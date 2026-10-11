//! # superprint-ps — PostScript, EPS et `.ai`
//!
//! ## Le constat qui commande tout
//!
//! **Un `.ai` moderne n'est pas du PostScript : c'est un PDF.** Illustrator
//! enregistre en PDF dès que la compatibilité PDF est active, ce qui est le
//! défaut. Le témoin du dépôt (`Logo_licra_vecto.ai`, 425 Ko) commence par
//! `%PDF-1.6`. Écrire un interpréteur PostScript pour ce fichier serait du temps
//! perdu, et prétendre l'avoir lu serait un mensonge.
//!
//! Ce crate **reconnaît** donc les saveurs ([`dsc::reconnaitre`]) et refuse un
//! PDF en le nommant ([`ErreurPs::EstUnPdf`]). La partie PostScript — `.eps`, et
//! les `.ai` enregistrés en EPS — est interprétée.
//!
//! ## Pourquoi il faut un interpréteur
//!
//! Parce que PostScript est un **langage de programmation**, pas un format. Un
//! `.eps` réel commence par un prologue qui définit ses abréviations :
//!
//! ```text
//! %%BeginProlog
//! /m /moveto load def
//! /l /lineto load def
//! /f /fill load def
//! %%EndProlog
//! ```
//!
//! et le corps du dessin n'emploie que celles-là. Chercher `moveto` dans le
//! texte ne trouverait rien ; chercher `m` trouverait n'importe quoi.
//!
//! ## La machine est bornée, et ses bornes sont écrites
//!
//! | Borne | Valeur |
//! |---|---|
//! | pas d'exécution | 5 000 000 |
//! | profondeur d'appel | 64 |
//! | dessins produits | 100 000 |
//! | profondeur de pile | 10 000 |
//!
//! ## Ce qui est refusé, et pourquoi ce n'est pas de la paresse
//!
//! - **le texte** (`show`, `charpath`…) : l'interpréter demande police, corps et
//!   approches, c'est-à-dire un moteur de composition de plus. L'**ignorer**
//!   serait pire : un import rendrait un dessin amputé de ses libellés sans rien
//!   dire ;
//! - **les images bitmap**, les polices, les entrées-sorties, l'horloge, la
//!   gestion mémoire : hors du sujet, et refusées nommément ;
//! - **les boucles sans compteur** (`loop`, `forall`) et `arct` : refusées avec
//!   leur nom, jamais approximées.
//!
//! Chaque refus nomme l'opérateur et **dit pourquoi** — c'est ce qui distingue
//! un import honnête d'un import qui a l'air complet.
//!
//! ## La chaîne
//!
//! [`interpreter`] rend un [`DocumentPs`] : l'en-tête DSC, et les
//! [`dessin::Dessin`] — chemins en coordonnées d'appareil, peintures, couleurs.
//! Les courbes sont aplaties par [`superprint_path::courbe`], avec une tolérance
//! explicite. Un `Dessin` est donc directement réutilisable par l'écrivain PDF
//! ou par la géométrie booléenne.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « import de documents »).

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod dessin;
pub mod dsc;
pub mod lexeur;
pub mod machine;

use std::fmt;

pub use dessin::{Couleur, Dessin, Matrice, Peinture};
pub use dsc::{EnTeteEps, Saveur};
pub use machine::Machine;

/// Tolérance d'aplatissement par défaut, en points PostScript.
///
/// `0,05` point vaut 17 millièmes de millimètre : très en dessous de ce qu'un
/// procédé d'impression distingue, et suffisant pour qu'un cercle de 100 mm de
/// rayon ne demande qu'une centaine de sommets.
pub const TOLERANCE_PAR_DEFAUT: f64 = 0.05;

/// Ce qu'une interprétation a produit.
#[derive(Clone, Debug, PartialEq)]
pub struct Valeurs {
    /// Les chemins peints, dans l'ordre du fichier.
    pub dessins: Vec<Dessin>,
    /// Les opérateurs rencontrés, triés. Sert à dire **ce que le fichier
    /// utilise**, donc ce qui pourrait manquer.
    pub operateurs: Vec<String>,
    /// Les opérateurs **inconnus**, triés et dédoublonnés.
    ///
    /// Un EPS réel arrive souvent avec un prologue tronqué ; ces noms sont ce
    /// que le noyau n'a pas su interpréter. Ils ne sont **pas** silencieux :
    /// ils figurent ici et dans les avertissements. Ce ne sont pas des refus —
    /// les refus, eux, arrêtent la lecture, parce qu'ils concernent des
    /// opérateurs dont l'ignorance perd du dessin (le texte, les images).
    pub inconnus: Vec<String>,
    /// Nombre de blocs de données sautés par le découpage DSC.
    pub blocs_ignores: usize,
    /// Nombre de `showpage`.
    pub pages: usize,
    /// Ce qui a été accepté sans effet, ou enregistré sans être appliqué.
    pub avertissements: Vec<String>,
}

