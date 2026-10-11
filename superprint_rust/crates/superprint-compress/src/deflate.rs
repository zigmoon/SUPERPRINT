//! Compresseur DEFLATE — LZ77 puis codage de Huffman **figé**.
//!
//! ## En deux temps, comme la norme le prévoit
//!
//! 1. **LZ77** : on cherche, à chaque position, la plus longue suite déjà vue
//!    ailleurs dans les 32 Ko précédents. On émet alors un couple
//!    (longueur, distance) au lieu des octets. C'est là que se gagne
//!    l'essentiel — un aplat, un dégradé, du texte répétitif se réduisent de
//!    plusieurs dizaines de fois.
//! 2. **Huffman** : les symboles ainsi produits (octets littéraux, longueurs,
//!    distances) sont écrits avec des codes courts pour les fréquents.
//!
//! ## Pourquoi le Huffman **figé**
//!
//! La RFC 1951 définit deux tables fixes, connues du décodeur, qui n'ont donc
//! pas à être transmises. Les employer économise tout un en-tête et rend le
//! code vérifiable. La contrepartie est chiffrée et assumée : un Huffman
//! **dynamique** (calculé par bloc) gagne encore 5 à 15 % sur du texte. Voir
//! `docs/PORTAGE.md`.
//!
//! ## Le choix entre les deux formes de bloc
//!
//! À la fin, on compare la taille du bloc compressé et celle des données
//! **recopiées telles quelles** (bloc « stocké », qui coûte 5 octets pour
//! 65 535). Sur du bruit — une photographie tramée, un tirage aléatoire — la
//! compression ne gagne rien et peut même coûter : on prend alors la plus
//! petite des deux. Un compresseur qui gonfle ses entrées est un compresseur
//! qu'on n'ose pas activer.

use super::inflate::ErreurDeflate;

/// Niveau de compression demandé.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Compression {
    /// Cherche moins loin : plus rapide, moins bon. Convient aux gros aplats.
    Rapide,
    /// Le réglage par défaut.
    Defaut,
    /// Cherche plus loin : plus lent, un peu meilleur.
    Pousse,
}

impl Compression {
    /// Longueur maximale de la chaîne de recherche.
    fn chaine_max(self) -> usize {
        match self {
            Self::Rapide => 16,
            Self::Defaut => 192,
            Self::Pousse => 1024,
        }
    }

    /// Différence de longueur minimale pour préférer un littéral retardé.
    fn paresseux(self) -> bool {
        !matches!(self, Self::Rapide)
    }
}

/// La fenêtre glissante de DEFLATE : 32 768 octets.
const FENETRE: usize = 32_768;

/// Longueur minimale d'une correspondance : en dessous, les bits de code
/// coûtent plus que les octets recopiés.
const LONGUEUR_MIN: usize = 3;

/// Longueur maximale d'une correspondance.
const LONGUEUR_MAX: usize = 258;

/// Taille maximale d'un bloc **stocké**.
const BLOC_STOCKE_MAX: usize = 65_535;

/// Compresse un tampon entier : un seul bloc, figé ou stocké.
#[must_use]
pub fn compresser(donnees: &[u8], niveau: Compression) -> Vec<u8> {
    let mut figes = BitEcrivain::new();
    figes.bit(1, 1); // BFINAL : dernier bloc
    figes.bit(1, 2); // BTYPE : 01 = Huffman figé
    for jeton in jetons(donnees, niveau) {
        ecrire_jeton(&mut figes, &jeton);
    }
    ecrire_symbole(&mut figes, 256); // fin de bloc
    let compresse = figes.terminer();

    // Bloc stocké : recopie directe, 5 octets d'en-tête pour 65 535 utiles.
    let stocke = stocker(donnees);

    if stocke.len() <= compresse.len() {
        stocke
    } else {
        compresse
    }
}

