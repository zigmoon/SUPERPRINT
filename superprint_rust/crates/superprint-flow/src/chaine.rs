//! La **chaîne** : les cadres, dans l'ordre, et ce qui les unit.
//!
//! Un cadre est une boîte de composition : une largeur utile, une hauteur utile.
//! Une chaîne est une **liste ordonnée** de cadres — l'ordre est la définition du
//! chaînage, et c'est pourquoi la structure le porte, plutôt que de le laisser à
//! un graphe de liens que l'appelant devrait parcourir.
//!
//! ## Ce que « utile » veut dire, et pourquoi c'est calculé ici
//!
//! La largeur utile n'est pas la largeur du cadre : il faut retirer les marges
//! intérieures **et** les colonnes. Une disposition en deux colonnes fait deux
//! **chaînes** distinctes, et c'est à l'appelant de les découper ainsi — mais
//! [`Cadre::colonnes`] refuse une valeur nulle, parce qu'une division par zéro
//! silencieuse dans un calcul de mise en page est un défaut qui ne se voit
//! qu'à l'impression.
//!
//! Feuille de route : `docs/PORTAGE.md` (domaine « pagination et chaînage »).

/// Un cadre de composition.
#[derive(Clone, Debug, PartialEq)]
pub struct Cadre {
    /// Largeur intérieure du cadre, dans l'unité de l'appelant.
    pub largeur: f64,
    /// Hauteur intérieure du cadre.
    pub hauteur: f64,
    /// Marge intérieure à gauche.
    pub marge_gauche: f64,
    /// Marge intérieure à droite.
    pub marge_droite: f64,
    /// Marge intérieure en haut.
    pub marge_haut: f64,
    /// Marge intérieure en bas.
    pub marge_bas: f64,
    /// Nombre de colonnes dans le cadre.
    pub colonnes: usize,
    /// Écart entre les colonnes.
    pub gouttiere: f64,
    /// Identifiant, pour que l'appelant retrouve ses blocs.
    pub id: usize,
}

impl Cadre {
    /// Un cadre sans marge, une colonne.
    ///
    /// `colonnes` est ramené à **1** s'il vaut zéro : un cadre sans colonne n'a
    /// pas de largeur utile, et le dire vaut mieux que de diviser par zéro.
    #[must_use]
    pub fn nouveau(id: usize, largeur: f64, hauteur: f64) -> Self {
        Self {
            largeur,
            hauteur,
            marge_gauche: 0.0,
            marge_droite: 0.0,
            marge_haut: 0.0,
            marge_bas: 0.0,
            colonnes: 1,
            gouttiere: 0.0,
            id,
        }
    }

    /// Fixe les marges intérieures.
    #[must_use]
    pub fn marges(mut self, gauche: f64, haut: f64, droite: f64, bas: f64) -> Self {
        self.marge_gauche = gauche;
        self.marge_haut = haut;
        self.marge_droite = droite;
        self.marge_bas = bas;
        self
    }

    /// Fixe les colonnes et leur gouttière.
    #[must_use]
    pub fn colonnes(mut self, nombre: usize, gouttiere: f64) -> Self {
        self.colonnes = nombre.max(1);
        self.gouttiere = gouttiere;
        self
    }

    /// La largeur utile **totale** du cadre, marges retirées.
    #[must_use]
    pub fn largeur_utile(&self) -> f64 {
        (self.largeur - self.marge_gauche - self.marge_droite).max(0.0)
    }

    /// La largeur utile **d'une colonne**, gouttières retirées.
    ///
    /// C'est la largeur à donner au compositionneur.
    #[must_use]
    pub fn largeur_colonne(&self) -> f64 {
        let colonnes = self.colonnes.max(1) as f64;
        let gouttieres = self.gouttiere * (colonnes - 1.0);
        ((self.largeur_utile() - gouttieres) / colonnes).max(0.0)
    }

    /// La hauteur utile du cadre, marges retirées.
    #[must_use]
    pub fn hauteur_utile(&self) -> f64 {
        (self.hauteur - self.marge_haut - self.marge_bas).max(0.0)
    }

    /// Vrai si le cadre ne peut rien contenir.
    #[must_use]
    pub fn est_inexploitable(&self) -> bool {
        self.largeur_colonne() <= 0.0 || self.hauteur_utile() <= 0.0
    }
}

/// Une chaîne de cadres, dans l'ordre de lecture.
#[derive(Clone, Debug, PartialEq, Default)]
pub struct Chaine {
    /// Les cadres, dans l'ordre du flux.
    pub cadres: Vec<Cadre>,
}

impl Chaine {
    /// Une chaîne vide.
    #[must_use]
    pub fn nouveau() -> Self {
        Self::default()
    }

    /// Ajoute un cadre à la fin.
    pub fn ajouter(&mut self, cadre: Cadre) {
        self.cadres.push(cadre);
    }

