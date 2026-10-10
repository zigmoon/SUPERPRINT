//! Tampons d'image typés : RVB (3 canaux) et niveaux de gris (1 canal).
//!
//! Les données sont stockées **ligne par ligne, sans remplissage** : la taille
//! attendue du tampon est exactement `largeur × hauteur × canaux`. Toute
//! construction vérifie cette cohérence, ce qui évite les décalages silencieux
//! (une image « de travers » est un classique du traitement d'image).

use superprint_core::color::Rgb;

/// Erreur de construction d'un tampon d'image.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ImageError {
    /// Largeur ou hauteur nulle : une image vide n'est pas exploitable.
    EmptyDimensions,
    /// Le tampon ne fait pas exactement `largeur × hauteur × canaux` octets.
    BadLength {
        /// Taille attendue, en octets.
        expected: usize,
        /// Taille fournie, en octets.
        got: usize,
    },
    /// Coordonnées de pixel hors de l'image.
    OutOfBounds,
}

impl std::fmt::Display for ImageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::EmptyDimensions => write!(f, "dimensions d'image nulles"),
            Self::BadLength { expected, got } => {
                write!(
                    f,
                    "tampon de {got} octets alors que {expected} sont attendus"
                )
            }
            Self::OutOfBounds => write!(f, "coordonnées de pixel hors de l'image"),
        }
    }
}

impl std::error::Error for ImageError {}

/// Image en couleurs, 3 octets par pixel (rouge, vert, bleu).
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RgbImage {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

impl RgbImage {
    /// Nombre d'octets par pixel.
    pub const CHANNELS: usize = 3;

    /// Construit une image RVB à partir de ses données.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::EmptyDimensions`] si une dimension est nulle,
    /// [`ImageError::BadLength`] si le tampon n'a pas la taille attendue.
    pub fn from_data(width: u32, height: u32, data: Vec<u8>) -> Result<Self, ImageError> {
        if width == 0 || height == 0 {
            return Err(ImageError::EmptyDimensions);
        }
        let expected = Self::expected_len(width, height);
        if data.len() != expected {
            return Err(ImageError::BadLength {
                expected,
                got: data.len(),
            });
        }
        Ok(Self {
            width,
            height,
            data,
        })
    }

    /// Taille attendue du tampon, en octets.
    #[must_use]
    pub fn expected_len(width: u32, height: u32) -> usize {
        width as usize * height as usize * Self::CHANNELS
    }

    /// Largeur, en pixels.
    #[must_use]
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Hauteur, en pixels.
    #[must_use]
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Les données brutes (RVB entrelacé).
    #[must_use]
    pub fn data(&self) -> &[u8] {
        &self.data
    }

    /// Lit le pixel aux coordonnées données.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::OutOfBounds`] si `x` ou `y` sort de l'image.
    pub fn pixel(&self, x: u32, y: u32) -> Result<Rgb, ImageError> {
        if x >= self.width || y >= self.height {
            return Err(ImageError::OutOfBounds);
        }
        let i = (y as usize * self.width as usize + x as usize) * Self::CHANNELS;
        Ok(Rgb::new(self.data[i], self.data[i + 1], self.data[i + 2]))
    }

    /// Convertit l'image en niveaux de gris (luminance Rec. 709).
    #[must_use]
    pub fn to_gray(&self) -> GrayImage {
        let mut out = Vec::with_capacity(self.width as usize * self.height as usize);
        for pixel in self.data.chunks_exact(Self::CHANNELS) {
            out.push(Rgb::new(pixel[0], pixel[1], pixel[2]).luma());
        }
        GrayImage {
            width: self.width,
            height: self.height,
            data: out,
        }
    }
}

/// Image en niveaux de gris, 1 octet par pixel.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GrayImage {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

impl GrayImage {
    /// Nombre d'octets par pixel.
    pub const CHANNELS: usize = 1;

    /// Construit une image en niveaux de gris à partir de ses données.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::EmptyDimensions`] si une dimension est nulle,
    /// [`ImageError::BadLength`] si le tampon n'a pas la taille attendue.
    pub fn from_data(width: u32, height: u32, data: Vec<u8>) -> Result<Self, ImageError> {
        if width == 0 || height == 0 {
            return Err(ImageError::EmptyDimensions);
        }
        let expected = width as usize * height as usize;
        if data.len() != expected {
            return Err(ImageError::BadLength {
                expected,
                got: data.len(),
            });
        }
        Ok(Self {
            width,
            height,
            data,
        })
    }

    /// Largeur, en pixels.
    #[must_use]
    pub fn width(&self) -> u32 {
        self.width
    }

    /// Hauteur, en pixels.
    #[must_use]
    pub fn height(&self) -> u32 {
        self.height
    }

    /// Les données brutes (un octet par pixel).
    #[must_use]
    pub fn data(&self) -> &[u8] {
        &self.data
    }

    /// Lit la valeur de gris aux coordonnées données.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::OutOfBounds`] si `x` ou `y` sort de l'image.
    pub fn pixel(&self, x: u32, y: u32) -> Result<u8, ImageError> {
        if x >= self.width || y >= self.height {
            return Err(ImageError::OutOfBounds);
        }
        Ok(self.data[y as usize * self.width as usize + x as usize])
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn construction_valide() {
        let img = RgbImage::from_data(2, 1, vec![1, 2, 3, 4, 5, 6]).unwrap();
        assert_eq!(img.width(), 2);
        assert_eq!(img.height(), 1);
        assert_eq!(img.pixel(0, 0).unwrap(), Rgb::new(1, 2, 3));
        assert_eq!(img.pixel(1, 0).unwrap(), Rgb::new(4, 5, 6));
    }

    #[test]
    fn longueur_invalide_refusee() {
        assert_eq!(
            RgbImage::from_data(2, 1, vec![1, 2, 3]),
            Err(ImageError::BadLength {
                expected: 6,
                got: 3
            })
        );
    }

    #[test]
    fn dimensions_nulles_refusees() {
        assert_eq!(
            RgbImage::from_data(0, 5, vec![]),
            Err(ImageError::EmptyDimensions)
        );
    }

    #[test]
    fn hors_bornes() {
        let img = RgbImage::from_data(1, 1, vec![0, 0, 0]).unwrap();
        assert_eq!(img.pixel(1, 0), Err(ImageError::OutOfBounds));
        assert_eq!(img.pixel(0, 1), Err(ImageError::OutOfBounds));
    }

    #[test]
    fn gris_depuis_rvb() {
        let img = RgbImage::from_data(2, 1, vec![255, 255, 255, 0, 0, 0]).unwrap();
        let gray = img.to_gray();
        assert_eq!(gray.width(), 2);
        assert_eq!(gray.data(), &[255, 0]);
        // Le blanc doit rester blanc, le noir rester noir.
        assert_eq!(gray.pixel(0, 0).unwrap(), 255);
        assert_eq!(gray.pixel(1, 0).unwrap(), 0);
    }
}
