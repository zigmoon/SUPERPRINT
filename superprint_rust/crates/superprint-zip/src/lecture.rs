//! Lecture du contenant : fin d'annuaire central, annuaire, en-têtes locaux.

use std::collections::HashMap;

use superprint_compress::decompresser_brut;

use crate::crc::crc32;
use crate::ErreurZip;
/// Signature d'un en-tête de fichier local (`PK\x03\x04`).
pub const SIG_LOCALE: [u8; 4] = [0x50, 0x4B, 0x03, 0x04];
/// Signature d'une entrée d'annuaire central (`PK\x01\x02`).
pub const SIG_ANNUAIRE: [u8; 4] = [0x50, 0x4B, 0x01, 0x02];
/// Signature de la fin de l'annuaire central (`PK\x05\x06`).
pub const SIG_EOCD: [u8; 4] = [0x50, 0x4B, 0x05, 0x06];
/// Signature de la fin d'annuaire ZIP64 (`PK\x06\x06`).
pub const SIG_EOCD64: [u8; 4] = [0x50, 0x4B, 0x06, 0x06];

/// Taille d'une fin d'annuaire central, sans commentaire.
const TAILLE_EOCD: usize = 22;
/// Longueur maximale d'un commentaire d'archive.
const COMMENTAIRE_MAX: usize = 65_535;

/// Une entrée de l'annuaire central.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Entree {
    nom: String,
    methode: u16,
    drapeaux: u16,
    crc: u32,
    taille_compressee: u64,
    taille: u64,
    decalage_local: u64,
}

impl Entree {
    /// Nom de l'entrée, tel qu'écrit dans l'archive (séparateurs `/`).
    #[must_use]
    pub fn nom(&self) -> &str {
        &self.nom
    }

    /// Numéro de méthode de compression (0 = stocké, 8 = DEFLATE).
    #[must_use]
    pub fn methode(&self) -> u16 {
        self.methode
    }

    /// Taille du contenu **décompressé**, en octets.
    #[must_use]
    pub fn taille(&self) -> u64 {
        self.taille
    }

    /// Taille du contenu **tel qu'il est stocké**, en octets.
    #[must_use]
    pub fn taille_compressee(&self) -> u64 {
        self.taille_compressee
    }

    /// CRC32 du contenu décompressé, tel qu'écrit dans l'archive.
    #[must_use]
    pub fn crc(&self) -> u32 {
        self.crc
    }

    /// Drapeaux généraux (chiffrement, descripteur de données, nom UTF-8…).
    #[must_use]
    pub fn drapeaux(&self) -> u16 {
        self.drapeaux
    }

    /// Le nom est-il annoncé comme de l'UTF-8 (drapeau 11) ?
    #[must_use]
    pub fn nom_utf8(&self) -> bool {
        self.drapeaux & 0x0800 != 0
    }

    /// Le contenu était-il stocké sans compression ?
    #[must_use]
    pub fn est_stocke(&self) -> bool {
        self.methode == 0
    }
}

/// Une archive ZIP ouverte, gardée en mémoire.
///
/// Le crate ne lit **pas** depuis un fichier : il prend les octets. Le noyau
/// WebAssembly n'a pas de système de fichiers, et un import qui lirait le disque
/// ne serait pas testable de la même façon.
#[derive(Clone, Debug)]
pub struct Archive {
    octets: Vec<u8>,
    entrees: Vec<Entree>,
    /// Rang de chaque nom dans `entrees`, pour une recherche directe.
    par_nom: HashMap<String, usize>,
}

impl Archive {
    /// Ouvre une archive à partir de son contenu.
    ///
    /// # Erreurs
    ///
    /// Voir [`ErreurZip`]. En résumé : ce n'est pas un ZIP, c'est un ZIP64, il
    /// est chiffré, il est découpé, la méthode de compression n'est pas gérée,
    /// ou l'annuaire central ne tient pas dans le fichier.
    pub fn lire(octets: Vec<u8>) -> Result<Self, ErreurZip> {
        let eocd = chercher_eocd(&octets)?;
        let (nombre_annonce, taille_annuaire, decalage_annuaire) = lire_eocd(&octets, eocd)?;

        let fin_annuaire = decalage_annuaire
            .checked_add(taille_annuaire)
            .ok_or(ErreurZip::PasUneArchive)?;
        if fin_annuaire > octets.len() {
            return Err(ErreurZip::HorsFichier {
                nom: "annuaire central".to_string(),
            });
        }

        let mut entrees = Vec::with_capacity(nombre_annonce);
        let mut position = decalage_annuaire;
        while position + 46 <= fin_annuaire {
            if octets[position..position + 4] != SIG_ANNUAIRE {
                // Une entrée mal alignée veut dire une archive mal formée : on
                // ne cherche pas à reprendre plus loin, on s'arrête.
                break;
            }
            let (entree, suivante) = lire_entree_annuaire(&octets, position)?;
            entrees.push(entree);
            position = suivante;
        }

        if entrees.len() != nombre_annonce {
            return Err(ErreurZip::AnnuaireIncoherent {
                annonce: nombre_annonce,
                lu: entrees.len(),
            });
        }

        let mut par_nom = HashMap::with_capacity(entrees.len());
        for (rang, entree) in entrees.iter().enumerate() {
            par_nom.entry(entree.nom.clone()).or_insert(rang);
        }

        Ok(Self {
            octets,
            entrees,
            par_nom,
        })
    }

