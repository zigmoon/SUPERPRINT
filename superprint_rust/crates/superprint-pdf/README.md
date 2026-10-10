# superprint-pdf

Cœur PDF du noyau Rust de SuperPrint — la partie la plus critique pour
l'imprimeur : **les tons directs**, et de quoi **embarquer une image** sans
faire exploser le fichier.

| Module | Rôle |
|---|---|
| `object` | Primitives de syntaxe PDF : noms (échappement `#XX`), nombres, tableaux, dictionnaires |
| `spot` | Une **encre directe** et sa transformation de teinte — l'espace `/Separation` |
| `colorspace` | Pile de couleurs : quadri (CMJN/RVB) + encres directes, décompte des canaux |
| `boxes` | Boîtes de page (`MediaBox`, `TrimBox`, `BleedBox`) en points |
| `image` | **Image XObject** : pixels réduits et compressés, embarqués dans le PDF |
| `doc` | Assemblage d'un **PDF 1.7 d'une page** : tons directs seuls, ou avec image |

## Ce que ça corrige

Un **rapport de test interne** (non publié, conservé hors du dépôt) désigne deux
défauts majeurs. Ce crate traite les deux.

**Défaut P0-1 — perte des tons directs.** Quand les marqueurs d'encre directe
sont perdus, l'imprimeur reçoit un PDF **sans plaque Pantone, sans
avertissement**. Ici, chaque encre devient un vrai espace couleur `/Separation`,
nommé, avec sa fonction de teinte :

```text
[/Separation /PANTONE#20WARM#20RED#20C /DeviceCMYK
  << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [0 0.9 0.8 0] /N 1 >>]
```

**Défaut P0-x — PDF de 131 Mo.** Les images étaient embarquées **à leur
résolution d'origine** et **sans filtre**. Le module `image` n'accepte que des
pixels **déjà réduits** par [`superprint-image`](../superprint-image) et encode
le flux avec `/RunLengthDecode` **seulement s'il fait gagner des octets**. Un
aplat de 64 × 64 RVB (12 288 octets) tombe à 192 octets.

## Vérifier

```powershell
cd superprint_rust

# Tests unitaires (via WebAssembly, sans linker natif) :
cargo test --target wasm32-wasip1 -- --test-threads=1

# Tons directs seuls : production d'un PDF réel + validation par pdf-lib
cargo build --target wasm32-wasip1 -p superprint-pdf --example spot_page
node scripts/run-wasi.mjs target/wasm32-wasip1/debug/examples/spot_page.wasm spot-page.pdf
node scripts/validate-pdf.mjs spot-page.pdf

# Tons directs + image : la chaîne image → PDF, chiffrée
cargo build --target wasm32-wasip1 -p superprint-pdf --example spot_image_page
node scripts/run-wasi.mjs target/wasm32-wasip1/debug/examples/spot_image_page.wasm spot-image-page.pdf
node scripts/validate-pdf.mjs spot-image-page.pdf --mm=196x266 --spots=2 --image=1004x1418
```

`--image` fait vérifier par **pdf-lib** que l'objet XObject existe, qu'il a la
définition annoncée et que son flux n'est **pas plus gros que ses pixels bruts**.
C'est l'invariant qui interdit le retour du PDF de 131 Mo.

## Ce que le module image ne prétend pas faire

- `/RunLengthDecode` est **sans perte** et excelle sur les **aplats** ; il ne
  gagne **rien** sur une photographie. Le levier réel sur une photo reste la
  **réduction** (celle que fait `superprint-image`), puis `/FlateDecode` et
  `/DCTDecode` — à venir.
- L'image est toujours peinte sur **toute la page**. Placement, échelle et
  rotation viendront avec le module de mise en page.

## Limites (à venir, voir `docs/PLAN.md`)

Profil ICC, `OutputIntent` PDF/X, polices, plusieurs pages, `/FlateDecode` et
`/DCTDecode`. Ce crate pose la **fondation vérifiable** des tons directs et de
l'embarquement d'image ; l'enrichissement se fera module par module, chaque
étape validée.
