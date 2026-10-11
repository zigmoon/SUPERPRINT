//! Les **seuils** du contrôle prépresse.
//!
//! Tous les seuils sont des paramètres, jamais des constantes cachées dans le
//! code des vérificateurs. La raison est pratique : un imprimeur offset sur
//! papier couché et un imprimeur numérique sur papier non couché n'ont pas les
//! mêmes tolérances. Un contrôle qui impose ses valeurs se fait désactiver.

/// Seuils du contrôle prépresse.
///
/// Les valeurs par défaut sont celles de l'imprimerie **offset sur couché**,
/// l'usage le plus courant en Europe de l'Ouest. Chaque champ est public : le
/// jour où il faut imprimer autrement, on change la structure, pas le code.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct Regles {
    /// Résolution minimale d'une **image**, en points par pouce.
    ///
    /// 300 dpi est la valeur d'usage pour une photo imprimée en quadri. En
    /// dessous, le flou se voit sur le papier — mais pas à l'écran, c'est tout
    /// le problème.
    pub dpi_mini_image: f64,

    /// Résolution minimale d'un **tracé** (trait, aplat, logo vectoriel
    /// rasterisé), en points par pouce.
    ///
    /// Beaucoup plus élevé que pour une photo : un bord net a besoin de
    /// beaucoup plus de pixels qu'un dégradé pour paraître net. 1 200 dpi est
    /// l'ordre de grandeur admis pour du trait.
    pub dpi_mini_trace: f64,

    /// Couverture d'encre maximale, en pourcentage de la somme des quatre
    /// canaux quadri.
    ///
    /// À 300 %, l'encre ne sèche plus assez vite en offset. Sur papier journal,
    /// la limite descend à 240 % ; sur numérique, elle monte.
    pub couverture_encre_max_pourcent: f64,

    /// Taille de corps sous laquelle un texte est considéré **fin**.
    ///
    /// C'est le seuil qui déclenche l'alerte de noir quadrichrome : sous ce
    /// corps, les quatre encres se décalent au repérage et le texte bave.
    pub corps_texte_fin_pt: f64,

    /// Épaisseur sous laquelle un trait est considéré **fin**, en millimètres.
    pub epaisseur_trait_fin_mm: f64,

    /// Le document doit-il porter un fond perdu non nul ?
    pub exiger_fond_perdu: bool,

    /// Le document doit-il porter un profil de sortie (exigence PDF/X) ?
    pub exiger_profil_sortie: bool,

    /// Le document doit-il tracer des repères de coupe ?
    pub exiger_reperes: bool,

    /// Faut-il signaler le texte vivant ? Information seulement, jamais un
    /// blocage : c'est une intention de l'auteur, pas une propriété du fichier.
    pub signaler_texte_vivant: bool,
}

impl Default for Regles {
    fn default() -> Self {
        Self {
            dpi_mini_image: 300.0,
            dpi_mini_trace: 1200.0,
            couverture_encre_max_pourcent: 300.0,
            corps_texte_fin_pt: 12.0,
            epaisseur_trait_fin_mm: 0.5,
            exiger_fond_perdu: true,
            exiger_profil_sortie: false,
            exiger_reperes: false,
            signaler_texte_vivant: true,
        }
    }
}

impl Regles {
    /// Les règles d'un imprimeur **numérique** : tolérances plus larges.
    ///
    /// Le numérique n'a pas de repérage à corriger entre passes et sèche l'encre
    /// autrement : la couverture peut monter, et le noir quadrichrome est moins
    /// risqué (mais reste déconseillé sur du texte fin, où le repérage existe
    /// toujours).
    #[must_use]
    pub fn numerique() -> Self {
        Self {
            dpi_mini_image: 200.0,
            dpi_mini_trace: 600.0,
            couverture_encre_max_pourcent: 330.0,
            ..Self::default()
        }
    }

    /// Les règles d'un imprimeur **offset sur papier journal** : beaucoup plus
    /// serré sur l'encre — le papier boit et bave.
    #[must_use]
    pub fn journal() -> Self {
        Self {
            dpi_mini_image: 200.0,
            dpi_mini_trace: 900.0,
            couverture_encre_max_pourcent: 240.0,
            corps_texte_fin_pt: 14.0,
            ..Self::default()
        }
    }
}

