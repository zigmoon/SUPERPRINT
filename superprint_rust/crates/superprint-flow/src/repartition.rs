//! La **répartition** : les lignes composées → les cadres.
//!
//! ## Ce qui rend cette répartition exacte, et pourquoi ce n'est pas la même
//! chose qu'une recherche binaire
//!
//! La méthode du produit est une recherche binaire sur le **nombre de
//! caractères** : elle essaie 3 000 caractères, mesure, essaie 1 500, mesure…
//! jusqu'à tomber sur la plus grande longueur qui rentre. Trois propriétés en
//! découlent, et les trois sont des défauts :
//!
//! 1. **La coupure tombe sur un caractère**, pas sur une ligne. Le cadre peut
//!    donc se terminer au milieu d'une ligne — ce qui laisse un blanc en bas du
//!    cadre là où une ligne entière aurait dû passer au suivant.
//! 2. **Il faut recomposer entièrement** à chaque essai : c'est là que passent
//!    les 128 secondes d'une chaîne de 124 blocs.
//! 3. **Le résultat dépend de la métrique de la police au moment de la mesure**,
//!    donc deux blocs de la même chaîne peuvent être mesurés par deux chemins
//!    différents et se contredire.
//!
//! Ici, le texte est composé **une fois** en lignes, chacune connaît sa hauteur,
//! et la répartition est une **somme courante**. Les coupures tombent donc
//! toujours entre deux lignes, le coût est linéaire, et la somme des morceaux
//! rendus est exactement le flux d'entrée — ce que [`Repartition::verifier`]
//! contrôle.
//!
//! ## Les deux règles de tenue d'une ligne
//!
//! Une ligne tient dans ce qui reste d'un cadre si :
//!
//! - sa hauteur **plus ses décalages** (espace avant/après) tient dans la
//!   hauteur restante ;
//! - et elle n'est pas orpheline : on ne laisse pas la **première ligne d'un
//!   paragraphe** seule en bas d'un cadre, ni la **dernière** seule en haut du
//!   suivant, quand le cadre suivant existe. C'est la règle des lignes veuves et
//!   orphelines, et [`Reglages::veuves_et_orphelines`] dit combien de lignes il
//!   en faut pour qu'un paragraphe soit coupable.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « pagination et chaînage »).

use superprint_text::{Cesure, Compositeur, Ligne};

use crate::chaine::Chaine;
use crate::flux::Flux;

/// Ce qu'il faut pour mesurer et composer.
pub struct Reglages<'a> {
    /// Largeur d'un texte, dans l'unité de l'appelant.
    pub largeur: &'a dyn Fn(&str) -> f64,
    /// Hauteur d'une ligne, d'après le **rang du paragraphe**.
    ///
    /// Un titre et un corps n'ont pas la même hauteur de ligne ; c'est le seul
    /// renseignement que la répartition a besoin de tirer du style.
    pub hauteur_ligne: &'a dyn Fn(usize) -> f64,
    /// Espace ajouté avant un paragraphe, d'après son rang.
    pub espace_avant: &'a dyn Fn(usize) -> f64,
    /// Le moteur de césure, si l'on veut couper les mots.
    pub cesure: Option<&'a Cesure>,
    /// Nombre de lignes qu'un paragraphe doit avoir pour pouvoir être coupé.
    ///
    /// `2` est la valeur de la plupart des logiciels de PAO : en dessous, un
    /// paragraphe coupé laisserait une ligne seule d'un côté ou de l'autre, ce
    /// qui se voit plus que le blanc qu'on voulait éviter.
    pub veuves_et_orphelines: usize,
}

impl<'a> Reglages<'a> {
    /// Des réglages sans césure ni protection des veuves.
    #[must_use]
    pub fn nouveau(
        largeur: &'a dyn Fn(&str) -> f64,
        hauteur_ligne: &'a dyn Fn(usize) -> f64,
        espace_avant: &'a dyn Fn(usize) -> f64,
    ) -> Self {
        Self {
            largeur,
            hauteur_ligne,
            espace_avant,
            cesure: None,
            veuves_et_orphelines: 2,
        }
    }

    /// Active la césure des mots trop longs.
    #[must_use]
    pub fn avec_cesure(mut self, cesure: &'a Cesure) -> Self {
        self.cesure = Some(cesure);
        self
    }

    /// Change la protection des veuves et orphelines.
    #[must_use]
    pub fn veuves_et_orphelines(mut self, nombre: usize) -> Self {
        self.veuves_et_orphelines = nombre;
        self
    }
}

/// Une ligne composée, placée dans un cadre.
#[derive(Clone, Debug, PartialEq)]
pub struct LignePlacee {
    /// Le rang du paragraphe d'où la ligne vient.
    pub paragraphe: usize,
    /// Le rang de la ligne **dans son paragraphe**.
    pub rang: usize,
    /// Le rang du cadre qui la porte.
    pub cadre: usize,
    /// La ligne composée.
    pub ligne: Ligne,
    /// Vrai si cette ligne ouvre un paragraphe.
    pub ouvre: bool,
    /// Vrai si cette ligne ferme un paragraphe.
    pub ferme: bool,
}

/// Un cadre, et ce qui y a été placé.
#[derive(Clone, Debug, PartialEq)]
pub struct CadreRempli {
    /// Le rang du cadre dans la chaîne.
    pub cadre: usize,
    /// L'identifiant du cadre, tel que l'appelant l'a posé.
    pub id: usize,
    /// Les lignes placées.
    pub lignes: Vec<LignePlacee>,
    /// La hauteur réellement occupée.
    pub hauteur_occupee: f64,
    /// La hauteur utile du cadre.
    pub hauteur_utile: f64,
    /// Vrai si l'espace restant n'a pas permis de poser la ligne suivante.
    pub tronque: bool,
}

impl CadreRempli {
    /// Vrai si le cadre n'a rien reçu.
    #[must_use]
    pub fn est_vide(&self) -> bool {
        self.lignes.is_empty()
    }

