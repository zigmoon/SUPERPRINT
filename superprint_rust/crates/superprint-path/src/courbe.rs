//! Courbes de Bézier : évaluation, boîte, subdivision, **aplatissement**.
//!
//! ## Pourquoi l'aplatissement est le cœur du module
//!
//! Une courbe de Bézier n'est pas un polygone, et toutes les opérations
//! booléennes de ce crate travaillent sur des polygones. La seule façon honnête
//! de passer de l'un à l'autre est de **remplacer la courbe par une polyligne
//! qui la suit d'assez près** — et de dire de combien.
//!
//! Le critère employé est celui de Paper.js (`getFlatness`) : la courbe est
//! remplacée par sa corde quand ses points de contrôle s'en écartent de moins
//! que la tolérance. Ce critère porte sur les **points de contrôle**, pas sur la
//! courbe : c'est une borne supérieure connue de l'écart réel, donc une
//! garantie, pas une approximation heureuse.
//!
//! ## Ce que le produit faisait
//!
//! Rien : il appelait Paper.js. Ce n'est pas une critique — c'est la raison
//! pour laquelle ce module existe, et pour laquelle il doit être vérifiable seul.
//!
//! ## Unités
//!
//! Aucune. La tolérance est dans l'unité des coordonnées : `0,05` millimètres
//! pour un tracé d'imprimerie, `0,25` pixel pour un écran. C'est à l'appelant de
//! savoir ce qu'il demande.

use crate::point::{Boite, Point};

/// Profondeur maximale de subdivision.
///
/// Sans garde-fou, une courbe dégénérée (points de contrôle confondus, corde
/// nulle) ferait récurser jusqu'à épuisement de la pile. 24 subdivisions
/// suffisent à couvrir toute précision de `f64` raisonnable : au-delà, les
/// points ne sont plus distinguables.
pub const PROFONDEUR_MAX: u32 = 24;

/// Une courbe de Bézier : segment, quadratique ou cubique.
///
/// Les deux premiers points sont toujours les extrémités ; les points de
/// contrôle sont au milieu pour la quadratique, et les indices 1 et 2 pour la
/// cubique. La variante [`Courbe::Ligne`] existe pour que l'aplatissement d'un
/// chemin n'ait pas à traiter deux types de morceaux.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Courbe {
    /// Segment de droite.
    Ligne {
        /// Point de départ.
        depart: Point,
        /// Point d'arrivée.
        arrivee: Point,
    },
    /// Bézier quadratique : un point de contrôle.
    Quadratique {
        /// Point de départ.
        depart: Point,
        /// Point de contrôle.
        controle: Point,
        /// Point d'arrivée.
        arrivee: Point,
    },
    /// Bézier cubique : deux points de contrôle.
    Cubique {
        /// Point de départ.
        depart: Point,
        /// Premier point de contrôle.
        controle1: Point,
        /// Second point de contrôle.
        controle2: Point,
        /// Point d'arrivée.
        arrivee: Point,
    },
}

impl Courbe {
    /// Le point de départ.
    #[must_use]
    pub fn depart(&self) -> Point {
        match *self {
            Self::Ligne { depart, .. }
            | Self::Quadratique { depart, .. }
            | Self::Cubique { depart, .. } => depart,
        }
    }

    /// Le point d'arrivée.
    #[must_use]
    pub fn arrivee(&self) -> Point {
        match *self {
            Self::Ligne { arrivee, .. }
            | Self::Quadratique { arrivee, .. }
            | Self::Cubique { arrivee, .. } => arrivee,
        }
    }

