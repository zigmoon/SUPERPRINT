# SuperPrint — application de bureau

Coquille [Tauri](https://tauri.app) autour de la PAO SuperPrint. Elle n'ajoute
aucune fonction : elle ouvre les applications web existantes dans la **webview du
système** (WebView2 sous Windows, WKWebView sous macOS, WebKitGTK sous Linux) et
les **embarque dans le binaire**, de sorte que l'application fonctionne
hors-ligne, sans serveur et sans compte.

**Les trois applications sont dans le même paquet** — l'éditeur **SuperPrint**,
le **Studio IA** et **SuperTyPo** — et se choisissent sur la page de lancement.
Un seul installeur par système, donc, et non trois.

Le front-end n'est **pas copié** dans ce dossier : `scripts/stage-frontend.mjs`
l'assemble au moment du build, depuis `../superprint/`. Il n'y a donc **une
seule** application à maintenir — une correction dans `superprint/app` se
retrouve dans le bureau au build suivant.

```
superprint_desktop/
├── package.json                 CLI Tauri (devDependency)
├── src/launcher.html            page de lancement (trois cartes)
├── scripts/
│   ├── stage-frontend.mjs       assemble frontend/ depuis ../superprint/
│   └── build-windows.ps1        recette de compilation Windows
├── frontend/                    FABRIQUÉ, jamais versionné
└── src-tauri/
    ├── Cargo.toml               dépendances Rust (tauri 2)
    ├── build.rs                 appelé par tauri-build
    ├── tauri.conf.json          fenêtre, icônes, installeurs
    ├── capabilities/            autorisations de la fenêtre
    ├── icons/                   icônes générées par `npx tauri icon`
    └── src/main.rs              ouverture de la fenêtre — et rien d'autre
```

## Ce que le dossier embarqué contient

`stage-frontend.mjs` fabrique `frontend/` et **vérifie son propre résultat** :

| Source | Destination | Pour |
|---|---|---|
| `superprint/app/` | `frontend/app/` | l'éditeur SuperPrint |
| `superprint/sp213-studio.html` | `frontend/studio.html` | le Studio IA |
| `superprint/supertypo/` | `frontend/supertypo/` | SuperTyPo |
| `superprint/icons/`, `favicon.png`, `manifest.webmanifest` | idem | partagé par les trois |
| `superprint/JS/fabric.min.js` | `frontend/JS/` | moteur de canevas du Studio |
| `superprint/CSS/fonts.css` | `frontend/CSS/` | typographie du Studio |
| `src/launcher.html` | `frontend/index.html` | la page de lancement, version injectée |

À la fin, **chaque `src=`/`href=` local des quatre pages est résolu sur le
disque**, commentaires HTML et corps de `<script>` retirés : un fichier manquant
fait échouer le build. Une image absente dans une application installée est une
chose qu'on ne découvre qu'après la livraison.

### Les polices ne sont copiées qu'une fois

`superprint/CSS/fonts/` pèse **19,8 Mo**, dont **19,6 Mo sont octet pour octet
déjà présents** dans `app/CSS/fonts/` (mesuré le 2026-10-13 : 176 fichiers sur
185). Le script réécrit donc la feuille copiée pour pointer sur la copie déjà
là, et ne copie réellement que les 9 fichiers sans équivalent. Sans cela, chaque
téléchargement paierait deux fois les mêmes polices.

> ⚠️ 27 des 117 polices demandées par `superprint/CSS/fonts.css` **n'existent
> pas** (`bricolage-4..12`, `newsreader-4..12`, `spacegrotesk-4..12` — seuls les
> rangs 1 à 3 sont livrés). C'est un **défaut préexistant du site**, que le
> script **signale** à chaque build sans le transformer en échec.

## Compiler

### Prérequis

| Système | Outils |
|---|---|
| Windows | Rust, Node ≥ 20, et les **C++ build tools** de Visual Studio |
| macOS | Rust, Node ≥ 20, Xcode Command Line Tools |
| Linux | Rust, Node ≥ 20, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf` |

### Windows

```powershell
.\scripts\build-windows.ps1                 # installeur NSIS + MSI
.\scripts\build-windows.ps1 -Bundles nsis   # installeur NSIS seul
.\scripts\build-windows.ps1 -NoBundle       # binaire seul, sans installeur
```

Le script choisit tout seul son éditeur de liens : **MSVC** s'il est présent
(voie standard), sinon **MinGW-w64 GCC** — auquel cas il bascule Rust sur la
cible `stable-x86_64-pc-windows-gnu`. Il faut alors un MinGW **avec GCC** :

```powershell
winget install BrechtSanders.WinLibs.POSIX.UCRT
```

> ⚠️ **LLVM-MinGW ne suffit pas.** Il ne fournit pas `libgcc`, que la cible GNU
> de Rust réclame (`-lgcc`, `-lgcc_eh`) : la compilation échoue à l'édition de
> liens. C'est GCC qu'il faut, pas clang.

`frontend/` est reconstruit automatiquement avant chaque compilation
(`build.beforeBuildCommand` dans `tauri.conf.json`) : il n'y a rien à lancer à
la main. Pour le seul assemblage, `node scripts/stage-frontend.mjs`.

### macOS et Linux

```bash
npm install
npx tauri build
```

> Chaque système ne produit que **ses** paquets : un `.dmg` exige macOS, un
> `.AppImage` exige Linux. Depuis Windows on ne peut donc obtenir que le `.exe`.
> Les trois sont produits ensemble par le workflow
> [`.github/workflows/build-desktop.yml`](../.github/workflows/build-desktop.yml).

## Sorties

| Fichier | Système |
|---|---|
| `src-tauri/target/release/superprint-desktop.exe` | Windows — exécutable nu |
| `src-tauri/target/release/bundle/nsis/SuperPrint_<version>_x64-setup.exe` | Windows — installeur |
| `src-tauri/target/release/bundle/msi/SuperPrint_<version>_x64_en-US.msi` | Windows — paquet MSI |
| `src-tauri/target/release/bundle/dmg/SuperPrint_<version>_<arch>.dmg` | macOS |
| `src-tauri/target/release/bundle/appimage/SuperPrint_<version>_amd64.AppImage` | Linux |
| `src-tauri/target/release/bundle/deb/SuperPrint_<version>_amd64.deb` | Linux (Debian/Ubuntu) |

Ordre de grandeur mesuré le 2026-10-13 (Windows, NSIS) : `frontend/` **61,3 Mo**
→ binaire **33 Mo**, installeur **32 Mo**.

## Téléchargement publié

Le workflow renomme les paquets en noms **fixes**, sans numéro de version, et les
attache à la version `desktop-latest` du dépôt. Le menu **« Télécharger »** de la
barre de navigation pointe dessus — et c'est **la seule** adresse des fichiers :
ils ne sont écrits nulle part ailleurs dans le site.

```
https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Windows-x64-setup.exe
https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-macOS-AppleSilicon.dmg
https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-macOS-Intel.dmg
https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Linux-x86_64.AppImage
https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Linux-x86_64.deb
```

Ces adresses ne répondent qu'après le **premier passage** du workflow :
`Actions → Application de bureau → Run workflow`.

## Signer

Les paquets publiés ne sont **pas signés**. macOS affichera donc un avertissement
au premier lancement (clic droit → Ouvrir), et Windows SmartScreen en fera autant.

- **macOS** : certificateur Apple Developer ID + notarisation (`APPLE_CERTIFICATE`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` lus par Tauri).
- **Windows** : certificat de signature de code (`bundle.windows.certificateThumbprint`
  ou les variables `TAURI_SIGNING_*`).

## Licence

`LicenseRef-Proprietary` — voir [`LICENSE`](LICENSE).
