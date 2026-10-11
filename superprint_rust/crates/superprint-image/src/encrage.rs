//! Encrage : taux d'encre, limitation, retrait du gris (GCR).
//!
//! Un imprimeur ne peut pas poser une quantité d'encre illimitée sur un papier :
//! au-delà d'un **taux total** d'encre (TAC, *Total Area Coverage*), le support
//! ne sèche plus, les feuilles se collent, et la mise en register bouge. La
//! limite habituelle est de **300 %** en offset couché, **240 %** en offset
//! non couché, **260 %** en journal. Le noyau ne connaissait pas cette contrainte
//! du tout : il acceptait `C = M = Y = K = 100 %`, soit 400 % d'encre, sans rien
//! dire. C'est le genre de fichier qu'un imprimeur refuse.
//!
//! ## Ce que fait la limitation, et ce qu'elle NE fait pas
//!
//! [`limiter`] ramène le taux total sous la limite en **retirant à parts égales**
//! sur les trois couleurs, puis sur le noir si cela ne suffit pas. Elle ne
//! prétend **pas** conserver la couleur telle qu'elle apparaîtrait sous un
//! profil ICC : le modèle multiplicatif du noyau n'est pas un modèle d'encre.
//! Réduire l'encre *et* tenir la couleur demande le profil du procédé, ce que
//! [`crate::encrage`] ne fait pas. Ce qui est garanti est plus modeste et
//! vérifiable : **la limite est respectée**, et rien ne monte.
//!
//! ## GCR, et pourquoi il ne fait pas semblant d'être colorimétrique
//!
//! Le *grey component removal* retire de l'encre colorée la partie qui fait un
//! gris, et la remet au noir : `C = M = Y = 100 %` (300 % d'encre, et en pratique
//! du brun) devient `K = 100 %` (100 % d'encre, et du noir). La règle est une
//! règle **d'encre** : elle ne garantit pas que la couleur imprimée soit la même,
//! elle garantit qu'on imprime moins. Les tests vérifient exactement cela, et
//! pas autre chose.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « prépresse », encrage).

use crate::buffer::ImageError;

/// Un pixel CMJN à octets, comme la frontière C le transporte.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Cmjn {
    /// Cyan, 0–255.
    pub c: u8,
    /// Magenta, 0–255.
    pub m: u8,
    /// Jaune, 0–255.
    pub y: u8,
    /// Noir, 0–255.
    pub k: u8,
}

impl Cmjn {
    /// Construit un pixel.
    #[must_use]
    pub const fn new(c: u8, m: u8, y: u8, k: u8) -> Self {
        Self { c, m, y, k }
    }

    /// Le taux d'encre total, en **pour cent** : 0 à 400.
    ///
    /// C'est la quantité que l'imprimeur compare à sa limite. Le calcul se fait
    /// en pour cent (et non sur les octets) pour que la valeur affichée soit
    /// celle du métier : 300 %, pas 765.
    #[must_use]
    pub fn taux_encre(self) -> u32 {
        let pourcent = |v: u8| u32::from(v) * 100 / 255;
        pourcent(self.c) + pourcent(self.m) + pourcent(self.y) + pourcent(self.k)
    }

    /// La densité optique approchée d'un canal, `−log10(1 − c)`.
    ///
    /// Encre nulle → densité nulle ; encre pleine → densité plafonnée à
    /// [`DENSITE_MAX`] (une densité infinie n'est pas manipulable).
    #[must_use]
    pub fn densite(canal: u8) -> f64 {
        let transmission = 1.0 - f64::from(canal) / 255.0;
        let transmission = transmission.max(10f64.powf(-DENSITE_MAX));
        -transmission.log10()
    }

    /// La densité totale, somme des quatre canaux.
    #[must_use]
    pub fn densite_totale(self) -> f64 {
        Self::densite(self.c)
            + Self::densite(self.m)
            + Self::densite(self.y)
            + Self::densite(self.k)
    }
}

