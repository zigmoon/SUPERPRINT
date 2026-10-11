//! Lecture binaire du format **sfnt** : en-tête, table des tables, accès borné.
//!
//! Tous les accès passent par [`Reader`], qui **vérifie les bornes** à chaque
//! lecture et rend un [`FontError::Truncated`] au lieu de paniquer. C'est la
//! règle du crate : un fichier de police est une **entrée non fiable** — il vient
//! du disque de l'utilisateur, il peut être tronqué, d'un autre format, ou
//! malveillant. Aucune lecture non vérifiée.

use crate::FontError;

/// Identifiant de table sfnt : quatre octets ASCII (`head`, `cmap`…).
pub type Tag = [u8; 4];

/// Un lecteur borné sur les octets d'une police.
#[derive(Clone, Copy)]
pub struct Reader<'a> {
    data: &'a [u8],
}

impl<'a> Reader<'a> {
    /// Ouvre une vue sur les octets.
    #[must_use]
    pub fn new(data: &'a [u8]) -> Self {
        Self { data }
    }

    /// Longueur totale.
    #[must_use]
    pub fn len(&self) -> usize {
        self.data.len()
    }

    /// Vrai si la vue est vide.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.data.is_empty()
    }

    /// Vérifie qu'une plage est entièrement contenue et la renvoie.
    ///
    /// # Erreurs
    ///
    /// [`FontError::Truncated`] si la plage dépasse les octets disponibles.
    pub fn slice(&self, offset: usize, len: usize) -> Result<&'a [u8], FontError> {
        let fin = offset
            .checked_add(len)
            .ok_or(FontError::Truncated { offset, len })?;
        if fin > self.data.len() {
            return Err(FontError::Truncated { offset, len });
        }
        Ok(&self.data[offset..fin])
    }

    /// Lit un octet non signé.
    pub fn u8(&self, offset: usize) -> Result<u8, FontError> {
        Ok(self.slice(offset, 1)?[0])
    }

    /// Lit un entier non signé de 16 bits, **gros-boutiste** (l'ordre du format).
    pub fn u16(&self, offset: usize) -> Result<u16, FontError> {
        let b = self.slice(offset, 2)?;
        Ok(u16::from_be_bytes([b[0], b[1]]))
    }

    /// Lit un entier signé de 16 bits.
    pub fn i16(&self, offset: usize) -> Result<i16, FontError> {
        Ok(self.u16(offset)? as i16)
    }

    /// Lit un entier non signé de 32 bits.
    pub fn u32(&self, offset: usize) -> Result<u32, FontError> {
        let b = self.slice(offset, 4)?;
        Ok(u32::from_be_bytes([b[0], b[1], b[2], b[3]]))
    }

    /// Lit un entier signé de 32 bits.
    pub fn i32(&self, offset: usize) -> Result<i32, FontError> {
        Ok(self.u32(offset)? as i32)
    }

    /// Lit un nombre **16.16** à virgule fixe.
    ///
    /// La partie entière est signée, la partie fractionnaire non signée : la
    /// conversion naïve par `/ 65536.0` donnerait un signe faux pour une valeur
    /// négative comme `−0.5` (`0xFFFF8000`).
    pub fn fixed(&self, offset: usize) -> Result<f64, FontError> {
        let brut = self.i32(offset)?;
        Ok(f64::from(brut) / 65536.0)
    }
}

/// Table des tables d'une police sfnt.
#[derive(Clone, Debug)]
pub struct TableDirectory {
    tables: Vec<(Tag, usize, usize)>,
}

impl TableDirectory {
    /// Lit l'en-tête et la table des tables.
    ///
    /// # Erreurs
    ///
    /// - [`FontError::BadSignature`] si le fichier n'est pas un sfnt reconnu ;
    /// - [`FontError::UnsupportedFormat`] pour un `OTTO` (OpenType/CFF), dont les
    ///   contours ne sont pas dans `glyf` : l'embarquer tel quel est possible,
    ///   mais ce crate n'en écrit pas encore les métriques de glyphe ;
    /// - [`FontError::Truncated`] si la table des tables dépasse le fichier.
    pub fn parse(data: &[u8]) -> Result<Self, FontError> {
        let reader = Reader::new(data);
        if reader.len() < 12 {
            return Err(FontError::Truncated { offset: 0, len: 12 });
        }

        let signature: Tag = reader.slice(0, 4)?.try_into().expect("quatre octets");
        match signature {
            // 0x00010000 = TrueType ; `true` = déclinaison ancienne de la pomme.
            [0x00, 0x01, 0x00, 0x00] | [b't', b'r', b'u', b'e'] => {}
            [b'O', b'T', b'T', b'O'] => {
                return Err(FontError::UnsupportedFormat {
                    raison: "OpenType à contours CFF (pas de table glyf) — fournir un TrueType",
                })
            }
            [b't', b't', b'c', b'f'] => {
                return Err(FontError::UnsupportedFormat {
                    raison: "collection de polices (.ttc) — extraire une police d'abord",
                })
            }
            [b'w', b'O', b'F', b'F'] | [b'w', b'O', b'F', b'2'] => {
                return Err(FontError::UnsupportedFormat {
                    raison: "police WOFF compressée — décompresser d'abord",
                })
            }
            autre => {
                // On montre la signature **lisible** en plus de son hexadécimal :
                // « JUNK » se reconnaît d'un coup d'œil, « [4A, 55, 4E, 4B] » non.
                let lisible: String = autre
                    .iter()
                    .map(|b| {
                        if b.is_ascii_graphic() {
                            *b as char
                        } else {
                            '.'
                        }
                    })
                    .collect();
                return Err(FontError::BadSignature {
                    signature: format!("« {lisible} » ({autre:02X?})"),
                });
            }
        }

        let count = usize::from(reader.u16(4)?);
        if reader.len() < 12 + count * 16 {
            return Err(FontError::Truncated {
                offset: 12,
                len: count * 16,
            });
        }

        let mut tables = Vec::with_capacity(count);
        for index in 0..count {
            let base = 12 + index * 16;
            let tag: Tag = reader.slice(base, 4)?.try_into().expect("quatre octets");
            let offset = reader.u32(base + 8)? as usize;
            let length = reader.u32(base + 12)? as usize;
            // Les tables peuvent se chevaucher dans un fichier malformé ; on
            // vérifie ici que chaque table tient dans le fichier.
            reader.slice(offset, length)?;
            tables.push((tag, offset, length));
        }

        Ok(Self { tables })
    }

