//! # superprint-font — analyse de police TrueType
//!
//! C'est le module qui manquait pour écrire du **texte** dans un PDF
//! d'impression : sans lui, on ne sait placer que des aplats et des images.
//!
//! ## Ce que le module fait, et ce qu'il ne fait pas
//!
//! Il **lit** une police TrueType pour en tirer trois choses :
//!
//! 1. la correspondance **caractère Unicode → identifiant de glyphe** (table
//!    `cmap`) — un PDF en `Identity-H` n'écrit pas des caractères, il écrit des
//!    identifiants de glyphe ;
//! 2. les **largeurs d'avance** (table `hmtx`) — sans elles, impossible de savoir
//!    où placer le caractère suivant ;
//! 3. les **métriques de descripteur** (montée, descente, cadre, style) — ce que
//!    le PDF exige pour un texte bien rendu.
//!
//! Il **n'analyse pas les contours** : le fichier est embarqué **tel quel** dans
//! le PDF. Conséquence honnête : le PDF porte la police entière, pas seulement
//! les caractères utilisés. Un sous-ensemble pèserait cinq à dix fois moins, mais
//! demanderait de réécrire les tables `glyf`, `loca`, `hmtx` et `cmap` — un
//! chantier à part entière, noté dans `docs/PLAN.md`.
//!
//! ## Formats refusés, et pourquoi
//!
//! - **`OTTO`** (OpenType à contours CFF) : les dessins ne sont pas dans `glyf`.
//!   L'embarquer demanderait `/FontFile3` et un sous-type `CIDFontType0C`, que ce
//!   module n'écrit pas encore ;
//! - **`.ttc`** (collection) : plusieurs polices dans un fichier, il faut
//!   d'abord en extraire une ;
//! - **`woff` / `woff2`** : polices compressées, à décompresser avant.
//!
//! Ces refus sont **explicites** : un message qui dit quoi faire, pas un échec
//! silencieux.
//!
//! ## Entrée non fiable
//!
//! Un fichier de police vient du disque de l'utilisateur : il peut être tronqué,
//! d'un autre format, ou fabriqué. **Aucune lecture n'est non vérifiée** — c'est
//! la raison d'être de [`sfnt::Reader`], qui borne chaque accès.
//!
//! Feuille de route : `superprint_rust/docs/PLAN.md` (module n° 6).

#![forbid(unsafe_code)]

pub mod cmap;
pub mod face;
pub mod name;
pub mod sfnt;

pub use cmap::Cmap;
pub use face::FontFace;
pub use name::Names;

/// Ce qui empêche de lire une police.
///
/// Chaque variante dit **ce qui ne va pas**, pas seulement que ça n'a pas
/// marché : c'est ce qu'un utilisateur a besoin de lire pour corriger son
/// fichier.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum FontError {
    /// La plage demandée sort des octets disponibles.
    Truncated {
        /// Décalage demandé.
        offset: usize,
        /// Longueur demandée.
        len: usize,
    },
    /// Les quatre premiers octets ne sont pas un format sfnt connu.
    BadSignature {
        /// Les octets lus, en hexadécimal.
        signature: String,
    },
    /// Format reconnu mais non pris en charge, avec la marche à suivre.
    UnsupportedFormat {
        /// Explication, orientée vers l'action à faire.
        raison: &'static str,
    },
    /// Une table obligatoire est absente.
    MissingTable {
        /// Étiquette de la table (`head`, `cmap`…).
        tag: &'static str,
    },
    /// Aucune sous-table `cmap` exploitable.
    CmapUnsupported {
        /// Format de la première sous-table rencontrée, pour le diagnostic.
        format: u16,
    },
    /// Une valeur est incohérente dans une table.
    BadValue {
        /// Table concernée.
        table: &'static str,
        /// Le champ fautif.
        champ: &'static str,
    },
}

impl std::fmt::Display for FontError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Truncated { offset, len } => write!(
                f,
                "police tronquée : {len} octet(s) demandé(s) à l'offset {offset}"
            ),
            Self::BadSignature { signature } => write!(
                f,
                "ce n'est pas une police TrueType (signature {signature})"
            ),
            Self::UnsupportedFormat { raison } => {
                write!(f, "police non prise en charge : {raison}")
            }
            Self::MissingTable { tag } => {
                write!(f, "table « {tag} » absente : la police est inutilisable")
            }
            Self::CmapUnsupported { format } => write!(
                f,
                "aucune table cmap exploitable (premier format rencontré : {format})"
            ),
            Self::BadValue { table, champ } => {
                write!(f, "valeur incohérente dans « {table} » : {champ}")
            }
        }
    }
}

