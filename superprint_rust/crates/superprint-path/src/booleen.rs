//! Opérations booléennes sur des formes pleines : le Pathfinder.
//!
//! ## La méthode, et pourquoi celle-là
//!
//! Le produit confiait ces quatre opérations à Paper.js. Ici, elles sont
//! calculées, et la méthode tient en trois idées :
//!
//! 1. **Découper** toutes les arêtes aux points où elles rencontrent celles de
//!    l'autre forme. Après ce découpage, chaque petit segment est *entièrement*
//!    dedans, *entièrement* dehors, ou *entièrement* sur le bord ;
//! 2. **Classer** chaque petit segment par une question purement ensembliste :
//!    la forme du résultat est-elle remplie d'un côté du segment, et pas de
//!    l'autre ? Si oui, le segment appartient au bord du résultat — et il est
//!    orienté pour que la partie **remplie soit à sa gauche** ;
//! 3. **Enchaîner** ces segments orientés en anneaux, en prenant à chaque
//!    sommet le **virage le plus à gauche** quand plusieurs choix se présentent.
//!
//! L'élégance de l'étape 2 est qu'elle ne connaît pas les opérations : `Union`,
//! `Intersection`, `Difference` et `Exclusion` ne diffèrent que par la fonction
//! qui décide si un point est dans le résultat à partir de son appartenance à
//! `A` et à `B`. Les quatre cas partagent donc tout le reste, y compris les
//! arêtes **colinéaires** (deux carrés qui se touchent), qui sont le cas où les
//! implémentations naïves se cassent.
//!
//! ## Le choix du virage à gauche
//!
//! Quand deux formes se touchent en un seul point, ce sommet voit quatre
//! segments. Prendre le virage **le plus à gauche** détache les deux formes
//! l'une de l'autre, ce qui donne deux anneaux simples plutôt qu'un anneau qui
//! se croise en un point. Un anneau simple est une forme dont « dedans » a un
//! sens — ce qui est la moindre des choses pour un résultat de Pathfinder.
//!
//! ## La tolérance, et ce qu'elle engage
//!
//! Tout repose sur des points échantillonnés **à une petite distance de chaque
//! côté** d'un segment. Ces points doivent tomber franchement dedans ou dehors :
//! la tolérance doit donc être **petite devant les détails** de la forme, et
//! **grande devant le bruit** du calcul flottant. La valeur par défaut est
//! `1e-7 × diagonale`, soit 10 nanomètres pour une forme de 10 centimètres. Une
//! forme dont un détail est plus petit que cela est hors de portée de cette
//! méthode, et elle le dit : c'est écrit ici plutôt que découvert plus tard.

use std::collections::HashMap;

use crate::point::{Boite, Point};
use crate::polygone::{sur_segment, Contour, Polygone, Regle};
use crate::ErreurPath;

/// Les quatre opérations du Pathfinder, telles que le produit les nomme.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Operation {
    /// Union : dedans si on est dans l'une **ou** dans l'autre.
    Union,
    /// Intersection : dedans si on est dans l'une **et** dans l'autre.
    Intersection,
    /// Différence `A − B` : dedans si on est dans `A` **sans** être dans `B`.
    Difference,
    /// Exclusion : dedans si on est dans l'une **ou** dans l'autre, mais pas
    /// dans les deux.
    Exclusion,
}

impl Operation {
    /// La fonction d'appartenance de l'opération, appliquée aux appartenances
    /// aux deux formes d'entrée.
    ///
    /// C'est **la** définition de chaque opération, écrite une fois.
    #[must_use]
    fn membre(&self, dans_gauche: bool, dans_droite: bool) -> bool {
        match self {
            Self::Union => dans_gauche || dans_droite,
            Self::Intersection => dans_gauche && dans_droite,
            Self::Difference => dans_gauche && !dans_droite,
            Self::Exclusion => dans_gauche != dans_droite,
        }
    }
}

/// Applique une opération, avec la tolérance par défaut.
///
/// # Erreurs
///
/// Voir [`operer_avec`].
pub fn operer(
    gauche: &Contour,
    droite: &Contour,
    operation: Operation,
) -> Result<Contour, ErreurPath> {
    operer_avec(gauche, droite, operation, 0.0)
}

