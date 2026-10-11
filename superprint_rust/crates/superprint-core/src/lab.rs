//! Colorimétrie : XYZ, L\*a\*b\* et écarts de couleur.
//!
//! La conversion **naïve** RVB ↔ CMJN de [`crate::color`] suffit pour un aplat
//! d'écran, pas pour **comparer** deux teintes : deux couleurs très différentes
//! en CMJN peuvent être presque identiques à l'œil, et l'inverse. Comparer
//! demande un espace **perceptuellement** à peu près uniforme — c'est le rôle de
//! L\*a\*b\* — et une distance qui suive l'œil — c'est le rôle de ΔE.
//!
//! ## Conventions, écrites noir sur blanc
//!
//! - **RVB** : sRGB (IEC 61966-2-1), donc blanc **D65** ;
//! - **XYZ / L\*a\*b\*** : observateur CIE 1931 2°, blanc choisi par l'appelant
//!   ([`BLANC_D65`] ou [`BLANC_D50`], ce dernier étant celui de l'impression) ;
//! - **ΔE\*ab** ([`delta_e76`]) : la distance euclidienne, simple mais qui
//!   surestime les écarts dans les saturations ;
//! - **ΔE00** ([`delta_e2000`]) : la formule CIEDE2000, celle qu'utilisent les
//!   imprimeurs. Elle est plus longue mais ne se trompe pas sur les bleus.
//!
//! Feuille de route : `docs/PORTAGE.md` (module nuanciers, profil ICC).

use crate::color::Rgb;

/// Point blanc de référence, en XYZ.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Xyz {
    /// Composante X.
    pub x: f64,
    /// Composante Y (la luminance).
    pub y: f64,
    /// Composante Z.
    pub z: f64,
}

/// Couleur en L\*a\*b\*.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Lab {
    /// Clarté, 0 (noir) à 100 (blanc).
    pub l: f64,
    /// Axe vert (−) → rouge (+).
    pub a: f64,
    /// Axe bleu (−) → jaune (+).
    pub b: f64,
}

/// Blanc normalisé D65 (écran, sRGB).
pub const BLANC_D65: Xyz = Xyz {
    x: 0.950_47,
    y: 1.0,
    z: 1.088_83,
};

/// Blanc normalisé D50 (impression, ISO 13655).
pub const BLANC_D50: Xyz = Xyz {
    x: 0.964_22,
    y: 1.0,
    z: 0.825_21,
};

/// Éclairement sRGB : composante 0–255 → linéaire 0–1 (IEC 61966-2-1).
#[must_use]
pub fn srgb_vers_lineaire(octet: u8) -> f64 {
    let v = f64::from(octet) / 255.0;
    if v <= 0.040_45 {
        v / 12.92
    } else {
        ((v + 0.055) / 1.055).powf(2.4)
    }
}

impl From<Rgb> for Xyz {
    /// sRGB (D65) → XYZ, matrice de la IEC 61966-2-1.
    fn from(rgb: Rgb) -> Self {
        let r = srgb_vers_lineaire(rgb.r);
        let g = srgb_vers_lineaire(rgb.g);
        let b = srgb_vers_lineaire(rgb.b);
        Self {
            x: 0.412_456_4 * r + 0.357_576_1 * g + 0.180_437_5 * b,
            y: 0.212_672_9 * r + 0.715_152_2 * g + 0.072_175_0 * b,
            z: 0.019_333_9 * r + 0.119_192_0 * g + 0.950_304_1 * b,
        }
    }
}

/// `δ` de la loi L\*a\*b\*, `6/29` (norme CIE 15).
const DELTA: f64 = 6.0 / 29.0;

/// `3δ²` — le coefficient de la branche **linéaire**, dans les deux sens.
///
/// Écrit une seule fois : la version fausse de cette constante est de la
/// **diviser** là où il faut **multiplier**, ce qui ne se voit que sur les tons
/// très sombres (le blanc et le noir passaient, le noir à 1/255 échouait).
const TROIS_DELTA_CARRE: f64 = 3.0 * DELTA * DELTA;

/// Seuil de bascule linéaire/cubique : `δ³`, soit `216/24389`.
const SEUIL_LAB: f64 = DELTA * DELTA * DELTA;