impl std::error::Error for FontError {}

/// Construit une police minimale mais **valide**, pour les tests et les
/// démonstrations.
///
/// Un vrai fichier de police pèse des centaines de kilo-octets et n'a pas sa
/// place dans un dépôt. Ce constructeur en fabrique un de moins d'un kilo-octet,
/// avec des tables **conformes au format** : l'analyse est donc testée pour de
/// bon, et les tests restent déterministes et lisibles.
///
/// Ce n'est **pas** un outil de production : les contours sont vides, la police
/// ne dessine rien, et elle ne sert qu'à vérifier la lecture des tables. Un PDF
/// produit avec elle est structurellement juste mais visuellement vide — les
/// validations qui font appel à un lecteur réel utilisent une vraie police.
pub mod synth {
    /// Une police synthétique, décrite par ses caractères et leurs avances.
    pub struct PoliceSynth {
        pub upem: u16,
        pub famille: String,
        pub style: String,
        pub nom_postscript: String,
        pub italic_angle: f64,
        /// `(caractère, avance en unités de police)`.
        pub glyphes: Vec<(char, u16)>,
    }

    impl Default for PoliceSynth {
        fn default() -> Self {
            Self {
                upem: 1000,
                famille: "Synthétique".into(),
                style: "Regular".into(),
                nom_postscript: "Synthetique-Regular".into(),
                italic_angle: 0.0,
                glyphes: vec![
                    (' ', 250),
                    ('A', 600),
                    ('B', 620),
                    ('a', 500),
                    ('b', 520),
                    ('é', 500),
                ],
            }
        }
    }

    /// Rend les octets d'un fichier sfnt valide.
    pub fn construire(p: &PoliceSynth) -> Vec<u8> {
        let nb_glyphes = (p.glyphes.len() + 1) as u16; // + .notdef

        // ── glyf vide + loca tout à zéro : aucun contour, mais tables présentes.
        let glyf = Vec::<u8>::new();
        let loca: Vec<u8> = vec![0; (usize::from(nb_glyphes) + 1) * 2]; // format court

        // ── hmtx : une avance + un lsb par glyphe (.notdef d'abord).
        let mut hmtx = Vec::new();
        hmtx.extend_from_slice(&0u16.to_be_bytes()); // .notdef : avance 0
        hmtx.extend_from_slice(&0i16.to_be_bytes()); // lsb
        for (_, avance) in &p.glyphes {
            hmtx.extend_from_slice(&avance.to_be_bytes());
            hmtx.extend_from_slice(&0i16.to_be_bytes());
        }

        // ── cmap format 4 : deux segments (la plage, puis la sentinelle).
        let cmap = cmap_format_4(&p.glyphes);

        // ── head
        let mut head = vec![0u8; 54];
        head[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes()); // version
        head[12..16].copy_from_slice(&0x5F0F_3CF5u32.to_be_bytes()); // magic
        head[18..20].copy_from_slice(&p.upem.to_be_bytes());
        // xMin, yMin, xMax, yMax
        head[36..38].copy_from_slice(&0i16.to_be_bytes());
        head[38..40].copy_from_slice(&(-200i16).to_be_bytes());
        head[40..42].copy_from_slice(&1000i16.to_be_bytes());
        head[42..44].copy_from_slice(&800i16.to_be_bytes());
        head[50..52].copy_from_slice(&0i16.to_be_bytes()); // indexToLocFormat court

        // ── hhea
        let mut hhea = vec![0u8; 36];
        hhea[4..6].copy_from_slice(&800i16.to_be_bytes()); // ascender
        hhea[6..8].copy_from_slice(&(-200i16).to_be_bytes()); // descender
        let nb_metrics = nb_glyphes;
        hhea[34..36].copy_from_slice(&nb_metrics.to_be_bytes());

        // ── maxp (version 1.0 : 32 octets)
        let mut maxp = vec![0u8; 32];
        maxp[0..4].copy_from_slice(&0x0001_0000u32.to_be_bytes());
        maxp[4..6].copy_from_slice(&nb_glyphes.to_be_bytes());

        // ── post (version 3.0 : sans noms de glyphes)
        let mut post = vec![0u8; 32];
        post[0..4].copy_from_slice(&0x0003_0000u32.to_be_bytes());
        let angle = (p.italic_angle * 65536.0) as i32;
        post[4..8].copy_from_slice(&angle.to_be_bytes());
        post[12..16].copy_from_slice(&0u32.to_be_bytes()); // isFixedPitch

        // ── OS/2 (version 4)
        let mut os2 = vec![0u8; 96];
        os2[0..2].copy_from_slice(&4u16.to_be_bytes()); // version
        os2[4..6].copy_from_slice(&400u16.to_be_bytes()); // usWeightClass
        os2[62..64].copy_from_slice(&0x40u16.to_be_bytes()); // fsSelection : regular
        os2[68..70].copy_from_slice(&800i16.to_be_bytes()); // sTypoAscender
        os2[70..72].copy_from_slice(&(-200i16).to_be_bytes()); // sTypoDescender
        os2[88..90].copy_from_slice(&700i16.to_be_bytes()); // sCapHeight

        let name = name_table(&p.famille, &p.style, &p.nom_postscript);

        let tables: Vec<(&[u8; 4], Vec<u8>)> = vec![
            (b"cmap", cmap),
            (b"glyf", glyf),
            (b"head", head),
            (b"hhea", hhea),
            (b"hmtx", hmtx),
            (b"loca", loca),
            (b"maxp", maxp),
            (b"name", name),
            (b"OS/2", os2),
            (b"post", post),
        ];

        assembler_sfnt(&tables)
    }

