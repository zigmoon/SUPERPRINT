//! Canal alpha : composition et aplatissement.
//!
//! Le noyau n'avait que deux sortes d'images, RVB et gris — donc **pas de
//! transparence**. Un PNG transparent ne pouvait pas entrer, et une opacité
//! posée dans l'interface ne pouvait pas sortir autrement qu'à plat. C'est le
//! manque le plus visible du domaine « image ».
//!
//! ## Non prémultiplié, et pourquoi le dire
//!
//! Les pixels sont stockés **non prémultipliés** (`r, g, b, a` avec `rgb` à sa
//! valeur pleine, indépendante de `a`) : c'est la forme des fichiers PNG et
//! celle qu'attend un `/SMask` de PDF. Le prix est qu'une multiplication est
//! nécessaire à chaque composition ; l'avantage est qu'aucune information n'est
//! perdue par les arrondis répétés.
//!
//! Un pixel **entièrement transparent** (`a = 0`) n'a pas de couleur définie :
//! le produit le traite comme du **noir transparent**, ce que fait la norme
//! PNG. C'est pour cela que la composition calcule sur des flottants et ne
//! divise par `a` qu'après avoir vérifié qu'il n'est pas nul.
//!
//! ## Les modes de fusion
//!
//! [`ModeFusion::Normal`] est le `source-over` de Porter-Duff, avec le canal
//! alpha correct. Les autres modes sont définis sur les **canaux de couleur** et
//! s'appliquent après la composition normale : c'est la convention du CSS et de
//! Fabric. Chacun a une **identité** que les tests vérifient (multiplier sous
//! blanc = rien, écran sous noir = rien), ce qui est la seule façon de savoir
//! qu'un mode est branché dans le bon sens.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « image », canal alpha).

use superprint_core::color::Rgb;

use crate::buffer::{GrayImage, ImageError, RgbImage};

/// Un pixel RVB avec son opacité.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgba {
    /// Rouge.
    pub r: u8,
    /// Vert.
    pub g: u8,
    /// Bleu.
    pub b: u8,
    /// Opacité : 0 transparent, 255 opaque.
    pub a: u8,
}

impl Rgba {
    /// Construit un pixel.
    #[must_use]
    pub const fn new(r: u8, g: u8, b: u8, a: u8) -> Self {
        Self { r, g, b, a }
    }

    /// La couleur, sans l'opacité.
    #[must_use]
    pub const fn rgb(self) -> Rgb {
        Rgb::new(self.r, self.g, self.b)
    }
}

/// Comment un calque se pose sur un fond.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ModeFusion {
    /// Recouvrement simple : le dessus cache le dessous, au prorata de l'alpha.
    Normal,
    /// Multiplier : les deux couleurs sont multipliées. Assombrit toujours.
    Multiplier,
    /// Écran : l'inverse du produit des inverses. Éclaircit toujours.
    Ecran,
    /// Obscurcir : garde la plus sombre des deux, canal par canal.
    Obscurcir,
    /// Éclaircir : garde la plus claire des deux, canal par canal.
    Eclaircir,
    /// Superposer : multiplier sur les couleurs sombres, écran sur les claires.
    Superposer,
}

/// Image RVB avec canal alpha, **non prémultipliée**.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AlphaImage {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

impl AlphaImage {
    /// Nombre d'octets par pixel.
    pub const CHANNELS: usize = 4;

    /// Taille attendue du tampon, en octets.
    #[must_use]
    pub fn expected_len(width: u32, height: u32) -> usize {
        width as usize * height as usize * Self::CHANNELS
    }

    /// Construit une image à partir de ses données — `rgba` entrelacé.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::EmptyDimensions`] si une dimension est nulle,
    /// [`ImageError::BadLength`] si le tampon n'a pas la taille attendue.
    pub fn from_data(width: u32, height: u32, data: Vec<u8>) -> Result<Self, ImageError> {
        if width == 0 || height == 0 {
            return Err(ImageError::EmptyDimensions);
        }
        let attendu = Self::expected_len(width, height);
        if data.len() != attendu {
            return Err(ImageError::BadLength {
                expected: attendu,
                got: data.len(),
            });
        }
        Ok(Self {
            width,
            height,
            data,
        })
    }

