//! Les **vérificateurs** : chacun cherche un défaut précis dans un document.
//!
//! Chaque vérificateur est une fonction indépendante. Elle prend le document et
//! les règles, et **ajoute** ses constats à une liste. Aucun ne connaît les
//! autres, aucun ne corrige quoi que ce soit.
//!
//! ## Un défaut est toujours nommé et chiffré
//!
//! « L'image est de trop basse résolution » ne sert à rien. Le constat dit :
//! *page 2, image de 400 × 300 posée sur 120 × 90 mm = 85 dpi, minimum 300*. La
//! valeur mesurée **et** le seuil, toujours — l'auteur doit pouvoir décider s'il
//! accepte l'écart, et pour cela il lui faut les deux nombres.

use super::{Code, Constat, Gravite, Regles};
use superprint_core::Cmyk;
use superprint_pdf::colorspace::QuadriSpace;
use superprint_pdf::document::{ColorValue, Document, Op, Paint, Path};

/// Millimètres par pouce — le pont entre les deux unités du calcul.
const MM_PAR_POUCE: f64 = 25.4;

/// La page en cours d'examen : son numéro, sa quadri, et les règles appliquées.
///
/// Les regrouper n'est pas de la coquetterie : sans ce groupe, chaque
/// vérificateur promène quatre paramètres dont deux sont des entiers sans
/// rapport (un numéro de page, un rang de police) — exactement le genre de
/// couple qui s'inverse un jour dans un appel sans que rien ne le signale.
struct PageEnCours<'a> {
    /// Numéro montré à l'auteur : 1 pour la première page.
    numero: usize,
    /// L'espace colorimétrique des pages.
    quadri: QuadriSpace,
    /// Les seuils en vigueur.
    regles: &'a Regles,
}

/// Passe **tous** les contrôles sur un document.
#[must_use]
pub fn verifier(doc: &Document, regles: &Regles) -> Vec<Constat> {
    let mut constats = Vec::new();

    if doc.pages.is_empty() {
        constats.push(Constat::document(
            Code::DocumentVide,
            Gravite::Erreur,
            "le document ne contient aucune page : il n'y a rien à imprimer",
        ));
        return constats;
    }

    // Le profil de sortie décrit le **document**, pas une page : il est vérifié
    // une fois, avec la quadri de la première page comme référence.
    let en_tete = PageEnCours {
        numero: 1,
        quadri: doc.pages[0].stack.quadri(),
        regles,
    };
    verifier_profil_sortie(doc, &en_tete, &mut constats);

    for (index, page) in doc.pages.iter().enumerate() {
        let en_cours = PageEnCours {
            numero: index + 1,
            quadri: page.stack.quadri(),
            regles,
        };
        verifier_page(page, &en_cours, &mut constats);
        verifier_operations(doc, page, &en_cours, &mut constats);
        verifier_encres(page, &en_cours, &mut constats);
    }

    verifier_polices(doc, &mut constats);
    verifier_images(doc, &mut constats);

    constats
}

// ─────────────────────────── page : géométrie ───────────────────────────

/// Fond perdu et réserve de repères.
fn verifier_page(
    page: &superprint_pdf::document::Page,
    en_cours: &PageEnCours<'_>,
    sortie: &mut Vec<Constat>,
) {
    let numero = en_cours.numero;
    if en_cours.regles.exiger_fond_perdu && page.bleed_mm <= 0.0 {
        sortie.push(Constat::page(
            Code::FondPerduAbsent,
            Gravite::Avertissement,
            numero,
            "la page n'a pas de fond perdu : après rognage, un liseré blanc \
             peut apparaître sur le bord",
        ));
    }

    if page.mark_mm > 0.0 && page.bleed_mm > 0.0 && page.mark_mm < 5.0 {
        // Un repère de coupe fait 5 mm : une réserve plus courte le tronque.
        sortie.push(Constat::page(
            Code::ReperesSansReserve,
            Gravite::Avertissement,
            numero,
            format!(
                "la réserve pour les repères fait {:.1} mm, alors qu'un trait de \
                 coupe en demande 5 mm : les repères seront tronqués",
                page.mark_mm
            ),
        ));
    }

    // Les repères sont tracés par le document, pas par la page : on vérifie ici
    // qu'ils sont *possibles*, la demande elle-même est contrôlée plus haut.
    if en_cours.regles.exiger_reperes && page.mark_mm <= 0.0 {
        sortie.push(Constat::page(
            Code::ReperesSansReserve,
            Gravite::Erreur,
            numero,
            "des repères de coupe sont exigés mais la page ne réserve aucune \
             marge pour les tracer",
        ));
    }
}

