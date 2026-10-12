//! **RTF** : le texte d'un document balisé, débarrassé de son balisage.
//!
//! ## Ce que le produit faisait, et ce qui manquait
//!
//! Le RTF était lu comme du **texte brut** (`readAsText`) : le modèle recevait
//! `{\rtf1\ansi\deff0{\fonttbl{\f0\froman Times;}}…`. Le module
//! `sp-doc-import.js` a corrigé cela avec `spRtfToText` — un parcours unique de
//! la source — et `spRtfLayoutInfo`, qui relève la mise en page. C'est **ce**
//! lecteur qui est porté ici, et la preuve est une comparaison **caractère par
//! caractère** avec la fonction d'origine extraite du produit.
//!
//! ## La structure d'un RTF, et pourquoi un parcours suffit
//!
//! Un RTF est un arbre d'accolades. Chaque groupe commence par un mot de
//! contrôle qui dit **ce qu'il est** : `\fonttbl` une table de polices,
//! `\colortbl` une palette, `\pict` une image, `\*` un groupe **destiné à être
//! ignoré** si on ne le comprend pas. Le texte est tout ce qui n'est pas du
//! balisage.
//!
//! Le parcours suit donc trois règles, et rien d'autre :
//!
//! 1. **sauter les groupes** dont le mot de contrôle est dans la liste des
//!    destinations non textuelles — et sauter le groupe **entier**, pas le mot ;
//! 2. **décoder** les trois écritures d'un caractère : `\'hh` (un octet, en
//!    CP1252), `\uNNNN` (un point de code **décimal**, les valeurs négatives
//!    codant au-delà de 32767), et les symboles littéraux `\\`, `\{`, `\}` ;
//! 3. **garder** les mots de contrôle qui portent une ponctuation — `\par`,
//!    `\line`, `\tab`, `\emdash` — parce que les perdre collerait deux mots.
//!
//! ## Les deux pièges qui ont coûté, et qui sont dans le code d'origine
//!
//! - `\u8217?` : la spécification RTF impose d'**ignorer** les caractères de
//!   repli qui suivent un `\uN`, et leur nombre est donné par `\ucN` (1 par
//!   défaut). Sans ce saut, « l'artisan » devenait « l?artisan ». Le `\ucN`
//!   peut valoir 0 : dans ce cas il n'y a **aucun** repli à sauter ;
//! - `\*` : sans lui, `{\*\generator Riched20 10.0;}` mettait « Riched20 10.0; »
//!   au milieu du texte.
//!
//! ## Ce qui est porté, y compris les bizarreries — et pourquoi
//!
//! Le lecteur reproduit le comportement du produit **tel qu'il est**, parce que
//! c'est lui qui est mesuré. Trois conséquences, et elles sont assumées :
//!
//! - la liste des destinations ignorées contient `mmathPr`, écrit en
//!   **camelCase** alors que le mot de contrôle est mis en minuscules avant la
//!   recherche : cette entrée n'est donc **jamais atteinte**, et un groupe
//!   `\mmathPr` n'est pas sauté. C'est un défaut du produit ; le corriger ici
//!   rendrait le portage **meilleur** que la référence, et la comparaison
//!   échouerait sur un vrai document MathML. Il est donc **reproduit**, et
//!   signalé ;
//! - `\page` produit un marqueur `[PAGE n]` **dans le texte** : c'est le choix du
//!   module — un texte qui dit où sont les pages — et il est conservé à
//!   l'identique ;
//! - un `\uN` qui tombe dans la zone des **substituts** (0xD800–0xDFFF) est
//!   **ignoré** : JavaScript y produirait un substitut isolé, qui n'est pas un
//!   caractère et n'a pas d'écriture UTF-8. C'est la **seule** divergence connue
//!   avec le produit, et elle ne concerne que des fichiers qui n'existent pas.
//!
//! ## Une fonction du produit qui ne sert à rien, et qui n'est pas portée
//!
//! `spRtfHorsFlux` neutralise les groupes `{\header …}` dans le corps. Elle est
//! **définie et jamais appelée** : le corps les exclut déjà par la liste des
//! destinations ignorées. Porter du code mort aurait laissé croire qu'il sert.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « import de documents »).

use crate::{ErreurImport, Format, Memoire, Page, Paragraphe};

/// Les destinations dont le **groupe entier** est du balisage, jamais du texte.
///
/// ⚠️ Les mots de contrôle sont mis en minuscules **avant** la recherche, comme
/// dans le produit. La liste d'origine contient donc une entrée `mmathPr` en
/// camelCase qui **ne peut jamais correspondre** : elle est absente ici, et la
/// raison est écrite plutôt que devinée (voir l'en-tête du module).
const DESTINATIONS_IGNOREES: &[&str] = &[
    "fonttbl",
    "colortbl",
    "stylesheet",
    "info",
    "pict",
    "object",
    "themedata",
    "colorschememapping",
    "latentstyles",
    "datastore",
    "listtable",
    "listoverridetable",
    "rsidtbl",
    "generator",
    "filetbl",
    "revtbl",
    "xmlnstbl",
    "upr",
    "wgrffmtfilter",
    "pgptbl",
    "docvar",
    "nonshppict",
    "shppict",
    // Les en-têtes et pieds de page sont **lus par l'analyse de mise en page**
    // (sur la source brute) mais **exclus du corps** : sans cela, « Page » et
    // « CONFIDENTIEL » apparaissaient au milieu du document.
    "header",
    "footer",
    "headerl",
    "headerr",
    "footerl",
    "footerr",
    "footnote",
    "annotation",
    "fldinst",
];

