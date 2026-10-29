//! Mise à jour automatique — vérification au démarrage, puis installation.
//!
//! POURQUOI CE MODULE EXISTE. Une application de bureau installée ne voyait plus
//! jamais les correctifs : il fallait retélécharger l'installeur à la main. Le
//! web, lui, se met à jour tout seul par le service worker — d'où l'impression
//! que « les applications sont en retard sur le site » alors qu'elles étaient
//! simplement figées à leur version d'installation.
//!
//! Un service worker ne peut PAS résoudre cela : il ne gère que le cache d'une
//! page, il ne peut ni remplacer un binaire ni redémarrer un processus. Le
//! mécanisme prévu pour cela est le plugin `updater` de Tauri : il interroge un
//! manifeste JSON, vérifie une **signature minisign** avec la clé publique
//! inscrite dans `tauri.conf.json`, télécharge le paquet de la plateforme, puis
//! le pose en place.
//!
//! OÙ SONT DÉPOSÉES LES MISES À JOUR. Sur la release GitHub `desktop-latest` du
//! dépôt, celle que le site utilise déjà pour ses liens de téléchargement. Rien
//! à héberger, rien à payer : les binaires y sont publiés par
//! `.github/workflows/build-desktop.yml`, qui y dépose aussi, à chaque version,
//! un manifeste `latest-<application>.json` par application.
//!
//! CE QUI EST VÉRIFIÉ, ET CE QUI NE L'EST PAS. La signature garantit que le
//! paquet vient bien de la clé privée du projet : un manifeste modifié sur
//! GitHub ne suffit pas à installer autre chose. En revanche la mise à jour ne
//! s'applique QUE si l'application installée contient déjà ce module — la
//! première version qui l'embarque doit donc être installée une fois à la main.
//!
//! LIMITE CONNUE, ET ASSUMÉE. Sous Linux, seul l'AppImage peut se remplacer
//! lui-même : une installation `.deb` ou `.rpm` appartient au gestionnaire de
//! paquets du système, et la remplacer en douce serait une mauvaise manière. Ces
//! utilisateurs restent donc en mise à jour manuelle — c'est écrit dans
//! `superprint_desktop/README.md`, section « Mise à jour automatique ».

use tauri::{AppHandle, Manager};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

/// Délai avant la première vérification, en secondes.
///
/// Pourquoi attendre : la vérification fait une requête HTTPS et peut
/// télécharger une trentaine de mégaoctets. La lancer pendant l'ouverture de la
/// fenêtre ferait concurrence au chargement du document, sur une machine qui
/// démarre. Cinq secondes suffisent à laisser la page s'afficher.
const DELAI_AVANT_VERIFICATION_S: u64 = 5;

/// Lance la vérification en tâche de fond, sans jamais bloquer le démarrage.
///
/// Appelée depuis `setup`, quand la fenêtre existe déjà. Aucune erreur ne
/// remonte à l'utilisateur : une machine hors ligne, un manifeste absent ou un
/// GitHub inaccessible ne doivent pas produire de message au lancement — le
/// journal suffit, et c'était le défaut à éviter (une boîte d'erreur à chaque
/// démarrage sans réseau).
pub fn verifier_au_demarrage(app: AppHandle) {
    std::thread::spawn(move || {
        std::thread::sleep(std::time::Duration::from_secs(DELAI_AVANT_VERIFICATION_S));
        // `block_on` plutôt que `spawn` : le délai est déjà écoulé et l'on veut
        // que la séquence vérification → dialogue → installation s'exécute dans
        // l'ordre, sans risque d'entrelacement avec un autre geste.
        tauri::async_runtime::block_on(async move {
            if let Err(e) = verifier_et_installer(&app).await {
                eprintln!("[mise à jour] vérification impossible : {e}");
            }
        });
    });
}

/// Vérifie le manifeste, demande l'accord, installe.
async fn verifier_et_installer(app: &AppHandle) -> Result<(), Box<dyn std::error::Error>> {
    let updater = app.updater()?;
    let Some(update) = updater.check().await? else {
        return Ok(());
    };

    // Le nom affiché vient de la configuration de l'application (« SuperPrint »,
    // « Studio IA », « SuperTyPo ») : les trois binaires partagent ce module, et
    // une boîte intitulée « SuperPrint » dans SuperTyPo serait un mensonge.
    let nom = app
        .config()
        .product_name
        .clone()
        .unwrap_or_else(|| "Application".to_string());

    let notes = update
        .body
        .clone()
        .unwrap_or_default()
        .lines()
        .take(6)
        .collect::<Vec<_>>()
        .join("\n");

    let mut message = format!(
        "La version {version} est disponible.\n\n\
         Vous utilisez la version {actuelle}.\n\n\
         L'installation prend quelques secondes, puis l'application redémarre.",
        version = update.version,
        actuelle = update.current_version,
    );
    if !notes.trim().is_empty() {
        message.push_str("\n\n");
        message.push_str(notes.trim());
    }

    // `blocking_show` depuis un fil de fond : le fil principal reste libre pour
    // le rendu de la fenêtre, sinon le dialogue s'afficherait devant une page
    // figée.
    let accepter = app
        .dialog()
        .message(message)
        .title(format!("Mise à jour de {nom}"))
        .kind(MessageDialogKind::Info)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Installer".to_string(),
            "Plus tard".to_string(),
        ))
        .blocking_show();

    if !accepter {
        return Ok(());
    }

    // Les deux fermetures sont obligatoires dans l'API : la première reçoit la
    // progression, la seconde la fin du téléchargement. On n'affiche pas de
    // barre — le dialogue est déjà fermé — mais on garde la trace en mémoire
    // pour ne pas laisser croire à un blocage si le réseau est lent.
    let mut octets_recus: usize = 0;
    update
        .download_and_install(
            |morceau, total| {
                octets_recus += morceau;
                if let Some(total) = total {
                    // Une ligne par mégaoctet : le journal du système reste
                    // lisible, et suffit à diagnostiquer une livraison lente.
                    if octets_recus % (1024 * 1024) < morceau {
                        println!("[mise à jour] {octets_recus} / {total} octets");
                    }
                }
            },
            || println!("[mise à jour] téléchargement terminé"),
        )
        .await?;

    println!(
        "[mise à jour] version {} installée, redémarrage",
        update.version
    );

    // Sous Windows, l'installeur NSIS a déjà terminé le processus : cette ligne
    // n'est atteinte que sous macOS et Linux, où c'est à nous de relancer.
    app.restart()
}
