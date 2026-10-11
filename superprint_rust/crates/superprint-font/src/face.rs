//! La **façade** d'une police TrueType : ce qu'un moteur de mise en page a
//! besoin de savoir, et rien de plus.
//!
//! On n'analyse **pas les contours** : le fichier est embarqué tel quel dans le
//! PDF (`/FontFile2`), et un lecteur y retrouve les dessins. Ce dont on a besoin,
//! c'est de la **correspondance caractère → glyphe** (table `cmap`) et des
//! **largeurs d'avance** (table `hmtx`) — sans elles, impossible de savoir où
//! placer le caractère suivant.
//!
//! ## Unités
//!
//! Les tables expriment les distances en **unités de police** (`unitsPerEm`,
//! souvent 1000 ou 2048). Le PDF, lui, attend des **unités de texte** sur une
//! base de 1000. Toute la conversion vit ici, en un seul endroit :
//! [`FontFace::unites1000`].

use crate::cmap::Cmap;
use crate::sfnt::TableDirectory;
use crate::FontError;

/// Une police prête à être embarquée et à recevoir du texte.
#[derive(Clone, Debug)]
pub struct FontFace {
    /// Les octets du fichier, tels quels : c'est ce qui sera embarqué.
    pub data: Vec<u8>,
    /// Nom de famille (`name` id 1).
    pub family: String,
    /// Style (`name` id 2), p. ex. « Regular », « Bold Italic ».
    pub subfamily: String,
    /// Nom PostScript (`name` id 6), ou un repli tiré du nom de famille.
    pub postscript_name: String,
    /// Unités par cadratin de la police.
    pub units_per_em: u16,
    /// Nombre de glyphes déclarés.
    pub num_glyphs: u16,
    /// Montée (en unités de police).
    pub ascent: i16,
    /// Descente (en unités de police).
    pub descent: i16,
    /// Hauteur de capitale, si la police la déclare.
    pub cap_height: i16,
    /// Cadre englobant `[xMin, yMin, xMax, yMax]`.
    pub bbox: [i16; 4],
    /// Angle d'inclinaison, en degrés (négatif = penché à droite).
    pub italic_angle: f64,
    /// Police à chasse fixe (table `post`).
    pub fixed_pitch: bool,
    /// Style gras déclaré.
    pub bold: bool,
    /// Style italique déclaré.
    pub italic: bool,
    /// La table de correspondance retenue.
    cmap: Cmap,
    /// Avance par glyphe, en unités de police.
    advances: Vec<u16>,
}

impl FontFace {
    /// Analyse une police TrueType.
    ///
    /// # Erreurs
    ///
    /// [`FontError`] : signature inconnue, format non pris en charge, table
    /// manquante, fichier tronqué. Un fichier de police vient du disque de
    /// l'utilisateur : il est traité comme une entrée non fiable.
    pub fn parse(data: Vec<u8>) -> Result<Self, FontError> {
        let dir = TableDirectory::parse(&data)?;

        // `head` : unités, cadre, style.
        let head = dir.require(&data, "head")?;
        let units_per_em = head.u16(18)?;
        if units_per_em == 0 {
            return Err(FontError::BadValue {
                table: "head",
                champ: "unitsPerEm nul",
            });
        }
        let mac_style = head.u16(44)?;
        let bbox = [head.i16(36)?, head.i16(38)?, head.i16(40)?, head.i16(42)?];

        // `maxp` : nombre de glyphes.
        let maxp = dir.require(&data, "maxp")?;
        let num_glyphs = maxp.u16(4)?;
        if num_glyphs == 0 {
            return Err(FontError::BadValue {
                table: "maxp",
                champ: "numGlyphs nul",
            });
        }

        // `hhea` + `hmtx` : les avances.
        let hhea = dir.require(&data, "hhea")?;
        let ascent = hhea.i16(4)?;
        let descent = hhea.i16(6)?;
        let metrics_count = usize::from(hhea.u16(34)?);
        if metrics_count == 0 {
            return Err(FontError::BadValue {
                table: "hhea",
                champ: "numberOfHMetrics nul",
            });
        }
        let hmtx = dir.require(&data, "hmtx")?;
        let mut advances = Vec::with_capacity(usize::from(num_glyphs));
        let mut derniere = 0u16;
        for gid in 0..usize::from(num_glyphs) {
            if gid < metrics_count {
                derniere = hmtx.u16(gid * 4)?;
            }
            // Au-delà de `numberOfHMetrics`, la dernière avance se répète :
            // c'est la compression prévue par le format, pas une approximation.
            advances.push(derniere);
        }

        // `post` : italique et chasse fixe. Facultative.
        let (italic_angle, fixed_pitch) = match dir.require(&data, "post") {
            Ok(post) => (post.fixed(4)?, post.u32(12)? != 0),
            Err(_) => (0.0, false),
        };

        // `OS/2` : styles et hauteur de capitale. Facultative aussi.
        let (bold_os2, italic_os2, cap_height) = match dir.require(&data, "OS/2") {
            Ok(os2) => {
                let version = os2.u16(0)?;
                let fs_selection = os2.u16(62)?;
                let cap = if version >= 2 { os2.i16(88)? } else { ascent };
                (
                    fs_selection & 0x20 != 0, // fsSelection : gras
                    fs_selection & 0x01 != 0, // fsSelection : italique
                    cap,
                )
            }
            Err(_) => (false, false, ascent),
        };

        // `name` : les noms lisibles. Facultative — repli sur un nom neutre.
        let noms = crate::name::Names::parse(&data, &dir).unwrap_or_default();
        let family = noms
            .first_non_empty(&[1])
            .unwrap_or_else(|| "Sans nom".into());
        let subfamily = noms.first_non_empty(&[2]).unwrap_or_default();
        let postscript_name = noms
            .first_non_empty(&[6])
            .filter(|n| !n.trim().is_empty())
            .unwrap_or_else(|| family.clone());

        let cmap = Cmap::parse(&data, &dir)?;

        Ok(Self {
            data,
            family,
            subfamily,
            postscript_name,
            units_per_em,
            num_glyphs,
            ascent,
            descent,
            cap_height,
            bbox,
            italic_angle,
            fixed_pitch,
            bold: bold_os2 || mac_style & 0x01 != 0,
            // Un angle d'inclinaison non nul suffit à dire « penché » : certaines
            // polices le déclarent là et pas dans le style.
            italic: italic_os2 || mac_style & 0x02 != 0 || italic_angle != 0.0,
            cmap,
            advances,
        })
    }

