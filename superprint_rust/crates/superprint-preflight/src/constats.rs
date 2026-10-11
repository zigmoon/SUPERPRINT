//! Les **constats** : ce que le prépresse rend, et comment il le dit.
//!
//! Chaque constat porte un **code** stable, une **gravité**, la **page**
//! concernée quand elle existe, et une phrase qui dit quoi faire. Le code est ce
//! qui permet de filtrer, compter, ignorer ; la phrase est ce qu'un humain lit.

use core::fmt;

/// Ce qu'un constat signifie pour le tirage.
///
/// L'ordre est celui de l'urgence : `Erreur` > `Avertissement` > `Information`.
/// Un rapport est trié par gravité décroissante, pour que la première ligne lue
/// soit toujours la plus grave.
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Gravite {
    /// À savoir, sans conséquence sur le tirage.
    Information,
    /// Le fichier s'imprime, mais le résultat peut décevoir. À regarder.
    Avertissement,
    /// Le fichier ne devrait pas partir à l'impression tel quel.
    Erreur,
}

impl Gravite {
    /// Le mot que l'interface affiche.
    #[must_use]
    pub fn libelle(self) -> &'static str {
        match self {
            Self::Information => "Information",
            Self::Avertissement => "Avertissement",
            Self::Erreur => "Erreur",
        }
    }

    /// Le rang de la gravité : `0` information, `1` avertissement, `2` erreur.
    ///
    /// C'est ce que transporte la frontière C. Un **rang** et non un mot : le
    /// protocole reste alors indépendant de la langue de l'interface, et un
    /// appelant peut écrire « bloquant » dès `rang >= 2` sans comparer de
    /// chaînes de caractères.
    #[must_use]
    pub fn rang(self) -> u8 {
        match self {
            Self::Information => 0,
            Self::Avertissement => 1,
            Self::Erreur => 2,
        }
    }
}

impl fmt::Display for Gravite {
    fn fmt(&self, formateur: &mut fmt::Formatter<'_>) -> fmt::Result {
        formateur.write_str(self.libelle())
    }
}

/// Le **type** de constat, stable et filtrable.
///
/// C'est un code, pas un texte : un appelant peut décider « j'ignore les
/// avertissements sur la résolution pour ce travail », alors qu'il ne peut rien
/// décider sur une phrase. Le code ne change **jamais** de sens ; si un contrôle
/// change, on ajoute une variante et on incrémente [`crate::VERSION_CONTROLES`].
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Code {
    /// Une image est posée à une résolution inférieure au seuil demandé.
    ImageBasseResolution,
    /// La somme des quatre encres quadri dépasse la couverture maximale.
    CouvertureEncreExcessive,
    /// Un texte **fin** est peint en noir quadrichrome (quatre encres).
    NoirQuadrichromeSurTexteFin,
    /// Un trait **fin** est peint en noir quadrichrome.
    NoirQuadrichromeSurTraitFin,
    /// Un objet dépasse la zone autorisée par le fond perdu.
    DebordementFondPerdu,
    /// Une police n'est pas embarquée : l'imprimeur en mettra une autre.
    PoliceNonEmbarquee,
    /// Aucun profil de sortie : le fichier ne dit pas dans quel espace il parle.
    ProfilSortieAbsent,
    /// Le profil de sortie n'a pas le nombre de composantes attendu.
    ProfilSortieIncoherent,
    /// Des repères de coupe sont demandés mais la réserve est nulle.
    ReperesSansReserve,
    /// Une encre directe est déclarée sur une page qui ne s'en sert pas.
    EncreNonUtilisee,
    /// Une page n'a pas de fond perdu alors que le document en attend un.
    FondPerduAbsent,
    /// Le document ne contient aucune page.
    DocumentVide,
    /// Le document contient du texte vivant (information, pas un défaut).
    TexteVivant,
    /// Une image n'est ni RVB ni en niveaux de gris.
    ImageEspaceInattendu,
}

impl Code {
    /// Le nom court du code — celui qu'on écrit dans un journal ou un test.
    #[must_use]
    pub fn nom(self) -> &'static str {
        match self {
            Self::ImageBasseResolution => "image-basse-resolution",
            Self::CouvertureEncreExcessive => "couverture-encre-excessive",
            Self::NoirQuadrichromeSurTexteFin => "noir-quadri-texte-fin",
            Self::NoirQuadrichromeSurTraitFin => "noir-quadri-trait-fin",
            Self::DebordementFondPerdu => "debordement-fond-perdu",
            Self::PoliceNonEmbarquee => "police-non-embarquee",
            Self::ProfilSortieAbsent => "profil-sortie-absent",
            Self::ProfilSortieIncoherent => "profil-sortie-incoherent",
            Self::ReperesSansReserve => "reperes-sans-reserve",
            Self::EncreNonUtilisee => "encre-non-utilisee",
            Self::FondPerduAbsent => "fond-perdu-absent",
            Self::DocumentVide => "document-vide",
            Self::TexteVivant => "texte-vivant",
            Self::ImageEspaceInattendu => "image-espace-inattendu",
        }
    }
}

/// Un constat, avec de quoi le situer et le comprendre.
#[derive(Clone, Debug, PartialEq)]
pub struct Constat {
    /// Le type de constat.
    pub code: Code,
    /// À quel point cela compte.
    pub gravite: Gravite,
    /// La page concernée, numérotée **à partir de 1** comme dans l'interface.
    /// `None` quand le constat porte sur le document entier.
    pub page: Option<usize>,
    /// Phrase lisible : quoi, où, et combien.
    pub message: String,
}

impl Constat {
    /// Construit un constat sur une page.
    #[must_use]
    pub fn page(code: Code, gravite: Gravite, page: usize, message: impl Into<String>) -> Self {
        Self {
            code,
            gravite,
            page: Some(page),
            message: message.into(),
        }
    }

