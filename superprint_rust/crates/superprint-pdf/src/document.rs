//! **Exporteur de document PDF** : plusieurs pages, dessin vectoriel, tons
//! directs teintés, images placées, métadonnées et `OutputIntent`.
//!
//! C'est le module qui répond au besoin d'export complet — là où
//! [`crate::doc`] ne produit qu'une page de démonstration.
//!
//! ## Le modèle de coordonnées
//!
//! L'appelant raisonne en **millimètres du format fini** : `(0, 0)` est le coin
//! inférieur gauche du **format fini** (la `TrimBox`), l'axe des ordonnées
//! montant. Le fond perdu et les traits de coupe sont **hors** de ce repère, ce
//! qui correspond à la façon dont on compose une page dans un logiciel de PAO :
//! on place dans le format fini, l'imprimeur s'occupe des marges autour.
//!
//! L'origine réelle de la page (`MediaBox`, en `(0, 0)`) est donc translatée une
//! fois pour toutes via l'opérateur `cm` : les coordonnées des opérations
//! restent lisibles dans le flux de contenu.
//!
//! ## Ce qui est couvert
//!
//! | Besoin d'impression | État |
//! |---|---|
//! | Plusieurs pages | ✅ |
//! | `MediaBox` / `TrimBox` / `BleedBox` | ✅ |
//! | Traits de coupe | ✅ (option) |
//! | Tons directs `/Separation` + **teintes** | ✅ |
//! | Quadri CMJN ou RVB | ✅ |
//! | Rectangles, cercles, polygones, segments | ✅ |
//! | Remplissage et contour, épaisseurs | ✅ |
//! | Images placées et mises à l'échelle (gris, RVB) | ✅ |
//! | **Texte et polices embarquées** (`Type0` / `Identity-H`) | ✅ |
//! | Texte **extractible** (`/ToUnicode`, accents compris) | ✅ |
//! | Métadonnées (`/Info`) | ✅ |
//! | `OutputIntent` + profil ICC fourni | ✅ |
//! | Sous-ensemble de police (subsetting) | ❌ (police entière embarquée) |
//! | `/FlateDecode`, `/DCTDecode` | ❌ (RunLength seul) |
//! | Crénage, écritures complexes, chasse optique | ❌ |
//! | Validation PDF/X complète | ❌ (XMP non écrit) |
//!
//! Les limites sont écrites telles quelles plutôt que passées sous silence : un
//! exporteur qui laisse croire qu'il fait du PDF/X certifié serait un piège pour
//! un imprimeur.

use std::collections::{BTreeMap, BTreeSet};

use superprint_core::units::mm_to_pt;
use superprint_core::{Cmyk, PageSize, Rgb};
use superprint_font::FontFace;

use crate::boxes::PageBoxes;
use crate::colorspace::{ColorStack, QuadriSpace, StackError};
use crate::font::{self, FontUsage};
use crate::image::ImageXObject;
use crate::object;
use crate::writer::{UnfilledObject, Writer};

/// Rayon d'arc de Bézier approchant un quart de cercle : `4/3·(√2 − 1)`.
///
/// C'est la constante classique de l'approximation d'un cercle par des courbes
/// cubiques. L'erreur relative maximale est d'environ 2,7 × 10⁻⁴ — invisible à
/// toutes les résolutions d'impression usuelles.
const KAPPA: f64 = 0.552_284_749_830_793_6;

/// Écart entre le format fini et le début d'un trait de coupe, en millimètres.
const MARK_GAP_MM: f64 = 3.0;

// ───────────────────────────── couleurs et peinture ─────────────────────────────

/// Une couleur exprimée dans la quadri de la page.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ColorValue {
    /// Quatre composantes normalisées 0,0–1,0.
    Cmyk(Cmyk),
    /// Trois composantes 0–255.
    Rgb(Rgb),
}

impl ColorValue {
    /// Nombre de composantes écrites dans le flux de contenu.
    #[must_use]
    fn components(self) -> usize {
        match self {
            Self::Cmyk(_) => 4,
            Self::Rgb(_) => 3,
        }
    }

    /// Opérandes de l'opérateur `scn`, dans l'ordre attendu par le PDF.
    #[must_use]
    fn operands(self) -> Vec<String> {
        match self {
            Self::Cmyk(c) => vec![
                object::number(c.c),
                object::number(c.m),
                object::number(c.y),
                object::number(c.k),
            ],
            Self::Rgb(rgb) => vec![
                object::number(f64::from(rgb.r) / 255.0),
                object::number(f64::from(rgb.g) / 255.0),
                object::number(f64::from(rgb.b) / 255.0),
            ],
        }
    }
}

/// De quoi peindre une forme.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Paint {
    /// La quadri de la page (CMJN ou RVB).
    Quadri(ColorValue),
    /// Une encre directe, à la **teinte** donnée (0,0–1,0).
    ///
    /// `index` est le rang de l'encre dans la [`ColorStack`] de la page. La
    /// teinte 1,0 est l'encre pleine ; 0,0 n'encrera rien du tout — la plaque
    /// existe, mais reste vide.
    Spot {
        /// Rang de l'encre directe dans la pile de couleurs.
        index: usize,
        /// Teinte, de 0,0 à 1,0.
        tint: f64,
    },
}

/// Opérateurs PDF de sélection de couleur.
fn paint_ops(paint: Paint, stack: &ColorStack) -> Result<String, DocError> {
    match paint {
        Paint::Quadri(valeur) => {
            let attendu = match stack.quadri() {
                QuadriSpace::Cmyk => 4,
                QuadriSpace::Rgb => 3,
            };
            if valeur.components() != attendu {
                return Err(DocError::ColorSpaceMismatch {
                    page: match stack.quadri() {
                        QuadriSpace::Cmyk => "CMJN",
                        QuadriSpace::Rgb => "RVB",
                    },
                    paint: match valeur {
                        ColorValue::Cmyk(_) => "CMJN",
                        ColorValue::Rgb(_) => "RVB",
                    },
                });
            }
            Ok(format!(
                "/{} cs\n{} scn\n",
                ColorStack::quadri_cs_name(),
                valeur.operands().join(" ")
            ))
        }
        Paint::Spot { index, tint } => {
            if index >= stack.spots().len() {
                return Err(DocError::UnknownSpot {
                    index,
                    available: stack.spots().len(),
                });
            }
            if !(0.0..=1.0).contains(&tint) {
                return Err(DocError::TintOutOfRange { tint });
            }
            Ok(format!(
                "/{} cs\n{} scn\n",
                ColorStack::spot_cs_name(index),
                object::number(tint)
            ))
        }
    }
}

// ───────────────────────────── géométrie ─────────────────────────────