    /// Les entrées, dans l'ordre de l'annuaire central.
    #[must_use]
    pub fn entrees(&self) -> &[Entree] {
        &self.entrees
    }

    /// Nombre d'entrées.
    #[must_use]
    pub fn nombre_d_entrees(&self) -> usize {
        self.entrees.len()
    }

    /// Les noms des entrées.
    #[must_use]
    pub fn noms(&self) -> Vec<&str> {
        self.entrees.iter().map(Entree::nom).collect()
    }

    /// Cherche une entrée par son nom **exact**.
    #[must_use]
    pub fn trouver(&self, nom: &str) -> Option<&Entree> {
        self.par_nom.get(nom).map(|rang| &self.entrees[*rang])
    }

    /// Cherche une entrée sans tenir compte de la casse, et en traitant `\`
    /// comme `/`.
    ///
    /// Les archives produites sous Windows emploient parfois des barres
    /// obliques inverses, et `[Content_Types].xml` s'écrit aussi bien
    /// `[content_types].xml` selon l'outil. La comparaison stricte reste
    /// [`Archive::trouver`] ; celle-ci est là pour les fichiers du monde réel.
    #[must_use]
    pub fn trouver_souple(&self, nom: &str) -> Option<&Entree> {
        let cible = normaliser(nom);
        self.entrees
            .iter()
            .find(|entree| normaliser(entree.nom()) == cible)
    }

    /// Extrait le contenu d'une entrée, après vérification du CRC.
    ///
    /// # Erreurs
    ///
    /// [`ErreurZip::EntreeAbsente`], [`ErreurZip::MethodeInconnue`],
    /// [`ErreurZip::DeflateIllisible`], [`ErreurZip::TailleDifferent`],
    /// [`ErreurZip::CrcDifferent`], [`ErreurZip::HorsFichier`].
    pub fn extraire(&self, nom: &str) -> Result<Vec<u8>, ErreurZip> {
        let entree = self
            .trouver(nom)
            .or_else(|| self.trouver_souple(nom))
            .ok_or_else(|| ErreurZip::EntreeAbsente {
                nom: nom.to_string(),
            })?;
        self.extraire_entree(entree)
    }

    /// Extrait le contenu d'une entrée déjà trouvée.
    ///
    /// # Erreurs
    ///
    /// Les mêmes que [`Archive::extraire`], sauf l'entrée absente.
    pub fn extraire_entree(&self, entree: &Entree) -> Result<Vec<u8>, ErreurZip> {
        let brut = self.donnees_brutes(entree)?;
        let contenu = match entree.methode {
            0 => brut.to_vec(),
            8 => decompresser_brut(brut).map_err(|e| ErreurZip::DeflateIllisible {
                nom: entree.nom.clone(),
                raison: e.to_string(),
            })?,
            autre => {
                return Err(ErreurZip::MethodeInconnue {
                    nom: entree.nom.clone(),
                    methode: autre,
                })
            }
        };
        let attendue = entree.taille as usize;
        if contenu.len() != attendue {
            return Err(ErreurZip::TailleDifferent {
                nom: entree.nom.clone(),
                attendue,
                obtenue: contenu.len(),
            });
        }
        let obtenu = crc32(&contenu);
        if obtenu != entree.crc {
            return Err(ErreurZip::CrcDifferent {
                nom: entree.nom.clone(),
                attendu: entree.crc,
                obtenu,
            });
        }
        Ok(contenu)
    }

    /// Extrait le contenu d'une entrée et le lit comme du texte UTF-8.
    ///
    /// # Erreurs
    ///
    /// Les mêmes que [`Archive::extraire`], plus [`ErreurZip::TexteIllisible`].
    pub fn extraire_texte(&self, nom: &str) -> Result<String, ErreurZip> {
        let octets = self.extraire(nom)?;
        String::from_utf8(octets).map_err(|_| ErreurZip::TexteIllisible {
            nom: nom.to_string(),
        })
    }

    /// Les octets **tels qu'ils sont stockés** dans l'archive, sans décompresser.
    ///
    /// Sert à [`Archive::extraire_entree`], et aux cas où l'on veut seulement
    /// mesurer le taux de compression.
    ///
    /// # Erreurs
    ///
    /// [`ErreurZip::HorsFichier`] si l'entrée annonce des octets qui ne sont pas
    /// dans le fichier.
    pub fn donnees_brutes(&self, entree: &Entree) -> Result<&[u8], ErreurZip> {
        let debut = self.offset_donnees(entree)?;
        let fin = debut
            .checked_add(entree.taille_compressee as usize)
            .filter(|fin| *fin <= self.octets.len())
            .ok_or_else(|| ErreurZip::HorsFichier {
                nom: entree.nom.clone(),
            })?;
        Ok(&self.octets[debut..fin])
    }