/// Assemble un ou plusieurs blocs **stockés**.
fn stocker(donnees: &[u8]) -> Vec<u8> {
    if donnees.is_empty() {
        let mut e = BitEcrivain::new();
        e.bit(1, 1);
        e.bit(0, 2);
        e.bit(0, 5); // reste de l'alignement d'octet
        e.bit(0, 16);
        e.bit(0xFFFF, 16);
        return e.terminer();
    }
    let mut sortie = Vec::with_capacity(donnees.len() + donnees.len() / BLOC_STOCKE_MAX * 5 + 5);
    let mut reste = donnees;
    while !reste.is_empty() {
        let taille = reste.len().min(BLOC_STOCKE_MAX);
        let (bloc, suite) = reste.split_at(taille);
        let dernier = suite.is_empty();
        sortie.push(u8::from(dernier)); // BFINAL + BTYPE 00 : aligné sur l'octet
        sortie.extend_from_slice(&(bloc.len() as u16).to_le_bytes());
        sortie.extend_from_slice(&(!(bloc.len() as u16)).to_le_bytes());
        sortie.extend_from_slice(bloc);
        reste = suite;
    }
    sortie
}

/// Une suite compressée : un octet, ou une correspondance (longueur, distance).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Jeton {
    Litteral(u8),
    Correspondance { longueur: usize, distance: usize },
}

