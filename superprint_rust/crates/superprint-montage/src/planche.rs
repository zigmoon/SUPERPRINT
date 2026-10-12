//! **L'assemblage d'une planche** : poser, rogner, repérer, écrire.
//!
//! ## Ce que fait l'assemblage, dans l'ordre
//!
//! 1. le **format de la planche** vient du plan ([`Plan::format_fini_mm`]) : la
//!    zone couvrante des deux pages, gouttière comprise. C'est le format fini au
//!    sens PDF — ce que l'imprimeur découpe ;
//! 2. le **fond blanc**, si on le demande, couvre tout le média. C'est ce qui
//!    distingue « la zone de fond perdu est blanche » de « la zone de fond perdu
//!    est transparente », et à l'impression les deux ne se ressemblent pas ;
//! 3. chaque **page est posée** à la place que lui donne le plan, puis rognée à
//!    sa zone autorisée ([`superprint_impose::Pose::zone_mm`]) ;
//! 4. les **repères** sont ceux du plan — les mêmes seize traits dont
//!    `scripts/validate-imposition.mjs` a mesuré qu'ils coïncident, position par
//!    position, avec ceux du produit ;
//! 5. le **document** est écrit par [`Document::write`], avec son profil de
//!    sortie et sa déclaration de conformité s'il y en a une.
//!
//! ## Le rognage, et pourquoi c'est le PDF qui le porte
//!
//! Le produit rogne chaque objet avec un `clipPath` de Fabric, un objet à la
//! fois. Ici, le rognage est une opération **du flux PDF** (`q … re W n`) : il
//! est donc dans le fichier, contrairement au découpage que Fabric applique juste
//! avant de rasteriser. La conséquence est visible : un lecteur PDF qui relit
//! le fichier voit le rognage, et un contrôle peut donc le **vérifier** au lieu
//! de croire le programme sur parole.
//!
//! ## Ce que l'assemblage ne fait pas
//!
//! Il ne rasterise pas (le navigateur le fait), il ne réduit pas les images
//! (la qualité est choisie en amont), et il ne décide pas **où** vont les pages
//! (c'est le plan). Chacun de ces renoncements est une frontière nette, et
//! chacune est ce qui rend ce module vérifiable.

use superprint_core::color::{Cmyk, Reglages as ReglagesEncre, Rgb};
use superprint_core::PageSize;
use superprint_impose::{Cote, Plan};
use superprint_pdf::colorspace::{ColorStack, QuadriSpace};
use superprint_pdf::document::{
    ColorValue, DocError, DocInfo, Document, Op, OutputIntent, Page, Paint, Path,
};
use superprint_pdf::image::ImageFilter;
use superprint_pdf::xmp::Conformite;

use crate::rendu::{ModeCouleur, RendusPage};
use crate::ErreurMontage;

/// Écart relatif toléré entre le rapport du rendu et celui de la zone posée.
///
/// Il n'y a pas de raison qu'un appelant correct se trompe de plus de la
/// résolution d'un pixel (moins de 0,1 % pour une page A4 à 150 dpi) : 1 % est
/// donc large pour du bruit d'arrondi, et serré pour une vraie erreur — passer
/// le rendu de la mauvaise page, par exemple.
pub const TOLERANCE_RAPPORT: f64 = 0.01;

/// La sortie : destination ICC, et conformité revendiquée.
///
/// Les deux vont ensemble. Revendiquer une conformité sans `OutputIntent` est
/// refusé par le noyau ([`DocError::PdfxSansSortie`]) — un fichier qui se dit
/// PDF/X sans dire pour quelle condition d'impression ne veut rien dire.
#[derive(Clone, Debug, Default)]
pub struct Sortie {
    /// Octets du profil ICC, tels quels.
    pub icc: Vec<u8>,
    /// Composantes du profil (3 pour RVB, 4 pour CMJN).
    pub composantes: u8,
    /// Identifiant de la condition d'impression, p. ex. `FOGRA39`.
    pub identifiant: String,
    /// Description lisible.
    pub description: String,
    /// Conformité revendiquée, s'il y en a une.
    pub conformite: Option<Conformite>,
}

impl Sortie {
    /// Aucune destination de sortie : le PDF ne dira pas pour quelle condition
    /// d'impression il a été fait. C'est le défaut, et c'est ce qu'il faut
    /// déclarer pour un export d'écran.
    #[must_use]
    pub fn aucune() -> Self {
        Self::default()
    }

    /// La sortie décrite par ses composants, sans conformité revendiquée.
    #[must_use]
    pub fn nouvelle(icc: Vec<u8>, composantes: u8, identifiant: &str, description: &str) -> Self {
        Self {
            icc,
            composantes,
            identifiant: identifiant.to_string(),
            description: description.to_string(),
            conformite: None,
        }
    }