    /// Le contenu de l'archive, tel qu'il a été fourni.
    #[must_use]
    pub fn octets(&self) -> &[u8] {
        &self.octets
    }

    /// Où commencent les données d'une entrée : après son en-tête local, dont le
    /// nom et le champ additionnel ont des longueurs variables.
    fn offset_donnees(&self, entree: &Entree) -> Result<usize, ErreurZip> {
        let local = entree.decalage_local as usize;
        if local + 30 > self.octets.len() {
            return Err(ErreurZip::HorsFichier {
                nom: entree.nom.clone(),
            });
        }
        if self.octets[local..local + 4] != SIG_LOCALE {
            return Err(ErreurZip::HorsFichier {
                nom: entree.nom.clone(),
            });
        }
        let longueur_nom = u16::from_le_bytes([self.octets[local + 26], self.octets[local + 27]]);
        let longueur_extra = u16::from_le_bytes([self.octets[local + 28], self.octets[local + 29]]);
        let debut = local + 30 + longueur_nom as usize + longueur_extra as usize;
        if debut > self.octets.len() {
            return Err(ErreurZip::HorsFichier {
                nom: entree.nom.clone(),
            });
        }
        Ok(debut)
    }
}

/// L'octet d'un décalage, ou une erreur si l'on sort du fichier.
fn u16_a(octets: &[u8], position: usize, quoi: &'static str) -> Result<u16, ErreurZip> {
    let fin = position + 2;
    if fin > octets.len() {
        return Err(ErreurZip::TropCourt {
            quoi,
            requis: fin,
            present: octets.len(),
        });
    }
    Ok(u16::from_le_bytes([octets[position], octets[position + 1]]))
}

/// Quatre octets lus en petit-boutiste.
fn u32_a(octets: &[u8], position: usize, quoi: &'static str) -> Result<u32, ErreurZip> {
    let fin = position + 4;
    if fin > octets.len() {
        return Err(ErreurZip::TropCourt {
            quoi,
            requis: fin,
            present: octets.len(),
        });
    }
    Ok(u32::from_le_bytes([
        octets[position],
        octets[position + 1],
        octets[position + 2],
        octets[position + 3],
    ]))
}

/// Cherche la fin d'annuaire central, en partant de la fin du fichier.
///
/// On remonte au plus de la taille d'un commentaire, parce qu'un commentaire
/// d'archive peut contenir n'importe quoi — y compris la signature elle-même.
/// C'est pourquoi la recherche part de la **fin** et non du début : la vraie
/// signature est celle qui est le plus près de la fin.
fn chercher_eocd(octets: &[u8]) -> Result<usize, ErreurZip> {
    if octets.len() < TAILLE_EOCD {
        return Err(ErreurZip::TropCourt {
            quoi: "fin d'annuaire central",
            requis: TAILLE_EOCD,
            present: octets.len(),
        });
    }
    let debut_balayage = octets.len().saturating_sub(TAILLE_EOCD + COMMENTAIRE_MAX);
    for position in (debut_balayage..=octets.len() - TAILLE_EOCD).rev() {
        if octets[position..position + 4] == SIG_EOCD {
            // Un commentaire annoncé doit tenir exactement jusqu'à la fin.
            let longueur = u16::from_le_bytes([octets[position + 20], octets[position + 21]]);
            if position + TAILLE_EOCD + longueur as usize == octets.len() {
                return Ok(position);
            }
        }
        if octets[position..position + 4] == SIG_EOCD64 {
            return Err(ErreurZip::Zip64Refuse);
        }
    }
    Err(ErreurZip::PasUneArchive)
}

/// Lit la fin d'annuaire central : `(nombre d'entrées, taille, décalage)`.
fn lire_eocd(octets: &[u8], position: usize) -> Result<(usize, usize, usize), ErreurZip> {
    let disque = u16_a(octets, position + 4, "numéro de disque")?;
    let disque_annuaire = u16_a(octets, position + 6, "disque de l'annuaire")?;
    let entrees_ce_disque = u16_a(octets, position + 8, "entrées de ce disque")?;
    let entrees_total = u16_a(octets, position + 10, "nombre d'entrées")?;
    let taille = u32_a(octets, position + 12, "taille de l'annuaire")?;
    let decalage = u32_a(octets, position + 16, "décalage de l'annuaire")?;

    if disque != 0 || disque_annuaire != 0 {
        return Err(ErreurZip::MultiVolume);
    }
    // Le sentinelle 0xFFFFFFFF annonce ZIP64, même sans marqueur à part.
    if entrees_total == 0xFFFF
        || entrees_ce_disque == 0xFFFF
        || taille == 0xFFFF_FFFF
        || decalage == 0xFFFF_FFFF
    {
        return Err(ErreurZip::Zip64Refuse);
    }
    if entrees_total != entrees_ce_disque {
        return Err(ErreurZip::AnnuaireIncoherent {
            annonce: entrees_total as usize,
            lu: entrees_ce_disque as usize,
        });
    }
    Ok((entrees_total as usize, taille as usize, decalage as usize))
}

