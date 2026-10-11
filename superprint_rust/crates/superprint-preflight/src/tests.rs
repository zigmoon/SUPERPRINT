//! Tests du prépresse : chaque contrôle doit **détecter** ce qu'il cherche, et
//! **ne pas** signaler ce qui est correct.
//!
//! Les deux moitiés comptent autant. Un contrôle qui ne détecte rien ne sert à
//! rien ; un contrôle qui signale tout le temps se fait désactiver, et devient
//! aussi inutile — en pire, parce qu'il aura fait perdre la confiance.

use super::*;
use superprint_core::{Cmyk, PageSize};
use superprint_pdf::colorspace::{ColorStack, QuadriSpace};
use superprint_pdf::document::{ColorValue, Document, Op, Page, Paint, Path};
use superprint_pdf::image::{ImageFilter, ImageXObject};

/// Une page A4 dont le fond perdu et la réserve de repères sont réglables.
fn page_a4(bleed_mm: f64, mark_mm: f64, quadri: QuadriSpace) -> Page {
    let stack = ColorStack::new(quadri);
    Page::new(PageSize::new(210.0, 297.0), bleed_mm, mark_mm, stack)
}

fn document_avec(page: Page) -> Document {
    let mut doc = Document::new();
    doc.add_page(page);
    doc
}

/// Un document qui porte **une vraie police**, pour les tests qui posent du
/// texte : sans police, un texte est à juste titre une erreur, et le test
/// mesurerait cette erreur-là au lieu de ce qu'il cherche.
fn document_avec_police(page: Page) -> Document {
    let mut doc = Document::new();
    doc.add_font(police());
    doc.add_page(page);
    doc
}

fn police() -> superprint_font::FontFace {
    superprint_font::FontFace::parse(superprint_font::synth::construire(
        &superprint_font::synth::PoliceSynth::default(),
    ))
    .expect("police synthétique lisible")
}

/// Un document **sain** : une page correcte **et** un profil de sortie.
///
/// Le profil compte : sans lui, le contrôle signale — à juste titre — que
/// personne ne sait de quelle couleur le fichier parle. Un test qui l'omettrait
/// mesurerait ce constat-là au lieu de vérifier qu'il n'y a rien d'autre.
fn document_sain() -> Document {
    let mut doc = document_avec(page_a4(3.0, 5.0, QuadriSpace::Cmyk));
    doc.output_intent = Some(superprint_pdf::document::OutputIntent {
        icc: vec![0u8; 128],
        components: 4,
        identifier: "test".to_string(),
        info: "profil de test".to_string(),
    });
    doc
}

fn regles_permissives() -> Regles {
    Regles {
        // Les tests qui ne portent pas sur un contrôle doivent pouvoir l'ignorer
        // sans bruit : on part donc de règles qui n'exigent presque rien.
        exiger_fond_perdu: false,
        exiger_reperes: false,
        exiger_profil_sortie: false,
        signaler_texte_vivant: false,
        ..Regles::default()
    }
}

fn vide(regles: &Regles) -> bool {
    verifier(&document_sain(), regles).is_empty()
}

// ─────────────────────────── gravité et rapport ───────────────────────────

#[test]
fn un_document_sain_ne_produit_aucun_constat() {
    assert!(
        vide(&regles_permissives()),
        "un document correct ne doit rien signaler : {:?}",
        verifier(&document_sain(), &regles_permissives())
    );
}

#[test]
fn un_document_sans_page_est_une_erreur() {
    let rapport = Rapport::nouveau(verifier(&Document::new(), &Regles::default()));
    assert!(rapport.contient(Code::DocumentVide));
    assert!(!rapport.acceptable());
}

#[test]
fn le_rapport_est_trie_par_gravite_decroissante() {
    let constats = vec![
        Constat::document(Code::TexteVivant, Gravite::Information, "info"),
        Constat::page(Code::DocumentVide, Gravite::Erreur, 1, "erreur"),
        Constat::page(
            Code::FondPerduAbsent,
            Gravite::Avertissement,
            2,
            "avertissement",
        ),
    ];
    let rapport = Rapport::nouveau(constats);
    assert_eq!(rapport.constats[0].gravite, Gravite::Erreur);
    assert_eq!(rapport.constats[1].gravite, Gravite::Avertissement);
    assert_eq!(rapport.constats[2].gravite, Gravite::Information);
    // Et à gravité égale, par page croissante : on lit un rapport de haut en
    // bas, page par page.
    let deux = Rapport::nouveau(vec![
        Constat::page(Code::FondPerduAbsent, Gravite::Avertissement, 5, "cinq"),
        Constat::page(Code::FondPerduAbsent, Gravite::Avertissement, 2, "deux"),
    ]);
    assert_eq!(deux.constats[0].page, Some(2));
}

