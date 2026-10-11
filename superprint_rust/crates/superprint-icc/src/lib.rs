//! # superprint-icc — lire un profil ICC, pas le calculer
//!
//! ## Ce que ce crate fait, et surtout ce qu'il ne fait pas
//!
//! Le produit se sert des profils ICC pour **deux choses**, et pas trois :
//!
//! 1. **transformer** des couleurs — et cela reste le travail de `lcms` (Little
//!    CMS, C compilé, déjà embarqué dans le produit). On **lie** un moteur ICC,
//!    on n'en réécrit pas un : une transformation colorimétrique fausse ne se
//!    voit pas, elle sort simplement des tirages faux, et personne ne s'en
//!    aperçoit avant l'imprimeur ;
//! 2. **embarquer** le profil dans un PDF/X, en `/ICCBased`, référencé par un
//!    `OutputIntent` — et cela demande de savoir **ce qu'il y a dans le
//!    fichier** : son nom, son espace, son nombre de composantes, sa classe,
//!    son point blanc, et si le fichier est seulement valide.
//!
//! C'est le point 2 que ce crate prend en charge. Le point 1 reste à `lcms`, par
//! décision et non par manque — c'est écrit ici pour que personne ne cherche
//! « la transformation » dans ce crate.
//!
//! ## Les tables de couleurs : décrites, pas évaluées
//!
//! Un profil d'imprimante porte ses conversions dans des **tables** (`mft1`,
//! `mft2`). Ce crate **décrit** ces tables — nombre d'entrées, de sorties,
//! points de grille, taille calculée, taille déclarée — sans les évaluer, pour
//! deux raisons qu'il vaut mieux écrire que taire :
//!
//! - le produit n'en a pas besoin : c'est `lcms` qui transforme ;
//! - et les profils Adobe livrés **ne sont pas rangés comme la spécification le
//!   dit**, d'une façon parfaitement mesurable. Sur `CoatedFOGRA39.icc` : les
//!   balises `mft2` déclarent 1 520 octets de **moins** que la spécification, et
//!   les `mft1` 40 octets de **plus**. Le détail : en `mft2` l'en-tête fait 52
//!   octets au lieu de 48 et la table de sortie 12 octets au lieu de 1 536
//!   (deux entrées par canal, au lieu de 256) ; en `mft1`, 40 octets s'ajoutent
//!   à l'en-tête de 8.
//!
//! **La disposition est donc déductible — et c'est justement pourquoi ce crate
//! ne la déduit pas.** Un lecteur qui connaît la marotte d'Adobe lira ces trois
//! fichiers correctement et se trompera **en silence** sur un profil conforme
//! écrit par un autre outil : les couleurs seront fausses, et rien ne le dira.
//! [`Balise::ecart_de_taille`] **rend l'écart visible** au lieu de le masquer,
//! et `scripts/validate-icc.mjs` le chiffre sur les trois profils livrés.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « profils ICC »).

#![forbid(unsafe_code)]
#![deny(missing_docs)]

use superprint_core::lab::Xyz;

/// Pourquoi un fichier n'est pas un profil ICC exploitable.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErreurIcc {
    /// Moins de 128 octets : même l'en-tête n'y tient pas.
    TropCourt {
        /// Taille reçue, en octets.
        taille: usize,
    },
    /// Les octets 36 à 39 ne disent pas `acsp`.
    SignatureAbsente,
    /// La taille déclarée dans l'en-tête dépasse le fichier.
    TailleDeclareeTropGrande {
        /// Taille annoncée par l'en-tête.
        declaree: u32,
        /// Taille réelle du fichier.
        reelle: usize,
    },
    /// La table des balises sort du fichier.
    TableDesBalisesHorsFichier {
        /// Nombre de balises annoncé.
        nombre: u32,
    },
    /// Une balise sort du fichier.
    BaliseHorsFichier {
        /// Signature de la balise, quatre caractères.
        signature: String,
        /// Décalage annoncé.
        decalage: u32,
        /// Taille annoncée.
        taille: u32,
    },
}

impl std::fmt::Display for ErreurIcc {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TropCourt { taille } => {
                write!(f, "profil de {taille} octets : en-tête ICC incomplet")
            }
            Self::SignatureAbsente => write!(f, "signature « acsp » absente"),
            Self::TailleDeclareeTropGrande { declaree, reelle } => write!(
                f,
                "profil annoncé sur {declaree} octets alors qu'il n'en fait que {reelle}"
            ),
            Self::TableDesBalisesHorsFichier { nombre } => {
                write!(f, "table de {nombre} balises plus longue que le fichier")
            }
            Self::BaliseHorsFichier {
                signature,
                decalage,
                taille,
            } => write!(
                f,
                "balise « {signature} » ({decalage} + {taille}) en dehors du fichier"
            ),
        }
    }
}