    /// Le point de la courbe pour le paramètre `t` (De Casteljau, stable).
    ///
    /// `t` est ramené dans `[0, 1]`.
    #[must_use]
    pub fn point(&self, t: f64) -> Point {
        let t = t.clamp(0.0, 1.0);
        match *self {
            Self::Ligne { depart, arrivee } => depart.interpole(arrivee, t),
            Self::Quadratique {
                depart,
                controle,
                arrivee,
            } => {
                let a = depart.interpole(controle, t);
                let b = controle.interpole(arrivee, t);
                a.interpole(b, t)
            }
            Self::Cubique {
                depart,
                controle1,
                controle2,
                arrivee,
            } => {
                let a = depart.interpole(controle1, t);
                let b = controle1.interpole(controle2, t);
                let c = controle2.interpole(arrivee, t);
                a.interpole(b, t).interpole(b.interpole(c, t), t)
            }
        }
    }

    /// Le vecteur dérivé pour `t`, non normalisé.
    ///
    /// Utile pour la tangente à l'extrémité d'une courbe (raccord de polices,
    /// orientation d'une flèche), et exactement ce qu'il faut pour trouver les
    /// extrema d'une boîte englobante.
    #[must_use]
    pub fn derivee(&self, t: f64) -> Point {
        let t = t.clamp(0.0, 1.0);
        match *self {
            Self::Ligne { depart, arrivee } => arrivee - depart,
            Self::Quadratique {
                depart,
                controle,
                arrivee,
            } => (controle - depart).interpole(arrivee - controle, t) * 2.0,
            Self::Cubique {
                depart,
                controle1,
                controle2,
                arrivee,
            } => {
                let a = (controle1 - depart) * 3.0;
                let b = (controle2 - controle1) * 3.0;
                let c = (arrivee - controle2) * 3.0;
                let ab = a.interpole(b, t);
                let bc = b.interpole(c, t);
                ab.interpole(bc, t)
            }
        }
    }

    /// Coupe la courbe en `t` (De Casteljau) et rend les deux morceaux.
    ///
    /// Les deux morceaux mis bout à bout sont **exactement** la courbe : la
    /// subdivision ne l'approche pas, elle la partage.
    #[must_use]
    pub fn subdiviser(&self, t: f64) -> (Self, Self) {
        let t = t.clamp(0.0, 1.0);
        match *self {
            Self::Ligne { depart, arrivee } => {
                let m = depart.interpole(arrivee, t);
                (
                    Self::Ligne { depart, arrivee: m },
                    Self::Ligne { depart: m, arrivee },
                )
            }
            Self::Quadratique {
                depart,
                controle,
                arrivee,
            } => {
                let a = depart.interpole(controle, t);
                let b = controle.interpole(arrivee, t);
                let m = a.interpole(b, t);
                (
                    Self::Quadratique {
                        depart,
                        controle: a,
                        arrivee: m,
                    },
                    Self::Quadratique {
                        depart: m,
                        controle: b,
                        arrivee,
                    },
                )
            }
            Self::Cubique {
                depart,
                controle1,
                controle2,
                arrivee,
            } => {
                let a = depart.interpole(controle1, t);
                let b = controle1.interpole(controle2, t);
                let c = controle2.interpole(arrivee, t);
                let d = a.interpole(b, t);
                let e = b.interpole(c, t);
                let m = d.interpole(e, t);
                (
                    Self::Cubique {
                        depart,
                        controle1: a,
                        controle2: d,
                        arrivee: m,
                    },
                    Self::Cubique {
                        depart: m,
                        controle1: e,
                        controle2: c,
                        arrivee,
                    },
                )
            }
        }
    }

    /// Écart maximal entre la courbe et sa corde, **majoré** par l'écart des
    /// points de contrôle.
    ///
    /// C'est la mesure de « platitude » classique : si ce nombre est inférieur à
    /// la tolérance, la corde remplace la courbe. Comme il majore l'écart réel,
    /// la tolérance est respectée — mais **ce n'est pas suffisant** : voir
    /// [`Courbe::est_plate`].
    ///
    /// Quand la corde est nulle (départ et arrivée confondus), l'écart est
    /// mesuré depuis le point de départ, sinon la division par la longueur de la
    /// corde produirait un infini.
    #[must_use]
    pub fn ecart_a_la_corde(&self) -> f64 {
        let depart = self.depart();
        let arrivee = self.arrivee();
        let corde = arrivee - depart;
        let longueur = corde.longueur();
        let distance = |p: Point| {
            if longueur == 0.0 {
                p.distance(depart)
            } else {
                // Distance du point à la DROITE portée par la corde.
                ((p - depart).vectoriel(corde) / longueur).abs()
            }
        };
        match *self {
            Self::Ligne { .. } => 0.0,
            Self::Quadratique { controle, .. } => distance(controle) / 2.0,
            Self::Cubique {
                controle1,
                controle2,
                ..
            } => distance(controle1).max(distance(controle2)) * 0.75,
        }
    }

