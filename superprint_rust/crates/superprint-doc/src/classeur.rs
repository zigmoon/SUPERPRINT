//! **Le classeur `.xlsx`, lu comme un modèle de cellules.**
//!
//! ## Pourquoi un module à part, et pas une branche de `odt`
//!
//! Un tableur n'est pas un texte : il a des **références** (`B12`), une
//! **grille**, des **largeurs de colonne**, des **fusions**, et plusieurs
//! **feuilles**. Réduire un classeur à une suite de paragraphes perdrait tout
//! cela — et c'est exactement ce que la version antérieure de ce crate faisait de
//! fait, puisqu'il ne lisait pas le `.xlsx` du tout.
//!
//! Le classeur est donc rendu ici sous deux formes, et les deux servent :
//!
//! - le **modèle** ([`Classeur`], [`Feuille`], [`Cellule`]) : ce qu'une mise en
//!   page a besoin de savoir pour composer un tableau ;
//! - le **texte** ([`Feuille::vers_texte`]) : les lignes séparées par des sauts,
//!   les cellules par des tabulations. C'est ce qui permet d'importer un
//!   classeur **aujourd'hui**, sans attendre le composeur de tableaux.
//!
//! ## Ce qui est lu, et ce qui ne l'est pas
//!
//! | Lu | Comment |
//! |---|---|
//! | les feuilles, dans l'ordre du classeur | `xl/workbook.xml` **et** ses relations (`xl/_rels/workbook.xml.rels`) — l'ordre et le fichier ne se devinent pas |
//! | le nom et l'état (visible, masquée) de chaque feuille | `sheets/sheet` |
//! | les chaînes partagées | `xl/sharedStrings.xml`, morceaux `r/t` concaténés |
//! | les nombres, booléens, erreurs, chaînes en ligne | `t` de la cellule |
//! | les largeurs de colonne et leur masquage | `cols/col` |
//! | les fusions | `mergeCells/mergeCell` |
//!
//! **Ce qui n'est pas lu, et qui est dit plutôt que deviné :**
//!
//! - les **formats numériques** (styles) : une cellule n'est donc jamais
//!   « convertie en date ». Un numéro de série reste un nombre. Le faire
//!   demanderait `xl/styles.xml` et `numFmt`, c'est-à-dire le moteur de formatage
//!   d'Excel — un autre métier, et un demi-moteur donnerait des dates fausses ;
//! - les **formules** ne sont pas évaluées : c'est le **cache** écrit par Excel
//!   qui est lu (`<v>`), et c'est exactement ce que fait SheetJS. Une cellule
//!   `str` (résultat de formule en texte) est lue comme du texte ;
//! - les styles, les couleurs, les images, les graphiques, les volets figés.
//!
//! ## La mesure
//!
//! `scripts/validate-xlsx.mjs` confronte ce lecteur à **SheetJS** — la
//! bibliothèque que le produit embarque (`xlsx.full.min.js`, Apache-2.0), lue sur
//! place et jamais modifiée. Références, types, valeurs, ordre des feuilles,
//! largeurs et fusions sont comparés cellule par cellule.

use superprint_zip::Archive;

use crate::xml::{self, Element};
use crate::{ErreurImport, Format, Memoire, Paragraphe};

/// Une référence A1 : colonne et ligne, **indexées à zéro**.
///
/// Zéro est un index, pas une notation : `A1` est `(0, 0)`. La conversion vers et
/// depuis la notation A1 est faite ici, et nulle part ailleurs — c'est le seul
/// point où la convention bijective (`A`→`Z`, puis `AA`) peut se tromper.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Reference {
    /// Colonne, indexée à zéro : `A` vaut 0.
    pub colonne: u32,
    /// Ligne, indexée à zéro : `1` vaut 0.
    pub ligne: u32,
}

impl Reference {
    /// Une référence à partir de ses index.
    #[must_use]
    pub const fn nouvelle(colonne: u32, ligne: u32) -> Self {
        Self { colonne, ligne }
    }

