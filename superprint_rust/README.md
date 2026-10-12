# SuperPrint — noyau Rust

Refactoring progressif des **parties calculatoires** de SuperPrint en **Rust**,
compilable en natif *et* en **WebAssembly** pour être appelé depuis
l'application web.

> ⚠️ **Dossier indépendant.** Il ne modifie ni `superprint/` (la version
> classique, servie en production) ni `superprint_ASTRO/`. Ces deux dossiers
> sont la **référence de comportement** : on n'y touche pas.

## Pourquoi Rust

SuperPrint est une application PAO qui tourne **dans le navigateur**. Ses
parties les plus lourdes et les plus fragiles sont aujourd'hui en JavaScript :

| Domaine | Aujourd'hui | Piste Rust / WASM |
|---|---|---|
| Séparation CMJN / tons directs, PDF/X | `pdf-lib` + code maison | cœur PDF typé et testable ✅ n° 3 |
| Profil ICC | `lcms.wasm` (C compilé) | liaison sûre, ou réimplémentation |
| Images : niveaux de gris, CMJN, réduction | canvas + JS | traitement pixel par pixel ✅ n° 4 |
| Césure multilingue | `Hypher` (JS) | algorithme rapide et partagé |
| Analyse de police / métriques | `opentype.js` (JS) | parseur `TTF` performant ✅ n° 6 |
| Géométrie d'impression (fond perdu, traits, imposition) | JS | noyau déterministe et testé ✅ n° 1 |

Contexte : un **rapport de test interne** (non publié, conservé hors du dépôt)
documente les défauts **mesurés** sur la chaîne d'export PDF (fichiers de
131 Mo, mode Planches ignoré, tons directs perdus au passage par le studio…).
**C'est la cible prioritaire.**

## État actuel

**Dix-sept crates, testés et validés — dont deux modules WebAssembly réellement
chargeables par un navigateur.** La liste ci-dessous n'est pas exhaustive :
l'inventaire complet, domaine par domaine, est dans `docs/PORTAGE.md`.

- **`superprint-core`** — primitives pures : `units` (mm/pt/px/cm/in),
  `color` (RVB/CMJN/luma), `geometry` (fond perdu, traits de coupe).
- **`superprint-compress`** — **compression DEFLATE et zlib**, écrite depuis les
  RFC 1951 et 1950, sans dépendance. C'est la réponse au défaut le plus lourd du
  rapport de test interne : **la taille des fichiers**. `RunLength` ne gagnait
  rien sur une photographie ni sur du vectoriel dense ; Flate, si — mesuré :
  **108×** sur un flux de contenu, **2,4×** sur le module `.wasm` livrable.
  Le décompresseur est **complet** (blocs stockés, Huffman figé **et dynamique**),
  donc tout flux PDF venu d'ailleurs se relit. Le compresseur emploie le Huffman
  **figé** : c'est une limite assumée, chiffrée (≈ 4 % de plus que `zlib` sur le
  corpus, jusqu'à 4× sur un aplat), écrite dans `docs/PORTAGE.md`.
- **`superprint-font`** — **module n° 6** : **analyse de police**. Lit un
  fichier TrueType (`sfnt`) depuis ses tables, **sans jamais dépasser les
  bornes** : répertoire de tables, `.head` (unités, cadre, italique), `.hhea` et
  `.hmtx` (avances), `.maxp` (nombre de glyphes), `.name` (famille, style, nom
  PostScript) et surtout **`.cmap`** — formats 0, 4, 6 et 12, avec la règle exacte
  d'`idRangeOffset`. C'est la pièce sans laquelle un PDF ne peut pas écrire de
  texte : en `Identity-H`, un flux PDF ne porte pas des caractères mais des
  **identifiants de glyphe**, et seule la `cmap` sait que `é` vaut 231 dans une
  police donnée. Les formats à contours **CFF** (`OTTO`), les collections
  (`.ttc`) et les polices compressées (`woff`) sont **refusés explicitement**,
  avec un message qui dit quoi faire.
- **`superprint-text`** — **module n° 5** : **césure et composition**. Le moteur
  de **Liang** (les motifs de césure de TeX, ceux de `hypher.js`) et les
  **règles typographiques françaises** portées depuis `main.js`, chacune
  documentée par le cas réel qui l'avait motivée. Plus la découpe en lignes, avec
  la mesure **injectée** (elle dépend de la police, pas du noyau). Aucun
  dictionnaire n'est embarqué : les motifs sont des données de langue, fournies
  dans l'un des deux formats que le crate sait lire — dont celui du dépôt.
