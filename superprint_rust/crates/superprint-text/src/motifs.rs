//! Césure par **dictionnaire de motifs** — l'algorithme de Liang.
//!
//! ## D'où vient ce code
//!
//! C'est le portage fidèle de `superprint/app/JS/hypher.js` (Hypher, lui-même
//! issu de `Hyphenator.js`), qui applique les motifs de césure de **Franklin
//! Liang** — ceux de TeX. Chaque langue fournit un jeu de motifs
//! (`hydrogène` → `hy-dro-gène`) et deux bornes : le nombre minimal de lettres
//! avant et après une coupe.
//!
//! ## Le principe, en trois phrases
//!
//! Un motif est un mot avec des **chiffres entre les lettres**. Le motif
//! `hy3ph` dit : « si tu vois `hyph`, note 3 entre `y` et `p` ». On fait
//! glisser tous les motifs sur le mot, on garde la **note la plus forte** à
//! chaque position, et **une coupe est permise là où la note est impaire**.
//! C'est tout — et ça marche parce que les motifs sont triés par fréquence dans
//! la langue.
//!
//! ## Deux formats de données acceptés
//!
//! - [`Motifs::depuis_pat`] lit le format **texte** habituel : une ligne par
//!   motif (`hy3ph`, `2ssi3t`), celle de `hyph-fr.pat.txt` ;
//! - [`Motifs::depuis_compacte`] lit le format **compact** de `Hyphenator.js`,
//!   celui du dépôt : des chaînes concaténées (`"1ç1j1q"`) groupées par longueur
//!   (`2 : …`, `3 : …`). L'appelant peut donc donner **directement** les données
//!   qu'il possède déjà, sans passer par un fichier intermédiaire.
//!
//! ## Ce que le crate n'embarque pas
//!
//! **Aucun dictionnaire.** Les motifs sont des données de langue : les inclure
//! ferait grossir le `.wasm` de dizaines de kilo-octets par langue, et
//! imposerait une mise à jour du noyau pour corriger une césure. Ils arrivent
//! donc par la frontière, depuis les fichiers que l'application possède déjà.

use std::collections::BTreeMap;

/// Un nœud de l'arbre des motifs.
///
/// Les motifs sont un **arbre préfixe** : `hy` mène à `hyp`, qui mène à `hyph`.
/// Chercher un motif revient donc à descendre d'un cran par lettre, au lieu de
/// comparer le mot à chacun des motifs — c'est ce qui rend la césure assez
/// rapide pour tourner à chaque mot d'un paragraphe.
#[derive(Clone, Debug, Default)]
struct Noeud {
    /// Notes du motif qui **se termine** ici, une par frontière (`len + 1`).
    notes: Vec<u8>,
    /// Enfants : lettre → rang du nœud, **triés par lettre**.
    ///
    /// L'ordre n'est pas cosmétique : il permet la dichotomie ci-dessous. Un
    /// nœud français porte jusqu'à une quarantaine d'enfants, et la césure fait
    /// cette recherche pour **chaque lettre de chaque mot** — un balayage
    /// linéaire y coûtait quatre fois le prix du moteur JavaScript qu'on
    /// remplace (mesuré : 6 300 ns par mot contre 2 300).
    enfants: Vec<(char, usize)>,
}

impl Noeud {
    /// Le nœud enfant d'une lettre, ou `None`.
    fn enfant(&self, lettre: char) -> Option<usize> {
        self.enfants
            .binary_search_by_key(&lettre, |(c, _)| *c)
            .ok()
            .map(|index| self.enfants[index].1)
    }

    /// Où se trouve une lettre par rapport aux enfants — le rang si elle y est,
    /// la position d'insertion sinon. C'est ce qui garde la liste triée.
    fn position_enfant(&self, lettre: char) -> Result<usize, usize> {
        self.enfants.binary_search_by_key(&lettre, |(c, _)| *c)
    }
}

