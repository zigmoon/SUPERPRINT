//! Couleurs : RVB 8 bits et CMJN.
//!
//! Les conversions RVB ↔ CMJN sont **naïves** (formule algébrique, sans profil
//! ICC). La gestion colorimétrique réelle (profils, `/Separation`, PDF/X)
//! passera par un module dédié — voir `docs/PLAN.md`.

/// Couleur RVB, canaux 0–255.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rgb {
    pub r: u8,
    pub g: u8,
    pub b: u8,
}

/// Couleur CMJN, canaux normalisés 0,0–1,0.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Cmyk {
    pub c: f64,
    pub m: f64,
    pub y: f64,
    pub k: f64,
}

impl Rgb {
    pub const fn new(r: u8, g: u8, b: u8) -> Self {
        Self { r, g, b }
    }

    /// Luminance perceptuelle (Rec. 709), 0–255 — base du passage en niveaux de gris.
    #[must_use]
    pub fn luma(self) -> u8 {
        let y =
            0.2126 * f64::from(self.r) + 0.7152 * f64::from(self.g) + 0.0722 * f64::from(self.b);
        y.round().clamp(0.0, 255.0) as u8
    }
}

impl From<Rgb> for Cmyk {
    /// Conversion **naïve** RVB → CMJN, sans profil ICC.
    fn from(rgb: Rgb) -> Self {
        let r = f64::from(rgb.r) / 255.0;
        let g = f64::from(rgb.g) / 255.0;
        let b = f64::from(rgb.b) / 255.0;

        let k = 1.0 - r.max(g).max(b);
        if k >= 1.0 {
            return Self {
                c: 0.0,
                m: 0.0,
                y: 0.0,
                k: 1.0,
            };
        }
        let d = 1.0 - k;
        Self {
            c: (1.0 - r - k) / d,
            m: (1.0 - g - k) / d,
            y: (1.0 - b - k) / d,
            k,
        }
    }
}

