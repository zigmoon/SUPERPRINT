//! Lexeur PostScript : les types d'objets de la langue.
//!
//! ## Ce que PostScript a de particulier
//!
//! Ce n'est pas un format de fichier, c'est un **langage de programmation**. Un
//! `.eps` peut contenir des définitions de procédures, des boucles, des calculs,
//! et en théorie n'importe quel programme. On ne l'analyse donc pas comme un
//! document : on l'**exécute** — dans une machine restreinte et bornée, mais on
//! l'exécute.
//!
//! La distinction qui gouverne tout : un nom **littéral** (`/moveto`) est une
//! donnée, un nom **exécutable** (`moveto`) est un ordre. C'est ce qui permet
//! d'écrire `/m /moveto load def` — « que le nom `m` désigne l'opération
//! `moveto` » — et c'est ce que font tous les prologues d'Illustrator.
//!
//! ## Les délimiteurs
//!
//! PostScript en a huit : les espaces, la tabulation, le retour à la ligne, le
//! saut de page, le retour chariot, le caractère nul, et les caractères
//! `( ) < > [ ] { } / %`. Un fichier réel en contient de tous.

use std::fmt;

/// Un objet PostScript.
#[derive(Clone, Debug, PartialEq)]
pub enum Objet {
    /// Un entier.
    Entier(i64),
    /// Un réel.
    Reel(f64),
    /// Un booléen (`true` / `false`).
    Booleen(bool),
    /// Un nom **exécutable** : `moveto`.
    Nom(String),
    /// Un nom **littéral** : `/moveto`.
    NomLitteral(String),
    /// Une chaîne d'octets, `(…)`.
    Chaine(Vec<u8>),
    /// Un tableau, `[…]`.
    Tableau(Vec<Objet>),
    /// Une procédure, `{…}`.
    Procedure(Vec<Objet>),
    /// Un opérateur du noyau, produit par `/moveto load`.
    ///
    /// Sans cette variante, `def` ne pourrait pas lier un nom à une opération :
    /// le prologue d'un EPS réel n'est fait que de ça.
    Operateur(String),
    /// La marque `mark`.
    Marque,
    /// Le résultat de `save`, à rendre à `restore`.
    Sauvegarde(usize),
}

impl Objet {
    /// Le nom de cet objet, tel qu'un opérateur l'attendrait.
    #[must_use]
    pub fn comme_nom(&self) -> Option<&str> {
        match self {
            Self::Nom(nom) | Self::NomLitteral(nom) | Self::Operateur(nom) => Some(nom),
            _ => None,
        }
    }

    /// La valeur numérique, entière ou réelle.
    #[must_use]
    pub fn comme_nombre(&self) -> Option<f64> {
        match self {
            Self::Entier(v) => Some(*v as f64),
            Self::Reel(v) => Some(*v),
            _ => None,
        }
    }

    /// La valeur entière, réelle arrondie comprise.
    #[must_use]
    pub fn comme_entier(&self) -> Option<i64> {
        match self {
            Self::Entier(v) => Some(*v),
            Self::Reel(v) if v.is_finite() => Some(*v as i64),
            _ => None,
        }
    }

    /// Décrit l'objet pour un message d'erreur.
    #[must_use]
    pub fn type_de() -> &'static str {
        "objet"
    }
}

impl fmt::Display for Objet {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Entier(v) => write!(f, "{v}"),
            Self::Reel(v) => write!(f, "{v}"),
            Self::Booleen(v) => write!(f, "{v}"),
            Self::Nom(nom) => write!(f, "{nom}"),
            Self::NomLitteral(nom) => write!(f, "/{nom}"),
            Self::Chaine(octets) => write!(f, "({})", String::from_utf8_lossy(octets)),
            Self::Tableau(valeurs) => write!(f, "[{} éléments]", valeurs.len()),
            Self::Procedure(valeurs) => write!(f, "{{{} éléments}}", valeurs.len()),
            Self::Operateur(nom) => write!(f, "{nom}"),
            Self::Marque => write!(f, "mark"),
            Self::Sauvegarde(rang) => write!(f, "save#{rang}"),
        }
    }
}

