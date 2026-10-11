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
| 6 | Analyse de police + typographie vectorielle | moyenne | élevée | `opentype.js` actuel — ✅ **analyse faite**, contours toujours rendus par le navigateur |
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
expose 32 fonctions derrière une frontière C écrite à la main — unités,
couleurs sur octets, luminance, filtre RunLength, réduction d'image, page de
démonstration, **construction de document** et **texte** — **sans
`wasm-bindgen`**, pour tenir la règle « zéro dépendance ». C'est aussi le seul
endroit du workspace où il y a de l'`unsafe` : les quatre crates du noyau
restent `#![forbid(unsafe_code)]`.

**Phase 2c — l'exporteur de document.** ✅ `superprint-pdf::document` remplace la
page unique par un **document** : plusieurs pages de formats différents, formes
vectorielles (rectangle, cercle, polygone, segment) en remplissage ou contour,
tons directs **avec teintes**, images grises ou RVB placées et mises à l'échelle,
métadonnées, traits de coupe et `OutputIntent` avec profil ICC fourni.

La frontière expose un **constructeur de document** (`sp_doc_reset`,
`sp_doc_add_page`, `sp_doc_add_ink`, `sp_doc_op`, `sp_doc_add_image_*`,
`sp_doc_add_font`, `sp_doc_substitues`, `sp_doc_info`, `sp_doc_output_intent`,
`sp_doc_write`) : un seul document en cours, comme un curseur. Les opérations de
dessin arrivent en **lignes tabulées**, ce qui évite d'inventer une structure
binaire et garde le protocole lisible dans un journal d'erreur.

> **Ce qui manque encore** : la **césure** et l'habillage du texte (module n° 5),
> le **sous-ensemble de police**, `/FlateDecode` et `/DCTDecode` (RunLength
> seul), et l'écriture XMP sans laquelle aucune conformité PDF/X n'est
> revendiquée.

**Phase 2d — le texte et les polices.** ✅ Le crate **`superprint-font`**
(module n° 6) lit un fichier TrueType **sans jamais dépasser les bornes** :
répertoire de tables, `.head`, `.hhea`, `.hmtx`, `.maxp`, `.name` et `.cmap`
(formats 0, 4, 6 et 12, avec la règle exacte d'`idRangeOffset`). L'exporteur
embarque alors la police en `/FontFile2`, écrit le texte en polices
**composites** (`/Type0` + `/Identity-H` + `/CIDFontType2`), déclare les
largeurs `/W` des seuls glyphes **réellement employés**, et pose une table
**`/ToUnicode`** — sans laquelle le PDF s'afficherait sans être extractible.

Le contrôle ne se contente pas de vérifier que le PDF s'ouvre :
`scripts/validate-text.mjs` demande à **`pdf.js` (Mozilla) de relire les
caractères**, accents, apostrophe typographique et tiret cadratin compris.
C'est la seule preuve qui vaille pour du texte — et c'est aussi ce qui a
confirmé la lecture d'`idRangeOffset`.

> **Limites énoncées, pas passées sous silence** : la police est embarquée
> **en entier** (pas de sous-ensemble : le fichier est plus lourd, mais aucun
> glyphe ne peut manquer) ; les contours **CFF** (`OTTO`), les collections
> (`.ttc`) et les formats compressés (`woff`) sont **refusés explicitement** ;
> il n'y a **ni crénage, ni écriture complexe** (arabe, devanagari), ni
> bidirectionnel. `sp_doc_substitues()` compte les caractères que la police n'a
> pas su dessiner : un document incomplet le dit au lieu de laisser un blanc
> inexpliqué.

**Phase 3 — bascule progressive.** ⏳ À venir. Un module à la fois, derrière un
drapeau, avec **repli JS** si le module Rust n'est pas chargé.

**Phase 3a — la colle est prête.** ✅ `web/superprint-core.js` charge le module et
présente à l'application des fonctions simples (`Uint8Array` en entrée et en
sortie, exceptions explicites) au lieu du contrat C brut. Si le module ne se
charge pas, la colle **retombe sur des implémentations JavaScript** en le
signalant (`api.backend` vaut `'js'`) — et l'écriture PDF, qu'on ne réécrit pas
en JavaScript, **lève une erreur claire** au lieu d'approximer. Elle est validée
par `scripts/validate-web.mjs` (parité octet pour octet du repli, garde-fous,
endurance) et par `web/demo.html`, un banc d'essai de 27 mesures exécuté dans un
vrai navigateur.

> **`superprint/` n'a pas été modifié.** C'est un choix explicite : le dossier est
> en production. Ce qui manque pour l'activer est décrit pas à pas dans
> `web/BRANCHEMENT.md`.

**Phase 3b — bascule dans l'app.** ⏳ À venir, et c'est une décision autant qu'un
chantier : copier deux fichiers, ajouter une balise `<script>`, puis brancher
**un seul module à la fois** derrière un drapeau.

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
| **texte composé** | **`pdf.js` (extraction)** | 1 page, 3 lignes | caractères **relus en clair**, accents compris |

Le reste du noyau n’a **pas** encore de mesure de parité contre le JavaScript de
SuperPrint lui-même : c’est la phase 3.

## Avancement des modules

