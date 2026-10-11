//! **Traits de coupe** — les repères qui disent au massicot où couper.
//!
//! Huit traits pour deux pages, plus quatre traits **intérieurs** en mode
//! « découpe page par page ». Chaque trait est **décalé** du format fini : il ne
//! touche jamais la zone imprimée, sinon il serait visible après rognage.
//!
//! ## Ce qui n'est pas dessiné, et pourquoi
//!
//! Le long de la **couture**, il n'y a ni trait horizontal (haut de la page
//! gauche, bas de la page gauche, haut et bas de la page droite) : ces bords sont
//! dans le pli, pas sur une coupe. Dessiner ces traits ferait apparaître des
//! marques au dos du pliage.
//!
//! ## Écart constaté entre les deux copies du produit
//!
//! `main.js` dessine ces traits à deux endroits : le chemin raster
//! (`renderImposedSheet`) et le chemin tons directs (`_spSpotDrawCropMarks`).
//! Les **coordonnées** sont identiques — c'est ce que ce module reproduit, et le
//! contrôle de parité le vérifie trait par trait. L'**épaisseur** ne l'est pas :
//! 0,08 mm d'un côté, 0,25 mm de l'autre. C'est exactement le genre d'écart
//! qu'une formule unique élimine ; l'épaisseur est donc un paramètre, et non une
//! constante cachée.

use super::plan::{Place, Reglages};

/// Un trait de coupe, dans le repère du média (millimètres, origine en haut à
/// gauche).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Segment {
    /// Abscisse du départ.
    pub x1: f64,
    /// Ordonnée du départ.
    pub y1: f64,
    /// Abscisse de l'arrivée.
    pub x2: f64,
    /// Ordonnée de l'arrivée.
    pub y2: f64,
    /// Épaisseur du trait.
    pub epaisseur_mm: f64,
}

impl Segment {
    /// Vrai si le trait est horizontal (ordonnées égales).
    #[must_use]
    pub fn est_horizontal(&self) -> bool {
        (self.y1 - self.y2).abs() < f64::EPSILON
    }

    /// Longueur euclidienne du trait.
    #[must_use]
    pub fn longueur(&self) -> f64 {
        let dx = self.x2 - self.x1;
        let dy = self.y2 - self.y1;
        (dx * dx + dy * dy).sqrt()
    }
}

