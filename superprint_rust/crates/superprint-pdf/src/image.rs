//! **Image XObject** : embarquer une image dans un PDF, réduite et compressée.
//!
//! C'est la réponse directe au défaut constaté dans le rapport de test interne
//! (non publié, conservé hors du dépôt) : le PDF de 131 Mo. La cause n'est pas
//! le PDF lui-même mais ce qu'on y met — des images **à leur résolution
//! d'origine** et **non compressées**. Un seul cliché de 24 Mpx en RVB brut pèse
//! 72 Mo ; deux suffisent à faire exploser le fichier.
//!
//! Ce module produit le dictionnaire d'un objet image PDF
//! (`/Subtype /Image`) et son flux, en s'appuyant sur [`superprint_image`] :
//!
//! 1. l'appelant **réduit** d'abord l'image (`downscale_bilinear`,
//!    `target_size_for_dpi`) ;
//! 2. puis l'encode ici avec [`ImageFilter::Auto`] — qui ne retient le filtre
//!    `/RunLengthDecode` que s'il **rétrécit** réellement les données.
//!
//! ## Portée honnête de la compression
//!
//! *RunLength* est un codage **sans perte** qui excelle sur les **aplats**
//! (fond uni, logo, image de synthèse) et **ne gagne rien sur une photo**. Pour
//! les photographies, la parade reste la **réduction** — le levier le plus
//! efficace, et de loin — puis, à terme, `/FlateDecode` et `/DCTDecode` (voir
//! `docs/PLAN.md`, module n° 4). Ce module ne ment pas sur ce point : il expose
//! [`ImageXObject::raw_len`] et [`ImageXObject::encoded_len`] pour que
//! l'appelant mesure au lieu de supposer.

use crate::object;
use superprint_compress::compresser_zlib;
use superprint_image::{run_length_encode, CmjnImage, GrayImage, RgbImage};

/// Espace couleur d'une image XObject.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageColorSpace {
    /// Trois octets par pixel (rouge, vert, bleu).
    DeviceRgb,
    /// Un octet par pixel (luminance).
    DeviceGray,
    /// Quatre octets par pixel (cyan, magenta, jaune, noir).
    ///
    /// Cet espace n'est pas une commodité : c'est une **obligation** en PDF/X.
    /// PDF/X-1a et X-3 interdisent le RVB dans le flux, et le contrôle de
    /// [`crate::document::Document::write`] refuse d'ailleurs de revendiquer
    /// une telle conformité en présence d'une image RVB. Une planche CMJN doit
    /// donc voyager en `DeviceCMYK`, pas en RVB « qu'on convertit plus tard ».
    DeviceCmyk,
}

impl ImageColorSpace {
    /// Nom PDF de l'espace couleur.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::DeviceRgb => "DeviceRGB",
            Self::DeviceGray => "DeviceGray",
            Self::DeviceCmyk => "DeviceCMYK",
        }
    }

    /// Nombre de composantes par pixel.
    #[must_use]
    pub fn channels(self) -> usize {
        match self {
            Self::DeviceRgb => 3,
            Self::DeviceGray => 1,
            Self::DeviceCmyk => 4,
        }
    }
}

impl std::fmt::Display for ImageColorSpace {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.name())
    }
}

/// Filtre appliqué au flux de l'image.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ImageFilter {
    /// Aucun filtre : les octets sont écrits tels quels.
    None,
    /// Filtre PDF `/RunLengthDecode`, appliqué d'office.
    RunLengthDecode,
    /// Filtre PDF `/FlateDecode` (zlib/DEFLATE), appliqué d'office.
    ///
    /// C'est le filtre des PDF d'impression réels : il gagne sur tout ce qui
    /// n'est pas un aplat, c'est-à-dire sur presque tout.
    FlateDecode,
    /// Le **plus petit** des trois, calculé pour de bon : RunLength, Flate,
    /// ou aucun filtre. C'est le réglage recommandé : il garantit qu'un PDF
    /// n'est **jamais** plus gros que les pixels qu'il contient.
    Auto,
}