    /// La même sortie, avec une conformité revendiquée.
    #[must_use]
    pub fn revendiquant(mut self, conformite: Conformite) -> Self {
        self.conformite = Some(conformite);
        self
    }

    fn vers_intent(&self) -> Option<OutputIntent> {
        if self.icc.is_empty() {
            return None;
        }
        Some(OutputIntent {
            icc: self.icc.clone(),
            components: self.composantes,
            identifier: self.identifiant.clone(),
            info: self.description.clone(),
        })
    }
}

/// Tout ce que l'assemblage a besoin de savoir en plus du plan et des rendus.
#[derive(Clone, Debug)]
pub struct Options {
    /// Ce qu'on écrit dans la planche.
    pub mode: ModeCouleur,
    /// Réglages d'encrage de la conversion CMJN (GCR, limite d'encre).
    ///
    /// Ils n'ont d'effet qu'en mode CMJN, et c'est exactement le comportement du
    /// produit : `_spCmykConvert` reçoit ses options du même endroit que le mode.
    pub encre: ReglagesEncre,
    /// Faut-il peindre un fond blanc sur tout le média ?
    pub fond_blanc: bool,
    /// Filtre des images écrites.
    pub filtre: ImageFilter,
    /// Métadonnées du document.
    pub info: DocInfo,
    /// Destination de sortie et conformité.
    pub sortie: Sortie,
    /// Nom du producteur, écrit dans `/Producer` **et** dans le XMP.
    ///
    /// Il est reçu plutôt que codé en dur : c'est le seul champ dont la valeur
    /// dépend de qui appelle, et une constante ici serait un mensonge le jour où
    /// le module est employé ailleurs.
    pub producteur: String,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            mode: ModeCouleur::Rvb,
            encre: ReglagesEncre::default(),
            fond_blanc: true,
            filtre: ImageFilter::Auto,
            info: DocInfo::default(),
            sortie: Sortie::aucune(),
            producteur: "SuperPrint".to_string(),
        }
    }
}

/// Le résultat d'un assemblage, avec de quoi vérifier ce qui a été fait.
#[derive(Clone, Debug)]
pub struct Planche {
    /// Les octets du PDF.
    pub pdf: Vec<u8>,
    /// Le format fini de la planche, en millimètres.
    pub format_fini_mm: (f64, f64),
    /// Le média, en millimètres.
    pub media_mm: (f64, f64),
    /// La zone autorisée de chaque page, dans le repère du média.
    ///
    /// C'est ce qui a été rogné, tel que le PDF le porte : le contrôle peut le
    /// relire sur le fichier, mais l'avoir ici évite de le recalculer pour le
    /// comparer.
    pub zones_mm: [(f64, f64, f64, f64); 2],
    /// Nombre de repères écrits.
    pub reperes: usize,
}