    /// Plage d'une table, ou `None` si elle est absente.
    #[must_use]
    pub fn find(&self, tag: &Tag) -> Option<(usize, usize)> {
        self.tables
            .iter()
            .find(|(nom, _, _)| nom == tag)
            .map(|(_, offset, length)| (*offset, *length))
    }

    /// Exige la présence d'une table et en renvoie la vue.
    ///
    /// # Erreurs
    ///
    /// [`FontError::MissingTable`] si la table n'est pas là. Une police sans
    /// `cmap` ou sans `head` n'est pas exploitable ; le dire tôt évite de
    /// découvrir le problème au milieu de l'écriture d'un PDF.
    pub fn require<'a>(&self, data: &'a [u8], tag: &'static str) -> Result<Reader<'a>, FontError> {
        let cle: Tag = tag.as_bytes().try_into().expect("quatre octets");
        let (offset, length) = self.find(&cle).ok_or(FontError::MissingTable { tag })?;
        Ok(Reader::new(Reader::new(data).slice(offset, length)?))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entete(nb_tables: u16) -> Vec<u8> {
        let mut v = vec![0x00, 0x01, 0x00, 0x00];
        v.extend_from_slice(&nb_tables.to_be_bytes());
        // searchRange, entrySelector, rangeShift — ignorés à la lecture.
        v.extend_from_slice(&[0, 0, 0, 0, 0, 0]);
        v
    }

    fn record(tag: &[u8; 4], offset: u32, length: u32) -> Vec<u8> {
        let mut v = tag.to_vec();
        v.extend_from_slice(&[0, 0, 0, 0]); // checksum, ignoré
        v.extend_from_slice(&offset.to_be_bytes());
        v.extend_from_slice(&length.to_be_bytes());
        v
    }

    #[test]
    fn refus_de_la_collection_et_du_woff() {
        let mut ttcf = b"ttcf".to_vec();
        ttcf.extend_from_slice(&[0; 20]);
        assert!(matches!(
            TableDirectory::parse(&ttcf),
            Err(FontError::UnsupportedFormat { raison }) if raison.contains("collection")
        ));

        let mut woff = b"wOFF".to_vec();
        woff.extend_from_slice(&[0; 20]);
        assert!(matches!(
            TableDirectory::parse(&woff),
            Err(FontError::UnsupportedFormat { raison }) if raison.contains("WOFF")
        ));
    }

    #[test]
    fn refus_de_otto_cff() {
        let mut otto = b"OTTO".to_vec();
        otto.extend_from_slice(&[0; 20]);
        assert!(matches!(
            TableDirectory::parse(&otto),
            Err(FontError::UnsupportedFormat { .. })
        ));
    }

    #[test]
    fn signature_inconnue_est_dite() {
        let mut faux = b"JUNK".to_vec();
        faux.extend_from_slice(&[0; 20]);
        match TableDirectory::parse(&faux) {
            Err(FontError::BadSignature { signature }) => assert!(signature.contains("JUNK")),
            autre => panic!("signature attendue, obtenu {autre:?}"),
        }
    }

    #[test]
    fn table_tronquee_refusee() {
        // La table annonce 100 octets mais il n'y en a que 4.
        let mut data = entete(1);
        data.extend_from_slice(&record(b"head", 30, 100));
        data.extend_from_slice(&[0; 4]);
        assert!(matches!(
            TableDirectory::parse(&data),
            Err(FontError::Truncated { .. })
        ));
    }

    #[test]
    fn table_trouvee_et_absente_dite() {
        let mut data = entete(2);
        data.extend_from_slice(&record(b"head", 44, 8));
        data.extend_from_slice(&record(b"cmap", 52, 4));
        data.extend_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        data.extend_from_slice(&[9, 9, 9, 9]);

        let dir = TableDirectory::parse(&data).expect("police minimale valide");
        assert_eq!(dir.find(b"head"), Some((44, 8)));
        assert_eq!(dir.find(b"cmap"), Some((52, 4)));
        assert_eq!(dir.find(b"glyf"), None);

        let head = dir.require(&data, "head").expect("head présente");
        assert_eq!(head.u32(0).unwrap(), 0x01020304);
        assert!(matches!(
            dir.require(&data, "glyf"),
            Err(FontError::MissingTable { tag: "glyf" })
        ));
    }

    #[test]
    fn fixed_negative_a_le_bon_signe() {
        // `-0.5` en 16.16 s'écrit 0xFFFF8000 : la conversion naïve par division
        // donnerait un signe faux si l'entier 32 bits n'était pas signé.
        let data = [0xFF, 0xFF, 0x80, 0x00];
        let reader = Reader::new(&data);
        assert!((reader.fixed(0).unwrap() + 0.5).abs() < 1e-9);
    }
}
