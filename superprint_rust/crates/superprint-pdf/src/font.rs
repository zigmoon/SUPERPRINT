//! Écriture des **objets de police** d'un PDF, et suivi de ce qui est utilisé.
//!
//! ## Le choix d'`Identity-H`
//!
//! Un PDF peut décrire du texte de deux façons. La plus simple — une police
//! simple avec `WinAnsiEncoding` — est limitée à 256 caractères et interdit
//! d'embarquer une police TrueType complète sans se battre avec les
//! correspondances. On prend donc la voie des **polices composites** :
//!
//! ```text
//! /Type0  +  /Encoding /Identity-H  +  descendant /CIDFontType2
//! ```
//!
//! Conséquence à connaître : le flux de contenu **n'écrit pas des caractères**,
//! il écrit des **identifiants de glyphe** sur deux octets. C'est la raison
//! d'être de `superprint-font` : sans la table `cmap`, on ne saurait pas que
//! `é` est le glyphe 231 d'une police donnée.
//!
//! ## Et le texte reste-t-il lisible ?
//!
//! Avec `Identity-H` seul, un lecteur qui extrait le texte ne verrait que des
//! identifiants de glyphe — du charabia. On écrit donc **aussi** un flux
//! `/ToUnicode` (un CMap qui associe chaque identifiant de glyphe au caractère
//! Unicode voulu). C'est ce qui rend le texte **sélectionnable, copiable et
//! cherchable** dans le PDF produit, et c'est vérifié à l'extraction.

use std::collections::{BTreeMap, BTreeSet};

use superprint_font::FontFace;

use crate::object;

/// Nombre maximal d'entrées par bloc `beginbfchar` dans un CMap `/ToUnicode`.
///
/// La spécification CMap plafonne à 100 entrées par bloc ; au-delà, un lecteur
/// strict interrompt la lecture du flux et le texte devient partiellement
/// illisible.
const MAX_BFCHAR: usize = 100;

/// Nom de ressource d'une police dans une page : `/F0`, `/F1`…
#[must_use]
pub fn nom_ressource(index: usize) -> String {
    format!("F{index}")
}

/// Ce qu'une page a réellement écrit, police par police.
///
/// Rassemblé pendant la génération des flux de contenu, il sert ensuite à écrire
/// deux choses qu'on ne peut pas connaître à l'avance : les largeurs `/W` et la
/// table `/ToUnicode`.
#[derive(Clone, Debug, Default)]
pub struct FontUsage {
    /// Identifiants de glyphe utilisés, par police.
    pub gids: Vec<BTreeSet<u16>>,
    /// Correspondance identifiant de glyphe → caractère, par police.
    pub to_unicode: Vec<BTreeMap<u16, char>>,
    /// Nombre de caractères pour lesquels la police n'avait **aucun dessin**.
    ///
    /// Ce compteur existe pour ne pas produire un document silencieusement
    /// incomplet : `0` veut dire « tout s'imprimera ».
    pub substitues: usize,
}

impl FontUsage {
    /// S'assure que la police `index` a ses structures internes.
    pub fn ensure(&mut self, index: usize) {
        while self.gids.len() <= index {
            self.gids.push(BTreeSet::new());
            self.to_unicode.push(BTreeMap::new());
        }
    }

    /// Les polices effectivement utilisées, dans l'ordre de leur rang.
    #[must_use]
    pub fn polices_utilisees(&self) -> Vec<usize> {
        (0..self.gids.len())
            .filter(|index| !self.gids[*index].is_empty())
            .collect()
    }

    /// Fusionne les glyphes d'une page dans le total du document.
    pub fn fusionner(&mut self, index: usize, gids: &BTreeSet<u16>, unicode: &BTreeMap<u16, char>) {
        self.ensure(index);
        self.gids[index].extend(gids.iter().copied());
        // La première correspondance gagne : deux caractères peuvent partager un
        // dessin (c'est le cas des ligatures), et le premier rencontré est celui
        // que l'utilisateur a voulu écrire.
        for (gid, caractere) in unicode {
            self.to_unicode[index].entry(*gid).or_insert(*caractere);
        }
    }
}

