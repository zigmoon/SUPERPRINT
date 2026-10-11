//! Retrouver une teinte : par son nom, ou par la **couleur la plus proche**.
//!
//! Deux besoins distincts, et deux réponses distinctes.
//!
//! 1. **Par le nom** — l'utilisateur tape « jaune pâle » ou « toyo 001 ». La
//!    comparaison doit être indifférente à la casse, aux accents et à la
//!    ponctuation, sinon « Pantone Yellow C » serait introuvable sans taper le
//!    tiret exact. [`chercher`] fait cela, et **classe** les résultats (nom
//!    exact, puis préfixe, puis début de mot, puis contenu) au lieu de rendre
//!    une liste dans l'ordre du fichier.
//!
//! 2. **Par la couleur** — l'utilisateur a un RVB et veut savoir de quelle encre
//!    il s'approche. La question est **perceptuelle** : la réponse est la plus
//!    petite distance en L\*a\*b\*, pas en RVB. [`plus_proche`] rend les deux
//!    écarts — ΔE00 pour décider, ΔE\*ab pour situer — et **le livre d'où vient
//!    la teinte**, parce qu'un imprimeur ne choisit pas la même encre selon
//!    qu'il travaille en Pantone ou en HKS.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « nuanciers »).

use superprint_core::lab::{delta_e2000, delta_e76, Lab};
use superprint_core::Rgb;

use crate::catalogue::{rgb_depuis_hex, Catalogue, Pastille};

/// Une teinte retrouvée, avec **d'où elle vient**.
#[derive(Clone, Copy, Debug)]
pub struct Trouvaille<'a> {
    /// La teinte.
    pub pastille: &'a Pastille,
    /// Identifiant du livre (« pantone », « hks »…).
    pub livre_id: &'a str,
    /// Nom du livre.
    pub livre_nom: &'a str,
    /// Libellé de la famille.
    pub famille: &'a str,
}

/// Une teinte la plus proche d'une couleur, avec ses écarts.
#[derive(Clone, Copy, Debug)]
pub struct Proximite<'a> {
    /// La teinte la plus proche.
    pub trouvaille: Trouvaille<'a>,
    /// Écart CIEDE2000 — celui qui décide.
    pub delta_e2000: f64,
    /// Écart CIELAB 1976 — celui qui situe.
    pub delta_e76: f64,
}

impl Proximite<'_> {
    /// Vrai si l'écart est sous un seuil. En dessous de 2, l'écart n'est pas
    /// visible à l'œil ; au-delà de 5, il l'est sans instrument.
    #[must_use]
    pub fn imperceptible(&self) -> bool {
        self.delta_e2000 < 2.0
    }
}

/// Met un nom sous une forme comparable : minuscules, sans accents, sans
/// ponctuation, espaces réduits.
///
/// C'est la seule façon qu'une recherche « RAL 5015 » trouve « RAL 5015 — Bleu
/// ciel », et que « pantone yellow » trouve « Pantone Yellow C ».
#[must_use]
pub fn normaliser(texte: &str) -> String {
    let mut sortie = String::with_capacity(texte.len());
    let mut espace = true; /* pour ne pas commencer par une espace */
    for c in texte.chars() {
        let remplace = match c {
            'à' | 'á' | 'â' | 'ã' | 'ä' | 'å' => "a",
            'À' | 'Á' | 'Â' | 'Ã' | 'Ä' | 'Å' => "a",
            'ç' | 'Ç' => "c",
            'è' | 'é' | 'ê' | 'ë' => "e",
            'È' | 'É' | 'Ê' | 'Ë' => "e",
            'ì' | 'í' | 'î' | 'ï' => "i",
            'Ì' | 'Í' | 'Î' | 'Ï' => "i",
            'ñ' | 'Ñ' => "n",
            'ò' | 'ó' | 'ô' | 'õ' | 'ö' => "o",
            'Ò' | 'Ó' | 'Ô' | 'Õ' | 'Ö' => "o",
            'ù' | 'ú' | 'û' | 'ü' => "u",
            'Ù' | 'Ú' | 'Û' | 'Ü' => "u",
            'ý' | 'ÿ' | 'Ý' => "y",
            'œ' | 'Œ' => "oe",
            'æ' | 'Æ' => "ae",
            'ß' => "ss",
            _ => "",
        };
        if !remplace.is_empty() {
            sortie.push_str(remplace);
            espace = false;
            continue;
        }
        if c.is_alphanumeric() {
            for bas in c.to_lowercase() {
                sortie.push(bas);
            }
            espace = false;
        } else if !espace {
            sortie.push(' ');
            espace = true;
        }
    }
    sortie.trim_end().to_string()
}