/// Un octet de la source devient-il un caractère RTF ?
///
/// La signature d'un RTF est `{\rtf` — et le produit se contente des deux
/// premiers octets, `{` puis `\`.
#[must_use]
pub fn ressemble_a_du_rtf(octets: &[u8]) -> bool {
    octets.len() >= 2 && octets[0] == 0x7B && octets[1] == 0x5C
}

/// Lit un document RTF.
///
/// # Erreurs
///
/// [`ErreurImport::FormatContredit`] si les octets ne commencent pas par `{\`.
pub fn lire(octets: &[u8]) -> Result<Memoire, ErreurImport> {
    if !ressemble_a_du_rtf(octets) {
        return Err(ErreurImport::FormatContredit {
            annonce: "rtf".to_string(),
            trouve: debut_lisible(octets),
        });
    }
    let source = latin1(octets);
    let complet = texte(&source);
    let page = format_page(&source);

    // Chaque ligne devient un paragraphe. Ce n'est pas une perte : `texte()`
    // les rejoint par des sauts de ligne, donc l'aller-retour est exact — et
    // c'est la seule lecture possible, le RTF ne portant ses paragraphes que
    // comme des `\par` **dans le flux de caractères**.
    let paragraphes: Vec<Paragraphe> = complet
        .split('\n')
        .map(Paragraphe::texte)
        .collect::<Vec<Paragraphe>>();

    Ok(Memoire {
        format: Format::Rtf,
        paragraphes,
        page,
        titre: None,
        images: Vec::new(),
        notes: Vec::new(),
        avertissements: vec![
            "RTF : le texte et la mise en page sont lus, les **styles** ne le sont pas — \
             gras, italique, corps et couleur sont du balisage ignoré, comme dans le produit. \
             Les propriétés de page reconnues (format, marges, colonnes, en-tête, pied) sont \
             rendues en tête du texte."
                .to_string(),
        ],
    })
}

/// Les octets interprétés en **latin-1** : chaque octet devient le caractère de
/// même code.
///
/// C'est ce que fait `spBytesToLatin1` du produit, et c'est la seule lecture
/// possible : dans un RTF, les octets accentués sont écrits `\'e9` et décodés en
/// CP1252 **au cas par cas**, pas par un décodage global du fichier.
#[must_use]
pub fn latin1(octets: &[u8]) -> String {
    octets.iter().map(|octet| char::from(*octet)).collect()
}

/// Un caractère RTF, à partir d'un octet, selon la page de codes **CP1252**.
///
/// Trois cas, et ils viennent tous du produit :
///
/// - `160..=255` : le caractère latin-1 correspondant ;
/// - `128..=159` : la table CP1252, qui remplace les caractères de contrôle par
///   des signes utiles (guillemets français, euro, tirets) ;
/// - le reste : **rien**. Un octet de contrôle ne produit pas de caractère, et
///   c'est bien ce qu'on veut d'un `\'00` de remplissage.
#[must_use]
pub fn cp1252(octet: u8) -> Option<char> {
    if (160..=255).contains(&octet) {
        return Some(char::from(octet));
    }
    let code: u32 = match octet {
        128 => 0x20AC,
        130 => 0x201A,
        131 => 0x0192,
        132 => 0x201E,
        133 => 0x2026,
        134 => 0x2020,
        135 => 0x2021,
        136 => 0x02C6,
        137 => 0x2030,
        138 => 0x0160,
        139 => 0x2039,
        140 => 0x0152,
        142 => 0x017D,
        145 => 0x2018,
        146 => 0x2019,
        147 => 0x201C,
        148 => 0x201D,
        149 => 0x2022,
        150 => 0x2013,
        151 => 0x2014,
        152 => 0x02DC,
        153 => 0x2122,
        154 => 0x0161,
        155 => 0x203A,
        156 => 0x0153,
        158 => 0x017E,
        159 => 0x0178,
        _ => return None,
    };
    char::from_u32(code)
}

/// Le texte d'un RTF : le corps débarrassé du balisage, précédé de la mise en
/// page reconnue.
#[must_use]
pub fn texte(source: &str) -> String {
    let brut = corps(source);
    let assemble = format!("{}{}", mise_en_page(source), normaliser(&brut).trim());
    assemble.trim().to_string()
}