    /// Le texte des lignes placées, joint par des fins de ligne.
    ///
    /// Le **tiret** est ajouté quand la ligne en porte un : c'est ce que
    /// l'imprimeur verra, donc c'est ce qui doit être comparé.
    #[must_use]
    pub fn texte(&self) -> String {
        self.lignes
            .iter()
            .map(|l| {
                if l.ligne.tiret {
                    format!("{}-", l.ligne.texte)
                } else {
                    l.ligne.texte.clone()
                }
            })
            .collect::<Vec<_>>()
            .join("\n")
    }
}

/// Le résultat d'une répartition.
#[derive(Clone, Debug, PartialEq)]
pub struct Repartition {
    /// Les cadres remplis, dans l'ordre de la chaîne.
    pub cadres: Vec<CadreRempli>,
    /// Le texte qui n'a **pas pu** être placé.
    ///
    /// Rendu plutôt que signalé par un drapeau : un `bool` dirait qu'il reste
    /// quelque chose sans dire combien ni quoi, et c'est justement ce qu'un
    /// opérateur a besoin de lire.
    pub reste: String,
    /// Le nombre de lignes composées au total.
    pub lignes_composees: usize,
    /// Vrai si tout le flux a été placé.
    pub complet: bool,
}

impl Repartition {
    /// Le texte placé, cadres bout à bout.
    #[must_use]
    pub fn texte_place(&self) -> String {
        self.cadres
            .iter()
            .filter(|c| !c.est_vide())
            .map(CadreRempli::texte)
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Contrôle que **rien n'a été perdu ni dupliqué**.
    ///
    /// La comparaison se fait sur le **flux de caractères**, espaces, fins de
    /// ligne et **traits d'union** retirés. C'est la bonne granularité, et elle
    /// mérite d'être expliquée.
    ///
    /// Pourquoi les espaces sont retirés : la composition les normalise
    /// (`split_whitespace`), c'est son travail, et comparer les octets bruts
    /// échouerait sur un texte qui contient deux espaces de suite.
    ///
    /// Pourquoi les traits d'union le sont aussi — et c'est la partie qui
    /// demande un aveu : le trait d'union qu'un coupeur de lignes **insère**
    /// (« n'im- » / « porte ») est **indistinguable** d'un trait d'union
    /// **authentique** (« États- » / « Unis »). Le test les retire donc des deux
    /// côtés. Ce qu'il garantit est précis :
    ///
    /// - **aucun caractère autre qu'un trait d'union n'est perdu ni dupliqué** ;
    /// - **aucun mot n'est perdu, dupliqué ni déplacé** — perdre un mot sans
    ///   perdre de caractère étant impossible, c'est la même affirmation ;
    /// - le nombre de cadres correspond à la chaîne.
    ///
    /// Ce qu'il ne garantit pas : qu'un trait d'union d'un mot placé soit
    /// toujours là. Ce cas est couvert autrement — un trait d'union ne peut
    /// disparaître qu'avec le mot entier, et
    /// [`CadreRempli::texte`] rend le texte affiché, tirets de césure compris,
    /// pour un contrôle de rendu.
    pub fn verifier(&self, flux: &Flux, chaine: &Chaine) -> Result<(), String> {
        let attendus = flux_de_caracteres(&flux.texte());

        let mut obtenus = String::new();
        for cadre in &self.cadres {
            for placee in &cadre.lignes {
                obtenus.push_str(&placee.ligne.texte);
            }
        }
        obtenus.push_str(&self.reste);
        let obtenus = flux_de_caracteres(&obtenus);

        if obtenus != attendus {
            let commun = attendus
                .chars()
                .zip(obtenus.chars())
                .take_while(|(a, b)| a == b)
                .count();
            let autour = |s: &str| -> String {
                s.chars().skip(commun.saturating_sub(20)).take(45).collect()
            };
            return Err(format!(
                "{} caractères attendus, {} placés ; première divergence au caractère {} : attendu …{}…, obtenu …{}…",
                attendus.chars().count(),
                obtenus.chars().count(),
                commun,
                autour(&attendus),
                autour(&obtenus),
            ));
        }
        if self.cadres.len() != chaine.cadres.len() {
            return Err(format!(
                "{} cadres remplis pour {} cadres dans la chaîne",
                self.cadres.len(),
                chaine.cadres.len()
            ));
        }
        Ok(())
    }
}

/// Le texte réduit à son flux de caractères : espaces, fins de ligne et traits
/// d'union retirés.
fn flux_de_caracteres(texte: &str) -> String {
    texte
        .chars()
        .filter(|c| !c.is_whitespace() && *c != '-')
        .collect()
}

/// Une ligne composée, avec ce qu'il faut pour la placer.
struct LigneComposee {
    paragraphe: usize,
    rang: usize,
    ligne: Ligne,
    ouvre: bool,
    ferme: bool,
    /** Espace à réserver **avant** cette ligne (espace avant du paragraphe). */
    avant: f64,
    /** Espace à réserver **après** cette ligne (espace après du paragraphe). */
    apres: f64,
    hauteur: f64,
}

/// Compose le flux, puis le **répartit** sur la chaîne.
///
/// Le composition est faite **une seule fois**, à la largeur de colonne du
/// **premier** cadre. Un cadre plus **étroit** que le premier verra donc passer
/// des lignes trop larges, et c'est [`CadreRempli::tronque`] qui le signale :
/// prétendre composer une chaîne à largeurs inégales en un seul passage serait
/// mentir, et composer cadre par cadre ferait dépendre le découpage du cadre
/// alors qu'il doit dépendre du flux.
#[must_use]
pub fn repartir(flux: &Flux, chaine: &Chaine, reglages: &Reglages<'_>) -> Repartition {
    if chaine.cadres.is_empty() {
        return Repartition {
            cadres: Vec::new(),
            reste: flux.texte(),
            lignes_composees: 0,
            complet: flux.est_vide(),
        };
    }

    let composees = composer_flux(flux, chaine, reglages);
    let total = composees.len();

    /* Les cadres remplis, un par cadre de la chaîne — même les vides : un cadre
    vide est un résultat, pas une absence de résultat. */
    let mut cadres: Vec<CadreRempli> = chaine
        .cadres
        .iter()
        .enumerate()
        .map(|(rang, cadre)| CadreRempli {
            cadre: rang,
            id: cadre.id,
            lignes: Vec::new(),
            hauteur_occupee: 0.0,
            hauteur_utile: cadre.hauteur_utile(),
            tronque: false,
        })
        .collect();

    /* Où commence et combien de lignes porte chaque paragraphe : précalculé,
    parce que la protection des veuves en a besoin à chaque ligne et qu'un
    parcours du vecteur à chaque fois serait quadratique. */
    let bornes = bornes_des_paragraphes(&composees);

    let mut curseur = 0usize;
    for (rang, cadre) in chaine.cadres.iter().enumerate() {
        if curseur >= composees.len() {
            break;
        }
        let hauteur_utile = cadre.hauteur_utile();
        let mut occupee = 0.0;
        /* Où le paragraphe en cours de pose a commencé dans CE cadre : sert à
        reculer si la coupure s'avère inacceptable. */
        let mut debut_ici: Option<(usize, usize, f64)> = None;

        while curseur < composees.len() {
            let item = &composees[curseur];
            let reserve = item.avant + item.hauteur;
            if occupee + reserve > hauteur_utile + 1e-9 {
                if occupee <= 1e-9 {
                    /* Le cadre n'a rien pu recevoir parce qu'il est trop court
                    pour une seule ligne, et il reste du texte : c'est un
                    cadre sous-dimensionné, et le dire vaut mieux que de le
                    sauter en silence. */
                    cadres[rang].tronque = true;
                }
                break;
            }

            if item.ouvre {
                debut_ici = Some((curseur, cadres[rang].lignes.len(), occupee));
            }

            /* La coupure qui suivrait la pose de cette ligne est-elle
            acceptable ? Si non, et si le paragraphe tient entier dans un
            cadre, on recule : il part au cadre suivant d'un bloc. */
            if coupure_inacceptable(
                &composees,
                &bornes,
                reglages,
                curseur,
                occupee + reserve,
                hauteur_utile,
            ) {
                let hauteur_paragraphe =
                    hauteur_du_paragraphe(&composees, &bornes, item.paragraphe);
                if let Some((debut_curseur, debut_lignes, debut_occupee)) = debut_ici {
                    if hauteur_paragraphe <= hauteur_utile + 1e-9 {
                        cadres[rang].lignes.truncate(debut_lignes);
                        curseur = debut_curseur;
                        occupee = debut_occupee;
                        break;
                    }
                }
                /* Le paragraphe vient d'un cadre précédent, ou il ne tient
                dans aucun cadre : on accepte la coupure. Une veuve est
                laid, un texte tronqué est faux. */
            }

            occupee += reserve;
            let item = &composees[curseur];
            cadres[rang].lignes.push(LignePlacee {
                paragraphe: item.paragraphe,
                rang: item.rang,
                cadre: rang,
                ligne: item.ligne.clone(),
                ouvre: item.ouvre,
                ferme: item.ferme,
            });
            curseur += 1;
        }
        cadres[rang].hauteur_occupee = occupee;
    }

    let reste = if curseur < composees.len() {
        /* Le reste est recomposé en texte : c'est la forme lisible par un
        humain, et l'invariante [`Repartition::verifier`] la contrôle. */
        reste_en_texte(flux, &composees, curseur)
    } else {
        String::new()
    };

    Repartition {
        complet: curseur >= composees.len(),
        cadres,
        reste,
        lignes_composees: total,
    }
}

/// Le texte non placé, sous sa forme recomposée.
fn reste_en_texte(_flux: &Flux, composees: &[LigneComposee], depuis: usize) -> String {
    let mut morceaux: Vec<String> = Vec::new();
    let mut paragraphe_courant: Option<usize> = None;
    let mut lignes: Vec<String> = Vec::new();
    for item in &composees[depuis..] {
        if paragraphe_courant != Some(item.paragraphe) {
            if let Some(_precedent) = paragraphe_courant {
                morceaux.push(lignes.join(" "));
                lignes.clear();
            }
            paragraphe_courant = Some(item.paragraphe);
        }
        let texte = if item.ligne.tiret {
            format!("{}-", item.ligne.texte)
        } else {
            item.ligne.texte.clone()
        };
        lignes.push(texte);
    }
    if paragraphe_courant.is_some() {
        morceaux.push(lignes.join(" "));
    }
    /* Le paragraphe d'origine n'est pas recopié : c'est bien la composition qui
    décide du texte restant, sinon le contrôle d'invariante comparerait deux
    choses différentes. */
    morceaux.join("\n")
}

/// Compose le flux en lignes, avec les décalages de paragraphe.
///
/// ## L'espacement appartient à la **transition**, pas au paragraphe
///
/// L'espace « après » d'un paragraphe est déplacé sur la **première ligne du
/// paragraphe suivant**, et il **fusionne** avec l'espace « avant » de celui-ci
/// par un **maximum**, pas une somme. Deux raisons, et les deux comptent :
///
/// 1. l'espace n'est réservé que s'il y a effectivement une ligne après lui. Un
///    paragraphe court en bas de cadre ne recule donc pas d'un cran en laissant
///    un trou : il est suivi d'une coupure, et une coupure avale l'espace ;
/// 2. deux réglages qui se suivent ne s'additionnent pas — c'est l'usage en PAO
///    et en CSS, et additionner donnerait un blanc du double de ce que l'auteur a
///    demandé, à chaque fois qu'il règle les deux côtés.
fn composer_flux(flux: &Flux, chaine: &Chaine, reglages: &Reglages<'_>) -> Vec<LigneComposee> {
    let largeur_cadre = chaine.cadres[0].largeur_colonne();
    let composeur = Compositeur::new(reglages.largeur);
    let composeur = match reglages.cesure {
        Some(c) => composeur.avec_cesure(c),
        None => composeur,
    };

    let mut sortie: Vec<LigneComposee> = Vec::new();
    for (index, paragraphe) in flux.paragraphes.iter().enumerate() {
        let hauteur = (reglages.hauteur_ligne)(index);
        let avant = (reglages.espace_avant)(index);

        if paragraphe.est_vide() {
            /* Un paragraphe vide occupe une ligne de hauteur nulle plus son
            espace : c'est un blanc voulu, et le supprimer changerait la
            pagination. */
            sortie.push(LigneComposee {
                paragraphe: index,
                rang: 0,
                ligne: Ligne {
                    texte: String::new(),
                    tiret: false,
                    largeur: 0.0,
                },
                ouvre: true,
                ferme: true,
                avant,
                apres: paragraphe.espace_apres,
                hauteur: 0.0,
            });
            continue;
        }

        /* La largeur dépend du rang de ligne : c'est ce qui donne son sens à un
        alinéa, et c'est aussi pourquoi on ne compose pas à la largeur la plus
        étroite « pour être sûr ». */
        let lignes = if paragraphe.retrait_premiere == paragraphe.retrait_suivantes {
            let largeur = (largeur_cadre - paragraphe.retrait_suivantes).max(0.0);
            composeur.composer(&paragraphe.texte, largeur)
        } else {
            composeur.composer_avec_largeurs(&paragraphe.texte, &|rang| {
                (largeur_cadre - paragraphe.retrait(rang)).max(0.0)
            })
        };

        let nombre = lignes.len();
        for (rang, ligne) in lignes.into_iter().enumerate() {
            sortie.push(LigneComposee {
                paragraphe: index,
                rang,
                ligne,
                ouvre: rang == 0,
                ferme: rang + 1 == nombre,
                avant: if rang == 0 { avant } else { 0.0 },
                apres: if rang + 1 == nombre {
                    paragraphe.espace_apres
                } else {
                    0.0
                },
                hauteur,
            });
        }
    }

    reporter_les_espaces(&mut sortie);
    sortie
}

/// Déplace chaque « espace après » sur la ligne suivante, en fusionnant par un
/// maximum avec son « espace avant ».
fn reporter_les_espaces(lignes: &mut [LigneComposee]) {
    for i in 0..lignes.len().saturating_sub(1) {
        let apres = lignes[i].apres;
        lignes[i].apres = 0.0;
        if apres > 0.0 {
            lignes[i + 1].avant = lignes[i + 1].avant.max(apres);
        }
    }
    /* L'espace « après » de la dernière ligne tombe : il n'y a rien après lui
    dans ce flux, et un espace en fin de document ne se voit pas. */
    if let Some(derniere) = lignes.last_mut() {
        derniere.apres = 0.0;
    }
}

/// Le premier et le dernier rang de chaque paragraphe dans la liste composée.
fn bornes_des_paragraphes(composees: &[LigneComposee]) -> Vec<(usize, usize)> {
    let mut bornes: Vec<(usize, usize)> = Vec::new();
    for (i, item) in composees.iter().enumerate() {
        match bornes.get_mut(item.paragraphe) {
            Some(borne) => borne.1 = i,
            None => {
                /* Le vecteur est indexé par le rang du paragraphe, qui croît
                strictement : on le remplit donc sans trou. */
                debug_assert_eq!(bornes.len(), item.paragraphe);
                bornes.resize(item.paragraphe + 1, (i, i));
            }
        }
    }
    bornes
}

/// La hauteur totale d'un paragraphe, décalages compris.
fn hauteur_du_paragraphe(
    composees: &[LigneComposee],
    bornes: &[(usize, usize)],
    paragraphe: usize,
) -> f64 {
    let Some((debut, fin)) = bornes.get(paragraphe).copied() else {
        return 0.0;
    };
    composees[debut..=fin]
        .iter()
        .map(|c| c.avant + c.hauteur)
        .sum()
}

/// La coupure qui suivrait la pose de la ligne `curseur` est-elle
/// inacceptable ?
///
/// Elle l'est quand elle laisserait **moins de `veuves_et_orphelines` lignes**
/// d'un côté ou de l'autre : une ou deux lignes esseulées en bas d'un cadre
/// (orpheline) ou en haut du suivant (veuve).
///
/// La réponse est `false` dans trois cas, et chacun compte :
///
/// - la protection est désactivée (`minimum < 2`) ;
/// - cette ligne **achève le paragraphe** dans ce cadre — il n'y a alors aucune
///   coupure à juger ;
/// - le paragraphe est **plus court** que le minimum : on ne protège pas ce
///   qu'on ne peut pas protéger.
fn coupure_inacceptable(
    composees: &[LigneComposee],
    bornes: &[(usize, usize)],
    reglages: &Reglages<'_>,
    curseur: usize,
    occupee_apres: f64,
    hauteur_utile: f64,
) -> bool {
    let minimum = reglages.veuves_et_orphelines;
    if minimum < 2 {
        return false;
    }
    let item = &composees[curseur];
    let Some((debut, fin)) = bornes.get(item.paragraphe).copied() else {
        return false;
    };
    let total = fin - debut + 1;
    if total < minimum {
        return false;
    }

    /* Lignes du paragraphe qui seraient placées ici, cette ligne comprise. */
    let ici = curseur - debut + 1;
    if ici >= total {
        return false; /* le paragraphe est achevé ici : aucune coupure */
    }

    /* Et combien de lignes du même paragraphe peuvent ENCORE tenir après ? Si
    aucune ne tient, la coupure est inévitable quelle que soit la règle. */
    let mut hauteur = occupee_apres;
    let mut apres = 0usize;
    for suivant in &composees[debut + ici..=fin] {
        hauteur += suivant.avant + suivant.hauteur;
        if hauteur > hauteur_utile + 1e-9 {
            break;
        }
        apres += 1;
    }
    /* `ici + apres == total` veut dire que le paragraphe **s'achève dans ce
    cadre** : il n'y a alors aucune coupure entre deux cadres, et une
    « première ligne seule » n'est pas une orpheline — elle est simplement la
    première ligne, les suivantes étant plus bas sur la même page. Sans cette
    condition, tout paragraphe commençant en haut d'un cadre serait reculé
    indéfiniment. */
    if ici + apres >= total {
        return false;
    }

    ici < minimum || apres < minimum
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::flux::Paragraphe;

    /** Mesure à la monospace : une unité par caractère. */
    fn monospace(texte: &str) -> f64 {
        texte.chars().count() as f64
    }

    const HAUTEUR: f64 = 10.0;

    fn reglages_simples() -> Reglages<'static> {
        static ZERO: fn(usize) -> f64 = |_| 0.0;
        static DIX: fn(usize) -> f64 = |_| HAUTEUR;
        Reglages::nouveau(&monospace, &DIX, &ZERO)
    }

