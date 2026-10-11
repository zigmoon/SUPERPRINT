//! # superprint-doc — import de documents et de dessin vectoriel
//!
//! ## Ce que ce crate fait
//!
//! **Trois formats de texte** — il ouvre un `.docx`, un `.odt` ou un `.idml` et
//! en tire ce dont une mise en page a besoin : **les paragraphes**, leur
//! **style**, leur **niveau de titre**, les **images** qu'ils appellent, et le
//! **format de page**.
//!
//! **Un format de dessin** — il ouvre un **SVG** ([`svg`]) et en tire les
//! **formes** : commandes de chemin, formes élémentaires, transformations,
//! attributs de présentation, aplatis en polylignes dans le repère du canevas.
//!
//! Le produit s'appuyait pour cela sur Mammoth (621 Ko) et sur `jszip` pour
//! `.docx`, sur `DOMParser` pour `.odt`, sur du code maison pour `.idml`, et sur
//! **le navigateur lui-même** pour le SVG (`fabric.loadSVGFromString`). Ici,
//! tout est calculé : conteneur ([`superprint_zip`]), analyse XML ([`xml`]),
//! lecture des trois formats de texte, et lecture du dessin vectoriel.
//!
//! ## Les trois formats de texte, et ce qui les rapproche
//!
//! | Format | Racine du texte | Style | Format de page |
//! |---|---|---|---|
//! | `.docx` | `word/document.xml`, élément `w:p` | `w:pPr/w:pStyle/@w:val` | `w:sectPr/w:pgSz` (vingtièmes de point) |
//! | `.odt` | `content.xml`, éléments `text:p` et `text:h` | `text:style-name` | `style:page-layout` (`fo:page-width`) |
//! | `.idml` | `Stories/Story_*.xml`, élément `Content` | `ParagraphStyleRange/@AppliedParagraphStyle` | `Spreads/*.xml`, `Page/@GeometricBounds` (points) |
//!
//! ## La sortie du texte est un [`Memoire`], et elle sait se chaîner
//!
//! [`Memoire::fluidifier`] rend un [`superprint_flow::Flux`] — donc un document
//! importé peut être **paginé** par le reste du noyau, sans conversion
//! intermédiaire. Un saut de ligne **forcé** (Maj+Entrée dans Word,
//! `<text:line-break/>` dans ODF) devient un paragraphe sans retrait de première
//! ligne : c'est exactement ce qu'il est — la même phrase qui continue à la
//! ligne suivante.
//!
//! ## La sortie du dessin est un [`svg::DocumentSvg`]
//!
//! [`svg::Forme`] porte des polylignes **déjà aplaties** dans le repère du
//! canevas, avec leur remplissage et leur contour ; c'est la même forme de
//! sortie que l'interpréteur PostScript (`superprint-ps`), et la même convention
//! de fermeture (le premier point est répété). Un SVG lu est donc directement
//! réutilisable par la géométrie booléenne ou par l'écrivain PDF.
//!
//! ## Ce qui est refusé, et ce qui est avoué
//!
//! - un fichier qui n'est **pas** une archive : refusé, en nommant ce qu'il est
//!   (PDF, RTF, ancien `.doc` binaire) quand c'est reconnaissable ;
//! - une archive qui est bien une archive, mais pas du format annoncé : refusé ;
//! - les **styles** sont rendus **par leur nom**, sans être interprétés : le
//!   noyau ne connaît pas la feuille de styles de Word, et traduire
//!   `Heading1` en « corps 18 pt gras » serait une invention ;
//! - les **mises en forme fines** (gras, italique, couleur par morceau) sont
//!   **comptées et signalées** dans les avertissements, pas silencieusement
//!   perdues — c'est la limite du modèle de [`Paragraphe`], et elle est dite ;
//! - un `.ai` moderne est un **PDF**, pas du PostScript : ce crate ne l'ouvre
//!   pas, et le détecteur de format le dit ([`superprint_zip::lecture::ressemble_a_une_archive`]
//!   aidant, via `zip_dump format`) ;
//! - en SVG, tout ce dont l'ignorance **perd du dessin** est refusé (`image`,
//!   `use`, un dégradé, un `clip-path`, une feuille `<style>`), et tout ce qui
//!   **décrit** sans dessiner (`defs`, `title`, `metadata`…) est **compté** dans
//!   [`svg::DocumentSvg::non_rendus`].
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « import de documents »).

#![forbid(unsafe_code)]
#![deny(missing_docs)]

pub mod docx;
pub mod idml;
pub mod odt;
pub mod svg;
pub mod xml;

use std::fmt;

use superprint_flow::flux::{Flux, Paragraphe as ParagrapheFlux};
use superprint_zip::Archive;