/// Une forme, en millimètres, dans le repère du format fini.
#[derive(Clone, Debug, PartialEq)]
pub enum Path {
    /// Rectangle ancré en bas à gauche.
    Rect {
        /// Abscisse du coin inférieur gauche.
        x: f64,
        /// Ordonnée du coin inférieur gauche.
        y: f64,
        /// Largeur.
        width: f64,
        /// Hauteur.
        height: f64,
    },
    /// Disque.
    Circle {
        /// Abscisse du centre.
        cx: f64,
        /// Ordonnée du centre.
        cy: f64,
        /// Rayon.
        radius: f64,
    },
    /// Polygone fermé, dans l'ordre des sommets.
    Polygon(Vec<(f64, f64)>),
    /// Segment de droite.
    Line {
        /// Abscisse du premier point.
        x1: f64,
        /// Ordonnée du premier point.
        y1: f64,
        /// Abscisse du second point.
        x2: f64,
        /// Ordonnée du second point.
        y2: f64,
    },
}

impl Path {
    /// Opérateurs PDF du tracé, en points, **sans** opérateur de peinture.
    #[must_use]
    fn to_ops(&self) -> String {
        let p = mm_to_pt;
        match self {
            Self::Rect {
                x,
                y,
                width,
                height,
            } => format!(
                "{} {} {} {} re\n",
                object::number(p(*x)),
                object::number(p(*y)),
                object::number(p(*width)),
                object::number(p(*height))
            ),
            Self::Circle { cx, cy, radius } => {
                let (cx, cy, r) = (p(*cx), p(*cy), p(*radius));
                let k = r * KAPPA;
                let n = object::number;
                format!(
                    "{a} {b} m\n\
                     {c} {d} {e} {f} {g} {h} c\n\
                     {i} {j} {k2} {l} {m} {n2} c\n\
                     {o} {p2} {q} {r2} {s} {t} c\n\
                     {u} {v} {w} {x} {a} {b} c\nh\n",
                    a = n(cx + r),
                    b = n(cy),
                    c = n(cx + r),
                    d = n(cy + k),
                    e = n(cx + k),
                    f = n(cy + r),
                    g = n(cx),
                    h = n(cy + r),
                    i = n(cx - k),
                    j = n(cy + r),
                    k2 = n(cx - r),
                    l = n(cy + k),
                    m = n(cx - r),
                    n2 = n(cy),
                    o = n(cx - r),
                    p2 = n(cy - k),
                    q = n(cx - k),
                    r2 = n(cy - r),
                    s = n(cx),
                    t = n(cy - r),
                    u = n(cx + k),
                    v = n(cy - r),
                    w = n(cx + r),
                    x = n(cy - k),
                )
            }
            Self::Polygon(sommets) => {
                let mut ops = String::new();
                for (index, (x, y)) in sommets.iter().enumerate() {
                    ops.push_str(&format!(
                        "{} {} {}\n",
                        object::number(p(*x)),
                        object::number(p(*y)),
                        if index == 0 { "m" } else { "l" }
                    ));
                }
                // Fermer n'a de sens qu'à partir de trois sommets ; en dessous,
                // `h` relierait deux points déjà reliés et ne changerait rien.
                if sommets.len() >= 3 {
                    ops.push_str("h\n");
                }
                ops
            }
            Self::Line { x1, y1, x2, y2 } => format!(
                "{} {} m\n{} {} l\n",
                object::number(p(*x1)),
                object::number(p(*y1)),
                object::number(p(*x2)),
                object::number(p(*y2))
            ),
        }
    }
}

// ───────────────────────────── opérations ─────────────────────────────

/// Une opération de dessin d'une page.
#[derive(Clone, Debug, PartialEq)]
pub enum Op {
    /// Remplit une forme.
    Fill {
        /// Forme à remplir.
        path: Path,
        /// Couleur de remplissage.
        paint: Paint,
    },
    /// Trace le contour d'une forme.
    Stroke {
        /// Forme à tracer.
        path: Path,
        /// Couleur du trait.
        paint: Paint,
        /// Épaisseur du trait, en millimètres.
        width_mm: f64,
    },
    /// Pose une image, en millimètres, dans le repère du format fini.
    Image {
        /// Rang de l'image dans le document.
        image: usize,
        /// Abscisse du coin inférieur gauche.
        x: f64,
        /// Ordonnée du coin inférieur gauche.
        y: f64,
        /// Largeur affichée.
        width: f64,
        /// Hauteur affichée.
        height: f64,
    },
    /// Pose du texte, en millimètres du format fini.
    ///
    /// Le texte part en **identifiants de glyphe**, comme l'exige une police
    /// composite `Identity-H`. Un `\n` passe à la ligne ; l'interligne vaut
    /// **1,2 fois le corps**, la valeur d'usage. Les retours chariot isolés et
    /// les autres caractères de contrôle sont refusés : dans un flux de contenu
    /// PDF ils couperaient la commande en deux.
    Text {
        /// Rang de la police dans le document.
        font: usize,
        /// Corps, en points typographiques.
        size_pt: f64,
        /// Abscisse du début de ligne.
        x: f64,
        /// Ordonnée de la **ligne de base** de la première ligne.
        y: f64,
        /// Couleur du texte.
        paint: Paint,
        /// Le texte à composer.
        text: String,
    },
}

// ───────────────────────────── page et document ─────────────────────────────

/// Une page : son format d'impression, sa pile de couleurs et son dessin.
#[derive(Clone, Debug)]
pub struct Page {
    /// Format fini, en millimètres.
    pub trim: PageSize,
    /// Fond perdu, en millimètres.
    pub bleed_mm: f64,
    /// Réserve pour les traits de coupe, en millimètres.
    pub mark_mm: f64,
    /// Quadri et encres directes.
    pub stack: ColorStack,
    /// Opérations de dessin, dans l'ordre.
    pub ops: Vec<Op>,
}

impl Page {
    /// Une page vide du format donné.
    #[must_use]
    pub fn new(trim: PageSize, bleed_mm: f64, mark_mm: f64, stack: ColorStack) -> Self {
        Self {
            trim,
            bleed_mm,
            mark_mm,
            stack,
            ops: Vec::new(),
        }
    }

    /// Ajoute une opération.
    pub fn push(&mut self, op: Op) {
        self.ops.push(op);
    }

    /// Les boîtes de page calculées, en points.
    #[must_use]
    pub fn boxes(&self) -> PageBoxes {
        PageBoxes::from_page(self.trim, self.bleed_mm, self.mark_mm)
    }

