//! Désinstallation de l'application, déclenchée depuis l'application elle-même.
//!
//! POURQUOI CE MODULE EXISTE. Les formats ne se valent pas, et c'est MESURÉ :
//!
//!   · Windows — l'installeur NSIS écrit un `uninstall.exe` à côté du binaire et
//!     l'enregistre dans « Ajout/Suppression de programmes ». Vérifié sur une
//!     machine réelle : `uninstall.exe` présent, entrée de registre avec son
//!     `UninstallString`.
//!   · Linux — le `.deb` et le `.rpm` se retirent par le gestionnaire de paquets
//!     (`apt remove`, `dnf remove`) ; l'`.AppImage` se retire en supprimant le
//!     fichier. Aucun des trois n'a de programme de désinstallation.
//!   · macOS — le `.dmg` contient `SuperPrint.app` et un lien vers
//!     `Applications`, RIEN d'autre : l'image disque a été DÉCOMPRESSÉE pour le
//!     vérifier, et « uninstall » n'y apparaît nulle part. La désinstallation y
//!     est le glisser vers la Corbeille.
//!
//! Le macOS était donc le seul système où l'utilisateur n'avait AUCUN moyen
//! explicite de désinstaller, et les données de l'application restaient derrière
//! partout. Ce module donne le même geste aux trois systèmes.
//!
//! CE QU'IL RENVOIE, ET POURQUOI CE N'EST PAS UN TEXTE. Les traductions vivent
//! dans l'interface (FR / EN / JP) ; le natif ne peut pas les connaître. Il
//! renvoie donc un CODE stable, que l'interface traduit, plus la liste des
//! chemins réellement traités — ce qui permet de MONTRER ce qui a été fait
//! plutôt que de l'affirmer.
//!
//! ⚠️ CETTE COMMANDE EST DESTRUCTIVE, donc deux garde-fous : elle exige un jeton
//! de confirmation, et elle n'est appelable que depuis la webview de
//! l'application (les commandes locales ne sont pas exposées au web).

use serde::Serialize;
use tauri::Manager;

use crate::desinstallation_chemins as chemins;

#[derive(Serialize, Default)]
pub struct Rapport {
    /// Code stable, traduit par l'interface.
    pub code: &'static str,
    /// Chemins traités — supprimés, déplacés, ou à retirer à la main.
    pub chemins: Vec<String>,
    /// Vrai si l'application doit se fermer : l'action n'est complète qu'ensuite.
    pub fermer: bool,
}

/// Élément traité, ajouté au rapport sous forme lisible.
fn noter(rapport: &mut Rapport, chemin: impl std::fmt::Display) {
    rapport.chemins.push(chemin.to_string());
}

#[tauri::command]
pub fn desinstaller(app: tauri::AppHandle, confirmation: String) -> Rapport {
    if !chemins::jeton_valide(&confirmation) {
        return Rapport {
            code: "refuse",
            chemins: Vec::new(),
            fermer: false,
        };
    }

    let mut rapport = agir(&app);

    /* ⚠️ L'ordre compte : on décide D'ABORD si l'application doit se fermer, et
       on ne lance le fil qu'ensuite. Dans l'autre sens, un code d'erreur aurait
       pu planifier une sortie avant d'être annulé. */
    if rapport.code == "erreur" {
        rapport.fermer = false;
    }

    if rapport.fermer {
        /* On laisse à l'interface le temps d'afficher ce qui vient d'être fait
           avant que la fenêtre ne disparaisse. */
        let handle = app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(std::time::Duration::from_millis(1200));
            handle.exit(0);
        });
    }

    rapport
}

/// Supprime les données de l'application. Rend la liste des dossiers réellement
/// supprimés. **Best effort** : un dossier verrouillé ne doit pas faire échouer
/// la désinstallation, il doit seulement ne pas être annoncé comme supprimé.
fn purger_donnees(app: &tauri::AppHandle, rapport: &mut Rapport) {
    let mut candidats: Vec<std::path::PathBuf> = Vec::new();

    /* ⚠️ Le nom local est `resolver` et non `chemins` : `chemins` est aussi
       l'alias du module pur, et deux noms identiques dans des espaces de noms
       différents compileraient — mais se liraient mal, et le prochain lecteur
       croirait à une erreur. */
    let resolver = app.path();

    for p in [
        resolver.app_data_dir().ok(),
        resolver.app_local_data_dir().ok(),
        resolver.app_config_dir().ok(),
        resolver.app_cache_dir().ok(),
        resolver.app_log_dir().ok(),
    ]
    .into_iter()
    .flatten()
    {
        candidats.push(p);
    }

    /* ⚠️ Sur macOS, les données de la webview NE SONT PAS dans ces dossiers :
       WKWebView range son stockage ailleurs. Sans ces chemins, une
       « désinstallation » laisse le cache et l'état d'application derrière elle.
       La liste est construite par une fonction PURE, vérifiée pour de vrai — le
       calcul des chemins est la partie qui se trompe le plus facilement. */
    #[cfg(target_os = "macos")]
    {
        if let Some(dossier) = dirs_home() {
            let identifiant = app.config().identifier.clone();
            candidats.extend(chemins::dossiers_webview_macos(&dossier, &identifiant));
        }
    }

    for p in candidats {
        if !p.exists() {
            continue;
        }
        let supprime = if p.is_dir() {
            std::fs::remove_dir_all(&p).is_ok()
        } else {
            std::fs::remove_file(&p).is_ok()
        };
        if supprime {
            noter(rapport, p.display());
        }
    }
}

