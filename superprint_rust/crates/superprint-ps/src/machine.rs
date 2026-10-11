//! La machine : un interpréteur PostScript **sûr** et **borné**.
//!
//! ## Pourquoi il faut un interpréteur, et pas un analyseur
//!
//! PostScript est un langage. Un `.eps` réel commence par un **prologue** qui
//! définit des abréviations — `/m /moveto load def`, `/f /fill load def` — et le
//! corps du dessin n'emploie que celles-là. Un analyseur qui chercherait
//! `moveto` dans le texte ne verrait rien du dessin ; un analyseur qui
//! chercherait `m` ferait des faux positifs partout. Il faut donc **exécuter**.
//!
//! ## Trois bornes, et ce qu'elles protègent
//!
//! | Borne | Valeur | Ce qu'elle empêche |
//! |---|---|---|
//! | pas d'exécution | 5 000 000 | une boucle infinie écrite dans le fichier |
//! | profondeur d'appel | 64 | une procédure qui s'appelle elle-même |
//! | dessins produits | 100 000 | un fichier qui gonfle la mémoire |
//! | profondeur de pile | 10 000 | un programme qui empile sans dépiler |
//!
//! Un fichier qui dépasse une borne est **refusé**, avec le nom de la borne.
//!
//! ## Ce qui est refusé, et pourquoi ce n'est pas de la paresse
//!
//! Certains opérateurs sont **connus** et **refusés nommément** :
//!
//! - `show`, `ashow`, `widthshow`, `kshow` : le texte. Les interpréter demande
//!   la police, le corps, les approches — c'est-à-dire un moteur de composition
//!   de plus. Les **ignorer** serait bien pire : l'import rendrait un dessin
//!   amputé de ses libellés, en silence ;
//! - `image`, `imagemask`, `colorimage` : les images bitmap.
//! - `forall`, `loop`, `exit`, `stopped`, `run` : les itérations. Un fichier qui
//!   en a besoin se heurtera à un refus qui le nomme, pas à une exécution
//!   partielle qui aurait l'air d'un dessin complet ;
//! - `arc` et `arcn` sont, elles, **supportées** : elles se remplacent par des
//!   Béziers, ce qui ne perd rien à la précision d'un tracé.
//!
//! ## Les matrices ne sont pas appliquées aux chemins par magie
//!
//! Chaque point passe par la matrice au moment où il est ajouté. Une
//! transformation change la matrice **en cours** ; elle ne retouche pas les
//! points déjà tracés. C'est le comportement de PostScript, et l'inverse
//! (appliquer à la fin) donnerait un dessin faux dès qu'un programme change de
//! repère au milieu d'un chemin.

use std::collections::{HashMap, HashSet};

use superprint_path::courbe::Courbe;
use superprint_path::point::Point;

use crate::dessin::{Couleur, Dessin, Matrice, Peinture};
use crate::lexeur::Objet;
use crate::{ErreurPs, Valeurs};

/// Pas d'exécution maximal.
pub const PAS_MAX: usize = 5_000_000;
/// Profondeur d'appel maximale (procédures et opérateurs confondus).
pub const APPELS_MAX: usize = 64;
/// Nombre maximal de dessins produits.
pub const DESSINS_MAX: usize = 100_000;
/// Profondeur maximale de la pile d'opérandes.
pub const PILE_MAX: usize = 10_000;

/// L'état graphique, empilé par `gsave`.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct EtatGraphique {
    /// La matrice courante.
    pub matrice: Matrice,
    /// La couleur courante.
    pub couleur: Couleur,
    /// L'épaisseur du trait.
    pub epaisseur: f64,
    /// Le facteur de planéité (accepté, sans effet : le noyau aplatit à sa
    /// propre tolérance, documentée).
    pub planeite: f64,
}

impl Default for EtatGraphique {
    fn default() -> Self {
        Self {
            matrice: Matrice::identite(),
            couleur: Couleur::Gris(0.0),
            epaisseur: 1.0,
            planeite: 1.0,
        }
    }
}

/// La machine PostScript.
pub struct Machine {
    pile: Vec<Objet>,
    dictionnaire: HashMap<String, Objet>,
    etats: Vec<EtatGraphique>,
    sauvegardes: Vec<(EtatGraphique, HashMap<String, Objet>)>,
    etats_sauvegardes: Vec<Vec<EtatGraphique>>,
    chemin: Vec<Vec<Point>>,
    point_courant: Option<Point>,
    depart_sous_chemin: Option<Point>,
    dessins: Vec<Dessin>,
    operateurs: HashSet<String>,
    inconnus: Vec<String>,
    blocs_ignores: usize,
    pas: usize,
    appels: usize,
    pages: usize,
    avertissements: Vec<String>,
    /// La tolérance d'aplatissement des courbes, en points.
    tolerance: f64,
}

impl Machine {
    /// Une machine neuve, avec une tolérance d'aplatissement.
    ///
    /// La tolérance est la même unité que les coordonnées : `0,05` point pour un
    /// tracé d'imprimerie est invisible à l'œil et reste raisonnable en nombre
    /// de sommets.
    #[must_use]
    pub fn nouvelle(tolerance: f64) -> Self {
        Self {
            pile: Vec::new(),
            dictionnaire: HashMap::new(),
            etats: vec![EtatGraphique::default()],
            sauvegardes: Vec::new(),
            etats_sauvegardes: Vec::new(),
            chemin: Vec::new(),
            point_courant: None,
            depart_sous_chemin: None,
            dessins: Vec::new(),
            operateurs: HashSet::new(),
            inconnus: Vec::new(),
            blocs_ignores: 0,
            pas: 0,
            appels: 0,
            pages: 0,
            avertissements: Vec::new(),
            tolerance: if tolerance > 0.0 { tolerance } else { 0.05 },
        }
    }

    /// Le nombre de blocs de données sauté par le découpage DSC.
    pub fn blocs_ignores(&mut self, nombre: usize) {
        self.blocs_ignores = nombre;
    }

    /// L'état graphique courant.
    fn etat(&self) -> EtatGraphique {
        *self
            .etats
            .last()
            .expect("la pile d'états n'est jamais vide")
    }

    fn etat_mut(&mut self) -> &mut EtatGraphique {
        self.etats
            .last_mut()
            .expect("la pile d'états n'est jamais vide")
    }

    /// Avertit une seule fois (message déjà présent = on n'ajoute pas).
    fn avertir(&mut self, message: impl Into<String>) {
        let message = message.into();
        if !self.avertissements.contains(&message) {
            self.avertissements.push(message);
        }
    }

    /// Exécute une suite d'objets, comme le fait le scanneur de PostScript.
    ///
    /// # Erreurs
    ///
    /// Voir [`ErreurPs`].
    pub fn executer(&mut self, objets: &[Objet]) -> Result<(), ErreurPs> {
        for objet in objets {
            self.pas += 1;
            if self.pas > PAS_MAX {
                return Err(ErreurPs::TropDePas { limite: PAS_MAX });
            }
            match objet {
                Objet::Nom(nom) => self.executer_nom(nom)?,
                Objet::Operateur(nom) => self.operateur(nom)?,
                // Un `{ … }` rencontré par le scanneur est **empilé**, pas
                // exécuté. C'est la sémantique de PostScript, et ce n'est pas un
                // détail : c'est ce qui permet à `/f { 0 0 moveto } def` de
                // définir une procédure au lieu de l'exécuter sur place — et un
                // en-tête d'EPS réel est un enchaînement de telles définitions.
                autre => self.empiler(autre.clone())?,
            }
        }
        Ok(())
    }

    /// Exécute un objet : une procédure s'exécute, tout le reste est empilé.
    fn appeler(&mut self, objet: Objet) -> Result<(), ErreurPs> {
        match objet {
            Objet::Procedure(corps) => {
                self.appels += 1;
                if self.appels > APPELS_MAX {
                    return Err(ErreurPs::TropProfond { limite: APPELS_MAX });
                }
                self.executer(&corps)?;
                self.appels -= 1;
                Ok(())
            }
            Objet::Operateur(nom) => self.operateur(&nom),
            Objet::Nom(nom) => self.executer_nom(&nom),
            autre => self.empiler(autre),
        }
    }

    /// Exécute un nom : sa valeur est cherchée dans le dictionnaire, puis parmi
    /// les opérateurs du noyau.
    ///
    /// ## Inconnu n'est pas la même chose que refusé
    ///
    /// Trois cas, et trois comportements distincts :
    ///
    /// 1. **le nom est défini** par le fichier : sa valeur est exécutée (une
    ///    procédure) ou empilée (autre chose) ;
    /// 2. **le nom est un opérateur connu mais non interprété** — le texte, une
    ///    image, une boucle sans compteur : on **refuse en nommant la raison**.
    ///    Continuer donnerait un dessin amputé de ses libellés, en silence, ce
    ///    qui est pire qu'un échec : un échec se voit ;
    /// 3. **le nom est inconnu** : on le **signale** dans les avertissements et
    ///    on poursuit. Un EPS réel arrive souvent avec un prologue tronqué —
    ///    `/GS0 gs` en est l'exemple le plus courant — et refuser tout le fichier
    ///    pour un marqueur d'état sans effet géométrique rendrait l'import
    ///    inutilisable sur des fichiers valides. Ce n'est PAS un silence : le nom
    ///    est relevé, compté et rendu dans le rapport.
    ///
    /// Un interpréteur PostScript strict lèverait `undefined` dans le cas 3.
    /// C'est un écart assumé, et mesuré : voir `scripts/validate-ps.mjs`.
    fn executer_nom(&mut self, nom: &str) -> Result<(), ErreurPs> {
        if let Some(valeur) = self.dictionnaire.get(nom).cloned() {
            // Une valeur qui n'est ni procédure ni opérateur est empilée : c'est
            // ainsi qu'un `/x 5 def` suivi de `x` met 5 sur la pile.
            return self.appeler(valeur);
        }
        if mon_operateur(nom) {
            return self.operateur(nom);
        }
        if let Some(raison) = refus_connu(nom) {
            return Err(ErreurPs::OperateurNonSupporte {
                nom: nom.to_string(),
                raison: raison.to_string(),
            });
        }
        self.signaler_inconnu(nom);
        Ok(())
    }

