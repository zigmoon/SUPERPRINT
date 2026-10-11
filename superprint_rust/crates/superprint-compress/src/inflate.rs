//! Décompresseur DEFLATE — **complet**.
//!
//! Il lit les trois formes de bloc de la RFC 1951 :
//!
//! | BTYPE | Forme | Pourquoi il faut la gérer |
//! |---|---|---|
//! | `00` | **stocké** | tout déflateur en produit pour les données incompressibles |
//! | `01` | **Huffman figé** | la table est dans la norme, rien à transmettre |
//! | `10` | **Huffman dynamique** | **indispensable** : c'est ce que produisent `zlib`, `pako`, Java, Python… |
//!
//! ⚠️ Ne pas gérer le Huffman **dynamique** rendrait ce décodeur inutile en
//! pratique : aucun outil courant ne produit autre chose par défaut. Un PDF
//! fabriqué ailleurs — donc n'importe quel PDF qu'un client envoie — l'emploie.
//!
//! ## Le décodage d'un code de Huffman, en une phrase
//!
//! On lit les bits **un par un**, en accumulant un code dont on sait seulement
//! qu'il est **canonique** : à une longueur donnée, les codes se suivent dans
//! l'ordre des symboles. On peut donc, à chaque bit ajouté, demander « ce code
//! tombe-t-il dans la plage de cette longueur ? ». Trois additions suffisent.

use std::fmt;

/// Ce qui empêche de relire un flux.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErreurDeflate {
    /// Le flux s'arrête au milieu d'un élément.
    Tronque {
        /// Octets nécessaires.
        attendu: usize,
        /// Octets disponibles.
        trouve: usize,
    },
    /// La méthode de compression n'est pas DEFLATE (zlib).
    MethodeInconnue {
        /// L'octet d'en-tête fautif.
        octet: u8,
    },
    /// L'en-tête zlib n'est pas un multiple de 31 : il est abîmé.
    EnTeteInvalide {
        /// Le mot de 16 bits lu.
        mot: u16,
    },
    /// Le flux déclare un dictionnaire préalable, que ce module ne gère pas.
    DictionnaireNonGere,
    /// La somme de contrôle ne correspond pas au contenu.
    SommeInvalide {
        /// Somme portée par le flux.
        attendu: u32,
        /// Somme calculée sur le contenu relu.
        obtenu: u32,
    },
    /// Un code de Huffman est incomplet ou se répète.
    HuffmanInvalide {
        /// La raison, en clair.
        raison: &'static str,
    },
    /// Le bloc emploie un symbole que la norme ne définit pas.
    SymboleInconnu {
        /// Le symbole fautif.
        symbole: u16,
    },
    /// Le bloc annonce plus de longueurs et de distances que la norme n'en permet.
    BlocInvalide {
        /// La raison, en clair.
        raison: &'static str,
    },
    /// La longueur relue ne correspond pas à celle attendue.
    LongueurInvalide {
        /// Octets attendus.
        attendu: usize,
        /// Octets obtenus.
        obtenu: usize,
    },
}

impl fmt::Display for ErreurDeflate {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Tronque { attendu, trouve } => write!(
                f,
                "flux DEFLATE tronqué : {attendu} octet(s) attendu(s), {trouve} disponible(s)"
            ),
            Self::MethodeInconnue { octet } => {
                write!(f, "méthode de compression inconnue (octet {octet:#04X})")
            }
            Self::EnTeteInvalide { mot } => write!(
                f,
                "en-tête zlib invalide : le mot {mot:#06X} n'est pas un multiple de 31"
            ),
            Self::DictionnaireNonGere => {
                write!(f, "flux à dictionnaire préalable : non pris en charge")
            }
            Self::SommeInvalide { attendu, obtenu } => write!(
                f,
                "somme de contrôle Adler-32 fausse : {attendu:#010X} attendu, {obtenu:#010X} calculé"
            ),
            Self::HuffmanInvalide { raison } => write!(f, "table de Huffman invalide : {raison}"),
            Self::SymboleInconnu { symbole } => {
                write!(f, "symbole {symbole} absent de la table de Huffman")
            }
            Self::BlocInvalide { raison } => write!(f, "bloc invalide : {raison}"),
            Self::LongueurInvalide { attendu, obtenu } => write!(
                f,
                "contenu relu de {obtenu} octet(s) au lieu de {attendu}"
            ),
        }
    }
}