#[test]
fn un_avertissement_ne_bloque_pas_un_fichier() {
    let rapport = Rapport::nouveau(vec![Constat::page(
        Code::FondPerduAbsent,
        Gravite::Avertissement,
        1,
        "pas de fond perdu",
    )]);
    assert!(
        rapport.acceptable(),
        "bloquer sur un avertissement pousserait a ignorer les avertissements"
    );
}

#[test]
fn un_code_peut_etre_ignore() {
    let mut rapport = Rapport::nouveau(vec![
        Constat::page(Code::FondPerduAbsent, Gravite::Avertissement, 1, "a"),
        Constat::page(Code::DocumentVide, Gravite::Erreur, 1, "b"),
    ]);
    rapport.ignorer(Code::FondPerduAbsent);
    assert_eq!(rapport.constats.len(), 1);
    assert!(rapport.contient(Code::DocumentVide));
}

#[test]
fn le_resume_dit_la_gravite_et_la_page() {
    let rapport = Rapport::nouveau(vec![Constat::page(
        Code::ImageBasseResolution,
        Gravite::Erreur,
        3,
        "une image est trop basse",
    )]);
    let texte = rapport.resume();
    assert!(texte.contains("Erreur"), "{texte}");
    assert!(texte.contains("page 3"), "{texte}");
    assert!(texte.contains("une image est trop basse"), "{texte}");
}

#[test]
fn un_rapport_vide_le_dit_avec_des_mots() {
    let rapport = Rapport::vide();
    assert!(rapport.acceptable());
    assert!(rapport.resume().contains("prêt"));
}

// ─────────────────────────── fond perdu ───────────────────────────

#[test]
fn le_fond_perdu_absent_est_signale_quand_il_est_exige() {
    let regles = Regles::default();
    let rapport = Rapport::nouveau(verifier(
        &document_avec(page_a4(0.0, 5.0, QuadriSpace::Cmyk)),
        &regles,
    ));
    assert!(rapport.contient(Code::FondPerduAbsent), "{rapport}");
}

#[test]
fn les_reperes_sans_reserve_sont_signales() {
    let regles = Regles {
        exiger_reperes: true,
        ..regles_permissives()
    };
    let rapport = Rapport::nouveau(verifier(
        &document_avec(page_a4(3.0, 0.0, QuadriSpace::Cmyk)),
        &regles,
    ));
    assert!(rapport.contient(Code::ReperesSansReserve), "{rapport}");
    assert!(
        !rapport.acceptable(),
        "des reperes exiges sans reserve bloquent"
    );
}

#[test]
fn une_reserve_de_reperes_trop_courte_est_signalee() {
    let regles = regles_permissives();
    // 3 mm de réserve : un trait de coupe en demande 5.
    let rapport = Rapport::nouveau(verifier(
        &document_avec(page_a4(3.0, 3.0, QuadriSpace::Cmyk)),
        &regles,
    ));
    assert!(rapport.contient(Code::ReperesSansReserve), "{rapport}");
}

// ─────────────────────────── résolution d'image ───────────────────────────

/// Une image uni de la taille demandée, avec des pixels non triviaux.
fn image_unie(largeur: u32, hauteur: u32) -> ImageXObject {
    let donnees: Vec<u8> = (0..largeur * hauteur * 3)
        .map(|i| (i % 251) as u8)
        .collect();
    let image = superprint_image::RgbImage::from_data(largeur, hauteur, donnees).unwrap();
    ImageXObject::from_rgb(&image, ImageFilter::None)
}