    /// Lit une référence en notation A1 — `A1`, `B12`, `AB1048576`.
    ///
    /// Rend `None` si la forme n'est pas respectée : au moins une lettre, puis au
    /// moins un chiffre, et rien d'autre. Les `$` des références absolues sont
    /// **tolérés et ignorés** : `$A$1` désigne la même cellule que `A1`, et
    /// refuser la forme absolue serait refuser du XML valide.
    #[must_use]
    pub fn lire(a1: &str) -> Option<Self> {
        let mut colonne: u32 = 0;
        let mut lettres = 0usize;
        let mut chiffres = String::new();
        for caractere in a1.chars() {
            if caractere == '$' {
                continue;
            }
            if caractere.is_ascii_uppercase() {
                if !chiffres.is_empty() {
                    return None;
                }
                // `A` vaut 1 dans la notation, donc 0 après décrément ; `AA`
                // vaut 27. La base est 26, et le décalage de un est ce qui
                // distingue cette numération d'une base 26 ordinaire.
                colonne = colonne
                    .checked_mul(26)?
                    .checked_add(u32::from(caractere as u8 - b'A') + 1)?;
                lettres += 1;
            } else if caractere.is_ascii_lowercase() {
                return None;
            } else if caractere.is_ascii_digit() {
                if lettres == 0 {
                    return None;
                }
                chiffres.push(caractere);
            } else {
                return None;
            }
        }
        if lettres == 0 || chiffres.is_empty() {
            return None;
        }
        let ligne: u32 = chiffres.parse().ok()?;
        if ligne == 0 {
            return None;
        }
        Some(Self {
            colonne: colonne - 1,
            ligne: ligne - 1,
        })
    }

    /// La notation A1 de cette référence.
    #[must_use]
    pub fn a1(&self) -> String {
        let mut colonne = self.colonne + 1;
        let mut lettres = Vec::new();
        while colonne > 0 {
            let reste = (colonne - 1) % 26;
            lettres.push(u8::try_from(reste).unwrap_or(0) + b'A');
            colonne = (colonne - 1) / 26;
        }
        lettres.reverse();
        let nom = String::from_utf8(lettres).unwrap_or_default();
        format!("{nom}{}", self.ligne + 1)
    }
}

/// Ce qu'une cellule porte.
#[derive(Clone, Debug, PartialEq)]
pub enum Valeur {
    /// Une chaîne — partagée ou en ligne.
    Texte(String),
    /// Un nombre. **Jamais converti en date** : voir l'en-tête du module.
    Nombre(f64),
    /// Un booléen.
    Booleen(bool),
    /// Une erreur de formule (`#REF!`, `#DIV/0!`…), telle qu'Excel l'a écrite.
    Erreur(String),
    /// Une cellule qui n'était qu'un style, ou une formule sans cache.
    Vide,
}

impl Valeur {
    /// La valeur telle qu'un texte la lirait : c'est ce qui compose
    /// [`Feuille::vers_texte`].
    #[must_use]
    pub fn en_texte(&self) -> String {
        match self {
            Self::Texte(t) => t.clone(),
            Self::Nombre(n) => format!("{n}"),
            Self::Booleen(v) => if *v { "VRAI" } else { "FAUX" }.to_string(),
            Self::Erreur(e) => e.clone(),
            Self::Vide => String::new(),
        }
    }

    /// Le genre de la valeur, en un mot — le vocabulaire de `<c t="…">`, pour
    /// qu'une comparaison avec un lecteur tiers soit terme à terme.
    ///
    /// `inlineStr` (chaîne en ligne) et `s` (chaîne partagée) rendent le **même**
    /// mot : ce sont deux écritures d'une seule chose, et une comparaison doit
    /// porter sur la chose, pas sur l'encodage.
    #[must_use]
    pub const fn genre(&self) -> &'static str {
        match self {
            Self::Texte(_) => "s",
            Self::Nombre(_) => "n",
            Self::Booleen(_) => "b",
            Self::Erreur(_) => "e",
            Self::Vide => "vide",
        }
    }
}

/// Une cellule, à sa place dans la grille.
#[derive(Clone, Debug, PartialEq)]
pub struct Cellule {
    /// Sa référence.
    pub reference: Reference,
    /// Ce qu'elle porte.
    pub valeur: Valeur,
}

/// La largeur d'une ou plusieurs colonnes, telle que le fichier la donne.
///
/// La largeur est celle d'Excel, en **caractères du chiffre zéro** de la police
/// par défaut — c'est l'unité du format, et la convertir en millimètres
/// demanderait la police, ce que le noyau ne fait pas ici.
#[derive(Clone, Debug, PartialEq)]
pub struct Colonne {
    /// Première colonne couverte, indexée à zéro.
    pub premiere: u32,
    /// Dernière colonne couverte, incluse.
    pub derniere: u32,
    /// Largeur, en caractères.
    pub largeur: f64,
    /// La ou les colonnes sont-elles masquées ?
    pub masquee: bool,
}

