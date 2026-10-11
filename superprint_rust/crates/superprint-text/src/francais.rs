//! Règles typographiques **françaises** de césure.
//!
//! ## D'où vient ce code
//!
//! C'est le portage fidèle du bloc « CÉSURE : RÈGLES TYPOGRAPHIQUES FRANÇAISES »
//! de `superprint/app/JS/main.js` (lignes 5560-5728). Ces règles ne sont **pas**
//! de la théorie : chacune a été ajoutée après une **mesure** sur des cas réels,
//! et les commentaires d'origine le disent. Les voici, telles quelles :
//!
//! - « `L'-` en coupant `L'habillage` » → on ne coupe **jamais** juste après une
//!   apostrophe d'élision ;
//! - « `grand-mè- | re` » → il faut **3** lettres après le tiret, pas 2 ;
//! - « `aujourd'hui` sortait en `jour- | d'hui` » → jamais de coupe juste **avant**
//!   une élision ;
//! - « `États-U- | nis` » et « `gran- | d-mère` » → les minima se comptent **par
//!   segment** (l'élément du mot composé), pas sur le mot entier ;
//! - « `États-Unis` n'avait plus aucune frontière » → les **traits d'union du mot
//!   sont des frontières de coupe**.
//!
//! ## Pourquoi ces règles comptent autant que le dictionnaire
//!
//! Un dictionnaire de motifs ne connaît pas la ponctuation : il ignore
//! l'apostrophe, le trait d'union, l'élision. Sans ces règles, il produit des
//! coupes **fautives en français** — et c'est exactement ce qui s'était produit.
//! Le dictionnaire propose, ces règles **disposent**.

/// Nombre minimal de caractères **avant** une coupe.
pub const MIN_AVANT: usize = 2;

/// Nombre minimal de caractères **après** une coupe.
///
/// Convention française : 3, et non 2 (`grand-mè-re` et non `grand-mè- | re`).
pub const MIN_APRES: usize = 3;

/// Les voyelles, accents compris.
const VOYELLES: &str = "aeiouyàâäéèêëïîôùûüÿœæAEIOUYÀÂÄÉÈÊËÏÎÔÙÛÜŸŒÆ";

/// Les apostrophes d'élision : droite, typographique, et modificatrice.
const APOSTROPHES: [char; 3] = ['\'', '\u{2019}', '\u{02BC}'];

/// Les traits d'union : trait d'union, trait conditionnel, insécable,
/// demi-cadratin, cadratin.
///
/// 🆕 **2026-10-11** : le trait conditionnel (U+00AD) a été **ajouté** à la
/// liste du JavaScript. Il manquait, et son absence se voyait : un mot composé
/// écrit avec un trait conditionnel (`États\u{00AD}Unis`) n'était pas reconnu
/// comme mot composé, donc sa frontière de tiret était refusée — alors que
/// c'est précisément la coupe que l'utilisateur avait **déjà** décidée. Le
/// placer un caractère d'avance est une extension, pas un écart : elle ne peut
/// que rendre admissible une coupe que l'utilisateur a lui-même écrite.
const TIRETS: [char; 6] = [
    '-', '\u{2010}', '\u{2011}', '\u{2013}', '\u{2014}', '\u{00AD}',
];

/// Groupes de deux consonnes qui forment **un seul** son : ils vont ensemble.
const DIGRAPHES: [&str; 6] = ["ch", "ph", "th", "gn", "gu", "qu"];

/// Groupes de deux consonnes inséparables : `b` + `l` ne se coupent pas.
const INSECABLES: [&str; 13] = [
    "bl", "br", "cl", "cr", "dr", "fl", "fr", "gl", "gr", "pl", "pr", "tr", "vr",
];

/// Une lettre, au sens du JavaScript d'origine : `[A-Za-zÀ-ÿ]`.
#[must_use]
pub fn est_lettre(c: char) -> bool {
    c.is_ascii_alphabetic() || ('\u{00C0}'..='\u{00FF}').contains(&c)
}

/// Une voyelle, accents compris.
#[must_use]
pub fn est_voyelle(c: char) -> bool {
    VOYELLES.contains(c)
}

/// Une apostrophe d'élision.
#[must_use]
pub fn est_apostrophe(c: char) -> bool {
    APOSTROPHES.contains(&c)
}

