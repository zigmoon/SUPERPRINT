//! Épaississement d'un trait : d'une ligne à une surface.
//!
//! ## Pourquoi ce module existe
//!
//! Un trait, en PostScript comme en PDF, n'est **pas** une surface : c'est une
//! polyligne et une épaisseur. Un imprimeur, lui, n'imprime que des surfaces.
//! Tant que le trait n'est pas converti, deux choses restent impossibles :
//!
//! 1. **découper un trait** (`clip`) : la région de découpage est une surface, et
//!    on ne peut intersecter que deux surfaces. C'est la raison écrite noir sur
//!    blanc dans `superprint-ps` pour expliquer que `clip` n'était **pas
//!    appliqué** ;
//! 2. **mesurer la surface couverte** par un tracé, ce qu'un contrôle prépresse
//!    demande (taux d'encrage, couverture).
//!
//! ## La définition, et c'est elle qui sert de preuve
//!
//! Le trait d'une polyligne `P` d'épaisseur `w` est la **somme de Minkowski** de
//! `P` et d'un disque de rayon `h = w/2` : l'ensemble des points situés à une
//! distance inférieure ou égale à `h` de `P`. Cette définition n'est pas une
//! convention : c'est la seule, et c'est elle que `scripts/validate-path.mjs`
//! recalcule par force brute, point par point, pour confronter le résultat.
//!
//! ## Ce que chaque style change — et lequel reproduit la définition
//!
//! C'est ici que la mesure a corrigé une intuition fausse, et il faut le dire :
//! **le style exactement égal à la définition est le rond**, pas l'onglet.
//!
//! | Style | Rapport à `{distance ≤ h}` | Pourquoi |
//! |---|---|---|
//! | `Jonction::Rond` + `Extremite::Rond` | **égal** | les rectangles des segments, plus un disque à chaque sommet : c'est la somme de Minkowski, terme pour terme |
//! | `Jonction::Miter` | **plus grand** | l'onglet prolonge les bords **au-delà** du sommet : sa pointe est à `h/sin(θ/2)` du sommet, donc hors du trait quand `θ < 180°`. C'est bien pour cela qu'il existe une **limite** d'onglet |
//! | `Jonction::Biseau` | plus petit | le coin est coupé |
//! | `Extremite::Bout` | plus petit | les demi-disques des extrémités sont retirés |
//! | `Extremite::Carre` | plus grand | le demi-carré dépasse d'une demi-épaisseur, et son coin est à `h·√2` |
//!
//! Les jonctions et les extrémités n'agissent que **par l'extérieur** du virage.
//! Le côté **intérieur** est toujours l'intersection exacte des deux bords : ce
//! n'est pas un style, c'est la géométrie. Le confondre avec un biseau retirerait
//! des points qui appartiennent au trait, et la mesure le voit — c'était un
//! défaut réel pendant l'écriture de ce module (voir `bordure`).
//!
//! Au-delà de `Plume::limite_miter`, l'onglet est **remplacé** par un biseau :
//! une pointe très aiguë s'éloignerait sans borne du sommet. Le rapport comparé
//! est `|sommet → pointe| / h`, soit `1 / sin(θ/2)` — `√2` pour un angle droit,
//! ce qui rend les valeurs du PostScript (`10`) et du SVG (`4`) comparables.
//!
//! ## Ce que le module refuse
//!
//! Convertir un trait en surface **n'est pas toujours possible sans se tromper**.
//! Quand un bord replié se recoupe — une épaisseur grande devant la longueur
//! d'un segment, une épingle à cheveux — l'anneau obtenu s'auto-intersecte et
//! « dedans » n'y a plus de sens unique. Le module le **détecte**
//! ([`Polygone::est_simple`]) et **refuse**
//! ([`crate::ErreurPath::TraitInsoluble`]) au lieu de rendre une surface dont la
//! forme dépendrait de la règle de remplissage par hasard.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « géométrie vectorielle »).

use crate::point::{Boite, Point};
use crate::polygone::{Contour, Polygone, Regle};
use crate::ErreurPath;

/// Forme de l'extrémité d'un trait ouvert.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Extremite {
    /// Coupé net au bout : rien n'est ajouté. Le défaut du PostScript.
    #[default]
    Bout,
    /// Prolongé d'une demi-épaisseur, à angle droit.
    Carre,
    /// Arrondi par un demi-disque de rayon `h`.
    Rond,
}

/// Forme de l'extérieur d'un virage.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Jonction {
    /// Les bords sont prolongés jusqu'à leur intersection. Le défaut.
    #[default]
    Miter,
    /// Les deux bords sont reliés par un segment : le coin est coupé.
    Biseau,
    /// Les deux bords sont reliés par un arc de rayon `h`.
    Rond,
}

/// Les paramètres d'un épaississement.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Plume {
    /// L'épaisseur du trait, en unités des coordonnées.
    pub epaisseur: f64,
    /// La forme de l'extérieur des virages.
    pub jonction: Jonction,
    /// La forme des extrémités d'un trait ouvert.
    pub extremite: Extremite,
    /// Le rapport de longueur d'onglet au-delà duquel on biseaute.
    ///
    /// Comparé à `|sommet → pointe| / h`. `10,0` est la valeur par défaut du
    /// PostScript, `4,0` celle du SVG.
    pub limite_miter: f64,
    /// L'écart maximal entre un arc et sa polyligne, en unités.
    pub tolerance: f64,
}