impl std::error::Error for ErreurDeflate {}

/// Longueur maximale admise pour un contenu décompressé.
///
/// Une bombe de décompression (un petit flux qui décrit des gigaoctets) est une
/// attaque connue. Un moteur qui doit rendre la main ne peut pas allouer sans
/// borne : au-delà de 512 Mo, on refuse.
const MAX_SORTIE: usize = 512 * 1024 * 1024;

/// Lecture de bits, dans l'ordre que DEFLATE impose.
struct BitLecteur<'a> {
    donnees: &'a [u8],
    position: usize,
    courant: u32,
    bits: u32,
}

impl<'a> BitLecteur<'a> {
    fn new(donnees: &'a [u8]) -> Self {
        Self {
            donnees,
            position: 0,
            courant: 0,
            bits: 0,
        }
    }

    /// Lit `nombre` bits en partant du **poids faible**.
    fn bits(&mut self, nombre: u32) -> Result<u32, ErreurDeflate> {
        while self.bits < nombre {
            let octet = *self
                .donnees
                .get(self.position)
                .ok_or(ErreurDeflate::Tronque {
                    attendu: self.position + 1,
                    trouve: self.donnees.len(),
                })?;
            self.position += 1;
            self.courant |= u32::from(octet) << self.bits;
            self.bits += 8;
        }
        let valeur = self.courant & ((1u32 << nombre) - 1);
        self.courant >>= nombre;
        self.bits -= nombre;
        Ok(valeur)
    }

    /// Lit **un** bit.
    fn bit(&mut self) -> Result<u32, ErreurDeflate> {
        self.bits(1)
    }

    /// Aligne la lecture sur l'octet suivant (pour les blocs stockés).
    fn aligner(&mut self) {
        self.courant = 0;
        self.bits = 0;
    }
}

/// Une table de Huffman, sous forme **canonique**.
///
/// Le décodage se fait bit par bit : on n'a pas besoin d'une table de conversion
/// indexée — seulement du **nombre de codes par longueur** et des symboles dans
/// l'ordre canonique. C'est le même algorithme que `zlib`, transcrit.
struct Huffman {
    /// Nombre de codes pour chaque longueur, index 1..=15.
    compte: [u16; 16],
    /// Symboles rangés par longueur croissante, puis par valeur.
    symboles: Vec<u16>,
    /// Longueur du code le plus long.
    longueur_max: u32,
}

impl Huffman {
    /// Construit la table depuis les longueurs de code.
    ///
    /// Une longueur nulle signifie « symbole absent » : les codes vides sont la
    /// règle, pas l'exception (la table des distances d'un bloc sans
    /// correspondance n'a qu'un symbole, de longueur 1).
    fn depuis_longueurs(longueurs: &[u8]) -> Result<Self, ErreurDeflate> {
        let mut compte = [0u16; 16];
        for longueur in longueurs {
            if *longueur > 15 {
                return Err(ErreurDeflate::HuffmanInvalide {
                    raison: "longueur de code supérieure à 15",
                });
            }
            if *longueur > 0 {
                compte[usize::from(*longueur)] += 1;
            }
        }
        let longueur_max = (1..16).rev().find(|l| compte[*l] > 0).unwrap_or(0) as u32;

        // Contrôle de **complétude** (algorithme classique) : un code
        // sur-souscrit ne peut pas exister, un code sur-souscrit ou incomplet
        // signalerait une table abîmée.
        let mut reste = 1i32;
        for nombre in compte.iter().skip(1) {
            reste <<= 1;
            reste -= i32::from(*nombre);
            if reste < 0 {
                return Err(ErreurDeflate::HuffmanInvalide {
                    raison: "code sur-souscrit",
                });
            }
        }

        // Ordre canonique : par longueur croissante, puis par symbole croissant.
        let total: usize = compte.iter().map(|c| usize::from(*c)).sum();
        let mut symboles = Vec::with_capacity(total);
        for longueur in 1..=15u8 {
            for (symbole, l) in longueurs.iter().enumerate() {
                if *l == longueur {
                    symboles.push(symbole as u16);
                }
            }
        }
        Ok(Self {
            compte,
            symboles,
            longueur_max,
        })
    }

