//! # Import SVG — le dessin vectoriel, lu, transformé, aplati
//!
//! ## Ce que le produit faisait, et ce que ce module remplace
//!
//! L'import SVG du produit, c'est **une ligne** : `fabric.loadSVGFromString()`
//! (`main.js`, `addSvgFromContent`). Tout le travail — analyse XML, commandes de
//! chemin, transformations, styles — est donc fait par le **navigateur**, et
//! l'application n'en voit que le résultat. Ce module écrit cette analyse.
//!
//! ## Les trois étages, et où ils s'arrêtent
//!
//! | Étage | Ce qui est fait | Ce qui ne l'est pas |
//! |---|---|---|
//! | **XML** | [`crate::xml`], entités du DTD interne comprises | entités externes, entités paramètre |
//! | **Structure** | `svg`, `g`, `switch`, `foreignObject`, `defs` et consorts | feuille de style CSS, `use`, `image` |
//! | **Géométrie** | commandes de chemin, formes, transformations, aplatissement | découpage (`clip-path`), masques, filtres |
//!
//! ## Les commandes de chemin, et ce qu'elles deviennent
//!
//! Toutes les commandes de la spécification sont lues :
//!
//! | Commande | Sens | Devient |
//! |---|---|---|
//! | `M` `m` | début de sous-chemin | un nouveau sous-chemin |
//! | `L` `l` `H` `h` `V` `v` | segment | un point |
//! | `C` `c` `S` `s` | cubique (et son reflet) | une [`Courbe::Cubique`] aplatie |
//! | `Q` `q` `T` `t` | quadratique (et son reflet) | une [`Courbe::Quadratique`] aplatie |
//! | `A` `a` | arc elliptique | une suite de cubiques, puis des points |
//! | `Z` `z` | fermeture | le premier point répété, **comme l'interpréteur PostScript** |
//!
//! Les répétitions implicites sont respectées — après un `M`, une paire de
//! coordonnées seule vaut un `L` — parce que c'est la forme sous laquelle les
//! outils écrivent réellement leurs chemins.
//!
//! L'aplatissement emploie [`Courbe::aplatir`], donc la **même** tolérance
//! mesurée que l'interpréteur PostScript : l'écart entre la polyligne et la
//! courbe vraie ne dépasse jamais la tolérance demandée.
//!
//! ## La règle : refuser ou signaler, et pourquoi
//!
//! Le noyau ne fait pas semblant. Un élément dont l'ignorance **perd du dessin**
//! est **refusé**, en nommant ce qu'il aurait fallu : `image`, `use`, un
//! remplissage `url(#…)` (dégradé ou motif), `clip-path`, `mask`, `filter`, une
//! feuille `<style>`. Un élément qui **décrit** sans dessiner (`defs`, `symbol`,
//! `title`, `metadata`, une déclaration de dégradé) est **compté** dans
//! [`DocumentSvg::non_rendus`] et n'arrête rien.
//!
//! C'est le même partage que dans `superprint-ps`, et pour la même raison : un
//! import amputé qui ne le dit pas est pire qu'un import refusé.
//!
//! ## Le texte
//!
//! `<text>` **n'est pas dessiné** : dessiner un glyphe demande une police, et le
//! noyau ne devine pas laquelle. Mais le texte n'est **pas perdu** : sa
//! position, son corps, sa famille et son ancre sont rendus dans
//! [`DocumentSvg::textes`]. C'est le même partage que l'écrivain PDF, qui prend
//! une police explicite : ici, l'appelant fournit la police, la géométrie est
//! déjà calculée.
//!
//! ## Le repère
//!
//! La sortie est exprimée dans le **repère du canevas SVG** : le `viewBox` du
//! document est appliqué, `preserveAspectRatio` compris. Un
//! `<svg viewBox="0 0 24 24" width="24" height="24">` rend donc des coordonnées
//! en pixels, comme le navigateur les affiche.
//!
//! Les **unités CSS** sont converties (`1in = 96px`, `1pt = 96/72px`,
//! `1mm = 96/25,4px`, `1em` = le corps courant). Un **pourcentage** se rapporte
//! à la référence de son attribut, et le SVG n'en a pas qu'une : `x` et `width`
//! à la largeur du canevas, `y` et `height` à sa hauteur, `r`, `rx`, `ry` et
//! `stroke-width` à sa **diagonale normalisée** — `√((l² + h²) / 2)`. Un
//! pourcentage sans canevas connu (ni `viewBox`, ni `width`, ni `height`) est
//! **refusé** : deviner reviendrait à placer le dessin au hasard. `font-size` en
//! pourcentage se rapporte au corps du parent, comme en CSS. `ex` est refusé :
//! il demande les métriques de la police, que le noyau n'a pas.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « import de documents »).

use std::fmt;

use superprint_path::courbe::Courbe;
use superprint_path::matrice::Matrice;
use superprint_path::point::{Boite, Point};
use superprint_path::polygone::Regle;

use crate::xml::{self, Element, ErreurXml};

/// Tolérance d'aplatissement par défaut, en unités utilisateur.
///
/// C'est la tolérance de l'interpréteur PostScript : `0,05` unité vaut un
/// vingtième de pixel, très en dessous de ce qu'un procédé d'impression
/// distingue.
pub const TOLERANCE_PAR_DEFAUT: f64 = 0.05;

/// Taille de police supposée quand rien ne la donne, en unités utilisateur.
///
/// C'est la valeur initiale du CSS (`medium`, soit 16 px). Elle ne sert qu'à
/// résoudre `em` et les longueurs relatives ; elle n'est jamais dessinée.
pub const CORPS_PAR_DEFAUT: f64 = 16.0;

/// Unité CSS par pouce. Les longueurs SVG sont des longueurs CSS.
const PX_PAR_POUCE: f64 = 96.0;

/// Profondeur maximale de parcours de l'arbre (un `use` ne l'augmente pas : il
/// n'est pas suivi).
const PROFONDEUR_MAX: usize = 256;

// ═══════════════════════════════════════════════════════════════════════════
// Erreurs
// ═══════════════════════════════════════════════════════════════════════════

/// Ce qui empêche de lire un SVG.
#[derive(Clone, Debug, PartialEq)]
pub enum ErreurSvg {
    /// Le document n'est pas du XML lisible.
    Xml(ErreurXml),
    /// La racine n'est pas un `<svg>`.
    RacineInattendue {
        /// Le nom de l'élément trouvé.
        nom: String,
    },
    /// Une valeur numérique annoncée n'est pas un nombre.
    NombreIllisible {
        /// Élément qui porte l'attribut.
        element: String,
        /// Nom de l'attribut.
        attribut: String,
        /// Valeur lue.
        valeur: String,
    },
    /// Une longueur dépend d'un contexte que le document ne donne pas.
    ///
    /// Un pourcentage se rapporte au canevas : sans `viewBox`, ni `width`, ni
    /// `height`, il n'y a rien à prendre pour référence. Deviner reviendrait à
    /// placer le dessin au hasard.
    LongueurSansReference {
        /// Élément qui porte l'attribut.
        element: String,
        /// Nom de l'attribut.
        attribut: String,
        /// Valeur lue.
        valeur: String,
    },
    /// Une donnée de chemin n'est pas conforme.
    CheminIllisible {
        /// Rang du caractère fautif dans l'attribut `d`.
        position: usize,
        /// Ce qui ne va pas, en une phrase.
        raison: String,
    },
    /// Un attribut `transform` n'est pas lisible.
    TransformationIllisible {
        /// Valeur lue.
        valeur: String,
        /// Ce qui ne va pas.
        raison: String,
    },
    /// Le fichier n'est pas de l'UTF-8.
    ///
    /// Le produit lit ses SVG avec `FileReader.readAsText`, qui décode en UTF-8 :
    /// c'est le même contrat, et un fichier dans un autre encodage le dit.
    OctetsNonUtf8 {
        /// Rang du premier octet qui ne forme pas un caractère valide.
        position: usize,
    },
    /// Une couleur n'est pas reconnue.
    CouleurIllisible {
        /// Valeur lue.
        valeur: String,
    },
    /// Un élément connu, mais dont l'ignorance **perdrait du dessin**.
    NonSupporte {
        /// Nom de l'élément ou de la propriété.
        quoi: String,
        /// Pourquoi le noyau refuse plutôt que d'approximer.
        raison: String,
    },
}

impl fmt::Display for ErreurSvg {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Xml(e) => write!(f, "SVG illisible : {e}"),
            Self::RacineInattendue { nom } => {
                write!(f, "la racine du document est <{nom}>, pas <svg>")
            }
            Self::NombreIllisible {
                element,
                attribut,
                valeur,
            } => write!(
                f,
                "<{element}> {attribut}=\"{valeur}\" : ce n'est pas un nombre"
            ),
            Self::LongueurSansReference {
                element,
                attribut,
                valeur,
            } => write!(
                f,
                "<{element}> {attribut}=\"{valeur}\" : un pourcentage se rapporte au canevas, \
                 et ce document n'en donne aucun (ni viewBox, ni width, ni height)"
            ),
            Self::CheminIllisible { position, raison } => {
                write!(f, "chemin illisible au caractère {position} : {raison}")
            }
            Self::TransformationIllisible { valeur, raison } => {
                write!(f, "transform=\"{valeur}\" : {raison}")
            }
            Self::OctetsNonUtf8 { position } => write!(
                f,
                "le fichier n'est pas de l'UTF-8 (premier octet invalide au rang {position}) : \
                 l'application lit ses SVG en UTF-8, comme le navigateur"
            ),
            Self::CouleurIllisible { valeur } => write!(
                f,
                "couleur « {valeur} » non reconnue : ni #rrggbb, ni rgb(), ni nom connu"
            ),
            Self::NonSupporte { quoi, raison } => {
                write!(f, "{quoi} : {raison}")
            }
        }
    }
}

impl std::error::Error for ErreurSvg {}

