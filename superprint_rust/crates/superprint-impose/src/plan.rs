//! **Géométrie d'une planche** : taille de la feuille, place de chaque page,
//! format fini.
//!
//! ## Le repère
//!
//! Tout est en **millimètres**, l'origine au **coin haut-gauche du média** — le
//! coin de la feuille telle qu'elle sort de l'imprimante, marges techniques
//! comprises. C'est le repère de l'application (le canvas du produit a son
//! origine en haut à gauche), et c'est celui dans lequel les traits de coupe du
//! produit sont écrits. L'exporteur PDF convertira en repère PDF
//! (`y_pdf = hauteur - y`) au dernier moment, à un seul endroit.
//!
//! ## Pourquoi ce module existe
//!
//! Les quatre formules qui suivent sont écrites **trois fois** dans
//! `app/JS/main.js` (export imposé, rendu de planche, construction du canvas),
//! avec deux écarts constatés entre les copies. Un seul endroit, donc un seul
//! jeu de règles — et un contrôle de parité qui les compare à la source.

use super::reperes::{reperes_de_coupe, Segment};

/// Ce qui est nécessaire pour décrire une planche.
///
/// Les valeurs par défaut sont celles du produit : marges de repères 10 mm,
/// traits de 5 mm décalés de 2,5 mm (voir `window.SP_CROP_STD` dans `main.js`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Reglages {
    /// Largeur du **format fini** d'une page (le format de coupe, pas le média).
    pub largeur_page_mm: f64,
    /// Hauteur du format fini d'une page.
    pub hauteur_page_mm: f64,
    /// Fond perdu du document, en millimètres.
    pub fond_perdu_mm: f64,
    /// Faut-il imprimer le fond perdu ?
    pub inclure_fond_perdu: bool,
    /// Découpe page par page : chaque page garde ses **quatre** fonds perdus et
    /// les deux pages sont séparées par une gouttière de `2 × fond perdu`.
    /// Sans cette option, les deux pages se touchent et le fond perdu intérieur
    /// est coupé au trait — la couture d'un livret.
    pub decoupe_page_a_page: bool,
    /// Faut-il dessiner les traits de coupe ?
    pub reperes_de_coupe: bool,
    /// Marge technique autour du format fini, qui reçoit les repères.
    pub marge_reperes_mm: f64,
    /// Longueur d'un trait de coupe.
    pub longueur_repere_mm: f64,
    /// Décalage du trait par rapport au format fini (le trait ne touche jamais
    /// le format : c'est ce qui permet de le rogner sans le voir).
    pub decalage_repere_mm: f64,
    /// Épaisseur d'un trait de coupe.
    pub epaisseur_repere_mm: f64,
}

impl Default for Reglages {
    fn default() -> Self {
        Self {
            largeur_page_mm: 210.0,
            hauteur_page_mm: 297.0,
            fond_perdu_mm: 3.0,
            inclure_fond_perdu: true,
            decoupe_page_a_page: false,
            reperes_de_coupe: true,
            marge_reperes_mm: 10.0,
            longueur_repere_mm: 5.0,
            decalage_repere_mm: 2.5,
            epaisseur_repere_mm: 0.25,
        }
    }
}

impl Reglages {
    /// Le fond perdu **effectivement imprimé** : zéro quand l'utilisateur ne
    /// veut pas de fond perdu, même si le document en déclare un.
    #[must_use]
    pub fn fond_perdu_effectif_mm(&self) -> f64 {
        if self.inclure_fond_perdu {
            self.fond_perdu_mm
        } else {
            0.0
        }
    }

    /// La marge technique effectivement réservée : zéro si aucun repère n'est
    /// demandé — une marge vide serait du papier gaspillé.
    #[must_use]
    pub fn marge_effective_mm(&self) -> f64 {
        if self.reperes_de_coupe {
            self.marge_reperes_mm
        } else {
            0.0
        }
    }

    /// La gouttière entre les deux pages : `2 × fond perdu` quand chaque page
    /// doit garder son fond perdu intérieur, zéro sinon (les deux pages se
    /// touchent et le fond perdu intérieur est coupé au trait).
    #[must_use]
    pub fn gouttiere_mm(&self) -> f64 {
        if self.decoupe_page_a_page && self.inclure_fond_perdu {
            self.fond_perdu_effectif_mm() * 2.0
        } else {
            0.0
        }
    }
}