    /// Le format de la sous-table `cmap` retenue (4 pour le cas courant,
    /// 12 pour une police qui couvre au-delà du plan multilingue de base).
    ///
    /// C'est une information de diagnostic : elle dit *comment* la police a été
    /// lue, ce qu'aucun résultat de recherche ne montre.
    #[must_use]
    pub fn cmap_format(&self) -> u16 {
        self.cmap.format_choisi()
    }

    /// L'identifiant de glyphe d'un caractère, ou `None` si la police ne le
    /// dessine pas.
    #[must_use]
    pub fn glyph_id(&self, caractere: char) -> Option<u16> {
        self.cmap.glyph_id(&self.data, caractere)
    }

    /// L'identifiant de glyphe d'un caractère, avec repli sur `.notdef` (0).
    ///
    /// Renvoie `(gid, substitue)`. Le second booléen dit si un dessin a été
    /// **substitué** : c'est l'information qui permet de prévenir l'appelant
    /// qu'un caractère ne s'imprimera pas, au lieu de produire un document
    /// silencieusement incomplet.
    #[must_use]
    pub fn glyph_id_ou_notdef(&self, caractere: char) -> (u16, bool) {
        match self.glyph_id(caractere) {
            Some(gid) => (gid, false),
            None => (0, true),
        }
    }

    /// L'avance d'un glyphe, en unités de police.
    #[must_use]
    pub fn advance(&self, gid: u16) -> u16 {
        self.advances
            .get(usize::from(gid))
            .copied()
            .unwrap_or(self.advances.last().copied().unwrap_or(0))
    }

    /// L'avance d'un glyphe, en **unités de texte PDF** (base 1000).
    #[must_use]
    pub fn advance1000(&self, gid: u16) -> u16 {
        self.unites1000(u32::from(self.advance(gid)))
    }

    /// Convertit une distance en unités de police vers la base 1000 du PDF.
    ///
    /// L'arrondi est **au plus proche** : tronquer ferait dériver la longueur
    /// cumulative d'une ligne, caractère après caractère.
    #[must_use]
    pub fn unites1000(&self, valeur: u32) -> u16 {
        let mille = u64::from(valeur) * 1000;
        let diviseur = u64::from(self.units_per_em);
        let arrondi = (mille + diviseur / 2) / diviseur;
        u16::try_from(arrondi).unwrap_or(u16::MAX)
    }

    /// Convertit une distance **signée** vers la base 1000 du PDF.
    ///
    /// Le cadre englobant et les montées/descentes sont signés : une descente
    /// négative doit le rester, sinon le descripteur décrit une police qui
    /// n'existe pas.
    #[must_use]
    pub fn unites1000_signe(&self, valeur: i32) -> i32 {
        let signe = valeur.signum();
        signe * i32::from(self.unites1000(valeur.unsigned_abs()))
    }

    /// La largeur d'une chaîne en unités de texte (base 1000), `.notdef` compris.
    ///
    /// C'est ce qui permet à l'appelant de **centrer** ou d'**aligner à droite**
    /// un texte sans mesurer lui-même.
    #[must_use]
    pub fn largeur1000(&self, texte: &str) -> u32 {
        texte
            .chars()
            .map(|c| u32::from(self.advance1000(self.glyph_id_ou_notdef(c).0)))
            .sum()
    }