// ─────────────────────── opérations : images et couleurs ───────────────────────

/// Parcourt les opérations d'une page.
fn verifier_operations(
    doc: &Document,
    page: &superprint_pdf::document::Page,
    en_cours: &PageEnCours<'_>,
    sortie: &mut Vec<Constat>,
) {
    let numero = en_cours.numero;
    let mut texte_signale = false;

    for operation in &page.ops {
        match operation {
            Op::Image {
                image,
                width,
                height,
                ..
            } => {
                // Les coordonnées de pose (`x`, `y`) ne servent pas ici : le
                // contrôle porte sur la **densité** de l'image, pas sur
                // l'endroit où elle tombe.
                verifier_placement_image(doc, *image, *width, *height, en_cours, sortie);
            }
            Op::Text {
                text,
                paint,
                size_pt,
                font,
                ..
            } => {
                if en_cours.regles.signaler_texte_vivant && !text.is_empty() && !texte_signale {
                    texte_signale = true;
                    sortie.push(Constat::page(
                        Code::TexteVivant,
                        Gravite::Information,
                        numero,
                        "la page contient du texte vivant : si l'imprimeur ne \
                         dispose pas de la même police, la coupure des lignes et \
                         les largeurs changeront. Vectoriser est plus sûr pour \
                         un fichier d'impression.",
                    ));
                }
                if *size_pt <= en_cours.regles.corps_texte_fin_pt {
                    verifier_noir_fin(*paint, en_cours, *size_pt, *font, sortie);
                }
            }
            Op::Stroke {
                path,
                paint,
                width_mm,
            } => {
                if *width_mm <= en_cours.regles.epaisseur_trait_fin_mm {
                    verifier_noir_trait(*paint, en_cours, *width_mm, sortie);
                }
                verifier_debordement(path, page, en_cours, sortie);
            }
            Op::Fill { path, .. } => {
                verifier_debordement(path, page, en_cours, sortie);
            }
            // Le rognage ne peint rien : il n'y a donc ni épaisseur de trait, ni
            // corps de texte, ni noir à contrôler.
            //
            // ⚠️ Limite assumée, et dite : un objet **rogné** est malgré tout
            // contrôlé contre le format, alors que le rognage l'empêche
            // justement de dépasser. Le contrôle peut donc signaler un
            // débordement qui n'existe pas à l'impression. Aller contre ce
            // silence demanderait de suivre la pile des zones de rognage et
            // d'intersecter les boîtes ; c'est faisable, ce n'est pas fait, et
            // cela ne produit jamais l'inverse — un débordement réel caché.
            Op::Clip { .. } | Op::EndClip => {}
        }
    }
}

