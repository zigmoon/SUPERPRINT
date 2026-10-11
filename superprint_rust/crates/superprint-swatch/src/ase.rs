//! Lecture des fichiers **Adobe Swatch Exchange** (`.ase`).
//!
//! Format public, et volontairement simple : un en-tête « ASEF », un compte de
//! blocs, puis des blocs `type · longueur · données`. Trois types comptent :
//! `0x0001` une couleur, `0xC001` un début de groupe, `0xC002` une fin de
//! groupe. Un type inconnu est **sauté** grâce à la longueur déclarée, ce qui
//! fait qu'un fichier écrit par une version plus récente se lit quand même
//! partiellement au lieu de faire dérailler la suite.
//!
//! ## Ce que fait ce lecteur, et ce qu'il ne fait pas
//!
//! Il lit les quatre modèles du format — `RGB `, `CMYK`, `LAB `, `Gray` — et
//! rend une couleur **RVB d'aperçu**. Un `.ase` porte les valeurs dans le modèle
//! d'origine, et convertir vers le RVB d'écran demande une décision :
//!
//! - `RGB ` : directement, à l'octet près ;
//! - `CMYK` : conversion **naïve** `(1 − c)(1 − k)`, la même que partout ailleurs
//!   dans le produit pour l'aperçu d'un ton direct — un vrai rendu demanderait
//!   le profil du fabricant ;
//! - `LAB ` : L\*a\*b\* (D50) → sRGB, par la matrice adaptée publiée ;
//! - `Gray` : le niveau, répliqué sur les trois canaux.
//!
//! Ces deux dernières conversions sont des **approximations d'aperçu**. Elles
//! sont ici portées **à l'identique** du produit (`swatchbooks.js`) : le but
//! n'est pas de faire mieux, c'est que le noyau et l'application donnent la
//! même pastille pour le même fichier. `scripts/validate-swatch.mjs` le mesure.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « nuanciers »).

use superprint_core::color::Rgb;

use crate::catalogue::hex_depuis_rgb;

/// Pourquoi un fichier `.ase` n'a pas pu être lu.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum AseErreur {
    /// Le fichier fait moins de 12 octets : même l'en-tête n'y tient pas.
    TropCourt {
        /// Taille reçue, en octets.
        taille: usize,
    },
    /// Les quatre premiers octets ne sont pas « ASEF ».
    SignatureAbsente,
}

impl std::fmt::Display for AseErreur {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TropCourt { taille } => {
                write!(f, "fichier .ase de {taille} octets : en-tête incomplet")
            }
            Self::SignatureAbsente => write!(f, "signature « ASEF » absente"),
        }
    }
}

impl std::error::Error for AseErreur {}

/// Le résultat d'une lecture : les teintes, et les familles si le fichier en
/// déclare.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Releve {
    /// Les teintes, dans l'ordre du fichier.
    pub teintes: Vec<Pastille>,
    /// Les familles déclarées par des blocs de groupe, dans l'ordre.
    ///
    /// Un `.ase` exporté depuis une bibliothèque en contient ; un `.ase` plat
    /// n'en contient aucune, et [`Releve::teintes`] suffit alors.
    pub familles: Vec<Famille>,
}

use crate::catalogue::{Famille, Pastille};

