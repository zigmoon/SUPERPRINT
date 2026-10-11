//! Métadonnées **XMP**, et la revendication de conformité PDF/X.
//!
//! Le noyau écrivait un `/Info` complet et un `OutputIntent` porteur du profil
//! ICC, et **rien d'autre** : un imprimeur recevait donc un fichier qui *avait
//! l'air* d'un PDF/X (bonnes boîtes, bon profil) mais qui n'en portait pas la
//! déclaration. Une vérification automatique le rejette — et c'est normal : sur
//! un PDF/X, c'est la **déclaration** qui engage, pas la ressemblance.
//!
//! ## Ce que PDF/X demande exactement
//!
//! | Où | Quoi |
//! |---|---|
//! | dictionnaire `/Info` | `/GTS_PDFXVersion` (X-1a et X-3 ; facultatif en X-4) |
//! | paquet XMP | `pdfx:GTS_PDFXVersion`, `pdfaid:part`, `pdfaid:conformance` |
//! | paquet XMP | au moins un `dc:title`, et `xmp:CreatorTool` / `pdf:Producer` |
//! | catalogue | `/Metadata` pointant le paquet XMP, en flux `/Subtype /XML` |
//! | catalogue | `/OutputIntents` avec un profil de **sortie** |
//!
//! ## Pourquoi la conformité est une valeur **fermée**
//!
//! PDF/X-1a, X-3 et X-4 **ne demandent pas la même chose** : X-1a interdit la
//! transparence et n'accepte que CMJN ou tons directs ; X-3 autorise le RVB et
//! l'ICCBased ; X-4 autorise la transparence vivante et l'ICC v4. Écrire une
//! chaîne libre dans un champ de conformité reviendrait à pouvoir déclarer
//! n'importe quoi. [`Conformite`] est donc un type à trois valeurs, et chaque
//! valeur porte **ce qu'elle engage**.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « PDF/X »).

use crate::document::DocInfo;

/// Ce que le fichier revendique, parmi ce que PDF/X définit.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Conformite {
    /// PDF/X-1a:2001 — CMJN et tons directs seulement, transparence interdite.
    PdfX1a2001,
    /// PDF/X-3:2002 — RVB et espaces ICC autorisés, transparence interdite.
    PdfX3n2002,
    /// PDF/X-4 — transparence vivante et profils ICC v4 autorisés.
    PdfX4,
}

impl Conformite {
    /// Le nom exact à écrire, dans `/Info` comme dans le XMP.
    ///
    /// L'orthographe compte : un validateur compare cette chaîne caractère par
    /// caractère, et `X-3` n'est pas `X3`.
    #[must_use]
    pub const fn nom(self) -> &'static str {
        match self {
            Self::PdfX1a2001 => "PDF/X-1a:2001",
            Self::PdfX3n2002 => "PDF/X-3:2002",
            Self::PdfX4 => "PDF/X-4",
        }
    }

    /// La partie de la norme ISO 15930 couverte, pour `pdfaid:part`.
    #[must_use]
    pub const fn partie(self) -> &'static str {
        match self {
            Self::PdfX1a2001 => "1",
            Self::PdfX3n2002 => "3",
            Self::PdfX4 => "4",
        }
    }

    /// Le niveau de conformité, pour `pdfaid:conformance`.
    #[must_use]
    pub const fn niveau(self) -> &'static str {
        match self {
            Self::PdfX1a2001 => "A",
            Self::PdfX3n2002 => "B",
            Self::PdfX4 => "B",
        }
    }

    /// L'identifiant de la norme, pour `pdfxid:GTS_PDFXVersion` et le XMP.
    #[must_use]
    pub const fn identifiant(self) -> &'static str {
        match self {
            Self::PdfX1a2001 => "PDF/X-1a:2001",
            Self::PdfX3n2002 => "PDF/X-3:2002",
            Self::PdfX4 => "PDF/X-4",
        }
    }

    /// Ce que cette conformité **interdit**, écrit noir sur blanc.
    ///
    /// Sert au contrôle : un document qui porte de la transparence ne peut pas
    /// revendiquer X-1a ni X-3, et le dire ici évite que la règle soit recopiée
    /// à trois endroits.
    #[must_use]
    pub const fn interdit_la_transparence(self) -> bool {
        matches!(self, Self::PdfX1a2001 | Self::PdfX3n2002)
    }

    /// `true` si cette conformité accepte les espaces RVB et ICCBased.
    #[must_use]
    pub const fn accepte_le_rvb(self) -> bool {
        matches!(self, Self::PdfX3n2002 | Self::PdfX4)
    }

    /// Le texte à écrire dans `/GTS_PDFXVersion` du dictionnaire `/Info`.
    ///
    /// PDF/X-4 n'exige pas la clé : elle est écrite quand même, parce qu'un
    /// fichier qui la porte est plus facile à contrôler qu'un fichier muet.
    #[must_use]
    pub const fn info_version(self) -> &'static str {
        self.nom()
    }
}