/// Un dictionnaire de césure : un arbre de motifs, deux bornes, des exceptions.
#[derive(Clone, Debug)]
pub struct Motifs {
    noeuds: Vec<Noeud>,
    left_min: usize,
    right_min: usize,
    exceptions: BTreeMap<String, Vec<String>>,
}

impl Default for Motifs {
    fn default() -> Self {
        Self::nouveau(2, 3)
    }
}

impl Motifs {
    /// Un dictionnaire vide, avec ses bornes.
    ///
    /// Valeurs d'usage du français : `leftmin = 2`, `rightmin = 3`. Le
    /// `rightmin = 3` français est une spécificité connue (« grand-mè-re » se
    /// coupe, mais jamais en laissant moins de trois lettres) ; il est dans les
    /// données, pas dans le code.
    #[must_use]
    pub fn nouveau(left_min: usize, right_min: usize) -> Self {
        Self {
            noeuds: vec![Noeud::default()],
            left_min,
            right_min,
            exceptions: BTreeMap::new(),
        }
    }

    /// Le format **texte** : un motif par ligne, `#` pour un commentaire.
    ///
    /// Un motif est une suite de lettres et de chiffres (`hy3ph`). Un `.` y
    /// marque le bord du mot ; il est traduit en `_`, comme dans Hypher.
    #[must_use]
    pub fn depuis_pat(texte: &str, left_min: usize, right_min: usize) -> Self {
        let mut motifs = Self::nouveau(left_min, right_min);
        for ligne in texte.lines() {
            let motif = ligne.trim();
            // Un motif peut se terminer par un commentaire en fin de ligne.
            let motif = motif.split('#').next().unwrap_or("").trim();
            if motif.is_empty() {
                continue;
            }
            let propre: String = motif
                .chars()
                .map(|c| if c == '.' { '_' } else { c })
                .collect();
            motifs.inscrire(&propre);
        }
        motifs
    }

    /// Le format **compact** de `Hyphenator.js`, celui des fichiers du dépôt.
    ///
    /// Chaque entrée donne une longueur et une chaîne où les motifs se
    /// **suivent** : `(3, "1ç1j1q")` contient les deux motifs `1ç1` et `j1q`.
    /// Le découpage se fait donc tous les `longueur` caractères — le dernier
    /// morceau peut être plus court, c'est prévu par le format.
    #[must_use]
    pub fn depuis_compacte(left_min: usize, right_min: usize, groupes: &[(usize, &str)]) -> Self {
        let mut motifs = Self::nouveau(left_min, right_min);
        for (taille, texte) in groupes {
            if *taille == 0 {
                continue;
            }
            let caracteres: Vec<char> = texte.chars().collect();
            for morceau in caracteres.chunks(*taille) {
                motifs.inscrire(&morceau.iter().collect::<String>());
            }
        }
        motifs
    }

    /// Une **spécification** complète, sous forme de texte.
    ///
    /// C'est le format que la frontière C reçoit et que l'exemple de contrôle
    /// écrit : un seul lecteur, donc un seul jeu de règles, donc pas de dérive
    /// possible entre ce qui est mesuré et ce qui est livré.
    ///
    /// ```text
    /// !bornes<TAB>2<TAB>3
    /// 3<TAB>1ç1j1q
    /// 4<TAB>1f2lab2h2c
    /// !exceptions<TAB>as·so·ci·a·tion, ta·ble
    /// ```
    ///
    /// Renvoie `None` si la ligne `!bornes` est absente : sans elle, le
    /// dictionnaire n'aurait pas de bornes — et des bornes devinées seraient
    /// pires qu'un refus.
    #[must_use]
    pub fn depuis_spec(specification: &str) -> Option<Self> {
        let mut bornes: Option<(usize, usize)> = None;
        let mut groupes: Vec<(usize, String)> = Vec::new();
        let mut exceptions: Option<String> = None;

        for ligne in specification.lines() {
            let ligne = ligne.trim_end();
            if ligne.is_empty() {
                continue;
            }
            if let Some(reste) = ligne.strip_prefix("!bornes") {
                let champs: Vec<&str> = reste.trim().split('\t').collect();
                let gauche = champs.first()?.trim().parse().ok()?;
                let droite = champs.get(1)?.trim().parse().ok()?;
                bornes = Some((gauche, droite));
                continue;
            }
            if let Some(reste) = ligne.strip_prefix("!exceptions") {
                exceptions = Some(reste.trim_start_matches('\t').to_string());
                continue;
            }
            let mut champs = ligne.splitn(2, '\t');
            let (Some(premier), Some(second)) = (champs.next(), champs.next()) else {
                continue;
            };
            let Ok(taille) = premier.trim().parse::<usize>() else {
                continue;
            };
            groupes.push((taille, second.to_string()));
        }

        let (gauche, droite) = bornes?;
        let references: Vec<(usize, &str)> = groupes
            .iter()
            .map(|(taille, texte)| (*taille, texte.as_str()))
            .collect();
        let mut motifs = Self::depuis_compacte(gauche, droite, &references);
        if let Some(liste) = &exceptions {
            motifs = motifs.avec_exceptions(liste);
        }
        Some(motifs)
    }