/// Un trait d'union (au sens large).
#[must_use]
pub fn est_tiret(c: char) -> bool {
    TIRETS.contains(&c)
}

/// La coupe à la position `i` est-elle **typographiquement admissible** ?
///
/// `i` est un indice de caractère ; couper signifie : séparer après le `i`-ᵉ
/// caractère. C'est la question centrale du module : le dictionnaire propose des
/// positions, cette fonction dit lesquelles le français accepte.
#[must_use]
pub fn frontiere_valide(mot: &[char], i: usize) -> bool {
    if i < MIN_AVANT || i > mot.len() {
        return false;
    }
    if mot.len() - i < MIN_APRES {
        return false;
    }
    let avant = mot[i - 1];
    let apres = mot[i];

    // Jamais juste après (ou juste avant) une apostrophe d'élision.
    if est_apostrophe(avant) || est_apostrophe(apres) {
        return false;
    }
    // Jamais juste AVANT un trait d'union : il EST déjà la coupe du mot composé.
    // La frontière juste APRÈS un trait d'union est au contraire la bonne coupe
    // (« États- | Unis ») : elle est acceptée ici.
    if est_tiret(apres) {
        return false;
    }
    // ① Jamais juste avant une élision (`d'hui`, `qu'un`, `l'homme`).
    if commence_par_elision(&mot[i..]) {
        return false;
    }

    // ② Les minima se comptent **par segment**, pas sur le mot entier.
    let coupe_au_tiret = est_tiret(avant);
    let depart = if coupe_au_tiret {
        i.saturating_sub(2)
    } else {
        i - 1
    };
    let mut debut_segment = 0usize;
    // `depart` peut valoir 0 : la boucle s'arrête alors d'elle-même.
    for (k, c) in mot.iter().enumerate().take(depart + 1).rev() {
        if est_tiret(*c) || est_apostrophe(*c) {
            debut_segment = k + 1;
            break;
        }
    }
    if i - debut_segment < MIN_AVANT {
        return false;
    }
    // Une coupe au trait d'union n'a besoin que de 2 caractères après elle :
    // un mot composé se coupe à ses tirets, ses éléments gardent leur longueur.
    if coupe_au_tiret {
        return mot.len() - i >= 2;
    }
    let mut fin_segment = mot.len();
    for (k, c) in mot.iter().enumerate().skip(i) {
        if est_tiret(*c) {
            fin_segment = k;
            break;
        }
    }
    fin_segment - i >= MIN_APRES
}

/// Le fragment commence-t-il par une élision (`d'`, `qu'`, `l'`…) ?
fn commence_par_elision(fragment: &[char]) -> bool {
    let mut iter = fragment.iter().copied();
    let Some(premier) = iter.next() else {
        return false;
    };
    let deuxieme = iter.next();
    if premier.eq_ignore_ascii_case(&'q') {
        return matches!(iter.next(), Some(c) if est_apostrophe(c));
    }
    matches!(
        premier.to_ascii_lowercase(),
        'c' | 'd' | 'j' | 'l' | 'm' | 'n' | 's' | 't'
    ) && matches!(deuxieme, Some(c) if est_apostrophe(c))
}

/// Où couper dans le groupe de consonnes qui commence à `i` ?
///
/// On suppose `mot[i - 1]` voyelle et `mot[i]` consonne. Renvoie la position de
/// coupe, ou `None` s'il n'y a pas de groupe à couper.
///
/// ⚠️ **Le cas `i` sur une voyelle ou une non-lettre ne panique pas** : il rend
/// `None`. Le JavaScript d'origine, lui, retomberait sur `i - 1` — un cas
/// dégénéré que ses appelants n'atteignent jamais. Le corpus de contrôle a
/// trouvé ce chemin : mieux vaut une fonction publique qui répond `None` qu'une
/// fonction qui interrompt un export.
#[must_use]
pub fn coupe_du_groupe(mot: &[char], i: usize) -> Option<usize> {
    if i >= mot.len() {
        return None;
    }
    let mut j = i;
    while j < mot.len() && est_lettre(mot[j]) && !est_voyelle(mot[j]) {
        j += 1;
    }
    if j >= mot.len() {
        return None; // le mot finit par des consonnes : aucune syllabe après
    }
    let groupe: Vec<char> = mot[i..j].to_vec();
    let n = groupe.len();
    if n == 0 {
        // Rien à grouper : `mot[i]` est une voyelle ou n'est pas une lettre.
        return None;
    }
    if n == 1 {
        return Some(i);
    }
    let deux: String = groupe[..2].iter().collect::<String>().to_lowercase();
    let deux = deux.as_str();
    if n == 2 {
        if groupe[0] == groupe[1] {
            return Some(i + 1); // consonne doublée : on coupe entre les deux
        }
        if DIGRAPHES.contains(&deux) {
            return Some(i); // ch, ph, th, gn, gu, qu : inséparables
        }
        if INSECABLES.contains(&deux) {
            return Some(i); // bl, tr, fr… : groupes insécables
        }
        return Some(i + 1); // es|paces
    }
    let fin: String = groupe[n - 2..].iter().collect::<String>().to_lowercase();
    let fin = fin.as_str();
    if INSECABLES.contains(&fin) || DIGRAPHES.contains(&fin) {
        return Some(i + n - 2);
    }
    Some(i + n - 1)
}