/// Échappe un texte pour du XML.
///
/// Les cinq caractères qui comptent, et l'ordre compte : `&` d'abord, sinon on
/// échapperait les `&` des entités qu'on vient d'écrire. C'est l'erreur qui
/// produit des paquets XMP invalides sur un simple titre contenant « & ».
#[must_use]
pub fn echapper_xml(texte: &str) -> String {
    let mut sortie = String::with_capacity(texte.len());
    for c in texte.chars() {
        match c {
            '&' => sortie.push_str("&amp;"),
            '<' => sortie.push_str("&lt;"),
            '>' => sortie.push_str("&gt;"),
            '"' => sortie.push_str("&quot;"),
            '\'' => sortie.push_str("&apos;"),
            /* Les caractères de contrôle interdits en XML 1.0 sont retirés :
            les écrire rendrait le paquet invalide, et les échapper n'existe
            pas — un titre qui en contient est un titre à nettoyer. */
            c if (c as u32) < 0x20 && c != '\t' && c != '\n' && c != '\r' => {}
            c => sortie.push(c),
        }
    }
    sortie
}

/// Un texte, ou rien du tout : une propriété XMP absente n'est pas une
/// propriété vide.
fn propriete(prefixe: &str, nom: &str, valeur: &Option<String>) -> String {
    match valeur.as_ref().map(|v| v.trim()).filter(|v| !v.is_empty()) {
        Some(v) => format!(
            "<{prefixe}:{nom}><rdf:Alt><rdf:li xml:lang=\"x-default\">{}</rdf:li></rdf:Alt></{prefixe}:{nom}>",
            echapper_xml(v)
        ),
        None => String::new(),
    }
}

/// Une propriété simple, en texte.
fn simple(prefixe: &str, nom: &str, valeur: &Option<String>) -> String {
    match valeur.as_ref().map(|v| v.trim()).filter(|v| !v.is_empty()) {
        Some(v) => format!("<{prefixe}:{nom}>{}</{prefixe}:{nom}>", echapper_xml(v)),
        None => String::new(),
    }
}

/// Construit le **paquet XMP** d'un document, avec sa revendication PDF/X.
///
/// Le résultat est un XML complet, encadré par les marqueurs `<?xpacket ?>` que
/// la spécification XMP exige : sans eux, un lecteur tiers traite le paquet
/// comme du XML ordinaire et peut refuser le fichier.
#[must_use]
pub fn paquet(info: &DocInfo, conformite: Conformite) -> String {
    let titre = propriete("dc", "title", &info.title);
    let auteur = propriete("dc", "creator", &info.author);
    let sujet = propriete("dc", "description", &info.subject);
    let mots_cles = propriete("pdf", "Keywords", &info.keywords);
    let createur = simple("xmp", "CreatorTool", &info.creator);
    let producteur = simple("pdf", "Producer", &info.producer);
    let date_creation = simple("xmp", "CreateDate", &info.creation_date);
    let date_modif = simple("xmp", "ModifyDate", &info.creation_date);

    let corps = format!(
        "<x:xmpmeta xmlns:x=\"adobe:ns:meta/\" x:xmptk=\"SuperPrint\">\
<rdf:RDF xmlns:rdf=\"http://www.w3.org/1999/02/22-rdf-syntax-ns#\">\
<rdf:Description rdf:about=\"\" \
xmlns:dc=\"http://purl.org/dc/elements/1.1/\" \
xmlns:xmp=\"http://ns.adobe.com/xap/1.0/\" \
xmlns:pdf=\"http://ns.adobe.com/pdf/1.3/\" \
xmlns:pdfx=\"http://ns.adobe.com/pdfx/1.3/\" \
xmlns:pdfxid=\"http://www.npes.org/pdfx/ns/id/\" \
xmlns:pdfaid=\"http://www.aiim.org/pdfa/ns/id/\">\
{titre}{auteur}{sujet}{mots_cles}{createur}{producteur}{date_creation}{date_modif}\
<pdfx:GTS_PDFXVersion>{}</pdfx:GTS_PDFXVersion>\
<pdfxid:GTS_PDFXVersion>{}</pdfxid:GTS_PDFXVersion>\
<pdfaid:part>{}</pdfaid:part>\
<pdfaid:conformance>{}</pdfaid:conformance>\
</rdf:Description></rdf:RDF></x:xmpmeta>",
        echapper_xml(conformite.identifiant()),
        echapper_xml(conformite.identifiant()),
        conformite.partie(),
        conformite.niveau(),
    );

    /* Le rembourrage : la spécification XMP recommande de compléter le paquet
    jusqu'à environ 2 ko par des espaces, pour qu'un outil qui modifie le
    paquet sur place ait de la place sans déplacer tout le fichier. Ce n'est
    pas une coquetterie : sans lui, certains outils réécrivent le PDF entier.
    La quantité est calculée sur la longueur **réelle** du paquet encadré, et
    non estimée : une estimation laisse passer un paquet de 2 027 octets. */
    const PREFIXE: &str = "<?xpacket begin=\"\u{feff}\" id=\"W5M0MpCehiHzreSzNTczkc9d\"?>";
    const SUFFIXE: &str = "<?xpacket end=\"w\"?>";
    const CIBLE: usize = 2048;
    let socle = PREFIXE.len() + corps.len() + SUFFIXE.len();
    let rembourrage = " ".repeat(CIBLE.saturating_sub(socle));

    format!("{PREFIXE}{corps}{rembourrage}{SUFFIXE}")
}

