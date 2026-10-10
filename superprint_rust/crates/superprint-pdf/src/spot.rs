//! Encres directes (tons directs) et espaces couleur `/Separation`.
//!
//! Une **encre directe** — un Pantone, par exemple — n'est pas un mélange
//! quadri : c'est une **plaque séparée**, que l'imprimeur reçoit dans son
//! propre canal. En PDF, cela se traduit par un espace couleur
//! [`/Separation`](https://opensource.adobe.com/dc-acrobat-sdk-docs/pdfstandards/PDF32000_2008.pdf)
//! dont la définition est celle que produit [`SpotInk::separation_pdf`] :
//!
//! ```text
//! [/Separation /PANTONE#20WARM#20RED#20C /DeviceCMYK
//!   << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0.9 0.8 0] /N 1 >>]
//! ```
//!
//! Le quatrième élément est la **transformation de teinte** : une fonction
//! d'interpolation linéaire entre le papier (`C0`, teinte 0 %) et l'encre
//! pleine (`C1`, teinte 100 %). C'est elle que les visionneuses et les RIP
//! utilisent pour *afficher* l'encre de remplacement.
//!
//! C'est le point que le rapport de test interne (non publié) désigne comme
//! **défaut P0-1** : quand les marqueurs d'encre directe sont perdus, l'imprimeur
//! reçoit un PDF sans plaque Pantone, sans avertissement.

use superprint_core::{Cmyk, Rgb};

use crate::object;

/// Espace de remplacement (*alternate space*) d'une encre directe : en quel
/// espace l'encre pleine est décrite pour l'affichage.
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum AlternateSpace {
    /// Une seule composante, 0–255.
    Gray(u8),
    /// Trois composantes, 0–255.
    Rgb(Rgb),
    /// Quatre composantes, normalisées 0,0–1,0.
    Cmyk(Cmyk),
}

impl AlternateSpace {
    /// Nom de l'espace PDF correspondant.
    #[must_use]
    pub fn pdf_name(self) -> &'static str {
        match self {
            Self::Gray(_) => "DeviceGray",
            Self::Rgb(_) => "DeviceRGB",
            Self::Cmyk(_) => "DeviceCMYK",
        }
    }

    /// Nombre de composantes de l'espace.
    #[must_use]
    pub fn components(self) -> usize {
        match self {
            Self::Gray(_) => 1,
            Self::Rgb(_) => 3,
            Self::Cmyk(_) => 4,
        }
    }

    /// Valeurs à **0 %** d'encre — le papier, toujours « rien ».
    #[must_use]
    pub fn c0(self) -> Vec<String> {
        vec!["0".to_string(); self.components()]
    }

    /// Valeurs à **100 %** d'encre — l'encre pleine.
    #[must_use]
    pub fn c1(self) -> Vec<String> {
        match self {
            Self::Gray(g) => vec![object::number(f64::from(g) / 255.0)],
            Self::Rgb(Rgb { r, g, b }) => vec![
                object::number(f64::from(r) / 255.0),
                object::number(f64::from(g) / 255.0),
                object::number(f64::from(b) / 255.0),
            ],
            Self::Cmyk(Cmyk { c, m, y, k }) => vec![
                object::number(c),
                object::number(m),
                object::number(y),
                object::number(k),
            ],
        }
    }
}

/// Erreur de construction d'une encre directe.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum SpotError {
    /// Le nom de l'encre est vide : une plaque sans nom n'a aucun sens.
    EmptyName,
}

impl std::fmt::Display for SpotError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyName => write!(f, "le nom de l'encre directe ne peut pas être vide"),
        }
    }
}

impl std::error::Error for SpotError {}

/// Une **encre directe** : un nom (celui imprimé sur la plaque) et un espace
/// de remplacement.
#[derive(Clone, Debug, PartialEq)]
pub struct SpotInk {
    name: String,
    alternate: AlternateSpace,
}

