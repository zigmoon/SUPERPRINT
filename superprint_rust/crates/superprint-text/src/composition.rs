//! Composition : découper un paragraphe en **lignes**.
//!
//! ## Ce que ce module fait, et ce qu'il ne fait pas
//!
//! Il découpe un texte en lignes pour une largeur donnée. Il ne **mesure pas**
//! le texte : la mesure dépend de la police, du corps, des approches — donc de
//! l'appelant. Celui-ci fournit une fonction `&dyn Fn(&str) -> f64`, et le
//! compositeur raisonne là-dessus. C'est ce découplage qui rend la composition
//! portable : le noyau Rust peut composer sans rien savoir d'un canevas.
//!
//! ## La règle appliquée
//!
//! **Glouton** : on remplit la ligne tant que ça tient, et on coupe au premier
//! mot qui déborde. C'est ce que fait l'application (`main.js`, `_wrapLine`), et
//! c'est aussi ce qu'on veut pour un texte de PAO : un Texte justifié par
//! optimisation globale (Knuth-Plass) donnerait un résultat *différent* de celui
//! que l'utilisateur voit à l'écran — et changer l'aspect d'une mise en page
//! existante n'est pas un progrès.
//!
//! ## Le tiret de fin de ligne
//!
//! Quand un mot est coupé, la ligne doit porter un trait d'union — **sauf** si
//! le fragment se termine déjà par un tiret, auquel cas la coupe tombe sur un
//! tiret du mot composé (« États- ») et en ajouter un second écrirait
//! « États-- ». C'est exactement la règle `sublineHyphenFlags` de
//! `main.js` (lignes 11506-11859), et [`Ligne::tiret`] la transporte.

use crate::Cesure;

/// Une ligne composée.
#[derive(Clone, Debug, PartialEq)]
pub struct Ligne {
    /// Le texte de la ligne, **sans** le tiret éventuel.
    pub texte: String,
    /// Faut-il ajouter un trait d'union à la fin ?
    ///
    /// `false` quand la ligne se termine déjà par un tiret : celui du mot
    /// composé suffit, en ajouter un second serait une faute.
    pub tiret: bool,
    /// La largeur mesurée de `texte`.
    pub largeur: f64,
}

/// Un composeur, qui connaît la largeur des mots et les règles de césure.
pub struct Compositeur<'a> {
    /// Mesure d'un texte, dans l'unité de l'appelant (points, millimètres…).
    mesure: &'a dyn Fn(&str) -> f64,
    /// Le moteur de césure, si l'on veut couper les mots.
    cesure: Option<&'a Cesure>,
    /// En dessous de cette longueur, un mot ne sera pas coupé.
    minimum_coupable: usize,
}

impl<'a> Compositeur<'a> {
    /// Un composeur qui mesure avec `mesure` et ne coupe jamais les mots.
    pub fn new(mesure: &'a dyn Fn(&str) -> f64) -> Self {
        Self {
            mesure,
            cesure: None,
            minimum_coupable: 5,
        }
    }

    /// Active la césure des mots trop longs pour tenir sur une ligne.
    #[must_use]
    pub fn avec_cesure(mut self, cesure: &'a Cesure) -> Self {
        self.cesure = Some(cesure);
        self
    }

    /// Change la longueur minimale d'un mot coupable.
    #[must_use]
    pub fn minimum_coupable(mut self, minimum: usize) -> Self {
        self.minimum_coupable = minimum;
        self
    }

    fn largeur(&self, texte: &str) -> f64 {
        (self.mesure)(texte)
    }

    /// Compose `texte` dans `largeur`.
    ///
    /// Un `\n` passe au paragraphe suivant : les paragraphes ne se mélangent
    /// jamais. Une ligne toujours plus large que la colonne est rendue telle
    /// quelle plutôt que découpée au caractère — un mot qui déborde se voit, et
    /// c'est à l'utilisateur d'agrandir le bloc ou de réduire le corps.
    #[must_use]
    pub fn composer(&self, texte: &str, largeur: f64) -> Vec<Ligne> {
        self.composer_avec_largeurs(texte, &|_| largeur)
    }