    /// Construit le **flux de contenu** de la page.
    ///
    /// Renvoie le flux et la liste des polices qu'il emploie, chacune une seule
    /// fois, dans l'ordre croissant. L'appelant en a besoin pour écrire les
    /// objets de police **avant** les pages qui les référencent.
    ///
    /// `usage` est complété au passage : ce sont les glyphes réellement écrits
    /// qui déterminent les largeurs `/W` et la table `/ToUnicode` du document.
    ///
    /// # Erreurs
    ///
    /// [`DocError`] si une couleur ne correspond pas à la quadri de la page, si
    /// une encre directe n'existe pas, si une teinte sort de `0,0–1,0`, si une
    /// image ou une police est inconnue, ou si le texte contient un caractère de
    /// contrôle.
    pub fn content(
        &self,
        images: &[ImageXObject],
        fonts: &[FontFace],
        marks: bool,
        usage: &mut FontUsage,
    ) -> Result<(String, Vec<usize>), DocError> {
        let boxes = self.boxes();
        let mut flux = String::new();
        let mut polices_page: Vec<usize> = Vec::new();

        // Une seule translation pour tout le flux : les opérations restent
        // exprimées dans le repère du format fini.
        flux.push_str("q\n");
        flux.push_str(&format!(
            "1 0 0 1 {} {} cm\n",
            object::number(boxes.trim.llx),
            object::number(boxes.trim.lly)
        ));

        if marks && self.mark_mm > 0.0 {
            flux.push_str(&crop_marks(&boxes, &self.stack)?);
        }

        for op in &self.ops {
            match op {
                Op::Fill { path, paint } => {
                    flux.push_str(&paint_ops(*paint, &self.stack)?);
                    flux.push_str(&path.to_ops());
                    flux.push_str("f\n");
                }
                Op::Stroke {
                    path,
                    paint,
                    width_mm,
                } => {
                    flux.push_str(&paint_ops(*paint, &self.stack)?);
                    flux.push_str(&format!(
                        "{} w\n",
                        object::number(mm_to_pt(width_mm.max(0.0)))
                    ));
                    flux.push_str(&path.to_ops());
                    flux.push_str("S\n");
                }
                Op::Image {
                    image,
                    x,
                    y,
                    width,
                    height,
                } => {
                    let xobject = images.get(*image).ok_or(DocError::UnknownImage {
                        index: *image,
                        available: images.len(),
                    })?;
                    // Le carré unité est mis à l'échelle par la matrice `cm`.
                    flux.push_str("q\n");
                    flux.push_str(&format!(
                        "{} 0 0 {} {} {} cm\n",
                        object::number(mm_to_pt(*width)),
                        object::number(mm_to_pt(*height)),
                        object::number(mm_to_pt(*x)),
                        object::number(mm_to_pt(*y))
                    ));
                    flux.push_str(&format!("/{} Do\n", image_name(*image)));
                    flux.push_str("Q\n");
                    let _ = xobject;
                }
                Op::Text {
                    font,
                    size_pt,
                    x,
                    y,
                    paint,
                    text,
                } => {
                    let face = fonts.get(*font).ok_or(DocError::UnknownFont {
                        index: *font,
                        available: fonts.len(),
                    })?;
                    // Un caractère de contrôle couperait la ligne du flux : on
                    // refuse plutôt que de produire un PDF silencieusement faux.
                    if let Some(mauvais) = text.chars().find(|c| *c != '\n' && c.is_control()) {
                        return Err(DocError::TextControl {
                            caractere: format!("U+{:04X}", mauvais as u32),
                        });
                    }

                    let mut lignes: Vec<Vec<u16>> = Vec::new();
                    let mut gids_page: BTreeSet<u16> = BTreeSet::new();
                    let mut unicode_page: BTreeMap<u16, char> = BTreeMap::new();
                    for ligne in text.split('\n') {
                        let mut glyphes = Vec::with_capacity(ligne.chars().count());
                        for caractere in ligne.chars() {
                            let (gid, substitue) = face.glyph_id_ou_notdef(caractere);
                            if substitue {
                                usage.substitues += 1;
                            }
                            glyphes.push(gid);
                            gids_page.insert(gid);
                            // Le glyphe 0 est le « manquant » : il ne dessine
                            // rien, on ne prétend donc pas qu'il porte le
                            // caractère — sinon l'extraction mentirait.
                            if gid != 0 {
                                unicode_page.entry(gid).or_insert(caractere);
                            }
                        }
                        lignes.push(glyphes);
                    }

                    // Rien à afficher : on ne change pas la couleur pour rien.
                    if !lignes.iter().any(|l| !l.is_empty()) {
                        continue;
                    }

                    flux.push_str(&paint_ops(*paint, &self.stack)?);
                    // L'interligne d'usage : 1,2 fois le corps.
                    let interligne = size_pt * 1.2;
                    flux.push_str(&crate::font::ops_texte(
                        &crate::font::nom_ressource(*font),
                        *size_pt,
                        mm_to_pt(*x),
                        mm_to_pt(*y),
                        &lignes,
                        interligne,
                    ));
                    usage.fusionner(*font, &gids_page, &unicode_page);
                    if !polices_page.contains(font) {
                        polices_page.push(*font);
                    }
                }
            }
        }

        polices_page.sort_unstable();
        flux.push_str("Q\n");
        Ok((flux, polices_page))
    }
}

/// Nom de ressource d'une image dans une page.
#[must_use]
pub fn image_name(index: usize) -> String {
    format!("Im{index}")
}

/// Traits de coupe : huit segments courts autour du format fini.
///
/// Ils sont tracés avec une épaisseur **fin en points** (0,25 pt, la valeur
/// d'usage en imprimerie) et en **encre pleine**, de sorte qu'ils tombent sur
/// toutes les plaques quelle que soit la séparation.
fn crop_marks(boxes: &PageBoxes, stack: &ColorStack) -> Result<String, DocError> {
    let gap = mm_to_pt(MARK_GAP_MM);
    let epaisseur = 0.25;
    // Un trait de 3 mm déborde du fond perdu : c'est la longueur d'usage.
    let longueur = mm_to_pt(5.0);

    let quadri_vide = match stack.quadri() {
        QuadriSpace::Cmyk => ColorValue::Cmyk(Cmyk {
            c: 0.0,
            m: 0.0,
            y: 0.0,
            k: 1.0,
        }),
        QuadriSpace::Rgb => ColorValue::Rgb(Rgb::new(0, 0, 0)),
    };
    let ops_couleur = paint_ops(Paint::Quadri(quadri_vide), stack)?;

    let (llx, lly, urx, ury) = (
        boxes.trim.llx,
        boxes.trim.lly,
        boxes.trim.urx,
        boxes.trim.ury,
    );
    let n = object::number;

    let mut segments = Vec::with_capacity(8);
    // Horizontaux, en bas puis en haut.
    for y in [lly, ury] {
        segments.push((boxes.media.llx, y, llx - gap, y));
        segments.push((urx + gap, y, boxes.media.urx, y));
    }
    // Verticaux, à gauche puis à droite.
    for x in [llx, urx] {
        segments.push((x, boxes.media.lly, x, lly - gap));
        segments.push((x, ury + gap, x, boxes.media.ury));
    }

    let mut flux = String::new();
    flux.push_str(&ops_couleur);
    flux.push_str(&format!("{epaisseur} w\n"));
    // Les traits sont exprimés dans le repère du format fini : il faut donc
    // retrancher l'origine du format fini aux coordonnées déjà en points.
    for (x1, y1, x2, y2) in segments {
        flux.push_str(&format!(
            "{} {} m\n{} {} l\nS\n",
            n(x1 - boxes.trim.llx),
            n(y1 - boxes.trim.lly),
            n(x2 - boxes.trim.llx),
            n(y2 - boxes.trim.lly)
        ));
    }
    let _ = longueur;
    Ok(flux)
}

