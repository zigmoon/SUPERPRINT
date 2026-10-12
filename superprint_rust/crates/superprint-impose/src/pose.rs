//! **Où chaque page se pose**, et jusqu'où son encre a le droit d'aller.
//!
//! ## Le problème que ce module résout
//!
//! Imposer, c'est charger une page entière — fond perdu compris — sur une
//! planche, à un endroit précis, puis **rogner** ce qui dépasse. Deux nombres
//! suffisent à décrire chaque place, et ils sont de nature différente :
//!
//! - **la pose** : où le rendu de la page se pose. C'est le coin haut-gauche de
//!   la zone chargée, qui porte le fond perdu des quatre côtés ;
//! - **la zone autorisée** : où l'encre a le droit d'aller. C'est le format fini
//!   élargi du fond perdu **imprimé** — et rien de plus, parce que ce qui dépasse
//!   du fond perdu finit sur la page voisine ou dans la marge technique.
//!
//! ## La règle de la couture, en une phrase
//!
//! Quand les deux pages ne sont pas découpées séparément, elles se touchent :
//! chacune garde son fond perdu sur le bord **extérieur** de la planche, et le
//! perd sur le bord **intérieur** — sinon les deux fonds perdus intérieurs se
//! recouvrent et l'un des deux dessine par-dessus l'autre. Le mode « découpe
//! page par page » ajoute une gouttière de `2 × fond perdu` et **garde** les
//! quatre fonds perdus de chaque page : c'est ce qui permet de couper les pages
//! après impression et d'avoir un raccord net.
//!
//! ## D'où viennent ces formules
//!
//! Elles sont écrites une fois dans `main.js` — `buildImposedSheetCanvas`, dont
//! les décalages passés à `loadOnePage` et les bornes `clipX0`…`clipY1` sont des
//! expressions affines — et **une seconde fois ici**, en millimètres.
//! `scripts/validate-imposition.mjs` extrait ces expressions du produit, les
//! évalue, et exige l'égalité : la parité n'est pas supposée, elle est mesurée.
//!
//! ⚠️ Le produit calcule en **pixels de document**, et son document est à
//! **72 dpi** (`mmToPx = mm × 72 / 25,4`, `main.js`). Un pixel y vaut donc
//! exactement un point PostScript, et la conversion vers les millimètres est
//! exacte — ce qui permet de comparer les deux au millionième de millimètre au
//! lieu de tolérer une demi-résolution.

use crate::plan::{Place, Plan, Reglages};

/// Le côté d'une planche.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cote {
    /// La place de gauche : le dos d'un livret, ou la première page d'une
    /// planche recto.
    Gauche,
    /// La place de droite.
    Droite,
}

impl Cote {
    /// L'autre côté.
    #[must_use]
    pub fn autre(self) -> Self {
        match self {
            Self::Gauche => Self::Droite,
            Self::Droite => Self::Gauche,
        }
    }
}

/// La pose d'une page sur la planche, en millimètres, dans le repère du
/// **média** : origine au coin haut-gauche de la feuille, `y` vers le bas.
///
/// C'est le repère de l'application, et celui dans lequel un rendu (un canevas,
/// une image) se place naturellement. L'exporteur PDF convertit en repère PDF
/// (`y` vers le haut) par [`Plan::vers_format_fini`], à un seul endroit.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Pose {
    /// Le côté occupé.
    pub cote: Cote,
    /// Abscisse du coin haut-gauche de la zone chargée — la page dessinée avec
    /// son fond perdu sur ses quatre côtés.
    pub x_mm: f64,
    /// Ordonnée du même coin.
    pub y_mm: f64,
    /// **Zone autorisée**, `(gauche, haut, droite, bas)` : l'encre qui sort de
    /// là n'a pas le droit d'être écrite.
    ///
    /// Elle peut dépasser le média quand un fond perdu est déclaré mais non
    /// imprimé — c'est la zone *chargée* qui déborde, pas l'encre gardée, et la
    /// zone autorisée, elle, reste dans le média. C'est la propriété testée.
    pub zone_mm: (f64, f64, f64, f64),
}

impl Pose {
    /// Largeur de la zone autorisée.
    #[must_use]
    pub fn largeur_zone_mm(&self) -> f64 {
        self.zone_mm.2 - self.zone_mm.0
    }

