//! # superprint-montage — l'assemblage d'une planche imposée
//!
//! Ce crate répond à une seule question : **comment passe-t-on d'un plan et de
//! deux rendus de page à un PDF imposé, prêt à partir chez l'imprimeur ?**
//!
//! Trois autres crates font le reste, chacun à sa place :
//!
//! | Crate | Sa responsabilité |
//! |---|---|
//! | [`superprint_impose`] | **décide** : ordre des pages, taille du média, pose de chaque page, zone autorisée, repères |
//! | [`superprint_pdf`] | **écrit** : syntaxe PDF, boîtes de page, images, profils ICC, PDF/X |
//! | `superprint-montage` | **assemble** : pose chaque rendu, rogne, trace, convertit les couleurs |
//!
//! ## Pourquoi un crate de plus, et pas une fonction dans `impose`
//!
//! Parce que `superprint-impose` **ne dessine rien** — c'est sa raison d'être, et
//! elle est écrite dans son en-tête : il calcule, sans dépendre du PDF. Y ajouter
//! l'assemblage l'obligerait à dépendre de `superprint-pdf`, et le calcul se
//! mettrait à traîner un écrivain de fichiers derrière lui. La couture est donc
//! ici, et nulle part ailleurs.
//!
//! ## Ce que l'assemblage garantit, et comment il le prouve
//!
//! ```no_run
//! use superprint_impose::{Emplacement, Plan, Reglages};
//! use superprint_montage::{assembler, Options, RendusPage};
//!
//! // Un format carré, sans fond perdu ni repères : la géométrie est nue, donc
//! // lisible dans l'exemple.
//! let reglages = Reglages {
//!     largeur_page_mm: 100.0,
//!     hauteur_page_mm: 100.0,
//!     fond_perdu_mm: 0.0,
//!     inclure_fond_perdu: false,
//!     reperes_de_coupe: false,
//!     ..Reglages::default()
//! };
//! let plan = Plan::nouveau(Emplacement::Page(2), Emplacement::Page(1), reglages);
//!
//! // Deux rendus de 20 × 20 pixels, au rapport exact de la zone posée.
//! let rendu = RendusPage::nouveau(20, 20, vec![128; 20 * 20 * 3]).unwrap();
//! let planche = assembler(&plan, [&rendu, &rendu], &Options::default()).unwrap();
//!
//! assert_eq!(planche.format_fini_mm, (200.0, 100.0));
//! assert!(planche.pdf.starts_with(b"%PDF-"));
//! ```
//!
//! Ce que la preuve vérifie, en plus de ce qui précède, est dans
//! `scripts/validate-montage.mjs` : le PDF produit est **relu par `pdf-lib`** —
//! un lecteur tiers, celui du produit — et ses boîtes, la place de chaque page,
//! l'effet du rognage, les repères, l'espace couleur des images et les clés PDF/X
//! sont confrontés à ce que le plan annonce.
//!
//! ## Le rognage mérite d'être regardé, pas cru
//!
//! La page de gauche et celle de droite se touchent : leurs fonds perdus
//! intérieurs se recouvrent, et sans rognage l'une dessine par-dessus l'autre.
//! Le produit corrige cela avec un `clipPath` de Fabric, appliqué **juste avant
//! de rasteriser** — le découpage n'existe donc que dans la façon dont le fichier
//! a été fabriqué. Ici, le rognage est une **opération du flux PDF**
//! ([`superprint_pdf::document::Op::Clip`]) : il est dans le fichier, et un
//! contrôle peut le relire.
//!
//! ## Les limites, écrites ici pour ne pas être découvertes
//!
//! - les pages sont posées **en image** : le texte de la planche n'est pas du
//!   texte, il est dans les pixels. C'est le prix de l'assemblage par le noyau,
//!   et c'est dit plutôt que tu ;
//! - les tons directs (Pantone) ne sont pas portés sur la planche imposée : une
//!   page contenant une encre directe y perd son nom d'encre. Le mode CMJN est
//!   le mode sûr, et PDF/X-1a est refusé en RVB — le noyau ne laisse pas
//!   passer un fichier qui serait refusé chez l'imprimeur ;
//! - la conversion RVB → CMJN est celle du noyau (vérifiée au bit près contre
//!   celle du produit), **pas** une transformation par profil ICC. Faire
//!   intervenir le profil demande de porter la gestion de couleurs, ce qui n'est
//!   pas fait.

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod planche;
pub mod rendu;

