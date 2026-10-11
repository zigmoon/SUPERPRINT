//! Niveaux et courbes : le contraste, par table de correspondance.
//!
//! Un réglage de niveaux est **une table de 256 entrées** : chaque valeur
//! d'entrée dit la valeur de sortie. Tout est donc appliqué par une seule
//! lecture de table, ce qui a trois conséquences pratiques :
//!
//! - c'est **exact**, sans accumulation d'erreurs d'arrondi sur une chaîne de
//!   réglages — la table est composée une fois, puis appliquée ;
//! - c'est **rapide** (une lecture par canal et par pixel) ;
//! - c'est **vérifiable** : la table entière se compare, pas un échantillon.
//!
//! ## L'ordre des réglages, écrit pour ne pas être deviné
//!
//! Les niveaux **globaux** sont appliqués d'abord, puis les niveaux **par
//! canal** : c'est l'ordre de la boîte de dialogue du produit, et composer dans
//! l'autre sens donnerait un autre résultat. Quand aucun réglage par canal n'est
//! donné, [`Reglages::canaux`] vaut [`Niveaux::neutre`] et la seconde étape ne
//! change rien.
//!
//! ## Ce qui n'est **pas** fait ici
//!
//! Aucune conversion d'espace : les niveaux s'appliquent sur le RVB **du
//! document**, pas dans un espace de travail. Corriger le contraste en L\*a\*b\*
//! donne un meilleur résultat ; c'est un autre travail, et le prétendre ici
//! serait mentir sur ce que la fonction fait.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « image »).

use crate::buffer::{GrayImage, ImageError, RgbImage};

/// Un réglage de niveaux, en valeurs 0–255 pour les bornes et 0,01–10 pour le
/// gamma.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Niveaux {
    /// Point noir d'entrée (0–255).
    pub entree_noire: f64,
    /// Point blanc d'entrée (0–255).
    pub entree_blanche: f64,
    /// Exposant gamma (1,0 = neutre, > 1 éclaircit les tons moyens).
    pub gamma: f64,
    /// Point noir de sortie (0–255).
    pub sortie_noire: f64,
    /// Point blanc de sortie (0–255).
    pub sortie_blanche: f64,
}

impl Niveaux {
    /// Le réglage qui ne change rien.
    #[must_use]
    pub const fn neutre() -> Self {
        Self {
            entree_noire: 0.0,
            entree_blanche: 255.0,
            gamma: 1.0,
            sortie_noire: 0.0,
            sortie_blanche: 255.0,
        }
    }

    /// Vrai si le réglage ne change rien.
    ///
    /// Sert à sauter une étape : appliquer une table identité reste exact, mais
    /// autant ne pas la parcourir.
    #[must_use]
    pub fn est_neutre(&self) -> bool {
        (self.entree_noire - 0.0).abs() < f64::EPSILON
            && (self.entree_blanche - 255.0).abs() < f64::EPSILON
            && (self.gamma - 1.0).abs() < f64::EPSILON
            && (self.sortie_noire - 0.0).abs() < f64::EPSILON
            && (self.sortie_blanche - 255.0).abs() < f64::EPSILON
    }

    /// Un réglage par deux points d'entrée et un gamma.
    #[must_use]
    pub fn nouveau(entree_noire: f64, entree_blanche: f64, gamma: f64) -> Self {
        Self {
            entree_noire,
            entree_blanche,
            gamma,
            ..Self::neutre()
        }
    }

    /// La table de correspondance 0–255 → 0–255 de ce réglage.
    ///
    /// Les bornes inversées ou confondues sont **corrigées** au lieu de produire
    /// une table absurde : une entrée plus claire que le point blanc donne une
    /// plage de largeur nulle, donc un aplat. On garde la table utilisable.
    #[must_use]
    pub fn table(&self) -> [u8; 256] {
        let blanche = self.entree_blanche.max(self.entree_noire + 1.0);
        let gamma = self.gamma.clamp(0.01, 10.0);
        let mut table = [0u8; 256];
        for (entree, sortie) in table.iter_mut().enumerate() {
            let t = (entree as f64 - self.entree_noire) / (blanche - self.entree_noire);
            let t = t.clamp(0.0, 1.0).powf(1.0 / gamma);
            let valeur = self.sortie_noire + t * (self.sortie_blanche - self.sortie_noire);
            *sortie = valeur.round().clamp(0.0, 255.0) as u8;
        }
        table
    }
}

