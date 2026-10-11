//! Polygones, aires signées, et **règles de remplissage**.
//!
//! ## Ce qu'une forme pleine veut dire
//!
//! Un même anneau dessiné en boucle peut représenter deux choses différentes :
//! un disque, ou un disque percé. Tout dépend de la **règle de remplissage** :
//!
//! - `NonZero` (le défaut du produit, et celui du PDF) : un point est dedans si
//!   le nombre d'enroulements autour de lui n'est pas nul — donc un anneau
//!   intérieur parcouru **dans le sens inverse** fait un trou ;
//! - `PairImpair` : un point est dedans si un rayon parti de lui coupe les
//!   arêtes un nombre impair de fois — donc un anneau intérieur fait **toujours**
//!   un trou, quel que soit son sens.
//!
//! Ces deux règles ne sont pas un détail d'implémentation : elles décident si
//! l'anneau intérieur est un trou ou une partie pleine. Le produit, lui,
//! confiait la question à Paper.js.
//!
//! ## Aire signée
//!
//! L'aire est **signée** : positive pour un anneau parcouru dans le sens direct
//! (anti-horaire), négative sinon. Ce n'est pas une coquetterie : c'est le
//! signe qui porte le sens, et c'est le sens qui fait les trous sous la règle
//! `NonZero`. `aire_absolue` est fournie à côté, et les deux sont testées.

use crate::point::{Boite, Point};
use crate::ErreurPath;

/// Règle de remplissage d'une forme.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Regle {
    /// Un point est dedans si le nombre d'enroulements est non nul.
    NonZero,
    /// Un point est dedans si un rayon le coupe un nombre impair de fois.
    PairImpair,
}

/// Un anneau fermé : une suite de sommets, **implicitement refermée**.
///
/// Le premier sommet n'est pas répété à la fin. Répéter le dernier point est
/// l'erreur d'entrée la plus fréquente, et elle crée un segment nul : la
/// normalisation s'en charge ([`Polygone::nettoyer`]).
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Polygone {
    /// Les sommets, dans l'ordre.
    pub points: Vec<Point>,
}

impl Polygone {
    /// Construit un anneau à partir de ses sommets.
    #[must_use]
    pub fn nouveau(points: Vec<Point>) -> Self {
        Self { points }
    }

    /// Un rectangle, dans le sens direct.
    #[must_use]
    pub fn rectangle(x: f64, y: f64, largeur: f64, hauteur: f64) -> Self {
        Self::nouveau(vec![
            Point::new(x, y),
            Point::new(x + largeur, y),
            Point::new(x + largeur, y + hauteur),
            Point::new(x, y + hauteur),
        ])
    }

    /// Un anneau régulier à `cotes` sommets, dans le sens direct.
    #[must_use]
    pub fn regulier(centre: Point, rayon: f64, cotes: usize) -> Self {
        let cotes = cotes.max(3);
        let points = (0..cotes)
            .map(|i| {
                let angle = std::f64::consts::TAU * i as f64 / cotes as f64;
                centre + Point::new(angle.cos(), angle.sin()) * rayon
            })
            .collect();
        Self::nouveau(points)
    }

    /// Nombre de sommets.
    #[must_use]
    pub fn nombre_de_sommets(&self) -> usize {
        self.points.len()
    }

    /// Le polygone est-il exploitable (au moins trois sommets distincts) ?
    #[must_use]
    pub fn est_valide(&self) -> bool {
        self.points.len() >= 3 && self.points.iter().all(Point::est_fini)
    }

    /// Aire **signée** : positive si l'anneau tourne dans le sens direct.
    ///
    /// Formule du lacet (shoelace). Elle est exacte pour un anneau simple, et
    /// reste l'intégrale de l'indicatrice pour un anneau quelconque — ce qui est
    /// précisément la propriété utile quand on mesure des aires de résultats
    /// booléens.
    #[must_use]
    pub fn aire(&self) -> f64 {
        let n = self.points.len();
        if n < 3 {
            return 0.0;
        }
        let mut somme = 0.0;
        for i in 0..n {
            let a = self.points[i];
            let b = self.points[(i + 1) % n];
            somme += a.vectoriel(b);
        }
        somme / 2.0
    }