impl Plume {
    /// Une plume d'épaisseur donnée, aux styles par défaut du PostScript.
    #[must_use]
    pub fn nouvelle(epaisseur: f64) -> Self {
        Self {
            epaisseur,
            jonction: Jonction::Miter,
            extremite: Extremite::Bout,
            limite_miter: 10.0,
            tolerance: 0.05,
        }
    }

    /// La demi-épaisseur : le rayon du disque dont le trait est la somme.
    #[must_use]
    pub fn demi_epaisseur(&self) -> f64 {
        self.epaisseur / 2.0
    }

    /// Épaissit une suite de sous-chemins.
    ///
    /// # Erreurs
    ///
    /// Voir [`epaissir`].
    pub fn epaissir(
        &self,
        sous_chemins: &[Vec<Point>],
        fermes: &[bool],
    ) -> Result<Contour, ErreurPath> {
        epaissir(sous_chemins, fermes, self)
    }
}

/// Un sous-chemin dont le dernier point est le premier est-il fermé ?
///
/// C'est la convention des deux importeurs du noyau (`closepath` en PostScript,
/// `Z` en SVG) : la fermeture est écrite en **répétant** le point de départ.
/// Elle est rendue ici pour que l'appelant n'ait pas à la réinventer — et la
/// limite est dite : un sous-chemin qui revient à son point de départ **sans**
/// être fermé serait pris pour fermé, ce qui ne change la surface que d'une
/// extrémité.
#[must_use]
pub fn fermeture_deduite(sous_chemin: &[Point]) -> bool {
    sous_chemin.len() > 2 && sous_chemin.first() == sous_chemin.last()
}

/// Épaissit des sous-chemins en une surface.
///
/// # Erreurs
///
/// - [`ErreurPath::TraitInsoluble`] si l'épaisseur n'est pas un nombre fini
///   positif, si un sous-chemin n'a pas deux points distincts, ou si un bord
///   replié se recoupe — auquel cas la surface n'aurait pas de sens unique ;
/// - [`ErreurPath::ContourVide`] si aucun sous-chemin exploitable n'est fourni.
pub fn epaissir(
    sous_chemins: &[Vec<Point>],
    fermes: &[bool],
    plume: &Plume,
) -> Result<Contour, ErreurPath> {
    let h = plume.demi_epaisseur();
    if !(h.is_finite() && h > 0.0) {
        return Err(ErreurPath::TraitInsoluble {
            sous_chemin: 0,
            raison: format!(
                "épaisseur {} : un trait n'a de surface que d'épaisseur finie et positive",
                plume.epaisseur
            ),
        });
    }
    let tolerance = if plume.tolerance > 0.0 {
        plume.tolerance
    } else {
        f64::MIN_POSITIVE
    };

    let mut anneaux: Vec<Polygone> = Vec::new();
    for (rang, sous_chemin) in sous_chemins.iter().enumerate() {
        let ferme = fermes.get(rang).copied().unwrap_or(false);
        let points = preparer(sous_chemin, ferme, rang)?;
        let troncons = troncons(&points, ferme);
        if troncons.is_empty() {
            continue;
        }
        for anneau in anneaux_du_trait(&troncons, ferme, plume, h, tolerance, rang)? {
            anneaux.push(anneau);
        }
    }
    if anneaux.is_empty() {
        return Err(ErreurPath::ContourVide { gauche: true });
    }
    Ok(Contour::avec_regle(anneaux, Regle::NonZero))
}

/// Nettoie un sous-chemin : retire les points confondus, et la répétition
/// finale quand le sous-chemin est fermé.
fn preparer(sous_chemin: &[Point], ferme: bool, rang: usize) -> Result<Vec<Point>, ErreurPath> {
    if !sous_chemin.iter().all(Point::est_fini) {
        return Err(ErreurPath::TraitInsoluble {
            sous_chemin: rang,
            raison: "un sommet n'est pas un nombre fini".to_string(),
        });
    }
    let mut points: Vec<Point> = Vec::with_capacity(sous_chemin.len());
    for point in sous_chemin {
        match points.last() {
            Some(dernier) if dernier.distance(*point) == 0.0 => {}
            _ => points.push(*point),
        }
    }
    if ferme && points.len() > 1 && points.first() == points.last() {
        points.pop();
    }
    if points.len() < 2 {
        return Err(ErreurPath::TraitInsoluble {
            sous_chemin: rang,
            raison: format!(
                "{} point(s) distinct(s) : un trait se parcourt, il ne se résume pas à un point",
                points.len()
            ),
        });
    }
    Ok(points)
}

/// Un segment orienté, avec sa direction et sa normale gauche unitaires.
struct Troncon {
    depart: Point,
    arrivee: Point,
    direction: Point,
    normale: Point,
}