impl std::error::Error for ErreurIcc {}

/// L'espace de couleurs d'un profil ou d'une connexion.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Espace {
    /// Trois canaux rouge-vert-bleu.
    Rgb,
    /// Quatre canaux cyan-magenta-jaune-noir.
    Cmjn,
    /// Un canal.
    Gris,
    /// Deux canaux.
    DeuxCouleurs,
    /// Trois canaux CMY.
    Cmy,
    /// Quatre à quinze canaux : un nuancier propre au procédé.
    Multicolore(u8),
    /// `Lab `, le PCS usuel.
    Lab,
    /// `XYZ `, l'autre PCS.
    Xyz,
    /// Un espace que ce crate ne nomme pas (`YCbr`, `HSV`…).
    Autre([u8; 4]),
}

impl Espace {
    /// Nombre de canaux de la connexion.
    #[must_use]
    pub const fn composantes(self) -> u8 {
        match self {
            Self::Rgb | Self::Lab | Self::Xyz | Self::Cmy => 3,
            Self::Cmjn | Self::Multicolore(4) => 4,
            Self::Gris => 1,
            Self::DeuxCouleurs => 2,
            Self::Multicolore(n) => n,
            Self::Autre(_) => 0,
        }
    }

    /// Lit une signature de quatre octets.
    #[must_use]
    pub fn depuis_signature(sig: [u8; 4]) -> Self {
        match &sig {
            b"RGB " => Self::Rgb,
            b"CMYK" => Self::Cmjn,
            b"GRAY" => Self::Gris,
            b"2CLR" => Self::DeuxCouleurs,
            b"CMY " => Self::Cmy,
            b"Lab " => Self::Lab,
            b"XYZ " => Self::Xyz,
            b"3CLR" => Self::Multicolore(3),
            b"5CLR" => Self::Multicolore(5),
            b"6CLR" => Self::Multicolore(6),
            b"7CLR" => Self::Multicolore(7),
            b"8CLR" => Self::Multicolore(8),
            b"9CLR" => Self::Multicolore(9),
            b"ACLR" => Self::Multicolore(10),
            b"BCLR" => Self::Multicolore(11),
            b"CCLR" => Self::Multicolore(12),
            b"DCLR" => Self::Multicolore(13),
            b"ECLR" => Self::Multicolore(14),
            b"FCLR" => Self::Multicolore(15),
            _ => Self::Autre(sig),
        }
    }

    /// Signature de quatre octets, telle qu'elle est écrite dans un profil.
    #[must_use]
    pub fn signature(self) -> [u8; 4] {
        match self {
            Self::Rgb => *b"RGB ",
            Self::Cmjn => *b"CMYK",
            Self::Gris => *b"GRAY",
            Self::DeuxCouleurs => *b"2CLR",
            Self::Cmy => *b"CMY ",
            Self::Lab => *b"Lab ",
            Self::Xyz => *b"XYZ ",
            Self::Multicolore(n) => match n {
                3 => *b"3CLR",
                5 => *b"5CLR",
                6 => *b"6CLR",
                7 => *b"7CLR",
                8 => *b"8CLR",
                9 => *b"9CLR",
                10 => *b"ACLR",
                11 => *b"BCLR",
                12 => *b"CCLR",
                13 => *b"DCLR",
                14 => *b"ECLR",
                _ => *b"FCLR",
            },
            Self::Autre(sig) => sig,
        }
    }

    /// Vrai si l'espace est celui d'une **sortie** d'impression (une encre).
    ///
    /// C'est la question qui compte pour un `OutputIntent` : on y met un profil
    /// d'impression, pas un profil d'écran. (Un profil d'écran placé là passe
    /// les contrôles de structure et donne un PDF/X invalide.)
    #[must_use]
    pub const fn est_un_espace_d_impression(self) -> bool {
        matches!(
            self,
            Self::Cmjn | Self::Cmy | Self::Gris | Self::DeuxCouleurs | Self::Multicolore(_)
        )
    }
}

impl std::fmt::Display for Espace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Rgb => write!(f, "RVB"),
            Self::Cmjn => write!(f, "CMJN"),
            Self::Gris => write!(f, "gris"),
            Self::DeuxCouleurs => write!(f, "deux couleurs"),
            Self::Cmy => write!(f, "CMJ"),
            Self::Multicolore(n) => write!(f, "{n} couleurs"),
            Self::Lab => write!(f, "Lab"),
            Self::Xyz => write!(f, "XYZ"),
            Self::Autre(_) => write!(f, "inconnu"),
        }
    }
}