    /// Relevé d'un opérateur inconnu : une fois par nom, jamais en silence.
    fn signaler_inconnu(&mut self, nom: &str) {
        self.operateurs.insert(nom.to_string());
        if !self.inconnus.iter().any(|n| n == nom) {
            self.inconnus.push(nom.to_string());
        }
        self.avertir(format!(
            "opérateur inconnu « {nom} » : ignoré, et relevé ici. Un EPS dont le prologue \
             est tronqué en contient souvent ; s'il manque quelque chose au dessin, c'est \
             le premier endroit où regarder"
        ));
    }

    fn empiler(&mut self, objet: Objet) -> Result<(), ErreurPs> {
        if self.pile.len() >= PILE_MAX {
            return Err(ErreurPs::PileTropProfonde { limite: PILE_MAX });
        }
        self.pile.push(objet);
        Ok(())
    }

    /// Dépile un objet, ou refuse en nommant l'opérateur fautif.
    fn depiler(&mut self, operateur: &str) -> Result<Objet, ErreurPs> {
        self.pile.pop().ok_or_else(|| ErreurPs::PileInsuffisante {
            operateur: operateur.to_string(),
        })
    }

    /// Dépile un nombre, ou refuse.
    fn nombre(&mut self, operateur: &str) -> Result<f64, ErreurPs> {
        let objet = self.depiler(operateur)?;
        objet.comme_nombre().ok_or_else(|| ErreurPs::TypeInattendu {
            operateur: operateur.to_string(),
            recu: objet.to_string(),
        })
    }

    /// Dépile un entier, ou refuse.
    fn entier(&mut self, operateur: &str) -> Result<i64, ErreurPs> {
        let objet = self.depiler(operateur)?;
        objet.comme_entier().ok_or_else(|| ErreurPs::TypeInattendu {
            operateur: operateur.to_string(),
            recu: objet.to_string(),
        })
    }

    /// Dépile un booléen, ou refuse.
    fn booleen(&mut self, operateur: &str) -> Result<bool, ErreurPs> {
        let objet = self.depiler(operateur)?;
        match objet {
            Objet::Booleen(v) => Ok(v),
            autre => Err(ErreurPs::TypeInattendu {
                operateur: operateur.to_string(),
                recu: autre.to_string(),
            }),
        }
    }

    /// Dépile une procédure, ou refuse.
    fn procedure(&mut self, operateur: &str) -> Result<Vec<Objet>, ErreurPs> {
        let objet = self.depiler(operateur)?;
        match objet {
            Objet::Procedure(corps) => Ok(corps),
            autre => Err(ErreurPs::TypeInattendu {
                operateur: operateur.to_string(),
                recu: autre.to_string(),
            }),
        }
    }

    /// Dépile un tableau, ou refuse.
    fn tableau(&mut self, operateur: &str) -> Result<Vec<Objet>, ErreurPs> {
        let objet = self.depiler(operateur)?;
        match objet {
            Objet::Tableau(valeurs) => Ok(valeurs),
            autre => Err(ErreurPs::TypeInattendu {
                operateur: operateur.to_string(),
                recu: autre.to_string(),
            }),
        }
    }

    fn positionner(&mut self, x: f64, y: f64) {
        let point = self.etat().matrice.appliquer(Point::new(x, y));
        match self.chemin.last_mut() {
            Some(sous_chemin) => sous_chemin.push(point),
            None => self.chemin.push(vec![point]),
        }
        self.point_courant = Some(point);
    }

    /// Ajoute une courbe exprimée dans le repère **utilisateur**.
    ///
    /// Les points de contrôle sont transformés AVANT l'aplatissement : c'est
    /// l'ordre correct, parce que l'aplatissement doit se faire à la tolérance
    /// demandée dans le repère final. Aplatir puis transformer donnerait un écart
    /// multiplié par l'échelle — et une courbe trop grossière dès qu'on agrandit.
    fn ajouter_courbe(&mut self, controle1: Point, controle2: Point, arrivee: Point) {
        let matrice = self.etat().matrice;
        self.ajouter_courbe_appareil(
            matrice.appliquer(controle1),
            matrice.appliquer(controle2),
            matrice.appliquer(arrivee),
        );
    }

    /// Ajoute une courbe exprimée en repère d'**appareil**.
    fn ajouter_courbe_appareil(&mut self, controle1: Point, controle2: Point, arrivee: Point) {
        let depart = self.point_courant.unwrap_or(controle1);
        let courbe = Courbe::Cubique {
            depart,
            controle1,
            controle2,
            arrivee,
        };
        let mut points = Vec::new();
        // Le premier point est déjà dans le chemin : `aplatir` n'ajoute que les
        // points d'arrivée successifs.
        courbe.aplatir(self.tolerance, &mut points);
        match self.chemin.last_mut() {
            Some(sous_chemin) => sous_chemin.extend(points),
            None => self.chemin.push(points),
        }
        self.point_courant = Some(arrivee);
    }

    /// Peint le chemin courant et repart à zéro.
    fn peindre(&mut self, peinture: Peinture) -> Result<(), ErreurPs> {
        if self.chemin.is_empty() {
            return Err(ErreurPs::CheminVide {
                operateur: peinture.nom().to_string(),
            });
        }
        if self.dessins.len() >= DESSINS_MAX {
            return Err(ErreurPs::TropDeDessins {
                limite: DESSINS_MAX,
            });
        }
        if peinture == Peinture::Tronque {
            self.avertir(
                "les découpages (`clip`) sont enregistrés mais NON appliqués aux formes \
                 suivantes : découper vraiment demanderait une algèbre de régions",
            );
        }
        let dessin = Dessin {
            sous_chemins: std::mem::take(&mut self.chemin),
            peinture,
            couleur: self.etat().couleur,
        };
        self.point_courant = None;
        self.depart_sous_chemin = None;
        self.dessins.push(dessin);
        Ok(())
    }

    /// Un arc de cercle remplacé par des Béziers.
    ///
    /// La longueur de poignée d'un arc de `θ` radians est `4/3 · tan(θ/4) · r`.
    /// Pour un quart de tour, cela vaut `0,5523 · r` — la constante `kappa`
    /// classique. La formule générale est préférée à la constante parce qu'un arc
    /// de 30° écrit avec des poignées de quart de tour donnerait un arc faux.
    ///
    /// Les points sont calculés dans le repère UTILISATEUR puis transformés un à
    /// un : sous une matrice non uniforme, un arc devient donc une ellipse, ce
    /// qui est bien le comportement attendu. Mélanger les deux repères — par
    /// exemple en prenant le point courant (déjà transformé) comme départ —
    /// donnerait une ellipse fausse dès qu'une mise à l'échelle est en vigueur.
    ///
    /// Le point courant est supposé **déjà** au départ de l'arc : c'est
    /// l'appelant qui l'y met, parce que PostScript y ajoute une droite d'attache
    /// quand il y avait un point courant.
    fn arc(&mut self, centre: Point, rayon: f64, debut: f64, fin: f64, sens_direct: bool) {
        let balayage = if sens_direct {
            let mut reste = fin - debut;
            while reste <= 0.0 {
                reste += 360.0;
            }
            reste
        } else {
            let mut reste = debut - fin;
            while reste <= 0.0 {
                reste += 360.0;
            }
            -reste
        };
        let signe = if balayage >= 0.0 { 1.0 } else { -1.0 };
        let matrice = self.etat().matrice;
        let mut angle = debut;
        let mut reste = balayage.abs();
        // Un tour complet se découpe en quarts de tour au plus : quatre Béziers
        // par quart font coïncider le tracé avec le cercle à moins d'un millième
        // de rayon.
        while reste > 1e-9 {
            let pas = reste.min(90.0);
            let a0 = angle.to_radians();
            let a1 = (angle + signe * pas).to_radians();
            let theta = (signe * pas).to_radians();
            let poignee = 4.0 / 3.0 * (theta / 4.0).tan() * rayon;
            let p0 = centre + Point::new(a0.cos(), a0.sin()) * rayon;
            let p1 = centre + Point::new(a1.cos(), a1.sin()) * rayon;
            // La tangente au cercle au paramètre θ, orientée par le sens de
            // parcours.
            let tangente = |a: f64| Point::new(-a.sin(), a.cos()) * signe * poignee;
            self.ajouter_courbe_appareil(
                matrice.appliquer(p0 + tangente(a0)),
                matrice.appliquer(p1 - tangente(a1)),
                matrice.appliquer(p1),
            );
            angle += signe * pas;
            reste -= pas;
        }
    }