/// Produit la suite de jetons LZ77.
fn jetons(donnees: &[u8], niveau: Compression) -> Vec<Jeton> {
    let mut sortie = Vec::with_capacity(donnees.len() / 2 + 1);
    // En dessous de trois octets, il n'y a rien à hacher : tout est littéral.
    // ⚠️ `saturating_sub` seul ne suffit pas — il rendrait 0 pour un tampon
    // d'un octet, ce qui ferait lire `donnees[2]`. C'est le corpus de contrôle
    // qui a fait tomber ce cas, pas un raisonnement.
    if donnees.len() < LONGUEUR_MIN {
        return donnees
            .iter()
            .map(|octet| Jeton::Litteral(*octet))
            .collect();
    }
    let chaine_max = niveau.chaine_max();
    let paresseux = niveau.paresseux();

    // Table de hachage des trios : `tete[h]` donne la dernière position vue
    // dont les trois octets hachés valent `h`, et `precedent[p]` la précédente
    // pour la même valeur. C'est la chaîne de recherche.
    const BITS_HACHAGE: u32 = 15;
    const TAILLE_TABLE: usize = 1 << BITS_HACHAGE;
    let mut tete = vec![usize::MAX; TAILLE_TABLE];
    let mut precedent = vec![0usize; donnees.len().max(1)];

    let hacher = |index: usize| -> usize {
        let a = u32::from(donnees[index]);
        let b = u32::from(donnees[index + 1]);
        let c = u32::from(donnees[index + 2]);
        (((a << 10) ^ (b << 5) ^ c) as usize) & (TAILLE_TABLE - 1)
    };

    let mut position = 0usize;
    let limite = donnees.len() - LONGUEUR_MIN;
    while position <= limite {
        let h = hacher(position);
        let mut meilleur = (0usize, 0usize);
        if tete[h] != usize::MAX {
            let mut candidat = tete[h];
            let mut essais = 0usize;
            let distance_max = position.min(FENETRE);
            loop {
                let distance = position - candidat;
                if distance == 0 || distance > distance_max {
                    break;
                }
                // Comparaison : on avance tant que ça correspond.
                let max = (donnees.len() - position).min(LONGUEUR_MAX);
                let mut longueur = 0usize;
                while longueur < max && donnees[candidat + longueur] == donnees[position + longueur]
                {
                    longueur += 1;
                }
                if longueur > meilleur.0 {
                    meilleur = (longueur, distance);
                    if longueur >= LONGUEUR_MAX {
                        break;
                    }
                }
                essais += 1;
                if essais >= chaine_max {
                    break;
                }
                let suivant = precedent[candidat];
                // Une chaîne remonte le temps : une position qui n'est pas
                // strictement antérieure marque la fin.
                if suivant == usize::MAX || suivant >= candidat {
                    break;
                }
                candidat = suivant;
            }
        }

        // Correspondance trop courte : un littéral coûte moins cher.
        if meilleur.0 < LONGUEUR_MIN {
            sortie.push(Jeton::Litteral(donnees[position]));
            // On inscrit la position dans la chaîne pour les recherches à venir.
            precedent[position] = tete[h];
            tete[h] = position;
            position += 1;
            continue;
        }

        let (longueur, distance) = meilleur;

        // Évaluation paresseuse : si la position suivante offre une
        // correspondance nettement meilleure, on émet un littéral maintenant et
        // on la prendra au tour suivant. C'est ce qui évite de consommer une
        // bonne suite pour une médiocre.
        if paresseux && position < limite {
            precedent[position] = tete[h];
            tete[h] = position;
            let h_suivant = hacher(position + 1);
            let mut meilleur_suivant = 0usize;
            if tete[h_suivant] != usize::MAX {
                let mut candidat = tete[h_suivant];
                let mut essais = 0usize;
                loop {
                    let d = (position + 1) - candidat;
                    if candidat > position || d > (position + 1).min(FENETRE) {
                        break;
                    }
                    let max = (donnees.len() - (position + 1)).min(LONGUEUR_MAX);
                    let mut l = 0usize;
                    while l < max && donnees[candidat + l] == donnees[position + 1 + l] {
                        l += 1;
                    }
                    if l > meilleur_suivant {
                        meilleur_suivant = l;
                    }
                    essais += 1;
                    if essais >= chaine_max || meilleur_suivant >= LONGUEUR_MAX {
                        break;
                    }
                    let suivant = precedent[candidat];
                    if suivant == usize::MAX || suivant >= candidat {
                        break;
                    }
                    candidat = suivant;
                }
            }
            // « Nettement » : un octet de plus ne justifie pas de retarder.
            if meilleur_suivant > longueur + 1 {
                sortie.push(Jeton::Litteral(donnees[position]));
                position += 1;
                continue;
            }
        }

        sortie.push(Jeton::Correspondance { longueur, distance });
        // Toutes les positions traversées entrent dans la chaîne : sauter ces
        // inscriptions coûterait des correspondances plus loin.
        let fin = (position + longueur).min(donnees.len() - LONGUEUR_MIN + 1);
        for p in position..fin {
            if p + 2 < donnees.len() {
                let hp = hacher(p);
                if let Some(cellule) = precedent.get_mut(p) {
                    *cellule = tete[hp];
                }
                tete[hp] = p;
            }
        }
        position += longueur;
    }

    // Ce qui reste après la dernière correspondance.
    while position < donnees.len() {
        sortie.push(Jeton::Litteral(donnees[position]));
        position += 1;
    }
    sortie
}

/// Les longueurs et les codes de base de la RFC 1951, table §3.2.5.
///
/// `(code, base, bits_supplementaires)` — la base est la longueur (ou la
/// distance) de départ, les bits supplémentaires disent de combien on peut
/// dépasser.
const LONGUEURS: [(u16, usize, u32); 29] = [
    (257, 3, 0),
    (258, 4, 0),
    (259, 5, 0),
    (260, 6, 0),
    (261, 7, 0),
    (262, 8, 0),
    (263, 9, 0),
    (264, 10, 0),
    (265, 11, 1),
    (266, 13, 1),
    (267, 15, 1),
    (268, 17, 1),
    (269, 19, 2),
    (270, 23, 2),
    (271, 27, 2),
    (272, 31, 2),
    (273, 35, 3),
    (274, 43, 3),
    (275, 51, 3),
    (276, 59, 3),
    (277, 67, 4),
    (278, 83, 4),
    (279, 99, 4),
    (280, 115, 4),
    (281, 131, 5),
    (282, 163, 5),
    (283, 195, 5),
    (284, 227, 5),
    (285, 258, 0),
];

