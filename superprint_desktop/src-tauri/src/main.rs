// SuperPrint — lanceur de bureau.
//
// La coquille ne fait qu'une chose : ouvrir l'application web SuperPrint dans la
// webview du système (WebView2 sous Windows, WKWebView sous macOS, WebKitGTK sous
// Linux). Toute la PAO reste dans `superprint/app`, embarqué au moment du build
// par `tauri-build` : le binaire ainsi produit fonctionne hors-ligne.
//
// Elle expose en plus DEUX capacités que le web ne peut pas assurer :
//   · `desinstaller` — retirer l'application du système (voir `desinstallation.rs`) ;
//   · la mise à jour automatique (voir `maj.rs`), vérifiée en tâche de fond au
//     démarrage : c'est le pendant du service worker du site, en version binaire.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[allow(dead_code)]
mod desinstallation;
#[allow(dead_code)]
mod desinstallation_chemins;
mod maj;

fn main() {
    tauri::Builder::default()
        // L'updater lit le manifeste de la plateforme et vérifie la signature du
        // paquet avec la clé publique de `tauri.conf.json`. Le plugin est
        // enregistré ici, mais TOUT le dialogue se fait en Rust (`maj.rs`) : la
        // page web n'a aucune permission de mise à jour, donc une page
        // compromises ne peut pas déclencher d'installation.
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![desinstallation::desinstaller])
        .setup(|app| {
            maj::verifier_au_demarrage(app.handle().clone());
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("erreur au lancement de SuperPrint");
}