/// Une place sur la planche.
///
/// La place décrit la **zone de fond perdu** : c'est ce que le rendu charge
/// (une page dessinée avec son fond perdu sur ses quatre côtés), même si le fond
/// perdu intérieur est ensuite rogné. `x_mm`/`y_mm` sont le coin haut-gauche de
/// cette zone ; [`Place::trim_x_mm`] et consorts donnent le format fini.
///
/// ## ⚠️ La zone peut dépasser du média, et c'est voulu
///
/// Quand le document déclare un fond perdu mais que l'utilisateur ne veut pas
/// l'imprimer, la zone — qui en porte quand même un, puisqu'elle est rendue à
/// partir des objets du document — déborde de `fond_perdu_mm` de chaque côté.
/// Le rendu **rogne** ce débordement au format fini. Le résultat sur papier est
/// le format fini net, sur ses quatre bords : c'est exactement ce qu'on veut,
/// et c'est ce que fait le produit (son canvas de planche est rogné de la même
/// façon).
///
/// La propriété qui compte, et qui est testée, est donc : **le format fini tient
/// toujours dans le média**. Un plan où le format fini dépasserait serait une
/// impression tronquée — un défaut déjà rencontré dans le produit (voir le
/// commentaire « imposition - bandes blanches » dans `main.js`).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Place {
    /// La page qui occupe la place, ou une place vide.
    pub emplacement: super::Emplacement,
    /// Coin haut-gauche de la zone, fond perdu compris.
    pub x_mm: f64,
    /// Coin haut-gauche de la zone, fond perdu compris.
    pub y_mm: f64,
    /// Largeur de la zone : format fini + fond perdu des deux côtés.
    pub largeur_mm: f64,
    /// Hauteur de la zone : format fini + fond perdu des deux côtés.
    pub hauteur_mm: f64,
    /// Fond perdu appliqué autour du format fini, dans cette zone.
    pub fond_perdu_mm: f64,
}

impl Place {
    /// Abscisse du bord gauche du **format fini**.
    #[must_use]
    pub fn trim_x_mm(&self) -> f64 {
        self.x_mm + self.fond_perdu_mm
    }

    /// Ordonnée du bord haut du format fini.
    #[must_use]
    pub fn trim_y_mm(&self) -> f64 {
        self.y_mm + self.fond_perdu_mm
    }

    /// Abscisse du bord droit du format fini.
    #[must_use]
    pub fn trim_droite_mm(&self) -> f64 {
        self.trim_x_mm() + self.largeur_mm - 2.0 * self.fond_perdu_mm
    }

    /// Ordonnée du bord bas du format fini.
    #[must_use]
    pub fn trim_bas_mm(&self) -> f64 {
        self.trim_y_mm() + self.hauteur_mm - 2.0 * self.fond_perdu_mm
    }
}

/// Le plan complet d'une planche : la taille du média, les deux places, les
/// repères.
#[derive(Clone, Debug, PartialEq)]
pub struct Plan {
    /// Largeur du média (la feuille), marges techniques comprises.
    pub feuille_largeur_mm: f64,
    /// Hauteur du média.
    pub feuille_hauteur_mm: f64,
    /// Les deux places : page de gauche, puis page de droite.
    pub places: [Place; 2],
    /// Les traits de coupe, dans le repère du média.
    pub reperes: Vec<Segment>,
    /// Les réglages qui ont produit ce plan — conservés pour que l'appelant
    /// n'ait pas à les recalculer pour interpréter le plan.
    pub reglages: Reglages,
}

