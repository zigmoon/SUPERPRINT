//! Produit un **PDF/X** complet, pour contrôle par un lecteur tiers.
//!
//! Cet exemple est la moitié Rust d'une preuve : `scripts/validate-pdfx.mjs`
//! relit le fichier produit avec `pdf-lib` (le lecteur emprunté au produit) et
//! vérifie, octet par octet, la déclaration de conformité et le profil embarqué.
//!
//! Usage :
//!
//! ```text
//! pdfx_dump <1a|3|4|-> <profil.icc|-> <date ISO 8601> <sortie.pdf>
//! ```
//!
//! `-` à la place de la conformité produit un fichier **sans** revendication
//! PDF/X (le cas témoin) ; `-` à la place du profil produit un fichier **sans**
//! `OutputIntent` (le cas que PDF/X doit refuser).

use std::env;
use std::fs;
use std::process::ExitCode;

use superprint_core::color::Cmyk;
use superprint_core::PageSize;
use superprint_pdf::colorspace::{ColorStack, QuadriSpace};
use superprint_pdf::document::{
    ColorValue, DocInfo, Document, Op, OutputIntent, Page, Paint, Path,
};
use superprint_pdf::Conformite;

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    if args.len() < 5 {
        eprintln!("usage : pdfx_dump <1a|3|4> <profil.icc|-> <date ISO> <sortie.pdf>");
        return ExitCode::from(2);
    }
    let conformite = match args[1].as_str() {
        "1a" => Some(Conformite::PdfX1a2001),
        "3" => Some(Conformite::PdfX3n2002),
        "4" => Some(Conformite::PdfX4),
        "-" => None,
        autre => {
            eprintln!("conformité inconnue : {autre}");
            return ExitCode::from(2);
        }
    };

    let mut doc = Document::new();
    doc.info = DocInfo {
        title: Some("Brochure & fond perdu".to_string()),
        author: Some("Atelier Dupont".to_string()),
        subject: Some("A4, fond perdu 3 mm, traits de coupe".to_string()),
        keywords: Some("pdfx, offset, quadri".to_string()),
        creator: Some("SuperPrint".to_string()),
        producer: Some("SuperPrint (noyau Rust)".to_string()),
        creation_date: Some(args[3].clone()),
    };

    if args[2] != "-" {
        let Ok(icc) = fs::read(&args[2]) else {
            eprintln!("profil illisible : {}", args[2]);
            return ExitCode::from(2);
        };
        /* Le profil est **lu** avant d'être embarqué : son espace donne le
        nombre de composantes, et sa classe décide s'il peut servir de sortie.
        Embarquer n'importe quel fichier qui commence par « acsp » serait le
        genre de faux PDF/X qu'un contrôle automatique rejette. */
        let profil = match superprint_icc::Profil::lire(&icc) {
            Ok(p) => p,
            Err(e) => {
                eprintln!("profil refusé : {e}");
                return ExitCode::from(2);
            }
        };
        if !profil.peut_servir_de_sortie() {
            eprintln!(
                "profil refusé : classe « {} », espace « {} » — ce n'est pas un profil de sortie",
                profil.classe, profil.espace
            );
            return ExitCode::from(2);
        }
        doc.output_intent = Some(OutputIntent {
            components: profil.espace.composantes(),
            identifier: profil.identifiant_de_condition(),
            info: profil.nom.clone(),
            icc,
        });
    }

    doc.pdfx = conformite;

    /* Une page A4 avec fond perdu, un aplat quadri qui déborde, et deux tons
    directs : de quoi occuper les contrôleurs de PDF/X. */
    let pile = ColorStack::new(QuadriSpace::Cmyk);
    let mut page = Page::new(PageSize::new(210.0, 297.0), 3.0, 10.0, pile);
    page.ops.push(Op::Fill {
        path: Path::Rect {
            x: -3.0,
            y: -3.0,
            width: 216.0,
            height: 303.0,
        },
        paint: Paint::Quadri(ColorValue::Cmyk(Cmyk {
            c: 0.0,
            m: 1.0,
            y: 1.0,
            k: 0.0,
        })),
    });
    page.ops.push(Op::Fill {
        path: Path::Rect {
            x: 20.0,
            y: 40.0,
            width: 170.0,
            height: 100.0,
        },
        paint: Paint::Quadri(ColorValue::Cmyk(Cmyk {
            c: 1.0,
            m: 0.0,
            y: 0.0,
            k: 0.0,
        })),
    });
    doc.add_page(page);

    match doc.write() {
        Ok(pdf) => {
            if let Err(e) = fs::write(&args[4], pdf) {
                eprintln!("écriture impossible : {e}");
                return ExitCode::from(1);
            }
            ExitCode::SUCCESS
        }
        Err(e) => {
            /* L'erreur part sur la sortie standard **et** en code de sortie : le
            script de contrôle doit pouvoir distinguer « refusé » de
            « produit ». */
            println!("refus\t{e}");
            ExitCode::from(3)
        }
    }
}