    /// Un opérateur du noyau.
    fn operateur(&mut self, nom: &str) -> Result<(), ErreurPs> {
        self.operateurs.insert(nom.to_string());
        match nom {
            // ── pile ────────────────────────────────────────────────────
            "dup" => {
                let haut = self.depiler(nom)?;
                self.empiler(haut.clone())?;
                self.empiler(haut)
            }
            "exch" => {
                let b = self.depiler(nom)?;
                let a = self.depiler(nom)?;
                self.empiler(b)?;
                self.empiler(a)
            }
            "pop" => {
                self.depiler(nom)?;
                Ok(())
            }
            "clear" => {
                self.pile.clear();
                Ok(())
            }
            "count" => self.empiler(Objet::Entier(self.pile.len() as i64)),
            "copy" => {
                let n = self.entier(nom)?.max(0) as usize;
                if n > self.pile.len() {
                    return Err(ErreurPs::PileInsuffisante {
                        operateur: nom.to_string(),
                    });
                }
                let debut = self.pile.len() - n;
                let copie: Vec<Objet> = self.pile[debut..].to_vec();
                for objet in copie {
                    self.empiler(objet)?;
                }
                Ok(())
            }
            "index" => {
                let n = self.entier(nom)?.max(0) as usize;
                if n >= self.pile.len() {
                    return Err(ErreurPs::PileInsuffisante {
                        operateur: nom.to_string(),
                    });
                }
                let objet = self.pile[self.pile.len() - 1 - n].clone();
                self.empiler(objet)
            }
            "roll" => {
                let j = self.entier(nom)?;
                let n = self.entier(nom)?.max(0) as usize;
                if n > self.pile.len() {
                    return Err(ErreurPs::PileInsuffisante {
                        operateur: nom.to_string(),
                    });
                }
                if n == 0 {
                    return Ok(());
                }
                let debut = self.pile.len() - n;
                let tour = ((j % n as i64) + n as i64) as usize % n;
                self.pile[debut..].rotate_right(tour);
                Ok(())
            }
            "mark" => self.empiler(Objet::Marque),
            "cleartomark" => {
                while let Some(objet) = self.pile.pop() {
                    if objet == Objet::Marque {
                        return Ok(());
                    }
                }
                Err(ErreurPs::TypeInattendu {
                    operateur: nom.to_string(),
                    recu: "aucune marque sur la pile".to_string(),
                })
            }
            "counttomark" => {
                let compte = self
                    .pile
                    .iter()
                    .rev()
                    .take_while(|o| **o != Objet::Marque)
                    .count();
                self.empiler(Objet::Entier(compte as i64))
            }
            // ── arithmétique ────────────────────────────────────────────
            "add" | "sub" | "mul" | "div" | "idiv" | "mod" | "atan" | "exp" => {
                let b = self.nombre(nom)?;
                let a = self.nombre(nom)?;
                let valeur = match nom {
                    "add" => a + b,
                    "sub" => a - b,
                    "mul" => a * b,
                    "div" => {
                        if b == 0.0 {
                            return Err(ErreurPs::DivisionParZero);
                        }
                        a / b
                    }
                    "idiv" => {
                        if b == 0.0 {
                            return Err(ErreurPs::DivisionParZero);
                        }
                        (a / b).trunc()
                    }
                    "mod" => {
                        if b == 0.0 {
                            return Err(ErreurPs::DivisionParZero);
                        }
                        a % b
                    }
                    "atan" => a.atan2(b).to_degrees(),
                    _ => {
                        let v = a.powf(b);
                        if !v.is_finite() {
                            return Err(ErreurPs::ValeurInvalide {
                                operateur: nom.to_string(),
                            });
                        }
                        v
                    }
                };
                self.verifier_nombre(nom, valeur)?;
                self.empiler(Objet::Reel(valeur))
            }
            "neg" | "abs" | "sqrt" | "sin" | "cos" | "ln" | "log" | "ceiling" | "floor"
            | "round" | "truncate" => {
                let a = self.nombre(nom)?;
                let valeur = match nom {
                    "neg" => -a,
                    "abs" => a.abs(),
                    "sqrt" => {
                        if a < 0.0 {
                            return Err(ErreurPs::ValeurInvalide {
                                operateur: nom.to_string(),
                            });
                        }
                        a.sqrt()
                    }
                    "sin" => a.to_radians().sin(),
                    "cos" => a.to_radians().cos(),
                    "ln" => {
                        if a <= 0.0 {
                            return Err(ErreurPs::ValeurInvalide {
                                operateur: nom.to_string(),
                            });
                        }
                        a.ln()
                    }
                    "log" => {
                        if a <= 0.0 {
                            return Err(ErreurPs::ValeurInvalide {
                                operateur: nom.to_string(),
                            });
                        }
                        a.log10()
                    }
                    "ceiling" => a.ceil(),
                    "floor" => a.floor(),
                    "round" => a.round(),
                    _ => a.trunc(),
                };
                self.verifier_nombre(nom, valeur)?;
                self.empiler(Objet::Reel(valeur))
            }
            // ── booléens et comparaisons ────────────────────────────────
            "eq" | "ne" | "gt" | "lt" | "ge" | "le" => {
                let b = self.depiler(nom)?;
                let a = self.depiler(nom)?;
                let resultat = match (a.comme_nombre(), b.comme_nombre()) {
                    (Some(x), Some(y)) => match nom {
                        "eq" => x == y,
                        "ne" => x != y,
                        "gt" => x > y,
                        "lt" => x < y,
                        "ge" => x >= y,
                        _ => x <= y,
                    },
                    _ => match nom {
                        "eq" => a == b,
                        "ne" => a != b,
                        _ => {
                            return Err(ErreurPs::TypeInattendu {
                                operateur: nom.to_string(),
                                recu: format!("{a} et {b}"),
                            })
                        }
                    },
                };
                self.empiler(Objet::Booleen(resultat))
            }
            "and" | "or" | "xor" => {
                let b = self.entier(nom)?;
                let a = self.entier(nom)?;
                let valeur = match nom {
                    "and" => a & b,
                    "or" => a | b,
                    _ => a ^ b,
                };
                self.empiler(Objet::Entier(valeur))
            }
            "not" => {
                let objet = self.depiler(nom)?;
                match objet {
                    Objet::Booleen(v) => self.empiler(Objet::Booleen(!v)),
                    Objet::Entier(v) => self.empiler(Objet::Entier(!v)),
                    autre => Err(ErreurPs::TypeInattendu {
                        operateur: nom.to_string(),
                        recu: autre.to_string(),
                    }),
                }
            }
            // ── conversion ──────────────────────────────────────────────
            "cvi" => {
                let v = self.entier(nom)?;
                self.empiler(Objet::Entier(v))
            }
            "cvr" => {
                let v = self.nombre(nom)?;
                self.empiler(Objet::Reel(v))
            }
            // ── dictionnaire et noms ────────────────────────────────────
            "def" => {
                let valeur = self.depiler(nom)?;
                let cle = self.depiler(nom)?;
                let Objet::NomLitteral(cle) = cle else {
                    return Err(ErreurPs::TypeInattendu {
                        operateur: nom.to_string(),
                        recu: cle.to_string(),
                    });
                };
                self.dictionnaire.insert(cle, valeur);
                Ok(())
            }
            "load" => {
                let cle = self.depiler(nom)?;
                let Some(cle) = cle.comme_nom() else {
                    return Err(ErreurPs::TypeInattendu {
                        operateur: nom.to_string(),
                        recu: cle.to_string(),
                    });
                };
                if let Some(valeur) = self.dictionnaire.get(cle).cloned() {
                    return self.empiler(valeur);
                }
                // Un opérateur connu — y compris un opérateur REFUSÉ — peut être
                // chargé : c'est l'EXÉCUTION qui refusera, en nommant la raison.
                // Refuser ici priverait le message de son contexte.
                if superprint_ps_operateur_connu(cle) {
                    return self.empiler(Objet::Operateur(cle.to_string()));
                }
                // Un nom que le fichier n'a pas défini et que le noyau ne connaît
                // pas : on empile un objet inerte plutôt que d'échouer. Un
                // prologue tronqué fait exactement cela, et refuser tout le
                // fichier pour un alias perdu serait disproportionné — mais le nom
                // est relevé.
                let inconnu = format!("<{cle}: inconnu>");
                self.signaler_inconnu(cle);
                self.empiler(Objet::NomLitteral(inconnu))
            }
            "gs" => {
                // `gs` n'appartient pas à PostScript : c'est un opérateur
                // d'**Illustrator**, qui applique un « état graphique » nommé
                // (`/GS0 gs`). Le nom est dépilé, et sans dictionnaire d'états à
                // appliquer, c'est tout ce qu'il y a à faire. Le refuser rendrait
                // illisibles des fichiers Illustrator réels — c'est mesuré : le
                // témoin `eps-illustrator.eps` en contient un.
                let _ = self.depiler(nom)?;
                Ok(())
            }
            "known" => {
                let cle = self.depiler(nom)?;
                let connu = cle
                    .comme_nom()
                    .is_some_and(|c| self.dictionnaire.contains_key(c));
                self.empiler(Objet::Booleen(connu))
            }
            "where" => {
                // Le sous-ensemble n'a qu'un dictionnaire : `where` rend
                // toujours vrai pour ce qui y est défini.
                let cle = self.depiler(nom)?;
                let connu = cle
                    .comme_nom()
                    .is_some_and(|c| self.dictionnaire.contains_key(c));
                self.empiler(Objet::Booleen(connu))
            }
            "bind" => {
                // `bind` n'est qu'une optimisation d'exécution en PostScript :
                // ne rien faire est correct, et le dire serait du bavardage.
                let _ = self.depiler(nom)?;
                Ok(())
            }
            "exec" => {
                let objet = self.depiler(nom)?;
                self.appeler(objet)
            }
            "cvx" | "cvlit" => {
                // Un nom reste un nom : la distinction littéral/exécutable n'a
                // pas d'effet dans ce sous-ensemble, où seul l'appel compte.
                let objet = self.depiler(nom)?;
                self.empiler(objet)
            }
            "dict" | "maxlength" | "begin" | "end" => {
                // Un seul dictionnaire : `dict` produit une marque inerte et
                // `begin`/`end` ne changent rien. Un prologue réel s'en sert,
                // refuser ici empêcherait d'ouvrir des fichiers valides.
                if nom == "dict" {
                    let _ = self.entier(nom)?;
                    self.empiler(Objet::NomLitteral("<dict>".to_string()))
                } else if nom == "maxlength" {
                    let _ = self.depiler(nom)?;
                    self.empiler(Objet::Entier(0))
                } else {
                    Ok(())
                }
            }
            // ── contrôle ────────────────────────────────────────────────
            "if" => {
                let corps = self.procedure(nom)?;
                if self.booleen(nom)? {
                    self.appeler(Objet::Procedure(corps))?;
                }
                Ok(())
            }
            "ifelse" => {
                let sinon = self.procedure(nom)?;
                let alors = self.procedure(nom)?;
                let condition = self.booleen(nom)?;
                self.appeler(if condition {
                    Objet::Procedure(alors)
                } else {
                    Objet::Procedure(sinon)
                })
            }
            "repeat" => {
                let corps = self.procedure(nom)?;
                let fois = self.entier(nom)?.clamp(0, 1_000_000);
                for _ in 0..fois {
                    self.pas += 1;
                    if self.pas > PAS_MAX {
                        return Err(ErreurPs::TropDePas { limite: PAS_MAX });
                    }
                    self.appeler(Objet::Procedure(corps.clone()))?;
                }
                Ok(())
            }
            "for" => {
                // `premier pas limite corps for` : la borne est INCLUSE, comme le
                // veut PostScript. C'est une boucle BORNÉE, donc interprétable —
                // contrairement à `loop`. L'ignorer perdrait le dessin : un corps
                // de boucle trace, presque toujours.
                let corps = self.procedure(nom)?;
                let limite = self.nombre(nom)?;
                let pas = self.nombre(nom)?;
                let premier = self.nombre(nom)?;
                if pas == 0.0 || !(premier.is_finite() && pas.is_finite() && limite.is_finite()) {
                    return Err(ErreurPs::ValeurInvalide {
                        operateur: nom.to_string(),
                    });
                }
                let mut valeur = premier;
                let mut tours = 0usize;
                while if pas > 0.0 {
                    valeur <= limite
                } else {
                    valeur >= limite
                } {
                    tours += 1;
                    if tours > 1_000_000 {
                        return Err(ErreurPs::TropDePas { limite: PAS_MAX });
                    }
                    self.empiler(Objet::Reel(valeur))?;
                    self.appeler(Objet::Procedure(corps.clone()))?;
                    valeur += pas;
                }
                Ok(())
            }
            // ── état graphique ──────────────────────────────────────────
            "gsave" | "q" => {
                let etat = self.etat();
                self.etats.push(etat);
                Ok(())
            }
            "grestore" | "Q" => {
                if self.etats.len() <= 1 {
                    return Err(ErreurPs::EmpilementDesequilibre {
                        operateur: nom.to_string(),
                    });
                }
                self.etats.pop();
                Ok(())
            }
            "grestoreall" => {
                self.etats.truncate(1);
                Ok(())
            }
            "save" => {
                let rang = self.sauvegardes.len();
                self.sauvegardes
                    .push((self.etat(), self.dictionnaire.clone()));
                self.etats_sauvegardes.push(self.etats.clone());
                self.empiler(Objet::Sauvegarde(rang))
            }
            "restore" => {
                let objet = self.depiler(nom)?;
                let Objet::Sauvegarde(rang) = objet else {
                    // Un `restore` dont l'opérande n'est pas l'objet rendu par
                    // `save` : c'est ce qui arrive quand une file d'opérandes a
                    // été laissée en désordre — un EPS mal formé, ou lu par un
                    // prologue tronqué. PostScript lèverait `typecheck`, mais
                    // arrêter toute la lecture pour cela priverait d'un dessin par
                    // ailleurs lisible. On revient donc à l'état initial, et on le
                    // DIT : ce n'est pas un silence.
                    self.avertir(format!(
                        "`restore` a reçu {objet} au lieu de l'objet rendu par `save` : retour à \
                         l'état graphique initial, et file d'opérandes vidée"
                    ));
                    self.pile.clear();
                    self.etats.truncate(1);
                    if let Some(premier) = self.etats.first_mut() {
                        *premier = EtatGraphique::default();
                    }
                    return Ok(());
                };
                let Some((etat, dictionnaire)) = self.sauvegardes.get(rang).cloned() else {
                    self.avertir(format!(
                        "`restore` fait référence à une sauvegarde {rang} qui n'existe pas : \
                         ignoré"
                    ));
                    return Ok(());
                };
                // `restore` rend au programme son état ET ses définitions,
                // comme PostScript : une définition faite entre `save` et
                // `restore` disparaît.
                self.dictionnaire = dictionnaire;
                self.etats = self
                    .etats_sauvegardes
                    .get(rang)
                    .cloned()
                    .unwrap_or_else(|| vec![etat]);
                Ok(())
            }
            // ── matrices ────────────────────────────────────────────────
            "matrix" => self.empiler(Objet::Tableau(
                Matrice::identite()
                    .0
                    .iter()
                    .map(|v| Objet::Reel(*v))
                    .collect(),
            )),
            "identmatrix" => {
                // `identmatrix` remplit une matrice passée en argument.
                let _ = self.depiler(nom)?;
                self.empiler(Objet::Tableau(
                    Matrice::identite()
                        .0
                        .iter()
                        .map(|v| Objet::Reel(*v))
                        .collect(),
                ))
            }
            "defaultmatrix" | "currentmatrix" => self.empiler(Objet::Tableau(
                self.etat()
                    .matrice
                    .0
                    .iter()
                    .map(|v| Objet::Reel(*v))
                    .collect(),
            )),
            "setmatrix" => {
                let valeurs = self.tableau(nom)?;
                let matrice = lire_matrice(&valeurs).ok_or_else(|| ErreurPs::TypeInattendu {
                    operateur: nom.to_string(),
                    recu: format!("[{} éléments]", valeurs.len()),
                })?;
                self.etat_mut().matrice = matrice;
                Ok(())
            }
            "translate" => {
                let (dy, dx) = (self.nombre(nom)?, self.nombre(nom)?);
                let etat = self.etat_mut();
                etat.matrice = Matrice::translation(dx, dy).concatener(etat.matrice);
                Ok(())
            }
            "scale" => {
                let (fy, fx) = (self.nombre(nom)?, self.nombre(nom)?);
                let etat = self.etat_mut();
                etat.matrice = Matrice::echelle(fx, fy).concatener(etat.matrice);
                Ok(())
            }
            "rotate" => {
                let angle = self.nombre(nom)?;
                let etat = self.etat_mut();
                etat.matrice = Matrice::rotation(angle).concatener(etat.matrice);
                Ok(())
            }
            // `cm` prend SIX nombres (`a b c d tx ty`) ; `concat` prend une
            // matrice. Les deux formes sont acceptées pour les deux, parce que
            // le type est lisible sur la pile et que certains producteurs les
            // confondent — mais la distinction de PostScript est rappelée ici.
            // `cm` est l'abréviation la plus employée par Illustrator.
            "cm" | "concat" => {
                let matrice = self.matrice_operande(nom)?;
                let etat = self.etat_mut();
                etat.matrice = matrice.concatener(etat.matrice);
                Ok(())
            }
            "transform" => {
                let y = self.nombre(nom)?;
                let x = self.nombre(nom)?;
                let point = self.etat().matrice.appliquer(Point::new(x, y));
                self.empiler(Objet::Reel(point.y))?;
                self.empiler(Objet::Reel(point.x))
            }
            // ── couleurs ────────────────────────────────────────────────
            "setgray" | "g" => {
                let v = self.nombre(nom)?;
                self.couleur(Couleur::Gris(v), nom)
            }
            "setrgbcolor" | "rg" | "RG" => {
                let b = self.nombre(nom)?;
                let v = self.nombre(nom)?;
                let r = self.nombre(nom)?;
                self.couleur(Couleur::Rvb(r, v, b), nom)
            }
            "setcmykcolor" | "k" | "K" => {
                let n = self.nombre(nom)?;
                let j = self.nombre(nom)?;
                let m = self.nombre(nom)?;
                let c = self.nombre(nom)?;
                self.couleur(Couleur::Cmjn(c, m, j, n), nom)
            }
            "currentgray" => {
                let v = match self.etat().couleur {
                    Couleur::Gris(v) => v,
                    autre => {
                        self.avertir(
                            "`currentgray` a été lu alors que la couleur courante n'est pas un \
                             gris : la valeur rendue est 0",
                        );
                        let _ = autre;
                        0.0
                    }
                };
                self.empiler(Objet::Reel(v))
            }
            // ── tracé ───────────────────────────────────────────────────
            "newpath" | "n" | "N" => {
                self.chemin.clear();
                self.point_courant = None;
                self.depart_sous_chemin = None;
                Ok(())
            }
            "moveto" | "m" => {
                let y = self.nombre(nom)?;
                let x = self.nombre(nom)?;
                self.chemin.push(Vec::new());
                self.positionner(x, y);
                self.depart_sous_chemin = self.point_courant;
                Ok(())
            }
            "rmoveto" => {
                let dy = self.nombre(nom)?;
                let dx = self.nombre(nom)?;
                let point = self.deplacer_relatif(dx, dy);
                self.chemin.push(Vec::new());
                self.positionner_deja(point);
                self.depart_sous_chemin = self.point_courant;
                Ok(())
            }
            "lineto" | "l" | "L" => {
                let y = self.nombre(nom)?;
                let x = self.nombre(nom)?;
                if self.point_courant.is_none() {
                    return Err(ErreurPs::CheminVide {
                        operateur: nom.to_string(),
                    });
                }
                self.positionner(x, y);
                Ok(())
            }
            "rlineto" => {
                let dy = self.nombre(nom)?;
                let dx = self.nombre(nom)?;
                if self.point_courant.is_none() {
                    return Err(ErreurPs::CheminVide {
                        operateur: nom.to_string(),
                    });
                }
                let point = self.deplacer_relatif(dx, dy);
                self.positionner_deja(point);
                Ok(())
            }
            "curveto" | "c" | "C" => {
                let y3 = self.nombre(nom)?;
                let x3 = self.nombre(nom)?;
                let y2 = self.nombre(nom)?;
                let x2 = self.nombre(nom)?;
                let y1 = self.nombre(nom)?;
                let x1 = self.nombre(nom)?;
                self.ajouter_courbe(Point::new(x1, y1), Point::new(x2, y2), Point::new(x3, y3));
                Ok(())
            }
            "rcurveto" => {
                // Le décalage est relatif au repère UTILISATEUR : sa partie
                // linéaire s'ajoute au point d'appareil courant. C'est exact, et
                // c'est ce que fait le produit — la matrice étant affine, la
                // partie constante s'annule dans la différence.
                let e3y = self.nombre(nom)?;
                let e3x = self.nombre(nom)?;
                let e2y = self.nombre(nom)?;
                let e2x = self.nombre(nom)?;
                let e1y = self.nombre(nom)?;
                let e1x = self.nombre(nom)?;
                let Some(base) = self.point_courant else {
                    return Err(ErreurPs::CheminVide {
                        operateur: nom.to_string(),
                    });
                };
                let [a, b, c, d, _, _] = self.etat().matrice.0;
                let lineaire = |dx: f64, dy: f64| Point::new(a * dx + c * dy, b * dx + d * dy);
                self.ajouter_courbe_appareil(
                    base + lineaire(e1x, e1y),
                    base + lineaire(e2x, e2y),
                    base + lineaire(e3x, e3y),
                );
                Ok(())
            }
            "v" => {
                // `v` : premier point de contrôle = point courant.
                let y3 = self.nombre(nom)?;
                let x3 = self.nombre(nom)?;
                let y2 = self.nombre(nom)?;
                let x2 = self.nombre(nom)?;
                let courant = self.point_courant.unwrap_or(Point::new(x2, y2));
                self.ajouter_courbe(courant, Point::new(x2, y2), Point::new(x3, y3));
                Ok(())
            }
            "y" => {
                // `y` : second point de contrôle = point d'arrivée.
                let y3 = self.nombre(nom)?;
                let x3 = self.nombre(nom)?;
                let y2 = self.nombre(nom)?;
                let x2 = self.nombre(nom)?;
                self.ajouter_courbe(Point::new(x2, y2), Point::new(x3, y3), Point::new(x3, y3));
                Ok(())
            }
            "closepath" | "h" | "H" => {
                if let (Some(debut), Some(courant)) = (self.depart_sous_chemin, self.point_courant)
                {
                    if debut != courant {
                        if let Some(sous_chemin) = self.chemin.last_mut() {
                            sous_chemin.push(debut);
                        }
                    }
                    self.point_courant = Some(debut);
                }
                Ok(())
            }
            "re" | "rect" => {
                // `x y largeur hauteur re` : un RECTANGLE. Le fermer est le fait
                // du chemin, pas du programme : aucun arrondi n'est en jeu, et
                // l'aire reste exacte.
                let hauteur = self.nombre(nom)?;
                let largeur = self.nombre(nom)?;
                let y = self.nombre(nom)?;
                let x = self.nombre(nom)?;
                let matrice = self.etat().matrice;
                let coins = [
                    Point::new(x, y),
                    Point::new(x + largeur, y),
                    Point::new(x + largeur, y + hauteur),
                    Point::new(x, y + hauteur),
                ];
                let points: Vec<Point> = coins.iter().map(|c| matrice.appliquer(*c)).collect();
                let depart = points[0];
                // Le sous-chemin est **fermé** : le premier point est répété en
                // fin, comme le fait `closepath`. C'est ce qu'un moteur de rendu
                // attend pour tracer le quatrième côté, et c'est aussi ce qui
                // rend `re` comparable à `moveto` + trois `lineto` + `closepath`.
                let mut points = points;
                points.push(depart);
                self.chemin.push(points);
                self.point_courant = Some(depart);
                self.depart_sous_chemin = Some(depart);
                Ok(())
            }
            "arc" | "arcn" => {
                let fin = self.nombre(nom)?;
                let debut = self.nombre(nom)?;
                let rayon = self.nombre(nom)?;
                let y = self.nombre(nom)?;
                let x = self.nombre(nom)?;
                let centre = Point::new(x, y);
                let sens_direct = nom == "arc";
                // PostScript relie le point courant au début de l'arc par une
                // DROITE : sans cela, un `arc` qui suit un `moveto` lointain
                // laisserait un trou dans le chemin.
                let a0 = debut.to_radians();
                let depart = self
                    .etat()
                    .matrice
                    .appliquer(centre + Point::new(a0.cos(), a0.sin()) * rayon);
                match self.point_courant {
                    None => {
                        self.chemin.push(Vec::new());
                        self.positionner_deja(depart);
                    }
                    Some(courant) if courant != depart => self.positionner_deja(depart),
                    _ => {}
                }
                self.arc(centre, rayon, debut, fin, sens_direct);
                Ok(())
            }
            // ── peinture ────────────────────────────────────────────────
            "fill" | "f" | "F" => self.peindre(Peinture::Rempli),
            "eofill" | "f*" => self.peindre(Peinture::RempliPairImpair),
            // `b`/`B` (niveau 2) : remplir **puis** tracer. Deux peintures pour un
            // seul chemin, et non deux chemins : la géométrie est mise de côté et
            // rejouée. `b` ferme le chemin d'abord, `B` non ; l'astérisque choisit
            // la règle pair-impair, comme pour `f*`.
            "b" | "B" | "b*" | "B*" => {
                if nom.starts_with('b') {
                    if let (Some(debut), Some(courant)) =
                        (self.depart_sous_chemin, self.point_courant)
                    {
                        if debut != courant {
                            if let Some(sous_chemin) = self.chemin.last_mut() {
                                sous_chemin.push(debut);
                            }
                        }
                        self.point_courant = Some(debut);
                    }
                }
                let epaisseur = self.etat().epaisseur.abs().max(1e-6);
                let chemin = self.chemin.clone();
                let depart = self.depart_sous_chemin;
                let courant = self.point_courant;
                self.peindre(if nom.ends_with('*') {
                    Peinture::RempliPairImpair
                } else {
                    Peinture::Rempli
                })?;
                self.chemin = chemin;
                self.depart_sous_chemin = depart;
                self.point_courant = courant;
                self.peindre(Peinture::Contour { epaisseur })
            }
            "stroke" | "S" => {
                let epaisseur = self.etat().epaisseur.abs().max(1e-6);
                self.peindre(Peinture::Contour { epaisseur })
            }
            "clip" | "W" => self.peindre(Peinture::Tronque),
            "eoclip" | "W*" => self.peindre(Peinture::Tronque),
            "showpage" => {
                self.pages += 1;
                Ok(())
            }
            "erasepage" => {
                self.avertir(
                    "`erasepage` est ignoré : effacer la page n'a pas de sens dans un import",
                );
                Ok(())
            }
            // ── attributs de trait, acceptés sans effet sur la géométrie ──
            "setlinewidth" | "w" => {
                let v = self.nombre(nom)?;
                self.etat_mut().epaisseur = v;
                Ok(())
            }
            "setmiterlimit" | "M" | "setlinecap" | "J" | "setlinejoin" | "j" => {
                let _ = self.nombre(nom)?;
                Ok(())
            }
            "setflat" => {
                let v = self.nombre(nom)?;
                self.etat_mut().planeite = v;
                Ok(())
            }
            "setdash" | "d" => {
                let _decalage = self.nombre(nom)?;
                let _motif = self.tableau(nom)?;
                Ok(())
            }
            // ── opérateurs connus et REFUSÉS ────────────────────────────
            autre => match refus_connu(autre) {
                Some(raison) => Err(ErreurPs::OperateurNonSupporte {
                    nom: autre.to_string(),
                    raison: raison.to_string(),
                }),
                None => {
                    self.signaler_inconnu(autre);
                    Ok(())
                }
            },
        }
    }