/// Classe d'appareil du profil.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Classe {
    /// Profil d'entrée : un scanner, un appareil photo.
    Entree,
    /// Profil d'affichage.
    Affichage,
    /// Profil de sortie : une imprimante, un procédé. **C'est celui d'un PDF/X.**
    Sortie,
    /// Profil d'un espace de connexion (`Lab`, `XYZ`).
    EspaceDeConnexion,
    /// Profil d'un espace abstrait.
    Abstrait,
    /// Profil d'un nuancier nommé.
    Nuancier,
    /// Classe non reconnue.
    Autre([u8; 4]),
}

impl Classe {
    /// Lit une signature.
    #[must_use]
    pub fn depuis_signature(sig: [u8; 4]) -> Self {
        match &sig {
            b"scnr" => Self::Entree,
            b"mntr" => Self::Affichage,
            b"prtr" => Self::Sortie,
            b"link" => Self::EspaceDeConnexion,
            b"abst" => Self::Abstrait,
            b"nmcl" => Self::Nuancier,
            _ => Self::Autre(sig),
        }
    }

    /// Vrai si la classe convient à un `OutputIntent` de PDF/X.
    #[must_use]
    pub const fn convient_comme_sortie(self) -> bool {
        matches!(self, Self::Sortie)
    }
}

impl std::fmt::Display for Classe {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Entree => write!(f, "entrée"),
            Self::Affichage => write!(f, "affichage"),
            Self::Sortie => write!(f, "sortie"),
            Self::EspaceDeConnexion => write!(f, "espace de connexion"),
            Self::Abstrait => write!(f, "abstrait"),
            Self::Nuancier => write!(f, "nuancier"),
            Self::Autre(_) => write!(f, "inconnue"),
        }
    }
}

/// Ce qu'une balise de table de couleurs annonce — **sans l'évaluer**.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct StructureTable {
    /// Type de la balise (`mft1`, `mft2`, `mAB `, `mBA `).
    pub type_balise: [u8; 4],
    /// Nombre de canaux d'entrée.
    pub entrees: u8,
    /// Nombre de canaux de sortie.
    pub sorties: u8,
    /// Points de grille de la CLUT.
    pub points_de_grille: u8,
}

/// Une balise du profil.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Balise {
    /// Signature, quatre caractères (`desc`, `A2B0`…).
    pub signature: String,
    /// Décalage dans le fichier.
    pub decalage: u32,
    /// Taille annoncée.
    pub taille: u32,
    /// Signature du **type** rangé à ce décalage (`mft2`, `XYZ `, `desc`…).
    pub type_balise: [u8; 4],
    /// Structure déclarée, pour les balises de table de couleurs.
    pub table: Option<StructureTable>,
}

impl Balise {
    /// Taille **calculée** de la table, d'après la spécification (ICC.1).
    ///
    /// `None` pour les balises qui ne sont pas des tables de couleurs.
    ///
    /// C'est le calcul de la spécification, et rien d'autre : il sert à
    /// **comparer** avec la taille déclarée, pas à décider d'une disposition.
    /// Quand les deux diffèrent, c'est un fait à montrer
    /// ([`Balise::ecart_de_taille`]), pas une convention à inventer.
    #[must_use]
    pub fn taille_calculee(&self) -> Option<u64> {
        let t = self.table?;
        let entrees = u64::from(t.entrees);
        let sorties = u64::from(t.sorties);
        let grille = u64::from(t.points_de_grille);
        let noeuds = grille.checked_pow(u32::from(t.entrees))?;
        Some(match &t.type_balise {
            /* lut8Type : en-tête 8, tables d'entrée de 256 entrées d'un octet,
            CLUT d'un octet par sortie, tables de sortie de 256 entrées. */
            b"mft1" => 8 + entrees * 256 + noeuds * sorties + sorties * 256,
            /* lut16Type : en-tête 48 (matrice comprise), tables d'entrée de 256
            entrées de deux octets, CLUT de deux octets par sortie, tables de
            sortie de 256 entrées de deux octets. */
            b"mft2" => 48 + entrees * 256 * 2 + noeuds * sorties * 2 + sorties * 256 * 2,
            _ => return None,
        })
    }

    /// L'écart entre la taille déclarée et la taille de la spécification.
    ///
    /// `0` quand tout concorde. Un écart non nul **n'est pas une erreur de
    /// lecture** : c'est un fait sur le fichier, et il est mesuré sur les trois
    /// profils livrés (`scripts/validate-icc.mjs`). Le taire serait faire
    /// semblant de comprendre le fichier.
    #[must_use]
    pub fn ecart_de_taille(&self) -> Option<i64> {
        let calculee = self.taille_calculee()?;
        Some(i64::from(self.taille) - calculee as i64)
    }
}