/// Assemble la planche : deux rendus, un plan, et les options.
///
/// # Erreurs
///
/// - [`ErreurMontage::TamponIncoherent`] : un rendu n'a pas la taille annoncée ;
/// - [`ErreurMontage::RapportIncoherent`] : le rapport du rendu ne correspond pas
///   à la zone qu'il doit couvrir — la page serait étirée ;
/// - [`ErreurMontage::Ecriture`] : le document PDF a été refusé (conformité
///   revendiquée incompatible avec le contenu, profil ICC incohérent…).
pub fn assembler(
    plan: &Plan,
    rendus: [&RendusPage; 2],
    options: &Options,
) -> Result<Planche, ErreurMontage> {
    let (_, _, largeur_finie, hauteur_finie) = plan.format_fini_mm();
    let fond_perdu = plan.reglages.fond_perdu_effectif_mm();
    let marge = plan.reglages.marge_effective_mm();

    let stack = match options.mode {
        ModeCouleur::Cmjn => ColorStack::new(QuadriSpace::Cmyk),
        ModeCouleur::Rvb | ModeCouleur::NiveauxDeGris => ColorStack::new(QuadriSpace::Rgb),
    };

    let mut page = Page::new(
        PageSize::new(largeur_finie, hauteur_finie),
        fond_perdu,
        marge,
        stack,
    );

    if options.fond_blanc {
        // Le média déborde du format fini de `fond perdu + marge` de chaque côté.
        // Le rectangle est exprimé dans le repère du format fini, donc négatif
        // du côté bas-gauche : c'est exact, et c'est le seul moyen de peindre
        // sous toute la surface, y compris la marge technique.
        let debord = fond_perdu + marge;
        page.push(Op::Fill {
            path: Path::Rect {
                x: -debord,
                y: -debord,
                width: largeur_finie + 2.0 * debord,
                height: hauteur_finie + 2.0 * debord,
            },
            paint: Paint::Quadri(blanc(options.mode)),
        });
    }

    let mut document = Document::new();
    // Les repères du document ne sont pas ceux du noyau PDF : le plan en donne
    // seize (douze autour des deux pages, quatre à la couture en découpe page à
    // page), là où `crop_marks` n'en connaît que huit pour une page seule.
    document.marks = false;
    document.info = options.info.clone();
    if options.producteur.trim().is_empty() {
        document.info.producer = None;
    } else {
        document.info.producer = Some(options.producteur.clone());
    }
    document.output_intent = options.sortie.vers_intent();
    document.pdfx = options.sortie.conformite;

    let mut zones = [(0.0, 0.0, 0.0, 0.0); 2];
    for (rang, cote) in [Cote::Gauche, Cote::Droite].into_iter().enumerate() {
        let place = &plan.places[rang];
        let pose = place.pose(&plan.reglages, cote);
        let rendu = rendus[rang];

        // Le rapport : la zone posée fait `largeur × hauteur`, le rendu fait
        // `largeur_px × hauteur_px`. Si les deux rapports diffèrent, l'image sera
        // étirée — un défaut qui ne se voit pas sur un aperçu écran et qui se
        // voit sur le papier.
        let attendu = place.largeur_mm / place.hauteur_mm;
        let obtenu = rendu.rapport_px();
        if attendu > 0.0 && ((obtenu - attendu) / attendu).abs() > TOLERANCE_RAPPORT {
            return Err(ErreurMontage::RapportIncoherent {
                cote: cote.nom(),
                zone: (place.largeur_mm, place.hauteur_mm),
                pixels: (rendu.largeur_px(), rendu.hauteur_px()),
            });
        }

        let rang_image =
            document.add_image(rendu.encoder(options.mode, options.encre, options.filtre));

        // Le coin HAUT-gauche de la zone chargée, dans le repère du média ; le
        // PDF veut le coin BAS-gauche dans le repère du format fini.
        let (x, y_bas) = plan.vers_format_fini(place.x_mm, place.y_mm + place.hauteur_mm);
        // Le rognage : la zone autorisée, du coin bas-gauche au coin haut-droit.
        let (cx, cy) = plan.vers_format_fini(pose.zone_mm.0, pose.zone_mm.3);
        zones[rang] = pose.zone_mm;

        page.push(Op::Clip {
            x: cx,
            y: cy,
            width: pose.largeur_zone_mm(),
            height: pose.hauteur_zone_mm(),
        });
        page.push(Op::Image {
            image: rang_image,
            x,
            y: y_bas,
            width: place.largeur_mm,
            height: place.hauteur_mm,
        });
        page.push(Op::EndClip);
    }

    let noir = noir(options.mode);
    for repere in &plan.reperes {
        let (x1, y1) = plan.vers_format_fini(repere.x1, repere.y1);
        let (x2, y2) = plan.vers_format_fini(repere.x2, repere.y2);
        page.push(Op::Stroke {
            path: Path::Line { x1, y1, x2, y2 },
            paint: Paint::Quadri(noir),
            width_mm: repere.epaisseur_mm,
        });
    }

    let reperes = plan.reperes.len();
    let boxes = page.boxes();
    document.add_page(page);

    let mm = 25.4 / 72.0;
    let media_mm = (boxes.media.width() * mm, boxes.media.height() * mm);
    let pdf = document.write().map_err(ErreurMontage::Ecriture)?;

    Ok(Planche {
        pdf,
        format_fini_mm: (largeur_finie, hauteur_finie),
        media_mm,
        zones_mm: zones,
        reperes,
    })
}

/// Le blanc, dans la quadri de la page.
fn blanc(mode: ModeCouleur) -> ColorValue {
    match mode {
        ModeCouleur::Cmjn => ColorValue::Cmyk(Cmyk {
            c: 0.0,
            m: 0.0,
            y: 0.0,
            k: 0.0,
        }),
        ModeCouleur::Rvb | ModeCouleur::NiveauxDeGris => ColorValue::Rgb(Rgb::new(255, 255, 255)),
    }
}

/// Le noir **d'encre pleine**, dans la quadri de la page.
///
/// En CMJN, c'est du noir seul à 100 % : un repère composé de quatre encres
/// serait flou au tirage, et un repère de contrôle doit être net sur toutes les
/// plaques — ici, seule celle du noir en portera.
fn noir(mode: ModeCouleur) -> ColorValue {
    match mode {
        ModeCouleur::Cmjn => ColorValue::Cmyk(Cmyk {
            c: 0.0,
            m: 0.0,
            y: 0.0,
            k: 1.0,
        }),
        ModeCouleur::Rvb | ModeCouleur::NiveauxDeGris => ColorValue::Rgb(Rgb::new(0, 0, 0)),
    }
}

/// Traduit une erreur d'écriture PDF en erreur de montage.
impl From<DocError> for ErreurMontage {
    fn from(erreur: DocError) -> Self {
        Self::Ecriture(erreur)
    }
}
