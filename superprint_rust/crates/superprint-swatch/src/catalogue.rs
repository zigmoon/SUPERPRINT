//! Le catalogue : livres, familles, teintes — et son lecteur.
//!
//! Le fichier de données (`data/nuanciers.txt`) est engendré depuis le produit.
//! Son format est volontairement le même genre de **texte tabulé** que les
//! spécifications d'imposition : lisible à l'œil, diffable, et sans
//! dépendance à un format binaire maison.
//!
//! ```text
//! !livre    toyo    Toyo Color Finder
//! !groupe   Jaunes & oranges
//! !couleur  Toyo 001 — Jaune pâle    #F7E7A0
//! ```
//!
//! Le lecteur est **strict** : une ligne mal formée est une erreur, pas une
//! ligne ignorée. Le fichier étant engendré et testé, une erreur y signale un
//! défaut du générateur — et la taire ferait disparaître une teinte en silence,
//! ce qui est exactement le défaut qu'on cherche à éviter ici.

use std::sync::OnceLock;

use superprint_core::color::Rgb;

/// Une teinte : un nom affiché et une couleur RVB.
///
/// La couleur est en **RVB d'écran** (sRGB). Un ton direct n'a pas de valeur
/// RVB exacte : c'est une encre, pas une couleur de lumière. Le produit livre
/// des repères publiés, et c'est tout ce que ce modèle transporte.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Pastille {
    /// Nom affiché, tel qu'il apparaît dans le produit.
    pub nom: String,
    /// Couleur RVB de repère.
    pub rgb: Rgb,
}

impl Pastille {
    /// Construit une pastille.
    #[must_use]
    pub fn new(nom: impl Into<String>, rgb: Rgb) -> Self {
        Self {
            nom: nom.into(),
            rgb,
        }
    }

    /// La couleur au format `#RRGGBB`, **en majuscules**.
    ///
    /// L'orthographe est celle du produit (`hexDepuisRgb` de `swatchbooks.js`) :
    /// c'est la forme qui circule entre l'interface, le catalogue et l'export,
    /// et deux orthographes pour une même teinte seraient une source de
    /// doublons dans les tons directs.
    #[must_use]
    pub fn hex(&self) -> String {
        hex_depuis_rgb(self.rgb)
    }
}

/// `#RRGGBB` en majuscules, depuis une couleur RVB.
#[must_use]
pub fn hex_depuis_rgb(rgb: Rgb) -> String {
    format!("#{:02X}{:02X}{:02X}", rgb.r, rgb.g, rgb.b)
}

/// Lit `#RRGGBB` (le `#` est facultatif, la casse indifférente).
#[must_use]
pub fn rgb_depuis_hex(texte: &str) -> Option<Rgb> {
    let t = texte.strip_prefix('#').unwrap_or(texte);
    if t.len() != 6 || !t.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let octet = |i: usize| u8::from_str_radix(&t[i..i + 2], 16).ok();
    Some(Rgb::new(octet(0)?, octet(2)?, octet(4)?))
}

/// Un ensemble de familles regroupées sous un nom — « RAL », « Pantone »…
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Livre {
    /// Identifiant stable, en minuscules sans accent (`toyo`, `pantone`…).
    pub id: String,
    /// Nom affiché.
    pub nom: String,
    /// Nombre de teintes que le produit en **montre** (`0` = toutes).
    ///
    /// Pantone est livré avec 245 teintes au catalogue mais n'en propose que
    /// 50 dans l'interface. Le catalogue les porte toutes : cacher une teinte
    /// est une décision d'affichage, pas une donnée à jeter.
    pub echantillon: usize,
    /// Familles, dans l'ordre du produit.
    pub familles: Vec<Famille>,
}

impl Livre {
    /// Toutes les teintes du livre, familles confondues.
    pub fn teintes(&self) -> impl Iterator<Item = &Pastille> {
        self.familles.iter().flat_map(|f| f.teintes.iter())
    }

    /// Nombre de teintes.
    #[must_use]
    pub fn nombre_teintes(&self) -> usize {
        self.familles.iter().map(|f| f.teintes.len()).sum()
    }
}

/// Une famille de teintes — l'équivalent d'un `<optgroup>` du produit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Famille {
    /// Libellé affiché (« Jaunes & oranges », « Pantone Basics (Coated) »…).
    pub label: String,
    /// Teintes, dans l'ordre du produit.
    pub teintes: Vec<Pastille>,
}

/// Tous les nuanciers du produit.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Catalogue {
    /// Les livres, dans l'ordre du produit.
    pub livres: Vec<Livre>,
}

/// Une ligne du fichier de données n'a pas pu être lue.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LigneIllisible {
    /// Numéro de ligne, à partir de 1.
    pub numero: usize,
    /// Contenu fautif, tronqué pour l'affichage.
    pub contenu: String,
}

impl std::fmt::Display for LigneIllisible {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "ligne {} du fichier de nuanciers illisible : {:?}",
            self.numero, self.contenu
        )
    }
}

impl std::error::Error for LigneIllisible {}