/// Lit un fichier `.ase`.
///
/// Les blocs de couleur illisibles sont **sautés** (un nom tronqué, un modèle
/// inconnu), comme le fait le produit : un fichier tiers à moitié valide doit
/// rendre ce qu'il peut. En revanche un en-tête absent est une **erreur** —
/// il n'y a alors rien à lire, et le dire vaut mieux que rendre une liste vide
/// que l'utilisateur prendrait pour un fichier sans couleur.
///
/// # Erreurs
///
/// [`AseErreur::TropCourt`] ou [`AseErreur::SignatureAbsente`].
pub fn lire(octets: &[u8]) -> Result<Releve, AseErreur> {
    if octets.len() < 12 {
        return Err(AseErreur::TropCourt {
            taille: octets.len(),
        });
    }
    if &octets[0..4] != b"ASEF" {
        return Err(AseErreur::SignatureAbsente);
    }

    let nombre = u32_be(octets, 8).unwrap_or(0);
    let mut teintes = Vec::new();
    let mut familles: Vec<Famille> = Vec::new();
    let mut position = 12usize;
    let mut index = 0u32;

    while index < nombre {
        if position >= octets.len() {
            break;
        }
        let Some(type_bloc) = u16_be(octets, position) else {
            break;
        };
        let Some(longueur) = u32_be(octets, position + 2) else {
            break;
        };
        let debut = position + 6;
        /* wasm32 est en 32 bits : une longueur déclarée absurde déborderait.
        On la traite comme « jusqu'à la fin » plutôt que de paniquer. */
        let fin = debut.saturating_add(longueur as usize);

        match type_bloc {
            0x0001 => {
                if let Some(pastille) = lire_couleur(octets, debut) {
                    if let Some(f) = familles.last_mut() {
                        f.teintes.push(pastille.clone());
                    }
                    teintes.push(pastille);
                }
            }
            0xC001 => {
                if let Some(label) = lire_nom(octets, debut) {
                    familles.push(Famille {
                        label: if label.is_empty() {
                            format!("Groupe {}", familles.len() + 1)
                        } else {
                            label
                        },
                        teintes: Vec::new(),
                    });
                }
            }
            0xC002 => { /* fin de groupe : rien à faire, le groupe est déjà là */ }
            _ => { /* type inconnu : sauté par la longueur déclarée */ }
        }

        if fin <= position {
            break; /* garde-fou : jamais deux fois la même position */
        }
        position = fin;
        index += 1;
    }

    Ok(Releve { teintes, familles })
}

/// Comme [`lire`], mais ne rend que la liste plate des teintes.
///
/// C'est la forme qu'utilise le produit pour un nuancier importé.
///
/// # Erreurs
///
/// Les mêmes que [`lire`].
pub fn lire_teintes(octets: &[u8]) -> Result<Vec<Pastille>, AseErreur> {
    lire(octets).map(|r| r.teintes)
}

/* ─────────────────────────── primitives de lecture ───────────────────────────
Toutes rendent `Option` : un fichier tronqué ne doit pas paniquer, il doit
rendre ce qu'il peut. L'équivalent côté produit est un `DataView` qui lève —
et un `try/catch` qui saute le bloc.

⚠️ Toutes les additions d'adresse sont **vérifiées** (`checked_add`). Sur
`wasm32`, un `usize` fait 32 bits : une longueur de bloc déclarée à
`0xFFFFFFFF` ferait déborder `position + 2`, ce qui panique en mode debug et
boucle à l'envers en mode publication. Un fichier tiers n'a pas à pouvoir
planter le noyau, donc aucune addition d'index n'est laissée nue.            */

fn u16_be(octets: &[u8], position: usize) -> Option<u16> {
    let fin = position.checked_add(2)?;
    let o = octets.get(position..fin)?;
    Some(u16::from_be_bytes([o[0], o[1]]))
}

fn u32_be(octets: &[u8], position: usize) -> Option<u32> {
    let fin = position.checked_add(4)?;
    let o = octets.get(position..fin)?;
    Some(u32::from_be_bytes([o[0], o[1], o[2], o[3]]))
}

fn f32_be(octets: &[u8], position: usize) -> Option<f32> {
    let fin = position.checked_add(4)?;
    let o = octets.get(position..fin)?;
    Some(f32::from_be_bytes([o[0], o[1], o[2], o[3]]))
}

/// Lit un nom UTF-16BE : `uint16` de longueur, puis les code units.
fn lire_nom(octets: &[u8], position: usize) -> Option<String> {
    let longueur = u16_be(octets, position)? as usize;
    let debut = position.checked_add(2)?;
    let mut unites = Vec::with_capacity(longueur.min(octets.len()));
    for i in 0..longueur {
        let a = debut.checked_add(i.checked_mul(2)?)?;
        unites.push(u16_be(octets, a)?);
    }
    Some(String::from_utf16_lossy(&unites))
}