    /// Aire absolue.
    #[must_use]
    pub fn aire_absolue(&self) -> f64 {
        self.aire().abs()
    }

    /// Périmètre.
    #[must_use]
    pub fn perimetre(&self) -> f64 {
        let n = self.points.len();
        if n < 2 {
            return 0.0;
        }
        (0..n)
            .map(|i| self.points[i].distance(self.points[(i + 1) % n]))
            .sum()
    }

    /// Boîte englobante.
    #[must_use]
    pub fn boite(&self) -> Boite {
        let mut b = Boite::vide();
        for p in &self.points {
            b.englober(*p);
        }
        b
    }

    /// Inverse le sens de parcours.
    ///
    /// C'est l'opération qui transforme un disque en trou sous la règle
    /// `NonZero` : rien n'est retiré, tout est retourné.
    pub fn inverser(&mut self) {
        self.points.reverse();
    }

    /// Nombre d'enroulements autour d'un point (**règle `NonZero`**).
    ///
    /// C'est le nombre algébrique de tours que fait l'anneau autour du point.
    /// Un anneau direct et un anneau inverse de même trace donnent `+1` et `−1`,
    /// donc `0` ensemble : le trou est percé.
    #[must_use]
    pub fn enroulements(&self, p: Point) -> i32 {
        let n = self.points.len();
        if n < 3 {
            return 0;
        }
        let mut enroulements = 0;
        for i in 0..n {
            let a = self.points[i];
            let b = self.points[(i + 1) % n];
            // Un point qui est exactement sur une arête compte comme dedans :
            // c'est le choix qui rend `contient` stable quand on teste un point
            // de bord, et il est documenté ici.
            if sur_segment(p, a, b) {
                return 1;
            }
            if a.y <= p.y {
                if b.y > p.y && (b - a).vectoriel(p - a) > 0.0 {
                    enroulements += 1;
                }
            } else if b.y <= p.y && (b - a).vectoriel(p - a) < 0.0 {
                enroulements -= 1;
            }
        }
        enroulements
    }

    /// Nombre de croisements d'un rayon partant vers la droite
    /// (**règle `PairImpair`**).
    #[must_use]
    pub fn croisements(&self, p: Point) -> u32 {
        let n = self.points.len();
        if n < 3 {
            return 0;
        }
        let mut croisements = 0;
        for i in 0..n {
            let a = self.points[i];
            let b = self.points[(i + 1) % n];
            if sur_segment(p, a, b) {
                return 1;
            }
            // Le demi-intervalle [a.y, b.y[ évite de compter deux fois un
            // sommet traversé.
            if (a.y > p.y) != (b.y > p.y) {
                let x = a.x + (p.y - a.y) / (b.y - a.y) * (b.x - a.x);
                if x > p.x {
                    croisements += 1;
                }
            }
        }
        croisements
    }

    /// Le point est-il à l'intérieur, selon la règle donnée ?
    #[must_use]
    pub fn contient(&self, p: Point, regle: Regle) -> bool {
        match regle {
            Regle::NonZero => self.enroulements(p) != 0,
            Regle::PairImpair => self.croisements(p) % 2 == 1,
        }
    }