/// Où la correspondance a été trouvée — plus le rang est petit, meilleur c'est.
fn rang(nom_normalise: &str, requete: &str) -> Option<u8> {
    if nom_normalise == requete {
        return Some(0);
    }
    if nom_normalise.starts_with(requete) {
        return Some(1);
    }
    if nom_normalise.split(' ').any(|mot| mot == requete) {
        return Some(2);
    }
    if nom_normalise.contains(requete) {
        return Some(3);
    }
    None
}

/// Cherche les teintes dont le nom correspond à `requete`.
///
/// Si `requete` est un code `#RRGGBB`, la recherche porte sur la **couleur**
/// exacte. Sinon elle porte sur le nom, classée du meilleur au moins bon
/// (nom exact, préfixe, début de mot, contenu), puis dans l'ordre du catalogue,
/// qui est celui du produit.
///
/// `limite` borne le nombre de résultats ; `0` veut dire **tous**.
#[must_use]
pub fn chercher<'a>(catalogue: &'a Catalogue, requete: &str, limite: usize) -> Vec<Trouvaille<'a>> {
    let requete = requete.trim();
    if requete.is_empty() {
        return Vec::new();
    }

    /* Un code couleur : recherche exacte, on ne devine pas. */
    if let Some(rgb) = rgb_depuis_hex(requete) {
        let hex = crate::catalogue::hex_depuis_rgb(rgb);
        let mut trouvailles: Vec<Trouvaille<'a>> = Vec::new();
        for livre in &catalogue.livres {
            for famille in &livre.familles {
                for pastille in &famille.teintes {
                    if pastille.hex() == hex {
                        trouvailles.push(Trouvaille {
                            pastille,
                            livre_id: &livre.id,
                            livre_nom: &livre.nom,
                            famille: &famille.label,
                        });
                    }
                }
            }
        }
        return borner(trouvailles, limite);
    }

    let requete = normaliser(requete);
    if requete.is_empty() {
        return Vec::new();
    }

    let mut classees: Vec<(u8, usize, Trouvaille<'a>)> = Vec::new();
    let mut ordre = 0usize;
    for livre in &catalogue.livres {
        for famille in &livre.familles {
            for pastille in &famille.teintes {
                ordre += 1;
                if let Some(r) = rang(&normaliser(&pastille.nom), &requete) {
                    classees.push((
                        r,
                        ordre,
                        Trouvaille {
                            pastille,
                            livre_id: &livre.id,
                            livre_nom: &livre.nom,
                            famille: &famille.label,
                        },
                    ));
                }
            }
        }
    }
    classees.sort_by(|a, b| a.0.cmp(&b.0).then(a.1.cmp(&b.1)));
    borner(classees.into_iter().map(|(_, _, t)| t).collect(), limite)
}

fn borner<T>(mut liste: Vec<T>, limite: usize) -> Vec<T> {
    if limite > 0 && liste.len() > limite {
        liste.truncate(limite);
    }
    liste
}

/// La teinte la plus proche **dans tout le catalogue**.
///
/// Les comparaisons se font en **L\*a\*b\* D50** (le blanc de l'impression), et
/// la décision est prise sur ΔE00. À égalité parfaite, la première teinte
/// rencontrée dans l'ordre du catalogue l'emporte — le résultat ne dépend donc
/// pas de l'ordre de parcours d'une table de hachage, ce qui rendrait le
/// contrôle impossible.
#[must_use]
pub fn plus_proche(catalogue: &Catalogue, rgb: Rgb) -> Option<Proximite<'_>> {
    let cible = Lab::from(rgb);
    let mut meilleure: Option<Proximite<'_>> = None;

    for livre in &catalogue.livres {
        for famille in &livre.familles {
            for pastille in &famille.teintes {
                let lab = Lab::from(pastille.rgb);
                let d00 = delta_e2000(cible, lab);
                if meilleure.map_or(true, |m| d00 < m.delta_e2000) {
                    meilleure = Some(Proximite {
                        trouvaille: Trouvaille {
                            pastille,
                            livre_id: &livre.id,
                            livre_nom: &livre.nom,
                            famille: &famille.label,
                        },
                        delta_e2000: d00,
                        delta_e76: delta_e76(cible, lab),
                    });
                }
            }
        }
    }
    meilleure
}

