//! Le dessin produit : chemins, couleurs, peintures.
//!
//! ## La matrice
//!
//! PostScript décrit une transformation par six nombres `[a b c d tx ty]`, et
//! applique `(x, y) → (a·x + c·y + tx, b·x + d·y + ty)`. `concat` **pré**-multiplie :
//! la matrice donnée s'applique **avant** celle en cours. C'est cette convention
//! qui fait qu'un `translate` suivi d'un `scale` met l'échelle d'abord dans le
//! repère local — et c'est ce que tout programme PostScript suppose.
//!
//! Cette matrice est désormais définie dans **`superprint-path`**
//! ([`superprint_path::matrice::Matrice`]), dont dépendent les trois importeurs
//! de dessin (PostScript, SVG, et la géométrie elle-même). Elle est ré-exportée
//! ici : `superprint_ps::Matrice` reste valide.
//!
//! ## Ce qui est enregistré, et dans quel repère
//!
//! Chaque chemin est donné dans le repère **de l'appareil** (après la matrice),
//! en points PostScript. Un import de mise en page n'a que faire du repère
//! utilisateur : ce qu'il veut, c'est la forme là où elle se dessine.
//!
//! ## Le découpage
//!
//! `clip` **est appliqué** : le noyau intersecte chaque forme peinte avec la
//! région de découpage en vigueur ([`superprint_path::booleen`]). Le dessin du
//! découpage lui-même reste **enregistré** ([`Peinture::Tronque`]) : c'est ce
//! que la colle Fabric lit pour ne pas le peindre, et ce que le vérificateur
//! indépendant lit pour recalculer la région de son côté.
//!
//! Trois conséquences, et elles se voient :
//!
//! - un **trait** découpé devient une **surface** remplie. Un trait n'a pas
//!   d'intersection avec une région ; c'est la surface qu'il encre qui en a une.
//!   La peinture change donc de nature, et la couleur ne change pas ;
//! - une forme **entièrement hors** de la région n'est plus peinte du tout :
//!   elle disparaît, et c'est exact ;
//! - une forme que l'algèbre **refuse** de découper (un anneau qui
//!   s'auto-intersecte, un trait insoluble) est peinte **entière**, comme avant
//!   ce changement, avec un avertissement qui le dit. Peindre un peu trop se
//!   voit ; perdre un objet ne se voit pas.

use superprint_path::point::Point;

/// Une couleur PostScript, dans son espace d'origine.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Couleur {
    /// Un gris, de 0 (noir) à 1 (blanc).
    Gris(f64),
    /// Un RVB, chaque composante de 0 à 1.
    Rvb(f64, f64, f64),
    /// Un CMJN, chaque composante de 0 à 1.
    Cmjn(f64, f64, f64, f64),
}

impl Default for Couleur {
    fn default() -> Self {
        Self::Gris(0.0)
    }
}

impl Couleur {
    /// Les composantes, dans l'ordre de l'espace.
    #[must_use]
    pub fn composantes(&self) -> Vec<f64> {
        match *self {
            Self::Gris(g) => vec![g],
            Self::Rvb(r, v, b) => vec![r, v, b],
            Self::Cmjn(c, m, j, n) => vec![c, m, j, n],
        }
    }

    /// Le nom de l'espace.
    #[must_use]
    pub fn espace(&self) -> &'static str {
        match self {
            Self::Gris(_) => "gris",
            Self::Rvb(..) => "rvb",
            Self::Cmjn(..) => "cmjn",
        }
    }

    /// Chaque composante est-elle dans `[0, 1]` ?
    #[must_use]
    pub fn est_dans_les_bornes(&self) -> bool {
        self.composantes().iter().all(|v| (0.0..=1.0).contains(v))
    }
}

/// Une matrice de transformation `[a b c d tx ty]`.
///
/// Définie dans `superprint-path` — la convention est la même pour PostScript et
/// pour SVG — et ré-exportée ici pour que `superprint_ps::Matrice` reste valide.
pub use superprint_path::matrice::Matrice;