    /// Lit une matrice sur la pile, en acceptant les deux formes : un tableau
    /// `[a b c d tx ty]` (forme de `concat`) ou six nombres (forme de `cm`).
    fn matrice_operande(&mut self, nom: &str) -> Result<Matrice, ErreurPs> {
        if matches!(self.pile.last(), Some(Objet::Tableau(_))) {
            let valeurs = self.tableau(nom)?;
            return lire_matrice(&valeurs).ok_or_else(|| ErreurPs::TypeInattendu {
                operateur: nom.to_string(),
                recu: format!("[{} éléments]", valeurs.len()),
            });
        }
        let ty = self.nombre(nom)?;
        let tx = self.nombre(nom)?;
        let d = self.nombre(nom)?;
        let c = self.nombre(nom)?;
        let b = self.nombre(nom)?;
        let a = self.nombre(nom)?;
        let matrice = Matrice([a, b, c, d, tx, ty]);
        if !matrice.est_finie() {
            return Err(ErreurPs::ValeurInvalide {
                operateur: nom.to_string(),
            });
        }
        Ok(matrice)
    }

    /// Positionne un point DÉJÀ en coordonnées d'appareil.
    fn positionner_deja(&mut self, point: Point) {
        match self.chemin.last_mut() {
            Some(sous_chemin) => sous_chemin.push(point),
            None => self.chemin.push(vec![point]),
        }
        self.point_courant = Some(point);
    }