/// Lit un bloc couleur : nom, modèle, puis les flottants **du modèle**.
///
/// Le produit lit **trois** flottants pour tous les modèles, y compris `Gray`
/// qui n'en a qu'**un** : il lit alors dans l'octet suivant, et si le bloc est
/// le dernier du fichier la lecture sort du tampon, lève, et la teinte est
/// **jetée**. Un `.ase` finissant par un gris y perd donc son dernier gris.
/// Ce lecteur lit le nombre de flottants que le modèle déclare — c'est la seule
/// différence volontaire, et elle est mesurée par `scripts/validate-swatch.mjs`.
fn lire_couleur(octets: &[u8], position: usize) -> Option<Pastille> {
    let nom = lire_nom(octets, position)?;
    let longueur_nom = u16_be(octets, position)? as usize;
    let modele_a = position
        .checked_add(2)?
        .checked_add(longueur_nom.checked_mul(2)?)?;
    let modele = octets.get(modele_a..modele_a.checked_add(4)?)?;
    let valeurs_a = modele_a.checked_add(4)?;

    let f = |i: usize| -> Option<f64> {
        let a = valeurs_a.checked_add(i.checked_mul(4)?)?;
        f32_be(octets, a).map(f64::from)
    };

    let rgb = match modele {
        b"RGB " => rgb_depuis_flottants(f(0)? * 255.0, f(1)? * 255.0, f(2)? * 255.0),
        b"CMYK" => cmyk_apercu_vers_rgb(f(0)?, f(1)?, f(2)?, f(3)?),
        b"LAB " => lab_apercu_vers_rgb(f(0)?, f(1)?, f(2)?),
        b"Gray" => {
            let v = f(0)? * 255.0;
            rgb_depuis_flottants(v, v, v)
        }
        _ => return None,
    };

    let hex = hex_depuis_rgb(rgb);
    let nom = nom.trim();
    Some(Pastille::new(
        if nom.is_empty() { hex } else { nom.to_string() },
        rgb,
    ))
}

/* ─────────────────────────── conversions d'aperçu ─────────────────────────── */

/// Arrondit et borne une composante 0–255, comme le produit.
///
/// Une valeur non finie vaut **zéro** : un flottant aberrant dans un fichier
/// tiers ne doit pas produire une couleur au hasard.
#[must_use]
pub fn octet(valeur: f64) -> u8 {
    if !valeur.is_finite() {
        return 0;
    }
    valeur.round().clamp(0.0, 255.0) as u8
}

/// RVB flottant (0–255) → couleur à octets.
#[must_use]
pub fn rgb_depuis_flottants(r: f64, g: f64, b: f64) -> Rgb {
    Rgb::new(octet(r), octet(g), octet(b))
}

/// CMJN **d'aperçu** → RVB : `(1 − c)(1 − k)`, comme le reste du produit.
#[must_use]
pub fn cmyk_apercu_vers_rgb(c: f64, m: f64, y: f64, k: f64) -> Rgb {
    rgb_depuis_flottants(
        255.0 * (1.0 - c) * (1.0 - k),
        255.0 * (1.0 - m) * (1.0 - k),
        255.0 * (1.0 - y) * (1.0 - k),
    )
}

/// L\*a\*b\* (D50) → sRGB **d'aperçu**, porté à l'identique du produit.
///
/// Ce n'est pas la colorimétrie correcte — c'est celle du produit, et c'est ce
/// qui compte ici : la même pastille des deux côtés de la frontière. Pour une
/// conversion exacte, voir `superprint_core::lab`.
#[must_use]
pub fn lab_apercu_vers_rgb(l: f64, a: f64, b: f64) -> Rgb {
    let fy = (l + 16.0) / 116.0;
    let fx = fy + a / 500.0;
    let fz = fy - b / 200.0;
    let f = |t: f64| {
        let t3 = t * t * t;
        if t3 > 0.008_856 {
            t3
        } else {
            (t - 16.0 / 116.0) / 7.787
        }
    };
    let x = 0.9642 * f(fx);
    let y = 1.0 * f(fy);
    let z = 0.8249 * f(fz);
    let r = 3.133_856_1 * x - 1.616_866_7 * y - 0.490_614_6 * z;
    let g = -0.978_768_4 * x + 1.916_141_5 * y + 0.033_454_0 * z;
    let bl = 0.071_945_3 * x - 0.228_991_4 * y + 1.405_242_7 * z;
    let gamma = |v: f64| {
        if v <= 0.003_130_8 {
            12.92 * v
        } else {
            1.055 * v.powf(1.0 / 2.4) - 0.055
        }
    };
    rgb_depuis_flottants(255.0 * gamma(r), 255.0 * gamma(g), 255.0 * gamma(bl))
}