/// Une fusion de cellules : la plage couverte.
#[derive(Clone, Debug, PartialEq)]
pub struct Fusion {
    /// Coin haut-gauche.
    pub debut: Reference,
    /// Coin bas-droit, **inclus**.
    pub fin: Reference,
}

/// L'état d'une feuille dans le classeur.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum EtatFeuille {
    /// Affichée.
    Visible,
    /// Masquée, mais présente.
    Masquee,
    /// Masquée et inaccessible depuis l'interface d'Excel.
    TresMasquee,
}

impl EtatFeuille {
    fn lire(valeur: Option<&str>) -> Self {
        match valeur {
            Some("hidden") => Self::Masquee,
            Some("veryHidden") => Self::TresMasquee,
            _ => Self::Visible,
        }
    }

    /// L'état tel que `xl/workbook.xml` l'écrit — `"visible"` tenant la place de
    /// l'attribut absent, puisqu'un lecteur tiers compare des mots, pas des
    /// attributs manquants.
    #[must_use]
    pub const fn nom(self) -> &'static str {
        match self {
            Self::Visible => "visible",
            Self::Masquee => "hidden",
            Self::TresMasquee => "veryHidden",
        }
    }
}

/// Une feuille : ses cellules, ses largeurs, ses fusions.
#[derive(Clone, Debug, PartialEq)]
pub struct Feuille {
    /// Le nom, tel qu'Excel l'affiche.
    pub nom: String,
    /// Visible ou masquée.
    pub etat: EtatFeuille,
    /// L'entrée d'archive dont la feuille est tirée.
    pub entree: String,
    /// Les cellules **doivent** être triées par référence : [`Feuille::cellule`]
    /// s'appuie sur une recherche dichotomique. [`lire_feuille`] trie ; une
    /// feuille construite à la main doit le faire aussi.
    pub cellules: Vec<Cellule>,
    /// Les largeurs déclarées.
    pub colonnes: Vec<Colonne>,
    /// Les fusions.
    pub fusions: Vec<Fusion>,
}

impl Feuille {
    /// La cellule à cette référence, si la feuille en porte une.
    #[must_use]
    pub fn cellule(&self, reference: Reference) -> Option<&Cellule> {
        self.cellules
            .binary_search_by(|c| c.reference.cmp(&reference))
            .ok()
            .map(|rang| &self.cellules[rang])
    }

    /// La valeur à cette référence, ou [`Valeur::Vide`].
    #[must_use]
    pub fn valeur(&self, reference: Reference) -> Valeur {
        self.cellule(reference)
            .map_or(Valeur::Vide, |c| c.valeur.clone())
    }

    /// La plage couverte par les cellules : `(début, fin)`, ou `None` si la
    /// feuille est vide. C'est l'équivalent de `!ref` chez SheetJS.
    #[must_use]
    pub fn plage(&self) -> Option<(Reference, Reference)> {
        let premiere = self.cellules.first()?.reference;
        let mut fin = premiere;
        for cellule in &self.cellules {
            if cellule.reference.colonne > fin.colonne {
                fin.colonne = cellule.reference.colonne;
            }
            if cellule.reference.ligne > fin.ligne {
                fin.ligne = cellule.reference.ligne;
            }
        }
        Some((premiere, fin))
    }

    /// La feuille en **texte** : les lignes séparées par des sauts, les cellules
    /// par des tabulations.
    ///
    /// Les trous sont **remplis par des tabulations** : une cellule vide entre
    /// deux cellules pleines ne doit pas décaler la colonne suivante, sans quoi
    /// la grille serait perdue au moment précis où elle sert.
    #[must_use]
    pub fn vers_texte(&self) -> String {
        let Some((debut, fin)) = self.plage() else {
            return String::new();
        };
        let mut sortie = String::new();
        for ligne in debut.ligne..=fin.ligne {
            if ligne > debut.ligne {
                sortie.push('\n');
            }
            let mut morceaux = Vec::new();
            for colonne in debut.colonne..=fin.colonne {
                let valeur = self.valeur(Reference::nouvelle(colonne, ligne));
                morceaux.push(valeur.en_texte());
            }
            // Les cellules vides de FIN de ligne ne sont pas écrites : garder
            // les tabulations finales ferait des lignes qui n'en finissent pas.
            while morceaux.last().is_some_and(|m| m.is_empty()) {
                morceaux.pop();
            }
            sortie.push_str(&morceaux.join("\t"));
        }
        sortie
    }

    /// Le nombre de lignes de la plage couverte.
    #[must_use]
    pub fn nombre_de_lignes(&self) -> usize {
        self.plage()
            .map_or(0, |(debut, fin)| (fin.ligne - debut.ligne + 1) as usize)
    }
}

