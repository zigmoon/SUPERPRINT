//! Analyseur XML minimal, sans dépendance.
//!
//! ## Pourquoi écrit à la main
//!
//! Un `.docx`, un `.odt` et un `.idml` contiennent du XML, et le noyau n'a le
//! droit à aucune dépendance externe. Écrire un analyseur XML **complet** serait
//! un projet en soi ; celui-ci est **suffisant pour ces trois formats**, et il
//! le dit : il ne fait ni validation de schéma, ni espaces de noms résolus, ni
//! entités externes.
//!
//! ## Ce qui est lu
//!
//! | Élément | État |
//! |---|---|
//! | Déclaration `<?xml … ?>`, commentaires, sections `CDATA` | ✅ ignorés proprement |
//! | Attributs entre guillemets simples ou doubles, `>` dans une valeur | ✅ |
//! | Entités `&amp;` `&lt;` `&gt;` `&quot;` `&apos;` | ✅ les cinq du XML |
//! | Entités numériques `&#160;` et `&#x2019;` | ✅ |
//! | Quelques entités nommées du HTML (`&nbsp;`, `&mdash;`…) | ✅ et **listées** : XML ne les définit pas, mais les documents réels en contiennent |
//! | Préfixes d'espace de noms (`w:`, `text:`, `fo:`…) | ✅ conservés tels quels |
//! | **Déclarations `<!ENTITY nom "valeur">` du sous-ensemble interne** | ✅ résolues, et c'est **nécessaire** : Illustrator écrit `xmlns:x="&ns_extend;"` dans ses SVG |
//! | Entité qui s'appelle elle-même, ou cycle entre entités | ❌ **refusées** ([`ErreurXml::EntiteRecursive`]) |
//! | Entités externes (`SYSTEM`, `PUBLIC`) | ❌ **refusées** : une entité externe est un accès au réseau ou au disque |
//! | Entité paramètre (`<!ENTITY % …>`, `%nom;`) | ❌ **non étendues** : elles décrivent la grammaire du DTD, pas le contenu du document |
//!
//! ## Comment on désigne un élément
//!
//! Le préfixe est **conservé** dans [`Element::nom`], et les recherches
//! comparent d'abord le nom complet, puis le nom local. C'est ce qui permet
//! d'écrire `est("w:p")` — précis — ou `est("p")` — tolérant — selon ce qu'on
//! veut. Le contenu mixte (texte **et** éléments) est conservé dans l'ordre,
//! parce que l'ordre d'un texte et de ses éléments de mise en forme est le
//! document lui-même.

use std::fmt;

/// Profondeur maximale d'imbrication.
///
/// Un document hostile peut imbriquer mille balises pour faire déborder la pile
/// du récursif. Refuser au-delà de cette profondeur est plus utile que de
/// planter : aucun document de traitement de texte réel n'atteint 128 niveaux.
pub const PROFONDEUR_MAX: usize = 128;

/// Nombre maximal d'entités déclarées que le sous-ensemble interne peut porter.
///
/// Les fichiers réels en déclarent une poignée (Illustrator : huit, pour ses
/// espaces de noms). Un document qui en déclare des milliers n'est pas une mise
/// en page ; c'est un fichier hostile, et la table d'entités est le bon endroit
/// pour le dire.
pub const ENTITES_MAX: usize = 256;

/// Profondeur maximale de développement d'une entité.
///
/// `<!ENTITY a "&b;">` est licite ; `<!ENTITY a "&a;">` ne l'est pas. Une borne
/// explicite évite d'avoir à démontrer l'absence de cycle.
pub const ENTITES_PROFONDEUR_MAX: usize = 8;

/// ERREUR D'ANALYSE
///
/// Ce qu'on ne peut pas lire est dit, avec sa position.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErreurXml {
    /// Une balise ouvrante n'a pas été fermée.
    BaliseNonFermee {
        /// Nom de la balise.
        nom: String,
        /// Rang du caractère où elle a été ouverte.
        position: usize,
    },
    /// Une balise fermante ne correspond à aucune balise ouverte.
    BaliseOrpheline {
        /// Nom de la balise.
        nom: String,
        /// Rang du caractère.
        position: usize,
    },
    /// Le document s'arrête au milieu d'une balise.
    FinInattendue {
        /// Rang du caractère.
        position: usize,
    },
    /// Une valeur d'attribut n'est pas refermée.
    GuillemetManquant {
        /// Nom de l'attribut.
        attribut: String,
        /// Rang du caractère.
        position: usize,
    },
    /// Une entité n'est pas connue.
    EntiteInconnue {
        /// Ce qui suivait le `&`.
        nom: String,
    },
    /// Une entité numérique ne contient pas un point de code valide.
    EntiteNumeriqueInvalide {
        /// Ce qui suivait le `&`.
        nom: String,
    },
    /// Le document imbrique plus de [`PROFONDEUR_MAX`] balises.
    TropProfond,
    /// Une déclaration `<!ENTITY nom SYSTEM "…">` désigne une ressource
    /// extérieure : entité **refusée**.
    ///
    /// Une entité externe est un accès au réseau ou au disque déclenché par le
    /// contenu d'un fichier. Un import de document n'a jamais besoin de cela.
    EntiteExterne {
        /// Nom de l'entité déclarée.
        nom: String,
    },
    /// Le sous-ensemble interne déclare plus de [`ENTITES_MAX`] entités.
    TropDEntites {
        /// Nombre de déclarations lues avant de refuser.
        compte: usize,
    },
    /// Une entité se référence elle-même, directement ou par un cycle.
    EntiteRecursive {
        /// Nom de l'entité qui boucle.
        nom: String,
    },
    /// Aucun élément racine n'a été trouvé.
    SansRacine,
}

