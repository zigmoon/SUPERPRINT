//! **Ordre des pages** d'une imposition en livret — l'algorithme du produit.
//!
//! Une feuille pliée porte **quatre** pages : deux au recto, deux au verso. Pour
//! qu'un livret se lise dans l'ordre une fois les feuilles emboîtées, il faut
//! imprimer les pages **extérieures d'abord** et converger vers le centre :
//! pour 20 pages, `20, 1, 2, 19, 18, 3, 4, 17, …`.
//!
//! ## D'où vient cette suite
//!
//! C'est le portage fidèle de `calculateImposition` (`app/JS/main.js`, à partir
//! de la ligne 31629). Aucune interprétation : les pages qui n'existent pas
//! deviennent [`Emplacement::Vide`], exactement comme le produit écrit `'Vide'`.
//! Le contrôle `scripts/validate-imposition.mjs` extrait la fonction
//! **du fichier réel** et compare les deux suites terme à terme.

/// Ce qui occupe une place sur une planche.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Emplacement {
    /// Une page du document, numérotée **à partir de 1** (comme dans l'interface).
    Page(u32),
    /// Une place vide : le dos blanc qui complète la dernière feuille.
    Vide,
}

impl Emplacement {
    /// Le numéro de page, ou `None` pour une place vide.
    #[must_use]
    pub fn numero(&self) -> Option<u32> {
        match self {
            Self::Page(n) => Some(*n),
            Self::Vide => None,
        }
    }

    /// Vrai si la place porte une page.
    #[must_use]
    pub fn est_page(&self) -> bool {
        matches!(self, Self::Page(_))
    }
}

impl core::fmt::Display for Emplacement {
    /// Le texte que l'interface affiche : le numéro, ou « Vide ».
    fn fmt(&self, formateur: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            Self::Page(n) => write!(formateur, "{n}"),
            Self::Vide => write!(formateur, "Vide"),
        }
    }
}

/// Nombre de pages d'une feuille pliée : deux au recto, deux au verso.
pub const PAGES_PAR_FEUILLE: u32 = 4;

/// L'ordre d'impression pour `nb_pages` pages.
///
/// Le nombre de pages est arrondi au multiple de 4 supérieur : une feuille
/// pliée ne se remplit pas partiellement, les places en trop sont
/// [`Emplacement::Vide`].
///
/// # Exemple
///
/// ```
/// use superprint_impose::{ordre, Emplacement};
/// // 8 pages tiennent sur deux feuilles.
/// assert_eq!(
///     ordre(8),
///     vec![
///         Emplacement::Page(8), Emplacement::Page(1),
///         Emplacement::Page(2), Emplacement::Page(7),
///         Emplacement::Page(6), Emplacement::Page(3),
///         Emplacement::Page(4), Emplacement::Page(5),
///     ],
/// );
/// ```
#[must_use]
pub fn ordre(nb_pages: u32) -> Vec<Emplacement> {
    if nb_pages == 0 {
        return Vec::new();
    }
    // `div_ceil` plutôt que `(n + 3) / 4` : pas de débordement sur `u32`.
    let ajustees = nb_pages.div_ceil(PAGES_PAR_FEUILLE) * PAGES_PAR_FEUILLE;
    let feuilles = ajustees / PAGES_PAR_FEUILLE;

    let mut sortie = Vec::with_capacity(ajustees as usize);
    let mut avant: u32 = 1;
    let mut arriere: u32 = ajustees;
    for _ in 0..feuilles {
        // RECTO — côté extérieur de la feuille.
        sortie.push(place(arriere, nb_pages));
        sortie.push(place(avant, nb_pages));
        arriere -= 1;
        avant += 1;
        // VERSO — côté intérieur.
        sortie.push(place(avant, nb_pages));
        sortie.push(place(arriere, nb_pages));
        avant += 1;
        arriere -= 1;
    }
    sortie
}

/// Une page du document, ou une place vide si elle n'existe pas.
fn place(numero: u32, nb_pages: u32) -> Emplacement {
    if numero <= nb_pages {
        Emplacement::Page(numero)
    } else {
        Emplacement::Vide
    }
}

/// L'ordre découpé en **planches de deux places** — recto et verso alternés.
///
/// C'est la forme dont l'exporteur a besoin : il dessine une planche à la fois.
/// Une liste d'ordre vide donne une liste de planches vide ; une liste de
/// longueur **impaire** est refusée, car un recto sans verso signifie que la
/// découpe en paires n'a pas de sens.
#[must_use]
pub fn planches(emplacements: &[Emplacement]) -> Option<Vec<[Emplacement; 2]>> {
    if emplacements.len() % 2 != 0 {
        return None;
    }
    Some(
        emplacements
            .chunks_exact(2)
            .map(|paire| [paire[0], paire[1]])
            .collect(),
    )
}