/// La résolution **réelle** d'une image, celle qui compte : sa taille en pixels
/// divisée par la taille à laquelle elle est posée.
fn verifier_placement_image(
    doc: &Document,
    index: usize,
    width: f64,
    height: f64,
    en_cours: &PageEnCours<'_>,
    sortie: &mut Vec<Constat>,
) {
    let numero = en_cours.numero;
    let Some(image) = doc.images.get(index) else {
        sortie.push(Constat::page(
            Code::ImageEspaceInattendu,
            Gravite::Erreur,
            numero,
            format!("une image est posée alors que son rang {index} n'existe pas"),
        ));
        return;
    };
    if width <= 0.0 || height <= 0.0 {
        return;
    }
    // On prend la **plus mauvaise** des deux dimensions : un cadre étiré
    // horizontalement peut être net dans un sens et flou dans l'autre, et c'est
    // le flou qui se voit.
    let dpi_horizontal = f64::from(image.width()) / (width / MM_PAR_POUCE);
    let dpi_vertical = f64::from(image.height()) / (height / MM_PAR_POUCE);
    let dpi = dpi_horizontal.min(dpi_vertical);

    if dpi < en_cours.regles.dpi_mini_image {
        let gravite = if dpi < en_cours.regles.dpi_mini_image * 0.6 {
            Gravite::Erreur
        } else {
            Gravite::Avertissement
        };
        sortie.push(Constat::page(
            Code::ImageBasseResolution,
            gravite,
            numero,
            format!(
                "une image de {} × {} px posée sur {:.1} × {:.1} mm donne {:.0} dpi, \
                 alors que {:.0} dpi sont demandés",
                image.width(),
                image.height(),
                width,
                height,
                dpi,
                en_cours.regles.dpi_mini_image
            ),
        ));
    }
}

// ─────────────────────── couleurs : noir quadrichrome ───────────────────────

/// Le noir quadrichrome sur du **texte fin**.
fn verifier_noir_fin(
    paint: Paint,
    en_cours: &PageEnCours<'_>,
    size_pt: f64,
    font: usize,
    sortie: &mut Vec<Constat>,
) {
    let Some(cmyk) = composantes_cmyk(paint, en_cours.quadri) else {
        return;
    };
    if !est_noir_quadrichrome(cmyk) {
        return;
    }
    sortie.push(Constat::page(
        Code::NoirQuadrichromeSurTexteFin,
        Gravite::Avertissement,
        en_cours.numero,
        format!(
            "un texte de {:.1} pt (police n°{}) est peint en noir quadrichrome \
             ({:.0}/{:.0}/{:.0}/{:.0}) : sous {:.1} pt, les quatre encres se \
             décalent au repérage et le texte bave. Un noir à 100 % de noir seul \
             est plus sûr.",
            size_pt,
            font,
            cmyk.c * 100.0,
            cmyk.m * 100.0,
            cmyk.y * 100.0,
            cmyk.k * 100.0,
            en_cours.regles.corps_texte_fin_pt
        ),
    ));
}

/// Le noir quadrichrome sur un **trait fin**.
fn verifier_noir_trait(
    paint: Paint,
    en_cours: &PageEnCours<'_>,
    width_mm: f64,
    sortie: &mut Vec<Constat>,
) {
    let Some(cmyk) = composantes_cmyk(paint, en_cours.quadri) else {
        return;
    };
    if !est_noir_quadrichrome(cmyk) {
        return;
    }
    sortie.push(Constat::page(
        Code::NoirQuadrichromeSurTraitFin,
        Gravite::Avertissement,
        en_cours.numero,
        format!(
            "un trait de {:.2} mm est peint en noir quadrichrome \
             ({:.0}/{:.0}/{:.0}/{:.0}) : les quatre encres se décalent, et le \
             trait devient flou",
            width_mm,
            cmyk.c * 100.0,
            cmyk.m * 100.0,
            cmyk.y * 100.0,
            cmyk.k * 100.0
        ),
    ));
}

/// Les quatre composantes d'une peinture, ou `None` si ce n'est pas du quadri.
fn composantes_cmyk(paint: Paint, quadri: QuadriSpace) -> Option<Cmyk> {
    match paint {
        // Une encre directe n'est pas du quadri : elle a sa propre plaque, donc
        // pas de repérage à craindre entre canaux. On ne la juge pas.
        Paint::Spot { .. } => None,
        Paint::Quadri(valeur) => match valeur {
            ColorValue::Cmyk(cmyk) => Some(cmyk),
            ColorValue::Rgb(rgb) => {
                if quadri == QuadriSpace::Rgb {
                    // En RVB, il n'y a pas encore de quadri : c'est la
                    // séparation qui décidera. On signale tout de même un noir
                    // quadrichrome **potentiel** — un noir RVB pur devient
                    // souvent quatre encres à la séparation.
                    let c = Cmyk::from(rgb);
                    Some(c)
                } else {
                    // La page est en CMJN mais on peint du RVB : c'est
                    // incohérent, et l'exporteur le refusera. Le prépresse ne
                    // double pas ce contrôle, qui a déjà son erreur dédiée.
                    None
                }
            }
        },
    }
}