/// Le corps du texte, sans la mise en page : c'est le parcours principal.
#[must_use]
pub fn corps(source: &str) -> String {
    let s: Vec<char> = source.chars().collect();
    let n = s.len();
    let mut sortie = String::new();
    let mut i = 0usize;
    let mut profondeur: i64 = 0;
    // Le groupe ignoré commence à cette profondeur ; `-1` = on n'ignore rien.
    let mut ignorer_depuis: i64 = -1;
    // `\ucN` : nombre de caractères de repli à sauter après un `\uN`.
    let mut uc = 1usize;
    let mut numero_de_page = 1u32;

    while i < n {
        let c = s[i];
        if c == '{' {
            profondeur += 1;
            i += 1;
            continue;
        }
        if c == '}' {
            if ignorer_depuis >= 0 && profondeur <= ignorer_depuis {
                ignorer_depuis = -1;
            }
            profondeur -= 1;
            i += 1;
            continue;
        }
        if c == '\\' {
            // `\'hh` — un octet en CP1252.
            if i + 3 < n && s[i + 1] == '\'' {
                if let (Some(haut), Some(bas)) = (chiffre_hexa(s[i + 2]), chiffre_hexa(s[i + 3])) {
                    i += 4;
                    if ignorer_depuis < 0 {
                        if let Some(caractere) = cp1252(haut * 16 + bas) {
                            sortie.push(caractere);
                        }
                    }
                    continue;
                }
            }
            // `\uN` — un point de code **décimal**.
            if i + 1 < n && s[i + 1] == 'u' {
                if let Some((valeur, longueur)) = entier_signe(&s[i + 2..]) {
                    i += 2 + longueur;
                    if ignorer_depuis < 0 {
                        let mut code = valeur;
                        if code < 0 {
                            code += 65536;
                        }
                        if code > 0 && code <= 1_114_111 {
                            if let Some(caractere) = char::from_u32(code as u32) {
                                sortie.push(caractere);
                            }
                        }
                    }
                    // Le repli annoncé par `\ucN` : c'est ce qui évite « l?artisan ».
                    for _ in 0..uc {
                        if i < n {
                            i += 1;
                        }
                    }
                    continue;
                }
            }
            // `\*` — un groupe destiné à être ignoré.
            if i + 1 < n && s[i + 1] == '*' {
                i += 2;
                if ignorer_depuis < 0 {
                    ignorer_depuis = profondeur;
                }
                continue;
            }
            // `\mot[-]chiffres` — un mot de contrôle.
            if let Some((mot, parametre, suivant)) = mot_de_controle(&s, i) {
                i = suivant;
                if mot == "uc" {
                    uc = parametre.unwrap_or(1).max(0) as usize;
                    continue;
                }
                if DESTINATIONS_IGNOREES.contains(&mot.as_str()) && ignorer_depuis < 0 {
                    ignorer_depuis = profondeur;
                    continue;
                }
                if ignorer_depuis >= 0 {
                    continue;
                }
                match mot.as_str() {
                    "page" => {
                        numero_de_page += 1;
                        sortie.push_str(&format!("\n[PAGE {numero_de_page}]\n"));
                    }
                    "par" | "line" | "sect" | "row" => sortie.push('\n'),
                    "tab" | "cell" => sortie.push('\t'),
                    "bullet" => sortie.push_str("- "),
                    "emdash" => sortie.push('\u{2014}'),
                    "endash" => sortie.push('\u{2013}'),
                    "lquote" => sortie.push('\u{2018}'),
                    "rquote" => sortie.push('\u{2019}'),
                    "ldblquote" => sortie.push('\u{00AB}'),
                    "rdblquote" => sortie.push('\u{00BB}'),
                    // Tout le reste (`\b`, `\i`, `\fs24`, `\cf1`, `\f0`…) est de
                    // la mise en forme : sans intérêt pour une mise en page
                    // qui ne la porte pas, donc ignoré — et c'est dit.
                    _ => {}
                }
                continue;
            }
            // `\x` où `x` n'est pas une lettre : un symbole littéral.
            if i + 1 < n && !s[i + 1].is_ascii_alphabetic() {
                if ignorer_depuis < 0 {
                    sortie.push(s[i + 1]);
                }
                i += 2;
                continue;
            }
            i += 1;
            continue;
        }
        // Les fins de ligne de la source ne sont pas du contenu : un RTF écrit
        // sur plusieurs lignes ne fait pas de paragraphes pour autant.
        if c != '\r' && c != '\n' && ignorer_depuis < 0 {
            sortie.push(c);
        }
        i += 1;
    }
    sortie
}

/// Le mot de contrôle qui commence à `i` (qui pointe sur l'antislash).
///
/// Rend `(mot en minuscules, paramètre, indice suivant)`. Le mot est suivi d'un
/// paramètre entier facultatif — le `-` n'est consommé que s'il **est** suivi
/// d'un chiffre — puis d'**un seul** espace facultatif.
fn mot_de_controle(s: &[char], i: usize) -> Option<(String, Option<i64>, usize)> {
    let n = s.len();
    let debut = i + 1;
    let mut j = debut;
    while j < n && s[j].is_ascii_alphabetic() {
        j += 1;
    }
    if j == debut {
        return None;
    }
    let mut fin = j;
    let mut parametre = None;
    if j < n && (s[j] == '-' || s[j].is_ascii_digit()) {
        let mut k = j;
        if s[k] == '-' {
            k += 1;
        }
        let debut_chiffres = k;
        while k < n && s[k].is_ascii_digit() {
            k += 1;
        }
        if k > debut_chiffres {
            let texte: String = s[j..k].iter().collect();
            parametre = texte.parse::<i64>().ok();
            fin = k;
        }
    }
    if fin < n && s[fin] == ' ' {
        fin += 1;
    }
    let mot: String = s[debut..j].iter().collect::<String>().to_ascii_lowercase();
    Some((mot, parametre, fin))
}