    /// Table `cmap` avec une sous-table format 4 dont les identifiants suivent
    /// la progression : glyphe `i + 1` pour le `i`-ᵉ caractère déclaré.
    fn cmap_format_4(glyphes: &[(char, u16)]) -> Vec<u8> {
        // Les caractères sont groupés en segments contigus.
        let mut tries: Vec<char> = glyphes.iter().map(|(c, _)| *c).collect();
        tries.sort_unstable();
        tries.dedup();

        // Un segment par plage contiguë de points de code.
        let mut segments: Vec<(u16, u16)> = Vec::new();
        for c in &tries {
            let code = *c as u32;
            if code > 0xFFFF {
                continue;
            }
            let code = code as u16;
            match segments.last_mut() {
                Some((_, fin)) if *fin + 1 == code => *fin = code,
                _ => segments.push((code, code)),
            }
        }
        segments.push((0xFFFF, 0xFFFF));

        let seg_count = segments.len();
        let mut sous = Vec::new();
        sous.extend_from_slice(&4u16.to_be_bytes());
        sous.extend_from_slice(&0u16.to_be_bytes()); // longueur, remplie ensuite
        sous.extend_from_slice(&0u16.to_be_bytes()); // language
        sous.extend_from_slice(&((seg_count * 2) as u16).to_be_bytes());
        sous.extend_from_slice(&[0, 0, 0, 0, 0, 0]);

        for (_, fin) in &segments {
            sous.extend_from_slice(&fin.to_be_bytes());
        }
        sous.extend_from_slice(&0u16.to_be_bytes()); // reservedPad
        for (debut, _) in &segments {
            sous.extend_from_slice(&debut.to_be_bytes());
        }

        // `idDelta` : delta tel que `code + delta = glyphe`. Un seul delta par
        // segment ne marche que si les glyphes progressent — c'est justement le
        // cas ici, par construction.
        let rang = |c: u16| -> i32 {
            let caractere = char::from_u32(u32::from(c)).unwrap_or(' ');
            glyphes
                .iter()
                .position(|(ch, _)| *ch == caractere)
                .map(|i| i as i32 + 1)
                .unwrap_or(0)
        };
        for (debut, _) in &segments {
            if *debut == 0xFFFF {
                sous.extend_from_slice(&1i16.to_be_bytes());
            } else {
                let delta = rang(*debut) - i32::from(*debut);
                sous.extend_from_slice(&(delta as i16).to_be_bytes());
            }
        }
        for _ in &segments {
            sous.extend_from_slice(&0u16.to_be_bytes()); // idRangeOffset = 0
        }

        let longueur = sous.len() as u16;
        sous[2..4].copy_from_slice(&longueur.to_be_bytes());

        let mut cmap = Vec::new();
        cmap.extend_from_slice(&0u16.to_be_bytes()); // version
        cmap.extend_from_slice(&1u16.to_be_bytes()); // nbTables
        cmap.extend_from_slice(&3u16.to_be_bytes()); // platformID
        cmap.extend_from_slice(&1u16.to_be_bytes()); // encodingID
        cmap.extend_from_slice(&12u32.to_be_bytes()); // décalage
        assert_eq!(cmap.len(), 12);
        cmap.extend_from_slice(&sous);
        cmap
    }