impl fmt::Display for ErreurXml {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::BaliseNonFermee { nom, position } => {
                write!(f, "balise <{nom}> ouverte au caractère {position} et jamais fermée")
            }
            Self::BaliseOrpheline { nom, position } => {
                write!(f, "balise </{nom}> fermante au caractère {position}, sans ouverture")
            }
            Self::FinInattendue { position } => {
                write!(f, "le document s'arrête au milieu d'une balise (caractère {position})")
            }
            Self::GuillemetManquant { attribut, position } => write!(
                f,
                "la valeur de l'attribut {attribut} (caractère {position}) n'est pas refermée"
            ),
            Self::EntiteInconnue { nom } => write!(f, "entité inconnue : &{nom};"),
            Self::EntiteNumeriqueInvalide { nom } => {
                write!(f, "entité numérique invalide : &{nom};")
            }
            Self::TropProfond => write!(
                f,
                "document imbriqué à plus de {PROFONDEUR_MAX} niveaux : refusé plutôt que d'épuiser la pile"
            ),
            Self::EntiteExterne { nom } => write!(
                f,
                "l'entité {nom} est déclarée avec SYSTEM ou PUBLIC : une entité externe est \
                 un accès au réseau ou au disque, hors du sujet d'un import"
            ),
            Self::TropDEntites { compte } => write!(
                f,
                "plus de {ENTITES_MAX} entités déclarées ({compte} lues) : refusé plutôt que \
                 de croire à un document de mise en page"
            ),
            Self::EntiteRecursive { nom } => write!(
                f,
                "l'entité {nom} se référence elle-même : le développement ne s'arrêterait jamais"
            ),
            Self::SansRacine => write!(f, "aucun élément racine dans le document"),
        }
    }
}

impl std::error::Error for ErreurXml {}

/// Les entités générales déclarées par le sous-ensemble interne du `DOCTYPE`.
///
/// ## Pourquoi ce n'est pas un détail
///
/// Illustrator écrit ses espaces de noms en entités :
///
/// ```text
/// <!DOCTYPE svg PUBLIC "…" "http://…/svg11-basic.dtd" [
///   <!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
///   <!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
/// ]>
/// <svg xmlns:x="&ns_extend;" xmlns:i="&ns_ai;" …>
/// ```
///
/// Sans ces déclarations, `&ns_extend;` est une **entité inconnue** et le
/// fichier est refusé. Et ce ne sont pas des fichiers exotiques : ce sont les
/// deux logos du dépôt (`icons/sper_typo.svg`, `icons/studio_print_logo_blanc.svg`).
///
/// ## Ce que la table ne fait pas
///
/// - les entités **externes** (`SYSTEM`, `PUBLIC`) sont refusées à la
///   déclaration ([`ErreurXml::EntiteExterne`]) ;
/// - les entités **paramètre** (`%nom;`) ne sont pas étendues : elles décrivent
///   la grammaire du DTD, jamais le contenu du document ;
/// - un cycle est refusé ([`ErreurXml::EntiteRecursive`]) au lieu de boucler.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct Entites {
    declarations: Vec<(String, String)>,
}

impl Entites {
    /// Le nombre d'entités déclarées.
    #[must_use]
    pub fn nombre(&self) -> usize {
        self.declarations.len()
    }

    /// Les noms déclarés, dans l'ordre du document.
    pub fn noms(&self) -> impl Iterator<Item = &str> {
        self.declarations.iter().map(|(nom, _)| nom.as_str())
    }

    /// La valeur d'une entité, `&autre;` internes déjà développés.
    ///
    /// Rend `None` si le développement boucle ou dépasse
    /// [`ENTITES_PROFONDEUR_MAX`]. Une référence à une entité **inconnue** est
    /// laissée telle quelle : c'est [`resoudre_entites_avec`] qui la signalera,
    /// avec le nom fautif.
    #[must_use]
    pub fn valeur(&self, nom: &str) -> Option<String> {
        let mut courant = self.valeur_simple(nom)?.to_string();
        let mut vus: Vec<String> = vec![nom.to_string()];
        for _ in 0..ENTITES_PROFONDEUR_MAX {
            let caracteres: Vec<char> = courant.chars().collect();
            let mut suivant = String::with_capacity(courant.len());
            let mut i = 0usize;
            let mut reference = false;
            while i < caracteres.len() {
                if caracteres[i] == '&' {
                    if let Some((nom_suivant, fin)) = lire_reference(&caracteres, i) {
                        if let Some(valeur) = self.valeur_simple(&nom_suivant) {
                            if vus.contains(&nom_suivant) {
                                return None;
                            }
                            vus.push(nom_suivant);
                            suivant.push_str(valeur);
                            reference = true;
                            i = fin;
                            continue;
                        }
                    }
                }
                suivant.push(caracteres[i]);
                i += 1;
            }
            if !reference {
                return Some(suivant);
            }
            courant = suivant;
        }
        None
    }

    fn valeur_simple(&self, nom: &str) -> Option<&str> {
        self.declarations
            .iter()
            .find(|(n, _)| n == nom)
            .map(|(_, v)| v.as_str())
    }
}

/// Lit le nom d'une entité à la position d'un `&`, et rend la position après le
/// `;`.
fn lire_reference(caracteres: &[char], position: usize) -> Option<(String, usize)> {
    let mut i = position + 1;
    while i < caracteres.len() && caracteres[i] != ';' && caracteres[i] != '&' && i - position < 41
    {
        i += 1;
    }
    if i >= caracteres.len() || caracteres[i] != ';' || i == position + 1 {
        return None;
    }
    Some((caracteres[position + 1..i].iter().collect(), i + 1))
}

/// Un nœud de l'arbre : un élément, ou du texte.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum Noeud {
    /// Une balise, avec ses attributs et ses enfants.
    Element(Element),
    /// Du texte, entités déjà résolues.
    Texte(String),
}

/// Un élément XML.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Element {
    /// Nom complet, préfixe compris (`w:p`, `text:span`).
    pub nom: String,
    /// Attributs, dans l'ordre du document, préfixe compris.
    pub attributs: Vec<(String, String)>,
    /// Enfants, dans l'ordre du document.
    pub enfants: Vec<Noeud>,
}

impl Element {
    /// Le nom sans son préfixe.
    #[must_use]
    pub fn local(&self) -> &str {
        match self.nom.split_once(':') {
            Some((_, local)) => local,
            None => &self.nom,
        }
    }

    /// Le préfixe, s'il y en a un.
    #[must_use]
    pub fn prefixe(&self) -> Option<&str> {
        self.nom.split_once(':').map(|(prefixe, _)| prefixe)
    }

