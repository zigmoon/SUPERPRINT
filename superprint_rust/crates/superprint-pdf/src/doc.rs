//! Assemblage d'un **PDF** portant les tons directs — et, en option, une image.
//!
//! Ce module écrit un document PDF 1.7 d'**une page**, dont les ressources
//! déclarent la quadri et chaque encre directe comme un espace couleur
//! `/Separation`, et dont le flux de contenu peint une bande par canal — la
//! quadri puis une bande par encre. C'est le plus petit document qui prouve
//! qu'un ton direct **survit** jusqu'au fichier.
//!
//! Deux entrées :
//!
//! - [`write_spot_page`] — les tons directs seuls (4 objets) ;
//! - [`write_spot_page_with_image`] — les mêmes tons directs **plus une image
//!   XObject** (5 objets), peinte sur toute la page. C'est le chemin qui
//!   démontre la correction du défaut « PDF de 131 Mo » : l'image arrive ici
//!   déjà **réduite** et **compressée**.
//!
//! Le fichier est assemblé **octet par octet**, table `xref` comprise : chaque
//! décalage d'objet est calculé pendant l'écriture, ce que les tests vérifient
//! en relisant la table.
//!
//! Ce que ce module **ne fait pas encore** (voir `docs/PLAN.md`) : profils ICC,
//! `OutputIntent` PDF/X, polices, plusieurs pages, `/FlateDecode` et
//! `/DCTDecode`.

use superprint_core::units::mm_to_pt;
use superprint_core::PageSize;

use crate::boxes::PageBoxes;
use crate::colorspace::{ColorStack, QuadriSpace};
use crate::image::ImageXObject;

/// Numéro du premier objet libre dans la table `xref`.
const FIRST_OBJECT: usize = 1;

/// Hauteur des bandes de contrôle des tons directs, en millimètres.
///
/// Assez fines pour laisser voir l'image, assez larges pour qu'une bande soit
/// identifiable sur une sortie papier.
const BAND_MM: f64 = 6.0;

/// Assemble un document à partir de ses **corps d'objets**, numérotés dans
/// l'ordre d'ajout (1, 2, 3…).
///
/// Écrire les objets dans l'ordre des numéros simplifie tout : la table `xref`
/// se remplit linéairement, sans trou ni tri.
#[derive(Default)]
struct PdfWriter {
    bodies: Vec<Vec<u8>>,
}

impl PdfWriter {
    /// Ajoute un objet simple et renvoie son numéro.
    fn add_object(&mut self, body: String) -> usize {
        self.bodies.push(body.into_bytes());
        self.bodies.len()
    }

    /// Ajoute un **flux** dont la longueur annoncée est la longueur réelle.
    fn add_stream(&mut self, entries: &str, data: &[u8]) -> usize {
        let head = if entries.is_empty() {
            format!("<< /Length {} >>\n", data.len())
        } else {
            format!("<< {entries} /Length {} >>\n", data.len())
        };
        let mut body = head.into_bytes();
        body.extend_from_slice(b"stream\n");
        body.extend_from_slice(data);
        body.extend_from_slice(b"\nendstream\n");
        self.bodies.push(body);
        self.bodies.len()
    }