/// Un classeur : ses feuilles, dans l'ordre du fichier.
#[derive(Clone, Debug, PartialEq)]
pub struct Classeur {
    /// Les feuilles, dans l'ordre de `xl/workbook.xml`.
    pub feuilles: Vec<Feuille>,
    /// Nombre de chaînes partagées lues — sert à dire la taille du fichier lu.
    pub chaines_partagees: usize,
    /// Ce qui n'a **pas** pu être lu fidèlement, dit explicitement.
    pub avertissements: Vec<String>,
}

impl Classeur {
    /// Ouvre un classeur à partir des octets de son fichier.
    ///
    /// # Erreurs
    ///
    /// Voir [`ErreurImport`].
    pub fn depuis_octets(octets: Vec<u8>) -> Result<Self, ErreurImport> {
        let archive = Archive::lire(octets)?;
        Self::lire(&archive)
    }

    /// Ouvre un classeur déjà dépaqueté.
    ///
    /// # Erreurs
    ///
    /// [`ErreurImport::FormatContredit`] si l'archive n'a pas de classeur.
    pub fn lire(archive: &Archive) -> Result<Self, ErreurImport> {
        let Some(entree_classeur) = archive.trouver_souple("xl/workbook.xml") else {
            return Err(ErreurImport::FormatContredit {
                annonce: Format::Xlsx.nom().to_string(),
                trouve: archive
                    .noms()
                    .into_iter()
                    .take(8)
                    .map(str::to_string)
                    .collect(),
            });
        };
        let classeur = xml::analyser(&archive.extraire_texte("xl/workbook.xml")?).map_err(|e| {
            ErreurImport::Xml {
                entree: entree_classeur.nom().to_string(),
                raison: e.to_string(),
            }
        })?;

        let mut avertissements = Vec::new();
        let partagees = lire_chaines_partagees(archive).unwrap_or_else(|erreur| {
            avertissements.push(format!("chaînes partagées non lues : {erreur}"));
            Vec::new()
        });
        let relations = lire_relations(archive);
        if relations.is_empty() {
            avertissements.push(
                "xl/_rels/workbook.xml.rels absent : les feuilles sont prises dans l'ordre des \
                 fichiers de xl/worksheets/, ce qui peut ne pas être l'ordre du classeur"
                    .to_string(),
            );
        }

        let feuilles_xml = lister_feuilles(&classeur);
        let mut feuilles = Vec::with_capacity(feuilles_xml.len());
        for (rang, (nom, etat)) in feuilles_xml.iter().enumerate() {
            let entree = chemin_de_feuille(archive, &relations, rang, feuilles_xml.len());
            match lire_feuille(archive, &entree, nom, *etat, &partagees) {
                Ok(feuille) => feuilles.push(feuille),
                Err(erreur) => avertissements.push(format!("feuille « {nom} » non lue : {erreur}")),
            }
        }
        if feuilles.is_empty() {
            return Err(ErreurImport::SansContenu {
                entree: "xl/worksheets/".to_string(),
            });
        }
        Ok(Self {
            feuilles,
            chaines_partagees: partagees.len(),
            avertissements,
        })
    }

    /// Le **texte** du classeur : les feuilles séparées par une ligne vide, et un
    /// titre par feuille quand il y en a plusieurs.
    ///
    /// C'est la forme sous laquelle un classeur entre dans une composition
    /// aujourd'hui : le modèle sert à composer un tableau, le texte sert à
    /// importer tout de suite.
    #[must_use]
    pub fn vers_texte(&self) -> String {
        let plusieurs = self.feuilles.len() > 1;
        let mut morceaux = Vec::with_capacity(self.feuilles.len());
        for feuille in &self.feuilles {
            let corps = feuille.vers_texte();
            if plusieurs {
                morceaux.push(format!("{}\n{corps}", feuille.nom));
            } else {
                morceaux.push(corps);
            }
        }
        morceaux.join("\n\n")
    }