    /// L'élément porte-t-il ce nom ?
    ///
    /// Le nom **complet** est comparé d'abord ; s'il ne correspond pas, le nom
    /// **local** est comparé. Ainsi `est("w:p")` est précis et `est("p")`
    /// tolérant au préfixe — ce qui est utile parce que le même format s'écrit
    /// avec des préfixes différents selon l'outil qui l'a produit.
    #[must_use]
    pub fn est(&self, nom: &str) -> bool {
        self.nom == nom || self.local() == nom
    }

    /// La valeur d'un attribut.
    ///
    /// Même règle que [`Element::est`] : nom complet d'abord, nom local ensuite.
    #[must_use]
    pub fn attribut(&self, nom: &str) -> Option<&str> {
        self.attributs
            .iter()
            .find(|(cle, _)| cle == nom)
            .or_else(|| {
                self.attributs
                    .iter()
                    .find(|(cle, _)| cle.split_once(':').map(|(_, l)| l).unwrap_or(cle) == nom)
            })
            .map(|(_, valeur)| valeur.as_str())
    }

    /// Les enfants qui sont des éléments.
    pub fn elements(&self) -> impl Iterator<Item = &Element> {
        self.enfants.iter().filter_map(|n| match n {
            Noeud::Element(e) => Some(e),
            Noeud::Texte(_) => None,
        })
    }

    /// Le premier enfant élément portant ce nom.
    #[must_use]
    pub fn enfant(&self, nom: &str) -> Option<&Element> {
        self.elements().find(|e| e.est(nom))
    }

    /// Tous les descendants portant ce nom, en profondeur d'abord, dans l'ordre
    /// du document.
    #[must_use]
    pub fn chercher(&self, nom: &str) -> Vec<&Element> {
        let mut trouves = Vec::new();
        self.chercher_dans(nom, &mut trouves);
        trouves
    }

    fn chercher_dans<'a>(&'a self, nom: &str, trouves: &mut Vec<&'a Element>) {
        for enfant in self.elements() {
            if enfant.est(nom) {
                trouves.push(enfant);
            }
            enfant.chercher_dans(nom, trouves);
        }
    }

    /// Tout le texte sous cet élément, concaténé dans l'ordre du document.
    #[must_use]
    pub fn texte(&self) -> String {
        let mut sortie = String::new();
        self.texte_dans(&mut sortie);
        sortie
    }

    fn texte_dans(&self, sortie: &mut String) {
        for enfant in &self.enfants {
            match enfant {
                Noeud::Texte(t) => sortie.push_str(t),
                Noeud::Element(e) => e.texte_dans(sortie),
            }
        }
    }

    /// Les enfants, dans l'ordre, texte et éléments mêlés.
    #[must_use]
    pub fn contenu(&self) -> &[Noeud] {
        &self.enfants
    }

    /// Nombre d'éléments descendants.
    #[must_use]
    pub fn nombre_d_elements(&self) -> usize {
        self.elements().map(|e| 1 + e.nombre_d_elements()).sum()
    }
}

/// Analyse un document XML et rend son élément racine.
///
/// # Erreurs
///
/// Voir [`ErreurXml`].
pub fn analyser(texte: &str) -> Result<Element, ErreurXml> {
    analyser_avec_entites(texte).map(|(racine, _)| racine)
}

/// Analyse un document XML et rend son élément racine **et** les entités
/// générales qu'il déclare.
///
/// C'est la même analyse que [`analyser`], à ceci près qu'elle rend aussi la
/// table des entités : utile pour dire, dans un rapport d'import, ce que le
/// document exigeait.
///
/// # Erreurs
///
/// Voir [`ErreurXml`].
pub fn analyser_avec_entites(texte: &str) -> Result<(Element, Entites), ErreurXml> {
    let octets: Vec<char> = texte.chars().collect();
    let mut position = 0usize;
    let mut racine: Option<Element> = None;
    let mut entites = Entites::default();
    loop {
        ignorer_bruit(&octets, &mut position, &mut entites)?;
        if position >= octets.len() {
            break;
        }
        if octets[position] != '<' {
            // Du texte hors de toute balise : le XML n'en veut pas, mais
            // certains fichiers réels en ont (espaces). On l'ignore s'il est
            // blanc, on s'arrête sinon.
            let debut = position;
            while position < octets.len() && octets[position] != '<' {
                position += 1;
            }
            let blanc = octets[debut..position].iter().all(|c| c.is_whitespace());
            if !blanc && racine.is_none() {
                return Err(ErreurXml::SansRacine);
            }
            continue;
        }
        if racine.is_some() {
            // Un deuxième élément racine : le XML bien formé n'en admet qu'un.
            return Err(ErreurXml::SansRacine);
        }
        let (element, suivante) = lire_element(&octets, position, 0, &entites)?;
        racine = Some(element);
        position = suivante;
    }
    racine
        .map(|racine| (racine, entites))
        .ok_or(ErreurXml::SansRacine)
}

/// Saute ce qui n'apporte rien : déclaration, commentaires, doctype.
///
/// Le `DOCTYPE` n'est pas seulement sauté : son **sous-ensemble interne** est
/// lu, parce que c'est là que les entités générales sont déclarées
/// ([`Entites`]).
fn ignorer_bruit(
    octets: &[char],
    position: &mut usize,
    entites: &mut Entites,
) -> Result<(), ErreurXml> {
    loop {
        while *position < octets.len() && octets[*position].is_whitespace() {
            *position += 1;
        }
        if *position + 1 >= octets.len() || octets[*position] != '<' {
            return Ok(());
        }
        let suivant = octets[*position + 1];
        // `<?xml …?>` et `<?autre …?>` : on va jusqu'au `?>`.
        if suivant == '?' {
            let mut i = *position + 2;
            while i + 1 < octets.len() && !(octets[i] == '?' && octets[i + 1] == '>') {
                i += 1;
            }
            *position = (i + 2).min(octets.len());
            continue;
        }
        // `<!-- … -->`
        if suivant == '!' && octets.get(*position + 2) == Some(&'-') {
            let mut i = *position + 4;
            while i + 2 < octets.len()
                && !(octets[i] == '-' && octets[i + 1] == '-' && octets[i + 2] == '>')
            {
                i += 1;
            }
            *position = (i + 3).min(octets.len());
            continue;
        }
        // `<!DOCTYPE …>` — ses entités générales sont lues, le reste est sauté.
        if suivant == '!' {
            *position = lire_doctype(octets, *position, entites)?;
            continue;
        }
        return Ok(());
    }
}