    /// Le point courant décalé d'un delta exprimé dans le repère **utilisateur**.
    ///
    /// La matrice est affine : appliquer un déplacement utilisateur revient à
    /// ajouter sa partie linéaire au point d'appareil. C'est exact, et cela
    /// évite de garder deux points courants (utilisateur et appareil) dont la
    /// désynchronisation serait une source de fautes silencieuses.
    fn deplacer_relatif(&self, dx: f64, dy: f64) -> Point {
        let base = self.point_courant.unwrap_or_else(Point::origine);
        let [a, b, c, d, _, _] = self.etat().matrice.0;
        Point::new(base.x + a * dx + c * dy, base.y + b * dx + d * dy)
    }

    fn couleur(&mut self, couleur: Couleur, operateur: &str) -> Result<(), ErreurPs> {
        if !couleur.composantes().iter().all(|v| v.is_finite()) {
            return Err(ErreurPs::ValeurInvalide {
                operateur: operateur.to_string(),
            });
        }
        self.etat_mut().couleur = couleur;
        Ok(())
    }

    fn verifier_nombre(&self, operateur: &str, valeur: f64) -> Result<(), ErreurPs> {
        if valeur.is_finite() {
            Ok(())
        } else {
            Err(ErreurPs::ValeurInvalide {
                operateur: operateur.to_string(),
            })
        }
    }