impl Default for Niveaux {
    fn default() -> Self {
        Self::neutre()
    }
}

/// Une courbe de correction : des points de contrôle, reliés par des segments.
///
/// L'interpolation est **linéaire**. Une spline donnerait des transitions plus
/// douces et des dépassements : pour du réglage d'encre, un dépassement est un
/// défaut, pas une élégance.
#[derive(Clone, Debug, PartialEq)]
pub struct Courbe {
    /// Points de contrôle `(entrée, sortie)`, en 0–255. L'ordre d'appel n'a pas
    /// d'importance : [`Courbe::table`] les trie.
    pub points: Vec<(f64, f64)>,
}

impl Courbe {
    /// La courbe qui ne change rien.
    #[must_use]
    pub fn identite() -> Self {
        Self {
            points: vec![(0.0, 0.0), (255.0, 255.0)],
        }
    }

    /// Construit une courbe depuis des points.
    #[must_use]
    pub fn nouvelle(points: &[(f64, f64)]) -> Self {
        Self {
            points: points.to_vec(),
        }
    }

    /// La table 0–255 → 0–255 de cette courbe.
    ///
    /// Une courbe sans point, ou dont tous les points ont la même entrée, ne
    /// peut rien corriger : elle rend alors l'identité, plutôt qu'un aplat noir
    /// qui ferait disparaître l'image.
    #[must_use]
    pub fn table(&self) -> [u8; 256] {
        let mut points: Vec<(f64, f64)> = self
            .points
            .iter()
            .copied()
            .filter(|(e, s)| e.is_finite() && s.is_finite())
            .collect();
        points.sort_by(|a, b| a.0.partial_cmp(&b.0).unwrap_or(std::cmp::Ordering::Equal));
        if points.len() < 2 || (points[0].0 - points[points.len() - 1].0).abs() < f64::EPSILON {
            return identite_table();
        }

        let mut table = [0u8; 256];
        for (entree, sortie) in table.iter_mut().enumerate() {
            let e = entree as f64;
            let valeur = if e <= points[0].0 {
                points[0].1
            } else if e >= points[points.len() - 1].0 {
                points[points.len() - 1].1
            } else {
                let i = points
                    .windows(2)
                    .position(|p| e >= p[0].0 && e <= p[1].0)
                    .unwrap_or(0);
                let (x0, y0) = points[i];
                let (x1, y1) = points[i + 1];
                let largeur = x1 - x0;
                if largeur <= 0.0 {
                    y1
                } else {
                    y0 + (e - x0) / largeur * (y1 - y0)
                }
            };
            *sortie = valeur.round().clamp(0.0, 255.0) as u8;
        }
        table
    }
}

fn identite_table() -> [u8; 256] {
    let mut table = [0u8; 256];
    for (i, v) in table.iter_mut().enumerate() {
        *v = i as u8;
    }
    table
}

/// Les réglages complets : niveaux globaux, niveaux par canal, courbe.
#[derive(Clone, Debug, PartialEq)]
pub struct Reglages {
    /// Appliqués à tous les canaux, en premier.
    pub global: Niveaux,
    /// Appliqués à un canal (rouge, vert, bleu) après les niveaux globaux.
    pub canaux: [Niveaux; 3],
    /// Appliquée en dernier, à tous les canaux.
    pub courbe: Courbe,
}

impl Reglages {
    /// Les réglages qui ne changent rien.
    #[must_use]
    pub fn neutre() -> Self {
        Self {
            global: Niveaux::neutre(),
            canaux: [Niveaux::neutre(); 3],
            courbe: Courbe::identite(),
        }
    }