    /// Compose `texte` avec une largeur qui peut **dépendre du rang de ligne**.
    ///
    /// Sert aux alinéas : la première ligne d'un paragraphe qui rentre de 10 mm
    /// n'a pas la même largeur que les suivantes. C'est la même règle gloutonne
    /// que [`Compositeur::composer`] — une seule règle, écrite une fois, avec la
    /// largeur tirée du rang courant. Composer le paragraphe à la largeur la plus
    /// étroite serait exact mais gâcherait la place des autres lignes ; le
    /// composer deux fois pour recoller le résultat donnerait un autre découpage.
    #[must_use]
    pub fn composer_avec_largeurs(
        &self,
        texte: &str,
        largeur_de_ligne: &dyn Fn(usize) -> f64,
    ) -> Vec<Ligne> {
        let mut lignes = Vec::new();
        for paragraphe in texte.split('\n') {
            let depart = lignes.len();
            self.composer_paragraphe(paragraphe, depart, largeur_de_ligne, &mut lignes);
        }
        lignes
    }

    fn composer_paragraphe(
        &self,
        paragraphe: &str,
        depart: usize,
        largeur_de_ligne: &dyn Fn(usize) -> f64,
        lignes: &mut Vec<Ligne>,
    ) {
        let mots: Vec<&str> = paragraphe.split_whitespace().collect();
        if mots.is_empty() {
            return;
        }
        let largeur_espace = self.largeur(" ");

        // File d'attente des mots à placer. Un mot coupé est remplacé par son
        // reste : c'est ce qui permet d'enchaîner sans récursion.
        let mut a_placer: std::collections::VecDeque<String> =
            mots.iter().map(|m| (*m).to_string()).collect();

        loop {
            let mut ligne = String::new();
            let mut tiret = false;
            /* La largeur se relit à chaque ligne : c'est le seul changement par
            rapport à la composition d'une seule largeur. */
            let largeur = largeur_de_ligne(lignes.len() - depart);

            while let Some(mot) = a_placer.pop_front() {
                let candidat = if ligne.is_empty() {
                    mot.clone()
                } else {
                    format!("{ligne} {mot}")
                };
                if self.largeur(&candidat) <= largeur || largeur <= 0.0 {
                    ligne = candidat;
                    continue;
                }

                // Le mot ne tient pas dans ce qui reste. Peut-on le couper ?
                if let Some((fragment, reste)) =
                    self.couper_pour_tenir(&mot, &ligne, largeur, largeur_espace)
                {
                    let avec_tiret = !se_termine_par_un_tiret(&fragment);
                    ligne = if ligne.is_empty() {
                        fragment
                    } else {
                        format!("{ligne} {fragment}")
                    };
                    tiret = avec_tiret;
                    a_placer.push_front(reste);
                    break;
                }

                // Rien à faire : le mot part à la ligne suivante, entier.
                a_placer.push_front(mot);
                break;
            }

            if ligne.is_empty() {
                // Cas de sûreté : un mot plus large que la colonne, non
                // coupable. On le pose tel quel pour ne jamais boucler.
                let Some(mot) = a_placer.pop_front() else {
                    return;
                };
                let largeur_mot = self.largeur(&mot);
                lignes.push(Ligne {
                    texte: mot,
                    tiret: false,
                    largeur: largeur_mot,
                });
                if a_placer.is_empty() {
                    return;
                }
                continue;
            }

            let largeur_ligne = self.largeur(&ligne);
            lignes.push(Ligne {
                texte: ligne,
                tiret,
                largeur: largeur_ligne,
            });
            if a_placer.is_empty() {
                return;
            }
        }
    }

