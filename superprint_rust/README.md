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
| Séparation CMJN / tons directs, PDF/X | `pdf-lib` + code maison | cœur PDF typé et testable |
| Profil ICC | `lcms.wasm` (C compilé) | liaison sûre, ou réimplémentation |
| Images : niveaux de gris, CMJN, réduction | canvas + JS | traitement pixel par pixel |
| Césure multilingue | `Hypher` (JS) | algorithme rapide et partagé |
| Analyse de police / métriques | `opentype.js` (JS) | parseur `TTF`/`CFF` performant |
| Géométrie d'impression (fond perdu, traits, imposition) | JS | noyau déterministe et testé |

Contexte : `superprint/RAPPORT-WORKFLOW-415.md` documente les défauts **mesurés**
sur la chaîne d'export PDF (fichiers de 131 Mo, mode Planches ignoré, tons
directs perdus au passage par le studio…). **C'est la cible prioritaire.**

## État actuel

**Socle en place et vérifié** (voir *Vérifier*). Ce dépôt contient
aujourd'hui :

- un **workspace Cargo** prêt à accueillir les modules ;
- un crate **`superprint-core`** avec 3 modules de primitives pures —
  `units` (mm/pt/px/cm/in), `color` (RVB/CMJN/luma), `geometry`
  (fond perdu, traits de coupe) — chacun couvert par des tests unitaires.

C'est une **fondation**, pas encore la version Rust complète de SuperPrint : la
feuille de route (`docs/PLAN.md`) décrit les 7 modules visés et leur ordre.
Aucun module n'est encore branché dans l'application : la parité avec le JS
sera mesurée avant toute bascule.

> Vérifié : `cargo fmt --check`, `cargo check --all-targets`,
> `cargo clippy -D warnings` et `cargo build --target wasm32-unknown-unknown`
> passent tous (0 erreur, 0 avertissement).

## Prérequis

```powershell
# 1. Installer Rust (rustup)
winget install --id Rustlang.Rustup

# 2. Ajouter la cible navigateur
rustup target add wasm32-unknown-unknown

# 3. (plus tard) l'outil de packaging WASM
cargo install wasm-pack
```

## ⚠️ État de la chaîne de build (Windows)

**Smart App Control** est **désactivé** (`VerifiedAndReputablePolicyState = 0`) :
`cargo` et le linker WebAssembly fonctionnent donc à nouveau.

| Commande | État |
|---|---|
| `cargo check --workspace` | ✅ fonctionne |
| `cargo build --target wasm32-unknown-unknown` | ✅ fonctionne (cible du produit) |
| `cargo test` | ❌ nécessite le **linker natif MSVC** (`link.exe`) |

Pour les **tests natifs**, il reste à installer les **Build Tools C++** (au niveau
machine → **PowerShell en administrateur**) :

```powershell
winget install --id Microsoft.VisualStudio.2022.BuildTools `
  --accept-package-agreements --accept-source-agreements `
  --override "--quiet --wait --add Microsoft.VisualStudio.Workload.VCTools --includeRecommended"
```

En attendant, `scripts/check.ps1` compile-vérifie le crate (natif + wasm32) sans
`cargo`, et `cargo build --target wasm32-unknown-unknown` couvre la cible web.

## Structure

```
superprint_rust/
├─ Cargo.toml                 espace de travail (workspace)
├─ rust-toolchain.toml        version et cibles (stable + wasm32)
├─ scripts/check.ps1          compile-check sans cargo (contourne Smart App Control)
├─ docs/PLAN.md               feuille de route, inventaire, décisions
└─ crates/
   └─ superprint-core/        primitives pures (aucune dépendance)
      └─ src/{units,color,geometry}.rs
```

## Vérifier

```powershell
cd superprint_rust

# Vérification de types + cible web (fonctionnent déjà) :
cargo check --workspace
cargo build --workspace --target wasm32-unknown-unknown

# Compile-check de secours, sans cargo :
pwsh -File scripts/check.ps1

# Tests unitaires (nécessitent les Build Tools C++, voir ci-dessus) :
cargo test --workspace
cargo clippy --all-targets
cargo fmt --check
```

## Relation au reste du dépôt

- `superprint/` — version classique (HTML/CSS/JS + PHP), **référence**, non modifiée.
- `superprint_ASTRO/` — version Astro du site, **référence**, non modifiée.
- `superprint_rust/` — **ce dossier** : noyau Rust/WASM, isolé au départ.

## Licence

**AGPL-3.0-or-later** — la même que le reste du produit (voir `../superprint/LICENSE`).