    /// Écrit le fichier complet : en-tête, objets, table `xref`, `trailer`.
    fn finish(self, root: usize) -> Vec<u8> {
        let mut out: Vec<u8> = Vec::new();
        // En-tête + commentaire binaire (signale un fichier non-texte aux outils).
        out.extend_from_slice(b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");

        // offsets[numero] = décalage en octets ; l'index 0 reste l'entrée libre.
        let mut offsets: Vec<usize> = vec![0];
        for (index, body) in self.bodies.iter().enumerate() {
            let number = index + 1;
            offsets.push(out.len());
            out.extend_from_slice(format!("{number} 0 obj\n").as_bytes());
            out.extend_from_slice(body);
            out.extend_from_slice(b"endobj\n");
        }

        // Table xref : une entrée de 20 octets par objet, la première libre.
        let xref_offset = out.len();
        let count = offsets.len();
        out.extend_from_slice(format!("xref\n0 {count}\n").as_bytes());
        out.extend_from_slice(b"0000000000 65535 f\r\n");
        for (number, offset) in offsets.iter().enumerate().skip(FIRST_OBJECT) {
            let entry = format!("{offset:010} 00000 n\r\n");
            debug_assert_eq!(entry.len(), 20, "entrée xref {number} de taille invalide");
            out.extend_from_slice(entry.as_bytes());
        }

        out.extend_from_slice(
            format!(
                "trailer\n<< /Size {count} /Root {root} 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n"
            )
            .as_bytes(),
        );

        out
    }
}

/// Construit les bandes de contrôle : une bande pleine largeur par canal
/// (la quadri, puis chaque encre directe), chacune peinte à pleine teinte, en
/// bas de page.
fn bands_ops(stack: &ColorStack, width: f64, band_height: f64) -> String {
    let mut ops = String::new();

    // Bande de la quadri (index 0, en bas).
    let quadri_color = match stack.quadri() {
        QuadriSpace::Cmyk => "0 0 0 1".to_string(), // noir CMJN
        QuadriSpace::Rgb => "0.2 0.2 0.2".to_string(),
    };
    ops.push_str(&format!(
        "/{} cs\n{quadri_color} scn\n0 0 {width} {band_height} re\nf\n",
        ColorStack::quadri_cs_name()
    ));

    // Une bande par encre directe, à pleine teinte (1 scn).
    for (index, _ink) in stack.spots().iter().enumerate() {
        let y = (index + 1) as f64 * band_height;
        ops.push_str(&format!(
            "/{} cs\n1 scn\n0 {y} {width} {band_height} re\nf\n",
            ColorStack::spot_cs_name(index)
        ));
    }

    ops
}

/// Construit le **flux de contenu** des tons directs seuls : la page divisée en
/// bandes pleine largeur, une par canal de couleur.
fn content_stream(stack: &ColorStack, width: f64, height: f64) -> String {
    let bands = 1 + stack.spots().len();
    bands_ops(stack, width, height / bands as f64)
}

/// Le corps de la page, commun aux deux documents.
fn page_body(boxes: &PageBoxes, resources: &str, content: usize) -> String {
    format!(
        "<< /Type /Page /Parent 2 0 R {} /Resources << {resources} >> /Contents {content} 0 R >>\n",
        boxes.boxes_entries(),
    )
}

/// Écrit un PDF d'une page, au format `trim`, avec `bleed_mm` de fond perdu et
/// `mark_mm` de traits de coupe ; la page déclare la [`ColorStack`] donnée.
///
/// Renvoie les octets complets du fichier.
#[must_use]
pub fn write_spot_page(trim: PageSize, bleed_mm: f64, mark_mm: f64, stack: &ColorStack) -> Vec<u8> {
    let boxes = PageBoxes::from_page(trim, bleed_mm, mark_mm);
    let content = content_stream(stack, boxes.media.width(), boxes.media.height());

    let mut writer = PdfWriter::default();
    let catalog = writer.add_object("<< /Type /Catalog /Pages 2 0 R >>\n".to_string());
    let _pages = writer.add_object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n".to_string());
    // La page est écrite après : on réserve son numéro par un corps vide.
    let page_slot = writer.bodies.len();
    writer.add_object(String::new());
    let content_ref = writer.add_stream("", content.as_bytes());

    let resources = format!("/ColorSpace {}", stack.resources_pdf());
    writer.bodies[page_slot] = page_body(&boxes, &resources, content_ref).into_bytes();

    writer.finish(catalog)
}

/// Écrit un PDF d'une page portant **une image** et les bandes de contrôle des
/// tons directs.
///
/// L'image est peinte sur toute la page ; les bandes de contrôle
/// ([`BAND_MM`] de haut, une par canal) sont peintes **par-dessus**, en bas.
///
/// L'appelant doit avoir **réduit** l'image avant de la confier ici : ce
/// module l'encode, il ne devine pas la résolution utile.
#[must_use]
pub fn write_spot_page_with_image(
    trim: PageSize,
    bleed_mm: f64,
    mark_mm: f64,
    stack: &ColorStack,
    image: &ImageXObject,
) -> Vec<u8> {
    let boxes = PageBoxes::from_page(trim, bleed_mm, mark_mm);
    let width = boxes.media.width();
    let height = boxes.media.height();

    // L'image occupe la page entière : le carré unité est mis à l'échelle.
    let mut content = String::from("q\n");
    content.push_str(&format!("{width} 0 0 {height} 0 0 cm\n/Im0 Do\nQ\n"));
    content.push_str(&bands_ops(stack, width, mm_to_pt(BAND_MM)));

    let mut writer = PdfWriter::default();
    let catalog = writer.add_object("<< /Type /Catalog /Pages 2 0 R >>\n".to_string());
    let _pages = writer.add_object("<< /Type /Pages /Kids [3 0 R] /Count 1 >>\n".to_string());
    let page_slot = writer.bodies.len();
    writer.add_object(String::new());
    let content_ref = writer.add_stream("", content.as_bytes());
    let image_ref = writer.add_stream(&image.dict_entries(), image.data());

    let resources = format!(
        "/ColorSpace {} /XObject << /Im0 {image_ref} 0 R >>",
        stack.resources_pdf()
    );
    writer.bodies[page_slot] = page_body(&boxes, &resources, content_ref).into_bytes();

    writer.finish(catalog)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spot::{AlternateSpace, SpotInk};
    use superprint_core::{Cmyk, Rgb};

    fn stack_with_two_pantones() -> ColorStack {
        let red = SpotInk::new(
            "PANTONE WARM RED C",
            AlternateSpace::Cmyk(Cmyk {
                c: 0.0,
                m: 0.9,
                y: 0.8,
                k: 0.0,
            }),
        )
        .unwrap();
        let violet = SpotInk::new(
            "PANTONE VIOLET C",
            AlternateSpace::Cmyk(Cmyk {
                c: 0.7,
                m: 1.0,
                y: 0.0,
                k: 0.1,
            }),
        )
        .unwrap();
        ColorStack::with_spots(QuadriSpace::Cmyk, [red, violet]).unwrap()
    }

    #[test]
    fn en_tete_et_pied_conformes() {
        let pdf = write_spot_page(
            PageSize::new(170.0, 240.0),
            3.0,
            10.0,
            &stack_with_two_pantones(),
        );
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.starts_with("%PDF-1.7"));
        assert!(text.trim_end().ends_with("%%EOF"));
    }