impl From<Cmyk> for Rgb {
    /// Conversion **naïve** CMJN → RVB, sans profil ICC.
    fn from(cmyk: Cmyk) -> Self {
        let Cmyk { c, m, y, k } = cmyk;
        let scale = 1.0 - k;
        Self {
            r: ((1.0 - c) * scale * 255.0).round().clamp(0.0, 255.0) as u8,
            g: ((1.0 - m) * scale * 255.0).round().clamp(0.0, 255.0) as u8,
            b: ((1.0 - y) * scale * 255.0).round().clamp(0.0, 255.0) as u8,
        }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
//  La conversion du produit : seuil neutre, GCR, limite d'encre
// ─────────────────────────────────────────────────────────────────────────────

/// Le seuil de neutralité du produit : `12/255`, soit environ 4,7 %.
///
/// Les pages exportées sont rasterisées en JPEG, ce qui introduit du **bruit
/// chromatique** autour des textes noirs — des halos rouges ou bleus, invisibles
/// à l'œil en RVB, mais qui deviennent après conversion des encres CMJ
/// **visibles** : c'est le « noir sale avec des traits à l'intérieur du noir ».
/// Un pixel dont l'écart entre canaux est sous ce seuil est donc traité comme un
/// gris pur, et forcé en noir seul (`C = M = J = 0`). C'est la méthode de
/// prépresse standard, et le seuil est celui du produit.
pub const SEUIL_NEUTRE: f64 = 12.0 / 255.0;

/// Les réglages de la conversion RVB → CMJN.
///
/// `None` désactive, `Some(montant)` active. C'est **exactement** la sémantique
/// de `if (opts.gcr)` en JavaScript, où `undefined`, `false` et `0` sont faux :
/// un montant nul désactive l'étape au lieu de l'appliquer à zéro.
#[derive(Clone, Copy, Debug, Default, PartialEq)]
pub struct Reglages {
    /// Remplacement de la composante grise, 0,0–1,0.
    pub gcr: Option<f64>,
    /// Limite d'encre totale, en canaux (3,0 = 300 %).
    pub limite_encre: Option<f64>,
}

/// Conversion RVB → CMJN, **identique à `_spCmykConvert` du produit**.
///
/// Elle est recopiée telle quelle, bizarreries comprises, parce que son résultat
/// est **visible à l'impression** — il part dans le PDF livré :
///
/// - `r`, `g` et `b` sont acceptés en `[0, 1]` **ou** en `[0, 255]`. La
///   détection est **globale** : si un seul des trois canaux dépasse 1, les trois
///   sont divisés par 255. Une entrée mélangée (`0,5` et `200`) est donc
///   interprétée comme du 0–255. Ce n'est pas élégant, mais reproduire le
///   comportement du produit vaut mieux que de « corriger » une entrée ambiguë
///   sans savoir ce que l'appelant voulait dire ;
/// - la **neutralisation** vient avant le calcul : un gris part en noir seul ;
/// - le **GCR** remonte le minimum CMJ dans le noir et le retranche des trois
///   autres canaux ;
/// - la **limite d'encre** réduit les quatre canaux proportionnellement.
///
/// ⚠️ Une entrée **non finie** n'est pas gérée ici : `convertir` est un
/// miroir fidèle du produit, qui propagerait un `NaN`. C'est la frontière qui
/// refuse ([`superprint_wasm::sp_cmyk_convert`]), parce qu'un `NaN` dans un PDF
/// livré ne se voit qu'à l'impression.
#[must_use]
pub fn convertir(r: f64, g: f64, b: f64, reglages: Reglages) -> Cmyk {
    // Détection globale de l'échelle, puis bornage — dans cet ordre.
    let (mut r, mut g, mut b) = if r > 1.0 || g > 1.0 || b > 1.0 {
        (r / 255.0, g / 255.0, b / 255.0)
    } else {
        (r, g, b)
    };
    r = r.clamp(0.0, 1.0);
    g = g.clamp(0.0, 1.0);
    b = b.clamp(0.0, 1.0);

    // Neutralisation : un pixel quasi gris part en noir seul.
    let etendue = r.max(g).max(b) - r.min(g).min(b);
    if etendue < SEUIL_NEUTRE {
        let gris = (r + g + b) / 3.0;
        return Cmyk {
            c: 0.0,
            m: 0.0,
            y: 0.0,
            k: (1.0 - gris).clamp(0.0, 1.0),
        };
    }

    let mut k = 1.0 - r.max(g).max(b);
    let (mut c, mut m, mut y);
    if k >= 1.0 - 1e-9 {
        c = 0.0;
        m = 0.0;
        y = 0.0;
        k = 1.0;
    } else {
        let inv = 1.0 - k;
        c = (1.0 - r - k) / inv;
        m = (1.0 - g - k) / inv;
        y = (1.0 - b - k) / inv;
    }

    // Remplacement de la composante grise.
    if let Some(montant) = reglages.gcr.filter(|v| *v > 0.0) {
        let montant = montant.clamp(0.0, 1.0);
        let minimum = c.min(m).min(y);
        let nouveau_k = k.max(minimum * montant);
        let delta = nouveau_k - k;
        if delta > 0.0 {
            c = (c - delta).max(0.0);
            m = (m - delta).max(0.0);
            y = (y - delta).max(0.0);
            k = nouveau_k;
        }
    }

    // Limite d'encre : réduction proportionnelle des quatre canaux.
    if let Some(limite) = reglages.limite_encre.filter(|v| *v > 0.0) {
        let total = c + m + y + k;
        if total > limite {
            let facteur = limite / total;
            c *= facteur;
            m *= facteur;
            y *= facteur;
            k *= facteur;
        }
    }

    Cmyk { c, m, y, k }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn approx_rgb(a: Rgb, b: Rgb) {
        let d = |x: u8, y: u8| (i16::from(x) - i16::from(y)).abs();
        assert!(
            d(a.r, b.r) <= 1 && d(a.g, b.g) <= 1 && d(a.b, b.b) <= 1,
            "attendu {b:?}, obtenu {a:?}"
        );
    }

    #[test]
    fn luminance_blanc_noir() {
        assert_eq!(Rgb::new(255, 255, 255).luma(), 255);
        assert_eq!(Rgb::new(0, 0, 0).luma(), 0);
        assert_eq!(Rgb::new(128, 128, 128).luma(), 128);
    }

    #[test]
    fn noir_donne_k_a_un() {
        let cmyk: Cmyk = Rgb::new(0, 0, 0).into();
        assert_eq!(
            cmyk,
            Cmyk {
                c: 0.0,
                m: 0.0,
                y: 0.0,
                k: 1.0
            }
        );
    }

    #[test]
    fn aller_retour_rgb_cmyk() {
        for rgb in [
            Rgb::new(255, 0, 0),
            Rgb::new(0, 128, 64),
            Rgb::new(12, 200, 255),
            Rgb::new(247, 243, 236),
        ] {
            approx_rgb(Rgb::from(Cmyk::from(rgb)), rgb);
        }
    }

    // ── la conversion du produit ─────────────────────────────────────────────

    fn proche(a: f64, b: f64) -> bool {
        (a - b).abs() < 1e-12
    }

    #[test]
    fn couleur_pure_en_echelle_0_1() {
        // Rouge pur : K = 0, C = 0 (le rouge est à 1), M = J = 1.
        let c = convertir(1.0, 0.0, 0.0, Reglages::default());
        assert!(proche(c.c, 0.0) && proche(c.k, 0.0));
        assert!(proche(c.m, 1.0) && proche(c.y, 1.0), "{c:?}");
    }

    #[test]
    fn l_echelle_est_detectee_globalement() {
        // La détection est GLOBALE : un seul canal au-dessus de 1 fait passer
        // les TROIS en échelle 0-255. (0,5 ; 200 ; 0,5) est donc lu comme
        // (0,00196 ; 0,784 ; 0,00196) et non comme un mélange.
        let entier = convertir(128.0, 200.0, 51.0, Reglages::default());
        let flottant = convertir(
            128.0 / 255.0,
            200.0 / 255.0,
            51.0 / 255.0,
            Reglages::default(),
        );
        assert!(proche(entier.c, flottant.c));
        assert!(proche(entier.m, flottant.m));
        assert!(proche(entier.y, flottant.y));
        assert!(proche(entier.k, flottant.k));

        // Le cas mélangé : c'est bien l'échelle 0-255 qui l'emporte.
        let melange = convertir(0.5, 200.0, 0.5, Reglages::default());
        let attendu = convertir(0.5 / 255.0, 200.0 / 255.0, 0.5 / 255.0, Reglages::default());
        assert!(proche(melange.c, attendu.c), "{melange:?} vs {attendu:?}");
    }

    #[test]
    fn un_gris_part_en_noir_seul() {
        // Un gris exact : C = M = J = 0.
        let c = convertir(0.5, 0.5, 0.5, Reglages::default());
        assert!(proche(c.c, 0.0) && proche(c.m, 0.0) && proche(c.y, 0.0));
        assert!(proche(c.k, 0.5));
    }

    #[test]
    fn la_neutralisation_attrape_le_bruit_jpeg() {
        // Le cas qui a motivé le seuil : un « noir » JPEG à peine coloré.
        // Sans neutralisation, il ressortirait avec des encres CMJ visibles.
        let bruit = convertir(0.02, 0.0, 0.03, Reglages::default());
        assert!(
            proche(bruit.c, 0.0) && proche(bruit.m, 0.0) && proche(bruit.y, 0.0),
            "le bruit chromatique doit partir en noir seul : {bruit:?}"
        );
        assert!(proche(bruit.k, 1.0 - (0.02 + 0.0 + 0.03) / 3.0));

        // Juste au-dessus du seuil : la couleur est conservée.
        let franc = convertir(0.10, 0.0, 0.0, Reglages::default());
        assert!(franc.m > 0.0 && franc.y > 0.0, "{franc:?}");
    }

    #[test]
    fn le_seuil_est_bien_12_sur_255() {
        assert!(proche(SEUIL_NEUTRE, 12.0 / 255.0));
        // 11/255 d'écart : neutralisé. 13/255 : conservé.
        let dessous = convertir(0.5, 0.5 - 11.0 / 255.0, 0.5, Reglages::default());
        assert!(proche(dessous.c, 0.0) && proche(dessous.m, 0.0) && proche(dessous.y, 0.0));
        let dessus = convertir(0.5, 0.5 - 13.0 / 255.0, 0.5, Reglages::default());
        assert!(dessus.m > 0.0 || dessus.y > 0.0, "{dessus:?}");
    }

    #[test]
    fn le_gcr_du_produit_ne_change_rien_et_c_est_un_defaut() {
        // MESURE, et non hypothèse. Après la conversion naïve, le canal
        // d'énergie maximale donne TOUJOURS un CMJ nul :
        //     c = (1 - max - k) / (1 - k)  avec  k = 1 - max  →  c = 0.
        // Le minimum de C, M, J vaut donc 0 **exactement**, l'instruction
        // `newK = max(k, cmyMin × montant)` rend `k` inchangé, `delta` vaut 0,
        // et le remplacement de la composante grise n'a **aucun effet** —
        // quelle que soit la valeur demandée.
        //
        // C'est un défaut réel du produit, et le noyau le **reproduit** : la
        // parité passe avant la correction, parce que changer le résultat ici
        // changerait le PDF livré sans que personne ne l'ait demandé. Mais le
        // défaut est écrit ici, et signalé dans `docs/PORTAGE.md`.
        for (r, g, b) in [
            (0.5, 0.6, 0.7),
            (0.9, 0.2, 0.4),
            (0.2, 0.3, 0.9),
            (0.99, 0.5, 0.51),
            (0.05, 0.0, 0.02),
        ] {
            let sans = convertir(r, g, b, Reglages::default());
            let minimum = sans.c.min(sans.m).min(sans.y);
            assert!(
                minimum.abs() < 1e-15,
                "({r}, {g}, {b}) : le minimum CMJ devrait être nul, il vaut {minimum}"
            );
            for montant in [0.2, 0.5, 0.8, 1.0] {
                let avec = convertir(
                    r,
                    g,
                    b,
                    Reglages {
                        gcr: Some(montant),
                        limite_encre: None,
                    },
                );
                assert_eq!(
                    sans, avec,
                    "le GCR a modifié la conversion pour ({r}, {g}, {b}) au montant {montant}"
                );
            }
        }
    }

    #[test]
    fn un_montant_de_gcr_nul_desactive_l_etape() {
        // `if (opts.gcr)` en JavaScript : zéro est faux. Un montant nul ne doit
        // donc RIEN changer, et non « appliquer le GCR à zéro ».
        let sans = convertir(0.7, 0.6, 0.5, Reglages::default());
        let zero = convertir(
            0.7,
            0.6,
            0.5,
            Reglages {
                gcr: Some(0.0),
                limite_encre: None,
            },
        );
        assert_eq!(sans, zero);
    }

    #[test]
    fn la_limite_d_encre_reduit_proportionnellement() {
        // Un brun sombre et saturé : la couverture dépasse 250 %.
        let base = convertir(0.2, 0.05, 0.0, Reglages::default());
        let total = base.c + base.m + base.y + base.k;
        assert!(total > 2.0, "le cas de test doit être chargé : {total}");
        let limite = total / 2.0;
        let borne = convertir(
            0.2,
            0.05,
            0.0,
            Reglages {
                gcr: None,
                limite_encre: Some(limite),
            },
        );
        let nouveau = borne.c + borne.m + borne.y + borne.k;
        assert!(
            (nouveau - limite).abs() < 1e-12,
            "total {nouveau}, attendu {limite}"
        );
        // La réduction est proportionnelle : les rapports entre canaux sont
        // conservés, donc la teinte ne bouge pas.
        assert!(proche(borne.m / borne.y, base.m / base.y));
        assert!(proche(borne.k / borne.y, base.k / base.y));
    }

    #[test]
    fn une_limite_deja_respectee_ne_change_rien() {
        let base = convertir(1.0, 1.0, 1.0, Reglages::default());
        let borne = convertir(
            1.0,
            1.0,
            1.0,
            Reglages {
                gcr: None,
                limite_encre: Some(4.0),
            },
        );
        assert_eq!(base, borne);
    }

    #[test]
    fn les_entrees_sont_bornees() {
        // Hors bornes : ramené dans l'intervalle.
        let dessous = convertir(-5.0, -1.0, -0.2, Reglages::default());
        assert_eq!(dessous, convertir(0.0, 0.0, 0.0, Reglages::default()));
        let dessus = convertir(2.0, 3.0, 4.0, Reglages::default());
        assert_eq!(
            dessus,
            convertir(2.0 / 255.0, 3.0 / 255.0, 4.0 / 255.0, Reglages::default())
        );
    }

    #[test]
    fn la_conversion_scalaire_et_celle_par_octets_donnent_le_meme_ton() {
        // `sp_rgb_to_cmyk` (par lots, 8 bits) et la conversion scalaire
        // doivent raconter la même chose sur un même pixel — sinon l'aperçu et
        // l'export se contrediraient.
        for (r, g, b) in [(0u8, 0u8, 0u8), (255, 0, 0), (0, 128, 64), (200, 30, 90)] {
            let par_octets: Cmyk = Rgb::new(r, g, b).into();
            let scalaire = convertir(
                f64::from(r),
                f64::from(g),
                f64::from(b),
                Reglages::default(),
            );
            // Les deux diffèrent par le seuil neutre (absent de la version par
            // octets) : on ne les compare donc que sur les pixels colorés.
            if !(r.abs_diff(g) < 12 && g.abs_diff(b) < 12 && r.abs_diff(b) < 12) {
                assert!(
                    (par_octets.c - scalaire.c).abs() < 1e-9,
                    "c : {par_octets:?} vs {scalaire:?}"
                );
                assert!((par_octets.k - scalaire.k).abs() < 1e-9);
            }
        }
    }
}