    fn chaine_de(n: usize, largeur: f64, hauteur: f64) -> Chaine {
        let mut chaine = Chaine::nouveau();
        for id in 0..n {
            chaine.ajouter(crate::chaine::Cadre::nouveau(id, largeur, hauteur));
        }
        chaine
    }

    #[test]
    fn un_texte_court_tient_dans_le_premier_cadre() {
        let flux = Flux::depuis_texte("Bonjour");
        let chaine = chaine_de(2, 20.0, 30.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert_eq!(r.cadres[0].lignes.len(), 1);
        assert!(r.cadres[1].est_vide());
        assert!(r.complet);
        assert_eq!(r.reste, "");
        assert!(r.verifier(&flux, &chaine).is_ok());
    }

    #[test]
    fn le_texte_deborde_au_cadre_suivant() {
        /* 9 mots de 5 caractères dans des cadres de 12 × 30 (3 lignes). */
        let flux = Flux::depuis_texte("aaaaa bbbbb ccccc ddddd eeeee fffff ggggg hhhhh iiiii");
        let chaine = chaine_de(2, 12.0, 30.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert!(!r.cadres[0].est_vide());
        assert!(!r.cadres[1].est_vide());
        assert!(r.complet, "reste : {:?}", r.reste);
        assert!(r.verifier(&flux, &chaine).is_ok());
    }

    #[test]
    fn un_texte_trop_long_laisse_un_reste_explicite() {
        let flux = Flux::depuis_texte("aaaaa bbbbb ccccc ddddd eeeee fffff ggggg hhhhh");
        let chaine = chaine_de(1, 12.0, 20.0); /* deux lignes */
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert!(!r.complet);
        assert!(
            !r.reste.is_empty(),
            "le reste doit être rendu, pas juste signalé"
        );
        /* Le cadre doit être REMPLI : deux lignes de deux mots, donc quatre mots
        restants. Un `1 ligne ici / 3 au reste` serait un cadre à moitié vide. */
        assert_eq!(r.cadres[0].lignes.len(), 2, "le cadre doit être rempli");
        assert_eq!(r.reste.split_whitespace().count(), 4);
        assert!(r.verifier(&flux, &chaine).is_ok());
    }

    #[test]
    fn aucun_caractere_ne_se_perd_ni_ne_se_duplique() {
        /* L'invariante qui compte : sur des cas construits pour être difficiles
        (cadres courts, mots longs, paragraphes multiples, césure). */
        let texte = "Le chaînage de texte répartit un flux sur plusieurs cadres. \
                     Chaque cadre reçoit ce qui tient, et le reste passe au suivant. \
                     Un paragraphe peut être coupé, mais pas n'importe comment.";
        let cesure = Cesure::nouvelle();
        for (largeur, hauteur, cadres) in [
            (40.0, 50.0, 1usize),
            (40.0, 50.0, 3),
            (25.0, 30.0, 4),
            (100.0, 20.0, 6),
            (12.0, 25.0, 8),
        ] {
            let flux = Flux::depuis_texte(texte);
            let chaine = chaine_de(cadres, largeur, hauteur);
            let reglages = reglages_simples().avec_cesure(&cesure);
            let r = repartir(&flux, &chaine, &reglages);
            r.verifier(&flux, &chaine)
                .unwrap_or_else(|e| panic!("{largeur}×{hauteur} ×{cadres} : {e}"));
        }
    }

    #[test]
    fn les_coupures_tombent_entre_deux_lignes_jamais_dans_une_ligne() {
        /* C'est la différence avec une recherche binaire sur les caractères :
        chaque ligne placée est une ligne COMPOSÉE, entière. */
        let flux = Flux::depuis_texte(
            "aaaaa bbbbb ccccc ddddd eeeee fffff ggggg hhhhh iiiii jjjjj kkkkk lllll",
        );
        let chaine = chaine_de(4, 12.0, 25.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        for cadre in &r.cadres {
            for ligne in &cadre.lignes {
                assert!(!ligne.ligne.texte.is_empty(), "une ligne vide a été placée");
                /* La mesure doit correspondre au texte de la ligne : c'est ce
                qui prouve que la ligne n'a pas été tronquée. */
                assert!((ligne.ligne.largeur - monospace(&ligne.ligne.texte)).abs() < 1e-9);
            }
        }
    }

    #[test]
    fn le_nombre_de_lignes_par_cadre_tient_dans_sa_hauteur() {
        let flux = Flux::depuis_texte(
            "aaaaa bbbbb ccccc ddddd eeeee fffff ggggg hhhhh iiiii jjjjj kkkkk lllll mmmmm nnnnn",
        );
        let chaine = chaine_de(3, 12.0, 35.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        for cadre in &r.cadres {
            assert!(
                cadre.hauteur_occupee <= cadre.hauteur_utile + 1e-9,
                "cadre {} occupe {} pour {}",
                cadre.cadre,
                cadre.hauteur_occupee,
                cadre.hauteur_utile
            );
            assert!(
                cadre.lignes.len() <= 3,
                "{} lignes dans 3 hauteurs",
                cadre.lignes.len()
            );
        }
    }

    #[test]
    fn les_marges_reduisent_ce_qui_tient() {
        let flux = Flux::depuis_texte("aaaaa bbbbb ccccc ddddd eeeee");
        let sans = chaine_de(1, 12.0, 30.0);
        let mut avec = Chaine::nouveau();
        avec.ajouter(crate::chaine::Cadre::nouveau(0, 12.0, 30.0).marges(2.0, 5.0, 2.0, 5.0));
        let r_sans = repartir(&flux, &sans, &reglages_simples());
        let r_avec = repartir(&flux, &avec, &reglages_simples());
        assert!(
            r_avec.cadres[0].lignes.len() <= r_sans.cadres[0].lignes.len(),
            "les marges ne peuvent pas faire tenir plus de lignes"
        );
    }

    #[test]
    fn les_colonnes_reduisent_la_largeur_utile() {
        let flux = Flux::depuis_texte("aaaaa bbbbb ccccc ddddd");
        let mut une = Chaine::nouveau();
        une.ajouter(crate::chaine::Cadre::nouveau(0, 24.0, 100.0));
        let mut deux = Chaine::nouveau();
        deux.ajouter(crate::chaine::Cadre::nouveau(0, 24.0, 100.0).colonnes(2, 4.0));
        let r1 = repartir(&flux, &une, &reglages_simples());
        let r2 = repartir(&flux, &deux, &reglages_simples());
        /* Deux colonnes de 10 : 2 mots par ligne au lieu de 4. */
        assert!(r2.cadres[0].lignes.len() >= r1.cadres[0].lignes.len());
    }

    #[test]
    fn un_alinea_indente_la_premiere_ligne_et_pas_les_autres() {
        let mut flux = Flux::nouveau();
        flux.ajouter(Paragraphe::nouveau("aaaaa bbbbb ccccc ddddd eeeee").retraits(6.0, 0.0));
        let chaine = chaine_de(1, 12.0, 100.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        let lignes = &r.cadres[0].lignes;
        assert!(lignes.len() >= 2);
        /* La première ligne a 6 unités de moins : elle doit être plus courte. */
        assert!(
            lignes[0].ligne.largeur < lignes[1].ligne.largeur,
            "première ligne {:?} ({}), deuxième {:?} ({})",
            lignes[0].ligne.texte,
            lignes[0].ligne.largeur,
            lignes[1].ligne.texte,
            lignes[1].ligne.largeur
        );
        assert!(lignes[0].ligne.largeur <= 6.0);
    }

    #[test]
    fn un_alinea_suspendu_indente_les_lignes_suivantes() {
        let mut flux = Flux::nouveau();
        flux.ajouter(Paragraphe::nouveau("aaaaa bbbbb ccccc ddddd").retraits(0.0, 5.0));
        let chaine = chaine_de(1, 12.0, 100.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        let lignes = &r.cadres[0].lignes;
        assert!(lignes.len() >= 2);
        for ligne in &lignes[1..] {
            assert!(
                ligne.ligne.largeur <= 7.0 + 1e-9,
                "ligne suivante trop large : {} ({:?})",
                ligne.ligne.largeur,
                ligne.ligne.texte
            );
        }
    }

    #[test]
    fn l_espace_apres_un_paragraphe_compte_dans_la_hauteur() {
        let mut flux = Flux::nouveau();
        flux.ajouter(Paragraphe::nouveau("aaaaa").espace_apres(30.0));
        flux.ajouter(Paragraphe::nouveau("bbbbb"));
        let chaine = chaine_de(1, 20.0, 25.0); /* deux lignes, mais 30 d'espace */
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert_eq!(
            r.cadres[0].lignes.len(),
            1,
            "l'espace après doit bloquer la seconde"
        );
        assert!(!r.complet);
    }

    #[test]
    fn un_paragraphe_vide_occupe_de_la_place() {
        let mut flux = Flux::nouveau();
        flux.ajouter(Paragraphe::nouveau("aaaaa"));
        flux.ajouter(Paragraphe::nouveau(""));
        flux.ajouter(Paragraphe::nouveau("bbbbb"));
        let chaine = chaine_de(1, 20.0, 100.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert_eq!(r.cadres[0].lignes.len(), 3);
        assert!(r.cadres[0].lignes[1].ligne.texte.is_empty());
        assert!(r.complet);
    }

    #[test]
    fn un_paragraphe_qui_ne_tient_pas_entier_ne_se_coupe_pas_si_un_cadre_peut_le_prendre() {
        /* Cas réel : un cadre qui a déjà reçu un paragraphe, et un second
        paragraphe plus grand que la place restante. Sans la règle, il serait
        coupé 1 ligne ici / 1 ligne au suivant — une orpheline et une veuve.
        Avec, il part entier au cadre suivant. */
        let mut flux = Flux::nouveau();
        flux.ajouter(Paragraphe::nouveau("aaaaa bbbbb ccccc ddddd eeeee fffff")); /* 3 lignes */
        flux.ajouter(Paragraphe::nouveau("ggggg hhhhh iiiii jjjjj")); /* 2 lignes */
        let chaine = chaine_de(2, 12.0, 40.0); /* 4 lignes par cadre */
        let r = repartir(&flux, &chaine, &reglages_simples());

        assert_eq!(
            r.cadres[0].lignes.len(),
            3,
            "le premier paragraphe occupe 3 lignes, et doit rester seul"
        );
        assert_eq!(
            r.cadres[1].lignes.len(),
            2,
            "le second part entier au suivant plutôt que 1 ligne / 1 ligne"
        );
        assert!(r.complet);
        assert!(r.verifier(&flux, &chaine).is_ok());
    }

    #[test]
    fn un_paragraphe_plus_long_qu_un_cadre_se_coupe_quand_meme() {
        /* Douze mots, donc six lignes, dans des cadres de trois : refuser la
        coupure ferait disparaître la moitié du texte, ce qui est bien pire
        qu'une orpheline — c'est pour cela que le recul est refusé quand le
        paragraphe ne tient dans AUCUN cadre. */
        let mut flux = Flux::nouveau();
        flux.ajouter(Paragraphe::nouveau(
            "aaaaa bbbbb ccccc ddddd eeeee fffff ggggg hhhhh iiiii jjjjj kkkkk lllll",
        ));
        let chaine = chaine_de(2, 12.0, 30.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert_eq!(r.cadres[0].lignes.len(), 3);
        assert_eq!(r.cadres[1].lignes.len(), 3);
        assert!(r.complet, "reste : {:?}", r.reste);
        assert!(r.verifier(&flux, &chaine).is_ok());
    }

    #[test]
    fn la_protection_des_veuves_peut_etre_desactivee() {
        let mut flux = Flux::nouveau();
        flux.ajouter(Paragraphe::nouveau("aaaaa bbbbb ccccc ddddd eeeee fffff"));
        flux.ajouter(Paragraphe::nouveau("ggggg hhhhh iiiii jjjjj"));
        let chaine = chaine_de(2, 12.0, 40.0);
        let sans = repartir(&flux, &chaine, &reglages_simples());
        let avec = repartir(&flux, &chaine, &reglages_simples().veuves_et_orphelines(0));
        /* Protégé : le second paragraphe part entier. Non protégé : il est coupé
        là où la place s'arrête. Les deux ne peuvent pas donner la même chose,
        sinon le réglage ne ferait rien. */
        assert_eq!(sans.cadres[1].lignes.len(), 2);
        assert_eq!(avec.cadres[0].lignes.len(), 4);
        assert_eq!(avec.cadres[1].lignes.len(), 1);
        assert!(avec.verifier(&flux, &chaine).is_ok());
    }

    #[test]
    fn un_paragraphe_long_se_coupe_normalement() {
        /* Neuf lignes dans trois cadres de trois : la coupure est légitime
        (trois lignes de chaque côté). */
        let mut flux = Flux::nouveau();
        flux.ajouter(Paragraphe::nouveau(
            "aaaaa bbbbb ccccc ddddd eeeee fffff ggggg hhhhh iiiii",
        ));
        let chaine = chaine_de(3, 12.0, 30.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert!(!r.cadres[0].est_vide());
        assert!(r.complet);
        assert!(r.verifier(&flux, &chaine).is_ok());
    }

    #[test]
    fn une_chaine_vide_rend_tout_en_reste() {
        let flux = Flux::depuis_texte("aaaaa bbbbb");
        let r = repartir(&flux, &Chaine::nouveau(), &reglages_simples());
        assert!(r.cadres.is_empty());
        assert!(!r.complet);
        assert_eq!(r.reste, "aaaaa bbbbb");
    }

    #[test]
    fn un_cadre_sans_place_est_signale_tronque() {
        let flux = Flux::depuis_texte("aaaaa");
        let mut chaine = Chaine::nouveau();
        chaine.ajouter(crate::chaine::Cadre::nouveau(0, 20.0, 2.0)); /* trop court */
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert!(r.cadres[0].est_vide());
        assert!(
            r.cadres[0].tronque,
            "un cadre trop court doit être dit tronqué"
        );
        assert!(!r.complet);
    }

    #[test]
    fn tous_les_cadres_sont_rendus_meme_vides() {
        let flux = Flux::depuis_texte("aaaaa");
        let chaine = chaine_de(4, 20.0, 30.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert_eq!(r.cadres.len(), 4);
        assert_eq!(r.cadres[0].id, 0);
        assert_eq!(r.cadres[3].id, 3);
        assert_eq!(r.cadres.iter().filter(|c| c.est_vide()).count(), 3);
    }

    #[test]
    fn les_identifiants_des_cadres_sont_conserves() {
        let mut chaine = Chaine::nouveau();
        for id in [42, 7, 13] {
            chaine.ajouter(crate::chaine::Cadre::nouveau(id, 12.0, 20.0));
        }
        let flux = Flux::depuis_texte("aaaaa bbbbb ccccc ddddd eeeee fffff");
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert_eq!(
            r.cadres.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![42, 7, 13]
        );
    }

    #[test]
    fn le_texte_place_est_du_texte_lisible() {
        let flux = Flux::depuis_texte("Bonjour le monde");
        let chaine = chaine_de(1, 8.0, 30.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        let texte = r.texte_place();
        assert!(texte.contains("Bonjour"));
        assert!(texte.contains("monde"));
    }

    #[test]
    fn un_mot_plus_large_que_le_cadre_ne_boucle_pas() {
        /* Le compositeur pose un mot incoupable plus large que la colonne tel
        quel : la répartition doit le placer, pas boucler. */
        let flux = Flux::depuis_texte("anticonstitutionnellement x");
        let chaine = chaine_de(1, 5.0, 30.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        assert!(!r.cadres[0].est_vide());
    }

    #[test]
    fn la_repartition_est_deterministe() {
        let flux = Flux::depuis_texte("aaaaa bbbbb ccccc ddddd eeeee fffff ggggg");
        let chaine = chaine_de(3, 12.0, 25.0);
        let a = repartir(&flux, &chaine, &reglages_simples());
        let b = repartir(&flux, &chaine, &reglages_simples());
        assert_eq!(a, b);
    }

    #[test]
    fn les_reglages_de_hauteur_par_paragraphe_sont_respectes() {
        /* Un titre de 20 d'unités occupe le double d'un corps de 10 : c'est ce
        qui doit décider du passage au cadre suivant. */
        static HAUTEURS: fn(usize) -> f64 = |rang| if rang == 0 { 20.0 } else { 10.0 };
        static ZERO: fn(usize) -> f64 = |_| 0.0;
        let reglages = Reglages::nouveau(&monospace, &HAUTEURS, &ZERO);
        let mut flux = Flux::nouveau();
        flux.ajouter(Paragraphe::nouveau("TITRE").espace_apres(0.0));
        flux.ajouter(Paragraphe::nouveau("aaaaa"));
        let chaine = chaine_de(1, 20.0, 25.0);
        let r = repartir(&flux, &chaine, &reglages);
        /* 20 + 10 = 30 > 25 : le second paragraphe ne tient pas. */
        assert_eq!(r.cadres[0].lignes.len(), 1);
        assert_eq!(r.cadres[0].hauteur_occupee, 20.0);
    }

    #[test]
    fn le_controle_d_invariante_detecte_une_perte() {
        /* Le contrôle doit VRAIMENT attraper une perte : on lui donne une
        répartition trafiquée. La chaîne est volontairement trop petite, pour
        qu'il y ait bien un reste à faire disparaître. */
        let flux = Flux::depuis_texte("aaaaa bbbbb ccccc ddddd eeeee");
        let chaine = chaine_de(1, 12.0, 20.0);
        let mut r = repartir(&flux, &chaine, &reglages_simples());
        assert!(!r.complet, "il faut un reste pour éprouver le contrôle");
        assert!(r.verifier(&flux, &chaine).is_ok());
        r.reste.clear();
        r.complet = true;
        assert!(
            r.verifier(&flux, &chaine).is_err(),
            "la perte doit être vue"
        );
    }

    #[test]
    fn le_controle_d_invariante_detecte_une_ligne_perdue() {
        let flux = Flux::depuis_texte("aaaaa bbbbb ccccc ddddd");
        let chaine = chaine_de(1, 12.0, 100.0);
        let mut r = repartir(&flux, &chaine, &reglages_simples());
        assert!(r.verifier(&flux, &chaine).is_ok());
        r.cadres[0].lignes.remove(1);
        assert!(
            r.verifier(&flux, &chaine).is_err(),
            "une ligne retirée doit être vue"
        );
    }

    #[test]
    fn le_controle_d_invariante_detecte_un_doublon() {
        let flux = Flux::depuis_texte("aaaaa bbbbb");
        let chaine = chaine_de(1, 20.0, 30.0);
        let mut r = repartir(&flux, &chaine, &reglages_simples());
        if let Some(ligne) = r.cadres[0].lignes.first().cloned() {
            r.cadres[0].lignes.push(ligne);
            assert!(
                r.verifier(&flux, &chaine).is_err(),
                "le doublon doit être vu"
            );
        }
    }

    #[test]
    fn le_controle_d_invariante_detecte_un_mauvais_nombre_de_cadres() {
        let flux = Flux::depuis_texte("aaaaa");
        let chaine = chaine_de(1, 20.0, 30.0);
        let r = repartir(&flux, &chaine, &reglages_simples());
        let autre = chaine_de(2, 20.0, 30.0);
        assert!(r.verifier(&flux, &autre).is_err());
    }

    #[test]
    fn la_cesure_permet_de_faire_tenir_des_mots_longs() {
        use superprint_text::Motifs;
        /* Un jeu de motifs minuscule mais suffisant : couper après « anticon »
        et « stit ». Écrire les vraies règles françaises ici serait recopier
        `hyphenation-fr.js` ; ce que ce test doit prouver est que le chaînage
        **emploie** le moteur de césure qu'on lui donne, pas que ce moteur est
        juste — c'est le rôle de `validate-cesure.mjs`. */
        let cesure = Cesure::dictionnaire(Motifs::depuis_pat("n3t\nn1s1t\n", 2, 3));
        let flux =
            Flux::depuis_texte("anticonstitutionnellement extraordinairement invraisemblablement");
        let chaine = chaine_de(1, 14.0, 100.0);
        let sans = repartir(&flux, &chaine, &reglages_simples());
        let avec = repartir(&flux, &chaine, &reglages_simples().avec_cesure(&cesure));

        assert!(
            avec.cadres[0].lignes.len() > sans.cadres[0].lignes.len(),
            "la césure doit donner plus de lignes : {} contre {}",
            avec.cadres[0].lignes.len(),
            sans.cadres[0].lignes.len()
        );
        /* Et aucune ligne ne doit dépasser la largeur du cadre : c'est
        précisément ce que la césure vient régler. */
        for cadre in &avec.cadres {
            for ligne in &cadre.lignes {
                assert!(
                    ligne.ligne.largeur <= 14.0 + 1e-9,
                    "ligne trop large malgré la césure : {:?} ({})",
                    ligne.ligne.texte,
                    ligne.ligne.largeur
                );
            }
        }
        avec.verifier(&flux, &chaine).expect("invariante");
    }

    #[test]
    fn flux_de_caracteres_ne_garde_que_les_caracteres() {
        /* Un texte coupé par la césure se recolle tout seul : le tiret de césure
        est retiré des deux côtés, puisqu'il est indistinguable d'un tiret
        authentique. C'est écrit dans la documentation de `verifier`. */
        assert_eq!(
            format!(
                "{}{}",
                flux_de_caracteres("n'im-"),
                flux_de_caracteres("porte")
            ),
            flux_de_caracteres("n'importe")
        );
        assert_eq!(flux_de_caracteres("États-"), flux_de_caracteres("États"));
        assert_eq!(flux_de_caracteres("a b\nc\td"), "abcd");
        assert_eq!(flux_de_caracteres("   "), "");
        assert_eq!(flux_de_caracteres("é à ü"), "éàü");
    }
}
