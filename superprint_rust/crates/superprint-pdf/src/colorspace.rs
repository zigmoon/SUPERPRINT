//! Pile de couleurs d'une page : la **quadri de base** et les **encres
//! directes** posées par-dessus.
//!
//! SuperPrint laisse choisir la couche quadri située **sous** les tons directs
//! — « CMJN + encres directes » ou « RVB + encres directes » — pour que les
//! encres directes RVB restent vives au lieu d'être écrasées par le gamut
//! CMJN. Ce module en porte le modèle et le décompte de canaux.

use crate::object;
use crate::spot::{SpotError, SpotInk};

/// La couche quadri (procédé) posée sous les encres directes.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum QuadriSpace {
    /// Quadrichromie CMJN (4 canaux).
    Cmyk,
    /// Synthèse additive RVB (3 canaux).
    Rgb,
}

impl QuadriSpace {
    /// Nom de l'espace PDF correspondant.
    #[must_use]
    pub fn pdf_name(self) -> &'static str {
        match self {
            Self::Cmyk => "DeviceCMYK",
            Self::Rgb => "DeviceRGB",
        }
    }

    /// Nombre de canaux de la quadri.
    #[must_use]
    pub fn channels(self) -> usize {
        match self {
            Self::Cmyk => 4,
            Self::Rgb => 3,
        }
    }
}

/// Erreur de construction d'une pile de couleurs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum StackError {
    /// Deux encres portent le même nom : deux plaques identiques, ce qui est
    /// toujours une erreur de composition.
    DuplicateSpot(String),
    /// L'encre n'a pas pu être construite.
    Spot(SpotError),
}

impl std::fmt::Display for StackError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::DuplicateSpot(name) => {
                write!(f, "encre directe en double : « {name} »")
            }
            Self::Spot(e) => write!(f, "{e}"),
        }
    }
}

impl std::error::Error for StackError {}

impl From<SpotError> for StackError {
    fn from(error: SpotError) -> Self {
        Self::Spot(error)
    }
}

/// La pile de couleurs d'une page : quadri + encres directes (sans doublon).
#[derive(Clone, Debug, PartialEq)]
pub struct ColorStack {
    quadri: QuadriSpace,
    spots: Vec<SpotInk>,
}

impl ColorStack {
    /// Pile vide (aucune encre directe) sur la quadri donnée.
    #[must_use]
    pub fn new(quadri: QuadriSpace) -> Self {
        Self {
            quadri,
            spots: Vec::new(),
        }
    }

    /// Construit une pile à partir d'une liste d'encres, en refusant les
    /// doublons.
    ///
    /// # Erreurs
    ///
    /// Renvoie [`StackError::DuplicateSpot`] si deux encres ont le même nom.
    pub fn with_spots(
        quadri: QuadriSpace,
        spots: impl IntoIterator<Item = SpotInk>,
    ) -> Result<Self, StackError> {
        let mut stack = Self::new(quadri);
        for ink in spots {
            stack.add_spot(ink)?;
        }
        Ok(stack)
    }

    /// Ajoute une encre directe.
    ///
    /// # Erreurs
    ///
    /// Renvoie [`StackError::DuplicateSpot`] si une encre du même nom est déjà
    /// présente.
    pub fn add_spot(&mut self, ink: SpotInk) -> Result<(), StackError> {
        if self
            .spots
            .iter()
            .any(|existing| existing.name() == ink.name())
        {
            return Err(StackError::DuplicateSpot(ink.name().to_string()));
        }
        self.spots.push(ink);
        Ok(())
    }

    /// La quadri de base.
    #[must_use]
    pub fn quadri(&self) -> QuadriSpace {
        self.quadri
    }

    /// Les encres directes, dans l'ordre d'ajout.
    #[must_use]
    pub fn spots(&self) -> &[SpotInk] {
        &self.spots
    }

    /// Nombre total de canaux : quadri + une par encre directe.
    ///
    /// C'est ce que SuperPrint affiche à l'export — « 6 channels: CMYK + 2
    /// Pantone » pour une quadri CMJN et deux tons directs.
    #[must_use]
    pub fn channels(&self) -> usize {
        self.quadri.channels() + self.spots.len()
    }

    /// Nom du canal d'encre directe `index` dans les ressources de la page
    /// (`/CS0`, `/CS1`, …).
    #[must_use]
    pub fn spot_cs_name(index: usize) -> String {
        format!("CS{index}")
    }

    /// Nom du canal quadri dans les ressources de la page.
    #[must_use]
    pub fn quadri_cs_name() -> &'static str {
        "CSQuadri"
    }

    /// Dictionnaire `/ColorSpace` des ressources : la quadri puis chaque encre
    /// directe, sous des noms stables (`/CSQuadri`, `/CS0`, `/CS1`…).
    #[must_use]
    pub fn resources_pdf(&self) -> String {
        let mut entries: Vec<(String, String)> = Vec::with_capacity(self.spots.len() + 1);
        entries.push((
            Self::quadri_cs_name().to_string(),
            object::name(self.quadri.pdf_name()),
        ));
        for (index, ink) in self.spots.iter().enumerate() {
            entries.push((Self::spot_cs_name(index), ink.separation_pdf()));
        }
        object::dict(&entries)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spot::AlternateSpace;
    use superprint_core::{Cmyk, Rgb};

    fn ink(name: &str) -> SpotInk {
        SpotInk::new(
            name,
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
    fn decompte_des_canaux() {
        // Rapport P0 : « 6 channels: CMYK + 2 Pantone ».
        let stack = ColorStack::with_spots(
            QuadriSpace::Cmyk,
            [ink("PANTONE WARM RED C"), ink("PANTONE VIOLET C")],
        )
        .unwrap();
        assert_eq!(stack.channels(), 6);
        assert_eq!(stack.spots().len(), 2);
        assert_eq!(stack.quadri(), QuadriSpace::Cmyk);
    }

    #[test]
    fn quadri_rvb() {
        let stack = ColorStack::new(QuadriSpace::Rgb);
        assert_eq!(stack.channels(), 3);
    }

    #[test]
    fn doublon_refuse() {
        let err = ColorStack::with_spots(
            QuadriSpace::Cmyk,
            [ink("PANTONE WARM RED C"), ink("PANTONE WARM RED C")],
        )
        .unwrap_err();
        assert_eq!(
            err,
            StackError::DuplicateSpot("PANTONE WARM RED C".to_string())
        );
    }

    #[test]
    fn ressources_nomment_quadri_et_encres() {
        let stack = ColorStack::with_spots(
            QuadriSpace::Cmyk,
            [ink("PANTONE WARM RED C"), ink("PANTONE VIOLET C")],
        )
        .unwrap();
        let resources = stack.resources_pdf();
        assert!(resources.starts_with("<< /CSQuadri /DeviceCMYK"));
        assert!(resources.contains("/CS0 [/Separation /PANTONE#20WARM#20RED#20C"));
        assert!(resources.contains("/CS1 [/Separation /PANTONE#20VIOLET#20C"));
    }

    #[test]
    fn encres_rvb_conservees() {
        // Les encres directes RVB doivent garder leur espace DeviceRGB.
        let green = SpotInk::new("Vert", AlternateSpace::Rgb(Rgb::new(0, 128, 64))).unwrap();
        let stack = ColorStack::with_spots(QuadriSpace::Cmyk, [green]).unwrap();
        assert!(stack.resources_pdf().contains("/DeviceRGB"));
    }
}