/// Lit un `<!DOCTYPE …>`, enregistre ses entités générales et rend la position
/// qui suit le `>` final.
///
/// Le sous-ensemble interne est délimité par `[` … `]`. Il est parcouru
/// déclaration par déclaration ; ce qui n'est pas une `<!ENTITY>` (`<!ELEMENT>`,
/// `<!ATTLIST>`, commentaire, instruction) est sauté sans être interprété.
fn lire_doctype(octets: &[char], depart: usize, entites: &mut Entites) -> Result<usize, ErreurXml> {
    // 1. Trouver la fin de la déclaration, `[` … `]` compris.
    let mut i = depart + 2;
    let mut crochets = 0usize;
    let mut fin_sous_ensemble: Option<(usize, usize)> = None;
    let mut guillemet: Option<char> = None;
    while i < octets.len() {
        let c = octets[i];
        if let Some(q) = guillemet {
            if c == q {
                guillemet = None;
            }
            i += 1;
            continue;
        }
        match c {
            '"' | '\'' => guillemet = Some(c),
            '[' => {
                if crochets == 0 {
                    fin_sous_ensemble = Some((i, 0));
                }
                crochets += 1;
            }
            ']' => {
                if crochets == 1 {
                    if let Some((debut, _)) = fin_sous_ensemble {
                        fin_sous_ensemble = Some((debut, i));
                    }
                }
                crochets = crochets.saturating_sub(1);
            }
            '>' if crochets == 0 => {
                i += 1;
                break;
            }
            _ => {}
        }
        i += 1;
    }
    let apres = i.min(octets.len());

    // 2. Lire les déclarations du sous-ensemble interne, s'il y en a un.
    if let Some((debut, fin)) = fin_sous_ensemble {
        if fin > debut {
            lire_sous_ensemble(octets, debut + 1, fin, entites)?;
        }
    }
    Ok(apres)
}

/// Lit les déclarations d'entité générale d'un sous-ensemble interne.
fn lire_sous_ensemble(
    octets: &[char],
    debut: usize,
    fin: usize,
    entites: &mut Entites,
) -> Result<(), ErreurXml> {
    let mut i = debut;
    while i < fin {
        // Sauter ce qui n'est pas une déclaration : espaces, commentaires,
        // instructions, `%param;`.
        if octets[i].is_whitespace() {
            i += 1;
            continue;
        }
        if octets[i] != '<' {
            i += 1;
            continue;
        }
        if octets.get(i + 1) == Some(&'!') && octets.get(i + 2) == Some(&'-') {
            let mut j = i + 4;
            while j + 2 < fin && !(octets[j] == '-' && octets[j + 1] == '-' && octets[j + 2] == '>')
            {
                j += 1;
            }
            i = (j + 3).min(fin);
            continue;
        }
        if octets.get(i + 1) == Some(&'?') {
            let mut j = i + 2;
            while j + 1 < fin && !(octets[j] == '?' && octets[j + 1] == '>') {
                j += 1;
            }
            i = (j + 2).min(fin);
            continue;
        }
        if !mot_suit(octets, i + 2, "ENTITY", fin) {
            // `<!ELEMENT …>`, `<!ATTLIST …>`, `<!NOTATION …>` : sautés jusqu'au
            // `>`, guillemets respectés.
            let mut j = i + 2;
            let mut guillemet: Option<char> = None;
            while j < fin {
                let c = octets[j];
                if let Some(q) = guillemet {
                    if c == q {
                        guillemet = None;
                    }
                } else if c == '"' || c == '\'' {
                    guillemet = Some(c);
                } else if c == '>' {
                    break;
                }
                j += 1;
            }
            i = (j + 1).min(fin);
            continue;
        }
        // `<!ENTITY …>` : le nom, puis la valeur.
        let mut j = i + "<!ENTITY".len();
        while j < fin && octets[j].is_whitespace() {
            j += 1;
        }
        if octets.get(j) == Some(&'%') {
            // Entité paramètre : elle décrit la grammaire du DTD, pas le
            // contenu du document. Sautée, jamais étendue.
            let mut k = j;
            while k < fin && octets[k] != '>' {
                k += 1;
            }
            i = (k + 1).min(fin);
            continue;
        }
        let nom: String = {
            let debut_nom = j;
            while j < fin
                && (octets[j].is_alphanumeric()
                    || octets[j] == '_'
                    || octets[j] == '-'
                    || octets[j] == '.'
                    || octets[j] == ':')
            {
                j += 1;
            }
            octets[debut_nom..j].iter().collect()
        };
        while j < fin && octets[j].is_whitespace() {
            j += 1;
        }
        if mot_suit(octets, j, "SYSTEM", fin) || mot_suit(octets, j, "PUBLIC", fin) {
            return Err(ErreurXml::EntiteExterne { nom });
        }
        let Some(&guillemet) = octets.get(j).filter(|c| **c == '"' || **c == '\'') else {
            // Déclaration sans valeur littérale et sans SYSTEM/PUBLIC : rien à
            // enregistrer. On saute, sans inventer de valeur.
            let mut k = j;
            while k < fin && octets[k] != '>' {
                k += 1;
            }
            i = (k + 1).min(fin);
            continue;
        };
        j += 1;
        let debut_valeur = j;
        while j < fin && octets[j] != guillemet {
            j += 1;
        }
        let valeur: String = octets[debut_valeur..j.min(fin)].iter().collect();
        if entites.declarations.len() >= ENTITES_MAX {
            return Err(ErreurXml::TropDEntites {
                compte: entites.declarations.len() + 1,
            });
        }
        entites.declarations.push((nom, valeur));
        i = (j + 1).min(fin);
    }
    Ok(())
}