    /// Le classeur sous la forme d'une [`Memoire`] : **un paragraphe par ligne**,
    /// les cellules séparées par des tabulations.
    ///
    /// Pourquoi un paragraphe par ligne, et pas un par cellule : les trois autres
    /// lecteurs rendent des paragraphes, et c'est ce qu'une composition sait
    /// recevoir. Une ligne de tableur est une ligne ; la grille, elle, est dans
    /// [`Memoire::classeur`], où un composeur de tableaux la trouvera — avec ses
    /// références, ses largeurs et ses fusions, que le texte ne peut pas porter.
    ///
    /// Consomme `self` : les feuilles sont **transférées** dans la mémoire, pas
    /// recopiées. Un classeur de quelques milliers de cellules ne se duplique pas
    /// pour rien.
    #[must_use]
    pub fn en_memoire(self) -> Memoire {
        let plusieurs = self.feuilles.len() > 1;
        let mut paragraphes = Vec::new();
        for feuille in &self.feuilles {
            if plusieurs {
                paragraphes.push(Paragraphe::texte(feuille.nom.clone()));
            }
            for ligne in feuille.vers_texte().split('\n') {
                paragraphes.push(Paragraphe::texte(ligne));
            }
        }
        Memoire {
            format: Format::Xlsx,
            paragraphes,
            // Un classeur n'a pas de format de page : c'est une grille, et c'est
            // la mise en page qui décidera du papier.
            page: None,
            titre: None,
            images: Vec::new(),
            notes: Vec::new(),
            classeur: Some(self),
            avertissements: Vec::new(),
        }
    }
}

/// Les noms et états des feuilles, dans l'ordre de `xl/workbook.xml`.
fn lister_feuilles(classeur: &Element) -> Vec<(String, EtatFeuille)> {
    let mut sortie = Vec::new();
    for feuille in classeur.chercher("sheet") {
        let nom = feuille
            .attribut("name")
            .map_or_else(|| format!("Feuille {}", sortie.len() + 1), str::to_string);
        sortie.push((nom, EtatFeuille::lire(feuille.attribut("state"))));
    }
    sortie
}

/// Le type de relation d'une feuille de calcul, tel qu'OOXML l'écrit.
const TYPE_FEUILLE: &str = "/worksheet";

/// Les relations du classeur : identifiant → cible.
fn lire_relations(archive: &Archive) -> Vec<(String, String)> {
    let Ok(texte) = archive.extraire_texte("xl/_rels/workbook.xml.rels") else {
        return Vec::new();
    };
    let Ok(racine) = xml::analyser(&texte) else {
        return Vec::new();
    };
    let mut sortie = Vec::new();
    for relation in racine.chercher("Relationship") {
        let Some(cible) = relation.attribut("Target") else {
            continue;
        };
        // On ne garde que les feuilles de calcul : les relations portent aussi
        // les styles, les chaînes partagées et le thème, et prendre la première
        // venue donnerait une feuille qui n'en est pas une.
        let genre = relation.attribut("Type").unwrap_or_default();
        if !genre.ends_with(TYPE_FEUILLE) {
            continue;
        }
        let id = relation.attribut("Id").unwrap_or_default().to_string();
        sortie.push((id, normaliser_cible(cible)));
    }
    sortie
}

/// Le chemin d'une feuille dans l'archive, à partir de son rang.
///
/// L'ordre est celui du classeur : on prend la cible de la relation quand elle
/// existe, et sinon le fichier de même rang — en le disant (l'avertissement est
/// posé par l'appelant).
fn chemin_de_feuille(
    archive: &Archive,
    relations: &[(String, String)],
    rang: usize,
    total: usize,
) -> String {
    if let Some((_, cible)) = relations.get(rang) {
        if archive.trouver_souple(cible).is_some() {
            return cible.clone();
        }
    }
    // Repli : les fichiers de `xl/worksheets/`, dans l'ordre des noms. Excel les
    // écrit `sheet1.xml`, `sheet2.xml`… mais l'ordre n'est garanti par rien, et
    // c'est pourquoi ce chemin est un **repli** et non la règle.
    let mut fichiers: Vec<String> = archive
        .noms()
        .into_iter()
        .filter(|nom| nom.starts_with("xl/worksheets/") && nom.ends_with(".xml"))
        .map(str::to_string)
        .collect();
    fichiers.sort();
    fichiers
        .get(rang.min(total.saturating_sub(1)))
        .cloned()
        .unwrap_or_else(|| format!("xl/worksheets/sheet{}.xml", rang + 1))
}

/// Une cible de relation, ramenée à un chemin d'archive.
///
/// Les cibles sont relatives à `xl/`, et peuvent commencer par `/` (racine de
/// l'archive) ou par `../`.
fn normaliser_cible(cible: &str) -> String {
    if let Some(chemin) = cible.strip_prefix('/') {
        return chemin.to_string();
    }
    let mut morceaux: Vec<&str> = vec!["xl"];
    for morceau in cible.split('/') {
        match morceau {
            "." | "" => {}
            ".." => {
                morceaux.pop();
            }
            autre => morceaux.push(autre),
        }
    }
    morceaux.join("/")
}

