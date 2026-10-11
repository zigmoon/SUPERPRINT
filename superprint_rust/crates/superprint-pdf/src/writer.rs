//! Assemblage bas niveau d'un fichier PDF : objets numérotés, flux, table
//! `xref`, `trailer`.
//!
//! Ce module ne connaît **rien** de la mise en page ni des couleurs : il sait
//! seulement écrire des objets numérotés et produire un fichier valide. C'est
//! ce qui lui permet de servir aussi bien une page de démonstration qu'un
//! document de plusieurs centaines de pages.
//!
//! ## Références en avant
//!
//! Un PDF est un graphe d'objets qui se référencent mutuellement — et souvent
//! **avant** d'être écrits : le catalogue connaît la racine des pages, chaque
//! page connaît son parent, qui n'existe pas encore. Le [`Writer`] résout cela
//! par des **emplacements réservés** : on réserve un numéro, on écrit les objets
//! qui le référencent, puis on remplit l'emplacement. Aucun tri, aucune
//! deuxième passe sur la table.

/// Numéro du premier objet — l'entrée 0 de la table `xref` est la liste libre.
const FIRST_OBJECT: usize = 1;

/// Longueur d'une entrée de table `xref`, en octets.
///
/// Dix chiffres d'offset, cinq de génération, un marqueur, deux de fin de ligne.
/// La norme impose ces 20 octets : un écart ici produit un PDF illisible par
/// certains lecteurs, sans message d'erreur.
const XREF_ENTRY_LEN: usize = 20;

/// Assemble les objets d'un PDF, puis le fichier complet.
#[derive(Default)]
pub struct Writer {
    /// `slots[0]` est l'objet 1. `None` = emplacement réservé, pas encore rempli.
    slots: Vec<Option<Vec<u8>>>,
}

/// Erreur d'assemblage : un objet réservé n'a jamais été rempli.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UnfilledObject {
    /// Numéro de l'objet resté vide.
    pub number: usize,
}

impl std::fmt::Display for UnfilledObject {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "objet {} réservé mais jamais rempli : le fichier PDF serait corrompu",
            self.number
        )
    }
}

impl std::error::Error for UnfilledObject {}

impl Writer {
    /// Un assembleur vide.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Nombre d'objets déclarés, emplacements réservés compris.
    #[must_use]
    pub fn len(&self) -> usize {
        self.slots.len()
    }

    /// Vrai si aucun objet n'a été déclaré.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// Réserve un numéro d'objet **sans le remplir**.
    ///
    /// C'est ce qui permet d'écrire une référence avant de savoir ce que l'objet
    /// contiendra. Le numéro doit ensuite être rempli par [`Writer::put`], sinon
    /// [`Writer::finish`] refuse d'écrire le fichier.
    pub fn reserve(&mut self) -> usize {
        self.slots.push(None);
        self.slots.len()
    }

    /// Remplit un emplacement réservé.
    ///
    /// Le contenu est le **corps** de l'objet : ce qui se trouve entre
    /// `N 0 obj` et `endobj`. Les dictionnaires se terminent donc par un saut de
    /// ligne, comme le veut la lisibilité du format.
    pub fn put(&mut self, number: usize, body: impl Into<Vec<u8>>) {
        debug_assert!(
            number >= FIRST_OBJECT && number <= self.slots.len(),
            "numéro d'objet hors bornes : {number}"
        );
        self.slots[number - 1] = Some(body.into());
    }

    /// Ajoute un objet et renvoie son numéro.
    pub fn push_object(&mut self, body: impl Into<Vec<u8>>) -> usize {
        self.slots.push(Some(body.into()));
        self.slots.len()
    }

    /// Ajoute un **flux** et renvoie son numéro.
    ///
    /// La longueur annoncée dans `/Length` est calculée ici, à partir des octets
    /// réellement écrits : c'est la source d'erreur la plus fréquente des
    /// générateurs PDF, et elle n'est pas laissée à l'appelant.
    ///
    /// `entries` reçoit les entrées du dictionnaire **avant** `/Length` ; une
    /// chaîne vide donne un flux sans métadonnée autre que sa longueur.
    pub fn push_stream(&mut self, entries: &str, data: &[u8]) -> usize {
        self.slots.push(Some(stream_body(entries, data)));
        self.slots.len()
    }

    /// Corps d'un flux, exposé pour les appels qui réservent avant d'écrire.
    #[must_use]
    pub fn stream_body(entries: &str, data: &[u8]) -> Vec<u8> {
        stream_body(entries, data)
    }

