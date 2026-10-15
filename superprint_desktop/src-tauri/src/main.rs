// SuperPrint — lanceur de bureau.
//
// La coquille ne fait qu'une chose : ouvrir l'application web SuperPrint dans la
// webview du système (WebView2 sous Windows, WKWebView sous macOS, WebKitGTK sous
// Linux). Toute la PAO reste dans `superprint/app`, embarqué au moment du build
// par `tauri-build` : le binaire ainsi produit fonctionne hors-ligne.
//
// Elle expose en plus UNE commande native, `desinstaller` : c'est le seul geste
// que le web ne peut pas faire à la place du système. Voir `desinstallation.rs`
// pour ce que chaque plateforme permet réellement, et pourquoi.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[allow(dead_code)]
mod desinstallation;
#[allow(dead_code)]
mod desinstallation_chemins;

fn main() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![desinstallation::desinstaller])
        .run(tauri::generate_context!())
        .expect("erreur au lancement de SuperPrint");
}