/// Ce qu'on fait d'un chemin.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Peinture {
    /// Remplissage par la règle non nulle (`fill`).
    Rempli,
    /// Remplissage par la règle pair-impair (`eofill`).
    RempliPairImpair,
    /// Contour, avec son épaisseur (`stroke`).
    Contour {
        /// Épaisseur du trait, en points.
        epaisseur: f64,
    },
    /// Région de découpage (`clip`, `W`), de règle **non nulle** : le dessin est
    /// enregistré, et la région qu'il décrit découpe les peintures suivantes.
    Tronque,
    /// Région de découpage de règle **pair-impair** (`eoclip`, `W*`).
    ///
    /// La distinction n'est pas cosmétique : sous la règle non nulle, deux
    /// anneaux tournant dans le même sens s'additionnent — un « trou » doit être
    /// inversé pour en être un. Sous la règle pair-impair, la parité suffit.
    /// Sur un chemin qui s'auto-croise, les deux découpent des régions
    /// différentes.
    TronquePairImpair,
}

impl Peinture {
    /// Le nom de la peinture.
    #[must_use]
    pub fn nom(&self) -> &'static str {
        match self {
            Self::Rempli => "remplissage",
            Self::RempliPairImpair => "remplissage-pair-impair",
            Self::Contour { .. } => "contour",
            Self::Tronque => "decoupage",
            Self::TronquePairImpair => "decoupage-pair-impair",
        }
    }

    /// Est-ce un découpage (et non une peinture) ?
    #[must_use]
    pub fn est_decoupage(&self) -> bool {
        matches!(self, Self::Tronque | Self::TronquePairImpair)
    }
}

/// Un chemin peint : ses sous-chemins, sa peinture, sa couleur.
#[derive(Clone, Debug, PartialEq)]
pub struct Dessin {
    /// Les sous-chemins, en coordonnées d'appareil.
    pub sous_chemins: Vec<Vec<Point>>,
    /// Ce qu'on en fait.
    pub peinture: Peinture,
    /// La couleur au moment de peindre.
    pub couleur: Couleur,
}

impl Dessin {
    /// Nombre de sommets, tous sous-chemins confondus.
    #[must_use]
    pub fn nombre_de_sommets(&self) -> usize {
        self.sous_chemins.iter().map(Vec::len).sum()
    }

    /// La boîte englobante du dessin, ou `None` s'il n'a aucun point.
    #[must_use]
    pub fn boite(&self) -> Option<(Point, Point)> {
        let mut min: Option<Point> = None;
        let mut max: Option<Point> = None;
        for point in self.sous_chemins.iter().flatten() {
            min = Some(match min {
                None => *point,
                Some(m) => Point::new(m.x.min(point.x), m.y.min(point.y)),
            });
            max = Some(match max {
                None => *point,
                Some(m) => Point::new(m.x.max(point.x), m.y.max(point.y)),
            });
        }
        Some((min?, max?))
    }

