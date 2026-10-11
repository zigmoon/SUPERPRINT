//! Table `cmap` : correspondance **caractère Unicode → identifiant de glyphe**.
//!
//! C'est la table qui décide quel dessin afficher pour un caractère. Un PDF en
//! `Identity-H` n'écrit pas des caractères : il écrit des **identifiants de
//! glyphe**. Sans cette table, on ne saurait pas que `é` est le glyphe 231 d'une
//! police donnée.
//!
//! Le format laisse coexister plusieurs sous-tables, une par plateforme et par
//! encodage. On choisit la **meilleure**, dans cet ordre :
//!
//! 1. `(3, 10)` Windows / UCS-4 — format 12, couvre tout Unicode ;
//! 2. `(3, 1)` Windows / BMP — format 4, le cas courant ;
//! 3. `(0, *)` Unicode — format 4 ou 12 selon la sous-table ;
//! 4. `(1, 0)` Macintosh / Roman — format 0 ou 6.
//!
//! Formats lus : 0 (octets), 4 (segments), 6 (table tronquée), 12 (groupes).

use crate::sfnt::{Reader, TableDirectory};
use crate::FontError;

/// Les sous-tables lues, dans l'ordre de préférence.
#[derive(Clone, Debug, Default)]
pub struct Cmap {
    /// Sous-tables exploitables, triées par préférence décroissante.
    sous_tables: Vec<SousTable>,
}

#[derive(Clone, Copy, Debug)]
struct SousTable {
    format: u16,
    /// Décalage absolu, dans les octets de la police.
    absolute: usize,
    preference: u8,
}

impl Cmap {
    /// Lit la table `cmap` et retient la meilleure sous-table.
    ///
    /// # Erreurs
    ///
    /// [`FontError::MissingTable`] si `cmap` est absente,
    /// [`FontError::CmapUnsupported`] si aucun format exploitable n'est présent.
    pub fn parse(data: &[u8], dir: &TableDirectory) -> Result<Self, FontError> {
        let table = dir.require(data, "cmap")?;
        let base = dir
            .find(b"cmap")
            .map(|(offset, _)| offset)
            .ok_or(FontError::MissingTable { tag: "cmap" })?;

        let count = usize::from(table.u16(2)?);
        let mut sous_tables = Vec::with_capacity(count);
        for index in 0..count {
            let base_record = 4 + index * 8;
            let platform = table.u16(base_record)?;
            let encoding = table.u16(base_record + 2)?;
            let relative = table.u32(base_record + 4)? as usize;
            let absolute = base.checked_add(relative).ok_or(FontError::Truncated {
                offset: relative,
                len: 2,
            })?;
            let format = Reader::new(data).u16(absolute)?;
            if let Some(preference) = preference(platform, encoding, format) {
                sous_tables.push(SousTable {
                    format,
                    absolute,
                    preference,
                });
            }
        }

        if sous_tables.is_empty() {
            return Err(FontError::CmapUnsupported { format: 0 });
        }
        sous_tables.sort_by_key(|s| s.preference);
        Ok(Self { sous_tables })
    }

    /// L'identifiant de glyphe d'un caractère, ou `None` s'il n'y en a pas.
    ///
    /// `None` n'est pas une erreur : une police latine ne dessine pas le
    /// japonais. L'appelant décide quoi faire — ce crate ne décide pas à sa
    /// place, et il ne doit surtout pas inventer un glyphe.
    #[must_use]
    pub fn glyph_id(&self, data: &[u8], caractere: char) -> Option<u16> {
        let code = u32::from(caractere);
        let reader = Reader::new(data);
        for table in &self.sous_tables {
            let trouve = match table.format {
                0 => lire_format_0(&reader, table.absolute, code),
                4 => lire_format_4(&reader, table.absolute, code),
                6 => lire_format_6(&reader, table.absolute, code),
                12 => lire_format_12(&reader, table.absolute, code),
                _ => None,
            };
            if let Some(gid) = trouve.filter(|g| *g != 0) {
                return Some(gid);
            }
        }
        None
    }

    /// Le format de la sous-table réellement retenue (utile aux diagnostics).
    #[must_use]
    pub fn format_choisi(&self) -> u16 {
        self.sous_tables.first().map(|s| s.format).unwrap_or(0)
    }
}

