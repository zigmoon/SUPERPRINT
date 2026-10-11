//! # superprint-text — césure et composition typographique
//!
//! Module n° 5 du noyau Rust de SuperPrint. Il répond à une question qu'un
//! exporteur d'impression ne peut pas éluder : **où un mot peut-il se couper ?**
//!
//! ## Les deux moteurs, et pourquoi il en faut deux
//!
//! 1. **[`motifs`]** — un **dictionnaire de césure** au sens de Liang (ceux de
//!    TeX, ceux de `hyphenation-fr.js`). Il connaît les mots d'une langue, mais
//!    il ne connaît **que** ça : ni l'apostrophe, ni le trait d'union, ni
//!    l'élision.
//! 2. **[`francais`]** — les **règles typographiques**. Elles ne connaissent pas
//!    le vocabulaire, mais elles savent ce qu'un dictionnaire ignore.
//!
//! Pris séparément, chacun produit des coupes fautives. Ensemble, ils tombent
//! juste. C'est très exactement ce qui s'était passé dans SuperPrint : un
//! correctif a dû être écrit après que le dictionnaire seul eut produit
//! `L'-habillage`, `grand-mè- | re`, `États-U- | nis` et `jour- | d'hui`. Les
//! règles françaises portées ici sont celles de ce correctif, **appliquées après
//! mesure** — et [`francais`] reproduit les commentaires d'origine, qui disent
//! quel cas réel a motivé chaque refus.
//!
//! ## Ce que le crate n'embarque pas
//!
//! **Aucun dictionnaire.** Les motifs sont des données de langue : les inclure
//! ferait grossir le `.wasm` de dizaines de kilo-octets par langue et
//! imposerait une mise à jour du noyau pour corriger une césure. Ils arrivent
//! par la frontière, dans l'un des deux formats que [`Motifs`] sait lire — dont
//! celui des fichiers que l'application possède déjà.
//!
//! ## Parité mesurée
//!
//! `scripts/validate-cesure.mjs` charge le **vrai** `hypher.js` et le **vrai**
//! `hyphenation-fr.js` du dépôt, extrait les **vraies** règles françaises de
//! `app/JS/main.js` (en lecture seule) et compare les deux moteurs **mot pour
//! mot**, position par position. Un écart ne serait pas un détail : ce serait
//! une coupe fautive livrée à l'imprimeur.
//!
//! ## Composition
//!
//! [`composition`] découpe un paragraphe en lignes pour une largeur donnée. Il
//! ne mesure **rien** lui-même : la mesure dépend de la police et du corps, donc
//! elle vient de l'appelant, sous forme d'une fonction. C'est ce qui permet au
//! noyau de composer sans rien savoir d'un canevas.
//!
//! ```no_run
//! use superprint_text::{Cesure, Compositeur, Motifs};
//!
//! // Les motifs de la langue arrivent de l'application (données, pas code).
//! let motifs = Motifs::depuis_pat("hy3ph\n", 2, 3);
//! let cesure = Cesure::dictionnaire(motifs);
//!
//! // La mesure vient de la police : ici, une largeur fixe par caractère.
//! let mesure = |t: &str| t.chars().count() as f64 * 6.0;
//! let lignes = Compositeur::new(&mesure)
//!     .avec_cesure(&cesure)
//!     .composer("un texte à composer", 100.0);
//! assert!(!lignes.is_empty());
//! ```

#![forbid(unsafe_code)]

pub mod composition;
pub mod francais;
pub mod motifs;
pub mod typographie;

pub use composition::{Compositeur, Ligne};
pub use motifs::Motifs;
pub use typographie::{EspacePonctuation, ReglesEspaces};

/// Le moteur de césure : un dictionnaire s'il y en a un, les règles françaises
/// dans tous les cas.
///
/// Un dictionnaire **vide** n'est pas une erreur : sans motifs, le module
/// travaille uniquement avec les règles de repli (découpage syllabique
/// français). C'est dégradé, mais ce n'est pas faux — et c'est ce que fait
/// l'application quand une langue n'a pas de motifs.
#[derive(Clone, Debug, Default)]
pub struct Cesure {
    motifs: Option<Motifs>,
}

impl Cesure {
    /// Sans dictionnaire : seules les règles françaises s'appliquent.
    #[must_use]
    pub fn nouvelle() -> Self {
        Self { motifs: None }
    }