- **`superprint-pdf`** — **module n° 3** : **tons directs & exporteur PDF**.
  Chaînes `/Separation` nommées, fonction de teinte, pile de couleurs
  (quadri CMJN/RVB + encres), boîtes de page (`MediaBox`/`TrimBox`/`BleedBox`)
  et **exporteur de document** (`document.rs`) : plusieurs pages de formats
  différents, formes vectorielles (rectangle, cercle, polygone, segment) en
  remplissage ou contour, tons directs **avec teintes**, images grises ou RVB
  placées et mises à l'échelle, **texte dans une police embarquée**, métadonnées
  en PDFDocEncoding, traits de coupe et `OutputIntent` avec profil ICC fourni.
  Les images choisissent d'elles-mêmes le plus petit des trois encodages —
  aucun filtre, `RunLength`, `Flate` — de sorte qu'un PDF **ne peut pas** être
  plus gros que les pixels qu'il contient.
  Le texte part en polices **composites** (`/Type0` + `/Identity-H` +
  `/CIDFontType2` + `/FontFile2`), avec les largeurs `/W` des seuls glyphes
  réellement employés et une table **`/ToUnicode`** — c'est elle qui rend le
  texte **sélectionnable, copiable et cherchable**, et elle est vérifiée à
  l'extraction par un lecteur indépendant.
- **`superprint-image`** — **module n° 4** : **traitement d'image**. Tampons
  typés RVB/gris, **réduction** bilinéaire ou plus proche voisin, ciblage DPI,
  filtre PDF **RunLength**.
- **`superprint-doc`** — **import de documents et de dessin**. Les formats
  documentaires `.docx`, `.odt` et `.idml`, analysés depuis le conteneur ZIP
  (`superprint-zip`) : paragraphes, styles, niveau de titre, listes, tableaux,
  images et format de page, chaînables vers la pagination. Et le **dessin SVG** :
  les commandes de chemin de la spécification (`M L H V C S Q T A Z`, absolues et
  relatives), `rect` à coins arrondis, `circle`, `ellipse`, `line`, `polyline`,
  `polygon`, `transform`, unités CSS, attributs de présentation hérités — les
  courbes **aplaties** par la même géométrie que l'interpréteur PostScript, dans le
  repère du canevas. Ce dont l'ignorance **perdrait du dessin** est refusé en le
  nommant (`image`, `use`, dégradés, `clip-path`, feuille `<style>`), et ce qui
  **décrit sans dessiner** est compté. Le contrôle confronte le noyau à un lecteur
  écrit à part sur **40 SVG réels du dépôt, 172 formes, 10 404 sommets**.
- **`superprint-wasm`** — **la frontière C**, et le seul crate en `cdylib` :
  c'est lui qui produit le `.wasm` du navigateur. **32 fonctions** exposées
  (unités, couleurs sur octets, luminance, RunLength, réduction, page de
  démonstration, document complet **et texte**),
  **aucun import** — donc `WebAssembly.instantiate(bytes, {})` suffit, sans
  WASI ni fonction hôte. Pas de `wasm-bindgen` : la frontière est écrite à la
  main pour tenir la règle « zéro dépendance ».

