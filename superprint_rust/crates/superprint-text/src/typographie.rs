//! Espaces insécables et ponctuation française.
//!
//! ## Statut honnête de ce module
//!
//! Contrairement à [`crate::francais`], ce n'est **pas** un portage : le
//! JavaScript de SuperPrint n'a pas de fonction d'application des espaces
//! françaises (il pose une insécable à la demande, `spInsertSpecialChar`). Ces
//! règles sont celles du **Code typographique**, et elles sont ajoutées ici
//! parce qu'un compositeur en a besoin : un logiciel de PAO qui laisse
//! « 12 000 » se couper en fin de ligne produit un fichier fautif.
//!
//! ## Les trois espaces qui comptent
//!
//! | Nom | Caractère | Usage français |
//! |---|---|---|
//! | insécable | `U+00A0` | avant `%`, après un numéro, dans `12 000` |
//! | fine insécable | `U+202F` | avant `: ; ! ?` et à l'intérieur des guillemets `« »` |
//! | fine | `U+2009` | réservée, non utilisée ici |
//!
//! ⚠️ La règle « espace **fine** insécable avant `;` » est celle du Code
//! typographique ; la tradition de l'Imprimerie nationale admet aussi une espace
//! **mot** insécable. `U+202F` est le choix retenu, et il est réglable : voir
//! [`ReglesEspaces`].

/// Quelle espace poser devant la ponctuation double.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EspacePonctuation {
    /// `U+202F` — espace fine insécable. Le choix du Code typographique.
    Fine,
    /// `U+00A0` — espace insécable ordinaire. Le choix de l'Imprimerie nationale.
    Mot,
}

/// Les règles appliquées, pour qu'un appelant puisse les choisir.
#[derive(Clone, Copy, Debug)]
pub struct ReglesEspaces {
    /// Espace devant `: ; ! ?` et à l'intérieur des guillemets français.
    pub ponctuation: EspacePonctuation,
    /// Poser une insécable avant `%`.
    pub avant_pourcent: bool,
}

impl Default for ReglesEspaces {
    fn default() -> Self {
        Self {
            ponctuation: EspacePonctuation::Fine,
            avant_pourcent: true,
        }
    }
}

/// La fine insécable.
pub const FINE_INSECABLE: char = '\u{202F}';
/// L'insécable ordinaire.
pub const INSECABLE: char = '\u{00A0}';

/// La ponctuation française qui prend une espace **devant**.
const PONCTUATION_DOUBLE: [char; 5] = [':', ';', '!', '?', '\u{00BB}'];

fn espace_choisie(regles: &ReglesEspaces) -> char {
    match regles.ponctuation {
        EspacePonctuation::Fine => FINE_INSECABLE,
        EspacePonctuation::Mot => INSECABLE,
    }
}

/// Applique les règles françaises d'espacement à un texte.
///
/// Trois choses, et rien de plus :
/// 1. l'espace **ordinaire** devant `: ; ! ? »` devient l'espace insécable choisie ;
/// 2. l'espace ordinaire après `«` devient la même espace insécable ;
/// 3. l'espace ordinaire devant `%` devient une insécable ordinaire.
///
/// Ce qui n'est **pas** touché : une espace insécable déjà posée (l'utilisateur
/// a pu choisir la sienne), et une ponctuation qui n'est précédée d'aucune
/// espace — on n'en invente jamais.
#[must_use]
pub fn espaces_francaises(texte: &str, regles: &ReglesEspaces) -> String {
    let fine = espace_choisie(regles);
    let caracteres: Vec<char> = texte.chars().collect();
    let mut sortie = String::with_capacity(texte.len() + 8);
    // Une espace déjà consommée par la règle du guillemet ouvrant.
    let mut sauter = false;

    for (index, c) in caracteres.iter().enumerate() {
        let suivant = caracteres.get(index + 1).copied();
        let precedent = if index == 0 {
            None
        } else {
            Some(caracteres[index - 1])
        };
        let deja_insecable = matches!(precedent, Some(FINE_INSECABLE | INSECABLE));

        if sauter && *c == ' ' {
            sauter = false;
            continue;
        }
        sauter = false;

        // ① Espace devant la ponctuation double : on la remplace.
        if *c == ' ' && !deja_insecable {
            if matches!(suivant, Some(p) if PONCTUATION_DOUBLE.contains(&p)) {
                sortie.push(fine);
                continue;
            }
            if regles.avant_pourcent && suivant == Some('%') {
                sortie.push(INSECABLE);
                continue;
            }
        }

        // ② Guillemet ouvrant : l'espace insécable suit.
        if *c == '\u{00AB}' {
            sortie.push(*c);
            if suivant == Some(' ') {
                sortie.push(fine);
                sauter = true;
            } else if !matches!(suivant, Some(FINE_INSECABLE | INSECABLE)) {
                sortie.push(fine);
            }
            continue;
        }

        sortie.push(*c);
    }
    sortie
}