    /// Retire les sommets confondus et les sommets alignés.
    ///
    /// Un segment nul n'a pas d'orientation, et un sommet aligné entre ses deux
    /// voisins n'apporte rien. Les deux sont la source la plus banale d'échec
    /// des algorithmes booléens, alors on les élimine à l'entrée plutôt que de
    /// les traîner : c'est moins de code, et plus sûr.
    #[must_use]
    pub fn nettoyer(&self, epsilon: f64) -> Self {
        let epsilon = epsilon.abs();
        let mut points: Vec<Point> = Vec::with_capacity(self.points.len());
        for p in &self.points {
            let doublon = match points.last() {
                Some(dernier) => dernier.distance(*p) <= epsilon,
                None => false,
            };
            if !doublon {
                points.push(*p);
            }
        }
        // La fermeture implicite peut laisser un doublon entre le premier et le
        // dernier sommet.
        while points.len() > 1
            && points
                .first()
                .is_some_and(|premier| premier.distance(*points.last().unwrap()) <= epsilon)
        {
            points.pop();
        }
        // Sommets alignés : on retire le sommet du milieu quand les trois sont
        // colinéaires ET que le milieu est bien entre les deux autres.
        let mut epures: Vec<Point> = Vec::with_capacity(points.len());
        let n = points.len();
        for i in 0..n {
            let precedent = points[(i + n - 1) % n];
            let courant = points[i];
            let suivant = points[(i + 1) % n];
            let base = suivant - precedent;
            let hauteur = (courant - precedent).vectoriel(base).abs() / base.longueur();
            let aligne = base.longueur() > epsilon && hauteur <= epsilon;
            let entre_les_deux = (courant - precedent).scalaire(suivant - courant) >= 0.0;
            if !(aligne && entre_les_deux) {
                epures.push(courant);
            }
        }
        if epures.len() < 3 {
            epures = points;
        }
        Self::nouveau(epures)
    }

    /// Deux arêtes non voisines se **traversent**-elles franchement ?
    ///
    /// C'est plus étroit que [`Polygone::est_simple`] : un simple contact par
    /// une extrémité, ou un recouvrement colinéaire, ne compte pas. Sert à
    /// distinguer un anneau **plat** (tous les sommets alignés : rien à
    /// remplir) d'un anneau qui se **croise** (un papillon : « dedans » n'a plus
    /// de sens unique). Les deux méritent un refus, pas le même.
    #[must_use]
    pub fn a_un_croisement_propre(&self) -> bool {
        let n = self.points.len();
        if n < 3 {
            return false;
        }
        for i in 0..n {
            let a1 = self.points[i];
            let a2 = self.points[(i + 1) % n];
            for j in (i + 1)..n {
                if j == i + 1 || (i == 0 && j == n - 1) {
                    continue;
                }
                let b1 = self.points[j];
                let b2 = self.points[(j + 1) % n];
                let d1 = (a2 - a1).vectoriel(b1 - a1);
                let d2 = (a2 - a1).vectoriel(b2 - a1);
                let d3 = (b2 - b1).vectoriel(a1 - b1);
                let d4 = (b2 - b1).vectoriel(a2 - b1);
                // Inégalités STRICTES des deux côtés : les extrémités ne
                // comptent pas, donc un contact ne passe pas pour un
                // croisement.
                if (d1 > 0.0) != (d2 > 0.0)
                    && (d1 != 0.0 && d2 != 0.0)
                    && (d3 > 0.0) != (d4 > 0.0)
                    && (d3 != 0.0 && d4 != 0.0)
                {
                    return true;
                }
            }
        }
        false
    }

    /// L'anneau est-il **simple** (aucune auto-intersection) ?
    ///
    /// C'est la précondition des opérations booléennes, et elle est vérifiée
    /// plutôt que supposée : sur un anneau qui se croise lui-même, « dedans »
    /// n'a plus de sens, et un résultat aurait pourtant l'air d'un résultat.
    ///
    /// Les arêtes **voisines** qui se touchent par une extrémité ne comptent pas
    /// comme une intersection ; une arête qui rase une autre (recouvrement
    /// colinéaire) compte, elle.
    #[must_use]
    pub fn est_simple(&self) -> bool {
        let n = self.points.len();
        if n < 3 {
            return false;
        }
        for i in 0..n {
            let a1 = self.points[i];
            let a2 = self.points[(i + 1) % n];
            for j in (i + 1)..n {
                let b1 = self.points[j];
                let b2 = self.points[(j + 1) % n];
                // Voisines (y compris la première et la dernière, qui partagent
                // le premier sommet) : elles se touchent par construction.
                let voisines = j == i + 1 || (i == 0 && j == n - 1);
                if voisines {
                    continue;
                }
                if segments_se_coupent(a1, a2, b1, b2) {
                    return false;
                }
            }
        }
        true
    }
}