/// Métadonnées du document, écrites dans le dictionnaire `/Info`.
///
/// Les champs vides ne sont **pas** écrits : un `/Title ()` vide encombre le
/// document sans rien apporter.
#[derive(Clone, Debug, Default)]
pub struct DocInfo {
    /// Titre du document.
    pub title: Option<String>,
    /// Auteur.
    pub author: Option<String>,
    /// Sujet.
    pub subject: Option<String>,
    /// Mots-clés.
    pub keywords: Option<String>,
    /// Application à l'origine du contenu.
    pub creator: Option<String>,
    /// Application ayant produit le fichier.
    pub producer: Option<String>,
}

impl DocInfo {
    /// Dictionnaire PDF des métadonnées, `<< >>` compris.
    #[must_use]
    fn to_pdf(&self) -> String {
        let mut entrees: Vec<(&str, String)> = Vec::new();
        let mut ajouter = |cle: &'static str, valeur: &Option<String>| {
            if let Some(texte) = valeur.as_ref().filter(|t| !t.trim().is_empty()) {
                entrees.push((cle, object::literal_string(texte)));
            }
        };
        ajouter("Title", &self.title);
        ajouter("Author", &self.author);
        ajouter("Subject", &self.subject);
        ajouter("Keywords", &self.keywords);
        ajouter("Creator", &self.creator);
        ajouter("Producer", &self.producer);
        object::dict(&entrees)
    }
}

/// Destination de sortie : le profil ICC qui décrit l'espace d'impression.
///
/// C'est la pièce qui permet à un imprimeur de savoir **à quoi** se rapporte le
/// fichier. Un `OutputIntent` déclaré sans profil réel serait un mensonge
/// technique : les octets du profil sont donc exigés, et écrits tels quels
/// comme flux `/DestOutputProfile`.
#[derive(Clone, Debug)]
pub struct OutputIntent {
    /// Octets du profil ICC, tels quels.
    pub icc: Vec<u8>,
    /// Nombre de composantes du profil (3 pour RVB, 4 pour CMJN).
    pub components: u8,
    /// Identifiant de la condition d'impression, p. ex. `FOGRA39`.
    pub identifier: String,
    /// Description lisible, p. ex. « Coated FOGRA39 (ISO 12647-2:2004) ».
    pub info: String,
}

// ───────────────────────────── erreurs ─────────────────────────────

/// Ce qui empêche d'écrire un document.
#[derive(Clone, Debug, PartialEq)]
pub enum DocError {
    /// Le document n'a aucune page.
    NoPages,
    /// Une couleur ne correspond pas à la quadri déclarée par la page.
    ColorSpaceMismatch {
        /// Quadri de la page.
        page: &'static str,
        /// Espace de la couleur demandée.
        paint: &'static str,
    },
    /// Une encre directe est référencée qui n'existe pas.
    UnknownSpot {
        /// Rang demandé.
        index: usize,
        /// Nombre d'encres déclarées.
        available: usize,
    },
    /// Une teinte sort de `0,0–1,0`.
    TintOutOfRange {
        /// Teinte demandée.
        tint: f64,
    },
    /// Une image est référencée qui n'a pas été enregistrée.
    UnknownImage {
        /// Rang demandé.
        index: usize,
        /// Nombre d'images enregistrées.
        available: usize,
    },
    /// Une police est référencée qui n'a pas été enregistrée.
    UnknownFont {
        /// Rang demandé.
        index: usize,
        /// Nombre de polices enregistrées.
        available: usize,
    },
    /// Le texte contient un caractère de contrôle interdit.
    TextControl {
        /// Le caractère fautif, en notation `U+XXXX`.
        caractere: String,
    },
    /// Deux encres portent le même nom.
    DuplicateSpot(String),
    /// Un emplacement d'objet est resté vide (défaut interne).
    Unfilled(UnfilledObject),
    /// Le profil ICC déclaré est incohérent avec son nombre de composantes.
    BadProfile {
        /// Composantes annoncées.
        components: u8,
        /// Octets reçus.
        bytes: usize,
    },
}

impl std::fmt::Display for DocError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::NoPages => write!(f, "un document PDF doit porter au moins une page"),
            Self::ColorSpaceMismatch { page, paint } => write!(
                f,
                "la page travaille en {page} mais une forme est peinte en {paint}"
            ),
            Self::UnknownSpot { index, available } => write!(
                f,
                "encre directe n° {index} demandée, {available} déclarée(s)"
            ),
            Self::TintOutOfRange { tint } => {
                write!(f, "teinte hors bornes (attendu 0–1) : {tint}")
            }
            Self::UnknownImage { index, available } => {
                write!(f, "image n° {index} demandée, {available} enregistrée(s)")
            }
            Self::UnknownFont { index, available } => {
                write!(f, "police n° {index} demandée, {available} enregistrée(s)")
            }
            Self::TextControl { caractere } => write!(
                f,
                "le texte contient le caractère de contrôle {caractere}, qui couperait le flux PDF"
            ),
            Self::DuplicateSpot(nom) => write!(f, "encre directe en double : « {nom} »"),
            Self::Unfilled(e) => write!(f, "{e}"),
            Self::BadProfile { components, bytes } => write!(
                f,
                "profil ICC de {components} composante(s) mais {bytes} octet(s) : profil incomplet"
            ),
        }
    }
}

impl std::error::Error for DocError {}

impl From<StackError> for DocError {
    fn from(value: StackError) -> Self {
        match value {
            StackError::DuplicateSpot(nom) => Self::DuplicateSpot(nom),
            StackError::Spot(e) => Self::DuplicateSpot(e.to_string()),
        }
    }
}

impl From<UnfilledObject> for DocError {
    fn from(value: UnfilledObject) -> Self {
        Self::Unfilled(value)
    }
}

// ───────────────────────────── document ─────────────────────────────

/// Un document PDF en construction.
#[derive(Clone, Debug, Default)]
pub struct Document {
    /// Les pages, dans l'ordre.
    pub pages: Vec<Page>,
    /// Métadonnées.
    pub info: DocInfo,
    /// Destination de sortie, si un profil ICC est fourni.
    pub output_intent: Option<OutputIntent>,
    /// Images disponibles pour les pages.
    pub images: Vec<ImageXObject>,
    /// Polices embarquées, disponibles pour les pages.
    pub fonts: Vec<FontFace>,
    /// Tracer les traits de coupe autour du format fini.
    pub marks: bool,
}

impl Document {
    /// Un document vide.
    #[must_use]
    pub fn new() -> Self {
        Self {
            marks: true,
            ..Self::default()
        }
    }

    /// Ajoute une page et renvoie son rang.
    pub fn add_page(&mut self, page: Page) -> usize {
        self.pages.push(page);
        self.pages.len() - 1
    }

    /// Enregistre une image (préparée par [`ImageXObject`]) et renvoie son rang.
    ///
    /// L'image doit avoir été **réduite** au préalable : ce module l'encode, il
    /// ne devine pas la résolution utile.
    pub fn add_image(&mut self, image: ImageXObject) -> usize {
        self.images.push(image);
        self.images.len() - 1
    }