    /// Une image uniforme, d'une couleur et d'une opacité données.
    #[must_use]
    pub fn unie(width: u32, height: u32, couleur: Rgba) -> Self {
        let mut data = Vec::with_capacity(Self::expected_len(width, height));
        for _ in 0..width as usize * height as usize {
            data.extend_from_slice(&[couleur.r, couleur.g, couleur.b, couleur.a]);
        }
        Self {
            width,
            height,
            data,
        }
    }

    /// Ajoute l'opacité **opaque** à une image RVB.
    #[must_use]
    pub fn depuis_rgb(src: &RgbImage) -> Self {
        let mut data = Vec::with_capacity(Self::expected_len(src.width(), src.height()));
        for pixel in src.data().chunks_exact(RgbImage::CHANNELS) {
            data.extend_from_slice(&[pixel[0], pixel[1], pixel[2], 255]);
        }
        Self {
            width: src.width(),
            height: src.height(),
            data,
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

    /// Le tampon brut.
    #[must_use]
    pub fn data(&self) -> &[u8] {
        &self.data
    }

    /// Le canal alpha seul — c'est ce qu'un `/SMask` attend.
    #[must_use]
    pub fn masque(&self) -> GrayImage {
        let mut data = Vec::with_capacity(self.width as usize * self.height as usize);
        for pixel in self.data.chunks_exact(Self::CHANNELS) {
            data.push(pixel[3]);
        }
        GrayImage::from_data(self.width, self.height, data)
            .expect("le masque a exactement la taille de son image")
    }

    /// Un pixel.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::OutOfBounds`] si les coordonnées sortent de l'image.
    pub fn pixel(&self, x: u32, y: u32) -> Result<Rgba, ImageError> {
        if x >= self.width || y >= self.height {
            return Err(ImageError::OutOfBounds);
        }
        let i = (y as usize * self.width as usize + x as usize) * Self::CHANNELS;
        Ok(Rgba::new(
            self.data[i],
            self.data[i + 1],
            self.data[i + 2],
            self.data[i + 3],
        ))
    }

    /// La couleur seule, l'opacité **mise à part**.
    #[must_use]
    pub fn vers_rgb(&self) -> RgbImage {
        let mut data = Vec::with_capacity(self.width as usize * self.height as usize * 3);
        for pixel in self.data.chunks_exact(Self::CHANNELS) {
            data.extend_from_slice(&pixel[0..3]);
        }
        RgbImage::from_data(self.width, self.height, data)
            .expect("la couleur a exactement la taille de son image")
    }

    /// Vrai si tous les pixels sont opaques.
    #[must_use]
    pub fn est_opaque(&self) -> bool {
        self.data.chunks_exact(Self::CHANNELS).all(|p| p[3] == 255)
    }

    /// Vrai si un pixel au moins est **entièrement** transparent.
    #[must_use]
    pub fn contient_du_transparent(&self) -> bool {
        self.data.chunks_exact(Self::CHANNELS).any(|p| p[3] < 255)
    }

    /// Aplatit sur un fond opaque : le résultat n'a plus d'alpha.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::DimensionsIncompatibles`] si le fond et l'image n'ont pas
    /// la même taille.
    pub fn aplatir_sur(&self, fond: &RgbImage) -> Result<RgbImage, ImageError> {
        if fond.width() != self.width || fond.height() != self.height {
            return Err(ImageError::DimensionsIncompatibles {
                attendu: (self.width, self.height),
                recu: (fond.width(), fond.height()),
            });
        }
        let mut data = Vec::with_capacity(self.width as usize * self.height as usize * 3);
        for (dessus, dessous) in self
            .data
            .chunks_exact(Self::CHANNELS)
            .zip(fond.data().chunks_exact(RgbImage::CHANNELS))
        {
            let alpha = f64::from(dessus[3]) / 255.0;
            for canal in 0..3 {
                let valeur =
                    f64::from(dessus[canal]) * alpha + f64::from(dessous[canal]) * (1.0 - alpha);
                data.push(valeur.round().clamp(0.0, 255.0) as u8);
            }
        }
        RgbImage::from_data(self.width, self.height, data)
    }

    /// Aplatit sur du blanc — le cas le plus courant : une page.
    ///
    /// # Panics
    ///
    /// Ne peut pas arriver : le fond blanc a exactement la taille de l'image.
    #[must_use]
    pub fn aplatir_sur_blanc(&self) -> RgbImage {
        let blanc = RgbImage::from_data(
            self.width,
            self.height,
            vec![255u8; self.width as usize * self.height as usize * 3],
        )
        .expect("un fond blanc de la bonne taille se construit toujours");
        self.aplatir_sur(&blanc)
            .expect("le fond blanc est à la taille de l'image")
    }
}

/// Applique un mode de fusion à une couleur, canal par canal (0,0–1,0).
fn fusion(mode: ModeFusion, dessous: f64, dessus: f64) -> f64 {
    match mode {
        ModeFusion::Normal => dessus,
        ModeFusion::Multiplier => dessous * dessus,
        ModeFusion::Ecran => 1.0 - (1.0 - dessous) * (1.0 - dessus),
        ModeFusion::Obscurcir => dessous.min(dessus),
        ModeFusion::Eclaircir => dessous.max(dessus),
        ModeFusion::Superposer => {
            /* Superposer : multiplier là où le DESSOUS est sombre, écran là où il
            est clair. Le seuil est la moyenne, et c'est le dessous qui décide —
            inverser les deux est l'erreur classique, d'où l'identité testée :
            sous un fond blanc, superposer ne change rien. */
            if dessous <= 0.5 {
                2.0 * dessous * dessus
            } else {
                1.0 - 2.0 * (1.0 - dessous) * (1.0 - dessus)
            }
        }
    }
}

/// Compose `dessus` sur `dessous`, avec un mode de fusion.
///
/// Le résultat garde le canal alpha : composer deux calques translucides rend un
/// calque translucide, et c'est à l'appelant d'aplatir quand il sait sur quoi.
///
/// # Erreurs
///
/// [`ImageError::DimensionsIncompatibles`] si les deux images n'ont pas la même
/// taille.
pub fn composer(
    fond: &AlphaImage,
    dessus: &AlphaImage,
    mode: ModeFusion,
) -> Result<AlphaImage, ImageError> {
    if fond.width() != dessus.width() || fond.height() != dessus.height() {
        return Err(ImageError::DimensionsIncompatibles {
            attendu: (fond.width(), fond.height()),
            recu: (dessus.width(), dessus.height()),
        });
    }

    let mut data = Vec::with_capacity(fond.data.len());
    for (bas, haut) in fond
        .data
        .chunks_exact(AlphaImage::CHANNELS)
        .zip(dessus.data.chunks_exact(AlphaImage::CHANNELS))
    {
        let a_bas = f64::from(bas[3]) / 255.0;
        let a_haut = f64::from(haut[3]) / 255.0;
        let a_sortie = a_haut + a_bas * (1.0 - a_haut);

        if a_sortie <= 0.0 {
            data.extend_from_slice(&[0, 0, 0, 0]);
            continue;
        }
        for canal in 0..3 {
            let c_bas = f64::from(bas[canal]) / 255.0;
            let c_haut = f64::from(haut[canal]) / 255.0;
            /* La formule de composition, dans l'ordre de la spécification
            (W3C Composite, « source-over » avec mode de fusion) :

              1. la couleur du dessus est **fusionnée** avec celle du dessous,
                 mais seulement là où le dessous est opaque — d'où le
                 `(1 − α_bas)` devant la couleur brute du dessus ;
              2. le tout est prémultiplié par les opacités ;
              3. on redivise par l'opacité de sortie.

            L'ordre est ce qui donne son sens au mode : à α_haut = 0, le
            dessus ne colore rien ; à α_bas = 0, un « multiplier » sur du
            transparent ne produit pas du noir. */
            let melange = (1.0 - a_bas) * c_haut + a_bas * fusion(mode, c_bas, c_haut);
            let premultiplie = a_haut * melange + (1.0 - a_haut) * a_bas * c_bas;
            let sortie = premultiplie / a_sortie;
            data.push((sortie * 255.0).round().clamp(0.0, 255.0) as u8);
        }
        data.push((a_sortie * 255.0).round().clamp(0.0, 255.0) as u8);
    }

    AlphaImage::from_data(fond.width(), fond.height(), data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(pixels: &[[u8; 4]]) -> AlphaImage {
        let mut data = Vec::new();
        for p in pixels {
            data.extend_from_slice(p);
        }
        AlphaImage::from_data(pixels.len() as u32, 1, data).unwrap()
    }

    #[test]
    fn une_taille_incoherente_est_refusee() {
        assert_eq!(
            AlphaImage::from_data(2, 2, vec![0; 15]),
            Err(ImageError::BadLength {
                expected: 16,
                got: 15
            })
        );
        assert_eq!(
            AlphaImage::from_data(0, 4, vec![]),
            Err(ImageError::EmptyDimensions)
        );
    }

    #[test]
    fn l_ajout_d_alpha_rend_le_rvb_intact() {
        let rgb = RgbImage::from_data(2, 1, vec![10, 20, 30, 40, 50, 60]).unwrap();
        let avec = AlphaImage::depuis_rgb(&rgb);
        assert!(avec.est_opaque());
        assert!(!avec.contient_du_transparent());
        assert_eq!(avec.vers_rgb(), rgb);
        assert_eq!(avec.pixel(1, 0).unwrap(), Rgba::new(40, 50, 60, 255));
    }

    #[test]
    fn le_masque_est_le_canal_alpha() {
        let img = image(&[[10, 20, 30, 0], [40, 50, 60, 128], [70, 80, 90, 255]]);
        let masque = img.masque();
        assert_eq!(masque.width(), 3);
        assert_eq!(masque.data(), &[0, 128, 255]);
    }

    #[test]
    fn un_pixel_hors_bornes_est_refuse() {
        let img = image(&[[0, 0, 0, 255]]);
        assert_eq!(img.pixel(1, 0), Err(ImageError::OutOfBounds));
        assert_eq!(img.pixel(0, 1), Err(ImageError::OutOfBounds));
    }

    #[test]
    fn aplati_sur_blanc_un_pixel_transparent_devient_blanc() {
        let img = image(&[[0, 0, 0, 0], [255, 0, 0, 255], [0, 0, 0, 128]]);
        let plat = img.aplatir_sur_blanc();
        assert_eq!(plat.pixel(0, 0).unwrap(), Rgb::new(255, 255, 255));
        assert_eq!(plat.pixel(1, 0).unwrap(), Rgb::new(255, 0, 0));
        /* Un noir à demi transparent sur du blanc est un gris moyen, et le même
        sur les trois canaux : la moitié du noir plus la moitié du blanc. */
        let milieu = plat.pixel(2, 0).unwrap();
        assert_eq!(milieu.r, milieu.g);
        assert_eq!(milieu.g, milieu.b);
        assert!((127..=128).contains(&milieu.r), "{milieu:?}");
    }

    #[test]
    fn aplati_sur_un_fond_de_taille_differente_est_refuse() {
        let img = AlphaImage::unie(2, 2, Rgba::new(0, 0, 0, 128));
        let fond = RgbImage::from_data(3, 3, vec![255; 27]).unwrap();
        assert!(matches!(
            img.aplatir_sur(&fond),
            Err(ImageError::DimensionsIncompatibles { .. })
        ));
    }

    #[test]
    fn une_image_opaque_aplatie_sur_blanc_est_elle_meme() {
        let img = image(&[[10, 20, 30, 255], [40, 50, 60, 255]]);
        assert_eq!(img.aplatir_sur_blanc().data(), &[10, 20, 30, 40, 50, 60]);
    }

    #[test]
    fn l_aplatissement_est_deterministe() {
        let img = image(&[[3, 7, 11, 33], [200, 100, 50, 200]]);
        assert_eq!(img.aplatir_sur_blanc(), img.aplatir_sur_blanc());
    }

    #[test]
    fn composer_en_normal_un_calque_opaque_cache_le_fond() {
        let fond = image(&[[255, 0, 0, 255], [0, 255, 0, 255]]);
        let dessus = image(&[[0, 0, 255, 255], [0, 0, 0, 0]]);
        let melange = composer(&fond, &dessus, ModeFusion::Normal).unwrap();
        assert_eq!(melange.pixel(0, 0).unwrap(), Rgba::new(0, 0, 255, 255));
        /* Un calque transparent ne touche à rien : c'est l'identité. */
        assert_eq!(melange.pixel(1, 0).unwrap(), Rgba::new(0, 255, 0, 255));
    }

    #[test]
    fn composer_en_normal_un_calque_transparent_laisse_tout_passer() {
        let fond = image(&[[10, 20, 30, 255]]);
        let dessus = image(&[[200, 200, 200, 0]]);
        let melange = composer(&fond, &dessus, ModeFusion::Normal).unwrap();
        assert_eq!(melange.pixel(0, 0).unwrap(), Rgba::new(10, 20, 30, 255));
    }

    #[test]
    fn composer_accumule_les_opacites() {
        let fond = image(&[[0, 0, 0, 128]]);
        let dessus = image(&[[0, 0, 0, 128]]);
        let melange = composer(&fond, &dessus, ModeFusion::Normal).unwrap();
        /* Deux couches à 128/255 = 0,50196 : la sortie vaut
        0,50196 + 0,50196 × 0,49804 = 0,75196, soit 191,75 → 192.
        Le calcul se fait en alpha normalisé, pas en octets : c'est ce qui
        rend la composition indépendante du nombre de bits. */
        assert_eq!(melange.pixel(0, 0).unwrap().a, 192);
    }

    #[test]
    fn composer_deux_images_transparentes_donne_du_transparent() {
        let fond = image(&[[0, 0, 0, 0]]);
        let dessus = image(&[[0, 0, 0, 0]]);
        let melange = composer(&fond, &dessus, ModeFusion::Normal).unwrap();
        assert_eq!(melange.pixel(0, 0).unwrap(), Rgba::new(0, 0, 0, 0));
    }

    #[test]
    fn des_tailles_differentes_ne_se_composent_pas() {
        let fond = AlphaImage::unie(2, 2, Rgba::new(0, 0, 0, 255));
        let dessus = AlphaImage::unie(3, 3, Rgba::new(0, 0, 0, 255));
        assert!(matches!(
            composer(&fond, &dessus, ModeFusion::Normal),
            Err(ImageError::DimensionsIncompatibles { .. })
        ));
    }

    /* Les identités des modes : c'est le seul contrôle qui dit qu'un mode est
    branché dans le bon sens. Un mode inversé passe toutes les autres
    vérifications. */
    #[test]
    fn multiplier_sous_du_blanc_ne_change_rien() {
        let fond = image(&[[0, 128, 255, 255]]);
        let dessus = image(&[[255, 255, 255, 255]]);
        let melange = composer(&fond, &dessus, ModeFusion::Multiplier).unwrap();
        assert_eq!(melange.pixel(0, 0).unwrap(), Rgba::new(0, 128, 255, 255));
    }

    #[test]
    fn ecran_sous_du_noir_ne_change_rien() {
        let fond = image(&[[0, 128, 255, 255]]);
        let dessus = image(&[[0, 0, 0, 255]]);
        let melange = composer(&fond, &dessus, ModeFusion::Ecran).unwrap();
        assert_eq!(melange.pixel(0, 0).unwrap(), Rgba::new(0, 128, 255, 255));
    }

    #[test]
    fn multiplier_assombrit_et_ecran_eclaircit() {
        let fond = image(&[[200, 200, 200, 255]]);
        let dessus = image(&[[128, 128, 128, 255]]);
        let sombre = composer(&fond, &dessus, ModeFusion::Multiplier)
            .unwrap()
            .pixel(0, 0)
            .unwrap();
        let clair = composer(&fond, &dessus, ModeFusion::Ecran)
            .unwrap()
            .pixel(0, 0)
            .unwrap();
        assert!(sombre.r < 128, "multiplier doit assombrir : {sombre:?}");
        assert!(clair.r > 200, "écran doit éclaircir : {clair:?}");
    }

    #[test]
    fn obscurcir_et_eclaircir_prennent_le_minimum_et_le_maximum() {
        let fond = image(&[[200, 50, 128, 255]]);
        let dessus = image(&[[100, 150, 128, 255]]);
        let sombre = composer(&fond, &dessus, ModeFusion::Obscurcir)
            .unwrap()
            .pixel(0, 0)
            .unwrap();
        let clair = composer(&fond, &dessus, ModeFusion::Eclaircir)
            .unwrap()
            .pixel(0, 0)
            .unwrap();
        assert_eq!(sombre, Rgba::new(100, 50, 128, 255));
        assert_eq!(clair, Rgba::new(200, 150, 128, 255));
    }

    #[test]
    fn superposer_sous_du_blanc_ne_change_rien_et_sous_du_noir_non_plus() {
        /* Sous un fond blanc ou noir, superposer ne peut rien faire de plus que
        les deux cas extrêmes : c'est le test qui détecte un superposer
        inversé (les deux branches échangées). */
        let dessus = image(&[[200, 200, 200, 255]]);
        for (fond, attendu) in [
            ([255u8, 255, 255, 255], Rgba::new(255, 255, 255, 255)),
            ([0u8, 0, 0, 255], Rgba::new(0, 0, 0, 255)),
        ] {
            let melange = composer(&image(&[fond]), &dessus, ModeFusion::Superposer).unwrap();
            assert_eq!(melange.pixel(0, 0).unwrap(), attendu, "fond {fond:?}");
        }
        /* Et la propriété qui définit superposer : sous un fond **sombre**, le
        résultat ne dépasse pas la couleur du dessus ; sous un fond **clair**,
        il ne descend pas en dessous. */
        let source = image(&[[150, 150, 150, 255]]);
        let sombre = composer(
            &image(&[[64, 64, 64, 255]]),
            &source,
            ModeFusion::Superposer,
        )
        .unwrap()
        .pixel(0, 0)
        .unwrap();
        let clair = composer(
            &image(&[[200, 200, 200, 255]]),
            &source,
            ModeFusion::Superposer,
        )
        .unwrap()
        .pixel(0, 0)
        .unwrap();
        assert!(sombre.r <= 150, "fond sombre : {sombre:?}");
        assert!(clair.r >= 150, "fond clair : {clair:?}");
    }

    #[test]
    fn composer_est_deterministe() {
        let fond = image(&[[200, 30, 40, 180], [10, 10, 10, 255]]);
        let dessus = image(&[[0, 0, 0, 120], [255, 255, 255, 40]]);
        for mode in [
            ModeFusion::Normal,
            ModeFusion::Multiplier,
            ModeFusion::Ecran,
            ModeFusion::Obscurcir,
            ModeFusion::Eclaircir,
            ModeFusion::Superposer,
        ] {
            assert_eq!(
                composer(&fond, &dessus, mode).unwrap(),
                composer(&fond, &dessus, mode).unwrap(),
                "{mode:?}"
            );
        }
    }

    #[test]
    fn composer_puis_aplatir_ne_perd_jamais_l_image() {
        /* Propriété de sûreté : quelle que soit la composition, aplatir donne
        une image de la bonne taille et un résultat stable. */
        let fond = AlphaImage::unie(4, 3, Rgba::new(255, 255, 255, 255));
        let dessus = AlphaImage::unie(4, 3, Rgba::new(0, 0, 0, 90));
        let melange = composer(&fond, &dessus, ModeFusion::Normal).unwrap();
        let plat = melange.aplatir_sur_blanc();
        assert_eq!(plat.width(), 4);
        assert_eq!(plat.height(), 3);
        assert_eq!(plat, melange.aplatir_sur_blanc());
    }
}