/// Un noir **quadrichrome** : les quatre canaux sont chargés.
///
/// Le seuil n'est pas « les quatre canaux non nuls » : un gris foncé à
/// 5/5/5/90 est un noir normal avec un peu de soutien, on ne va pas le
/// dénoncer. On cherche le noir **profond** fabriqué avec les quatre encres — le
/// « noir riche » — celui qui a besoin d'un repérage parfait.
fn est_noir_quadrichrome(cmyk: Cmyk) -> bool {
    // Les trois canaux chromatiques doivent être franchement engagés…
    let chromatiques = cmyk.c.min(cmyk.m).min(cmyk.y);
    // …et le noir aussi, sinon ce n'est pas un noir.
    chromatiques > 0.15 && cmyk.k > 0.3
}

// ─────────────────────── couverture d'encre ───────────────────────

/// La somme des quatre encres, et les encres directes déclarées mais vides.
fn verifier_encres(
    page: &superprint_pdf::document::Page,
    en_cours: &PageEnCours<'_>,
    sortie: &mut Vec<Constat>,
) {
    let numero = en_cours.numero;
    let regles = en_cours.regles;
    // ── Couverture d'encre ────────────────────────────────────────────────
    // On retient la **pire** couverture de la page : c'est elle qui décidera du
    // séchage, une zone à 340 % suffit à faire bayer un tirage.
    //
    // `f64::NEG_INFINITY` plutôt qu'un `Option::is_none_or` : ce dernier n'est
    // arrivé qu'en Rust 1.82, et le projet se tient à 1.75.
    let mut pire_total = f64::NEG_INFINITY;
    let mut pire: Option<Cmyk> = None;
    for operation in &page.ops {
        let peinture = match operation {
            Op::Fill { paint, .. } | Op::Stroke { paint, .. } => Some(*paint),
            Op::Text { paint, .. } => Some(*paint),
            Op::Image { .. } | Op::Clip { .. } | Op::EndClip => None,
        };
        let Some(Paint::Quadri(ColorValue::Cmyk(cmyk))) = peinture else {
            continue;
        };
        let total = (cmyk.c + cmyk.m + cmyk.y + cmyk.k) * 100.0;
        if total > pire_total {
            pire_total = total;
            pire = Some(cmyk);
        }
    }

    if let Some(cmyk) = pire {
        if pire_total > regles.couverture_encre_max_pourcent {
            // Un dépassement franc (au-delà de 110 % du seuil) est une erreur :
            // c'est le domaine où l'encre ne sèche plus du tout. Un dépassement
            // léger reste un avertissement, à juger par l'imprimeur.
            let gravite = if pire_total > regles.couverture_encre_max_pourcent * 1.1 {
                Gravite::Erreur
            } else {
                Gravite::Avertissement
            };
            sortie.push(Constat::page(
                Code::CouvertureEncreExcessive,
                gravite,
                numero,
                format!(
                    "la couverture d'encre monte à {:.0} % \
                     ({:.0}/{:.0}/{:.0}/{:.0}) alors que le maximum est {:.0} % : \
                     l'encre peut ne pas sécher et baver",
                    pire_total,
                    cmyk.c * 100.0,
                    cmyk.m * 100.0,
                    cmyk.y * 100.0,
                    cmyk.k * 100.0,
                    regles.couverture_encre_max_pourcent
                ),
            ));
        }
    }

    // ── Encres directes déclarées mais vides ─────────────────────────────
    // Une plaque sans encre se facture comme les autres.
    for (rang, encre) in page.stack.spots().iter().enumerate() {
        let utilisee = page.ops.iter().any(|operation| {
            let peinture = match operation {
                Op::Fill { paint, .. } | Op::Stroke { paint, .. } => Some(*paint),
                Op::Text { paint, .. } => Some(*paint),
                Op::Image { .. } | Op::Clip { .. } | Op::EndClip => None,
            };
            matches!(peinture, Some(Paint::Spot { index, tint }) if index == rang && tint > 0.0)
        });
        if !utilisee {
            sortie.push(Constat::page(
                Code::EncreNonUtilisee,
                Gravite::Information,
                numero,
                format!(
                    "l'encre directe « {} » est déclarée sur la page mais aucun objet \
                     ne s'en sert : une plaque sera facturée pour rien",
                    encre.name()
                ),
            ));
        }
    }
}