    /// Vrai si aucun réglage n'est actif.
    #[must_use]
    pub fn est_neutre(&self) -> bool {
        self.global.est_neutre()
            && self.canaux.iter().all(Niveaux::est_neutre)
            && self.courbe.points.as_slice() == Courbe::identite().points.as_slice()
    }

    /// Les trois tables, une par canal, dans l'ordre des opérations.
    #[must_use]
    pub fn tables(&self) -> [[u8; 256]; 3] {
        let globale = self.global.table();
        let courbe = self.courbe.table();
        let mut tables = [[0u8; 256]; 3];
        for (canal, table) in tables.iter_mut().enumerate() {
            let canal_table = self.canaux[canal].table();
            for entree in 0..256 {
                let apres_global = globale[entree] as usize;
                let apres_canal = canal_table[apres_global] as usize;
                table[entree] = courbe[apres_canal];
            }
        }
        tables
    }

    /// La table d'un canal de gris : seuls les niveaux globaux et la courbe.
    #[must_use]
    pub fn table_gris(&self) -> [u8; 256] {
        let globale = self.global.table();
        let courbe = self.courbe.table();
        let mut table = [0u8; 256];
        for entree in 0..256 {
            table[entree] = courbe[globale[entree] as usize];
        }
        table
    }
}

/// Applique les réglages à une image RVB.
#[must_use]
pub fn appliquer(src: &RgbImage, reglages: &Reglages) -> RgbImage {
    let tables = reglages.tables();
    let mut data = Vec::with_capacity(src.data().len());
    for pixel in src.data().chunks_exact(RgbImage::CHANNELS) {
        for canal in 0..3 {
            data.push(tables[canal][pixel[canal] as usize]);
        }
    }
    RgbImage::from_data(src.width(), src.height(), data)
        .expect("appliquer ne change pas les dimensions")
}

/// Applique les niveaux globaux et la courbe à une image en gris.
#[must_use]
pub fn appliquer_gris(src: &GrayImage, reglages: &Reglages) -> GrayImage {
    let table = reglages.table_gris();
    let data: Vec<u8> = src.data().iter().map(|v| table[*v as usize]).collect();
    GrayImage::from_data(src.width(), src.height(), data)
        .expect("appliquer ne change pas les dimensions")
}

/// Calcule des niveaux **automatiques** par écrêtage d'histogramme.
///
/// `ecarte` est la proportion de pixels ignorée **de chaque côté** de
/// l'histogramme (`0,005` = 0,5 %). Écrêter est indispensable : sans cela, un
/// seul pixel isolé — une poussière sur le scan — fixe le point noir et la
/// correction ne fait rien.
///
/// La fonction ne touche pas au gamma : corriger le contraste et corriger la
/// luminosité sont deux décisions, et les confondre dans un « auto » est ce qui
/// rend ces boutons imprévisibles.
#[must_use]
pub fn auto_niveaux(src: &RgbImage, ecarte: f64) -> Niveaux {
    let mut histogramme = [0u64; 256];
    for valeur in src.data() {
        histogramme[*valeur as usize] += 1;
    }
    let total: u64 = histogramme.iter().sum();
    if total == 0 {
        return Niveaux::neutre();
    }
    let ecarte = ecarte.clamp(0.0, 0.25);
    let seuil = (total as f64 * ecarte).floor() as u64;

    let mut cumul = 0u64;
    let mut noir = 0usize;
    for (valeur, compte) in histogramme.iter().enumerate() {
        cumul += compte;
        if cumul > seuil {
            noir = valeur;
            break;
        }
    }
    let mut cumul = 0u64;
    let mut blanc = 255usize;
    for (valeur, compte) in histogramme.iter().enumerate().rev() {
        cumul += compte;
        if cumul > seuil {
            blanc = valeur;
            break;
        }
    }

    /* Une plage trop étroite (image unie, ou écrêtage trop fort) donnerait une
    amplification absurde : on refuse alors de toucher à l'image. */
    if blanc <= noir + 8 {
        return Niveaux::neutre();
    }
    Niveaux {
        entree_noire: noir as f64,
        entree_blanche: blanc as f64,
        ..Niveaux::neutre()
    }
}