    /// Avec un dictionnaire de motifs.
    #[must_use]
    pub fn dictionnaire(motifs: Motifs) -> Self {
        Self {
            motifs: Some(motifs),
        }
    }

    /// Le dictionnaire, s'il y en a un.
    #[must_use]
    pub fn motifs(&self) -> Option<&Motifs> {
        self.motifs.as_ref()
    }

    /// Les positions de coupe acceptées, en indices de caractères.
    ///
    /// C'est la chaîne complète : le dictionnaire propose, les règles françaises
    /// disposent. Une position refusée par les règles est **retirée**, même si le
    /// dictionnaire la demandait.
    #[must_use]
    pub fn coupes(&self, mot: &str) -> Vec<usize> {
        let Some(motifs) = &self.motifs else {
            return Vec::new();
        };
        let caracteres: Vec<char> = mot.chars().collect();
        let mut positions: Vec<usize> = motifs
            .coupes(mot)
            .into_iter()
            .filter(|i| francais::frontiere_valide(&caracteres, *i))
            .collect();
        positions.sort_unstable();
        positions.dedup();
        positions
    }

    /// Le mot découpé pour la composition, ou `None` s'il ne doit pas être coupé.
    ///
    /// L'ordre des étapes est celui qui compte, et il reproduit celui de
    /// l'application :
    ///
    /// 1. le **dictionnaire** propose ses coupes ;
    /// 2. les **règles françaises** les filtrent — et si plus aucune ne tient,
    ///    c'est le **découpage syllabique** qui prend le relais ;
    /// 3. les **traits d'union du mot** sont ajoutés comme frontières : un mot
    ///    composé se coupe à ses tirets, le dictionnaire ne le sait pas.
    #[must_use]
    pub fn couper(&self, mot: &str) -> Option<Vec<String>> {
        let du_dictionnaire = self.motifs.as_ref().map(|m| m.fragments(mot));
        let filtre = du_dictionnaire
            .as_ref()
            .and_then(|fragments| francais::filtrer(mot, fragments));
        let base = filtre.or_else(|| francais::syllabes(mot));
        let resultat = francais::ajouter_tirets(mot, base.as_deref())?;
        (resultat.len() > 1).then_some(resultat)
    }

    /// Le mot entier, ou `None` s'il n'est pas coupable.
    #[must_use]
    pub fn fragments(&self, mot: &str) -> Vec<String> {
        self.couper(mot).unwrap_or_else(|| vec![mot.to_string()])
    }

    /// Un texte où les mots coupables reçoivent un **trait conditionnel**
    /// (U+00AD), la forme attendue par un moteur de composition.
    ///
    /// ## Ce que fait exactement cette fonction
    ///
    /// C'est le portage de `Hypher.hyphenateText`, et une **mesure** a été
    /// nécessaire pour l'écrire juste. Le texte est découpé en **segments**
    /// alternés — suites de caractères de mot, puis suites de séparateurs — et :
    ///
    /// - un **mot** de plus de `minimum` caractères reçoit des traits
    ///   conditionnels aux positions que [`Cesure::coupes`] autorise ;
    /// - un **séparateur qui contient une barre oblique** reçoit une espace de
    ///   largeur nulle (U+200B) : c'est une occasion de coupure, placée **après
    ///   la barre**. C'est ce que fait Hypher, et le mesurer a été nécessaire :
    ///   la barre oblique n'est pas un caractère de mot, donc la règle s'applique
    ///   au *séparateur* `".cc/"` et non au mot qui le précède. La deviner aurait
    ///   donné une coupure au mauvais endroit.
    ///
    /// Les garde-fous d'Hypher sont conservés : ni au tout début, ni à la toute
    /// fin du texte, et pas quand la barre oblique touche déjà une espace — dans
    /// ce dernier cas elle est un séparateur, pas un mot.
    #[must_use]
    pub fn cesurer_texte(&self, texte: &str, minimum: usize) -> String {
        let segments = decouper_en_segments(texte);
        let dernier = segments.len().saturating_sub(1);
        let mut sortie = String::with_capacity(texte.len() + texte.len() / 8);
        for (index, (segment, est_mot)) in segments.iter().enumerate() {
            if *est_mot {
                if segment.chars().count() > minimum {
                    sortie.push_str(&poser_traits(segment, &self.coupes(segment)));
                } else {
                    sortie.push_str(segment);
                }
                continue;
            }
            sortie.push_str(segment);
            if segment.contains('/')
                && index != 0
                && index != dernier
                && !espace_autour_de_la_barre(segment)
            {
                sortie.push('\u{200B}');
            }
        }
        sortie
    }
}