> ✅ **Vérifié** : `cargo fmt --check`, `cargo check --all-targets`,
> `cargo clippy --all-targets -- -D warnings`, `cargo build --target
> wasm32-unknown-unknown`, et **963 tests unitaires** (`superprint-compress` 36,
> `superprint-core` 37, `superprint-doc` 120, `superprint-eps-wasm` 5,
> `superprint-flow` 51, `superprint-font` 31, `superprint-icc` 21,
> `superprint-image` 110, `superprint-impose` 35, `superprint-path` 94,
> `superprint-pdf` 109, `superprint-preflight` 45, `superprint-ps` 86,
> `superprint-swatch` 46, `superprint-text` 73, `superprint-wasm` 38,
> `superprint-zip` 26) — tous verts.
>
> Le module livrable est construit dans **`dist/superprint_core.wasm`** (≈ 380 Ko),
> chargé **sans le moindre import**, et validé sur huit points :
>
> - **parité croisée** — sur 250 000 pixels, RVB→CMJN, CMJN→RVB et la luminance
>   sont **identiques au bit près** à l'implémentation écrite à la main en WAT
>   (`superprint_asm/dist/`). Deux implémentations indépendantes, chargées de la
>   même façon ;
> - **RunLength** — le flux produit est relu à l'identique par un décodeur écrit
>   **depuis l'ISO 32000-2**, pas depuis le code Rust ;
> - **page de démonstration** — deux PDF écrits depuis le module et relus par
>   **pdf-lib** : 196×266 mm, 2 `/Separation`, et une image XObject de
>   1004×1418 px dont le flux fait **22 468 octets au lieu des 1 423 672 octets
>   de pixels bruts** (×63) ;
> - **document complet** — un PDF de 2 pages (vectoriel, 2 tons directs teintés,
>   image placée, métadonnées) écrit depuis le **navigateur**, puis relu par
>   pdf-lib : 2 pages, 2 `/Separation`, titre accentué intact ;
> - **texte** — une vraie police TrueType du dépôt est embarquée, du texte est
>   composé, et **`pdf.js` (Mozilla) relit les caractères en clair**, accents,
>   apostrophe typographique et tiret cadratin compris. C'est cette relecture qui
>   prouve que `/ToUnicode` est juste : sans elle, le PDF s'afficherait sans
>   qu'aucun lecteur ne puisse extraire un mot ;
> - **césure** — les deux moteurs, le Rust et celui du produit (`hypher.js` +
>   les règles françaises de `main.js`, lus **sans être modifiés**), sont
>   comparés **mot pour mot** sur 2 597 mots de prose française et 84 cas
>   pièges : les six valeurs comparées sont identiques ;
> - **compression** — le codec DEFLATE est confronté au **`zlib` de Node**, dans
>   les deux sens, sur 15 jeux ; les flux abîmés sont refusés nommément ;
> - **import SVG** — un lecteur écrit à part (son analyseur XML, son lecteur de
>   `d`, sa matrice, ses arcs, son aplatissement) donne **les mêmes 10 404
>   sommets à 5e-10 près** sur les 40 SVG réels du dépôt, et la table des couleurs
>   nommées est relevée de `jspdf.umd.min.js`, un par un.
>
> Un `pwsh -File scripts/check.ps1` enchaîne tout, validation comprise.

Aucun module n'est encore appelé par l'application, **sauf trois** : la césure, la
conversion RVB → CMJN et l'import PostScript, branchés sans modifier `main.js`
(voir `docs/PORTAGE.md`, section F). **Le reste du branchement est prêt** :
`web/superprint-core.js` charge le noyau et expose des fonctions simples, avec un
**repli JavaScript** dont la parité est mesurée octet pour octet. Voir
`web/BRANCHEMENT.md`.

Le noyau représente à ce jour **37,4 %** du JavaScript applicatif de
SuperPrint — en lignes, c'est le plus trompeur des quatre chiffres qui mesurent
l'avancement : `docs/PORTAGE.md` les donne tous les quatre, avec l'inventaire
**étape par étape, fonction par fonction**, ce qui est porté, ce qui reste à
porter, et ce qui **ne doit pas** l'être (interface, WebGL, WebRTC, service
worker, moteurs C compilés).

## Prérequis

```powershell
# 1. Installer Rust (rustup)
winget install --id Rustlang.Rustup

# 2. Ajouter les cibles : navigateur + tests
rustup target add wasm32-unknown-unknown wasm32-wasip1
```

`wasm-pack` **n'est pas nécessaire** : il sert à `wasm-bindgen`, que ce workspace
n'utilise pas.

## ⚠️ État de la chaîne de build (Windows)

**Smart App Control** est **désactivé** (`VerifiedAndReputablePolicyState = 0`) :
`cargo` et le linker WebAssembly fonctionnent.

| Commande | État |
|---|---|
| `cargo check` · `cargo clippy` · `cargo fmt` | ✅ |
| `cargo build --target wasm32-unknown-unknown` | ✅ (cible du produit) |
| `cargo test --target wasm32-wasip1` | ✅ **les tests tournent** (via WebAssembly, sans linker natif) |
| `cargo test` (natif) | ❌ nécessite le linker **MSVC** (`link.exe`) |