impl ImageFilter {
    /// Nom PDF du filtre, ou `None` si le flux n'est pas filtré.
    #[must_use]
    pub fn name(self) -> Option<&'static str> {
        match self {
            Self::None | Self::Auto => None,
            Self::RunLengthDecode => Some("RunLengthDecode"),
            Self::FlateDecode => Some("FlateDecode"),
        }
    }
}

impl std::fmt::Display for ImageFilter {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(match self {
            // `Auto` n'est pas un filtre : c'est une politique de choix. S'il
            // apparaît ici, c'est que l'image a été construite avec un autre
            // filtre — on l'annonce donc comme « aucun ».
            Self::None | Self::Auto => "aucun",
            Self::RunLengthDecode => "RunLengthDecode",
            Self::FlateDecode => "FlateDecode",
        })
    }
}

/// Une image prête à être écrite comme objet XObject d'un PDF.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ImageXObject {
    width: u32,
    height: u32,
    color_space: ImageColorSpace,
    filter: ImageFilter,
    data: Vec<u8>,
    raw_len: usize,
}

impl ImageXObject {
    /// Prépare une image **RVB** (8 bits par composante).
    #[must_use]
    pub fn from_rgb(image: &RgbImage, filter: ImageFilter) -> Self {
        Self::new(
            image.width(),
            image.height(),
            ImageColorSpace::DeviceRgb,
            image.data(),
            filter,
        )
    }

    /// Prépare une image en **niveaux de gris** (8 bits par pixel).
    ///
    /// Une planche en noir et blanc n'a aucune raison de voyager en RVB : passer
    /// de 3 octets à 1 octet par pixel divise le poids **par trois**, sans
    /// aucune perte.
    #[must_use]
    pub fn from_gray(image: &GrayImage, filter: ImageFilter) -> Self {
        Self::new(
            image.width(),
            image.height(),
            ImageColorSpace::DeviceGray,
            image.data(),
            filter,
        )
    }

    /// Prépare une image **CMJN** (8 bits par composante).
    ///
    /// C'est l'espace des planches d'impression : quatre octets par pixel, et
    /// aucune conversion implicite à l'ouverture. La conversion RVB → CMJN se
    /// fait **avant**, par l'appelant, et c'est là qu'elle doit se faire — le
    /// noyau en a une version vérifiée au bit près contre celle du produit
    /// (`superprint_core::color::convertir`).
    #[must_use]
    pub fn from_cmyk(image: &CmjnImage, filter: ImageFilter) -> Self {
        Self::new(
            image.width(),
            image.height(),
            ImageColorSpace::DeviceCmyk,
            image.data(),
            filter,
        )
    }