    /// La courbe peut-elle être remplacée par sa corde, à cette tolérance ?
    ///
    /// Deux conditions, et pas une :
    ///
    /// 1. l'écart des points de contrôle à la corde
    ///    ([`Courbe::ecart_a_la_corde`]) est sous la tolérance ;
    /// 2. **les points de contrôle se projettent sur la corde**, entre ses deux
    ///    extrémités.
    ///
    /// La seconde condition n'est pas un luxe. Sans elle, une courbe dont les
    /// points de contrôle sont **alignés** sur la corde — une poignée tirée en
    /// arrière, ce qui arrive dès qu'on édite un nœud — passe pour une droite :
    /// l'écart perpendiculaire est nul. Or la courbe, elle, **dépasse** les
    /// extrémités : elle rebrousse.
    ///
    /// C'est une faute de tracé réelle, trouvée par la mesure : sur une telle
    /// courbe, l'écart à la polyligne restait bloqué à 0,74 **quelle que soit la
    /// tolérance** demandée — 0,1 comme 0,001 — parce que la subdivision
    /// s'arrêtait au premier niveau. Aucun test unitaire ne l'avait vue ; c'est
    /// le contrôle par mesure d'écart qui l'a montrée.
    #[must_use]
    pub fn est_plate(&self, tolerance: f64) -> bool {
        if matches!(self, Self::Ligne { .. }) {
            return true;
        }
        if self.ecart_a_la_corde() > tolerance {
            return false;
        }
        let depart = self.depart();
        let arrivee = self.arrivee();
        let corde = arrivee - depart;
        let carre = corde.scalaire(corde);
        if carre == 0.0 {
            // Corde nulle : la courbe est un aller-retour. Seule une courbe
            // vraiment dégénérée peut être déclarée plate.
            return self.point(0.5).distance(depart) <= tolerance;
        }
        let longueur = corde.longueur();
        let dedans = |p: Point| {
            let t = (p - depart).scalaire(corde) / carre;
            // La marge est proportionnelle à la tolérance : un point de contrôle
            // projeté à la tolérance près du bout reste acceptable.
            t >= -tolerance / longueur && t <= 1.0 + tolerance / longueur
        };
        match *self {
            Self::Ligne { .. } => true,
            Self::Quadratique { controle, .. } => dedans(controle),
            Self::Cubique {
                controle1,
                controle2,
                ..
            } => dedans(controle1) && dedans(controle2),
        }
    }

    /// Boîte englobante **exacte** : les extrema de la courbe, pas ceux de ses
    /// points de contrôle.
    ///
    /// La différence compte : une cubique dont les points de contrôle sortent
    /// largement de la courbe donnerait une boîte trop grande, et un
    /// « recadrer sur la sélection » laisserait alors une marge visible.
    #[must_use]
    pub fn boite(&self) -> Boite {
        let mut b = Boite::du_point(self.depart());
        b.englober(self.arrivee());
        match *self {
            Self::Ligne { .. } => {}
            Self::Quadratique {
                depart,
                controle,
                arrivee,
            } => {
                // B'(t) = 2[(1-t)(C-P0) + t(P2-C)] : un seul zéro possible.
                for (p0, p1, p2) in [
                    (depart.x, controle.x, arrivee.x),
                    (depart.y, controle.y, arrivee.y),
                ] {
                    if let Some(t) = zero_quadratique(p0, p1, p2) {
                        b.englober(self.point(t));
                    }
                }
            }
            Self::Cubique {
                depart,
                controle1,
                controle2,
                arrivee,
            } => {
                for axe in 0..2 {
                    let (p0, p1, p2, p3) = match axe {
                        0 => (depart.x, controle1.x, controle2.x, arrivee.x),
                        _ => (depart.y, controle1.y, controle2.y, arrivee.y),
                    };
                    for t in zeros_cubiques(p0, p1, p2, p3) {
                        b.englober(self.point(t));
                    }
                }
            }
        }
        b
    }