/// Un mot-clé du DTD commence-t-il à cette position, suivi d'un blanc ou d'un
/// `>` ?
fn mot_suit(octets: &[char], position: usize, mot: &str, fin: usize) -> bool {
    let longueur = mot.chars().count();
    if position + longueur > fin {
        return false;
    }
    if !mot
        .chars()
        .enumerate()
        .all(|(rang, c)| octets.get(position + rang) == Some(&c))
    {
        return false;
    }
    match octets.get(position + longueur) {
        None => true,
        Some(c) => c.is_whitespace() || *c == '>' || *c == '[',
    }
}

/// Lit un élément à partir de son `<`, et rend aussi la position suivante.
fn lire_element(
    octets: &[char],
    position: usize,
    profondeur: usize,
    entites: &Entites,
) -> Result<(Element, usize), ErreurXml> {
    if profondeur >= PROFONDEUR_MAX {
        return Err(ErreurXml::TropProfond);
    }
    debug_assert_eq!(octets[position], '<');
    let mut i = position + 1;
    let nom = lire_nom(octets, &mut i);
    if nom.is_empty() {
        return Err(ErreurXml::SansRacine);
    }
    let mut attributs = Vec::new();

    loop {
        while i < octets.len() && octets[i].is_whitespace() {
            i += 1;
        }
        if i >= octets.len() {
            return Err(ErreurXml::FinInattendue { position });
        }
        match octets[i] {
            '>' => {
                i += 1;
                break;
            }
            '/' => {
                if octets.get(i + 1) != Some(&'>') {
                    return Err(ErreurXml::FinInattendue { position: i });
                }
                // Balise auto-fermante : aucun enfant.
                return Ok((
                    Element {
                        nom,
                        attributs,
                        enfants: Vec::new(),
                    },
                    i + 2,
                ));
            }
            _ => {
                let cle = lire_nom(octets, &mut i);
                if cle.is_empty() {
                    return Err(ErreurXml::FinInattendue { position: i });
                }
                while i < octets.len() && octets[i].is_whitespace() {
                    i += 1;
                }
                let mut valeur = String::new();
                if octets.get(i) == Some(&'=') {
                    i += 1;
                    while i < octets.len() && octets[i].is_whitespace() {
                        i += 1;
                    }
                    let Some(&guillemet) = octets.get(i) else {
                        return Err(ErreurXml::GuillemetManquant {
                            attribut: cle,
                            position: i,
                        });
                    };
                    if guillemet != '"' && guillemet != '\'' {
                        return Err(ErreurXml::GuillemetManquant {
                            attribut: cle,
                            position: i,
                        });
                    }
                    i += 1;
                    let debut = i;
                    while i < octets.len() && octets[i] != guillemet {
                        i += 1;
                    }
                    if i >= octets.len() {
                        return Err(ErreurXml::GuillemetManquant {
                            attribut: cle,
                            position: debut,
                        });
                    }
                    valeur = resoudre_entites_avec(&octets[debut..i], entites)?;
                    i += 1;
                }
                attributs.push((cle, valeur));
            }
        }
    }

    // Contenu : du texte, des éléments, ou l'un après l'autre.
    let mut enfants: Vec<Noeud> = Vec::new();
    let mut texte_courant = String::new();
    loop {
        if i >= octets.len() {
            return Err(ErreurXml::BaliseNonFermee { nom, position });
        }
        if octets[i] == '<' {
            if octets.get(i + 1) == Some(&'/') {
                let mut j = i + 2;
                let fermant = lire_nom(octets, &mut j);
                while j < octets.len() && octets[j].is_whitespace() {
                    j += 1;
                }
                if octets.get(j) != Some(&'>') {
                    return Err(ErreurXml::FinInattendue { position: j });
                }
                if fermant != nom {
                    return Err(ErreurXml::BaliseOrpheline {
                        nom: fermant,
                        position: i,
                    });
                }
                pousser_texte(&mut enfants, &mut texte_courant, entites)?;
                return Ok((
                    Element {
                        nom,
                        attributs,
                        enfants,
                    },
                    j + 1,
                ));
            }
            if octets.get(i + 1) == Some(&'!') && octets.get(i + 2) == Some(&'[') {
                // Section CDATA : son contenu est **littéral**. Les entités n'y
                // sont pas résolues — c'est la définition même de CDATA, et
                // les résoudre changerait le sens du document.
                pousser_texte(&mut enfants, &mut texte_courant, entites)?;
                let debut = i + 9;
                let mut j = debut;
                while j + 2 < octets.len()
                    && !(octets[j] == ']' && octets[j + 1] == ']' && octets[j + 2] == '>')
                {
                    j += 1;
                }
                enfants.push(Noeud::Texte(
                    octets[debut..j.min(octets.len())].iter().collect(),
                ));
                i = (j + 3).min(octets.len());
                continue;
            }
            // Un éventuel commentaire ou une instruction à l'intérieur du
            // contenu : c'est du bruit, on le saute et on continue.
            if octets.get(i + 1) == Some(&'!') || octets.get(i + 1) == Some(&'?') {
                let mut j = i;
                let mut bruit = Entites::default();
                ignorer_bruit(octets, &mut j, &mut bruit)?;
                if j != i {
                    pousser_texte(&mut enfants, &mut texte_courant, entites)?;
                    i = j;
                    continue;
                }
            }
            pousser_texte(&mut enfants, &mut texte_courant, entites)?;
            let (enfant, suivante) = lire_element(octets, i, profondeur + 1, entites)?;
            enfants.push(Noeud::Element(enfant));
            i = suivante;
            continue;
        }
        texte_courant.push(octets[i]);
        i += 1;
    }
}

/// Ferme le tampon de texte courant : résout ses entités et l'ajoute comme
/// nœud, s'il y a quelque chose à ajouter.
///
/// C'est le seul chemin par lequel le texte d'un élément devient un nœud, ce qui
/// garantit qu'aucun texte n'échappe à la résolution des entités — c'était un
/// vrai défaut : les attributs étaient résolus, le texte ne l'était pas, et
/// `&amp;` s'affichait littéralement dans un document contenant « AT&T ».
fn pousser_texte(
    enfants: &mut Vec<Noeud>,
    brut: &mut String,
    entites: &Entites,
) -> Result<(), ErreurXml> {
    if brut.is_empty() {
        return Ok(());
    }
    let caracteres: Vec<char> = brut.chars().collect();
    let texte = resoudre_entites_avec(&caracteres, entites)?;
    brut.clear();
    enfants.push(Noeud::Texte(texte));
    Ok(())
}