**Astuce** : là où Visual Studio manque, les tests s'exécutent **en WebAssembly**
via `--target wasm32-wasip1` (lancés par Node). Le fichier `.cargo/config.toml`
branche le lanceur ; voir `scripts/run-wasi.mjs`.

Pour les **tests natifs**, installer les **Build Tools C++** (niveau machine →
**PowerShell en administrateur**) :

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools `
  --accept-package-agreements --accept-source-agreements `
  --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

## Structure

```
superprint_rust/
├─ .cargo/config.toml         lanceur WASI pour `cargo test --target wasm32-wasip1`
├─ Cargo.toml                 espace de travail (workspace)
├─ rust-toolchain.toml        version et cibles (stable + wasm32 + wasip1)
├─ dist/
│  └─ superprint_core.wasm    LE MODULE LIVRABLE — à rebâtir (non versionné,
│                             comme superprint_asm/dist/, via build-wasm.ps1)
├─ web/                       ← LE BRANCHEMENT
│  ├─ superprint-core.js      la colle : chargement, fonctions amicales, repli
│  ├─ demo.html / demo.js     banc d'essai navigateur (27 mesures)
│  └─ BRANCHEMENT.md          comment l'utiliser, comment l'activer dans l'app
├─ docs/PLAN.md               feuille de route, inventaire, décisions
├─ scripts/
│  ├─ build-wasm.ps1          construit dist/superprint_core.wasm (release)
│  ├─ check.ps1               chaîne complète : fmt, check, clippy, wasm, tests, PDF
│  ├─ demo-image.ps1          produit deux PDF réels et les valide avec pdf-lib
│  ├─ demo-wasm.ps1           module wasm : charge, parité, PDF, pdf-lib
│  ├─ demo-web.ps1            colle : parité du repli, garde-fous, document, pdf-lib
│  ├─ run-wasi.mjs            exécute un binaire wasm32-wasip1 via Node
│  ├─ serve-web.mjs           serveur local pour le banc d'essai navigateur
│  ├─ validate-pdf.mjs        relit un PDF avec pdf-lib (pages, tons directs, image)
│  ├─ validate-text.mjs       relit le TEXTE avec pdf.js (police, /ToUnicode)
│  ├─ validate-cesure.mjs     compare la CESURE au moteur JavaScript du produit
│  ├─ validate-compression.mjs confronte le codec DEFLATE au zlib de Node
│  ├─ validate-wasm.mjs       charge le .wasm sans import et mesure la parité
│  └─ validate-web.mjs        valide la colle, son repli, le document et ses garde-fous
└─ crates/
   ├─ superprint-core/        primitives pures (units, color, geometry, color8)
   ├─ superprint-compress/    DEFLATE et zlib, écrits depuis les RFC
   ├─ superprint-font/        analyse de police TrueType (module n° 6)
   ├─ superprint-image/       traitement d'image (module n° 4)
   ├─ superprint-pdf/         tons directs & écriture PDF (module n° 3)
   ├─ superprint-text/        césure et composition (module n° 5)
   └─ superprint-wasm/        frontière C → dist/superprint_core.wasm (cdylib)
```

## Vérifier

```powershell
cd superprint_rust

# Tout, d'un seul coup : formatage, types, lint, WebAssembly, tests, et
# production + validation de SIX PDF réels par pdf-lib, plus la relecture du
# texte composé par pdf.js.
pwsh -File scripts/check.ps1
```

Équivalent détaillé :