/// Un fichier PostScript interprété.
#[derive(Clone, Debug, PartialEq)]
pub struct DocumentPs {
    /// La saveur reconnue (toujours [`Saveur::PostScript`] en cas de succès).
    pub saveur: Saveur,
    /// L'en-tête DSC.
    pub en_tete: EnTeteEps,
    /// Ce que l'interprétation a produit.
    pub valeurs: Valeurs,
}

impl DocumentPs {
    /// Les dessins.
    #[must_use]
    pub fn dessins(&self) -> &[Dessin] {
        &self.valeurs.dessins
    }

    /// La boîte englobante de tout ce qui a été **dessiné**, qui n'est pas
    /// forcément celle de l'en-tête : un fichier peut annoncer une boîte plus
    /// grande que son dessin, et le contrôle le montre.
    #[must_use]
    pub fn boite_dessinee(
        &self,
    ) -> Option<(superprint_path::point::Point, superprint_path::point::Point)> {
        let mut min: Option<superprint_path::point::Point> = None;
        let mut max: Option<superprint_path::point::Point> = None;
        for dessin in &self.valeurs.dessins {
            let Some((bas, haut)) = dessin.boite() else {
                continue;
            };
            min = Some(match min {
                None => bas,
                Some(m) => superprint_path::point::Point::new(m.x.min(bas.x), m.y.min(bas.y)),
            });
            max = Some(match max {
                None => haut,
                Some(m) => superprint_path::point::Point::new(m.x.max(haut.x), m.y.max(haut.y)),
            });
        }
        Some((min?, max?))
    }

    /// Nombre total de sommets, tous dessins confondus.
    #[must_use]
    pub fn nombre_de_sommets(&self) -> usize {
        self.valeurs
            .dessins
            .iter()
            .map(Dessin::nombre_de_sommets)
            .sum()
    }
}

/// Erreur d'interprétation PostScript.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErreurPs {
    /// Le fichier n'est pas du PostScript.
    SaveurRefusee {
        /// La saveur reconnue.
        saveur: Saveur,
    },
    /// Le fichier est un PDF — donc, très probablement, un `.ai` d'Illustrator.
    EstUnPdf {
        /// La version annoncée.
        version: u8,
    },
    /// Le lexage a échoué.
    Lexe {
        /// Ce que le lexeur a dit.
        raison: String,
    },
    /// Un opérateur existe mais n'est **pas** interprété, et la raison est dite.
    ///
    /// C'est un refus, et non un simple avertissement, parce qu'il ne porte que
    /// sur des opérateurs dont l'ignorance **perd du dessin** : le texte, les
    /// images, les polices, les boucles sans compteur. Les noms entièrement
    /// inconnus, eux, sont relevés sans arrêter la lecture — voir
    /// [`Valeurs::inconnus`].
    OperateurNonSupporte {
        /// Son nom.
        nom: String,
        /// Pourquoi il est refusé.
        raison: String,
    },
    /// Un opérande n'est pas du type attendu.
    TypeInattendu {
        /// L'opérateur.
        operateur: String,
        /// Ce qui a été trouvé.
        recu: String,
    },
    /// La pile n'a pas assez d'opérandes.
    PileInsuffisante {
        /// L'opérateur qui a manqué d'opérandes.
        operateur: String,
    },
    /// La pile est trop profonde.
    PileTropProfonde {
        /// La limite atteinte.
        limite: usize,
    },
    /// Un `grestore` sans `gsave`.
    EmpilementDesequilibre {
        /// L'opérateur.
        operateur: String,
    },
    /// Une peinture a été demandée sur un chemin vide.
    CheminVide {
        /// L'opérateur.
        operateur: String,
    },
    /// Une division par zéro.
    DivisionParZero,
    /// Un calcul a produit une valeur non finie.
    ValeurInvalide {
        /// L'opérateur.
        operateur: String,
    },
    /// Le programme a dépassé le nombre de pas autorisé.
    TropDePas {
        /// La limite.
        limite: usize,
    },
    /// Le programme est trop profondément imbriqué.
    TropProfond {
        /// La limite.
        limite: usize,
    },
    /// Le fichier a produit trop de dessins.
    TropDeDessins {
        /// La limite.
        limite: usize,
    },
}