/// Un entier décimal signé, tel que `-?\d+`.
///
/// Rend la valeur et le **nombre de caractères consommés** (le signe compris).
fn entier_signe(s: &[char]) -> Option<(i64, usize)> {
    let mut i = 0;
    let mut signe = 1i64;
    if s.first() == Some(&'-') {
        signe = -1;
        i = 1;
    }
    let debut_des_chiffres = i;
    while i < s.len() && s[i].is_ascii_digit() {
        i += 1;
    }
    if i == debut_des_chiffres {
        return None;
    }
    let texte: String = s[debut_des_chiffres..i].iter().collect();
    texte.parse::<i64>().ok().map(|v| (signe * v, i))
}

fn chiffre_hexa(c: char) -> Option<u8> {
    c.to_digit(16).map(|v| v as u8)
}

/// La normalisation des blancs, appliquée au texte extrait.
///
/// Trois passes, dans l'ordre du produit — et l'ordre compte :
///
/// 1. les suites d'espaces et de tabulations deviennent **une** espace ;
/// 2. les espaces **collées** à un saut de ligne disparaissent ;
/// 3. trois sauts de ligne ou plus deviennent **deux**, c'est-à-dire un
///    paragraphe vide au plus.
#[must_use]
pub fn normaliser(texte: &str) -> String {
    let mut colle: Vec<char> = Vec::with_capacity(texte.len());
    for c in texte.chars() {
        if c == ' ' || c == '\t' {
            if matches!(colle.last(), Some(' ') | Some('\t')) {
                continue;
            }
            colle.push(' ');
        } else {
            colle.push(c);
        }
    }
    let mut sans_bords: Vec<char> = Vec::with_capacity(colle.len());
    for c in colle {
        if c == ' ' && sans_bords.last() == Some(&'\n') {
            continue;
        }
        if c == '\n' {
            while sans_bords.last() == Some(&' ') {
                sans_bords.pop();
            }
        }
        sans_bords.push(c);
    }
    let mut sortie = String::with_capacity(sans_bords.len());
    let mut suite = 0usize;
    for c in sans_bords {
        if c == '\n' {
            suite += 1;
            if suite > 2 {
                continue;
            }
        } else {
            suite = 0;
        }
        sortie.push(c);
    }
    sortie
}

/// Les propriétés de page reconnues, en tête du texte, dans l'ordre du produit.
///
/// C'est du **texte**, pas une structure : le module l'ajoute au corps pour que
/// qui lit le document — un humain comme un modèle de langage — sache de quel
/// papier il s'agit. Le noyau, lui, rend la même information en **structure**
/// par [`format_page`], et les deux viennent de la même source.
#[must_use]
pub fn mise_en_page(source: &str) -> String {
    if source.is_empty() {
        return String::new();
    }
    let twips_en_mm = |twips: f64| (twips * 25.4 / 1440.0 * 10.0).round() / 10.0;

    let paperw = nombre(source, "paperw");
    let paperh = nombre(source, "paperh");
    let margl = nombre(source, "margl");
    let margr = nombre(source, "margr");
    let margt = nombre(source, "margt");
    let margb = nombre(source, "margb");
    let gutter = nombre(source, "gutter");
    let cols = nombre(source, "cols");
    let colsx = nombre(source, "colsx");
    let paysage_force = present(source, "landscape");

    let sauts_de_page = compter(source, "page");
    let sauts_de_section = compter(source, "sect");

    let entete = texte_du_groupe(source, "header");
    let pied = texte_du_groupe(source, "footer");

    let mut champs: Vec<&str> = Vec::new();
    if present(source, "chpgn") {
        champs.push("numero de page");
    }
    if present(source, "numpages") {
        champs.push("nombre total de pages");
    }
    if present(source, "chdate") || present(source, "chtime") {
        champs.push("date");
    }
    if present(source, "chftn") {
        champs.push("note de bas de page");
    }

    let mut lignes: Vec<String> = Vec::new();
    if let (Some(largeur), Some(hauteur)) = (paperw, paperh) {
        if largeur > 0.0 && hauteur > 0.0 {
            let l = twips_en_mm(largeur);
            let h = twips_en_mm(hauteur);
            let paysage = paysage_force || l > h;
            let petit = l.min(h).round();
            let grand = l.max(h).round();
            let cote = format!("{petit:.0} x {grand:.0}");
            let nom = match cote.as_str() {
                "210 x 297" => Some("A4"),
                "297 x 420" => Some("A3"),
                "148 x 210" => Some("A5"),
                "216 x 279" => Some("Letter"),
                "216 x 356" => Some("Legal"),
                "279 x 432" => Some("Tabloid"),
                _ => None,
            };
            let mut texte = String::new();
            if let Some(nom) = nom {
                texte.push_str(nom);
                texte.push(' ');
            }
            texte.push_str(if paysage { "paysage" } else { "portrait" });
            lignes.push(format!("FORMAT : {texte} ({l} x {h} mm)"));
        }
    }
    if margl.is_some() || margt.is_some() || margr.is_some() || margb.is_some() {
        let mut cotes: Vec<String> = Vec::new();
        if let Some(v) = margt {
            cotes.push(format!("haut {} mm", twips_en_mm(v)));
        }
        if let Some(v) = margb {
            cotes.push(format!("bas {} mm", twips_en_mm(v)));
        }
        if let Some(v) = margl {
            cotes.push(format!("gauche {} mm", twips_en_mm(v)));
        }
        if let Some(v) = margr {
            cotes.push(format!("droite {} mm", twips_en_mm(v)));
        }
        lignes.push(format!("MARGES : {}", cotes.join(", ")));
    }
    if let Some(valeur) = gutter.filter(|v| *v != 0.0) {
        lignes.push(format!("RELIURE : {} mm", twips_en_mm(valeur)));
    }
    if let Some(nombre_de_colonnes) = cols.filter(|v| *v > 1.0) {
        let suffixe = match colsx {
            Some(v) => format!(" (gouttiere {} mm)", twips_en_mm(v)),
            None => String::new(),
        };
        lignes.push(format!("COLONNES : {}{suffixe}", nombre_de_colonnes as i64));
    }
    if sauts_de_section > 0 {
        lignes.push(format!(
            "SECTIONS : {} (formats pouvant differer)",
            sauts_de_section + 1
        ));
    }
    if sauts_de_page > 0 {
        lignes.push(format!(
            "PAGES : au moins {} (sauts de page explicites). Chaque saut est marque [PAGE n] \
             dans le texte.",
            sauts_de_page + 1
        ));
    }
    if !entete.is_empty() {
        lignes.push(format!("EN-TETE : {entete}"));
    }
    if !pied.is_empty() {
        lignes.push(format!("PIED DE PAGE : {pied}"));
    }
    if !champs.is_empty() {
        lignes.push(format!("CHAMPS AUTOMATIQUES : {}", champs.join(", ")));
    }
    if lignes.is_empty() {
        return String::new();
    }
    format!(
        "\n[DOCUMENT RTF \u{2014} MISE EN PAGE DETECTEE]\n{}\n[FIN DE LA MISE EN PAGE]\n",
        lignes.join("\n")
    )
}