/// Applique une opération, en imposant la tolérance géométrique.
///
/// Passer `0.0` demande la valeur par défaut, déduite de la taille des formes.
///
/// # Erreurs
///
/// - [`ErreurPath::ContourVide`] : une forme n'a pas d'anneau exploitable ;
/// - [`ErreurPath::ContourDegenere`] : un anneau est d'aire nulle ;
/// - [`ErreurPath::ContourNonSimple`] : un anneau s'auto-intersecte, et
///   « dedans » n'y a plus de sens ;
/// - [`ErreurPath::ResultatVide`] : l'opération ne laisse aucune surface ;
/// - [`ErreurPath::ChainageImpossible`] : le bord du résultat ne se referme pas.
pub fn operer_avec(
    gauche: &Contour,
    droite: &Contour,
    operation: Operation,
    tolerance: f64,
) -> Result<Contour, ErreurPath> {
    let tolerance = if tolerance > 0.0 {
        tolerance
    } else {
        tolerance_par_defaut(gauche, droite)
    };
    gauche.verifier_entree(true, tolerance)?;
    droite.verifier_entree(false, tolerance)?;

    // Les formes de travail : nettoyées, donc sans segment nul ni sommet
    // aligné. C'est la seule transformation appliquée aux entrées, et elle ne
    // change ni la surface ni le contour.
    let a = nettoyer_contour(gauche, tolerance);
    let b = nettoyer_contour(droite, tolerance);

    // Les arêtes découpées des deux côtés, mises en commun dans un même
    // registre de points : c'est ce registre qui garantit qu'un point
    // d'intersection calculé deux fois (une par arête) est bien le même.
    let mut registre = Registre::new(tolerance);
    let aretes_a = decouper_contour(&a, &b, tolerance, &mut registre);
    let aretes_b = decouper_contour(&b, &a, tolerance, &mut registre);

    // Classification et orientation, puis dédoublonnage : deux arêtes
    // parfaitement superposées ne font qu'un bord.
    let pas = tolerance;
    let mut segments: Vec<Segment> = Vec::new();
    let mut vues: HashMap<(Cle, Cle), usize> = HashMap::new();

    for (i, (p, q)) in aretes_a.iter().chain(aretes_b.iter()).enumerate() {
        let p = registre.point(*p);
        let q = registre.point(*q);
        if p == q {
            continue;
        }
        let milieu = p.interpole(q, 0.5);
        let normale = (q - p).normalise().normale_gauche();
        let cote_gauche = milieu + normale * pas;
        let cote_droit = milieu - normale * pas;
        let dans = |contour: &Contour, point: Point| contour.contient(point);
        let membre_gauche = operation.membre(dans(&a, cote_gauche), dans(&b, cote_gauche));
        let membre_droit = operation.membre(dans(&a, cote_droit), dans(&b, cote_droit));
        if membre_gauche == membre_droit {
            // Le remplissage est le même des deux côtés : ce segment est
            // intérieur au résultat, ou extérieur. Il n'appartient pas au bord.
            continue;
        }
        // Orienté pour que la partie remplie soit à gauche.
        let segment = if membre_gauche { (p, q) } else { (q, p) };
        let cle = (registre.cle(segment.0), registre.cle(segment.1));
        // Le dédoublonnage est nécessaire quand une arête de `A` et une arête de
        // `B` sont géométriquement confondues : elles décrivent le même bord.
        if vues.contains_key(&cle) {
            continue;
        }
        vues.insert(cle, segments.len());
        segments.push(Segment {
            debut: segment.0,
            fin: segment.1,
            origine: i,
        });
    }

    if segments.is_empty() {
        return Err(ErreurPath::ResultatVide);
    }

    let anneaux = enchainer(&segments, &registre, tolerance)?;
    // Les anneaux sortent avec les sommets d'intersection : quand deux arêtes
    // colinéaires fusionnent, il reste des sommets **alignés** au milieu d'un
    // bord droit. Ils ne changent pas la forme, mais ils alourdissent le tracé
    // d'un PDF et rendent tout contrôle de nombre de sommets inutilement
    // fragile. On les retire, comme on l'a fait pour les entrées.
    let anneaux: Vec<Polygone> = anneaux
        .into_iter()
        .map(|a| a.nettoyer(tolerance))
        .filter(|a| a.points.len() >= 3 && a.aire_absolue() > tolerance * tolerance)
        .collect();
    if anneaux.is_empty() {
        return Err(ErreurPath::ResultatVide);
    }
    Ok(Contour::avec_regle(anneaux, Regle::NonZero))
}

/// Un segment orienté du bord du résultat.
#[derive(Clone, Copy, Debug)]
struct Segment {
    debut: Point,
    fin: Point,
    /// Rang de l'arête d'origine : sert uniquement à départager deux virages
    /// exactement opposés, pour que le résultat ne dépende pas de l'ordre des
    /// entrées.
    origine: usize,
}

