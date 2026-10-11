//! Le dessin produit : matrices, chemins, couleurs, peintures.
//!
//! ## La matrice, et sa convention
//!
//! PostScript décrit une transformation par six nombres `[a b c d tx ty]`, et
//! applique `(x, y) → (a·x + c·y + tx, b·x + d·y + ty)`. `concat` **pré**-multiplie :
//! la matrice donnée s'applique **avant** celle en cours. C'est cette convention
//! qui fait qu'un `translate` suivi d'un `scale` met l'échelle d'abord dans le
//! repère local — et c'est ce que tout programme PostScript suppose.
//!
//! ## Ce qui est enregistré, et dans quel repère
//!
//! Chaque chemin est donné dans le repère **de l'appareil** (après la matrice),
//! en points PostScript. Un import de mise en page n'a que faire du repère
//! utilisateur : ce qu'il veut, c'est la forme là où elle se dessine.
//!
//! ## Le découpage
//!
//! `clip` est **enregistré** comme une opération, mais il n'est **pas appliqué**
//! aux formes suivantes : découper vraiment demanderait une algèbre booléenne de
//! régions, et le noyau préfère le dire que de laisser croire que la forme est
//! découpée. L'avertissement est posé une fois, à la première occurrence.

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
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Matrice(pub [f64; 6]);

impl Default for Matrice {
    fn default() -> Self {
        Self::identite()
    }
}

impl Matrice {
    /// La matrice identité.
    #[must_use]
    pub const fn identite() -> Self {
        Self([1.0, 0.0, 0.0, 1.0, 0.0, 0.0])
    }

    /// Une translation.
    #[must_use]
    pub const fn translation(dx: f64, dy: f64) -> Self {
        Self([1.0, 0.0, 0.0, 1.0, dx, dy])
    }

    /// Une mise à l'échelle.
    #[must_use]
    pub const fn echelle(fx: f64, fy: f64) -> Self {
        Self([fx, 0.0, 0.0, fy, 0.0, 0.0])
    }

    /// Une rotation d'un angle en degrés (sens direct).
    #[must_use]
    pub fn rotation(degres: f64) -> Self {
        let radians = degres.to_radians();
        Self([
            radians.cos(),
            radians.sin(),
            -radians.sin(),
            radians.cos(),
            0.0,
            0.0,
        ])
    }

    /// La composition `self ∘ autre` : `self` s'applique **avant** `autre`.
    ///
    /// C'est la convention de `concat` en PostScript.
    #[must_use]
    pub fn concatener(&self, autre: Self) -> Self {
        let [a1, b1, c1, d1, tx1, ty1] = self.0;
        let [a2, b2, c2, d2, tx2, ty2] = autre.0;
        Self([
            a1 * a2 + b1 * c2,
            a1 * b2 + b1 * d2,
            c1 * a2 + d1 * c2,
            c1 * b2 + d1 * d2,
            tx1 * a2 + ty1 * c2 + tx2,
            tx1 * b2 + ty1 * d2 + ty2,
        ])
    }

    /// Applique la matrice à un point.
    #[must_use]
    pub fn appliquer(&self, p: Point) -> Point {
        let [a, b, c, d, tx, ty] = self.0;
        Point::new(a * p.x + c * p.y + tx, b * p.x + d * p.y + ty)
    }

    /// Le déterminant : nul si la transformation écrase le plan.
    #[must_use]
    pub fn determinant(&self) -> f64 {
        self.0[0] * self.0[3] - self.0[1] * self.0[2]
    }

    /// Le déterminant est-il non nul ?
    #[must_use]
    pub fn est_inversible(&self) -> bool {
        self.determinant() != 0.0 && self.est_finie()
    }

    /// L'inverse, ou la matrice identité si la transformation n'est pas
    /// inversible.
    #[must_use]
    pub fn inverse(&self) -> Self {
        let det = self.determinant();
        if det == 0.0 || !det.is_finite() {
            return Self::identite();
        }
        let [a, b, c, d, tx, ty] = self.0;
        // L'inverse d'une matrice affine `[[a c tx],[b d ty],[0 0 1]]`.
        Self([
            d / det,
            -b / det,
            -c / det,
            a / det,
            (c * ty - d * tx) / det,
            (b * tx - a * ty) / det,
        ])
    }

    /// Toutes les valeurs sont-elles finies ?
    #[must_use]
    pub fn est_finie(&self) -> bool {
        self.0.iter().all(|v| v.is_finite())
    }
}

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
    /// Région de découpage (`clip`, `eoclip`) : enregistrée, non appliquée.
    Tronque,
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
        }
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