    /// Table `name` : famille (1), style (2) et nom PostScript (6), en UTF-16BE.
    fn name_table(famille: &str, style: &str, postscript: &str) -> Vec<u8> {
        let entrees: [(u16, Vec<u8>); 3] = [
            (1, utf16be(famille)),
            (2, utf16be(style)),
            (6, utf16be(postscript)),
        ];

        let mut chaines: Vec<u8> = Vec::new();
        let mut records: Vec<u8> = Vec::new();
        for (id, octets) in &entrees {
            let offset = chaines.len();
            chaines.extend_from_slice(octets);
            records.extend_from_slice(&3u16.to_be_bytes()); // platformID Windows
            records.extend_from_slice(&1u16.to_be_bytes()); // encodingID
            records.extend_from_slice(&0x0409u16.to_be_bytes()); // anglais (États-Unis)
            records.extend_from_slice(&id.to_be_bytes());
            records.extend_from_slice(&(octets.len() as u16).to_be_bytes());
            records.extend_from_slice(&(offset as u16).to_be_bytes());
        }

        let string_offset = 6 + records.len();
        let mut table = Vec::new();
        table.extend_from_slice(&0u16.to_be_bytes()); // format
        table.extend_from_slice(&3u16.to_be_bytes()); // count
        table.extend_from_slice(&(string_offset as u16).to_be_bytes());
        table.extend_from_slice(&records);
        table.extend_from_slice(&chaines);
        table
    }

    fn utf16be(texte: &str) -> Vec<u8> {
        texte.encode_utf16().flat_map(|u| u.to_be_bytes()).collect()
    }

    /// Assemble un fichier sfnt : en-tête, table des tables, tables alignées.
    fn assembler_sfnt(tables: &[(&[u8; 4], Vec<u8>)]) -> Vec<u8> {
        let count = tables.len() as u16;
        let decoration = 12 + 16 * usize::from(count);

        // Les tables sont posées les unes après les autres, chacune alignée sur
        // quatre octets — le format l'exige.
        let mut offsets = Vec::new();
        let mut position = decoration;
        for (_, corps) in tables {
            position = position.div_ceil(4) * 4;
            offsets.push(position);
            position += corps.len();
        }

        let mut fichier = vec![0x00, 0x01, 0x00, 0x00];
        fichier.extend_from_slice(&count.to_be_bytes());
        fichier.extend_from_slice(&[0, 0, 0, 0, 0, 0]);

        for (index, (tag, corps)) in tables.iter().enumerate() {
            fichier.extend_from_slice(*tag);
            fichier.extend_from_slice(&0u32.to_be_bytes()); // checksum, non vérifié
            fichier.extend_from_slice(&(offsets[index] as u32).to_be_bytes());
            fichier.extend_from_slice(&(corps.len() as u32).to_be_bytes());
        }

        for (index, (_, corps)) in tables.iter().enumerate() {
            while fichier.len() < offsets[index] {
                fichier.push(0);
            }
            fichier.extend_from_slice(corps);
        }
        fichier
    }
}

#[cfg(test)]
mod tests {
    use super::synth::{construire, PoliceSynth};
    use super::*;

    #[test]
    fn police_synthetique_se_charge() {
        let octets = construire(&PoliceSynth::default());
        let face = FontFace::parse(octets).expect("la police synthétique doit être lisible");

        assert_eq!(face.units_per_em, 1000);
        assert_eq!(face.num_glyphs, 7, ".notdef + six caractères");
        assert_eq!(face.family, "Synthétique");
        assert_eq!(face.subfamily, "Regular");
        assert_eq!(face.postscript_name, "Synthetique-Regular");
        assert_eq!(face.ascent, 800);
        assert_eq!(face.descent, -200);
        assert_eq!(face.cap_height, 700);
        assert_eq!(face.bbox, [0, -200, 1000, 800]);
        assert_eq!(face.cmap_format(), 4);
        assert_eq!(face.nom_pdf(), "Synthetique-Regular");
    }