/// Découpe un texte en segments alternés : `(segment, est_un_mot)`.
///
/// Les séparateurs sont **conservés** : c'est indispensable, puisque c'est sur
/// eux que la règle de la barre oblique s'applique.
fn decouper_en_segments(texte: &str) -> Vec<(String, bool)> {
    let mut segments: Vec<(String, bool)> = Vec::new();
    for c in texte.chars() {
        let est_mot = est_lettre_de_mot(c);
        match segments.last_mut() {
            Some((courant, meme_nature)) if *meme_nature == est_mot => courant.push(c),
            _ => segments.push((c.to_string(), est_mot)),
        }
    }
    segments
}

/// La barre oblique touche-t-elle une espace, juste avant ou juste après ?
fn espace_autour_de_la_barre(segment: &str) -> bool {
    let caracteres: Vec<char> = segment.chars().collect();
    for (index, c) in caracteres.iter().enumerate() {
        if *c != '/' {
            continue;
        }
        if index > 0 && caracteres[index - 1].is_whitespace() {
            return true;
        }
        if caracteres.get(index + 1).is_some_and(|s| s.is_whitespace()) {
            return true;
        }
    }
    false
}

/// Pose un trait conditionnel devant chaque position de coupe.
fn poser_traits(mot: &str, coupes: &[usize]) -> String {
    let mut sortie = String::with_capacity(mot.len() + coupes.len());
    for (index, c) in mot.chars().enumerate() {
        if coupes.contains(&index) {
            sortie.push('\u{00AD}');
        }
        sortie.push(c);
    }
    sortie
}