impl From<ErreurXml> for ErreurSvg {
    fn from(e: ErreurXml) -> Self {
        Self::Xml(e)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Couleurs
// ═══════════════════════════════════════════════════════════════════════════

/// Une couleur sRGB, avec son opacité.
///
/// Le SVG ne pense pas en tons directs : ce que le document donne, c'est du
/// sRGB. C'est la même couleur que celle du produit à l'écran, et c'est à
/// l'appelant de la convertir en quadri s'il imprime (le noyau sait le faire :
/// [`superprint_core::color`]).
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Couleur {
    /// Composante rouge.
    pub r: u8,
    /// Composante verte.
    pub g: u8,
    /// Composante bleue.
    pub b: u8,
    /// Opacité, de 0 à 1 (1 = opaque).
    pub alpha: f64,
}

impl Couleur {
    /// Une couleur opaque.
    #[must_use]
    pub const fn rvb(r: u8, g: u8, b: u8) -> Self {
        Self {
            r,
            g,
            b,
            alpha: 1.0,
        }
    }

    /// Le noir opaque : ce que le SVG emploie par défaut, et non « rien ».
    #[must_use]
    pub const fn noir() -> Self {
        Self::rvb(0, 0, 0)
    }

    /// La couleur écrite en `#rrggbb`.
    #[must_use]
    pub fn hexadecimal(&self) -> String {
        format!("#{:02x}{:02x}{:02x}", self.r, self.g, self.b)
    }

    /// La couleur a-t-elle un effet visible ?
    ///
    /// Une opacité nulle est exactement l'absence de peinture : la garder ferait
    /// produire une forme vide.
    #[must_use]
    pub fn est_visible(&self) -> bool {
        self.alpha > 0.0
    }
}

/// Reconnaît une couleur SVG : `#rrggbb`, `#rgb`, `rgb()`, un nom, ou `none`.
///
/// Rend `None` pour `none`, `transparent`, ou une couleur d'opacité nulle.
///
/// # Erreurs
///
/// [`ErreurSvg::CouleurIllisible`] pour tout le reste, **en nommant la valeur** :
/// une couleur de la liste CSS absente de la table du noyau se voit tout de
/// suite, et ne devient jamais un noir silencieux.
pub fn couleur(texte: &str) -> Result<Option<Couleur>, ErreurSvg> {
    let valeur = texte.trim();
    let minuscule = valeur.to_ascii_lowercase();
    match minuscule.as_str() {
        "" | "none" | "transparent" => return Ok(None),
        _ => {}
    }
    if let Some(hex) = minuscule.strip_prefix('#') {
        return couleur_hexadecimale(hex)
            .map(Some)
            .ok_or_else(|| ErreurSvg::CouleurIllisible {
                valeur: valeur.to_string(),
            });
    }
    if minuscule.starts_with("rgb") {
        return couleur_fonction(valeur)
            .map(Some)
            .ok_or_else(|| ErreurSvg::CouleurIllisible {
                valeur: valeur.to_string(),
            });
    }
    if minuscule == "currentcolor" {
        // Signalé par une couleur sentinelle : le contexte la remplace.
        return Ok(Some(COULEUR_COURANTE));
    }
    COULEURS
        .iter()
        .find(|(nom, _)| *nom == minuscule)
        .map(|(_, entier)| {
            Some(Couleur::rvb(
                (entier >> 16) as u8,
                (entier >> 8) as u8,
                *entier as u8,
            ))
        })
        .ok_or_else(|| ErreurSvg::CouleurIllisible {
            valeur: valeur.to_string(),
        })
}

/// Sentinelle interne : `currentColor`, remplacée par le contexte.
const COULEUR_COURANTE: Couleur = Couleur::rvb(0, 0, 1);

fn couleur_hexadecimale(hex: &str) -> Option<Couleur> {
    let chiffres: Vec<u32> = hex
        .chars()
        .map(|c| c.to_digit(16))
        .collect::<Option<Vec<u32>>>()?;
    match chiffres.len() {
        3 => Some(Couleur::rvb(
            (chiffres[0] * 17) as u8,
            (chiffres[1] * 17) as u8,
            (chiffres[2] * 17) as u8,
        )),
        4 => Some(Couleur {
            r: (chiffres[0] * 17) as u8,
            g: (chiffres[1] * 17) as u8,
            b: (chiffres[2] * 17) as u8,
            alpha: (chiffres[3] * 17) as f64 / 255.0,
        }),
        6 => Some(Couleur::rvb(
            (chiffres[0] * 16 + chiffres[1]) as u8,
            (chiffres[2] * 16 + chiffres[3]) as u8,
            (chiffres[4] * 16 + chiffres[5]) as u8,
        )),
        8 => Some(Couleur {
            r: (chiffres[0] * 16 + chiffres[1]) as u8,
            g: (chiffres[2] * 16 + chiffres[3]) as u8,
            b: (chiffres[4] * 16 + chiffres[5]) as u8,
            alpha: ((chiffres[6] * 16 + chiffres[7]) as f64) / 255.0,
        }),
        _ => None,
    }
}

fn couleur_fonction(valeur: &str) -> Option<Couleur> {
    let ouvert = valeur.find('(')?;
    let ferme = valeur.rfind(')')?;
    if ferme <= ouvert {
        return None;
    }
    let entier = valeur[..ouvert].trim().to_ascii_lowercase();
    let corps = &valeur[ouvert + 1..ferme];
    let morceaux: Vec<&str> = corps
        .split([',', '/', ' ', '\t', '\n'])
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .collect();
    match entier.as_str() {
        "rgb" | "rgba" if (3..=4).contains(&morceaux.len()) => {
            let composantes: Vec<f64> = morceaux[..3]
                .iter()
                .map(|m| composante_couleur(m))
                .collect::<Option<Vec<f64>>>()?;
            let alpha = match morceaux.get(3) {
                Some(texte) => alpha_couleur(texte)?,
                None => 1.0,
            };
            let octet = |v: f64| v.round().clamp(0.0, 255.0) as u8;
            Some(Couleur {
                r: octet(composantes[0]),
                g: octet(composantes[1]),
                b: octet(composantes[2]),
                alpha: alpha.clamp(0.0, 1.0),
            })
        }
        _ => None,
    }
}

/// Une composante de `rgb()` : un nombre de 0 à 255, ou un pourcentage.
fn composante_couleur(texte: &str) -> Option<f64> {
    match texte.trim().strip_suffix('%') {
        Some(reste) => reste.trim().parse::<f64>().ok().map(|v| v * 255.0 / 100.0),
        None => texte.trim().parse::<f64>().ok(),
    }
}

/// L'opacité de `rgba()` : un nombre de 0 à 1, ou un pourcentage.
fn alpha_couleur(texte: &str) -> Option<f64> {
    match texte.trim().strip_suffix('%') {
        Some(reste) => reste.trim().parse::<f64>().ok().map(|v| v / 100.0),
        None => texte.trim().parse::<f64>().ok(),
    }
}

/// Les couleurs nommées, avec leur valeur.
///
/// ## D'où vient cette table
///
/// Elle est **relevée du produit** : `superprint/app/JS/jspdf.umd.min.js` porte
/// la table de `rgbcolor.js` (celle qu'emploie aussi le navigateur), et
/// `scripts/validate-svg.mjs` relit ce fichier pour comparer **les 143 entrées,
/// nom par nom**. Ce n'est donc pas une liste recopiée de mémoire.
///
/// ## Les six entrées en plus
///
/// La table du produit mélange les orthographes (`lightgrey` mais `darkgray`).
/// Les six écritures britanniques ou américaines manquantes sont ajoutées, pour
/// qu'un auteur n'ait pas à deviner laquelle le noyau connaît. Elles sont
/// **déclarées** ici, et le contrôle les compte séparément.
pub const COULEURS: &[(&str, u32)] = &[
    ("aliceblue", 0xf0f8ff),
    ("antiquewhite", 0xfaebd7),
    ("aqua", 0x00ffff),
    ("aquamarine", 0x7fffd4),
    ("azure", 0xf0ffff),
    ("beige", 0xf5f5dc),
    ("bisque", 0xffe4c4),
    ("black", 0x000000),
    ("blanchedalmond", 0xffebcd),
    ("blue", 0x0000ff),
    ("blueviolet", 0x8a2be2),
    ("brown", 0xa52a2a),
    ("burlywood", 0xdeb887),
    ("cadetblue", 0x5f9ea0),
    ("chartreuse", 0x7fff00),
    ("chocolate", 0xd2691e),
    ("coral", 0xff7f50),
    ("cornflowerblue", 0x6495ed),
    ("cornsilk", 0xfff8dc),
    ("crimson", 0xdc143c),
    ("cyan", 0x00ffff),
    ("darkblue", 0x00008b),
    ("darkcyan", 0x008b8b),
    ("darkgoldenrod", 0xb8860b),
    ("darkgray", 0xa9a9a9),
    ("darkgreen", 0x006400),
    ("darkgrey", 0xa9a9a9),
    ("darkkhaki", 0xbdb76b),
    ("darkmagenta", 0x8b008b),
    ("darkolivegreen", 0x556b2f),
    ("darkorange", 0xff8c00),
    ("darkorchid", 0x9932cc),
    ("darkred", 0x8b0000),
    ("darksalmon", 0xe9967a),
    ("darkseagreen", 0x8fbc8f),
    ("darkslateblue", 0x483d8b),
    ("darkslategray", 0x2f4f4f),
    ("darkturquoise", 0x00ced1),
    ("darkviolet", 0x9400d3),
    ("deeppink", 0xff1493),
    ("deepskyblue", 0x00bfff),
    ("dimgray", 0x696969),
    ("dimgrey", 0x696969),
    ("dodgerblue", 0x1e90ff),
    ("feldspar", 0xd19275),
    ("firebrick", 0xb22222),
    ("floralwhite", 0xfffaf0),
    ("forestgreen", 0x228b22),
    ("fuchsia", 0xff00ff),
    ("gainsboro", 0xdcdcdc),
    ("ghostwhite", 0xf8f8ff),
    ("gold", 0xffd700),
    ("goldenrod", 0xdaa520),
    ("gray", 0x808080),
    ("green", 0x008000),
    ("greenyellow", 0xadff2f),
    ("grey", 0x808080),
    ("honeydew", 0xf0fff0),
    ("hotpink", 0xff69b4),
    ("indianred", 0xcd5c5c),
    ("indigo", 0x4b0082),
    ("ivory", 0xfffff0),
    ("khaki", 0xf0e68c),
    ("lavender", 0xe6e6fa),
    ("lavenderblush", 0xfff0f5),
    ("lawngreen", 0x7cfc00),
    ("lemonchiffon", 0xfffacd),
    ("lightblue", 0xadd8e6),
    ("lightcoral", 0xf08080),
    ("lightcyan", 0xe0ffff),
    ("lightgoldenrodyellow", 0xfafad2),
    ("lightgray", 0xd3d3d3),
    ("lightgreen", 0x90ee90),
    ("lightgrey", 0xd3d3d3),
    ("lightpink", 0xffb6c1),
    ("lightsalmon", 0xffa07a),
    ("lightseagreen", 0x20b2aa),
    ("lightskyblue", 0x87cefa),
    ("lightslateblue", 0x8470ff),
    ("lightslategray", 0x778899),
    ("lightslategrey", 0x778899),
    ("lightsteelblue", 0xb0c4de),
    ("lightyellow", 0xffffe0),
    ("lime", 0x00ff00),
    ("limegreen", 0x32cd32),
    ("linen", 0xfaf0e6),
    ("magenta", 0xff00ff),
    ("maroon", 0x800000),
    ("mediumaquamarine", 0x66cdaa),
    ("mediumblue", 0x0000cd),
    ("mediumorchid", 0xba55d3),
    ("mediumpurple", 0x9370d8),
    ("mediumseagreen", 0x3cb371),
    ("mediumslateblue", 0x7b68ee),
    ("mediumspringgreen", 0x00fa9a),
    ("mediumturquoise", 0x48d1cc),
    ("mediumvioletred", 0xc71585),
    ("midnightblue", 0x191970),
    ("mintcream", 0xf5fffa),
    ("mistyrose", 0xffe4e1),
    ("moccasin", 0xffe4b5),
    ("navajowhite", 0xffdead),
    ("navy", 0x000080),
    ("oldlace", 0xfdf5e6),
    ("olive", 0x808000),
    ("olivedrab", 0x6b8e23),
    ("orange", 0xffa500),
    ("orangered", 0xff4500),
    ("orchid", 0xda70d6),
    ("palegoldenrod", 0xeee8aa),
    ("palegreen", 0x98fb98),
    ("paleturquoise", 0xafeeee),
    ("palevioletred", 0xd87093),
    ("papayawhip", 0xffefd5),
    ("peachpuff", 0xffdab9),
    ("peru", 0xcd853f),
    ("pink", 0xffc0cb),
    ("plum", 0xdda0dd),
    ("powderblue", 0xb0e0e6),
    ("purple", 0x800080),
    ("red", 0xff0000),
    ("rosybrown", 0xbc8f8f),
    ("royalblue", 0x4169e1),
    ("saddlebrown", 0x8b4513),
    ("salmon", 0xfa8072),
    ("sandybrown", 0xf4a460),
    ("seagreen", 0x2e8b57),
    ("seashell", 0xfff5ee),
    ("sienna", 0xa0522d),
    ("silver", 0xc0c0c0),
    ("skyblue", 0x87ceeb),
    ("slateblue", 0x6a5acd),
    ("slategray", 0x708090),
    ("slategrey", 0x708090),
    ("snow", 0xfffafa),
    ("springgreen", 0x00ff7f),
    ("steelblue", 0x4682b4),
    ("tan", 0xd2b48c),
    ("teal", 0x008080),
    ("thistle", 0xd8bfd8),
    ("tomato", 0xff6347),
    ("turquoise", 0x40e0d0),
    ("violet", 0xee82ee),
    ("violetred", 0xd02090),
    ("wheat", 0xf5deb3),
    ("white", 0xffffff),
    ("whitesmoke", 0xf5f5f5),
    ("yellow", 0xffff00),
    ("yellowgreen", 0x9acd32),
];

// ═══════════════════════════════════════════════════════════════════════════
// Contour
// ═══════════════════════════════════════════════════════════════════════════

/// Forme de l'extrémité d'un trait ouvert (`stroke-linecap`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Extremite {
    /// Coupé net (`butt`), le défaut du SVG.
    #[default]
    Bout,
    /// Arrondi (`round`).
    Rond,
    /// Prolongé d'une demi-épaisseur (`square`).
    Carre,
}

/// Forme de la jonction entre deux segments (`stroke-linejoin`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Jonction {
    /// Prolongé jusqu'à l'intersection (`miter`), le défaut du SVG.
    #[default]
    Miter,
    /// Arrondi (`round`).
    Rond,
    /// Coupé (`bevel`).
    Biseau,
}

/// Un contour : sa couleur, son épaisseur, ses extrémités.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Trait {
    /// La couleur du trait.
    pub couleur: Couleur,
    /// L'épaisseur, en unités utilisateur.
    ///
    /// Un trait d'épaisseur nulle ne dessine rien : le SVG le dit ainsi, et le
    /// noyau le fait ainsi plutôt que de peindre un pixel.
    pub epaisseur: f64,
    /// La forme des extrémités.
    pub extremite: Extremite,
    /// La forme des jonctions.
    pub jonction: Jonction,
}

// ═══════════════════════════════════════════════════════════════════════════
// Texte
// ═══════════════════════════════════════════════════════════════════════════

/// Position du texte par rapport au point d'ancrage (`text-anchor`).
#[derive(Clone, Copy, Debug, Default, PartialEq, Eq)]
pub enum Ancre {
    /// Le point est le début du texte (`start`), le défaut du SVG.
    #[default]
    Debut,
    /// Le point est le milieu (`middle`).
    Milieu,
    /// Le point est la fin (`end`).
    Fin,
}

/// Un texte lu, **non dessiné**.
///
/// Le noyau ne dessine pas de glyphes : il rend ce qu'il sait — la chaîne, le
/// point, le corps, la famille demandée, l'ancre — et laisse l'appelant fournir
/// la police. C'est exactement le contrat de l'écrivain PDF, qui prend une
/// police explicite.
#[derive(Clone, Debug, PartialEq)]
pub struct Texte {
    /// Le contenu, entités résolues.
    pub contenu: String,
    /// L'abscisse du point d'ancrage, en unités utilisateur du canevas.
    pub x: f64,
    /// L'ordonnée du point d'ancrage (la **ligne de base**), en unités
    /// utilisateur du canevas.
    pub y: f64,
    /// Le corps demandé, en unités utilisateur.
    pub corps: f64,
    /// La famille demandée, telle qu'écrite (`Arial, sans-serif`).
    pub famille: String,
    /// Gras (`font-weight` ≥ 600 ou `bold`).
    pub gras: bool,
    /// Italique.
    pub italique: bool,
    /// L'ancre.
    pub ancre: Ancre,
    /// La peinture du texte, ou `None` si le texte ne se remplit pas.
    pub remplissage: Option<Couleur>,
    /// La transformation cumulée au point du texte.
    ///
    /// Elle sert à **placer** le texte : une rotation devient une rotation du
    /// bloc de texte, pas une rotation des glyphes.
    pub transformation: Matrice,
}

// ═══════════════════════════════════════════════════════════════════════════
// Formes
// ═══════════════════════════════════════════════════════════════════════════

/// Une forme peinte : ses sous-chemins, son remplissage et son contour.
///
/// ## Ce qui est dans le modèle, et ce qui n'y est pas
///
/// Un même chemin SVG peut être **rempli et contouré** en même temps. Les deux
/// sont donc ici, séparément, avec leur opacité déjà multipliée par celle des
/// groupes parents. Ce qui n'y est **pas** : les dégradés, les motifs et les
/// découpages — ils sont refusés à la lecture ([`ErreurSvg::NonSupporte`])
/// plutôt que réduits à une couleur moyenne.
#[derive(Clone, Debug, PartialEq)]
pub struct Forme {
    /// Les sous-chemins, aplatis, dans le repère du canevas.
    ///
    /// Un sous-chemin fermé se termine par une répétition de son premier point :
    /// c'est la convention de `superprint-ps`, pour que les deux importeurs
    /// produisent la même chose.
    pub sous_chemins: Vec<Vec<Point>>,
    /// La peinture du remplissage, ou `None` (`fill="none"`, ou une forme qui
    /// n'a pas d'intérieur, comme un segment).
    pub remplissage: Option<Couleur>,
    /// La règle de remplissage (`fill-rule`).
    pub regle: Regle,
    /// Le contour, ou `None`.
    pub contour: Option<Trait>,
    /// L'identifiant `id` de l'élément, quand il en a un.
    pub id: Option<String>,
}

impl Forme {
    /// Le nombre de sommets, tous sous-chemins confondus.
    #[must_use]
    pub fn nombre_de_sommets(&self) -> usize {
        self.sous_chemins.iter().map(Vec::len).sum()
    }

    /// La boîte englobante, ou `None` si la forme n'a aucun point.
    #[must_use]
    pub fn boite(&self) -> Option<(Point, Point)> {
        let mut min: Option<Point> = None;
        let mut max: Option<Point> = None;
        for point in self.sous_chemins.iter().flatten() {
            min = Some(match min {
                None => *point,
                Some(m) => Point::new(m.x.min(point.x), m.y.min(point.y)),
            });
            max = Some(match max {
                None => *point,
                Some(m) => Point::new(m.x.max(point.x), m.y.max(point.y)),
            });
        }
        Some((min?, max?))
    }

    /// L'aire signée, tous sous-chemins additionnés (formule du lacet).
    ///
    /// Elle est **signée** : un trou parcouru à l'envers se retranche. C'est la
    /// propriété qui rend la comparaison avec un contrôle indépendant utile —
    /// deux lectures qui trouvent la même surface sont d'accord sur la forme.
    #[must_use]
    pub fn aire(&self) -> f64 {
        let mut somme = 0.0;
        for sous_chemin in &self.sous_chemins {
            let n = sous_chemin.len();
            if n < 3 {
                continue;
            }
            for i in 0..n {
                let a = sous_chemin[i];
                let b = sous_chemin[(i + 1) % n];
                somme += a.x * b.y - b.x * a.y;
            }
        }
        somme / 2.0
    }