fn troncons(points: &[Point], ferme: bool) -> Vec<Troncon> {
    let n = points.len();
    let nombre = if ferme { n } else { n - 1 };
    let mut sortie = Vec::with_capacity(nombre);
    for i in 0..nombre {
        let depart = points[i];
        let arrivee = points[(i + 1) % n];
        let vecteur = arrivee - depart;
        let longueur = vecteur.longueur();
        if longueur == 0.0 {
            continue;
        }
        let direction = vecteur / longueur;
        sortie.push(Troncon {
            depart,
            arrivee,
            direction,
            normale: direction.normale_gauche(),
        });
    }
    sortie
}

/// Les anneaux du trait d'un sous-chemin.
///
/// Un trait **ouvert** donne un anneau : bord gauche, extrémité, bord droit
/// parcouru à l'envers, extrémité de départ. Un trait **fermé** donne deux
/// anneaux : le bord gauche, et le bord droit **inversé** — c'est ce qui en fait
/// un anneau et non un disque plein, sous la règle non nulle.
#[allow(clippy::too_many_arguments)]
fn anneaux_du_trait(
    troncons: &[Troncon],
    ferme: bool,
    plume: &Plume,
    h: f64,
    tolerance: f64,
    rang: usize,
) -> Result<Vec<Polygone>, ErreurPath> {
    let gauche = bordure(troncons, 1.0, ferme, plume, h, tolerance);
    let droite = bordure(troncons, -1.0, ferme, plume, h, tolerance);

    let mut sortie = Vec::new();
    if ferme {
        sortie.push(verifier_anneau(gauche, rang, h)?);
        let mut interieur = Polygone::nouveau(droite);
        // L'inverse est ce qui perce le milieu : sous la règle non nulle, les
        // deux bords s'annulent à l'intérieur et ne laissent que la surface du
        // trait.
        interieur.inverser();
        sortie.push(verifier_anneau(interieur.points, rang, h)?);
    } else {
        let premier = &troncons[0];
        let dernier = &troncons[troncons.len() - 1];
        let mut anneau = gauche;
        anneau.extend(extremite(
            dernier.arrivee,
            dernier.direction,
            1.0,
            h,
            plume,
            tolerance,
            false,
        ));
        anneau.extend(droite.into_iter().rev());
        anneau.extend(extremite(
            premier.depart,
            premier.direction,
            -1.0,
            h,
            plume,
            tolerance,
            true,
        ));
        sortie.push(verifier_anneau(anneau, rang, h)?);
    }
    Ok(sortie)
}

fn verifier_anneau(points: Vec<Point>, rang: usize, h: f64) -> Result<Polygone, ErreurPath> {
    // Un anneau est **implicitement refermé** : répéter le premier point à la
    // fin crée un segment nul, et l'arc d'une extrémité répète son point
    // d'arrivée, qui est aussi le début du bord suivant. Les deux se corrigent
    // ici, avant toute vérification — sinon `est_simple` verrait des
    // croisements qui n'existent pas.
    let mut points = points;
    if points.len() > 1 && points.first() == points.last() {
        points.pop();
    }
    let anneau = Polygone::nouveau(points).nettoyer(h * 1e-9);
    if anneau.points.len() < 3 || anneau.aire_absolue() <= f64::EPSILON {
        return Err(ErreurPath::TraitInsoluble {
            sous_chemin: rang,
            raison: "la surface obtenue est plate".to_string(),
        });
    }
    if !anneau.est_simple() {
        return Err(ErreurPath::TraitInsoluble {
            sous_chemin: rang,
            raison: format!(
                "le bord replié se recoupe : une épaisseur de {} est trop grande pour ce tracé, \
                 et la surface n'aurait pas de sens unique",
                h * 2.0
            ),
        });
    }
    Ok(anneau)
}

/// Le bord d'un côté : les décalages et les jonctions, dans l'ordre du parcours.
///
/// `cote` vaut `+1` pour la gauche (la normale directe) et `-1` pour la droite.
/// Un bord **ouvert** porte ses deux extrémités ; un bord **fermé** n'a que des
/// jonctions, et se referme sur lui-même.
fn bordure(
    troncons: &[Troncon],
    cote: f64,
    ferme: bool,
    plume: &Plume,
    h: f64,
    tolerance: f64,
) -> Vec<Point> {
    let n = troncons.len();
    let mut sortie = Vec::new();
    if !ferme {
        sortie.push(troncons[0].depart + troncons[0].normale * (cote * h));
    }
    let premier = if ferme { 0 } else { 1 };
    // Un bord **ouvert** porte aussi son **dernier** virage : les sommets
    // intérieurs vont de `1` à `n − 1`, donc la borne exclue est `n`. L'écrire
    // `n − 1` oubliait le coin final, et le trait perdait une moitié entière —
    // la mesure l'a vu.
    let dernier = n;
    for i in premier..dernier {
        let entrant = &troncons[(i + n - 1) % n];
        let sortant = &troncons[i % n];
        sortie.extend(jonction(entrant, sortant, cote, plume, h, tolerance));
    }
    if !ferme {
        sortie.push(troncons[n - 1].arrivee + troncons[n - 1].normale * (cote * h));
    }
    sortie
}