// ─────────────────────── débordement du fond perdu ───────────────────────

/// Vérifie qu'un tracé ne dépasse pas la zone autorisée.
///
/// ⚠️ **Le fond perdu n'est pas une limite : c'est une réserve.** Un objet *
/// *doit** pouvoir mordre dedans — c'est même son rôle pour un aplat qui va au
/// bord. Ce qui compte est qu'il ne franchisse pas le bord **extérieur** du
/// média : au-delà, le contenu est purement et simplement coupé à l'impression,
/// et personne ne le verra avant le tirage.
fn verifier_debordement(
    path: &Path,
    page: &superprint_pdf::document::Page,
    en_cours: &PageEnCours<'_>,
    sortie: &mut Vec<Constat>,
) {
    let Some(objet) = boite_englobante(path) else {
        return;
    };
    // La zone imprimable : le format fini, plus le fond perdu **des deux côtés**.
    let marge = page.bleed_mm.max(0.0);
    let limite = (
        -marge,
        -marge,
        page.trim.width_mm + marge,
        page.trim.height_mm + marge,
    );

    // Une tolérance d'un dixième de millimètre : les coordonnées viennent de
    // calculs flottants, et refuser pour 0,0001 mm serait absurde.
    let tolerance = 0.1;
    let pire = pires_depassements(objet, limite, tolerance);

    if let Some((excès, cote, limite)) = pire {
        let bord = limite + excès;
        sortie.push(Constat::page(
            Code::DebordementFondPerdu,
            Gravite::Avertissement,
            en_cours.numero,
            format!(
                "un objet dépasse {cote} de {excès:.1} mm au-delà de la zone \
                 imprimable : la limite est à {limite:.1} mm et l'objet va jusqu'à \
                 {bord:.1} mm (format fini {:.1} × {:.1} mm, fond perdu {:.1} mm). \
                 Cette partie sera coupée à l'impression.",
                page.trim.width_mm, page.trim.height_mm, marge,
            ),
        ));
    }
}

/// La limite franchie, et de combien.
///
/// Le calcul renvoie les quatre écarts avec **leur nom** et **la coordonnée de
/// la limite** : un message qui dit « dépassement de 37 mm » sans dire où est la
/// limite oblige à refaire le calcul à la main.
fn pires_depassements(
    objet: (f64, f64, f64, f64),
    limite: (f64, f64, f64, f64),
    tolerance: f64,
) -> Option<(f64, &'static str, f64)> {
    let (gauche, bas, droite, haut) = objet;
    let (limite_gauche, limite_bas, limite_droite, limite_haut) = limite;
    [
        (limite_gauche - gauche, "à gauche", limite_gauche),
        (limite_bas - bas, "en bas", limite_bas),
        (droite - limite_droite, "à droite", limite_droite),
        (haut - limite_haut, "en haut", limite_haut),
    ]
    .into_iter()
    .filter(|(valeur, _, _)| *valeur > tolerance)
    .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(core::cmp::Ordering::Equal))
}

