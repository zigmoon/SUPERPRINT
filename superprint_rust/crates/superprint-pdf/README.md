# superprint-pdf

Cœur PDF du noyau Rust de SuperPrint — la partie la plus critique pour
l'imprimeur : **les tons directs**.

| Module | Rôle |
|---|---|
| `object` | Primitives de syntaxe PDF : noms (échappement `#XX`), nombres, tableaux, dictionnaires |
| `spot` | Une **encre directe** et sa transformation de teinte — l'espace `/Separation` |
| `colorspace` | Pile de couleurs : quadri (CMJN/RVB) + encres directes, décompte des canaux |
| `boxes` | Boîtes de page (`MediaBox`, `TrimBox`, `BleedBox`) en points |
| `doc` | Assemblage d'un **PDF 1.7 d'une page** portant les tons directs |

## Ce que ça corrige

Le rapport interne `superprint/RAPPORT-WORKFLOW-415.md` désigne comme **défaut
P0-1** la perte des tons directs : quand les marqueurs d'encre directe sont
perdus, l'imprimeur reçoit un PDF **sans plaque Pantone, sans avertissement**.
Ce crate produit l'inverse : chaque encre devient un vrai espace couleur
`/Separation`, nommé, avec sa fonction de teinte.

```text
[/Separation /PANTONE#20WARM#20RED#20C /DeviceCMYK
  << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0.9 0.8 0] /N 1 >>]
```

## Vérifier

```powershell
cd superprint_rust

# Tests unitaires (via WebAssembly, sans linker natif) :
cargo test --target wasm32-wasip1 -- --test-threads=1

# Production d'un PDF réel + validation par pdf-lib :
cargo build --target wasm32-wasip1 -p superprint-pdf --example spot_page
node scripts/run-wasi.mjs target/wasm32-wasip1/debug/examples/spot_page.wasm spot-page.pdf
node scripts/validate-pdf.mjs spot-page.pdf
```

## Limites (à venir, voir `docs/PLAN.md`)

Profil ICC, `OutputIntent` PDF/X, polices, images, plusieurs pages, compression.
Ce module pose la **fondation vérifiable** des tons directs ; l'enrichissement
se fera module par module, chaque étape validée.