#[test]
fn une_image_floue_est_signalee_avec_ses_deux_nombres() {
    let mut doc = Document::new();
    let rang = doc.add_image(image_unie(400, 300));
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Image {
        image: rang,
        x: 10.0,
        y: 10.0,
        // 400 px sur 120 mm = 84,7 dpi — loin des 300 demandés.
        width: 120.0,
        height: 90.0,
    });
    doc.add_page(page);

    let rapport = Rapport::nouveau(verifier(&doc, &regles_permissives()));
    assert!(rapport.contient(Code::ImageBasseResolution), "{rapport}");
    let constat = &rapport.par_code(Code::ImageBasseResolution)[0];
    // Les DEUX nombres : la valeur mesurée et le seuil. Sans eux, l'auteur ne
    // peut pas juger si l'écart est acceptable.
    assert!(constat.message.contains("85 dpi"), "{}", constat.message);
    assert!(constat.message.contains("300 dpi"), "{}", constat.message);
    assert!(
        constat.message.contains("120.0 × 90.0 mm"),
        "la taille posée doit être citée : {}",
        constat.message
    );
}

#[test]
fn une_image_a_la_bonne_resolution_n_est_pas_signalee() {
    let mut doc = Document::new();
    // 25,4 mm font exactement un pouce, donc 300 px sur 25,4 mm font exactement
    // 300 dpi. On choisit volontairement une valeur **ronde** : c'est le seul
    // moyen de tester la frontière sans se battre avec l'arrondi.
    //
    // Et on garde l'image **petite** (300 × 300 px, pas 3 000 × 3 000) : le seul
    // nombre qui compte pour le contrôle est le rapport pixels / millimètres, et
    // une image de 27 Mo ferait tomber le noyau de test WASI (mémoire linéaire
    // plafonnée) au lieu de tester le contrôle. On veut tester le contrôle.
    let rang = doc.add_image(image_unie(300, 300));
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Image {
        image: rang,
        x: 0.0,
        y: 0.0,
        width: 25.4,
        height: 25.4,
    });
    doc.add_page(page);
    let rapport = Rapport::nouveau(verifier(&doc, &regles_permissives()));
    assert!(!rapport.contient(Code::ImageBasseResolution), "{rapport}");
}

/// La frontière est **exacte**, et c'est voulu : aucun pourcentage de tolérance
/// caché. Ce test le verrouille, parce que c'est exactement le genre de chose
/// qu'on assouplit un jour sans s'en rendre compte.
#[test]
fn la_frontiere_de_resolution_est_exacte() {
    // 248 px sur 21 mm : 299,96 dpi. Juste sous 300 → signalé.
    // L'échelle est dix fois plus petite que la réalité (2 480 px sur 210 mm),
    // mais le rapport pixels / millimètres est **identique**, donc le calcul l'est
    // aussi — et l'image ne fait plus 18 Mo.
    let mut doc = Document::new();
    let rang = doc.add_image(image_unie(248, 248));
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Image {
        image: rang,
        x: 0.0,
        y: 0.0,
        width: 21.0,
        height: 21.0,
    });
    doc.add_page(page);
    let rapport = Rapport::nouveau(verifier(&doc, &regles_permissives()));
    assert!(
        rapport.contient(Code::ImageBasseResolution),
        "299,96 dpi est sous 300 : le controle doit le dire, sans tolerance cachee : {rapport}"
    );
    let constat = &rapport.par_code(Code::ImageBasseResolution)[0];
    assert!(constat.message.contains("300 dpi"), "{}", constat.message);
}

#[test]
fn la_dimension_la_plus_mauvaise_decide() {
    let mut doc = Document::new();
    // 300 px de large, 30 px de haut ; posée sur 21 × 21 mm.
    // Horizontal : 363 dpi (bon). Vertical : 36 dpi (catastrophique).
    // Mêmes rapports qu'une image de 3 000 × 300 px sur 210 × 210 mm, pour dix
    // fois moins de mémoire.
    let rang = doc.add_image(image_unie(300, 30));
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Image {
        image: rang,
        x: 0.0,
        y: 0.0,
        width: 21.0,
        height: 21.0,
    });
    doc.add_page(page);
    let rapport = Rapport::nouveau(verifier(&doc, &regles_permissives()));
    let constat = &rapport.par_code(Code::ImageBasseResolution)[0];
    assert!(
        constat.message.contains("36 dpi"),
        "le coté étiré doit décider, pas le bon : {}",
        constat.message
    );
}