/// Groupe les milliers d'un nombre avec une fine insécable : `12000` → `12 000`.
///
/// Seuls les nombres **entiers de 5 chiffres et plus** sont groupés, et les
/// chiffres après une virgule ou un point **ne le sont pas** — « 3,14159 » reste
/// tel quel. C'est la règle d'usage : on ne coupe pas une partie décimale.
#[must_use]
pub fn grouper_milliers(nombre: &str) -> String {
    let Some(position) = nombre.find(['.', ',']) else {
        return grouper_chiffres(nombre);
    };
    let (entier, decimal) = nombre.split_at(position);
    format!("{}{decimal}", grouper_chiffres(entier))
}

fn grouper_chiffres(entier: &str) -> String {
    let (signe, chiffres) = match entier.strip_prefix('-') {
        Some(reste) => ("-", reste),
        None => ("", entier),
    };
    if chiffres.len() <= 4 || !chiffres.chars().all(|c| c.is_ascii_digit()) {
        return entier.to_string();
    }
    let mut sortie = String::with_capacity(chiffres.len() + chiffres.len() / 3);
    for (index, c) in chiffres.chars().enumerate() {
        if index > 0 && (chiffres.len() - index) % 3 == 0 {
            sortie.push(FINE_INSECABLE);
        }
        sortie.push(c);
    }
    format!("{signe}{sortie}")
}