    /// Ajoute les exceptions, au format de `Hyphenator.js` :
    /// `"as·so·ci·a·tion, ta·ble"`. Le séparateur de syllabes est `·`
    /// (U+00B7).
    #[must_use]
    pub fn avec_exceptions(mut self, liste: &str) -> Self {
        for brute in liste.split(',') {
            let brute = brute.trim();
            if brute.is_empty() {
                continue;
            }
            let cle = brute.replace('\u{00B7}', "").to_lowercase();
            let morceaux: Vec<String> = brute.split('\u{00B7}').map(str::to_string).collect();
            if morceaux.len() > 1 {
                self.exceptions.insert(cle, morceaux);
            }
        }
        self
    }

    /// Le nombre minimal de lettres avant une coupe.
    #[must_use]
    pub fn left_min(&self) -> usize {
        self.left_min
    }

    /// Le nombre minimal de lettres après une coupe.
    #[must_use]
    pub fn right_min(&self) -> usize {
        self.right_min
    }

    /// Nombre de motifs chargés (utile aux diagnostics et aux tests).
    #[must_use]
    pub fn nombre_de_motifs(&self) -> usize {
        self.noeuds.iter().filter(|n| !n.notes.is_empty()).count()
    }

    /// Inscrit un motif dans l'arbre.
    fn inscrire(&mut self, motif: &str) {
        // Décomposition : les lettres d'un côté, les notes de l'autre. La
        // première note porte sur la frontière **avant** la première lettre,
        // la dernière sur la frontière **après** la dernière : il y a donc
        // toujours une note de plus que de lettres.
        let mut lettres: Vec<char> = Vec::with_capacity(motif.chars().count());
        let mut notes: Vec<u8> = Vec::with_capacity(lettres.len() + 1);
        notes.push(0);
        let mut chiffres = String::new();
        for c in motif.chars() {
            if c.is_ascii_digit() {
                chiffres.push(c);
                continue;
            }
            if !chiffres.is_empty() {
                // Un motif peut porter un nombre à deux chiffres (`12`), ce que
                // le format autorise : on garde la valeur, pas les caractères.
                if let Ok(valeur) = chiffres.parse::<u8>() {
                    if let Some(derniere) = notes.last_mut() {
                        *derniere = valeur;
                    }
                }
                chiffres.clear();
            }
            lettres.push(c);
            notes.push(0);
        }
        if !chiffres.is_empty() {
            if let Ok(valeur) = chiffres.parse::<u8>() {
                if let Some(derniere) = notes.last_mut() {
                    *derniere = valeur;
                }
            }
        }
        if lettres.is_empty() {
            return;
        }

        let mut rang = 0usize;
        for lettre in &lettres {
            rang = match self.noeuds[rang].position_enfant(*lettre) {
                Ok(index) => self.noeuds[rang].enfants[index].1,
                Err(position) => {
                    self.noeuds.push(Noeud::default());
                    let nouveau = self.noeuds.len() - 1;
                    self.noeuds[rang]
                        .enfants
                        .insert(position, (*lettre, nouveau));
                    nouveau
                }
            };
        }
        // Un motif déjà présent est **remplacé**, comme dans Hypher : les motifs
        // d'un même jeu ne se contredisent pas, et le dernier mot dit.
        self.noeuds[rang].notes = notes;
    }