    /// Construit un constat sur le document entier.
    #[must_use]
    pub fn document(code: Code, gravite: Gravite, message: impl Into<String>) -> Self {
        Self {
            code,
            gravite,
            page: None,
            message: message.into(),
        }
    }
}

impl fmt::Display for Constat {
    /// « Erreur, page 3 — une image est posée à 142 dpi… »
    fn fmt(&self, formateur: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self.page {
            Some(page) => write!(
                formateur,
                "{}, page {page} — {}",
                self.gravite, self.message
            ),
            None => write!(formateur, "{} — {}", self.gravite, self.message),
        }
    }
}

/// Tous les constats d'un document, et de quoi décider vite.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct Rapport {
    /// Les constats, **triés** : gravité décroissante, puis page, puis code.
    pub constats: Vec<Constat>,
}

impl Rapport {
    /// Un rapport vide. Utile aux appels sans document, et aux tests.
    #[must_use]
    pub fn vide() -> Self {
        Self::nouveau(Vec::new())
    }

    /// Construit un rapport à partir de constats en désordre.
    ///
    /// Le tri n'est pas cosmétique : un rapport lu de haut en bas doit donner le
    /// problème le plus grave en premier, sinon il faut le relire en entier pour
    /// savoir s'il y a urgence.
    #[must_use]
    pub fn nouveau(mut constats: Vec<Constat>) -> Self {
        constats.sort_by(|a, b| {
            // Gravité décroissante : `b` avant `a`.
            b.gravite
                .cmp(&a.gravite)
                .then_with(|| a.page.unwrap_or(0).cmp(&b.page.unwrap_or(0)))
                .then_with(|| a.code.cmp(&b.code))
        });
        Self { constats }
    }

    /// Le fichier peut-il partir à l'impression tel quel ?
    ///
    /// Vrai s'il n'y a **aucune erreur**. Les avertissements ne bloquent pas :
    /// bloquer sur un avertissement ferait perdre du temps à tout le monde, et
    /// pousserait à ignorer les avertissements — exactement le contraire du but.
    #[must_use]
    pub fn acceptable(&self) -> bool {
        !self.constats.iter().any(|c| c.gravite == Gravite::Erreur)
    }

    /// Nombre de constats d'une gravité donnée.
    #[must_use]
    pub fn compter(&self, gravite: Gravite) -> usize {
        self.constats
            .iter()
            .filter(|c| c.gravite == gravite)
            .count()
    }

    /// Les constats d'un code donné.
    #[must_use]
    pub fn par_code(&self, code: Code) -> Vec<&Constat> {
        self.constats.iter().filter(|c| c.code == code).collect()
    }

    /// Le rapport contient-il ce code ?
    #[must_use]
    pub fn contient(&self, code: Code) -> bool {
        self.constats.iter().any(|c| c.code == code)
    }

    /// Retire les constats d'un code — ce qu'un utilisateur fait quand il a
    /// décidé que ce contrôle ne le concerne pas.
    pub fn ignorer(&mut self, code: Code) {
        self.constats.retain(|c| c.code != code);
    }

    /// Une ligne par constat, prête à afficher ou à écrire dans un fichier.
    #[must_use]
    pub fn resume(&self) -> String {
        if self.constats.is_empty() {
            return "Aucun constat : le document est prêt pour l'impression.".to_string();
        }
        let mut sortie = String::new();
        for constat in &self.constats {
            sortie.push_str(&constat.to_string());
            sortie.push('\n');
        }
        sortie
    }

    /// Le rapport en texte **lisible par une machine** — le format que la
    /// frontière C transporte.
    ///
    /// Une ligne par information, les champs séparés par des tabulations :
    ///
    /// ```text
    /// !acceptable<TAB>0
    /// !compte<TAB>2<TAB>1<TAB>0
    /// !constat<TAB>image-basse-resolution<TAB>2<TAB>1<TAB>une image de …
    /// ```
    ///
    /// `!acceptable` vaut `1` si le fichier peut partir tel quel. `!compte`
    /// donne les erreurs, puis les avertissements, puis les informations.
    /// `!constat` donne le code, le **rang** de gravité ([`Gravite::rang`]), le
    /// numéro de page (`0` = document entier), puis le message.
    ///
    /// Le message est **le dernier** champ, et c'est délibéré : il contient de la
    /// ponctuation, des accents et des chiffres, donc tout sauf des tabulations
    /// — un lecteur qui découpe sur les trois premiers séparateurs et garde le
    /// reste ne peut pas se tromper.
    ///
    /// Ce format double [`Rapport::resume`] : le résumé est pour l'humain, le
    /// texte pour la machine. Les deux sortent du **même** rapport trié, donc ils
    /// ne peuvent pas raconter deux choses différentes.
    #[must_use]
    pub fn texte(&self) -> String {
        use core::fmt::Write as _;
        let mut sortie = String::with_capacity(256);
        let _ = writeln!(sortie, "!acceptable\t{}", u8::from(self.acceptable()));
        let _ = writeln!(
            sortie,
            "!compte\t{}\t{}\t{}",
            self.compter(Gravite::Erreur),
            self.compter(Gravite::Avertissement),
            self.compter(Gravite::Information)
        );
        for constat in &self.constats {
            let _ = writeln!(
                sortie,
                "!constat\t{}\t{}\t{}\t{}",
                constat.code.nom(),
                constat.gravite.rang(),
                constat.page.unwrap_or(0),
                constat.message
            );
        }
        sortie
    }
}

impl fmt::Display for Rapport {
    fn fmt(&self, formateur: &mut fmt::Formatter<'_>) -> fmt::Result {
        formateur.write_str(&self.resume())
    }
}