    #[test]
    fn correspondance_caractere_glyphe() {
        let octets = construire(&PoliceSynth::default());
        let face = FontFace::parse(octets).unwrap();

        // Les glyphes suivent l'ordre de déclaration : .notdef = 0, puis 1, 2…
        assert_eq!(face.glyph_id(' '), Some(1));
        assert_eq!(face.glyph_id('A'), Some(2));
        assert_eq!(face.glyph_id('B'), Some(3));
        assert_eq!(face.glyph_id('a'), Some(4));
        assert_eq!(face.glyph_id('b'), Some(5));
        assert_eq!(
            face.glyph_id('é'),
            Some(6),
            "un caractère accentué doit se trouver : c'est le cas qui compte pour du français"
        );
    }

    #[test]
    fn caractere_absent_rend_none_puis_notdef() {
        let octets = construire(&PoliceSynth::default());
        let face = FontFace::parse(octets).unwrap();

        assert_eq!(
            face.glyph_id('中'),
            None,
            "pas de dessin pour un idéogramme"
        );
        let (gid, substitue) = face.glyph_id_ou_notdef('中');
        assert_eq!(gid, 0, ".notdef");
        assert!(substitue, "la substitution est signalée, pas silencieuse");
    }

    #[test]
    fn avances_lues_dans_hmtx() {
        let octets = construire(&PoliceSynth::default());
        let face = FontFace::parse(octets).unwrap();

        assert_eq!(face.advance(0), 0, ".notdef");
        assert_eq!(face.advance(1), 250, "espace");
        assert_eq!(face.advance(2), 600, "A");
        assert_eq!(face.advance(4), 500, "a");
        assert_eq!(face.advance1000(2), 600, "déjà en unités de 1000");
    }

    #[test]
    fn largeur_d_un_texte_reel() {
        let octets = construire(&PoliceSynth::default());
        let face = FontFace::parse(octets).unwrap();
        // « Ab » = 600 + 520
        assert_eq!(face.largeur1000("Ab"), 1120);
        // « A b » = 600 + 250 + 520
        assert_eq!(face.largeur1000("A b"), 1370);
    }

    #[test]
    fn upem_2048_convertit_juste() {
        let description = PoliceSynth {
            upem: 2048,
            glyphes: vec![('A', 2048), ('B', 1024)],
            ..PoliceSynth::default()
        };
        let face = FontFace::parse(construire(&description)).unwrap();

        assert_eq!(face.advance1000(1), 1000, "un cadratin entier");
        assert_eq!(face.advance1000(2), 500, "un demi-cadratin");
    }

    #[test]
    fn italic_angle_lu_et_pose_en_drapeau() {
        let description = PoliceSynth {
            italic_angle: -12.0,
            ..PoliceSynth::default()
        };
        let face = FontFace::parse(construire(&description)).unwrap();

        assert!((face.italic_angle + 12.0).abs() < 1e-6);
        assert!(face.italic, "un angle non nul suffit à dire « penché »");
        assert_eq!(face.drapeaux_pdf() & 0x40, 0x40, "drapeau Italic");
    }

    #[test]
    fn fichier_tronque_refuse_sans_paniquer() {
        let complet = construire(&PoliceSynth::default());
        let n = complet.len();
        assert!(
            n > 200,
            "la police de test doit être substantielle : {n} octets"
        );

        // Quelques coupes franches, puis TOUTES les coupes des 48 derniers
        // octets : la dernière table est ainsi amputation après amputation.
        let mut tailles: Vec<usize> = vec![0, 1, 2, 3, 4, 8, 11, 12, 13, 16, 32, 64, 128];
        tailles.extend(n.saturating_sub(48)..n);

        for coupe in tailles {
            if coupe >= n {
                continue;
            }
            let resultat = FontFace::parse(complet[..coupe].to_vec());
            assert!(
                resultat.is_err(),
                "une police tronquée à {coupe} sur {n} octets ne doit pas être acceptée"
            );
        }

        // Et le fichier entier, lui, doit passer.
        assert!(FontFace::parse(complet).is_ok());
    }

    #[test]
    fn octets_aleatoires_refuses_sans_paniquer() {
        // Un générateur congruentiel simple : reproductible, et suffisant pour
        // éprouver les bornes avec des données hostiles.
        let mut etat = 20261011u32;
        for _ in 0..40 {
            let taille = (etat % 600) as usize + 1;
            let octets: Vec<u8> = (0..taille)
                .map(|_| {
                    etat = etat.wrapping_mul(1664525).wrapping_add(1013904223);
                    (etat >> 24) as u8
                })
                .collect();
            // L'important n'est pas le résultat, c'est qu'il n'y ait pas de
            // panique ni de lecture hors bornes.
            let _ = FontFace::parse(octets);
        }
    }
}