#[test]
fn une_image_tres_basse_resolution_est_une_erreur_pas_un_avertissement() {
    let mut doc = Document::new();
    let rang = doc.add_image(image_unie(100, 100));
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Image {
        image: rang,
        x: 0.0,
        y: 0.0,
        width: 200.0,
        height: 200.0,
    });
    doc.add_page(page);
    let rapport = Rapport::nouveau(verifier(&doc, &regles_permissives()));
    let constat = &rapport.par_code(Code::ImageBasseResolution)[0];
    // 100 px sur 200 mm = 12,7 dpi : moins de 60 % du seuil.
    assert_eq!(constat.gravite, Gravite::Erreur);
}

#[test]
fn une_image_posee_avec_un_rang_inexistant_est_une_erreur() {
    let mut doc = Document::new();
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Image {
        image: 7,
        x: 0.0,
        y: 0.0,
        width: 10.0,
        height: 10.0,
    });
    doc.add_page(page);
    let rapport = Rapport::nouveau(verifier(&doc, &regles_permissives()));
    assert_eq!(rapport.constats[0].gravite, Gravite::Erreur);
    assert!(!rapport.acceptable());
}

// ─────────────────────────── couleurs ───────────────────────────

fn cmyk(c: f64, m: f64, y: f64, k: f64) -> Paint {
    Paint::Quadri(ColorValue::Cmyk(Cmyk { c, m, y, k }))
}

#[test]
fn une_couverture_d_encre_excessive_est_signalee() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    // 100 + 90 + 90 + 80 = 360 % : bien au-delà de 300.
    page.push(Op::Fill {
        path: Path::Rect {
            x: 0.0,
            y: 0.0,
            width: 210.0,
            height: 297.0,
        },
        paint: cmyk(1.0, 0.9, 0.9, 0.8),
    });
    let rapport = Rapport::nouveau(verifier(&document_avec(page), &regles_permissives()));
    assert!(
        rapport.contient(Code::CouvertureEncreExcessive),
        "{rapport}"
    );
    let constat = &rapport.par_code(Code::CouvertureEncreExcessive)[0];
    assert!(constat.message.contains("360 %"), "{}", constat.message);
    assert!(constat.message.contains("300 %"), "{}", constat.message);
    // 360 > 300 × 1,1 = 330 : c'est une erreur, pas un avertissement.
    assert_eq!(constat.gravite, Gravite::Erreur);
}

#[test]
fn un_depassement_leger_d_encre_reste_un_avertissement() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    // 310 % : dépasse, mais de peu.
    page.push(Op::Fill {
        path: Path::Rect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        },
        paint: cmyk(0.8, 0.8, 0.8, 0.7),
    });
    let rapport = Rapport::nouveau(verifier(&document_avec(page), &regles_permissives()));
    let constat = &rapport.par_code(Code::CouvertureEncreExcessive)[0];
    assert!(constat.message.contains("310 %"), "{}", constat.message);
    assert_eq!(constat.gravite, Gravite::Avertissement);
    assert!(
        rapport.acceptable(),
        "un depassement leger peut etre accepte"
    );
}

#[test]
fn une_couverture_normale_n_est_pas_signalee() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    // 0/0/0/100 : un noir pur, 100 %.
    page.push(Op::Fill {
        path: Path::Rect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        },
        paint: cmyk(0.0, 0.0, 0.0, 1.0),
    });
    let rapport = Rapport::nouveau(verifier(&document_avec(page), &regles_permissives()));
    assert!(
        !rapport.contient(Code::CouvertureEncreExcessive),
        "{rapport}"
    );
}

#[test]
fn le_noir_quadrichrome_sur_texte_fin_est_signale() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Text {
        font: 0,
        size_pt: 8.0,
        x: 10.0,
        y: 100.0,
        paint: cmyk(0.6, 0.5, 0.5, 1.0),
        text: "petit texte".to_string(),
    });
    let regles = Regles {
        exiger_profil_sortie: false,
        ..regles_permissives()
    };
    let rapport = Rapport::nouveau(verifier(&document_avec_police(page), &regles));
    assert!(
        rapport.contient(Code::NoirQuadrichromeSurTexteFin),
        "{rapport}"
    );
    let constat = &rapport.par_code(Code::NoirQuadrichromeSurTexteFin)[0];
    assert!(constat.message.contains("8.0 pt"), "{}", constat.message);
}