/// Lit une entrée d'annuaire central à partir de sa signature, et rend aussi la
/// position de l'entrée suivante.
fn lire_entree_annuaire(octets: &[u8], position: usize) -> Result<(Entree, usize), ErreurZip> {
    let drapeaux = u16_a(octets, position + 8, "drapeaux d'une entrée")?;
    let methode = u16_a(octets, position + 10, "méthode d'une entrée")?;
    let crc = u32_a(octets, position + 16, "CRC d'une entrée")?;
    let taille_compressee = u32_a(octets, position + 20, "taille compressée")?;
    let taille = u32_a(octets, position + 24, "taille décompressée")?;
    let longueur_nom = u16_a(octets, position + 28, "longueur du nom")?;
    let longueur_extra = u16_a(octets, position + 30, "longueur du champ additionnel")?;
    let longueur_commentaire = u16_a(octets, position + 32, "longueur du commentaire")?;
    let decalage_local = u32_a(octets, position + 42, "décalage de l'en-tête local")?;

    let debut_nom = position + 46;
    let fin_nom = debut_nom + longueur_nom as usize;
    if fin_nom > octets.len() {
        return Err(ErreurZip::TropCourt {
            quoi: "nom d'une entrée",
            requis: fin_nom,
            present: octets.len(),
        });
    }
    let nom = String::from_utf8(octets[debut_nom..fin_nom].to_vec())
        .map_err(|_| ErreurZip::NomIllisible { rang: position })?;

    // ZIP64 dans le champ additionnel : on le refuse par son nom, pas par
    // accident.
    if taille == 0xFFFF_FFFF || taille_compressee == 0xFFFF_FFFF || decalage_local == 0xFFFF_FFFF {
        return Err(ErreurZip::Zip64Refuse);
    }
    if drapeaux & 0x0001 != 0 {
        return Err(ErreurZip::Chiffre { nom });
    }
    if let Some(suspect) = nom_suspect(&nom) {
        return Err(ErreurZip::NomSuspect { nom: suspect });
    }

    let suivante = fin_nom + longueur_extra as usize + longueur_commentaire as usize;
    if suivante > octets.len() {
        return Err(ErreurZip::TropCourt {
            quoi: "fin d'une entrée d'annuaire",
            requis: suivante,
            present: octets.len(),
        });
    }

    Ok((
        Entree {
            nom,
            methode,
            drapeaux,
            crc,
            taille_compressee: u64::from(taille_compressee),
            taille: u64::from(taille),
            decalage_local: u64::from(decalage_local),
        },
        suivante,
    ))
}

/// Un nom qui sortirait de l'archive, ou qui désigne un chemin absolu.
fn nom_suspect(nom: &str) -> Option<String> {
    let normalise = nom.replace('\\', "/");
    let absolu = normalise.starts_with('/')
        || normalise.starts_with("//")
        || nom.contains(':')
        || normalise.split('/').any(|morceau| morceau == "..");
    absolu.then(|| nom.to_string())
}

/// Forme comparable d'un nom : barres obliques normalisées, minuscules.
fn normaliser(nom: &str) -> String {
    nom.replace('\\', "/").to_lowercase()
}

/// Les octets commencent-ils par une signature ZIP ?
///
/// Sert à **reconnaître** un .docx, un .odt ou un .idml avant de l'ouvrir, et
/// donc à distinguer un vrai fichier d'un `.doc` binaire renommé.
#[must_use]
pub fn ressemble_a_une_archive(octets: &[u8]) -> bool {
    octets.len() >= 4
        && (octets[0..4] == SIG_LOCALE
            || octets[0..4] == SIG_EOCD
            || octets[0..4] == SIG_EOCD64
            || octets[0..4] == SIG_ANNUAIRE)
}

#[cfg(test)]
mod tests {
    use super::*;
    use superprint_compress::{compresser_brut, Compression};