/// Une forme pleine : des anneaux, et la règle qui décide des trous.
#[derive(Clone, Debug, PartialEq)]
pub struct Contour {
    /// Les anneaux : le premier est l'extérieur, les suivants sont dedans
    /// (trous ou parties pleines, selon la règle et leur sens).
    pub anneaux: Vec<Polygone>,
    /// La règle de remplissage.
    pub regle: Regle,
}

impl Contour {
    /// Une forme à un seul anneau.
    #[must_use]
    pub fn simple(anneau: Polygone) -> Self {
        Self {
            anneaux: vec![anneau],
            regle: Regle::NonZero,
        }
    }

    /// Une forme avec sa règle.
    #[must_use]
    pub fn avec_regle(anneaux: Vec<Polygone>, regle: Regle) -> Self {
        Self { anneaux, regle }
    }

    /// Le point est-il dans la forme remplie ?
    ///
    /// Sous `NonZero`, les enroulements des anneaux **s'additionnent** — c'est
    /// ainsi qu'un anneau intérieur inversé perce un trou. Sous `PairImpair`,
    /// les croisements s'additionnent aussi, et la parité en décide.
    #[must_use]
    pub fn contient(&self, p: Point) -> bool {
        if self.anneaux.is_empty() {
            return false;
        }
        match self.regle {
            Regle::NonZero => self.anneaux.iter().map(|a| a.enroulements(p)).sum::<i32>() != 0,
            Regle::PairImpair => {
                self.anneaux.iter().map(|a| a.croisements(p)).sum::<u32>() % 2 == 1
            }
        }
    }

    /// Aire totale **signée** : la somme des aires des anneaux.
    #[must_use]
    pub fn aire(&self) -> f64 {
        self.anneaux.iter().map(Polygone::aire).sum()
    }

    /// Aire absolue (la surface effectivement remplie, en positif).
    #[must_use]
    pub fn aire_absolue(&self) -> f64 {
        self.aire().abs()
    }

    /// Boîte englobante.
    #[must_use]
    pub fn boite(&self) -> Boite {
        let mut b = Boite::vide();
        for anneau in &self.anneaux {
            b.englober_boite(anneau.boite());
        }
        b
    }

    /// Est-ce que cette forme peut servir d'entrée à une opération booléenne ?
    ///
    /// # Erreurs
    ///
    /// [`ErreurPath::ContourVide`], [`ErreurPath::ContourNonSimple`] ou
    /// [`ErreurPath::ContourDegenere`]. Le paramètre `gauche` est posé par
    /// l'appelant, pour que le message désigne la bonne forme.
    pub fn verifier_entree(&self, gauche: bool, epsilon: f64) -> Result<(), ErreurPath> {
        if self.anneaux.is_empty() {
            return Err(ErreurPath::ContourVide { gauche });
        }
        for anneau in &self.anneaux {
            if !anneau.est_valide() {
                return Err(ErreurPath::ContourVide { gauche });
            }
        }
        for anneau in &self.anneaux {
            let propre = anneau.nettoyer(epsilon);
            if propre.points.len() < 3 {
                return Err(ErreurPath::ContourVide { gauche });
            }
            if propre.aire_absolue() <= epsilon * epsilon {
                // Aire nulle. Deux cas très différents : un anneau qui se
                // traverse (un papillon, dont les deux lobes s'annulent) et un
                // anneau plat, dont tous les sommets sont alignés. Le second
                // n'est rien ; le premier demande qu'on regarde la forme.
                return Err(if propre.a_un_croisement_propre() {
                    ErreurPath::ContourNonSimple { gauche }
                } else {
                    ErreurPath::ContourDegenere { gauche }
                });
            }
            if !propre.est_simple() {
                return Err(ErreurPath::ContourNonSimple { gauche });
            }
        }
        Ok(())
    }

