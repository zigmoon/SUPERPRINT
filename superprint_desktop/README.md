# Applications de bureau SuperPrint

Trois applications, un seul projet [Tauri](https://tauri.app). La coquille
n'ajoute aucune fonction : elle ouvre les applications web existantes dans la
**webview du système** (WebView2 sous Windows, WKWebView sous macOS, WebKitGTK
sous Linux) et les **embarque dans le binaire**, de sorte que tout fonctionne
hors-ligne, sans serveur et sans compte.

| Application | Embarque | Installeur Windows |
|---|---|---|
| **SuperPrint** | l'éditeur de PAO complet | 31,5 Mo |
| **Studio IA** | la mise en page assistée par IA | 8,3 Mo |
| **SuperTyPo** | la décomposition de caractères | 1,7 Mo |

**Trois paquets séparés, et non un paquet qui contient tout.** Ce n'est pas une
commodité : l'éditeur pèse 57,9 Mo, le Studio 9,8 Mo et SuperTyPo 1,0 Mo. Un
paquet unique en aurait livré 68,7 Mo d'un bloc — et 183,6 Mo si les trois
avaient chacun tout embarqué. Aucune des trois applications ne renvoie vers une
des deux autres (vérifié) : chacune est complète et indépendante.

Les trois applications sont **le même code Rust**, compilé trois fois avec trois
surcouches de configuration. Un correctif dans la coquille profite donc aux
trois, sans être écrit trois fois.

Le front-end n'est **pas copié** dans ce dossier : `scripts/prepare-bundle.mjs`
l'assemble au moment de la compilation, depuis `../superprint/`. Il n'y a donc
**une seule** application à maintenir — une correction dans `superprint/app` se
retrouve dans le bureau au build suivant.

```
superprint_desktop/
├── package.json                 CLI Tauri (devDependency)
├── scripts/
│   ├── prepare-bundle.mjs       assemble frontend/<app>/ depuis ../superprint/
│   └── build-windows.ps1        recette de compilation Windows
├── frontend/                    FABRIQUÉ, jamais versionné
│   ├── superprint/               57,9 Mo — l'éditeur
│   ├── studio/                    9,8 Mo — le Studio IA
│   └── supertypo/                 1,0 Mo — SuperTyPo
└── src-tauri/
    ├── Cargo.toml               dépendances Rust (tauri 2)
    ├── build.rs                 appelé par tauri-build
    ├── tauri.conf.json          ce qui est COMMUN aux trois
    ├── apps/superprint.json     surcouches : identité, icônes, dossier, page
    ├── apps/studio.json
    ├── apps/supertypo.json
    ├── capabilities/            autorisations de la fenêtre
    ├── icons/{superprint,studio,supertypo}/   trois jeux, engendrés
    └── src/main.rs              ouverture de la fenêtre — et rien d'autre
```

## Ce que chaque paquet contient

`prepare-bundle.mjs <app>` fabrique `frontend/<app>/` et **vérifie son propre
résultat**. Ce que chaque application réclame a été mesuré page par page, en
résolvant ses propres `src=` / `href=` — ce n'est pas une liste devinée.

| Paquet | Contenu | Poids |
|---|---|---|
| `superprint` | `app/` **entier**, plus `superprint/icons/` (ses pages remontent à `../icons/`), plus `icons/` | 57,9 Mo |
| `studio` | `sp213-studio.html` en `index.html`, `JS/fabric.min.js`, `icons/`, `favicon.png`, la feuille de polices du site **avec toutes ses polices** | 9,8 Mo |
| `supertypo` | `supertypo/`, plus `icons/` — entièrement autonome | 1,0 Mo |

> ⚠️ **`app/` N'EST PAS APLATI À LA RACINE.** Ses pages référencent
> `../icons/studio_print_logo_blanc.svg` et `../icons/sper_typo.svg`. Aplati, ce
> `../icons/` sortirait du dossier embarqué et les deux logotypes disparaîtraient
> **sans bruit** : le script refuserait même de construire (voir la vérification
> des références ci-dessous).

> ⚠️ **Le Studio garde toutes les polices.** Il laisse choisir la police du
> texte : un sous-ensemble donnerait un rendu de repli silencieux, la pire des
> pannes — celle qu'on ne voit pas.

### Les polices ne sont copiées qu'une fois

Dans le paquet de l'éditeur, `CSS/fonts.css` pointerait vers des fichiers déjà
présents dans `app/CSS/fonts/` : **19,6 Mo sur 19,8 Mo** y sont octet pour octet
identiques (mesuré le 2026-10-13 : 176 fichiers sur 185). Le script réécrit donc
la feuille pour réutiliser la copie déjà là, et ne copie réellement que les 9
fichiers sans équivalent.

> ⚠️ 27 des 117 polices demandées par `superprint/CSS/fonts.css` **n'existent
> pas** (`bricolage-4..12`, `newsreader-4..12`, `spacegrotesk-4..12` — seuls les
> rangs 1 à 3 sont livrés). C'est un **défaut préexistant du site**, que le
> script **signale** à chaque build sans le transformer en échec.

### Le service worker est retiré

**Une application de bureau ne doit pas avoir de service worker.** Il n'y apporte
rien — les fichiers sont déjà dans le binaire — et il peut faire beaucoup de
mal, parce qu'il **survit aux mises à jour** : il vit dans le profil du
navigateur, pas dans l'application.

C'est arrivé. Mesuré le 2026-10-13 sur l'application installée : le service
worker servait son cache à la place des fichiers réels — la racine renvoyait un
éditeur de **565 907 octets** au lieu de la page attendue, et `/CSS/main.css`
renvoyait un fichier inexistant à cette adresse. Résultat : **un écran sans CSS
ni JavaScript**, et aucune mise à jour possible tant que le cache restait en
place.

Le script écrit donc trois choses, et pas une de moins :

| Fichier | Rôle |
|---|---|
| la **purge**, inline dans la page d'entrée | désenregistre tout service worker et vide tous les caches — c'est elle qui RÉPARE les installations déjà abîmées |
| `service-worker.js` (racine du paquet) | un désinstalleur, à l'adresse même du service worker fautif : il prend sa place, vide son cache et disparaît |
| `app/service-worker.js` + `app/JS/pwa.js` | un désinstalleur, et la neutralisation du fichier qui **déclenche** l'enregistrement |

> ⚠️ **La purge doit rester INLINE.** Placée dans un fichier séparé, elle serait
> elle-même servie par le cache empoisonné qu'elle doit supprimer.
>
> Elle ne peut pas boucler : elle ne recharge la page qu'une fois par session, et
> renonce si `sessionStorage` n'est pas disponible. Au pire, elle ne recharge pas
> — le lancement suivant est propre.

Le site public, lui, **garde sa PWA intacte** : tout ceci ne touche que les
copies embarquées.

### Les surcouches sont vérifiées avant toute compilation

`--config src-tauri/apps/<app>.json` est fusionné à `tauri.conf.json` à la
manière d'un « merge patch » JSON : **les objets fusionnent, les tableaux sont
remplacés en bloc**. `app.windows` étant un tableau, chaque surcouche doit donc
redonner la fenêtre entière — et c'est exactement le genre de duplication qui se
met à diverger sans que personne ne s'en aperçoive.

Le script refuse donc de compiler si :

- les trois fenêtres ne sont pas identiques hors `title` et `url` ;
- deux surcouches partagent un `identifier` (elles écraseraient les données de
  l'une et de l'autre) ;
- `beforeBuildCommand` ne désigne pas la **même** application que `frontendDist`
  — une surcouche copiée d'une autre produirait un paquet nommé « Studio IA » qui
  contient l'éditeur : fichier valide, installation réussie, personne ne le voit ;
- la documentation annoncée dans `deb.files` ne va pas dans
  `/usr/share/doc/<nom-du-paquet>/`. **Tauri n'offre aucune option pour nommer un
  paquet `.deb`** : le nom est le kebab-case du `productName`. Rien ne vérifie
  qu'une adresse écrite à la main corresponde, et `copy_custom_files` crée le
  dossier demandé sans broncher — une adresse fausse déposerait la documentation
  dans un dossier que personne ne lit ;
- une icône annoncée n'existe pas sur le disque.

### Chaque référence est résolue après l'assemblage

À la fin, **chaque `src=` / `href=` local des pages embarquées est résolu sur le
disque**, commentaires HTML et corps de `<script>` retirés (sinon une référence
éteinte dans un commentaire, ou une expression rationnelle dans un script,
feraient échouer la compilation pour rien). Un fichier manquant fait **échouer**
la compilation : une image absente dans une application installée est une chose
qu'on ne découvre qu'après la livraison.

## Compiler

### Prérequis

| Système | Outils |
|---|---|
| Windows | Rust, Node ≥ 20, et les **C++ build tools** de Visual Studio |
| macOS | Rust, Node ≥ 20, Xcode Command Line Tools |
| Linux | Rust, Node ≥ 20, `libwebkit2gtk-4.1-dev`, `libappindicator3-dev`, `librsvg2-dev`, `patchelf`, `rpm` |

### Windows

```powershell
.\scripts\build-windows.ps1                     # les trois, installeur NSIS + MSI
.\scripts\build-windows.ps1 -App studio         # le Studio IA seul
.\scripts\build-windows.ps1 -Bundles nsis       # installeur NSIS seul
.\scripts\build-windows.ps1 -App supertypo -NoBundle
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

`frontend/<app>/` est reconstruit automatiquement avant chaque compilation
(`build.beforeBuildCommand`, propre à chaque surcouche) : il n'y a rien à lancer
à la main. Pour le seul assemblage : `node scripts/prepare-bundle.mjs studio`.

### macOS et Linux

```bash
npm install
npx tauri build --config src-tauri/apps/superprint.json
```

> Chaque système ne produit que **ses** paquets : un `.dmg` exige macOS, un
> `.AppImage` exige Linux. Depuis Windows on ne peut donc obtenir que le `.exe`.
> Les neuf sont produits ensemble par le workflow
> [`.github/workflows/build-desktop.yml`](../.github/workflows/build-desktop.yml).

### Les icônes

Les icônes des trois systèmes sont **engendrées**, jamais dessinées à la main.
Chaque application a la sienne, tirée du **pack de marque**
(`superprint/logos_superprint.zip`).

| Application | Source |
|---|---|
| SuperPrint | `icons/sources/superprint-1024.png` |
| Studio IA | `icons/sources/studio-1024.png` |
| SuperTyPo | `icons/sources/supertypo-1024.png` |

Les trois sources sont **versionnées**, extraites du pack de marque
(`superprint/logos_superprint.zip`) : la recette se rejoue donc telle quelle,
sans dépendre d'un fichier qui pourrait disparaître. Ce sont des copies, pas des
originaux — le pack reste la référence.

```bash
npx tauri icon src-tauri/icons/sources/studio-1024.png -o src-tauri/icons/studio
rm -rf src-tauri/icons/studio/android src-tauri/icons/studio/ios
```

> ⚠️ **LA SOURCE DOIT FAIRE 1024 px.** Avec une source de 512, `tauri icon`
> **agrandit** pour remplir les planches Retina du `.icns` : la planche
> 1024×1024 (`ic10`) existe dans les deux cas, mais elle est floue. Mesuré au
> Laplacien : **1,99** depuis une source 512, **4,44** depuis la source native
> 1024 — **2,2× plus nette**.

Ce que produit `tauri icon` :

| Fichier | Pour |
|---|---|
| `icons/<app>/icon.ico` | Windows — **6 tailles** : 16, 24, 32, 48, 64, **256** |
| `icons/<app>/icon.icns` | macOS — **12 planches**, dont `ic10` (**1024×1024**, Retina) |
| `icons/<app>/icon.png`, `32x32`, `128x128`, `128x128@2x` | Linux — et fenêtre |
| `icons/<app>/Square*.png`, `StoreLogo.png` | Windows Store (inutilisés ici) |

> ⚠️ **L'ICÔNE DE L'INSTALLEUR DOIT ÊTRE NOMMÉE.** `bundle.windows.nsis.installerIcon`
> est écrit **explicitement dans chaque surcouche**. Sans lui, le
> `…_x64-setup.exe` — le fichier qu'on voit dans son dossier de téléchargements —
> portait **une autre image** que l'application : mesuré **70,8** d'écart moyen
> par canal avec l'icône du binaire, contre **17,8** une fois la clé posée (même
> valeur que le binaire, donc même icône).

## Sorties

Pour chaque application `<app>` ∈ { `superprint`, `studio`, `supertypo` } :

| Fichier | Système |
|---|---|
| `src-tauri/target/release/superprint-desktop.exe` | Windows — exécutable nu |
| `bundle/nsis/SuperPrint_<version>_x64-setup.exe` | Windows — installeur |
| `bundle/msi/SuperPrint_<version>_x64_en-US.msi` | Windows — paquet MSI |
| `bundle/dmg/….dmg` | macOS — une par architecture |
| `bundle/appimage/….AppImage` | Linux |
| `bundle/deb/….deb` | Linux (Debian/Ubuntu) |
| `bundle/rpm/….rpm` | Linux (Fedora/RHEL/openSUSE) |

Le nom du fichier est celui du `productName` de la surcouche : `SuperPrint`,
`Studio IA`, `SuperTyPo`. Le nom du **paquet** `.deb` est son kebab-case :
`super-print`, `studio-ia`, `super-ty-po`.

Ordre de grandeur mesuré le 2026-10-13 (Windows, NSIS) :

| Application | Dossier embarqué | Binaire | Installeur |
|---|---|---|---|
| SuperPrint | 57,9 Mo | 33,2 Mo | 31,5 Mo |
| Studio IA | 9,8 Mo | — | 8,3 Mo |
| SuperTyPo | 1,0 Mo | — | 1,7 Mo |

## Téléchargement publié

Le workflow renomme les paquets en noms **fixes**, sans numéro de version, et les
attache à la version `desktop-latest` du dépôt. Le menu **« Télécharger »** de la
barre de navigation pointe dessus — et c'est **la seule** adresse des fichiers :
ils ne sont écrits nulle part ailleurs dans le site.

**21 fichiers** : 3 applications × 7 formats.

```
SuperPrint-Windows-x64-setup.exe     Studio-IA-Windows-x64-setup.exe     SuperTyPo-Windows-x64-setup.exe
SuperPrint-Windows-x64.msi           Studio-IA-Windows-x64.msi           SuperTyPo-Windows-x64.msi
SuperPrint-macOS-AppleSilicon.dmg    Studio-IA-macOS-AppleSilicon.dmg    SuperTyPo-macOS-AppleSilicon.dmg
SuperPrint-macOS-Intel.dmg           Studio-IA-macOS-Intel.dmg           SuperTyPo-macOS-Intel.dmg
SuperPrint-Linux-x86_64.AppImage     Studio-IA-Linux-x86_64.AppImage     SuperTyPo-Linux-x86_64.AppImage
SuperPrint-Linux-x86_64.deb          Studio-IA-Linux-x86_64.deb          SuperTyPo-Linux-x86_64.deb
SuperPrint-Linux-x86_64.rpm          Studio-IA-Linux-x86_64.rpm          SuperTyPo-Linux-x86_64.rpm
```

Tous sous
`https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/`.

Ces adresses ne répondent qu'après le **premier passage** du workflow :
`Actions → Applications de bureau → Run workflow`.

## Signer

Les paquets publiés ne sont **pas signés**. macOS affichera donc un avertissement
au premier lancement (clic droit → Ouvrir), et Windows SmartScreen en fera autant.

- **macOS** : certificateur Apple Developer ID + notarisation (`APPLE_CERTIFICATE`,
  `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` lus par Tauri).
- **Windows** : certificat de signature de code (`bundle.windows.certificateThumbprint`
  ou les variables `TAURI_SIGNING_*`).

## Licence

`LicenseRef-Proprietary` — voir [`LICENSE`](../LICENSE). Les composants tiers
embarqués et leurs licences sont listés dans [`NOTICE.md`](NOTICE.md), et les
marques dans [`TRADEMARKS.md`](TRADEMARKS.md). Les deux sont livrés dans le
`.deb`, sous `/usr/share/doc/<paquet>/`.