impl Catalogue {
    /// Lit un catalogue depuis le format texte du fichier de données.
    ///
    /// # Erreurs
    ///
    /// [`LigneIllisible`] dès la première ligne qui ne se lit pas.
    pub fn lire(texte: &str) -> Result<Self, LigneIllisible> {
        let mut livres: Vec<Livre> = Vec::new();
        let mut livre: Option<Livre> = None;
        let mut famille: Option<Famille> = None;

        for (index, ligne) in texte.lines().enumerate() {
            let numero = index + 1;
            let ligne = ligne.trim_end_matches('\r');
            if ligne.is_empty() || ligne.starts_with('#') {
                continue;
            }
            let mut champs = ligne.split('\t');
            let directive = champs.next().unwrap_or_default();
            let refus = |contenu: &str| LigneIllisible {
                numero,
                contenu: contenu.to_string(),
            };

            match directive {
                "!livre" => {
                    if let Some(f) = famille.take() {
                        if let Some(l) = livre.as_mut() {
                            l.familles.push(f);
                        }
                    }
                    if let Some(l) = livre.take() {
                        livres.push(l);
                    }
                    let id = champs.next().ok_or_else(|| refus(ligne))?;
                    let nom = champs.next().ok_or_else(|| refus(ligne))?;
                    livre = Some(Livre {
                        id: id.to_string(),
                        nom: nom.to_string(),
                        echantillon: 0,
                        familles: Vec::new(),
                    });
                }
                "!echantillon" => {
                    let n = champs.next().ok_or_else(|| refus(ligne))?;
                    let n: usize = n.parse().map_err(|_| refus(ligne))?;
                    match livre.as_mut() {
                        Some(l) => l.echantillon = n,
                        None => return Err(refus(ligne)),
                    }
                }
                "!groupe" => {
                    if let Some(f) = famille.take() {
                        if let Some(l) = livre.as_mut() {
                            l.familles.push(f);
                        }
                    }
                    let label = champs.next().ok_or_else(|| refus(ligne))?;
                    if livre.is_none() {
                        return Err(refus(ligne));
                    }
                    famille = Some(Famille {
                        label: label.to_string(),
                        teintes: Vec::new(),
                    });
                }
                "!couleur" => {
                    let nom = champs.next().ok_or_else(|| refus(ligne))?;
                    let hex = champs.next().ok_or_else(|| refus(ligne))?;
                    let rgb = rgb_depuis_hex(hex).ok_or_else(|| refus(ligne))?;
                    match famille.as_mut() {
                        Some(f) => f.teintes.push(Pastille::new(nom, rgb)),
                        None => return Err(refus(ligne)),
                    }
                }
                _ => return Err(refus(ligne)),
            }
        }

        if let Some(f) = famille.take() {
            if let Some(l) = livre.as_mut() {
                l.familles.push(f);
            }
        }
        if let Some(l) = livre.take() {
            livres.push(l);
        }
        Ok(Self { livres })
    }

    /// Un livre par son identifiant.
    #[must_use]
    pub fn livre(&self, id: &str) -> Option<&Livre> {
        self.livres.iter().find(|l| l.id == id)
    }

    /// Toutes les teintes de tous les livres.
    pub fn teintes(&self) -> impl Iterator<Item = &Pastille> {
        self.livres.iter().flat_map(Livre::teintes)
    }

    /// Nombre total de teintes.
    #[must_use]
    pub fn nombre_teintes(&self) -> usize {
        self.livres.iter().map(Livre::nombre_teintes).sum()
    }
}

/// Le catalogue engendré, lu **une seule fois** puis partagé.
///
/// # Panics
///
/// Ne peut pas arriver : le fichier de données est engendré, versionné, et
/// [`tests::le_catalogue_engendre_se_lit`] prouve qu'il se lit. Un `expect` sur
/// une donnée interne vérifiée par un test est préférable à un `Option` qui
/// ferait porter le cas impossible à chaque appelant.
#[must_use]
pub fn catalogue() -> &'static Catalogue {
    static CATALOGUE: OnceLock<Catalogue> = OnceLock::new();
    CATALOGUE.get_or_init(|| {
        Catalogue::lire(DONNEES).expect("le fichier de nuanciers engendré doit se lire")
    })
}