    /// Écrit le fichier complet : en-tête, objets, table `xref`, `trailer`.
    ///
    /// `root` est le numéro du catalogue. `extra_trailer` reçoit des entrées
    /// supplémentaires, par exemple `/Info`.
    ///
    /// # Erreurs
    ///
    /// [`UnfilledObject`] si un emplacement réservé est resté vide. Mieux vaut
    /// refuser d'écrire que produire un PDF qu'un RIP rejettera sans expliquer
    /// pourquoi.
    pub fn finish(self, root: usize, extra_trailer: &str) -> Result<Vec<u8>, UnfilledObject> {
        if let Some(index) = self.slots.iter().position(Option::is_none) {
            return Err(UnfilledObject {
                number: index + FIRST_OBJECT,
            });
        }

        let mut out: Vec<u8> = Vec::new();
        // En-tête, puis un commentaire binaire : il signale aux outils que le
        // fichier contient des octets hors texte.
        out.extend_from_slice(b"%PDF-1.7\n%\xE2\xE3\xCF\xD3\n");

        // offsets[n] = décalage de l'objet n ; l'entrée 0 de xref est libre.
        let mut offsets: Vec<usize> = vec![0];
        for (index, body) in self.slots.iter().enumerate() {
            let number = index + FIRST_OBJECT;
            offsets.push(out.len());
            out.extend_from_slice(format!("{number} 0 obj\n").as_bytes());
            out.extend_from_slice(body.as_ref().expect("vérifié ci-dessus"));
            out.extend_from_slice(b"endobj\n");
        }

        let xref_offset = out.len();
        let count = offsets.len();
        out.extend_from_slice(format!("xref\n0 {count}\n").as_bytes());
        out.extend_from_slice(b"0000000000 65535 f\r\n");
        for offset in offsets.iter().skip(FIRST_OBJECT) {
            let entry = format!("{offset:010} 00000 n\r\n");
            debug_assert_eq!(
                entry.len(),
                XREF_ENTRY_LEN,
                "entrée xref de taille invalide"
            );
            out.extend_from_slice(entry.as_bytes());
        }

        let spacer = if extra_trailer.is_empty() { "" } else { " " };
        out.extend_from_slice(
            format!(
                "trailer\n<< /Size {count} /Root {root} 0 R{spacer}{extra_trailer} >>\n\
                 startxref\n{xref_offset}\n%%EOF\n"
            )
            .as_bytes(),
        );

        Ok(out)
    }
}

/// Corps d'un flux PDF, `stream`/`endstream` compris.
fn stream_body(entries: &str, data: &[u8]) -> Vec<u8> {
    let head = if entries.is_empty() {
        format!("<< /Length {} >>\n", data.len())
    } else {
        format!("<< {entries} /Length {} >>\n", data.len())
    };
    let mut body = head.into_bytes();
    body.extend_from_slice(b"stream\n");
    body.extend_from_slice(data);
    // Le saut de ligne avant `endstream` ne compte pas dans `/Length`, mais il
    // rend le fichier lisible et conforme à l'usage.
    body.extend_from_slice(b"\nendstream\n");
    body
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reference_en_avant() {
        // Le catalogue référence la racine des pages, réservée mais écrite après.
        let mut w = Writer::new();
        let catalog = w.reserve();
        let pages = w.push_object("<< /Type /Pages /Kids [] /Count 0 >>\n");
        w.put(
            catalog,
            format!("<< /Type /Catalog /Pages {pages} 0 R >>\n"),
        );

        let pdf = w.finish(catalog, "").expect("tous les objets sont remplis");
        let texte = String::from_utf8_lossy(&pdf);
        assert!(texte.starts_with("%PDF-1.7"));
        assert!(texte.contains(&format!("/Pages {pages} 0 R")));
        assert!(texte.trim_end().ends_with("%%EOF"));
    }

    #[test]
    fn emplacement_non_rempli_refuse() {
        let mut w = Writer::new();
        let catalog = w.reserve();
        w.push_object("<< /Type /Catalog >>\n");
        let erreur = w.finish(catalog, "").unwrap_err();
        assert_eq!(erreur.number, catalog);
        assert!(erreur.to_string().contains("jamais rempli"));
    }

    #[test]
    fn longueur_de_flux_calculee() {
        let mut w = Writer::new();
        let donnees = b"q 1 0 0 1 0 0 cm Q\n";
        let reference = w.push_stream("", donnees);
        let pdf = w.finish(reference, "").expect("objet rempli");
        let texte = String::from_utf8_lossy(&pdf);
        assert!(
            texte.contains(&format!("/Length {}", donnees.len())),
            "la longueur annoncée doit être celle des octets écrits"
        );
    }

    #[test]
    fn entrees_de_trailer_ajoutees() {
        let mut w = Writer::new();
        let catalog = w.push_object("<< /Type /Catalog >>\n");
        let info = w.push_object("<< /Title (Essai) >>\n");
        let pdf = w.finish(catalog, &format!("/Info {info} 0 R")).unwrap();
        let texte = String::from_utf8_lossy(&pdf);
        assert!(texte.contains(&format!("/Info {info} 0 R")));
        assert!(texte.contains("/Root 1 0 R"));
    }

    #[test]
    fn table_xref_coherente() {
        // Chaque entrée doit pointer sur `N 0 obj` à l'octet annoncé. Le test
        // travaille sur les OCTETS, jamais sur une chaîne : l'en-tête contient un
        // commentaire binaire que `from_utf8_lossy` remplacerait, ce qui
        // décalerait toutes les positions.
        let mut w = Writer::new();
        let catalog = w.push_object("<< /Type /Catalog >>\n");
        let pdf = w.finish(catalog, "").unwrap();

        let position = |motif: &[u8]| pdf.windows(motif.len()).position(|f| f == motif);
        let xref = position(b"xref\n0 ").expect("table xref présente");

        // On saute « xref\n », puis la ligne « 0 N ».
        let apres = xref + b"xref\n".len();
        let fin_ligne = apres + pdf[apres..].iter().position(|&b| b == b'\n').unwrap() + 1;

        // Entrée 0 = liste libre (20 octets), entrée 1 = premier objet.
        let premiere = fin_ligne + XREF_ENTRY_LEN;
        let offset: usize = std::str::from_utf8(&pdf[premiere..premiere + 10])
            .unwrap()
            .parse()
            .expect("offset lisible");
        assert!(
            pdf[offset..].starts_with(b"1 0 obj"),
            "l'entrée xref de l'objet 1 doit pointer sur son en-tête"
        );
    }
}