    /// L'aire signée du dessin, tous sous-chemins additionnés (formule du lacet).
    ///
    /// Sert aux contrôles : deux interprétations qui trouvent la même surface
    /// pour un rectangle sont d'accord sur le rectangle. L'aire est **signée**,
    /// donc un trou parcouru à l'envers se **retranche** — ce qui est
    /// exactement la propriété utile.
    #[must_use]
    pub fn aire(&self) -> f64 {
        let mut somme = 0.0;
        for sous_chemin in &self.sous_chemins {
            let n = sous_chemin.len();
            if n < 3 {
                continue;
            }
            for i in 0..n {
                let a = sous_chemin[i];
                let b = sous_chemin[(i + 1) % n];
                somme += a.x * b.y - b.x * a.y;
            }
        }
        somme / 2.0
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::f64::consts::FRAC_PI_4;

    fn proche(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-9
    }

    #[test]
    fn identite() {
        let m = Matrice::identite();
        assert_eq!(m.appliquer(Point::new(3.0, 4.0)), Point::new(3.0, 4.0));
        assert!(proche(m.determinant(), 1.0));
    }

    #[test]
    fn translation() {
        let m = Matrice::translation(10.0, 20.0);
        assert_eq!(m.appliquer(Point::new(0.0, 0.0)), Point::new(10.0, 20.0));
        assert_eq!(m.appliquer(Point::new(1.0, 2.0)), Point::new(11.0, 22.0));
    }

    #[test]
    fn echelle() {
        let m = Matrice::echelle(2.0, 3.0);
        assert_eq!(m.appliquer(Point::new(3.0, 4.0)), Point::new(6.0, 12.0));
        assert!(proche(m.determinant(), 6.0));
    }

    #[test]
    fn rotation_d_un_quart_de_tour() {
        let m = Matrice::rotation(90.0);
        let p = m.appliquer(Point::new(1.0, 0.0));
        assert!(proche(p.x, 0.0) && proche(p.y, 1.0), "{p:?}");
        let p = m.appliquer(Point::new(0.0, 1.0));
        assert!(proche(p.x, -1.0) && proche(p.y, 0.0), "{p:?}");
        assert!(proche(m.determinant(), 1.0));
    }

    #[test]
    fn rotation_45_degres() {
        let m = Matrice::rotation(45.0);
        let p = m.appliquer(Point::new(1.0, 0.0));
        // cos(45°) = sin(45°) = √2/2.
        let racine = FRAC_PI_4.cos();
        assert!(proche(p.x, racine) && proche(p.y, racine));
    }

    #[test]
    fn concat_met_l_echelle_dans_le_repere_local() {
        // `10 10 translate 2 2 scale` : un point (1,1) doit donner (12,12).
        let m = Matrice::echelle(2.0, 2.0).concatener(Matrice::translation(10.0, 10.0));
        assert_eq!(m.appliquer(Point::new(1.0, 1.0)), Point::new(12.0, 12.0));
        // Et l'ordre inverse donne autre chose : c'est le sens de « pré-multiplie ».
        let inverse = Matrice::translation(10.0, 10.0).concatener(Matrice::echelle(2.0, 2.0));
        assert_eq!(
            inverse.appliquer(Point::new(1.0, 1.0)),
            Point::new(22.0, 22.0)
        );
    }

    #[test]
    fn rotation_puis_translation() {
        // Rotation de 90° autour de l'origine, puis translation de (5,5).
        let m = Matrice::rotation(90.0).concatener(Matrice::translation(5.0, 5.0));
        let p = m.appliquer(Point::new(1.0, 0.0));
        assert!(proche(p.x, 5.0) && proche(p.y, 6.0), "{p:?}");
    }

    #[test]
    fn matrice_ecrasante_a_un_determinant_nul() {
        let m = Matrice::echelle(1.0, 0.0);
        assert!(proche(m.determinant(), 0.0));
        assert_eq!(m.appliquer(Point::new(3.0, 4.0)), Point::new(3.0, 0.0));
    }

    #[test]
    fn matrice_non_finie_se_voit() {
        assert!(Matrice::identite().est_finie());
        assert!(!Matrice::echelle(f64::NAN, 1.0).est_finie());
    }

    #[test]
    fn couleurs() {
        assert_eq!(Couleur::Gris(0.5).composantes(), vec![0.5]);
        assert_eq!(
            Couleur::Rvb(1.0, 0.0, 0.0).composantes(),
            vec![1.0, 0.0, 0.0]
        );
        assert_eq!(Couleur::Cmjn(0.0, 1.0, 1.0, 0.0).espace(), "cmjn");
        assert!(Couleur::Rvb(0.0, 0.5, 1.0).est_dans_les_bornes());
        assert!(!Couleur::Gris(1.5).est_dans_les_bornes());
        assert!(!Couleur::Gris(-0.1).est_dans_les_bornes());
    }

    #[test]
    fn dessin_boite_et_aire() {
        let dessin = Dessin {
            sous_chemins: vec![vec![
                Point::new(0.0, 0.0),
                Point::new(10.0, 0.0),
                Point::new(10.0, 20.0),
                Point::new(0.0, 20.0),
            ]],
            peinture: Peinture::Rempli,
            couleur: Couleur::Gris(0.0),
        };
        assert_eq!(dessin.nombre_de_sommets(), 4);
        let (min, max) = dessin.boite().unwrap();
        assert_eq!(min, Point::new(0.0, 0.0));
        assert_eq!(max, Point::new(10.0, 20.0));
        assert!(proche(dessin.aire(), 200.0), "aire {}", dessin.aire());
    }

    #[test]
    fn dessin_sans_point() {
        let dessin = Dessin {
            sous_chemins: vec![],
            peinture: Peinture::Contour { epaisseur: 1.0 },
            couleur: Couleur::Gris(0.0),
        };
        assert_eq!(dessin.nombre_de_sommets(), 0);
        assert!(dessin.boite().is_none());
        assert_eq!(dessin.peinture.nom(), "contour");
    }
}