/// Le premier `\mot<entier>` de la source, ou `None`.
fn nombre(source: &str, mot: &str) -> Option<f64> {
    let motif = format!("\\{mot}");
    let s: Vec<char> = source.chars().collect();
    let aiguille: Vec<char> = motif.chars().collect();
    let mut i = 0usize;
    while i + aiguille.len() <= s.len() {
        if s[i..i + aiguille.len()] == aiguille[..] {
            let suite = &s[i + aiguille.len()..];
            if let Some((valeur, _)) = entier_signe(suite) {
                return Some(valeur as f64);
            }
        }
        i += 1;
    }
    None
}

/// Le mot de contrôle est-il **présent** dans la source ? (`\mot` suivi d'une
/// fin de mot.)
fn present(source: &str, mot: &str) -> bool {
    compter(source, mot) > 0
}

/// Combien de fois le mot de contrôle apparaît, **sur la source brute**.
///
/// ⚠️ C'est bien la source brute, et pas le texte extrait : une occurrence
/// écrite dans la table des polices compte. C'est le comportement du produit, et
/// il est conservé — la mesure porte sur ce que le fichier **dit**, pas sur ce
/// qu'il en reste après nettoyage.
fn compter(source: &str, mot: &str) -> usize {
    let motif = format!("\\{mot}");
    let s: Vec<char> = source.chars().collect();
    let aiguille: Vec<char> = motif.chars().collect();
    let mut total = 0usize;
    let mut i = 0usize;
    while i + aiguille.len() <= s.len() {
        if s[i..i + aiguille.len()] == aiguille[..] {
            // La fin du mot : ce qui suit ne doit pas être un caractère de mot,
            // sinon `\page` compterait aussi `\pages`.
            let fin_de_mot = match s.get(i + aiguille.len()) {
                Some(c) => !est_caractere_de_mot(*c),
                None => true,
            };
            if fin_de_mot {
                total += 1;
            }
        }
        i += 1;
    }
    total
}

fn est_caractere_de_mot(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_'
}

/// Le contenu d'un groupe `{\nom … }`, réduit à son texte.
fn texte_du_groupe(source: &str, nom: &str) -> String {
    let motif = format!("{{\\{nom}");
    let Some(debut) = source.find(&motif) else {
        return String::new();
    };
    let s: Vec<char> = source[debut..].chars().collect();
    let mut profondeur = 0i64;
    let mut fin = None;
    for (i, c) in s.iter().enumerate() {
        if *c == '{' {
            profondeur += 1;
        } else if *c == '}' {
            profondeur -= 1;
            if profondeur == 0 {
                fin = Some(i);
                break;
            }
        }
    }
    let Some(fin) = fin else {
        return String::new();
    };
    let brut: String = s[..fin].iter().collect();
    nettoyer_groupe(&brut)
}