impl fmt::Display for ErreurPs {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::SaveurRefusee { saveur } => {
                write!(f, "ce n'est pas du PostScript mais : {saveur}")
            }
            Self::EstUnPdf { version } => write!(
                f,
                "ce fichier est un PDF {version}.x, pas du PostScript : c'est le cas de tous les \
                 `.ai` enregistrés par Illustrator avec la compatibilité PDF. Le noyau ÉCRIT du \
                 PDF mais n'en LIT pas, et préfère le dire plutôt que d'interpréter de travers"
            ),
            Self::Lexe { raison } => write!(f, "lexage impossible : {raison}"),
            Self::OperateurNonSupporte { nom, raison } => {
                write!(f, "opérateur « {nom} » non interprété : {raison}")
            }
            Self::TypeInattendu { operateur, recu } => {
                write!(f, "{operateur} : opérande inattendu ({recu})")
            }
            Self::PileInsuffisante { operateur } => {
                write!(f, "{operateur} : pas assez d'opérandes sur la pile")
            }
            Self::PileTropProfonde { limite } => {
                write!(f, "pile plus profonde que {limite} éléments")
            }
            Self::EmpilementDesequilibre { operateur } => {
                write!(f, "{operateur} sans `gsave` correspondant")
            }
            Self::CheminVide { operateur } => {
                write!(f, "{operateur} : aucun chemin à peindre")
            }
            Self::DivisionParZero => write!(f, "division par zéro"),
            Self::ValeurInvalide { operateur } => {
                write!(
                    f,
                    "{operateur} : valeur non finie (division, racine ou logarithme)"
                )
            }
            Self::TropDePas { limite } => write!(
                f,
                "le programme dépasse {limite} pas d'exécution : boucle probable, refusée plutôt \
                 que subie"
            ),
            Self::TropProfond { limite } => write!(
                f,
                "imbrication d'appels plus profonde que {limite} : procédure récursive probable"
            ),
            Self::TropDeDessins { limite } => {
                write!(f, "le fichier produit plus de {limite} dessins")
            }
        }
    }
}

impl std::error::Error for ErreurPs {}

impl From<lexeur::ErreurLexe> for ErreurPs {
    fn from(e: lexeur::ErreurLexe) -> Self {
        Self::Lexe {
            raison: e.to_string(),
        }
    }
}

/// Interprète un fichier PostScript ou EPS.
///
/// # Erreurs
///
/// [`ErreurPs::EstUnPdf`] si le fichier est un PDF (donc un `.ai` d'Illustrator
/// moderne), [`ErreurPs::SaveurRefusee`] pour tout autre format,
/// [`ErreurPs::Lexe`] si le programme n'est pas lexable, et les erreurs
/// d'exécution pour le reste.
pub fn interpreter(octets: &[u8]) -> Result<DocumentPs, ErreurPs> {
    interpreter_avec(octets, TOLERANCE_PAR_DEFAUT)
}

/// Interprète avec une tolérance d'aplatissement imposée.
///
/// # Erreurs
///
/// Voir [`interpreter`].
pub fn interpreter_avec(octets: &[u8], tolerance: f64) -> Result<DocumentPs, ErreurPs> {
    match dsc::reconnaitre(octets) {
        Saveur::Pdf { version } => return Err(ErreurPs::EstUnPdf { version }),
        Saveur::PostScript => {}
        autre => return Err(ErreurPs::SaveurRefusee { saveur: autre }),
    }
    // Un fichier PostScript est de l'ASCII, avec des octets binaires possibles
    // dans les blocs de données — que le découpage DSC retire.
    let texte = String::from_utf8_lossy(octets);
    interpreter_source(&texte, tolerance)
}

