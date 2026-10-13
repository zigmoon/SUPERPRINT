// SuperPrint — lanceur de bureau.
//
// La coquille ne fait qu'une chose : ouvrir l'application web SuperPrint dans la
// webview du système (WebView2 sous Windows, WKWebView sous macOS, WebKitGTK sous
// Linux). Toute la PAO reste dans `superprint/app`, embarqué au moment du build
// par `tauri-build` : le binaire ainsi produit fonctionne hors-ligne.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("erreur au lancement de SuperPrint");
}