/// Entrées du dictionnaire du flux `/FontFile2`.
#[must_use]
pub fn entrees_fontfile(face: &FontFace) -> String {
    // `/Length1` est la longueur du programme tel qu'il est, non compressé. On
    // n'écrit aucun filtre : la valeur est donc la longueur des octets.
    format!("/Length1 {}", face.data.len())
}

/// Dictionnaire `/FontDescriptor`.
#[must_use]
pub fn descripteur_pdf(face: &FontFace, nom: &str, fontfile: usize) -> String {
    let table = |valeur: i32| object::number(f64::from(face.unites1000_signe(valeur)));
    let bbox = object::array(&[
        table(i32::from(face.bbox[0])),
        table(i32::from(face.bbox[1])),
        table(i32::from(face.bbox[2])),
        table(i32::from(face.bbox[3])),
    ]);
    // `StemV` n'a pas de source fiable dans les tables lues : on donne la valeur
    // d'usage, plus grasse pour un gras. Ce n'est pas une mesure, c'est une
    // déclaration — et elle n'affecte que l'émulation d'une police absente.
    let stem_v = if face.bold { 120 } else { 80 };

    format!(
        "<< /Type /FontDescriptor /FontName {} /Flags {} /FontBBox {} /ItalicAngle {} \
         /Ascent {} /Descent {} /CapHeight {} /StemV {stem_v} /FontFile2 {fontfile} 0 R >>\n",
        object::name(nom),
        face.drapeaux_pdf(),
        bbox,
        object::number(face.italic_angle),
        table(i32::from(face.ascent)),
        table(i32::from(face.descent)),
        table(i32::from(face.cap_height)),
    )
}

/// Tableau `/W` des largeurs, pour les seuls glyphes réellement utilisés.
///
/// Forme employée : `gid [largeur]` répété. C'est la forme la plus explicite du
/// format — elle se relit sans calcul, ce qui compte pour un fichier
/// d'impression qu'un tiers peut devoir inspecter.
///
/// Un glyphe dont la largeur vaut `/DW` (1000) est omis : le défaut s'applique.
#[must_use]
pub fn largeurs_pdf(face: &FontFace, gids: &BTreeSet<u16>) -> String {
    let mut morceaux = Vec::with_capacity(gids.len());
    for gid in gids {
        let largeur = face.advance1000(*gid);
        if largeur == 1000 {
            continue;
        }
        morceaux.push(format!("{gid} [{}]", object::number(f64::from(largeur))));
    }
    if morceaux.is_empty() {
        // Un tableau vide est valide et signifie « tout au défaut ».
        return "[]".to_string();
    }
    format!("[{}]", morceaux.join(" "))
}

/// Dictionnaire de la police descendante (`/CIDFontType2`).
#[must_use]
pub fn cidfont_pdf(face: &FontFace, nom: &str, descripteur: usize, largeurs: &str) -> String {
    let _ = face;
    format!(
        "<< /Type /Font /Subtype /CIDFontType2 /BaseFont {} \
         /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> \
         /FontDescriptor {descripteur} 0 R /CIDToGIDMap /Identity /DW 1000 /W {largeurs} >>\n",
        object::name(nom)
    )
}

/// Dictionnaire de la police composite (`/Type0`).
#[must_use]
pub fn type0_pdf(nom: &str, cid: usize, tounicode: usize) -> String {
    format!(
        "<< /Type /Font /Subtype /Type0 /BaseFont {} /Encoding /Identity-H \
         /DescendantFonts [{cid} 0 R] /ToUnicode {tounicode} 0 R >>\n",
        object::name(nom)
    )
}