impl Xyz {
    /// XYZ → L\*a\*b\*, pour un blanc de référence donné.
    #[must_use]
    pub fn lab(self, blanc: Xyz) -> Lab {
        fn f(t: f64) -> f64 {
            if t > SEUIL_LAB {
                t.cbrt()
            } else {
                t / TROIS_DELTA_CARRE + 4.0 / 29.0
            }
        }
        let fx = f(self.x / blanc.x);
        let fy = f(self.y / blanc.y);
        let fz = f(self.z / blanc.z);
        Lab {
            l: 116.0 * fy - 16.0,
            a: 500.0 * (fx - fy),
            b: 200.0 * (fy - fz),
        }
    }
}

impl Lab {
    /// L\*a\*b\* → XYZ, pour un blanc de référence donné.
    #[must_use]
    pub fn xyz(self, blanc: Xyz) -> Xyz {
        let fy = (self.l + 16.0) / 116.0;
        let fx = fy + self.a / 500.0;
        let fz = fy - self.b / 200.0;
        fn f_inverse(t: f64) -> f64 {
            let t3 = t * t * t;
            if t3 > SEUIL_LAB {
                t3
            } else {
                (t - 4.0 / 29.0) * TROIS_DELTA_CARRE
            }
        }
        Xyz {
            x: blanc.x * f_inverse(fx),
            y: blanc.y * f_inverse(fy),
            z: blanc.z * f_inverse(fz),
        }
    }

    /// Chroma : la distance à l'axe des gris, `√(a² + b²)`.
    #[must_use]
    pub fn chroma(self) -> f64 {
        self.a.hypot(self.b)
    }
}

impl From<Rgb> for Lab {
    /// Raccourci : sRGB → L\*a\*b\* **D65**.
    ///
    /// D65, et pas D50 : le sRGB est défini sous D65. Le convertir avec le blanc
    /// D50 **sans adaptation chromatique** ne donnerait pas un blanc neutre —
    /// `(255, 255, 255)` tomberait à `L* = 99,45` avec `b* = −19`, c'est-à-dire
    /// un blanc franchement bleuté. Pour passer en D50 sans se tromper, il faut
    /// [`Xyz::vers_d50`].
    fn from(rgb: Rgb) -> Self {
        Xyz::from(rgb).lab(BLANC_D65)
    }
}

/* ─────────────── adaptation chromatique (Bradford) ───────────────
Matrice de réponse des cônes de Bradford, publiée par Lam (1985) ; c'est
celle qu'utilisent les profils ICC pour passer d'un blanc à l'autre.       */

const BRADFORD: [[f64; 3]; 3] = [
    [0.895_1, 0.266_4, -0.161_4],
    [-0.750_2, 1.713_5, 0.036_7],
    [0.038_9, -0.068_5, 1.029_6],
];

const BRADFORD_INVERSE: [[f64; 3]; 3] = [
    [0.986_992_9, -0.147_054_3, 0.159_962_7],
    [0.432_305_3, 0.518_360_3, 0.049_291_2],
    [-0.008_528_7, 0.040_042_8, 0.968_486_7],
];

fn applique(m: [[f64; 3]; 3], v: [f64; 3]) -> [f64; 3] {
    [
        m[0][0] * v[0] + m[0][1] * v[1] + m[0][2] * v[2],
        m[1][0] * v[0] + m[1][1] * v[1] + m[1][2] * v[2],
        m[2][0] * v[0] + m[2][1] * v[1] + m[2][2] * v[2],
    ]
}

/// Matrice d'adaptation chromatique de Bradford, du blanc `source` au blanc `cible`.
///
/// Elle est **construite** à partir des deux blancs et non recopiée : une
/// matrice recopiée se trompe en silence, alors que celle-ci se vérifie —
/// appliquée au blanc source, elle doit rendre le blanc cible au bit près
/// (c'est ce que teste `bradford_amene_le_blanc_source_sur_le_blanc_cible`).
#[must_use]
pub fn bradford(source: Xyz, cible: Xyz) -> [[f64; 3]; 3] {
    let s = applique(BRADFORD, [source.x, source.y, source.z]);
    let c = applique(BRADFORD, [cible.x, cible.y, cible.z]);
    let d = [c[0] / s[0], c[1] / s[1], c[2] / s[2]];
    let mut m = [[0.0f64; 3]; 3];
    for i in 0..3 {
        for j in 0..3 {
            m[i][j] = BRADFORD_INVERSE[i][0] * d[0] * BRADFORD[0][j]
                + BRADFORD_INVERSE[i][1] * d[1] * BRADFORD[1][j]
                + BRADFORD_INVERSE[i][2] * d[2] * BRADFORD[2][j];
        }
    }
    m
}