/// Erreur de lexage.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ErreurLexe {
    /// Un délimiteur fermant ne correspond à aucun ouvrant.
    FermetureOrpheline {
        /// Le caractère rencontré.
        caractere: char,
    },
    /// Une chaîne n'est jamais fermée.
    ChaineNonFermee,
    /// Une chaîne hexadécimale n'est jamais fermée.
    ChaineHexNonFermee,
    /// Un nombre mal écrit.
    NombreInvalide {
        /// Le texte en question.
        texte: String,
    },
}

impl fmt::Display for ErreurLexe {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::FermetureOrpheline { caractere } => {
                write!(f, "« {caractere} » fermant sans ouvrant")
            }
            Self::ChaineNonFermee => write!(f, "chaîne (…) jamais fermée"),
            Self::ChaineHexNonFermee => write!(f, "chaîne hexadécimale <…> jamais fermée"),
            Self::NombreInvalide { texte } => write!(f, "nombre illisible : « {texte} »"),
        }
    }
}

impl std::error::Error for ErreurLexe {}

/// Un caractère est-il un délimiteur PostScript ?
#[must_use]
pub fn est_delimiteur(c: char) -> bool {
    c.is_whitespace()
        || matches!(
            c,
            '\0' | '(' | ')' | '<' | '>' | '[' | ']' | '{' | '}' | '/' | '%'
        )
}

/// Découpe un texte PostScript en objets.
///
/// Le commentaire `%` va jusqu'à la fin de la ligne, sauf à l'intérieur d'une
/// chaîne. Les parenthèses d'une chaîne s'imbriquent, et les échappements
/// `\n`, `\t`, `\\`, `\(`, `\)` et `\ddd` sont résolus.
///
/// # Erreurs
///
/// Voir [`ErreurLexe`].
pub fn lexer(source: &str) -> Result<Vec<Objet>, ErreurLexe> {
    let caracteres: Vec<char> = source.chars().collect();
    let mut position = 0usize;
    let mut sortie = Vec::new();
    let mut pile_ouvrants: Vec<char> = Vec::new();
    while position < caracteres.len() {
        let c = caracteres[position];
        if c.is_whitespace() || c == '\0' {
            position += 1;
            continue;
        }
        if c == '%' {
            while position < caracteres.len() && caracteres[position] != '\n' {
                position += 1;
            }
            continue;
        }
        match c {
            '(' => {
                let (chaine, suivante) = lire_chaine(&caracteres, position)?;
                sortie.push(Objet::Chaine(chaine));
                position = suivante;
            }
            '<' => {
                if caracteres.get(position + 1) == Some(&'<') {
                    // `<<` : dictionnaire. Le sous-ensemble ne le gère pas, mais
                    // il faut avancer proprement pour ne pas tout lire de
                    // travers — et le refus sera nommé par la machine.
                    sortie.push(Objet::NomLitteral("<<".to_string()));
                    position += 2;
                } else {
                    let (chaine, suivante) = lire_chaine_hex(&caracteres, position)?;
                    sortie.push(Objet::Chaine(chaine));
                    position = suivante;
                }
            }
            '>' => {
                if caracteres.get(position + 1) == Some(&'>') {
                    sortie.push(Objet::NomLitteral(">>".to_string()));
                    position += 2;
                } else {
                    return Err(ErreurLexe::FermetureOrpheline { caractere: '>' });
                }
            }
            ']' | '}' => {
                // La fermeture est un JETON, pas une erreur : c'est
                // [`assembler`] qui décide si elle correspond à un ouvrant.
                // La refuser ici rendrait toute procédure impossible — et un
                // en-tête d'EPS réel en contient toujours.
                sortie.push(Objet::NomLitteral(c.to_string()));
                position += 1;
            }
            ')' => {
                return Err(ErreurLexe::FermetureOrpheline { caractere: ')' });
            }
            '[' | '{' => {
                pile_ouvrants.push(c);
                sortie.push(Objet::NomLitteral(c.to_string()));
                position += 1;
            }
            '/' => {
                // `/nom` est un nom LITTÉRAL : il n'est pas exécuté, il est
                // empilé. `//nom` (niveau 2) est un nom résolu tout de suite ;
                // dans un sous-ensemble sans `bind` réel, les deux se
                // comportent pareil, et le dire vaut mieux que de refuser.
                let immediat = caracteres.get(position + 1) == Some(&'/');
                position += if immediat { 2 } else { 1 };
                let debut = position;
                while position < caracteres.len() && !est_delimiteur(caracteres[position]) {
                    position += 1;
                }
                let nom: String = caracteres[debut..position].iter().collect();
                sortie.push(Objet::NomLitteral(nom));
            }
            _ => {
                let debut = position;
                while position < caracteres.len() && !est_delimiteur(caracteres[position]) {
                    position += 1;
                }
                if position == debut {
                    // Un délimiteur que la boucle ci-dessus n'a pas su lire. Cela
                    // ne devrait pas arriver — mais si cela arrivait, la boucle
                    // ne progresserait pas et remplirait la mémoire jusqu'à
                    // l'abandon. On refuse, en nommant le caractère : une panne
                    // silencieuse coûte toujours plus cher qu'un refus nommé.
                    return Err(ErreurLexe::NombreInvalide {
                        texte: format!("caractère non analysable « {c} »"),
                    });
                }
                let texte: String = caracteres[debut..position].iter().collect();
                sortie.push(analyser_jeton(&texte)?);
            }
        }
    }
    Ok(sortie)
}