    /// La forme est-elle peinte d'au moins une façon visible ?
    #[must_use]
    pub fn est_peinte(&self) -> bool {
        self.remplissage.is_some_and(|c| c.est_visible())
            || self
                .contour
                .is_some_and(|t| t.couleur.est_visible() && t.epaisseur > 0.0)
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// Document
// ═══════════════════════════════════════════════════════════════════════════

/// Un SVG lu.
#[derive(Clone, Debug, PartialEq)]
pub struct DocumentSvg {
    /// Largeur du canevas, en unités utilisateur, quand elle est connue.
    pub largeur: Option<f64>,
    /// Hauteur du canevas, en unités utilisateur, quand elle est connue.
    pub hauteur: Option<f64>,
    /// La fenêtre du `viewBox`, dans le repère d'origine du document.
    pub view_box: Option<Boite>,
    /// Les formes, dans l'ordre du document.
    pub formes: Vec<Forme>,
    /// Les textes lus, **non dessinés** (voir [`Texte`]).
    pub textes: Vec<Texte>,
    /// Les éléments rencontrés et **non rendus**, triés par nom, avec leur
    /// nombre d'occurrences.
    ///
    /// Ce ne sont pas des erreurs : `defs`, `title`, `metadata` décrivent sans
    /// dessiner. La liste est là pour qu'un import qui ne rend pas tout le dise
    /// — et `style`, `clipPath`, `mask` y figurent aussi, car eux **changeraient**
    /// le dessin s'ils étaient appliqués. Un `clip-path` **sur une forme**, lui,
    /// arrête la lecture.
    pub non_rendus: Vec<(String, usize)>,
    /// Les avertissements : ce qui a été accepté sans effet.
    pub avertissements: Vec<String>,
    /// Le nombre d'entités déclarées par le DTD interne.
    pub entites: usize,
    /// La tolérance d'aplatissement employée, en unités utilisateur.
    pub tolerance: f64,
}

impl DocumentSvg {
    /// Le nombre de sommets de toutes les formes.
    #[must_use]
    pub fn nombre_de_sommets(&self) -> usize {
        self.formes.iter().map(Forme::nombre_de_sommets).sum()
    }

    /// La boîte de tout le dessin, ou `None` s'il n'y a aucune forme.
    #[must_use]
    pub fn boite(&self) -> Option<(Point, Point)> {
        let mut min: Option<Point> = None;
        let mut max: Option<Point> = None;
        for forme in &self.formes {
            let Some((bas, haut)) = forme.boite() else {
                continue;
            };
            min = Some(match min {
                None => bas,
                Some(m) => Point::new(m.x.min(bas.x), m.y.min(bas.y)),
            });
            max = Some(match max {
                None => haut,
                Some(m) => Point::new(m.x.max(haut.x), m.y.max(haut.y)),
            });
        }
        Some((min?, max?))
    }

    /// L'aire signée de toutes les formes.
    #[must_use]
    pub fn aire(&self) -> f64 {
        self.formes.iter().map(Forme::aire).sum()
    }

    /// Le nombre de fois qu'un élément a été rencontré sans être rendu.
    #[must_use]
    pub fn non_rendu(&self, nom: &str) -> usize {
        self.non_rendus
            .iter()
            .find(|(n, _)| n == nom)
            .map_or(0, |(_, compte)| *compte)
    }
}

/// Lit un SVG depuis son texte.
///
/// # Erreurs
///
/// Voir [`ErreurSvg`].
pub fn lire(texte: &str) -> Result<DocumentSvg, ErreurSvg> {
    lire_avec(texte, TOLERANCE_PAR_DEFAUT)
}

/// Lit un SVG avec une tolérance d'aplatissement explicite.
///
/// # Erreurs
///
/// Voir [`ErreurSvg`].
pub fn lire_avec(texte: &str, tolerance: f64) -> Result<DocumentSvg, ErreurSvg> {
    let (racine, entites) = xml::analyser_avec_entites(texte)?;
    if !racine.est("svg") {
        return Err(ErreurSvg::RacineInattendue {
            nom: racine.nom.clone(),
        });
    }
    let mut parcours = Parcours {
        formes: Vec::new(),
        textes: Vec::new(),
        non_rendus: Vec::new(),
        avertissements: Vec::new(),
        tolerance: if tolerance > 0.0 {
            tolerance
        } else {
            TOLERANCE_PAR_DEFAUT
        },
        largeur: None,
        hauteur: None,
        view_box: None,
    };
    let racine_geometrie = parcours.lire_canevas(&racine)?;
    parcours.parcourir(&racine, &Style::defaut(), racine_geometrie, 0)?;
    // Les éléments non rendus sont triés par nom : un rapport se lit dans le
    // même ordre quel que soit l'ordre de parcours.
    parcours.non_rendus.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(DocumentSvg {
        largeur: parcours.largeur,
        hauteur: parcours.hauteur,
        view_box: parcours.view_box,
        formes: parcours.formes,
        textes: parcours.textes,
        non_rendus: parcours.non_rendus,
        avertissements: parcours.avertissements,
        entites: entites.nombre(),
        tolerance: parcours.tolerance,
    })
}

/// Lit un SVG depuis des octets, en UTF-8.
///
/// Le produit lit ses SVG avec `FileReader.readAsText`, qui décode en UTF-8 :
/// c'est donc le même contrat. Un octet de marque (`BOM`) est retiré.
///
/// # Erreurs
///
/// [`ErreurSvg::Xml`] si les octets ne sont pas de l'UTF-8 valide.
pub fn lire_octets(octets: &[u8], tolerance: f64) -> Result<DocumentSvg, ErreurSvg> {
    let sans_bom = octets
        .strip_prefix([0xEF, 0xBB, 0xBF].as_slice())
        .unwrap_or(octets);
    let texte = std::str::from_utf8(sans_bom).map_err(|e| ErreurSvg::OctetsNonUtf8 {
        position: e.valid_up_to(),
    })?;
    lire_avec(texte, tolerance)
}

// ═══════════════════════════════════════════════════════════════════════════
// Style hérité
// ═══════════════════════════════════════════════════════════════════════════

/// Les propriétés de présentation, héritées de parent en enfant.
#[derive(Clone, Debug)]
struct Style {
    remplissage: Option<Couleur>,
    regle: Regle,
    contour: Option<Trait>,
    couleur_courante: Couleur,
    opacite: f64,
    opacite_remplissage: f64,
    opacite_contour: f64,
    corps: f64,
    famille: String,
    gras: bool,
    italique: bool,
    ancre: Ancre,
}

impl Style {
    fn defaut() -> Self {
        Self {
            remplissage: Some(Couleur::noir()),
            regle: Regle::NonZero,
            contour: None,
            couleur_courante: Couleur::noir(),
            opacite: 1.0,
            opacite_remplissage: 1.0,
            opacite_contour: 1.0,
            corps: CORPS_PAR_DEFAUT,
            famille: String::new(),
            gras: false,
            italique: false,
            ancre: Ancre::Debut,
        }
    }

    /// Le style d'un enfant.
    ///
    /// Le SVG distingue deux familles, et le noyau suit la distinction :
    ///
    /// - ce qui **s'hérite** — `fill`, `stroke`, `fill-opacity`, la police… —
    ///   est recopié, et l'enfant le **remplace** s'il en donne un ;
    /// - `opacity`, qui **ne s'hérite pas** mais **se compose** : l'opacité d'un
    ///   groupe s'applique à tout ce qu'il contient. Elle est donc transportée
    ///   telle quelle, et multipliée par celle de l'élément.
    fn herite(&self) -> Self {
        self.clone()
    }

    /// Applique les attributs de présentation d'un élément.
    fn appliquer(&mut self, element: &Element, parcours: &mut Parcours) -> Result<(), ErreurSvg> {
        let proprietes = proprietes_de_presentation(element);
        for (nom, valeur) in proprietes {
            self.propriete(&nom, &valeur, element, parcours)?;
        }
        Ok(())
    }

    fn propriete(
        &mut self,
        nom: &str,
        valeur: &str,
        element: &Element,
        parcours: &mut Parcours,
    ) -> Result<(), ErreurSvg> {
        let valeur = valeur.trim();
        match nom {
            "fill" => self.remplissage = paint("fill", valeur, element, parcours)?,
            "stroke" => {
                self.contour = paint("stroke", valeur, element, parcours)?.map(|couleur| Trait {
                    couleur,
                    epaisseur: 1.0,
                    extremite: Extremite::Bout,
                    jonction: Jonction::Miter,
                });
            }
            "fill-rule" | "clip-rule" => {
                self.regle = match valeur {
                    "evenodd" => Regle::PairImpair,
                    "nonzero" => Regle::NonZero,
                    _ => {
                        parcours.avertir(format!(
                            "fill-rule=\"{valeur}\" inconnu : la règle non nulle est employée"
                        ));
                        self.regle
                    }
                };
            }
            "stroke-width" => {
                let epaisseur = parcours.longueur(element, "stroke-width", valeur)?;
                if let Some(trait_) = &mut self.contour {
                    trait_.epaisseur = epaisseur;
                }
            }
            "stroke-linecap" => {
                let forme = match valeur {
                    "butt" => Extremite::Bout,
                    "round" => Extremite::Rond,
                    "square" => Extremite::Carre,
                    _ => Extremite::Bout,
                };
                if let Some(trait_) = &mut self.contour {
                    trait_.extremite = forme;
                }
            }
            "stroke-linejoin" => {
                let forme = match valeur {
                    "miter" => Jonction::Miter,
                    "round" => Jonction::Rond,
                    "bevel" => Jonction::Biseau,
                    _ => Jonction::Miter,
                };
                if let Some(trait_) = &mut self.contour {
                    trait_.jonction = forme;
                }
            }
            "color" => {
                if let Some(couleur) = couleur(valeur)? {
                    self.couleur_courante = couleur;
                    if self.remplissage == Some(COULEUR_COURANTE) {
                        self.remplissage = Some(couleur);
                    }
                    if let Some(trait_) = &mut self.contour {
                        if trait_.couleur == COULEUR_COURANTE {
                            trait_.couleur = couleur;
                        }
                    }
                }
            }
            "opacity" => {
                let o = parcours.nombre(element, "opacity", valeur)?;
                self.opacite *= o.clamp(0.0, 1.0);
            }
            "fill-opacity" => {
                // `fill-opacity` **s'hérite** : l'enfant remplace la valeur du
                // parent, il ne la multiplie pas.
                let o = parcours.nombre(element, "fill-opacity", valeur)?;
                self.opacite_remplissage = o.clamp(0.0, 1.0);
            }
            "stroke-opacity" => {
                let o = parcours.nombre(element, "stroke-opacity", valeur)?;
                self.opacite_contour = o.clamp(0.0, 1.0);
            }
            "font-size" => {
                // Un pourcentage de `font-size` se rapporte au corps du parent,
                // comme en CSS — pas au canevas.
                self.corps = if let Some(pourcent) = valeur.strip_suffix('%') {
                    let part = parcours.nombre(element, "font-size", pourcent)?;
                    self.corps * part / 100.0
                } else {
                    parcours.longueur(element, "font-size", valeur)?
                };
            }
            "font-family" => self.famille = valeur.trim_matches(['"', '\'']).to_string(),
            "font-weight" => {
                self.gras =
                    valeur == "bold" || valeur.parse::<u32>().is_ok_and(|poids| poids >= 600);
            }
            "font-style" => self.italique = valeur == "italic" || valeur == "oblique",
            "text-anchor" => {
                self.ancre = match valeur {
                    "middle" => Ancre::Milieu,
                    "end" => Ancre::Fin,
                    _ => Ancre::Debut,
                };
            }
            // Ce qui change le dessin sans que le noyau le fasse : refusé.
            "clip-path" | "mask" | "filter" => {
                return Err(ErreurSvg::NonSupporte {
                    quoi: format!("{nom}=\"{valeur}\""),
                    raison: "découper, masquer ou filtrer demande une algèbre de régions \
                             ou un moteur de rendu ; le noyau préfère refuser que rendre \
                             une forme entière là où elle devait être découpée"
                        .to_string(),
                });
            }
            "style" => self.proprietes_de_style(valeur, element, parcours)?,
            "stroke-dasharray" if valeur != "none" && !valeur.trim().is_empty() => {
                parcours.avertir(format!(
                    "stroke-dasharray=\"{valeur}\" : les pointillés ne sont pas rendus"
                ));
            }
            _ => {}
        }
        Ok(())
    }

    /// Lit un attribut `style="propriété: valeur; …"`.
    ///
    /// Les propriétés connues sont appliquées ; les inconnues sont **comptées**,
    /// pas devinées — c'est aussi ce que fait un moteur CSS.
    fn proprietes_de_style(
        &mut self,
        valeur: &str,
        element: &Element,
        parcours: &mut Parcours,
    ) -> Result<(), ErreurSvg> {
        let mut inconnues: Vec<String> = Vec::new();
        for declaration in valeur.split(';') {
            let Some((nom, brut)) = declaration.split_once(':') else {
                continue;
            };
            let nom = nom.trim().to_ascii_lowercase();
            let valeur = brut.trim();
            if valeur.is_empty() {
                continue;
            }
            if !PROPRIETES_CONNUES.contains(&nom.as_str()) && nom != "transform" {
                inconnues.push(nom);
                continue;
            }
            self.propriete(&nom, valeur, element, parcours)?;
        }
        if !inconnues.is_empty() {
            parcours.avertir(format!(
                "style : propriété(s) non appliquée(s) : {}",
                inconnues.join(", ")
            ));
        }
        Ok(())
    }
}

/// Les propriétés que [`Style::propriete`] sait appliquer.
const PROPRIETES_CONNUES: &[&str] = &[
    "fill",
    "fill-rule",
    "fill-opacity",
    "stroke",
    "stroke-width",
    "stroke-linecap",
    "stroke-linejoin",
    "stroke-opacity",
    "color",
    "opacity",
    "font-size",
    "font-family",
    "font-weight",
    "font-style",
    "text-anchor",
    "stroke-dasharray",
    "stroke-dashoffset",
    "stroke-miterlimit",
    "clip-path",
    "mask",
    "filter",
];

/// Les attributs de présentation d'un élément, `style=` déplié à la fin.
fn proprietes_de_presentation(element: &Element) -> Vec<(String, String)> {
    let mut sortie = Vec::new();
    for (nom, valeur) in &element.attributs {
        if nom == "style" {
            continue;
        }
        sortie.push((nom.clone(), valeur.clone()));
    }
    if let Some(style) = element.attribut("style") {
        sortie.push(("style".to_string(), style.to_string()));
    }
    sortie
}

/// Lit une peinture : une couleur, `none`, ou une référence refusée.
fn paint(
    propriete: &str,
    valeur: &str,
    element: &Element,
    _parcours: &mut Parcours,
) -> Result<Option<Couleur>, ErreurSvg> {
    if valeur.starts_with("url(") {
        return Err(ErreurSvg::NonSupporte {
            quoi: format!("<{}> {propriete}=\"{valeur}\"", element.nom),
            raison: "un dégradé ou un motif n'est pas rendu : le réduire à une couleur \
                     moyenne changerait la couleur livrée, et c'est exactement ce qu'un \
                     imprimeur ne pardonne pas"
                .to_string(),
        });
    }
    couleur(valeur)
}

// ═══════════════════════════════════════════════════════════════════════════
// Parcours de l'arbre
// ═══════════════════════════════════════════════════════════════════════════

struct Parcours {
    formes: Vec<Forme>,
    textes: Vec<Texte>,
    non_rendus: Vec<(String, usize)>,
    avertissements: Vec<String>,
    tolerance: f64,
    largeur: Option<f64>,
    hauteur: Option<f64>,
    view_box: Option<Boite>,
}

impl Parcours {
    fn avertir(&mut self, message: String) {
        if !self.avertissements.contains(&message) {
            self.avertissements.push(message);
        }
    }

    fn compter(&mut self, nom: &str) {
        match self.non_rendus.iter_mut().find(|(n, _)| n == nom) {
            Some((_, compte)) => *compte += 1,
            None => self.non_rendus.push((nom.to_string(), 1)),
        }
    }

    /// Lit les dimensions du canevas et la matrice `viewBox` → canevas.
    fn lire_canevas(&mut self, racine: &Element) -> Result<Matrice, ErreurSvg> {
        let view_box = match racine.attribut("viewBox") {
            Some(valeur) => {
                let nombres = nombres_liste(valeur);
                if nombres.len() != 4 || nombres[2] <= 0.0 || nombres[3] <= 0.0 {
                    self.avertir(format!(
                        "viewBox=\"{valeur}\" n'est pas quatre nombres, dont deux positifs : ignoré"
                    ));
                    None
                } else {
                    Some(Boite {
                        min: Point::new(nombres[0], nombres[1]),
                        max: Point::new(nombres[0] + nombres[2], nombres[1] + nombres[3]),
                    })
                }
            }
            None => None,
        };
        self.view_box = view_box;

        let reference = view_box.map(|vb| vb.max.x - vb.min.x);
        let largeur = self.longueur_optionnelle(racine, "width", reference)?;
        let reference = view_box.map(|vb| vb.max.y - vb.min.y);
        let hauteur = self.longueur_optionnelle(racine, "height", reference)?;

        let (largeur, hauteur) = match view_box {
            Some(vb) => (
                largeur.unwrap_or(vb.max.x - vb.min.x),
                hauteur.unwrap_or(vb.max.y - vb.min.y),
            ),
            None => (largeur.unwrap_or(0.0), hauteur.unwrap_or(0.0)),
        };
        self.largeur = if largeur > 0.0 { Some(largeur) } else { None };
        self.hauteur = if hauteur > 0.0 { Some(hauteur) } else { None };

        let Some(vb) = view_box else {
            return Ok(Matrice::identite());
        };
        let (vw, vh) = (vb.max.x - vb.min.x, vb.max.y - vb.min.y);
        let (cible_w, cible_h) = (self.largeur.unwrap_or(vw), self.hauteur.unwrap_or(vh));
        let (facteur_x, facteur_y) = if vw > 0.0 && vh > 0.0 {
            (cible_w / vw, cible_h / vh)
        } else {
            (1.0, 1.0)
        };
        let alignement = racine
            .attribut("preserveAspectRatio")
            .map(|v| v.trim().to_ascii_lowercase());
        let (fx, fy, decalage_x, decalage_y) = match alignement.as_deref() {
            Some(valeur) if valeur.starts_with("none") => (facteur_x, facteur_y, 0.0, 0.0),
            Some(valeur) if valeur.contains("slice") => {
                let f = facteur_x.max(facteur_y);
                let (dx, dy) = centrage(valeur, cible_w - vw * f, cible_h - vh * f);
                (f, f, dx, dy)
            }
            Some(valeur) => {
                let f = facteur_x.min(facteur_y);
                let (dx, dy) = centrage(valeur, cible_w - vw * f, cible_h - vh * f);
                (f, f, dx, dy)
            }
            None => {
                let f = facteur_x.min(facteur_y);
                (f, f, (cible_w - vw * f) / 2.0, (cible_h - vh * f) / 2.0)
            }
        };
        Ok(Matrice::translation(-vb.min.x, -vb.min.y)
            .concatener(Matrice::echelle(fx, fy))
            .concatener(Matrice::translation(decalage_x, decalage_y)))
    }

    fn parcourir(
        &mut self,
        element: &Element,
        style_parent: &Style,
        transformation: Matrice,
        profondeur: usize,
    ) -> Result<(), ErreurSvg> {
        if profondeur > PROFONDEUR_MAX {
            return Ok(());
        }
        // Ce qui n'est pas rendu l'est **avant** d'appliquer le style : un
        // élément masqué qui porte un `clip-path` ne doit pas faire échouer la
        // lecture d'un document dont le dessin, lui, est complet.
        if a_l_attribut_non_rendu(element) {
            self.compter(&element.nom);
            return Ok(());
        }
        let mut style = style_parent.herite();
        style.appliquer(element, self)?;
        if style.remplissage == Some(COULEUR_COURANTE) {
            style.remplissage = Some(style.couleur_courante);
        }
        if let Some(trait_) = &mut style.contour {
            if trait_.couleur == COULEUR_COURANTE {
                trait_.couleur = style.couleur_courante;
            }
        }
        let transformation = transformation.concatener(self.transformation(element)?);

        let nom = element.local().to_string();
        match nom.as_str() {
            "svg" | "g" | "a" => {
                if nom == "svg"
                    && (element.attribut("viewBox").is_some()
                        || element.attribut("x").is_some()
                        || element.attribut("y").is_some())
                {
                    self.avertir(
                        "<svg> imbriqué : son décalage et son viewBox ne sont pas appliqués, \
                         il est traité comme un groupe"
                            .to_string(),
                    );
                }
                for enfant in element.elements() {
                    self.parcourir(enfant, &style, transformation, profondeur + 1)?;
                }
            }
            "switch" => {
                if let Some(choisi) = choisir_dans_switch(element) {
                    self.parcourir(choisi, &style, transformation, profondeur + 1)?;
                }
            }
            "path" | "rect" | "circle" | "ellipse" | "line" | "polyline" | "polygon" => {
                if let Some(forme) = self.lire_forme(element, &nom, &style, transformation)? {
                    self.formes.push(forme);
                }
            }
            "text" => self.lire_texte(element, &style, transformation)?,
            "title" | "desc" | "metadata" | "defs" | "symbol" | "marker" | "clipPath" | "mask"
            | "linearGradient" | "radialGradient" | "pattern" | "filter" | "foreignObject" => {
                self.compter(&element.nom);
            }
            "style" => {
                return Err(ErreurSvg::NonSupporte {
                    quoi: "élément <style>".to_string(),
                    raison: "le noyau n'applique pas CSS : lire la moitié des règles \
                             changerait les couleurs, et l'autre moitié les laisserait fausses"
                        .to_string(),
                });
            }
            "image" => {
                return Err(ErreurSvg::NonSupporte {
                    quoi: "élément <image>".to_string(),
                    raison: "l'image est bitmap et demande un décodeur (PNG, JPEG) : \
                             la sauter laisserait un trou, la remplacer serait une invention"
                        .to_string(),
                });
            }
            "use" => {
                return Err(ErreurSvg::NonSupporte {
                    quoi: "élément <use>".to_string(),
                    raison: "il référence une définition ; ne pas le suivre amputerait le \
                             dessin d'un morceau entier, et le suivre demande de résoudre \
                             les identifiants du document"
                        .to_string(),
                });
            }
            autre => {
                self.compter(autre);
            }
        }
        Ok(())
    }

    /// Lit l'attribut `transform` d'un élément.
    fn transformation(&self, element: &Element) -> Result<Matrice, ErreurSvg> {
        match element.attribut("transform") {
            Some(valeur) => analyser_transformation(valeur),
            None => Ok(Matrice::identite()),
        }
    }

    fn lire_forme(
        &mut self,
        element: &Element,
        nom: &str,
        style: &Style,
        transformation: Matrice,
    ) -> Result<Option<Forme>, ErreurSvg> {
        let mut sous_chemins = self.geometrie(element, nom)?;
        if sous_chemins.is_empty() {
            return Ok(None);
        }
        for sous_chemin in &mut sous_chemins {
            for point in sous_chemin.iter_mut() {
                *point = transformation.appliquer(*point);
            }
        }
        sous_chemins.retain(|c| !c.is_empty());
        if sous_chemins.is_empty() {
            return Ok(None);
        }

        let teinter = |couleur: Couleur, opacite: f64| Couleur {
            alpha: couleur.alpha * opacite,
            ..couleur
        };
        let remplissage = match nom {
            // Un segment et une ligne n'ont pas d'intérieur : `fill` ne les
            // peint pas, quelle que soit la valeur de l'attribut.
            "line" => None,
            _ => style
                .remplissage
                .map(|c| teinter(c, style.opacite * style.opacite_remplissage))
                .filter(Couleur::est_visible),
        };
        let contour = style.contour.and_then(|trait_| {
            let couleur = teinter(trait_.couleur, style.opacite * style.opacite_contour);
            if !couleur.est_visible() || trait_.epaisseur <= 0.0 {
                return None;
            }
            Some(Trait { couleur, ..trait_ })
        });
        Ok(Some(Forme {
            sous_chemins,
            remplissage,
            regle: style.regle,
            contour,
            id: element.attribut("id").map(str::to_string),
        }))
    }

    /// Les sous-chemins d'une forme élémentaire, dans le repère utilisateur.
    fn geometrie(&mut self, element: &Element, nom: &str) -> Result<Vec<Vec<Point>>, ErreurSvg> {
        match nom {
            "path" => {
                let d = element.attribut("d").unwrap_or("").to_string();
                lire_chemin(&d, self.tolerance)
            }
            "rect" => {
                let x = self.longueur_defaut(element, "x", 0.0)?;
                let y = self.longueur_defaut(element, "y", 0.0)?;
                let largeur = self.longueur_defaut(element, "width", 0.0)?;
                let hauteur = self.longueur_defaut(element, "height", 0.0)?;
                if largeur <= 0.0 || hauteur <= 0.0 {
                    return Ok(Vec::new());
                }
                let rx = self
                    .longueur_optionnelle(element, "rx", Some(largeur))?
                    .or(self.longueur_optionnelle(element, "ry", Some(hauteur))?);
                let ry = self
                    .longueur_optionnelle(element, "ry", Some(hauteur))?
                    .or(self.longueur_optionnelle(element, "rx", Some(largeur))?);
                Ok(vec![rectangle_arrondi(
                    x,
                    y,
                    largeur,
                    hauteur,
                    rx.unwrap_or(0.0).clamp(0.0, largeur / 2.0),
                    ry.unwrap_or(0.0).clamp(0.0, hauteur / 2.0),
                    self.tolerance,
                )])
            }
            "circle" => {
                let cx = self.longueur_defaut(element, "cx", 0.0)?;
                let cy = self.longueur_defaut(element, "cy", 0.0)?;
                let r = self.longueur_defaut(element, "r", 0.0)?;
                if r <= 0.0 {
                    return Ok(Vec::new());
                }
                Ok(vec![ellipse(cx, cy, r, r, self.tolerance)])
            }
            "ellipse" => {
                let cx = self.longueur_defaut(element, "cx", 0.0)?;
                let cy = self.longueur_defaut(element, "cy", 0.0)?;
                let rx = self.longueur_defaut(element, "rx", 0.0)?;
                let ry = self.longueur_defaut(element, "ry", 0.0)?;
                if rx <= 0.0 || ry <= 0.0 {
                    return Ok(Vec::new());
                }
                Ok(vec![ellipse(cx, cy, rx, ry, self.tolerance)])
            }
            "line" => {
                let x1 = self.longueur_defaut(element, "x1", 0.0)?;
                let y1 = self.longueur_defaut(element, "y1", 0.0)?;
                let x2 = self.longueur_defaut(element, "x2", 0.0)?;
                let y2 = self.longueur_defaut(element, "y2", 0.0)?;
                Ok(vec![vec![Point::new(x1, y1), Point::new(x2, y2)]])
            }
            "polyline" | "polygon" => {
                let points = element.attribut("points").unwrap_or("").to_string();
                let mut liste = lire_points(&points, element)?;
                if nom == "polygon" && liste.len() > 1 && liste[0] != liste[liste.len() - 1] {
                    liste.push(liste[0]);
                }
                Ok(if liste.is_empty() {
                    Vec::new()
                } else {
                    vec![liste]
                })
            }
            autre => {
                self.avertir(format!("élément <{autre}> ignoré"));
                Ok(Vec::new())
            }
        }
    }

    fn lire_texte(
        &mut self,
        element: &Element,
        style: &Style,
        transformation: Matrice,
    ) -> Result<(), ErreurSvg> {
        // `<text>` et ses `<tspan>` : le contenu textuel est celui de l'élément
        // entier, y compris les morceaux. Le noyau ne suit pas les `dx`/`dy`
        // d'un `tspan` : les additionner sans métriques de police serait faux.
        if element.enfant("tspan").is_some() {
            self.avertir(
                "<tspan> : les décalages de morceaux ne sont pas suivis, le texte est lu \
                 comme un seul bloc"
                    .to_string(),
            );
        }
        let contenu = element.texte();
        if contenu.trim().is_empty() {
            return Ok(());
        }
        let x = self.longueur_defaut(element, "x", 0.0)?;
        let y = self.longueur_defaut(element, "y", 0.0)?;
        let point = transformation.appliquer(Point::new(x, y));
        self.textes.push(Texte {
            contenu,
            x: point.x,
            y: point.y,
            corps: style.corps * transformation.echelle_maximale(),
            famille: style.famille.clone(),
            gras: style.gras,
            italique: style.italique,
            ancre: style.ancre,
            remplissage: style
                .remplissage
                .map(|c| Couleur {
                    alpha: c.alpha * style.opacite * style.opacite_remplissage,
                    ..c
                })
                .filter(Couleur::est_visible),
            transformation,
        });
        Ok(())
    }

    // ── Attributs ──────────────────────────────────────────────────────────

    fn nombre(
        &mut self,
        element: &Element,
        attribut: &str,
        valeur: &str,
    ) -> Result<f64, ErreurSvg> {
        valeur
            .trim()
            .parse::<f64>()
            .map_err(|_| ErreurSvg::NombreIllisible {
                element: element.nom.clone(),
                attribut: attribut.to_string(),
                valeur: valeur.to_string(),
            })
    }

    /// La référence d'un pourcentage, selon l'attribut.
    ///
    /// Le SVG ne prend pas une seule référence : `x` et `width` se rapportent à
    /// la **largeur** du canevas, `y` et `height` à sa **hauteur**, et tout le
    /// reste (`r`, `rx`, `ry`, `stroke-width`) à sa **diagonale normalisée** —
    /// `√((l² + h²) / 2)`. Une seule référence pour tous les attributs rendrait
    /// un cercle ovale dans un canevas rectangle, ce qui se voit.
    fn reference_pour(&self, attribut: &str) -> Option<f64> {
        match attribut {
            "x" | "x1" | "x2" | "cx" | "width" => self.largeur,
            "y" | "y1" | "y2" | "cy" | "height" => self.hauteur,
            _ => self.diagonale(),
        }
    }

    fn diagonale(&self) -> Option<f64> {
        match (self.largeur, self.hauteur) {
            (Some(largeur), Some(hauteur)) => {
                Some(((largeur * largeur + hauteur * hauteur) / 2.0).sqrt())
            }
            (Some(largeur), None) => Some(largeur),
            (None, Some(hauteur)) => Some(hauteur),
            (None, None) => None,
        }
    }

    fn longueur(
        &mut self,
        element: &Element,
        attribut: &str,
        valeur: &str,
    ) -> Result<f64, ErreurSvg> {
        let reference = self.reference_pour(attribut);
        longueur_avec_contexte(valeur, reference, CORPS_PAR_DEFAUT, &element.nom, attribut)
    }

    fn longueur_defaut(
        &mut self,
        element: &Element,
        attribut: &str,
        defaut: f64,
    ) -> Result<f64, ErreurSvg> {
        match element.attribut(attribut) {
            Some(valeur) => self.longueur(element, attribut, valeur),
            None => Ok(defaut),
        }
    }

    fn longueur_optionnelle(
        &mut self,
        element: &Element,
        attribut: &str,
        reference: Option<f64>,
    ) -> Result<Option<f64>, ErreurSvg> {
        let Some(valeur) = element.attribut(attribut) else {
            return Ok(None);
        };
        if valeur.trim().is_empty() || valeur.trim() == "auto" {
            return Ok(None);
        }
        longueur_avec_contexte(valeur, reference, CORPS_PAR_DEFAUT, &element.nom, attribut)
            .map(Some)
    }
}

/// L'élément est-il non rendu par ses propres attributs ?
///
/// - `display="none"` masque l'élément **et son sous-arbre** ;
/// - `visibility="hidden"` masque l'élément : le noyau traite le sous-arbre de
///   la même façon, alors que le SVG permet à un enfant de le rétablir. La
///   différence n'apparaît que sur un document qui ré-active la visibilité d'un
///   enfant, et elle est écrite ici plutôt que devinée ;
/// - `requiredExtensions` / `requiredFeatures` : le noyau n'évalue pas les
///   extensions, donc un élément qui en **exige** une n'est pas rendu. C'est la
///   règle du SVG lui-même.
fn a_l_attribut_non_rendu(element: &Element) -> bool {
    if let Some(display) = element.attribut("display") {
        if display.trim() == "none" {
            return true;
        }
    }
    if let Some(visibility) = element.attribut("visibility") {
        if matches!(visibility.trim(), "hidden" | "collapse") {
            return true;
        }
    }
    element.attribut("requiredExtensions").is_some()
        || element.attribut("requiredFeatures").is_some()
}

/// Le premier enfant d'un `<switch>` qui peut être rendu.
///
/// Le SVG demande de rendre le **premier** enfant qui satisfait ses conditions.
/// Le noyau n'évalue ni `requiredExtensions` ni `systemLanguage` : il saute donc
/// les enfants qui les portent, et retient le premier qui n'en porte aucun.
/// C'est exactement ce que fait un lecteur qui ne connaît pas l'extension —
/// et c'est ce qui fait d'un `<switch>` Adobe une lecture correcte de son
/// second enfant.
fn choisir_dans_switch(element: &Element) -> Option<&Element> {
    element.elements().find(|enfant| {
        enfant.attribut("requiredExtensions").is_none()
            && enfant.attribut("requiredFeatures").is_none()
    })
}

/// Le décalage de centrage d'un `preserveAspectRatio`.
fn centrage(valeur: &str, reste_x: f64, reste_y: f64) -> (f64, f64) {
    let minuscule = valeur.to_ascii_lowercase();
    let x = if minuscule.contains("xmin") {
        0.0
    } else if minuscule.contains("xmax") {
        reste_x
    } else {
        reste_x / 2.0
    };
    let y = if minuscule.contains("ymin") {
        0.0
    } else if minuscule.contains("ymax") {
        reste_y
    } else {
        reste_y / 2.0
    };
    (x, y)
}

// ═══════════════════════════════════════════════════════════════════════════
// Longueurs
// ═══════════════════════════════════════════════════════════════════════════

/// Un nombre pur : `1`, `-2.5`, `.5`, `1e-3`, `1.`.
fn nombre_pur(texte: &str) -> Option<f64> {
    let t = texte.trim();
    if t.is_empty() {
        return None;
    }
    t.parse::<f64>().ok().filter(|v| v.is_finite())
}

/// Lit une longueur SVG : un nombre, ou un nombre suivi d'une unité.
///
/// Les unités absolues sont celles du CSS — et la conversion en unités
/// utilisateur est celle du CSS aussi (`1in = 96px`), **pas** celle du
/// PostScript (`1in = 72pt`) : un SVG est un document écran, et son `px` est
/// l'unité utilisateur.
fn longueur_avec_contexte(
    valeur: &str,
    reference: Option<f64>,
    corps: f64,
    element: &str,
    attribut: &str,
) -> Result<f64, ErreurSvg> {
    let texte = valeur.trim();
    if texte.is_empty() {
        return Ok(0.0);
    }
    if let Some(pourcent) = texte.strip_suffix('%') {
        let part = nombre_pur(pourcent).ok_or_else(|| ErreurSvg::NombreIllisible {
            element: element.to_string(),
            attribut: attribut.to_string(),
            valeur: valeur.to_string(),
        })?;
        let Some(base) = reference else {
            return Err(ErreurSvg::LongueurSansReference {
                element: element.to_string(),
                attribut: attribut.to_string(),
                valeur: valeur.to_string(),
            });
        };
        return Ok(base * part / 100.0);
    }
    let (nombre, unite) = decouper_unite(texte);
    let Some(nombre) = nombre_pur(nombre) else {
        return Err(ErreurSvg::NombreIllisible {
            element: element.to_string(),
            attribut: attribut.to_string(),
            valeur: valeur.to_string(),
        });
    };
    let facteur = match unite.to_ascii_lowercase().as_str() {
        "" | "px" => 1.0,
        "pt" => PX_PAR_POUCE / 72.0,
        "pc" => PX_PAR_POUCE / 6.0,
        "mm" => PX_PAR_POUCE / 25.4,
        "cm" => PX_PAR_POUCE / 2.54,
        "in" => PX_PAR_POUCE,
        "em" => corps,
        "ex" => {
            return Err(ErreurSvg::NombreIllisible {
                element: element.to_string(),
                attribut: attribut.to_string(),
                valeur: valeur.to_string(),
            })
        }
        _ => {
            return Err(ErreurSvg::NombreIllisible {
                element: element.to_string(),
                attribut: attribut.to_string(),
                valeur: valeur.to_string(),
            })
        }
    };
    Ok(nombre * facteur)
}

/// Sépare « 12mm » en `("12", "mm")`.
fn decouper_unite(texte: &str) -> (&str, &str) {
    let coupe = texte
        .char_indices()
        .rev()
        .take_while(|(_, c)| c.is_ascii_alphabetic())
        .last()
        .map_or(texte.len(), |(i, _)| i);
    (&texte[..coupe], &texte[coupe..])
}

/// Lit une liste de nombres séparés par des blancs ou des virgules.
fn nombres_liste(texte: &str) -> Vec<f64> {
    texte
        .split([',', ' ', '\t', '\n', '\r'])
        .filter(|m| !m.trim().is_empty())
        .filter_map(nombre_pur)
        .collect()
}

// ═══════════════════════════════════════════════════════════════════════════
// Transformations
// ═══════════════════════════════════════════════════════════════════════════

/// Lit un attribut `transform="…"`.
///
/// # Erreurs
///
/// [`ErreurSvg::TransformationIllisible`] pour une fonction inconnue ou un
/// nombre de paramètres qui ne correspond pas. Refuser est le seul choix
/// honnête : ignorer une transformation déplace tout le dessin.
pub fn analyser_transformation(valeur: &str) -> Result<Matrice, ErreurSvg> {
    let illisible = |raison: &str| ErreurSvg::TransformationIllisible {
        valeur: valeur.to_string(),
        raison: raison.to_string(),
    };
    let mut matrice = Matrice::identite();
    let mut reste = valeur;
    while let Some(ouvert) = reste.find('(') {
        let nom = reste[..ouvert]
            .trim()
            .trim_matches(',')
            .trim()
            .to_ascii_lowercase();
        let Some(ferme) = reste[ouvert..].find(')') else {
            return Err(illisible("parenthèse fermante manquante"));
        };
        let corps = &reste[ouvert + 1..ouvert + ferme];
        let nombres = nombres_liste(corps);
        let transformation = match (nom.as_str(), nombres.len()) {
            ("matrix", 6) => Matrice([
                nombres[0], nombres[1], nombres[2], nombres[3], nombres[4], nombres[5],
            ]),
            ("translate", 1) => Matrice::translation(nombres[0], 0.0),
            ("translate", 2) => Matrice::translation(nombres[0], nombres[1]),
            ("scale", 1) => Matrice::echelle(nombres[0], nombres[0]),
            ("scale", 2) => Matrice::echelle(nombres[0], nombres[1]),
            ("rotate", 1) => Matrice::rotation(nombres[0]),
            ("rotate", 3) => Matrice::rotation_autour(nombres[0], nombres[1], nombres[2]),
            ("skewx", 1) => Matrice::inclinaison_x(nombres[0]),
            ("skewy", 1) => Matrice::inclinaison_y(nombres[0]),
            (autre, compte) => {
                return Err(illisible(&format!(
                    "« {autre} » avec {compte} paramètre(s) : aucune fonction ne correspond"
                )))
            }
        };
        if !transformation.est_finie() {
            return Err(illisible("un des paramètres n'est pas un nombre fini"));
        }
        // Les transformations du SVG s'appliquent **de droite à gauche** : la
        // dernière écrite agit la première sur le point. `concatener` applique
        // son opérande gauche en premier, donc la nouvelle vient à gauche.
        matrice = transformation.concatener(matrice);
        reste = &reste[ouvert + ferme + 1..];
    }
    let residu = reste.trim().trim_matches(',');
    if !residu.is_empty() && residu != valeur {
        return Err(illisible(&format!(
            "« {residu} » n'est pas une transformation"
        )));
    }
    Ok(matrice)
}

/// Lit une liste de points (`points="x,y x,y …"`).
fn lire_points(valeur: &str, element: &Element) -> Result<Vec<Point>, ErreurSvg> {
    let nombres = nombres_liste(valeur);
    if nombres.len() % 2 != 0 {
        return Err(ErreurSvg::CheminIllisible {
            position: 0,
            raison: format!(
                "<{}> points=\"{valeur}\" : un nombre impair de coordonnées ({})",
                element.nom,
                nombres.len()
            ),
        });
    }
    Ok(nombres
        .chunks(2)
        .map(|paire| Point::new(paire[0], paire[1]))
        .collect())
}

// ═══════════════════════════════════════════════════════════════════════════
// Formes élémentaires
// ═══════════════════════════════════════════════════════════════════════════

fn ellipse(cx: f64, cy: f64, rx: f64, ry: f64, tolerance: f64) -> Vec<Point> {
    let mut points = vec![Point::new(cx + rx, cy)];
    if let Some(courbes) = arc_vers_courbes(
        Point::new(cx + rx, cy),
        rx,
        ry,
        0.0,
        false,
        true,
        Point::new(cx - rx, cy),
    ) {
        for courbe in &courbes {
            courbe.aplatir(tolerance, &mut points);
        }
        let courbes = arc_vers_courbes(
            Point::new(cx - rx, cy),
            rx,
            ry,
            0.0,
            false,
            true,
            Point::new(cx + rx, cy),
        )
        .unwrap_or_default();
        for courbe in &courbes {
            courbe.aplatir(tolerance, &mut points);
        }
    }
    points
}

fn rectangle_arrondi(
    x: f64,
    y: f64,
    largeur: f64,
    hauteur: f64,
    rx: f64,
    ry: f64,
    tolerance: f64,
) -> Vec<Point> {
    let coins = [
        // Coin supérieur droit : on y arrive par le haut, on en repart par la
        // droite.
        (
            Point::new(x + largeur - rx, y),
            Point::new(x + largeur, y + ry),
        ),
        (
            Point::new(x + largeur, y + hauteur - ry),
            Point::new(x + largeur - rx, y + hauteur),
        ),
        (
            Point::new(x + rx, y + hauteur),
            Point::new(x, y + hauteur - ry),
        ),
        (Point::new(x, y + ry), Point::new(x + rx, y)),
    ];
    if rx <= 0.0 || ry <= 0.0 {
        // Un rectangle à angles droits : quatre sommets et la fermeture, sans
        // passer par les arcs.
        return vec![
            Point::new(x, y),
            Point::new(x + largeur, y),
            Point::new(x + largeur, y + hauteur),
            Point::new(x, y + hauteur),
            Point::new(x, y),
        ];
    }
    let mut points = vec![Point::new(x + rx, y)];
    for (debut, fin) in coins {
        // Le début du coin est le point courant : `aplatir` ajoute l'arrivée et
        // suppose le départ déjà présent, donc on le pose ici — et la ligne
        // droite qui relie deux coins est ainsi décrite par ses deux bouts.
        points.push(debut);
        // Les quatre coins tournent dans le même sens : `balayage = true`.
        let courbes = arc_vers_courbes(debut, rx, ry, 0.0, false, true, fin).unwrap_or_default();
        for courbe in &courbes {
            courbe.aplatir(tolerance, &mut points);
        }
    }
    if points.last() != Some(&points[0]) {
        points.push(points[0]);
    }
    points
}

// ═══════════════════════════════════════════════════════════════════════════
// Données de chemin
// ═══════════════════════════════════════════════════════════════════════════

/// Lit un paramètre de commande, ou rend une erreur qui dit **quelle commande**
/// et **quel paramètre** manquaient.
fn lire_nombre_champ(
    lecteur: &mut Lecteur,
    rang: usize,
    commande: char,
    quoi: &str,
) -> Result<f64, ErreurSvg> {
    lecteur.nombre().ok_or_else(|| ErreurSvg::CheminIllisible {
        position: rang,
        raison: format!("« {commande} » attend {quoi}"),
    })
}

/// Un paramètre numérique de commande, ou l'erreur qui dit lequel manquait.
macro_rules! champ {
    ($lecteur:expr, $rang:expr, $c:expr, $quoi:expr) => {
        lire_nombre_champ(&mut $lecteur, $rang, $c, $quoi)?
    };
}

/// Une paire de coordonnées, ou l'erreur qui dit laquelle manquait.
macro_rules! champ_point {
    ($lecteur:expr, $rang:expr, $c:expr, $quoi:expr) => {{
        let x = lire_nombre_champ(&mut $lecteur, $rang, $c, $quoi)?;
        let y = lire_nombre_champ(&mut $lecteur, $rang, $c, $quoi)?;
        Point::new(x, y)
    }};
}

/// Lit un attribut `d` : les commandes de chemin de la spécification SVG.
///
/// # Erreurs
///
/// [`ErreurSvg::CheminIllisible`], avec le rang du caractère fautif.
pub fn lire_chemin(donnees: &str, tolerance: f64) -> Result<Vec<Vec<Point>>, ErreurSvg> {
    let caracteres: Vec<char> = donnees.chars().collect();
    let mut lecteur = Lecteur {
        caracteres: &caracteres,
        position: 0,
    };
    let mut sous_chemins: Vec<Vec<Point>> = Vec::new();
    let mut courant = Point::new(0.0, 0.0);
    let mut debut = Point::new(0.0, 0.0);
    let mut controle: Option<Point> = None;
    let mut commande: Option<char> = None;
    let mut ouvert = false;

    loop {
        lecteur.sauter();
        if lecteur.position >= caracteres.len() {
            break;
        }
        let rang = lecteur.position;
        let c = caracteres[rang];
        if c.is_ascii_alphabetic() {
            commande = Some(c);
            lecteur.position += 1;
        } else {
            let Some(previous) = commande else {
                return Err(ErreurSvg::CheminIllisible {
                    position: rang,
                    raison: "le chemin doit commencer par une commande".to_string(),
                });
            };
            // La répétition implicite : après un `M`, une paire de coordonnées
            // seule vaut un `L` — c'est la forme sous laquelle les outils
            // écrivent leurs chemins.
            commande = Some(match previous {
                'M' => 'L',
                'm' => 'l',
                'Z' | 'z' => {
                    return Err(ErreurSvg::CheminIllisible {
                        position: rang,
                        raison: "des coordonnées suivent une fermeture « Z »".to_string(),
                    })
                }
                autre => autre,
            });
        }
        let Some(c) = commande else { break };
        let relatif = c.is_ascii_lowercase();
        match c {
            'M' | 'm' => {
                let mut p = champ_point!(lecteur, rang, c, "deux coordonnées");
                if relatif {
                    p = Point::new(courant.x + p.x, courant.y + p.y);
                }
                courant = p;
                debut = p;
                controle = None;
                sous_chemins.push(vec![p]);
                ouvert = true;
            }
            'L' | 'l' => {
                let mut p = champ_point!(lecteur, rang, c, "deux coordonnées");
                if relatif {
                    p = Point::new(courant.x + p.x, courant.y + p.y);
                }
                ouvrir(&mut sous_chemins, &mut ouvert, courant);
                courant = p;
                controle = None;
                sous_chemins.last_mut().expect("sous-chemin ouvert").push(p);
            }
            'H' | 'h' => {
                let mut x = champ!(lecteur, rang, c, "une abscisse");
                if relatif {
                    x += courant.x;
                }
                ouvrir(&mut sous_chemins, &mut ouvert, courant);
                courant = Point::new(x, courant.y);
                controle = None;
                sous_chemins
                    .last_mut()
                    .expect("sous-chemin ouvert")
                    .push(courant);
            }
            'V' | 'v' => {
                let mut y = champ!(lecteur, rang, c, "une ordonnée");
                if relatif {
                    y += courant.y;
                }
                ouvrir(&mut sous_chemins, &mut ouvert, courant);
                courant = Point::new(courant.x, y);
                controle = None;
                sous_chemins
                    .last_mut()
                    .expect("sous-chemin ouvert")
                    .push(courant);
            }
            'C' | 'c' => {
                let mut c1 = champ_point!(lecteur, rang, c, "deux points de contrôle");
                let mut c2 = champ_point!(lecteur, rang, c, "deux points de contrôle");
                let mut arrivee = champ_point!(lecteur, rang, c, "un point d'arrivée");
                if relatif {
                    c1 = Point::new(courant.x + c1.x, courant.y + c1.y);
                    c2 = Point::new(courant.x + c2.x, courant.y + c2.y);
                    arrivee = Point::new(courant.x + arrivee.x, courant.y + arrivee.y);
                }
                ouvrir(&mut sous_chemins, &mut ouvert, courant);
                let courbe = Courbe::Cubique {
                    depart: courant,
                    controle1: c1,
                    controle2: c2,
                    arrivee,
                };
                courbe.aplatir(
                    tolerance,
                    sous_chemins.last_mut().expect("sous-chemin ouvert"),
                );
                courant = arrivee;
                controle = Some(c2);
            }
            'S' | 's' => {
                // Le premier point de contrôle est le **reflet** du précédent :
                // c'est la même cubique, écrite plus court.
                let c1 = reflet(controle, courant);
                let mut c2 = champ_point!(lecteur, rang, c, "un point de contrôle");
                let mut arrivee = champ_point!(lecteur, rang, c, "un point d'arrivée");
                if relatif {
                    c2 = Point::new(courant.x + c2.x, courant.y + c2.y);
                    arrivee = Point::new(courant.x + arrivee.x, courant.y + arrivee.y);
                }
                ouvrir(&mut sous_chemins, &mut ouvert, courant);
                let courbe = Courbe::Cubique {
                    depart: courant,
                    controle1: c1,
                    controle2: c2,
                    arrivee,
                };
                courbe.aplatir(
                    tolerance,
                    sous_chemins.last_mut().expect("sous-chemin ouvert"),
                );
                courant = arrivee;
                controle = Some(c2);
            }
            'Q' | 'q' => {
                let mut c1 = champ_point!(lecteur, rang, c, "un point de contrôle");
                let mut arrivee = champ_point!(lecteur, rang, c, "un point d'arrivée");
                if relatif {
                    c1 = Point::new(courant.x + c1.x, courant.y + c1.y);
                    arrivee = Point::new(courant.x + arrivee.x, courant.y + arrivee.y);
                }
                ouvrir(&mut sous_chemins, &mut ouvert, courant);
                let courbe = Courbe::Quadratique {
                    depart: courant,
                    controle: c1,
                    arrivee,
                };
                courbe.aplatir(
                    tolerance,
                    sous_chemins.last_mut().expect("sous-chemin ouvert"),
                );
                courant = arrivee;
                controle = Some(c1);
            }
            'T' | 't' => {
                let c1 = reflet(controle, courant);
                let mut arrivee = champ_point!(lecteur, rang, c, "un point d'arrivée");
                if relatif {
                    arrivee = Point::new(courant.x + arrivee.x, courant.y + arrivee.y);
                }
                ouvrir(&mut sous_chemins, &mut ouvert, courant);
                let courbe = Courbe::Quadratique {
                    depart: courant,
                    controle: c1,
                    arrivee,
                };
                courbe.aplatir(
                    tolerance,
                    sous_chemins.last_mut().expect("sous-chemin ouvert"),
                );
                courant = arrivee;
                controle = Some(c1);
            }
            'A' | 'a' => {
                let rx = champ!(lecteur, rang, c, "un rayon");
                let ry = champ!(lecteur, rang, c, "un rayon");
                let rotation = champ!(lecteur, rang, c, "un angle de rotation");
                let grand_arc = lecteur
                    .drapeau()
                    .ok_or_else(|| ErreurSvg::CheminIllisible {
                        position: rang,
                        raison: "« A » attend un drapeau « large-arc » valant 0 ou 1".to_string(),
                    })?;
                let balayage = lecteur
                    .drapeau()
                    .ok_or_else(|| ErreurSvg::CheminIllisible {
                        position: rang,
                        raison: "« A » attend un drapeau « sweep » valant 0 ou 1".to_string(),
                    })?;
                let mut arrivee = champ_point!(lecteur, rang, c, "un point d'arrivée");
                if relatif {
                    arrivee = Point::new(courant.x + arrivee.x, courant.y + arrivee.y);
                }
                ouvrir(&mut sous_chemins, &mut ouvert, courant);
                let cible = sous_chemins.last_mut().expect("sous-chemin ouvert");
                if courant == arrivee || rx == 0.0 || ry == 0.0 {
                    // Rayons nuls, ou extrémités confondues : la spécification
                    // demande un segment droit, et rien du tout si les deux
                    // extrémités sont le même point.
                    if courant != arrivee {
                        cible.push(arrivee);
                    }
                } else {
                    match arc_vers_courbes(
                        courant,
                        rx.abs(),
                        ry.abs(),
                        rotation,
                        grand_arc,
                        balayage,
                        arrivee,
                    ) {
                        Some(courbes) => {
                            for courbe in &courbes {
                                courbe.aplatir(tolerance, cible);
                            }
                        }
                        None => cible.push(arrivee),
                    }
                }
                courant = arrivee;
                controle = None;
            }
            'Z' | 'z' => {
                if ouvert {
                    let cible = sous_chemins.last_mut().expect("sous-chemin ouvert");
                    if cible.last() != Some(&debut) {
                        cible.push(debut);
                    }
                }
                courant = debut;
                controle = None;
                ouvert = false;
            }
            autre => {
                return Err(ErreurSvg::CheminIllisible {
                    position: rang,
                    raison: format!("commande « {autre} » inconnue"),
                })
            }
        }
    }
    Ok(sous_chemins)
}

/// Le reflet d'un point de contrôle, pour `S` et `T`.
///
/// Sans point de contrôle précédent, le reflet **est** le point courant : c'est
/// ce que dit la spécification, et c'est ce qui rend `S` équivalent à `C` quand
/// aucune courbe ne précède.
fn reflet(controle: Option<Point>, courant: Point) -> Point {
    match controle {
        Some(precedent) => Point::new(2.0 * courant.x - precedent.x, 2.0 * courant.y - precedent.y),
        None => courant,
    }
}

/// Ouvre un sous-chemin à la position courante si nécessaire (après un `Z`).
fn ouvrir(sous_chemins: &mut Vec<Vec<Point>>, ouvert: &mut bool, courant: Point) {
    if !*ouvert {
        sous_chemins.push(vec![courant]);
        *ouvert = true;
    }
}

/// Lecteur de données de chemin : nombres et commandes.
struct Lecteur<'a> {
    caracteres: &'a [char],
    position: usize,
}

impl Lecteur<'_> {
    /// Saute les séparateurs : espaces et virgules.
    fn sauter(&mut self) {
        while self.position < self.caracteres.len()
            && (self.caracteres[self.position].is_whitespace()
                || self.caracteres[self.position] == ',')
        {
            self.position += 1;
        }
    }