    /// Lit le symbole décrit par le flux.
    fn lire(&self, lecteur: &mut BitLecteur<'_>) -> Result<u16, ErreurDeflate> {
        if self.longueur_max == 0 {
            return Err(ErreurDeflate::HuffmanInvalide {
                raison: "table vide",
            });
        }
        let mut code = 0u32;
        let mut premier = 0u32;
        let mut index = 0usize;
        for longueur in 1..=self.longueur_max {
            code = (code << 1) | lecteur.bit()?;
            let nombre = u32::from(self.compte[longueur as usize]);
            if code >= premier && code - premier < nombre {
                return Ok(self.symboles[index + (code - premier) as usize]);
            }
            index += nombre as usize;
            premier = (premier + nombre) << 1;
        }
        Err(ErreurDeflate::HuffmanInvalide {
            raison: "code absent de la table",
        })
    }
}

/// Les longueurs de base et les bits supplémentaires, RFC 1951 §3.2.5.
const BASE_LONGUEUR: [usize; 29] = [
    3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131,
    163, 195, 227, 258,
];
const EXTRA_LONGUEUR: [u32; 29] = [
    0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0,
];
const BASE_DISTANCE: [usize; 30] = [
    1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537,
    2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577,
];
const EXTRA_DISTANCE: [u32; 30] = [
    0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13,
    13,
];

/// L'ordre de transmission des longueurs du code de code, RFC 1951 §3.2.7.
///
/// Cet ordre bizarre — 16, 17, 18, 0, 8… — place les longueurs **les plus
/// utiles** en premier : la table peut ainsi être tronquée dès qu'il ne reste
/// que des zéros.
const ORDRE_CODE_LONGUEURS: [usize; 19] = [
    16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15,
];

/// Décompresse un flux DEFLATE **brut**.
///
/// # Erreurs
///
/// [`ErreurDeflate`] si le flux est tronqué, si une table est incohérente ou si
/// un symbole est absent.
pub fn decompresser(donnees: &[u8]) -> Result<Vec<u8>, ErreurDeflate> {
    let mut lecteur = BitLecteur::new(donnees);
    let mut sortie: Vec<u8> = Vec::new();

    loop {
        let dernier = lecteur.bit()? == 1;
        let type_bloc = lecteur.bits(2)?;
        match type_bloc {
            0 => {
                lecteur.aligner();
                let longueur = lire_u16(&mut lecteur)? as usize;
                let complement = lire_u16(&mut lecteur)?;
                if !(longueur as u16) != complement {
                    return Err(ErreurDeflate::BlocInvalide {
                        raison: "la longueur et son complément ne concordent pas",
                    });
                }
                for _ in 0..longueur {
                    let octet =
                        *lecteur
                            .donnees
                            .get(lecteur.position)
                            .ok_or(ErreurDeflate::Tronque {
                                attendu: lecteur.position + 1,
                                trouve: lecteur.donnees.len(),
                            })?;
                    lecteur.position += 1;
                    sortie.push(octet);
                }
            }
            1 => {
                let (longueurs, distances) = tables_figees()?;
                gonfler(&mut lecteur, &mut sortie, &longueurs, &distances)?;
            }
            2 => {
                let (longueurs, distances) = tables_dynamiques(&mut lecteur)?;
                gonfler(&mut lecteur, &mut sortie, &longueurs, &distances)?;
            }
            _ => {
                return Err(ErreurDeflate::BlocInvalide {
                    raison: "type de bloc réservé (3)",
                })
            }
        }
        if sortie.len() > MAX_SORTIE {
            return Err(ErreurDeflate::BlocInvalide {
                raison: "contenu décompressé au-delà de la limite de sûreté",
            });
        }
        if dernier {
            break;
        }
    }
    Ok(sortie)
}