/// Flux `/ToUnicode` : le CMap qui rend le texte **extractible**.
///
/// Sans lui, un lecteur ne voit que des identifiants de glyphe : le texte
/// s'affiche, mais il n'est ni sélectionnable, ni copiable, ni cherchable — et
/// aucun contrôle automatique ne peut vérifier ce qui a été écrit.
#[must_use]
pub fn to_unicode_cmap(correspondances: &BTreeMap<u16, char>) -> String {
    let mut flux = String::with_capacity(256 + correspondances.len() * 16);
    flux.push_str(
        "/CIDInit /ProcSet findresource begin\n\
         12 dict begin\n\
         begincmap\n\
         /CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n\
         /CMapName /Adobe-Identity-UCS def\n\
         /CMapType 2 def\n\
         1 begincodespacerange\n\
         <0000> <FFFF>\n\
         endcodespacerange\n",
    );

    let entrees: Vec<(&u16, &char)> = correspondances.iter().collect();
    for bloc in entrees.chunks(MAX_BFCHAR) {
        flux.push_str(&format!("{} beginbfchar\n", bloc.len()));
        for &(gid, caractere) in bloc {
            flux.push_str(&format!("<{gid:04X}> <{}>\n", utf16be_hex(*caractere)));
        }
        flux.push_str("endbfchar\n");
    }

    flux.push_str(
        "endcmap\n\
         CMapName currentdict /CMap defineresource pop\n\
         end\n\
         end\n",
    );
    flux
}

/// Un caractère en **UTF-16BE hexadécimal**, paire de substitution comprise.
///
/// Un idéogramme ou un emoji est au-delà du plan multilingue de base : il
/// s'écrit en **deux** unités de 16 bits. Écrire ses quatre chiffres hexadécimaux
/// bruts produirait une table fausse — le texte serait extractible en apparence
/// et illisible en pratique.
fn utf16be_hex(caractere: char) -> String {
    let mut tampon = [0u16; 2];
    caractere
        .encode_utf16(&mut tampon)
        .iter()
        .map(|unite| format!("{unite:04X}"))
        .collect()
}

/// Le flux de contenu qui **affiche** une chaîne, en identifiants de glyphe.
///
/// `lignes` contient les identifiants déjà résolus, une entrée par ligne du
/// texte. `leading` est l'interligne en points, appliqué vers le bas entre deux
/// lignes.
#[must_use]
pub fn ops_texte(
    ressource: &str,
    taille_pt: f64,
    x_pt: f64,
    y_pt: f64,
    lignes: &[Vec<u16>],
    leading_pt: f64,
) -> String {
    if lignes.iter().all(Vec::is_empty) {
        return String::new();
    }
    let mut ops = String::new();
    ops.push_str(&format!(
        "/{ressource} {} Tf\n",
        object::number(taille_pt.max(0.0))
    ));
    ops.push_str("BT\n");
    for (index, glyphes) in lignes.iter().enumerate() {
        if glyphes.is_empty() {
            continue;
        }
        let descente = leading_pt * index as f64;
        ops.push_str(&format!(
            "1 0 0 1 {} {} Tm\n",
            object::number(x_pt),
            object::number(y_pt - descente)
        ));
        // Chaîne hexadécimale : chaque glyphe sur quatre chiffres, sans
        // séparateur — c'est la forme dense prévue par le format.
        let hex: String = glyphes.iter().map(|g| format!("{g:04X}")).collect();
        ops.push_str(&format!("<{hex}> Tj\n"));
    }
    ops.push_str("ET\n");
    ops
}

#[cfg(test)]
mod tests {
    use super::*;
    use superprint_font::synth::{construire, PoliceSynth};

    /// Une police synthétique : l'arithmétique des largeurs et des noms est
    /// testée sur des valeurs connues, sans dépendre d'un fichier externe.
    fn face() -> FontFace {
        FontFace::parse(construire(&PoliceSynth::default())).expect("police synthétique lisible")
    }

    #[test]
    fn noms_de_ressource() {
        assert_eq!(nom_ressource(0), "F0");
        assert_eq!(nom_ressource(12), "F12");
    }

    #[test]
    fn entrees_fontfile_annoncent_la_longueur() {
        let face = face();
        let entrees = entrees_fontfile(&face);
        assert_eq!(entrees, format!("/Length1 {}", face.data.len()));
        assert!(
            face.data.len() > 100,
            "le fichier de test doit être substantiel"
        );
    }

