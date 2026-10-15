//! Fonctions PURES de la désinstallation — sans dépendance à Tauri ni au système.
//!
//! POURQUOI CE FICHIER EXISTE, SÉPARÉ DU RESTE. Sur cette machine, Rust ne peut
//! pas se LIER : Visual Studio est absent, et la chaîne GNU réclame `libgcc` /
//! `libgcc_eh` que LLVM-MinGW ne fournit pas (il utilise libunwind). Le message
//! d'erreur, lui, est formel : `lld: error: unable to find library -lgcc_eh`.
//! Un `cargo check` est donc impossible dès qu'un *build script* doit être lié.
//!
//! Or la partie RISQUÉE de la désinstallation n'est pas l'appel système : c'est
//! le CALCUL DES CHEMINS — remonter d'un binaire à son paquet `.app`, ne pas
//! écraser un homonyme dans la Corbeille, reconnaître un `.deb` d'un `.rpm`. Ces
//! calculs ne dépendent ni de Tauri ni du système d'exploitation.
//!
//! Ils sont donc ici, isolés et sans dépendance, pour être VÉRIFIÉS POUR DE VRAI :
//! `_dev/scripts/verif_desinstallation.rs` les inclut tels quels, les compile en
//! WebAssembly (cible `wasm32-wasip1`, dont l'éditeur de liens est fourni par
//! rustc) et les EXÉCUTE sous Node. Le fichier testé est ce fichier-ci, pas une
//! copie — c'est ce qui donne à la vérification sa valeur.

use std::path::{Path, PathBuf};

/// Jeton de confirmation exigé par la commande native. Il ne protège pas d'un
/// attaquant — la commande n'est joignable que depuis notre propre webview — mais
/// il empêche qu'un `invoke` égaré efface une installation.
pub const JETON: &str = "desinstaller-superprint";

pub fn jeton_valide(recu: &str) -> bool {
    recu == JETON
}

/// Remonte d'un binaire macOS jusqu'au paquet `.app` qui le contient.
///
///     …/SuperPrint.app/Contents/MacOS/superprint  ->  …/SuperPrint.app
///
/// ⚠️ La vérification de l'extension `.app` n'est pas décorative : sans elle,
/// une arborescence inattendue ferait déplacer vers la Corbeille le dossier
/// `Contents`, ou n'importe quoi d'autre. On refuse plutôt que de deviner.
pub fn paquet_app_depuis_exe(exe: &Path) -> Option<PathBuf> {
    let paquet = exe.parent()?.parent()?.parent()?;
    if paquet.extension().map(|e| e == "app").unwrap_or(false) {
        Some(paquet.to_path_buf())
    } else {
        None
    }
}

/// Destination dans la Corbeille, **sans écraser un homonyme**.
///
/// Deux applications du même nom ne doivent pas se remplacer l'une l'autre dans
/// la Corbeille : ce serait une perte de données déguisée en désinstallation.
/// `existe` est passé en paramètre pour que la décision soit testable sans
/// toucher au disque.
pub fn cible_corbeille(
    corbeille: &Path,
    nom: &str,
    horodatage: u64,
    existe: impl Fn(&Path) -> bool,
) -> PathBuf {
    let direct = corbeille.join(nom);
    if !existe(&direct) {
        return direct;
    }
    match nom.strip_suffix(".app") {
        Some(tige) => corbeille.join(format!("{tige} {horodatage}.app")),
        None => corbeille.join(format!("{nom} {horodatage}")),
    }
}

/// Commande à donner à l'utilisateur pour retirer un paquet système.
///
/// On ne peut pas la lancer nous-mêmes : retirer un paquet demande les droits
/// d'administration, et une application ne doit pas s'élever toute seule pour se
/// supprimer. On identifie donc le gestionnaire réellement présent.
pub fn commandes_paquet(deb: bool, rpm: bool) -> Vec<&'static str> {
    if deb {
        vec!["sudo apt remove super-print"]
    } else if rpm {
        vec!["sudo dnf remove super-print"]
    } else {
        vec![
            "sudo apt remove super-print",
            "sudo dnf remove super-print",
        ]
    }
}

/// Dossiers de données que Tauri NE connaît pas, et qui resteraient derrière une
/// désinstallation.
///
/// ⚠️ Sur macOS, `WKWebView` range son stockage hors des dossiers de
/// l'application : sans ces chemins, une « désinstallation » laisse le cache, les
/// préférences et l'état de session. C'est précisément ce qu'on veut éviter.
pub fn dossiers_webview_macos(home: &Path, identifiant: &str) -> Vec<PathBuf> {
    let bib = home.join("Library");
    vec![
        bib.join("WebKit").join(identifiant),
        bib.join("HTTPStorages").join(identifiant),
        bib.join("Saved Application State")
            .join(format!("{identifiant}.savedState")),
        bib.join("Preferences").join(format!("{identifiant}.plist")),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_jeton_est_exige() {
        assert!(jeton_valide(JETON));
        assert!(!jeton_valide(""));
        assert!(!jeton_valide("Desinstaller-superprint"));
    }

    #[test]
    fn remonte_bien_au_paquet() {
        let exe = Path::new("/Applications/SuperPrint.app/Contents/MacOS/superprint");
        assert_eq!(
            paquet_app_depuis_exe(exe),
            Some(PathBuf::from("/Applications/SuperPrint.app"))
        );
    }

    #[test]
    fn refuse_une_arborescence_sans_app() {
        // Un binaire qui n'est pas dans un paquet : on ne devine pas.
        assert_eq!(paquet_app_depuis_exe(Path::new("/usr/bin/superprint")), None);
        // Un dossier `Contents` nu ne doit pas être pris pour un paquet.
        assert_eq!(
            paquet_app_depuis_exe(Path::new("/tmp/Contents/MacOS/superprint")),
            None
        );
    }

    #[test]
    fn corbeille_n_ecrase_pas_un_homonyme() {
        let corbeille = Path::new("/Users/x/.Trash");
        let libre = cible_corbeille(corbeille, "SuperPrint.app", 100, |_| false);
        assert_eq!(libre, PathBuf::from("/Users/x/.Trash/SuperPrint.app"));

        let occupe = cible_corbeille(corbeille, "SuperPrint.app", 100, |_| true);
        assert_eq!(
            occupe,
            PathBuf::from("/Users/x/.Trash/SuperPrint 100.app")
        );
    }

    #[test]
    fn commandes_selon_le_gestionnaire() {
        assert_eq!(commandes_paquet(true, false), vec!["sudo apt remove super-print"]);
        assert_eq!(commandes_paquet(false, true), vec!["sudo dnf remove super-print"]);
        assert_eq!(commandes_paquet(false, false).len(), 2);
    }

    #[test]
    fn les_dossiers_webview_macos_sont_bien_ceux_la() {
        let d = dossiers_webview_macos(Path::new("/Users/x"), "cc.superprint.desktop");
        assert!(d.contains(&PathBuf::from(
            "/Users/x/Library/WebKit/cc.superprint.desktop"
        )));
        assert!(d.contains(&PathBuf::from(
            "/Users/x/Library/Preferences/cc.superprint.desktop.plist"
        )));
        assert_eq!(d.len(), 4);
    }
}
