//! Primitives de syntaxe PDF : noms, nombres, tableaux, dictionnaires.
//!
//! Rien ici ne connaît les tons directs : ce module ne fait que **produire la
//! syntaxe** correcte du format PDF (ISO 32000), pour que les modules du dessus
//! n'aient plus à s'en préoccuper.

/// Échappe et préfixe un **nom PDF** (`/Nom`).
///
/// Les caractères hors de la plage imprimable `!`–`~` et les délimiteurs
/// (`()<>[]{}/%#`) doivent être écrits en `#XX` (deux chiffres hexadécimaux
/// majuscules), octet par octet. Un espace devient donc `#20`, ce qui est
/// exactement ce qui permet d'écrire `/PANTONE#20WARM#20RED#20C`.
#[must_use]
pub fn name(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len() + 1);
    out.push('/');
    for &byte in raw.as_bytes() {
        let escape = byte <= 0x20
            || byte >= 0x7f
            || matches!(
                byte,
                b'(' | b')' | b'<' | b'>' | b'[' | b']' | b'{' | b'}' | b'/' | b'%' | b'#'
            );
        if escape {
            out.push('#');
            out.push_str(&format!("{byte:02X}"));
        } else {
            out.push(byte as char);
        }
    }
    out
}

/// Formate un nombre réel pour le PDF : au plus 4 décimales, zéros de fin
/// supprimés, `-0` normalisé en `0`, valeurs non finies remplacées par `0`.
///
/// Un PDF n'accepte ni `NaN`, ni `Infinity` ; ce garde-fou évite d'écrire un
/// document corrompu si un calcul amont part en vrille.
#[must_use]
pub fn number(value: f64) -> String {
    if !value.is_finite() {
        return "0".to_string();
    }
    let value = if value == 0.0 { 0.0 } else { value };
    let text = format!("{value:.4}");
    let trimmed = text.trim_end_matches('0').trim_end_matches('.');
    if trimmed.is_empty() || trimmed == "-" {
        "0".to_string()
    } else {
        trimmed.to_string()
    }
}

/// Formate un entier PDF.
#[must_use]
pub fn integer(value: i64) -> String {
    value.to_string()
}

/// Assemble un **tableau** PDF : `[a b c]`.
#[must_use]
pub fn array(items: &[String]) -> String {
    format!("[{}]", items.join(" "))
}

/// Assemble un **dictionnaire** PDF : `<< /Clé Valeur … >>`.
///
/// Les clés sont des noms bruts (sans `/`) ; les valeurs sont déjà formatées
/// en syntaxe PDF.
#[must_use]
pub fn dict<K: AsRef<str>>(entries: &[(K, String)]) -> String {
    let mut out = String::from("<<");
    for (key, value) in entries {
        out.push(' ');
        out.push_str(&name(key.as_ref()));
        out.push(' ');
        out.push_str(value);
    }
    out.push_str(" >>");
    out
}
/// Table de correspondance des caractères **typographiques** vers
/// PDFDocEncoding.
///
/// PDFDocEncoding n'est pas Latin-1 sur la plage 0x80–0x9F : il y loge les
/// caractères de composition (tirets, guillemets courbes, puces, symbole
/// euro…). Les ignorer ferait perdre le tiret cadratin et l'apostrophe courbe
/// d'un titre français — exactement ce qui arrive quand on écrit un « ? » à la
/// place. Une table explicite est la seule façon d'être juste.
const PDFDOC_SPECIAUX: &[(char, u8)] = &[
    ('\u{20AC}', 0xA0), // € euro
    ('\u{201A}', 0x91), // ‚ quotesinglbase
    ('\u{0192}', 0x86), // ƒ florin
    ('\u{201E}', 0x8C), // „ quotedblbase
    ('\u{2026}', 0x83), // … ellipsis
    ('\u{2020}', 0x81), // † dagger
    ('\u{2021}', 0x82), // ‡ daggerdbl
    ('\u{02C6}', 0x1A), // ˆ circumflex
    ('\u{2030}', 0x8B), // ‰ perthousand
    ('\u{0160}', 0x97), // Š Scaron
    ('\u{2039}', 0x88), // ‹ guilsinglleft
    ('\u{0152}', 0x96), // Œ OE
    ('\u{017D}', 0x99), // Ž Zcaron
    ('\u{2018}', 0x8F), // ‘ quoteleft
    ('\u{2019}', 0x90), // ’ quoteright
    ('\u{201C}', 0x8D), // “ quotedblleft
    ('\u{201D}', 0x8E), // ” quotedblright
    ('\u{2022}', 0x80), // • bullet
    ('\u{2013}', 0x85), // – endash
    ('\u{2014}', 0x84), // — emdash
    ('\u{02DC}', 0x1F), // ˜ tilde
    ('\u{2122}', 0x92), // ™ trademark
    ('\u{0161}', 0x9D), // š scaron
    ('\u{203A}', 0x89), // › guilsinglright
    ('\u{0153}', 0x9C), // œ oe
    ('\u{017E}', 0x9E), // ž zcaron
    ('\u{0178}', 0x98), // Ÿ Ydieresis
];

