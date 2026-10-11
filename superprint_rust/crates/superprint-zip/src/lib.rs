//! # superprint-zip — le conteneur des fichiers d'échange
//!
//! ## Pourquoi ce crate existe
//!
//! Un `.docx`, un `.odt`, un `.xlsx` et un `.idml` sont, avant d'être des
//! documents, **la même chose** : une archive ZIP contenant du XML. Le produit
//! chargeait pour cela une bibliothèque tierce (`jszip.min.js`) — trois fichiers
//! `.docx` sur quatre se lisent sans elle, mais il n'y avait aucun décodeur ZIP
//! dans le noyau. Il y en a un maintenant.
//!
//! Le décompresseur DEFLATE, lui, existait déjà ([`superprint_compress`]) : ce
//! crate ne fait que **le contenant** — annuaire central, en-têtes locaux,
//! méthodes, CRC.
//!
//! ## Ce qui est lu
//!
//! | Élément | État |
//! |---|---|
//! | Méthode `0` (stocké) | ✅ |
//! | Méthode `8` (DEFLATE) | ✅ via [`superprint_compress::decompresser_brut`] |
//! | Noms longs, noms UTF-8 (drapeau 11) | ✅ |
//! | Tailles dans un descripteur de données (drapeau 3) | ✅ l'annuaire central les porte |
//! | Commentaire d'archive | ✅ sauté, borné |
//! | Tout le reste | **refusé**, nommément |
//!
//! ## Ce qui est refusé, et pourquoi c'est écrit ici
//!
//! - **entrée chiffrée** (drapeau 0) : on ne devine pas un mot de passe ;
//! - **méthode de compression autre que stocké ou DEFLATE** (BZIP2 = 12,
//!   LZMA = 14, Zstd = 93) : le noyau n'a pas ces codecs, et rendre les octets
//!   compressés serait un mensonge ;
//! - **ZIP64** : une archive de plus de 4 Gio. Les formats visés ne l'emploient
//!   pas, et un lecteur à moitié ZIP64 vaut moins qu'un refus net ;
//! - **archive multi-volume**, **incohérence entre l'annuaire central et
//!   l'en-tête local**, **CRC différent** : ce sont des fichiers abîmés, et les
//!   accepter reviendrait à rendre du XML tronqué à l'analyseur.
//!
//! ## Le CRC est vérifié, pas décoratif
//!
//! Chaque entrée porte le CRC32 de son contenu **décompressé**. Le crate le
//! recalcule ([`crc32`]) et **refuse** en cas d'écart. C'est ce qui distingue
//! « le fichier s'est ouvert » de « le fichier est intact » : un ZIP tronqué
//! s'ouvre très bien, et rend un document.xml coupé en deux.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « import de documents »).

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod crc;
pub mod lecture;

pub use crc::crc32;
pub use lecture::{Archive, Entree};