    #[test]
    fn les_tons_directs_sont_dans_le_fichier() {
        // C'est LA preuve du défaut P0-1 corrigé : deux /Separation présents.
        let pdf = write_spot_page(
            PageSize::new(170.0, 240.0),
            3.0,
            10.0,
            &stack_with_two_pantones(),
        );
        let text = String::from_utf8_lossy(&pdf);
        let separations = text.matches("/Separation").count();
        assert_eq!(separations, 2, "deux plaques Pantone attendues");
        assert!(text.contains("/PANTONE#20WARM#20RED#20C"));
        assert!(text.contains("/PANTONE#20VIOLET#20C"));
    }

    #[test]
    fn une_bande_par_canal_dans_le_flux() {
        let pdf = write_spot_page(
            PageSize::new(170.0, 240.0),
            0.0,
            0.0,
            &stack_with_two_pantones(),
        );
        let text = String::from_utf8_lossy(&pdf);
        // 1 quadri + 2 encres = 3 sélections de couleur (`cs`).
        assert_eq!(text.matches(" cs\n").count(), 3);
    }

    /// Cherche une sous-chaîne d'octets et renvoie son décalage.
    fn find_bytes(hay: &[u8], needle: &[u8]) -> Option<usize> {
        hay.windows(needle.len()).position(|w| w == needle)
    }

    /// Découpe une tranche d'octets sur `\n` (les `\r` de fin sont retirés).
    fn lines_bytes(data: &[u8]) -> Vec<Vec<u8>> {
        data.split(|&b| b == b'\n')
            .map(|line| {
                if line.ends_with(b"\r") {
                    line[..line.len() - 1].to_vec()
                } else {
                    line.to_vec()
                }
            })
            .collect()
    }