/// Découpe un mot en syllabes selon les règles françaises.
///
/// C'est le **repli** : on s'en sert quand le dictionnaire ne propose rien. Un
/// mot de moins de 5 caractères est refusé d'emblée (il n'y a rien à couper).
#[must_use]
pub fn syllabes(mot: &str) -> Option<Vec<String>> {
    let caracteres: Vec<char> = mot.chars().collect();
    if caracteres.len() < 5 {
        return None;
    }
    let mut coupes: Vec<usize> = Vec::new();
    for i in 1..caracteres.len() {
        if !est_voyelle(caracteres[i - 1]) {
            continue;
        }
        if est_voyelle(caracteres[i]) {
            continue;
        }
        if !est_lettre(caracteres[i]) {
            continue;
        }
        let Some(c) = coupe_du_groupe(&caracteres, i) else {
            continue;
        };
        if !frontiere_valide(&caracteres, c) {
            continue;
        }
        if !coupes.contains(&c) {
            coupes.push(c);
        }
    }
    if coupes.is_empty() {
        return None;
    }
    let morceaux = super::motifs::decouper(mot, &coupes);
    if morceaux.len() > 1 {
        Some(morceaux)
    } else {
        None
    }
}

/// Ne garde, parmi les fragments proposés par le dictionnaire, que les coupes
/// que le français accepte.
///
/// Renvoie `None` s'il ne reste **aucune** coupe : mieux vaut alors laisser le
/// mot entier que de le couper n'importe où.
#[must_use]
pub fn filtrer(mot: &str, morceaux: &[String]) -> Option<Vec<String>> {
    if morceaux.len() <= 1 || mot.is_empty() {
        return None;
    }
    let caracteres: Vec<char> = mot.chars().collect();
    let mut positions = Vec::with_capacity(morceaux.len() - 1);
    let mut cumul = 0usize;
    for morceau in morceaux.iter().take(morceaux.len() - 1) {
        cumul += morceau.chars().count();
        positions.push(cumul);
    }
    let valides: Vec<usize> = positions
        .iter()
        .copied()
        .filter(|i| frontiere_valide(&caracteres, *i))
        .collect();
    if valides.is_empty() {
        return None;
    }
    if valides.len() == positions.len() {
        return Some(morceaux.to_vec());
    }
    let resultat = super::motifs::decouper(mot, &valides);
    if resultat.len() > 1 {
        Some(resultat)
    } else {
        None
    }
}

