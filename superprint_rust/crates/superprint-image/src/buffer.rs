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
    /// Deux images de tailles différentes là où elles doivent coïncider.
    ///
    /// C'est le cas de la composition : fusionner un calque et un fond de
    /// tailles différentes n'a pas de sens, et le faire « au plus petit »
    /// produirait une image rognée en silence.
    DimensionsIncompatibles {
        /// `(largeur, hauteur)` attendues.
        attendu: (u32, u32),
        /// `(largeur, hauteur)` reçues.
        recu: (u32, u32),
    },
    /// Le rectangle demandé ne recouvre aucun pixel de l'image.
    ///
    /// Le recadrage **rogne** le rectangle sur les bords de l'image (une
    /// sélection qui dépasse ne fabrique jamais de pixel), mais si le rectangle
    /// est entièrement dehors, il n'y a rien à rendre — et rendre une image vide
    /// serait pire que refuser.
    RecadrageHorsImage {
        /// Rectangle demandé : `(x, y, largeur, hauteur)`.
        demande: (i64, i64, u32, u32),
        /// Dimensions de l'image qui l'a refusé.
        image: (u32, u32),
    },
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
            Self::DimensionsIncompatibles { attendu, recu } => write!(
                f,
                "images de tailles différentes : {}×{} attendu, {}×{} reçu",
                attendu.0, attendu.1, recu.0, recu.1
            ),
            Self::RecadrageHorsImage { demande, image } => write!(
                f,
                "rectangle {}+{} {}×{} hors de l'image {}×{}",
                demande.0, demande.1, demande.2, demande.3, image.0, image.1
            ),
        }
    }
}

impl std::error::Error for ImageError {}