/// Reconnaît un jeton non délimité : nombre, booléen, nom exécutable ou littéral.
fn analyser_jeton(texte: &str) -> Result<Objet, ErreurLexe> {
    if let Some(nom) = texte.strip_prefix('/') {
        return Ok(Objet::NomLitteral(nom.to_string()));
    }
    match texte {
        "true" => return Ok(Objet::Booleen(true)),
        "false" => return Ok(Objet::Booleen(false)),
        _ => {}
    }
    if let Some(entier) = analyser_entier(texte) {
        return Ok(Objet::Entier(entier));
    }
    if let Ok(reel) = texte.parse::<f64>() {
        if reel.is_finite() {
            return Ok(Objet::Reel(reel));
        }
        return Err(ErreurLexe::NombreInvalide {
            texte: texte.to_string(),
        });
    }
    Ok(Objet::Nom(texte.to_string()))
}

/// Analyse un entier, base comprise (`8#17`, `16#FF`).
///
/// PostScript accepte ces notations, et les programmes réels s'en servent pour
/// les codes de caractères.
fn analyser_entier(texte: &str) -> Option<i64> {
    if let Some((base, chiffres)) = texte.split_once('#') {
        let base: u32 = base.parse().ok()?;
        if !(2..=36).contains(&base) {
            return None;
        }
        return i64::from_str_radix(chiffres, base).ok();
    }
    texte.parse::<i64>().ok()
}

/// Lit une chaîne `(…)`, parenthèses imbriquées et échappements compris.
fn lire_chaine(caracteres: &[char], position: usize) -> Result<(Vec<u8>, usize), ErreurLexe> {
    let mut i = position + 1;
    let mut profondeur = 1usize;
    let mut sortie: Vec<u8> = Vec::new();
    while i < caracteres.len() {
        let c = caracteres[i];
        match c {
            '\\' => {
                i += 1;
                let Some(&echappe) = caracteres.get(i) else {
                    return Err(ErreurLexe::ChaineNonFermee);
                };
                match echappe {
                    'n' => sortie.push(b'\n'),
                    'r' => sortie.push(b'\r'),
                    't' => sortie.push(b'\t'),
                    'b' => sortie.push(8),
                    'f' => sortie.push(12),
                    '\\' => sortie.push(b'\\'),
                    '(' => sortie.push(b'('),
                    ')' => sortie.push(b')'),
                    '\n' => {} // continuation de ligne : ne produit rien
                    chiffre if chiffre.is_ascii_digit() => {
                        // Jusqu'à trois chiffres octaux.
                        let mut valeur = 0u32;
                        let mut faits = 0;
                        while faits < 3 {
                            match caracteres.get(i) {
                                Some(d) if d.is_ascii_digit() && *d < '8' => {
                                    valeur = valeur * 8 + (*d as u32 - '0' as u32);
                                    i += 1;
                                    faits += 1;
                                }
                                _ => break,
                            }
                        }
                        i -= 1;
                        sortie.push((valeur & 0xFF) as u8);
                    }
                    autre => sortie.push(autre as u8),
                }
                i += 1;
            }
            '(' => {
                profondeur += 1;
                sortie.push(b'(');
                i += 1;
            }
            ')' => {
                profondeur -= 1;
                if profondeur == 0 {
                    return Ok((sortie, i + 1));
                }
                sortie.push(b')');
                i += 1;
            }
            autre => {
                let mut tampon = [0u8; 4];
                sortie.extend_from_slice(autre.encode_utf8(&mut tampon).as_bytes());
                i += 1;
            }
        }
    }
    Err(ErreurLexe::ChaineNonFermee)
}