    #[test]
    fn descripteur_complet_et_signes_conserves() {
        let face = face();
        let descripteur = descripteur_pdf(&face, "Synthetique", 7);
        assert!(descripteur.contains("/Type /FontDescriptor"));
        assert!(descripteur.contains("/FontName /Synthetique"));
        assert!(descripteur.contains("/FontFile2 7 0 R"));
        assert!(descripteur.contains("/Flags 32"), "Nonsymbolic seul");
        assert!(descripteur.contains("/Ascent 800"));
        assert!(
            descripteur.contains("/Descent -200"),
            "la descente doit rester négative : {descripteur}"
        );
        assert!(descripteur.contains("/CapHeight 700"));
        assert!(descripteur.contains("/FontBBox [0 -200 1000 800]"));
        assert!(descripteur.contains("/StemV 80"));
    }

    #[test]
    fn descripteur_gras_a_un_stemv_plus_fort() {
        let mut face = face();
        face.bold = true;
        assert!(descripteur_pdf(&face, "X", 1).contains("/StemV 120"));
        assert_eq!(face.drapeaux_pdf() & 0x40000, 0x40000, "drapeau ForceBold");
    }

    #[test]
    fn largeurs_omises_quand_elles_valent_le_defaut() {
        // Un caractère dont l'avance vaut exactement 1000 unités ne s'écrit pas :
        // `/DW 1000` s'applique, et le tableau reste court.
        let description = PoliceSynth {
            glyphes: vec![('A', 1000), ('B', 600)],
            ..PoliceSynth::default()
        };
        let face = FontFace::parse(construire(&description)).unwrap();

        let mut gids = BTreeSet::new();
        gids.insert(1u16); // A → 1000 : omis
        gids.insert(2u16); // B → 600 : écrit
        assert_eq!(largeurs_pdf(&face, &gids), "[2 [600]]");

        // Aucun glyphe : tableau vide, ce qui est valide.
        assert_eq!(largeurs_pdf(&face, &BTreeSet::new()), "[]");
    }

    #[test]
    fn cidfont_declare_identite_et_defaut() {
        let face = face();
        let cid = cidfont_pdf(&face, "Synthetique", 3, "[1 [250]]");
        assert!(cid.contains("/Subtype /CIDFontType2"));
        assert!(cid.contains("/CIDToGIDMap /Identity"));
        assert!(cid.contains("/Ordering (Identity)"));
        assert!(cid.contains("/DW 1000"));
        assert!(cid.contains("/W [1 [250]]"));
        assert!(cid.contains("/FontDescriptor 3 0 R"));
    }

    #[test]
    fn type0_pointe_sur_le_descendant_et_la_table_unicode() {
        let type0 = type0_pdf("Synthetique", 4, 5);
        assert!(type0.contains("/Subtype /Type0"));
        assert!(type0.contains("/Encoding /Identity-H"));
        assert!(type0.contains("/DescendantFonts [4 0 R]"));
        assert!(type0.contains("/ToUnicode 5 0 R"));
        // Le descendant vient après la déclaration du parent : c'est la
        // référence en avant que le Writer sait gérer.
        assert!(!type0.contains("/FontFile2"));
    }

    #[test]
    fn cmap_to_unicode_est_conforme() {
        let mut correspondances = BTreeMap::new();
        correspondances.insert(2u16, 'A');
        correspondances.insert(6u16, 'é');
        let cmap = to_unicode_cmap(&correspondances);

        assert!(cmap.contains("begincmap"));
        assert!(cmap.contains("/CMapType 2 def"));
        assert!(cmap.contains("1 begincodespacerange"));
        assert!(cmap.contains("<0000> <FFFF>"));
        assert!(cmap.contains("2 beginbfchar"));
        assert!(cmap.contains("<0002> <0041>"), "A = U+0041");
        assert!(cmap.contains("<0006> <00E9>"), "é = U+00E9");
        assert!(cmap.contains("endbfchar"));
        assert!(cmap.contains("endcmap"));
    }

