//! Le **flux** : un texte découpé en paragraphes, avec ce qu'il faut pour le
//! composer.
//!
//! Un flux n'est pas une chaîne de caractères : c'est une **liste de
//! paragraphes**. La distinction compte, parce que le produit en a besoin pour
//! deux choses :
//!
//! - la **césure** ne traverse pas une fin de paragraphe ;
//! - un paragraphe peut porter une **césure interdite** (un titre, un code) et
//!   une **indentation négative** (un alinéa, une puce).
//!
//! ## De quoi un paragraphe a besoin, et rien de plus
//!
//! Trois réglages, les seuls qui changent quelque chose au **nombre de lignes** :
//! l'indentation de première ligne, l'indentation des suivantes, et la césure.
//! Tout le reste — corps, graisse, couleur, interlettrage — passe par la
//! **mesure**, qui est fournie par l'appelant : deux paragraphes de styles
//! différents sont donc mesurés différemment sans que ce modèle ait à le savoir.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « pagination et chaînage »).

/// Un paragraphe de texte, avec ses réglages de composition.
#[derive(Clone, Debug, PartialEq)]
pub struct Paragraphe {
    /// Le texte, sans fin de paragraphe.
    pub texte: String,
    /// Indentation de la **première** ligne, dans l'unité de l'appelant.
    pub retrait_premiere: f64,
    /// Indentation des lignes **suivantes**. Négative pour un alinéa suspendu.
    pub retrait_suivantes: f64,
    /// Faut-il autoriser la césure dans ce paragraphe ?
    pub cesure: bool,
    /// Espace ajouté **après** le paragraphe, dans l'unité de l'appelant.
    pub espace_apres: f64,
}

impl Paragraphe {
    /// Un paragraphe de texte nu.
    #[must_use]
    pub fn nouveau(texte: impl Into<String>) -> Self {
        Self {
            texte: texte.into(),
            retrait_premiere: 0.0,
            retrait_suivantes: 0.0,
            cesure: true,
            espace_apres: 0.0,
        }
    }

    /// Un paragraphe sans césure : un titre, un code, une référence.
    #[must_use]
    pub fn sans_cesure(texte: impl Into<String>) -> Self {
        Self {
            cesure: false,
            ..Self::nouveau(texte)
        }
    }

    /// Fixe les deux indentations.
    #[must_use]
    pub fn retraits(mut self, premiere: f64, suivantes: f64) -> Self {
        self.retrait_premiere = premiere;
        self.retrait_suivantes = suivantes;
        self
    }

    /// Fixe l'espace après le paragraphe.
    #[must_use]
    pub fn espace_apres(mut self, espace: f64) -> Self {
        self.espace_apres = espace;
        self
    }

    /// Vrai si le paragraphe est vide ou fait d'espaces.
    ///
    /// Un paragraphe vide compte comme **une ligne** de hauteur nulle : c'est un
    /// blanc voulu par l'auteur, et le supprimer changerait la pagination.
    #[must_use]
    pub fn est_vide(&self) -> bool {
        self.texte.trim().is_empty()
    }

    /// L'indentation de la ligne de rang `rang` (0 = première).
    #[must_use]
    pub fn retrait(&self, rang: usize) -> f64 {
        if rang == 0 {
            self.retrait_premiere
        } else {
            self.retrait_suivantes
        }
    }
}

/// Un flux de texte : les paragraphes, dans l'ordre.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Flux {
    /// Les paragraphes.
    pub paragraphes: Vec<Paragraphe>,
}

impl Flux {
    /// Un flux vide.
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// Construit un flux en découpant un texte sur ses fins de ligne.
    ///
    /// Un `\r\n` (Windows) et un `\r` seul (Mac classique) comptent tous deux
    /// comme une fin de paragraphe : un texte venu d'ailleurs ne doit pas
    /// produire un paragraphe boursouflé de retours chariot invisibles.
    #[must_use]
    pub fn depuis_texte(texte: &str) -> Self {
        let normalise = texte.replace("\r\n", "\n").replace('\r', "\n");
        Self {
            paragraphes: normalise.split('\n').map(Paragraphe::nouveau).collect(),
        }
    }

    /// Ajoute un paragraphe.
    pub fn ajouter(&mut self, paragraphe: Paragraphe) {
        self.paragraphes.push(paragraphe);
    }

    /// Le nombre de paragraphes.
    #[must_use]
    pub fn nombre_de_paragraphes(&self) -> usize {
        self.paragraphes.len()
    }