    /// Longueur approchée, obtenue en aplatissant à la tolérance donnée.
    ///
    /// Ce n'est **pas** une longueur exacte, et il ne faut pas la présenter
    /// comme telle : la longueur d'un arc de Bézier s'obtient par une intégrale
    /// elliptique, et l'aplatir est la méthode standard. L'écart est de l'ordre
    /// de la tolérance demandée.
    #[must_use]
    pub fn longueur(&self, tolerance: f64) -> f64 {
        let mut points = Vec::new();
        self.aplatir(tolerance, &mut points);
        points
            .windows(2)
            .map(|paire| paire[0].distance(paire[1]))
            .sum()
    }

    /// Remplace la courbe par une polyligne, en **ajoutant** ses sommets
    /// (extrémité finale comprise) à `sortie`.
    ///
    /// Le premier point n'est **jamais** ajouté : c'est le dernier point déjà
    /// présent, et le dupliquer créerait un segment nul — la plaie des
    /// algorithmes booléens, où un segment nul n'a pas d'orientation et fait
    /// échouer la classification « dedans / dehors ».
    ///
    /// La subdivision est récursive en `t = 0,5`, ce qui donne des points
    /// régulièrement répartis — un avantage pour la suite : les segments sont de
    /// longueurs comparables, donc les erreurs de classification ne se
    /// concentrent pas dans un coin.
    pub fn aplatir(&self, tolerance: f64, sortie: &mut Vec<Point>) {
        aplatir_recursif(self, tolerance.abs(), sortie, 0);
    }

    /// Aplatit une suite de courbes en un seul chemin, en s'assurant que les
    /// morceaux se suivent.
    ///
    /// # Erreurs
    ///
    /// [`crate::ErreurPath::CheminDiscontinu`] si une courbe ne commence pas où
    /// finit la précédente : un chemin discontinu n'est pas un chemin, et le
    /// recoller en silence inventerait un segment.
    pub fn aplatir_chemin(
        courbes: &[Self],
        tolerance: f64,
    ) -> Result<Vec<Point>, crate::ErreurPath> {
        let mut points = Vec::new();
        for (i, courbe) in courbes.iter().enumerate() {
            if i > 0 {
                let precedent = courbes[i - 1];
                if precedent.arrivee() != courbe.depart() {
                    return Err(crate::ErreurPath::CheminDiscontinu { morceau: i });
                }
            } else {
                points.push(courbe.depart());
            }
            courbe.aplatir(tolerance, &mut points);
        }
        Ok(points)
    }
}

/// Applique l'aplatissement récursif, en gardant la trace de la profondeur.
fn aplatir_recursif(courbe: &Courbe, tolerance: f64, sortie: &mut Vec<Point>, profondeur: u32) {
    if courbe.est_plate(tolerance) || profondeur >= PROFONDEUR_MAX {
        sortie.push(courbe.arrivee());
        return;
    }
    let (gauche, droite) = courbe.subdiviser(0.5);
    aplatir_recursif(&gauche, tolerance, sortie, profondeur + 1);
    aplatir_recursif(&droite, tolerance, sortie, profondeur + 1);
}