/// Les chaînes partagées, dans l'ordre de leurs index.
fn lire_chaines_partagees(archive: &Archive) -> Result<Vec<String>, String> {
    let Ok(texte) = archive.extraire_texte("xl/sharedStrings.xml") else {
        return Ok(Vec::new());
    };
    let racine = xml::analyser(&texte).map_err(|e| e.to_string())?;
    let mut sortie = Vec::new();
    for chaine in racine.chercher("si") {
        // Un `si` peut être fait de plusieurs morceaux `r/t` : c'est le cas
        // d'une cellule dont une partie seulement est en gras. Les concaténer
        // dans l'ordre est la seule lecture correcte.
        let mut morceaux = Vec::new();
        for t in chaine.chercher("t") {
            morceaux.push(t.texte());
        }
        sortie.push(morceaux.concat());
    }
    Ok(sortie)
}

/// Lit une feuille : cellules, largeurs, fusions.
fn lire_feuille(
    archive: &Archive,
    entree: &str,
    nom: &str,
    etat: EtatFeuille,
    partagees: &[String],
) -> Result<Feuille, ErreurImport> {
    let texte = archive.extraire_texte(entree)?;
    let racine = xml::analyser(&texte).map_err(|e| ErreurImport::Xml {
        entree: entree.to_string(),
        raison: e.to_string(),
    })?;

    let mut cellules = Vec::new();
    for ligne in racine.chercher("row") {
        let numero_ligne = ligne.attribut("r").and_then(|r| r.parse::<u32>().ok());
        for (rang, c) in ligne.chercher("c").iter().enumerate() {
            if let Some(cellule) = lire_cellule(c, numero_ligne, rang, partagees) {
                cellules.push(cellule);
            }
        }
    }
    // L'ordre du fichier n'est pas garanti (des lignes peuvent être écrites dans
    // le désordre, et l'index de colonne n'est pas toujours croissant) : on trie,
    // une fois, pour que `cellule()` puisse faire une recherche dichotomique.
    cellules.sort_by_key(|c| c.reference);
    cellules.dedup_by(|a, b| a.reference == b.reference);

    let colonnes = racine
        .chercher("col")
        .iter()
        .filter_map(|c| lire_colonne(c))
        .collect();
    let fusions = racine
        .chercher("mergeCell")
        .iter()
        .filter_map(|m| lire_fusion(m))
        .collect();

    Ok(Feuille {
        nom: nom.to_string(),
        etat,
        entree: entree.to_string(),
        cellules,
        colonnes,
        fusions,
    })
}

/// Lit une cellule `<c>`, ou `None` si sa référence est illisible.
fn lire_cellule(
    c: &Element,
    numero_ligne: Option<u32>,
    rang: usize,
    partagees: &[String],
) -> Option<Cellule> {
    // La référence est la source de vérité ; `r` de la ligne et le rang servent
    // de repli quand elle manque, ce qui arrive dans des fichiers engendrés à la
    // main.
    let reference = c
        .attribut("r")
        .and_then(Reference::lire)
        .or_else(|| numero_ligne.map(|l| Reference::nouvelle(rang as u32, l.saturating_sub(1))))?;

    let genre = c.attribut("t").unwrap_or("n");
    let valeur = match genre {
        "s" => {
            // Chaîne partagée : la valeur est un INDEX. Un index hors bornes est
            // une erreur du fichier, pas une cellule vide — on le dit.
            let index = c.enfant("v").map(|v| v.texte()).unwrap_or_default();
            match index
                .trim()
                .parse::<usize>()
                .ok()
                .and_then(|i| partagees.get(i))
            {
                Some(texte) => Valeur::Texte(texte.clone()),
                None => Valeur::Erreur(format!("#CHAINE-{index}")),
            }
        }
        "inlineStr" => Valeur::Texte(
            c.enfant("is")
                .map(|is| {
                    is.chercher("t")
                        .iter()
                        .map(|t| t.texte())
                        .collect::<Vec<_>>()
                        .concat()
                })
                .unwrap_or_default(),
        ),
        "str" => Valeur::Texte(c.enfant("v").map_or_else(String::new, |v| v.texte())),
        "b" => Valeur::Booleen(
            c.enfant("v")
                .map(|v| v.texte().trim() == "1")
                .unwrap_or(false),
        ),
        "e" => Valeur::Erreur(c.enfant("v").map_or_else(String::new, |v| v.texte())),
        "d" => Valeur::Texte(c.enfant("v").map_or_else(String::new, |v| v.texte())),
        _ => {
            // Nombre : c'est le défaut d'un `<c>` sans `t`. Un `<v>` absent veut
            // dire une cellule sans valeur (formule sans cache, ou style seul),
            // et c'est `Vide` — pas zéro, qui serait un mensonge.
            match c.enfant("v") {
                Some(v) => {
                    let brut = v.texte();
                    match brut.trim().parse::<f64>() {
                        Ok(nombre) => Valeur::Nombre(nombre),
                        Err(_) => Valeur::Texte(brut),
                    }
                }
                None => Valeur::Vide,
            }
        }
    };
    Some(Cellule { reference, valeur })
}