    /// Le texte complet, paragraphes joints par des fins de ligne.
    ///
    /// Sert à la vérification : c'est la forme sous laquelle on contrôle
    /// qu'aucun caractère n'a été perdu.
    #[must_use]
    pub fn texte(&self) -> String {
        self.paragraphes
            .iter()
            .map(|p| p.texte.as_str())
            .collect::<Vec<_>>()
            .join("\n")
    }

    /// Le nombre de caractères, fins de paragraphe comprises.
    #[must_use]
    pub fn longueur(&self) -> usize {
        if self.paragraphes.is_empty() {
            return 0;
        }
        self.paragraphes
            .iter()
            .map(|p| p.texte.chars().count())
            .sum::<usize>()
            + self.paragraphes.len()
            - 1
    }

    /// Vrai si le flux n'a rien à composer.
    #[must_use]
    pub fn est_vide(&self) -> bool {
        self.paragraphes.iter().all(Paragraphe::est_vide)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn un_texte_se_decoupe_sur_ses_fins_de_ligne() {
        let flux = Flux::depuis_texte("Premier\nDeuxième\nTroisième");
        assert_eq!(flux.nombre_de_paragraphes(), 3);
        assert_eq!(flux.paragraphes[0].texte, "Premier");
        assert_eq!(flux.paragraphes[2].texte, "Troisième");
    }

    #[test]
    fn les_fins_de_ligne_windows_et_mac_sont_normalisees() {
        let attendu = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        for texte in ["a\r\nb\r\nc", "a\rb\rc", "a\nb\nc", "a\r\nb\rc"] {
            let flux = Flux::depuis_texte(texte);
            let obtenu: Vec<String> = flux.paragraphes.iter().map(|p| p.texte.clone()).collect();
            assert_eq!(obtenu, attendu, "{texte:?}");
        }
    }

    #[test]
    fn un_texte_vide_donne_un_paragraphe_vide() {
        let flux = Flux::depuis_texte("");
        assert_eq!(flux.nombre_de_paragraphes(), 1);
        assert!(flux.paragraphes[0].est_vide());
    }

    #[test]
    fn un_paragraphe_vide_compte_comme_une_ligne() {
        /* Un blanc est un blanc VOULU : il doit occuper de la place, sinon la
        pagination change toute seule. */
        let flux = Flux::depuis_texte("A\n\nB");
        assert_eq!(flux.nombre_de_paragraphes(), 3);
        assert!(flux.paragraphes[1].est_vide());
    }

    #[test]
    fn l_aller_retour_par_texte_est_fidele() {
        for texte in [
            "Un seul paragraphe",
            "A\nB\nC",
            "A\n\nB",
            "",
            "  espaces  ",
            "accents éàü et signes — « »",
        ] {
            let flux = Flux::depuis_texte(texte);
            let normalise = texte.replace("\r\n", "\n").replace('\r', "\n");
            assert_eq!(flux.texte(), normalise, "{texte:?}");
        }
    }

    #[test]
    fn la_longueur_compte_les_fins_de_paragraphe() {
        assert_eq!(Flux::depuis_texte("abc").longueur(), 3);
        assert_eq!(Flux::depuis_texte("abc\ndef").longueur(), 7);
        assert_eq!(Flux::depuis_texte("a\n\nb").longueur(), 4);
        assert_eq!(Flux::nouveau().longueur(), 0);
    }

    #[test]
    fn la_longueur_compte_les_caracteres_et_pas_les_octets() {
        /* Un accent fait deux octets en UTF-8 et un seul caractère : compter les
        octets serait une source d'erreur silencieuse dans toute la suite. */
        assert_eq!(Flux::depuis_texte("éé").longueur(), 2);
        assert_eq!(Flux::depuis_texte("😀").longueur(), 1);
    }

    #[test]
    fn un_paragraphe_connait_l_indentation_de_chaque_ligne() {
        let p = Paragraphe::nouveau("x").retraits(10.0, 4.0);
        assert_eq!(p.retrait(0), 10.0);
        assert_eq!(p.retrait(1), 4.0);
        assert_eq!(p.retrait(50), 4.0);
    }

    #[test]
    fn un_paragraphe_sans_cesure_n_en_a_pas() {
        assert!(Paragraphe::nouveau("x").cesure);
        assert!(!Paragraphe::sans_cesure("x").cesure);
    }

    #[test]
    fn l_espace_apres_est_un_reglage() {
        let p = Paragraphe::nouveau("x").espace_apres(6.0);
        assert_eq!(p.espace_apres, 6.0);
        assert_eq!(Paragraphe::nouveau("x").espace_apres, 0.0);
    }

    #[test]
    fn un_flux_de_blancs_est_vide() {
        assert!(Flux::depuis_texte("   \n\t\n").est_vide());
        assert!(!Flux::depuis_texte("a").est_vide());
    }
}
