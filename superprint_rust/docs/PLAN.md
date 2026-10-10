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

**Phase 0 — socle.** *(fait ici)* Workspace Cargo, crate `superprint-core`
(unités, couleurs, géométrie), tests unitaires, documentation, outillage.

**Phase 1 — primitives validées.** Étendre `superprint-core` et **comparer** au
JS : un script de parité (mêmes entrées → mêmes sorties) avant tout branchement.

**Phase 2 — premier module WASM.** Cible `wasm32`, `wasm-bindgen`, exemple
branché sur une page de test **isolée** (sans toucher `superprint/`).

**Phase 3 — bascule progressive.** Un module à la fois, derrière un drapeau,
avec **repli JS** si le module Rust n'est pas chargé.

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