/// Format d'un document importé.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Format {
    /// Word (Office Open XML, `.docx`).
    Docx,
    /// OpenDocument Texte (`.odt`).
    Odt,
    /// InDesign Markup (`.idml`).
    Idml,
}

impl Format {
    /// Le nom du format, tel qu'on l'écrit.
    #[must_use]
    pub fn nom(&self) -> &'static str {
        match self {
            Self::Docx => "docx",
            Self::Odt => "odt",
            Self::Idml => "idml",
        }
    }

    /// Le type MIME, quand le format en a un.
    #[must_use]
    pub fn type_mime(&self) -> &'static str {
        match self {
            Self::Docx => "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
            Self::Odt => "application/vnd.oasis.opendocument.text",
            Self::Idml => "application/vnd.adobe.indesign-idml-package",
        }
    }
}

/// Alignement horizontal d'un paragraphe.
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Alignement {
    /// Non précisé par le document : c'est le style qui décide.
    #[default]
    ParDefaut,
    /// À gauche.
    Gauche,
    /// Centré.
    Centre,
    /// À droite.
    Droite,
    /// Justifié.
    Justifie,
}

impl Alignement {
    /// Reconnaît un alignement écrit dans un document.
    ///
    /// Rend [`Alignement::ParDefaut`] pour tout ce qui n'est pas reconnu : ce
    /// n'est pas une erreur, c'est une absence de consigne.
    #[must_use]
    pub fn depuis_nom(nom: &str) -> Self {
        match nom.to_ascii_lowercase().as_str() {
            "left" | "start" => Self::Gauche,
            "center" | "centre" => Self::Centre,
            "right" | "end" => Self::Droite,
            "both" | "justify" => Self::Justifie,
            _ => Self::ParDefaut,
        }
    }

    /// Le nom de l'alignement, ou `defaut`.
    #[must_use]
    pub fn nom(&self) -> &'static str {
        match self {
            Self::ParDefaut => "defaut",
            Self::Gauche => "gauche",
            Self::Centre => "centre",
            Self::Droite => "droite",
            Self::Justifie => "justifie",
        }
    }
}

/// Un paragraphe importé.
#[derive(Clone, Debug, PartialEq)]
pub struct Paragraphe {
    /// Le texte, entités résolues. Peut contenir `\n` : c'est un saut de ligne
    /// **forcé** (Maj+Entrée), par opposition au paragraphe suivant.
    pub texte: String,
    /// Le nom du style, **tel qu'écrit dans le document** (`Heading1`,
    /// `ParagraphStyle/$ID/NormalParagraphStyle`…), jamais traduit.
    pub style: Option<String>,
    /// Le niveau de titre, quand le document l'annonce (`Heading3` → 3,
    /// `text:outline-level="2"` → 2).
    pub niveau: Option<u8>,
    /// Le paragraphe appartient-il à une liste à puces ou numérotée ?
    pub liste: bool,
    /// L'alignement, quand il est précisé sur le paragraphe.
    pub alignement: Alignement,
    /// Nom de l'entrée d'archive de l'image, quand le paragraphe n'en porte
    /// qu'une et rien d'autre. Les paragraphes à plusieurs images sont signalés
    /// dans les avertissements.
    pub image: Option<String>,
    /// Position dans un tableau : `(ligne, colonne)`, à partir de zéro.
    pub table: Option<(usize, usize)>,
}

impl Paragraphe {
    /// Un paragraphe de texte nu.
    #[must_use]
    pub fn texte(texte: impl Into<String>) -> Self {
        Self {
            texte: texte.into(),
            style: None,
            niveau: None,
            liste: false,
            alignement: Alignement::ParDefaut,
            image: None,
            table: None,
        }
    }

    /// Le paragraphe est-il vide de tout texte **et** de toute image ?
    #[must_use]
    pub fn est_vide(&self) -> bool {
        self.texte.trim().is_empty() && self.image.is_none()
    }

    /// Nombre de caractères.
    #[must_use]
    pub fn longueur(&self) -> usize {
        self.texte.chars().count()
    }
}

/// Un format de page, en millimètres.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Page {
    /// Largeur.
    pub largeur_mm: f64,
    /// Hauteur.
    pub hauteur_mm: f64,
    /// Marge de gauche, quand elle est connue.
    pub marge_gauche_mm: Option<f64>,
    /// Marge de droite.
    pub marge_droite_mm: Option<f64>,
    /// Marge du haut.
    pub marge_haut_mm: Option<f64>,
    /// Marge du bas.
    pub marge_bas_mm: Option<f64>,
}

impl Page {
    /// Le format est-il paysage ?
    #[must_use]
    pub fn est_paysage(&self) -> bool {
        self.largeur_mm > self.hauteur_mm
    }