/// Note de préférence d'une sous-table : plus petit = meilleur ; `None` = ignorée.
fn preference(platform: u16, encoding: u16, format: u16) -> Option<u8> {
    let lisible = matches!(format, 0 | 4 | 6 | 12);
    if !lisible {
        return None;
    }
    match (platform, encoding) {
        (3, 10) if format == 12 => Some(0),
        (3, 1) if format == 4 => Some(1),
        (0, _) => Some(2),
        (1, 0) => Some(3),
        (3, 0) if format == 4 => Some(4), // symbole
        _ => None,
    }
}

/// Format 0 : 256 octets, un identifiant par octet.
fn lire_format_0(reader: &Reader<'_>, base: usize, code: u32) -> Option<u16> {
    if code > 255 {
        return None;
    }
    let gid = reader.u8(base + 6 + code as usize).ok()?;
    Some(u16::from(gid))
}

/// Format 6 : plage contiguë `firstCode` + tableau d'identifiants.
fn lire_format_6(reader: &Reader<'_>, base: usize, code: u32) -> Option<u16> {
    let first = u32::from(reader.u16(base + 6).ok()?);
    let count = u32::from(reader.u16(base + 8).ok()?);
    if code < first || code >= first + count {
        return None;
    }
    reader.u16(base + 10 + 2 * (code - first) as usize).ok()
}

/// Format 4 : segments, la forme la plus répandue.
///
/// L'arithmétique est délicate — c'est le passage où l'on calcule soi-même
/// l'adresse d'une entrée. La spécification OpenType définit
/// `idRangeOffset` comme un décalage depuis **l'adresse de l'entrée
/// `idRangeOffset` elle-même** :
///
/// ```text
/// adresseGlyphe = adresse(idRangeOffset[i]) + idRangeOffset[i] + 2·(c − startCode[i])
/// ```
///
/// Ce n'est donc **pas** un décalage depuis le début de la table `cmap` — s'en
/// tromper ne provoque pas de plantage, mais renvoie un glyphe faux. D'où les
/// tests.
fn lire_format_4(reader: &Reader<'_>, base: usize, code: u32) -> Option<u16> {
    if code > 0xFFFF {
        return None;
    }
    let code = code as u16;
    let seg_count = reader.u16(base + 6).ok()? / 2;
    if seg_count == 0 {
        return None;
    }

    let end_codes = base + 14;
    let start_codes = end_codes + 2 * usize::from(seg_count) + 2; // +2 : reservedPad
    let id_deltas = start_codes + 2 * usize::from(seg_count);
    let id_range_offsets = id_deltas + 2 * usize::from(seg_count);

    // Recherche du premier segment dont `endCode` atteint le caractère.
    let mut segment = None;
    for index in 0..usize::from(seg_count) {
        if reader.u16(end_codes + 2 * index).ok()? >= code {
            segment = Some(index);
            break;
        }
    }
    let index = segment?;

    let start = reader.u16(start_codes + 2 * index).ok()?;
    if code < start {
        return None;
    }

    let delta = reader.i16(id_deltas + 2 * index).ok()?;
    let range_offset = reader.u16(id_range_offsets + 2 * index).ok()?;

    let gid = if range_offset == 0 {
        code.wrapping_add(delta as u16)
    } else {
        // L'adresse du glyphe est comptée depuis l'entrée elle-même.
        let ici = id_range_offsets + 2 * index;
        let adresse = ici
            .wrapping_add(usize::from(range_offset))
            .wrapping_add(2 * usize::from(code - start));
        let brut = reader.u16(adresse).ok()?;
        if brut == 0 {
            return None;
        }
        brut.wrapping_add(delta as u16)
    };

    (gid != 0).then_some(gid)
}