/// Les traits de coupe des deux places.
///
/// L'ordre est celui du produit : page de gauche, puis page de droite, puis les
/// traits intérieurs — ce qui rend la comparaison avec `main.js` directe, trait
/// par trait, sans réordonner.
#[must_use]
pub fn reperes_de_coupe(places: &[Place; 2], r: &Reglages) -> Vec<Segment> {
    let long = r.longueur_repere_mm;
    let dec = r.decalage_repere_mm;
    let ep = r.epaisseur_repere_mm;

    let gauche = places[0];
    let droite = places[1];

    let gx = gauche.trim_x_mm();
    let gy = gauche.trim_y_mm();
    let g_droite = gauche.trim_droite_mm();
    let g_bas = gauche.trim_bas_mm();

    let dx = droite.trim_x_mm();
    let dy = droite.trim_y_mm();
    let d_droite = droite.trim_droite_mm();
    let d_bas = droite.trim_bas_mm();

    let mut traits = Vec::with_capacity(if r.decoupe_page_a_page { 16 } else { 12 });
    let mut pousser = |x1: f64, y1: f64, x2: f64, y2: f64| {
        traits.push(Segment {
            x1,
            y1,
            x2,
            y2,
            epaisseur_mm: ep,
        });
    };

    // ── Page de gauche ───────────────────────────────────────────────────
    // Coin haut-gauche : un trait horizontal vers l'extérieur, un vertical.
    pousser(gx - dec - long, gy, gx - dec, gy);
    pousser(gx, gy - dec - long, gx, gy - dec);
    // Coin haut-droit : vertical seulement — l'horizontal est dans la couture.
    pousser(g_droite, gy - dec - long, g_droite, gy - dec);
    // Coin bas-gauche.
    pousser(gx - dec - long, g_bas, gx - dec, g_bas);
    pousser(gx, g_bas + dec, gx, g_bas + dec + long);
    // Coin bas-droit : vertical seulement.
    pousser(g_droite, g_bas + dec, g_droite, g_bas + dec + long);

    // ── Page de droite ───────────────────────────────────────────────────
    // Coin haut-gauche : vertical seulement — l'horizontal est dans la couture.
    pousser(dx, dy - dec - long, dx, dy - dec);
    // Coin haut-droit.
    pousser(d_droite + dec, dy, d_droite + dec + long, dy);
    pousser(d_droite, dy - dec - long, d_droite, dy - dec);
    // Coin bas-gauche : vertical seulement.
    pousser(dx, d_bas + dec, dx, d_bas + dec + long);
    // Coin bas-droit.
    pousser(d_droite + dec, d_bas, d_droite + dec + long, d_bas);
    pousser(d_droite, d_bas + dec, d_droite, d_bas + dec + long);

    // ── Traits intérieurs (découpe page à page) ──────────────────────────
    // Chaque page est massicotée seule : il faut donc des repères **aussi** le
    // long de la gouttière, sinon le massicotin n'a rien à suivre et le fond
    // perdu intérieur est perdu.
    if r.decoupe_page_a_page {
        pousser(g_droite + dec, gy, g_droite + dec + long, gy);
        pousser(g_droite + dec, g_bas, g_droite + dec + long, g_bas);
        pousser(dx - dec - long, dy, dx - dec, dy);
        pousser(dx - dec - long, d_bas, dx - dec, d_bas);
    }

    traits
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Emplacement;

    fn plan_avec(r: Reglages) -> (Vec<Segment>, super::super::Plan) {
        let plan = super::super::Plan::nouveau(Emplacement::Page(1), Emplacement::Page(2), r);
        (plan.reperes.clone(), plan)
    }

    /// Douze traits par défaut : six par page, quatre coins chacune.
    #[test]
    fn douze_traits_par_defaut() {
        let (traits, _) = plan_avec(Reglages::default());
        assert_eq!(traits.len(), 12);
    }

    /// Seize traits en découpe page à page : les quatre intérieurs s'ajoutent.
    #[test]
    fn seize_traits_en_decoupe_page_a_page() {
        let (traits, _) = plan_avec(Reglages {
            decoupe_page_a_page: true,
            ..Reglages::default()
        });
        assert_eq!(traits.len(), 16);
    }

    /// Chaque trait mesure exactement la longueur demandée.
    #[test]
    fn chaque_trait_a_la_longueur_demandee() {
        let (traits, _) = plan_avec(Reglages::default());
        for trait_coupe in &traits {
            assert!(
                (trait_coupe.longueur() - 5.0).abs() < 1e-9,
                "trait de {} mm au lieu de 5",
                trait_coupe.longueur()
            );
        }
    }

    /// Aucun trait ne **touche** le format fini : le décalage est la règle, et
    /// un trait qui toucherait la zone imprimée serait visible après rognage.
    #[test]
    fn aucun_trait_ne_touche_le_format_fini() {
        let (traits, plan) = plan_avec(Reglages::default());
        let gauche = plan.places[0];
        let droite = plan.places[1];
        for trait_coupe in &traits {
            for (x, y) in [
                (trait_coupe.x1, trait_coupe.y1),
                (trait_coupe.x2, trait_coupe.y2),
            ] {
                let dans_gauche = x > gauche.trim_x_mm() + 1e-9
                    && x < gauche.trim_droite_mm() - 1e-9
                    && y > gauche.trim_y_mm() + 1e-9
                    && y < gauche.trim_bas_mm() - 1e-9;
                let dans_droite = x > droite.trim_x_mm() + 1e-9
                    && x < droite.trim_droite_mm() - 1e-9
                    && y > droite.trim_y_mm() + 1e-9
                    && y < droite.trim_bas_mm() - 1e-9;
                assert!(
                    !dans_gauche && !dans_droite,
                    "un trait de coupe entre dans le format fini ({x}, {y})"
                );
            }
        }
    }

    /// Tous les traits sont horizontaux **ou** verticaux : un trait oblique
    /// serait le signe d'une coordonnée mélangée.
    #[test]
    fn les_traits_sont_horizontaux_ou_verticaux() {
        let (traits, _) = plan_avec(Reglages::default());
        for trait_coupe in &traits {
            let horizontal = (trait_coupe.y1 - trait_coupe.y2).abs() < 1e-9;
            let vertical = (trait_coupe.x1 - trait_coupe.x2).abs() < 1e-9;
            assert!(horizontal || vertical, "trait oblique : {trait_coupe:?}");
        }
    }

    /// Les traits restent dans le média, quelle que soit la configuration : un
    /// repère hors de la feuille serait imprimé nulle part.
    #[test]
    fn les_traits_tiennent_dans_le_media() {
        let cas = [
            Reglages::default(),
            Reglages {
                decoupe_page_a_page: true,
                ..Reglages::default()
            },
            Reglages {
                inclure_fond_perdu: false,
                ..Reglages::default()
            },
            Reglages {
                inclure_fond_perdu: false,
                decoupe_page_a_page: true,
                ..Reglages::default()
            },
        ];
        for r in cas {
            let (traits, plan) = plan_avec(r);
            for trait_coupe in &traits {
                for (x, y) in [
                    (trait_coupe.x1, trait_coupe.y1),
                    (trait_coupe.x2, trait_coupe.y2),
                ] {
                    assert!(
                        x >= -1e-9
                            && x <= plan.feuille_largeur_mm + 1e-9
                            && y >= -1e-9
                            && y <= plan.feuille_hauteur_mm + 1e-9,
                        "{r:?} : trait hors du media en ({x}, {y}), media {}x{}",
                        plan.feuille_largeur_mm,
                        plan.feuille_hauteur_mm
                    );
                }
            }
        }
    }

    /// Les traits intérieurs n'existent **que** en découpe page à page : sans
    /// cette option, la couture ne se coupe pas et des traits y seraient des
    /// marques parasites au dos du pli.
    ///
    /// ⚠️ Ces traits **débordent** de la gouttière : ils font `décalage +
    /// longueur` = 7,5 mm alors que la gouttière n'en fait que 6 (deux fois le
    /// fond perdu). Ils mordent donc de 1,5 mm sur le fond perdu de la page
    /// voisine. C'est sans conséquence — cette bande est rognée — mais c'est la
    /// raison pour laquelle ils sont tracés **après** les pages, et non avant.
    #[test]
    fn les_traits_interieurs_n_existent_qu_en_decoupe_page_a_page() {
        let (sans, _) = plan_avec(Reglages::default());
        let (avec, plan) = plan_avec(Reglages {
            decoupe_page_a_page: true,
            ..Reglages::default()
        });
        assert_eq!(avec.len(), sans.len() + 4, "quatre traits interieurs");

        // Chaque trait intérieur atteint la gouttière : il y a bien quelque
        // chose à couper entre les deux pages.
        let gouttiere_debut = plan.places[0].trim_droite_mm();
        let gouttiere_fin = plan.places[1].trim_x_mm();
        assert!(
            gouttiere_fin > gouttiere_debut,
            "en decoupe page a page, une gouttiere separe les deux pages"
        );
        for trait_coupe in &avec[sans.len()..] {
            let atteint = [trait_coupe.x1, trait_coupe.x2]
                .iter()
                .any(|x| *x >= gouttiere_debut - 1e-9 && *x <= gouttiere_fin + 1e-9);
            assert!(
                atteint,
                "trait interieur qui n'atteint pas la gouttiere : {trait_coupe:?}"
            );
        }
    }

    /// Sans repères demandés, aucun trait n'est produit — pas même une liste
    /// vide calculée pour rien.
    #[test]
    fn sans_reperes_aucun_trait() {
        let (traits, _) = plan_avec(Reglages {
            reperes_de_coupe: false,
            ..Reglages::default()
        });
        assert!(traits.is_empty());
    }
}