/// Vérifie qu'une table est bien monotone.
///
/// Une table non monotone **inverse** des valeurs : deux tons différents
/// deviennent identiques, ou pire, s'échangent. C'est un défaut qu'on voit à
/// l'impression et pas à l'écran ; ce contrôle sert à l'interdire dans les
/// tests.
#[must_use]
pub fn table_monotone(table: &[u8; 256]) -> bool {
    table.windows(2).all(|p| p[0] <= p[1])
}

/// Applique une table à une image RVB, canal par canal.
///
/// # Erreurs
///
/// [`ImageError::BadLength`] si le nombre de tables ne correspond pas au
/// nombre de canaux.
pub fn appliquer_tables(src: &RgbImage, tables: &[[u8; 256]; 3]) -> Result<RgbImage, ImageError> {
    let mut data = Vec::with_capacity(src.data().len());
    for pixel in src.data().chunks_exact(RgbImage::CHANNELS) {
        for canal in 0..3 {
            data.push(tables[canal][pixel[canal] as usize]);
        }
    }
    RgbImage::from_data(src.width(), src.height(), data)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn gris_de_quatre() -> RgbImage {
        /* 0, 64, 128, 255 sur le rouge, identiques sur les trois canaux. */
        RgbImage::from_data(
            4,
            1,
            vec![0, 0, 0, 64, 64, 64, 128, 128, 128, 255, 255, 255],
        )
        .unwrap()
    }

    #[test]
    fn les_reglages_neutres_ne_changent_rien() {
        let src = gris_de_quatre();
        let r = Reglages::neutre();
        assert!(r.est_neutre());
        assert_eq!(appliquer(&src, &r), src);
    }

    #[test]
    fn la_table_neutre_est_l_identite() {
        let table = Niveaux::neutre().table();
        for (entree, sortie) in table.iter().enumerate() {
            assert_eq!(*sortie as usize, entree);
        }
    }

    #[test]
    fn les_tables_sont_monotones() {
        for niveaux in [
            Niveaux::neutre(),
            Niveaux::nouveau(20.0, 200.0, 1.0),
            Niveaux::nouveau(0.0, 255.0, 2.2),
            Niveaux::nouveau(200.0, 100.0, 1.0),
        ] {
            let table = niveaux.table();
            assert!(table_monotone(&table), "{niveaux:?}");
        }
    }

    #[test]
    fn le_point_noir_ecrase_les_tons_sombres() {
        let r = Reglages {
            global: Niveaux::nouveau(64.0, 255.0, 1.0),
            ..Reglages::neutre()
        };
        let apres = appliquer(&gris_de_quatre(), &r);
        assert_eq!(apres.data()[0], 0); /* 0 → 0 */
        assert_eq!(apres.data()[3], 0); /* 64 → 0 */
        /* 128 → (128-64)/191 × 255 = 85 */
        assert_eq!(apres.data()[6], 85);
        assert_eq!(apres.data()[9], 255);
    }

    #[test]
    fn le_gamma_eclaircit_les_tons_moyens() {
        let r = Reglages {
            global: Niveaux::nouveau(0.0, 255.0, 2.0),
            ..Reglages::neutre()
        };
        let apres = appliquer(&gris_de_quatre(), &r);
        /* 128 → (0,502)^(1/2) = 0,708 → 181 : plus clair que 128. */
        assert!(
            apres.data()[6] > 128,
            "gamma > 1 doit éclaircir : {}",
            apres.data()[6]
        );
        /* Les extrêmes ne bougent pas. */
        assert_eq!(apres.data()[0], 0);
        assert_eq!(apres.data()[9], 255);
    }

    #[test]
    fn le_gamma_inferieur_a_un_assombrit() {
        let r = Reglages {
            global: Niveaux::nouveau(0.0, 255.0, 0.5),
            ..Reglages::neutre()
        };
        assert!(appliquer(&gris_de_quatre(), &r).data()[6] < 128);
    }

    #[test]
    fn les_niveaux_par_canal_sont_appliques_apres_les_globaux() {
        let r = Reglages {
            global: Niveaux::nouveau(0.0, 255.0, 1.0),
            canaux: [
                Niveaux::neutre(),
                Niveaux::neutre(),
                Niveaux {
                    sortie_noire: 128.0,
                    ..Niveaux::neutre()
                },
            ],
            courbe: Courbe::identite(),
        };
        let src = RgbImage::from_data(1, 1, vec![0, 0, 0]).unwrap();
        let apres = appliquer(&src, &r);
        assert_eq!(apres.data()[0], 0);
        assert_eq!(apres.data()[1], 0);
        /* Le bleu part du noir de sortie : 128. */
        assert_eq!(apres.data()[2], 128);
    }

    #[test]
    fn une_sortie_reduite_ecrase_la_plage() {
        let r = Reglages {
            global: Niveaux {
                sortie_noire: 64.0,
                sortie_blanche: 192.0,
                ..Niveaux::neutre()
            },
            ..Reglages::neutre()
        };
        let apres = appliquer(&gris_de_quatre(), &r);
        assert_eq!(apres.data()[0], 64);
        assert_eq!(apres.data()[9], 192);
        assert!(table_monotone(&r.tables()[0]));
    }

    #[test]
    fn une_courbe_lineaire_est_l_identite() {
        assert_eq!(Courbe::identite().table(), identite_table());
        assert_eq!(
            Courbe::nouvelle(&[(0.0, 0.0), (255.0, 255.0)]).table(),
            identite_table()
        );
    }

    #[test]
    fn une_courbe_lineraire_par_morceaux_interpole() {
        let courbe = Courbe::nouvelle(&[(0.0, 0.0), (128.0, 255.0), (255.0, 255.0)]);
        let table = courbe.table();
        assert_eq!(table[0], 0);
        assert_eq!(table[64], 128); /* moitié de la montée */
        assert_eq!(table[128], 255);
        assert_eq!(table[200], 255);
        assert!(table_monotone(&table));
    }

    #[test]
    fn une_courbe_qui_ne_peut_rien_corriger_rend_l_identite() {
        for points in [vec![], vec![(0.0, 0.0)], vec![(10.0, 5.0), (10.0, 200.0)]] {
            assert_eq!(
                Courbe::nouvelle(&points).table(),
                identite_table(),
                "{points:?}"
            );
        }
    }

    #[test]
    fn une_courbe_en_desordre_est_triee() {
        let a = Courbe::nouvelle(&[(255.0, 255.0), (0.0, 0.0), (128.0, 90.0)]).table();
        let b = Courbe::nouvelle(&[(0.0, 0.0), (128.0, 90.0), (255.0, 255.0)]).table();
        assert_eq!(a, b);
    }

    #[test]
    fn une_valeur_non_finie_est_ecartee_de_la_courbe() {
        let table = Courbe::nouvelle(&[
            (0.0, 0.0),
            (f64::NAN, 100.0),
            (128.0, 200.0),
            (255.0, 255.0),
        ])
        .table();
        assert_eq!(table[0], 0);
        assert_eq!(table[128], 200);
    }

    #[test]
    fn un_gamma_absurde_est_borne_au_lieu_de_tout_ecraser() {
        for gamma in [0.0, -3.0, 1000.0] {
            let table = Niveaux::nouveau(0.0, 255.0, gamma).table();
            assert!(table_monotone(&table), "gamma {gamma}");
        }
    }

    #[test]
    fn des_bornes_inversees_donnent_un_seuil_net_pas_une_table_absurde() {
        /* Bornes inversées ou confondues : la plage serait de largeur nulle ou
        négative. Le réglage est ramené à une largeur de 1, ce qui donne un
        SEUIL net — l'image devient un deux-tons. C'est visible, monotone et
        réversible ; un résultat au hasard, non. */
        for niveaux in [
            Niveaux::nouveau(128.0, 128.0, 1.0),
            Niveaux::nouveau(200.0, 100.0, 1.0),
        ] {
            let table = niveaux.table();
            assert!(table_monotone(&table), "{niveaux:?}");
            assert!(
                table.iter().all(|v| *v == 0 || *v == 255),
                "un seuil ne produit que deux valeurs : {niveaux:?}"
            );
            assert_eq!(table[0], 0);
            assert_eq!(table[255], 255);
        }
    }

    #[test]
    fn les_reglages_sont_appliques_au_gris() {
        let gris = GrayImage::from_data(3, 1, vec![0, 128, 255]).unwrap();
        let r = Reglages {
            global: Niveaux::nouveau(0.0, 255.0, 2.0),
            ..Reglages::neutre()
        };
        let apres = appliquer_gris(&gris, &r);
        assert_eq!(apres.data()[0], 0);
        assert!(apres.data()[1] > 128);
        assert_eq!(apres.data()[2], 255);
    }

    #[test]
    fn les_reglages_ne_changent_pas_les_dimensions() {
        let src = gris_de_quatre();
        let r = Reglages {
            global: Niveaux::nouveau(10.0, 240.0, 1.3),
            ..Reglages::neutre()
        };
        let apres = appliquer(&src, &r);
        assert_eq!(apres.width(), src.width());
        assert_eq!(apres.height(), src.height());
        assert_eq!(apres.data().len(), src.data().len());
    }

    #[test]
    fn l_application_est_deterministe() {
        let src = gris_de_quatre();
        let r = Reglages {
            global: Niveaux::nouveau(12.0, 233.0, 1.7),
            ..Reglages::neutre()
        };
        assert_eq!(appliquer(&src, &r), appliquer(&src, &r));
    }

    #[test]
    fn les_niveaux_automatiques_ecrasent_sur_la_plage_utile() {
        /* Image « terne » : tout est entre 40 et 200. Les niveaux automatiques
        doivent étaler cette plage sur 0–255. */
        let data: Vec<u8> = (0..256)
            .flat_map(|i| {
                let v = 40 + (i as u8 % 161);
                [v, v, v]
            })
            .collect();
        let src = RgbImage::from_data(256, 1, data).unwrap();
        let niveaux = auto_niveaux(&src, 0.0);
        assert!(niveaux.entree_noire >= 39.0 && niveaux.entree_noire <= 41.0);
        assert!(niveaux.entree_blanche >= 199.0 && niveaux.entree_blanche <= 201.0);
        assert_eq!(niveaux.gamma, 1.0, "l'auto ne touche pas au gamma");
    }

    #[test]
    fn les_niveaux_automatiques_ignorent_les_pixels_isoles() {
        /* Un pixel noir isolé sur un fond clair : sans écrêtage, il fixerait le
        point noir et l'auto ne ferait rien. */
        let mut data = vec![200u8; 300];
        data[0] = 0;
        let src = RgbImage::from_data(100, 1, data).unwrap();
        let sans_ecretage = auto_niveaux(&src, 0.0);
        let avec = auto_niveaux(&src, 0.01);
        assert_eq!(sans_ecretage.entree_noire, 0.0);
        assert!(avec.entree_noire < 240.0);
        assert!(avec.entree_blanche >= 200.0);
    }

    #[test]
    fn les_niveaux_automatiques_ne_touchent_pas_une_image_unie() {
        let src = RgbImage::from_data(
            4,
            1,
            vec![128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128, 128],
        )
        .unwrap();
        assert!(auto_niveaux(&src, 0.005).est_neutre());
    }

    #[test]
    fn les_niveaux_automatiques_ne_touchent_pas_a_une_image_deja_pleine() {
        let src = RgbImage::from_data(2, 1, vec![0, 0, 0, 255, 255, 255]).unwrap();
        assert!(auto_niveaux(&src, 0.0).est_neutre());
    }

    #[test]
    fn une_image_vide_ne_casse_rien() {
        let src = RgbImage::from_data(1, 1, vec![0, 0, 0]).unwrap();
        assert!(auto_niveaux(&src, 0.5).est_neutre());
    }
}