/// Interprète un programme PostScript déjà lu comme du texte.
///
/// # Erreurs
///
/// Voir [`interpreter`].
pub fn interpreter_source(source: &str, tolerance: f64) -> Result<DocumentPs, ErreurPs> {
    let (en_tete, code, blocs) = dsc::decouper(source);
    let objets = lexeur::analyser(&code)?;
    let mut machine = Machine::nouvelle(tolerance);
    machine.blocs_ignores(blocs);
    machine.executer(&objets)?;
    Ok(DocumentPs {
        saveur: Saveur::PostScript,
        en_tete,
        valeurs: machine.terminer(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_pdf_est_refuse_en_le_nommant() {
        let erreur = interpreter(b"%PDF-1.6\n%....\n").unwrap_err();
        assert_eq!(erreur, ErreurPs::EstUnPdf { version: 1 });
        // Le message explique POURQUOI, c'est tout l'intérêt.
        let message = erreur.to_string();
        assert!(message.contains("PDF 1.x"), "{message}");
        assert!(message.contains("Illustrator"), "{message}");
    }

    #[test]
    fn une_saveur_inconnue_est_refusee() {
        assert!(matches!(
            interpreter(b"\x89PNG\r\n").unwrap_err(),
            ErreurPs::SaveurRefusee {
                saveur: Saveur::Inconnnue
            }
        ));
        assert!(matches!(
            interpreter(b"PK\x03\x04").unwrap_err(),
            ErreurPs::SaveurRefusee {
                saveur: Saveur::Archive
            }
        ));
    }

    #[test]
    fn un_eps_minimal_est_interprete() {
        let source = "%!PS-Adobe-3.0 EPSF-3.0\n\
                      %%BoundingBox: 0 0 100 100\n\
                      %%EndComments\n\
                      newpath 0 0 moveto 100 0 lineto 100 100 lineto 0 100 lineto closepath \
                      0.5 setgray fill\n\
                      showpage\n%%EOF\n";
        let document = interpreter(source.as_bytes()).unwrap();
        assert_eq!(document.saveur, Saveur::PostScript);
        assert_eq!(
            document.en_tete.bounding_box,
            Some((0.0, 0.0, 100.0, 100.0))
        );
        assert_eq!(document.dessins().len(), 1);
        assert_eq!(document.dessins()[0].couleur, Couleur::Gris(0.5));
        assert_eq!(document.valeurs.pages, 1);
        let (min, max) = document.boite_dessinee().unwrap();
        assert_eq!(min, superprint_path::point::Point::new(0.0, 0.0));
        assert_eq!(max, superprint_path::point::Point::new(100.0, 100.0));
    }

    #[test]
    fn la_boite_de_l_en_tete_et_celle_du_dessin_sont_distinctes() {
        // Un fichier qui annonce plus grand qu'il ne dessine.
        let source = "%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 500 500\n%%EndComments\n\
                      newpath 10 10 moveto 20 10 lineto 20 20 lineto closepath fill\n";
        let document = interpreter(source.as_bytes()).unwrap();
        assert_eq!(
            document.en_tete.bounding_box,
            Some((0.0, 0.0, 500.0, 500.0))
        );
        let (min, max) = document.boite_dessinee().unwrap();
        assert_eq!(min, superprint_path::point::Point::new(10.0, 10.0));
        assert_eq!(max, superprint_path::point::Point::new(20.0, 20.0));
    }

    #[test]
    fn le_decoupage_dsc_est_relaye() {
        let source = "%!PS-Adobe-3.0 EPSF-3.0\n\
                      %%BeginPreview: 10 10 1 10\n\
                      % A5A5A5A5\nA5A5A5A5\n\
                      %%EndPreview\n\
                      newpath 0 0 moveto 1 0 lineto stroke\n";
        let document = interpreter(source.as_bytes()).unwrap();
        assert_eq!(document.valeurs.blocs_ignores, 1);
        assert_eq!(document.dessins().len(), 1);
    }

    #[test]
    fn un_programme_infini_est_borne() {
        let source = "%!PS-Adobe-3.0\n/x { x } def x";
        let erreur = interpreter(source.as_bytes()).unwrap_err();
        assert!(matches!(
            erreur,
            ErreurPs::TropProfond {
                limite: machine::APPELS_MAX
            }
        ));
    }

    #[test]
    fn un_operateur_refuse_dit_pourquoi() {
        let source = "%!PS-Adobe-3.0\n(Bonjour) show\n";
        let erreur = interpreter(source.as_bytes()).unwrap_err();
        let message = erreur.to_string();
        assert!(message.contains("show"), "{message}");
        assert!(message.contains("texte"), "{message}");
    }

    #[test]
    fn tolerance_change_le_nombre_de_sommets() {
        let source = "%!PS-Adobe-3.0\nnewpath 0 0 moveto 0 100 100 100 100 0 curveto stroke\n";
        let grossier = interpreter_avec(source.as_bytes(), 5.0).unwrap();
        let fin = interpreter_avec(source.as_bytes(), 0.01).unwrap();
        assert!(
            fin.nombre_de_sommets() > grossier.nombre_de_sommets() * 3,
            "grossier {}, fin {}",
            grossier.nombre_de_sommets(),
            fin.nombre_de_sommets()
        );
    }
}