impl Plan {
    /// Construit le plan d'une planche portant `gauche` et `droite`.
    #[must_use]
    pub fn nouveau(gauche: super::Emplacement, droite: super::Emplacement, r: Reglages) -> Self {
        // Le fond perdu **imprimé** : c'est lui qui décide de la taille du média.
        let fond_perdu = r.fond_perdu_effectif_mm();
        let marge = r.marge_effective_mm();
        let gouttiere = r.gouttiere_mm();

        let feuille_largeur_mm =
            r.largeur_page_mm * 2.0 + fond_perdu * 2.0 + gouttiere + marge * 2.0;
        let feuille_hauteur_mm = r.hauteur_page_mm + fond_perdu * 2.0 + marge * 2.0;

        // Chaque zone porte le fond perdu **du document** sur ses quatre côtés :
        // le rendu charge une page entière, fond perdu compris, puis rogne.
        let zone_largeur = r.largeur_page_mm + r.fond_perdu_mm * 2.0;
        let zone_hauteur = r.hauteur_page_mm + r.fond_perdu_mm * 2.0;

        // ⚠️ La formule garde `- fond_perdu_mm` et non `- fond_perdu` : quand
        // l'utilisateur ne veut pas de fond perdu imprimé, la zone — qui en
        // porte quand même un — est **décalée vers l'extérieur** d'autant, et le
        // format fini tombe exactement à `marge` du bord. C'est ce que le
        // produit fait, et c'est ce qui garde les repères alignés sur le format
        // fini dans les deux cas. Mettre `fond_perdu` ici décalerait tout de
        // 3 mm dès qu'un fond perdu est déclaré mais non imprimé.
        let x = marge + fond_perdu - r.fond_perdu_mm;
        let y = marge + fond_perdu - r.fond_perdu_mm;

        let places = [
            Place {
                emplacement: gauche,
                x_mm: x,
                y_mm: y,
                largeur_mm: zone_largeur,
                hauteur_mm: zone_hauteur,
                fond_perdu_mm: r.fond_perdu_mm,
            },
            Place {
                emplacement: droite,
                x_mm: x + r.largeur_page_mm + gouttiere,
                y_mm: y,
                largeur_mm: zone_largeur,
                hauteur_mm: zone_hauteur,
                fond_perdu_mm: r.fond_perdu_mm,
            },
        ];

        let reperes = if r.reperes_de_coupe {
            reperes_de_coupe(&places, &r)
        } else {
            Vec::new()
        };

        Self {
            feuille_largeur_mm,
            feuille_hauteur_mm,
            places,
            reperes,
            reglages: r,
        }
    }

    /// Construit le plan décrit par une **spécification textuelle**.
    ///
    /// C'est le point d'entrée de la frontière WebAssembly : le format est lu par
    /// [`Specification::lire`], et il n'existe qu'une seule implémentation de ce
    /// lecteur dans tout le dépôt.
    ///
    /// Renvoie `None` si la spécification est inutilisable — ligne `!page`
    /// absente, dimension nulle ou négative.
    #[must_use]
    pub fn depuis_spec(texte: &str) -> Option<Self> {
        let spec = super::Specification::lire(texte)?;
        Some(Self::nouveau(spec.gauche, spec.droite, spec.reglages))
    }

