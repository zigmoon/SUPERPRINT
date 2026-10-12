//! Lecture de la **spécification** d'un plan, sous forme de texte.
//!
//! Un seul lecteur, donc un seul jeu de règles : la frontière C, l'exemple de
//! contrôle et les tests lisent tous ce format avec ce code. Recopier ce
//! lecteur quelque part serait la garantie d'une dérive silencieuse entre ce qui
//! est mesuré et ce qui est livré.
//!
//! ```text
//! !page<TAB>210<TAB>297             largeur, hauteur du format fini (mm)   — OBLIGATOIRE
//! !fond<TAB>3<TAB>1                 fond perdu (mm), imprimé (0 ou 1)
//! !decoupe<TAB>0                    découpe page à page (0 ou 1)
//! !reperes<TAB>1<TAB>10<TAB>5<TAB>2.5<TAB>0.25
//!                                   actifs, marge, longueur, décalage, épaisseur
//! !places<TAB>1<TAB>20              page de gauche, page de droite (0 = vide)
//! !pages<TAB>20                     nombre de pages du document (pour l'ordre)
//! ```
//!
//! Les lignes absentes gardent leur valeur par défaut, **sauf `!page`** : des
//! dimensions de page devinées produiraient une planche fausse, donc du papier
//! perdu. Mieux vaut un refus explicite.

use super::{Emplacement, Reglages};

/// Tout ce qu'une spécification porte : les réglages, les deux places, et le
/// nombre de pages du document.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Specification {
    /// Les réglages de la planche.
    pub reglages: Reglages,
    /// La page de la place de gauche.
    pub gauche: Emplacement,
    /// La page de la place de droite.
    pub droite: Emplacement,
    /// Nombre de pages du document, si la spécification le donne. Sert à
    /// calculer l'ordre d'impression.
    pub pages: Option<u32>,
}

impl Specification {
    /// Lit une spécification. Renvoie `None` si elle est inutilisable — ligne
    /// `!page` absente, dimension nulle ou négative, valeur non numérique.
    #[must_use]
    pub fn lire(texte: &str) -> Option<Self> {
        let mut reglages = Reglages::default();
        let mut gauche = Emplacement::Vide;
        let mut droite = Emplacement::Vide;
        let mut pages = None;
        let mut page_donnee = false;

        for ligne in texte.lines() {
            let ligne = ligne.trim_end();
            if ligne.is_empty() {
                continue;
            }
            let champs: Vec<&str> = ligne.split('\t').collect();
            let Some(nom) = champs.first().copied() else {
                continue;
            };
            let nombre = |index: usize| -> Option<f64> {
                champs.get(index).and_then(|v| v.trim().parse::<f64>().ok())
            };
            let entier = |index: usize| -> Option<u32> {
                champs.get(index).and_then(|v| v.trim().parse::<u32>().ok())
            };
            let actif = |index: usize| -> bool {
                champs
                    .get(index)
                    .is_some_and(|v| v.trim() == "1" || v.trim().eq_ignore_ascii_case("true"))
            };

            match nom {
                "!page" => {
                    reglages.largeur_page_mm = nombre(1)?;
                    reglages.hauteur_page_mm = nombre(2)?;
                    if reglages.largeur_page_mm <= 0.0 || reglages.hauteur_page_mm <= 0.0 {
                        return None;
                    }
                    page_donnee = true;
                }
                "!fond" => {
                    reglages.fond_perdu_mm = nombre(1)?;
                    if reglages.fond_perdu_mm < 0.0 {
                        return None;
                    }
                    reglages.inclure_fond_perdu = actif(2);
                }
                "!decoupe" => reglages.decoupe_page_a_page = actif(1),
                "!reperes" => {
                    reglages.reperes_de_coupe = actif(1);
                    // Les valeurs optionnelles sont prises si elles sont
                    // présentes et valides ; une valeur illisible est ignorée,
                    // car le défaut est un choix sensé du produit.
                    if let Some(valeur) = nombre(2).filter(|v| *v >= 0.0) {
                        reglages.marge_reperes_mm = valeur;
                    }
                    if let Some(valeur) = nombre(3).filter(|v| *v >= 0.0) {
                        reglages.longueur_repere_mm = valeur;
                    }
                    if let Some(valeur) = nombre(4).filter(|v| *v >= 0.0) {
                        reglages.decalage_repere_mm = valeur;
                    }
                    if let Some(valeur) = nombre(5).filter(|v| *v > 0.0) {
                        reglages.epaisseur_repere_mm = valeur;
                    }
                }
                "!places" => {
                    gauche = lire_place(champs.get(1).copied());
                    droite = lire_place(champs.get(2).copied());
                }
                "!pages" => pages = entier(1),
                _ => continue,
            }
        }

        if !page_donnee {
            return None;
        }
        Some(Self {
            reglages,
            gauche,
            droite,
            pages,
        })
    }
}