    /// Largeur utile, marges déduites quand elles sont connues.
    #[must_use]
    pub fn largeur_utile_mm(&self) -> f64 {
        self.largeur_mm - self.marge_gauche_mm.unwrap_or(0.0) - self.marge_droite_mm.unwrap_or(0.0)
    }

    /// Hauteur utile, marges déduites quand elles sont connues.
    #[must_use]
    pub fn hauteur_utile_mm(&self) -> f64 {
        self.hauteur_mm - self.marge_haut_mm.unwrap_or(0.0) - self.marge_bas_mm.unwrap_or(0.0)
    }
}

/// Un document importé.
#[derive(Clone, Debug, PartialEq)]
pub struct Memoire {
    /// Le format reconnu.
    pub format: Format,
    /// Les paragraphes, dans l'ordre du document.
    pub paragraphes: Vec<Paragraphe>,
    /// Le format de page, quand le document le porte.
    pub page: Option<Page>,
    /// Le titre du document, quand il en porte un.
    pub titre: Option<String>,
    /// Les entrées d'archive dont une image est tirée.
    pub images: Vec<String>,
    /// Les notes de bas de page et de fin, **sorties du flux**.
    ///
    /// Dans IDML, une note est imbriquée au milieu du paragraphe qui l'appelle :
    /// la laisser dedans collerait son texte au milieu de la phrase. Elle est
    /// donc retirée du flux et rassemblée ici — conservée, et à sa place.
    pub notes: Vec<String>,
    /// Ce qui n'a **pas** pu être rendu fidèlement, dit explicitement.
    pub avertissements: Vec<String>,
}

impl Memoire {
    /// Ouvre un document à partir des octets de son fichier.
    ///
    /// Le format est **déduit du contenu**, pas du nom de fichier : un `.odt` qui
    /// contient du RTF est refusé, pas interprété.
    ///
    /// # Erreurs
    ///
    /// Voir [`ErreurImport`].
    pub fn depuis_octets(octets: Vec<u8>) -> Result<Self, ErreurImport> {
        let archive = Archive::lire(octets)?;
        Self::importer(&archive)
    }

    /// Ouvre un document déjà dépaqueté.
    ///
    /// # Erreurs
    ///
    /// Voir [`ErreurImport`].
    pub fn importer(archive: &Archive) -> Result<Self, ErreurImport> {
        // La signature du format est un fichier présent, pas une extension.
        // L'ordre compte : un `.docx` contient `[Content_Types].xml`, un `.odt`
        // contient `mimetype`, un `.idml` contient `designmap.xml`.
        if archive.trouver_souple("word/document.xml").is_some() {
            return docx::lire(archive);
        }
        if archive.trouver_souple("content.xml").is_some()
            && archive.trouver_souple("mimetype").is_some()
        {
            return odt::lire(archive);
        }
        if archive.trouver_souple("designmap.xml").is_some() {
            return idml::lire(archive);
        }
        if archive.trouver_souple("content.xml").is_some() {
            // Un ODF sans `mimetype` : c'est un ODF abîmé, mais lisible.
            // On le dit et on continue, plutôt que de refuser un document dont
            // le texte est là.
            let mut memoire = odt::lire(archive)?;
            memoire.avertissements.push(
                "archive OpenDocument sans entrée `mimetype` : le format est déduit de `content.xml`"
                    .to_string(),
            );
            return Ok(memoire);
        }
        Err(ErreurImport::FormatInconnu {
            entrees: archive
                .noms()
                .iter()
                .take(8)
                .map(|n| (*n).to_string())
                .collect(),
        })
    }

    /// Le texte complet, paragraphes séparés par des sauts de ligne.
    #[must_use]
    pub fn texte(&self) -> String {
        let mut sortie = String::new();
        for (i, paragraphe) in self.paragraphes.iter().enumerate() {
            if i > 0 {
                sortie.push('\n');
            }
            sortie.push_str(&paragraphe.texte);
        }
        sortie
    }

    /// Nombre total de caractères.
    #[must_use]
    pub fn nombre_de_caracteres(&self) -> usize {
        self.paragraphes.iter().map(Paragraphe::longueur).sum()
    }

    /// Les paragraphes qui portent du texte.
    pub fn paragraphes_de_texte(&self) -> impl Iterator<Item = &Paragraphe> {
        // Un itérateur est déjà `must_use` par nature : le redire ferait doublon.
        self.paragraphes.iter().filter(|p| !p.est_vide())
    }

    /// Les paragraphes qui portent un titre.
    pub fn titres(&self) -> impl Iterator<Item = &Paragraphe> {
        self.paragraphes.iter().filter(|p| p.niveau.is_some())
    }