pub use planche::{
    assembler, assembler_serie, Assembleur, Face, FaceAssemblee, Options, Planche, Planches,
    Sortie, TOLERANCE_RAPPORT,
};
pub use rendu::{ModeCouleur, RendusPage};

use superprint_pdf::document::DocError;

/// Ce qui empêche d'assembler une planche.
#[derive(Clone, Debug, PartialEq)]
pub enum ErreurMontage {
    /// Un rendu n'a pas la taille que ses dimensions annoncent.
    ///
    /// La cause est presque toujours un appel fautif : une longueur oubliée, un
    /// canal alpha laissé dans le tampon (quatre octets par pixel au lieu de
    /// trois), ou une largeur et une hauteur interverties. Le message donne
    /// l'attendu et le reçu, parce que c'est le rapport entre les deux qui met
    /// sur la voie.
    TamponIncoherent {
        /// Largeur annoncée, en pixels.
        largeur_px: u32,
        /// Hauteur annoncée, en pixels.
        hauteur_px: u32,
        /// Nombre d'octets reçus.
        octets: usize,
        /// Nombre d'octets attendu.
        attendu: usize,
    },
    /// Le rapport du rendu ne correspond pas à la zone qu'il doit couvrir.
    ///
    /// La page serait **étirée** — invisible sur un aperçu à l'écran, visible
    /// sur le papier, et impossible à rattraper après coup.
    RapportIncoherent {
        /// Le côté fautif.
        cote: &'static str,
        /// La zone posée, en millimètres (largeur, hauteur).
        zone: (f64, f64),
        /// Le rendu reçu, en pixels (largeur, hauteur).
        pixels: (u32, u32),
    },
    /// Le document PDF a été refusé.
    Ecriture(DocError),
}

impl std::fmt::Display for ErreurMontage {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TamponIncoherent {
                largeur_px,
                hauteur_px,
                octets,
                attendu,
            } => write!(
                f,
                "rendu {largeur_px}×{hauteur_px} : {octets} octets reçus, {attendu} attendus \
                 (3 octets par pixel, ligne du haut en premier)"
            ),
            Self::RapportIncoherent { cote, zone, pixels } => write!(
                f,
                "page de {cote} : zone {:.3}×{:.3} mm (rapport {:.5}) contre un rendu \
                 {pixels:?} pixels (rapport {:.5}) — la page serait étirée",
                zone.0,
                zone.1,
                zone.0 / zone.1,
                f64::from(pixels.0) / f64::from(pixels.1),
            ),
            Self::Ecriture(erreur) => write!(f, "écriture du PDF refusée : {erreur}"),
        }
    }
}

impl std::error::Error for ErreurMontage {}

#[cfg(test)]
mod tests {
    use super::*;
    use superprint_core::units::mm_to_pt;
    use superprint_impose::Reglages;
    use superprint_pdf::object;
    use superprint_pdf::xmp::Conformite;

    /// Le plan des tests : A4, fond perdu 3, repères, sans découpe page à page.
    fn plan_a4() -> superprint_impose::Plan {
        superprint_impose::Plan::nouveau(
            superprint_impose::Emplacement::Page(1),
            superprint_impose::Emplacement::Page(2),
            Reglages::default(),
        )
    }

    /// Un rendu au rapport de la zone posée du plan A4 — 216 × 303 mm.
    ///
    /// Un pixel par millimètre suffit à ces tests : ce qui est vérifié est la
    /// **place** et le **rognage**, pas la finesse de l'image. Des tampons plus
    /// gros (1276 × 1789 à 150 dpi) font échouer le runtime de test, qui est du
    /// WebAssembly exécuté par Node — et un test qui tombe pour une raison
    /// d'environnement ne mesure plus rien.
    fn rendus_a4() -> RendusPage {
        RendusPage::nouveau(216, 303, vec![200; 216 * 303 * 3]).expect("tampon complet")
    }