    /// Le format fini global : la zone couvrante des deux formats finis.
    /// C'est la dimension que l'imprimeur découpe.
    #[must_use]
    pub fn format_fini_mm(&self) -> (f64, f64, f64, f64) {
        let gauche = self.places[0].trim_x_mm();
        let haut = self.places[0].trim_y_mm();
        let droite = self.places[1].trim_droite_mm();
        let bas = self.places[0].trim_bas_mm();
        (gauche, haut, droite - gauche, bas - haut)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Emplacement;

    fn p(n: u32) -> Emplacement {
        Emplacement::Page(n)
    }

    /// Toutes les combinaisons d'options — c'est ce jeu qui doit tenir, quelle
    /// que soit la configuration choisie dans l'interface.
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

    /// Les valeurs par défaut doivent être celles du produit : si elles
    /// dérivent, tous les plans ci-dessous deviennent faux en silence.
    #[test]
    fn les_reglages_par_defaut_sont_ceux_du_produit() {
        let r = Reglages::default();
        assert_eq!(r.marge_reperes_mm, 10.0, "SP_CROP_STD.margeMm");
        assert_eq!(r.longueur_repere_mm, 5.0, "SP_CROP_STD.longueurMm");
        assert_eq!(r.decalage_repere_mm, 2.5, "SP_CROP_STD.decalageMm");
    }

    /// A4 paysage imposé en livret, avec fond perdu et repères : la largeur est
    /// `2 × 210 + 2 × 3 + 2 × 10`, la hauteur `297 + 2 × 3 + 2 × 10`.
    #[test]
    fn la_feuille_a4_avec_fond_perdu_et_reperes() {
        let plan = Plan::nouveau(p(1), p(2), Reglages::default());
        assert_eq!(plan.feuille_largeur_mm, 446.0);
        assert_eq!(plan.feuille_hauteur_mm, 323.0);
    }

    /// Sans fond perdu imprimé, la feuille rétrécit d'autant… mais les repères
    /// restent sur le format fini.
    #[test]
    fn sans_fond_perdu_les_reperes_suivent_le_format_fini() {
        let r = Reglages {
            inclure_fond_perdu: false,
            ..Reglages::default()
        };
        let plan = Plan::nouveau(p(1), p(2), r);
        assert_eq!(plan.feuille_largeur_mm, 440.0, "420 + 2 x 10");
        assert_eq!(plan.feuille_hauteur_mm, 317.0, "297 + 2 x 10");
        // Le format fini commence à la marge, dans les deux cas.
        assert_eq!(plan.places[0].trim_x_mm(), 10.0);
        assert_eq!(plan.places[0].trim_y_mm(), 10.0);
    }

    /// Avec fond perdu, le format fini recule de la marge **plus** le fond perdu.
    #[test]
    fn avec_fond_perdu_le_format_fini_recule() {
        let plan = Plan::nouveau(p(1), p(2), Reglages::default());
        assert_eq!(
            plan.places[0].trim_x_mm(),
            13.0,
            "10 de marge + 3 de fond perdu"
        );
        assert_eq!(plan.places[0].trim_droite_mm(), 223.0, "13 + 210");
        assert_eq!(plan.places[0].trim_bas_mm(), 310.0, "13 + 297");
    }

    /// La page de droite commence après la page de gauche — et saute la
    /// gouttière quand la découpe page à page est demandée.
    #[test]
    fn la_page_de_droite_suit_la_page_de_gauche() {
        let sans = Plan::nouveau(p(1), p(2), Reglages::default());
        assert_eq!(sans.places[1].trim_x_mm(), 223.0, "aucune gouttiere");

        let avec = Plan::nouveau(
            p(1),
            p(2),
            Reglages {
                decoupe_page_a_page: true,
                ..Reglages::default()
            },
        );
        assert_eq!(
            avec.places[1].trim_x_mm(),
            229.0,
            "223 + 2 x 3 de gouttiere"
        );
        assert_eq!(
            avec.feuille_largeur_mm, 452.0,
            "la feuille grandit de la gouttiere"
        );
    }

    /// Les deux formats finis sont **jointifs** quand il n'y a pas de gouttière :
    /// c'est la couture d'un livret, et les repères intérieurs n'y sont pas
    /// dessinés pour cette raison.
    #[test]
    fn sans_gouttiere_les_deux_formats_finis_se_touchent() {
        let plan = Plan::nouveau(p(1), p(2), Reglages::default());
        assert_eq!(
            plan.places[0].trim_droite_mm(),
            plan.places[1].trim_x_mm(),
            "les deux formats finis doivent se toucher"
        );
    }

    /// Le format fini global est le rectangle couvrant les deux pages.
    #[test]
    fn le_format_fini_couvre_les_deux_pages() {
        let plan = Plan::nouveau(p(1), p(2), Reglages::default());
        let (x, y, l, h) = plan.format_fini_mm();
        assert_eq!((x, y), (13.0, 13.0));
        assert_eq!(l, 420.0, "deux pages de 210");
        assert_eq!(h, 297.0);
    }

    /// Le **format fini** tient dans le média dans toutes les configurations :
    /// c'est la seule propriété dont l'absence produirait une impression
    /// tronquée, et elle doit tenir partout.
    #[test]
    fn le_format_fini_tient_toujours_dans_le_media() {
        for r in configurations() {
            let plan = Plan::nouveau(p(1), p(2), r);
            let (x, y, l, h) = plan.format_fini_mm();
            assert!(
                x >= -1e-9 && y >= -1e-9,
                "{r:?} : le format fini commence hors du media ({x}, {y})"
            );
            assert!(
                x + l <= plan.feuille_largeur_mm + 1e-9,
                "{r:?} : le format fini deborde a droite ({} > {})",
                x + l,
                plan.feuille_largeur_mm
            );
            assert!(
                y + h <= plan.feuille_hauteur_mm + 1e-9,
                "{r:?} : le format fini deborde en bas ({} > {})",
                y + h,
                plan.feuille_hauteur_mm
            );
        }
    }

    /// Quand le fond perdu **est imprimé**, les zones occupent exactement le
    /// média : elles se partagent le fond perdu central, sans blanc ni
    /// débordement inutile.
    #[test]
    fn avec_fond_perdu_les_zones_remplissent_exactement_le_media() {
        // Sans gouttière, les deux zones se **touchent** au centre : le fond
        // perdu est alors partagé, et rogné au trait de couture.
        let sans = Plan::nouveau(p(1), p(2), Reglages::default());
        assert_eq!(sans.places[0].x_mm, 10.0, "la marge technique d'abord");
        assert_eq!(
            sans.places[1].x_mm + sans.places[1].largeur_mm + 10.0,
            sans.feuille_largeur_mm,
            "la zone de droite doit finir a la marge technique"
        );

        // Avec gouttière, chaque zone a sa place, sans recouvrement.
        let avec = Plan::nouveau(
            p(1),
            p(2),
            Reglages {
                decoupe_page_a_page: true,
                ..Reglages::default()
            },
        );
        assert_eq!(
            avec.places[0].x_mm + avec.places[0].largeur_mm,
            avec.places[1].x_mm,
            "les deux zones doivent se toucher, pas se recouvrir"
        );
    }

    /// Sans fond perdu imprimé, la zone déborde de part et d'autre : le rendu
    /// **rogne** au format fini. On vérifie que le débordement vaut exactement le
    /// fond perdu déclaré, des deux côtés — c'est ce qui garantit que le rognage
    /// retombe pile sur le format fini.
    #[test]
    fn sans_fond_perdu_imprime_la_zone_deborde_pour_etre_rognee() {
        // Sans repères, il n'y a aucune marge technique pour absorber le
        // débordement : la zone sort du média, et le rognage est la seule chose
        // qui l'empêche d'être imprimée de travers.
        let r = Reglages {
            inclure_fond_perdu: false,
            reperes_de_coupe: false,
            ..Reglages::default()
        };
        let plan = Plan::nouveau(p(1), p(2), r);
        let place = plan.places[0];
        assert_eq!(place.x_mm, -3.0, "aucune marge moins fond perdu 3");
        assert_eq!(
            place.x_mm + place.fond_perdu_mm,
            place.trim_x_mm(),
            "le rognage doit retomber exactement sur le format fini"
        );
        assert!(
            place.x_mm < -1e-9 && place.trim_x_mm() >= -1e-9,
            "la zone deborde, mais le format fini reste dans le media"
        );

        // Avec les repères, la marge de 10 mm absorbe le débordement : la zone
        // reste entièrement dans le média, comme le produit le fait remarquer
        // (« sans bleed, le sheet fait exactement 2 pages »).
        let avec = Plan::nouveau(
            p(1),
            p(2),
            Reglages {
                inclure_fond_perdu: false,
                ..Reglages::default()
            },
        );
        assert_eq!(avec.places[0].x_mm, 7.0, "marge 10 moins fond perdu 3");
        assert!(avec.places[0].x_mm > 0.0, "la marge absorbe le debordement");
    }

    /// Aucun trait de coupe n'est demandé → aucun trait, et aucune marge
    /// technique.
    #[test]
    fn sans_reperes_la_marge_disparait() {
        let plan = Plan::nouveau(
            p(1),
            p(2),
            Reglages {
                reperes_de_coupe: false,
                ..Reglages::default()
            },
        );
        assert!(plan.reperes.is_empty());
        assert_eq!(plan.feuille_largeur_mm, 426.0, "420 + 2 x 3, sans marge");
        assert_eq!(plan.places[0].trim_x_mm(), 3.0);
    }
}