/// Lie un nombre à son unité par une insécable : `30 mm` ne se coupe pas.
///
/// Les unités sont fournies par l'appelant (`mm`, `pt`, `px`, `%`, `€`…) : ce
/// module n'a pas à décider de la liste, et l'application en a de plus longue.
#[must_use]
pub fn lier_nombre_et_unite(texte: &str, unites: &[&str]) -> String {
    let mut sortie = String::with_capacity(texte.len());
    let mots: Vec<&str> = texte.split(' ').collect();
    for (index, mot) in mots.iter().enumerate() {
        let precedent_est_nombre = index > 0
            && !mots[index - 1].is_empty()
            && mots[index - 1]
                .chars()
                .all(|c| c.is_ascii_digit() || c == ',');
        if precedent_est_nombre && unites.contains(mot) {
            sortie.push(INSECABLE);
        } else if index > 0 {
            sortie.push(' ');
        }
        sortie.push_str(mot);
    }
    sortie
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deux_points_recoivent_une_fine_insecable() {
        let regles = ReglesEspaces::default();
        assert_eq!(
            espaces_francaises("Attention : ceci", &regles),
            "Attention\u{202F}: ceci"
        );
        assert_eq!(espaces_francaises("Oui ; non", &regles), "Oui\u{202F}; non");
        assert_eq!(
            espaces_francaises("Vraiment ?", &regles),
            "Vraiment\u{202F}?"
        );
        assert_eq!(espaces_francaises("Bravo !", &regles), "Bravo\u{202F}!");
    }

    #[test]
    fn les_guillemets_francais_sont_espaces() {
        let regles = ReglesEspaces::default();
        assert_eq!(
            espaces_francaises("il dit \u{00AB} bonjour \u{00BB}", &regles),
            "il dit \u{00AB}\u{202F}bonjour\u{202F}\u{00BB}"
        );
        // Sans espace du tout : l'insécable est posée tout de même.
        assert_eq!(
            espaces_francaises("il dit \u{00AB}bonjour\u{00BB}", &regles),
            "il dit \u{00AB}\u{202F}bonjour\u{00BB}"
        );
    }

    #[test]
    fn l_espace_mot_est_un_autre_choix() {
        let regles = ReglesEspaces {
            ponctuation: EspacePonctuation::Mot,
            ..ReglesEspaces::default()
        };
        assert_eq!(
            espaces_francaises("Attention :", &regles),
            "Attention\u{00A0}:"
        );
    }

    #[test]
    fn une_insecable_deja_posee_est_respectee() {
        let regles = ReglesEspaces::default();
        let deja = "Attention\u{00A0}:";
        assert_eq!(espaces_francaises(deja, &regles), deja);
        let fine = "Attention\u{202F}:";
        assert_eq!(espaces_francaises(fine, &regles), fine);
    }

    #[test]
    fn aucune_espace_n_est_inventee() {
        let regles = ReglesEspaces::default();
        // « a:b » n'a pas d'espace : on n'en ajoute pas.
        assert_eq!(espaces_francaises("a:b", &regles), "a:b");
        assert_eq!(espaces_francaises("(suite)", &regles), "(suite)");
        assert_eq!(espaces_francaises("", &regles), "");
    }

    #[test]
    fn le_pourcent_recoit_une_insecable() {
        let regles = ReglesEspaces::default();
        assert_eq!(espaces_francaises("30 %", &regles), "30\u{00A0}%");
        assert_eq!(espaces_francaises("30%", &regles), "30%");
        let sans = ReglesEspaces {
            avant_pourcent: false,
            ..ReglesEspaces::default()
        };
        assert_eq!(espaces_francaises("30 %", &sans), "30 %");
    }

    #[test]
    fn le_texte_ordinaire_n_est_pas_abime() {
        let regles = ReglesEspaces::default();
        let texte = "Le chat dort tranquillement sur le canapé du salon.";
        assert_eq!(espaces_francaises(texte, &regles), texte);
    }

    #[test]
    fn les_milliers_sont_groupes() {
        assert_eq!(
            grouper_milliers("1000"),
            "1000",
            "quatre chiffres : tel quel"
        );
        assert_eq!(grouper_milliers("12000"), "12\u{202F}000");
        assert_eq!(grouper_milliers("1234567"), "1\u{202F}234\u{202F}567");
        assert_eq!(grouper_milliers("-12000"), "-12\u{202F}000");
    }

    #[test]
    fn une_partie_decimale_n_est_jamais_coupee() {
        assert_eq!(grouper_milliers("3,14159"), "3,14159");
        assert_eq!(grouper_milliers("12000,5"), "12\u{202F}000,5");
        assert_eq!(grouper_milliers("12000.75"), "12\u{202F}000.75");
    }

    #[test]
    fn un_texte_qui_n_est_pas_un_nombre_reste_intact() {
        assert_eq!(grouper_milliers("abcde"), "abcde");
        assert_eq!(grouper_milliers("12a45"), "12a45");
        assert_eq!(grouper_milliers(""), "");
    }

    #[test]
    fn un_nombre_reste_lie_a_son_unite() {
        let unites = ["mm", "pt", "px"];
        assert_eq!(
            lier_nombre_et_unite("30 mm de marge", &unites),
            "30\u{00A0}mm de marge"
        );
        assert_eq!(lier_nombre_et_unite("30 pommes", &unites), "30 pommes");
        assert_eq!(lier_nombre_et_unite("mm de marge", &unites), "mm de marge");
        assert_eq!(lier_nombre_et_unite("12,5 pt", &unites), "12,5\u{00A0}pt");
        assert_eq!(lier_nombre_et_unite("", &unites), "");
    }
}
