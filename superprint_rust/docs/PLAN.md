# Plan de refactoring Rust — SuperPrint

## Principe

On **n'écrit pas** SuperPrint de zéro en Rust. On extrait, un par un, les
modules à fort calcul et à forte criticité, derrière une interface stable
(WebAssembly pour le web, API native réutilisable), en **gardant** la version
JS/PHP comme **référence de comportement**.

**Règle d'or — parité mesurée.** Tant qu'un module Rust ne produit pas une
sortie identique (ou meilleure) à la version JS sur un jeu de tests, il n'est
**pas** branché dans l'application. Aucune bascule « à l'aveugle ».

**Second principe — validation réelle.** Un test unitaire vert ne suffit pas :
chaque module qui produit un fichier doit être **relu par un outil tiers**
(`pdf-lib` pour le PDF). C'est ce contrôle qui a révélé un bug de dictionnaire
de page que les tests unitaires laissaient passer.

## Candidats (par valeur / risque)

| # | Module | Valeur | Difficulté | Notes |
|---|---|---|---|---|
| 1 | Géométrie d'impression (fond perdu, traits de coupe, imposition) | haute | faible | déterministe, facile à tester |
| 2 | Couleurs (RVB/CMJN, niveaux de gris, `luma`) | haute | faible | base du N&B et des planches |
| 3 | Séparation des tons directs / écriture PDF | très haute | élevée | cible du rapport de test interne (non publié) |
| 4 | Traitement d'image (N&B, CMJN, réduction, JPEG/Flate) | haute | moyenne | images **brutes** = cause du PDF de 131 Mo — ✅ réduction et RunLength faits ; reste le **décodage** (JPEG/PNG) et Flate |
| 5 | Césure + habillage du texte | moyenne | moyenne | `Hypher` actuel |
| 6 | Analyse de police + typographie vectorielle | moyenne | élevée | `opentype.js` actuel |
| 7 | Profil ICC | moyenne | élevée | `lcms.wasm` (C) déjà présent dans l'app |

## Phases

**Phase 0 — socle.** ✅ Workspace Cargo, crate `superprint-core` (unités,
couleurs, géométrie), tests unitaires, documentation, outillage.

**Phase 1 — primitives validées.** ✅ `superprint-core` étendu et testé
(65 tests au total dans le workspace). La comparaison JS viendra avec le
branchement.

**Phase 2 — premiers modules validés.** ✅ Le crate **`superprint-pdf`**
(module n° 3) produit un **PDF réel** relu par `pdf-lib` : chaînes
`/Separation` nommées, fonction de teinte, boîtes de page, flux de contenu. Le
crate **`superprint-image`** (module n° 4) y ajoute la réduction d’image, le
ciblage DPI et le filtre RunLength : un **second** PDF réel porte une image
XObject dont le flux est **plus petit que ses pixels bruts** — l’inverse exact
du défaut « PDF de 131 Mo ».

> ⚠️ **Correction (v0.2.0).** Ce paragraphe annonçait un `rlib`/`cdylib`
> WebAssembly. C’était **inexact** : les trois crates du noyau n’étaient que des
> `rlib`, et aucun `.wasm` chargeable par un navigateur n’était produit. Les
> tests passaient parce qu’ils s’exécutaient en `wasm32-wasip1` — un programme,
> pas un module. C’est la phase 2b qui a comblé ce trou.

**Phase 2b — le module réellement chargeable.** ✅ Le crate
**`superprint-wasm`** est le **seul** déclaré en `cdylib`. Il produit
`dist/superprint_core.wasm`, **sans aucun import** : un navigateur le charge
avec `WebAssembly.instantiate(bytes, {})`, sans WASI ni fonction hôte. Il
expose 19 fonctions derrière une frontière C écrite à la main — unités,
couleurs sur octets, luminance, filtre RunLength, réduction d’image, écriture
PDF — **sans `wasm-bindgen`**, pour tenir la règle « zéro dépendance ». C’est
also le seul endroit du workspace où il y a de l’`unsafe` : les trois crates du
noyau restent `#![forbid(unsafe_code)]`.

**Phase 3 — bascule progressive.** ⏳ À venir. Un module à la fois, derrière un
drapeau, avec **repli JS** si le module Rust n’est pas chargé. Le module existe
et est validé ; il n’est **pas encore appelé** par `superprint/`.

## La frontière C (phase 2b)

`crates/superprint-wasm/src/lib.rs`. Trois règles, et elles suffisent à
expliquer tout le fichier :

1. **Tout échoue par un code `i32`.** `>= 0` = succès (le nombre d’octets écrits
   quand il y en a) ; les erreurs sont numérotées **sous −1 000 000** pour
   qu’un compte d’octets ne puisse jamais être pris pour une erreur.
2. **Les tampons appartiennent à l’appelant.** Il alloue avec `sp_alloc`
   (aligné sur 8 octets, comme l’ABI C — c’est ce qui autorise les sorties
   `u32`/`f64` sans écriture sur pointeur mal aligné) et rend avec `sp_free`.
3. **Écriture en deux passes.** On appelle une première fois avec un tampon
   vide : la fonction rend `SP_ERR_TOO_SMALL` et remplit `out_len` avec la
   taille nécessaire. On alloue, on rappelle.

⚠️ Limite honnête du procédé : un pointeur C **ne porte pas sa taille**. La
frontière ne peut donc pas vérifier qu’un tampon fait vraiment la longueur
annoncée — c’est le contrat de l’appelant. Elle *peut* refuser un pointeur nul
et une dimension nulle, et elle le fait.

