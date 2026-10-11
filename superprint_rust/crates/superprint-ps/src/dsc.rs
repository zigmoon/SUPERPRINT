//! En-tête DSC d'un fichier EPS, et reconnaissance de la saveur du fichier.
//!
//! ## Ce qu'est DSC
//!
//! La convention « Document Structuring Conventions » est un ensemble de
//! **commentaires** qui décrivent un fichier PostScript : `%%BoundingBox`,
//! `%%Creator`, `%%Title`, `%%Pages`. Ils commencent tous par `%%`, ce qui les
//! rend inoffensifs pour un interpréteur PostScript — qui les ignore comme
//! n'importe quel commentaire — et lisibles par un programme qui ne sait pas
//! interpréter PostScript.
//!
//! ## Les blocs de données, et pourquoi il FAUT les sauter
//!
//! DSC délimite des blocs de données **non-PostScript** :
//! `%%BeginPreview` … `%%EndPreview` (une vignette en hexadécimal),
//! `%%BeginBinary`, `%%BeginData`, `%%BeginFont`. Le contenu d'un bloc Aperçu
//! est de l'hexadécimal en clair, sur des lignes qui ne commencent pas par `%` :
//! `A5A5A5A5A5…`. Sans le découpage DSC, un interpréteur lit cela comme des
//! **noms** PostScript et s'arrête sur « opérateur inconnu : A5A5A5A5… ».
//!
//! C'est le témoin `eps-preview.eps` qui le vérifie, et c'est pour cela qu'il
//! existe.
//!
//! ## Le `.ai` moderne n'est pas du PostScript
//!
//! Depuis longtemps, Illustrator enregistre ses `.ai` en **PDF** dès qu'on
//! garde la compatibilité PDF, ce qui est le défaut. Le fichier témoin
//! `Logo_licra_vecto.ai` du dépôt commence par `%PDF-1.6`. Prétendre le lire
//! comme du PostScript serait une faute, et le dire est utile : le noyau
//! **reconnaît** les deux, et refuse le PDF en expliquant pourquoi.

use std::fmt;

/// La saveur d'un fichier, reconnue par sa signature.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Saveur {
    /// Le fichier est du PostScript (`%!PS…`), et il est analysable.
    PostScript,
    /// Le fichier est un PDF (`%PDF-…`).
    ///
    /// C'est le cas de tous les `.ai` modernes. Le noyau **écrit** du PDF mais
    /// n'en **lit** pas : ce n'est pas un mensonge à raconter, c'est un refus.
    Pdf {
        /// La version annoncée.
        version: u8,
    },
    /// Le fichier est une archive ZIP d'Illustrator (`.aia`, plus rare).
    Archive,
    /// Rien de reconnu.
    Inconnnue,
}

impl fmt::Display for Saveur {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::PostScript => write!(f, "PostScript"),
            Self::Pdf { version } => write!(f, "PDF {version}.x"),
            Self::Archive => write!(f, "archive ZIP"),
            Self::Inconnnue => write!(f, "format inconnu"),
        }
    }
}

/// Reconnaît la saveur d'un fichier d'après ses premiers octets.
#[must_use]
pub fn reconnaitre(octets: &[u8]) -> Saveur {
    if octets.len() >= 2 && &octets[0..2] == b"%!" {
        // `%!PS-Adobe-3.0 EPSF-3.0`, `%!PS-Adobe-2.0`, ou `%!` tout court.
        return Saveur::PostScript;
    }
    if octets.len() >= 5 && &octets[0..5] == b"%PDF-" {
        // La version est un chiffre, puis un point.
        let version = octets[5].wrapping_sub(b'0');
        return Saveur::Pdf {
            version: if version <= 9 { version } else { 0 },
        };
    }
    if octets.len() >= 4 && &octets[0..4] == b"PK\x03\x04" {
        return Saveur::Archive;
    }
    Saveur::Inconnnue
}

/// L'en-tête DSC d'un fichier EPS.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct EnTeteEps {
    /// La ligne de version (`%!PS-Adobe-3.0 EPSF-3.0`), sans le `%!`.
    pub version: Option<String>,
    /// Le `%%BoundingBox`, en points : `(x min, y min, x max, y max)`.
    pub bounding_box: Option<(f64, f64, f64, f64)>,
    /// Le `%%HiResBoundingBox`, quand il est donné avec plus de précision.
    pub bounding_box_haute_resolution: Option<(f64, f64, f64, f64)>,
    /// Le `%%Creator`.
    pub createur: Option<String>,
    /// Le `%%Title`.
    pub titre: Option<String>,
    /// Le `%%CreationDate`.
    pub date: Option<String>,
    /// Le nombre de pages annoncé par `%%Pages`.
    pub pages_annoncees: Option<u32>,
    /// Le fichier est-il annoncé comme EPS (`EPSF`) ?
    pub est_eps: bool,
    /// Les commentaires `%AI…` d'Illustrator, tels quels.
    ///
    /// Ils disent des choses que DSC ne dit pas — la version du format
    /// d'Illustrator, la présence d'objets en direct — et les perdre serait
    /// perdre ce qui distingue un fichier retouchable d'un simple dessin.
    pub commentaires_illustrator: Vec<String>,
}