    /// Termine l'interprétation et rend les valeurs.
    pub fn terminer(self) -> Valeurs {
        Valeurs {
            dessins: self.dessins,
            operateurs: {
                let mut liste: Vec<String> = self.operateurs.into_iter().collect();
                liste.sort();
                liste
            },
            inconnus: {
                let mut liste = self.inconnus;
                liste.sort();
                liste.dedup();
                liste
            },
            blocs_ignores: self.blocs_ignores,
            pages: self.pages,
            avertissements: self.avertissements,
        }
    }
}

/// Lit six nombres dans un tableau, pour en faire une matrice.
fn lire_matrice(valeurs: &[Objet]) -> Option<Matrice> {
    // PostScript accepte `[a b c d tx ty]` et la forme courte `[a b c d]`
    // (translation nulle).
    let nombres: Vec<f64> = valeurs.iter().filter_map(Objet::comme_nombre).collect();
    match nombres.len() {
        6 => {
            let mut m = [0.0; 6];
            for (i, v) in nombres.iter().enumerate() {
                if !v.is_finite() {
                    return None;
                }
                m[i] = *v;
            }
            Some(Matrice(m))
        }
        _ => None,
    }
}

/// L'opérateur est-il connu du sous-ensemble (pour `load`, `known`, `where`) ?
#[must_use]
pub fn superprint_ps_operateur_connu(nom: &str) -> bool {
    mon_operateur(nom) || refus_connu(nom).is_some()
}

/// L'opérateur est-il **interprété** par la machine ?
#[must_use]
pub fn mon_operateur(nom: &str) -> bool {
    OPERATEURS_CONNUS.contains(&nom)
}

/// Les opérateurs que la machine sait exécuter.
pub const OPERATEURS_CONNUS: &[&str] = &[
    "dup",
    "exch",
    "pop",
    "clear",
    "count",
    "copy",
    "index",
    "roll",
    "mark",
    "cleartomark",
    "counttomark",
    "add",
    "sub",
    "mul",
    "div",
    "idiv",
    "mod",
    "atan",
    "exp",
    "neg",
    "abs",
    "sqrt",
    "sin",
    "cos",
    "ln",
    "log",
    "ceiling",
    "floor",
    "round",
    "truncate",
    "eq",
    "ne",
    "gt",
    "lt",
    "ge",
    "le",
    "and",
    "or",
    "xor",
    "not",
    "cvi",
    "cvr",
    "def",
    "load",
    "known",
    "where",
    "bind",
    "b",
    "B",
    "b*",
    "B*",
    "exec",
    "cvx",
    "cvlit",
    "dict",
    "maxlength",
    "begin",
    "end",
    "if",
    "ifelse",
    "repeat",
    "for",
    "gsave",
    "q",
    "grestore",
    "Q",
    "grestoreall",
    "save",
    "restore",
    "matrix",
    "identmatrix",
    "defaultmatrix",
    "currentmatrix",
    "setmatrix",
    "translate",
    "scale",
    "rotate",
    "concat",
    "cm",
    "transform",
    "setgray",
    "g",
    "setrgbcolor",
    "rg",
    "RG",
    "setcmykcolor",
    "k",
    "K",
    "currentgray",
    "newpath",
    "n",
    "N",
    "moveto",
    "m",
    "M",
    "rmoveto",
    "lineto",
    "l",
    "L",
    "rlineto",
    "curveto",
    "c",
    "C",
    "v",
    "y",
    "rcurveto",
    "closepath",
    "h",
    "H",
    "re",
    "rect",
    "arc",
    "arcn",
    "fill",
    "f",
    "F",
    "eofill",
    "f*",
    "stroke",
    "S",
    "clip",
    "W",
    "eoclip",
    "W*",
    "showpage",
    "erasepage",
    "setlinewidth",
    "w",
    "setmiterlimit",
    "setlinecap",
    "J",
    "setlinejoin",
    "j",
    "setflat",
    "setdash",
    "d",
    // Extension Illustrator : `/GS0 gs` applique un état graphique nommé.
    "gs",
];