    #[test]
    fn la_table_xref_pointe_les_bons_objets() {
        let pdf = write_spot_page(
            PageSize::new(210.0, 297.0),
            3.0,
            5.0,
            &stack_with_two_pantones(),
        );

        // Tout se lit sur les OCTETS : le commentaire binaire de l'en-tête
        // (%âãÏÓ) ferait dériver tout décalage calculé sur une chaîne « lossy ».
        let marker = b"startxref\n";
        let start = find_bytes(&pdf, marker).expect("startxref présent") + marker.len();
        let number_end = pdf[start..]
            .iter()
            .position(|&b| b == b'\n')
            .expect("fin du nombre");
        let xref_offset: usize = std::str::from_utf8(&pdf[start..start + number_end])
            .unwrap()
            .trim()
            .parse()
            .expect("décalage xref entier");

        // 1) startxref doit pointer sur le mot « xref ».
        assert_eq!(
            &pdf[xref_offset..xref_offset + 4],
            b"xref",
            "startxref doit pointer sur la table"
        );

        // 2) En-tête de la table : « 0 N ».
        let lines = lines_bytes(&pdf[xref_offset..]);
        assert_eq!(lines[0], b"xref");
        let count: usize = std::str::from_utf8(&lines[1])
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();

        // 3) Chaque entrée pointe bien sur « <n> 0 obj ».
        let mut entries: Vec<&Vec<u8>> = Vec::new();
        for index in 0..count {
            entries.push(&lines[2 + index]);
        }
        assert_eq!(entries[0], b"0000000000 65535 f");
        for (number, entry) in entries.iter().enumerate().skip(FIRST_OBJECT) {
            let offset: usize = std::str::from_utf8(entry)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap()
                .parse()
                .unwrap();
            let expected = format!("{number} 0 obj");
            assert!(
                pdf[offset..].starts_with(expected.as_bytes()),
                "l'objet {number} n'est pas à son décalage ({offset})"
            );
        }
    }

    #[test]
    fn longueur_du_flux_exacte() {
        let pdf = write_spot_page(
            PageSize::new(100.0, 100.0),
            0.0,
            0.0,
            &stack_with_two_pantones(),
        );

        let length_marker = b"/Length ";
        let start = find_bytes(&pdf, length_marker).unwrap() + length_marker.len();
        let number_end = pdf[start..].iter().position(|&b| b == b' ').unwrap();
        let declared: usize = std::str::from_utf8(&pdf[start..start + number_end])
            .unwrap()
            .parse()
            .unwrap();

        // Le corps est exactement ce qui suit « stream\n » et précède « \nendstream ».
        let stream_marker = b"stream\n";
        let body_start = find_bytes(&pdf, stream_marker).unwrap() + stream_marker.len();
        let end_marker = b"\nendstream";
        let body_end = find_bytes(&pdf[body_start..], end_marker).unwrap() + body_start;
        assert_eq!(declared, body_end - body_start);
    }

    #[test]
    fn quadri_rvb_donne_un_pdf_valide_structurellement() {
        let green = SpotInk::new("Vert signal", AlternateSpace::Rgb(Rgb::new(0, 128, 64))).unwrap();
        let stack = ColorStack::with_spots(QuadriSpace::Rgb, [green]).unwrap();
        let pdf = write_spot_page(PageSize::new(170.0, 240.0), 3.0, 10.0, &stack);
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/CSQuadri /DeviceRGB"));
        assert!(text.contains("/Separation /Vert#20signal /DeviceRGB"));
    }

    /// Un aplat RVB uni de la taille demandée.
    fn aplat(width: u32, height: u32) -> superprint_image::RgbImage {
        let data = vec![255u8; superprint_image::RgbImage::expected_len(width, height)];
        superprint_image::RgbImage::from_data(width, height, data).expect("aplat cohérent")
    }

    #[test]
    fn une_page_sans_image_compte_quatre_objets() {
        let pdf = write_spot_page(
            PageSize::new(170.0, 240.0),
            3.0,
            10.0,
            &stack_with_two_pantones(),
        );
        let text = String::from_utf8_lossy(&pdf);
        // 4 objets + l'entrée libre n° 0.
        assert!(
            text.contains("xref\n0 5\n"),
            "table xref attendue à 5 lignes"
        );
        assert!(text.contains("/Size 5"));
        assert!(!text.contains("/Subtype /Image"));
    }