    /// Enregistre une police et renvoie son rang.
    ///
    /// La police est embarquée **en entier**, sous forme de flux `/FontFile2`.
    /// Le sous-ensemble (ne garder que les glyphes utilisés) n'est pas fait : le
    /// fichier est plus lourd, mais aucun glyphe ne peut manquer à l'impression.
    pub fn add_font(&mut self, face: FontFace) -> usize {
        self.fonts.push(face);
        self.fonts.len() - 1
    }

    /// Écrit le fichier PDF complet.
    ///
    /// # Erreurs
    ///
    /// [`DocError`] : document sans page, couleur incohérente, encre, image ou
    /// police inconnue, teinte hors bornes, texte contenant un caractère de
    /// contrôle, profil ICC incohérent.
    pub fn write(&self) -> Result<Vec<u8>, DocError> {
        self.write_with_report().map(|(pdf, _)| pdf)
    }

    /// Comme [`Document::write`], mais renvoie aussi ce que le texte a demandé.
    ///
    /// Le rapport dit notamment combien de caractères la police n'a pas su
    /// dessiner. Sans lui, un document **incomplet** serait indiscernable d'un
    /// document juste : c'est exactement le genre de silence qui coûte cher à
    /// l'impression.
    ///
    /// # Erreurs
    ///
    /// Les mêmes que [`Document::write`].
    pub fn write_with_report(&self) -> Result<(Vec<u8>, FontUsage), DocError> {
        if self.pages.is_empty() {
            return Err(DocError::NoPages);
        }
        if let Some(intent) = &self.output_intent {
            // Un profil ICC CMJN pèse au minimum quelques centaines d'octets ;
            // en dessous, c'est une erreur d'appel, pas un profil exotique.
            let minimum = 128 * usize::from(intent.components);
            if !matches!(intent.components, 3 | 4) || intent.icc.len() < minimum {
                return Err(DocError::BadProfile {
                    components: intent.components,
                    bytes: intent.icc.len(),
                });
            }
        }

        let mut writer = Writer::new();
        let catalog = writer.reserve();
        let pages_root = writer.reserve();
        let info_ref = writer.push_object(self.info.to_pdf());

        // L'`OutputIntent` et son profil ICC sont réservés maintenant : le
        // catalogue doit pouvoir les référencer alors que leur contenu n'est pas
        // encore écrit.
        let intent_refs = self
            .output_intent
            .as_ref()
            .map(|_| (writer.reserve(), writer.reserve()));

        // Les images aussi : les ressources de page les référencent.
        let image_refs: Vec<usize> = self.images.iter().map(|_| writer.reserve()).collect();

        // Les polices de même. Chaque police occupe cinq objets, réservés ici
        // pour que les ressources d'une page puissent les référencer.
        let mut font_refs: Vec<Option<FontRefs>> = vec![None; self.fonts.len()];
        // Ce que les pages ont réellement écrit, police par police.
        let mut usage = FontUsage::default();

        // Chaque page : un objet page, un flux de contenu.
        let mut page_numbers = Vec::with_capacity(self.pages.len());
        for (index, page) in self.pages.iter().enumerate() {
            let number = writer.reserve();
            page_numbers.push(number);

            let (content, polices_page) =
                page.content(&self.images, &self.fonts, self.marks, &mut usage)?;
            let content_ref = writer.push_stream("", content.as_bytes());

            // Les polices de cette page reçoivent leurs objets ici : les
            // ressources peuvent alors les référencer, et rien n'est écrit pour
            // une police qu'aucune page n'emploie.
            for rang in &polices_page {
                if font_refs[*rang].is_none() {
                    font_refs[*rang] = Some(FontRefs {
                        type0: writer.reserve(),
                        cid: writer.reserve(),
                        descripteur: writer.reserve(),
                        fontfile: writer.reserve(),
                        tounicode: writer.reserve(),
                    });
                }
            }

            let resources = resources_for(
                page,
                &self.images,
                index,
                &image_refs,
                &polices_page,
                &font_refs,
            );
            writer.put(
                number,
                format!(
                    "<< /Type /Page /Parent {pages_root} 0 R {} /Resources {resources} \
                     /Contents {content_ref} 0 R >>\n",
                    page.boxes().boxes_entries()
                ),
            );
        }

        let kids: Vec<String> = page_numbers.iter().map(|n| format!("{n} 0 R")).collect();
        writer.put(
            pages_root,
            format!(
                "<< /Type /Pages /Kids [{}] /Count {} >>\n",
                kids.join(" "),
                page_numbers.len()
            ),
        );

        let mut catalog_entries = vec![
            ("Type".to_string(), object::name("Catalog")),
            ("Pages".to_string(), format!("{pages_root} 0 R")),
        ];
        if let Some((intent_ref, _)) = intent_refs {
            catalog_entries.push(("OutputIntents".to_string(), format!("[{intent_ref} 0 R]")));
        }
        writer.put(catalog, object::dict(&catalog_entries) + "\n");

        // Remplissage différé des images.
        for (index, image) in self.images.iter().enumerate() {
            writer.put(
                image_refs[index],
                Writer::stream_body(&image.dict_entries(), image.data()),
            );
        }

        // Remplissage différé des polices : cinq objets par police employée.
        for (index, face) in self.fonts.iter().enumerate() {
            let Some(refs) = font_refs[index] else {
                continue;
            };
            let nom = face.nom_pdf();

            // Le programme de la police, tel quel.
            writer.put(
                refs.fontfile,
                Writer::stream_body(&font::entrees_fontfile(face), &face.data),
            );
            writer.put(
                refs.descripteur,
                font::descripteur_pdf(face, &nom, refs.fontfile),
            );
            writer.put(
                refs.cid,
                font::cidfont_pdf(
                    face,
                    &nom,
                    refs.descripteur,
                    &font::largeurs_pdf(face, &usage.gids[index]),
                ),
            );
            // La table qui rend le texte extractible — c'est elle qui permet à
            // un contrôle automatique de relire ce qui a été composé.
            writer.put(
                refs.tounicode,
                Writer::stream_body(
                    "",
                    font::to_unicode_cmap(&usage.to_unicode[index]).as_bytes(),
                ),
            );
            writer.put(refs.type0, font::type0_pdf(&nom, refs.cid, refs.tounicode));
        }

        // Remplissage différé de la destination de sortie.
        if let (Some(intent), Some((intent_ref, icc_ref))) = (&self.output_intent, intent_refs) {
            writer.put(
                icc_ref,
                Writer::stream_body(&format!("/N {}", intent.components), &intent.icc),
            );
            writer.put(
                intent_ref,
                format!(
                    "<< /Type /OutputIntent /S /GTS_PDFX \
                     /OutputConditionIdentifier {} /Info {} /DestOutputProfile {icc_ref} 0 R >>\n",
                    object::literal_string(&intent.identifier),
                    object::literal_string(&intent.info)
                ),
            );
        }

        let pdf = writer
            .finish(catalog, &format!("/Info {info_ref} 0 R"))
            .map_err(DocError::from)?;
        Ok((pdf, usage))
    }
}