/// Un profil ICC lu.
#[derive(Clone, Debug, PartialEq)]
pub struct Profil {
    /// Taille annoncée dans l'en-tête.
    pub taille_declaree: u32,
    /// Version majeure.`bcd` : `0x02` pour un profil v2, `0x04` pour un v4.
    pub version_majeure: u8,
    /// Version mineure.
    pub version_mineure: u8,
    /// Classe d'appareil.
    pub classe: Classe,
    /// Espace de couleurs du fichier.
    pub espace: Espace,
    /// Espace de connexion (`Lab ` ou `XYZ `).
    pub pcs: Espace,
    /// Point blanc, tel que déclaré dans l'en-tête.
    pub point_blanc: Xyz,
    /// Intention de rendu par défaut.
    pub intention: u32,
    /// Nom du profil, lu dans `desc` ou `mluc`. Vide si aucune balise ne le porte.
    pub nom: String,
    /// Les balises, dans l'ordre du fichier.
    pub balises: Vec<Balise>,
}

impl Profil {
    /// Lit un profil.
    ///
    /// # Erreurs
    ///
    /// Refuse un fichier trop court, une signature absente, une taille déclarée
    /// plus grande que le fichier, une table de balises qui déborde, ou une
    /// balise qui déborde. Chaque refus est explicite : rendre un profil
    /// « partiellement lu » ferait écrire un `OutputIntent` sur un fichier
    /// incomplet, ce qui produirait un PDF invalide chez l'imprimeur.
    pub fn lire(octets: &[u8]) -> Result<Self, ErreurIcc> {
        if octets.len() < 128 {
            return Err(ErreurIcc::TropCourt {
                taille: octets.len(),
            });
        }
        if &octets[36..40] != b"acsp" {
            return Err(ErreurIcc::SignatureAbsente);
        }
        let taille_declaree = u32_be(octets, 0);
        if taille_declaree as usize > octets.len() {
            return Err(ErreurIcc::TailleDeclareeTropGrande {
                declaree: taille_declaree,
                reelle: octets.len(),
            });
        }

        let nombre = u32_be(octets, 128);
        let fin_table = 132usize.saturating_add(nombre as usize * 12);
        if fin_table > octets.len() {
            return Err(ErreurIcc::TableDesBalisesHorsFichier { nombre });
        }

        let mut balises = Vec::with_capacity(nombre as usize);
        for i in 0..nombre as usize {
            let e = 132 + i * 12;
            let signature = String::from_utf8_lossy(&octets[e..e + 4]).into_owned();
            let decalage = u32_be(octets, e + 4);
            let taille = u32_be(octets, e + 8);
            /* Une balise qui sort du fichier est une erreur, pas une balise
            vide : c'est ainsi qu'un profil tronqué se déguise en profil
            valide. */
            let debut = decalage as usize;
            let fin = debut.saturating_add(taille as usize);
            if decalage != 0 && (debut < 128 || fin > octets.len() || debut > fin) {
                return Err(ErreurIcc::BaliseHorsFichier {
                    signature,
                    decalage,
                    taille,
                });
            }
            let type_balise = if taille >= 4 && fin <= octets.len() {
                let mut t = [0u8; 4];
                t.copy_from_slice(&octets[debut..debut + 4]);
                t
            } else {
                [0; 4]
            };
            let table = structure_depuis(octets, debut, taille, type_balise);
            balises.push(Balise {
                signature,
                decalage,
                taille,
                type_balise,
                table,
            });
        }

        let point_blanc = Xyz {
            x: s15_16(octets, 68),
            y: s15_16(octets, 72),
            z: s15_16(octets, 76),
        };

        let nom = balises
            .iter()
            .find(|b| b.signature == "desc" || b.signature == "dmnd")
            .map(|b| {
                let debut = b.decalage as usize;
                let fin = debut.saturating_add(b.taille as usize).min(octets.len());
                let t = &octets[debut..fin];
                if &t[0..4.min(t.len())] == b"mluc" {
                    lire_mluc(t)
                } else {
                    lire_desc(t)
                }
            })
            .unwrap_or_default();

        Ok(Self {
            taille_declaree,
            version_majeure: octets[8],
            version_mineure: octets[9],
            classe: Classe::depuis_signature([octets[12], octets[13], octets[14], octets[15]]),
            espace: Espace::depuis_signature([octets[16], octets[17], octets[18], octets[19]]),
            pcs: Espace::depuis_signature([octets[20], octets[21], octets[22], octets[23]]),
            point_blanc,
            intention: u32_be(octets, 64),
            nom,
            balises,
        })
    }

    /// Une balise par sa signature.
    #[must_use]
    pub fn balise(&self, signature: &str) -> Option<&Balise> {
        self.balises.iter().find(|b| b.signature == signature)
    }

    /// Les balises dont la taille déclarée ne suit pas la spécification.
    ///
    /// Rendues au lieu d'être masquées : c'est le seul moyen de savoir qu'un
    /// fichier a été écrit par un outil qui s'écarte de la lettre de la norme.
    #[must_use]
    pub fn balises_hors_norme(&self) -> Vec<(&Balise, i64)> {
        self.balises
            .iter()
            .filter_map(|b| match b.ecart_de_taille() {
                Some(e) if e != 0 => Some((b, e)),
                _ => None,
            })
            .collect()
    }