    /// Lit un nombre, ou rend `None` sans avancer.
    fn nombre(&mut self) -> Option<f64> {
        self.sauter();
        let debut = self.position;
        let mut i = self.position;
        if matches!(self.caracteres.get(i), Some('+' | '-')) {
            i += 1;
        }
        let debut_chiffres = i;
        while matches!(self.caracteres.get(i), Some(c) if c.is_ascii_digit()) {
            i += 1;
        }
        let mut a_des_chiffres = i > debut_chiffres;
        if self.caracteres.get(i) == Some(&'.') {
            i += 1;
            while matches!(self.caracteres.get(i), Some(c) if c.is_ascii_digit()) {
                i += 1;
            }
            a_des_chiffres = i > debut_chiffres + 1 || a_des_chiffres;
        }
        if !a_des_chiffres {
            return None;
        }
        if matches!(self.caracteres.get(i), Some('e' | 'E')) {
            let sauvegarde = i;
            i += 1;
            if matches!(self.caracteres.get(i), Some('+' | '-')) {
                i += 1;
            }
            let debut_exposant = i;
            while matches!(self.caracteres.get(i), Some(c) if c.is_ascii_digit()) {
                i += 1;
            }
            if i == debut_exposant {
                i = sauvegarde;
            }
        }
        let texte: String = self.caracteres[debut..i].iter().collect();
        let valeur = texte.parse::<f64>().ok().filter(|v| v.is_finite())?;
        self.position = i;
        Some(valeur)
    }