impl EnTeteEps {
    /// La boîte à utiliser : la haute résolution quand elle est là, sinon la
    /// simple.
    ///
    /// Le `%%BoundingBox` est arrondi à l'entier inférieur : prendre la valeur
    /// fine quand elle existe évite de rogner un dixième de point de dessin.
    #[must_use]
    pub fn boite_utile(&self) -> Option<(f64, f64, f64, f64)> {
        self.bounding_box_haute_resolution.or(self.bounding_box)
    }

    /// Largeur et hauteur en points.
    #[must_use]
    pub fn dimensions(&self) -> Option<(f64, f64)> {
        let (x0, y0, x1, y1) = self.boite_utile()?;
        Some(((x1 - x0).abs(), (y1 - y0).abs()))
    }

    /// Largeur et hauteur en millimètres.
    #[must_use]
    pub fn dimensions_mm(&self) -> Option<(f64, f64)> {
        let (largeur, hauteur) = self.dimensions()?;
        Some((largeur * 25.4 / 72.0, hauteur * 25.4 / 72.0))
    }
}

/// Analyse un en-tête DSC et découpe le fichier en **code** et en blocs ignorés.
///
/// Rend `(en-tête, code, nombre de blocs sautés)`. Le code rendu est le
/// programme PostScript **sans** les blocs de données : c'est ce qui peut être
/// lexé.
#[must_use]
pub fn decouper(source: &str) -> (EnTeteEps, String, usize) {
    let mut en_tete = EnTeteEps::default();
    let mut code = String::with_capacity(source.len());
    let mut blocs = 0usize;
    let mut dans_un_bloc = false;
    let mut dans_les_commentaires = true;

    for (rang, ligne) in source.lines().enumerate() {
        let ligne_nettoyee = ligne.trim_end_matches(['\r', '\n']);

        if rang == 0 {
            if let Some(reste) = ligne_nettoyee.strip_prefix("%!") {
                en_tete.version = Some(reste.trim().to_string());
                en_tete.est_eps = reste.contains("EPSF");
            }
        }

        // ── 1. Les blocs de données : leur contenu n'est PAS du PostScript ──
        if dans_un_bloc {
            if ligne_nettoyee.starts_with("%%EndPreview")
                || ligne_nettoyee.starts_with("%%EndBinary")
                || ligne_nettoyee.starts_with("%%EndData")
                || ligne_nettoyee.starts_with("%%EndFont")
                || ligne_nettoyee.starts_with("%%EndDocument")
            {
                dans_un_bloc = false;
            }
            continue;
        }
        if ligne_nettoyee.starts_with("%%BeginPreview")
            || ligne_nettoyee.starts_with("%%BeginBinary")
            || ligne_nettoyee.starts_with("%%BeginData")
            || ligne_nettoyee.starts_with("%%BeginFont")
            || ligne_nettoyee.starts_with("%%BeginDocument")
        {
            dans_un_bloc = true;
            blocs += 1;
            continue;
        }

        // ── 2. Les commentaires Illustrator, où qu'ils soient ──────────────
        // Illustrator place `%AI5_FileFormat` tantôt avant, tantôt après
        // `%%EndComments`. Les chercher seulement dans la section d'en-tête
        // reviendrait à les rater dans la moitié des fichiers.
        if ligne_nettoyee.starts_with("%AI") {
            en_tete
                .commentaires_illustrator
                .push(ligne_nettoyee.trim_start_matches('%').trim().to_string());
            code.push('\n');
            continue;
        }

        // ── 3. La section d'en-tête DSC ────────────────────────────────────
        if dans_les_commentaires {
            if let Some(reste) = ligne_nettoyee.strip_prefix("%%") {
                let (cle, valeur) = match reste.split_once(':') {
                    Some((cle, valeur)) => (cle.trim(), valeur.trim()),
                    None => (reste.trim(), ""),
                };
                match cle {
                    "BoundingBox" | "BoundingBox (atend)" => {
                        en_tete.bounding_box = lire_boite(valeur);
                    }
                    "HiResBoundingBox" => {
                        en_tete.bounding_box_haute_resolution = lire_boite(valeur);
                    }
                    "Creator" => en_tete.createur = Some(valeur.to_string()),
                    "Title" => en_tete.titre = Some(valeur.to_string()),
                    "CreationDate" => en_tete.date = Some(valeur.to_string()),
                    "Pages" => {
                        en_tete.pages_annoncees = valeur
                            .split_whitespace()
                            .next()
                            .and_then(|v| v.parse().ok());
                    }
                    "EndComments" => dans_les_commentaires = false,
                    _ => {}
                }
                // Les marqueurs de structure restent dans le code sous forme de
                // commentaires : le lexeur les ignore, et c'est `showpage` qui
                // fait le travail de pagination.
                code.push('\n');
                continue;
            }
            // Une ligne qui n'est pas un commentaire ferme la section.
            if !ligne_nettoyee.starts_with('%') && !ligne_nettoyee.trim().is_empty() {
                dans_les_commentaires = false;
            }
        }

        // ── 4. Le code ─────────────────────────────────────────────────────
        if !ligne_nettoyee.starts_with('%') {
            code.push_str(ligne_nettoyee);
            code.push('\n');
        } else {
            // Un commentaire PostScript : `%`, `%%BeginProlog`, `%%Page: 1 1`…
            // Le lexeur les ignorera de toute façon, mais garder la ligne vide
            // conserve les numéros de ligne, ce qui rend un message d'erreur
            // utile.
            code.push('\n');
        }
    }
    (en_tete, code, blocs)
}