/// Lit un nom (d'élément ou d'attribut) et avance la position.
fn lire_nom(octets: &[char], position: &mut usize) -> String {
    let debut = *position;
    while *position < octets.len() {
        let c = octets[*position];
        if c.is_alphanumeric() || c == '_' || c == '-' || c == '.' || c == ':' || (c as u32) > 0x7F
        {
            *position += 1;
        } else {
            break;
        }
    }
    octets[debut..*position].iter().collect()
}

/// Les entités nommées que ce noyau reconnaît, en plus des cinq du XML.
///
/// XML n'en définit que cinq. Les documents réels — surtout ceux qui passent par
/// HTML — en contiennent d'autres, et **les refuser** empêcherait d'ouvrir un
/// fichier valide par ailleurs. La liste est fermée : ce qui n'y est pas est
/// refusé, jamais deviné.
const ENTITES_HTML: &[(&str, &str)] = &[
    ("nbsp", "\u{00A0}"),
    ("ensp", "\u{2002}"),
    ("emsp", "\u{2003}"),
    ("thinsp", "\u{2009}"),
    ("copy", "\u{00A9}"),
    ("reg", "\u{00AE}"),
    ("trade", "\u{2122}"),
    ("hellip", "\u{2026}"),
    ("mdash", "\u{2014}"),
    ("ndash", "\u{2013}"),
    ("lsquo", "\u{2018}"),
    ("rsquo", "\u{2019}"),
    ("ldquo", "\u{201C}"),
    ("rdquo", "\u{201D}"),
    ("laquo", "\u{00AB}"),
    ("raquo", "\u{00BB}"),
    ("times", "\u{00D7}"),
    ("divide", "\u{00F7}"),
    ("deg", "\u{00B0}"),
    ("euro", "\u{20AC}"),
    ("amp", "&"),
];

/// Résout les entités d'un fragment de texte.
///
/// Les cinq entités du XML, les entités numériques et les entités HTML connues,
/// **sans** les entités déclarées par le document. Pour celles-ci, voir
/// [`resoudre_entites_avec`].
///
/// # Erreurs
///
/// [`ErreurXml::EntiteInconnue`] ou [`ErreurXml::EntiteNumeriqueInvalide`].
pub fn resoudre_entites(fragment: &[char]) -> Result<String, ErreurXml> {
    resoudre_entites_avec(fragment, &Entites::default())
}