/// L'ordre des pages, directement en planches.
///
/// Raccourci de [`ordre`] puis [`planches`] — toujours `Some`, puisque [`ordre`]
/// rend un multiple de 4.
#[must_use]
pub fn planches_pour(nb_pages: u32) -> Vec<[Emplacement; 2]> {
    planches(&ordre(nb_pages)).unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn numeros(emplacements: &[Emplacement]) -> Vec<String> {
        emplacements.iter().map(ToString::to_string).collect()
    }

    #[test]
    fn aucun_page_aucune_place() {
        assert!(ordre(0).is_empty());
        assert!(planches_pour(0).is_empty());
    }

    /// Le cas cité en commentaire dans le produit : 20 pages.
    #[test]
    fn vingt_pages_donnent_la_suite_du_produit() {
        assert_eq!(
            numeros(&ordre(20)),
            [
                "20", "1", "2", "19", "18", "3", "4", "17", "16", "5", "6", "15", "14", "7", "8",
                "13", "12", "9", "10", "11"
            ]
        );
    }

    /// Une seule page : la feuille se complète par des places vides, et la page
    /// 1 se retrouve au recto, à droite — sa place réelle dans un livret.
    ///
    /// Les places du verso sont vides **elles aussi** : elles demandent les pages
    /// 2 et 3, qui n'existent pas. C'est le comportement du produit, et il est
    /// correct — un livret d'une page n'imprime rien au dos.
    #[test]
    fn une_page_complete_la_feuille_par_des_vides() {
        assert_eq!(numeros(&ordre(1)), ["Vide", "1", "Vide", "Vide"]);
        assert_eq!(ordre(1).iter().filter(|e| e.est_page()).count(), 1);
    }

    /// Six pages : deux feuilles, six places vides au total.
    #[test]
    fn six_pages_donnent_deux_feuilles() {
        let suite = ordre(6);
        assert_eq!(suite.len(), 8, "arrondi au multiple de 4");
        assert_eq!(
            numeros(&suite),
            ["Vide", "1", "2", "Vide", "6", "3", "4", "5"]
        );
        assert_eq!(suite.iter().filter(|e| e.est_page()).count(), 6);
    }

    /// Chaque page du document apparaît **exactement une fois** : c'est la seule
    /// propriété dont l'absence rendrait un livret inutilisable, et elle doit
    /// tenir pour toutes les tailles.
    #[test]
    fn chaque_page_apparait_une_fois_pour_toutes_les_tailles() {
        for nb_pages in 1..=200u32 {
            let suite = ordre(nb_pages);
            assert_eq!(
                suite.len() % 4,
                0,
                "{nb_pages} pages : multiple de 4 attendu"
            );
            let mut vues: Vec<u32> = suite.iter().filter_map(Emplacement::numero).collect();
            vues.sort_unstable();
            assert_eq!(
                vues,
                (1..=nb_pages).collect::<Vec<u32>>(),
                "{nb_pages} pages : chaque page doit apparaitre une fois"
            );
        }
    }

    /// Le recto porte toujours la page la plus haute à gauche : c'est la règle
    /// qui met la couverture au bon endroit après pliage.
    #[test]
    fn la_couverture_est_a_droite_du_recto_de_la_premiere_feuille() {
        let suite = ordre(20);
        assert_eq!(
            suite[0],
            Emplacement::Page(20),
            "verso de couverture, a gauche"
        );
        assert_eq!(suite[1], Emplacement::Page(1), "couverture, a droite");
    }

    #[test]
    fn les_planches_apparient_recto_et_verso() {
        let feuilles = planches_pour(4);
        assert_eq!(feuilles.len(), 2, "4 pages = 1 feuille = recto + verso");
        assert_eq!(
            feuilles[0],
            [Emplacement::Page(4), Emplacement::Page(1)],
            "recto"
        );
        assert_eq!(
            feuilles[1],
            [Emplacement::Page(2), Emplacement::Page(3)],
            "verso"
        );
    }

    /// Une liste de longueur impaire ne se découpe pas en planches : on refuse
    /// plutôt que de jeter la dernière place en silence.
    #[test]
    fn une_liste_impaire_ne_se_decoupe_pas() {
        assert!(planches(&[Emplacement::Page(1)]).is_none());
        assert!(planches(&[]).is_some_and(|p| p.is_empty()));
    }

    /// Le texte affiché est celui de l'interface — c'est lui qui est comparé au
    /// contrôle de parité, il ne doit pas dériver.
    #[test]
    fn le_texte_d_une_place_vide_est_vide() {
        assert_eq!(Emplacement::Vide.to_string(), "Vide");
        assert_eq!(Emplacement::Page(7).to_string(), "7");
        assert_eq!(Emplacement::Vide.numero(), None);
    }
}