    /// Cherche un fragment du mot qui tienne, tiret compris.
    ///
    /// Renvoie le fragment et le reste du mot. `None` si aucun fragment ne
    /// tient, ou si le mot n'est pas coupable.
    fn couper_pour_tenir(
        &self,
        mot: &str,
        ligne: &str,
        largeur: f64,
        largeur_espace: f64,
    ) -> Option<(String, String)> {
        let cesure = self.cesure?;
        if mot.chars().count() < self.minimum_coupable {
            return None;
        }
        let fragments = cesure.couper(mot)?;
        if fragments.len() <= 1 {
            return None;
        }
        let prefixe = if ligne.is_empty() {
            0.0
        } else {
            self.largeur(ligne) + largeur_espace
        };

        let mut meilleur: Option<(String, String)> = None;
        let mut cumul = String::new();
        for (index, fragment) in fragments.iter().enumerate() {
            cumul.push_str(fragment);
            // Un fragment seul ne suffit pas : il faut qu'il reste quelque
            // chose après, sinon la coupe ne sert à rien.
            if index + 1 >= fragments.len() {
                break;
            }
            let essai = format!("{cumul}-");
            let largeur_essai = prefixe + self.largeur(&essai);
            if largeur_essai <= largeur {
                let reste: String = fragments[index + 1..].concat();
                meilleur = Some((cumul.clone(), reste));
            } else {
                // Les fragments suivants sont plus longs : inutile d'insister.
                break;
            }
        }
        meilleur
    }
}