```powershell
cargo check --workspace --all-targets
cargo clippy --workspace --all-targets -- -D warnings
cargo fmt --check
cargo build --workspace --target wasm32-unknown-unknown
cargo test --target wasm32-wasip1 -- --test-threads=1

# Preuve bout en bout : image → PDF, puis relecture par pdf-lib.
pwsh -File scripts/demo-image.ps1

# Preuve du MODULE LIVRABLE : construction, chargeabilité sans import,
# parité Rust/WAT, écriture PDF, puis relecture par pdf-lib.
pwsh -File scripts/build-wasm.ps1
node scripts/validate-wasm.mjs
node scripts/validate-pdf.mjs wasm-page.pdf --mm=196x266 --spots=2
node scripts/validate-pdf.mjs wasm-page-image.pdf --mm=196x266 --spots=2 --image=1004x1418

# Preuve du BRANCHEMENT : la colle charge le noyau, tient la parité avec son
# repli JavaScript, refuse les entrées illisibles, et ses PDF sont relus.
node scripts/validate-web.mjs
node scripts/validate-pdf.mjs web-page.pdf --mm=196x266 --spots=2
node scripts/validate-pdf.mjs web-page-image.pdf --mm=196x266 --spots=2 --image=1004x1418
node scripts/validate-pdf.mjs web-page-document.pdf --mm=196x266 --spots=2 --pages=2
node scripts/validate-pdf.mjs web-page-text.pdf --mm=196x266 --spots=1 --pages=1

# Preuve du TEXTE : une vraie police TrueType est embarquée, du texte est
# composé, et pdf.js (Mozilla) doit RELIRE les caractères en clair — accents,
# apostrophe typographique et tiret cadratin compris. C'est la table /ToUnicode
# qui le permet : sans elle, le PDF s'affiche sans être extractible.
node scripts/validate-text.mjs

# Preuve de la CÉSURE : les deux moteurs — celui du produit (hypher.js et les
# règles françaises de main.js, lus sans être modifiés) et celui du noyau —
# sont comparés mot pour mot sur du vrai texte français.
node scripts/validate-cesure.mjs

# Preuve de la COMPRESSION : le codec DEFLATE est confronté au zlib de Node,
# dans les deux sens, et doit refuser tout flux abîmé.
node scripts/validate-compression.mjs

# Banc d'essai NAVIGATEUR (27 mesures ; le fetch du .wasm est refusé en file://)
node scripts/serve-web.mjs
# puis ouvrir http://127.0.0.1:8777/superprint_rust/web/demo.html
```

## Utiliser le module depuis une page web

```js
const bytes = await (await fetch('superprint_core.wasm')).arrayBuffer();
const { instance } = await WebAssembly.instantiate(bytes, {}); // aucun import
const { memory, sp_alloc, sp_free, sp_rgb_to_cmyk } = instance.exports;

const n = 1024;
const src = sp_alloc(n * 3);
const dst = sp_alloc(n * 4);
// ⚠️ `memory.buffer` est détaché dès qu'une fonction Rust agrandit la mémoire :
//    on reconstruit la vue APRÈS l'allocation, jamais avant.
new Uint8Array(memory.buffer, src, n * 3).set(pixelsRvb);
const code = sp_rgb_to_cmyk(src, dst, n); // 0 = succès
const cmyk = new Uint8Array(memory.buffer, dst, n * 4);
sp_free(src, n * 3);
sp_free(dst, n * 4);
```

Pour du **texte**, trois appels suffisent : embarquer une police TrueType, la
citer dans une opération `text`, écrire.

```js
const core = await SuperPrintCore.load({ bytes: wasm });
const doc = core.createDocument();
doc.addPage({ trimWidthMm: 170, trimHeightMm: 240 });
doc.addFont(await core.loadFont('fonts/IBMPlexSans-400-normal.ttf'));
const f = 0; // rang rendu par addFont
doc.text({ font: f, size: 12, x: 20, y: 200, text: 'café — déjà vu',
           paint: { cmyk: { c: 0, m: 0, y: 0, k: 1 } } });
const pdf = doc.write();
doc.substitutions(); // 0 = toutes les lettres s'imprimeront
```

Deux points à connaître :

- **la police est embarquée en entier.** Le sous-ensemble (ne garder que les
  glyphes utilisés) n'est **pas** fait : le fichier est plus lourd, mais aucun
  glyphe ne peut manquer. C'est un chantier à part, noté dans `docs/PLAN.md` ;
- **`substitutions()` compte les lettres que la police n'a pas su dessiner.**
  Un PDF peut s'écrire et être incomplet : ce compteur le dit au lieu de laisser
  un blanc inexpliqué sur la plaque.

## Relation au reste du dépôt

- `superprint/` — version classique (HTML/CSS/JS + PHP), **référence**, non modifiée.
- `superprint_ASTRO/` — version Astro du site, **référence**, non modifiée.
- `superprint_rust/` — **ce dossier** : noyau Rust/WASM, isolé au départ.

## Licence

**AGPL-3.0-or-later** — la même que le reste du produit (voir `../superprint/LICENSE`).