#[cfg(target_os = "macos")]
fn dirs_home() -> Option<std::path::PathBuf> {
    std::env::var_os("HOME").map(std::path::PathBuf::from)
}

/* ══════════════════════════ Windows ══════════════════════════════════════ */
#[cfg(target_os = "windows")]
fn agir(app: &tauri::AppHandle) -> Rapport {
    use std::process::Command;

    let mut rapport = Rapport::default();

    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(_) => {
            rapport.code = "erreur";
            return rapport;
        }
    };

    let desinstalleur = exe.with_file_name("uninstall.exe");
    if !desinstalleur.exists() {
        /* Cas normal d'une copie lancée depuis le dossier de compilation : elle
           n'a pas été installée, donc il n'y a rien à désinstaller. On le DIT,
           plutôt que d'échouer. */
        rapport.code = "nsis-absent";
        noter(&mut rapport, exe.display());
        return rapport;
    }

    purger_donnees(app, &mut rapport);

    match Command::new(&desinstalleur).spawn() {
        Ok(_) => {
            rapport.code = "nsis-lance";
            noter(&mut rapport, desinstalleur.display());
            rapport.fermer = true;
        }
        Err(_) => {
            rapport.code = "erreur";
            noter(&mut rapport, desinstalleur.display());
        }
    }
    rapport
}

/* ══════════════════════════ macOS ═══════════════════════════════════════ */
#[cfg(target_os = "macos")]
fn agir(app: &tauri::AppHandle) -> Rapport {
    let mut rapport = Rapport::default();

    let exe = match std::env::current_exe() {
        Ok(e) => e,
        Err(_) => {
            rapport.code = "erreur";
            return rapport;
        }
    };

    /* `…/SuperPrint.app/Contents/MacOS/superprint` : la remontée au paquet est
       faite par une fonction PURE et vérifiée, qui REFUSE tout ce qui ne finit
       pas par `.app` — sans ce contrôle, une arborescence inattendue ferait
       déplacer un dossier quelconque vers la Corbeille. */
    let paquet = match chemins::paquet_app_depuis_exe(&exe) {
        Some(p) => p,
        None => {
            rapport.code = "bundle-introuvable";
            noter(&mut rapport, exe.display());
            return rapport;
        }
    };

    let nom = paquet
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| "SuperPrint.app".to_string());

    let corbeille = match dirs_home() {
        Some(d) => d.join(".Trash"),
        None => {
            rapport.code = "erreur";
            return rapport;
        }
    };
    let _ = std::fs::create_dir_all(&corbeille);

    let horodatage = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    let cible = chemins::cible_corbeille(&corbeille, &nom, horodatage, |p| p.exists());

    match std::fs::rename(&paquet, &cible) {
        Ok(_) => {
            rapport.code = "bundle-corbeille";
            noter(&mut rapport, cible.display());
            purger_donnees(app, &mut rapport);
            rapport.fermer = true;
        }
        Err(_) => {
            /* Cas réel : l'application est dans /Applications et l'utilisateur
               n'est pas administrateur. On le dit, et on ne prétend rien. */
            rapport.code = "bundle-non-deplacable";
            noter(&mut rapport, paquet.display());
        }
    }
    rapport
}

/* ══════════════════════════ Linux ═══════════════════════════════════════ */
#[cfg(target_os = "linux")]
fn agir(app: &tauri::AppHandle) -> Rapport {
    let mut rapport = Rapport::default();

    /* ── AppImage : un seul fichier, que l'on peut supprimer même en cours
       d'exécution (le système garde l'index ouvert). On le supprime DIRECTEMENT,
       sans passer par un shell : cela évite tout problème de citation de chemin,
       et une commande shell construite à partir d'une variable d'environnement
       serait une injection potentielle. */
    if let Some(image) = std::env::var_os("APPIMAGE") {
        let image = std::path::PathBuf::from(image);
        purger_donnees(app, &mut rapport);
        match std::fs::remove_file(&image) {
            Ok(_) => {
                rapport.code = "appimage-supprime";
                noter(&mut rapport, image.display());
                rapport.fermer = true;
            }
            Err(_) => {
                rapport.code = "appimage-non-supprimable";
                noter(&mut rapport, image.display());
            }
        }
        return rapport;
    }

    /* ── Paquet système : retirer demande les droits d'administration, donc on
       ne peut pas le faire depuis l'application. On identifie le gestionnaire
       réellement concerné et on donne LA commande exacte — ce que l'utilisateur
       attend, et ce qu'aucun des deux formats ne fournissait jusqu'ici. */
    purger_donnees(app, &mut rapport);

    let deb = std::path::Path::new("/var/lib/dpkg/info/super-print.list").exists();
    let rpm = std::path::Path::new("/var/lib/rpm").exists()
        || std::path::Path::new("/usr/lib/sysimage/rpm").exists();

    let commandes = chemins::commandes_paquet(deb, rpm);
    rapport.code = match (deb, rpm) {
        (true, _) => "paquet-deb",
        (false, true) => "paquet-rpm",
        (false, false) => "paquet-inconnu",
    };
    for c in commandes {
        noter(&mut rapport, c);
    }

    /* Les données sont déjà purgées ; il reste le fichier système, qui n'est pas
       à nous. On ne ferme donc PAS l'application : elle reste utilisable tant
       que l'utilisateur n'a pas passé la commande. */
    rapport
}

#[cfg(not(any(target_os = "windows", target_os = "macos", target_os = "linux")))]
fn agir(_app: &tauri::AppHandle) -> Rapport {
    Rapport {
        code: "systeme-inconnu",
        chemins: Vec::new(),
        fermer: false,
    }
}
