//! Points, vecteurs et boîtes englobantes.
//!
//! Rien d'exotique : ce module existe pour que le reste du crate s'écrive en
//! `p + q` plutôt qu'en `Point::new(p.x + q.x, p.y + q.y)`, et surtout pour que
//! les cas limites (point non fini, produit vectoriel presque nul) soient
//! traités **une fois**, au même endroit.
//!
//! L'unité n'a pas d'importance : millimètres, points PostScript ou pixels. Ce
//! crate ne fait que de la géométrie ; c'est l'appelant qui sait ce que valent
//! ses nombres.

use std::ops::{Add, Div, Mul, Neg, Sub};

/// Un point du plan, en coordonnées réelles.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Point {
    /// Abscisse.
    pub x: f64,
    /// Ordonnée.
    pub y: f64,
}

impl Point {
    /// Le point `(x, y)`.
    #[must_use]
    pub const fn new(x: f64, y: f64) -> Self {
        Self { x, y }
    }

    /// L'origine `(0, 0)`.
    #[must_use]
    pub const fn origine() -> Self {
        Self { x: 0.0, y: 0.0 }
    }

    /// Les deux coordonnées sont-elles des nombres finis ?
    ///
    /// Un `NaN` qui entre dans un calcul de géométrie en ressort rarement
    /// proprement : il vaut mieux le refuser au seuil.
    #[must_use]
    pub fn est_fini(&self) -> bool {
        self.x.is_finite() && self.y.is_finite()
    }

    /// Produit scalaire.
    #[must_use]
    pub fn scalaire(&self, autre: Self) -> f64 {
        self.x * autre.x + self.y * autre.y
    }

    /// Produit vectoriel (déterminant) : sa **norme** est l'aire du
    /// parallélogramme, son **signe** dit de quel côté tourne le chemin.
    #[must_use]
    pub fn vectoriel(&self, autre: Self) -> f64 {
        self.x * autre.y - self.y * autre.x
    }

    /// Longueur.
    #[must_use]
    pub fn longueur(&self) -> f64 {
        self.x.hypot(self.y)
    }

    /// Distance à un autre point.
    #[must_use]
    pub fn distance(&self, autre: Self) -> f64 {
        (*self - autre).longueur()
    }

    /// Interpolation linéaire : `0` rend `self`, `1` rend `autre`.
    #[must_use]
    pub fn interpole(&self, autre: Self, t: f64) -> Self {
        Self::new(
            self.x + (autre.x - self.x) * t,
            self.y + (autre.y - self.y) * t,
        )
    }

    /// Vecteur normalisé, ou l'origine si le vecteur est nul.
    #[must_use]
    pub fn normalise(&self) -> Self {
        let l = self.longueur();
        if l == 0.0 {
            Self::origine()
        } else {
            *self / l
        }
    }

    /// Normale à gauche (rotation d'un quart de tour dans le sens direct).
    #[must_use]
    pub fn normale_gauche(&self) -> Self {
        Self::new(-self.y, self.x)
    }

    /// Le point est-il à l'intérieur de la boîte `(min, max)` ?
    #[must_use]
    pub fn dans_boite(&self, min: Self, max: Self) -> bool {
        self.x >= min.x && self.x <= max.x && self.y >= min.y && self.y <= max.y
    }
}

impl Add for Point {
    type Output = Self;
    fn add(self, autre: Self) -> Self {
        Self::new(self.x + autre.x, self.y + autre.y)
    }
}

impl Sub for Point {
    type Output = Self;
    fn sub(self, autre: Self) -> Self {
        Self::new(self.x - autre.x, self.y - autre.y)
    }
}

impl Mul<f64> for Point {
    type Output = Self;
    fn mul(self, facteur: f64) -> Self {
        Self::new(self.x * facteur, self.y * facteur)
    }
}

impl Div<f64> for Point {
    type Output = Self;
    fn div(self, facteur: f64) -> Self {
        Self::new(self.x / facteur, self.y / facteur)
    }
}

impl Neg for Point {
    type Output = Self;
    fn neg(self) -> Self {
        Self::new(-self.x, -self.y)
    }
}

/// Boîte alignée sur les axes.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Boite {
    /// Coin inférieur gauche.
    pub min: Point,
    /// Coin supérieur droit.
    pub max: Point,
}

impl Boite {
    /// Une boîte **vide**, qui ne contient rien et qu'on peut agrandir.
    ///
    /// Elle est écrite avec les infinis opposés : c'est la seule valeur qui,
    /// une fois passée à [`Boite::englober`], rend exactement l'autre boîte.
    #[must_use]
    pub fn vide() -> Self {
        Self {
            min: Point::new(f64::INFINITY, f64::INFINITY),
            max: Point::new(f64::NEG_INFINITY, f64::NEG_INFINITY),
        }
    }

    /// La boîte d'un seul point.
    #[must_use]
    pub fn du_point(p: Point) -> Self {
        Self { min: p, max: p }
    }

    /// Agrandit la boîte pour contenir un point.
    pub fn englober(&mut self, p: Point) {
        self.min = Point::new(self.min.x.min(p.x), self.min.y.min(p.y));
        self.max = Point::new(self.max.x.max(p.x), self.max.y.max(p.y));
    }