    /// Hauteur de la zone autorisée.
    #[must_use]
    pub fn hauteur_zone_mm(&self) -> f64 {
        self.zone_mm.3 - self.zone_mm.1
    }

    /// Le point du repère du média est-il dans la zone autorisée ?
    #[must_use]
    pub fn contient(&self, x_mm: f64, y_mm: f64) -> bool {
        let (gauche, haut, droite, bas) = self.zone_mm;
        x_mm >= gauche && x_mm <= droite && y_mm >= haut && y_mm <= bas
    }
}

impl Place {
    /// La pose de cette place, pour le côté donné.
    #[must_use]
    pub fn pose(&self, reglages: &Reglages, cote: Cote) -> Pose {
        // Le fond perdu **imprimé** : quand l'utilisateur n'en veut pas, la zone
        // en porte quand même un — elle est rendue à partir des objets du
        // document — mais l'encre est coupée au format fini.
        let imprime = reglages.fond_perdu_effectif_mm();
        let mut gauche = self.trim_x_mm() - imprime;
        let mut droite = self.trim_droite_mm() + imprime;
        if !reglages.decoupe_page_a_page {
            // Les deux pages se touchent : le bord intérieur s'arrête au trait.
            match cote {
                Cote::Gauche => droite = self.trim_droite_mm(),
                Cote::Droite => gauche = self.trim_x_mm(),
            }
        }
        Pose {
            cote,
            x_mm: self.x_mm,
            y_mm: self.y_mm,
            zone_mm: (
                gauche,
                self.trim_y_mm() - imprime,
                droite,
                self.trim_bas_mm() + imprime,
            ),
        }
    }
}

impl Plan {
    /// Les deux poses de la planche : la gauche, puis la droite.
    #[must_use]
    pub fn poses(&self) -> [Pose; 2] {
        [
            self.places[0].pose(&self.reglages, Cote::Gauche),
            self.places[1].pose(&self.reglages, Cote::Droite),
        ]
    }