/// Les distances de la RFC 1951, table §3.2.5.
const DISTANCES: [(u16, usize, u32); 30] = [
    (0, 1, 0),
    (1, 2, 0),
    (2, 3, 0),
    (3, 4, 0),
    (4, 5, 1),
    (5, 7, 1),
    (6, 9, 2),
    (7, 13, 2),
    (8, 17, 3),
    (9, 25, 3),
    (10, 33, 4),
    (11, 49, 4),
    (12, 65, 5),
    (13, 97, 5),
    (14, 129, 6),
    (15, 193, 6),
    (16, 257, 7),
    (17, 385, 7),
    (18, 513, 8),
    (19, 769, 8),
    (20, 1025, 9),
    (21, 1537, 9),
    (22, 2049, 10),
    (23, 3073, 10),
    (24, 4097, 11),
    (25, 6145, 11),
    (26, 8193, 12),
    (27, 12289, 12),
    (28, 16385, 13),
    (29, 24577, 13),
];

/// Écrit un jeton avec les codes **figés**.
fn ecrire_jeton(ecrivain: &mut BitEcrivain, jeton: &Jeton) {
    match jeton {
        Jeton::Litteral(octet) => ecrire_symbole(ecrivain, u16::from(*octet)),
        Jeton::Correspondance { longueur, distance } => {
            // Le couple est décrit par (code de longueur, bits en trop) puis
            // (code de distance, bits en trop).
            if let Some(&(code, base, bits)) = LONGUEURS
                .iter()
                .rev()
                .find(|(_, base, _)| *base <= *longueur)
            {
                ecrire_symbole(ecrivain, code);
                if bits > 0 {
                    ecrivain.bit((longueur - base) as u32, bits);
                }
            }
            if let Some(&(code, base, bits)) = DISTANCES
                .iter()
                .rev()
                .find(|(_, base, _)| *base <= *distance)
            {
                // ⚠️ Une distance est un **code de Huffman** : ses 5 bits
                // partent du poids fort, exactement comme les symboles. Les
                // écrire du poids faible produit un flux qui se relit chez soi
                // et nulle part ailleurs — c'est le piège du format.
                ecrivain.code(u32::from(code), 5);
                if bits > 0 {
                    ecrivain.bit((distance - base) as u32, bits);
                }
            }
        }
    }
}

/// Écrit un symbole avec la table **figée** de la RFC 1951 §3.2.6.
///
/// | Symbole | Bits | Code |
/// |---|---|---|
/// | 0–143 | 8 | `0x30 + s` |
/// | 144–255 | 9 | `0x190 + s − 144` |
/// | 256–279 | 7 | `s − 256` |
/// | 280–287 | 8 | `0xC0 + s − 280` |
fn ecrire_symbole(ecrivain: &mut BitEcrivain, symbole: u16) {
    match symbole {
        0..=143 => ecrivain.code(u32::from(symbole) + 0x30, 8),
        144..=255 => ecrivain.code(u32::from(symbole) - 144 + 0x190, 9),
        256..=279 => ecrivain.code(u32::from(symbole) - 256, 7),
        280..=287 => ecrivain.code(u32::from(symbole) - 280 + 0xC0, 8),
        // Un symbole au-delà de la table est un défaut interne : il ne peut
        // provenir que d'une longueur hors bornes, ce que `LONGUEURS` interdit.
        _ => ecrivain.code(0, 8),
    }
}

/// Écriture de bits, dans l'ordre que DEFLATE impose.
///
/// ⚠️ Le piège du format : les **bits bruts** partent du bit de poids faible,
/// mais les **codes de Huffman** partent du bit de poids fort. `bit` écrit des
/// bits bruts, `code` retourne le code avant de l'écrire. Confondre les deux
/// produit un flux qui se relit chez soi et nulle part ailleurs.
struct BitEcrivain {
    octets: Vec<u8>,
    courant: u8,
    remplis: u32,
}