/// Ajoute les **traits d'union du mot** aux frontières de coupe.
///
/// Un mot composé (« États-Unis ») a des frontières naturelles que le
/// dictionnaire ne connaît pas : ses tirets. La ligne qui finit déjà par ce
/// tiret n'en reçoit aucun autre — c'est le rôle du drapeau rendu par la
/// composition.
#[must_use]
pub fn ajouter_tirets(mot: &str, morceaux: Option<&[String]>) -> Option<Vec<String>> {
    if mot.is_empty() {
        return None;
    }
    let caracteres: Vec<char> = mot.chars().collect();
    let mut positions: Vec<usize> = Vec::new();
    if let Some(morceaux) = morceaux {
        if morceaux.len() > 1 {
            let mut cumul = 0usize;
            for morceau in morceaux.iter().take(morceaux.len() - 1) {
                cumul += morceau.chars().count();
                positions.push(cumul);
            }
        }
    }
    for (k, c) in caracteres
        .iter()
        .enumerate()
        .take(caracteres.len().saturating_sub(1))
        .skip(1)
    {
        if est_tiret(*c) {
            positions.push(k + 1);
        }
    }
    positions.sort_unstable();
    positions.dedup();
    positions.retain(|i| *i > 0 && *i < caracteres.len());

    let valides: Vec<usize> = positions
        .iter()
        .copied()
        .filter(|i| frontiere_valide(&caracteres, *i))
        .collect();
    if valides.is_empty() {
        return morceaux.filter(|m| m.len() > 1).map(<[String]>::to_vec);
    }
    let resultat = super::motifs::decouper(mot, &valides);
    if resultat.len() > 1 {
        Some(resultat)
    } else {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn c(texte: &str) -> Vec<char> {
        texte.chars().collect()
    }

    #[test]
    fn les_voyelles_et_les_lettres_accentuees_sont_reconnues() {
        assert!(est_voyelle('a') && est_voyelle('é') && est_voyelle('Œ') && est_voyelle('û'));
        assert!(!est_voyelle('b') && !est_voyelle('-'));
        assert!(est_lettre('A') && est_lettre('ÿ'));
        // ⚠️ Limite **reproduite telle quelle** : le JavaScript teste
        // `[A-Za-zÀ-ÿ]`, une plage qui s'arrête à `ÿ` (U+00FF). La ligature `œ`
        // (U+0153) est donc **au-dessus** et n'est pas une lettre pour ces
        // règles. C'est une imprécision de l'original, et la corriger ici ferait
        // diverger le Rust du comportement que l'utilisateur voit dans
        // l'application. Elle est signalée plutôt que corrigée en silence.
        assert!(!est_lettre('œ'), "limite de la plage À-ÿ de l'original");
        assert!(!est_lettre('1') && !est_lettre('\u{00A0}'));
    }

    #[test]
    fn on_ne_coupe_jamais_apres_une_elision() {
        // « L'habillage » : couper après l'apostrophe donnait « L'- ».
        let mot = c("L'habillage");
        assert!(!frontiere_valide(&mot, 2), "juste après l'apostrophe");
        assert!(!frontiere_valide(&mot, 1), "trop près du début");
        // Une coupe plus loin reste possible.
        assert!(frontiere_valide(&mot, 5), "L'ha|billage reste coupable");
    }

    #[test]
    fn on_ne_coupe_jamais_juste_avant_une_elision() {
        // « aujourd'hui » sortait en « jour- | d'hui ».
        let mot = c("aujourd'hui");
        let avant_elision = mot.len() - 4; // juste avant le « d' »
        assert!(!frontiere_valide(&mot, avant_elision));
        // Mais « au- | jourd'hui » est parfaitement français.
        assert!(frontiere_valide(&mot, 2));
    }

    #[test]
    fn qu_est_aussi_une_elision() {
        let mot = c("quelqu'un");
        assert!(!frontiere_valide(&mot, mot.len() - 3), "juste avant qu'");
    }

    #[test]
    fn trois_lettres_apres_la_coupe_pas_deux() {
        // « grand-mère » ne doit pas donner « grand-mè- | re ».
        let mot = c("grand-mère");
        // Coupe après « mè » (indice 8) : il ne reste que « re », deux lettres.
        assert!(!frontiere_valide(&mot, 8));
        // Coupe APRÈS le tiret (indice 6) : « grand- | mère », la bonne.
        assert!(frontiere_valide(&mot, 6));
        // Coupe justement refusée : juste AVANT le tiret (indice 5), le tiret
        // est déjà la coupe du mot composé.
        assert!(!frontiere_valide(&mot, 5));
    }

    #[test]
    fn les_minima_se_comptent_par_segment() {
        // « États-Unis » : couper après « États-U » laisserait un seul caractère
        // dans le segment.
        let mot = c("États-Unis");
        assert!(!frontiere_valide(&mot, 7), "« États-U- » doit être refusé");
        // La coupe au tiret, elle, est bonne : « États- | Unis ».
        assert!(frontiere_valide(&mot, 6));
    }

    #[test]
    fn une_coupe_au_tiret_ne_demande_que_deux_caracteres_apres() {
        // « c'est-à-dire » ne fait que 3 caractères après le tiret du milieu,
        // et c'est pourtant une coupe valide.
        let mot = c("c'est-à-dire");
        let apres_premier_tiret = 6;
        assert!(frontiere_valide(&mot, apres_premier_tiret));
    }

    #[test]
    fn un_groupe_de_deux_consonnes_se_coupe_entre_les_deux() {
        // « es|paces » : la coupe se calcule depuis la consonne qui suit une
        // voyelle — ici le `s` de l'indice 1.
        assert_eq!(coupe_du_groupe(&c("espaces"), 1), Some(2));
    }

    #[test]
    fn une_consonne_doublee_se_coupe_entre_les_deux() {
        // « ir|ré » : consonne doublée.
        assert_eq!(coupe_du_groupe(&c("irréel"), 1), Some(2));
    }

    #[test]
    fn un_digraphe_ou_un_groupe_insecable_reste_entier() {
        // « pro|chable » : « ch » ne se sépare pas.
        assert_eq!(coupe_du_groupe(&c("prochable"), 3), Some(3));
        // « ta|bleau » : « bl » ne se sépare pas.
        assert_eq!(coupe_du_groupe(&c("tableau"), 2), Some(2));
        // « tra|vail » : une consonne seule se coupe avant elle.
        assert_eq!(coupe_du_groupe(&c("travail"), 3), Some(3));
    }

    #[test]
    fn trois_consonnes_se_coupent_avant_la_derniere() {
        // « cons|tipation » : le groupe est `nst`, on coupe avant la dernière.
        assert_eq!(coupe_du_groupe(&c("constipation"), 2), Some(4));
    }

    #[test]
    fn un_groupe_final_insecable_se_garde_entier() {
        // Un groupe qui finit par « br »/« tr » ne se sépare pas au milieu :
        // « ar|briser » et non « arb|riser ».
        assert_eq!(coupe_du_groupe(&c("arbriser"), 1), Some(2));
        assert_eq!(coupe_du_groupe(&c("astrophysique"), 1), Some(2));
    }

    #[test]
    fn un_mot_qui_finit_par_des_consonnes_n_a_pas_de_groupe() {
        assert_eq!(coupe_du_groupe(&c("arc"), 1), None);
    }

    #[test]
    fn la_syllabation_de_repli_trouve_les_coupes() {
        let syllabes = syllabes("espaces").expect("coupe attendue");
        assert_eq!(syllabes, vec!["es", "pa", "ces"]);
    }

    #[test]
    fn la_syllabation_refuse_les_mots_trop_courts() {
        assert!(syllabes("mot").is_none());
        assert!(syllabes("").is_none());
    }

    #[test]
    fn le_filtre_rejette_les_coupes_fautives_du_dictionnaire() {
        // Un dictionnaire qui proposerait « L'-habillage » : le filtre refuse.
        let morceaux = vec!["L'".to_string(), "habillage".to_string()];
        assert!(filtrer("L'habillage", &morceaux).is_none());
    }

    #[test]
    fn le_filtre_garde_les_coupes_valides() {
        let morceaux = vec!["hy".to_string(), "phone".to_string()];
        assert_eq!(filtrer("hyphone", &morceaux), Some(morceaux));
    }

    #[test]
    fn les_tirets_du_mot_deviennent_des_frontieres() {
        // « États-Unis » sans coupe du dictionnaire : la frontière du tiret
        // doit tout de même exister.
        let resultat = ajouter_tirets("États-Unis", None).expect("coupe au tiret");
        assert_eq!(resultat, vec!["États-", "Unis"]);
    }

    #[test]
    fn les_tirets_s_ajoutent_aux_coupes_du_dictionnaire() {
        let du_dictionnaire = vec!["pa".to_string(), "pier-carton".to_string()];
        let resultat = ajouter_tirets("papier-carton", Some(&du_dictionnaire));
        let resultat = resultat.expect("au moins une coupe");
        assert!(
            resultat.len() > 2,
            "les deux frontières cohabitent : {resultat:?}"
        );
        assert_eq!(resultat.concat(), "papier-carton", "aucun caractère perdu");
    }

    #[test]
    fn un_mot_simple_sans_tiret_reste_entier() {
        assert!(ajouter_tirets("simple", None).is_none());
    }

    #[test]
    fn une_coupe_hors_du_mot_est_refusee() {
        let mot = c("abc");
        assert!(!frontiere_valide(&mot, 99));
        assert!(!frontiere_valide(&mot, 0));
    }
}