/// Plafond de densité : 10⁻⁵ de transmission, soit 5.
pub const DENSITE_MAX: f64 = 5.0;

/// Une image CMJN à quatre canaux, entrelacés.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CmjnImage {
    width: u32,
    height: u32,
    data: Vec<u8>,
}

impl CmjnImage {
    /// Nombre d'octets par pixel.
    pub const CHANNELS: usize = 4;

    /// Taille attendue du tampon, en octets.
    #[must_use]
    pub fn expected_len(width: u32, height: u32) -> usize {
        width as usize * height as usize * Self::CHANNELS
    }

    /// Construit une image à partir de ses données.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::EmptyDimensions`] ou [`ImageError::BadLength`].
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

    /// Un pixel.
    ///
    /// # Erreurs
    ///
    /// [`ImageError::OutOfBounds`] si les coordonnées sortent de l'image.
    pub fn pixel(&self, x: u32, y: u32) -> Result<Cmjn, ImageError> {
        if x >= self.width || y >= self.height {
            return Err(ImageError::OutOfBounds);
        }
        let i = (y as usize * self.width as usize + x as usize) * Self::CHANNELS;
        Ok(Cmjn::new(
            self.data[i],
            self.data[i + 1],
            self.data[i + 2],
            self.data[i + 3],
        ))
    }

    /// Le taux d'encre **maximal** de l'image, en pour cent.
    #[must_use]
    pub fn taux_maximal(&self) -> u32 {
        self.data
            .chunks_exact(Self::CHANNELS)
            .map(|p| Cmjn::new(p[0], p[1], p[2], p[3]).taux_encre())
            .max()
            .unwrap_or(0)
    }

    /// Nombre de pixels au-dessus d'un taux donné.
    #[must_use]
    pub fn pixels_au_dessus(&self, limite: u32) -> usize {
        self.data
            .chunks_exact(Self::CHANNELS)
            .filter(|p| Cmjn::new(p[0], p[1], p[2], p[3]).taux_encre() > limite)
            .count()
    }

    /// Applique une transformation à chaque pixel.
    fn transformer(&self, f: impl Fn(Cmjn) -> Cmjn) -> Self {
        let mut data = Vec::with_capacity(self.data.len());
        for p in self.data.chunks_exact(Self::CHANNELS) {
            let sortie = f(Cmjn::new(p[0], p[1], p[2], p[3]));
            data.extend_from_slice(&[sortie.c, sortie.m, sortie.y, sortie.k]);
        }
        Self {
            width: self.width,
            height: self.height,
            data,
        }
    }
}