impl Xyz {
    /// Applique une matrice 3×3.
    #[must_use]
    pub fn applique_matrice(self, m: [[f64; 3]; 3]) -> Self {
        let v = applique(m, [self.x, self.y, self.z]);
        Self {
            x: v[0],
            y: v[1],
            z: v[2],
        }
    }

    /// Le même XYZ, adapté au blanc **D50** de l'impression (Bradford).
    #[must_use]
    pub fn vers_d50(self) -> Self {
        self.applique_matrice(bradford(BLANC_D65, BLANC_D50))
    }

    /// Le même XYZ, adapté au blanc **D65** de l'écran (Bradford).
    #[must_use]
    pub fn vers_d65(self) -> Self {
        self.applique_matrice(bradford(BLANC_D50, BLANC_D65))
    }

    /// L\*a\*b\* sous le blanc **D50**, en adaptant d'abord depuis D65.
    ///
    /// C'est la conversion à utiliser pour comparer une couleur d'écran à une
    /// couleur d'imprimé.
    #[must_use]
    pub fn lab_d50_depuis_srgb(rgb: Rgb) -> Lab {
        Self::from(rgb).vers_d50().lab(BLANC_D50)
    }
}

/// Écart CIELAB de 1976 : distance euclidienne en L\*a\*b\*.
#[must_use]
pub fn delta_e76(a: Lab, b: Lab) -> f64 {
    ((a.l - b.l).powi(2) + (a.a - b.a).powi(2) + (a.b - b.b).powi(2)).sqrt()
}