    /// Convertit le document en flux de texte, pour la pagination.
    ///
    /// Un saut de ligne **forcé** à l'intérieur d'un paragraphe devient un
    /// paragraphe de flux **sans retrait de première ligne** : c'est la même
    /// phrase qui continue, elle ne doit pas être traitée comme un nouveau
    /// paragraphe.
    ///
    /// Les images sont ignorées — un flux de texte ne porte pas d'image — et
    /// elles sont signalées dans les avertissements pour qui appellerait cette
    /// fonction sans avoir lu [`Memoire::images`].
    #[must_use]
    pub fn fluidifier(&self, retrait: f64, espace_apres: f64) -> Flux {
        let mut flux = Flux::nouveau();
        for paragraphe in &self.paragraphes {
            if paragraphe.texte.trim().is_empty() {
                // Un paragraphe vide reste un paragraphe : c'est un trou dans la
                // mise en page, pas rien.
                flux.ajouter(ParagrapheFlux::nouveau(""));
                continue;
            }
            let morceaux: Vec<&str> = paragraphe.texte.split('\n').collect();
            for (rang, morceau) in morceaux.iter().enumerate() {
                let mut bloc = if rang == 0 {
                    ParagrapheFlux::nouveau(*morceau).retraits(retrait, 0.0)
                } else {
                    // Continuation d'un saut forcé : pas de retrait.
                    ParagrapheFlux::nouveau(*morceau)
                };
                bloc = bloc.espace_apres(espace_apres);
                flux.ajouter(bloc);
            }
        }
        flux
    }
}

/// Erreur d'import d'un document.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErreurImport {
    /// Le conteneur n'a pas pu être ouvert.
    Conteneur(superprint_zip::ErreurZip),
    /// L'archive est lisible, mais ce n'est pas un des formats connus.
    FormatInconnu {
        /// Les premières entrées de l'archive : elles disent ce qu'elle est.
        entrees: Vec<String>,
    },
    /// Une entrée attendue est absente de l'archive.
    EntreeManquante {
        /// Nom de l'entrée.
        nom: String,
    },
    /// Le XML d'une entrée n'a pas pu être analysé.
    Xml {
        /// Nom de l'entrée.
        entree: String,
        /// Ce que l'analyseur a dit.
        raison: String,
    },
    /// Le document est du bon format, mais n'a pas de contenu lisible.
    SansContenu {
        /// Nom de l'entrée qui devait le porter.
        entree: String,
    },
    /// Le format annoncé par le fichier ne correspond pas à sa construction.
    FormatContredit {
        /// Ce que le fichier annonce.
        annonce: String,
        /// Ce qu'on y trouve à la place.
        trouve: String,
    },
}

impl fmt::Display for ErreurImport {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Conteneur(e) => write!(f, "{e}"),
            Self::FormatInconnu { entrees } => write!(
                f,
                "ce n'est pas un document reconnu (ni .docx, ni .odt, ni .idml) — les entrées \
                 de l'archive sont : {}",
                entrees.join(", ")
            ),
            Self::EntreeManquante { nom } => write!(f, "entrée manquante dans l'archive : {nom}"),
            Self::Xml { entree, raison } => write!(f, "{entree} : XML illisible — {raison}"),
            Self::SansContenu { entree } => {
                write!(f, "{entree} : aucun paragraphe trouvé")
            }
            Self::FormatContredit { annonce, trouve } => write!(
                f,
                "le fichier s'annonce « {annonce} » mais contient « {trouve} »"
            ),
        }
    }
}

impl std::error::Error for ErreurImport {}

impl From<superprint_zip::ErreurZip> for ErreurImport {
    fn from(e: superprint_zip::ErreurZip) -> Self {
        Self::Conteneur(e)
    }
}

/// Lit une entrée d'archive et l'analyse comme du XML.
///
/// # Erreurs
///
/// [`ErreurImport::Conteneur`] si l'entrée est illisible,
/// [`ErreurImport::Xml`] si son contenu n'est pas du XML bien formé.
pub(crate) fn analyser_entree(
    archive: &Archive,
    nom: &str,
    remplacement: &str,
) -> Result<xml::Element, ErreurImport> {
    // Le nom peut être relatif à un dossier (`word/_rels/…`), et les archives
    // écrites sous Windows emploient parfois l'autre barre : `trouver_souple`
    // s'en charge.
    let texte = archive
        .extraire_texte(nom)
        .or_else(|_| {
            // Repli : chemin résolu par rapport à la racine du document.
            let candidat = if nom.contains('/') {
                nom.to_string()
            } else {
                format!("{remplacement}/{nom}")
            };
            archive.extraire_texte(&candidat)
        })
        .map_err(|e| match e {
            superprint_zip::ErreurZip::EntreeAbsente { nom } => {
                ErreurImport::EntreeManquante { nom }
            }
            autre => ErreurImport::Conteneur(autre),
        })?;
    xml::analyser(&texte).map_err(|e| ErreurImport::Xml {
        entree: nom.to_string(),
        raison: e.to_string(),
    })
}