/// Les quatre nettoyages d'un groupe d'en-tête, dans l'ordre du produit.
fn nettoyer_groupe(brut: &str) -> String {
    let s: Vec<char> = brut.chars().collect();
    let n = s.len();
    let mut sortie = String::new();
    let mut i = 0usize;
    while i < n {
        let c = s[i];
        if c == '\\' {
            // `\'hh` → le caractère CP1252.
            if i + 3 < n && s[i + 1] == '\'' {
                if let (Some(haut), Some(bas)) = (chiffre_hexa(s[i + 2]), chiffre_hexa(s[i + 3])) {
                    if let Some(caractere) = cp1252(haut * 16 + bas) {
                        sortie.push(caractere);
                    }
                    i += 4;
                    continue;
                }
            }
            // `\uN` suivi de sa place de repli (`\s?` puis `?`).
            if i + 1 < n && s[i + 1] == 'u' {
                if let Some((valeur, longueur)) = entier_signe(&s[i + 2..]) {
                    let mut code = valeur;
                    if code < 0 {
                        code += 65536;
                    }
                    if code > 0 {
                        if let Some(caractere) = char::from_u32(code as u32) {
                            sortie.push(caractere);
                        }
                    }
                    i += 2 + longueur;
                    if i < n && s[i].is_whitespace() {
                        i += 1;
                    }
                    if i < n && s[i] == '?' {
                        i += 1;
                    }
                    continue;
                }
            }
            // `\chpgn` → le numéro de page.
            //
            // ⚠️ Le produit écrit ici `{N}`, puis **remplace ensuite toutes les
            // accolades par des espaces** — l'étape suivante de son propre
            // nettoyage. Le marqueur ressort donc en « N » entouré d'espaces :
            // « CONFIDENTIEL{N} » devient « CONFIDENTIEL N ». C'est un défaut du
            // produit, et il est **reproduit** : la comparaison porte sur son
            // texte à lui, et « corriger » ici ferait échouer la mesure sur tous
            // les documents qui portent un numéro de page.
            if s[i + 1..].starts_with(&['c', 'h', 'p', 'g', 'n']) {
                let apres = i + 6;
                let fin_de_mot = match s.get(apres) {
                    Some(c) => !est_caractere_de_mot(*c),
                    None => true,
                };
                if fin_de_mot {
                    sortie.push_str(" N ");
                    i = apres;
                    continue;
                }
            }
            // Tout autre mot de contrôle devient une espace.
            let mut j = i + 1;
            while j < n && s[j].is_ascii_alphabetic() {
                j += 1;
            }
            if j > i + 1 {
                if j < n && s[j] == '-' {
                    j += 1;
                }
                while j < n && s[j].is_ascii_digit() {
                    j += 1;
                }
                if j < n && s[j].is_whitespace() {
                    j += 1;
                }
                sortie.push(' ');
                i = j;
                continue;
            }
            sortie.push(c);
            i += 1;
            continue;
        }
        if c == '{' || c == '}' {
            sortie.push(' ');
            i += 1;
            continue;
        }
        sortie.push(c);
        i += 1;
    }
    // `\s+` → une espace, puis les bords.
    let mut colle = String::with_capacity(sortie.len());
    for c in sortie.chars() {
        if c.is_whitespace() {
            if !colle.ends_with(' ') {
                colle.push(' ');
            }
        } else {
            colle.push(c);
        }
    }
    colle.trim().to_string()
}

/// Le format de page, lu sur `\paperw` et `\paperh` (en **twips**).
///
/// Un twip vaut 1/1440 de pouce. Les dimensions sont **arrondies au
/// millimètre** — c'est ce que fait le produit, et un format de papier se
/// connaît au millimètre — puis refusées si elles sortent de `20..=2000 mm`,
/// bornes qui écartent à la fois les valeurs absurdes et les fichiers qui ne
/// déclarent pas de format.
#[must_use]
pub fn format_page(source: &str) -> Option<Page> {
    let twips_par_mm = 1440.0 / 25.4;
    let largeur = nombre(source, "paperw")?;
    let hauteur = nombre(source, "paperh")?;
    let largeur = (largeur / twips_par_mm).round();
    let hauteur = (hauteur / twips_par_mm).round();
    if !(20.0..=2000.0).contains(&largeur) || !(20.0..=2000.0).contains(&hauteur) {
        return None;
    }
    Some(Page {
        largeur_mm: largeur,
        hauteur_mm: hauteur,
        marge_gauche_mm: None,
        marge_droite_mm: None,
        marge_haut_mm: None,
        marge_bas_mm: None,
    })
}