/// Le fichier de données, engendré par `scripts/extract-swatchbooks.mjs`.
pub const DONNEES: &str = include_str!("../data/nuanciers.txt");

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_catalogue_engendre_se_lit() {
        let c = catalogue();
        assert_eq!(c.livres.len(), 7, "sept nuanciers livrés");
        let ids: Vec<&str> = c.livres.iter().map(|l| l.id.as_str()).collect();
        assert_eq!(
            ids,
            ["toyo", "focoltone", "hks", "ral", "ncs", "dic", "pantone"]
        );
    }

    #[test]
    fn le_catalogue_porte_les_teintes_du_produit() {
        let c = catalogue();
        assert_eq!(c.nombre_teintes(), 688);
        assert_eq!(c.livre("pantone").unwrap().nombre_teintes(), 245);
        assert_eq!(c.livre("ral").unwrap().nombre_teintes(), 191);
        assert_eq!(c.livre("toyo").unwrap().nombre_teintes(), 46);
    }

    #[test]
    fn les_noms_et_les_couleurs_sont_ceux_du_produit() {
        let c = catalogue();
        let toyo = c.livre("toyo").unwrap();
        let premiere = toyo.familles[0].teintes[0].clone();
        assert_eq!(premiere.nom, "Toyo 001 — Jaune pâle");
        assert_eq!(premiere.hex(), "#F7E7A0");
        assert_eq!(toyo.familles[0].label, "Jaunes & oranges");
    }

    #[test]
    fn l_echantillon_de_pantone_est_plus_petit_que_le_livre() {
        /* Le produit n'affiche que 50 des 245 teintes : le catalogue les porte
        toutes, l'échantillon dit seulement combien sont montrées. */
        let pantone = catalogue().livre("pantone").unwrap();
        assert_eq!(pantone.echantillon, 50);
        assert!(pantone.nombre_teintes() > pantone.echantillon);
    }

    #[test]
    fn tous_les_livres_ont_un_nom_et_au_moins_une_teinte() {
        for livre in &catalogue().livres {
            assert!(!livre.nom.is_empty(), "livre {} sans nom", livre.id);
            assert!(livre.nombre_teintes() > 0, "livre {} vide", livre.id);
            for famille in &livre.familles {
                assert!(!famille.label.is_empty(), "famille sans label");
                assert!(!famille.teintes.is_empty(), "famille vide");
            }
        }
    }

    #[test]
    fn les_hexadecimales_sont_rendues_en_majuscules() {
        assert_eq!(hex_depuis_rgb(Rgb::new(0, 0, 0)), "#000000");
        assert_eq!(hex_depuis_rgb(Rgb::new(255, 255, 255)), "#FFFFFF");
        assert_eq!(hex_depuis_rgb(Rgb::new(10, 171, 5)), "#0AAB05");
    }

    #[test]
    fn l_aller_retour_hexadecimal_est_exact() {
        for rgb in [
            Rgb::new(0, 0, 0),
            Rgb::new(255, 255, 255),
            Rgb::new(247, 231, 160),
            Rgb::new(1, 2, 3),
        ] {
            assert_eq!(rgb_depuis_hex(&hex_depuis_rgb(rgb)), Some(rgb));
        }
    }

    #[test]
    fn une_couleur_illisible_est_refusee() {
        for texte in ["", "#", "#12345", "#1234567", "#GGGGGG", "bleu", "#12345Z"] {
            assert_eq!(rgb_depuis_hex(texte), None, "{texte:?} devrait être refusé");
        }
        assert_eq!(rgb_depuis_hex("f7e7a0"), Some(Rgb::new(247, 231, 160)));
    }

    #[test]
    fn une_ligne_mal_formee_est_une_erreur_pas_un_silence() {
        /* Le point important : une teinte qui disparaît sans rien dire est
        exactement le défaut que ce lecteur doit rendre impossible. */
        for (texte, ligne) in [
            ("!couleur\tNom\t#1234", 1),
            ("!livre\ttoyo", 1),
            ("!groupe\tFamille", 1),
            ("!couleur\tNom\t#FFFFFF", 1),
            ("!inconnue\t1", 1),
            ("!livre\ttoyo\tToyo\n!groupe\tG\n!couleur\tN\t#GGGGGG", 3),
            ("!livre\ttoyo\tToyo\n!echantillon\tbeaucoup", 2),
        ] {
            let erreur = Catalogue::lire(texte).unwrap_err();
            assert_eq!(erreur.numero, ligne, "pour {texte:?}");
        }
    }

    #[test]
    fn un_catalogue_ecrit_a_la_main_se_lit() {
        let texte = "\
# commentaire
!livre\ttest\tNuancier de test
!echantillon\t2
!groupe\tFamille A
!couleur\tA1\t#000000
!couleur\tA2\t#ffffff
!groupe\tFamille B
!couleur\tB1\t#FF0000
";
        let c = Catalogue::lire(texte).unwrap();
        assert_eq!(c.livres.len(), 1);
        let l = &c.livres[0];
        assert_eq!(l.id, "test");
        assert_eq!(l.echantillon, 2);
        assert_eq!(l.familles.len(), 2);
        assert_eq!(l.nombre_teintes(), 3);
        assert_eq!(l.familles[1].teintes[0].hex(), "#FF0000");
    }

    #[test]
    fn un_catalogue_vide_se_lit() {
        assert_eq!(Catalogue::lire("").unwrap().nombre_teintes(), 0);
        assert_eq!(Catalogue::lire("# rien\n\n").unwrap().livres.len(), 0);
    }

    #[test]
    fn le_fichier_engendre_ne_derive_pas_du_produit() {
        /* Si un nuancier change dans le produit et que le fichier n'est pas
        régénéré, ce test ne le verra pas — mais `validate-swatch.mjs` si.
        Ici on vérifie au moins que l'en-tête dit d'où vient le fichier et
        comment le refaire, pour qu'un humain tombant dessus sache quoi faire. */
        assert!(DONNEES.contains("extract-swatchbooks.mjs"));
        assert!(DONNEES.contains("swatchbooks.js"));
    }
}