/// Écrit une **chaîne littérale** PDF : `(…)`.
///
/// ## Encodage
///
/// Une chaîne PDF sans déclaration d'encodage est lue en **PDFDocEncoding**. On
/// écrit donc chaque caractère comme **un octet**, jamais comme sa séquence
/// UTF-8 : `é` devient `\351`, ce qui s'affiche correctement, alors qu'un `é`
/// UTF-8 (deux octets) s'afficherait « Ã© ».
///
/// PDFDocEncoding n'est pas Latin-1 au-dessus de 0x7F : la plage 0x80–0x9F porte
/// les caractères typographiques. [`PDFDOC_SPECIAUX`] les rétablit, pour qu'un
/// titre comme « L’art — et la manière » garde son apostrophe courbe et son
/// tiret cadratin.
///
/// Un caractère vraiment hors de cette table (CJK, emoji) est remplacé par un
/// `?`. L'alternative correcte est une chaîne **UTF-16BE** précédée de la marque
/// d'ordre des octets (`\376\377`), que ce module n'écrit pas encore — c'est
/// noté dans `docs/PLAN.md`.
///
/// Les trois caractères qui traversent ou ferment une chaîne sont échappés.
#[must_use]
pub fn literal_string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('(');
    for caractere in text.chars() {
        let Some(octet) = octet_pdfdoc(caractere) else {
            out.push('?');
            continue;
        };
        match octet {
            b'\\' => out.push_str("\\\\"),
            b'(' => out.push_str("\\("),
            b')' => out.push_str("\\)"),
            b'\n' => out.push_str("\\n"),
            b'\r' => out.push_str("\\r"),
            b'\t' => out.push_str("\\t"),
            0x20..=0x7e => out.push(octet as char),
            _ => out.push_str(&format!("\\{octet:03o}")),
        }
    }
    out.push(')');
    out
}

/// Rend l'octet PDFDocEncoding d'un caractère, ou `None` s'il n'existe pas.
#[must_use]
fn octet_pdfdoc(caractere: char) -> Option<u8> {
    let code = caractere as u32;
    if code <= 0xFF {
        // Latin-1 et PDFDocEncoding coïncident sur 0xA0–0xFF ; en dessous, les
        // caractères de contrôle ne sont pas des caractères d'affichage.
        return Some(code as u8);
    }
    PDFDOC_SPECIAUX
        .iter()
        .find(|(c, _)| *c == caractere)
        .map(|(_, octet)| *octet)
}
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nom_simple() {
        assert_eq!(name("DeviceCMYK"), "/DeviceCMYK");
    }

    #[test]
    fn nom_echappe_les_espaces() {
        // Cœur du sujet : un nom d'encre à espaces doit ressortir en `#20`.
        assert_eq!(name("PANTONE WARM RED C"), "/PANTONE#20WARM#20RED#20C");
    }

    #[test]
    fn nom_echappe_les_delimiters() {
        assert_eq!(name("a#b"), "/a#23b");
        assert_eq!(name("a(b)"), "/a#28b#29");
        assert_eq!(name("a/b"), "/a#2Fb");
        // Non-ASCII : échappé octet par octet (UTF-8).
        assert_eq!(name("é"), "/#C3#A9");
    }

    #[test]
    fn nombres() {
        assert_eq!(number(72.0), "72");
        assert_eq!(number(72.5), "72.5");
        assert_eq!(number(0.0), "0");
        assert_eq!(number(-0.0), "0");
        assert_eq!(number(0.9), "0.9");
        assert_eq!(number(1.0), "1");
        assert_eq!(number(612.2834645669292), "612.2835");
        assert_eq!(number(f64::NAN), "0");
        assert_eq!(number(f64::INFINITY), "0");
    }

    #[test]
    fn tableau_et_dictionnaire() {
        assert_eq!(array(&["1".into(), "0".into()]), "[1 0]");
        assert_eq!(
            dict(&[("Type", name("Page")), ("Count", integer(1))]),
            "<< /Type /Page /Count 1 >>"
        );
    }
}