#[test]
fn un_texte_en_noir_pur_n_est_pas_signale() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Text {
        font: 0,
        size_pt: 8.0,
        x: 10.0,
        y: 100.0,
        // 0/0/0/100 : du noir seul, parfaitement correct sur du texte fin.
        paint: cmyk(0.0, 0.0, 0.0, 1.0),
        text: "petit texte".to_string(),
    });
    let rapport = Rapport::nouveau(verifier(&document_avec_police(page), &regles_permissives()));
    assert!(
        !rapport.contient(Code::NoirQuadrichromeSurTexteFin),
        "{rapport}"
    );
}

#[test]
fn un_texte_en_noir_quadrichrome_mais_gros_n_est_pas_signale() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Text {
        font: 0,
        size_pt: 36.0,
        x: 10.0,
        y: 100.0,
        paint: cmyk(0.6, 0.5, 0.5, 1.0),
        text: "GROS TITRE".to_string(),
    });
    let rapport = Rapport::nouveau(verifier(&document_avec_police(page), &regles_permissives()));
    assert!(
        !rapport.contient(Code::NoirQuadrichromeSurTexteFin),
        "au-dessus du seuil de corps, un noir riche est un choix de l'auteur : {rapport}"
    );
}

#[test]
fn un_gris_fonce_avec_un_peu_de_soutien_n_est_pas_du_noir_riche() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Text {
        font: 0,
        size_pt: 8.0,
        x: 10.0,
        y: 100.0,
        // 5/5/5/90 : un noir normal. On ne va pas le denoncer.
        paint: cmyk(0.05, 0.05, 0.05, 0.9),
        text: "petit texte".to_string(),
    });
    let rapport = Rapport::nouveau(verifier(&document_avec_police(page), &regles_permissives()));
    assert!(
        !rapport.contient(Code::NoirQuadrichromeSurTexteFin),
        "{rapport}"
    );
}

#[test]
fn une_encre_directe_n_est_pas_jugee_comme_du_quadri() {
    // Une encre directe a sa propre plaque : il n'y a pas de reperage a craindre
    // entre canaux. Le noir quadrichrome ne la concerne pas.
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Fill {
        path: Path::Rect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        },
        paint: Paint::Spot {
            index: 0,
            tint: 1.0,
        },
    });
    let rapport = Rapport::nouveau(verifier(&document_avec(page), &regles_permissives()));
    assert!(
        !rapport.contient(Code::CouvertureEncreExcessive),
        "{rapport}"
    );
}

// ─────────────────────────── débordement ───────────────────────────

#[test]
fn un_objet_dans_le_fond_perdu_n_est_pas_signale() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    // Un aplat plein format qui mord de 2 mm dans le fond perdu : c'est
    // exactement ce qu'on lui demande.
    page.push(Op::Fill {
        path: Path::Rect {
            x: -2.0,
            y: -2.0,
            width: 214.0,
            height: 301.0,
        },
        paint: cmyk(0.0, 0.0, 0.0, 1.0),
    });
    let rapport = Rapport::nouveau(verifier(&document_avec(page), &regles_permissives()));
    assert!(
        !rapport.contient(Code::DebordementFondPerdu),
        "mordre dans le fond perdu est le role du fond perdu : {rapport}"
    );
}

#[test]
fn un_objet_au_dela_du_fond_perdu_est_signale() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    // 20 mm au-delà du bord : coupé à l'impression, personne ne le verra avant.
    page.push(Op::Fill {
        path: Path::Rect {
            x: 200.0,
            y: 0.0,
            width: 50.0,
            height: 50.0,
        },
        paint: cmyk(0.0, 0.0, 0.0, 1.0),
    });
    let rapport = Rapport::nouveau(verifier(&document_avec(page), &regles_permissives()));
    assert!(rapport.contient(Code::DebordementFondPerdu), "{rapport}");
    let constat = &rapport.par_code(Code::DebordementFondPerdu)[0];
    assert!(constat.message.contains("à droite"), "{}", constat.message);
    // Le rectangle va de 200 à 250 mm ; la zone imprimable s'arrête à
    // 210 + 3 = 213 mm. Le dépassement vaut donc 37 mm.
    assert!(constat.message.contains("37.0 mm"), "{}", constat.message);
    assert!(
        constat.message.contains("213"),
        "le message doit citer la limite, pas seulement l'ecart : {}",
        constat.message
    );
    assert!(
        constat.message.contains("250.0"),
        "le message doit citer le bord reellement atteint : {}",
        constat.message
    );
}