#[cfg(test)]
mod tests {
    use super::*;

    /* ─────────── fabrication de fichiers `.ase` pour les tests ─────────── */

    struct Ecrivain {
        octets: Vec<u8>,
        blocs: u32,
    }

    impl Ecrivain {
        fn nouveau() -> Self {
            let mut octets = Vec::from(*b"ASEF");
            octets.extend_from_slice(&1u16.to_be_bytes());
            octets.extend_from_slice(&0u16.to_be_bytes());
            octets.extend_from_slice(&0u32.to_be_bytes()); /* compte, rempli à la fin */
            Self { octets, blocs: 0 }
        }

        fn bloc(&mut self, type_bloc: u16, donnees: &[u8]) {
            self.octets.extend_from_slice(&type_bloc.to_be_bytes());
            self.octets
                .extend_from_slice(&(donnees.len() as u32).to_be_bytes());
            self.octets.extend_from_slice(donnees);
            self.blocs += 1;
        }

        fn nom(nom: &str) -> Vec<u8> {
            let unites: Vec<u16> = nom.encode_utf16().collect();
            let mut donnees = Vec::new();
            donnees.extend_from_slice(&(unites.len() as u16).to_be_bytes());
            for u in unites {
                donnees.extend_from_slice(&u.to_be_bytes());
            }
            donnees
        }

        fn couleur(&mut self, nom: &str, modele: &[u8; 4], valeurs: &[f32]) {
            let mut donnees = Self::nom(nom);
            donnees.extend_from_slice(modele);
            for v in valeurs {
                donnees.extend_from_slice(&v.to_be_bytes());
            }
            self.bloc(0x0001, &donnees);
        }

        fn groupe(&mut self, nom: &str) {
            self.bloc(0xC001, &Self::nom(nom));
        }

        fn fin_groupe(&mut self) {
            self.bloc(0xC002, &[]);
        }

        fn finir(mut self) -> Vec<u8> {
            let compte = self.blocs.to_be_bytes();
            self.octets[8..12].copy_from_slice(&compte);
            self.octets
        }
    }

    fn un_ase_simple() -> Vec<u8> {
        let mut e = Ecrivain::nouveau();
        e.couleur("Rouge pur", b"RGB ", &[1.0, 0.0, 0.0]);
        e.couleur("Noir riche", b"CMYK", &[0.6, 0.4, 0.4, 1.0]);
        e.couleur("Gris moyen", b"Gray", &[0.5]);
        e.finir()
    }

    #[test]
    fn un_fichier_trop_court_est_refuse() {
        assert_eq!(lire(&[]), Err(AseErreur::TropCourt { taille: 0 }));
        assert_eq!(lire(&[0; 11]), Err(AseErreur::TropCourt { taille: 11 }));
    }

    #[test]
    fn une_signature_absente_est_refusee() {
        let mut octets = un_ase_simple();
        octets[0] = b'B';
        assert_eq!(lire(&octets), Err(AseErreur::SignatureAbsente));
    }

    #[test]
    fn les_trois_modeles_simples_se_lisent() {
        let releve = lire(&un_ase_simple()).unwrap();
        assert_eq!(releve.teintes.len(), 3);
        assert_eq!(releve.teintes[0].nom, "Rouge pur");
        assert_eq!(releve.teintes[0].hex(), "#FF0000");
        assert_eq!(releve.teintes[1].nom, "Noir riche");
        /* (1-0,6)(1-1) = 0 ; (1-0,4)(0) = 0 ; (1-0,4)(0) = 0 → noir */
        assert_eq!(releve.teintes[1].hex(), "#000000");
        assert_eq!(releve.teintes[2].hex(), "#808080");
    }