/// Erreur de lecture d'une archive ZIP.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErreurZip {
    /// Le fichier est trop court pour contenir ce qu'il annonce.
    TropCourt {
        /// Ce qu'on cherchait.
        quoi: &'static str,
        /// Octets nécessaires.
        requis: usize,
        /// Octets présents.
        present: usize,
    },
    /// Aucune fin d'annuaire central (`EOCD`) n'a été trouvée.
    ///
    /// Ce n'est pas un ZIP. Le message le dit, parce que la confusion la plus
    /// fréquente est un fichier `.doc` (ancien format binaire) renommé en
    /// `.docx`, ou un `.rtf` renommé — les deux se rencontrent réellement.
    PasUneArchive,
    /// L'archive est découpée en plusieurs volumes.
    MultiVolume,
    /// L'archive emploie les tailles 64 bits (ZIP64).
    Zip64Refuse,
    /// Une entrée est chiffrée.
    Chiffre {
        /// Nom de l'entrée.
        nom: String,
    },
    /// La méthode de compression n'est pas gérée.
    MethodeInconnue {
        /// Nom de l'entrée.
        nom: String,
        /// Numéro de la méthode, tel qu'écrit dans l'archive.
        methode: u16,
    },
    /// Le nom d'une entrée n'est pas de l'UTF-8 valide.
    NomIllisible {
        /// Rang de l'entrée dans l'annuaire central.
        rang: usize,
    },
    /// Un décalage ou une taille sort du fichier.
    HorsFichier {
        /// Nom de l'entrée.
        nom: String,
    },
    /// Le contenu décompressé ne fait pas la taille annoncée.
    TailleDifferent {
        /// Nom de l'entrée.
        nom: String,
        /// Taille annoncée par l'archive.
        attendue: usize,
        /// Taille obtenue.
        obtenue: usize,
    },
    /// Le CRC32 du contenu ne correspond pas à celui de l'archive.
    CrcDifferent {
        /// Nom de l'entrée.
        nom: String,
        /// CRC écrit dans l'archive.
        attendu: u32,
        /// CRC calculé.
        obtenu: u32,
    },
    /// L'entrée demandée n'existe pas.
    EntreeAbsente {
        /// Nom demandé.
        nom: String,
    },
    /// Le flux DEFLATE d'une entrée est illisible.
    ///
    /// C'est une entrée abîmée : le contenant est intact, le contenu ne l'est
    /// pas. La distinction compte — restaurer un fichier depuis une sauvegarde
    /// n'est pas la même chose que réparer une archive.
    DeflateIllisible {
        /// Nom de l'entrée.
        nom: String,
        /// Ce que le décompresseur a dit.
        raison: String,
    },
    /// Le contenu d'une entrée n'est pas de l'UTF-8 valide.
    ///
    /// Les fichiers XML de ces archives sont de l'UTF-8 ; un contenu qui ne
    /// l'est pas est un fichier abîmé, ou un format qui n'est pas celui annoncé.
    TexteIllisible {
        /// Nom de l'entrée.
        nom: String,
    },
    /// L'archive annonce plus d'entrées que l'annuaire central n'en contient.
    AnnuaireIncoherent {
        /// Nombre annoncé par la fin d'annuaire.
        annonce: usize,
        /// Nombre effectivement lu.
        lu: usize,
    },
    /// Un nom d'entrée tenterait de sortir de l'archive (`../`, chemin absolu).
    ///
    /// Le noyau ne **écrit** jamais sur le disque à partir d'une archive, donc
    /// ce n'est pas une faille ici — mais un nom pareil signale une archive
    /// fabriquée, et il vaut mieux le dire que le laisser passer.
    NomSuspect {
        /// Le nom en question.
        nom: String,
    },
}

impl std::fmt::Display for ErreurZip {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TropCourt {
                quoi,
                requis,
                present,
            } => write!(
                f,
                "{quoi} : {present} octets présents, {requis} nécessaires"
            ),
            Self::PasUneArchive => write!(
                f,
                "ce n'est pas une archive ZIP : aucune fin d'annuaire central (EOCD) trouvée \
                 — un .doc ou un .rtf renommé en .docx produit exactement cela"
            ),
            Self::MultiVolume => write!(f, "archive ZIP multi-volume : non gérée"),
            Self::Zip64Refuse => write!(
                f,
                "archive ZIP64 (plus de 4 Gio) : non gérée, et refusée plutôt que mal lue"
            ),
            Self::Chiffre { nom } => write!(f, "entrée chiffrée : {nom}"),
            Self::MethodeInconnue { nom, methode } => write!(
                f,
                "méthode de compression {methode} non gérée (0 = stocké, 8 = DEFLATE) : {nom}"
            ),
            Self::NomIllisible { rang } => {
                write!(f, "nom de la {rang}e entrée illisible (UTF-8 invalide)")
            }
            Self::HorsFichier { nom } => {
                write!(f, "taille ou décalage hors du fichier : {nom}")
            }
            Self::TailleDifferent {
                nom,
                attendue,
                obtenue,
            } => write!(
                f,
                "{nom} : {obtenue} octets décompressés alors que {attendue} sont annoncés"
            ),
            Self::CrcDifferent {
                nom,
                attendu,
                obtenu,
            } => write!(
                f,
                "{nom} : CRC32 {obtenu:08X} alors que {attendu:08X} est annoncé — le fichier est abîmé"
            ),
            Self::EntreeAbsente { nom } => write!(f, "entrée absente de l'archive : {nom}"),
            Self::DeflateIllisible { nom, raison } => write!(
                f,
                "{nom} : le flux DEFLATE de cette entrée est illisible ({raison})"
            ),
            Self::TexteIllisible { nom } => {
                write!(f, "{nom} : contenu qui n'est pas de l'UTF-8 valide")
            }
            Self::AnnuaireIncoherent { annonce, lu } => write!(
                f,
                "l'archive annonce {annonce} entrées, l'annuaire en contient {lu}"
            ),
            Self::NomSuspect { nom } => write!(
                f,
                "nom d'entrée suspect (chemin absolu ou « .. ») : {nom}"
            ),
        }
    }
}

impl std::error::Error for ErreurZip {}
