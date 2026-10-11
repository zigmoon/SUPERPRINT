//! CRC32, tel que le ZIP l'emploie (norme ISO 3309, polynôme réfléchi
//! `0xEDB88320`).
//!
//! Le calcul est fait par **quartets** avec une table de seize valeurs, pas de
//! deux cent cinquante-six. C'est le même résultat — vérifié par test contre la
//! valeur publiée de `"123456789"` — pour un huitième de table à transporter.

/// Les seize entrées de la table, calculées à la compilation.
const TABLE: [u32; 16] = table();

/// Construit la table du CRC32 par quartets.
///
/// Chaque entrée est le reste de la division du quartet par le polynôme : c'est
/// quatre pas de l'algorithme ordinaire, faits une fois pour toutes.
const fn table() -> [u32; 16] {
    let mut table = [0u32; 16];
    let mut i = 0;
    while i < 16 {
        let mut valeur = i as u32;
        let mut bit = 0;
        while bit < 4 {
            valeur = if valeur & 1 != 0 {
                (valeur >> 1) ^ 0xEDB8_8320
            } else {
                valeur >> 1
            };
            bit += 1;
        }
        table[i] = valeur;
        i += 1;
    }
    table
}

/// CRC32 d'un bloc d'octets.
///
/// C'est **le** contrôle d'intégrité du ZIP : chaque entrée porte le CRC32 de
/// son contenu décompressé, ce qui permet de distinguer un fichier intact d'un
/// fichier tronqué — un ZIP tronqué s'ouvre sans broncher.
///
/// # Exemple
///
/// ```
/// # use superprint_zip::crc32;
/// assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
/// assert_eq!(crc32(b""), 0);
/// ```
#[must_use]
pub fn crc32(donnees: &[u8]) -> u32 {
    let mut reste = 0xFFFF_FFFFu32;
    for octet in donnees {
        reste ^= u32::from(*octet);
        reste = (reste >> 4) ^ TABLE[(reste & 0xF) as usize];
        reste = (reste >> 4) ^ TABLE[(reste & 0xF) as usize];
    }
    !reste
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valeurs_publiees() {
        // La valeur de référence de la littérature pour le CRC32.
        assert_eq!(crc32(b"123456789"), 0xCBF4_3926);
        assert_eq!(crc32(b""), 0);
        // « a » : valeur classique elle aussi.
        assert_eq!(crc32(b"a"), 0xE8B7_BE43);
    }

    #[test]
    fn sensibilite_a_un_seul_octet() {
        let base = crc32(b"un document");
        assert_ne!(base, crc32(b"un documenz"));
        assert_ne!(base, crc32(b"un document "));
        assert_ne!(base, crc32(b"uN document"));
    }

    #[test]
    fn le_quartet_donne_le_meme_resultat_que_l_octet() {
        // Référence : algorithme pas à pas sur un bit, écrit différemment.
        fn lent(donnees: &[u8]) -> u32 {
            let mut reste = 0xFFFF_FFFFu32;
            for octet in donnees {
                reste ^= u32::from(*octet);
                for _ in 0..8 {
                    reste = if reste & 1 != 0 {
                        (reste >> 1) ^ 0xEDB8_8320
                    } else {
                        reste >> 1
                    };
                }
            }
            !reste
        }
        let echantillon: Vec<u8> = (0..=255u8).collect();
        assert_eq!(crc32(&echantillon), lent(&echantillon));
        let texte = "<?xml version=\"1.0\"?><a>café — accentué</a>".as_bytes();
        assert_eq!(crc32(texte), lent(texte));
    }
}