/// Lit une largeur de colonne `<col>`.
fn lire_colonne(c: &Element) -> Option<Colonne> {
    let nombre = |nom: &str| c.attribut(nom).and_then(|v| v.trim().parse::<u32>().ok());
    let premiere = nombre("min")?;
    let derniere = nombre("max")?;
    if premiere == 0 || derniere < premiere {
        return None;
    }
    let largeur = c
        .attribut("width")
        .and_then(|v| v.trim().parse::<f64>().ok())
        .unwrap_or(0.0);
    let masquee = c
        .attribut("hidden")
        .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
    Some(Colonne {
        premiere: premiere - 1,
        derniere: derniere - 1,
        largeur,
        masquee,
    })
}

/// Lit une fusion `<mergeCell ref="A1:B2"/>`.
fn lire_fusion(m: &Element) -> Option<Fusion> {
    let (debut, fin) = m.attribut("ref")?.split_once(':')?;
    Some(Fusion {
        debut: Reference::lire(debut)?,
        fin: Reference::lire(fin)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn une_reference_se_lit_et_s_ecrit() {
        for (texte, colonne, ligne) in [
            ("A1", 0u32, 0u32),
            ("B12", 1, 11),
            ("Z1", 25, 0),
            ("AA1", 26, 0),
            ("AB1048576", 27, 1048575),
        ] {
            let reference = Reference::lire(texte).unwrap_or_else(|| panic!("{texte}"));
            assert_eq!(
                reference,
                Reference::nouvelle(colonne, ligne),
                "{texte} → {colonne},{ligne}"
            );
            assert_eq!(reference.a1(), texte, "aller-retour");
        }
    }

    /// Les `$` des références absolues sont tolérés : c'est la même cellule.
    #[test]
    fn les_dollars_sont_ignores() {
        assert_eq!(Reference::lire("$A$1"), Some(Reference::nouvelle(0, 0)));
        assert_eq!(Reference::lire("$B12"), Some(Reference::nouvelle(1, 11)));
    }

    /// Ce qui n'est pas une référence est refusé, et non deviné.
    #[test]
    fn une_reference_illisible_est_refusee() {
        for texte in ["", "A", "1", "1A", "A0", "-A1", "A1B", "a1", "A 1", "AA"] {
            assert!(
                Reference::lire(texte).is_none(),
                "« {texte} » doit être refusé"
            );
        }
    }

    /// La colonne suit la numération bijective : après `Z` vient `AA`, pas `BA`.
    /// Les références sont écrites ici en ligne 1 pour ne faire varier que la colonne.
    #[test]
    fn la_numeration_des_colonnes_est_bijective() {
        let vingt_sept = Reference::nouvelle(26, 0);
        assert_eq!(vingt_sept.a1(), "AA1");
        assert_eq!(Reference::nouvelle(51, 0).a1(), "AZ1");
        assert_eq!(Reference::nouvelle(52, 0).a1(), "BA1");
        assert_eq!(Reference::nouvelle(701, 0).a1(), "ZZ1");
        assert_eq!(Reference::nouvelle(702, 0).a1(), "AAA1");
    }

    fn feuille_de(cellules: &[(&str, Valeur)]) -> Feuille {
        let mut cellules: Vec<Cellule> = cellules
            .iter()
            .map(|(a1, valeur)| Cellule {
                reference: Reference::lire(a1).unwrap(),
                valeur: valeur.clone(),
            })
            .collect();
        // Une feuille lue est triée ; une feuille d'essai doit l'être aussi,
        // sinon on éprouverait un objet qui n'existe pas.
        cellules.sort_by_key(|c| c.reference);
        Feuille {
            nom: "Essai".to_string(),
            etat: EtatFeuille::Visible,
            entree: "xl/worksheets/sheet1.xml".to_string(),
            cellules,
            colonnes: Vec::new(),
            fusions: Vec::new(),
        }
    }

    /// Les trous sont remplis par des tabulations, sinon la grille serait perdue
    /// au moment où elle sert.
    #[test]
    fn le_texte_garde_les_colonnes() {
        let feuille = feuille_de(&[
            ("A1", Valeur::Texte("Article".into())),
            ("C1", Valeur::Texte("Prix".into())),
            ("A2", Valeur::Texte("Reliure".into())),
            ("C2", Valeur::Nombre(12.0)),
            // `B2` est vide : la colonne du prix doit rester la troisième.
        ]);
        assert_eq!(feuille.vers_texte(), "Article\t\tPrix\nReliure\t\t12");
    }

    /// Les cellules vides de fin de ligne ne sont pas écrites : une ligne ne doit
    /// pas finir par une tabulation.
    #[test]
    fn les_trous_de_fin_de_ligne_sont_retires() {
        let feuille = feuille_de(&[
            ("A1", Valeur::Texte("seul".into())),
            ("C1", Valeur::Texte("loin".into())),
            ("A2", Valeur::Texte("court".into())),
        ]);
        assert_eq!(feuille.vers_texte(), "seul\t\tloin\ncourt");
    }

    /// Une feuille vide ne rend rien, et sa plage est absente.
    #[test]
    fn une_feuille_vide_ne_rend_rien() {
        let feuille = feuille_de(&[]);
        assert_eq!(feuille.vers_texte(), "");
        assert!(feuille.plage().is_none());
        assert_eq!(feuille.nombre_de_lignes(), 0);
    }

    /// La plage couvre l'ensemble, trous compris — c'est ce que SheetJS appelle
    /// `!ref`, et c'est ce qui décide des lignes et colonnes écrites.
    #[test]
    fn la_plage_couvre_les_trous() {
        let feuille = feuille_de(&[("B2", Valeur::Nombre(1.0)), ("D5", Valeur::Nombre(2.0))]);
        let (debut, fin) = feuille.plage().unwrap();
        assert_eq!(debut.a1(), "B2");
        assert_eq!(fin.a1(), "D5");
        assert_eq!(feuille.nombre_de_lignes(), 4);
    }

    /// L'état d'une feuille se lit tel qu'Excel l'écrit.
    #[test]
    fn l_etat_des_feuilles() {
        assert_eq!(EtatFeuille::lire(None), EtatFeuille::Visible);
        assert_eq!(EtatFeuille::lire(Some("visible")), EtatFeuille::Visible);
        assert_eq!(EtatFeuille::lire(Some("hidden")), EtatFeuille::Masquee);
        assert_eq!(
            EtatFeuille::lire(Some("veryHidden")),
            EtatFeuille::TresMasquee
        );
    }

    /// Les cibles de relation sont relatives à `xl/` : elles montent et
    /// redescendent.
    #[test]
    fn les_cibles_de_relation_sont_normalisees() {
        assert_eq!(
            normaliser_cible("worksheets/sheet1.xml"),
            "xl/worksheets/sheet1.xml"
        );
        assert_eq!(
            normaliser_cible("/xl/worksheets/sheet2.xml"),
            "xl/worksheets/sheet2.xml"
        );
        assert_eq!(
            normaliser_cible("../xl/worksheets/sheet1.xml"),
            "xl/worksheets/sheet1.xml"
        );
    }

    /// Un booléen s'écrit comme Excel l'écrit.
    #[test]
    fn les_valeurs_en_texte() {
        assert_eq!(Valeur::Booleen(true).en_texte(), "VRAI");
        assert_eq!(Valeur::Booleen(false).en_texte(), "FAUX");
        assert_eq!(Valeur::Nombre(12.0).en_texte(), "12");
        assert_eq!(Valeur::Nombre(3.5).en_texte(), "3.5");
        assert_eq!(Valeur::Vide.en_texte(), "");
    }

    /// Une cellule se cherche par sa référence, et une référence absente rend
    /// `Vide` — pas zéro.
    #[test]
    fn une_cellule_absente_est_vide() {
        let feuille = feuille_de(&[("B2", Valeur::Nombre(7.0))]);
        assert_eq!(
            feuille
                .cellule(Reference::lire("B2").unwrap())
                .map(|c| c.valeur.clone()),
            Some(Valeur::Nombre(7.0))
        );
        assert_eq!(feuille.valeur(Reference::lire("A1").unwrap()), Valeur::Vide);
    }
}
