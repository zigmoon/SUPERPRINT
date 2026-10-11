//! Matrice affine `[a b c d tx ty]`, et sa convention.
//!
//! ## La convention, écrite une fois pour toutes
//!
//! Six nombres, et `(x, y) → (a·x + c·y + tx, b·x + d·y + ty)`. C'est la
//! convention du PostScript **et** celle du SVG : les deux formats écrivent
//! leurs transformations dans cet ordre, et le noyau le fait donc aussi.
//!
//! ## `concatener` : l'ordre est celui des langages, pas celui des matrices
//!
//! `a.concatener(b)` rend la transformation qui applique **`a` d'abord**, puis
//! `b`. C'est ce que suppose un programme qui lit `translate` puis `scale` : il
//! veut l'échelle dans le repère local. C'est aussi ce que suppose un
//! `transform="translate(...) scale(...)"` de SVG, où la transformation la plus
//! **à droite** s'applique en premier.
//!
//! La conséquence pratique, pour qui empile une liste de transformations : il
//! faut écrire `m = t.concatener(m)` en parcourant la liste **dans l'ordre du
//! document**. C'est fait dans [`superprint_doc::svg`], et la raison est ici.
//!
//! ## Ce que le crate refuse
//!
//! [`Matrice::inverse`] rend l'identité quand le déterminant est nul ou non
//! fini : une transformation qui écrase le plan n'a pas d'inverse, et rendre
//! `NaN` propagerait le défaut jusqu'au PDF livré.

use crate::point::Point;

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

    /// Une rotation autour d'un point (`rotate(a, cx, cy)` du SVG).
    #[must_use]
    pub fn rotation_autour(degres: f64, cx: f64, cy: f64) -> Self {
        Self::translation(-cx, -cy)
            .concatener(Self::rotation(degres).concatener(Self::translation(cx, cy)))
    }

    /// Un cisaillement selon l'axe des abscisses (`skewX`), en degrés.
    #[must_use]
    pub fn inclinaison_x(degres: f64) -> Self {
        Self([1.0, 0.0, degres.to_radians().tan(), 1.0, 0.0, 0.0])
    }

    /// Un cisaillement selon l'axe des ordonnées (`skewY`), en degrés.
    #[must_use]
    pub fn inclinaison_y(degres: f64) -> Self {
        Self([1.0, degres.to_radians().tan(), 0.0, 1.0, 0.0, 0.0])
    }

    /// La composition « `self` s'applique **avant** `autre` ».
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

    /// L'échelle appliquée à une longueur, dans la direction la plus étirée.
    ///
    /// Sert à translater une tolérance d'aplatissement dans le repère de
    /// l'appareil : une courbe réduite dix fois demande dix fois moins de
    /// sommets pour la même précision apparente.
    #[must_use]
    pub fn echelle_maximale(&self) -> f64 {
        let [a, b, c, d, _, _] = self.0;
        let colonne_x = (a * a + b * b).sqrt();
        let colonne_y = (c * c + d * d).sqrt();
        colonne_x.max(colonne_y)
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
    fn empiler_une_liste_du_svg() {
        // `transform="translate(10,10) scale(2)"` : l'échelle s'applique
        // d'abord (elle est à droite), la translation ensuite.
        let mut m = Matrice::identite();
        for t in [Matrice::translation(10.0, 10.0), Matrice::echelle(2.0, 2.0)] {
            m = t.concatener(m);
        }
        assert_eq!(m.appliquer(Point::new(1.0, 1.0)), Point::new(12.0, 12.0));
    }

    #[test]
    fn rotation_autour_d_un_point() {
        // Le centre ne bouge pas, et son voisin de droite monte.
        let m = Matrice::rotation_autour(90.0, 100.0, 100.0);
        let centre = m.appliquer(Point::new(100.0, 100.0));
        assert!(
            proche(centre.x, 100.0) && proche(centre.y, 100.0),
            "{centre:?}"
        );
        let voisin = m.appliquer(Point::new(110.0, 100.0));
        assert!(
            proche(voisin.x, 100.0) && proche(voisin.y, 110.0),
            "{voisin:?}"
        );
    }

    #[test]
    fn cisaillements() {
        // skewX(45°) : y ne bouge pas, x avance de y.
        let m = Matrice::inclinaison_x(45.0);
        let p = m.appliquer(Point::new(0.0, 10.0));
        assert!(proche(p.x, 10.0) && proche(p.y, 10.0), "{p:?}");
        // skewY(45°) : x ne bouge pas, y avance de x.
        let m = Matrice::inclinaison_y(45.0);
        let p = m.appliquer(Point::new(10.0, 0.0));
        assert!(proche(p.x, 10.0) && proche(p.y, 10.0), "{p:?}");
    }

    #[test]
    fn echelle_maximale_sert_a_translater_une_tolerance() {
        assert!(proche(Matrice::identite().echelle_maximale(), 1.0));
        assert!(proche(Matrice::echelle(3.0, 2.0).echelle_maximale(), 3.0));
        // Une rotation pure ne change pas l'échelle.
        assert!(proche(Matrice::rotation(37.0).echelle_maximale(), 1.0));
    }
}