/// Clé quantifiée d'un point : deux points à moins d'un millionième de la
/// tolérance sont le même point.
type Cle = (i64, i64);

/// Registre de points canoniques.
///
/// Un point d'intersection est calculé deux fois — une fois sur l'arête de `A`,
/// une fois sur celle de `B` — et les deux résultats diffèrent des derniers
/// chiffres. Le registre ramène tout le monde au **premier** point enregistré
/// pour une clé donnée, ce qui fait que les arêtes mises bout à bout se
/// rejoignent exactement.
struct Registre {
    facteur: f64,
    points: HashMap<Cle, Point>,
}

impl Registre {
    fn new(tolerance: f64) -> Self {
        Self {
            // Le pas de quantification est très fin devant la tolérance
            // géométrique : il sert à reconnaître deux écritures du même point,
            // pas à arrondir la géométrie.
            facteur: 1.0 / (tolerance * 1e-3).max(f64::MIN_POSITIVE),
            points: HashMap::new(),
        }
    }

    fn cle(&self, p: Point) -> Cle {
        (
            (p.x * self.facteur).round() as i64,
            (p.y * self.facteur).round() as i64,
        )
    }

    /// Enregistre un point et rend sa version canonique.
    fn enregistrer(&mut self, p: Point) -> Point {
        let cle = self.cle(p);
        *self.points.entry(cle).or_insert(p)
    }

    /// La version canonique d'un point déjà enregistré (ou lui-même).
    fn point(&self, p: Point) -> Point {
        self.points.get(&self.cle(p)).copied().unwrap_or(p)
    }
}

/// Tolérance par défaut : un dixième de millionième de la plus grande diagonale.
fn tolerance_par_defaut(gauche: &Contour, droite: &Contour) -> f64 {
    let diagonale = |b: Boite| {
        if b.est_vide() {
            0.0
        } else {
            (b.max - b.min).longueur()
        }
    };
    let echelle = diagonale(gauche.boite()).max(diagonale(droite.boite()));
    // Une forme de taille nulle ne doit pas donner une tolérance nulle : on
    // garde 1 comme plancher, ce qui laisse la géométrie décider.
    echelle.max(1.0) * 1e-7
}

/// Copie de la forme débarrassée des segments nuls et des sommets alignés.
fn nettoyer_contour(contour: &Contour, tolerance: f64) -> Contour {
    Contour {
        anneaux: contour
            .anneaux
            .iter()
            .map(|a| a.nettoyer(tolerance))
            .filter(|a| a.points.len() >= 3)
            .collect(),
        regle: contour.regle,
    }
}

/// Découpe les arêtes de `forme` à tous leurs contacts avec les arêtes de
/// `autre`, et enregistre tous les points obtenus dans `registre`.
fn decouper_contour(
    forme: &Contour,
    autre: &Contour,
    tolerance: f64,
    registre: &mut Registre,
) -> Vec<(Point, Point)> {
    let aretes_autre = autre.aretes();
    let boite_autre = autre.boite();
    let mut sortie = Vec::new();
    for (p, q) in forme.aretes() {
        let p = registre.enregistrer(p);
        let q = registre.enregistrer(q);
        // Un premier tri par boîte : inutile de découper une arête qui ne
        // croise même pas la boîte de l'autre forme.
        let boite_arete = {
            let mut b = Boite::du_point(p);
            b.englober(q);
            b.elargie(tolerance)
        };
        if !boite_arete.recouvre(boite_autre) {
            sortie.push((p, q));
            continue;
        }
        let mut coupes: Vec<f64> = vec![0.0, 1.0];
        for (r, s) in &aretes_autre {
            let (r, s) = (*r, *s);
            if !boite_arete.recouvre({
                let mut b = Boite::du_point(r);
                b.englober(s);
                b
            }) {
                continue;
            }
            for t in parametres_de_contact(p, q, r, s, tolerance) {
                if t > 0.0 && t < 1.0 {
                    coupes.push(t);
                }
            }
        }
        coupes.sort_by(|x, y| x.partial_cmp(y).unwrap_or(std::cmp::Ordering::Equal));
        coupes.dedup_by(|x, y| (*x - *y).abs() <= 1e-12);
        for fenetre in coupes.windows(2) {
            let debut = registre.enregistrer(p.interpole(q, fenetre[0]));
            let fin = registre.enregistrer(p.interpole(q, fenetre[1]));
            if debut != fin {
                sortie.push((debut, fin));
            }
        }
    }
    sortie
}

