//! Table `name` : les **noms lisibles** de la police.
//!
//! Les identifiants de nom qui nous servent :
//!
//! | id | contenu |
//! |---|---|
//! | 1 | famille (« IBM Plex Sans ») |
//! | 2 | style (« Bold Italic ») |
//! | 6 | nom PostScript (« IBMPlexSans-BoldItalic ») |
//!
//! Le même nom est souvent stocké **plusieurs fois**, une fois par plateforme.
//! On préfère la chaîne Windows en **UTF-16BE** (celle qui porte les accents de
//! « Clémence »), et on retombe sur la chaîne Macintosh en Latin-1 à défaut.

use crate::sfnt::TableDirectory;
use crate::FontError;

/// Les noms déclarés par la police.
#[derive(Clone, Debug, Default)]
pub struct Names {
    entrees: Vec<(u16, String)>,
}

impl Names {
    /// Lit la table `name`.
    ///
    /// # Erreurs
    ///
    /// [`FontError`] si la table est absente ou tronquée. L'appelant peut
    /// l'ignorer : [`Names::default`] donne des noms vides, et la façade de
    /// police a des replis.
    pub fn parse(data: &[u8], dir: &TableDirectory) -> Result<Self, FontError> {
        let table = dir.require(data, "name")?;
        let count = usize::from(table.u16(2)?);
        let string_offset = usize::from(table.u16(4)?);

        let mut entrees: Vec<(u16, String)> = Vec::with_capacity(count);
        for index in 0..count {
            let base = 6 + index * 12;
            let platform = table.u16(base)?;
            let name_id = table.u16(base + 6)?;
            let length = usize::from(table.u16(base + 8)?);
            let offset = usize::from(table.u16(base + 10)?);

            let brut = match table.slice(string_offset + offset, length) {
                Ok(brut) => brut,
                // Une entrée qui dépasse est ignorée plutôt que fatale : un nom
                // manquant ne doit pas empêcher d'utiliser la police.
                Err(_) => continue,
            };

            let texte = match platform {
                3 => decoder_utf16be(brut),
                // Macintosh : Mac Roman. On lit les octets comme du Latin-1, ce
                // qui est exact pour l'ASCII et proche pour le reste — les noms
                // PostScript sont de toute façon en ASCII.
                _ => brut.iter().map(|&b| b as char).collect(),
            };

            if !texte.trim().is_empty() {
                entrees.push((name_id, texte));
            }
        }

        // Les chaînes Windows passent devant : on les place en tête, si bien que
        // la première correspondance trouvée est la bonne.
        entrees.sort_by_key(|(_, _)| 0);
        Ok(Self { entrees })
    }

    /// Le premier nom non vide parmi les identifiants donnés.
    ///
    /// L'ordre des identifiants fait la priorité : passer `&[1]` demande la
    /// famille, `&[6]` le nom PostScript.
    #[must_use]
    pub fn first_non_empty(&self, ids: &[u16]) -> Option<String> {
        for id in ids {
            if let Some((_, texte)) = self.entrees.iter().find(|(entree, _)| entree == id) {
                return Some(texte.clone());
            }
        }
        None
    }
}

/// Décode une chaîne UTF-16 **gros-boutiste**.
///
/// Un octet final orphelin est ignoré plutôt que de produire un caractère de
/// remplacement : les tables `name` sont parfois coupées au milieu d'une paire.
fn decoder_utf16be(octets: &[u8]) -> String {
    let unites: Vec<u16> = octets
        .chunks_exact(2)
        .map(|paire| u16::from_be_bytes([paire[0], paire[1]]))
        .collect();
    String::from_utf16_lossy(&unites)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn utf16be_accentue() {
        // « Café » en UTF-16BE.
        let octets = [0x00, 0x43, 0x00, 0x61, 0x00, 0x66, 0x00, 0xE9];
        assert_eq!(decoder_utf16be(&octets), "Café");
    }

    #[test]
    fn utf16be_octet_orphelin_ignore() {
        let octets = [0x00, 0x41, 0x00];
        assert_eq!(decoder_utf16be(&octets), "A");
    }

    #[test]
    fn utf16be_vide() {
        assert_eq!(decoder_utf16be(&[]), "");
    }

    #[test]
    fn priorite_par_identifiant() {
        let noms = Names {
            entrees: vec![
                (1, "Famille".to_string()),
                (2, "Bold".to_string()),
                (6, "Famille-Bold".to_string()),
            ],
        };
        assert_eq!(noms.first_non_empty(&[1]), Some("Famille".to_string()));
        assert_eq!(noms.first_non_empty(&[6]), Some("Famille-Bold".to_string()));
        assert_eq!(
            noms.first_non_empty(&[4, 1]),
            Some("Famille".to_string()),
            "le premier identifiant présent gagne"
        );
        assert_eq!(noms.first_non_empty(&[99]), None);
    }
}
