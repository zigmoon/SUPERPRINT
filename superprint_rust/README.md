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

Contexte : `superprint/RAPPORT-WORKFLOW-415.md` documente les défauts **mesurés**
sur la chaîne d'export PDF (fichiers de 131 Mo, mode Planches ignoré, tons
directs perdus au passage par le studio…). **C'est la cible prioritaire.**

## État actuel

**Trois crates, testés et validés.**

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

> ✅ **Vérifié** : `cargo fmt --check`, `cargo check --all-targets`,
> `cargo clippy --all-targets -- -D warnings`, `cargo build --target
> wasm32-unknown-unknown`, et **65 tests unitaires** (`superprint-core` 12,
> `superprint-image` 16, `superprint-pdf` 37) — tous verts.
>
> Deux PDF réels sont produits puis relus par **pdf-lib** : tons directs seuls
> (1 page, 196×266 mm, 2 `/Separation`), et tons directs **+ image XObject**
> (2 273 635 octets de flux pour 4 271 016 octets de pixels bruts).
> Un `pwsh -File scripts/check.ps1` enchaîne tout, validation comprise.

Aucun module n'est encore branché dans l'application : la parité avec le JS
sera mesurée avant toute bascule (voir `docs/PLAN.md`).

## Prérequis

```powershell
# 1. Installer Rust (rustup)
winget install --id Rustlang.Rustup

# 2. Ajouter les cibles : navigateur + tests
rustup target add wasm32-unknown-unknown wasm32-wasip1

# 3. (plus tard) l'outil de packaging WASM
cargo install wasm-pack
```

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
├─ docs/PLAN.md               feuille de route, inventaire, décisions
├─ scripts/
│  ├─ check.ps1               chaîne complète : fmt, check, clippy, wasm, tests, PDF
│  ├─ demo-image.ps1          produit deux PDF réels et les valide avec pdf-lib
│  ├─ run-wasi.mjs            exécute un binaire wasm32-wasip1 via Node
│  └─ validate-pdf.mjs        relit un PDF avec pdf-lib (tons directs, image)
└─ crates/
   ├─ superprint-core/        primitives pures (units, color, geometry, color8)
   ├─ superprint-image/       traitement d'image (module n° 4)
   └─ superprint-pdf/         tons directs & écriture PDF (module n° 3)
```

## Vérifier

```powershell
cd superprint_rust

# Tout, d'un seul coup : formatage, types, lint, WebAssembly, tests et
# production + validation de deux PDF réels par pdf-lib.
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
```

## Relation au reste du dépôt

- `superprint/` — version classique (HTML/CSS/JS + PHP), **référence**, non modifiée.
- `superprint_ASTRO/` — version Astro du site, **référence**, non modifiée.
- `superprint_rust/` — **ce dossier** : noyau Rust/WASM, isolé au départ.

## Licence

**AGPL-3.0-or-later** — la même que le reste du produit (voir `../superprint/LICENSE`).