#[test]
fn la_boite_englobante_couvre_toutes_les_formes() {
    // Le calcul de boîte est la base du contrôle de débordement : une forme
    // oubliée dans le `match` passerait tous les contrôles en silence.
    let cas = [
        Path::Rect {
            x: 1.0,
            y: 2.0,
            width: 3.0,
            height: 4.0,
        },
        Path::Circle {
            cx: 0.0,
            cy: 0.0,
            radius: 5.0,
        },
        Path::Line {
            x1: -1.0,
            y1: -2.0,
            x2: 3.0,
            y2: 4.0,
        },
        Path::Polygon(vec![(0.0, 0.0), (10.0, 0.0), (10.0, 5.0), (-2.0, 5.0)]),
    ];
    for path in &cas {
        let (gauche, bas, droite, haut) =
            boite_englobante(path).unwrap_or_else(|| panic!("boite absente pour {path:?}"));
        assert!(gauche <= droite, "{path:?}");
        assert!(bas <= haut, "{path:?}");
    }
    // Et une boîte vide ne panique pas.
    assert!(boite_englobante(&Path::Polygon(Vec::new())).is_none());
}

// ─────────────────────────── polices ───────────────────────────

#[test]
fn un_texte_renvoyant_a_une_police_absente_est_une_erreur() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Text {
        font: 3,
        size_pt: 12.0,
        x: 10.0,
        y: 100.0,
        paint: cmyk(0.0, 0.0, 0.0, 1.0),
        text: "texte".to_string(),
    });
    let rapport = Rapport::nouveau(verifier(&document_avec(page), &regles_permissives()));
    assert!(rapport.contient(Code::PoliceNonEmbarquee), "{rapport}");
    assert!(
        !rapport.acceptable(),
        "un texte sans police ne s'imprime pas"
    );
}

#[test]
fn le_texte_vivant_est_une_information_jamais_un_blocage() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    page.push(Op::Text {
        font: 0,
        size_pt: 12.0,
        x: 10.0,
        y: 100.0,
        paint: cmyk(0.0, 0.0, 0.0, 1.0),
        text: "texte vivant".to_string(),
    });
    let regles = Regles {
        signaler_texte_vivant: true,
        ..regles_permissives()
    };
    let rapport = Rapport::nouveau(verifier(&document_avec_police(page), &regles));
    let constats = rapport.par_code(Code::TexteVivant);
    assert_eq!(constats.len(), 1, "{rapport}");
    assert_eq!(constats[0].gravite, Gravite::Information);
    assert!(
        rapport.acceptable(),
        "le texte vivant est une intention de l'auteur, pas une propriete du fichier"
    );
}

#[test]
fn le_texte_vivant_n_est_signale_qu_une_fois_par_page() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    for index in 0..5 {
        page.push(Op::Text {
            font: 0,
            size_pt: 12.0,
            x: 10.0,
            y: 100.0 + f64::from(index),
            paint: cmyk(0.0, 0.0, 0.0, 1.0),
            text: format!("ligne {index}"),
        });
    }
    let regles = Regles {
        signaler_texte_vivant: true,
        ..regles_permissives()
    };
    let rapport = Rapport::nouveau(verifier(&document_avec_police(page), &regles));
    assert_eq!(
        rapport.par_code(Code::TexteVivant).len(),
        1,
        "un constat par page suffit, sinon le rapport devient illisible"
    );
}

// ─────────────────────────── profil de sortie ───────────────────────────

#[test]
fn le_profil_de_sortie_absent_est_une_erreur_quand_il_est_exige() {
    let regles = Regles {
        exiger_profil_sortie: true,
        ..regles_permissives()
    };
    let rapport = Rapport::nouveau(verifier(
        &document_avec(page_a4(3.0, 5.0, QuadriSpace::Cmyk)),
        &regles,
    ));
    let constat = &rapport.par_code(Code::ProfilSortieAbsent)[0];
    assert_eq!(constat.gravite, Gravite::Erreur);
}