    #[test]
    fn cmap_decoupe_en_blocs_de_cent() {
        // 250 entrées : trois blocs (100, 100, 50). Un bloc trop long ferait
        // échouer la lecture chez un lecteur strict.
        let correspondances: BTreeMap<u16, char> = (1..=250u16).map(|gid| (gid, 'A')).collect();
        let cmap = to_unicode_cmap(&correspondances);
        assert!(cmap.contains("100 beginbfchar"));
        assert!(cmap.contains("50 beginbfchar"));
        assert_eq!(cmap.matches("beginbfchar").count(), 3);
    }

    #[test]
    fn cmap_ecrit_les_paires_de_substitution() {
        // Un idéogramme hors BMP s'écrit en deux unités de 16 bits.
        let mut correspondances = BTreeMap::new();
        correspondances.insert(9u16, '\u{1F600}'); // emoji
        let cmap = to_unicode_cmap(&correspondances);
        assert!(
            cmap.contains("<0009> <D83DDE00>"),
            "paire de substitution attendue ; obtenu : {cmap}"
        );
    }

    #[test]
    fn cmap_vide_reste_valide() {
        let cmap = to_unicode_cmap(&BTreeMap::new());
        assert!(cmap.contains("begincmap") && cmap.contains("endcmap"));
        assert!(!cmap.contains("beginbfchar"));
    }

    #[test]
    fn ops_texte_ecrit_les_identifiants_en_hexadecimal() {
        let ops = ops_texte("F0", 12.0, 100.0, 200.0, &[vec![2, 3, 6]], 14.4);
        assert!(ops.contains("/F0 12 Tf"));
        assert!(ops.contains("BT"));
        assert!(ops.contains("1 0 0 1 100 200 Tm"));
        assert!(ops.contains("<000200030006> Tj"));
        assert!(ops.contains("ET"));
    }

    #[test]
    fn ops_texte_plusieurs_lignes_descendent() {
        let ops = ops_texte("F1", 10.0, 0.0, 100.0, &[vec![2], vec![3], vec![4]], 12.0);
        assert!(ops.contains("1 0 0 1 0 100 Tm"), "première ligne à y");
        assert!(ops.contains("1 0 0 1 0 88 Tm"), "deuxième à y − 12");
        assert!(ops.contains("1 0 0 1 0 76 Tm"), "troisième à y − 24");
        assert_eq!(ops.matches(" Tj\n").count(), 3);
    }

    #[test]
    fn ops_texte_lignes_vides_ignorees() {
        let ops = ops_texte("F0", 10.0, 0.0, 50.0, &[vec![], vec![2], vec![]], 12.0);
        assert_eq!(ops.matches(" Tj\n").count(), 1);
        // Deux sauts de ligne n'ont pas bougé la ligne utile : elle est seule.
        assert!(ops.contains("1 0 0 1 0 38 Tm"));
    }

    #[test]
    fn ops_texte_sans_glyphe_ne_produit_rien() {
        assert_eq!(ops_texte("F0", 10.0, 0.0, 0.0, &[], 12.0), "");
        assert_eq!(ops_texte("F0", 10.0, 0.0, 0.0, &[vec![], vec![]], 12.0), "");
    }

    #[test]
    fn usage_fusionne_et_compte_les_polices() {
        let mut usage = FontUsage::default();
        let mut gids = BTreeSet::new();
        gids.insert(2u16);
        let mut unicode = BTreeMap::new();
        unicode.insert(2u16, 'A');

        usage.fusionner(0, &gids, &unicode);
        usage.fusionner(0, &gids, &unicode);

        assert_eq!(usage.polices_utilisees(), vec![0]);
        assert_eq!(
            usage.gids[0].len(),
            1,
            "un identifiant répété ne compte qu'une fois"
        );
        assert_eq!(usage.to_unicode[0].get(&2), Some(&'A'));

        // La première correspondance gagne : un second passage ne la remplace pas.
        let mut autre = BTreeMap::new();
        autre.insert(2u16, 'Z');
        usage.fusionner(0, &BTreeSet::new(), &autre);
        assert_eq!(usage.to_unicode[0].get(&2), Some(&'A'));

        // Une police sans glyphe n'est pas déclarée utilisée.
        usage.ensure(3);
        assert_eq!(usage.polices_utilisees(), vec![0]);
    }
}