/// Boîte englobante d'un tracé, en millimètres : `(gauche, bas, droite, haut)`.
///
/// C'est une **API publique**, et pas seulement un détail interne : savoir où
/// tombe un objet est ce dont un exporteur a besoin pour vérifier un cadre, et
/// refaire ce calcul ailleurs serait la garantie qu'il diverge un jour.
///
/// ```
/// use superprint_preflight::boite_englobante;
/// use superprint_pdf::document::Path;
///
/// let chemin = Path::Rect { x: 1.0, y: 2.0, width: 3.0, height: 4.0 };
/// assert_eq!(boite_englobante(&chemin), Some((1.0, 2.0, 4.0, 6.0)));
/// ```
///
/// Renvoie `None` seulement pour un polygone vide : il n'y a rien à encadrer, et
/// renvoyer `(0, 0, 0, 0)` ferait croire à un objet au coin de la page.
///
/// ⚠️ Un trait a une **épaisseur** : sa boîte réelle dépasse la ligne d'une
/// demi-épaisseur de chaque côté. Ce calcul donne la boîte **géométrique**, pas
/// la boîte peinte ; c'est à l'appelant d'élargir s'il contrôle un trait.
#[must_use]
pub fn boite_englobante(path: &Path) -> Option<(f64, f64, f64, f64)> {
    match path {
        Path::Rect {
            x,
            y,
            width,
            height,
        } => Some((*x, *y, x + width, y + height)),
        Path::Circle { cx, cy, radius } => {
            Some((cx - radius, cy - radius, cx + radius, cy + radius))
        }
        Path::Line { x1, y1, x2, y2 } => Some((x1.min(*x2), y1.min(*y2), x1.max(*x2), y1.max(*y2))),
        Path::Polygon(sommets) => {
            let premier = sommets.first()?;
            let mut boite = (premier.0, premier.1, premier.0, premier.1);
            for (x, y) in sommets {
                boite.0 = boite.0.min(*x);
                boite.1 = boite.1.min(*y);
                boite.2 = boite.2.max(*x);
                boite.3 = boite.3.max(*y);
            }
            Some(boite)
        }
    }
}

// ─────────────────────────── polices ───────────────────────────

/// Les polices annoncées par le document.
fn verifier_polices(doc: &Document, sortie: &mut Vec<Constat>) {
    // Une police est « embarquée » si elle est livrée **avec** le document. Le
    // modèle interne la porte obligatoirement — mais elle peut n'avoir aucun
    // glyphe, et une police sans glyphe ne dessine rien.
    for (rang, police) in doc.fonts.iter().enumerate() {
        if police.num_glyphs == 0 {
            sortie.push(Constat::document(
                Code::PoliceNonEmbarquee,
                Gravite::Erreur,
                format!(
                    "la police n°{rang} (« {} ») ne porte aucun glyphe : le texte \
                     qui l'utilise ne s'imprimera pas",
                    police.family
                ),
            ));
        }
    }

    // Un texte qui renvoie à une police absente est un défaut dur : le fichier
    // écrit une référence vers du vide.
    for (index, page) in doc.pages.iter().enumerate() {
        for operation in &page.ops {
            if let Op::Text { font, .. } = operation {
                if *font >= doc.fonts.len() {
                    sortie.push(Constat::page(
                        Code::PoliceNonEmbarquee,
                        Gravite::Erreur,
                        index + 1,
                        format!(
                            "un texte renvoie à la police n°{font}, alors que le \
                             document n'en contient que {} : ce texte ne \
                             s'imprimera pas",
                            doc.fonts.len()
                        ),
                    ));
                }
            }
        }
    }

    // Une police livrée mais jamais utilisée alourdit le fichier pour rien.
    let mut utilisees = vec![false; doc.fonts.len()];
    for page in &doc.pages {
        for operation in &page.ops {
            if let Op::Text { font, .. } = operation {
                if let Some(drapeau) = utilisees.get_mut(*font) {
                    *drapeau = true;
                }
            }
        }
    }
    for (rang, utilisee) in utilisees.iter().enumerate() {
        if !utilisee {
            sortie.push(Constat::document(
                Code::PoliceNonEmbarquee,
                Gravite::Information,
                format!(
                    "la police n°{rang} (« {} ») est embarquée mais aucun texte ne \
                     s'en sert : elle alourdit le fichier sans raison",
                    doc.fonts[rang].family
                ),
            ));
        }
    }
}