⚠️ Côté JavaScript, `memory.buffer` est **détaché** dès qu’une fonction Rust
agrandit la mémoire : toute vue `TypedArray` construite avant l’appel devient
inutilisable. Il faut la reconstruire après chaque appel qui peut allouer.
`scripts/validate-wasm.mjs` applique cette règle.

## Mesure de parité (phase 2b)

La règle d’or est « parité mesurée ». Elle est maintenant satisfaite sur trois
noyaux, et mesurée **en chargement navigateur des deux côtés** :

| Noyau | Comparé à | Volume | Résultat |
|---|---|---|---|
| RVB → CMJN | `color8.wat` | 250 000 pixels | identique au bit près |
| CMJN → RVB | `color8.wat` | 250 000 pixels | identique au bit près |
| luminance (Rec. 709) | `luma.wat` | 250 000 pixels | identique au bit près |
| unités (mm/pt/px) | formule recalculée | 42 conversions | identique au bit près |
| RunLength | décodeur écrit depuis l’ISO 32000-2 | 4 jeux | flux relu à l’identique |
| écriture PDF | `pdf-lib` | 2 documents | ouvrables, conformes |

Le reste du noyau n’a **pas** encore de mesure de parité contre le JavaScript de
SuperPrint lui-même : c’est la phase 3.

## Avancement des modules

| # | Module | État |
|---|---|---|
| 1 | Géométrie d'impression | ✅ `superprint-core::geometry` (+ `superprint-pdf::boxes`) |
| 2 | Couleurs (RVB/CMJN, gris) | ✅ `superprint-core::color` (+ `color8`, sur octets) |
| 3 | Séparation des tons directs / PDF | ✅ `superprint-pdf` (fondation + image XObject) |
| 4 | Traitement d'image | ✅ `superprint-image` (réduction, DPI, RunLength) |
| 5 | Césure + habillage du texte | ⏳ |
| 6 | Analyse de police / typo vectorielle | ⏳ |
| 7 | Profil ICC | ⏳ |
| — | **Frontière WebAssembly (le livrable)** | ✅ `superprint-wasm` — `cdylib`, 19 fonctions, **0 import**, 110 Ko |

> Les modules n° 3 et 4 sont des **fondations validées**, pas encore des
exporteurs complets. Ce qui manque : ICC, `OutputIntent` PDF/X, polices,
**décodage** d’image (JPEG/PNG) donc `/DCTDecode`, `/FlateDecode`, le
placement et l’échelle d’une image, le multi-pages — et la mesure de parité
avec la sortie JS de SuperPrint.
>
> Le noyau Rust représente à ce jour **environ 2,7 %** du JavaScript de
> SuperPrint (≈ 3 000 lignes contre ≈ 104 000, dont `main.js` à lui seul
> ≈ 95 000). C’est un début de noyau, pas une refactorisation achevée, et
> aucune ligne n’est encore appelée par l’application.

## Décisions prises

1. **Cible = WebAssembly** : on extrait des modules Rust/WASM appelés par
   l'application web existante. Pas de réécriture desktop, pas de fork du site.
2. **Périmètre** : à terme, **tous** les modules candidats ci-dessus — mais
   **un par un**, chacun validé (tests + parité) avant d'être branché.
3. **Isolation** : `superprint_rust/` ne modifie ni `superprint/` ni
   `superprint_ASTRO/`. La bascule dans l'app viendra plus tard, derrière un
   drapeau, avec repli JS.4. **Pas de `wasm-bindgen`** : la frontière est une C ABI écrite à la main
   (`crates/superprint-wasm`), pour ne pas introduire de dépendance ni de chaîne
   d’outils JavaScript à versionner. Le prix est la gestion mémoire manuelle.
5. **Le `.wasm` livrable n'est pas versionné.** Il vit dans `dist/`, que la
   règle `**/dist/` du dépôt ignore — même traitement que
   `superprint_asm/dist/`. Il se régénère par
   `pwsh -File scripts/build-wasm.ps1`, et `scripts/validate-wasm.mjs` refuse un
   module dont la version ne correspond plus au `Cargo.toml` : une dérive se
   voit immédiatement au lieu de dormir dans un binaire commité.
## Décisions encore ouvertes

1. **ICC** : réutiliser `lcms.wasm` (C) via des liaisons, ou réimplémenter ?
2. **PDF** : viser un crate existant (`lopdf`, `printpdf`, `pdf-writer`) ou un
   cœur maison ? *(Réponse provisoire : cœur maison — il produit déjà un PDF
   valide, sans dépendance, et il est relu par `pdf-lib`.)*
3. **Flate** : pour les photographies, `/RunLengthDecode` ne gagne rien. Écrire
   un déflate maison (patents expirés, ~300 lignes) ou intégrer `miniz_oxide` ?
   Le second est plus sûr, le premier garde le « zéro dépendance ».
4. **Mémoire WebAssembly** : le WASI de Node plafonne autour de 32 Mo de tas, ce
   qui limite la taille des images traitables **dans les tests**. Un runtime
   navigateur (4 Go) n'a pas cette limite. Faut-il privilégier un lanceur
   `wasmtime` pour les très grandes images ?

## Non-objectifs (pour l'instant)

- Porter l'interface (Fabric.js / canvas) en Rust.
- Remplacer PHP (proxies IA).
- Réécrire le site (déjà fait en Astro).