/// Les points d'un virage, du côté demandé.
fn jonction(
    entrant: &Troncon,
    sortant: &Troncon,
    cote: f64,
    plume: &Plume,
    h: f64,
    tolerance: f64,
) -> Vec<Point> {
    let sommet = sortant.depart;
    let normal_entrant = entrant.normale * cote;
    let normal_sortant = sortant.normale * cote;
    let rotation = entrant.direction.vectoriel(sortant.direction);
    let alignement = entrant.direction.scalaire(sortant.direction);

    // Tout droit : les deux décalages sont le même point.
    if rotation == 0.0 && alignement > 0.0 {
        return vec![sommet + normal_entrant * h];
    }

    // L'extérieur est du côté **opposé** au sens du virage : le bord gauche est
    // extérieur quand on tourne à droite.
    //
    // Le **demi-tour exact** (`alignement < 0` *et* `rotation == 0`) est le seul
    // cas où les deux côtés sont extérieurs : le trait s'arrête et repart en
    // sens inverse, et les deux bords se terminent là. Traiter comme tel un
    // virage simplement aigu serait une faute : l'intérieur existe dès que le
    // virage n'est pas un demi-tour, et l'oublier faisait partir une pointe en
    // onglet **dans** la surface — l'anneau se croisait alors, et la mesure l'a
    // désigné.
    let exterieur = rotation * cote < 0.0 || (rotation == 0.0 && alignement < 0.0);
    if !exterieur {
        // L'intérieur est l'intersection exacte des deux bords. Ce n'est pas un
        // style : s'en écarter retirerait des points qui sont dans le trait.
        let somme = normal_entrant + normal_sortant;
        let denominateur = 1.0 + normal_entrant.scalaire(normal_sortant);
        if denominateur.abs() < 1e-12 {
            return vec![sommet + normal_entrant * h, sommet + normal_sortant * h];
        }
        return vec![sommet + somme * (h / denominateur)];
    }

    let depuis = sommet + normal_entrant * h;
    let vers = sommet + normal_sortant * h;
    match plume.jonction {
        Jonction::Biseau => vec![depuis, vers],
        Jonction::Rond => {
            let a = angle(normal_entrant);
            let balayage = ramener_angle(angle(normal_sortant) - a);
            let mut points = arc(sommet, h, a, balayage, tolerance);
            points.insert(0, depuis);
            points
        }
        Jonction::Miter => {
            let somme = normal_entrant + normal_sortant;
            let denominateur = 1.0 + normal_entrant.scalaire(normal_sortant);
            if denominateur.abs() < 1e-12 {
                return vec![depuis, vers];
            }
            let pointe = sommet + somme * (h / denominateur);
            let rapport = (pointe - sommet).longueur() / h;
            if plume.limite_miter.is_finite() && rapport > plume.limite_miter {
                // Un onglet trop long s'éloignerait sans borne : biseau.
                vec![depuis, vers]
            } else {
                vec![depuis, pointe, vers]
            }
        }
    }
}

/// Les points d'une extrémité.
///
/// `cote` vaut `+1` quand on parcourt le bord dans le sens du trait, `-1` quand
/// on le parcourt à l'envers (l'extrémité de départ de l'anneau). `depart` dit
/// s'il s'agit du point de départ du sous-chemin.
#[allow(clippy::too_many_arguments)]
fn extremite(
    point: Point,
    direction: Point,
    cote: f64,
    h: f64,
    plume: &Plume,
    tolerance: f64,
    depart: bool,
) -> Vec<Point> {
    let sens = if depart { direction * -1.0 } else { direction };
    match plume.extremite {
        Extremite::Bout => Vec::new(),
        Extremite::Carre => {
            let normale = direction.normale_gauche() * cote;
            vec![
                point + normale * h + sens * h,
                point - normale * h + sens * h,
            ]
        }
        Extremite::Rond => {
            let normale = direction.normale_gauche() * cote;
            let depuis = angle(normale);
            // Le demi-disque passe par l'axe du trait : `-π` depuis la normale,
            // **toujours**. Depuis la gauche du bout, un balayage négatif passe
            // par la direction du trait (extrémité d'arrivée) ; depuis la droite
            // du départ, il passe par la direction opposée (extrémité de
            // départ). Balayer dans l'autre sens posait le demi-disque du
            // mauvais côté et faisait se croiser l'anneau — la mesure l'a vu.
            arc(point, h, depuis, -std::f64::consts::PI, tolerance)
        }
    }
}

/// Les points d'un arc, **sans** son premier, qui est déjà posé.
fn arc(centre: Point, rayon: f64, depuis: f64, balayage: f64, tolerance: f64) -> Vec<Point> {
    let pas = if rayon <= tolerance {
        // Un rayon plus petit que la tolérance : deux points suffisent.
        std::f64::consts::PI
    } else {
        let limite = 2.0 * (1.0 - tolerance / rayon).clamp(-1.0, 1.0).acos();
        if limite <= 0.0 {
            std::f64::consts::PI
        } else {
            limite
        }
    };
    let nombre = ((balayage.abs() / pas).ceil() as usize).clamp(1, 4096);
    let increment = balayage / nombre as f64;
    (1..=nombre)
        .map(|i| {
            let a = depuis + increment * i as f64;
            centre + Point::new(a.cos(), a.sin()) * rayon
        })
        .collect()
}

fn angle(v: Point) -> f64 {
    v.y.atan2(v.x)
}