    fn new(
        width: u32,
        height: u32,
        color_space: ImageColorSpace,
        raw: &[u8],
        filter: ImageFilter,
    ) -> Self {
        let raw_len = raw.len();
        let (data, filter) = match filter {
            ImageFilter::None => (raw.to_vec(), ImageFilter::None),
            ImageFilter::RunLengthDecode => (run_length_encode(raw), ImageFilter::RunLengthDecode),
            ImageFilter::FlateDecode => (compresser_zlib(raw), ImageFilter::FlateDecode),
            ImageFilter::Auto => {
                // On encode pour de bon les deux candidats et on garde le plus
                // petit. Les deux sont sans perte, donc le choix n'a aucune
                // conséquence sur l'image — seulement sur le poids du fichier.
                let par_longueurs = run_length_encode(raw);
                let par_flate = compresser_zlib(raw);
                let meilleur = par_longueurs.len().min(par_flate.len()).min(raw_len);
                if meilleur == raw_len {
                    (raw.to_vec(), ImageFilter::None)
                } else if par_flate.len() <= par_longueurs.len() {
                    (par_flate, ImageFilter::FlateDecode)
                } else {
                    (par_longueurs, ImageFilter::RunLengthDecode)
                }
            }
        };

        Self {
            width,
            height,
            color_space,
            filter,
            data,
            raw_len,
        }
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

    /// Espace couleur retenu.
    #[must_use]
    pub fn color_space(&self) -> ImageColorSpace {
        self.color_space
    }

    /// Filtre **effectivement** appliqué (peut différer de celui demandé si
    /// [`ImageFilter::Auto`] a jugé le filtre non rentable).
    #[must_use]
    pub fn filter(&self) -> ImageFilter {
        self.filter
    }

    /// Le flux encodé, tel qu'il sera écrit dans le fichier.
    #[must_use]
    pub fn data(&self) -> &[u8] {
        &self.data
    }

    /// Taille des pixels bruts, en octets.
    #[must_use]
    pub fn raw_len(&self) -> usize {
        self.raw_len
    }

    /// Taille du flux écrit, en octets.
    #[must_use]
    pub fn encoded_len(&self) -> usize {
        self.data.len()
    }

    /// Les entrées du dictionnaire de l'objet image, **sans** `/Length`.
    ///
    /// Renvoyées nues (et non enveloppées dans `<< >>`) pour que l'écrivain de
    /// document puisse les compléter par la longueur réelle du flux qu'il écrit.
    #[must_use]
    pub fn dict_entries(&self) -> String {
        let mut entries = vec![
            ("Type", object::name("XObject")),
            ("Subtype", object::name("Image")),
            ("Width", object::integer(i64::from(self.width))),
            ("Height", object::integer(i64::from(self.height))),
            ("ColorSpace", object::name(self.color_space.name())),
            ("BitsPerComponent", object::integer(8)),
        ];
        // pdf-lib et les RIP tolèrent l'absence de `/Filter`, pas un filtre vide.
        if let Some(filter) = self.filter.name() {
            entries.push(("Filter", object::name(filter)));
        }
        let dict = object::dict(&entries);
        // On retire les délimiteurs pour ne garder que les entrées.
        dict.trim_start_matches("<<")
            .trim_end_matches(">>")
            .trim()
            .to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un aplat uni : le pire cas pour la taille, le meilleur pour RunLength.
    fn aplat(width: u32, height: u32) -> RgbImage {
        let mut data = Vec::with_capacity(RgbImage::expected_len(width, height));
        for _ in 0..(width as usize * height as usize) {
            data.extend_from_slice(&[255, 255, 255]);
        }
        RgbImage::from_data(width, height, data).expect("aplat cohérent")
    }

    #[test]
    fn aplat_est_fortement_compresse() {
        let image = aplat(64, 64);
        let xobject = ImageXObject::from_rgb(&image, ImageFilter::Auto);

        // Sur un aplat, **Flate bat RunLength** : une seule correspondance y
        // décrit 258 octets, là où RunLength consomme 2 octets par tranche de
        // 128. Le choix automatique prend donc Flate — c'est une amélioration,
        // pas un changement gratuit.
        assert_eq!(xobject.filter(), ImageFilter::FlateDecode);
        assert_eq!(xobject.raw_len(), 64 * 64 * 3);
        // RunLength donnerait 2 octets par tranche de 128 ; Flate fait mieux.
        let par_longueurs = (64 * 64 * 3) / 128 * 2;
        assert!(
            xobject.encoded_len() < par_longueurs,
            "Flate devrait battre RunLength ({}) : {}",
            par_longueurs,
            xobject.encoded_len()
        );
        assert!(
            xobject.encoded_len() * 50 < xobject.raw_len(),
            "aplat peu compressé : {} octets",
            xobject.encoded_len()
        );
    }

    #[test]
    fn bruit_n_est_jamais_grossi_par_auto() {
        // Suite pseudo-aléatoire : RunLength ne gagne rien, donc `Auto` renonce.
        let mut seed = 0x1234_5678u32;
        let mut data = Vec::with_capacity(64 * 64 * 3);
        for _ in 0..(64 * 64 * 3) {
            seed = seed.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
            data.push((seed >> 24) as u8);
        }
        let image = RgbImage::from_data(64, 64, data).expect("bruit cohérent");
        let xobject = ImageXObject::from_rgb(&image, ImageFilter::Auto);

        assert_eq!(
            xobject.filter(),
            ImageFilter::None,
            "filtre non rentable gardé"
        );
        assert_eq!(xobject.encoded_len(), xobject.raw_len());
    }

    #[test]
    fn filtre_impose_est_respecte() {
        let image = aplat(4, 4);
        let none = ImageXObject::from_rgb(&image, ImageFilter::None);
        assert_eq!(none.filter(), ImageFilter::None);
        assert_eq!(none.encoded_len(), none.raw_len());

        // Un filtre imposé est un filtre qu'on ne discute pas, même si un autre
        // ferait mieux : RunLength donne ici 2 octets par tranche de 128.
        let forced = ImageXObject::from_rgb(&image, ImageFilter::RunLengthDecode);
        assert_eq!(forced.filter(), ImageFilter::RunLengthDecode);
        assert!(forced.encoded_len() < forced.raw_len());

        let flate = ImageXObject::from_rgb(&image, ImageFilter::FlateDecode);
        assert_eq!(flate.filter(), ImageFilter::FlateDecode);
        assert!(flate.encoded_len() < flate.raw_len());
        // ⚠️ Sur une **très petite** image, RunLength gagne : le flux zlib
        // traîne 2 octets d'en-tête et 4 octets de somme de contrôle, quand un
        // aplat de 48 octets tient en un seul run de 2 octets. C'est
        // précisément pourquoi `Auto` compare les deux au lieu de trancher.
        assert!(
            forced.encoded_len() < flate.encoded_len(),
            "sur 4 × 4, RunLength ({}) doit battre Flate ({})",
            forced.encoded_len(),
            flate.encoded_len()
        );

        // Sur une image de taille réelle, c'est l'inverse — et largement.
        let grand = aplat(64, 64);
        let flate_grand = ImageXObject::from_rgb(&grand, ImageFilter::FlateDecode);
        let longueurs_grand = ImageXObject::from_rgb(&grand, ImageFilter::RunLengthDecode);
        assert!(
            flate_grand.encoded_len() < longueurs_grand.encoded_len(),
            "sur 64 × 64, Flate ({}) doit battre RunLength ({})",
            flate_grand.encoded_len(),
            longueurs_grand.encoded_len()
        );
    }

    #[test]
    fn gris_divise_le_poids_par_trois() {
        let rgb = aplat(8, 8);
        let gray = rgb.to_gray();
        let xobject = ImageXObject::from_gray(&gray, ImageFilter::None);

        assert_eq!(xobject.color_space(), ImageColorSpace::DeviceGray);
        assert_eq!(xobject.raw_len(), 8 * 8);
        assert_eq!(xobject.raw_len() * 3, rgb.data().len());
    }

    #[test]
    fn dictionnaire_conforme() {
        let xobject = ImageXObject::from_rgb(&aplat(2, 2), ImageFilter::Auto);
        let entries = xobject.dict_entries();

        assert!(entries.starts_with("/Type /XObject"), "entrées : {entries}");
        assert!(entries.contains("/Subtype /Image"));
        assert!(entries.contains("/Width 2"));
        assert!(entries.contains("/Height 2"));
        assert!(entries.contains("/ColorSpace /DeviceRGB"));
        assert!(entries.contains("/BitsPerComponent 8"));
        assert!(entries.contains("/Filter /RunLengthDecode"));
        assert!(
            !entries.contains("/Length"),
            "la longueur est écrite par le document"
        );
        assert!(!entries.contains("<<"), "entrées nues attendues");
    }
}