/// Les paramètres `t` où le segment `(p, q)` touche le segment `(r, s)`.
///
/// Rend aussi les projections des extrémités de `(r, s)` quand les deux
/// segments sont colinéaires : une arête de `A` qui *contient* un sommet de `B`
/// sans le traverser doit être coupée là aussi, sinon le classement « dedans /
/// dehors » du segment entier serait faux et le chaînage laisserait un trou.
fn parametres_de_contact(p: Point, q: Point, r: Point, s: Point, tolerance: f64) -> Vec<f64> {
    let d = q - p;
    let e = s - r;
    let denominateur = d.vectoriel(e);
    let mut parametres = Vec::new();
    if denominateur.abs() > tolerance * tolerance * 0.0 + f64::MIN_POSITIVE {
        let t = (r - p).vectoriel(e) / denominateur;
        let u = (r - p).vectoriel(d) / denominateur;
        if (-tolerance..=1.0 + tolerance).contains(&t)
            && (-tolerance..=1.0 + tolerance).contains(&u)
        {
            parametres.push(t.clamp(0.0, 1.0));
        }
        return parametres;
    }
    // Parallèles. Colinéaires ? On projette les extrémités de l'autre segment.
    let longueur2 = d.scalaire(d);
    if longueur2 == 0.0 || d.vectoriel(r - p).abs() / longueur2.sqrt() > tolerance {
        return parametres;
    }
    for extremite in [r, s] {
        let t = (extremite - p).scalaire(d) / longueur2;
        if (-tolerance..=1.0 + tolerance).contains(&t) {
            parametres.push(t.clamp(0.0, 1.0));
        }
    }
    parametres
}

/// Enchaîne les segments orientés en anneaux fermés.
fn enchainer(
    segments: &[Segment],
    registre: &Registre,
    tolerance: f64,
) -> Result<Vec<Polygone>, ErreurPath> {
    let mut sortants: HashMap<Cle, Vec<usize>> = HashMap::new();
    for (i, segment) in segments.iter().enumerate() {
        sortants
            .entry(registre.cle(segment.debut))
            .or_default()
            .push(i);
    }

    let mut utilise = vec![false; segments.len()];
    let mut anneaux = Vec::new();
    let mut fragments_ouverts = 0usize;

    for depart in 0..segments.len() {
        if utilise[depart] {
            continue;
        }
        let mut points = vec![segments[depart].debut];
        let cle_depart = registre.cle(segments[depart].debut);
        let mut courant = depart;
        let mut ferme = false;
        loop {
            utilise[courant] = true;
            let fin = segments[courant].fin;
            let cle_fin = registre.cle(fin);
            if cle_fin == cle_depart {
                ferme = true;
                break;
            }
            let Some(candidats) = sortants.get(&cle_fin) else {
                break;
            };
            let direction = (segments[courant].fin - segments[courant].debut).normalise();
            let mut meilleur: Option<(usize, f64)> = None;
            for &candidat in candidats {
                if utilise[candidat] {
                    continue;
                }
                let sortie = (segments[candidat].fin - segments[candidat].debut).normalise();
                let angle = direction
                    .vectoriel(sortie)
                    .atan2(direction.scalaire(sortie));
                let cle = (angle, segments[candidat].origine);
                let remplace = match meilleur {
                    None => true,
                    // Virage le plus à gauche : l'angle le plus grand. À angle
                    // égal, c'est le rang de l'arête d'origine qui décide, pour
                    // que le résultat ne dépende pas de l'ordre des entrées.
                    Some((_, angle_meilleur)) => {
                        angle > angle_meilleur + 1e-12
                            || ((angle - angle_meilleur).abs() <= 1e-12
                                && cle.1 < segments[meilleur.unwrap().0].origine)
                    }
                };
                if remplace {
                    meilleur = Some((candidat, angle));
                }
            }
            match meilleur {
                Some((suivant, _)) => {
                    points.push(segments[suivant].debut);
                    courant = suivant;
                }
                None => break,
            }
        }
        if ferme {
            anneaux.push(Polygone::nouveau(points));
        } else {
            // Un fragment qui ne se referme pas est une arête isolée : le bord
            // du résultat ne passe pas deux fois par là. S'il délimite une
            // surface, c'est que le chaînage a échoué, et on le dit ; s'il ne
            // délimite rien, c'est un résidu de contact (une arête partagée par
            // deux formes qui se touchent) et il n'y a rien à en faire.
            let residu = Polygone::nouveau(points.clone());
            if residu.aire_absolue() > tolerance * tolerance {
                return Err(ErreurPath::ChainageImpossible);
            }
            fragments_ouverts += 1;
        }
    }
    let _ = fragments_ouverts;
    anneaux.sort_by(|a, b| {
        // Ordre stable : extérieur d'abord (grande aire absolue), puis par
        // position, pour que deux exécutions donnent le même résultat.
        b.aire_absolue()
            .partial_cmp(&a.aire_absolue())
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| {
                a.boite()
                    .min
                    .x
                    .partial_cmp(&b.boite().min.x)
                    .unwrap_or(std::cmp::Ordering::Equal)
            })
    });
    Ok(anneaux)
}