/// Le fragment se termine-t-il déjà par un trait d'union ?
#[must_use]
pub fn se_termine_par_un_tiret(fragment: &str) -> bool {
    match fragment.chars().last() {
        Some(c) => crate::francais::est_tiret(c),
        None => false,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Motifs;

    /// Mesure « à la monospace » : une unité par caractère. C'est ce qui rend
    /// les tests lisibles — 10 caractères tiennent dans une colonne de 10.
    fn monospace(_: &str) -> f64 {
        0.0
    }

    fn mesure_mono(texte: &str) -> f64 {
        texte.chars().count() as f64
    }

    fn composeur_simple() -> Compositeur<'static> {
        // Une fonction libre, pour éviter de capturer un `&dyn` local.
        Compositeur::new(&(mesure_mono as fn(&str) -> f64))
    }

    #[test]
    fn la_mesure_est_utilisee_telle_quelle() {
        let inutile = Compositeur::new(&monospace);
        assert_eq!(inutile.largeur("abc"), 0.0);
        assert_eq!(composeur_simple().largeur("abc"), 3.0);
    }

    #[test]
    fn un_paragraphe_court_tient_sur_une_ligne() {
        let lignes = composeur_simple().composer("mot court", 40.0);
        assert_eq!(lignes.len(), 1);
        assert_eq!(lignes[0].texte, "mot court");
        assert!(!lignes[0].tiret);
        assert_eq!(lignes[0].largeur, 9.0);
    }

    #[test]
    fn les_lignes_respectent_la_largeur() {
        let texte = "un deux trois quatre cinq six sept huit neuf dix onze douze";
        let lignes = composeur_simple().composer(texte, 20.0);
        for ligne in &lignes {
            assert!(
                ligne.largeur <= 20.0,
                "ligne trop large : « {} »",
                ligne.texte
            );
        }
        // Aucun mot n'est perdu, aucun n'est dupliqué.
        let recompose: Vec<String> = lignes.iter().map(|l| l.texte.clone()).collect();
        assert_eq!(recompose.join(" "), texte);
    }

    #[test]
    fn les_paragraphes_ne_se_melangent_pas() {
        let lignes = composeur_simple().composer("premier\nsecond", 40.0);
        assert_eq!(lignes.len(), 2);
        assert_eq!(lignes[0].texte, "premier");
        assert_eq!(lignes[1].texte, "second");
    }

    #[test]
    fn une_ligne_vide_est_ignoree() {
        let lignes = composeur_simple().composer("a\n\n\nb", 40.0);
        assert_eq!(lignes.len(), 2);
    }

    #[test]
    fn un_mot_trop_large_deborde_plutot_que_d_etre_coupe_au_caractere() {
        let lignes = composeur_simple().composer("anticonstitutionnellement", 5.0);
        assert_eq!(lignes.len(), 1, "le mot reste entier");
        assert_eq!(lignes[0].texte, "anticonstitutionnellement");
        assert!(lignes[0].largeur > 5.0, "et il déborde, visiblement");
    }

    #[test]
    fn le_mot_trop_long_est_coupe_si_la_cesure_est_activee() {
        // Un jeu de motifs qui coupe « anticonstitution » : on force les coupes
        // en les déclarant par exception.
        let motifs = Motifs::depuis_pat("", 2, 3)
            .avec_exceptions("an\u{00B7}ti\u{00B7}con\u{00B7}sti\u{00B7}tu\u{00B7}tion");
        let cesure = Cesure::dictionnaire(motifs);

        // Sans césure : le mot est plus large que la colonne, il déborde seul.
        let sans = composeur_simple().composer("anticonstitution", 12.0);
        assert_eq!(sans.len(), 1, "un seul mot : il ne peut pas se couper");
        assert!(sans[0].largeur > 12.0, "et il déborde");

        // Avec césure : le mot se coupe, en respectant la largeur.
        let avec = composeur_simple()
            .avec_cesure(&cesure)
            .composer("anticonstitution", 12.0);
        assert_eq!(avec.len(), 2, "deux lignes attendues : {avec:?}");
        assert!(avec[0].tiret, "la première ligne porte un tiret");
        assert!(
            avec[0].largeur + 1.0 <= 12.0,
            "la ligne doit tenir tiret compris"
        );
        // Recomposition : aucune lettre perdue, aucune ajoutée.
        assert_eq!(
            format!("{}{}", avec[0].texte, avec[1].texte),
            "anticonstitution"
        );
    }

    #[test]
    fn une_coupe_sur_un_tiret_du_mot_ne_rajoute_pas_de_tiret() {
        // « papier-carton » : la coupe tombe sur le tiret, on n'en ajoute pas un
        // second (sinon « papier-- »).
        let cesure = Cesure::nouvelle();
        let lignes = Compositeur::new(&(mesure_mono as fn(&str) -> f64))
            .avec_cesure(&cesure)
            .minimum_coupable(5)
            .composer("papier-carton", 7.0);
        let coupee = lignes
            .iter()
            .find(|l| l.tiret)
            .expect("une ligne doit être coupée avec tiret");
        assert!(!se_termine_par_un_tiret(&coupee.texte), "{coupee:?}");
    }

    #[test]
    fn se_terminer_par_un_tiret_est_detecte_pour_tous_les_tirets() {
        assert!(se_termine_par_un_tiret("États-"));
        assert!(se_termine_par_un_tiret("a\u{2013}"));
        assert!(!se_termine_par_un_tiret("États"));
        assert!(!se_termine_par_un_tiret(""));
    }

    #[test]
    fn une_largeur_nulle_met_tout_sur_une_ligne() {
        // Largeur 0 = « pas de contrainte » : c'est le cas d'un bloc qui n'a pas
        // encore de largeur définie.
        let lignes = composeur_simple().composer("a b c", 0.0);
        assert_eq!(lignes.len(), 1);
    }

    #[test]
    fn aucun_mot_n_est_perdu_sur_un_texte_long() {
        let texte =
            "Le chevalier de la programmation descendit les escaliers du château en courant, \
                     et il traversa la grande cour pavée avant de monter sur son fidèle destrier.";
        let sans = composeur_simple().composer(texte, 30.0);
        let attendu: Vec<&str> = texte.split_whitespace().collect();
        let obtenu: Vec<String> = sans
            .iter()
            .flat_map(|l| l.texte.split_whitespace().map(str::to_string))
            .collect();
        assert_eq!(
            obtenu, attendu,
            "la recomposition doit rendre le texte initial"
        );
    }
}
