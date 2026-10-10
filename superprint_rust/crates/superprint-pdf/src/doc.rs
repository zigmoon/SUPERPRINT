//! Assemblage d'un **PDF minimal** portant les tons directs.
//!
//! Ce module écrit un document PDF 1.7 d'**une page**, dont les ressources
//! déclarent la quadri et chaque encre directe comme un espace couleur
//! `/Separation`, et dont le flux de contenu peint une bande par canal — la
//! quadri puis une bande par encre. C'est le plus petit document qui prouve
//! qu'un ton direct **survit** jusqu'au fichier.
//!
//! Le fichier est assemblé **octet par octet**, table `xref` comprise : chaque
//! décalage d'objet est calculé pendant l'écriture, ce que les tests vérifient
//! en relisant la table.
//!
//! Les objets sont volontairement fixes :
//!
//! | N° | Objet |
//! |---|---|
//! | 1 | `/Catalog` |
//! | 2 | `/Pages` |
//! | 3 | `/Page` (boîtes + ressources couleur) |
//! | 4 | flux de contenu |
//!
//! Ce que ce module **ne fait pas encore** (voir `docs/PLAN.md`) : profils ICC,
//! `OutputIntent` PDF/X, polices, images, plusieurs pages, compression.

use superprint_core::PageSize;

use crate::boxes::PageBoxes;
use crate::colorspace::{ColorStack, QuadriSpace};

/// Numéro du premier objet libre dans la table `xref`.
const FIRST_OBJECT: usize = 1;

/// Construit le **flux de contenu** : une bande pleine largeur par canal
/// (la quadri, puis chaque encre directe), chacune peinte à pleine teinte.
fn content_stream(stack: &ColorStack, width: f64, height: f64) -> String {
    let bands = 1 + stack.spots().len();
    let band_height = height / bands as f64;

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

/// Écrit un PDF d'une page, au format `trim`, avec `bleed_mm` de fond perdu et
/// `mark_mm` de traits de coupe ; la page déclare la [`ColorStack`] donnée.
///
/// Renvoie les octets complets du fichier.
#[must_use]
pub fn write_spot_page(trim: PageSize, bleed_mm: f64, mark_mm: f64, stack: &ColorStack) -> Vec<u8> {
    let boxes = PageBoxes::from_page(trim, bleed_mm, mark_mm);
    let content = content_stream(stack, boxes.media.width(), boxes.media.height());

    let mut out: Vec<u8> = Vec::new();
    // En-tête + commentaire binaire (signale un fichier non-texte aux outils).
    out.extend_from_slice(b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");

    // offsets[numero] = décalage en octets ; l'index 0 reste l'entrée libre.
    let mut offsets: Vec<usize> = vec![0];

    let push_object = |out: &mut Vec<u8>, offsets: &mut Vec<usize>, body: &str| {
        offsets.push(out.len());
        out.extend_from_slice(body.as_bytes());
    };

    push_object(
        &mut out,
        &mut offsets,
        "1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n",
    );

    push_object(
        &mut out,
        &mut offsets,
        "2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n",
    );

    let page_body = format!(
        "3 0 obj\n<< /Type /Page /Parent 2 0 R {} /Resources << /ColorSpace {} >> /Contents 4 0 R >>\nendobj\n",
        boxes.boxes_entries(),
        stack.resources_pdf(),
    );
    push_object(&mut out, &mut offsets, &page_body);

    // Flux de contenu : la longueur annoncée est le nombre EXACT d'octets écrits.
    let content_bytes = content.as_bytes();
    offsets.push(out.len());
    out.extend_from_slice(
        format!("4 0 obj\n<< /Length {} >>\nstream\n", content_bytes.len()).as_bytes(),
    );
    out.extend_from_slice(content_bytes);
    out.extend_from_slice(b"\nendstream\nendobj\n");

    // Table xref : une entrée de 20 octets par objet, la première libre.
    let xref_offset = out.len();
    let count = offsets.len();
    out.extend_from_slice(format!("xref\n0 {count}\n").as_bytes());
    out.extend_from_slice(b"0000000000 65535 f\r\n");
    for (number, offset) in offsets.iter().enumerate().skip(FIRST_OBJECT) {
        out.extend_from_slice(format!("{offset:010} 00000 n\r\n").as_bytes());
        debug_assert_eq!(
            format!("{offset:010} 00000 n\r\n").len(),
            20,
            "entrée xref {number} de taille invalide"
        );
    }

    out.extend_from_slice(
        format!("trailer\n<< /Size {count} /Root 1 0 R >>\nstartxref\n{xref_offset}\n%%EOF\n")
            .as_bytes(),
    );

    out
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
}