/// Lit une chaîne hexadécimale `<…>`.
fn lire_chaine_hex(caracteres: &[char], position: usize) -> Result<(Vec<u8>, usize), ErreurLexe> {
    let mut i = position + 1;
    let mut chiffres: Vec<u8> = Vec::new();
    while i < caracteres.len() {
        let c = caracteres[i];
        if c == '>' {
            // Un nombre impair de chiffres se complète par un zéro final.
            if chiffres.len() % 2 == 1 {
                chiffres.push(0);
            }
            let octets = chiffres
                .chunks(2)
                .map(|paire| (paire[0] << 4) | paire[1])
                .collect();
            return Ok((octets, i + 1));
        }
        if let Some(valeur) = c.to_digit(16) {
            chiffres.push(valeur as u8);
        } else if !c.is_whitespace() {
            return Err(ErreurLexe::ChaineHexNonFermee);
        }
        i += 1;
    }
    Err(ErreurLexe::ChaineHexNonFermee)
}

/// Regroupe les jetons en procédures et tableaux.
///
/// Le lexeur rend une suite plate ; c'est ici que `{ … }` devient
/// [`Objet::Procedure`] et `[ … ]` un [`Objet::Tableau`]. Les procédures
/// s'imbriquent, d'où la pile.
///
/// # Erreurs
///
/// [`ErreurLexe::FermetureOrpheline`] si une fermeture n'a pas d'ouvrante.
pub fn assembler(jetons: Vec<Objet>) -> Result<Vec<Objet>, ErreurLexe> {
    // Pile de construction : chaque niveau accumule dans `courant`, et
    // `ouvrant` dit s'il s'agit d'une procédure ou d'un tableau.
    struct Niveau {
        ouvrant: char,
        objets: Vec<Objet>,
    }
    let mut niveaux: Vec<Niveau> = vec![Niveau {
        ouvrant: ' ',
        objets: Vec::new(),
    }];
    for jeton in jetons {
        match &jeton {
            Objet::NomLitteral(texte) if texte == "{" || texte == "[" => {
                niveaux.push(Niveau {
                    ouvrant: texte.chars().next().unwrap(),
                    objets: Vec::new(),
                });
            }
            Objet::NomLitteral(texte) if texte == "}" || texte == "]" => {
                let attendu = if texte == "}" { '{' } else { '[' };
                let Some(niveau) = niveaux.pop() else {
                    return Err(ErreurLexe::FermetureOrpheline { caractere: attendu });
                };
                if niveau.ouvrant != attendu {
                    return Err(ErreurLexe::FermetureOrpheline { caractere: attendu });
                }
                let objet = if attendu == '{' {
                    Objet::Procedure(niveau.objets)
                } else {
                    Objet::Tableau(niveau.objets)
                };
                niveaux.last_mut().unwrap().objets.push(objet);
            }
            autre => niveaux.last_mut().unwrap().objets.push(autre.clone()),
        }
    }
    if niveaux.len() > 1 {
        // Un ouvrant jamais fermé : on refuse plutôt que de rendre un programme
        // tronqué qui s'exécuterait en partie.
        return Err(ErreurLexe::FermetureOrpheline {
            caractere: niveaux.last().unwrap().ouvrant,
        });
    }
    Ok(niveaux.pop().unwrap().objets)
}