| # | Module | État |
|---|---|---|
| 1 | Géométrie d'impression | ✅ `superprint-core::geometry` (+ `superprint-pdf::boxes`) |
| 2 | Couleurs (RVB/CMJN, gris) | ✅ `superprint-core::color` (+ `color8`, sur octets) |
| 3 | Séparation des tons directs / PDF | ✅ `superprint-pdf::document` — **exporteur de document** |
| 4 | Traitement d'image | ✅ `superprint-image` (réduction, DPI, RunLength) |
| 5 | Césure + habillage du texte | ⏳ |
| 6 | Analyse de police / typo vectorielle | ✅ `superprint-font` — `cmap`, `head`, `hhea`, `hmtx`, `maxp`, `name` ; CFF refusé |
| 7 | Profil ICC | ⏳ (`OutputIntent` posable avec un profil fourni, pas de gestion) |
| — | **Frontière WebAssembly (le livrable)** | ✅ `superprint-wasm` — `cdylib`, 32 fonctions, **0 import**, 262 Ko |
| — | **Colle de branchement + repli** | ✅ `web/superprint-core.js` — parité du repli mesurée, PDF refusé sans le noyau |

### Ce que l'exporteur couvre, et ce qu'il ne couvre pas

| Besoin d'impression | État |
|---|---|
| Plusieurs pages, formats différents | ✅ |
| `MediaBox` / `TrimBox` / `BleedBox` | ✅ (les trois, **toujours** écrites) |
| Traits de coupe | ✅ |
| Tons directs `/Separation` **avec teintes** | ✅ |
| Quadri CMJN ou RVB, page par page | ✅ |
| Rectangles, cercles, polygones, segments | ✅ remplissage et contour, épaisseurs |
| Images placées et mises à l'échelle (gris, RVB) | ✅ |
| Métadonnées `/Info` en PDFDocEncoding | ✅ accents **et** typographie française |
| `OutputIntent` + profil ICC fourni | ✅ |
| **Texte dans une police embarquée** | ✅ `Type0` + `Identity-H` + `FontFile2` |
| **Texte extractible** (`/ToUnicode`) | ✅ vérifié à la relecture par `pdf.js` |
| **Sous-ensemble de police** | ❌ police entière embarquée (plus lourd, jamais incomplet) |
| Crénage, écritures complexes, bidirectionnel | ❌ |
| `/FlateDecode`, `/DCTDecode` | ❌ RunLength seul |
| Chaînes UTF-16BE (CJK) | ⚠️ dans un **CMap** `/ToUnicode` de police, oui ; en **métadonnée**, non (hors PDFDocEncoding → `?`) |
| Validation PDF/X complète (XMP) | ❌ non écrite, donc **non revendiquée** |

> Le module n° 3 n'est plus une fondation : l'exporteur produit de vrais documents
> multi-pages relus par `pdf-lib`, avec tons directs teintés, vectoriel, images,
> métadonnées **et texte extractible**. Ce qui reste à faire pour une
> composition complète tient à la **césure** (module n° 5) et au
> **sous-ensemble** de police — deux chantiers nommés, aucun caché.
>
> Le noyau Rust représente à ce jour **environ 4 %** du JavaScript de SuperPrint
> (≈ 5 900 lignes contre ≈ 104 000, dont `main.js` à lui seul ≈ 95 000). C'est un
> début solide, pas une refactorisation achevée — et **aucune ligne n'est encore
> appelée par l'application**.

## Décisions prises

1. **Cible = WebAssembly** : on extrait des modules Rust/WASM appelés par
   l'application web existante. Pas de réécriture desktop, pas de fork du site.
2. **Périmètre** : à terme, **tous** les modules candidats ci-dessus — mais
   **un par un**, chacun validé (tests + parité) avant d'être branché.
3. **Isolation** : `superprint_rust/` ne modifie ni `superprint/` ni
   `superprint_ASTRO/`. La bascule dans l'app viendra plus tard, derrière un
   drapeau, avec repli JS.
4. **Pas de `wasm-bindgen`** : la frontière est une C ABI écrite à la main
   (`crates/superprint-wasm`), pour ne pas introduire de dépendance ni de chaîne
   d'outils JavaScript à versionner. Le prix est la gestion mémoire manuelle.
5. **Le `.wasm` livrable n'est pas versionné.** Il vit dans `dist/`, que la
   règle `**/dist/` du dépôt ignore — même traitement que
   `superprint_asm/dist/`. Il se régénère par
   `pwsh -File scripts/build-wasm.ps1`, et `scripts/validate-wasm.mjs` refuse un
   module dont la version ne correspond plus au `Cargo.toml` : une dérive se
   voit immédiatement au lieu de dormir dans un binaire commité.
6. **Un seul document en cours à la frontière.** Un document se construit par
   étapes (les pages référencent des images déclarées plus tard), et le
   sérialiser à chaque appel coûterait plus cher que de garder un curseur. D'où
   `sp_doc_reset` / … / `sp_doc_write`, plutôt qu'une fonction unique à quinze
   paramètres.
7. **Texte en `Identity-H`, pas en police simple.** Un PDF peut écrire du texte
   de deux façons : la plus simple (police simple à `WinAnsiEncoding`) est
   plafonnée à 256 caractères et complique l'embarquement ; la voie retenue est
   celle des **polices composites**. Conséquence assumée : le flux de contenu ne
   porte pas des caractères mais des **identifiants de glyphe**, ce qui rend la
   table `/ToUnicode` **obligatoire** — et c'est elle qui est vérifiée à la
   relecture.
8. **La police est embarquée en entier.** Le sous-ensemble demanderait de
   réécrire `glyf`, `loca`, `hmtx` et `cmap` ; c'est un chantier à part. En
   attendant, on préfère un fichier plus lourd à un fichier où **une lettre
   manque** — et `sp_doc_substitues()` dit quand c'est le cas.

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