impl Regles {
    /// Vérifie que les règles ont un sens. Une règle absurde produirait des
    /// constats absurdes, et un rapport qu'on cesse de lire.
    #[must_use]
    pub fn coherentes(&self) -> bool {
        self.dpi_mini_image > 0.0
            && self.dpi_mini_trace >= self.dpi_mini_image
            && self.couverture_encre_max_pourcent > 0.0
            && self.corps_texte_fin_pt >= 0.0
            && self.epaisseur_trait_fin_mm >= 0.0
    }
}

impl Regles {
    /// Lit des règles depuis un texte — le format que la frontière C reçoit.
    ///
    /// Une ligne par champ, les champs séparés par des **tabulations**. Les
    /// lignes vides et celles qui commencent par `#` sont ignorées : un fichier
    /// de réglages doit pouvoir se commenter.
    ///
    /// ```text
    /// !preset<TAB>offset        offset (défaut), numerique, journal
    /// !image<TAB>300            résolution minimale d'une image (dpi)
    /// !trace<TAB>1200           résolution minimale d'un tracé (dpi)
    /// !encre<TAB>300            couverture d'encre maximale (%)
    /// !corps<TAB>12             corps sous lequel un texte est « fin » (pt)
    /// !trait<TAB>0.5            épaisseur sous laquelle un trait est « fin » (mm)
    /// !exiger<TAB>fond<TAB>1    le document doit porter un fond perdu
    /// !exiger<TAB>profil<TAB>0  … un profil de sortie
    /// !exiger<TAB>reperes<TAB>0 … des repères de coupe
    /// !texte<TAB>1              signaler le texte vivant
    /// ```
    ///
    /// `!preset` **remplace** les valeurs courantes : l'écrire après un `!image`
    /// annule ce `!image`. C'est voulu — un préréglage est un point de départ.
    ///
    /// Renvoie `None` si une clé est inconnue, si un nombre est illisible, ou si
    /// les règles obtenues ne sont pas cohérentes ([`Regles::coherentes`]). Une
    /// clé inconnue est **refusée**, jamais ignorée : l'ignorer laisserait croire
    /// que la règle demandée s'applique alors qu'elle ne s'applique pas — et un
    /// contrôle qu'on croit actif est pire qu'un contrôle absent.
    #[must_use]
    pub fn lire(texte: &str) -> Option<Self> {
        let mut regles = Self::default();
        for brute in texte.lines() {
            let ligne = brute.trim();
            if ligne.is_empty() || ligne.starts_with('#') {
                continue;
            }
            let champs: Vec<&str> = ligne.split('\t').map(str::trim).collect();
            match *champs.first()? {
                "!preset" => {
                    regles = match *champs.get(1)? {
                        "offset" => Self::default(),
                        "numerique" => Self::numerique(),
                        "journal" => Self::journal(),
                        _ => return None,
                    };
                }
                "!image" => regles.dpi_mini_image = nombre(&champs, 1)?,
                "!trace" => regles.dpi_mini_trace = nombre(&champs, 1)?,
                "!encre" => regles.couverture_encre_max_pourcent = nombre(&champs, 1)?,
                "!corps" => regles.corps_texte_fin_pt = nombre(&champs, 1)?,
                "!trait" => regles.epaisseur_trait_fin_mm = nombre(&champs, 1)?,
                "!exiger" => {
                    let actif = drapeau(&champs, 2)?;
                    match *champs.get(1)? {
                        "fond" => regles.exiger_fond_perdu = actif,
                        "profil" => regles.exiger_profil_sortie = actif,
                        "reperes" => regles.exiger_reperes = actif,
                        _ => return None,
                    }
                }
                "!texte" => regles.signaler_texte_vivant = drapeau(&champs, 1)?,
                _ => return None,
            }
        }
        regles.coherentes().then_some(regles)
    }
}

/// Un nombre fini pris à la position `rang` d'une ligne découpée.
fn nombre(champs: &[&str], rang: usize) -> Option<f64> {
    let valeur: f64 = champs.get(rang)?.parse().ok()?;
    valeur.is_finite().then_some(valeur)
}

/// Un drapeau `0` ou `1` pris à la position `rang`. Rien d'autre n'est accepté :
/// accepter `oui`, `true` ou `vrai` ferait diverger deux appelants sans le dire.
fn drapeau(champs: &[&str], rang: usize) -> Option<bool> {
    match *champs.get(rang)? {
        "0" => Some(false),
        "1" => Some(true),
        _ => None,
    }
}