    /// Le repère du **format fini** de la planche : origine au coin
    /// inférieur-gauche du format imposé, `y` vers le haut, en millimètres.
    ///
    /// C'est le repère que `superprint-pdf` attend pour ses opérations de
    /// dessin. La conversion se fait **ici et nulle part ailleurs** : le plan
    /// pense en repère d'application, le PDF en repère d'imprimeur, et un seul
    /// endroit fait le pont.
    #[must_use]
    pub fn vers_format_fini(&self, x_mm: f64, y_mm: f64) -> (f64, f64) {
        let (gauche, haut, _, hauteur) = self.format_fini_mm();
        // Le bas du format imposé, dans le repère du média (où `y` descend) :
        // c'est lui qui devient l'origine des ordonnées du PDF.
        (x_mm - gauche, haut + hauteur - y_mm)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Emplacement;

    fn a4() -> Reglages {
        Reglages::default()
    }

    /// A4, fond perdu 3 mm, repères : la pose de gauche commence à la marge,
    /// et la zone autorisée va du format fini élargi de 3 mm jusqu'à la couture.
    #[test]
    fn la_pose_a4_avec_fond_perdu() {
        let plan = Plan::nouveau(Emplacement::Page(1), Emplacement::Page(2), a4());
        let [gauche, droite] = plan.poses();

        // Marge 10, fond perdu imprimé 3, fond perdu du document 3 :
        // `x = 10 + 3 − 3 = 10`.
        assert_eq!(gauche.x_mm, 10.0);
        assert_eq!(gauche.y_mm, 10.0);
        // Le format fini va de 13 à 223 ; la zone autorisée de 10 à 223 : le
        // fond perdu extérieur (10..13) est gardé, le fond perdu intérieur est
        // coupé au trait.
        assert_eq!(gauche.zone_mm, (10.0, 10.0, 223.0, 313.0));
        // La place de droite est symétrique : sa zone va de 223 à 436.
        assert_eq!(droite.x_mm, 220.0);
        assert_eq!(droite.zone_mm, (223.0, 10.0, 436.0, 313.0));
    }

    /// La zone autorisée est exactement le format fini élargi de `fond perdu`
    /// **aux quatre coins** : c'est la propriété qui décrit la règle entière.
    #[test]
    fn la_zone_est_le_format_fini_elargi_du_fond_perdu_imprime() {
        for config in configurations() {
            let plan = Plan::nouveau(Emplacement::Page(1), Emplacement::Page(2), config);
            let poses = plan.poses();
            let imprime = config.fond_perdu_effectif_mm();
            let couture = !config.decoupe_page_a_page;
            for (rang, cote) in [Cote::Gauche, Cote::Droite].into_iter().enumerate() {
                let pose = &poses[rang];
                let place = &plan.places[rang];
                // Le bord EXTÉRIEUR de la planche garde le fond perdu ; le bord
                // INTÉRIEUR s'arrête au trait quand les pages se touchent.
                let attendu_gauche = if couture && cote == Cote::Droite {
                    place.trim_x_mm()
                } else {
                    place.trim_x_mm() - imprime
                };
                let attendu_droite = if couture && cote == Cote::Gauche {
                    place.trim_droite_mm()
                } else {
                    place.trim_droite_mm() + imprime
                };
                assert_eq!(
                    pose.zone_mm,
                    (
                        attendu_gauche,
                        place.trim_y_mm() - imprime,
                        attendu_droite,
                        place.trim_bas_mm() + imprime,
                    )
                );
            }
            // Les deux zones ne se recouvrent pas plus que la couture.
            if couture {
                assert_eq!(poses[0].zone_mm.2, poses[1].zone_mm.0);
            }
        }
    }

    /// Sans fond perdu imprimé, l'encre est coupée **au format fini**, et la
    /// zone chargée, elle, déborde du média : c'est le comportement du produit,
    /// et il n'est pas un défaut — le rognage est exact.
    #[test]
    fn sans_fond_perdu_imprime_la_zone_est_le_format_fini() {
        let reglages = Reglages {
            inclure_fond_perdu: false,
            ..a4()
        };
        let plan = Plan::nouveau(Emplacement::Page(1), Emplacement::Page(2), reglages);
        let [gauche, droite] = plan.poses();
        // Le média fait 2 × 210 + 2 × 10 de marge : le format fini commence donc
        // à 10 mm — la marge — et non à 13 : sans fond perdu imprimé, la marge
        // technique est ce qui sépare le format du bord du papier.
        assert_eq!(plan.feuille_largeur_mm, 440.0);
        assert_eq!(gauche.zone_mm, (10.0, 10.0, 220.0, 307.0));
        assert_eq!(droite.zone_mm, (220.0, 10.0, 430.0, 307.0));
        // La zone chargée, elle, commence 3 mm avant le média : elle déborde.
        assert_eq!(gauche.x_mm, 7.0);
        assert_eq!(droite.x_mm, 217.0);
        // Et malgré ce débordement, l'encre gardée tient dans le média.
        assert!(gauche.zone_mm.0 >= 0.0 && droite.zone_mm.2 <= plan.feuille_largeur_mm);
        assert_eq!(plan.places[0].trim_x_mm(), 10.0);
    }

    /// La gouttière : chaque page garde ses quatre fonds perdus, et la planche
    /// s'élargit de `2 × fond perdu`.
    #[test]
    fn la_decoupe_page_a_page_garde_les_quatre_fonds_perdus() {
        let reglages = Reglages {
            decoupe_page_a_page: true,
            ..a4()
        };
        let plan = Plan::nouveau(Emplacement::Page(1), Emplacement::Page(2), reglages);
        let [gauche, droite] = plan.poses();
        assert_eq!(plan.feuille_largeur_mm, 452.0, "446 + 2 × 3 de gouttière");
        assert_eq!(gauche.zone_mm, (10.0, 10.0, 226.0, 313.0));
        assert_eq!(droite.zone_mm, (226.0, 10.0, 442.0, 313.0));
        // Les deux zones se touchent exactement : aucune bande morte.
        assert_eq!(gauche.zone_mm.2, droite.zone_mm.0);
    }

    /// Les repères ne changent pas la pose ; ils changent la taille du média.
    #[test]
    fn sans_reperes_la_pose_glisse_avec_la_marge() {
        let reglages = Reglages {
            reperes_de_coupe: false,
            ..a4()
        };
        let plan = Plan::nouveau(Emplacement::Page(1), Emplacement::Page(2), reglages);
        let [gauche, _] = plan.poses();
        assert_eq!(plan.feuille_largeur_mm, 426.0);
        assert_eq!(gauche.x_mm, 0.0, "plus de marge technique");
        assert_eq!(gauche.zone_mm, (0.0, 0.0, 213.0, 303.0));
        assert_eq!(plan.places[0].trim_x_mm(), 3.0);
    }

    /// La conversion vers le repère du PDF : le coin haut-gauche du média
    /// devient le coin haut-gauche du format imposé, et `y` s'inverse.
    #[test]
    fn le_repere_du_format_fini_inverse_y() {
        let plan = Plan::nouveau(Emplacement::Page(1), Emplacement::Page(2), a4());
        let (gauche, haut, largeur, hauteur) = plan.format_fini_mm();
        assert_eq!((gauche, haut, largeur, hauteur), (13.0, 13.0, 420.0, 297.0));
        assert_eq!(plan.vers_format_fini(13.0, 13.0), (0.0, 297.0));
        assert_eq!(plan.vers_format_fini(433.0, 310.0), (420.0, 0.0));
        assert_eq!(plan.vers_format_fini(223.0, 13.0), (210.0, 297.0));
    }

    /// Les valeurs par défaut du produit — celles que `SP_CROP_STD` fixe.
    #[test]
    fn les_poses_du_produit_avec_et_sans_fond_perdu() {
        // Le produit pose la page de gauche à `exportBleed − bleed` **pixels**
        // (72 dpi) du bord du canevas, elle-même posée à la marge : `10 + 0`
        // avec fond perdu, `10 − 3` sans.
        let avec = Plan::nouveau(Emplacement::Page(1), Emplacement::Page(2), a4());
        assert_eq!(avec.poses()[0].x_mm, 10.0);
        let sans = Plan::nouveau(
            Emplacement::Page(1),
            Emplacement::Page(2),
            Reglages {
                inclure_fond_perdu: false,
                ..a4()
            },
        );
        assert_eq!(sans.poses()[0].x_mm, 7.0);
    }

    /// Les 12 configurations de l'interface : la zone autorisée tient toujours
    /// dans le média, et contient toujours le format fini.
    #[test]
    fn la_zone_contient_le_format_fini_et_tient_dans_le_media() {
        for config in configurations() {
            let plan = Plan::nouveau(Emplacement::Page(1), Emplacement::Page(2), config);
            let [gauche, droite] = plan.poses();
            for (pose, place) in [(&gauche, &plan.places[0]), (&droite, &plan.places[1])] {
                assert!(
                    pose.contient(place.trim_x_mm(), place.trim_y_mm()),
                    "le coin haut-gauche du format fini doit être dans la zone"
                );
                assert!(
                    pose.contient(place.trim_x_mm(), place.trim_bas_mm()),
                    "le coin bas-gauche du format fini doit être dans la zone"
                );
                assert!(
                    pose.contient(place.trim_droite_mm(), place.trim_bas_mm()),
                    "le coin bas-droit du format fini doit être dans la zone"
                );
                assert!(
                    pose.zone_mm.0 >= 0.0 && pose.zone_mm.1 >= 0.0,
                    "la zone reste dans le média (gauche/haut) : {:?}",
                    pose.zone_mm
                );
                assert!(
                    pose.zone_mm.2 <= plan.feuille_largeur_mm
                        && pose.zone_mm.3 <= plan.feuille_hauteur_mm,
                    "la zone reste dans le média (droite/bas) : {:?}",
                    pose.zone_mm
                );
            }
        }
    }

    fn configurations() -> Vec<Reglages> {
        let mut cas = Vec::new();
        for inclure_fond_perdu in [true, false] {
            for decoupe_page_a_page in [true, false] {
                for reperes_de_coupe in [true, false] {
                    for fond_perdu_mm in [0.0, 3.0, 5.0] {
                        cas.push(Reglages {
                            inclure_fond_perdu,
                            decoupe_page_a_page,
                            reperes_de_coupe,
                            fond_perdu_mm,
                            ..Reglages::default()
                        });
                    }
                }
            }
        }
        cas
    }
}