    /// Les positions de coupe d'un mot, en **indices de caractères**.
    ///
    /// Une position `i` signifie : couper **après** le `i`-ᵉ caractère. Les
    /// bornes `left`/`right` du dictionnaire sont déjà appliquées — inutile de
    /// les revérifier.
    #[must_use]
    pub fn coupes(&self, mot: &str) -> Vec<usize> {
        // Une exception est un mot **écrit** avec ses coupes : on les lit
        // directement, sans faire tourner l'algorithme.
        if let Some(morceaux) = self.exceptions.get(&mot.to_lowercase()) {
            let mut positions = Vec::with_capacity(morceaux.len().saturating_sub(1));
            let mut cumul = 0usize;
            for morceau in morceaux.iter().take(morceaux.len().saturating_sub(1)) {
                cumul += morceau.chars().count();
                positions.push(cumul);
            }
            return positions;
        }

        // Un mot déjà coupé à la main (trait conditionnel U+00AD) est laissé
        // tel quel : l'utilisateur a déjà dit où il voulait couper.
        if mot.contains('\u{00AD}') {
            return Vec::new();
        }

        let minuscules: Vec<char> = mot
            .to_lowercase()
            .chars()
            .chain(std::iter::once('_'))
            .collect::<Vec<char>>();
        // Le mot de travail est bordé de `_`, qui représente le bord du mot
        // dans les motifs (« `_ta` » = « commence par `ta` »).
        let mut enveloppe: Vec<char> = Vec::with_capacity(minuscules.len() + 1);
        enveloppe.push('_');
        enveloppe.extend(minuscules);
        let n = enveloppe.len();

        // Une note par frontière ; `n + 1` est plus grand que nécessaire, et
        // c'est volontaire : un motif peut déborder d'une position à droite, et
        // cette position n'est jamais lue.
        let mut notes = vec![0u8; n + 2];
        for (depart, _) in enveloppe.iter().enumerate() {
            let mut rang = 0usize;
            for lettre_fin in enveloppe.iter().skip(depart).take(n - depart) {
                let Some(suivant) = self.noeuds[rang].enfant(*lettre_fin) else {
                    break;
                };
                rang = suivant;
                let du_noeud = &self.noeuds[rang].notes;
                if !du_noeud.is_empty() {
                    for (k, note) in du_noeud.iter().enumerate() {
                        let cible = depart + k;
                        if cible < notes.len() && *note > notes[cible] {
                            notes[cible] = *note;
                        }
                    }
                }
            }
        }

        // Coupe là où la note est **impaire**, jamais trop près des bords.
        // `depart > left_min` et `depart < n - right_min` : les bornes strictes
        // sont celles du format, on n'y touche pas.
        let mut positions = Vec::new();
        for (depart, note) in notes.iter().enumerate().take(n.saturating_sub(1)).skip(1) {
            if depart > self.left_min && depart < n.saturating_sub(self.right_min) && note % 2 == 1
            {
                // L'enveloppe a une lettre de plus au début : on redescend à
                // l'indice du mot d'origine.
                positions.push(depart - 1);
            }
        }
        positions
    }

    /// Le mot découpé aux positions de coupe.
    ///
    /// Renvoie **le mot entier en un seul morceau** quand aucune coupe ne
    /// s'applique — jamais un vecteur vide, ce qui évite un cas particulier à
    /// chaque appelant.
    #[must_use]
    pub fn fragments(&self, mot: &str) -> Vec<String> {
        decouper(mot, &self.coupes(mot))
    }