/// Les premiers caractères lisibles, pour nommer ce qu'on a trouvé au lieu de
/// ce qu'on attendait.
fn debut_lisible(octets: &[u8]) -> String {
    let debut: String = octets
        .iter()
        .take(16)
        .map(|o| {
            if o.is_ascii_graphic() || *o == b' ' {
                char::from(*o)
            } else {
                '.'
            }
        })
        .collect();
    format!("les octets commencent par « {debut} », pas par « {{\\rtf »")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn texte_de(source: &str) -> String {
        corps(source)
    }

    #[test]
    fn un_document_minimal_donne_son_texte() {
        let source = r"{\rtf1\ansi\deff0{\fonttbl{\f0\froman Times;}}Bonjour.}";
        assert_eq!(texte_de(source).trim(), "Bonjour.");
    }

    /// La table des polices, la palette et les générateurs sont du balisage :
    /// leur contenu ne doit pas entrer dans le texte.
    #[test]
    fn les_destinations_non_textuelles_sont_sautees() {
        let source = r"{\rtf1{\colortbl;\red0\green0\blue0;}{\*\generator Riched20 10.0;}Texte.}";
        assert_eq!(texte_de(source).trim(), "Texte.");
    }

    /// `\par` et `\line` sont des sauts, `\tab` une tabulation, et les tirets
    /// typographiques des caractères : les perdre collerait deux mots.
    #[test]
    fn la_ponctuation_du_balisage_est_conservee() {
        let source =
            r"{\rtf1 un\par deux\line trois\tab quatre\emdash cinq\ldblquote six\rdblquote}";
        let texte = texte_de(source);
        assert!(texte.contains("un\n"), "{texte:?}");
        assert!(texte.contains("deux\n"), "{texte:?}");
        assert!(texte.contains("trois\tquatre"), "{texte:?}");
        assert!(texte.contains("\u{2014}"), "{texte:?}");
        assert!(
            texte.contains('\u{00AB}') && texte.contains('\u{00BB}'),
            "{texte:?}"
        );
    }

    /// `\'hh` est un octet CP1252. `80` y vaut le signe **euro** — c'est
    /// exactement ce que la table CP1252 ajoute à latin-1.
    #[test]
    fn les_caracteres_echappes_passent_par_cp1252() {
        assert_eq!(texte_de(r"{\rtf1 120\'80}").trim(), "120\u{20AC}");
        // `e9` est en 160..=255 : c'est le « é » latin-1.
        assert_eq!(texte_de(r"{\rtf1 caf\'e9}").trim(), "caf\u{00E9}");
        // `93` est un guillemet français ouvrant, absent de latin-1.
        assert_eq!(
            texte_de(r"{\rtf1 \'93Bonjour\'94}").trim(),
            "\u{201C}Bonjour\u{201D}"
        );
    }

    /// Le piège mesuré du produit : `\u8217?` doit donner l'apostrophe **sans**
    /// le point d'interrogation de repli.
    #[test]
    fn le_caractere_de_repli_est_saute() {
        assert_eq!(
            texte_de(r"{\rtf1 l\u8217?artisan}").trim(),
            "l\u{2019}artisan"
        );
        // ⚠️ Et voici une chose que je croyais fausse, que la mesure a tranchée :
        // l'échappement `\uN` ne consomme **pas** l'espace qui suit. C'est donc
        // l'**espace** qui occupe la place de repli, et le « ? » reste dans le
        // texte. Un rédacteur qui écrit `\u8217 ?` obtient « ’? » — c'est le
        // comportement du produit, reproduit tel quel, et la comparaison avec sa
        // fonction le vérifie sur de vrais fichiers.
        assert_eq!(
            texte_de(r"{\rtf1 l\u8217 ?artisan}").trim(),
            "l\u{2019}?artisan"
        );
        // `\uc0` annonce **zéro** repli : le « ? » suivant est du texte.
        assert_eq!(
            texte_de(r"{\rtf1\uc0 l\u8217?artisan}").trim(),
            "l\u{2019}?artisan"
        );
        // `\uc2` annonce deux caractères de repli.
        assert_eq!(
            texte_de(r"{\rtf1\uc2 l\u8217??artisan}").trim(),
            "l\u{2019}artisan"
        );
    }

    /// Une valeur négative code un point de code au-delà de 32767.
    #[test]
    fn une_valeur_negative_ajoute_65536() {
        // -3913 + 65536 = 61623, dans le domaine privé : peu importe le glyphe,
        // ce qui compte est que le décalage soit appliqué.
        let texte = texte_de(r"{\rtf1 \u-3913}");
        assert_eq!(texte.trim().chars().count(), 1, "{texte:?}");
        assert_eq!(texte.trim().chars().next().map(|c| c as u32), Some(61623));
    }

    /// Un `\page` devient un marqueur **dans le texte** : c'est le choix du
    /// module, et il est conservé à l'identique.
    #[test]
    fn les_sauts_de_page_sont_marques() {
        let texte = texte_de(r"{\rtf1 page une\page page deux\page page trois}");
        assert!(texte.contains("[PAGE 2]"), "{texte:?}");
        assert!(texte.contains("[PAGE 3]"), "{texte:?}");
    }

    /// Les symboles littéraux rendent le caractère, pas le balisage.
    #[test]
    fn les_symboles_litteraux_sont_rendus() {
        assert_eq!(texte_de(r"{\rtf1 a\\b}").trim(), "a\\b");
        assert_eq!(texte_de(r"{\rtf1 \{accolade\}}").trim(), "{accolade}");
    }

    /// Les retours à la ligne de la **source** ne sont pas du contenu.
    #[test]
    fn les_fins_de_ligne_du_fichier_sont_ignorees() {
        // Un RTF replié sur plusieurs lignes ne fait pas de paragraphes pour
        // autant : le repli du rédacteur tombe sur une espace, qui est, elle, du
        // contenu.
        assert_eq!(
            texte_de("{\\rtf1 un \r\ndeux\n trois}").trim(),
            "un deux trois"
        );
        // Et sans espace, il ne sépare rien : « undeux ». C'est le comportement
        // du produit — mesuré, pas deviné.
        assert_eq!(texte_de("{\\rtf1 un\r\ndeux}").trim(), "undeux");
    }

    #[test]
    fn la_normalisation_reduit_les_blancs() {
        assert_eq!(normaliser("a  \t b"), "a b");
        assert_eq!(normaliser("a \n b"), "a\nb");
        assert_eq!(normaliser("a\n\n\n\nb"), "a\n\nb");
        assert_eq!(normaliser("a\n \n \nb"), "a\n\nb");
    }

    /// La mise en page : A4 avec marges, colonnes, en-tête et un champ.
    #[test]
    fn la_mise_en_page_est_reconnue() {
        let source = concat!(
            r"{\rtf1\ansi\paperw11906\paperh16838",
            r"\margl1418\margr1418\margt1418\margb1418",
            r"\cols2\colsx425",
            r"{\header CONFIDENTIEL\chpgn}",
            r" corps}"
        );
        let en_tete = mise_en_page(source);
        assert!(en_tete.contains("[DOCUMENT RTF"), "{en_tete}");
        assert!(
            en_tete.contains("FORMAT : A4 portrait (210 x 297 mm)"),
            "{en_tete}"
        );
        assert!(
            en_tete.contains("MARGES : haut 25 mm, bas 25 mm, gauche 25 mm, droite 25 mm"),
            "{en_tete}"
        );
        assert!(
            en_tete.contains("COLONNES : 2 (gouttiere 7.5 mm)"),
            "{en_tete}"
        );
        assert!(en_tete.contains("EN-TETE : CONFIDENTIEL N"), "{en_tete}");
        assert!(
            en_tete.contains("CHAMPS AUTOMATIQUES : numero de page"),
            "{en_tete}"
        );
        // Et l'en-tête de groupe ne se mélange pas au corps.
        assert_eq!(corps(source).trim(), "corps");
    }

    /// Le format de page en structure, et ses bornes.
    #[test]
    fn le_format_de_page_est_lu_en_twips() {
        let page = format_page(r"{\rtf1\paperw11906\paperh16838}").expect("A4 attendu");
        assert_eq!(page.largeur_mm, 210.0);
        assert_eq!(page.hauteur_mm, 297.0);
        assert!(!page.est_paysage());
        // Une dimension absurde est refusée plutôt que rendue telle quelle.
        assert!(format_page(r"{\rtf1\paperw10\paperh10}").is_none());
        assert!(format_page(r"{\rtf1\paperw999999\paperh16838}").is_none());
        assert!(format_page(r"{\rtf1}").is_none());
    }

    /// Un paysage déclaré en `\landscape` l'emporte sur le rapport des côtés.
    #[test]
    fn le_paysage_declare_est_respecte() {
        let en_tete = mise_en_page(r"{\rtf1\landscape\paperw16838\paperh11906}");
        assert!(en_tete.contains("A4 paysage"), "{en_tete}");
    }

    /// `\cols1` n'est pas une mise en colonnes : le produit exige plus d'une.
    #[test]
    fn une_seule_colonne_n_est_pas_signalee() {
        let en_tete = mise_en_page(r"{\rtf1\cols1\paperw11906\paperh16838}");
        assert!(!en_tete.contains("COLONNES"), "{en_tete}");
    }

    /// Un fichier qui n'est pas un RTF est refusé, et on dit ce qu'on a trouvé.
    #[test]
    fn un_fichier_qui_n_est_pas_un_rtf_est_refuse() {
        let erreur = lire(b"Bonjour tout le monde").unwrap_err();
        match erreur {
            ErreurImport::FormatContredit { annonce, trouve } => {
                assert_eq!(annonce, "rtf");
                assert!(trouve.contains("Bonjour"), "{trouve}");
            }
            autre => panic!("attendu un format contredit, obtenu {autre:?}"),
        }
        assert!(ressemble_a_du_rtf(b"{\\rtf1"));
        assert!(!ressemble_a_du_rtf(b"Bonjour"));
        assert!(!ressemble_a_du_rtf(b"{"));
    }

    /// Un document complet passé par le lecteur : le texte, le format, le
    /// paragraphe, et l'avertissement qui dit ce qui n'est pas lu.
    #[test]
    fn lire_rend_un_document_complet() {
        let source =
            br"{\rtf1\ansi\paperw11906\paperh16838{\fonttbl{\f0 Times;}}Bonjour\par le monde.}";
        let memoire = lire(source).expect("RTF lisible");
        assert_eq!(memoire.format, Format::Rtf);
        assert_eq!(memoire.page.map(|p| p.largeur_mm), Some(210.0));
        let texte = memoire.texte();
        assert!(texte.contains("Bonjour"), "{texte}");
        assert!(texte.contains("le monde."), "{texte}");
        assert_eq!(memoire.avertissements.len(), 1);
        // Aucune mise en forme n'est inventée.
        assert!(memoire.paragraphes.iter().all(|p| p.style.is_none()
            && !p.liste
            && p.alignement == crate::Alignement::ParDefaut));
    }

    /// Les caractères non latins d'un document réel : la lecture en latin-1 ne
    /// doit rien perdre de ce qui est écrit en `\uN`.
    #[test]
    fn le_latin1_ne_perd_rien_de_l_unicode() {
        let octets = b"{\\rtf1 caf\\'e9 \\u233";
        let source = latin1(octets);
        // Le « é » écrit en `\u233` (décimal) est bien le même caractère.
        let texte = texte_de(&source);
        assert_eq!(texte.matches('\u{00E9}').count(), 2, "{texte:?}");
    }
}