/// Résout les entités d'un fragment, **entités déclarées comprises**.
///
/// # Erreurs
///
/// [`ErreurXml::EntiteInconnue`], [`ErreurXml::EntiteNumeriqueInvalide`], ou
/// [`ErreurXml::EntiteRecursive`] quand une entité déclarée se référence
/// elle-même.
pub fn resoudre_entites_avec(fragment: &[char], entites: &Entites) -> Result<String, ErreurXml> {
    let mut sortie = String::with_capacity(fragment.len());
    let mut i = 0usize;
    while i < fragment.len() {
        if fragment[i] != '&' {
            sortie.push(fragment[i]);
            i += 1;
            continue;
        }
        let debut = i;
        let mut j = i + 1;
        let mut nom_valide = true;
        // Le nom d'une entité ne contient que des caractères de nom XML. Un
        // espace, un `<` ou un guillemet rencontré avant le `;` veut dire que ce
        // `&` n'ouvre pas une entité du tout : c'est du texte. Sans cette règle,
        // « AT&T et R&amp;D » serait lu comme l'entité « T et R&amp » et refusé.
        while j < fragment.len() {
            let c = fragment[j];
            if c == ';' {
                break;
            }
            if !(c.is_alphanumeric() || c == '#' || c == '_' || c == '-' || c == '.' || c == ':') {
                nom_valide = false;
                break;
            }
            j += 1;
        }
        if !nom_valide || j >= fragment.len() || fragment[j] != ';' || (j - debut) > 40 {
            // Un `&` qui n'ouvre pas une entité : c'est du texte. Les documents
            // réels en contiennent (« AT&T » non échappé) et refuser serait
            // excessif.
            sortie.push('&');
            i += 1;
            continue;
        }
        let nom: String = fragment[debut + 1..j].iter().collect();
        let valeur = if let Some(reste) = nom.strip_prefix('#') {
            let point = if let Some(hex) = reste.strip_prefix(['x', 'X']) {
                u32::from_str_radix(hex, 16).ok()
            } else {
                reste.parse::<u32>().ok()
            };
            let Some(point) = point.filter(|p| *p <= 0x10_FFFF) else {
                return Err(ErreurXml::EntiteNumeriqueInvalide { nom });
            };
            // Les substituts isolés ne sont pas des caractères.
            char::from_u32(point)
                .filter(|c| !(0xD800..=0xDFFF).contains(&(*c as u32)))
                .ok_or(ErreurXml::EntiteNumeriqueInvalide { nom })?
                .to_string()
        } else {
            match nom.as_str() {
                "lt" => "<".to_string(),
                "gt" => ">".to_string(),
                "quot" => "\"".to_string(),
                "apos" => "'".to_string(),
                "amp" => "&".to_string(),
                autre => match entites.valeur(autre) {
                    Some(valeur) => valeur,
                    None if entites.noms().any(|n| n == autre) => {
                        return Err(ErreurXml::EntiteRecursive {
                            nom: autre.to_string(),
                        })
                    }
                    None => match ENTITES_HTML.iter().find(|(n, _)| *n == autre) {
                        Some((_, remplacement)) => (*remplacement).to_string(),
                        None => return Err(ErreurXml::EntiteInconnue { nom }),
                    },
                },
            }
        };
        sortie.push_str(&valeur);
        i = j + 1;
    }
    Ok(sortie)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn element_simple() {
        let racine = analyser("<a><b>texte</b></a>").unwrap();
        assert_eq!(racine.nom, "a");
        assert_eq!(racine.texte(), "texte");
        assert_eq!(racine.chercher("b").len(), 1);
    }

    #[test]
    fn declaration_commentaire_doctype() {
        let xml = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
                   <!-- un commentaire -->\n\
                   <!DOCTYPE racine [ <!ENTITY x \"y\"> ]>\n\
                   <racine><a/></racine>";
        let racine = analyser(xml).unwrap();
        assert_eq!(racine.nom, "racine");
        assert_eq!(racine.chercher("a").len(), 1);
    }

    #[test]
    fn entites_du_sous_ensemble_interne_sont_resolues() {
        // La forme exacte d'Illustrator : les espaces de noms sont des entités.
        let xml = "<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1 Basic//EN\" \
                   \"http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-basic.dtd\" [\n\
                     <!ENTITY ns_extend \"http://ns.adobe.com/Extensibility/1.0/\">\n\
                     <!ENTITY ns_ai 'http://ns.adobe.com/AdobeIllustrator/10.0/'>\n\
                   ]>\n\
                   <svg xmlns:x=\"&ns_extend;\" xmlns:i=\"&ns_ai;\">café</svg>";
        let (racine, entites) = analyser_avec_entites(xml).unwrap();
        assert_eq!(entites.nombre(), 2);
        assert_eq!(
            racine.attribut("xmlns:x"),
            Some("http://ns.adobe.com/Extensibility/1.0/")
        );
        assert_eq!(
            racine.attribut("xmlns:i"),
            Some("http://ns.adobe.com/AdobeIllustrator/10.0/")
        );
        assert_eq!(racine.texte(), "café");
    }

    #[test]
    fn une_entite_peut_en_appeler_une_autre() {
        let xml = "<!DOCTYPE a [ <!ENTITY base \"http://exemple/\"> \
                   <!ENTITY chemin \"&base;chemin\"> ]>\
                   <a href=\"&chemin;\"/>";
        let racine = analyser(xml).unwrap();
        assert_eq!(racine.attribut("href"), Some("http://exemple/chemin"));
    }

    #[test]
    fn une_entite_externe_est_refusee_en_la_nommant() {
        let xml = "<!DOCTYPE a [ <!ENTITY ext SYSTEM \"http://exemple/x\"> ]><a/>";
        let erreur = analyser(xml).unwrap_err();
        assert!(
            matches!(&erreur, ErreurXml::EntiteExterne { nom } if nom == "ext"),
            "{erreur:?}"
        );
        assert!(erreur.to_string().contains("ext"), "{erreur}");
    }

    #[test]
    fn une_entite_qui_se_reference_elle_meme_est_refusee() {
        let xml = "<!DOCTYPE a [ <!ENTITY boucle \"&boucle;\"> ]><a x=\"&boucle;\"/>";
        let erreur = analyser(xml).unwrap_err();
        assert!(
            matches!(&erreur, ErreurXml::EntiteRecursive { nom } if nom == "boucle"),
            "{erreur:?}"
        );
    }

    #[test]
    fn une_entite_parametre_est_sautee_sans_etre_etendue() {
        let xml = "<!DOCTYPE a [ <!ENTITY % forme \"(a|b)\"> <!ENTITY garde \"ok\"> ]>\
                   <a x=\"&garde;\"/>";
        let (racine, entites) = analyser_avec_entites(xml).unwrap();
        assert_eq!(entites.nombre(), 1);
        assert_eq!(racine.attribut("x"), Some("ok"));
    }

    #[test]
    fn les_declarations_non_entite_sont_sautees() {
        // `<!ATTLIST>` contient des `>` dans des valeurs entre guillemets : le
        // découpage doit les respecter, sinon la déclaration suivante serait
        // lue de travers.
        let xml = "<!DOCTYPE a [\n\
                     <!ELEMENT a (#PCDATA)>\n\
                     <!ATTLIST a x CDATA \"a>b\" y CDATA \"y\">\n\
                     <!ENTITY apres \"bonjour\">\n\
                   ]>\n\
                   <a t=\"&apres;\"/>";
        let racine = analyser(xml).unwrap();
        assert_eq!(racine.attribut("t"), Some("bonjour"));
    }

    #[test]
    fn trop_d_entites_est_refuse() {
        let mut xml = String::from("<!DOCTYPE a [");
        for i in 0..(ENTITES_MAX + 1) {
            xml.push_str(&format!("<!ENTITY e{i} \"v\">"));
        }
        xml.push_str("]><a/>");
        let erreur = analyser(&xml).unwrap_err();
        assert!(
            matches!(erreur, ErreurXml::TropDEntites { .. }),
            "{erreur:?}"
        );
    }

    #[test]
    fn une_entite_inconnue_est_toujours_refusee() {
        let xml = "<!DOCTYPE a [ <!ENTITY connu \"x\"> ]><a x=\"&inconnu;\"/>";
        let erreur = analyser(xml).unwrap_err();
        assert!(
            matches!(&erreur, ErreurXml::EntiteInconnue { nom } if nom == "inconnu"),
            "{erreur:?}"
        );
    }

    #[test]
    fn commentaire_a_l_interieur_d_un_contenu() {
        let racine = analyser("<a>avant<!-- au milieu -->apres</a>").unwrap();
        assert_eq!(racine.texte(), "avantapres");
    }

    #[test]
    fn auto_fermante_et_attributs() {
        let racine = analyser("<a x=\"1\" y='2' z = \"trois\"/>").unwrap();
        assert_eq!(racine.attribut("x"), Some("1"));
        assert_eq!(racine.attribut("y"), Some("2"));
        assert_eq!(racine.attribut("z"), Some("trois"));
        assert_eq!(racine.attribut("absent"), None);
    }

    #[test]
    fn liste_vide_sans_valeur() {
        // Les formats réels écrivent des attributs sans valeur.
        let racine = analyser("<a drapeau autre=\"x\"/>").unwrap();
        assert_eq!(racine.attribut("drapeau"), Some(""));
        assert_eq!(racine.attribut("autre"), Some("x"));
    }

    #[test]
    fn prefixes_d_espace_de_noms() {
        let racine = analyser("<w:document><w:p><w:t>bonjour</w:t></w:p></w:document>").unwrap();
        assert_eq!(racine.local(), "document");
        assert_eq!(racine.prefixe(), Some("w"));
        assert!(racine.est("w:document"));
        assert!(racine.est("document"));
        // Comparaison par nom local.
        assert_eq!(racine.chercher("p").len(), 1);
        assert_eq!(racine.chercher("t")[0].texte(), "bonjour");
    }

    #[test]
    fn attribut_par_nom_local() {
        let racine = analyser("<w:pStyle w:val=\"Heading1\"/>").unwrap();
        assert_eq!(racine.attribut("w:val"), Some("Heading1"));
        assert_eq!(racine.attribut("val"), Some("Heading1"));
    }

    #[test]
    fn entites() {
        assert_eq!(
            analyser("<a>&amp;&lt;&gt;&quot;&apos;</a>")
                .unwrap()
                .texte(),
            "&<>\"'"
        );
        assert_eq!(
            analyser("<a>&#160;|&#x2019;</a>").unwrap().texte(),
            "\u{00A0}|\u{2019}"
        );
        assert_eq!(
            analyser("<a>&nbsp;|&mdash;|&euro;</a>").unwrap().texte(),
            "\u{00A0}|\u{2014}|\u{20AC}"
        );
        // Un « & » qui n'ouvre pas une entité est du texte.
        assert_eq!(
            analyser("<a>AT&T et R&amp;D</a>").unwrap().texte(),
            "AT&T et R&D"
        );
        assert_eq!(
            analyser("<a>&inconnu;</a>").unwrap_err(),
            ErreurXml::EntiteInconnue {
                nom: "inconnu".to_string()
            }
        );
        assert!(matches!(
            analyser("<a>&#xFFFFFFF;</a>").unwrap_err(),
            ErreurXml::EntiteNumeriqueInvalide { .. }
        ));
    }

    #[test]
    fn entites_resolues_dans_le_texte_comme_dans_les_attributs() {
        // Régression : les attributs étaient résolus, le texte ne l'était pas.
        let racine = analyser("<a titre=\"caf&#233;\">caf&#233; &amp; th&#233;</a>").unwrap();
        assert_eq!(racine.attribut("titre"), Some("café"));
        assert_eq!(racine.texte(), "café & thé");
        // Et les entités sont résolues dans chacun des fragments de texte.
        let racine = analyser("<a>a&amp;b<b>c&amp;d</b>e&amp;f</a>").unwrap();
        assert_eq!(racine.texte(), "a&bc&de&f");
        assert_eq!(racine.contenu().len(), 3);
    }

    #[test]
    fn cdata() {
        // Les entités ne sont PAS résolues dans une section CDATA : c'est sa
        // raison d'être.
        let racine = analyser("<a><![CDATA[<pas une balise> & ni entité]]></a>").unwrap();
        assert_eq!(racine.texte(), "<pas une balise> & ni entité");
        // Et le contenu littéral avoisine du texte normal, résolu.
        let racine = analyser("<a>avant &amp; <![CDATA[& brut]]> après</a>").unwrap();
        assert_eq!(racine.texte(), "avant & & brut après");
    }

    #[test]
    fn chevron_dans_un_attribut() {
        let racine = analyser("<a chemin=\"a>b\"/>").unwrap();
        assert_eq!(racine.attribut("chemin"), Some("a>b"));
    }

    #[test]
    fn texte_et_elements_dans_l_ordre() {
        let racine = analyser("<p>avant<b>gras</b>apres</p>").unwrap();
        assert_eq!(racine.texte(), "avantgrasapres");
        assert_eq!(racine.contenu().len(), 3);
        assert!(matches!(racine.contenu()[0], Noeud::Texte(_)));
        assert!(matches!(racine.contenu()[1], Noeud::Element(_)));
    }

    #[test]
    fn balise_non_fermee() {
        assert!(matches!(
            analyser("<a><b>texte</a>").unwrap_err(),
            ErreurXml::BaliseOrpheline { .. }
        ));
        assert!(matches!(
            analyser("<a><b>texte").unwrap_err(),
            ErreurXml::BaliseNonFermee { .. }
        ));
    }

    #[test]
    fn guillemet_manquant() {
        assert!(matches!(
            analyser("<a x=1/>").unwrap_err(),
            ErreurXml::GuillemetManquant { .. }
        ));
        assert!(matches!(
            analyser("<a x=\"1/>").unwrap_err(),
            ErreurXml::GuillemetManquant { .. }
        ));
    }

    #[test]
    fn deux_racines_refusees() {
        assert!(analyser("<a/><b/>").is_err());
        assert_eq!(analyser("").unwrap_err(), ErreurXml::SansRacine);
        assert_eq!(analyser("   ").unwrap_err(), ErreurXml::SansRacine);
    }

    #[test]
    fn imbrication_trop_profonde_refusee() {
        let mut xml = String::new();
        for _ in 0..(PROFONDEUR_MAX + 10) {
            xml.push_str("<a>");
        }
        for _ in 0..(PROFONDEUR_MAX + 10) {
            xml.push_str("</a>");
        }
        assert_eq!(analyser(&xml).unwrap_err(), ErreurXml::TropProfond);
        // Et une profondeur acceptable passe.
        let mut bon = String::new();
        for _ in 0..100 {
            bon.push_str("<a>");
        }
        for _ in 0..100 {
            bon.push_str("</a>");
        }
        assert!(analyser(&bon).is_ok());
    }

    #[test]
    fn document_reel_style_ooxml() {
        let xml = r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>TITRE UN</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">Texte </w:t><w:tab/><w:t>après tabulation</w:t></w:r></w:p>
  </w:body>
</w:document>"#;
        let racine = analyser(xml).unwrap();
        let paragraphes = racine.chercher("p");
        assert_eq!(paragraphes.len(), 2);
        assert_eq!(paragraphes[0].chercher("t")[0].texte(), "TITRE UN");
        assert_eq!(
            paragraphes[0].chercher("pStyle")[0].attribut("val"),
            Some("Heading1")
        );
        assert_eq!(paragraphes[1].chercher("t").len(), 2);
        assert_eq!(paragraphes[1].chercher("tab").len(), 1);
    }

    #[test]
    fn compter_les_elements() {
        let racine = analyser("<a><b><c/><d/></b><e/></a>").unwrap();
        assert_eq!(racine.nombre_d_elements(), 4);
    }
}