    /// Le nom à écrire dans le PDF : nettoyé des caractères interdits par le
    /// format.
    ///
    /// Un nom PostScript ne peut ni contenir d'espace ni commencer par un
    /// chiffre, et les délimiteurs y sont réservés. Plutôt que d'échapper — ce
    /// qui donnerait un nom illisible dans les diagnostics — on **remplace** les
    /// caractères fautifs, et on garantit un nom non vide.
    #[must_use]
    pub fn nom_pdf(&self) -> String {
        let nettoye: String = self
            .postscript_name
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.') {
                    c
                } else {
                    '-'
                }
            })
            .collect();
        let nettoye = nettoye.trim_matches('-').to_string();
        if nettoye.is_empty() || nettoye.starts_with(|c: char| c.is_ascii_digit()) {
            format!("SuperPrintPolice{}", self.units_per_em)
        } else {
            nettoye
        }
    }

    /// Drapeaux du descripteur de police PDF (table 5.20 de l'ISO 32000-2).
    ///
    /// On déclare `Nonsymbolic` — et jamais `Symbolic` en même temps : les deux
    /// ensemble sont contradictoires et certains contrôleurs PDF le refusent.
    #[must_use]
    pub fn drapeaux_pdf(&self) -> u32 {
        let mut drapeaux = 0x20; // Nonsymbolic
        if self.fixed_pitch {
            drapeaux |= 0x01;
        }
        if self.italic {
            drapeaux |= 0x40;
        }
        if self.bold {
            drapeaux |= 0x40000;
        }
        drapeaux
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Une longueur, convertie, ne doit jamais dériver par troncature.
    #[test]
    fn conversion_en_base_1000_arrondit() {
        // 2048 unités par cadratin : 1024 unités = exactement 500.
        let face = face_de_test(2048);
        assert_eq!(face.unites1000(1024), 500);
        assert_eq!(face.unites1000(2048), 1000);
        assert_eq!(face.unites1000(0), 0);
        // 1 unité sur 2048 vaut 0,49 : l'arrondi donne 0, pas 1.
        assert_eq!(face.unites1000(1), 0);
        // 2 unités sur 2048 valent 0,98 : l'arrondi donne 1.
        assert_eq!(face.unites1000(2), 1);
        // Une valeur énorme sature au lieu de déborder.
        assert_eq!(face.unites1000(u32::MAX), u16::MAX);
    }

    #[test]
    fn mille_unites_par_cadratin_est_l_identite() {
        let face = face_de_test(1000);
        for v in [0u32, 1, 250, 500, 999, 1000, 65535] {
            assert_eq!(u32::from(face.unites1000(v)), v.min(u32::from(u16::MAX)));
        }
    }

    #[test]
    fn nom_pdf_nettoye() {
        let mut face = face_de_test(1000);
        face.postscript_name = "IBM Plex Sans".to_string();
        assert_eq!(face.nom_pdf(), "IBM-Plex-Sans");

        face.postscript_name = "   ".to_string();
        assert_eq!(face.nom_pdf(), "SuperPrintPolice1000");

        face.postscript_name = "1Police".to_string();
        assert!(
            !face.nom_pdf().starts_with('1'),
            "un nom PostScript ne peut pas commencer par un chiffre"
        );

        face.postscript_name = "Pol/ice#.".to_string();
        assert_eq!(face.nom_pdf(), "Pol-ice-.");
    }

    #[test]
    fn drapeaux_jamais_symbolique_et_nonsymbolique_ensemble() {
        let mut face = face_de_test(1000);
        face.fixed_pitch = true;
        face.italic = true;
        face.bold = true;
        let drapeaux = face.drapeaux_pdf();
        assert_eq!(drapeaux & 0x20, 0x20, "Nonsymbolic");
        assert_eq!(drapeaux & 0x04, 0, "Symbolic ne doit pas être posé");
        assert_eq!(drapeaux & 0x01, 0x01, "FixedPitch");
        assert_eq!(drapeaux & 0x40, 0x40, "Italic");
        assert_eq!(drapeaux & 0x40000, 0x40000, "ForceBold");
    }

    #[test]
    fn avance_au_dela_de_number_of_h_metrics() {
        let mut face = face_de_test(1000);
        face.advances = vec![500, 600, 700];
        assert_eq!(face.advance(0), 500);
        assert_eq!(face.advance(2), 700);
        // Au-delà : la dernière se répète, comme le veut le format.
        assert_eq!(face.advance(9), 700);
    }

    #[test]
    fn largeur_d_une_chaine_somme_les_avances() {
        let mut face = face_de_test(1000);
        face.advances = vec![250, 500, 600];
        // Trois caractères : par défaut, `glyph_id_ou_notdef` rend 0 → avance 250.
        assert_eq!(face.largeur1000("abc"), 750);
        assert_eq!(face.largeur1000(""), 0);
    }

    /// Une façade minimale, sans fichier : les tests ci-dessus portent sur
    /// l'arithmétique et le nettoyage, pas sur l'analyse binaire.
    fn face_de_test(units_per_em: u16) -> FontFace {
        FontFace {
            data: Vec::new(),
            family: "Test".into(),
            subfamily: "Regular".into(),
            postscript_name: "Test".into(),
            units_per_em,
            num_glyphs: 1,
            ascent: 800,
            descent: -200,
            cap_height: 700,
            bbox: [0, -200, 1000, 800],
            italic_angle: 0.0,
            fixed_pitch: false,
            bold: false,
            italic: false,
            cmap: Cmap::default(),
            advances: vec![500],
        }
    }
}