    /// Construit une archive minimale, stockée, sans rien calculer de faux :
    /// seuls les champs utilisés par le lecteur sont posés.
    pub(crate) fn archive_simple(entrees: &[(&str, &[u8])]) -> Vec<u8> {
        let mut sortie = Vec::new();
        let mut annuaire = Vec::new();
        for (nom, contenu) in entrees {
            let decalage = sortie.len() as u32;
            // En-tête local.
            sortie.extend_from_slice(&SIG_LOCALE);
            sortie.extend_from_slice(&[20, 0, 0, 0]); // version, drapeaux
            sortie.extend_from_slice(&0u16.to_le_bytes()); // méthode : stocké
            sortie.extend_from_slice(&[0, 0, 0, 0]); // heure, date
            sortie.extend_from_slice(&crc32(contenu).to_le_bytes());
            sortie.extend_from_slice(&(contenu.len() as u32).to_le_bytes());
            sortie.extend_from_slice(&(contenu.len() as u32).to_le_bytes());
            sortie.extend_from_slice(&(nom.len() as u16).to_le_bytes());
            sortie.extend_from_slice(&0u16.to_le_bytes()); // champ additionnel
            sortie.extend_from_slice(nom.as_bytes());
            sortie.extend_from_slice(contenu);

            // Entrée d'annuaire central.
            annuaire.extend_from_slice(&SIG_ANNUAIRE);
            annuaire.extend_from_slice(&[20, 0, 20, 0]);
            annuaire.extend_from_slice(&0u16.to_le_bytes());
            annuaire.extend_from_slice(&0u16.to_le_bytes()); // méthode
            annuaire.extend_from_slice(&[0, 0, 0, 0]);
            annuaire.extend_from_slice(&crc32(contenu).to_le_bytes());
            annuaire.extend_from_slice(&(contenu.len() as u32).to_le_bytes());
            annuaire.extend_from_slice(&(contenu.len() as u32).to_le_bytes());
            annuaire.extend_from_slice(&(nom.len() as u16).to_le_bytes());
            annuaire.extend_from_slice(&[0, 0, 0, 0]); // extra + commentaire
            annuaire.extend_from_slice(&0u16.to_le_bytes()); // disque
            annuaire.extend_from_slice(&0u16.to_le_bytes()); // interne
            annuaire.extend_from_slice(&0u32.to_le_bytes()); // externe
            annuaire.extend_from_slice(&decalage.to_le_bytes());
            annuaire.extend_from_slice(nom.as_bytes());
        }
        let debut_annuaire = sortie.len() as u32;
        let taille_annuaire = annuaire.len() as u32;
        sortie.extend_from_slice(&annuaire);
        sortie.extend_from_slice(&SIG_EOCD);
        sortie.extend_from_slice(&0u16.to_le_bytes());
        sortie.extend_from_slice(&0u16.to_le_bytes());
        sortie.extend_from_slice(&(entrees.len() as u16).to_le_bytes());
        sortie.extend_from_slice(&(entrees.len() as u16).to_le_bytes());
        sortie.extend_from_slice(&taille_annuaire.to_le_bytes());
        sortie.extend_from_slice(&debut_annuaire.to_le_bytes());
        sortie.extend_from_slice(&0u16.to_le_bytes());
        sortie
    }

    /// Construit une archive dont la méthode de compression est donnée, en
    /// calculant le contenu stocké par le compresseur du noyau.
    fn archive_compressee(entrees: &[(&str, &[u8])], niveau: Compression) -> Vec<u8> {
        let compressees: Vec<(String, Vec<u8>, Vec<u8>)> = entrees
            .iter()
            .map(|(nom, contenu)| {
                (
                    (*nom).to_string(),
                    compresser_brut(contenu, niveau),
                    contenu.to_vec(),
                )
            })
            .collect();
        let mut sortie = Vec::new();
        let mut annuaire = Vec::new();
        for (nom, comprime, contenu) in &compressees {
            let decalage = sortie.len() as u32;
            sortie.extend_from_slice(&SIG_LOCALE);
            sortie.extend_from_slice(&[20, 0, 0, 0]);
            sortie.extend_from_slice(&8u16.to_le_bytes()); // DEFLATE
            sortie.extend_from_slice(&[0, 0, 0, 0]);
            sortie.extend_from_slice(&crc32(contenu).to_le_bytes());
            sortie.extend_from_slice(&(comprime.len() as u32).to_le_bytes());
            sortie.extend_from_slice(&(contenu.len() as u32).to_le_bytes());
            sortie.extend_from_slice(&(nom.len() as u16).to_le_bytes());
            sortie.extend_from_slice(&0u16.to_le_bytes());
            sortie.extend_from_slice(nom.as_bytes());
            sortie.extend_from_slice(comprime);

            annuaire.extend_from_slice(&SIG_ANNUAIRE);
            annuaire.extend_from_slice(&[20, 0, 20, 0]);
            annuaire.extend_from_slice(&0u16.to_le_bytes());
            annuaire.extend_from_slice(&8u16.to_le_bytes());
            annuaire.extend_from_slice(&[0, 0, 0, 0]);
            annuaire.extend_from_slice(&crc32(contenu).to_le_bytes());
            annuaire.extend_from_slice(&(comprime.len() as u32).to_le_bytes());
            annuaire.extend_from_slice(&(contenu.len() as u32).to_le_bytes());
            annuaire.extend_from_slice(&(nom.len() as u16).to_le_bytes());
            annuaire.extend_from_slice(&[0, 0, 0, 0]);
            annuaire.extend_from_slice(&0u16.to_le_bytes());
            annuaire.extend_from_slice(&0u16.to_le_bytes());
            annuaire.extend_from_slice(&0u32.to_le_bytes());
            annuaire.extend_from_slice(&decalage.to_le_bytes());
            annuaire.extend_from_slice(nom.as_bytes());
        }
        let debut_annuaire = sortie.len() as u32;
        let taille_annuaire = annuaire.len() as u32;
        sortie.extend_from_slice(&annuaire);
        sortie.extend_from_slice(&SIG_EOCD);
        sortie.extend_from_slice(&0u16.to_le_bytes());
        sortie.extend_from_slice(&0u16.to_le_bytes());
        sortie.extend_from_slice(&(compressees.len() as u16).to_le_bytes());
        sortie.extend_from_slice(&(compressees.len() as u16).to_le_bytes());
        sortie.extend_from_slice(&taille_annuaire.to_le_bytes());
        sortie.extend_from_slice(&debut_annuaire.to_le_bytes());
        sortie.extend_from_slice(&0u16.to_le_bytes());
        sortie
    }

