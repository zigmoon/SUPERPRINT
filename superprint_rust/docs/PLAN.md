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
| 3 | Séparation des tons directs / écriture PDF | très haute | élevée | cible de `RAPPORT-WORKFLOW-415` |
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

**Phase 2 — premiers modules WASM.** ✅ Le crate **`superprint-pdf`**
(module n° 3) produit un `rlib`/`cdylib` WebAssembly et un **PDF réel** relu par
`pdf-lib` : chaînes `/Separation` nommées, fonction de teinte, boîtes de page,
flux de contenu. Le crate **`superprint-image`** (module n° 4) y ajoute la
réduction d'image, le ciblage DPI et le filtre RunLength : un **second** PDF
réel porte une image XObject dont le flux est **plus petit que ses pixels
bruts** — l'inverse exact du défaut « PDF de 131 Mo ».

**Phase 3 — bascule progressive.** ⏳ À venir. Un module à la fois, derrière un
drapeau, avec **repli JS** si le module Rust n'est pas chargé.

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

> Les modules n° 3 et 4 sont des **fondations validées**, pas encore des
> exporteurs complets. Ce qui manque : ICC, `OutputIntent` PDF/X, polices,
> **décodage** d'image (JPEG/PNG) donc `/DCTDecode`, `/FlateDecode`, le
> placement et l'échelle d'une image, le multi-pages — et la mesure de parité
> avec la sortie JS de SuperPrint.

## Décisions prises

1. **Cible = WebAssembly** : on extrait des modules Rust/WASM appelés par
   l'application web existante. Pas de réécriture desktop, pas de fork du site.
2. **Périmètre** : à terme, **tous** les modules candidats ci-dessus — mais
   **un par un**, chacun validé (tests + parité) avant d'être branché.
3. **Isolation** : `superprint_rust/` ne modifie ni `superprint/` ni
   `superprint_ASTRO/`. La bascule dans l'app viendra plus tard, derrière un
   drapeau, avec repli JS.

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