    /// Lit un drapeau d'arc : un seul caractère, `0` ou `1`.
    fn drapeau(&mut self) -> Option<bool> {
        self.sauter();
        match self.caracteres.get(self.position) {
            Some('0') => {
                self.position += 1;
                Some(false)
            }
            Some('1') => {
                self.position += 1;
                Some(true)
            }
            _ => None,
        }
    }
}

/// Convertit un arc elliptique en cubiques (notes du W3C, F.6).
///
/// Rend `None` quand l'arc dégénère en segment : rayons nuls, ou extrémités
/// confondues.
fn arc_vers_courbes(
    depart: Point,
    rx: f64,
    ry: f64,
    rotation_degres: f64,
    grand_arc: bool,
    balayage: bool,
    arrivee: Point,
) -> Option<Vec<Courbe>> {
    if depart == arrivee || rx == 0.0 || ry == 0.0 {
        return None;
    }
    let phi = rotation_degres.to_radians();
    let (sin_phi, cos_phi) = phi.sin_cos();
    let dx2 = (depart.x - arrivee.x) / 2.0;
    let dy2 = (depart.y - arrivee.y) / 2.0;
    let x1p = cos_phi * dx2 + sin_phi * dy2;
    let y1p = -sin_phi * dx2 + cos_phi * dy2;

    let lambda = (x1p * x1p) / (rx * rx) + (y1p * y1p) / (ry * ry);
    let (rx, ry) = if lambda > 1.0 {
        let facteur = lambda.sqrt();
        (rx * facteur, ry * facteur)
    } else {
        (rx, ry)
    };

    let numerateur = rx * rx * ry * ry - rx * rx * y1p * y1p - ry * ry * x1p * x1p;
    let denominateur = rx * rx * y1p * y1p + ry * ry * x1p * x1p;
    if denominateur == 0.0 {
        return None;
    }
    let signe = if grand_arc != balayage { 1.0 } else { -1.0 };
    let coefficient = signe * (numerateur / denominateur).max(0.0).sqrt();
    let cxp = coefficient * rx * y1p / ry;
    let cyp = -coefficient * ry * x1p / rx;
    let centre = Point::new(
        cos_phi * cxp - sin_phi * cyp + (depart.x + arrivee.x) / 2.0,
        sin_phi * cxp + cos_phi * cyp + (depart.y + arrivee.y) / 2.0,
    );

    let angle = |ux: f64, uy: f64, vx: f64, vy: f64| -> f64 {
        let produit = ux * vx + uy * vy;
        let normes = ((ux * ux + uy * uy).sqrt()) * ((vx * vx + vy * vy).sqrt());
        if normes == 0.0 {
            return 0.0;
        }
        let rapport = (produit / normes).clamp(-1.0, 1.0);
        let sens = if ux * vy - uy * vx < 0.0 { -1.0 } else { 1.0 };
        sens * rapport.acos()
    };

    let ux = (x1p - cxp) / rx;
    let uy = (y1p - cyp) / ry;
    let vx = (-x1p - cxp) / rx;
    let vy = (-y1p - cyp) / ry;
    let angle_depart = angle(1.0, 0.0, ux, uy);
    let mut balayage_angle = angle(ux, uy, vx, vy);
    if !balayage && balayage_angle > 0.0 {
        balayage_angle -= 2.0 * std::f64::consts::PI;
    } else if balayage && balayage_angle < 0.0 {
        balayage_angle += 2.0 * std::f64::consts::PI;
    }

    let point = |t: f64| {
        Point::new(
            centre.x + rx * t.cos() * cos_phi - ry * t.sin() * sin_phi,
            centre.y + rx * t.cos() * sin_phi + ry * t.sin() * cos_phi,
        )
    };
    let tangente = |t: f64| {
        Point::new(
            -rx * t.sin() * cos_phi - ry * t.cos() * sin_phi,
            -rx * t.sin() * sin_phi + ry * t.cos() * cos_phi,
        )
    };

    let segments = (balayage_angle.abs() / std::f64::consts::FRAC_PI_2)
        .ceil()
        .max(1.0) as usize;
    let pas = balayage_angle / segments as f64;
    let alpha = 4.0 / 3.0 * (pas / 4.0).tan();
    let mut courbes = Vec::with_capacity(segments);
    for rang in 0..segments {
        let t1 = angle_depart + pas * rang as f64;
        let t2 = t1 + pas;
        let p1 = point(t1);
        let p2 = point(t2);
        let d1 = tangente(t1);
        let d2 = tangente(t2);
        courbes.push(Courbe::Cubique {
            depart: p1,
            controle1: Point::new(p1.x + alpha * d1.x, p1.y + alpha * d1.y),
            controle2: Point::new(p2.x - alpha * d2.x, p2.y - alpha * d2.y),
            arrivee: p2,
        });
    }
    Some(courbes)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proche(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-6
    }

    // ── Couleurs ───────────────────────────────────────────────────────────

    #[test]
    fn couleurs_ecrites_de_toutes_les_facons() {
        assert_eq!(couleur("#ff0000").unwrap(), Some(Couleur::rvb(255, 0, 0)));
        assert_eq!(couleur("#f00").unwrap(), Some(Couleur::rvb(255, 0, 0)));
        assert_eq!(couleur("#ff000080").unwrap().unwrap().alpha, 128.0 / 255.0);
        assert_eq!(
            couleur("rgb(0,128,255)").unwrap(),
            Some(Couleur::rvb(0, 128, 255))
        );
        assert_eq!(
            couleur("rgb(100%, 0%, 50%)").unwrap(),
            Some(Couleur::rvb(255, 0, 128))
        );
        assert_eq!(couleur("none").unwrap(), None);
        assert_eq!(couleur("transparent").unwrap(), None);
        assert_eq!(couleur("black").unwrap(), Some(Couleur::rvb(0, 0, 0)));
        assert_eq!(couleur("DarkBlue").unwrap(), Some(Couleur::rvb(0, 0, 139)));
        assert_eq!(couleur("grey").unwrap(), Some(Couleur::rvb(128, 128, 128)));
    }

    #[test]
    fn une_couleur_inconnue_est_refusee_en_la_nommant() {
        let erreur = couleur("bleu-canard").unwrap_err();
        assert!(erreur.to_string().contains("bleu-canard"), "{erreur}");
    }

    #[test]
    fn la_table_est_triee_et_sans_doublon_de_nom() {
        let mut noms: Vec<&str> = COULEURS.iter().map(|(n, _)| *n).collect();
        let avant = noms.len();
        noms.sort_unstable();
        noms.dedup();
        assert_eq!(noms.len(), avant, "un nom est écrit deux fois");
        assert_eq!(COULEURS.len(), avant, "la table n'est pas triée");
    }

    // ── Longueurs ──────────────────────────────────────────────────────────

    #[test]
    fn longueurs_absolues_et_relatives() {
        let lire = |v: &str| longueur_avec_contexte(v, Some(200.0), 16.0, "rect", "x").unwrap();
        assert!(proche(lire("10"), 10.0));
        assert!(proche(lire("10px"), 10.0));
        assert!(proche(lire("12pt"), 16.0));
        assert!(proche(lire("1in"), 96.0));
        assert!(proche(lire("25.4mm"), 96.0));
        assert!(proche(lire("2.54cm"), 96.0));
        assert!(proche(lire("50%"), 100.0));
        assert!(proche(lire("2em"), 32.0));
    }

    #[test]
    fn un_pourcentage_sans_reference_est_refuse() {
        let erreur = longueur_avec_contexte("50%", None, 16.0, "rect", "x").unwrap_err();
        assert!(
            matches!(erreur, ErreurSvg::LongueurSansReference { .. }),
            "{erreur:?}"
        );
    }

    #[test]
    fn un_pourcentage_se_rapporte_a_la_reference_de_son_attribut() {
        // Un canevas 200 × 100 : la largeur et la hauteur ne se rapportent pas
        // au même nombre, et les confondre rendrait le rectangle deux fois trop
        // haut — ce qui se voit.
        let document = lire(
            r##"<svg width="200" height="100"><rect x="0" y="0" width="50%" height="50%"/></svg>"##,
        )
        .unwrap();
        let (min, max) = document.formes[0].boite().unwrap();
        assert!(proche(min.x, 0.0) && proche(min.y, 0.0), "{min:?}");
        assert!(proche(max.x, 100.0), "{max:?}");
        assert!(proche(max.y, 50.0), "{max:?}");
    }

    #[test]
    fn un_rayon_en_pourcentage_se_rapporte_a_la_diagonale_normalisee() {
        let document =
            lire(r##"<svg width="200" height="100"><circle cx="50%" cy="50%" r="10%"/></svg>"##)
                .unwrap();
        let diagonale = ((200.0_f64 * 200.0 + 100.0 * 100.0) / 2.0).sqrt();
        let (min, max) = document.formes[0].boite().unwrap();
        let diametre = max.x - min.x;
        assert!(
            (diametre - 2.0 * diagonale * 0.1).abs() < 0.01,
            "diamètre {diametre}, attendu {}",
            2.0 * diagonale * 0.1
        );
    }

    #[test]
    fn un_corps_en_pourcentage_se_rapporte_au_parent_comme_en_css() {
        let document = lire(
            r##"<svg width="100" height="100"><text x="0" y="0" font-size="100%">a</text></svg>"##,
        )
        .unwrap();
        assert!(proche(document.textes[0].corps, CORPS_PAR_DEFAUT));
        let moitie = lire(
            r##"<svg width="100" height="100" font-size="32"><text x="0" y="0" font-size="50%">a</text></svg>"##,
        )
        .unwrap();
        assert!(
            proche(moitie.textes[0].corps, 16.0),
            "corps {}",
            moitie.textes[0].corps
        );
    }

    #[test]
    fn une_unite_inconnue_est_refusee() {
        assert!(longueur_avec_contexte("10furlongs", Some(1.0), 16.0, "rect", "x").is_err());
        assert!(longueur_avec_contexte("10ex", Some(1.0), 16.0, "rect", "x").is_err());
    }

    // ── Transformations ────────────────────────────────────────────────────

    #[test]
    fn transformations_composees_dans_l_ordre_du_svg() {
        // `translate(10,10) scale(2)` : l'échelle d'abord, la translation ensuite.
        let m = analyser_transformation("translate(10,10) scale(2)").unwrap();
        let p = m.appliquer(Point::new(1.0, 1.0));
        assert!(proche(p.x, 12.0) && proche(p.y, 12.0), "{p:?}");
    }

    #[test]
    fn rotation_autour_d_un_point_ecrite_dans_le_svg() {
        let m = analyser_transformation("rotate(90 100 100)").unwrap();
        let p = m.appliquer(Point::new(110.0, 100.0));
        assert!(proche(p.x, 100.0) && proche(p.y, 110.0), "{p:?}");
    }

    #[test]
    fn matrice_et_cisaillements() {
        let m = analyser_transformation("matrix(1 0 0 1 5 6)").unwrap();
        assert_eq!(m.appliquer(Point::new(0.0, 0.0)), Point::new(5.0, 6.0));
        let m = analyser_transformation("skewX(45)").unwrap();
        let p = m.appliquer(Point::new(0.0, 10.0));
        assert!(proche(p.x, 10.0) && proche(p.y, 10.0), "{p:?}");
    }

    #[test]
    fn une_transformation_illisible_est_refusee() {
        let erreur = analyser_transformation("tourne(45)").unwrap_err();
        assert!(
            matches!(erreur, ErreurSvg::TransformationIllisible { .. }),
            "{erreur:?}"
        );
        assert!(analyser_transformation("scale(1,2,3)").is_err());
        assert!(analyser_transformation("translate(10").is_err());
    }

    // ── Commandes de chemin ────────────────────────────────────────────────

    #[test]
    fn chemin_rectangle_absolu() {
        let chemins = lire_chemin("M0 0 H10 V20 H0 Z", TOLERANCE_PAR_DEFAUT).unwrap();
        assert_eq!(chemins.len(), 1);
        assert_eq!(
            chemins[0],
            vec![
                Point::new(0.0, 0.0),
                Point::new(10.0, 0.0),
                Point::new(10.0, 20.0),
                Point::new(0.0, 20.0),
                Point::new(0.0, 0.0),
            ]
        );
        assert!(proche(aire(&chemins), 200.0));
    }

    #[test]
    fn chemin_relatif_et_repetitions_implicites() {
        // « m0 0 l10 0 0 10 -10 0 z » : un carré, écrit comme le fait Inkscape.
        let chemins = lire_chemin("m0 0 l10 0 0 10 -10 0 z", TOLERANCE_PAR_DEFAUT).unwrap();
        assert_eq!(chemins.len(), 1);
        assert_eq!(
            chemins[0],
            vec![
                Point::new(0.0, 0.0),
                Point::new(10.0, 0.0),
                Point::new(10.0, 10.0),
                Point::new(0.0, 10.0),
                Point::new(0.0, 0.0),
            ]
        );
    }

    #[test]
    fn apres_un_m_les_paires_sont_des_l() {
        let chemins = lire_chemin("M0 0 10 0 10 10", 1.0).unwrap();
        assert_eq!(chemins[0].len(), 3);
        assert_eq!(chemins[0][2], Point::new(10.0, 10.0));
    }

    #[test]
    fn plusieurs_sous_chemins() {
        let chemins = lire_chemin("M0 0 L10 0 Z M20 20 L30 20", 1.0).unwrap();
        assert_eq!(chemins.len(), 2);
        assert_eq!(chemins[0].last(), Some(&Point::new(0.0, 0.0)));
        assert_eq!(
            chemins[1],
            vec![Point::new(20.0, 20.0), Point::new(30.0, 20.0)]
        );
    }

    #[test]
    fn un_l_suivi_d_un_z_repart_du_point_de_depart() {
        let chemins = lire_chemin("M0 0 L10 0 Z L0 10", 1.0).unwrap();
        assert_eq!(chemins.len(), 2);
        assert_eq!(chemins[1][0], Point::new(0.0, 0.0));
        assert_eq!(chemins[1][1], Point::new(0.0, 10.0));
    }

    #[test]
    fn nombres_sans_separateur_et_flottants() {
        // Les outils écrivent « a2 2 0 0 0-2 2 » et « 1.5.5 » sans séparateur.
        let chemins = lire_chemin("M0 0 L1.5.5", 1.0).unwrap();
        assert_eq!(chemins[0][1], Point::new(1.5, 0.5));
    }

    #[test]
    fn un_arc_de_quart_de_cercle_tombe_juste() {
        // Un quart de cercle de rayon 10, centre (0,0) : de (10,0) à (0,10).
        let chemins = lire_chemin("M10 0 A10 10 0 0 1 0 10", 0.001).unwrap();
        let points = &chemins[0];
        assert!(
            proche(points[0].x, 10.0) && proche(points[0].y, 0.0),
            "{:?}",
            points[0]
        );
        let dernier = points[points.len() - 1];
        assert!(
            proche(dernier.x, 0.0) && proche(dernier.y, 10.0),
            "{dernier:?}"
        );
        // Tous les sommets sont sur le cercle, à la tolérance près.
        for point in points {
            let rayon = (point.x * point.x + point.y * point.y).sqrt();
            assert!((rayon - 10.0).abs() < 0.01, "rayon {rayon} en {point:?}");
        }
    }

    #[test]
    fn un_arc_de_rayon_nul_est_un_segment() {
        let chemins = lire_chemin("M0 0 A0 0 0 0 1 10 10", 0.01).unwrap();
        assert_eq!(
            chemins[0],
            vec![Point::new(0.0, 0.0), Point::new(10.0, 10.0)]
        );
    }

    #[test]
    fn un_chemin_qui_ne_commence_pas_par_une_commande_est_refuse() {
        let erreur = lire_chemin("10 10 L20 20", 1.0).unwrap_err();
        assert!(
            matches!(erreur, ErreurSvg::CheminIllisible { .. }),
            "{erreur:?}"
        );
        assert!(erreur.to_string().contains("commencer"), "{erreur}");
    }

    #[test]
    fn une_commande_inconnue_est_refusee_en_la_nommant() {
        let erreur = lire_chemin("M0 0 K10 10", 1.0).unwrap_err();
        assert!(erreur.to_string().contains("K"), "{erreur}");
    }

    #[test]
    fn un_arc_sans_drapeau_est_refuse() {
        let erreur = lire_chemin("M0 0 A10 10 0 5 1 10 10", 1.0).unwrap_err();
        assert!(erreur.to_string().contains("drapeau"), "{erreur}");
    }

    #[test]
    fn l_aplatissement_respecte_la_tolerance() {
        // Une cubique dont la courbe vraie est connue : on échantillonne
        // densément et on mesure l'écart à la polyligne.
        let d = "M0 0 C0 100 100 100 100 0";
        let tolerance = 0.05;
        let chemins = lire_chemin(d, tolerance).unwrap();
        let polyligne = &chemins[0];
        let courbe = Courbe::Cubique {
            depart: Point::new(0.0, 0.0),
            controle1: Point::new(0.0, 100.0),
            controle2: Point::new(100.0, 100.0),
            arrivee: Point::new(100.0, 0.0),
        };
        let mut pire = 0.0_f64;
        for etape in 0..=2000 {
            let t = etape as f64 / 2000.0;
            let point = courbe.point(t);
            let mut distance = f64::MAX;
            for fenetre in polyligne.windows(2) {
                distance = distance.min(distance_au_segment(point, fenetre[0], fenetre[1]));
            }
            pire = pire.max(distance);
        }
        assert!(pire <= tolerance, "écart {pire} > tolérance {tolerance}");
        assert!(polyligne.len() > 4, "la courbe n'a pas été subdivisée");
    }

    fn distance_au_segment(p: Point, a: Point, b: Point) -> f64 {
        let (dx, dy) = (b.x - a.x, b.y - a.y);
        let norme = dx * dx + dy * dy;
        if norme == 0.0 {
            return ((p.x - a.x).powi(2) + (p.y - a.y).powi(2)).sqrt();
        }
        let t = (((p.x - a.x) * dx + (p.y - a.y) * dy) / norme).clamp(0.0, 1.0);
        let projete = Point::new(a.x + t * dx, a.y + t * dy);
        ((p.x - projete.x).powi(2) + (p.y - projete.y).powi(2)).sqrt()
    }

    fn aire(chemins: &[Vec<Point>]) -> f64 {
        let mut somme = 0.0;
        for chemin in chemins {
            let n = chemin.len();
            if n < 3 {
                continue;
            }
            for i in 0..n {
                let a = chemin[i];
                let b = chemin[(i + 1) % n];
                somme += a.x * b.y - b.x * a.y;
            }
        }
        somme / 2.0
    }

    // ── Formes élémentaires ────────────────────────────────────────────────

    #[test]
    fn un_rectangle_simple_a_l_aire_attendue() {
        let document = lire(
            r##"<svg width="100" height="100"><rect x="10" y="20" width="30" height="40"/></svg>"##,
        )
        .unwrap();
        assert_eq!(document.formes.len(), 1);
        assert!(proche(document.formes[0].aire(), 1200.0));
        let (min, max) = document.formes[0].boite().unwrap();
        assert!(proche(min.x, 10.0) && proche(min.y, 20.0));
        assert!(proche(max.x, 40.0) && proche(max.y, 60.0));
    }

    #[test]
    fn un_rectangle_arrondi_a_l_aire_attendue() {
        // 100×100, coins de rayon 10 : l'aire vaut 10000 − (4 − π)·100.
        let document = lire(
            r##"<svg width="100" height="100">
                 <rect x="0" y="0" width="100" height="100" rx="10" ry="10"/>
               </svg>"##,
        )
        .unwrap();
        let aire = document.formes[0].aire().abs();
        let attendue = 10000.0 - (4.0 - std::f64::consts::PI) * 100.0;
        // La polyligne est **inscrite** dans les cercles : l'aire est donc
        // toujours un peu plus petite, et de moins en moins à mesure que la
        // tolérance se resserre. Les deux moitiés de la propriété sont ici.
        assert!(
            aire < attendue,
            "aire {aire} ≥ {attendue} : la polyligne déborde"
        );
        assert!(
            attendue - aire < 3.0,
            "aire {aire}, attendue {attendue} : écart {}",
            attendue - aire
        );
        let fin = lire_avec(
            r##"<svg width="100" height="100">
                 <rect x="0" y="0" width="100" height="100" rx="10" ry="10"/>
               </svg>"##,
            0.001,
        )
        .unwrap();
        let ecart_fin = attendue - fin.formes[0].aire().abs();
        assert!(
            ecart_fin < attendue - aire,
            "resserrer la tolérance doit rapprocher de l'aire vraie ({ecart_fin} vs {})",
            attendue - aire
        );
    }

    #[test]
    fn un_cercle_a_l_aire_attendue() {
        let document =
            lire(r##"<svg width="100" height="100"><circle cx="50" cy="50" r="25"/></svg>"##)
                .unwrap();
        let aire = document.formes[0].aire().abs();
        let attendue = std::f64::consts::PI * 625.0;
        assert!(
            (aire - attendue).abs() / attendue < 0.002,
            "aire {aire}, attendue {attendue}"
        );
    }

    #[test]
    fn une_ellipse_a_l_aire_attendue() {
        let document = lire(
            r##"<svg width="100" height="100"><ellipse cx="50" cy="50" rx="30" ry="20"/></svg>"##,
        )
        .unwrap();
        let aire = document.formes[0].aire().abs();
        let attendue = std::f64::consts::PI * 600.0;
        assert!(
            (aire - attendue).abs() / attendue < 0.002,
            "aire {aire}, attendue {attendue}"
        );
    }

    #[test]
    fn une_ligne_ne_se_remplit_pas() {
        let document = lire(
            r##"<svg width="10" height="10"><line x1="0" y1="0" x2="10" y2="10" stroke="red"/></svg>"##,
        )
        .unwrap();
        assert_eq!(document.formes[0].remplissage, None);
        assert!(document.formes[0].contour.is_some());
    }

    #[test]
    fn un_polygone_est_ferme_et_une_polyligne_non() {
        let document = lire(
            r##"<svg width="10" height="10">
                 <polygon points="0,0 10,0 10,10"/>
                 <polyline points="0,0 10,0 10,10"/>
               </svg>"##,
        )
        .unwrap();
        assert_eq!(document.formes.len(), 2);
        let polygone = &document.formes[0];
        assert_eq!(polygone.sous_chemins[0].len(), 4);
        assert_eq!(polygone.sous_chemins[0][3], polygone.sous_chemins[0][0]);
        let polyligne = &document.formes[1];
        assert_eq!(polyligne.sous_chemins[0].len(), 3);
    }

    #[test]
    fn les_points_en_nombre_impair_sont_refuses() {
        let erreur = lire(r##"<svg width="10" height="10"><polygon points="0,0 10,0 5"/></svg>"##)
            .unwrap_err();
        assert!(erreur.to_string().contains("impair"), "{erreur}");
    }

    // ── Styles ─────────────────────────────────────────────────────────────

    #[test]
    fn l_heritage_des_attributs_de_presentation() {
        let document = lire(
            r##"<svg width="100" height="100" fill="#123456" stroke="#abcdef" stroke-width="3">
                 <g transform="translate(10,10)"><rect x="0" y="0" width="10" height="10"/></g>
               </svg>"##,
        )
        .unwrap();
        let forme = &document.formes[0];
        assert_eq!(forme.remplissage.unwrap().hexadecimal(), "#123456");
        let contour = forme.contour.unwrap();
        assert_eq!(contour.couleur.hexadecimal(), "#abcdef");
        assert!(proche(contour.epaisseur, 3.0));
        let (min, _) = forme.boite().unwrap();
        assert!(proche(min.x, 10.0) && proche(min.y, 10.0));
    }

    #[test]
    fn l_attribut_style_l_emporte_sur_l_attribut_de_presentation() {
        let document = lire(
            r##"<svg width="10" height="10" fill="red">
                 <rect x="0" y="0" width="10" height="10" style="fill:#00ff00"/>
               </svg>"##,
        )
        .unwrap();
        assert_eq!(
            document.formes[0].remplissage.unwrap().hexadecimal(),
            "#00ff00"
        );
    }

    #[test]
    fn current_color_se_resout_par_l_attribut_color() {
        let document = lire(
            r##"<svg width="10" height="10" color="#ff0000" stroke="currentColor">
                 <rect x="0" y="0" width="10" height="10" fill="none"/>
               </svg>"##,
        )
        .unwrap();
        assert_eq!(
            document.formes[0].contour.unwrap().couleur.hexadecimal(),
            "#ff0000"
        );
    }

    #[test]
    fn display_none_masque_le_sous_arbre() {
        let document = lire(
            r##"<svg width="10" height="10">
                 <g display="none"><rect x="0" y="0" width="10" height="10"/></g>
                 <rect x="0" y="0" width="5" height="5"/>
               </svg>"##,
        )
        .unwrap();
        assert_eq!(document.formes.len(), 1);
        assert!(proche(document.formes[0].aire(), 25.0));
        assert_eq!(document.non_rendu("g"), 1);
    }

    #[test]
    fn les_opa_accumulent_et_une_forme_invisible_ne_l_est_pas() {
        let document = lire(
            r##"<svg width="10" height="10">
                 <g opacity="0.5">
                   <rect x="0" y="0" width="10" height="10" fill-opacity="0.5"/>
                 </g>
               </svg>"##,
        )
        .unwrap();
        assert!(proche(document.formes[0].remplissage.unwrap().alpha, 0.25));
        let document = lire(
            r##"<svg width="10" height="10">
                 <rect x="0" y="0" width="10" height="10" opacity="0"/>
               </svg>"##,
        )
        .unwrap();
        assert_eq!(document.formes[0].remplissage, None);
    }

    // ── Refus et signalements ──────────────────────────────────────────────

    #[test]
    fn un_remplissage_en_degrade_est_refuse() {
        let erreur = lire(
            r##"<svg width="10" height="10">
                 <defs><linearGradient id="g"/></defs>
                 <rect x="0" y="0" width="10" height="10" fill="url(#g)"/>
               </svg>"##,
        )
        .unwrap_err();
        assert!(
            matches!(erreur, ErreurSvg::NonSupporte { .. }),
            "{erreur:?}"
        );
        assert!(erreur.to_string().contains("url(#g)"), "{erreur}");
    }

    #[test]
    fn un_decoupage_sur_une_forme_est_refuse() {
        let erreur = lire(
            r##"<svg width="10" height="10">
                 <rect x="0" y="0" width="10" height="10" clip-path="url(#c)"/>
               </svg>"##,
        )
        .unwrap_err();
        assert!(erreur.to_string().contains("clip-path"), "{erreur}");
    }

    #[test]
    fn une_feuille_de_style_est_refusee() {
        let erreur = lire(
            r##"<svg width="10" height="10"><style>rect{fill:red}</style>
                 <rect x="0" y="0" width="10" height="10"/></svg>"##,
        )
        .unwrap_err();
        assert!(erreur.to_string().contains("style"), "{erreur}");
    }

    #[test]
    fn une_image_et_un_use_sont_refuses_nommes() {
        let erreur = lire(
            r##"<svg width="10" height="10"><image href="a.png" width="10" height="10"/></svg>"##,
        )
        .unwrap_err();
        assert!(erreur.to_string().contains("image"), "{erreur}");
        let erreur = lire(r##"<svg width="10" height="10"><use href="#a"/></svg>"##).unwrap_err();
        assert!(erreur.to_string().contains("use"), "{erreur}");
    }

    #[test]
    fn les_elements_qui_decrivent_sans_dessiner_sont_comptes() {
        let document = lire(
            r##"<svg width="10" height="10">
                 <title>titre</title><desc>description</desc><metadata>m</metadata>
                 <defs><linearGradient id="g"/></defs>
                 <rect x="0" y="0" width="10" height="10"/>
               </svg>"##,
        )
        .unwrap();
        assert_eq!(document.formes.len(), 1);
        assert_eq!(document.non_rendu("defs"), 1);
        assert_eq!(document.non_rendu("title"), 1);
        assert_eq!(document.non_rendu("desc"), 1);
        assert_eq!(document.non_rendu("metadata"), 1);
        // Ce qui est **dedans** `<defs>` n'est pas parcouru : un `<defs>` peut
        // contenir un `<rect>` qui ne se dessine pas, et le traverser pour le
        // compter serait un pas vers le dessiner. La définition est comptée une
        // fois, à son entrée.
        assert_eq!(document.non_rendu("linearGradient"), 0);
    }

    #[test]
    fn foreign_object_est_compte_et_non_rendu() {
        let document =
            lire(r##"<svg width="10" height="10"><foreignObject width="1" height="1"/></svg>"##)
                .unwrap();
        assert_eq!(document.non_rendu("foreignObject"), 1);
        assert!(document.formes.is_empty());
    }

    // ── switch, tel que l'écrit Illustrator ────────────────────────────────

    #[test]
    fn un_switch_prefere_le_premier_enfant_sans_extension_exigee() {
        let document = lire(
            r##"<svg width="10" height="10">
                 <switch>
                   <foreignObject requiredExtensions="http://ns.adobe.com/Extensibility/1.0/" width="1" height="1"/>
                   <g><rect x="0" y="0" width="4" height="4"/></g>
                 </switch>
               </svg>"##,
        )
        .unwrap();
        assert_eq!(document.formes.len(), 1);
        assert!(proche(document.formes[0].aire(), 16.0));
    }

    // ── canevas, viewBox, repère ───────────────────────────────────────────

    #[test]
    fn le_view_box_ramene_le_dessin_dans_le_canevas() {
        let document = lire(
            r##"<svg viewBox="0 0 24 24" width="48" height="48">
                 <rect x="0" y="0" width="24" height="24"/>
               </svg>"##,
        )
        .unwrap();
        let (min, max) = document.formes[0].boite().unwrap();
        assert!(proche(min.x, 0.0) && proche(min.y, 0.0));
        assert!(proche(max.x, 48.0) && proche(max.y, 48.0));
        assert_eq!(document.largeur, Some(48.0));
        assert_eq!(document.hauteur, Some(48.0));
    }

    #[test]
    fn un_view_box_avec_un_decalage_est_respecte() {
        let document = lire(
            r##"<svg viewBox="10 10 10 10" width="20" height="20">
                 <rect x="10" y="10" width="10" height="10"/>
               </svg>"##,
        )
        .unwrap();
        let (min, max) = document.formes[0].boite().unwrap();
        assert!(proche(min.x, 0.0) && proche(min.y, 0.0));
        assert!(proche(max.x, 20.0) && proche(max.y, 20.0));
    }

    #[test]
    fn preserve_aspect_ratio_meet_centre_le_dessin() {
        // 10×10 dans un canevas 40×20 : le facteur est 2, et le dessin est
        // centré verticalement.
        let document = lire(
            r##"<svg viewBox="0 0 10 10" width="40" height="20">
                 <rect x="0" y="0" width="10" height="10"/>
               </svg>"##,
        )
        .unwrap();
        let (min, max) = document.formes[0].boite().unwrap();
        assert!(proche(max.x - min.x, 20.0), "{min:?} {max:?}");
        assert!(proche(max.y - min.y, 20.0), "{min:?} {max:?}");
        assert!(proche(min.y, 0.0), "{min:?}");
    }

    #[test]
    fn preserve_aspect_ratio_none_etale() {
        let document = lire(
            r##"<svg viewBox="0 0 10 10" width="40" height="20" preserveAspectRatio="none">
                 <rect x="0" y="0" width="10" height="10"/>
               </svg>"##,
        )
        .unwrap();
        let (min, max) = document.formes[0].boite().unwrap();
        assert!(proche(max.x - min.x, 40.0), "{min:?} {max:?}");
        assert!(proche(max.y - min.y, 20.0), "{min:?} {max:?}");
    }

    // ── Texte ──────────────────────────────────────────────────────────────

    #[test]
    fn le_texte_est_lu_et_non_dessine() {
        let document = lire(
            r##"<svg width="24" height="24">
                 <text x="12" y="16" font-family="Arial, sans-serif" font-size="6"
                       font-weight="bold" text-anchor="middle" fill="#000000">PDF</text>
               </svg>"##,
        )
        .unwrap();
        assert!(document.formes.is_empty());
        assert_eq!(document.textes.len(), 1);
        let texte = &document.textes[0];
        assert_eq!(texte.contenu, "PDF");
        assert!(proche(texte.x, 12.0) && proche(texte.y, 16.0));
        assert!(proche(texte.corps, 6.0));
        assert_eq!(texte.famille, "Arial, sans-serif");
        assert!(texte.gras);
        assert_eq!(texte.ancre, Ancre::Milieu);
    }

    #[test]
    fn le_corps_d_un_texte_suit_le_view_box() {
        let document = lire(
            r##"<svg viewBox="0 0 10 10" width="20" height="20">
                 <text x="1" y="1" font-size="2">x</text>
               </svg>"##,
        )
        .unwrap();
        let texte = &document.textes[0];
        assert!(proche(texte.corps, 4.0), "corps {}", texte.corps);
        assert!(proche(texte.x, 2.0) && proche(texte.y, 2.0));
    }

    // ── XML, entités, octets ───────────────────────────────────────────────

    #[test]
    fn une_racine_qui_n_est_pas_svg_est_refusee() {
        let erreur = lire("<html><body/></html>").unwrap_err();
        assert!(
            matches!(erreur, ErreurSvg::RacineInattendue { .. }),
            "{erreur:?}"
        );
        assert!(erreur.to_string().contains("html"), "{erreur}");
    }

    #[test]
    fn les_entites_declarees_par_le_doctype_sont_resolues() {
        let document = lire(
            "<!DOCTYPE svg PUBLIC \"-//W3C//DTD SVG 1.1 Basic//EN\" \"x.dtd\" [\n\
               <!ENTITY ext \"http://ns.adobe.com/Extensibility/1.0/\">\n\
             ]>\n\
             <svg xmlns:x=\"&ext;\" width=\"10\" height=\"10\">\
               <rect x=\"0\" y=\"0\" width=\"10\" height=\"10\"/></svg>",
        )
        .unwrap();
        assert_eq!(document.entites, 1);
        assert_eq!(document.formes.len(), 1);
    }

    #[test]
    fn le_bom_est_retire() {
        let mut octets = vec![0xEF, 0xBB, 0xBF];
        octets.extend_from_slice(b"<svg width=\"1\" height=\"1\"/>");
        assert!(lire_octets(&octets, TOLERANCE_PAR_DEFAUT).is_ok());
    }

    #[test]
    fn un_flux_non_utf8_est_refuse() {
        let erreur = lire_octets(b"<svg \xff/>", TOLERANCE_PAR_DEFAUT).unwrap_err();
        assert!(
            matches!(erreur, ErreurSvg::OctetsNonUtf8 { position: 5 }),
            "{erreur:?}"
        );
    }

    // ── Un document qui ressemble aux fichiers réels ───────────────────────

    #[test]
    fn une_icone_de_barre_d_outils_telle_que_le_produit_les_exporte() {
        // Le motif exact des icônes du dépôt : `fill="none"` sur la racine,
        // `stroke="currentColor"`, `stroke-linecap="round"`, plusieurs chemins.
        let document = lire(
            r##"<svg width="24" height="24" viewBox="0 0 24 24" fill="none"
                    xmlns="http://www.w3.org/2000/svg" stroke="currentColor"
                    stroke-width="2" stroke-linecap="round">
                  <path d="M3 3h18v18H3V3z" stroke-width="2" fill="none"/>
                  <path d="M3 7h3M3 11h2M3 15h3M3 19h2" stroke-width="1.5" stroke-linecap="round"/>
                  <path d="M7 3v3M11 3v2M15 3v3M19 3v2" stroke-width="1.5" stroke-linecap="round"/>
                </svg>"##,
        )
        .unwrap();
        assert_eq!(document.formes.len(), 3);
        for forme in &document.formes {
            assert_eq!(forme.remplissage, None, "l'icône demande fill=\"none\"");
            let contour = forme.contour.expect("les traits sont contourés");
            assert_eq!(contour.couleur.hexadecimal(), "#000000");
            assert_eq!(contour.extremite, Extremite::Rond);
        }
        assert!(proche(document.formes[0].contour.unwrap().epaisseur, 2.0));
        assert!(proche(document.formes[1].contour.unwrap().epaisseur, 1.5));
    }

    #[test]
    fn le_logo_illustrator_du_depot_est_lu() {
        // La structure exacte de `icons/sper_typo.svg` (83 Ko dans le dépôt) :
        // DTD interne, `switch`, `foreignObject`, `display="none"`, chemins à
        // six décimales. La version complète est lue par
        // `scripts/validate-svg.mjs`, sur le fichier réel.
        let source = r##"<?xml version="1.0" encoding="utf-8"?>
<!-- Generator: Adobe Illustrator 30.8.1, SVG Export Plug-In . SVG Version: 9.03 Build 0)  -->
<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1 Basic//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11-basic.dtd" [
  <!ENTITY ns_extend "http://ns.adobe.com/Extensibility/1.0/">
  <!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">
]>
<svg version="1.1" baseProfile="basic" id="Calque_1" xmlns:x="&ns_extend;" xmlns:i="&ns_ai;"
  xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
  x="0px" y="0px" viewBox="0 0 500 500" xml:space="preserve">
<switch>
  <foreignObject requiredExtensions="&ns_ai;" x="0" y="0" width="1" height="1">
    <i:aipgfRef xlink:href="#adobe_illustrator_pgf"></i:aipgfRef>
  </foreignObject>
  <g i:extraneous="self">
    <g id="Calque_2" display="none"><g display="inline"><path fill="#020203" d="M193.9,157.4c1.3,1.5,2.7,2.7,4.2,3.6L193.9,157.4z"/></g></g>
    <g display="inline">
      <path fill="#020203" d="M240.1,168.2l0.2-2.3c-1.6,1.1-3.2,1.9-4.6,2.3L240.1,168.2z"/>
      <path fill="#020203" d="M251.1,179.5l8.6-40.1h7.1l-0.1,2.1L251.1,179.5z"/>
      <polygon fill="#020203" points="300,300 340,300 320,340"/>
    </g>
  </g>
</switch>
</svg>"##;
        let document = lire(source).unwrap();
        assert_eq!(document.entites, 2);
        // Le `<switch>` choisit le **second** enfant : le `<foreignObject>` est
        // écarté parce qu'il exige une extension, et il n'est donc même pas
        // parcouru — c'est la règle du SVG, et c'est ce qui rend un fichier
        // Adobe lisible au lieu d'être refusé.
        assert_eq!(document.non_rendu("foreignObject"), 0);
        assert_eq!(document.non_rendu("i:aipgfRef"), 0);
        // `display="none"` masque un groupe entier : son chemin n'est pas lu,
        // la seconde branche en donne trois.
        assert_eq!(
            document.formes.len(),
            3,
            "formes : {}",
            document.formes.len()
        );
        assert_eq!(document.view_box.unwrap().max.x, 500.0);
        // Aucun attribut d'Illustrator n'a fait échouer la lecture.
        assert!(document.formes.iter().all(|f| f.est_peinte()));
    }
}