/// Format 12 : groupes `[premier caractère, dernier, premier glyphe]`.
///
/// C'est la sous-table qui couvre au-delà du plan multilingue de base — donc le
/// seul format capable de dire où se trouve un idéogramme.
fn lire_format_12(reader: &Reader<'_>, base: usize, code: u32) -> Option<u16> {
    let groupes = reader.u32(base + 12).ok()? as usize;
    if groupes == 0 {
        return None;
    }

    // Recherche dichotomique : les groupes sont ordonnés par caractère croissant,
    // et un idéogramme se trouve dans une table de plusieurs milliers d'entrées.
    let (mut bas, mut haut) = (0usize, groupes);
    while bas < haut {
        let milieu = (bas + haut) / 2;
        let entree = base + 16 + milieu * 12;
        let debut = reader.u32(entree).ok()?;
        let fin = reader.u32(entree + 4).ok()?;
        if code < debut {
            haut = milieu;
        } else if code > fin {
            bas = milieu + 1;
        } else {
            let premier = reader.u32(entree + 8).ok()?;
            let gid = premier.checked_add(code - debut)?;
            return u16::try_from(gid).ok().filter(|g| *g != 0);
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Construit une table `cmap` à une seule sous-table d'encodage `(3, 1)`.
    fn cmap_format_4(segments: &[(u16, u16, i16, Vec<u16>)]) -> (Vec<u8>, usize) {
        let seg_count = segments.len();
        // En-tête cmap : version, nbTables, puis un enregistrement (3, 1).
        let mut cmap = Vec::new();
        cmap.extend_from_slice(&0u16.to_be_bytes()); // version
        cmap.extend_from_slice(&1u16.to_be_bytes()); // nbTables
        cmap.extend_from_slice(&3u16.to_be_bytes()); // platformID
        cmap.extend_from_slice(&1u16.to_be_bytes()); // encodingID
        cmap.extend_from_slice(&12u32.to_be_bytes()); // décalage de la sous-table

        let sous_table_debut = cmap.len();
        cmap.extend_from_slice(&4u16.to_be_bytes()); // format
        let longueur_position = cmap.len();
        cmap.extend_from_slice(&0u16.to_be_bytes()); // longueur, remplie plus bas
        cmap.extend_from_slice(&0u16.to_be_bytes()); // language
        cmap.extend_from_slice(&(seg_count as u16 * 2).to_be_bytes()); // segCountX2
        cmap.extend_from_slice(&[0, 0, 0, 0, 0, 0]); // searchRange/entrySelector/rangeShift

        for (_, fin, _, _) in segments {
            cmap.extend_from_slice(&fin.to_be_bytes());
        }
        cmap.extend_from_slice(&0u16.to_be_bytes()); // reservedPad
        for (debut, _, _, _) in segments {
            cmap.extend_from_slice(&debut.to_be_bytes());
        }
        for (_, _, delta, _) in segments {
            cmap.extend_from_slice(&delta.to_be_bytes());
        }

        // `idRangeOffset` : 0 si le segment n'utilise pas `glyphIdArray`, sinon
        // le décalage de son tableau depuis l'entrée elle-même.
        let position_id_range_offsets = cmap.len();
        let position_glyph_id_array = position_id_range_offsets + 2 * seg_count;
        for (index, (_, _, _, ids)) in segments.iter().enumerate() {
            if ids.is_empty() {
                cmap.extend_from_slice(&0u16.to_be_bytes());
            } else {
                let entree = position_id_range_offsets + 2 * index;
                // L'entrée doit pointer sur le début de SA plage dans le tableau.
                let decalage_depuis_ici = (position_glyph_id_array - entree) as i32;
                cmap.extend_from_slice(&(decalage_depuis_ici as u16).to_be_bytes());
            }
        }
        for (_, _, _, ids) in segments {
            for id in ids {
                cmap.extend_from_slice(&id.to_be_bytes());
            }
        }

        let longueur = (cmap.len() - sous_table_debut) as u16;
        cmap[longueur_position..longueur_position + 2].copy_from_slice(&longueur.to_be_bytes());
        (cmap, sous_table_debut)
    }

    fn lire(cmap: &[u8], sous_table: usize, code: u32) -> Option<u16> {
        let reader = Reader::new(cmap);
        lire_format_4(&reader, sous_table, code)
    }

    #[test]
    fn format_4_avec_id_delta() {
        // Deux segments : 0x20–0x7E décalés vers les glyphes 3.., puis 0xFFFF.
        let (cmap, base) = cmap_format_4(&[
            (0x20, 0x7E, (3i16).wrapping_sub(0x20), vec![]),
            (0xFFFF, 0xFFFF, 1, vec![]),
        ]);
        assert_eq!(lire(&cmap, base, 0x20), Some(3));
        assert_eq!(lire(&cmap, base, 0x41), Some(0x41 - 0x20 + 3));
        assert_eq!(lire(&cmap, base, 0x7E), Some(0x7E - 0x20 + 3));
        // Hors des segments couverts.
        assert_eq!(lire(&cmap, base, 0x100), None);
        assert_eq!(
            lire(&cmap, base, 0xFFFF),
            None,
            "le segment sentinelle ne renvoie rien"
        );
    }

    #[test]
    fn format_4_avec_glyph_id_array() {
        // Un segment dont les identifiants ne suivent PAS la progression.
        let (cmap, base) = cmap_format_4(&[
            (0x30, 0x32, 0, vec![10, 0, 30]),
            (0xFFFF, 0xFFFF, 1, vec![]),
        ]);
        assert_eq!(lire(&cmap, base, 0x30), Some(10));
        assert_eq!(
            lire(&cmap, base, 0x31),
            None,
            "un zéro dans la table = pas de glyphe"
        );
        assert_eq!(lire(&cmap, base, 0x32), Some(30));
    }

    #[test]
    fn format_0_lit_un_octet() {
        let mut data = vec![0u8; 262];
        data[0..2].copy_from_slice(&0u16.to_be_bytes());
        // Le tableau commence à l'offset 6.
        data[6 + 65] = 7;
        let reader = Reader::new(&data);
        assert_eq!(lire_format_0(&reader, 0, 65), Some(7));
        assert_eq!(lire_format_0(&reader, 0, 300), None, "au-delà d'un octet");
    }

    #[test]
    fn format_6_plage_contigue() {
        let mut data = vec![0u8; 32];
        data[0..2].copy_from_slice(&6u16.to_be_bytes());
        data[6..8].copy_from_slice(&100u16.to_be_bytes()); // firstCode
        data[8..10].copy_from_slice(&3u16.to_be_bytes()); // entryCount
        for (index, gid) in [11u16, 12, 13].iter().enumerate() {
            let p = 10 + index * 2;
            data[p..p + 2].copy_from_slice(&gid.to_be_bytes());
        }
        let reader = Reader::new(&data);
        assert_eq!(lire_format_6(&reader, 0, 100), Some(11));
        assert_eq!(lire_format_6(&reader, 0, 102), Some(13));
        assert_eq!(lire_format_6(&reader, 0, 103), None);
        assert_eq!(lire_format_6(&reader, 0, 99), None);
    }

    #[test]
    fn format_12_groupes_et_dichotomie() {
        let mut data = vec![0u8; 64];
        data[0..2].copy_from_slice(&12u16.to_be_bytes());
        data[12..16].copy_from_slice(&2u32.to_be_bytes()); // nGroups
                                                           // Groupe 1 : U+0041 – U+005A → glyphes 100..
        data[16..20].copy_from_slice(&0x41u32.to_be_bytes());
        data[20..24].copy_from_slice(&0x5Au32.to_be_bytes());
        data[24..28].copy_from_slice(&100u32.to_be_bytes());
        // Groupe 2 : U+3042 – U+3044 → glyphes 900..
        data[28..32].copy_from_slice(&0x3042u32.to_be_bytes());
        data[32..36].copy_from_slice(&0x3044u32.to_be_bytes());
        data[36..40].copy_from_slice(&900u32.to_be_bytes());

        let reader = Reader::new(&data);
        assert_eq!(lire_format_12(&reader, 0, 0x41), Some(100));
        // 0x5A − 0x41 = 25, donc le 26ᵉ glyphe du groupe.
        assert_eq!(lire_format_12(&reader, 0, 0x5A), Some(125));
        assert_eq!(lire_format_12(&reader, 0, 0x3044), Some(902));
        assert_eq!(lire_format_12(&reader, 0, 0x42), Some(101));
        assert_eq!(lire_format_12(&reader, 0, 0x40), None);
        assert_eq!(lire_format_12(&reader, 0, 0x60), None);
    }

    #[test]
    fn preference_choisit_ucs4_avant_bmp() {
        // (3, 10) est préférée à (3, 1), quel que soit l'ordre du fichier.
        assert!(preference(3, 10, 12) < preference(3, 1, 4));
        assert!(preference(3, 1, 4) < preference(0, 3, 4));
        assert!(preference(0, 3, 4) < preference(1, 0, 0));
        // Un format illisible est écarté.
        assert_eq!(preference(3, 1, 2), None);
        assert_eq!(
            preference(3, 10, 4),
            None,
            "UCS-4 en format 4 n'a pas de sens"
        );
    }
}