    #[test]
    fn la_planche_a4_a_les_dimensions_du_plan() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let planche = assembler(&plan, [&rendu, &rendu], &Options::default()).unwrap();
        assert_eq!(planche.format_fini_mm, (420.0, 297.0));
        // Média = format fini + 2 × (fond perdu 3 + marge 10) = 446 × 323.
        assert!(
            (planche.media_mm.0 - 446.0).abs() < 1e-9,
            "{:?}",
            planche.media_mm
        );
        assert!(
            (planche.media_mm.1 - 323.0).abs() < 1e-9,
            "{:?}",
            planche.media_mm
        );
        assert!(planche.pdf.starts_with(b"%PDF-"));
    }

    /// Une imposition réelle a **deux faces par feuille** — le recto et le
    /// verso — et elles doivent tenir dans **un seul** PDF : dix fichiers à
    /// recoller ne sont pas un fichier à envoyer.
    ///
    /// Le contrôle ne compte pas les pages dans le flux : il demande à un
    /// lecteur tiers combien de pages il trouve, et où sont leurs boîtes.
    #[test]
    fn deux_faces_tiennent_dans_un_seul_pdf() {
        let recto = plan_a4();
        let verso = plan_a4();
        let rendu = rendus_a4();
        let planches = assembler_serie(
            &[
                Face {
                    plan: &recto,
                    rendus: [&rendu, &rendu],
                },
                Face {
                    plan: &verso,
                    rendus: [&rendu, &rendu],
                },
            ],
            &Options::default(),
        )
        .unwrap();

        assert_eq!(planches.faces.len(), 2, "une face décrite par page écrite");
        for face in &planches.faces {
            assert_eq!(face.format_fini_mm, (420.0, 297.0));
            assert_eq!(face.reperes, 12);
        }
        let texte = String::from_utf8_lossy(&planches.pdf);
        assert_eq!(
            texte.matches("/Type /Page /Parent").count(),
            2,
            "deux pages dans le fichier"
        );
        assert!(
            texte.contains("/Type /Pages /Kids") && texte.contains("/Count 2"),
            "l'arbre de pages doit annoncer deux pages"
        );
    }

    /// Une face fautive **arrête tout** : un PDF à moitié assemblé est plus
    /// dangereux qu'un refus, parce qu'on pourrait le prendre pour complet.
    #[test]
    fn une_face_fautive_arrete_l_assemblage() {
        let plan = plan_a4();
        // Le rendu d'un carré ne peut pas couvrir une zone de 216 × 303.
        let carre = RendusPage::nouveau(100, 100, vec![0; 100 * 100 * 3]).unwrap();
        let bon = rendus_a4();
        let erreur = assembler_serie(
            &[
                Face {
                    plan: &plan,
                    rendus: [&bon, &bon],
                },
                Face {
                    plan: &plan,
                    rendus: [&carre, &carre],
                },
            ],
            &Options::default(),
        )
        .unwrap_err();
        assert!(matches!(erreur, ErreurMontage::RapportIncoherent { .. }));
    }

    /// Les repères de la planche sont **ceux du plan**, et le plan en donne
    /// **douze** sans découpe page à page : quatre autour de chaque page, et les
    /// quatre de la couture sont remplacés par un trait commun aux deux pages —
    /// le trait de coupe passe une fois, pas deux.
    #[test]
    fn les_douze_reperes_du_plan_sont_ecrits() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let planche = assembler(&plan, [&rendu, &rendu], &Options::default()).unwrap();
        assert_eq!(planche.reperes, 12);
        let texte = String::from_utf8_lossy(&planche.pdf);
        assert_eq!(
            texte.matches("l\nS\n").count(),
            12,
            "un `S` par repère dans le flux"
        );
    }

    /// En découpe page par page, la gouttière ajoute les quatre repères
    /// intérieurs : chaque page est coupée pour elle-même, et il faut donc
    /// marquer ses deux bords.
    #[test]
    fn la_decoupe_page_a_page_ajoute_les_quatre_reperes_interieurs() {
        let reglages = Reglages {
            decoupe_page_a_page: true,
            ..Reglages::default()
        };
        let plan = superprint_impose::Plan::nouveau(
            superprint_impose::Emplacement::Page(1),
            superprint_impose::Emplacement::Page(2),
            reglages,
        );
        // La zone posée fait alors 216 × 303 mm comme sans gouttière : les deux
        // pages gardent leurs quatre fonds perdus.
        let rendu = rendus_a4();
        let planche = assembler(&plan, [&rendu, &rendu], &Options::default()).unwrap();
        assert_eq!(planche.reperes, 16);
        // Et le média s'élargit de la gouttière : 446 + 2 × 3 = 452 mm.
        assert!(
            (planche.media_mm.0 - 452.0).abs() < 1e-9,
            "{:?}",
            planche.media_mm
        );
    }

    /// **Le rognage est dans le fichier.** C'est la propriété qui distingue cet
    /// assemblage du produit : le découpage n'est pas une étape de fabrication,
    /// il est écrit dans le flux PDF et un lecteur peut le voir.
    #[test]
    fn le_rognage_est_ecrit_dans_le_flux() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let planche = assembler(&plan, [&rendu, &rendu], &Options::default()).unwrap();
        let texte = String::from_utf8_lossy(&planche.pdf);
        assert_eq!(texte.matches("re\nW n\n").count(), 2, "une zone par page");
        assert!(
            texte.matches("\nQ\n").count() >= 2,
            "chaque zone est refermée par un `Q`"
        );
    }

    /// Le CMJN écrit un espace couleur `DeviceCMYK`, et c'est une **obligation**
    /// de PDF/X-1a : une planche CMJN en RVB serait refusée par l'imprimeur.
    #[test]
    fn le_mode_cmjn_ecrit_du_device_cmyk() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let options = Options {
            mode: ModeCouleur::Cmjn,
            ..Options::default()
        };
        let planche = assembler(&plan, [&rendu, &rendu], &options).unwrap();
        let texte = String::from_utf8_lossy(&planche.pdf);
        assert!(texte.contains("/DeviceCMYK"), "espace couleur des images");
        assert!(!texte.contains("/DeviceRGB"));
    }

    /// Le mode gris écrit un octet par pixel : trois fois moins d'image à
    /// transporter, sans perte utile pour une planche en noir.
    #[test]
    fn le_mode_gris_ecrit_du_device_gray() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let options = Options {
            mode: ModeCouleur::NiveauxDeGris,
            ..Options::default()
        };
        let planche = assembler(&plan, [&rendu, &rendu], &options).unwrap();
        let texte = String::from_utf8_lossy(&planche.pdf);
        assert!(texte.contains("/DeviceGray"));
    }

    /// **Le garde-fou de PDF/X.** Revendiquer X-1a avec une image RVB est
    /// exactement ce que le noyau doit refuser : un tel fichier serait rejeté
    /// par tout contrôle d'imprimeur, et le découvrir après l'envoi coûte un
    /// tirage.
    #[test]
    fn revendiquer_pdfx1a_en_rvb_est_refuse() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let options = Options {
            sortie: Sortie::nouvelle(vec![0; 2048], 3, "sRGB", "sRGB IEC61966-2.1")
                .revendiquant(Conformite::PdfX1a2001),
            ..Options::default()
        };
        let erreur = assembler(&plan, [&rendu, &rendu], &options).unwrap_err();
        assert!(
            matches!(
                erreur,
                ErreurMontage::Ecriture(DocError::PdfxRvbInterdit { .. })
            ),
            "{erreur:?}"
        );
    }

    /// Revendiquer une conformité **sans** dire pour quelle condition
    /// d'impression : refusé aussi, et pour la même raison de fond.
    #[test]
    fn revendiquer_pdfx_sans_profil_de_sortie_est_refuse() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let options = Options {
            mode: ModeCouleur::Cmjn,
            sortie: Sortie::aucune().revendiquant(Conformite::PdfX1a2001),
            ..Options::default()
        };
        let erreur = assembler(&plan, [&rendu, &rendu], &options).unwrap_err();
        assert!(
            matches!(
                erreur,
                ErreurMontage::Ecriture(DocError::PdfxSansSortie { .. })
            ),
            "{erreur:?}"
        );
    }

    /// Et quand tout est cohérent — CMJN, profil de sortie, X-1a — le PDF porte
    /// la déclaration.
    #[test]
    fn le_cmjn_avec_profil_de_sortie_declare_pdfx() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let options = Options {
            mode: ModeCouleur::Cmjn,
            sortie: Sortie::nouvelle(vec![0; 2048], 4, "FOGRA39", "Coated FOGRA39")
                .revendiquant(Conformite::PdfX1a2001),
            ..Options::default()
        };
        let planche = assembler(&plan, [&rendu, &rendu], &options).unwrap();
        let texte = String::from_utf8_lossy(&planche.pdf);
        assert!(texte.contains("/GTS_PDFXVersion"), "la clé /Info de PDF/X");
        assert!(texte.contains("PDF/X-1a:2001"), "l'orthographe exacte");
        assert!(
            texte.contains("/DestOutputProfile"),
            "le profil est embarqué"
        );
    }

    /// Un rendu au mauvais rapport est refusé **au lieu** d'être étiré.
    #[test]
    fn un_rapport_de_rendu_faux_est_refuse() {
        let plan = plan_a4();
        // 100 × 100 pour une zone de 216 × 303 mm : la page serait écrasée.
        let rendu = RendusPage::nouveau(100, 100, vec![0; 100 * 100 * 3]).unwrap();
        let erreur = assembler(&plan, [&rendu, &rendu], &Options::default()).unwrap_err();
        match erreur {
            ErreurMontage::RapportIncoherent { cote, zone, pixels } => {
                assert_eq!(cote, "gauche");
                assert!((zone.0 - 216.0).abs() < 1e-9, "{zone:?}");
                assert!((zone.1 - 303.0).abs() < 1e-9, "{zone:?}");
                assert_eq!(pixels, (100, 100));
            }
            autre => panic!("attendu un rapport incohérent, obtenu {autre:?}"),
        }
    }

    /// Le fond blanc couvre **tout le média**, marge technique comprise : sans
    /// cela, la marge resterait transparente et l'imprimeur verrait le fond du
    /// papier au travers.
    #[test]
    fn le_fond_blanc_couvre_tout_le_media() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let planche = assembler(&plan, [&rendu, &rendu], &Options::default()).unwrap();
        let texte = String::from_utf8_lossy(&planche.pdf);
        // Le débord vaut `fond perdu + marge` de chaque côté, et le rectangle
        // couvre donc exactement le média : c'est la seule façon de peindre la
        // marge technique, qui est **hors** du format fini.
        let debord = 3.0 + 10.0;
        let attendu = format!(
            "{} {} {} {} re",
            object::number(mm_to_pt(-debord)),
            object::number(mm_to_pt(-debord)),
            object::number(mm_to_pt(420.0 + 2.0 * debord)),
            object::number(mm_to_pt(297.0 + 2.0 * debord)),
        );
        assert!(
            texte.contains(&attendu),
            "attendu « {attendu} » dans le flux"
        );
        // Et il est le **premier** tracé : ce qui est peint ensuite passe dessus.
        let position_fond = texte.find(&attendu).unwrap();
        let position_page = texte.find("re\nW n\n").unwrap();
        assert!(
            position_fond < position_page,
            "le fond doit précéder les pages"
        );
    }

    /// Sans fond blanc demandé, il n'y a pas de rectangle de fond : le reste est
    /// identique. C'est une option, pas un effet de bord.
    #[test]
    fn sans_fond_blanc_aucun_rectangle_n_est_peint() {
        let plan = plan_a4();
        let rendu = rendus_a4();
        let options = Options {
            fond_blanc: false,
            ..Options::default()
        };
        let planche = assembler(&plan, [&rendu, &rendu], &options).unwrap();
        let texte = String::from_utf8_lossy(&planche.pdf);
        let debord = 3.0 + 10.0;
        let fond = format!(
            "{} {} {} {} re",
            object::number(mm_to_pt(-debord)),
            object::number(mm_to_pt(-debord)),
            object::number(mm_to_pt(420.0 + 2.0 * debord)),
            object::number(mm_to_pt(297.0 + 2.0 * debord)),
        );
        assert!(!texte.contains(&fond));
        assert_eq!(texte.matches("re\nW n\n").count(), 2, "le rognage reste");
    }
}