/// Les entrées `/Info` propres à PDF/X.
///
/// Rendues à part pour que [`DocInfo::to_pdf`] n'ait pas à connaître PDF/X — la
/// séparation garde chaque structure responsable d'une seule chose.
#[must_use]
pub fn entrees_info(conformite: Conformite) -> Vec<(&'static str, String)> {
    vec![
        (
            "GTS_PDFXVersion",
            crate::object::literal_string(conformite.info_version()),
        ),
        (
            "GTS_PDFXConformance",
            crate::object::literal_string(conformite.identifiant()),
        ),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::document::DocInfo;

    fn info_complet() -> DocInfo {
        DocInfo {
            title: Some("Brochure été".to_string()),
            author: Some("Atelier Dupont".to_string()),
            subject: Some("Fond perdu 3 mm".to_string()),
            keywords: Some("brochure, offset".to_string()),
            creator: Some("SuperPrint".to_string()),
            producer: Some("SuperPrint 1.7".to_string()),
            creation_date: Some("2026-10-11T09:30:00Z".to_string()),
        }
    }

    #[test]
    fn les_noms_de_conformite_sont_ceux_des_validateurs() {
        assert_eq!(Conformite::PdfX1a2001.nom(), "PDF/X-1a:2001");
        assert_eq!(Conformite::PdfX3n2002.nom(), "PDF/X-3:2002");
        assert_eq!(Conformite::PdfX4.nom(), "PDF/X-4");
        assert_eq!(Conformite::PdfX1a2001.partie(), "1");
        assert_eq!(Conformite::PdfX3n2002.partie(), "3");
        assert_eq!(Conformite::PdfX4.partie(), "4");
        assert_eq!(Conformite::PdfX1a2001.niveau(), "A");
        assert_eq!(Conformite::PdfX3n2002.niveau(), "B");
        assert_eq!(Conformite::PdfX4.niveau(), "B");
    }

    #[test]
    fn ce_que_chaque_conformite_autorise_est_ecrit() {
        /* C'est le contrôle qui empêche de revendiquer X-1a sur un fichier
        transparent : la règle est portée par le type, pas recopiée. */
        assert!(Conformite::PdfX1a2001.interdit_la_transparence());
        assert!(Conformite::PdfX3n2002.interdit_la_transparence());
        assert!(!Conformite::PdfX4.interdit_la_transparence());
        assert!(!Conformite::PdfX1a2001.accepte_le_rvb());
        assert!(Conformite::PdfX3n2002.accepte_le_rvb());
        assert!(Conformite::PdfX4.accepte_le_rvb());
    }

    #[test]
    fn l_echappement_xml_traite_les_cinq_caracteres() {
        assert_eq!(
            echapper_xml("a & b < c > d \" e ' f"),
            "a &amp; b &lt; c &gt; d &quot; e &apos; f"
        );
    }

    #[test]
    fn l_echappement_ne_double_echappe_pas() {
        assert_eq!(echapper_xml("&amp;"), "&amp;amp;");
        /* L'entrée brute « & » doit donner « &amp; », une seule fois. */
        assert_eq!(echapper_xml("&"), "&amp;");
    }

    #[test]
    fn l_echappement_retire_les_caracteres_de_controle() {
        assert_eq!(echapper_xml("a\u{0}b\u{7}c"), "abc");
        /* La tabulation et les fins de ligne sont permises en XML. */
        assert_eq!(echapper_xml("a\tb\nc\rd"), "a\tb\nc\rd");
    }

    #[test]
    fn le_paquet_est_encadre_par_les_marqueurs_xpacket() {
        let paquet = paquet(&info_complet(), Conformite::PdfX3n2002);
        assert!(paquet.starts_with("<?xpacket begin="));
        assert!(paquet.ends_with("<?xpacket end=\"w\"?>"));
        assert!(paquet.contains("id=\"W5M0MpCehiHzreSzNTczkc9d\""));
    }

    #[test]
    fn le_paquet_porte_la_revendication_pdfx() {
        for (conformite, partie, niveau) in [
            (Conformite::PdfX1a2001, "1", "A"),
            (Conformite::PdfX3n2002, "3", "B"),
            (Conformite::PdfX4, "4", "B"),
        ] {
            let p = paquet(&info_complet(), conformite);
            assert!(
                p.contains(&format!("<pdfaid:part>{partie}</pdfaid:part>")),
                "{conformite:?}"
            );
            assert!(
                p.contains(&format!(
                    "<pdfaid:conformance>{niveau}</pdfaid:conformance>"
                )),
                "{conformite:?}"
            );
            assert!(
                p.contains(&format!(
                    "<pdfx:GTS_PDFXVersion>{}</pdfx:GTS_PDFXVersion>",
                    conformite.nom()
                )),
                "{conformite:?}"
            );
        }
    }

    #[test]
    fn le_paquet_porte_les_metadonnees_du_document() {
        let p = paquet(&info_complet(), Conformite::PdfX3n2002);
        for attendu in [
            "Brochure été",
            "Atelier Dupont",
            "Fond perdu 3 mm",
            "brochure, offset",
            "SuperPrint",
            "SuperPrint 1.7",
            "2026-10-11T09:30:00Z",
        ] {
            assert!(p.contains(attendu), "{attendu:?} manque au paquet");
        }
    }

    #[test]
    fn un_titre_avec_un_esperluette_reste_valide() {
        let info = DocInfo {
            title: Some("Art & Design".to_string()),
            ..DocInfo::default()
        };
        let p = paquet(&info, Conformite::PdfX4);
        assert!(p.contains("Art &amp; Design"));
        assert!(
            !p.contains("Art & Design"),
            "l'esperluette brute rend le XML invalide"
        );
    }

    #[test]
    fn un_document_sans_metadonnees_produit_un_paquet_valide_quand_meme() {
        let p = paquet(&DocInfo::default(), Conformite::PdfX1a2001);
        assert!(p.starts_with("<?xpacket"));
        assert!(p.contains("<pdfaid:part>1</pdfaid:part>"));
        /* Aucune propriété vide : une propriété vide n'est pas une propriété. */
        assert!(!p.contains("<dc:title></dc:title>"));
        assert!(!p.contains("<xmp:CreateDate></xmp:CreateDate>"));
    }

    #[test]
    fn une_metadonnee_faite_d_espaces_est_traitee_comme_absente() {
        let info = DocInfo {
            title: Some("   ".to_string()),
            ..DocInfo::default()
        };
        let p = paquet(&info, Conformite::PdfX4);
        assert!(!p.contains("dc:title"));
    }

    #[test]
    fn le_paquet_a_le_rembourrage_de_la_specification() {
        /* ~2 ko de paquet : la place est prévue pour qu'un outil modifie les
        métadonnées sans réécrire le fichier entier. */
        let p = paquet(&DocInfo::default(), Conformite::PdfX4);
        assert!(p.len() >= 2048, "paquet de {} octets", p.len());
        assert!(p.len() < 4096);
    }

    #[test]
    fn les_entrees_info_portent_la_version_pdfx() {
        for conformite in [
            Conformite::PdfX1a2001,
            Conformite::PdfX3n2002,
            Conformite::PdfX4,
        ] {
            let entrees = entrees_info(conformite);
            assert_eq!(entrees.len(), 2);
            assert_eq!(entrees[0].0, "GTS_PDFXVersion");
            assert!(entrees[0].1.contains(conformite.nom()));
            assert_eq!(entrees[1].0, "GTS_PDFXConformance");
        }
    }

    #[test]
    fn le_paquet_est_deterministe() {
        let a = paquet(&info_complet(), Conformite::PdfX3n2002);
        let b = paquet(&info_complet(), Conformite::PdfX3n2002);
        assert_eq!(a, b);
    }

    #[test]
    fn tous_les_namespaces_declares_sont_utilises() {
        /* Un namespace déclaré et non employé, ou employé et non déclaré, rend
        le paquet invalide pour un validateur strict. */
        let p = paquet(&info_complet(), Conformite::PdfX3n2002);
        for (prefixe, usage) in [
            ("dc", "<dc:title>"),
            ("xmp", "<xmp:CreatorTool>"),
            ("pdf", "<pdf:Producer>"),
            ("pdfx", "<pdfx:GTS_PDFXVersion>"),
            ("pdfxid", "<pdfxid:GTS_PDFXVersion>"),
            ("pdfaid", "<pdfaid:part>"),
        ] {
            assert!(
                p.contains(&format!("xmlns:{prefixe}=")),
                "le namespace {prefixe} n'est pas déclaré"
            );
            assert!(
                p.contains(usage),
                "le prefixe {prefixe} est déclaré mais pas employé"
            );
        }
    }
}