/// Ramène le taux d'encre sous `limite` (en pour cent).
///
/// Ordre des retraits, et la raison :
///
/// 1. on retire d'abord sur les **trois couleurs, à parts égales** — c'est ce
///    qui préserve le mieux la teinte, puisque la dominante relative ne bouge
///    qu'un peu ;
/// 2. si cela ne suffit pas (le noir est déjà au-dessus de la limite à lui
///    seul), on retire sur le **noir**.
///
/// Un pixel déjà sous la limite est rendu **inchangé**, à l'octet près : c'est
/// indispensable, sinon appliquer deux fois de suite la même limitation
/// dégraderait l'image petit à petit.
#[must_use]
pub fn limiter(src: &CmjnImage, limite: u32) -> CmjnImage {
    let limite = limite.min(400);
    /* Le travail se fait en POUR CENT, comme le métier compte, et non en
    octets. Les conversions sont explicites ici pour qu'on ne puisse pas les
    confondre : `pourcent` est un plancher, `de_pourcent` arrondit au plus
    proche — donc aucune des deux ne fait monter une valeur. */
    let pourcent = |v: u8| u32::from(v) * 100 / 255;
    let de_pourcent = |p: u32| ((p.min(100) * 255 + 50) / 100) as u8;

    src.transformer(|p| {
        let taux = p.taux_encre();
        if taux <= limite {
            return p;
        }
        let exces = taux - limite;

        /* 1. On retire sur les trois couleurs, à parts égales. */
        let disponible_sur_couleurs = pourcent(p.c) + pourcent(p.m) + pourcent(p.y);
        let retire_sur_couleurs = exces.min(disponible_sur_couleurs);
        let par_canal = retire_sur_couleurs / 3;
        let baisse = |canal: u8| de_pourcent(pourcent(canal).saturating_sub(par_canal));
        let mut sortie = Cmjn::new(baisse(p.c), baisse(p.m), baisse(p.y), p.k);

        /* 2. Ce que les couleurs n'ont pas pu absorber va au noir. */
        let reste = exces.saturating_sub(par_canal * 3);
        if reste > 0 {
            sortie.k = de_pourcent(pourcent(sortie.k).saturating_sub(reste));
        }

        /* 3. Filet de sécurité. `pourcent` étant un plancher et `de_pourcent` un
        arrondi, un pixel peut rester un cran au-dessus. Une limite qu'on
        dépasse « à cause des arrondis » n'est pas une limite : on finit le
        travail canal par canal, noir d'abord. */
        let mut garde = 0;
        while sortie.taux_encre() > limite && garde < 2048 {
            if sortie.k > 0 {
                sortie.k -= 1;
            } else if sortie.c > 0 {
                sortie.c -= 1;
            } else if sortie.m > 0 {
                sortie.m -= 1;
            } else if sortie.y > 0 {
                sortie.y -= 1;
            } else {
                break;
            }
            garde += 1;
        }
        sortie
    })
}

/// Retire la composante grise des trois couleurs et la remet au noir.
///
/// `taux` va de 0,0 (rien) à 1,0 (retrait complet de `min(C, M, Y)`).
#[must_use]
pub fn gcr(src: &CmjnImage, taux: f64) -> CmjnImage {
    let taux = if taux.is_finite() {
        taux.clamp(0.0, 1.0)
    } else {
        0.0
    };
    if taux == 0.0 {
        return src.clone();
    }
    src.transformer(|p| {
        let minimum = p.c.min(p.m).min(p.y);
        let retire = (f64::from(minimum) * taux).round().clamp(0.0, 255.0) as u8;
        let baisse = |canal: u8| canal.saturating_sub(retire);
        Cmjn::new(
            baisse(p.c),
            baisse(p.m),
            baisse(p.y),
            p.k.saturating_add(retire),
        )
    })
}