    /// Position de l'entrée d'annuaire central d'une archive à une seule entrée.
    fn debut_annuaire(octets: &[u8]) -> usize {
        let eocd = octets.len() - TAILLE_EOCD;
        u32::from_le_bytes([
            octets[eocd + 16],
            octets[eocd + 17],
            octets[eocd + 18],
            octets[eocd + 19],
        ]) as usize
    }

    #[test]
    fn lire_une_archive_minimale() {
        let octets = archive_simple(&[
            ("mimetype", b"application/vnd.oasis.opendocument.text"),
            ("content.xml", b"<doc/>"),
        ]);
        let archive = Archive::lire(octets).unwrap();
        assert_eq!(archive.nombre_d_entrees(), 2);
        assert_eq!(archive.noms(), vec!["mimetype", "content.xml"]);
        assert_eq!(archive.extraire("content.xml").unwrap(), b"<doc/>");
        assert!(archive.trouver("mimetype").unwrap().est_stocke());
    }

    #[test]
    fn entree_absente() {
        let archive = Archive::lire(archive_simple(&[("a.txt", b"x")])).unwrap();
        assert_eq!(
            archive.extraire("b.txt"),
            Err(ErreurZip::EntreeAbsente {
                nom: "b.txt".to_string()
            })
        );
    }

    #[test]
    fn archive_vide() {
        let archive = Archive::lire(archive_simple(&[])).unwrap();
        assert_eq!(archive.nombre_d_entrees(), 0);
        assert!(archive.noms().is_empty());
    }

    #[test]
    fn commentaire_d_archive_jusqu_a_la_fin() {
        let mut octets = archive_simple(&[("a.txt", b"contenu")]);
        octets.extend_from_slice(b"un commentaire");
        let position = octets.len() - TAILLE_EOCD - 14;
        let ancienne = u16::from_le_bytes([octets[position + 20], octets[position + 21]]);
        assert_eq!(ancienne, 0);
        octets[position + 20..position + 22].copy_from_slice(&14u16.to_le_bytes());
        let archive = Archive::lire(octets).unwrap();
        assert_eq!(archive.extraire("a.txt").unwrap(), b"contenu");
    }

    #[test]
    fn un_commentaire_qui_contient_la_signature_ne_trompe_pas() {
        let mut octets = archive_simple(&[("a.txt", b"ok")]);
        let commentaire = {
            let mut c = SIG_EOCD.to_vec();
            c.extend_from_slice(b"faux");
            c
        };
        octets.extend_from_slice(&commentaire);
        let position = octets.len() - TAILLE_EOCD - commentaire.len();
        octets[position + 20..position + 22]
            .copy_from_slice(&(commentaire.len() as u16).to_le_bytes());
        let archive = Archive::lire(octets).unwrap();
        assert_eq!(archive.extraire("a.txt").unwrap(), b"ok");
    }

    #[test]
    fn ce_qui_n_est_pas_un_zip_est_dit_ainsi() {
        assert_eq!(
            Archive::lire(vec![0u8; 100]).unwrap_err(),
            ErreurZip::PasUneArchive
        );
        // Le cas réel : un .doc binaire renommé.
        let mut doc = vec![0xD0, 0xCF, 0x11, 0xE0, 0xA1, 0xB1, 0x1A, 0xE1];
        doc.extend_from_slice(&[0u8; 5000]);
        assert_eq!(Archive::lire(doc).unwrap_err(), ErreurZip::PasUneArchive);
        // Un RTF renommé.
        let rtf = b"{\\rtf1\\ansi un document}".to_vec();
        assert_eq!(Archive::lire(rtf).unwrap_err(), ErreurZip::PasUneArchive);
    }

    #[test]
    fn fichier_trop_court() {
        assert!(matches!(
            Archive::lire(vec![0x50, 0x4B]).unwrap_err(),
            ErreurZip::TropCourt { .. }
        ));
    }

    #[test]
    fn crc_abime_est_refuse() {
        let mut octets = archive_simple(&[("a.txt", b"contenu intact")]);
        // On abîme le contenu sans toucher aux CRC.
        let position = octets.windows(7).position(|f| f == b"contenu").unwrap();
        octets[position + 3] = b'X';
        let archive = Archive::lire(octets).unwrap();
        assert!(matches!(
            archive.extraire("a.txt").unwrap_err(),
            ErreurZip::CrcDifferent { .. }
        ));
    }