impl BitEcrivain {
    fn new() -> Self {
        Self {
            octets: Vec::new(),
            courant: 0,
            remplis: 0,
        }
    }

    /// Écrit `nombre` bits de `valeur`, en partant du poids faible.
    fn bit(&mut self, valeur: u32, nombre: u32) {
        for index in 0..nombre {
            let b = (valeur >> index) & 1;
            self.courant |= (b as u8) << self.remplis;
            self.remplis += 1;
            if self.remplis == 8 {
                self.octets.push(self.courant);
                self.courant = 0;
                self.remplis = 0;
            }
        }
    }

    /// Écrit un **code de Huffman** de `nombre` bits, poids fort en tête.
    fn code(&mut self, valeur: u32, nombre: u32) {
        let mut retourne = 0u32;
        for index in 0..nombre {
            retourne |= ((valeur >> (nombre - 1 - index)) & 1) << index;
        }
        self.bit(retourne, nombre);
    }

    /// Termine le flux en complétant l'octet courant.
    fn terminer(mut self) -> Vec<u8> {
        if self.remplis > 0 {
            self.octets.push(self.courant);
        }
        self.octets
    }
}

/// Vérifie qu'un flux produit par ce module se relit — utilisé par les tests.
pub fn verifier_aller_retour(donnees: &[u8], niveau: Compression) -> Result<(), ErreurDeflate> {
    let comprime = compresser(donnees, niveau);
    let relu = super::inflate::decompresser(&comprime)?;
    if relu == donnees {
        Ok(())
    } else {
        Err(ErreurDeflate::LongueurInvalide {
            attendu: donnees.len(),
            obtenu: relu.len(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn aller_retour(donnees: &[u8]) {
        for niveau in [
            Compression::Rapide,
            Compression::Defaut,
            Compression::Pousse,
        ] {
            verifier_aller_retour(donnees, niveau)
                .unwrap_or_else(|e| panic!("aller-retour impossible ({niveau:?}) : {e}"));
        }
    }

    #[test]
    fn un_tampon_vide_se_compresse_et_se_relit() {
        aller_retour(b"");
        let comprime = compresser(b"", Compression::Defaut);
        assert!(comprime.len() <= 6, "un tampon vide doit tenir en un bloc");
    }

    #[test]
    fn un_seul_octet_se_relit() {
        aller_retour(b"a");
        aller_retour(b"\0");
        aller_retour(&[0xFF]);
    }

    #[test]
    fn un_aplat_se_reduit_fortement() {
        let donnees = vec![0u8; 100_000];
        let comprime = compresser(&donnees, Compression::Defaut);
        assert!(
            comprime.len() < 1000,
            "100 000 octets identiques devraient tenir en moins de 1 000 : {}",
            comprime.len()
        );
        verifier_aller_retour(&donnees, Compression::Defaut).unwrap();
    }

    #[test]
    fn du_texte_repetitif_se_reduit() {
        let phrase = "le petit chat dort sur le canape du salon, tranquillement. ";
        let donnees = phrase.repeat(200).into_bytes();
        let comprime = compresser(&donnees, Compression::Defaut);
        assert!(
            comprime.len() * 10 < donnees.len(),
            "la repetition devrait au moins diviser par dix : {} → {}",
            donnees.len(),
            comprime.len()
        );
        verifier_aller_retour(&donnees, Compression::Defaut).unwrap();
    }

    #[test]
    fn du_bruit_n_est_pas_gonfle() {
        // Un générateur congruentiel : reproductible, et incompressible.
        let mut etat = 0x1234_5678u32;
        let donnees: Vec<u8> = (0..40_000)
            .map(|_| {
                etat = etat.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
                (etat >> 24) as u8
            })
            .collect();
        let comprime = compresser(&donnees, Compression::Defaut);
        assert!(
            comprime.len() <= donnees.len() + donnees.len() / 100 + 16,
            "un compresseur ne doit jamais gonfler : {} → {}",
            donnees.len(),
            comprime.len()
        );
        verifier_aller_retour(&donnees, Compression::Defaut).unwrap();
    }

    #[test]
    fn les_donnees_de_plus_de_65_535_octets_passent() {
        let donnees: Vec<u8> = (0..200_000u32).map(|i| (i % 7) as u8).collect();
        aller_retour(&donnees);
    }

    #[test]
    fn une_sequence_qui_se_recouvre_est_relue() {
        // « aaaaa… » : la correspondance se recouvre elle-même (distance 1).
        // C'est le cas que la norme autorise et qu'un décodeur naïf rate.
        let donnees = vec![b'x'; 300];
        aller_retour(&donnees);
    }

    #[test]
    fn un_motif_de_deux_octets_repetes_est_relu() {
        let donnees = b"abababababababababababababababab".to_vec();
        aller_retour(&donnees);
    }

    #[test]
    fn les_octets_sur_tout_le_domaine_passent() {
        let donnees: Vec<u8> = (0..=255u8).collect();
        aller_retour(&donnees);
        let doubles: Vec<u8> = (0..=255u8).chain(0..=255u8).collect();
        aller_retour(&doubles);
    }

    #[test]
    fn la_fenetre_glissante_tient_sur_32_ko() {
        // Un motif placé juste au-delà de la fenêtre ne doit pas être utilisé…
        // mais tout doit se relire, quelle que soit la distance retenue.
        let mut donnees = vec![0u8; FENETRE + 1000];
        for (index, octet) in donnees.iter_mut().enumerate() {
            *octet = ((index / 37) % 13) as u8;
        }
        aller_retour(&donnees);
    }

    #[test]
    fn la_longueur_maximale_d_une_correspondance_est_respectee() {
        // 258 est le maximum de la norme ; 259 produirait un code inexistant.
        assert_eq!(LONGUEUR_MAX, 258);
        assert_eq!(LONGUEURS[LONGUEURS.len() - 1].1, LONGUEUR_MAX);
    }

    #[test]
    fn les_tables_de_la_norme_sont_coherentes() {
        // Chaque entrée doit couvrir exactement la plage de la suivante…
        // …sauf entre les codes 284 et 285 : la norme place là une exception
        // connue (284 va de 227 à 257 avec 5 bits, dont une valeur est
        // inutilisée, et 285 vaut exactement 258). On la vérifie à part.
        for fenetre in LONGUEURS.windows(2).take(LONGUEURS.len() - 2) {
            let (_, base, bits) = fenetre[0];
            let attendu = base + (1usize << bits);
            assert_eq!(fenetre[1].1, attendu, "table des longueurs incohérente");
        }
        let avant_derniere = LONGUEURS[LONGUEURS.len() - 2];
        assert_eq!(
            (avant_derniere.0, avant_derniere.1, avant_derniere.2),
            (284, 227, 5)
        );
        let derniere = LONGUEURS[LONGUEURS.len() - 1];
        assert_eq!(
            (derniere.0, derniere.1, derniere.2),
            (285, 258, 0),
            "le code 285 vaut exactement 258, sans bits supplémentaires"
        );

        for fenetre in DISTANCES.windows(2) {
            let (_, base, bits) = fenetre[0];
            let attendu = base + (1usize << bits);
            assert_eq!(fenetre[1].1, attendu, "table des distances incohérente");
        }
        assert_eq!(
            DISTANCES[DISTANCES.len() - 1].1 + (1 << DISTANCES[DISTANCES.len() - 1].2),
            32_769,
            "la dernière distance doit couvrir jusqu'à 32 768"
        );
    }
}