    /// Agrandit la boîte pour contenir une autre boîte.
    pub fn englober_boite(&mut self, autre: Self) {
        self.englober(autre.min);
        self.englober(autre.max);
    }

    /// La boîte est-elle vide (aucun point englobé) ?
    #[must_use]
    pub fn est_vide(&self) -> bool {
        self.min.x > self.max.x || self.min.y > self.max.y
    }

    /// Largeur (0 pour une boîte vide).
    #[must_use]
    pub fn largeur(&self) -> f64 {
        if self.est_vide() {
            0.0
        } else {
            self.max.x - self.min.x
        }
    }

    /// Hauteur (0 pour une boîte vide).
    #[must_use]
    pub fn hauteur(&self) -> f64 {
        if self.est_vide() {
            0.0
        } else {
            self.max.y - self.min.y
        }
    }

    /// Contient-elle le point ? Les bords comptent comme dedans.
    #[must_use]
    pub fn contient(&self, p: Point) -> bool {
        p.dans_boite(self.min, self.max)
    }

    /// Les deux boîtes se recouvrent-elles ? Les bords qui se touchent comptent.
    #[must_use]
    pub fn recouvre(&self, autre: Self) -> bool {
        !(self.est_vide()
            || autre.est_vide()
            || self.max.x < autre.min.x
            || autre.max.x < self.min.x
            || self.max.y < autre.min.y
            || autre.max.y < self.min.y)
    }

    /// La boîte grandie de `marge` de chaque côté.
    #[must_use]
    pub fn elargie(&self, marge: f64) -> Self {
        if self.est_vide() {
            *self
        } else {
            Self {
                min: self.min - Point::new(marge, marge),
                max: self.max + Point::new(marge, marge),
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn operations_de_base() {
        let p = Point::new(3.0, 4.0);
        assert_eq!(p.longueur(), 5.0);
        assert_eq!(p.normalise().longueur(), 1.0);
        assert_eq!(p + Point::new(1.0, 1.0), Point::new(4.0, 5.0));
        assert_eq!(p - p, Point::origine());
        assert_eq!(p * 2.0, Point::new(6.0, 8.0));
        assert_eq!(-p, Point::new(-3.0, -4.0));
    }

    #[test]
    fn produit_vectoriel_donne_le_sens() {
        let ox = Point::new(1.0, 0.0);
        let oy = Point::new(0.0, 1.0);
        // Du +x vers le +y : sens direct, déterminant positif.
        assert_eq!(ox.vectoriel(oy), 1.0);
        assert_eq!(oy.vectoriel(ox), -1.0);
        // Colinéaires : aire nulle.
        assert_eq!(ox.vectoriel(Point::new(5.0, 0.0)), 0.0);
    }

    #[test]
    fn interpolation() {
        let a = Point::new(0.0, 0.0);
        let b = Point::new(10.0, 20.0);
        assert_eq!(a.interpole(b, 0.0), a);
        assert_eq!(a.interpole(b, 1.0), b);
        assert_eq!(a.interpole(b, 0.5), Point::new(5.0, 10.0));
    }

    #[test]
    fn vecteur_nul_ne_produit_pas_de_nan() {
        let z = Point::origine();
        assert_eq!(z.normalise(), z);
        assert_eq!(z.normale_gauche(), z);
    }

    #[test]
    fn normaliser_un_point_non_fini_se_voit() {
        let nan = Point::new(f64::NAN, 0.0);
        assert!(!nan.est_fini());
        assert!(Point::origine().est_fini());
    }

    #[test]
    fn boite_vide_englobe_l_autre_exactement() {
        let mut b = Boite::vide();
        assert!(b.est_vide());
        assert_eq!(b.largeur(), 0.0);
        let autre = Boite {
            min: Point::new(1.0, 2.0),
            max: Point::new(3.0, 4.0),
        };
        b.englober_boite(autre);
        assert_eq!(b, autre);
        assert_eq!(b.largeur(), 2.0);
        assert_eq!(b.hauteur(), 2.0);
    }

    #[test]
    fn boite_contient_et_recouvre() {
        let b = Boite {
            min: Point::new(0.0, 0.0),
            max: Point::new(10.0, 10.0),
        };
        assert!(b.contient(Point::new(0.0, 0.0)));
        assert!(b.contient(Point::new(10.0, 10.0)));
        assert!(!b.contient(Point::new(10.1, 5.0)));
        // Deux boîtes qui se touchent se recouvrent : c'est ce qu'on veut pour
        // un premier tri avant de calculer une vraie intersection.
        let collee = Boite {
            min: Point::new(10.0, 0.0),
            max: Point::new(20.0, 10.0),
        };
        assert!(b.recouvre(collee));
        let loin = Boite {
            min: Point::new(10.001, 0.0),
            max: Point::new(20.0, 10.0),
        };
        assert!(!b.recouvre(loin));
        assert!(!b.recouvre(Boite::vide()));
    }

    #[test]
    fn boite_elargie() {
        let b = Boite {
            min: Point::new(0.0, 0.0),
            max: Point::new(10.0, 10.0),
        };
        let e = b.elargie(2.0);
        assert_eq!(e.min, Point::new(-2.0, -2.0));
        assert_eq!(e.max, Point::new(12.0, 12.0));
        assert!(Boite::vide().elargie(2.0).est_vide());
    }
}