    #[test]
    fn le_gris_est_replique_sur_les_trois_canaux() {
        let mut e = Ecrivain::nouveau();
        e.couleur("Gris clair", b"Gray", &[0.75]);
        let releve = lire(&e.finir()).unwrap();
        assert_eq!(releve.teintes[0].rgb, Rgb::new(191, 191, 191));
    }

    #[test]
    fn un_gris_en_dernier_bloc_est_lu_et_pas_jete() {
        /* Écart VOULU avec le produit : il lit trois flottants même pour un
        gris, donc ici la troisième lecture sort du fichier, lève, et la
        teinte disparaît. Un nuancier finissant par un gris y perd sa
        dernière teinte. On lit le nombre de flottants que le modèle déclare. */
        let mut e = Ecrivain::nouveau();
        e.couleur("Cyan", b"CMYK", &[1.0, 0.0, 0.0, 0.0]);
        e.couleur("Gris final", b"Gray", &[0.5]);
        let octets = e.finir();
        let releve = lire(&octets).unwrap();
        assert_eq!(releve.teintes.len(), 2);
        assert_eq!(releve.teintes[1].nom, "Gris final");
        assert_eq!(releve.teintes[1].rgb, Rgb::new(128, 128, 128));
    }

    #[test]
    fn le_lab_donne_une_pastille_coherente() {
        /* L*=100 a*=0 b*=0 est le blanc : la pastille doit être blanche, quelle
        que soit la précision de la matrice. */
        let mut e = Ecrivain::nouveau();
        e.couleur("Blanc", b"LAB ", &[100.0, 0.0, 0.0]);
        e.couleur("Noir", b"LAB ", &[0.0, 0.0, 0.0]);
        let releve = lire(&e.finir()).unwrap();
        assert_eq!(releve.teintes[0].hex(), "#FFFFFF");
        assert_eq!(releve.teintes[1].hex(), "#000000");
    }

    #[test]
    fn un_nom_vide_prend_son_code_couleur() {
        let mut e = Ecrivain::nouveau();
        e.couleur("", b"RGB ", &[0.0, 0.0, 1.0]);
        e.couleur("   ", b"RGB ", &[0.0, 1.0, 0.0]);
        let releve = lire(&e.finir()).unwrap();
        assert_eq!(releve.teintes[0].nom, "#0000FF");
        assert_eq!(releve.teintes[1].nom, "#00FF00");
    }

    #[test]
    fn un_modele_inconnu_est_saute_sans_perdre_la_suite() {
        let mut e = Ecrivain::nouveau();
        e.couleur("Avant", b"RGB ", &[1.0, 1.0, 1.0]);
        e.couleur("Espace bizarre", b"XYZ ", &[0.1, 0.2, 0.3]);
        e.couleur("Après", b"RGB ", &[0.0, 0.0, 0.0]);
        let releve = lire(&e.finir()).unwrap();
        assert_eq!(releve.teintes.len(), 2);
        assert_eq!(releve.teintes[0].nom, "Avant");
        assert_eq!(releve.teintes[1].nom, "Après");
    }

    #[test]
    fn un_bloc_de_type_inconnu_est_saute_par_sa_longueur() {
        let mut e = Ecrivain::nouveau();
        e.couleur("Avant", b"RGB ", &[1.0, 0.0, 1.0]);
        e.bloc(0x9999, &[0u8; 37]);
        e.couleur("Après", b"RGB ", &[0.0, 1.0, 1.0]);
        let releve = lire(&e.finir()).unwrap();
        assert_eq!(releve.teintes.len(), 2);
        assert_eq!(releve.teintes[1].hex(), "#00FFFF");
    }

    #[test]
    fn un_fichier_tronque_rend_ce_qu_il_peut() {
        let complet = un_ase_simple();
        for coupe in [12, 20, 40, 70] {
            let partiel = &complet[..coupe.min(complet.len())];
            /* Ne doit pas paniquer, et ne doit jamais rendre plus que le complet. */
            let obtenu = lire(partiel).map(|r| r.teintes.len());
            assert!(
                matches!(obtenu, Ok(n) if n <= 3),
                "coupe à {coupe} : {obtenu:?}"
            );
        }
    }