    #[test]
    fn entree_reellement_compressee() {
        // Un texte qui se comprime bien : l'entrée doit passer par DEFLATE, et
        // ressortir intacte.
        let texte =
            b"<document>un texte repetitif, repetitif, repetitif, repetitif</document>".repeat(40);
        let octets = archive_compressee(&[("content.xml", &texte)], Compression::Defaut);
        let archive = Archive::lire(octets).unwrap();
        let entree = archive.trouver("content.xml").unwrap();
        assert_eq!(entree.methode(), 8);
        assert!(
            entree.taille_compressee() < entree.taille() / 2,
            "le contenu aurait dû se compresser : {} → {}",
            entree.taille(),
            entree.taille_compressee()
        );
        assert_eq!(archive.extraire("content.xml").unwrap(), texte);
        assert_eq!(
            archive.extraire_texte("content.xml").unwrap().len(),
            texte.len()
        );
    }

    #[test]
    fn toute_corruption_du_flux_est_detectee() {
        // Le corps comprimé commence après l'en-tête local (30 octets) et le nom.
        let contenu: &[u8] = b"un contenu qui se compresse un peu, un peu, un peu, un peu";
        let octets = archive_compressee(&[("content.xml", contenu)], Compression::Defaut);
        let debut = 30 + "content.xml".len();
        let fin = octets.len() - TAILLE_EOCD - (46 + "content.xml".len());
        assert!(fin > debut + 4);

        let mut detectees = 0;
        let mut acceptees_et_justes = 0;
        for pas in 0..24 {
            let position = debut + (pas * (fin - debut) / 24);
            let mut abime = octets.clone();
            abime[position] ^= 0xA5;
            let Ok(archive) = Archive::lire(abime) else {
                // L'annuaire lui-même est touché : l'ouverture échoue, c'est
                // une détection de plus.
                detectees += 1;
                continue;
            };
            match archive.extraire("content.xml") {
                Err(_) => detectees += 1,
                Ok(rendu) => {
                    // Aucune corruption ne doit passer pour le contenu intact.
                    assert_ne!(
                        rendu, contenu,
                        "corruption à l'octet {position} acceptée sans être vue"
                    );
                    acceptees_et_justes += 1;
                }
            }
        }
        assert_eq!(
            detectees + acceptees_et_justes,
            24,
            "chaque corruption doit être classée"
        );
        assert!(
            detectees >= 20,
            "trop peu de corruptions détectées : {detectees} sur 24"
        );
    }

    #[test]
    fn flux_deflate_abime_est_refuse_nomme() {
        // On remplace le corps comprimé par des octets qui ne peuvent pas être
        // un flux DEFLATE valide : un bloc de type 3 n'existe pas.
        let contenu: &[u8] = b"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx";
        let mut octets = archive_compressee(&[("content.xml", contenu)], Compression::Defaut);
        let debut = 30 + "content.xml".len();
        let fin = octets.len() - TAILLE_EOCD - (46 + "content.xml".len());
        for octet in &mut octets[debut..fin] {
            *octet = 0xFF;
        }
        let archive = Archive::lire(octets).unwrap();
        let erreur = archive.extraire("content.xml").unwrap_err();
        assert!(
            matches!(
                erreur,
                ErreurZip::DeflateIllisible { .. } | ErreurZip::TailleDifferent { .. }
            ),
            "erreur inattendue : {erreur:?}"
        );
        // Et le message nomme l'entrée fautive.
        assert!(erreur.to_string().contains("content.xml"));
    }

    #[test]
    fn donnees_qui_sortent_du_fichier_sont_refusees() {
        let mut octets = archive_simple(&[("a.txt", b"court")]);
        let annuaire = debut_annuaire(&octets);
        // La taille compressée annoncée dépasse la fin du fichier.
        octets[annuaire + 20..annuaire + 24].copy_from_slice(&999_999u32.to_le_bytes());
        let archive = Archive::lire(octets).unwrap();
        assert!(matches!(
            archive.extraire("a.txt").unwrap_err(),
            ErreurZip::HorsFichier { .. }
        ));
    }

    #[test]
    fn taille_declaree_qui_ne_correspond_pas_est_refusee() {
        let mut octets = archive_simple(&[("a.txt", b"0123456789")]);
        let annuaire = debut_annuaire(&octets);
        // La taille décompressée annoncée ne fait pas la taille réelle.
        octets[annuaire + 24..annuaire + 28].copy_from_slice(&7u32.to_le_bytes());
        let archive = Archive::lire(octets).unwrap();
        assert_eq!(
            archive.extraire("a.txt"),
            Err(ErreurZip::TailleDifferent {
                nom: "a.txt".to_string(),
                attendue: 7,
                obtenue: 10,
            })
        );
    }