// ─────────────────────────── images ───────────────────────────

/// Les images du document, hors placement.
fn verifier_images(doc: &Document, sortie: &mut Vec<Constat>) {
    if doc.images.is_empty() {
        return;
    }
    // Une image déclarée mais jamais posée est du poids mort — et, plus grave,
    // elle peut faire croire que le document contient une photo qu'il n'affiche
    // plus.
    let mut posees = vec![false; doc.images.len()];
    for page in &doc.pages {
        for operation in &page.ops {
            if let Op::Image { image, .. } = operation {
                if let Some(drapeau) = posees.get_mut(*image) {
                    *drapeau = true;
                }
            }
        }
    }
    for (rang, posee) in posees.iter().enumerate() {
        if !posee {
            let image = &doc.images[rang];
            sortie.push(Constat::document(
                Code::ImageEspaceInattendu,
                Gravite::Information,
                format!(
                    "l'image n°{rang} ({} × {} px) est embarquée mais posée nulle \
                     part : elle pèse {} sur le fichier sans être imprimée",
                    image.width(),
                    image.height(),
                    octets_lisibles(image.encoded_len())
                ),
            ));
        }
    }
}

// ─────────────────────────── profil de sortie ───────────────────────────

/// Le profil de sortie : sans lui, personne ne sait de quelle couleur le
/// fichier parle.
fn verifier_profil_sortie(doc: &Document, en_cours: &PageEnCours<'_>, sortie: &mut Vec<Constat>) {
    match &doc.output_intent {
        None => {
            if en_cours.regles.exiger_profil_sortie {
                sortie.push(Constat::document(
                    Code::ProfilSortieAbsent,
                    Gravite::Erreur,
                    "le document ne porte aucun profil de sortie alors qu'il est \
                     exigé : l'imprimeur ne peut pas savoir à quelle condition \
                     d'impression le fichier se rapporte",
                ));
            } else {
                sortie.push(Constat::document(
                    Code::ProfilSortieAbsent,
                    Gravite::Avertissement,
                    "le document ne porte aucun profil de sortie : les couleurs \
                     seront interprétées avec le profil par défaut de l'imprimeur, \
                     qui n'est peut-être pas le vôtre",
                ));
            }
        }
        Some(intent) => {
            // Le nombre de composantes doit correspondre à la quadri des pages.
            let quadri_attendue = match en_cours.quadri {
                QuadriSpace::Cmyk => 4u8,
                QuadriSpace::Rgb => 3u8,
            };
            if intent.components != quadri_attendue {
                sortie.push(Constat::document(
                    Code::ProfilSortieIncoherent,
                    Gravite::Erreur,
                    format!(
                        "le profil de sortie décrit {} composantes alors que les \
                         pages en utilisent {quadri_attendue} : l'imprimeur \
                         interprétera les couleurs dans le mauvais espace",
                        intent.components
                    ),
                ));
            }
            if intent.icc.is_empty() {
                sortie.push(Constat::document(
                    Code::ProfilSortieIncoherent,
                    Gravite::Erreur,
                    "le document déclare un profil de sortie mais n'en porte pas \
                     les octets : un lecteur ne pourra rien en faire",
                ));
            }
        }
    }
}

// ─────────────────────────── divers ───────────────────────────

/// Un nombre d'octets en clair : « 1,4 Mo », « 320 Ko ».
fn octets_lisibles(octets: usize) -> String {
    const KO: f64 = 1024.0;
    const MO: f64 = KO * 1024.0;
    let valeur = octets as f64;
    if valeur >= MO {
        format!("{:.1} Mo", valeur / MO)
    } else if valeur >= KO {
        format!("{:.0} Ko", valeur / KO)
    } else {
        format!("{octets} octets")
    }
}