    #[test]
    fn une_longueur_de_bloc_absurde_ne_panique_pas() {
        /* wasm32 est en 32 bits : `debut + longueur` peut déborder. Le lecteur
        doit s'arrêter proprement, pas planter. */
        let mut octets = un_ase_simple();
        let position_bloc = 12;
        octets[position_bloc + 2..position_bloc + 6].copy_from_slice(&u32::MAX.to_be_bytes());
        assert!(lire(&octets).is_ok());
    }

    #[test]
    fn les_groupes_sont_releves_et_les_teintes_rattachees() {
        let mut e = Ecrivain::nouveau();
        e.groupe("Les chauds");
        e.couleur("Rouge", b"RGB ", &[1.0, 0.0, 0.0]);
        e.couleur("Orange", b"RGB ", &[1.0, 0.5, 0.0]);
        e.fin_groupe();
        e.groupe("Les froids");
        e.couleur("Bleu", b"RGB ", &[0.0, 0.0, 1.0]);
        e.fin_groupe();
        let releve = lire(&e.finir()).unwrap();
        assert_eq!(releve.teintes.len(), 3);
        assert_eq!(releve.familles.len(), 2);
        assert_eq!(releve.familles[0].label, "Les chauds");
        assert_eq!(releve.familles[0].teintes.len(), 2);
        assert_eq!(releve.familles[1].label, "Les froids");
        assert_eq!(releve.familles[1].teintes.len(), 1);
    }

    #[test]
    fn un_compte_de_blocs_trop_grand_ne_boucle_pas() {
        let mut octets = un_ase_simple();
        octets[8..12].copy_from_slice(&1_000_000u32.to_be_bytes());
        let releve = lire(&octets).unwrap();
        assert_eq!(releve.teintes.len(), 3);
    }

    #[test]
    fn un_compte_de_blocs_a_zero_ne_rend_rien() {
        let mut octets = un_ase_simple();
        octets[8..12].copy_from_slice(&0u32.to_be_bytes());
        assert_eq!(lire(&octets).unwrap().teintes.len(), 0);
    }

    #[test]
    fn les_valeurs_non_finies_valent_zero() {
        /* NaN **et** infini : les deux ne sont pas des nombres exploitables, et
        le produit les traite comme zéro plutôt que de laisser passer une
        couleur au hasard dans un fichier tiers. */
        let mut e = Ecrivain::nouveau();
        e.couleur("NaN", b"RGB ", &[f32::NAN, 0.5, f32::INFINITY]);
        e.couleur("Moins infini", b"RGB ", &[f32::NEG_INFINITY, 0.5, 0.5]);
        let releve = lire(&e.finir()).unwrap();
        assert_eq!(releve.teintes[0].rgb, Rgb::new(0, 128, 0));
        assert_eq!(releve.teintes[1].rgb, Rgb::new(0, 128, 128));
    }

    #[test]
    fn les_valeurs_hors_bornes_sont_bornees() {
        let mut e = Ecrivain::nouveau();
        e.couleur("Trop", b"RGB ", &[-5.0, 2.0, 0.5]);
        let releve = lire(&e.finir()).unwrap();
        assert_eq!(releve.teintes[0].rgb, Rgb::new(0, 255, 128));
    }

    #[test]
    fn la_lecture_est_deterministe() {
        let octets = un_ase_simple();
        let a = lire(&octets).unwrap();
        let b = lire(&octets).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn lire_teintes_est_la_forme_plate() {
        let octets = un_ase_simple();
        assert_eq!(
            lire_teintes(&octets).unwrap(),
            lire(&octets).unwrap().teintes
        );
    }

    #[test]
    fn octet_arrondit_et_borne() {
        assert_eq!(octet(127.5), 128);
        assert_eq!(octet(127.4), 127);
        assert_eq!(octet(-1.0), 0);
        assert_eq!(octet(300.0), 255);
        assert_eq!(octet(f64::NAN), 0);
        assert_eq!(octet(f64::NEG_INFINITY), 0);
    }
}