/// Un numéro de page, ou une place vide. Zéro et l'absence valent « vide ».
///
/// ⚠️ **Publique**, et volontairement : la frontière C doit lire les mêmes
/// formes (`Vide`, vide, `0`, un entier) que la ligne `!places`. En recopier la
/// règle ferait deux lecteurs pour un seul format, et la dérive viendrait du
/// second.
#[must_use]
pub fn lire_place(champ: Option<&str>) -> Emplacement {
    match champ.and_then(|v| v.trim().parse::<u32>().ok()) {
        Some(numero) if numero > 0 => Emplacement::Page(numero),
        _ => Emplacement::Vide,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn une_specification_complete_est_lue() {
        let spec = Specification::lire(
            "!page\t210\t297\n!fond\t3\t1\n!decoupe\t1\n!reperes\t1\t10\t5\t2.5\t0.25\n!places\t1\t20\n!pages\t20",
        )
        .expect("specification valide");
        assert_eq!(spec.reglages.largeur_page_mm, 210.0);
        assert_eq!(spec.reglages.hauteur_page_mm, 297.0);
        assert_eq!(spec.reglages.fond_perdu_mm, 3.0);
        assert!(spec.reglages.inclure_fond_perdu);
        assert!(spec.reglages.decoupe_page_a_page);
        assert!(spec.reglages.reperes_de_coupe);
        assert_eq!(spec.reglages.marge_reperes_mm, 10.0);
        assert_eq!(spec.reglages.longueur_repere_mm, 5.0);
        assert_eq!(spec.reglages.decalage_repere_mm, 2.5);
        assert_eq!(spec.reglages.epaisseur_repere_mm, 0.25);
        assert_eq!(spec.gauche, Emplacement::Page(1));
        assert_eq!(spec.droite, Emplacement::Page(20));
        assert_eq!(spec.pages, Some(20));
    }

    /// Sans `!page`, on refuse : des dimensions de page devinées produiraient
    /// une planche fausse, donc du papier perdu.
    #[test]
    fn sans_page_on_refuse() {
        for texte in [
            "",
            "!fond\t3\t1",
            "!reperes\t1\t10\t5\t2.5\t0.25",
            "!places\t1\t2",
            "!pages\t20",
        ] {
            assert!(
                Specification::lire(texte).is_none(),
                "« {texte} » doit etre refuse"
            );
        }
    }

    /// Une page de dimensions nulles ou négatives est refusée : elle produirait
    /// une planche de largeur nulle.
    #[test]
    fn une_page_de_taille_absurde_est_refusee() {
        fn refuse(texte: &str) {
            assert!(Specification::lire(texte).is_none(), "« {texte} »");
        }
        refuse("!page\t0\t297");
        refuse("!page\t210\t0");
        refuse("!page\t-210\t297");
        refuse("!page\t210");
        refuse("!page\tlarge\t297");
    }

    /// Les lignes absentes gardent les valeurs du produit : c'est ce qui rend
    /// une spécification minimale utilisable.
    #[test]
    fn les_absences_gardent_les_valeurs_du_produit() {
        let spec = Specification::lire("!page\t210\t297").unwrap();
        let defaut = Reglages::default();
        assert_eq!(spec.reglages, defaut);
        assert_eq!(spec.gauche, Emplacement::Vide);
        assert_eq!(spec.droite, Emplacement::Vide);
        assert_eq!(spec.pages, None);
    }

    /// Les blancs et les lignes vides ne changent rien, et une ligne inconnue
    /// est ignorée plutôt que de faire échouer toute la lecture.
    #[test]
    fn les_lignes_inconnues_sont_ignorees() {
        let spec = Specification::lire("\n!page\t210\t297\n!quelque-chose\t1\n\n").unwrap();
        assert_eq!(spec.reglages.largeur_page_mm, 210.0);
    }

    /// Un fond perdu négatif est refusé — il produirait une feuille plus petite
    /// que les pages.
    #[test]
    fn un_fond_perdu_negatif_est_refuse() {
        assert!(Specification::lire("!page\t210\t297\n!fond\t-3\t1").is_none());
    }

    /// `!places` accepte `Vide` sous toutes ses formes : zéro, une case vide,
    /// ou la ligne absente.
    #[test]
    fn une_place_vide_s_ecrit_de_plusieurs_facons() {
        let spec = Specification::lire("!page\t210\t297\n!places\t4\t0").unwrap();
        assert_eq!(spec.gauche, Emplacement::Page(4));
        assert_eq!(spec.droite, Emplacement::Vide);

        let spec = Specification::lire("!page\t210\t297\n!places\t4\t").unwrap();
        assert_eq!(spec.droite, Emplacement::Vide);

        let spec = Specification::lire("!page\t210\t297\n!places\tVide\tVide").unwrap();
        assert_eq!(spec.gauche, Emplacement::Vide);
    }
}