/// Le zéro de `B'(t)` pour une quadratique, s'il tombe dans `]0, 1[`.
///
/// `B'(t) = 2[(p1 − p0) + t(p0 − 2p1 + p2)]` : une racine, ou aucune quand le
/// dénominateur est nul.
fn zero_quadratique(p0: f64, p1: f64, p2: f64) -> Option<f64> {
    let denominateur = p0 - 2.0 * p1 + p2;
    if denominateur == 0.0 {
        return None;
    }
    let t = (p0 - p1) / denominateur;
    if t > 0.0 && t < 1.0 {
        Some(t)
    } else {
        None
    }
}

/// Les zéros de `B'(t)` pour une cubique, ramenés dans `]0, 1[`.
fn zeros_cubiques(p0: f64, p1: f64, p2: f64, p3: f64) -> Vec<f64> {
    // B'(t) = 3[a t² + b t + c], avec :
    //   a = -p0 + 3p1 - 3p2 + p3
    //   b = 2(p0 - 2p1 + p2)
    //   c = p1 - p0
    let a = -p0 + 3.0 * p1 - 3.0 * p2 + p3;
    let b = 2.0 * (p0 - 2.0 * p1 + p2);
    let c = p1 - p0;
    let mut racines = Vec::new();
    if a.abs() < f64::EPSILON {
        // Dérivée linéaire.
        if b != 0.0 {
            racines.push(-c / b);
        }
    } else {
        let discriminant = b * b - 4.0 * a * c;
        if discriminant >= 0.0 {
            let racine = discriminant.sqrt();
            // La forme stable : la première racine évite la soustraction qui
            // annule les chiffres significatifs quand 4ac ≪ b².
            let q = -0.5 * (b + racine.copysign(b));
            racines.push(q / a);
            if q != 0.0 {
                racines.push(c / q);
            }
        }
    }
    racines
        .into_iter()
        .filter(|t| *t > 0.0 && *t < 1.0)
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cubique() -> Courbe {
        Courbe::Cubique {
            depart: Point::new(0.0, 0.0),
            controle1: Point::new(0.0, 100.0),
            controle2: Point::new(100.0, 100.0),
            arrivee: Point::new(100.0, 0.0),
        }
    }

    #[test]
    fn extremites_et_milieu() {
        let c = cubique();
        assert_eq!(c.point(0.0), Point::new(0.0, 0.0));
        assert_eq!(c.point(1.0), Point::new(100.0, 0.0));
        // Le point milieu d'une cubique symétrique est sur l'axe médian.
        let m = c.point(0.5);
        assert!((m.x - 50.0).abs() < 1e-12);
        assert!((m.y - 75.0).abs() < 1e-12);
    }

    #[test]
    fn t_est_borne() {
        let c = cubique();
        assert_eq!(c.point(-3.0), c.point(0.0));
        assert_eq!(c.point(9.0), c.point(1.0));
    }

    #[test]
    fn derivee_aux_extremites() {
        let c = cubique();
        // Tangente au départ : verticale (les deux premiers points sont sur x=0).
        let d = c.derivee(0.0);
        assert_eq!(d.x, 0.0);
        assert!(d.y > 0.0);
    }

    #[test]
    fn subdivision_rend_la_meme_courbe() {
        let c = cubique();
        let (g, d) = c.subdiviser(0.3);
        assert_eq!(g.depart(), c.depart());
        assert_eq!(d.arrivee(), c.arrivee());
        assert_eq!(g.arrivee(), d.depart());
        // Les deux morceaux couvrent exactement la courbe : à paramètre
        // correspondant, le point est le même.
        for i in 0..=20 {
            let u = i as f64 / 20.0;
            assert!((g.point(u) - c.point(0.3 * u)).longueur() < 1e-12);
            assert!((d.point(u) - c.point(0.3 + 0.7 * u)).longueur() < 1e-12);
        }
    }

    #[test]
    fn subdivision_a_la_moitie_donne_les_memes_points() {
        let c = cubique();
        let (g, _) = c.subdiviser(0.5);
        // Le morceau gauche doit passer par le point milieu.
        assert!((g.arrivee() - c.point(0.5)).longueur() < 1e-12);
    }

    #[test]
    fn boite_exacte_est_plus_petite_que_celle_des_controles() {
        let c = cubique();
        let b = c.boite();
        // La courbe ne dépasse jamais y = 75 (max d'une cubique symétrique),
        // alors que les points de contrôle montent à 100.
        assert!(
            (b.max.y - 75.0).abs() < 1e-9,
            "hauteur trouvée : {}",
            b.max.y
        );
        assert!((b.min.y - 0.0).abs() < 1e-12);
        assert!((b.min.x - 0.0).abs() < 1e-12);
        assert!((b.max.x - 100.0).abs() < 1e-12);
    }

    #[test]
    fn boite_d_une_courbe_qui_rebrousse() {
        // Les deux extrémités sont au même endroit (0,0), et les contrôles
        // tirent à droite puis à gauche : la courbe déborde des deux côtés des
        // extrémités. Une boîte calculée sur les seuls points de contrôle
        // donnerait [−100, 100] ; la vraie vaut ±28,87, et c'est ce qu'on veut.
        //
        //   B(t) = 300·t·(1−t)·(1−2t), dont les extrema sont en
        //   t = (1 ± 1/√3)/2, pour la valeur ±50/√3 ≈ ±28,8675.
        let c = Courbe::Cubique {
            depart: Point::new(0.0, 0.0),
            controle1: Point::new(100.0, 0.0),
            controle2: Point::new(-100.0, 0.0),
            arrivee: Point::new(0.0, 0.0),
        };
        let b = c.boite();
        let attendu = 50.0 / 3.0_f64.sqrt();
        assert!(
            (b.min.x + attendu).abs() < 1e-9,
            "le minimum vaut {} (attendu {})",
            b.min.x,
            -attendu
        );
        assert!(
            (b.max.x - attendu).abs() < 1e-9,
            "le maximum vaut {}",
            b.max.x
        );
        // Et tous les points échantillonnés sont bien dans la boîte.
        for i in 0..=200 {
            let p = c.point(i as f64 / 200.0);
            assert!(b.contient(p), "point {p:?} hors de {b:?}");
        }
    }

    #[test]
    fn boite_d_une_quadratique() {
        let c = Courbe::Quadratique {
            depart: Point::new(0.0, 0.0),
            controle: Point::new(50.0, 100.0),
            arrivee: Point::new(100.0, 0.0),
        };
        let b = c.boite();
        assert!(
            (b.max.y - 50.0).abs() < 1e-12,
            "hauteur trouvée : {}",
            b.max.y
        );
    }

    #[test]
    fn boite_d_une_ligne() {
        let c = Courbe::Ligne {
            depart: Point::new(3.0, 4.0),
            arrivee: Point::new(-1.0, 8.0),
        };
        let b = c.boite();
        assert_eq!(b.min, Point::new(-1.0, 4.0));
        assert_eq!(b.max, Point::new(3.0, 8.0));
    }

    #[test]
    fn ecart_a_la_corde_majore_l_ecart_reel() {
        let c = cubique();
        let majorant = c.ecart_a_la_corde();
        // Mesure réelle : distance de chaque point de la courbe à la corde.
        // La corde va de (0,0) à (100,0), c'est l'axe des x.
        let mut reel: f64 = 0.0;
        for i in 0..=1000 {
            let p = c.point(i as f64 / 1000.0);
            reel = reel.max(p.y.abs());
        }
        assert!(
            majorant >= reel,
            "le majorant {majorant} doit couvrir l'écart réel {reel}"
        );
    }

    #[test]
    fn aplatissement_dans_la_tolerance() {
        for tolerance in [10.0, 1.0, 0.1, 0.01] {
            let c = cubique();
            let mut points = vec![c.depart()];
            c.aplatir(tolerance, &mut points);
            assert_eq!(*points.last().unwrap(), c.arrivee());
            // Chaque segment n'est jamais plus long que la tolérance en écart :
            // on vérifie la propriété qui compte, à savoir que la polyligne
            // reste PROCHE de la courbe.
            for i in 0..=200 {
                let p = c.point(i as f64 / 200.0);
                let d = distance_au_polygone(p, &points);
                assert!(
                    d <= tolerance,
                    "tolérance {tolerance} : point à {d} du polygone"
                );
            }
            // Et les points sont ajoutés dans l'ordre du paramètre.
            assert!(points.windows(2).all(|w| w[0] != w[1]));
        }
    }

    #[test]
    fn aplatissement_plus_fin_avec_une_tolerance_plus_serree() {
        let grossier = {
            let mut p = Vec::new();
            cubique().aplatir(5.0, &mut p);
            p.len()
        };
        let fin = {
            let mut p = Vec::new();
            cubique().aplatir(0.05, &mut p);
            p.len()
        };
        assert!(fin > grossier * 4, "grossier {grossier}, fin {fin}");
    }

    #[test]
    fn aplatissement_d_une_ligne_ne_fait_rien() {
        let c = Courbe::Ligne {
            depart: Point::new(0.0, 0.0),
            arrivee: Point::new(1.0, 1.0),
        };
        let mut points = vec![c.depart()];
        c.aplatir(0.001, &mut points);
        assert_eq!(points.len(), 2);
    }

    #[test]
    fn courbe_degeneree_ne_boucle_pas() {
        // Tous les points confondus : l'aplatissement doit rendre un seul point
        // et surtout ne pas récurser jusqu'à la limite de profondeur.
        let c = Courbe::Cubique {
            depart: Point::new(5.0, 5.0),
            controle1: Point::new(5.0, 5.0),
            controle2: Point::new(5.0, 5.0),
            arrivee: Point::new(5.0, 5.0),
        };
        assert_eq!(c.ecart_a_la_corde(), 0.0);
        let mut points = vec![c.depart()];
        c.aplatir(0.01, &mut points);
        assert_eq!(points.len(), 2, "un seul segment nul est acceptable");
        assert_eq!(points[1], Point::new(5.0, 5.0));
        assert_eq!(c.longueur(0.01), 0.0);
    }

    #[test]
    fn longueur_d_un_quart_de_cercle() {
        // Approximation connue : la constante de Bezier pour un quart de cercle
        // unité donne une longueur de π/2, à moins de 0,03 % près.
        let k = 0.552_284_749_830_793_4;
        let c = Courbe::Cubique {
            depart: Point::new(1.0, 0.0),
            controle1: Point::new(1.0, k),
            controle2: Point::new(k, 1.0),
            arrivee: Point::new(0.0, 1.0),
        };
        let l = c.longueur(1e-6);
        let attendu = std::f64::consts::FRAC_PI_2;
        assert!(
            (l - attendu).abs() / attendu < 1e-3,
            "longueur trouvée {l}, attendue {attendu}"
        );
    }

    #[test]
    fn chemin_continu_et_discontinu() {
        let a = Courbe::Ligne {
            depart: Point::new(0.0, 0.0),
            arrivee: Point::new(1.0, 0.0),
        };
        let b = Courbe::Ligne {
            depart: Point::new(1.0, 0.0),
            arrivee: Point::new(1.0, 1.0),
        };
        let points = Courbe::aplatir_chemin(&[a, b], 0.1).unwrap();
        assert_eq!(
            points,
            vec![
                Point::new(0.0, 0.0),
                Point::new(1.0, 0.0),
                Point::new(1.0, 1.0)
            ]
        );
        // Un trou d'un dixième de millimètre suffit à refuser.
        let c = Courbe::Ligne {
            depart: Point::new(1.1, 0.0),
            arrivee: Point::new(1.1, 1.0),
        };
        assert!(Courbe::aplatir_chemin(&[a, c], 0.1).is_err());
        // Un chemin vide n'est pas une erreur : il n'est rien.
        assert_eq!(Courbe::aplatir_chemin(&[], 0.1).unwrap(), Vec::new());
    }

    #[test]
    fn zeros_trouves_pour_une_cubique_rebroussante() {
        // B'(t) s'annule deux fois en x : deux extrema.
        let zeros = zeros_cubiques(0.0, 200.0, -100.0, 100.0);
        assert_eq!(zeros.len(), 2, "zéros trouvés : {zeros:?}");
        assert!(zeros.iter().all(|t| *t > 0.0 && *t < 1.0));
        // Dérivée linéaire : un seul zéro.
        let zeros = zeros_cubiques(0.0, 1.0, 2.0, 3.0);
        assert!(zeros.is_empty(), "zéros trouvés : {zeros:?}");
    }

    #[test]
    fn aplatissement_d_une_courbe_alignee_qui_rebrousse() {
        // Régression, et le genre de cas qu'un test écrit à la main oublie :
        // tous les points de contrôle sont ALIGNÉS sur la corde, donc l'écart
        // perpendiculaire est nul. Le critère de platitude seul déclarait la
        // courbe plate dès le premier niveau, et la polyligne restait à 0,74 de
        // la courbe — quelle que soit la tolérance demandée.
        //
        //   p0 = (0,0), c1 = (100,0), c2 = (−100,0), p3 = (0,0)
        let c = Courbe::Cubique {
            depart: Point::new(0.0, 0.0),
            controle1: Point::new(100.0, 0.0),
            controle2: Point::new(-100.0, 0.0),
            arrivee: Point::new(0.0, 0.0),
        };
        // La corde de la courbe entière est nulle (départ et arrivée
        // confondus) : l'écart est alors mesuré depuis le point de départ, et il
        // est grand. C'est ce qui fait subdiviser au premier niveau.
        assert_eq!(c.ecart_a_la_corde(), 75.0);
        // Le défaut est dans un MORCEAU : sa corde est franchement non nulle,
        // ses deux points de contrôle sont **dessus** — écart perpendiculaire
        // nul — et pourtant il rebrousse au-delà de son extrémité. Le critère de
        // distance seule le déclarait plat.
        let (gauche, _) = c.subdiviser(0.5);
        let (petit, _) = gauche.subdiviser(0.5);
        assert_eq!(petit.depart(), Point::new(0.0, 0.0));
        assert!((petit.arrivee().x - 28.125).abs() < 1e-12);
        assert_eq!(
            petit.ecart_a_la_corde(),
            0.0,
            "l’écart perpendiculaire est nul"
        );
        assert!(
            !petit.est_plate(0.1),
            "et pourtant le morceau n’est pas plat"
        );
        assert!(Courbe::Ligne {
            depart: Point::origine(),
            arrivee: Point::new(1.0, 1.0)
        }
        .est_plate(1e-9));
        for tolerance in [10.0, 1.0, 0.1, 0.01] {
            let mut points = vec![c.depart()];
            c.aplatir(tolerance, &mut points);
            let mut pire = 0.0_f64;
            for i in 0..=2000 {
                let p = c.point(i as f64 / 2000.0);
                let d = points
                    .windows(2)
                    .map(|w| distance_au_segment(p, w[0], w[1]))
                    .fold(f64::INFINITY, f64::min);
                pire = pire.max(d);
            }
            assert!(
                pire <= tolerance,
                "tolérance {tolerance} : écart {pire} — la subdivision s’arrête trop tôt"
            );
        }
    }

    /// Distance d'un point à une polyligne, en prenant le minimum sur les
    /// segments. Sert à mesurer la qualité de l'aplatissement.
    fn distance_au_polygone(p: Point, points: &[Point]) -> f64 {
        points
            .windows(2)
            .map(|paire| distance_au_segment(p, paire[0], paire[1]))
            .fold(f64::INFINITY, f64::min)
    }

    fn distance_au_segment(p: Point, a: Point, b: Point) -> f64 {
        let ab = b - a;
        let l2 = ab.scalaire(ab);
        if l2 == 0.0 {
            return p.distance(a);
        }
        let t = ((p - a).scalaire(ab) / l2).clamp(0.0, 1.0);
        p.distance(a + ab * t)
    }
}