    /// Vrai si le profil peut servir d'`OutputIntent` à un PDF/X.
    ///
    /// Trois conditions, et les trois comptent : une **classe de sortie**, un
    /// espace **d'impression**, et un point blanc non nul. Un profil d'écran
    /// satisfait les contrôles de structure et ne satisfait pas celui-ci — c'est
    /// précisément ce que ce test attrape.
    #[must_use]
    pub fn peut_servir_de_sortie(&self) -> bool {
        self.classe.convient_comme_sortie()
            && self.espace.est_un_espace_d_impression()
            && self.espace.composantes() > 0
            && self.point_blanc.x > 0.0
            && self.point_blanc.y > 0.0
            && self.point_blanc.z > 0.0
    }

    /// L'identifiant à écrire dans l'`OutputConditionIdentifier`.
    ///
    /// Le nom du profil quand il y en a un ; sinon la classe et l'espace, qui
    /// sont toujours lisibles — plutôt qu'une chaîne vide, que l'imprimeur ne
    /// saurait pas interpréter.
    #[must_use]
    pub fn identifiant_de_condition(&self) -> String {
        if !self.nom.is_empty() {
            return self.nom.clone();
        }
        format!("Profil {} {}", self.classe, self.espace)
    }

    /// Vrai si le profil porte au moins une balise de table de couleurs.
    #[must_use]
    pub fn a_des_tables_de_couleurs(&self) -> bool {
        self.balises.iter().any(|b| b.table.is_some())
    }
}

fn structure_depuis(
    octets: &[u8],
    debut: usize,
    taille: u32,
    type_balise: [u8; 4],
) -> Option<StructureTable> {
    if !matches!(&type_balise, b"mft1" | b"mft2") || taille < 12 || debut + 12 > octets.len() {
        return None;
    }
    Some(StructureTable {
        type_balise,
        entrees: octets[debut + 8],
        sorties: octets[debut + 9],
        points_de_grille: octets[debut + 10],
    })
}

fn u32_be(octets: &[u8], position: usize) -> u32 {
    match octets.get(position..position + 4) {
        Some(o) => u32::from_be_bytes([o[0], o[1], o[2], o[3]]),
        None => 0,
    }
}

/// Lit un `s15Fixed16Number` : 16 bits entiers, 16 bits fractionnaires signés.
fn s15_16(octets: &[u8], position: usize) -> f64 {
    match octets.get(position..position + 4) {
        Some(o) => f64::from(i32::from_be_bytes([o[0], o[1], o[2], o[3]])) / 65536.0,
        None => 0.0,
    }
}

/// Lit un `textDescriptionType` (v2) : compte ASCII, puis la chaîne.
///
/// Le reste du type contient une version Unicode, que l'on ne lit pas : le
/// compte ASCII est toujours présent, et c'est lui qui porte le nom usuel.
fn lire_desc(octets: &[u8]) -> String {
    if octets.len() < 12 {
        return String::new();
    }
    let nombre = u32_be(octets, 8) as usize;
    let debut = 12usize;
    let fin = debut.saturating_add(nombre).min(octets.len());
    if debut >= fin {
        return String::new();
    }
    let brut = &octets[debut..fin];
    /* Le compte inclut souvent l'octet nul final : on le retire. */
    let sans_nul: Vec<u8> = brut.iter().copied().take_while(|b| *b != 0).collect();
    String::from_utf8_lossy(&sans_nul).trim().to_string()
}