    /// Le mot, avec des **traits conditionnels** (U+00AD) aux positions de
    /// coupe — la forme attendue par un moteur de composition.
    #[must_use]
    pub fn avec_traits_conditionnels(&self, mot: &str) -> String {
        let coupes = self.coupes(mot);
        if coupes.is_empty() {
            return mot.to_string();
        }
        let caracteres: Vec<char> = mot.chars().collect();
        let mut sortie = String::with_capacity(mot.len() + coupes.len());
        for (index, c) in caracteres.iter().enumerate() {
            if coupes.contains(&index) {
                sortie.push('\u{00AD}');
            }
            sortie.push(*c);
        }
        sortie
    }
}

/// Découpe `mot` aux positions données (indices de caractères).
///
/// Une position hors du mot est **ignorée** plutôt que de faire paniquer :
/// l'appelant peut venir d'une autre source que ce module.
#[must_use]
pub fn decouper(mot: &str, coupes: &[usize]) -> Vec<String> {
    let caracteres: Vec<char> = mot.chars().collect();
    if coupes.is_empty() || caracteres.is_empty() {
        return vec![mot.to_string()];
    }
    let mut valides: Vec<usize> = coupes
        .iter()
        .copied()
        .filter(|i| *i > 0 && *i < caracteres.len())
        .collect();
    valides.sort_unstable();
    valides.dedup();
    if valides.is_empty() {
        return vec![mot.to_string()];
    }
    let mut morceaux = Vec::with_capacity(valides.len() + 1);
    let mut debut = 0usize;
    for fin in valides {
        morceaux.push(caracteres[debut..fin].iter().collect());
        debut = fin;
    }
    morceaux.push(caracteres[debut..].iter().collect());
    morceaux
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Un petit jeu de motifs français, écrit à la main, dont les coupes sont
    /// connues d'avance : c'est ce qui permet de vérifier l'algorithme sans
    /// embarquer tout un dictionnaire.
    fn motifs_de_test() -> Motifs {
        // « hy3ph » : note 3 entre y et p. « 2ssi3t » : note 2 avant ss, 3
        // après i. Ces motifs viennent des vrais jeux de motifs français.
        Motifs::depuis_pat(
            "# motifs de test\n\
             hy3ph\n\
             2ssi3t\n\
             3ci2\n\
             1ç1\n\
             ",
            2,
            3,
        )
    }

    #[test]
    fn les_enfants_de_l_arbre_restent_tries() {
        // L'ordre des enfants n'est pas cosmétique : la recherche est une
        // **dichotomie**. Si l'ordre se perdait, `binary_search_by_key` ne
        // trouverait plus rien — et la césure cesserait silencieusement de
        // couper, sans erreur ni panique. C'est exactement le genre de défaut
        // qu'un test doit verrouiller.
        let motifs = Motifs::depuis_pat(
            "# insertion dans le desordre\n\
             z1\n\
             a1\n\
             m1\n\
             b1\n\
             é1\n\
             œ1\n\
             ",
            2,
            3,
        );
        for (index, noeud) in motifs.noeuds.iter().enumerate() {
            let lettres: Vec<char> = noeud.enfants.iter().map(|(c, _)| *c).collect();
            let mut triees = lettres.clone();
            triees.sort_unstable();
            assert_eq!(
                lettres, triees,
                "les enfants du nœud {index} ne sont pas tries"
            );
        }

        // Et la recherche retrouve bien ce qu'on a mis.
        let racine = &motifs.noeuds[0];
        for lettre in ['a', 'b', 'm', 'z', 'é', 'œ'] {
            assert!(
                racine.enfant(lettre).is_some(),
                "« {lettre} » doit etre trouvee"
            );
        }
        assert!(racine.enfant('q').is_none(), "« q » n'a pas ete inscrite");
    }

    #[test]
    fn un_motif_du_texte_se_charge() {
        let motifs = motifs_de_test();
        assert_eq!(motifs.nombre_de_motifs(), 4);
        assert_eq!(motifs.left_min(), 2);
        assert_eq!(motifs.right_min(), 3);
    }

    #[test]
    fn le_motif_impose_sa_coupe() {
        let motifs = motifs_de_test();
        // `hy3ph` place une note impaire entre « y » et « ph » : la coupe tombe
        // après le y. Bornes : 2 avant, 3 après.
        assert_eq!(motifs.coupes("hyphone"), vec![2]);
        assert_eq!(motifs.fragments("hyphone"), vec!["hy", "phone"]);
    }

    #[test]
    fn la_note_la_plus_forte_gagne() {
        // « 2ti3 » donne 2 avant « ti » et 3 après le « i ». Sur « petitien »,
        // les deux occurrences de « ti » placent une note impaire après le i.
        let motifs = Motifs::depuis_pat("2ti3\n", 2, 2);
        // « peti|tien », « petiti|en » : les deux coupes autorisées.
        assert_eq!(motifs.coupes("petitien"), vec![4, 6]);
    }

    #[test]
    fn le_dernier_motif_inscrit_remplace_le_precedent() {
        // Un motif est identifié par ses lettres : réinscrire les mêmes lettres
        // REMPLACE les notes, comme dans Hypher. C'est pour cela qu'un jeu de
        // motifs ne doit pas contenir deux fois le même motif.
        let une = Motifs::depuis_pat("1ti1\n", 2, 2);
        let deux = Motifs::depuis_pat("2ti3\n", 2, 2);
        assert_eq!(une.nombre_de_motifs(), 1);
        assert_eq!(deux.nombre_de_motifs(), 1);
        assert_eq!(une.coupes("petitien"), vec![2, 4, 6], "notes 1,0,1");
        assert_eq!(deux.coupes("petitien"), vec![4, 6], "notes 2,0,3");
    }

    #[test]
    fn les_bornes_refusent_les_coupes_trop_precoces() {
        // Le motif dit de couper tout de suite, les bornes refusent : les
        // bornes sont là exactement pour cela.
        let motifs = Motifs::depuis_pat("1ab1\n", 3, 1);
        assert!(
            motifs.coupes("abcde").is_empty(),
            "moins de 3 lettres avant"
        );
        let motifs = Motifs::depuis_pat("1ab1\n", 1, 4);
        assert!(
            motifs.coupes("abcde").is_empty(),
            "moins de 4 lettres après"
        );
    }

    #[test]
    fn une_coupe_en_dehors_du_mot_est_ignoree() {
        assert_eq!(decouper("mot", &[99]), vec!["mot"]);
        assert_eq!(decouper("mot", &[0]), vec!["mot"]);
        assert_eq!(decouper("mot", &[]), vec!["mot"]);
        assert_eq!(decouper("mot", &[1, 1, 2]), vec!["m", "o", "t"]);
    }

    #[test]
    fn les_exceptions_gagnent_sur_les_motifs() {
        let motifs = Motifs::depuis_pat("hy3ph\n", 2, 3)
            .avec_exceptions("as\u{00B7}so\u{00B7}ci\u{00B7}a\u{00B7}tion");
        assert_eq!(
            motifs.fragments("association"),
            vec!["as", "so", "ci", "a", "tion"]
        );
        // L'exception est cherchée en minuscules : la casse de l'appelant ne
        // change pas la découpe.
        assert_eq!(
            motifs.fragments("Association"),
            vec!["As", "so", "ci", "a", "tion"]
        );
    }

    #[test]
    fn le_format_compact_du_depot_est_lu() {
        // Exactement la forme de `hyphenation-fr.js` : longueur + chaîne
        // concaténée, découpée par la longueur annoncée. Le dernier morceau
        // peut être plus court.
        let motifs = Motifs::depuis_compacte(2, 3, &[(3, "1ç1j1q"), (4, "1f2lab2h2c")]);
        // Trois motifs de longueur 3 (`1ç1`, `j1q`… deux ici) et deux de
        // longueur 4 : cinq au total.
        assert_eq!(motifs.nombre_de_motifs(), 5);
        assert_eq!(motifs.left_min(), 2);
        assert_eq!(motifs.right_min(), 3);
    }

    #[test]
    fn les_deux_formats_donnent_le_meme_motif() {
        let texte = Motifs::depuis_pat("1ç1\n", 2, 3);
        let compact = Motifs::depuis_compacte(2, 3, &[(3, "1ç1")]);
        assert_eq!(texte.nombre_de_motifs(), 1);
        assert_eq!(compact.nombre_de_motifs(), 1);
        // Même résultat sur un mot qui déclenche le motif.
        let mot = "façade";
        assert_eq!(texte.coupes(mot), compact.coupes(mot));
    }

    #[test]
    fn la_specification_complete_est_lue() {
        // Le format exact que la frontière C reçoit et que l'exemple écrit.
        let spec = "!bornes\t2\t3\n\
                    3\t1ç1j1q\n\
                    4\t1f2lab2h2c\n\
                    !exceptions\tas\u{00B7}so\u{00B7}ci\u{00B7}a\u{00B7}tion\n";
        let motifs = Motifs::depuis_spec(spec).expect("spécification lisible");
        assert_eq!(motifs.left_min(), 2);
        assert_eq!(motifs.right_min(), 3);
        assert_eq!(motifs.nombre_de_motifs(), 5);
        assert_eq!(
            motifs.fragments("association"),
            vec!["as", "so", "ci", "a", "tion"],
            "l'exception doit être lue"
        );
    }

    #[test]
    fn une_specification_sans_bornes_est_refusee() {
        // Des bornes devinées seraient pires qu'un refus : elles décideraient
        // de coupes que l'utilisateur n'a jamais demandées.
        assert!(Motifs::depuis_spec("3\t1ç1j1q\n").is_none());
        assert!(Motifs::depuis_spec("").is_none());
        assert!(
            Motifs::depuis_spec("!bornes\t2\n").is_none(),
            "borne droite absente"
        );
    }

    #[test]
    fn la_specification_egale_le_chargement_direct() {
        let spec = "!bornes\t2\t3\n3\t1ç1j1q\n";
        let par_spec = Motifs::depuis_spec(spec).unwrap();
        let direct = Motifs::depuis_compacte(2, 3, &[(3, "1ç1j1q")]);
        assert_eq!(par_spec.nombre_de_motifs(), direct.nombre_de_motifs());
        for mot in ["façade", "leçon", "reçu", "garçon"] {
            assert_eq!(par_spec.fragments(mot), direct.fragments(mot));
        }
    }

    #[test]
    fn un_mot_deja_coupe_est_rendu_tel_quel() {
        let motifs = motifs_de_test();
        // U+00AD : l'utilisateur a déjà placé ses coupes.
        assert!(motifs.coupes("hy\u{00AD}phone").is_empty());
        assert_eq!(motifs.fragments("hy\u{00AD}phone"), vec!["hy\u{00AD}phone"]);
    }

    #[test]
    fn le_trait_conditionnel_est_pose_devant_la_lettre_suivante() {
        let motifs = motifs_de_test();
        assert_eq!(
            motifs.avec_traits_conditionnels("hyphone"),
            "hy\u{00AD}phone",
            "le trait se place après la coupe"
        );
        assert_eq!(motifs.avec_traits_conditionnels("xyz"), "xyz");
    }

    #[test]
    fn un_dictionnaire_vide_ne_coupe_rien() {
        let motifs = Motifs::nouveau(2, 3);
        assert_eq!(motifs.nombre_de_motifs(), 0);
        assert!(motifs.coupes("nimportequoi").is_empty());
        assert_eq!(motifs.fragments("nimportequoi"), vec!["nimportequoi"]);
    }

    #[test]
    fn les_accents_et_le_bord_de_mot_sont_traites() {
        // `_` désigne le début du mot : un motif peut exiger une syllabe
        // initiale, ce que le format lettre par lettre ne saurait pas dire.
        let motifs = Motifs::depuis_pat("_a1b\n", 1, 1);
        assert_eq!(motifs.coupes("abcdef"), vec![1], "coupe après le a initial");
        // Le même motif ne s'applique plus si le mot commence autrement.
        assert!(motifs.coupes("xabcdef").is_empty());
    }
}