/// Rogne un rectangle `(x, y, largeur, hauteur)` sur une image `(largeur,
/// hauteur)`, et rend les bornes `(x0, y0, x1, y1)` en coordonnées de pixels
/// (bornes supérieures **exclues**).
///
/// Le rectangle peut commencer à gauche ou au-dessus de l'image (`x` ou `y`
/// négatifs) : c'est le cas d'une sélection tirée vers l'extérieur. Elle est
/// **rognée**, jamais complétée — un recadrage ne fabrique pas de pixel.
fn rogner(
    x: i64,
    y: i64,
    largeur: u32,
    hauteur: u32,
    image: (u32, u32),
) -> Result<(usize, usize, usize, usize), ImageError> {
    let x1 = x
        .saturating_add(i64::from(largeur))
        .clamp(0, i64::from(image.0));
    let y1 = y
        .saturating_add(i64::from(hauteur))
        .clamp(0, i64::from(image.1));
    let x0 = x.clamp(0, i64::from(image.0));
    let y0 = y.clamp(0, i64::from(image.1));
    if x0 >= x1 || y0 >= y1 {
        return Err(ImageError::RecadrageHorsImage {
            demande: (x, y, largeur, hauteur),
            image,
        });
    }
    Ok((x0 as usize, y0 as usize, x1 as usize, y1 as usize))
}

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

    /// Extrait un rectangle de l'image — le calcul du recadrage.
    ///
    /// Le produit recadre en dessinant avec `drawImage` sur un canevas, la
    /// sélection étant bornée par les poignées de l'interface. Le calcul, lui,
    /// tient en une copie de lignes : c'est ce qui est porté ici.
    ///
    /// La sélection est **rognée** aux bords de l'image ; un recadrage ne
    /// fabrique jamais de pixel.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::RecadrageHorsImage`] si le rectangle ne recouvre aucun
    /// pixel — plutôt que de rendre une image vide.
    pub fn recadrer(&self, x: i64, y: i64, largeur: u32, hauteur: u32) -> Result<Self, ImageError> {
        let (x0, y0, x1, y1) = rogner(x, y, largeur, hauteur, (self.width, self.height))?;
        let largeur = x1 - x0;
        let lignes = y1 - y0;
        let mut data = Vec::with_capacity(largeur * lignes * Self::CHANNELS);
        for ligne in y0..y1 {
            let debut = (ligne * self.width as usize + x0) * Self::CHANNELS;
            data.extend_from_slice(&self.data[debut..debut + largeur * Self::CHANNELS]);
        }
        Ok(Self {
            width: largeur as u32,
            height: lignes as u32,
            data,
        })
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

    /// Extrait un rectangle de l'image. Mêmes règles que
    /// [`RgbImage::recadrer`] : sélection rognée aux bords, refus si le
    /// rectangle ne recouvre aucun pixel.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::RecadrageHorsImage`] si le rectangle ne recouvre aucun
    /// pixel.
    pub fn recadrer(&self, x: i64, y: i64, largeur: u32, hauteur: u32) -> Result<Self, ImageError> {
        let (x0, y0, x1, y1) = rogner(x, y, largeur, hauteur, (self.width, self.height))?;
        let largeur = x1 - x0;
        let lignes = y1 - y0;
        let mut data = Vec::with_capacity(largeur * lignes);
        for ligne in y0..y1 {
            let debut = ligne * self.width as usize + x0;
            data.extend_from_slice(&self.data[debut..debut + largeur]);
        }
        Ok(Self {
            width: largeur as u32,
            height: lignes as u32,
            data,
        })
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

    /// Une image 4×3 dont chaque pixel vaut `10*y + x` : le recadrage doit
    /// rendre exactement la sous-matrice attendue, sans décalage de ligne.
    fn damier() -> RgbImage {
        let mut data = Vec::new();
        for y in 0..3u32 {
            for x in 0..4u32 {
                let v = (10 * y + x) as u8;
                data.extend_from_slice(&[v, v, v]);
            }
        }
        RgbImage::from_data(4, 3, data).unwrap()
    }

    #[test]
    fn recadrage_au_centre() {
        let img = damier();
        let c = img.recadrer(1, 1, 2, 2).unwrap();
        assert_eq!((c.width(), c.height()), (2, 2));
        assert_eq!(c.data(), &[11, 11, 11, 12, 12, 12, 21, 21, 21, 22, 22, 22]);
    }

    #[test]
    fn recadrage_du_coin() {
        let img = damier();
        let c = img.recadrer(0, 0, 1, 1).unwrap();
        assert_eq!(c.data(), &[0, 0, 0]);
        // Et le coin opposé, pour vérifier que la dernière ligne est bien prise.
        let c = img.recadrer(3, 2, 1, 1).unwrap();
        assert_eq!(c.data(), &[23, 23, 23]);
    }

    #[test]
    fn recadrage_debordant_est_rogne() {
        let img = damier();
        // Sélection tirée vers l'extérieur : elle est rognée, pas complétée.
        let c = img.recadrer(-2, -2, 4, 4).unwrap();
        assert_eq!((c.width(), c.height()), (2, 2));
        assert_eq!(c.data(), &[0, 0, 0, 1, 1, 1, 10, 10, 10, 11, 11, 11]);
        // Dépassement à droite et en bas : on garde ce qui est dedans.
        let c = img.recadrer(2, 2, 100, 100).unwrap();
        assert_eq!((c.width(), c.height()), (2, 1));
        assert_eq!(c.data(), &[22, 22, 22, 23, 23, 23]);
    }

    #[test]
    fn recadrage_entierement_dehors_refuse() {
        let img = damier();
        for (x, y, l, h) in [(4, 0, 2, 2), (0, 3, 2, 2), (-5, 0, 3, 2), (0, -5, 2, 3)] {
            assert!(
                matches!(
                    img.recadrer(x, y, l, h),
                    Err(ImageError::RecadrageHorsImage { .. })
                ),
                "le rectangle {x},{y} {l}×{h} doit être refusé"
            );
        }
    }

    #[test]
    fn recadrage_paysage_et_portrait() {
        let img = damier();
        // Une ligne entière : le sens des données ne doit pas s'inverser.
        let c = img.recadrer(0, 1, 4, 1).unwrap();
        assert_eq!(c.data().len(), 12);
        assert_eq!(&c.data()[0..3], &[10, 10, 10]);
        assert_eq!(&c.data()[9..12], &[13, 13, 13]);
        // Une colonne entière.
        let c = img.recadrer(2, 0, 1, 3).unwrap();
        assert_eq!((c.width(), c.height()), (1, 3));
        assert_eq!(c.data(), &[2, 2, 2, 12, 12, 12, 22, 22, 22]);
    }

    #[test]
    fn recadrage_gris_et_identite() {
        let img = damier().to_gray();
        let c = img.recadrer(1, 0, 2, 1).unwrap();
        assert_eq!(c.data(), &[1, 2]);
        // Recadrer sur toute l'image ne change rien.
        let tout = img.recadrer(0, 0, 4, 3).unwrap();
        assert_eq!(tout, img);
    }
}