    #[test]
    fn une_image_ajoute_un_cinquieme_objet() {
        let image = aplat(4, 4);
        let xobject = crate::image::ImageXObject::from_rgb(&image, crate::image::ImageFilter::Auto);
        let pdf = write_spot_page_with_image(
            PageSize::new(170.0, 240.0),
            3.0,
            10.0,
            &stack_with_two_pantones(),
            &xobject,
        );
        let text = String::from_utf8_lossy(&pdf);

        // 5 objets + l'entrée libre n° 0.
        assert!(
            text.contains("xref\n0 6\n"),
            "table xref attendue à 6 lignes"
        );
        assert!(text.contains("/Size 6"));
        // L'image est l'objet 5 et la page la référence.
        assert!(text.contains("/Im0 5 0 R"), "ressource XObject absente");
        assert!(text.contains("/Subtype /Image"));
        assert!(text.contains("/Width 4"));
        assert!(text.contains("/Height 4"));
        assert!(text.contains("/ColorSpace /DeviceRGB"));
        // Les tons directs survivent à l'ajout de l'image.
        assert_eq!(text.matches("/Separation").count(), 2);
        // L'image est peinte, puis les bandes de contrôle par-dessus.
        assert!(text.contains("cm\n/Im0 Do"));
    }

    #[test]
    fn le_flux_de_l_image_est_plus_petit_que_les_pixels() {
        // C'est l'invariant anti-« PDF de 131 Mo » : un aplat ne doit JAMAIS
        // être écrit au prix de ses pixels bruts.
        let image = aplat(64, 64);
        let xobject = crate::image::ImageXObject::from_rgb(&image, crate::image::ImageFilter::Auto);
        let pdf = write_spot_page_with_image(
            PageSize::new(170.0, 240.0),
            0.0,
            0.0,
            &stack_with_two_pantones(),
            &xobject,
        );

        assert!(
            xobject.encoded_len() < xobject.raw_len(),
            "aplat non compressé : {} vs {}",
            xobject.encoded_len(),
            xobject.raw_len()
        );
        assert!(
            pdf.len() < xobject.raw_len(),
            "le PDF ({}) dépasse les pixels bruts ({})",
            pdf.len(),
            xobject.raw_len()
        );
    }

    #[test]
    fn la_table_xref_reste_valide_avec_une_image() {
        let image = aplat(8, 8);
        let xobject = crate::image::ImageXObject::from_rgb(&image, crate::image::ImageFilter::Auto);
        let pdf = write_spot_page_with_image(
            PageSize::new(210.0, 297.0),
            3.0,
            5.0,
            &stack_with_two_pantones(),
            &xobject,
        );

        let marker = b"startxref\n";
        let start = find_bytes(&pdf, marker).expect("startxref présent") + marker.len();
        let number_end = pdf[start..]
            .iter()
            .position(|&b| b == b'\n')
            .expect("fin du nombre");
        let xref_offset: usize = std::str::from_utf8(&pdf[start..start + number_end])
            .unwrap()
            .trim()
            .parse()
            .expect("décalage xref entier");
        assert_eq!(&pdf[xref_offset..xref_offset + 4], b"xref");

        let lines = lines_bytes(&pdf[xref_offset..]);
        let count: usize = std::str::from_utf8(&lines[1])
            .unwrap()
            .split_whitespace()
            .nth(1)
            .unwrap()
            .parse()
            .unwrap();
        assert_eq!(count, 6, "5 objets + l'entrée libre");

        for (number, entry) in lines[2..2 + count].iter().enumerate().skip(FIRST_OBJECT) {
            let offset: usize = std::str::from_utf8(entry)
                .unwrap()
                .split_whitespace()
                .next()
                .unwrap()
                .parse()
                .unwrap();
            assert!(
                pdf[offset..].starts_with(format!("{number} 0 obj").as_bytes()),
                "l'objet {number} n'est pas à son décalage ({offset})"
            );
        }
    }
}