/// Retire la composante grise **et** limite le taux d'encre, dans cet ordre.
///
/// L'ordre compte : le GCR ajoute du noir, donc il peut faire dépasser la limite
/// alors que le pixel était dessous. Limiter après GCR garantit la limite.
#[must_use]
pub fn gcr_puis_limiter(src: &CmjnImage, taux: f64, limite: u32) -> CmjnImage {
    limiter(&gcr(src, taux), limite)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn image(pixels: &[[u8; 4]]) -> CmjnImage {
        let mut data = Vec::new();
        for p in pixels {
            data.extend_from_slice(p);
        }
        CmjnImage::from_data(pixels.len() as u32, 1, data).unwrap()
    }

    #[test]
    fn le_taux_d_encre_se_compte_en_pour_cent() {
        assert_eq!(Cmjn::new(0, 0, 0, 0).taux_encre(), 0);
        assert_eq!(Cmjn::new(255, 0, 0, 0).taux_encre(), 100);
        assert_eq!(Cmjn::new(255, 255, 255, 255).taux_encre(), 400);
        /* Le cas qui fait refuser un fichier : CMJ pleins, pas de noir. */
        assert_eq!(Cmjn::new(255, 255, 255, 0).taux_encre(), 300);
        /* 50 % sur chaque canal. */
        assert_eq!(Cmjn::new(128, 128, 128, 128).taux_encre(), 200);
    }

    #[test]
    fn la_densite_croit_avec_l_encre() {
        assert_eq!(Cmjn::densite(0), 0.0);
        assert!(Cmjn::densite(128) > 0.0);
        assert!(Cmjn::densite(255) > Cmjn::densite(128));
        assert!(Cmjn::densite(255) <= DENSITE_MAX);
        assert!(
            Cmjn::new(255, 255, 255, 255).densite_totale() > Cmjn::new(0, 0, 0, 0).densite_totale()
        );
    }

    #[test]
    fn une_image_sous_la_limite_n_est_pas_touchee_a_l_octet_pres() {
        /* Indispensable : sans cette exacteté, appliquer la limitation deux fois
        dégraderait l'image à chaque passage. */
        let src = image(&[[10, 20, 30, 40], [100, 100, 100, 0], [0, 0, 0, 255]]);
        for entree in &[[10u8, 20, 30, 40], [100, 100, 100, 0], [0, 0, 0, 255]] {
            assert!(Cmjn::new(entree[0], entree[1], entree[2], entree[3]).taux_encre() <= 300);
        }
        assert_eq!(limiter(&src, 300), src);
    }

    #[test]
    fn la_limite_est_respectee() {
        let src = image(&[
            [255, 255, 255, 255],
            [255, 255, 255, 0],
            [200, 180, 160, 255],
            [0, 0, 0, 255],
            [128, 128, 128, 128],
        ]);
        for limite in [100u32, 150, 200, 240, 260, 300] {
            let sortie = limiter(&src, limite);
            assert!(
                sortie.taux_maximal() <= limite,
                "limite {limite} : taux obtenu {}",
                sortie.taux_maximal()
            );
            assert_eq!(sortie.pixels_au_dessus(limite), 0);
        }
    }

    #[test]
    fn la_limitation_ne_remonte_jamais_un_canal() {
        let src = image(&[[255, 255, 255, 255], [200, 180, 160, 255]]);
        let sortie = limiter(&src, 200);
        for (avant, apres) in src
            .data()
            .chunks_exact(4)
            .zip(sortie.data().chunks_exact(4))
        {
            for canal in 0..4 {
                assert!(apres[canal] <= avant[canal], "canal {canal}");
            }
        }
    }

    #[test]
    fn la_limitation_est_idempotente() {
        /* Appliquer deux fois la même limite ne doit pas continuer à dégrader :
        c'est le signe qu'une limite est bien une limite. */
        let src = image(&[[255, 255, 255, 255], [250, 240, 230, 200]]);
        let une = limiter(&src, 240);
        let deux = limiter(&une, 240);
        assert_eq!(une, deux);
    }

    #[test]
    fn une_limite_absurde_est_ramenee_a_400() {
        let src = image(&[[255, 255, 255, 255]]);
        assert_eq!(limiter(&src, 10_000).taux_maximal(), 400);
    }

    #[test]
    fn la_limitation_preserve_les_dimensions() {
        let src = CmjnImage::from_data(2, 2, vec![255; 16]).unwrap();
        let sortie = limiter(&src, 250);
        assert_eq!((sortie.width(), sortie.height()), (2, 2));
        assert_eq!(sortie.data().len(), 16);
    }

    #[test]
    fn la_limitation_est_deterministe() {
        let src = image(&[[255, 255, 255, 255], [200, 100, 50, 255]]);
        assert_eq!(limiter(&src, 220), limiter(&src, 220));
    }

    #[test]
    fn le_gcr_a_taux_nul_ne_change_rien() {
        let src = image(&[[255, 255, 255, 0], [10, 20, 30, 40]]);
        assert_eq!(gcr(&src, 0.0), src);
        assert_eq!(gcr(&src, f64::NAN), src);
    }

    #[test]
    fn le_gcr_transform_le_triplet_neutre_en_noir() {
        /* C = M = Y = 100 % : 300 % d'encre pour du noir. Après un GCR complet,
        il reste K = 100 % : 100 % d'encre, et du noir. */
        let src = image(&[[255, 255, 255, 0]]);
        let sortie = gcr(&src, 1.0);
        let p = sortie.pixel(0, 0).unwrap();
        assert_eq!(p, Cmjn::new(0, 0, 0, 255));
        assert_eq!(p.taux_encre(), 100);
    }

    #[test]
    fn le_gcr_retire_sur_les_trois_couleurs_et_ajoute_au_noir() {
        let src = image(&[[200, 150, 100, 10]]);
        let sortie = gcr(&src, 0.5);
        let p = sortie.pixel(0, 0).unwrap();
        /* min = 100 → retiré 50. */
        assert_eq!(p, Cmjn::new(150, 100, 50, 60));
    }

    #[test]
    fn le_gcr_ne_descend_jamais_sous_zero_et_ne_depasse_jamais_255() {
        let src = image(&[[255, 255, 255, 255], [0, 0, 0, 0], [1, 2, 3, 255]]);
        let sortie = gcr(&src, 1.0);
        assert_eq!(sortie.data().len(), 12);
        assert!(sortie.data().chunks_exact(4).all(|p| p.len() == 4));
        /* Le noir ne peut pas dépasser 255 : le pixel déjà à K = 255 avec du
        gris garde K = 255 (le retrait sur les couleurs reste, lui). */
        let p = sortie.pixel(0, 0).unwrap();
        assert_eq!(p.k, 255);
        assert_eq!((p.c, p.m, p.y), (0, 0, 0));
    }

    #[test]
    fn le_gcr_ne_fait_pas_monter_le_taux_d_encre() {
        let src = image(&[[255, 255, 255, 255], [200, 180, 160, 100]]);
        for taux in [0.25, 0.5, 1.0] {
            let sortie = gcr(&src, taux);
            for (avant, apres) in src
                .data()
                .chunks_exact(4)
                .zip(sortie.data().chunks_exact(4))
            {
                let a = Cmjn::new(avant[0], avant[1], avant[2], avant[3]).taux_encre();
                let b = Cmjn::new(apres[0], apres[1], apres[2], apres[3]).taux_encre();
                assert!(b <= a, "taux {taux} : {a} % → {b} %");
            }
        }
    }

    #[test]
    fn le_gcr_ne_touche_pas_un_pixel_sans_composante_grise() {
        /* Un pixel où une seule couleur travaille n'a rien de gris à retirer. */
        let src = image(&[[200, 0, 0, 50], [0, 180, 0, 0], [0, 0, 160, 0]]);
        let sortie = gcr(&src, 1.0);
        assert_eq!(
            sortie.data(),
            &[200u8, 0, 0, 50, 0, 180, 0, 0, 0, 0, 160, 0]
        );
    }

    #[test]
    fn le_gcr_puis_la_limite_tient_les_deux_promesses() {
        let src = CmjnImage::from_data(1, 1, vec![255, 255, 255, 255]).unwrap();
        let sortie = gcr_puis_limiter(&src, 1.0, 240);
        assert!(sortie.taux_maximal() <= 240);
        let p = sortie.pixel(0, 0).unwrap();
        assert_eq!(p.k, 255, "le GCR doit avoir mis du noir");
    }

    #[test]
    fn un_pixel_hors_bornes_est_refuse() {
        let src = image(&[[0, 0, 0, 0]]);
        assert_eq!(src.pixel(1, 0), Err(ImageError::OutOfBounds));
    }

    #[test]
    fn un_tampon_de_taille_fausse_est_refuse() {
        assert!(matches!(
            CmjnImage::from_data(2, 2, vec![0; 15]),
            Err(ImageError::BadLength { .. })
        ));
        assert!(matches!(
            CmjnImage::from_data(0, 2, vec![]),
            Err(ImageError::EmptyDimensions)
        ));
    }
}