#[test]
fn le_profil_de_sortie_absent_est_un_avertissement_sinon() {
    let rapport = Rapport::nouveau(verifier(
        &document_avec(page_a4(3.0, 5.0, QuadriSpace::Cmyk)),
        &regles_permissives(),
    ));
    let constat = &rapport.par_code(Code::ProfilSortieAbsent)[0];
    assert_eq!(constat.gravite, Gravite::Avertissement);
    assert!(
        rapport.acceptable(),
        "sans profil, le fichier s'imprime quand meme : avertissement, pas erreur"
    );
}

#[test]
fn un_profil_incoherent_avec_la_quadri_est_une_erreur() {
    let mut doc = document_avec(page_a4(3.0, 5.0, QuadriSpace::Cmyk));
    doc.output_intent = Some(superprint_pdf::document::OutputIntent {
        icc: vec![1, 2, 3],
        // 3 composantes (RVB) alors que les pages sont en CMJN (4).
        components: 3,
        identifier: "test".to_string(),
        info: "test".to_string(),
    });
    let rapport = Rapport::nouveau(verifier(&doc, &regles_permissives()));
    assert!(rapport.contient(Code::ProfilSortieIncoherent), "{rapport}");
    assert!(!rapport.acceptable());
}

// ─────────────────────────── règles ───────────────────────────

#[test]
fn les_regles_par_defaut_sont_celles_de_l_offset_couche() {
    let regles = Regles::default();
    assert_eq!(regles.dpi_mini_image, 300.0);
    assert_eq!(regles.dpi_mini_trace, 1200.0);
    assert_eq!(regles.couverture_encre_max_pourcent, 300.0);
    assert!(regles.coherentes());
}

#[test]
fn les_regles_du_journal_sont_plus_serrees_sur_l_encre() {
    let journal = Regles::journal();
    let defaut = Regles::default();
    assert!(
        journal.couverture_encre_max_pourcent < defaut.couverture_encre_max_pourcent,
        "le papier journal boit : la limite baisse"
    );
    assert!(journal.coherentes());
}

#[test]
fn les_regles_du_numerique_sont_plus_larges() {
    let numerique = Regles::numerique();
    assert!(numerique.dpi_mini_image < Regles::default().dpi_mini_image);
    assert!(
        numerique.couverture_encre_max_pourcent > Regles::default().couverture_encre_max_pourcent
    );
    assert!(numerique.coherentes());
}

#[test]
fn des_regles_absurdes_sont_refusees() {
    let absurde = Regles {
        dpi_mini_image: 0.0,
        ..Regles::default()
    };
    assert!(!absurde.coherentes());

    let inverse = Regles {
        dpi_mini_image: 600.0,
        dpi_mini_trace: 300.0,
        ..Regles::default()
    };
    assert!(
        !inverse.coherentes(),
        "exiger plus d'une photo que d'un trait n'a pas de sens"
    );
}

#[test]
fn les_regles_du_journal_changent_les_constats() {
    let mut page = page_a4(3.0, 5.0, QuadriSpace::Cmyk);
    // 280 % : accepté en offset (300), refusé sur papier journal (240).
    page.push(Op::Fill {
        path: Path::Rect {
            x: 0.0,
            y: 0.0,
            width: 10.0,
            height: 10.0,
        },
        paint: cmyk(0.7, 0.7, 0.7, 0.7),
    });
    let doc = document_avec(page);

    let offset = Rapport::nouveau(verifier(&doc, &regles_permissives()));
    assert!(!offset.contient(Code::CouvertureEncreExcessive), "{offset}");

    let journal = Rapport::nouveau(verifier(
        &doc,
        &Regles {
            exiger_fond_perdu: false,
            ..Regles::journal()
        },
    ));
    assert!(
        journal.contient(Code::CouvertureEncreExcessive),
        "les memes pixels, un autre imprimeur : {journal}"
    );
}

// ─────────────────────────── lecture des règles ───────────────────────────

#[test]
fn les_regles_se_lisent_depuis_un_texte() {
    let regles = Regles::lire(
        "# un commentaire, et une ligne vide suivent\n\
         \n\
         !preset\tjournal\n\
         !encre\t260\n\
         !exiger\tprofil\t1",
    )
    .expect("regles lisibles");
    assert_eq!(regles.couverture_encre_max_pourcent, 260.0);
    assert_eq!(regles.corps_texte_fin_pt, 14.0, "le préréglage journal");
    assert!(regles.exiger_profil_sortie);
    assert!(regles.coherentes());
}

