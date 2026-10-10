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