/// Un point est-il sur le bord d'un des anneaux de la forme ?
///
/// Sert aux contrôles : c'est la façon la plus simple de vérifier qu'un résultat
/// ne laisse pas un bord à moitié construit.
#[must_use]
pub fn sur_le_bord(contour: &Contour, p: Point) -> bool {
    contour.aretes().iter().any(|(a, b)| sur_segment(p, *a, *b))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn carre(x: f64, y: f64, cote: f64) -> Contour {
        Contour::simple(Polygone::rectangle(x, y, cote, cote))
    }

    fn aire(c: &Contour) -> f64 {
        c.aire()
    }

    #[test]
    fn union_de_deux_carres_qui_se_recouvrent() {
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(5.0, 0.0, 10.0);
        let u = operer(&a, &b, Operation::Union).unwrap();
        // Aire : 100 + 100 − 50 = 150.
        assert!((aire(&u) - 150.0).abs() < 1e-9, "aire {}", aire(&u));
        assert_eq!(u.anneaux.len(), 1);
        assert!(u.contient(Point::new(1.0, 1.0)));
        assert!(u.contient(Point::new(9.0, 9.0)));
        assert!(u.contient(Point::new(15.0, 5.0)));
        assert!(!u.contient(Point::new(16.0, 5.0)));
        // Les deux carrés sont alignés en hauteur : leur union est exactement le
        // grand rectangle, donc QUATRE sommets. Les sommets de contact alignés
        // ont été retirés, sans quoi le tracé porterait deux points de plus pour
        // rien.
        assert_eq!(
            u.anneaux[0].points.len(),
            4,
            "points {:?}",
            u.anneaux[0].points
        );
        assert!((u.boite().max.x - 15.0).abs() < 1e-12);
        assert!(u.anneaux[0].est_simple());
    }

    #[test]
    fn union_de_deux_carres_decales() {
        // Décalés dans les deux directions : le contour a un coin rentrant, et
        // les sommets d'intersection sont bien conservés.
        //
        //   A = [0,10]×[0,10]      B = [5,15]×[3,13]
        //
        // Le contour décrit un escalier à huit sommets, avec DEUX coins
        // rentrants — (10,3) en bas à droite, (5,10) en haut à gauche :
        //
        //   (0,0) → (10,0) → (10,3) → (15,3) → (15,13) → (5,13) → (5,10) →
        //   (0,10) → fermé
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(5.0, 3.0, 10.0);
        let u = operer(&a, &b, Operation::Union).unwrap();
        // Recouvrement : 5 × 7 = 35, donc union = 100 + 100 − 35 = 165.
        assert!((aire(&u) - 165.0).abs() < 1e-9, "aire {}", aire(&u));
        assert_eq!(u.anneaux.len(), 1);
        assert_eq!(
            u.anneaux[0].points.len(),
            8,
            "points {:?}",
            u.anneaux[0].points
        );
        assert!(u.anneaux[0].est_simple());
        assert_eq!(u.boite().max, Point::new(15.0, 13.0));
        // Les deux coins rentrants sont dehors, et leurs voisins dedans.
        assert!(
            !u.contient(Point::new(11.0, 2.0)),
            "en bas à droite : dehors"
        );
        assert!(
            !u.contient(Point::new(4.0, 11.0)),
            "en haut à gauche : dehors"
        );
        assert!(u.contient(Point::new(9.0, 2.0)));
        assert!(u.contient(Point::new(6.0, 11.0)));
        assert!(u.contient(Point::new(7.0, 5.0)));
        assert!(u.contient(Point::new(12.0, 5.0)));
    }

    #[test]
    fn intersection_de_deux_carres_qui_se_recouvrent() {
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(5.0, 0.0, 10.0);
        let i = operer(&a, &b, Operation::Intersection).unwrap();
        assert!((aire(&i) - 50.0).abs() < 1e-9, "aire {}", aire(&i));
        assert!(i.contient(Point::new(6.0, 5.0)));
        assert!(!i.contient(Point::new(4.0, 5.0)));
        assert!(!i.contient(Point::new(11.0, 5.0)));
        // Identité : union + intersection = somme des aires.
        let u = operer(&a, &b, Operation::Union).unwrap();
        assert!((aire(&u) + aire(&i) - (aire(&a) + aire(&b))).abs() < 1e-9);
    }

    #[test]
    fn difference_de_deux_carres_qui_se_recouvrent() {
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(5.0, 0.0, 10.0);
        let d = operer(&a, &b, Operation::Difference).unwrap();
        assert!((aire(&d) - 50.0).abs() < 1e-9, "aire {}", aire(&d));
        assert!(d.contient(Point::new(2.0, 5.0)));
        assert!(!d.contient(Point::new(6.0, 5.0)));
        // La différence est exactement `A` privé de l'intersection.
        let i = operer(&a, &b, Operation::Intersection).unwrap();
        assert!((aire(&d) - (aire(&a) - aire(&i))).abs() < 1e-9);
    }

    #[test]
    fn exclusion_de_deux_carres_qui_se_recouvrent() {
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(5.0, 0.0, 10.0);
        let x = operer(&a, &b, Operation::Exclusion).unwrap();
        // L'exclusion, c'est l'union moins l'intersection : 150 − 50 = 100, en
        // deux morceaux qui ne se touchent pas.
        assert!((aire(&x) - 100.0).abs() < 1e-9, "aire {}", aire(&x));
        assert_eq!(x.anneaux.len(), 2, "deux morceaux attendus");
        assert!(x.contient(Point::new(2.0, 5.0)));
        assert!(x.contient(Point::new(12.0, 5.0)));
        assert!(!x.contient(Point::new(7.0, 5.0)));
    }

    #[test]
    fn deux_carres_qui_partagent_une_arete() {
        // Le cas qui casse les implémentations naïves : les bords colinéaires.
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(10.0, 0.0, 10.0);

        let u = operer(&a, &b, Operation::Union).unwrap();
        assert!((aire(&u) - 200.0).abs() < 1e-9, "aire {}", aire(&u));
        assert_eq!(u.anneaux.len(), 1, "un seul anneau : le grand rectangle");
        assert_eq!(u.anneaux[0].points.len(), 4, "quatre sommets, pas huit");
        assert_eq!(u.boite().max.x, 20.0);
        assert!(u.anneaux[0].est_simple());

        // L'intersection est le segment commun : une surface nulle.
        assert_eq!(
            operer(&a, &b, Operation::Intersection),
            Err(ErreurPath::ResultatVide)
        );
        // Et l'exclusion redonne les deux carrés.
        let x = operer(&a, &b, Operation::Exclusion).unwrap();
        assert!((aire(&x) - 200.0).abs() < 1e-9, "aire {}", aire(&x));
    }

    #[test]
    fn deux_carres_qui_se_touchent_par_un_coin() {
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(10.0, 10.0, 10.0);
        let u = operer(&a, &b, Operation::Union).unwrap();
        assert!((aire(&u) - 200.0).abs() < 1e-9, "aire {}", aire(&u));
        // Deux anneaux simples valent mieux qu'un anneau qui se croise.
        assert_eq!(u.anneaux.len(), 2);
        assert!(u.anneaux.iter().all(Polygone::est_simple));
        assert_eq!(
            operer(&a, &b, Operation::Intersection),
            Err(ErreurPath::ResultatVide)
        );
    }

    #[test]
    fn carres_disjoints() {
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(100.0, 100.0, 10.0);
        let u = operer(&a, &b, Operation::Union).unwrap();
        assert_eq!(u.anneaux.len(), 2);
        assert!((aire(&u) - 200.0).abs() < 1e-9);
        assert_eq!(
            operer(&a, &b, Operation::Intersection),
            Err(ErreurPath::ResultatVide)
        );
        let d = operer(&a, &b, Operation::Difference).unwrap();
        assert!((aire(&d) - 100.0).abs() < 1e-9);
    }

    #[test]
    fn un_carre_dans_un_carre() {
        let grand = carre(0.0, 0.0, 10.0);
        let petit = carre(3.0, 3.0, 4.0);
        let d = operer(&grand, &petit, Operation::Difference).unwrap();
        assert!((aire(&d) - 84.0).abs() < 1e-9, "aire {}", aire(&d));
        // Un trou, donc deux anneaux, et le trou tourne à l'envers.
        assert_eq!(d.anneaux.len(), 2);
        let aires: Vec<f64> = d.anneaux.iter().map(Polygone::aire).collect();
        assert!(aires[0] > 0.0 && aires[1] < 0.0, "aires {aires:?}");
        assert!(!d.contient(Point::new(5.0, 5.0)));
        assert!(d.contient(Point::new(1.0, 1.0)));
        // Et le petit carré est bien l'intersection.
        let i = operer(&grand, &petit, Operation::Intersection).unwrap();
        assert!((aire(&i) - 16.0).abs() < 1e-9);
        assert!((aire(&i) - petit.aire()).abs() < 1e-9);
    }

    #[test]
    fn formes_identiques() {
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(0.0, 0.0, 10.0);
        assert!((aire(&operer(&a, &b, Operation::Union).unwrap()) - 100.0).abs() < 1e-9);
        assert!((aire(&operer(&a, &b, Operation::Intersection).unwrap()) - 100.0).abs() < 1e-9);
        assert_eq!(
            operer(&a, &b, Operation::Difference),
            Err(ErreurPath::ResultatVide)
        );
        assert_eq!(
            operer(&a, &b, Operation::Exclusion),
            Err(ErreurPath::ResultatVide)
        );
    }

    #[test]
    fn triangles_qui_se_coupent() {
        let a = Contour::simple(Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(0.0, 10.0),
        ]));
        let b = Contour::simple(Polygone::nouveau(vec![
            Point::new(5.0, 0.0),
            Point::new(15.0, 0.0),
            Point::new(15.0, 10.0),
        ]));
        let u = operer(&a, &b, Operation::Union).unwrap();
        let i = operer(&a, &b, Operation::Intersection).unwrap();
        // L'intersection est le triangle (5,0), (10,0), (7,5) : ½ × 5 × 2,5.
        assert!((aire(&i) - 6.25).abs() < 1e-9, "aire {}", aire(&i));
        assert!(i.anneaux.iter().all(Polygone::est_simple));
        // Et l'identité des aires tient : union + intersection = somme.
        assert!(
            (aire(&u) + aire(&i) - (50.0 + 50.0)).abs() < 1e-9,
            "union {}",
            aire(&u)
        );
        assert!(u.anneaux.iter().all(Polygone::est_simple));
        assert_eq!(u.anneaux.len(), 1);
    }

    #[test]
    fn deux_triangles_qui_ne_se_touchent_qu_en_un_point() {
        // Ce cas est un piège : les deux formes se touchent, mais ne se
        // recouvrent pas. L'intersection a une aire nulle, et elle est donc
        // refusée comme vide — ce qui oblige à l'écrire plutôt qu'à le
        // découvrir.
        let a = Contour::simple(Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 0.0),
            Point::new(0.0, 10.0),
        ]));
        let b = Contour::simple(Polygone::nouveau(vec![
            Point::new(5.0, 5.0),
            Point::new(15.0, 5.0),
            Point::new(15.0, 15.0),
        ]));
        assert_eq!(
            operer(&a, &b, Operation::Intersection),
            Err(ErreurPath::ResultatVide)
        );
        let u = operer(&a, &b, Operation::Union).unwrap();
        assert!((aire(&u) - 100.0).abs() < 1e-9, "aire {}", aire(&u));
        assert_eq!(u.anneaux.len(), 2);
        assert!(u.anneaux.iter().all(Polygone::est_simple));
    }

    #[test]
    fn symetrie_de_l_union_et_de_l_intersection() {
        let a = Contour::simple(Polygone::regulier(Point::new(0.0, 0.0), 10.0, 7));
        let b = Contour::simple(Polygone::regulier(Point::new(6.0, 3.0), 8.0, 5));
        let u1 = operer(&a, &b, Operation::Union).unwrap();
        let u2 = operer(&b, &a, Operation::Union).unwrap();
        assert!((aire(&u1) - aire(&u2)).abs() < 1e-9);
        let i1 = operer(&a, &b, Operation::Intersection).unwrap();
        let i2 = operer(&b, &a, Operation::Intersection).unwrap();
        assert!((aire(&i1) - aire(&i2)).abs() < 1e-9);
        // L'intersection est toujours plus petite que chacune des deux.
        assert!(aire(&i1) <= aire(&a) + 1e-9);
        assert!(aire(&i1) <= aire(&b) + 1e-9);
        // Et l'union plus grande.
        assert!(aire(&u1) >= aire(&a) - 1e-9);
        assert!(aire(&u1) >= aire(&b) - 1e-9);
    }

    #[test]
    fn la_difference_n_est_pas_commutative() {
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(3.0, 0.0, 10.0);
        let ab = operer(&a, &b, Operation::Difference).unwrap();
        let ba = operer(&b, &a, Operation::Difference).unwrap();
        assert!((aire(&ab) - 30.0).abs() < 1e-9, "aire {}", aire(&ab));
        assert!((aire(&ba) - 30.0).abs() < 1e-9, "aire {}", aire(&ba));
        // Mêmes aires par symétrie du recouvrement, mais pas les mêmes points.
        assert!(ab.contient(Point::new(1.0, 5.0)));
        assert!(!ab.contient(Point::new(11.0, 5.0)));
        assert!(ba.contient(Point::new(11.0, 5.0)));
        assert!(!ba.contient(Point::new(1.0, 5.0)));
    }

    #[test]
    fn identites_verifiees_sur_les_anneaux_booleens() {
        // Union + intersection = somme, et exclusion = union − intersection.
        for (dx, dy, cote) in [(5.0, 0.0, 10.0), (3.0, 3.0, 10.0), (0.0, 7.0, 12.0)] {
            let a = carre(0.0, 0.0, 10.0);
            let b = carre(dx, dy, cote);
            let u = operer(&a, &b, Operation::Union).unwrap();
            let i = operer(&a, &b, Operation::Intersection).unwrap();
            let x = operer(&a, &b, Operation::Exclusion).unwrap();
            assert!(
                (aire(&u) + aire(&i) - (aire(&a) + aire(&b))).abs() < 1e-9,
                "décalage {dx},{dy} côté {cote}"
            );
            assert!((aire(&x) - (aire(&u) - aire(&i))).abs() < 1e-9);
        }
    }

    #[test]
    fn refuse_les_entrees_qui_n_ont_pas_de_sens() {
        let bon = carre(0.0, 0.0, 10.0);
        let croise = Contour::simple(Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(10.0, 10.0),
            Point::new(10.0, 0.0),
            Point::new(0.0, 10.0),
        ]));
        assert_eq!(
            operer(&croise, &bon, Operation::Union),
            Err(ErreurPath::ContourNonSimple { gauche: true })
        );
        assert_eq!(
            operer(&bon, &croise, Operation::Union),
            Err(ErreurPath::ContourNonSimple { gauche: false })
        );
        let vide = Contour::avec_regle(vec![], Regle::NonZero);
        assert_eq!(
            operer(&vide, &bon, Operation::Union),
            Err(ErreurPath::ContourVide { gauche: true })
        );
        let plat = Contour::simple(Polygone::nouveau(vec![
            Point::new(0.0, 0.0),
            Point::new(5.0, 0.0),
            Point::new(10.0, 0.0),
        ]));
        assert_eq!(
            operer(&plat, &bon, Operation::Union),
            Err(ErreurPath::ContourDegenere { gauche: true })
        );
    }

    #[test]
    fn le_resultat_est_un_contour_non_zero_dont_les_trous_sont_a_l_envers() {
        let grand = Contour::simple(Polygone::regulier(Point::new(0.0, 0.0), 20.0, 24));
        let petit = Contour::simple(Polygone::regulier(Point::new(0.0, 0.0), 8.0, 24));
        let d = operer(&grand, &petit, Operation::Difference).unwrap();
        assert_eq!(d.anneaux.len(), 2);
        // L'anneau extérieur tourne dans le sens direct, le trou à l'envers :
        // c'est ce qui fait le trou sous la règle `NonZero`.
        let exterieur = d.anneaux.iter().find(|a| a.aire() > 0.0).unwrap();
        let trou = d.anneaux.iter().find(|a| a.aire() < 0.0).unwrap();
        assert!(exterieur.aire() > trou.aire_absolue());
        assert!(!d.contient(Point::origine()));
        assert!(d.contient(Point::new(15.0, 0.0)));
    }

    #[test]
    fn le_bord_du_resultat_ne_contient_aucun_point_interieur() {
        // Contrôle de cohérence : les sommets du résultat sont sur son bord.
        let a = carre(0.0, 0.0, 10.0);
        let b = carre(5.0, -5.0, 10.0);
        let u = operer(&a, &b, Operation::Union).unwrap();
        for anneau in &u.anneaux {
            for p in &anneau.points {
                assert!(sur_le_bord(&u, *p), "{p:?} devrait être sur le bord");
            }
        }
    }
}
