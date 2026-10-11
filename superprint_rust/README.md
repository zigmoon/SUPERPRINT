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
| Analyse de police / métriques | `opentype.js` (JS) | parseur `TTF`/`CFF` performant |
| Géométrie d'impression (fond perdu, traits, imposition) | JS | noyau déterministe et testé ✅ n° 1 |

Contexte : un **rapport de test interne** (non publié, conservé hors du dépôt)
documente les défauts **mesurés** sur la chaîne d'export PDF (fichiers de
131 Mo, mode Planches ignoré, tons directs perdus au passage par le studio…).
**C'est la cible prioritaire.**

## État actuel

**Quatre crates, testés et validés — dont un module WebAssembly réellement
chargeable par un navigateur.**

- **`superprint-core`** — primitives pures : `units` (mm/pt/px/cm/in),
  `color` (RVB/CMJN/luma), `geometry` (fond perdu, traits de coupe).
- **`superprint-pdf`** — **module n° 3** : **tons directs & écriture PDF**.
  Chaînes `/Separation` nommées, fonction de teinte, pile de couleurs
  (quadri CMJN/RVB + encres), boîtes de page (`MediaBox`/`TrimBox`/`BleedBox`)
  et assemblage d'un **PDF 1.7 d'une page** portant réellement les plaques.
- **`superprint-image`** — **module n° 4** : **traitement d'image**. Tampons
  typés RVB/gris, **réduction** bilinéaire ou plus proche voisin, ciblage DPI,
  filtre PDF **RunLength**. C'est la réponse au « PDF de 131 Mo » : les pixels
  arrivent **réduits** et repartent **compressés**.
- **`superprint-wasm`** — **la frontière C**, et le seul crate en `cdylib` :
  c'est lui qui produit le `.wasm` du navigateur. 19 fonctions exposées
  (unités, couleurs sur octets, luminance, RunLength, réduction, écriture PDF),
  **aucun import** — donc `WebAssembly.instantiate(bytes, {})` suffit, sans
  WASI ni fonction hôte. Pas de `wasm-bindgen` : la frontière est écrite à la
  main pour tenir la règle « zéro dépendance ».

> ✅ **Vérifié** : `cargo fmt --check`, `cargo check --all-targets`,
> `cargo clippy --all-targets -- -D warnings`, `cargo build --target
> wasm32-unknown-unknown`, et **70 tests unitaires** (`superprint-core` 12,
> `superprint-image` 16, `superprint-pdf` 37, `superprint-wasm` 5) — tous verts.
>
> Le module livrable est construit dans **`dist/superprint_core.wasm`** (≈ 110 Ko),
> chargé **sans le moindre import**, et validé sur trois points :
>
> - **parité croisée** — sur 250 000 pixels, RVB→CMJN, CMJN→RVB et la luminance
>   sont **identiques au bit près** à l'implémentation écrite à la main en WAT
>   (`superprint_asm/dist/`). Deux implémentations indépendantes, chargées de la
>   même façon ;
> - **RunLength** — le flux produit est relu à l'identique par un décodeur écrit
>   **depuis l'ISO 32000-2**, pas depuis le code Rust ;
> - **PDF** — deux documents sont écrits depuis le module et relus par
>   **pdf-lib** : 196×266 mm, 2 `/Separation`, et une image XObject de
>   1004×1418 px dont le flux fait **22 468 octets au lieu des 1 423 672 octets
>   de pixels bruts** (×63).
>
> Un `pwsh -File scripts/check.ps1` enchaîne tout, validation comprise.

Aucun module n'est encore branché dans l'application : la parité avec le JS de
SuperPrint reste à mesurer avant toute bascule (voir `docs/PLAN.md`, phase 3).
Le noyau représente à ce jour **environ 2,7 %** du JavaScript de SuperPrint.

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
├─ docs/PLAN.md               feuille de route, inventaire, décisions
├─ scripts/
│  ├─ build-wasm.ps1          construit dist/superprint_core.wasm (release)
│  ├─ check.ps1               chaîne complète : fmt, check, clippy, wasm, tests, PDF
│  ├─ demo-image.ps1          produit deux PDF réels et les valide avec pdf-lib
│  ├─ demo-wasm.ps1           module wasm : charge, parité, PDF, pdf-lib
│  ├─ run-wasi.mjs            exécute un binaire wasm32-wasip1 via Node
│  ├─ validate-pdf.mjs        relit un PDF avec pdf-lib (tons directs, image)
│  └─ validate-wasm.mjs       charge le .wasm sans import et mesure la parité
└─ crates/
   ├─ superprint-core/        primitives pures (units, color, geometry, color8)
   ├─ superprint-image/       traitement d'image (module n° 4)
   ├─ superprint-pdf/         tons directs & écriture PDF (module n° 3)
   └─ superprint-wasm/        frontière C → dist/superprint_core.wasm (cdylib)
```

## Vérifier

```powershell
cd superprint_rust

# Tout, d'un seul coup : formatage, types, lint, WebAssembly, tests, et
# production + validation de QUATRE PDF réels par pdf-lib (deux par les exemples,
# deux par le module wasm livrable).
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

## Relation au reste du dépôt

- `superprint/` — version classique (HTML/CSS/JS + PHP), **référence**, non modifiée.
- `superprint_ASTRO/` — version Astro du site, **référence**, non modifiée.
- `superprint_rust/` — **ce dossier** : noyau Rust/WASM, isolé au départ.

## Licence

**AGPL-3.0-or-later** — la même que le reste du produit (voir `../superprint/LICENSE`).