/// Un caractère qui fait partie d'un **mot coupable**.
///
/// C'est un choix, et il est explicite : lettres et chiffres Unicode, souligné,
/// trait conditionnel, apostrophes (droite et typographique), et la largeur nulle
/// de jointure. **Ni la barre oblique, ni le point** : une mesure sur le moteur
/// JavaScript a montré que `"superprint.cc/telecharger"` lui est présenté comme
/// trois mots (`superprint`, `cc`, `telecharger`) — la ponctuation sépare. Les
/// écritures qui ne se coupent pas par syllabes (idéogrammes, thaï) sont en
/// revanche **incluses** : elles traversent le moteur et ressortent intactes.
#[must_use]
pub fn est_lettre_de_mot(c: char) -> bool {
    c.is_alphanumeric()
        || matches!(
            c,
            '_' | '\u{00AD}' | '\'' | '\u{2019}' | '\u{02BC}' | '\u{200D}'
        )
        || ('\u{03AC}'..='\u{03CE}').contains(&c)
        || ('\u{0400}'..='\u{04FF}').contains(&c)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Motifs français minimalistes, écrits à la main : ils coupent là où on
    /// les attend, ce qui rend les tests lisibles.
    fn motifs() -> Motifs {
        Motifs::depuis_pat("hy3ph\n1ç1\n", 2, 3)
    }

    #[test]
    fn sans_dictionnaire_les_regles_de_repli_travaillent() {
        let cesure = Cesure::nouvelle();
        // « espaces » se découpe par les règles françaises, sans dictionnaire.
        assert_eq!(
            cesure.couper("espaces"),
            Some(vec!["es".to_string(), "pa".to_string(), "ces".to_string()])
        );
    }

    #[test]
    fn avec_dictionnaire_les_coupes_du_dictionnaire_gagnent() {
        let cesure = Cesure::dictionnaire(motifs());
        let coupes = cesure.coupes("hyphone");
        assert!(coupes.contains(&2), "coupe du dictionnaire : {coupes:?}");
    }

    #[test]
    fn les_regles_francaises_retirent_une_coupe_du_dictionnaire() {
        // Le dictionnaire propose de couper juste avant ET juste après
        // l'apostrophe de « L' ».
        let motifs = Motifs::depuis_pat("1'3h\n", 1, 1);
        assert_eq!(
            motifs.coupes("L'habillage"),
            vec![1, 2],
            "le dictionnaire propose bien ces deux coupes"
        );
        // Les règles françaises les retirent toutes les deux : « L'- » et
        // « -'habillage » ne doivent jamais sortir.
        let cesure = Cesure::dictionnaire(motifs);
        assert!(
            cesure.coupes("L'habillage").is_empty(),
            "aucune coupe autour d'une apostrophe"
        );
    }

    #[test]
    fn le_repli_syllabique_prend_le_relais_quand_le_filtre_refuse_tout() {
        // Un dictionnaire qui ne propose que des coupes fautives : une fois
        // filtrées, il n'en reste aucune, et le découpage syllabique français
        // doit prendre le relais.
        let cesure = Cesure::dictionnaire(Motifs::depuis_pat("1'3h\n", 1, 1));
        let resultat = cesure.couper("habillage").expect("repli attendu");
        assert!(resultat.len() > 1, "{resultat:?}");
        assert_eq!(resultat.concat(), "habillage", "aucune lettre perdue");
    }

    #[test]
    fn le_mot_compose_se_coupe_a_son_tiret() {
        let cesure = Cesure::nouvelle();
        let resultat = cesure.couper("papier-carton").expect("coupes attendues");
        // La ligne de coupe tombe sur un tiret du mot : c'est la frontière que
        // le dictionnaire ne connaît pas et que `ajouter_tirets` apporte.
        let mut cumul = 0usize;
        let mut positions = Vec::new();
        for fragment in resultat.iter().take(resultat.len() - 1) {
            cumul += fragment.chars().count();
            positions.push(cumul);
        }
        assert!(
            positions.contains(&7),
            "frontière du tiret attendue après « papier- » : {positions:?}"
        );
        assert_eq!(resultat.concat(), "papier-carton", "aucun caractère perdu");
        assert!(
            resultat.iter().any(|f| f.ends_with('-')),
            "un fragment doit se terminer par le tiret : {resultat:?}"
        );
    }

    #[test]
    fn un_mot_non_coupable_rend_none() {
        let cesure = Cesure::nouvelle();
        assert_eq!(cesure.couper("et"), None);
        assert_eq!(cesure.couper(""), None);
        assert_eq!(cesure.fragments("et"), vec!["et".to_string()]);
    }

    #[test]
    fn les_coupes_sont_triees_et_sans_doublon() {
        let cesure = Cesure::dictionnaire(Motifs::depuis_pat("1a1a1a1\n", 1, 1));
        let coupes = cesure.coupes("aaaaaa");
        let mut attendu = coupes.clone();
        attendu.sort_unstable();
        attendu.dedup();
        assert_eq!(coupes, attendu);
    }

    #[test]
    fn le_texte_recoit_des_traits_conditionnels() {
        let cesure = Cesure::dictionnaire(motifs());
        let resultat = cesure.cesurer_texte("un hyphone", 4);
        assert!(
            resultat.contains("hy\u{00AD}phone"),
            "trait conditionnel attendu : {resultat:?}"
        );
        // Les petits mots ne sont pas touchés.
        assert!(resultat.starts_with("un "));
    }

    #[test]
    fn un_mot_trop_court_n_est_pas_cesure() {
        let cesure = Cesure::dictionnaire(motifs());
        assert_eq!(cesure.cesurer_texte("hyphone", 20), "hyphone");
    }

    #[test]
    fn les_mots_deja_coupes_sont_respectes() {
        let cesure = Cesure::dictionnaire(motifs());
        let deja = "hy\u{00AD}phone";
        assert_eq!(cesure.cesurer_texte(deja, 4), deja);
    }

    #[test]
    fn une_barre_oblique_ouvre_une_coupe() {
        let cesure = Cesure::nouvelle();
        let resultat = cesure.cesurer_texte("superprint.cc/telecharger", 4);
        assert!(resultat.contains('\u{200B}'), "largeur nulle attendue");
    }

    #[test]
    fn la_pause_ne_perd_aucun_caractere() {
        let cesure = Cesure::dictionnaire(motifs());
        let texte = "Le chevalier hyphone vers la forêt, puis s'arrête.";
        let resultat = cesure.cesurer_texte(texte, 4);
        let sans_traits: String = resultat.chars().filter(|c| *c != '\u{00AD}').collect();
        assert_eq!(
            sans_traits, texte,
            "la césure ne doit rien perdre ni ajouter"
        );
    }

    #[test]
    fn les_caracteres_de_mot_sont_reconnus() {
        assert!(est_lettre_de_mot('a') && est_lettre_de_mot('é') && est_lettre_de_mot('7'));
        assert!(
            est_lettre_de_mot('日'),
            "un idéogramme traverse sans être cassé"
        );
        assert!(!est_lettre_de_mot(' ') && !est_lettre_de_mot(','));
    }
}