#[test]
fn les_regles_par_defaut_se_lisent_depuis_un_texte_vide() {
    // Un texte sans aucune ligne donne les valeurs par défaut : c'est ce qui
    // permet à un appelant de ne pas configurer du tout.
    assert_eq!(Regles::lire("").expect("vide = defauts"), Regles::default());
    assert_eq!(
        Regles::lire("\n\n# rien\n").expect("commentaires seuls"),
        Regles::default()
    );
    // Et le préréglage explicite mène au même endroit.
    assert_eq!(Regles::lire("!preset\toffset").unwrap(), Regles::default());
}

#[test]
fn une_cle_de_regle_inconnue_est_refusee() {
    // Ignorer une clé inconnue laisserait croire que la règle demandée
    // s'applique alors qu'elle ne s'applique pas — et un contrôle qu'on croit
    // actif est pire qu'un contrôle absent.
    for texte in [
        "!inconnue\t1",
        "!image",
        "!image\tbeaucoup",
        "!preset\tbidon",
        "!exiger\tfond\t2",
        "!exiger\tautre\t1",
        "!texte\toui",
    ] {
        assert!(
            Regles::lire(texte).is_none(),
            "« {texte} » doit etre refuse"
        );
    }
}

#[test]
fn des_regles_absurdes_sont_refusees_a_la_lecture() {
    // Le refus arrive au moment de la **lecture**, pas au moment du contrôle :
    // un appelant qui a lu ses règles sait qu'elles tiennent debout.
    for texte in ["!image\t0", "!image\t600\n!trace\t300", "!encre\t-1"] {
        let regles = Regles::lire(texte);
        assert!(
            regles.is_none(),
            "« {texte} » donne des regles absurdes, il faut le refuser"
        );
    }
}

// ─────────────────────────── rapport en texte ───────────────────────────

#[test]
fn le_rapport_en_texte_est_machine_lisible() {
    let rapport = Rapport::nouveau(vec![
        Constat::document(Code::ProfilSortieAbsent, Gravite::Avertissement, "profil"),
        Constat::page(Code::ImageBasseResolution, Gravite::Erreur, 3, "image"),
    ]);
    let texte = rapport.texte();
    let lignes: Vec<&str> = texte.lines().collect();

    assert_eq!(lignes[0], "!acceptable\t0");
    // Erreurs, puis avertissements, puis informations.
    assert_eq!(lignes[1], "!compte\t1\t1\t0");
    // Le plus grave d'abord : la même règle de tri que le résumé humain.
    assert_eq!(lignes[2], "!constat\timage-basse-resolution\t2\t3\timage");
    assert_eq!(lignes[3], "!constat\tprofil-sortie-absent\t1\t0\tprofil");
}

#[test]
fn le_rapport_en_texte_dit_quand_tout_va_bien() {
    let texte = Rapport::vide().texte();
    assert!(texte.starts_with("!acceptable\t1"));
    assert!(texte.contains("!compte\t0\t0\t0"));
    assert_eq!(texte.lines().count(), 2, "aucun constat : {texte}");
}

#[test]
fn le_message_du_rapport_est_toujours_le_dernier_champ() {
    // Un lecteur qui découpe sur les trois premiers séparateurs et garde le
    // reste ne peut pas se tromper — c'est la raison de ce choix de format.
    let rapport = Rapport::nouveau(vec![Constat::page(
        Code::ImageEspaceInattendu,
        Gravite::Information,
        7,
        "un message qui contient 3 chiffres, une virgule, et meme un — tiret",
    )]);
    let ligne = rapport
        .texte()
        .lines()
        .find(|l| l.starts_with("!constat"))
        .expect("une ligne de constat")
        .to_string();
    let champs: Vec<&str> = ligne.splitn(5, '\t').collect();
    assert_eq!(champs[1], "image-espace-inattendu");
    assert_eq!(champs[2], "0");
    assert_eq!(champs[3], "7");
    assert_eq!(
        champs[4],
        "un message qui contient 3 chiffres, une virgule, et meme un — tiret"
    );
}
