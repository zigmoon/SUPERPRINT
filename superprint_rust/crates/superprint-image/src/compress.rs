//! Filtre PDF **RunLength** (`/RunLengthDecode`).
//!
//! Dans un PDF, un flux d'image peut être laissé **brut** — c'est exactement ce
//! qui produisait le fichier de 131 Mo du rapport interne : des pixels écrits
//! sans aucun filtre. Le format PDF définit pourtant des filtres sans perte ;
//! *RunLength* en est le plus simple et le plus rapide à décoder.
//!
//! Format (ISO 32000-2, §7.4.5) : le flux est une suite de **runs**, chacun
//! introduit par un octet de longueur `L` :
//!
//! - `0..=127` — les `L + 1` octets suivants sont recopiés **littéralement** ;
//! - `129..=255` — l'octet suivant est **répété** `257 - L` fois ;
//! - `128` — fin de données (facultatif, non émis par l'encodeur).
//!
//! Ce filtre brille sur les aplats (fond de page uni, images de synthèse) et
//! reste neutre sur la photo : l'encodeur ne garde le run que s'il **gagne**
//! réellement un octet.

/// Longueur maximale d'un run littéral (`L + 1` octets), soit 128 octets.
const MAX_LITERAL: usize = 128;
/// Longueur maximale d'un run répété, soit 128 octets.
const MAX_REPEAT: usize = 128;

/// Encode un tampon avec le filtre PDF *RunLength*.
///
/// Sur les **aplats** (fond uni, image de synthèse), le gain est énorme : un
/// run répété remplace jusqu'à 128 octets par 2. Sur des données
/// **incompressibles**, le surcoût est borné à **1 octet par tranche de 128**
/// (l'octet de longueur) — c'est pourquoi un encodeur d'image compare les deux
/// tailles et n'applique le filtre que s'il gagne réellement.
#[must_use]
pub fn run_length_encode(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(data.len());
    let mut i = 0;

    while i < data.len() {
        // Longueur de la suite d'octets identiques à partir de `i`.
        let mut run = 1usize;
        while i + run < data.len() && data[i + run] == data[i] && run < MAX_REPEAT {
            run += 1;
        }

        if run >= 3 {
            // Run répété : L = 257 - count, puis l'octet répété.
            out.push((257 - run) as u8);
            out.push(data[i]);
            i += run;
        } else {
            // Séquence littérale : on avance jusqu'à la prochaine répétition
            // d'au moins 3 octets, sans dépasser MAX_LITERAL.
            let start = i;
            while i < data.len() && i - start < MAX_LITERAL {
                // S'arrêter si une répétition ≥ 3 commence ici (i > start).
                if i + 2 < data.len() && data[i] == data[i + 1] && data[i] == data[i + 2] {
                    break;
                }
                i += 1;
            }
            let count = i - start;
            if count == 0 {
                // Cas limite : la répétition commence exactement ici alors que
                // l'on n'a encore rien écrit ; on force l'écriture d'un octet.
                out.push(0);
                out.push(data[i]);
                i += 1;
            } else {
                out.push((count - 1) as u8);
                out.extend_from_slice(&data[start..i]);
            }
        }
    }

    out
}

/// Décode un tampon encodé avec le filtre PDF *RunLength*.
///
/// Renvoie `None` si le flux est **tronqué** (un run annonce plus d'octets que
/// le flux n'en contient) : un flux corrompu ne doit pas produire une image
/// silencieusement décalée.
#[must_use]
pub fn run_length_decode(data: &[u8]) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < data.len() {
        let length = data[i];
        i += 1;
        match length {
            0..=127 => {
                let count = usize::from(length) + 1;
                if i + count > data.len() {
                    return None;
                }
                out.extend_from_slice(&data[i..i + count]);
                i += count;
            }
            129..=255 => {
                if i >= data.len() {
                    return None;
                }
                let count = 257 - usize::from(length);
                let value = data[i];
                i += 1;
                out.extend(std::iter::repeat(value).take(count));
            }
            128 => break, // fin de données
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn aplat_compresse_fortement() {
        // 1000 octets identiques → 2 octets de run + en-tête.
        let data = vec![7u8; 1000];
        let encoded = run_length_encode(&data);
        assert!(
            encoded.len() < 20,
            "un aplat doit être minuscule : {}",
            encoded.len()
        );
        assert_eq!(run_length_decode(&encoded).unwrap(), data);
    }

    #[test]
    fn donnees_incompressibles_surcout_borne() {
        // Sur du bruit, le surcoût est d'au plus 1 octet par tranche de 128.
        let data: Vec<u8> = (0..=255u8).collect();
        let encoded = run_length_encode(&data);
        assert!(
            encoded.len() <= data.len() + data.len().div_ceil(MAX_LITERAL),
            "surcoût trop grand : {} pour {}",
            encoded.len(),
            data.len()
        );
        assert_eq!(run_length_decode(&encoded).unwrap(), data);
    }

    #[test]
    fn aller_retour_sur_plusieurs_motifs() {
        let cases: Vec<Vec<u8>> = vec![
            vec![],
            vec![1],
            vec![1, 1],
            vec![1, 1, 1],
            vec![1, 1, 1, 2, 2, 3],
            (0..300).map(|i| (i % 5) as u8).collect(),
            vec![0; 200],
            b"SuperPrint".to_vec(),
        ];
        for case in cases {
            let encoded = run_length_encode(&case);
            let decoded = run_length_decode(&encoded).expect("décodable");
            assert_eq!(decoded, case, "motif : {:?}", &case[..case.len().min(20)]);
        }
    }

    #[test]
    fn flux_tronque_refuse() {
        // L = 5 (→ 6 octets littéraux) mais seulement 2 octets suivent.
        assert_eq!(run_length_decode(&[5, 1, 2]), None);
        // Run répété sans octet à répéter.
        assert_eq!(run_length_decode(&[255]), None);
    }

    #[test]
    fn fin_de_donnees_honoree() {
        // 128 = fin de données : tout ce qui suit est ignoré.
        let decoded = run_length_decode(&[0, 42, 128, 0, 99]).unwrap();
        assert_eq!(decoded, vec![42]);
    }
}