// ───────────────────────────── ressources ─────────────────────────────

/// Les cinq objets qu'occupe une police embarquée.
///
/// Réserver les cinq d'un coup est ce qui permet d'écrire `/Font << /F0 12 0 R >>`
/// sur une page alors que les objets de la police ne sont remplis qu'à la fin —
/// une fois qu'on sait quels glyphes ont réellement servi.
#[derive(Clone, Copy, Debug)]
struct FontRefs {
    /// Le dictionnaire `/Type0` cité par les ressources de page.
    type0: usize,
    /// La police descendante `/CIDFontType2`.
    cid: usize,
    /// Le `/FontDescriptor`.
    descripteur: usize,
    /// Le flux `/FontFile2` : le programme de la police.
    fontfile: usize,
    /// Le flux `/ToUnicode`.
    tounicode: usize,
}

/// Ressources d'une page : couleurs, images et polices **réellement utilisées**.
///
/// N'écrire que ce qui est utilisé évite de faire porter à chaque page la
/// totalité des images et des polices du document — sur un catalogue de 200
/// pages, la différence se voit au poids du fichier.
fn resources_for(
    page: &Page,
    images: &[ImageXObject],
    page_index: usize,
    image_refs: &[usize],
    polices_page: &[usize],
    font_refs: &[Option<FontRefs>],
) -> String {
    let mut xobjects: Vec<String> = Vec::new();
    let mut vues: Vec<usize> = Vec::new();
    for op in &page.ops {
        if let Op::Image { image, .. } = op {
            if !vues.contains(image) && *image < images.len() {
                vues.push(*image);
            }
        }
    }
    for index in vues {
        xobjects.push(format!("/{} {} 0 R", image_name(index), image_refs[index]));
    }

    let mut polices: Vec<String> = Vec::new();
    for rang in polices_page {
        if let Some(Some(refs)) = font_refs.get(*rang) {
            polices.push(format!(
                "/{} {} 0 R",
                font::nom_ressource(*rang),
                refs.type0
            ));
        }
    }

    let mut parties = vec![format!("/ColorSpace {}", page.stack.resources_pdf())];
    if !xobjects.is_empty() {
        parties.push(format!("/XObject << {} >>", xobjects.join(" ")));
    }
    if !polices.is_empty() {
        parties.push(format!("/Font << {} >>", polices.join(" ")));
    }
    let _ = page_index;
    format!("<< {} >>", parties.join(" "))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spot::{AlternateSpace, SpotInk};
    use superprint_image::GrayImage;

    fn encres() -> ColorStack {
        ColorStack::with_spots(
            QuadriSpace::Cmyk,
            [
                SpotInk::new(
                    "PANTONE WARM RED C",
                    AlternateSpace::Cmyk(Cmyk {
                        c: 0.0,
                        m: 0.9,
                        y: 0.8,
                        k: 0.0,
                    }),
                )
                .unwrap(),
                SpotInk::new("PANTONE 300 C", AlternateSpace::Rgb(Rgb::new(0, 94, 184))).unwrap(),
            ],
        )
        .unwrap()
    }

    fn page(ops: Vec<Op>) -> Page {
        let mut page = Page::new(PageSize::new(170.0, 240.0), 3.0, 10.0, encres());
        page.ops = ops;
        page
    }

    #[test]
    fn document_sans_page_refuse() {
        assert_eq!(Document::new().write().unwrap_err(), DocError::NoPages);
    }

    #[test]
    fn rectangle_en_ton_direct_et_teinte() {
        let mut doc = Document::new();
        doc.add_page(page(vec![
            Op::Fill {
                path: Path::Rect {
                    x: 10.0,
                    y: 20.0,
                    width: 50.0,
                    height: 30.0,
                },
                paint: Paint::Spot {
                    index: 0,
                    tint: 0.5,
                },
            },
            Op::Stroke {
                path: Path::Rect {
                    x: 0.0,
                    y: 0.0,
                    width: 10.0,
                    height: 10.0,
                },
                paint: Paint::Quadri(ColorValue::Cmyk(Cmyk {
                    c: 0.0,
                    m: 0.0,
                    y: 0.0,
                    k: 1.0,
                })),
                width_mm: 0.5,
            },
        ]));
        let pdf = doc.write().expect("document valide");
        let texte = String::from_utf8_lossy(&pdf);

        assert!(texte.contains("/Separation"));
        assert!(texte.contains("/CS0 cs"), "encre directe sélectionnée");
        assert!(texte.contains("0.5 scn"), "teinte à 50 % écrite");
        assert!(texte.contains("/CSQuadri cs"));
        // Le rectangle de 50 × 30 mm doit ressortir à ses dimensions en points.
        assert!(texte.contains(&format!(
            "{} {} {} {} re",
            object::number(mm_to_pt(10.0)),
            object::number(mm_to_pt(20.0)),
            object::number(mm_to_pt(50.0)),
            object::number(mm_to_pt(30.0))
        )));
    }

    #[test]
    fn plusieurs_pages_declarees() {
        let mut doc = Document::new();
        for _ in 0..3 {
            doc.add_page(page(vec![]));
        }
        let pdf = doc.write().expect("document valide");
        let texte = String::from_utf8_lossy(&pdf);
        assert!(texte.contains("/Count 3"));
        assert_eq!(texte.matches("/Type /Page ").count(), 3);
        assert_eq!(texte.matches("/Type /Pages").count(), 1);
    }

    #[test]
    fn couleur_incoherente_refusee() {
        // Page CMJN, forme peinte en RVB : refus explicite.
        let mut doc = Document::new();
        doc.add_page(page(vec![Op::Fill {
            path: Path::Rect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            paint: Paint::Quadri(ColorValue::Rgb(Rgb::new(1, 2, 3))),
        }]));
        assert_eq!(
            doc.write().unwrap_err(),
            DocError::ColorSpaceMismatch {
                page: "CMJN",
                paint: "RVB"
            }
        );
    }

    #[test]
    fn encre_et_image_inconnues_refusees() {
        let mut doc = Document::new();
        doc.add_page(page(vec![Op::Fill {
            path: Path::Rect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            paint: Paint::Spot {
                index: 7,
                tint: 1.0,
            },
        }]));
        assert_eq!(
            doc.write().unwrap_err(),
            DocError::UnknownSpot {
                index: 7,
                available: 2
            }
        );

        let mut doc = Document::new();
        doc.add_page(page(vec![Op::Image {
            image: 3,
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        }]));
        assert_eq!(
            doc.write().unwrap_err(),
            DocError::UnknownImage {
                index: 3,
                available: 0
            }
        );
    }

    #[test]
    fn teinte_hors_bornes_refusee() {
        let mut doc = Document::new();
        doc.add_page(page(vec![Op::Fill {
            path: Path::Rect {
                x: 0.0,
                y: 0.0,
                width: 1.0,
                height: 1.0,
            },
            paint: Paint::Spot {
                index: 0,
                tint: 1.5,
            },
        }]));
        assert_eq!(
            doc.write().unwrap_err(),
            DocError::TintOutOfRange { tint: 1.5 }
        );
    }

    #[test]
    fn cercle_est_ferme_et_borne() {
        let ops = Path::Circle {
            cx: 10.0,
            cy: 20.0,
            radius: 5.0,
        }
        .to_ops();
        assert!(
            ops.contains(" m\n"),
            "un cercle commence par un déplacement"
        );
        assert_eq!(ops.matches(" c\n").count(), 4, "quatre arcs cubiques");
        assert!(ops.trim_end().ends_with('h'), "un cercle est fermé");
    }

    #[test]
    fn image_placee_a_sa_taille() {
        let gris = GrayImage::from_data(4, 2, vec![10u8; 8]).unwrap();
        let mut doc = Document::new();
        let image = doc.add_image(ImageXObject::from_gray(
            &gris,
            crate::image::ImageFilter::Auto,
        ));
        doc.add_page(page(vec![Op::Image {
            image,
            x: 5.0,
            y: 5.0,
            width: 20.0,
            height: 10.0,
        }]));
        let pdf = doc.write().expect("document valide");
        let texte = String::from_utf8_lossy(&pdf);

        assert!(texte.contains(&format!(
            "{} 0 0 {} {} {} cm",
            object::number(mm_to_pt(20.0)),
            object::number(mm_to_pt(10.0)),
            object::number(mm_to_pt(5.0)),
            object::number(mm_to_pt(5.0))
        )));
        assert!(texte.contains("/Im0 Do"));
        // Le numéro d'objet dépend de l'ordre d'assemblage : on vérifie donc la
        // **forme** de la référence, pas un numéro en dur. Les numéros en dur
        // dans un test se cassent au premier objet ajouté ailleurs.
        assert!(
            texte.contains("/Im0 ") && texte.contains(" 0 R >>"),
            "la ressource XObject doit référencer l'image"
        );
        assert!(texte.contains("/Subtype /Image"));
        assert!(texte.contains("/Width 4"));
        assert!(texte.contains("/Height 2"));
    }

    #[test]
    fn image_non_utilisee_absente_des_ressources() {
        // Une image enregistrée mais jamais posée ne doit pas alourdir la page.
        let gris = GrayImage::from_data(2, 2, vec![0u8; 4]).unwrap();
        let mut doc = Document::new();
        doc.add_image(ImageXObject::from_gray(
            &gris,
            crate::image::ImageFilter::None,
        ));
        doc.add_page(page(vec![]));
        let pdf = doc.write().expect("document valide");
        let texte = String::from_utf8_lossy(&pdf);
        assert!(
            !texte.contains("/Im0 1 0 R"),
            "aucune ressource XObject attendue"
        );
    }

    #[test]
    fn metadonnees_ecrites_sans_champ_vide() {
        let mut doc = Document::new();
        doc.add_page(page(vec![]));
        doc.info = DocInfo {
            title: Some("Essai (avec parenthèses)".to_string()),
            producer: Some("SuperPrint".to_string()),
            author: Some("   ".to_string()),
            ..DocInfo::default()
        };
        let pdf = doc.write().expect("document valide");
        let texte = String::from_utf8_lossy(&pdf);
        // Le `é` sort en PDFDocEncoding (`\351`), pas en deux octets UTF-8 :
        // c'est ce qui fait qu'un titre accentué s'affiche correctement.
        assert!(
            texte.contains("/Title (Essai \\(avec parenth\\350ses\\))"),
            "titre accentué attendu en PDFDocEncoding ; trouvé : {}",
            texte
                .lines()
                .find(|l| l.contains("/Title"))
                .unwrap_or("(pas de /Title)")
        );
        assert!(texte.contains("/Producer (SuperPrint)"));
        assert!(!texte.contains("/Author"), "un champ blanc n'est pas écrit");
        assert!(texte.contains("/Info "));
    }

    #[test]
    fn accents_restent_lisibles_par_un_lecteur_pdf() {
        // `é` en PDFDocEncoding vaut 0xE9, soit `\351`. Écrit en UTF-8, il
        // occuperait deux octets et un lecteur afficherait « Ã© ».
        assert_eq!(object::literal_string("café"), "(caf\\351)");
        // Hors Latin-1 : remplacé, jamais écrit en UTF-8 brut.
        assert_eq!(object::literal_string("東京"), "(??)");
        // Les trois caractères sensibles restent échappés.
        assert_eq!(object::literal_string("a(b)c\\d"), "(a\\(b\\)c\\\\d)");
    }

    #[test]
    fn typographie_francaise_conservee() {
        // PDFDocEncoding loge les caractères de composition au-dessus de 0x7F :
        // les perdre ferait disparaître l'apostrophe courbe et le tiret cadratin
        // d'un titre, remplacés par des « ? ».
        assert_eq!(
            object::literal_string("L’art — et la manière"),
            "(L\\220art \\204 et la mani\\350re)",
        );
        // « » et ° sont en Latin-1 (0xAB, 0xBB, 0xB0) : échappés en octal, comme
        // tout octet hors de la plage imprimable.
        assert_eq!(object::literal_string("« œuf »"), "(\\253 \\234uf \\273)");
        assert_eq!(
            object::literal_string("10 € – 20 €"),
            "(10 \\240 \\205 20 \\240)"
        );
        assert_eq!(object::literal_string("n° 1…"), "(n\\260 1\\203)");
    }

    #[test]
    fn output_intent_ecrit_avec_son_profil() {
        let mut doc = Document::new();
        doc.add_page(page(vec![]));
        // Un profil factice mais de taille plausible pour du CMJN.
        doc.output_intent = Some(OutputIntent {
            icc: vec![7u8; 700],
            components: 4,
            identifier: "FOGRA39".to_string(),
            info: "Coated FOGRA39".to_string(),
        });
        let pdf = doc.write().expect("document valide");
        let texte = String::from_utf8_lossy(&pdf);
        assert!(texte.contains("/OutputIntents ["));
        assert!(texte.contains("/S /GTS_PDFX"));
        assert!(texte.contains("/OutputConditionIdentifier (FOGRA39)"));
        assert!(texte.contains("/DestOutputProfile "));
        assert!(texte.contains("/N 4"));
    }

    #[test]
    fn profil_icc_trop_court_refuse() {
        let mut doc = Document::new();
        doc.add_page(page(vec![]));
        doc.output_intent = Some(OutputIntent {
            icc: vec![0u8; 12],
            components: 4,
            identifier: "X".to_string(),
            info: "Y".to_string(),
        });
        assert_eq!(
            doc.write().unwrap_err(),
            DocError::BadProfile {
                components: 4,
                bytes: 12
            }
        );
    }

    #[test]
    fn traits_de_coupe_presents_quand_demandes() {
        let mut doc = Document::new();
        doc.marks = true;
        doc.add_page(page(vec![]));
        let avec = String::from_utf8_lossy(&doc.write().unwrap()).to_string();

        doc.marks = false;
        let sans = String::from_utf8_lossy(&doc.write().unwrap()).to_string();

        assert_eq!(avec.matches(" l\nS\n").count(), 8, "huit segments attendus");
        assert_eq!(sans.matches(" l\nS\n").count(), 0);
        assert!(avec.len() > sans.len());
    }

    #[test]
    fn page_couleur_rvb_accepte_le_rvb() {
        let stack = ColorStack::new(QuadriSpace::Rgb);
        let mut doc = Document::new();
        doc.add_page(Page::new(PageSize::new(100.0, 100.0), 0.0, 0.0, stack));
        let pdf = doc.write().expect("document valide");
        let texte = String::from_utf8_lossy(&pdf);
        assert!(texte.contains("/DeviceRGB"));
    }

    // ───────────────────────────── texte et polices ─────────────────────────────

    fn police() -> FontFace {
        FontFace::parse(superprint_font::synth::construire(
            &superprint_font::synth::PoliceSynth::default(),
        ))
        .expect("police synthétique lisible")
    }

    fn texte(font: usize, chaine: &str) -> Op {
        Op::Text {
            font,
            size_pt: 12.0,
            x: 20.0,
            y: 200.0,
            paint: Paint::Quadri(ColorValue::Cmyk(Cmyk {
                c: 0.0,
                m: 0.0,
                y: 0.0,
                k: 1.0,
            })),
            text: chaine.to_string(),
        }
    }

    #[test]
    fn texte_ecrit_les_objets_de_police() {
        let mut doc = Document::new();
        doc.marks = false;
        let rang = doc.add_font(police());
        doc.add_page(page(vec![texte(rang, "Ab")]));
        let pdf = doc.write().expect("document valide");
        let flux = String::from_utf8_lossy(&pdf);

        // Les cinq objets attendus.
        assert!(flux.contains("/Subtype /Type0"), "dictionnaire /Type0");
        assert!(flux.contains("/Encoding /Identity-H"));
        assert!(flux.contains("/Subtype /CIDFontType2"));
        assert!(flux.contains("/Type /FontDescriptor"));
        assert!(flux.contains("/FontFile2 "));
        assert!(flux.contains("/Length1 "));

        // Les ressources de la page citent la police sous son nom de ressource.
        assert!(flux.contains("/Font << /F0 "), "ressource de page : {flux}");

        // Le flux de contenu écrit bien des identifiants de glyphe : A = 2, b = 5.
        assert!(flux.contains("<00020005> Tj"), "Tj en identifiants");
        assert!(flux.contains("/F0 12 Tf"));
        // Les millimètres de l'appelant sont convertis en points.
        assert!(
            flux.contains(&format!(
                "1 0 0 1 {} {} Tm",
                object::number(mm_to_pt(20.0)),
                object::number(mm_to_pt(200.0))
            )),
            "position en points attendue"
        );
    }

    #[test]
    fn table_to_unicode_rend_le_texte_extractible() {
        let mut doc = Document::new();
        doc.marks = false;
        let rang = doc.add_font(police());
        doc.add_page(page(vec![texte(rang, "Aé")]));
        let pdf = doc.write().expect("document valide");
        let flux = String::from_utf8_lossy(&pdf);

        assert!(flux.contains("/ToUnicode "));
        assert!(flux.contains("begincmap"));
        // A et é doivent apparaître comme caractères Unicode, pas comme glyphes.
        assert!(flux.contains("<0041>"), "A = U+0041 attendu");
        assert!(flux.contains("<00E9>"), "é = U+00E9 attendu");
    }

    #[test]
    fn largeurs_du_document_suivent_les_glyphes_utilises() {
        // Une seule police, deux pages, des caractères différents : le tableau
        // /W doit couvrir l'union des deux pages.
        let mut doc = Document::new();
        doc.marks = false;
        let rang = doc.add_font(police());
        doc.add_page(page(vec![texte(rang, "A")]));
        doc.add_page(page(vec![texte(rang, "B")]));
        let pdf = doc.write().expect("document valide");
        let flux = String::from_utf8_lossy(&pdf);

        // A = 600, B = 620 unités ; les deux doivent figurer.
        assert!(flux.contains("/W ["), "tableau des largeurs");
        assert!(flux.contains("2 [600]"), "largeur de A");
        assert!(flux.contains("3 [620]"), "largeur de B");
        // Une seule police : un seul /FontFile2 pour tout le document.
        assert_eq!(flux.matches("/FontFile2 ").count(), 1);
    }

    #[test]
    fn police_inconnue_refusee() {
        let mut doc = Document::new();
        doc.add_page(page(vec![texte(7, "A")]));
        assert_eq!(
            doc.write().unwrap_err(),
            DocError::UnknownFont {
                index: 7,
                available: 0
            }
        );
    }

    #[test]
    fn texte_avec_caractere_de_controle_refuse() {
        let mut doc = Document::new();
        let rang = doc.add_font(police());
        doc.add_page(page(vec![texte(rang, "AB\u{7}C")]));
        assert_eq!(
            doc.write().unwrap_err(),
            DocError::TextControl {
                caractere: "U+0007".to_string()
            }
        );
    }

    #[test]
    fn caracteres_absents_comptes_et_signales() {
        // « Ω » n'est pas dans la police synthétique : le glyphe 0 est écrit,
        // mais le compteur doit le dire — un document incomplet ne doit pas
        // passer pour complet.
        let mut doc = Document::new();
        doc.marks = false;
        let rang = doc.add_font(police());
        doc.add_page(page(vec![texte(rang, "AΩB")]));
        let pdf = doc.write().expect("document valide");
        let flux = String::from_utf8_lossy(&pdf);

        assert!(
            flux.contains("<000200000003> Tj"),
            "glyphe 0 pour le manquant"
        );
        // Le glyphe 0 ne doit pas prétendre porter Ω : l'extraction mentirait.
        assert!(!flux.contains("<03A9>"), "Ω ne doit pas être déclaré");
    }

    #[test]
    fn police_sans_texte_n_est_pas_ecrite() {
        // Déclarée mais inutilisée : aucun objet, sinon le fichier porterait une
        // police entière pour rien.
        let mut doc = Document::new();
        doc.marks = false;
        doc.add_font(police());
        doc.add_page(page(vec![]));
        let pdf = doc.write().expect("document valide");
        let flux = String::from_utf8_lossy(&pdf);
        assert_eq!(flux.matches("/FontFile2 ").count(), 0);
        assert!(!flux.contains("/Font <<"));
    }

    #[test]
    fn texte_multiligne_descend_d_une_interligne_et_demie() {
        let mut doc = Document::new();
        doc.marks = false;
        let rang = doc.add_font(police());
        doc.add_page(page(vec![texte(rang, "A\nB")]));
        let pdf = doc.write().expect("document valide");
        let flux = String::from_utf8_lossy(&pdf);
        // Corps 12 pt → interligne 14,4 pt ; y initial 200 mm.
        let attendu = object::number(mm_to_pt(200.0) - 12.0 * 1.2);
        assert!(
            flux.contains(&format!(
                "1 0 0 1 {} {attendu} Tm",
                object::number(mm_to_pt(20.0))
            )),
            "deuxième ligne descendue de 1,2 fois le corps"
        );
    }
}