fn lire_u16(lecteur: &mut BitLecteur<'_>) -> Result<u16, ErreurDeflate> {
    let bas = *lecteur
        .donnees
        .get(lecteur.position)
        .ok_or(ErreurDeflate::Tronque {
            attendu: lecteur.position + 1,
            trouve: lecteur.donnees.len(),
        })?;
    let haut = *lecteur
        .donnees
        .get(lecteur.position + 1)
        .ok_or(ErreurDeflate::Tronque {
            attendu: lecteur.position + 2,
            trouve: lecteur.donnees.len(),
        })?;
    lecteur.position += 2;
    Ok(u16::from(bas) | (u16::from(haut) << 8))
}

/// Les deux tables **figées** de la RFC 1951 §3.2.6.
fn tables_figees() -> Result<(Huffman, Huffman), ErreurDeflate> {
    let mut longueurs = vec![0u8; 288];
    for (symbole, longueur) in longueurs.iter_mut().enumerate() {
        *longueur = match symbole {
            0..=143 => 8,
            144..=255 => 9,
            256..=279 => 7,
            _ => 8,
        };
    }
    let distances = vec![5u8; 30];
    Ok((
        Huffman::depuis_longueurs(&longueurs)?,
        Huffman::depuis_longueurs(&distances)?,
    ))
}

/// Lit les tables d'un bloc à **Huffman dynamique** (RFC 1951 §3.2.7).
fn tables_dynamiques(lecteur: &mut BitLecteur<'_>) -> Result<(Huffman, Huffman), ErreurDeflate> {
    let nombre_longueurs = lecteur.bits(5)? as usize + 257;
    let nombre_distances = lecteur.bits(5)? as usize + 1;
    let nombre_codes = lecteur.bits(4)? as usize + 4;
    if nombre_longueurs > 286 || nombre_distances > 30 {
        return Err(ErreurDeflate::BlocInvalide {
            raison: "plus de longueurs ou de distances que la norme n'en permet",
        });
    }

    // ① Les longueurs du « code de code », transmises dans l'ordre imposé.
    let mut longueurs_du_code = [0u8; 19];
    for index in 0..nombre_codes {
        longueurs_du_code[ORDRE_CODE_LONGUEURS[index]] = lecteur.bits(3)? as u8;
    }
    let code_de_code = Huffman::depuis_longueurs(&longueurs_du_code)?;

    // ② Les longueurs des deux tables, avec les répétitions 16, 17 et 18.
    let total = nombre_longueurs + nombre_distances;
    let mut toutes: Vec<u8> = Vec::with_capacity(total);
    while toutes.len() < total {
        let symbole = code_de_code.lire(lecteur)?;
        match symbole {
            0..=15 => toutes.push(symbole as u8),
            16 => {
                let precedent = *toutes.last().ok_or(ErreurDeflate::BlocInvalide {
                    raison: "répétition sans valeur précédente",
                })?;
                let repetition = 3 + lecteur.bits(2)? as usize;
                for _ in 0..repetition {
                    toutes.push(precedent);
                }
            }
            17 => {
                let repetition = 3 + lecteur.bits(3)? as usize;
                toutes.resize(toutes.len() + repetition, 0);
            }
            18 => {
                let repetition = 11 + lecteur.bits(7)? as usize;
                toutes.resize(toutes.len() + repetition, 0);
            }
            autre => {
                return Err(ErreurDeflate::SymboleInconnu { symbole: autre });
            }
        }
        if toutes.len() > total {
            return Err(ErreurDeflate::BlocInvalide {
                raison: "trop de longueurs transmises",
            });
        }
    }

    // ③ Le symbole 256 (« fin de bloc ») doit exister : sans lui, le bloc ne
    //    pourrait pas se terminer, et la table est forcément abîmée.
    if toutes[nombre_longueurs - 1] == 0 {
        return Err(ErreurDeflate::HuffmanInvalide {
            raison: "le symbole de fin de bloc est absent",
        });
    }

    let (longueurs, distances) = toutes.split_at(nombre_longueurs);
    Ok((
        Huffman::depuis_longueurs(longueurs)?,
        Huffman::depuis_longueurs(distances)?,
    ))
}