/// Ramène un écart d'angles dans `]-π, π]`.
fn ramener_angle(a: f64) -> f64 {
    let tau = std::f64::consts::TAU;
    let mut a = a % tau;
    if a > std::f64::consts::PI {
        a -= tau;
    } else if a <= -std::f64::consts::PI {
        a += tau;
    }
    a
}

/// La boîte d'un trait épaissi : celle du trait, élargie d'une demi-épaisseur.
#[must_use]
pub fn boite_du_trait(sous_chemins: &[Vec<Point>], plume: &Plume) -> Option<Boite> {
    let mut boite = Boite::vide();
    let mut vu = false;
    for sous_chemin in sous_chemins {
        for point in sous_chemin {
            boite.englober(*point);
            vu = true;
        }
    }
    if !vu {
        return None;
    }
    Some(boite.elargie(plume.demi_epaisseur()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proche(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    fn segment(longueur: f64) -> Vec<Vec<Point>> {
        vec![vec![Point::new(0.0, 0.0), Point::new(longueur, 0.0)]]
    }

    /// Le carré de côté `cote`, parcouru dans le sens direct.
    fn carre(cote: f64) -> Vec<Vec<Point>> {
        vec![vec![
            Point::new(0.0, 0.0),
            Point::new(cote, 0.0),
            Point::new(cote, cote),
            Point::new(0.0, cote),
        ]]
    }

    // ── La surface, mesurée ────────────────────────────────────────────────

    #[test]
    fn un_segment_a_l_aire_de_son_rectangle() {
        let plume = Plume::nouvelle(2.0);
        let surface = epaissir(&segment(10.0), &[false], &plume).unwrap();
        // 10 de long, 2 de large : 20. Exactement.
        assert!(
            proche(surface.aire_absolue(), 20.0),
            "aire {}",
            surface.aire()
        );
    }

    #[test]
    fn une_extremite_carree_prolonge_d_une_demi_epaisseur() {
        let mut plume = Plume::nouvelle(2.0);
        plume.extremite = Extremite::Carre;
        let surface = epaissir(&segment(10.0), &[false], &plume).unwrap();
        // Deux carrés d'une demi-épaisseur : 10×2 + 2×(1×2) = 24.
        assert!(
            proche(surface.aire_absolue(), 24.0),
            "aire {}",
            surface.aire()
        );
    }

    #[test]
    fn une_extremite_ronde_ajoute_un_disque() {
        let mut plume = Plume::nouvelle(2.0);
        plume.extremite = Extremite::Rond;
        plume.tolerance = 0.0005;
        let surface = epaissir(&segment(10.0), &[false], &plume).unwrap();
        let attendue = 20.0 + std::f64::consts::PI;
        assert!(
            (surface.aire_absolue() - attendue).abs() / attendue < 0.001,
            "aire {}, attendue {attendue}",
            surface.aire()
        );
    }

    #[test]
    fn un_carre_ferme_a_l_aire_de_son_anneau() {
        // Côté 10, épaisseur 2 : (10+2)² − (10−2)² = 144 − 64 = 80.
        let plume = Plume::nouvelle(2.0);
        let surface = epaissir(&carre(10.0), &[true], &plume).unwrap();
        assert!(
            proche(surface.aire_absolue(), 80.0),
            "aire {}",
            surface.aire()
        );
    }

    #[test]
    fn un_carre_ferme_a_jonctions_rondes_est_plus_petit_que_l_onglet() {
        // Chaque coin rond perd h² − πh²/4 : 4×1 − π = 0,8584.
        let mut plume = Plume::nouvelle(2.0);
        plume.jonction = Jonction::Rond;
        plume.tolerance = 0.0002;
        let surface = epaissir(&carre(10.0), &[true], &plume).unwrap();
        let attendue = 80.0 - 4.0 + std::f64::consts::PI;
        assert!(
            (surface.aire_absolue() - attendue).abs() / attendue < 0.001,
            "aire {}, attendue {attendue}",
            surface.aire()
        );
    }

    #[test]
    fn un_carre_ferme_a_jonctions_biseautees_est_plus_petit_que_le_round() {
        let mut rond = Plume::nouvelle(2.0);
        rond.jonction = Jonction::Rond;
        rond.tolerance = 0.0002;
        let mut biseau = Plume::nouvelle(2.0);
        biseau.jonction = Jonction::Biseau;
        let a = epaissir(&carre(10.0), &[true], &rond)
            .unwrap()
            .aire_absolue();
        let b = epaissir(&carre(10.0), &[true], &biseau)
            .unwrap()
            .aire_absolue();
        let onglet = epaissir(&carre(10.0), &[true], &Plume::nouvelle(2.0))
            .unwrap()
            .aire_absolue();
        // Le biseau coupe le plus, l'onglet garde tout, le rond est entre les deux.
        assert!(b < a, "biseau {b} devrait être sous rond {a}");
        assert!(a < onglet, "rond {a} devrait être sous onglet {onglet}");
    }

    #[test]
    fn la_limite_d_onglet_remplace_l_onglet_par_un_biseau() {
        // Un Λ étroit : les deux bras sont presque parallèles, l'angle intérieur
        // vaut ≈ 5,7°, donc l'onglet s'éloigne de `1 / sin(θ/2)` ≈ 20 fois la
        // demi-épaisseur. Les bras font 40 de long, ce qui laisse la place à
        // l'intersection intérieure — sans quoi le tracé serait refusé (voir
        // `un_onglet_qui_sort_des_segments_est_refuse`).
        let chemin = vec![vec![
            Point::new(-2.0, 0.0),
            Point::new(0.0, 40.0),
            Point::new(2.0, 0.0),
        ]];
        let mut sans_limite = Plume::nouvelle(2.0);
        sans_limite.limite_miter = f64::INFINITY;
        let mut limite = Plume::nouvelle(2.0);
        limite.limite_miter = 2.0;
        let a = epaissir(&chemin, &[false], &sans_limite).unwrap();
        let b = epaissir(&chemin, &[false], &limite).unwrap();
        assert!(
            b.aire_absolue() < a.aire_absolue(),
            "biseauté {} devrait être sous onglet {}",
            b.aire_absolue(),
            a.aire_absolue()
        );
        // La pointe de l'onglet dépasse le sommet d'environ 20 ; le biseau, non.
        assert!(
            a.boite().max.y > 45.0,
            "la pointe devrait dépasser le sommet : {}",
            a.boite().max.y
        );
        assert!(
            b.boite().max.y < 45.0,
            "le biseau ne doit pas dépasser : {}",
            b.boite().max.y
        );
    }

    #[test]
    fn un_onglet_qui_sort_des_segments_est_refuse() {
        // Une pointe dont les segments sont **courts** devant l'onglet :
        // l'intersection des bords **intérieurs** tombe au-delà des bras,
        // l'anneau se recoupe, et la surface n'aurait pas de sens unique.
        // Refuser est le seul choix honnête — et c'est mesuré, pas supposé.
        let chemin = vec![vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(2.0, 0.5),
        ]];
        let mut plume = Plume::nouvelle(2.0);
        plume.limite_miter = f64::INFINITY;
        let erreur = epaissir(&chemin, &[false], &plume).unwrap_err();
        assert!(
            matches!(erreur, ErreurPath::TraitInsoluble { .. }),
            "{erreur:?}"
        );
        assert!(erreur.to_string().contains("recoupe"), "{erreur}");

        // Et la limite d'onglet **ne sauve pas** ce cas : elle n'agit que sur
        // l'extérieur du virage, alors que le défaut est à l'intérieur — où
        // l'intersection exacte n'est pas un style, c'est la géométrie. Le dire
        // ici évite de croire qu'un réglage suffit.
        let mut limite = Plume::nouvelle(2.0);
        limite.limite_miter = 2.0;
        assert!(
            epaissir(&chemin, &[false], &limite).is_err(),
            "le biseau ne change que l'extérieur : l'intérieur reste insoluble"
        );
        // Élargir la place, elle, suffit : les mêmes angles avec des bras longs.
        let long = vec![vec![
            Point::new(0.0, 0.0),
            Point::new(100.0, 0.0),
            Point::new(20.0, 5.0),
        ]];
        assert!(epaissir(&long, &[false], &limite).is_ok());
    }

    // ── La définition : distance au tracé ─────────────────────────────────

    /// Distance d'un point à la polyligne.
    fn distance_au_trait(p: Point, sous_chemins: &[Vec<Point>], fermes: &[bool]) -> f64 {
        let mut pire = f64::INFINITY;
        for (rang, sous_chemin) in sous_chemins.iter().enumerate() {
            let n = sous_chemin.len();
            let ferme = fermes.get(rang).copied().unwrap_or(false);
            let nombre = if ferme { n } else { n - 1 };
            for i in 0..nombre {
                let a = sous_chemin[i];
                let b = sous_chemin[(i + 1) % n];
                pire = pire.min(distance_au_segment(p, a, b));
            }
        }
        pire
    }

    fn distance_au_segment(p: Point, a: Point, b: Point) -> f64 {
        let ab = b - a;
        let norme = ab.scalaire(ab);
        if norme == 0.0 {
            return p.distance(a);
        }
        let t = ((p - a).scalaire(ab) / norme).clamp(0.0, 1.0);
        p.distance(a + ab * t)
    }

    #[test]
    fn le_rond_est_exactement_la_distance_au_trait() {
        // Le rond est le style qui **reproduit la définition**, dans les deux
        // sens : les rectangles des segments plus un disque à chaque sommet,
        // c'est la somme de Minkowski. Aucun autre style ne donne cette égalité
        // — l'onglet et l'extrémité carrée ajoutent, le biseau et le bout
        // retirent.
        let chemin = vec![vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 10.0),
        ]];
        let mut plume = Plume::nouvelle(2.0);
        plume.jonction = Jonction::Rond;
        plume.extremite = Extremite::Rond;
        plume.tolerance = 0.002;
        let surface = epaissir(&chemin, &[false], &plume).unwrap();
        let h = plume.demi_epaisseur();
        let mut desaccords = 0;
        let mut points = 0;
        let pas = 0.02;
        for i in 0..=800 {
            for j in 0..=800 {
                let p = Point::new(-3.0 + i as f64 * pas, -3.0 + j as f64 * pas);
                let distance = distance_au_trait(p, &chemin, &[false]);
                // On ne teste pas à la distance exacte : la frontière est un cas
                // de mesure, pas de géométrie. La bande écartée couvre aussi le
                // pas de l'arc, qui est une polyligne.
                if (distance - h).abs() < 0.02 {
                    continue;
                }
                points += 1;
                if surface.contient(p) != (distance < h) {
                    desaccords += 1;
                }
            }
        }
        assert!(points > 100_000, "trop peu de points : {points}");
        assert_eq!(desaccords, 0, "{desaccords} désaccords sur {points} points");
    }

    #[test]
    fn l_onglet_ne_perd_aucun_point_du_trait() {
        // L'onglet **ajoute** le coin hors du trait, mais il ne doit jamais en
        // retirer un seul point : tout point à moins d'une demi-épaisseur est
        // dedans. C'est la moitié de la propriété qui compte pour un imprimeur
        // (un trait trop maigre se voit).
        //
        // La comparaison se fait **extrémités rondes** : sans elles, le bout
        // plat retire les demi-disques du bout par définition, et le contrôle
        // mesurerait ce choix-là au lieu de l'onglet. La mesure a d'ailleurs
        // désigné exactement ces points-là, à `x ≈ −0,96`, avant correction.
        let chemin = vec![vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 10.0),
        ]];
        let mut plume = Plume::nouvelle(2.0);
        plume.limite_miter = f64::INFINITY;
        plume.extremite = Extremite::Rond;
        plume.tolerance = 0.002;
        let surface = epaissir(&chemin, &[false], &plume).unwrap();
        let h = plume.demi_epaisseur();
        let mut manquants = 0;
        let mut exemples: Vec<String> = Vec::new();
        let pas = 0.02;
        for i in 0..=800 {
            for j in 0..=800 {
                let p = Point::new(-3.0 + i as f64 * pas, -3.0 + j as f64 * pas);
                if distance_au_trait(p, &chemin, &[false]) < h - 0.02 && !surface.contient(p) {
                    manquants += 1;
                    if exemples.len() < 6 {
                        exemples.push(format!("({:.2}, {:.2})", p.x, p.y));
                    }
                }
            }
        }
        assert_eq!(
            manquants,
            0,
            "{manquants} points du trait manquants : {}",
            exemples.join(" ")
        );
    }

    #[test]
    fn l_onglet_n_ajoute_que_le_coin_du_virage() {
        // L'onglet ajoute, mais **seulement** dans le coin : la pointe reste à
        // `h·√2` pour un angle droit, et le point au-delà n'est pas dans le
        // trait pour autant.
        let chemin = vec![vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 10.0),
        ]];
        let mut plume = Plume::nouvelle(2.0);
        plume.limite_miter = f64::INFINITY;
        let h = plume.demi_epaisseur();
        let surface = epaissir(&chemin, &[false], &plume).unwrap();
        // Le coin extérieur du virage, à `h` au-delà des deux bords.
        let coin = Point::new(10.0 + h, -h);
        assert!(surface.contient(coin), "l'onglet devrait couvrir {coin:?}");
        assert!(
            distance_au_trait(coin, &chemin, &[false]) > h,
            "et ce point n'est pas dans le trait : c'est l'onglet"
        );
        // Juste au-delà de la pointe, plus personne : ni le trait, ni l'onglet.
        assert!(!surface.contient(Point::new(10.0 + h + 0.05, -h - 0.05)));
    }

    #[test]
    fn le_biseau_et_le_rond_ne_sortent_jamais_du_trait() {
        // Les deux styles qui coupent ne doivent jamais **ajouter** de surface :
        // c'est la moitié de la propriété qui compte, l'autre étant qu'ils en
        // retirent (mesurée par les aires).
        let chemin = carre(10.0);
        let h = 1.0;
        for jonction in [Jonction::Biseau, Jonction::Rond] {
            let mut plume = Plume::nouvelle(2.0);
            plume.jonction = jonction;
            plume.tolerance = 0.002;
            let surface = epaissir(&chemin, &[true], &plume).unwrap();
            let mut dehors = 0;
            for i in 0..=300 {
                for j in 0..=300 {
                    let p = Point::new(-1.0 + i as f64 * 0.04, -1.0 + j as f64 * 0.04);
                    if surface.contient(p) && distance_au_trait(p, &chemin, &[true]) > h + 0.001 {
                        dehors += 1;
                    }
                }
            }
            assert_eq!(dehors, 0, "{dehors} points hors du trait avec {jonction:?}");
        }
    }

    // ── Refus ─────────────────────────────────────────────────────────────

    #[test]
    fn une_epaisseur_nulle_est_refusee() {
        let erreur = epaissir(&segment(10.0), &[false], &Plume::nouvelle(0.0)).unwrap_err();
        assert!(
            matches!(erreur, ErreurPath::TraitInsoluble { .. }),
            "{erreur:?}"
        );
        assert!(erreur.to_string().contains("épaisseur"), "{erreur}");
    }

    #[test]
    fn un_sous_chemin_reduit_a_un_point_est_refuse() {
        let chemin = vec![vec![Point::new(1.0, 1.0)]];
        let erreur = epaissir(&chemin, &[false], &Plume::nouvelle(2.0)).unwrap_err();
        assert!(
            matches!(erreur, ErreurPath::TraitInsoluble { .. }),
            "{erreur:?}"
        );
    }

    #[test]
    fn aucun_sous_chemin_exploitable_est_refuse() {
        let erreur = epaissir(&[], &[], &Plume::nouvelle(2.0)).unwrap_err();
        assert!(
            matches!(erreur, ErreurPath::ContourVide { .. }),
            "{erreur:?}"
        );
    }

    #[test]
    fn une_epaisseur_trop_grande_se_recoupant_est_refusee() {
        // Un aller-retour de 0,2 de long avec 20 d'épaisseur : les bords se
        // recoupent, et la surface n'aurait pas de sens unique.
        let chemin = vec![vec![
            Point::new(0.0, 0.0),
            Point::new(0.2, 0.0),
            Point::new(0.0, 0.1),
        ]];
        let erreur = epaissir(&chemin, &[false], &Plume::nouvelle(20.0)).unwrap_err();
        assert!(
            matches!(erreur, ErreurPath::TraitInsoluble { .. }),
            "{erreur:?}"
        );
        assert!(erreur.to_string().contains("recoupe"), "{erreur}");
    }

    #[test]
    fn un_sommet_non_fini_est_refuse() {
        let chemin = vec![vec![Point::new(0.0, 0.0), Point::new(f64::NAN, 1.0)]];
        let erreur = epaissir(&chemin, &[false], &Plume::nouvelle(2.0)).unwrap_err();
        assert!(
            matches!(erreur, ErreurPath::TraitInsoluble { .. }),
            "{erreur:?}"
        );
    }

    // ── Détails du modèle ─────────────────────────────────────────────────

    #[test]
    fn la_fermeture_deduite_suit_la_convention_des_deux_importeurs() {
        let ferme = vec![
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
            Point::new(0.0, 0.0),
        ];
        assert!(fermeture_deduite(&ferme));
        let ouvert = vec![
            Point::new(0.0, 0.0),
            Point::new(1.0, 0.0),
            Point::new(1.0, 1.0),
        ];
        assert!(!fermeture_deduite(&ouvert));
        // Un point répété au milieu n'est pas une fermeture.
        assert!(!fermeture_deduite(&[
            Point::new(0.0, 0.0),
            Point::new(0.0, 0.0)
        ]));
    }

    #[test]
    fn les_points_confondus_sont_ignores() {
        let avec_doublons = vec![vec![
            Point::new(0.0, 0.0),
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(10.0, 0.0),
        ]];
        let surface = epaissir(&avec_doublons, &[false], &Plume::nouvelle(2.0)).unwrap();
        assert!(
            proche(surface.aire_absolue(), 20.0),
            "aire {}",
            surface.aire()
        );
    }

    #[test]
    fn un_segment_unique_ferme_ne_donne_rien_d_exploitable() {
        // Deux points marqués « fermés » : c'est un aller-retour, pas une forme.
        let chemin = vec![vec![Point::new(0.0, 0.0), Point::new(0.0, 0.0)]];
        assert!(epaissir(&chemin, &[true], &Plume::nouvelle(2.0)).is_err());
    }

    #[test]
    fn plusieurs_sous_chemins_donnent_plusieurs_surfaces() {
        let chemin = vec![
            vec![Point::new(0.0, 0.0), Point::new(10.0, 0.0)],
            vec![Point::new(0.0, 5.0), Point::new(10.0, 5.0)],
        ];
        let surface = epaissir(&chemin, &[false, false], &Plume::nouvelle(2.0)).unwrap();
        assert!(
            proche(surface.aire_absolue(), 40.0),
            "aire {}",
            surface.aire()
        );
        // Et les deux traits sont bien disjoints : le milieu ne contient rien.
        assert!(!surface.contient(Point::new(5.0, 2.5)));
        assert!(surface.contient(Point::new(5.0, 0.5)));
    }

    #[test]
    fn la_boite_du_trait_est_celle_du_trace_elargie() {
        let plume = Plume::nouvelle(2.0);
        let boite = boite_du_trait(&segment(10.0), &plume).unwrap();
        assert!(proche(boite.min.x, -1.0) && proche(boite.max.x, 11.0));
        assert!(proche(boite.min.y, -1.0) && proche(boite.max.y, 1.0));
        assert!(boite_du_trait(&[], &plume).is_none());
    }

    #[test]
    fn un_trait_ferme_se_parcourt_dans_les_deux_sens() {
        // Le sens de parcours ne doit pas changer la surface, seulement le signe.
        let direct = carre(10.0);
        let mut inverse = carre(10.0);
        inverse[0].reverse();
        let a = epaissir(&direct, &[true], &Plume::nouvelle(2.0)).unwrap();
        let b = epaissir(&inverse, &[true], &Plume::nouvelle(2.0)).unwrap();
        assert!(
            proche(a.aire_absolue(), b.aire_absolue()),
            "{} contre {}",
            a.aire(),
            b.aire()
        );
        // Et les deux surfaces contiennent le même point de l'anneau.
        assert!(a.contient(Point::new(5.0, 0.0)));
        assert!(b.contient(Point::new(5.0, 0.0)));
        // Le centre du carré, lui, n'est dans aucune des deux.
        assert!(!a.contient(Point::new(5.0, 5.0)));
        assert!(!b.contient(Point::new(5.0, 5.0)));
    }
}