    /// Le nombre de cadres.
    #[must_use]
    pub fn nombre_de_cadres(&self) -> usize {
        self.cadres.len()
    }

    /// Vrai si aucun cadre ne peut rien contenir.
    #[must_use]
    pub fn est_inexploitable(&self) -> bool {
        self.cadres.is_empty() || self.cadres.iter().all(Cadre::est_inexploitable)
    }

    /// La capacité d'une chaîne, **en lignes** d'une hauteur donnée.
    ///
    /// Sert à l'appelant qui veut savoir, avant de composer, si le texte a la
    /// moindre chance de tenir : une information utile pour prévenir plutôt que
    /// de produire un document tronqué.
    #[must_use]
    pub fn lignes_maximum(&self, hauteur_ligne: f64) -> usize {
        if hauteur_ligne <= 0.0 {
            return 0;
        }
        self.cadres
            .iter()
            .map(|c| (c.hauteur_utile() / hauteur_ligne).floor().max(0.0) as usize)
            .sum()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn proche(a: f64, b: f64) {
        assert!((a - b).abs() < 1e-9, "attendu {b}, obtenu {a}");
    }

    #[test]
    fn un_cadre_sans_marge_a_la_largeur_de_son_cadre() {
        let c = Cadre::nouveau(0, 100.0, 200.0);
        proche(c.largeur_utile(), 100.0);
        proche(c.largeur_colonne(), 100.0);
        proche(c.hauteur_utile(), 200.0);
    }

    #[test]
    fn les_marges_sont_retirees_des_deux_cotes() {
        let c = Cadre::nouveau(0, 100.0, 200.0).marges(10.0, 5.0, 10.0, 5.0);
        proche(c.largeur_utile(), 80.0);
        proche(c.hauteur_utile(), 190.0);
    }

    #[test]
    fn les_colonnes_partagent_la_largeur_utile_moins_les_gouttieres() {
        let c = Cadre::nouveau(0, 100.0, 200.0).colonnes(2, 8.0);
        proche(c.largeur_utile(), 100.0);
        proche(c.largeur_colonne(), 46.0);
    }

    #[test]
    fn trois_colonnes_comptent_deux_gouttieres() {
        let c = Cadre::nouveau(0, 120.0, 200.0).colonnes(3, 10.0);
        proche(c.largeur_colonne(), (120.0 - 20.0) / 3.0);
    }

    #[test]
    fn des_marges_plus_grandes_que_le_cadre_ne_donnent_pas_de_largeur_negative() {
        /* Un cadre mal réglé est un cadre qui ne compose rien. Une largeur
        négative, elle, se propagerait dans tout le calcul sans rien dire. */
        let c = Cadre::nouveau(0, 50.0, 50.0).marges(40.0, 40.0, 40.0, 40.0);
        proche(c.largeur_utile(), 0.0);
        proche(c.hauteur_utile(), 0.0);
        assert!(c.est_inexploitable());
    }

    #[test]
    fn zero_colonne_est_ramene_a_une() {
        let c = Cadre::nouveau(0, 100.0, 200.0).colonnes(0, 10.0);
        assert_eq!(c.colonnes, 1);
        proche(c.largeur_colonne(), 100.0);
    }

    #[test]
    fn un_cadre_sans_hauteur_est_inexploitable() {
        assert!(Cadre::nouveau(0, 100.0, 0.0).est_inexploitable());
        assert!(Cadre::nouveau(0, 0.0, 100.0).est_inexploitable());
        assert!(!Cadre::nouveau(0, 100.0, 100.0).est_inexploitable());
    }

    #[test]
    fn une_chaine_d_ordre_est_conservee() {
        let mut chaine = Chaine::nouveau();
        for id in [7, 3, 9] {
            chaine.ajouter(Cadre::nouveau(id, 100.0, 100.0));
        }
        assert_eq!(
            chaine.cadres.iter().map(|c| c.id).collect::<Vec<_>>(),
            vec![7, 3, 9]
        );
    }

    #[test]
    fn la_capacite_se_compte_en_lignes() {
        let mut chaine = Chaine::nouveau();
        chaine.ajouter(Cadre::nouveau(0, 100.0, 100.0));
        chaine.ajouter(Cadre::nouveau(1, 100.0, 55.0));
        /* 10 lignes puis 5 lignes et demie (donc 5). */
        assert_eq!(chaine.lignes_maximum(10.0), 15);
        assert_eq!(chaine.lignes_maximum(0.0), 0);
    }

    #[test]
    fn une_chaine_vide_ou_inexploitable_est_dite_telle() {
        assert!(Chaine::nouveau().est_inexploitable());
        let mut chaine = Chaine::nouveau();
        chaine.ajouter(Cadre::nouveau(0, 0.0, 0.0));
        assert!(chaine.est_inexploitable());
    }
}