impl SpotInk {
    /// Construit une encre directe. Le nom doit être non vide.
    ///
    /// # Erreurs
    ///
    /// Renvoie [`SpotError::EmptyName`] si `name` est vide ou ne contient que
    /// des blancs.
    pub fn new(name: impl Into<String>, alternate: AlternateSpace) -> Result<Self, SpotError> {
        let name = name.into();
        if name.trim().is_empty() {
            return Err(SpotError::EmptyName);
        }
        Ok(Self { name, alternate })
    }

    /// Nom de l'encre (tel qu'il apparaîtra sur la plaque).
    #[must_use]
    pub fn name(&self) -> &str {
        &self.name
    }

    /// Espace de remplacement.
    #[must_use]
    pub fn alternate(&self) -> AlternateSpace {
        self.alternate
    }

    /// Dictionnaire de la **transformation de teinte** : interpolation linéaire
    /// papier → encre pleine (`FunctionType 2`, exposant 1).
    #[must_use]
    pub fn tint_transform_pdf(&self) -> String {
        object::dict(&[
            ("FunctionType", object::integer(2)),
            ("Domain", object::array(&["0".into(), "1".into()])),
            ("C0", object::array(&self.alternate.c0())),
            ("C1", object::array(&self.alternate.c1())),
            ("N", object::integer(1)),
        ])
    }

    /// Espace couleur PDF complet : le tableau `/Separation` à quatre éléments.
    ///
    /// ```text
    /// [/Separation /NOM /DeviceCMYK << …transformation de teinte… >>]
    /// ```
    #[must_use]
    pub fn separation_pdf(&self) -> String {
        format!(
            "[{} {} {} {}]",
            object::name("Separation"),
            object::name(&self.name),
            object::name(self.alternate.pdf_name()),
            self.tint_transform_pdf(),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn pantone_warm_red() -> SpotInk {
        SpotInk::new(
            "PANTONE WARM RED C",
            AlternateSpace::Cmyk(Cmyk {
                c: 0.0,
                m: 0.9,
                y: 0.8,
                k: 0.0,
            }),
        )
        .unwrap()
    }

    #[test]
    fn nom_vide_refuse() {
        assert_eq!(
            SpotInk::new("   ", AlternateSpace::Gray(0)),
            Err(SpotError::EmptyName)
        );
    }

    #[test]
    fn encre_ok() {
        let ink = pantone_warm_red();
        assert_eq!(ink.name(), "PANTONE WARM RED C");
        assert_eq!(
            ink.alternate(),
            AlternateSpace::Cmyk(Cmyk {
                c: 0.0,
                m: 0.9,
                y: 0.8,
                k: 0.0
            })
        );
    }

    #[test]
    fn transformation_de_teinte_cmjn() {
        assert_eq!(
            pantone_warm_red().tint_transform_pdf(),
            "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0.9 0.8 0] /N 1 >>"
        );
    }

    #[test]
    fn transformation_de_teinte_rvb() {
        let ink = SpotInk::new("Vert signal", AlternateSpace::Rgb(Rgb::new(0, 128, 64))).unwrap();
        // 128/255 ≈ 0.5020, 64/255 ≈ 0.2510
        assert_eq!(
            ink.tint_transform_pdf(),
            "<< /FunctionType 2 /Domain [0 1] /C0 [0 0 0] /C1 [0 0.502 0.251] /N 1 >>"
        );
    }

    #[test]
    fn espace_separation_complet() {
        // Golden : la chaîne EXACTE qui décide si l'imprimeur voit la plaque.
        assert_eq!(
            pantone_warm_red().separation_pdf(),
            "[/Separation /PANTONE#20WARM#20RED#20C /DeviceCMYK \
             << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0.9 0.8 0] /N 1 >>]"
        );
    }

    #[test]
    fn noms_espaces_bien_echappes_dans_le_separation() {
        let ink = SpotInk::new(
            "PANTONE VIOLET C",
            AlternateSpace::Cmyk(Cmyk {
                c: 0.7,
                m: 1.0,
                y: 0.0,
                k: 0.1,
            }),
        )
        .unwrap();
        assert!(ink
            .separation_pdf()
            .starts_with("[/Separation /PANTONE#20VIOLET#20C /DeviceCMYK "));
    }
}