/// La teinte la plus proche **d'un seul livre**.
#[must_use]
pub fn plus_proche_dans<'a>(
    catalogue: &'a Catalogue,
    livre_id: &str,
    rgb: Rgb,
) -> Option<Proximite<'a>> {
    let livre = catalogue.livre(livre_id)?;
    let cible = Lab::from(rgb);
    let mut meilleure: Option<Proximite<'a>> = None;
    for famille in &livre.familles {
        for pastille in &famille.teintes {
            let lab = Lab::from(pastille.rgb);
            let d00 = delta_e2000(cible, lab);
            if meilleure.map_or(true, |m| d00 < m.delta_e2000) {
                meilleure = Some(Proximite {
                    trouvaille: Trouvaille {
                        pastille,
                        livre_id: &livre.id,
                        livre_nom: &livre.nom,
                        famille: &famille.label,
                    },
                    delta_e2000: d00,
                    delta_e76: delta_e76(cible, lab),
                });
            }
        }
    }
    meilleure
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::catalogue::catalogue;

    #[test]
    fn normaliser_retire_accents_casse_et_ponctuation() {
        assert_eq!(normaliser("Toyo 001 — Jaune pâle"), "toyo 001 jaune pale");
        assert_eq!(normaliser("Jaunes & oranges"), "jaunes oranges");
        assert_eq!(normaliser("  RAL  5015  "), "ral 5015");
        assert_eq!(normaliser("NCS S 1050-Y90R"), "ncs s 1050 y90r");
        assert_eq!(normaliser("Pantone Yellow C"), "pantone yellow c");
        assert_eq!(normaliser(""), "");
        assert_eq!(normaliser("—"), "");
        assert_eq!(normaliser("ÉÈÊË"), "eeee");
        assert_eq!(normaliser("œuf"), "oeuf");
    }

    #[test]
    fn trouver_par_le_nom_exact() {
        let c = catalogue();
        let r = chercher(c, "Toyo 001 — Jaune pâle", 5);
        assert!(!r.is_empty());
        assert_eq!(r[0].pastille.nom, "Toyo 001 — Jaune pâle");
        assert_eq!(r[0].livre_id, "toyo");
    }

    #[test]
    fn la_recherche_ignore_la_casse_et_les_accents() {
        let c = catalogue();
        for requete in ["TOYO 001", "toyo 001", "Jaune pale", "jaune pâle", "PALE"] {
            let r = chercher(c, requete, 5);
            assert!(!r.is_empty(), "{requete:?} ne trouve rien");
        }
    }

    #[test]
    fn le_nom_exact_passe_avant_le_contenu() {
        let c = catalogue();
        let r = chercher(c, "Pantone Yellow C", 10);
        assert_eq!(r[0].pastille.nom, "Pantone Yellow C");
        assert_eq!(r[0].livre_id, "pantone");
        assert_eq!(r[0].famille, "Pantone Basics (Coated)");
    }

    #[test]
    fn le_classement_est_par_rang_puis_par_ordre_du_catalogue() {
        let c = catalogue();
        let r = chercher(c, "bleu", 0);
        assert!(r.len() > 3);
        /* Tous les résultats contiennent « bleu » ; les noms exactement égaux
        n'existent pas ici, donc le meilleur rang possible est le préfixe. */
        for t in &r {
            assert!(normaliser(&t.pastille.nom).contains("bleu"));
        }
        let prefixe = normaliser(&r[0].pastille.nom).starts_with("bleu");
        let debut_mot = normaliser(&r[0].pastille.nom)
            .split(' ')
            .any(|m| m == "bleu");
        assert!(prefixe || debut_mot || normaliser(&r[0].pastille.nom) == "bleu");
    }

    #[test]
    fn un_code_couleur_cherche_la_couleur_pas_le_nom() {
        let c = catalogue();
        let r = chercher(c, "#FCEE21", 0);
        assert!(!r.is_empty());
        for t in &r {
            assert_eq!(t.pastille.hex(), "#FCEE21");
        }
        assert!(r.iter().any(|t| t.pastille.nom == "Pantone Yellow C"));
    }

    #[test]
    fn la_limite_est_respectee() {
        let c = catalogue();
        assert_eq!(chercher(c, "bleu", 3).len(), 3);
        assert!(chercher(c, "bleu", 0).len() > 3);
    }

    #[test]
    fn une_requete_vide_ne_trouve_rien() {
        let c = catalogue();
        assert!(chercher(c, "", 0).is_empty());
        assert!(chercher(c, "   ", 0).is_empty());
        assert!(chercher(c, "—", 0).is_empty());
    }

    #[test]
    fn une_requete_absente_ne_trouve_rien() {
        let c = catalogue();
        assert!(chercher(c, "zzzz-inexistant", 0).is_empty());
    }

    #[test]
    fn la_recherche_est_deterministe() {
        let c = catalogue();
        let a: Vec<String> = chercher(c, "ral 5015", 0)
            .iter()
            .map(|t| t.pastille.hex())
            .collect();
        let b: Vec<String> = chercher(c, "ral 5015", 0)
            .iter()
            .map(|t| t.pastille.hex())
            .collect();
        assert_eq!(a, b);
    }

    #[test]
    fn la_proximite_d_une_couleur_du_catalogue_est_elle_meme() {
        let c = catalogue();
        for (livre, nom) in [("toyo", "Toyo 001 — Jaune pâle"), ("dic", "DIC 001")] {
            let Some(pastille) = c
                .livre(livre)
                .and_then(|l| l.teintes().find(|p| p.nom == nom))
            else {
                continue;
            };
            let p = plus_proche(c, pastille.rgb).unwrap();
            assert_eq!(
                p.delta_e2000, 0.0,
                "une teinte du catalogue doit être sa propre plus proche"
            );
            assert_eq!(p.trouvaille.pastille.hex(), pastille.hex());
        }
    }

    #[test]
    fn la_proximite_choisit_la_vraie_encre_et_pas_le_voisin_rgb() {
        /* Un bleu ciel franc doit tomber sur un bleu, pas sur un gris clair
        « proche » en RVB : c'est toute la différence entre mesurer et voir. */
        let c = catalogue();
        let p = plus_proche(c, Rgb::new(0, 160, 220)).unwrap();
        let lab = Lab::from(p.trouvaille.pastille.rgb);
        assert!(
            lab.b < 0.0,
            "la teinte la plus proche d'un bleu clair devrait être bleue : {} ({:.1}, {:.1})",
            p.trouvaille.pastille.nom,
            lab.a,
            lab.b
        );
        assert!(p.delta_e2000 < 30.0);
    }

    #[test]
    fn la_proximite_peut_se_limiter_a_un_livre() {
        let c = catalogue();
        let p = plus_proche_dans(c, "hks", Rgb::new(200, 30, 40)).unwrap();
        assert_eq!(p.trouvaille.livre_id, "hks");
        assert!(plus_proche_dans(c, "inexistant", Rgb::new(0, 0, 0)).is_none());
    }

    #[test]
    fn les_deux_ecarts_sont_rendus_et_coherents() {
        let c = catalogue();
        let p = plus_proche(c, Rgb::new(120, 40, 200)).unwrap();
        assert!(p.delta_e2000 >= 0.0 && p.delta_e76 >= 0.0);
        assert_eq!(p.imperceptible(), p.delta_e2000 < 2.0);
    }

    #[test]
    fn la_plus_proche_est_bien_la_plus_proche() {
        /* Contrôle exhaustif : aucune teinte du catalogue ne doit être plus
        proche que celle qui a été rendue. */
        let c = catalogue();
        for cible in [
            Rgb::new(0, 0, 0),
            Rgb::new(255, 255, 255),
            Rgb::new(200, 30, 40),
            Rgb::new(0, 160, 220),
            Rgb::new(180, 190, 100),
        ] {
            let p = plus_proche(c, cible).unwrap();
            let lab = Lab::from(cible);
            for pastille in c.teintes() {
                let d = delta_e2000(lab, Lab::from(pastille.rgb));
                assert!(
                    d >= p.delta_e2000 - 1e-12,
                    "{:?} est à {d} alors que {} est à {}",
                    pastille.nom,
                    p.trouvaille.pastille.nom,
                    p.delta_e2000
                );
            }
        }
    }
}