    #[test]
    fn en_tete_local_manquant_est_refuse() {
        let mut octets = archive_simple(&[("a.txt", b"x")]);
        // On détruit la signature de l'en-tête local.
        octets[0] = b'X';
        let archive = Archive::lire(octets).unwrap();
        assert!(matches!(
            archive.extraire("a.txt").unwrap_err(),
            ErreurZip::HorsFichier { .. }
        ));
    }

    #[test]
    fn nom_non_utf8_refuse() {
        let mut octets = archive_simple(&[("aa", b"x")]);
        let annuaire = debut_annuaire(&octets);
        // Deux octets de nom illisibles en UTF-8.
        octets[annuaire + 46] = 0xFF;
        octets[annuaire + 47] = 0xFE;
        assert!(matches!(
            Archive::lire(octets).unwrap_err(),
            ErreurZip::NomIllisible { .. }
        ));
    }

    #[test]
    fn zip64_est_refuse_nomme() {
        let mut octets = archive_simple(&[("a.txt", b"x")]);
        // La sentinelle de nombre d'entrées déclare ZIP64.
        let position = octets.len() - TAILLE_EOCD;
        octets[position + 10..position + 12].copy_from_slice(&0xFFFFu16.to_le_bytes());
        octets[position + 8..position + 10].copy_from_slice(&0xFFFFu16.to_le_bytes());
        assert_eq!(Archive::lire(octets).unwrap_err(), ErreurZip::Zip64Refuse);
    }

    #[test]
    fn multi_volume_est_refuse_nomme() {
        let mut octets = archive_simple(&[("a.txt", b"x")]);
        let position = octets.len() - TAILLE_EOCD;
        octets[position + 4..position + 6].copy_from_slice(&1u16.to_le_bytes());
        assert_eq!(Archive::lire(octets).unwrap_err(), ErreurZip::MultiVolume);
    }

    #[test]
    fn entree_chiffree_est_refusee_nommee() {
        let mut octets = archive_simple(&[("secret.txt", b"x")]);
        let position = octets.len() - TAILLE_EOCD - 46 - "secret.txt".len();
        // Drapeau 0 : chiffrement.
        octets[position + 8..position + 10].copy_from_slice(&1u16.to_le_bytes());
        assert!(matches!(
            Archive::lire(octets).unwrap_err(),
            ErreurZip::Chiffre { .. }
        ));
    }

    #[test]
    fn noms_suspects_refuses() {
        for nom in ["/etc/passwd", "../evasion.txt", "a/../../b", "C:/windows/x"] {
            assert!(nom_suspect(nom).is_some(), "{nom} doit être suspect");
        }
        for nom in ["word/document.xml", "content.xml", "a/b/c.xml", "..foo"] {
            assert!(nom_suspect(nom).is_none(), "{nom} ne doit pas être suspect");
        }
    }

    #[test]
    fn archive_qui_annonce_plus_d_entrees_qu_il_n_y_en_a() {
        let mut octets = archive_simple(&[("a.txt", b"x")]);
        let position = octets.len() - TAILLE_EOCD;
        octets[position + 10..position + 12].copy_from_slice(&5u16.to_le_bytes());
        octets[position + 8..position + 10].copy_from_slice(&5u16.to_le_bytes());
        assert!(matches!(
            Archive::lire(octets).unwrap_err(),
            ErreurZip::AnnuaireIncoherent { annonce: 5, lu: 1 }
        ));
    }

    #[test]
    fn methodes_exotiques_refusees_nommees() {
        let octets = archive_simple(&[("a.txt", b"x")]);
        // Même archive, mais la méthode est réécrite en BZIP2 dans les deux
        // en-têtes.
        let mut bzip = octets.clone();
        bzip[8..10].copy_from_slice(&12u16.to_le_bytes());
        let annuaire = debut_annuaire(&octets);
        bzip[annuaire + 10..annuaire + 12].copy_from_slice(&12u16.to_le_bytes());
        let archive = Archive::lire(bzip).unwrap();
        assert_eq!(
            archive.extraire("a.txt"),
            Err(ErreurZip::MethodeInconnue {
                nom: "a.txt".to_string(),
                methode: 12
            })
        );
    }

    #[test]
    fn recherche_souple() {
        let archive = Archive::lire(archive_simple(&[
            ("word/document.xml", b"<w/>"),
            ("[Content_Types].xml", b"<t/>"),
        ]))
        .unwrap();
        assert!(archive.trouver("WORD/DOcument.xml").is_none());
        assert!(archive.trouver_souple("WORD/DOcument.xml").is_some());
        assert!(archive.trouver_souple("word\\document.xml").is_some());
        assert!(archive.trouver_souple("[content_types].xml").is_some());
    }

    #[test]
    fn reconnaitre_une_archive_a_la_signature() {
        assert!(ressemble_a_une_archive(&archive_simple(&[("a", b"b")])));
        assert!(ressemble_a_une_archive(&SIG_EOCD));
        assert!(!ressemble_a_une_archive(b"%PDF-1.6"));
        assert!(!ressemble_a_une_archive(b"%!PS-Adobe-3.0"));
        assert!(!ressemble_a_une_archive(b"PK"));
    }
}