/// Lexe et assemble en un seul appel.
///
/// # Erreurs
///
/// Voir [`ErreurLexe`].
pub fn analyser(source: &str) -> Result<Vec<Objet>, ErreurLexe> {
    assembler(lexer(source)?)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nombres() {
        let objets = analyser("1 -2 3.5 -0.5 .25 8#17 16#FF").unwrap();
        assert_eq!(objets[0], Objet::Entier(1));
        assert_eq!(objets[1], Objet::Entier(-2));
        assert_eq!(objets[2], Objet::Reel(3.5));
        assert_eq!(objets[3], Objet::Reel(-0.5));
        assert_eq!(objets[4], Objet::Reel(0.25));
        assert_eq!(objets[5], Objet::Entier(15));
        assert_eq!(objets[6], Objet::Entier(255));
    }

    #[test]
    fn noms_litteraux_et_executables() {
        let objets = analyser("/m /moveto load def").unwrap();
        assert_eq!(objets[0], Objet::NomLitteral("m".to_string()));
        assert_eq!(objets[1], Objet::NomLitteral("moveto".to_string()));
        assert_eq!(objets[2], Objet::Nom("load".to_string()));
        assert_eq!(objets[3], Objet::Nom("def".to_string()));
    }

    #[test]
    fn commentaires() {
        let objets = analyser("% un commentaire\n1 % un autre\n2").unwrap();
        assert_eq!(objets, vec![Objet::Entier(1), Objet::Entier(2)]);
    }

    #[test]
    fn chaines_avec_parentheses_imbriquees() {
        let objets = analyser("(a(b)c)").unwrap();
        assert_eq!(objets[0], Objet::Chaine(b"a(b)c".to_vec()));
        let objets = analyser("(a\\(b\\))").unwrap();
        assert_eq!(objets[0], Objet::Chaine(b"a(b)".to_vec()));
    }

    #[test]
    fn echappements_de_chaine() {
        let objets = analyser("(a\\nb\\tc\\\\d)").unwrap();
        assert_eq!(objets[0], Objet::Chaine(b"a\nb\tc\\d".to_vec()));
        // Octal : \101 est « A ».
        let objets = analyser("(\\101\\102)").unwrap();
        assert_eq!(objets[0], Objet::Chaine(b"AB".to_vec()));
    }

    #[test]
    fn chaine_hexadecimale() {
        let objets = analyser("<48656C6C6F>").unwrap();
        assert_eq!(objets[0], Objet::Chaine(b"Hello".to_vec()));
        // Nombre impair de chiffres : complété par un zéro.
        let objets = analyser("<414>").unwrap();
        assert_eq!(objets[0], Objet::Chaine(vec![0x41, 0x40]));
    }

    #[test]
    fn tableau_vide_et_procedure() {
        let objets = analyser("[]0 d").unwrap();
        assert_eq!(objets[0], Objet::Tableau(vec![]));
        assert_eq!(objets[1], Objet::Entier(0));
        assert_eq!(objets[2], Objet::Nom("d".to_string()));

        let objets = analyser("{} /x def").unwrap();
        assert_eq!(objets[0], Objet::Procedure(vec![]));
    }

    #[test]
    fn procedure_imbriquee() {
        let objets = analyser("{ { 1 } 2 }").unwrap();
        let Objet::Procedure(dedans) = &objets[0] else {
            panic!("attendu une procédure");
        };
        assert_eq!(dedans.len(), 2);
        assert_eq!(dedans[0], Objet::Procedure(vec![Objet::Entier(1)]));
        assert_eq!(dedans[1], Objet::Entier(2));
    }

    #[test]
    fn booleens() {
        let objets = analyser("true false").unwrap();
        assert_eq!(objets[0], Objet::Booleen(true));
        assert_eq!(objets[1], Objet::Booleen(false));
    }

    #[test]
    fn erreurs_de_structure() {
        assert!(matches!(
            analyser(")").unwrap_err(),
            ErreurLexe::FermetureOrpheline { .. }
        ));
        assert!(matches!(
            analyser("(abc").unwrap_err(),
            ErreurLexe::ChaineNonFermee
        ));
        assert!(matches!(
            analyser("<41").unwrap_err(),
            ErreurLexe::ChaineHexNonFermee
        ));
        assert!(matches!(
            analyser("{ 1").unwrap_err(),
            ErreurLexe::FermetureOrpheline { .. }
        ));
        assert!(matches!(
            analyser("[ 1 }").unwrap_err(),
            ErreurLexe::FermetureOrpheline { .. }
        ));
    }

    #[test]
    fn operateurs_et_prologues_reels() {
        // Un extrait de prologue d'Illustrator, tel qu'on le rencontre.
        let source = "/M /moveto load def\n/l /lineto load def\n/h /closepath load def\n\
                      /f /fill load def\n/x /exec load def\n";
        let objets = analyser(source).unwrap();
        assert_eq!(objets.len(), 20);
        assert_eq!(objets[1], Objet::NomLitteral("moveto".to_string()));
        assert_eq!(objets[2], Objet::Nom("load".to_string()));
    }
}