/// Écart CIEDE2000 (ΔE00), avec les facteurs `kL = kC = kH = 1`.
///
/// C'est la formule de référence pour les arts graphiques : elle corrige les
/// trois défauts de ΔE\*ab — la surestimation des écarts de chroma dans les
/// bleus, la sous-estimation autour du gris, et l'absence de la teinte.
#[must_use]
#[allow(clippy::similar_names)]
pub fn delta_e2000(a: Lab, b: Lab) -> f64 {
    let deg = |r: f64| r.to_degrees();
    let rad = |d: f64| d.to_radians();

    let c1 = a.a.hypot(a.b);
    let c2 = b.a.hypot(b.b);
    let c_moy = (c1 + c2) / 2.0;
    let c_moy7 = c_moy.powi(7);
    let g = 0.5 * (1.0 - (c_moy7 / (c_moy7 + 25f64.powi(7))).sqrt());

    let a1p = (1.0 + g) * a.a;
    let a2p = (1.0 + g) * b.a;
    let c1p = a1p.hypot(a.b);
    let c2p = a2p.hypot(b.b);

    let teinte = |ap: f64, bp: f64| {
        if ap == 0.0 && bp == 0.0 {
            0.0
        } else {
            deg(bp.atan2(ap)).rem_euclid(360.0)
        }
    };
    let h1p = teinte(a1p, a.b);
    let h2p = teinte(a2p, b.b);

    let dl = b.l - a.l;
    let dc = c2p - c1p;

    let dhp = if c1p * c2p == 0.0 {
        0.0
    } else if (h2p - h1p).abs() <= 180.0 {
        h2p - h1p
    } else if h2p - h1p > 180.0 {
        h2p - h1p - 360.0
    } else {
        h2p - h1p + 360.0
    };
    let dh = 2.0 * (c1p * c2p).sqrt() * rad(dhp / 2.0).sin();

    let l_moy = (a.l + b.l) / 2.0;
    let c_moy_p = (c1p + c2p) / 2.0;
    let h_moy_p = if c1p * c2p == 0.0 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) / 2.0
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) / 2.0
    } else {
        (h1p + h2p - 360.0) / 2.0
    };

    let t = 1.0 - 0.17 * rad(h_moy_p - 30.0).cos()
        + 0.24 * rad(2.0 * h_moy_p).cos()
        + 0.32 * rad(3.0 * h_moy_p + 6.0).cos()
        - 0.20 * rad(4.0 * h_moy_p - 63.0).cos();

    let d_theta = 30.0 * (-(((h_moy_p - 275.0) / 25.0).powi(2))).exp();
    let c_moy_p7 = c_moy_p.powi(7);
    let rc = 2.0 * (c_moy_p7 / (c_moy_p7 + 25f64.powi(7))).sqrt();

    let sl = 1.0 + (0.015 * (l_moy - 50.0).powi(2)) / (20.0 + (l_moy - 50.0).powi(2)).sqrt();
    let sc = 1.0 + 0.045 * c_moy_p;
    let sh = 1.0 + 0.015 * c_moy_p * t;
    let rt = -rad(2.0 * d_theta).sin() * rc;

    ((dl / sl).powi(2) + (dc / sc).powi(2) + (dh / sh).powi(2) + rt * (dc / sc) * (dh / sh)).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proche(a: f64, b: f64, tolerance: f64) {
        assert!((a - b).abs() <= tolerance, "attendu {b}, obtenu {a}");
    }

    #[test]
    fn le_blanc_est_a_clarte_cent() {
        let lab = Lab::from(Rgb::new(255, 255, 255));
        proche(lab.l, 100.0, 0.05);
        proche(lab.a, 0.0, 0.05);
        proche(lab.b, 0.0, 0.05);
    }

    #[test]
    fn le_noir_est_a_clarte_zero() {
        let lab = Lab::from(Rgb::new(0, 0, 0));
        proche(lab.l, 0.0, 0.001);
    }

    #[test]
    fn un_gris_moyen_donne_la_clarte_du_gris_128() {
        /* Valeur publiée pour sRGB(128) : L* = 53,585 (blanc D65). */
        let lab = Xyz::from(Rgb::new(128, 128, 128)).lab(BLANC_D65);
        proche(lab.l, 53.585, 0.01);
        proche(lab.a, 0.0, 0.01);
        proche(lab.b, 0.0, 0.01);
    }

    #[test]
    fn le_rouge_pur_a_les_coordonnees_publiees() {
        /* sRGB #FF0000 : L* = 53,24 · a* = 80,09 · b* = 67,20 (D65). */
        let lab = Xyz::from(Rgb::new(255, 0, 0)).lab(BLANC_D65);
        proche(lab.l, 53.24, 0.02);
        proche(lab.a, 80.09, 0.02);
        proche(lab.b, 67.20, 0.02);
    }

    #[test]
    fn aller_retour_lab_xyz() {
        for rgb in [
            Rgb::new(0, 0, 0),
            Rgb::new(255, 255, 255),
            Rgb::new(12, 200, 255),
            Rgb::new(247, 243, 236),
            Rgb::new(1, 2, 3),
        ] {
            let lab = Lab::from(rgb);
            let retour = lab.xyz(BLANC_D65).lab(BLANC_D65);
            proche(retour.l, lab.l, 1e-9);
            proche(retour.a, lab.a, 1e-9);
            proche(retour.b, lab.b, 1e-9);
        }
    }

    #[test]
    fn le_chroma_du_gris_est_nul() {
        proche(Lab::from(Rgb::new(128, 128, 128)).chroma(), 0.0, 0.05);
    }

    /* Les constantes de Bradford sont publiées à **sept chiffres** : le produit
    `M⁻¹ · D · M` ne retombe donc pas sur l'identité au bit près, mais à
    ~4·10⁻⁸. La tolérance dit ce plancher, elle ne le cache pas. */
    const PLANCHER_BRADFORD: f64 = 1e-6;

    #[test]
    fn bradford_amene_le_blanc_source_sur_le_blanc_cible() {
        let m = bradford(BLANC_D65, BLANC_D50);
        let obtenu = BLANC_D65.applique_matrice(m);
        proche(obtenu.x, BLANC_D50.x, PLANCHER_BRADFORD);
        proche(obtenu.y, BLANC_D50.y, PLANCHER_BRADFORD);
        proche(obtenu.z, BLANC_D50.z, PLANCHER_BRADFORD);
    }

    #[test]
    fn bradford_ne_touche_pas_un_blanc_deja_bon() {
        let m = bradford(BLANC_D50, BLANC_D50);
        let v = Xyz {
            x: 0.21,
            y: 0.34,
            z: 0.07,
        };
        let obtenu = v.applique_matrice(m);
        proche(obtenu.x, v.x, PLANCHER_BRADFORD);
        proche(obtenu.y, v.y, PLANCHER_BRADFORD);
        proche(obtenu.z, v.z, PLANCHER_BRADFORD);
    }

    #[test]
    fn le_blanc_reste_neutre_en_d50_apres_adaptation() {
        /* Sans adaptation, le blanc sRGB tombe à L* = 99,45 avec un b* de −19 :
        un blanc bleuté. Avec Bradford, il est blanc. C'est la différence
        entre convertir et se tromper. */
        let lab = Xyz::lab_d50_depuis_srgb(Rgb::new(255, 255, 255));
        proche(lab.l, 100.0, 0.05);
        proche(lab.a, 0.0, 0.05);
        proche(lab.b, 0.0, 0.05);
    }

    #[test]
    fn l_adaptation_va_et_vient() {
        let v = Xyz::from(Rgb::new(12, 200, 255));
        let retour = v.vers_d50().vers_d65();
        proche(retour.x, v.x, PLANCHER_BRADFORD);
        proche(retour.y, v.y, PLANCHER_BRADFORD);
        proche(retour.z, v.z, PLANCHER_BRADFORD);
    }

    #[test]
    fn un_ecart_nul_donne_zero() {
        let lab = Lab::from(Rgb::new(31, 84, 160));
        assert_eq!(delta_e76(lab, lab), 0.0);
        assert_eq!(delta_e2000(lab, lab), 0.0);
    }

    #[test]
    fn les_ecarts_sont_symetriques() {
        let a = Lab::from(Rgb::new(200, 30, 40));
        let b = Lab::from(Rgb::new(30, 90, 200));
        proche(delta_e76(a, b), delta_e76(b, a), 1e-12);
        proche(delta_e2000(a, b), delta_e2000(b, a), 1e-12);
    }

    /* Jeu de contrôle CIEDE2000 publié (Sharma, Wu & Dalal, 2005) : des valeurs
    choisies parce qu'elles font échouer les implémentations approximatives —
    ce sont donc elles qui valent comme test. */
    type Triplet = (f64, f64, f64);

    #[test]
    fn ciede2000_sur_le_jeu_de_controle_publie() {
        let cas: [(Triplet, Triplet, f64); 6] = [
            ((50.0, 2.6772, -79.7751), (50.0, 0.0, -82.7485), 2.0425),
            ((50.0, 3.1571, -77.2803), (50.0, 0.0, -82.7485), 2.8615),
            ((50.0, 2.8361, -74.0200), (50.0, 0.0, -82.7485), 3.4412),
            ((50.0, -1.3802, -84.2814), (50.0, 0.0, -82.7485), 1.0000),
            ((50.0, 0.0, 0.0), (50.0, -1.0, 2.0), 2.3669),
            (
                (60.2574, -34.0099, 36.2677),
                (60.4626, -34.1751, 39.4387),
                1.2644,
            ),
        ];
        for ((l1, a1, b1), (l2, a2, b2), attendu) in cas {
            let obtenu = delta_e2000(
                Lab {
                    l: l1,
                    a: a1,
                    b: b1,
                },
                Lab {
                    l: l2,
                    a: a2,
                    b: b2,
                },
            );
            assert!(
                (obtenu - attendu).abs() < 0.0002,
                "ΔE00(({l1}, {a1}, {b1}), ({l2}, {a2}, {b2})) = {obtenu}, attendu {attendu}"
            );
        }
    }

    #[test]
    fn ciede2000_et_delta_e76_ne_disent_pas_la_meme_chose() {
        /* Deux écarts de même taille euclidienne : l'un dans les bleus, l'autre
        dans les gris. ΔE00 corrige le premier — c'est précisément pourquoi on
        ne peut pas se contenter de ΔE*ab pour choisir une encre. */
        let bleu_a = Lab {
            l: 35.0,
            a: -44.0,
            b: 4.0,
        };
        let bleu_b = Lab {
            l: 35.0,
            a: -40.0,
            b: 2.0,
        };
        let gris_a = Lab {
            l: 50.0,
            a: 0.0,
            b: 0.0,
        };
        let gris_b = Lab {
            l: 50.0,
            a: 4.0,
            b: 2.0,
        };
        let ecart76 = |x: Lab, y: Lab| delta_e76(x, y);
        proche(ecart76(bleu_a, bleu_b), ecart76(gris_a, gris_b), 0.2);
        let d00_bleu = delta_e2000(bleu_a, bleu_b);
        let d00_gris = delta_e2000(gris_a, gris_b);
        assert!(
            d00_bleu < d00_gris * 0.5,
            "ΔE00 devrait fortement réduire l'écart des bleus : {d00_bleu} contre {d00_gris}"
        );
    }
}