/// Lit quatre nombres : `0 0 500 500`.
fn lire_boite(valeur: &str) -> Option<(f64, f64, f64, f64)> {
    let nombres: Vec<f64> = valeur
        .split_whitespace()
        .take(6)
        .filter_map(|v| v.parse::<f64>().ok())
        .collect();
    if nombres.len() < 4 {
        return None;
    }
    let (x0, y0, x1, y1) = (nombres[0], nombres[1], nombres[2], nombres[3]);
    if !(x0.is_finite() && y0.is_finite() && x1.is_finite() && y1.is_finite()) {
        return None;
    }
    Some((x0, y0, x1, y1))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnaitre_les_saveurs() {
        assert_eq!(reconnaitre(b"%!PS-Adobe-3.0 EPSF-3.0"), Saveur::PostScript);
        assert_eq!(reconnaitre(b"%!"), Saveur::PostScript);
        assert_eq!(reconnaitre(b"%PDF-1.6"), Saveur::Pdf { version: 1 });
        assert_eq!(reconnaitre(b"%PDF-2.0"), Saveur::Pdf { version: 2 });
        assert_eq!(reconnaitre(b"PK\x03\x04"), Saveur::Archive);
        assert_eq!(reconnaitre(b"\x89PNG"), Saveur::Inconnnue);
        assert_eq!(reconnaitre(b""), Saveur::Inconnnue);
        assert_eq!(reconnaitre(b"%"), Saveur::Inconnnue);
    }

    #[test]
    fn en_tete_complet() {
        let source = "%!PS-Adobe-3.0 EPSF-3.0\n\
                      %%Creator: fixture simple\n\
                      %%Title: un dessin\n\
                      %%CreationDate: 2026-01-01\n\
                      %%BoundingBox: 0 0 500 500\n\
                      %%HiResBoundingBox: 0.5 0.5 499.5 499.5\n\
                      %%Pages: 1\n\
                      %%EndComments\n\
                      0 0 moveto\n";
        let (en_tete, code, blocs) = decouper(source);
        assert_eq!(en_tete.version.as_deref(), Some("PS-Adobe-3.0 EPSF-3.0"));
        assert!(en_tete.est_eps);
        assert_eq!(en_tete.createur.as_deref(), Some("fixture simple"));
        assert_eq!(en_tete.titre.as_deref(), Some("un dessin"));
        assert_eq!(en_tete.date.as_deref(), Some("2026-01-01"));
        assert_eq!(en_tete.bounding_box, Some((0.0, 0.0, 500.0, 500.0)));
        assert_eq!(
            en_tete.bounding_box_haute_resolution,
            Some((0.5, 0.5, 499.5, 499.5))
        );
        assert_eq!(en_tete.pages_annoncees, Some(1));
        assert_eq!(blocs, 0);
        // La haute résolution est préférée.
        assert_eq!(en_tete.boite_utile(), Some((0.5, 0.5, 499.5, 499.5)));
        assert_eq!(en_tete.dimensions(), Some((499.0, 499.0)));
        assert!(code.contains("0 0 moveto"));
    }

    #[test]
    fn bloc_apercu_saute_le_piege_du_format() {
        // Le contenu d'un aperçu est de l'hexadécimal en clair, sur des lignes
        // qui NE commencent PAS par `%`. Sans le découpage DSC, ces lignes se
        // lisent comme des noms PostScript.
        let source = "%!PS-Adobe-3.0 EPSF-3.0\n\
                      %%BoundingBox: 0 0 10 10\n\
                      %%BeginPreview: 10 10 1 10\n\
                      % A5A5A5A5A5A5A5A5A5A5A5A5\n\
                      A5A5A5A5A5A5A5A5A5A5A5A5\n\
                      %%EndPreview\n\
                      newpath 0 0 moveto 10 10 lineto stroke\n";
        let (en_tete, code, blocs) = decouper(source);
        assert_eq!(blocs, 1);
        assert!(
            !code.contains("A5A5A5"),
            "l'aperçu ne doit pas rester dans le code"
        );
        assert!(code.contains("moveto"));
        assert_eq!(en_tete.bounding_box, Some((0.0, 0.0, 10.0, 10.0)));
    }

    #[test]
    fn bloc_binaire_saute() {
        let source =
            "%!PS-Adobe-3.0 EPSF-3.0\n%%BeginBinary: 100\n\x01\x02\x03\n%%EndBinary\n1 1 add\n";
        let (_, code, blocs) = decouper(source);
        assert_eq!(blocs, 1);
        assert!(code.contains("1 1 add"));
    }

    #[test]
    fn bloc_de_police_saute() {
        let source =
            "%!PS-Adobe-3.0 EPSF-3.0\n%%BeginFont: Helvetica\n/font+2 def\n%%EndFont\n1 1 add\n";
        let (_, code, blocs) = decouper(source);
        assert_eq!(blocs, 1);
        assert!(!code.contains("font+2"));
    }

    #[test]
    fn commentaires_illustrator_releves() {
        let source = "%!PS-Adobe-3.0 EPSF-3.0\n\
                      %%Creator: Adobe Illustrator(R) 27.0\n\
                      %%EndComments\n\
                      %AI5_FileFormat 14.0\n\
                      %%BeginProlog\n/Adobe_Illustrator 1 def\n%%EndProlog\n\
                      /m /moveto load def\n";
        let (en_tete, code, _) = decouper(source);
        assert_eq!(
            en_tete.createur.as_deref(),
            Some("Adobe Illustrator(R) 27.0")
        );
        assert!(
            en_tete
                .commentaires_illustrator
                .iter()
                .any(|c| c.contains("AI5_FileFormat")),
            "{:?}",
            en_tete.commentaires_illustrator
        );
        // Le prologue reste dans le code : c'est lui qui définit les alias.
        assert!(code.contains("/Adobe_Illustrator 1 def"));
        assert!(code.contains("/m /moveto load def"));
    }

    #[test]
    fn en_tete_sans_boite() {
        let (en_tete, _, _) = decouper("%!PS-Adobe-3.0\n%%EndComments\n");
        assert!(en_tete.bounding_box.is_none());
        assert!(en_tete.boite_utile().is_none());
        assert!(en_tete.dimensions().is_none());
        assert!(en_tete.dimensions_mm().is_none());
    }

    #[test]
    fn boite_atend() {
        // `%%BoundingBox: (atend)` : la vraie boîte est à la fin, et
        // l'analyseur ne la voit pas ici. On le dit plutôt que de deviner.
        let (en_tete, _, _) = decouper("%!PS-Adobe-3.0\n%%BoundingBox: (atend)\n%%EndComments\n");
        assert!(en_tete.bounding_box.is_none());
    }

    #[test]
    fn dimensions_en_millimetres() {
        let (en_tete, _, _) = decouper("%!PS-Adobe-3.0\n%%BoundingBox: 0 0 595.2755905511812 841.8897637795277\n%%EndComments\n");
        let (largeur, hauteur) = en_tete.dimensions_mm().unwrap();
        assert!((largeur - 210.0).abs() < 0.01, "{largeur}");
        assert!((hauteur - 297.0).abs() < 0.01, "{hauteur}");
    }

    #[test]
    fn boite_invalide_refusee() {
        assert!(lire_boite("0 0 500").is_none());
        assert!(lire_boite("a b c d").is_none());
        assert!(lire_boite("").is_none());
        assert_eq!(lire_boite("0 0 500 500"), Some((0.0, 0.0, 500.0, 500.0)));
        assert_eq!(
            lire_boite("-10 -10 10 10"),
            Some((-10.0, -10.0, 10.0, 10.0))
        );
    }
}
