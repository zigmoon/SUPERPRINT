# Plan de refactoring Rust — SuperPrint

## Principe

On **n'écrit pas** SuperPrint de zéro en Rust. On extrait, un par un, les
modules à fort calcul et à forte criticité, derrière une interface stable
(WebAssembly pour le web, API native réutilisable), en **gardant** la version
JS/PHP comme **référence de comportement**.

**Règle d'or — parité mesurée.** Tant qu'un module Rust ne produit pas une
sortie identique (ou meilleure) à la version JS sur un jeu de tests, il n'est
**pas** branché dans l'application. Aucune bascule « à l'aveugle ».

## Candidats (par valeur / risque)

| # | Module | Valeur | Difficulté | Notes |
|---|---|---|---|---|
| 1 | Géométrie d'impression (fond perdu, traits de coupe, imposition) | haute | faible | déterministe, facile à tester |
| 2 | Couleurs (RVB/CMJN, niveaux de gris, `luma`) | haute | faible | base du N&B et des planches |
| 3 | Séparation des tons directs / écriture PDF | très haute | élevée | cible de `RAPPORT-WORKFLOW-415` |
| 4 | Traitement d'image (N&B, CMJN, réduction, JPEG/Flate) | haute | moyenne | images **brutes** = cause du PDF de 131 Mo |
| 5 | Césure + habillage du texte | moyenne | moyenne | `Hypher` actuel |
| 6 | Analyse de police + typographie vectorielle | moyenne | élevée | `opentype.js` actuel |
| 7 | Profil ICC | moyenne | élevée | `lcms.wasm` (C) déjà présent dans l'app |

## Phases

**Phase 0 — socle.** ✅ Workspace Cargo, crate `superprint-core` (unités,
couleurs, géométrie), tests unitaires, documentation, outillage.

**Phase 1 — primitives validées.** ✅ `superprint-core` étendu et testé
(36 tests au total dans le workspace). La comparaison JS viendra avec le
branchement.

**Phase 2 — premier module WASM.** ✅ En cours. Le crate **`superprint-pdf`**
(module n° 3) produit un `rlib`/`cdylib` WebAssembly et un **PDF réel**
(1,1 ko) relu par `pdf-lib` : chaînes `/Separation` nommées, fonction de
teinte, boîtes de page, flux de contenu.

**Phase 3 — bascule progressive.** ⏳ À venir. Un module à la fois, derrière un
drapeau, avec **repli JS** si le module Rust n'est pas chargé.

## Avancement des modules

| # | Module | État |
|---|---|---|
| 1 | Géométrie d'impression | ✅ `superprint-core::geometry` (+ `superprint-pdf::boxes`) |
| 2 | Couleurs (RVB/CMJN, gris) | ✅ `superprint-core::color` |
| 3 | Séparation des tons directs / PDF | ✅ `superprint-pdf` (fondation) |
| 4 | Traitement d'image | ⏳ |
| 5 | Césure + habillage du texte | ⏳ |
| 6 | Analyse de police / typo vectorielle | ⏳ |
| 7 | Profil ICC | ⏳ |

> Le module n° 3 est une **fondation validée**, pas encore un exporteur complet :
> il manque ICC, `OutputIntent` PDF/X, polices, images, multi-pages, compression
> — et la mesure de parité avec la sortie JS de SuperPrint.

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
   cœur maison ?

## Non-objectifs (pour l'instant)

- Porter l'interface (Fabric.js / canvas) en Rust.
- Remplacer PHP (proxies IA).
- Réécrire le site (déjà fait en Astro).