    /// Toutes les arêtes, sous forme de segments orientés `(début, fin)`.
    #[must_use]
    pub fn aretes(&self) -> Vec<(Point, Point)> {
        let mut aretes = Vec::new();
        for anneau in &self.anneaux {
            let n = anneau.points.len();
            for i in 0..n {
                aretes.push((anneau.points[i], anneau.points[(i + 1) % n]));
            }
        }
        aretes
    }
}

/// Le point est-il sur le segment `[a, b]` (bornes comprises) ?
#[must_use]
pub fn sur_segment(p: Point, a: Point, b: Point) -> bool {
    let ab = b - a;
    let longueur2 = ab.scalaire(ab);
    if longueur2 == 0.0 {
        return p.distance(a) == 0.0;
    }
    // Colinéaire ET dans la boîte : c'est le test de proximité sans division.
    let aire = ab.vectoriel(p - a).abs();
    if aire / longueur2.sqrt() > 1e-12 {
        return false;
    }
    let t = (p - a).scalaire(ab) / longueur2;
    (-1e-12..=1.0 + 1e-12).contains(&t)
}

/// Les deux segments se coupent-ils, en comptant les contacts aux extrémités ?
#[must_use]
pub fn segments_se_coupent(a1: Point, a2: Point, b1: Point, b2: Point) -> bool {
    let d1 = (a2 - a1).vectoriel(b1 - a1);
    let d2 = (a2 - a1).vectoriel(b2 - a1);
    let d3 = (b2 - b1).vectoriel(a1 - b1);
    let d4 = (b2 - b1).vectoriel(a2 - b1);
    if ((d1 > 0.0) != (d2 > 0.0)) && ((d3 > 0.0) != (d4 > 0.0)) {
        return true;
    }
    // Cas colinéaires et contacts par les extrémités.
    (d1 == 0.0 && sur_segment(b1, a1, a2))
        || (d2 == 0.0 && sur_segment(b2, a1, a2))
        || (d3 == 0.0 && sur_segment(a1, b1, b2))
        || (d4 == 0.0 && sur_segment(a2, b1, b2))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn carre(x: f64, y: f64, cote: f64) -> Polygone {
        Polygone::rectangle(x, y, cote, cote)
    }

    #[test]
    fn aire_signee_depend_du_sens() {
        let direct = carre(0.0, 0.0, 10.0);
        assert_eq!(direct.aire(), 100.0);
        let mut inverse = direct.clone();
        inverse.inverser();
        assert_eq!(inverse.aire(), -100.0);
        assert_eq!(inverse.aire_absolue(), 100.0);
    }

    #[test]
    fn aire_d_un_anneau_degenere() {
        assert_eq!(Polygone::nouveau(vec![]).aire(), 0.0);
        assert_eq!(Polygone::nouveau(vec![Point::origine()]).aire(), 0.0);
        assert_eq!(
            Polygone::nouveau(vec![Point::origine(), Point::new(1.0, 1.0)]).aire(),
            0.0
        );
    }

    #[test]
    fn interieur_du_carre() {
        let c = carre(0.0, 0.0, 10.0);
        assert!(c.contient(Point::new(5.0, 5.0), Regle::NonZero));
        assert!(c.contient(Point::new(5.0, 5.0), Regle::PairImpair));
        assert!(!c.contient(Point::new(15.0, 5.0), Regle::NonZero));
        assert!(!c.contient(Point::new(5.0, 15.0), Regle::PairImpair));
        assert!(!c.contient(Point::new(-1.0, -1.0), Regle::NonZero));
    }

    #[test]
    fn un_point_du_bord_compte_comme_dedans() {
        let c = carre(0.0, 0.0, 10.0);
        for p in [
            Point::new(0.0, 0.0),
            Point::new(10.0, 10.0),
            Point::new(5.0, 0.0),
            Point::new(0.0, 5.0),
            Point::new(10.0, 5.0),
        ] {
            assert!(c.contient(p, Regle::NonZero), "{p:?} doit être dedans");
            assert!(c.contient(p, Regle::PairImpair), "{p:?} doit être dedans");
        }
        // Et un point juste à l'extérieur d'une arête ne l'est pas.
        assert!(!c.contient(Point::new(5.0, -0.0001), Regle::NonZero));
    }

    #[test]
    fn les_deux_regles_donnent_deux_formes_differentes() {
        // Deux anneaux concentriques de même sens : un disque plein avec
        // NonZero, un anneau percé avec PairImpair.
        let exterieur = carre(0.0, 0.0, 10.0);
        let interieur = carre(3.0, 3.0, 4.0);
        let centre = Point::new(5.0, 5.0);

        let nonzero =
            Contour::avec_regle(vec![exterieur.clone(), interieur.clone()], Regle::NonZero);
        assert!(nonzero.contient(centre), "même sens → pas de trou");

        let pairimpair = Contour::avec_regle(vec![exterieur, interieur], Regle::PairImpair);
        assert!(!pairimpair.contient(centre), "pair-impair → trou");
        // Le point entre les deux anneaux est dedans dans les deux cas.
        assert!(pairimpair.contient(Point::new(1.0, 1.0)));
    }

    #[test]
    fn un_anneau_inverse_perce_un_trou_sous_nonzero() {
        let exterieur = carre(0.0, 0.0, 10.0);
        let mut interieur = carre(3.0, 3.0, 4.0);
        interieur.inverser();
        let contour = Contour::avec_regle(vec![exterieur, interieur], Regle::NonZero);
        assert!(!contour.contient(Point::new(5.0, 5.0)));
        assert!(contour.contient(Point::new(1.0, 1.0)));
        // L'aire signée vaut 100 − 16 = 84 : c'est la surface pleine.
        assert_eq!(contour.aire(), 84.0);
    }

    #[test]
    fn nettoyer_retire_doublons_et_points_alignes() {
        let avec_doublon = Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 0.0), // doublon
            Point::new(10.0, 10.0),
            Point::new(0.0, 10.0),
        ]);
        assert_eq!(avec_doublon.nettoyer(1e-9).points.len(), 4);

        let avec_aligne = Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(5.0, 0.0), // aligné sur l'arête, entre les deux
            Point::new(10.0, 0.0),
            Point::new(10.0, 10.0),
            Point::new(0.0, 10.0),
        ]);
        assert_eq!(avec_aligne.nettoyer(1e-9).points.len(), 4);

        // Le premier sommet répété à la fin : un classique.
        let ferme = Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 10.0),
            Point::new(0.0, 0.0),
        ]);
        let propre = ferme.nettoyer(1e-9);
        assert_eq!(propre.points.len(), 3);
        assert!(propre.est_simple());
        // Le nettoyage ne change pas l'aire.
        assert_eq!(propre.aire(), ferme.aire());
    }

    #[test]
    fn nettoyer_ne_detruit_pas_un_triangle_qui_revient_sur_ses_pas() {
        // Un aller-retour sur une arête : deux sommets confondus après
        // nettoyage, donc un anneau dégénéré. On veut le voir, pas le corriger
        // en silence.
        let va_et_vient = Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(0.0, 0.0),
            Point::new(0.0, 10.0),
        ]);
        let propre = va_et_vient.nettoyer(1e-9);
        assert_eq!(propre.aire(), va_et_vient.aire());
        assert_eq!(propre.aire(), 0.0);
    }

    #[test]
    fn un_carre_est_simple_et_un_huit_ne_l_est_pas() {
        assert!(carre(0.0, 0.0, 10.0).est_simple());
        // Papillon : les deux diagonales se croisent au centre.
        let papillon = Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 10.0),
            Point::new(10.0, 0.0),
            Point::new(0.0, 10.0),
        ]);
        assert!(!papillon.est_simple());
    }

    #[test]
    fn un_polygone_regulier_est_simple() {
        for cotes in [3, 4, 5, 7, 12, 64] {
            let p = Polygone::regulier(Point::origine(), 10.0, cotes);
            assert!(p.est_simple(), "l'anneau à {cotes} côtés doit être simple");
            assert!(p.aire() > 0.0);
        }
        // L'aire d'un carré inscrit dans un cercle de rayon 10 vaut 200.
        let carre_inscrit = Polygone::regulier(Point::origine(), 10.0, 4);
        assert!((carre_inscrit.aire() - 200.0).abs() < 1e-9);
    }

    #[test]
    fn verifier_entree_refuse_ce_qu_il_faut() {
        let vide = Contour::avec_regle(vec![], Regle::NonZero);
        assert!(matches!(
            vide.verifier_entree(true, 1e-9),
            Err(ErreurPath::ContourVide { gauche: true })
        ));

        let degenere = Contour::simple(Polygone::nouveau(vec![
            Point::origine(),
            Point::new(1.0, 0.0),
            Point::new(2.0, 0.0),
        ]));
        assert!(matches!(
            degenere.verifier_entree(false, 1e-9),
            Err(ErreurPath::ContourDegenere { gauche: false })
        ));

        let croise = Contour::simple(Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 10.0),
            Point::new(10.0, 0.0),
            Point::new(0.0, 10.0),
        ]));
        assert!(matches!(
            croise.verifier_entree(true, 1e-9),
            Err(ErreurPath::ContourNonSimple { .. })
        ));

        assert!(Contour::simple(carre(0.0, 0.0, 10.0))
            .verifier_entree(true, 1e-9)
            .is_ok());
    }

    #[test]
    fn contact_par_une_extremite_dans_est_simple() {
        // Un anneau en L : aucun croisement, même si deux arêtes se touchent par
        // un sommet.
        let l = Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 2.0),
            Point::new(2.0, 2.0),
            Point::new(2.0, 10.0),
            Point::new(0.0, 10.0),
        ]);
        assert!(l.est_simple());
        assert_eq!(l.aire(), 36.0);
    }

    #[test]
    fn segments_qui_se_coupent() {
        let a1 = Point::new(0.0, 0.0);
        let a2 = Point::new(10.0, 10.0);
        let b1 = Point::new(0.0, 10.0);
        let b2 = Point::new(10.0, 0.0);
        assert!(segments_se_coupent(a1, a2, b1, b2));
        // Parallèles : non.
        assert!(!segments_se_coupent(
            a1,
            a2,
            Point::new(0.0, 1.0),
            Point::new(10.0, 11.0)
        ));
        // Contact par une extrémité : oui.
        assert!(segments_se_coupent(
            a1,
            a2,
            Point::new(10.0, 10.0),
            Point::new(20.0, 20.0)
        ));
        // Colinéaires qui se recouvrent : oui.
        assert!(segments_se_coupent(
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(5.0, 0.0),
            Point::new(15.0, 0.0)
        ));
        // Colinéaires disjoints : non.
        assert!(!segments_se_coupent(
            Point::new(0.0, 0.0),
            Point::new(4.0, 0.0),
            Point::new(5.0, 0.0),
            Point::new(15.0, 0.0)
        ));
    }

    #[test]
    fn boite_et_perimetre() {
        let c = carre(1.0, 2.0, 10.0);
        let b = c.boite();
        assert_eq!(b.min, Point::new(1.0, 2.0));
        assert_eq!(b.max, Point::new(11.0, 12.0));
        assert_eq!(c.perimetre(), 40.0);
        assert!(Contour::avec_regle(vec![], Regle::NonZero)
            .boite()
            .est_vide());
    }
}