/// Développe les symboles d'un bloc jusqu'au symbole de fin (256).
fn gonfler(
    lecteur: &mut BitLecteur<'_>,
    sortie: &mut Vec<u8>,
    longueurs: &Huffman,
    distances: &Huffman,
) -> Result<(), ErreurDeflate> {
    loop {
        let symbole = longueurs.lire(lecteur)?;
        match symbole {
            0..=255 => sortie.push(symbole as u8),
            256 => return Ok(()),
            257..=285 => {
                let index = usize::from(symbole) - 257;
                let longueur = BASE_LONGUEUR[index] + lecteur.bits(EXTRA_LONGUEUR[index])? as usize;
                let code_distance = distances.lire(lecteur)? as usize;
                if code_distance >= 30 {
                    return Err(ErreurDeflate::SymboleInconnu {
                        symbole: code_distance as u16,
                    });
                }
                let distance = BASE_DISTANCE[code_distance]
                    + lecteur.bits(EXTRA_DISTANCE[code_distance])? as usize;
                copier(sortie, distance, longueur)?;
            }
            autre => {
                return Err(ErreurDeflate::SymboleInconnu { symbole: autre });
            }
        }
    }
}

/// Recopie `longueur` octets depuis `distance` en arrière.
///
/// ⚠️ La copie se fait **octet par octet**, et c'est obligatoire : DEFLATE
/// autorise `distance < longueur`, auquel cas la source est le début de ce
/// qu'on est en train d'écrire. Une recopie par bloc (`copy_from_slice`) lirait
/// des octets pas encore écrits — et produirait un flux faux, seulement sur les
/// suites très répétitives, c'est-à-dire exactement les images à aplat.
fn copier(sortie: &mut Vec<u8>, distance: usize, longueur: usize) -> Result<(), ErreurDeflate> {
    if distance == 0 || distance > sortie.len() {
        return Err(ErreurDeflate::BlocInvalide {
            raison: "distance supérieure au contenu déjà relu",
        });
    }
    let debut = sortie.len() - distance;
    for index in 0..longueur {
        let octet = sortie[debut + index];
        sortie.push(octet);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_bloc_stocke_se_relit() {
        // BFINAL = 1, BTYPE = 00, puis LEN, NLEN et les octets.
        let donnees = b"bonjour";
        let mut flux = vec![0x01, donnees.len() as u8, 0, !(donnees.len() as u8), 0xFF];
        flux.extend_from_slice(donnees);
        assert_eq!(decompresser(&flux).unwrap(), donnees);
    }

    #[test]
    fn un_bloc_stocke_dont_la_longueur_est_fausse_est_refuse() {
        let flux = vec![0x01, 5, 0, 0, 0xFF, b'a', b'b', b'c', b'd', b'e'];
        assert!(matches!(
            decompresser(&flux),
            Err(ErreurDeflate::BlocInvalide { .. })
        ));
    }

    #[test]
    fn un_flux_vide_est_refuse() {
        assert!(matches!(
            decompresser(&[]),
            Err(ErreurDeflate::Tronque { .. })
        ));
    }

    #[test]
    fn un_type_de_bloc_reserve_est_refuse() {
        // BFINAL = 1, BTYPE = 11 : réservé par la norme.
        assert!(matches!(
            decompresser(&[0b0000_0111]),
            Err(ErreurDeflate::BlocInvalide { .. })
        ));
    }

    #[test]
    fn une_distance_qui_remonte_avant_le_debut_est_refusee() {
        let mut sortie = vec![b'a', b'b'];
        assert!(matches!(
            copier(&mut sortie, 5, 3),
            Err(ErreurDeflate::BlocInvalide { .. })
        ));
        assert!(matches!(
            copier(&mut sortie, 0, 3),
            Err(ErreurDeflate::BlocInvalide { .. })
        ));
    }

    #[test]
    fn une_copie_qui_se_recouvre_elle_meme_est_juste() {
        // Distance 1, longueur 4 : « aaaa » à partir d'un seul « a ».
        let mut sortie = vec![b'a'];
        copier(&mut sortie, 1, 4).unwrap();
        assert_eq!(sortie, b"aaaaa");
    }

    #[test]
    fn une_copie_normale_est_juste() {
        let mut sortie = b"abc".to_vec();
        copier(&mut sortie, 3, 3).unwrap();
        assert_eq!(sortie, b"abcabc");
    }

    #[test]
    fn les_tables_figees_ont_les_bonnes_longueurs() {
        let (longueurs, distances) = tables_figees().unwrap();
        assert_eq!(longueurs.longueur_max, 9);
        assert_eq!(longueurs.symboles.len(), 288);
        assert_eq!(distances.longueur_max, 5);
        assert_eq!(distances.symboles.len(), 30);
    }

    #[test]
    fn une_table_sur_souscrite_est_refusee() {
        // Trois codes de longueur 1 : impossible, il n'y a que deux codes de
        // longueur 1 dans un code préfixe.
        assert!(matches!(
            Huffman::depuis_longueurs(&[1, 1, 1]),
            Err(ErreurDeflate::HuffmanInvalide { .. })
        ));
    }

    #[test]
    fn une_table_vide_est_refusee_a_la_lecture() {
        let table = Huffman::depuis_longueurs(&[0, 0, 0]).unwrap();
        assert_eq!(table.longueur_max, 0);
        let mut lecteur = BitLecteur::new(&[0xFF, 0xFF]);
        assert!(table.lire(&mut lecteur).is_err());
    }

    #[test]
    fn une_longueur_de_code_trop_grande_est_refusee() {
        assert!(matches!(
            Huffman::depuis_longueurs(&[16]),
            Err(ErreurDeflate::HuffmanInvalide { .. })
        ));
    }

    #[test]
    fn les_tables_de_base_couvrent_toute_la_plage() {
        // La progression est régulière… sauf entre les codes 284 et 285 : la
        // norme y place une exception (284 va de 227 à 257 alors que 5 bits
        // couvriraient 32 valeurs ; 285 vaut exactement 258).
        for index in 1..BASE_LONGUEUR.len() - 1 {
            let precedent = BASE_LONGUEUR[index - 1] + (1usize << EXTRA_LONGUEUR[index - 1]);
            assert_eq!(BASE_LONGUEUR[index], precedent, "table des longueurs");
        }
        assert_eq!(BASE_LONGUEUR[BASE_LONGUEUR.len() - 2], 227);
        assert_eq!(EXTRA_LONGUEUR[EXTRA_LONGUEUR.len() - 2], 5);
        assert_eq!(BASE_LONGUEUR[BASE_LONGUEUR.len() - 1], 258);
        assert_eq!(EXTRA_LONGUEUR[EXTRA_LONGUEUR.len() - 1], 0);

        for index in 1..BASE_DISTANCE.len() {
            let precedent = BASE_DISTANCE[index - 1] + (1usize << EXTRA_DISTANCE[index - 1]);
            assert_eq!(BASE_DISTANCE[index], precedent, "table des distances");
        }
        assert_eq!(
            BASE_DISTANCE[BASE_DISTANCE.len() - 1]
                + (1 << EXTRA_DISTANCE[EXTRA_DISTANCE.len() - 1]),
            32_769,
            "la dernière distance doit couvrir jusqu'à 32 768"
        );
    }

    #[test]
    fn l_ordre_des_longueurs_du_code_est_celui_de_la_norme() {
        assert_eq!(&ORDRE_CODE_LONGUEURS[..8], &[16, 17, 18, 0, 8, 7, 9, 6]);
        assert_eq!(ORDRE_CODE_LONGUEURS.len(), 19);
    }
}