/// Les opérateurs **refusés**, avec la raison, écrite pour être lue.
///
/// Un refus nommé vaut mieux qu'un silence : un import qui laisse tomber les
/// libellés d'un logo rend un dessin faux qui a l'air juste.
#[must_use]
pub fn refus_connu(nom: &str) -> Option<&'static str> {
    match nom {
        "show" | "ashow" | "awidthshow" | "widthshow" | "kshow" | "xshow" | "yshow" | "xyshow"
        | "glyphshow" | "charpath" => Some(
            "le texte n'est pas interprété : il demanderait la police, le corps et les \
             approches, c'est-à-dire un moteur de composition de plus. L'ignorer rendrait un \
             dessin amputé de ses libellés, en silence",
        ),
        "image" | "imagemask" | "colorimage" | "imagebytes" => {
            Some("les images bitmap ne sont pas interprétées dans un EPS")
        }
        "forall" => Some("`forall` (itération sur un tableau) n'est pas interprété"),
        "loop" | "exit" => Some("les boucles sans compteur ne sont pas interprétées"),
        "stopped" | "stop" => Some("la gestion d'erreur du programme n'est pas interprétée"),
        "run" => Some("`run` (charger un autre fichier) n'est pas interprété"),
        "arct" | "arcto" => {
            Some("`arct`/`arcto` (arc tangent à deux droites) n'est pas interprété")
        }
        "pathforall" => Some("`pathforall` n'est pas interprété"),
        "setcolor" | "setcolorspace" => {
            Some("le changement d'espace colorimétrique n'est pas interprété")
        }
        "definefont" | "selectfont" | "scalefont" | "setfont" | "findfont" => {
            Some("les polices ne sont pas interprétées")
        }
        "setcachedevice" | "setcharwidth" => Some("les glyphes de police ne sont pas interprétés"),
        "filenameforall" | "file" | "write" | "read" | "closefile" => {
            Some("les entrées-sorties de fichier sont refusées")
        }
        "usertime" | "realtime" | "date" | "time" => {
            Some("l'horloge n'est pas accessible : le résultat doit être déterministe")
        }
        "vmstatus" | "setvmthreshold" | "vmreclaim" => Some("la gestion mémoire est refusée"),
        "setpagedevice" | "nulldevice" => Some("les paramètres d'appareil ne sont pas interprétés"),
        "level1" | "languagelevel" | "product" | "version" | "revision" => {
            Some("les renseignements d'implémentation ne sont pas interprétés")
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::lexeur;

    fn machine() -> Machine {
        Machine::nouvelle(0.05)
    }

    fn executer(source: &str) -> Result<Valeurs, ErreurPs> {
        let objets = lexeur::analyser(source).expect("lexage");
        let mut m = Machine::nouvelle(0.05);
        m.executer(&objets)?;
        Ok(m.terminer())
    }

    #[test]
    fn arithmetique_sur_la_pile() {
        let valeurs = executer("1 2 add").unwrap();
        assert!(valeurs.dessins.is_empty());
        let mut m = machine();
        m.executer(&lexeur::analyser("1 2 add").unwrap()).unwrap();
        assert_eq!(m.pile.last(), Some(&Objet::Reel(3.0)));
        m.executer(&lexeur::analyser("dup mul").unwrap()).unwrap();
        assert_eq!(m.pile.last(), Some(&Objet::Reel(9.0)));
    }

    #[test]
    fn division_par_zero_refusee() {
        assert_eq!(executer("1 0 div").unwrap_err(), ErreurPs::DivisionParZero);
        assert_eq!(executer("1 0 mod").unwrap_err(), ErreurPs::DivisionParZero);
        assert_eq!(executer("1 0 idiv").unwrap_err(), ErreurPs::DivisionParZero);
    }

    #[test]
    fn prologue_alias_puis_rectangle() {
        let valeurs = executer(
            "/m /moveto load def /l /lineto load def /h /closepath load def /f /fill load def\n\
             0 0 0 1 k\nnewpath 10 10 m 90 10 l 90 50 l 10 50 l h f",
        )
        .unwrap();
        assert_eq!(valeurs.dessins.len(), 1);
        let dessin = &valeurs.dessins[0];
        assert_eq!(dessin.peinture, Peinture::Rempli);
        assert_eq!(dessin.couleur, Couleur::Cmjn(0.0, 0.0, 0.0, 1.0));
        assert_eq!(
            dessin.nombre_de_sommets(),
            5,
            "quatre coins plus la fermeture"
        );
        let (min, max) = dessin.boite().unwrap();
        assert_eq!(min, Point::new(10.0, 10.0));
        assert_eq!(max, Point::new(90.0, 50.0));
        assert!(
            (dessin.aire() - 3200.0).abs() < 1e-9,
            "aire {}",
            dessin.aire()
        );
    }

    #[test]
    fn transformation_appliquee_aux_points() {
        let valeurs =
            executer("newpath 2 2 scale 0 0 moveto 10 0 lineto 10 10 lineto closepath fill")
                .unwrap();
        let (min, max) = valeurs.dessins[0].boite().unwrap();
        assert_eq!(min, Point::new(0.0, 0.0));
        assert_eq!(max, Point::new(20.0, 20.0));
    }

    #[test]
    fn cm_prend_six_nombres() {
        // `1 0 0 1 10 10 cm` : la forme employée par Illustrator. Un point (1,1)
        // doit donner (11,11).
        let valeurs =
            executer("newpath 1 0 0 1 10 10 cm 1 1 moveto 2 1 lineto closepath fill").unwrap();
        let (min, max) = valeurs.dessins[0].boite().unwrap();
        assert_eq!(min, Point::new(11.0, 11.0));
        assert_eq!(max, Point::new(12.0, 11.0));
    }

    #[test]
    fn concat_accepte_une_matrice() {
        // `concat` prend un TABLEAU ; les deux formes sont acceptées, mais la
        // valeur doit être la même.
        let nombres =
            executer("newpath 1 0 0 1 10 10 cm 0 0 moveto 1 0 lineto closepath fill").unwrap();
        let tableau =
            executer("newpath [1 0 0 1 10 10] concat 0 0 moveto 1 0 lineto closepath fill")
                .unwrap();
        assert_eq!(
            nombres.dessins[0].sous_chemins,
            tableau.dessins[0].sous_chemins
        );
        assert_eq!(
            tableau.dessins[0].boite().unwrap().0,
            Point::new(10.0, 10.0)
        );
    }

    #[test]
    fn cm_imbrique_comme_le_programme_l_ecrit() {
        // `1 0 0 1 10 10 cm` puis `1 0 0 1 5 5 cm` : (0,0) → (15,15).
        let valeurs = executer(
            "newpath 1 0 0 1 10 10 cm 1 0 0 1 5 5 cm 0 0 moveto 1 0 lineto closepath fill",
        )
        .unwrap();
        assert_eq!(
            valeurs.dessins[0].boite().unwrap().0,
            Point::new(15.0, 15.0)
        );
    }

    #[test]
    fn translation_puis_echelle_dans_l_ordre_du_programme() {
        // `10 10 translate 2 2 scale` : (1,1) → (12,12).
        let valeurs =
            executer("newpath 10 10 translate 2 2 scale 1 1 moveto 2 1 lineto closepath fill")
                .unwrap();
        let (min, max) = valeurs.dessins[0].boite().unwrap();
        assert_eq!(min, Point::new(12.0, 12.0));
        assert_eq!(max, Point::new(14.0, 12.0));
    }

    #[test]
    fn gsave_et_grestore_restaurent_la_matrice() {
        let valeurs = executer(
            "newpath 0 0 moveto 10 0 lineto closepath fill \
             gsave 100 100 translate newpath 0 0 moveto 10 0 lineto closepath fill grestore \
             newpath 0 0 moveto 10 0 lineto closepath fill",
        )
        .unwrap();
        assert_eq!(valeurs.dessins.len(), 3);
        assert_eq!(valeurs.dessins[0].boite().unwrap().0, Point::new(0.0, 0.0));
        assert_eq!(
            valeurs.dessins[1].boite().unwrap().0,
            Point::new(100.0, 100.0)
        );
        assert_eq!(valeurs.dessins[2].boite().unwrap().0, Point::new(0.0, 0.0));
    }

    #[test]
    fn grestore_sans_gsave_refuse() {
        assert_eq!(
            executer("grestore").unwrap_err(),
            ErreurPs::EmpilementDesequilibre {
                operateur: "grestore".to_string()
            }
        );
    }

    #[test]
    fn courbe_aplatie_en_polyligne() {
        let valeurs = executer("newpath 0 0 moveto 0 100 100 100 100 0 curveto stroke").unwrap();
        let dessin = &valeurs.dessins[0];
        assert!(
            dessin.nombre_de_sommets() > 4,
            "la courbe doit être décomposée"
        );
        assert!(matches!(dessin.peinture, Peinture::Contour { .. }));
        let (_, max) = dessin.boite().unwrap();
        // La cubique symétrique culmine à 75, jamais à 100.
        assert!((max.y - 75.0).abs() < 0.2, "hauteur {}", max.y);
    }

    #[test]
    fn courbe_v_et_y() {
        // `v` et `y` ont la même signature apparente `x1 y1 x2 y2`, mais les
        // points se règlent différemment : `v` coïncide le PREMIER point de
        // contrôle avec le point courant, `y` coïncide le SECOND avec
        // l'arrivée. Les deux courbes symétriques ci-dessous culminent donc à la
        // même hauteur, 150·(4/27) = 22,22 — ce qui est un contrôle utile : une
        // confusion entre les deux se verrait tout de suite.
        let valeurs = executer("newpath 0 0 moveto 50 50 100 0 v stroke").unwrap();
        assert!(valeurs.dessins[0].nombre_de_sommets() > 3);
        let (_, max) = valeurs.dessins[0].boite().unwrap();
        assert!((max.y - 22.222).abs() < 0.05, "hauteur {}", max.y);
        assert_eq!(max.x, 100.0);

        let valeurs = executer("newpath 0 0 moveto 50 50 100 0 y stroke").unwrap();
        assert!(valeurs.dessins[0].nombre_de_sommets() > 3);
        let (_, max) = valeurs.dessins[0].boite().unwrap();
        assert!((max.y - 22.222).abs() < 0.05, "hauteur {}", max.y);
        assert_eq!(max.x, 100.0);
    }

    #[test]
    fn rectangle_re() {
        let valeurs = executer("newpath 10 20 100 50 re fill").unwrap();
        let dessin = &valeurs.dessins[0];
        assert_eq!(
            dessin.nombre_de_sommets(),
            5,
            "quatre coins plus la fermeture"
        );
        let (min, max) = dessin.boite().unwrap();
        assert_eq!(min, Point::new(10.0, 20.0));
        assert_eq!(max, Point::new(110.0, 70.0));
        assert!(
            (dessin.aire() - 5000.0).abs() < 1e-9,
            "aire {}",
            dessin.aire()
        );
    }

    #[test]
    fn rectangle_sous_transformation() {
        // `re` passe par la matrice comme les autres opérateurs : un rectangle
        // dans un repère mis à l'échelle doit grandir.
        let valeurs = executer("newpath 2 2 scale 0 0 10 5 re fill").unwrap();
        let (min, max) = valeurs.dessins[0].boite().unwrap();
        assert_eq!(min, Point::new(0.0, 0.0));
        assert_eq!(max, Point::new(20.0, 10.0));
        assert!((valeurs.dessins[0].aire() - 200.0).abs() < 1e-9);
    }

    #[test]
    fn courbe_relative_revient_au_meme_point() {
        // `0 0 moveto 0 0 90 90 curveto` et `0 0 moveto 0 0 90 90 rcurveto`
        // doivent donner exactement la même courbe : le repère est l'identité.
        let absolu = executer("newpath 0 0 moveto 0 50 50 90 90 90 curveto stroke").unwrap();
        let relatif = executer("newpath 0 0 moveto 0 50 50 90 90 90 rcurveto stroke").unwrap();
        assert_eq!(
            absolu.dessins[0].sous_chemins,
            relatif.dessins[0].sous_chemins
        );
    }

    #[test]
    fn courbe_relative_sous_transformation() {
        // Avec un décalage, le relatif part du point courant transformé : le
        // décalage (50, 0) reste un décalage de 50 dans les deux repères.
        let valeurs =
            executer("newpath 100 100 translate 0 0 moveto 50 0 50 0 50 0 rcurveto stroke")
                .unwrap();
        let (min, max) = valeurs.dessins[0].boite().unwrap();
        assert_eq!(min, Point::new(100.0, 100.0));
        assert_eq!(max, Point::new(150.0, 100.0));
    }

    #[test]
    fn courbe_relative_sous_echelle() {
        // Sous une mise à l'échelle 2, un décalage de 50 en devient 100 : c'est
        // ce qui distingue un déplacement relatif utilisateur d'un déplacement
        // d'appareil, et c'est la faute qu'on veut interdire.
        let valeurs =
            executer("newpath 2 2 scale 0 0 moveto 50 0 50 0 50 0 rcurveto stroke").unwrap();
        let (min, max) = valeurs.dessins[0].boite().unwrap();
        assert_eq!(min, Point::new(0.0, 0.0));
        assert_eq!(max, Point::new(100.0, 0.0));
    }

    #[test]
    fn arc_remplace_par_des_beziers() {
        let valeurs = executer("newpath 50 50 40 0 360 arc closepath fill").unwrap();
        let dessin = &valeurs.dessins[0];
        assert!(
            dessin.nombre_de_sommets() > 20,
            "points {}",
            dessin.nombre_de_sommets()
        );
        let (min, max) = dessin.boite().unwrap();
        // Un cercle de rayon 40 centré en (50,50) : de 10 à 90.
        assert!((min.x - 10.0).abs() < 0.1, "min.x {}", min.x);
        assert!((max.x - 90.0).abs() < 0.1, "max.x {}", max.x);
        assert!((min.y - 10.0).abs() < 0.1);
        assert!((max.y - 90.0).abs() < 0.1);
        // L'aire d'un disque de rayon 40 vaut 5026,5.
        let aire = dessin.aire().abs();
        assert!(
            (aire - std::f64::consts::PI * 1600.0).abs() / (std::f64::consts::PI * 1600.0) < 0.01,
            "aire {aire}"
        );
    }

    #[test]
    fn arc_en_sens_inverse() {
        let valeurs = executer("newpath 50 50 40 0 90 arcn stroke").unwrap();
        assert!(valeurs.dessins[0].nombre_de_sommets() > 2);
    }

    #[test]
    fn couleurs() {
        let valeurs = executer(
            "newpath 0 0 moveto 1 0 lineto 1 1 lineto closepath 0.5 setgray fill \
             newpath 0 0 moveto 1 0 lineto 1 1 lineto closepath 1 0 0 setrgbcolor fill \
             newpath 0 0 moveto 1 0 lineto 1 1 lineto closepath 1 0 0 0 setcmykcolor fill",
        )
        .unwrap();
        assert_eq!(valeurs.dessins[0].couleur, Couleur::Gris(0.5));
        assert_eq!(valeurs.dessins[1].couleur, Couleur::Rvb(1.0, 0.0, 0.0));
        assert_eq!(
            valeurs.dessins[2].couleur,
            Couleur::Cmjn(1.0, 0.0, 0.0, 0.0)
        );
    }

    #[test]
    fn remplissage_pair_impair() {
        let valeurs =
            executer("newpath 0 0 moveto 10 0 lineto 10 10 lineto closepath eofill").unwrap();
        assert_eq!(valeurs.dessins[0].peinture, Peinture::RempliPairImpair);
    }

    #[test]
    fn clips_enregistre_avec_un_avertissement() {
        let valeurs = executer(
            "newpath 0 0 moveto 10 0 lineto 10 10 lineto closepath clip \
             newpath 0 0 moveto 5 0 lineto 5 5 lineto closepath fill",
        )
        .unwrap();
        assert_eq!(valeurs.dessins.len(), 2);
        assert_eq!(valeurs.dessins[0].peinture, Peinture::Tronque);
        assert_eq!(valeurs.avertissements.len(), 1);
        assert!(valeurs.avertissements[0].contains("clip"));
    }

    #[test]
    fn contour_vide_refuse() {
        assert_eq!(
            executer("fill").unwrap_err(),
            ErreurPs::CheminVide {
                operateur: "remplissage".to_string()
            }
        );
        assert_eq!(
            executer("stroke").unwrap_err(),
            ErreurPs::CheminVide {
                operateur: "contour".to_string()
            }
        );
    }

    #[test]
    fn lineto_sans_moveto_refuse() {
        assert!(matches!(
            executer("newpath 10 10 lineto").unwrap_err(),
            ErreurPs::CheminVide { .. }
        ));
    }

    #[test]
    fn texte_refuse_nomme() {
        let erreur = executer("(Bonjour) show").unwrap_err();
        match erreur {
            ErreurPs::OperateurNonSupporte { nom, raison } => {
                assert_eq!(nom, "show");
                assert!(raison.contains("texte"));
            }
            autre => panic!("attendu un refus nommé, obtenu {autre:?}"),
        }
    }

    #[test]
    fn images_refusees_nommees() {
        assert!(matches!(
            executer("image").unwrap_err(),
            ErreurPs::OperateurNonSupporte { nom, .. } if nom == "image"
        ));
        assert!(matches!(
            executer("imagemask").unwrap_err(),
            ErreurPs::OperateurNonSupporte { .. }
        ));
    }

    #[test]
    fn operateur_inconnu_signale_et_non_fatal() {
        // Un nom inconnu ne doit PAS arrêter la lecture : un EPS réel arrive
        // avec un prologue tronqué. Mais il doit être relevé, nommément.
        let valeurs = executer("zorglub newpath 0 0 moveto 10 0 lineto closepath fill").unwrap();
        assert_eq!(
            valeurs.dessins.len(),
            1,
            "le dessin doit être lu malgré l'inconnu"
        );
        assert_eq!(valeurs.inconnus, vec!["zorglub".to_string()]);
        assert!(valeurs.avertissements.iter().any(|a| a.contains("zorglub")));
    }

    #[test]
    fn marqueur_d_etat_illustrator_gs() {
        // `/GS0 gs` : le nom est dépilé, et il ne reste rien. Sans cela, le
        // témoin `eps-illustrator.eps` serait illisible.
        let mut m = machine();
        m.executer(&lexeur::analyser("/GS0 gs").unwrap()).unwrap();
        assert!(m.pile.is_empty(), "la pile doit être vide : {:?}", m.pile);
        assert!(m.terminer().inconnus.is_empty());
    }

    #[test]
    fn boucles_sans_compteur_refusees() {
        assert!(matches!(
            executer("{} loop").unwrap_err(),
            ErreurPs::OperateurNonSupporte { nom, .. } if nom == "loop"
        ));
        assert!(matches!(
            executer("[] {} forall").unwrap_err(),
            ErreurPs::OperateurNonSupporte { nom, .. } if nom == "forall"
        ));
    }

    #[test]
    fn horloge_refusee() {
        assert!(matches!(
            executer("usertime").unwrap_err(),
            ErreurPs::OperateurNonSupporte { .. }
        ));
    }

    #[test]
    fn pile_insuffisante_nommee() {
        assert_eq!(
            executer("add").unwrap_err(),
            ErreurPs::PileInsuffisante {
                operateur: "add".to_string()
            }
        );
        assert_eq!(
            executer("dup").unwrap_err(),
            ErreurPs::PileInsuffisante {
                operateur: "dup".to_string()
            }
        );
    }

    #[test]
    fn boucle_infinie_bornee_par_les_pas() {
        // Une procédure qui s'appelle elle-même : le garde-fou de profondeur
        // doit la refuser.
        let source = "/f { f } def f";
        let erreur = executer(source).unwrap_err();
        assert_eq!(erreur, ErreurPs::TropProfond { limite: APPELS_MAX });
    }

    #[test]
    fn condition_if_et_ifelse() {
        let valeurs = executer(
            "newpath true { 0 0 moveto 10 0 lineto closepath fill } if \
             newpath false { 0 0 moveto 1 0 lineto closepath fill } { 0 0 moveto 2 0 lineto 2 2 lineto closepath fill } ifelse",
        )
        .unwrap();
        assert_eq!(valeurs.dessins.len(), 2);
        assert_eq!(valeurs.dessins[1].nombre_de_sommets(), 4);
    }

    #[test]
    fn repeat_trois_fois() {
        let valeurs =
            executer("3 { newpath 0 0 moveto 1 0 lineto 1 1 lineto closepath fill } repeat")
                .unwrap();
        assert_eq!(valeurs.dessins.len(), 3);
    }

    #[test]
    fn boucle_for_bornee() {
        // Quatre carrés, pour un compteur de 0 à 3 pas 1.
        let valeurs =
            executer("0 1 3 { newpath 0 0 moveto 10 0 lineto closepath fill } for").unwrap();
        assert_eq!(valeurs.dessins.len(), 4);
        // La borne est INCLUSE : c'est ce qui distingue `for` de la plupart des
        // boucles d'autres langages.
        let valeurs = executer("0 1 0 { } for").unwrap();
        assert!(valeurs.dessins.is_empty());
    }

    #[test]
    fn for_avec_un_pas_nul_refuse() {
        assert!(matches!(
            executer("0 0 10 { } for").unwrap_err(),
            ErreurPs::ValeurInvalide { .. }
        ));
    }

    #[test]
    fn for_descendant() {
        let valeurs =
            executer("3 -1 0 { newpath 0 0 moveto 1 0 lineto closepath fill } for").unwrap();
        assert_eq!(valeurs.dessins.len(), 4);
    }

    #[test]
    fn save_et_restore_rendent_le_dictionnaire() {
        let valeurs = executer(
            "/x 1 def save /x 2 def restore x \
             newpath x 0 moveto 10 0 lineto 10 1 lineto closepath fill",
        )
        .unwrap();
        // `x` doit valoir 1 après `restore` : la barre fait 1 de haut.
        let (min, max) = valeurs.dessins[0].boite().unwrap();
        assert_eq!(min.x, 1.0);
        assert_eq!(max.y, 1.0);
    }

    #[test]
    fn operateurs_utilises_releves() {
        let valeurs = executer("newpath 0 0 moveto 1 0 lineto closepath fill").unwrap();
        assert!(valeurs.operateurs.contains(&"moveto".to_string()));
        assert!(valeurs.operateurs.contains(&"fill".to_string()));
        assert!(valeurs.operateurs.contains(&"newpath".to_string()));
        // Et la liste est triée, donc comparable d'une exécution à l'autre.
        let mut triee = valeurs.operateurs.clone();
        triee.sort();
        assert_eq!(valeurs.operateurs, triee);
    }

    #[test]
    fn showpage_compte() {
        let valeurs = executer("showpage showpage").unwrap();
        assert_eq!(valeurs.pages, 2);
    }

    #[test]
    fn toutes_les_abreviations_sont_dans_la_liste() {
        // Les abréviations qu'un EPS réel emploie. Cette liste est écrite d'après
        // la table d'abréviations de PostScript, **pas** recopiée de la constante :
        // c'est ce qui rend le contrôle utile. `q` et `Q` (save/restore d'état
        // d'Illustrator) ont été oubliés une fois, et c'est ce témoin — un vrai
        // fichier Illustrator — qui l'a montré.
        let abreviations = [
            "m", "M", "l", "L", "c", "C", "v", "y", "h", "H", "n", "N", "S", "f", "F", "W", "d",
            "j", "J", "k", "K", "w", "q", "Q", "re", "gs", "f*", "W*", "b", "B", "b*", "B*",
        ];
        // NOTER : `s` n'y est pas, et c'est délibéré. La spécification le donne
        // pour `scale`, le produit le lit comme `stroke` (`sp-eps-import.js`,
        // ligne 643). Deviner reviendrait, dans un cas sur deux, à changer la
        // géométrie en silence. Le noyau ne devine pas : il le signale.
        for nom in abreviations {
            assert!(
                mon_operateur(nom),
                "l'abréviation « {nom} » est exécutée par la machine mais absente de \
                 OPERATEURS_CONNUS : elle serait signalée « inconnue » sur un vrai fichier"
            );
        }
    }

    #[test]
    fn operateurs_connus_et_refuses_sont_disjoints() {
        for nom in OPERATEURS_CONNUS {
            assert!(
                refus_connu(nom).is_none(),
                "« {nom} » est à la fois exécuté et refusé"
            );
        }
        assert!(superprint_ps_operateur_connu("moveto"));
        assert!(superprint_ps_operateur_connu("show"));
        assert!(!superprint_ps_operateur_connu("zorglub"));
    }

    #[test]
    fn load_et_def_avec_un_operateur() {
        let mut m = machine();
        m.executer(&lexeur::analyser("/mv /moveto load def").unwrap())
            .unwrap();
        assert!(matches!(
            m.dictionnaire.get("mv"),
            Some(Objet::Operateur(nom)) if nom == "moveto"
        ));
    }

    #[test]
    fn load_d_un_operateur_inconnu_est_releve() {
        // Un alias perdu (`/x /zorglub load def`) ne doit pas faire échouer tout
        // le fichier, mais il doit être nommé.
        let valeurs = executer("/x /zorglub load def x").unwrap();
        assert_eq!(valeurs.inconnus, vec!["zorglub".to_string()]);
    }

    #[test]
    fn load_d_un_operateur_connu_mais_refuse_marche_quand_meme() {
        // `load` d'un refus nommé reste possible : c'est l'EXÉCUTION qui refuse,
        // et elle refusera en découvrant le nom.
        let erreur = executer("/t /show load def t").unwrap_err();
        assert!(matches!(
            erreur,
            ErreurPs::OperateurNonSupporte { nom, .. } if nom == "show"
        ));
    }
}