/// Lit un `multiLocalizedUnicodeType` (v4) : la première chaîne déclarée.
///
/// Le type est **toujours** en UTF-16BE : les quatre premiers octets d'un
/// enregistrement sont la langue et le pays, pas un encodage. Le lire comme un
/// drapeau d'encodage est l'erreur classique, et elle ne se voit que sur un
/// profil v4 dont le nom contient des accents.
fn lire_mluc(octets: &[u8]) -> String {
    if octets.len() < 28 {
        return String::new();
    }
    let nombre = u32_be(octets, 8) as usize;
    let taille_enregistrement = u32_be(octets, 12) as usize;
    if nombre == 0 || taille_enregistrement < 12 {
        return String::new();
    }
    let e = 16usize;
    let longueur = u32_be(octets, e + 4) as usize;
    let decalage = u32_be(octets, e + 8) as usize;
    let debut = e
        .saturating_add(nombre * taille_enregistrement)
        .saturating_add(decalage);
    let fin = debut.saturating_add(longueur).min(octets.len());
    if debut >= fin {
        return String::new();
    }
    let unites: Vec<u16> = octets[debut..fin]
        .chunks_exact(2)
        .map(|c| u16::from_be_bytes([c[0], c[1]]))
        .collect();
    String::from_utf16_lossy(&unites).trim().to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Petit nom local, pour que les tests se lisent comme des phrases.
    fn lire_profil(octets: &[u8]) -> Result<Profil, ErreurIcc> {
        Profil::lire(octets)
    }

    /* ── fabrication d'un profil minimal, pour éprouver chaque refus ── */

    /// Le constructeur ci-dessus entasse contenu puis entrée ; l'ordre réel du
    /// format est l'inverse. On assemble donc proprement ici.
    fn profil_minimal(balises: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let mut entete = vec![0u8; 132];
        entete[8] = 2;
        entete[36..40].copy_from_slice(b"acsp");
        entete[12..16].copy_from_slice(b"prtr");
        entete[16..20].copy_from_slice(b"CMYK");
        entete[20..24].copy_from_slice(b"Lab ");
        entete[68..72].copy_from_slice(&0x0000_f6d6i32.to_be_bytes());
        entete[72..76].copy_from_slice(&0x0001_0000i32.to_be_bytes());
        entete[76..80].copy_from_slice(&0x0000_d32di32.to_be_bytes());

        let table = 132 + balises.len() * 12;
        let mut corps = Vec::new();
        let mut entrees = Vec::new();
        for (signature, contenu) in balises {
            let decalage = (table + corps.len()) as u32;
            let mut e = [0u8; 12];
            e[0..4].copy_from_slice(*signature);
            e[4..8].copy_from_slice(&decalage.to_be_bytes());
            e[8..12].copy_from_slice(&(contenu.len() as u32).to_be_bytes());
            entrees.push(e);
            corps.extend_from_slice(contenu);
        }
        let mut octets = entete;
        for e in &entrees {
            octets.extend_from_slice(e);
        }
        octets.extend_from_slice(&corps);
        let taille = octets.len() as u32;
        octets[0..4].copy_from_slice(&taille.to_be_bytes());
        octets[128..132].copy_from_slice(&(balises.len() as u32).to_be_bytes());
        octets
    }

    fn desc_texte(texte: &str) -> Vec<u8> {
        let mut donnees = Vec::from(*b"desc");
        donnees.extend_from_slice(&[0, 0, 0, 0]);
        let avec_nul: Vec<u8> = texte.bytes().chain(std::iter::once(0)).collect();
        donnees.extend_from_slice(&(avec_nul.len() as u32).to_be_bytes());
        donnees.extend_from_slice(&avec_nul);
        donnees
    }

    fn table_mft2(entrees: u8, sorties: u8, grille: u8, taille: u32) -> Vec<u8> {
        let mut donnees = Vec::from(*b"mft2");
        donnees.extend_from_slice(&[0, 0, 0, 0, entrees, sorties, grille, 0]);
        donnees.extend_from_slice(&[0u8; 36]);
        donnees.resize(taille as usize, 0);
        donnees
    }

    fn un_profil(balises: &[(&str, Vec<u8>)]) -> Vec<u8> {
        let propres: Vec<([u8; 4], Vec<u8>)> = balises
            .iter()
            .map(|(s, c)| {
                let mut sig = [0u8; 4];
                sig.copy_from_slice(s.as_bytes());
                (sig, c.clone())
            })
            .collect();
        let refs: Vec<(&[u8; 4], Vec<u8>)> = propres.iter().map(|(s, c)| (s, c.clone())).collect();
        profil_minimal(&refs)
    }

    #[test]
    fn un_fichier_trop_court_est_refuse() {
        assert_eq!(lire_profil(&[]), Err(ErreurIcc::TropCourt { taille: 0 }));
        assert_eq!(
            lire_profil(&[0; 127]),
            Err(ErreurIcc::TropCourt { taille: 127 })
        );
    }

    #[test]
    fn une_signature_absente_est_refusee() {
        let mut octets = profil_minimal(&[]);
        octets[38] = b'x';
        assert_eq!(lire_profil(&octets), Err(ErreurIcc::SignatureAbsente));
    }

    #[test]
    fn une_taille_declaree_trop_grande_est_refusee() {
        let mut octets = profil_minimal(&[]);
        octets[0..4].copy_from_slice(&999_999u32.to_be_bytes());
        assert!(matches!(
            lire_profil(&octets),
            Err(ErreurIcc::TailleDeclareeTropGrande {
                declaree: 999_999,
                ..
            })
        ));
    }

    #[test]
    fn une_table_de_balises_qui_deborde_est_refusee() {
        let mut octets = profil_minimal(&[]);
        octets[128..132].copy_from_slice(&1000u32.to_be_bytes());
        assert_eq!(
            lire_profil(&octets),
            Err(ErreurIcc::TableDesBalisesHorsFichier { nombre: 1000 })
        );
    }

    #[test]
    fn une_balise_qui_deborde_est_refusee() {
        let mut octets = un_profil(&[("desc", desc_texte("Test"))]);
        /* On déplace le décalage de la balise bien au-delà du fichier. */
        octets[136..140].copy_from_slice(&900_000u32.to_be_bytes());
        assert!(matches!(
            lire_profil(&octets),
            Err(ErreurIcc::BaliseHorsFichier { .. })
        ));
    }

    #[test]
    fn un_profil_minimal_se_lit() {
        let octets = un_profil(&[("desc", desc_texte("ISO Coated v2"))]);
        let p = lire_profil(&octets).unwrap();
        assert_eq!(p.version_majeure, 2);
        assert_eq!(p.classe, Classe::Sortie);
        assert_eq!(p.espace, Espace::Cmjn);
        assert_eq!(p.pcs, Espace::Lab);
        assert_eq!(p.nom, "ISO Coated v2");
        assert_eq!(p.point_blanc.x, 0.964_202_880_859_375);
        assert_eq!(p.balises.len(), 1);
        assert!(p.peut_servir_de_sortie());
    }

    #[test]
    fn un_nom_vide_laisse_la_place_au_dernier_recours() {
        let octets = profil_minimal(&[]);
        let p = lire_profil(&octets).unwrap();
        assert_eq!(p.nom, "");
        assert_eq!(p.identifiant_de_condition(), "Profil sortie CMJN");
    }

    #[test]
    fn le_point_blanc_est_lu_en_s15fixed16() {
        let octets = profil_minimal(&[]);
        let p = lire_profil(&octets).unwrap();
        /* 0x0000F6D6 = 63190 / 65536 = 0,9642 */
        assert!((p.point_blanc.x - 0.9642).abs() < 1e-4);
        assert!((p.point_blanc.y - 1.0).abs() < 1e-9);
        assert!((p.point_blanc.z - 0.8249).abs() < 1e-4);
    }

    #[test]
    fn un_profil_d_ecran_ne_peut_pas_servir_de_sortie() {
        for (classe, espace) in [(b"mntr", b"RGB "), (b"prtr", b"RGB "), (b"mntr", b"CMYK")] {
            let mut octets = profil_minimal(&[]);
            octets[12..16].copy_from_slice(classe);
            octets[16..20].copy_from_slice(espace);
            let p = lire_profil(&octets).unwrap();
            assert!(
                !p.peut_servir_de_sortie(),
                "classe {classe:?} espace {espace:?} devrait être refusé"
            );
        }
    }

    #[test]
    fn un_point_blanc_nul_empeche_de_servir_de_sortie() {
        let mut octets = profil_minimal(&[]);
        octets[68..80].fill(0);
        let p = lire_profil(&octets).unwrap();
        assert!(!p.peut_servir_de_sortie());
    }

    #[test]
    fn les_espaces_se_lisent_et_se_rendent() {
        for (sig, espace, composantes) in [
            (*b"RGB ", Espace::Rgb, 3),
            (*b"CMYK", Espace::Cmjn, 4),
            (*b"GRAY", Espace::Gris, 1),
            (*b"2CLR", Espace::DeuxCouleurs, 2),
            (*b"6CLR", Espace::Multicolore(6), 6),
            (*b"Lab ", Espace::Lab, 3),
            (*b"XYZ ", Espace::Xyz, 3),
        ] {
            let lu = Espace::depuis_signature(sig);
            assert_eq!(lu, espace);
            assert_eq!(lu.composantes(), composantes);
            assert_eq!(lu.signature(), sig);
        }
        assert_eq!(Espace::depuis_signature(*b"YCbr"), Espace::Autre(*b"YCbr"));
        assert_eq!(Espace::Autre(*b"YCbr").composantes(), 0);
    }

    #[test]
    fn seuls_les_espaces_d_impression_sont_des_espaces_d_impression() {
        assert!(Espace::Cmjn.est_un_espace_d_impression());
        assert!(Espace::Gris.est_un_espace_d_impression());
        assert!(Espace::Multicolore(6).est_un_espace_d_impression());
        assert!(!Espace::Rgb.est_un_espace_d_impression());
        assert!(!Espace::Lab.est_un_espace_d_impression());
        assert!(!Espace::Xyz.est_un_espace_d_impression());
    }

    #[test]
    fn les_classes_se_lisent() {
        for (sig, classe) in [
            (*b"scnr", Classe::Entree),
            (*b"mntr", Classe::Affichage),
            (*b"prtr", Classe::Sortie),
            (*b"link", Classe::EspaceDeConnexion),
            (*b"abst", Classe::Abstrait),
            (*b"nmcl", Classe::Nuancier),
        ] {
            assert_eq!(Classe::depuis_signature(sig), classe);
        }
        assert_eq!(Classe::depuis_signature(*b"zzzz"), Classe::Autre(*b"zzzz"));
        assert!(Classe::Sortie.convient_comme_sortie());
        assert!(!Classe::Affichage.convient_comme_sortie());
    }

    #[test]
    fn une_table_de_couleurs_est_decrite() {
        /* mft2 : 4 entrées, 3 sorties, 11 points de grille.
        Taille annoncée = celle de la spécification. */
        let taille = 48 + 4 * 256 * 2 + 11u64.pow(4) as u32 * 3 * 2 + 3 * 256 * 2;
        let octets = un_profil(&[("A2B0", table_mft2(4, 3, 11, taille))]);
        let p = lire_profil(&octets).unwrap();
        let balise = p.balise("A2B0").unwrap();
        assert_eq!(balise.type_balise, *b"mft2");
        let t = balise.table.unwrap();
        assert_eq!((t.entrees, t.sorties, t.points_de_grille), (4, 3, 11));
        assert_eq!(balise.ecart_de_taille(), Some(0));
        assert!(p.balises_hors_norme().is_empty());
    }

    #[test]
    fn un_ecart_de_taille_est_rendu_et_non_masque() {
        let octets = un_profil(&[("A2B0", table_mft2(4, 3, 11, 100_000))]);
        let p = lire_profil(&octets).unwrap();
        let hors = p.balises_hors_norme();
        assert_eq!(hors.len(), 1);
        assert_eq!(hors[0].0.signature, "A2B0");
        /* La taille de la spécification pour 4 → 3, grille 11, en 16 bits. */
        assert_eq!(hors[0].0.taille_calculee(), Some(91_478));
        assert_eq!(hors[0].1, 100_000 - 91_478);
    }

    #[test]
    fn une_balise_qui_n_est_pas_une_table_n_a_pas_de_taille_calculee() {
        let octets = un_profil(&[("desc", desc_texte("X"))]);
        let p = lire_profil(&octets).unwrap();
        assert_eq!(p.balise("desc").unwrap().taille_calculee(), None);
        assert_eq!(p.balise("desc").unwrap().ecart_de_taille(), None);
    }

    #[test]
    fn un_mluc_se_lit_en_utf16() {
        /* multiLocalizedUnicodeType : en-tête, un enregistrement (langue, pays,
        longueur, décalage), puis la chaîne en UTF-16BE. */
        let texte: Vec<u16> = "Coated FOGRA39 ".encode_utf16().collect();
        let donnees_utf16: Vec<u8> = texte.iter().flat_map(|u| u.to_be_bytes()).collect();
        let mut donnees = Vec::from(*b"mluc");
        donnees.extend_from_slice(&[0, 0, 0, 0]);
        donnees.extend_from_slice(&1u32.to_be_bytes()); /* un enregistrement */
        donnees.extend_from_slice(&12u32.to_be_bytes()); /* taille d'enregistrement */
        donnees.extend_from_slice(b"enUS"); /* langue + pays */
        donnees.extend_from_slice(&(donnees_utf16.len() as u32).to_be_bytes());
        donnees.extend_from_slice(&0u32.to_be_bytes()); /* décalage relatif */
        donnees.extend_from_slice(&donnees_utf16);
        let octets = un_profil(&[("desc", donnees)]);
        let p = lire_profil(&octets).unwrap();
        assert_eq!(p.nom, "Coated FOGRA39");
    }

    #[test]
    fn un_desc_sans_nul_final_est_lu_quand_meme() {
        let mut donnees = Vec::from(*b"desc");
        donnees.extend_from_slice(&[0, 0, 0, 0]);
        donnees.extend_from_slice(&3u32.to_be_bytes());
        donnees.extend_from_slice(b"abc");
        let octets = un_profil(&[("desc", donnees)]);
        assert_eq!(lire_profil(&octets).unwrap().nom, "abc");
    }

    #[test]
    fn un_nom_avec_espaces_est_nettoye() {
        let octets = un_profil(&[("desc", desc_texte("  SWOP  \n"))]);
        assert_eq!(lire_profil(&octets).unwrap().nom, "SWOP");
    }

    #[test]
    fn la_lecture_est_deterministe() {
        let octets = un_profil(&[
            ("desc", desc_texte("Profil de test")),
            ("wtpt", vec![0u8; 20]),
        ]);
        let a = lire_profil(&octets).unwrap();
        let b = lire_profil(&octets).unwrap();
        assert_eq!(a, b);
    }

    #[test]
    fn une_balise_de_zero_octet_est_toleree() {
        /* Certains profils portent une balise vide ; ce n'est pas une erreur. */
        let octets = un_profil(&[("cprt", vec![])]);
        let p = lire_profil(&octets).unwrap();
        assert_eq!(p.balise("cprt").unwrap().taille, 0);
    }
}
