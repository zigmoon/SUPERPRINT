# Portage en Rust — inventaire complet, fonction par fonction

Ce document répond à une demande précise : **« relis bien chaque étape et
fonction de SuperPrint, tout doit être en Rust »**. Il relève donc **tout** ce
qui existe, et dit pour chaque domaine l'un de ces quatre états :

| État | Sens |
|---|---|
| ✅ **porté** | le Rust existe, il est testé, et sa sortie est vérifiée par un outil tiers |
| 🟡 **portable** | calcul pur et déterministe : **doit** passer en Rust, pas encore fait |
| 🟠 **portable plus tard** | faisable, mais demande une chaîne (ZIP+XML, décodage JPEG…) |
| ❌ **à garder en JS** | dépend du DOM, de WebGL, du réseau ou du navigateur — le porter n'aurait pas de sens, et la raison est écrite |

Les domaines marqués ✅ **plus bas** (B1, B2) sont ceux réalisés dans ce
chantier ; les autres portent leur état réel.

Les lignes sont mesurées, pas estimées : `superprint_rust/crates` = **8 567
lignes** de Rust (29 fichiers, tests compris) contre **104 574 lignes** de
JavaScript applicatif (hors bibliothèques tierces) → **≈ 8 %**. Le portage est
réel, il est loin d'être fini, et ce document dit exactement où il en est.
> ⚠️ **Aucun de ces modules n'est encore appelé par l'application.**
> `superprint/` n'a pas été modifié : ce sont des gains disponibles, pas des
> gains acquis. La bascule est décrite dans `web/BRANCHEMENT.md`.

---

## A. Ce qui est déjà porté, et vérifié

| # | Étape de SuperPrint | Rust | Preuve |
|---|---|---|---|
| 1 | Unités mm / pt / px / cm / in | `core::units` | comparé à la formule, 42 conversions |
| 2 | RVB → CMJN, CMJN → RVB, luminance | `core::color`, `core::color8` | parité **au bit près** vs WAT, 250 000 pixels |
| 3 | Fond perdu, traits de coupe, format fini | `core::geometry`, `pdf::boxes` | `pdf-lib` (3 boîtes, toujours écrites) |
| 4 | Tons directs `/Separation` + **teintes** | `pdf::spot`, `pdf::colorspace` | `pdf-lib` : 2 `/Separation`, teintes relues |
| 5 | `MediaBox` / `TrimBox` / `BleedBox` | `pdf::boxes` | `pdf-lib`, 196 × 266 mm |
| 6 | Document multi-pages, vectoriel, images | `pdf::document` | 6 PDF relus par `pdf-lib` |
| 7 | Filtre `RunLength` | `image::compress` | décodeur écrit depuis l'ISO 32000-2 |
| 8 | Réduction d'image, ciblage DPI | `image::resample` | identique au repli JS, octet pour octet |
| 9 | Métadonnées `/Info` (accents, typographie FR) | `pdf::object` | lues par `pdf-lib` : « café », tiret cadratin |
| 10 | `OutputIntent` + profil ICC fourni | `pdf::document` | `pdf-lib` : `/S /GTS_PDFX` |
| 11 | Analyse de police TrueType (`cmap`, métriques) | `superprint-font` | 31 tests, police synthétique **et** vraie police |
| 12 | Texte : `Type0` / `Identity-H` / `/FontFile2` | `pdf::font`, `pdf::document` | **`pdf.js` relit les caractères en clair** |
| 13 | Texte extractible (`/ToUnicode`) | `pdf::font` | `pdf.js` : accents, apostrophe, tiret cadratin |
| 14 | Frontière C (32 fonctions, 0 import) | `superprint-wasm` | `WebAssembly.Module.imports` = ∅ |
| 15 | Colle web + repli JS mesuré | `web/superprint-core.js` | parité du repli octet pour octet |

---

## B. Ce qui doit passer en Rust — calcul pur, sans dépendance

Ces domaines ne touchent ni au DOM ni au réseau. Ce sont des **calculs**, et
c'est exactement ce qu'on veut sortir du JavaScript.

### B1. Césure et composition typographique 🟡 → ✅ (fait, module 5)

| Étape de SuperPrint | Source actuelle | Rust |
|---|---|---|
| Moteur de césure par dictionnaire (Liang) | `app/JS/hypher.js` (197 l.) | ✅ `text::motifs` |
| Motifs de césure fr / en / de / es / it | `app/JS/hyphenation-*.js` | ✅ lus par `text::motifs` (deux formats) |
| Règles typographiques **françaises** (validité d'une frontière, groupes consonantiques, digraphes, groupes insécables) | `app/JS/main.js` 5560-5728 | ✅ `text::francais` |
| Repli syllabique quand le dictionnaire ne dit rien | `main.js` 5620-5690 | ✅ `text::francais::syllabes` |
| Traits d'union du mot composé comme frontières | `main.js` 5695-5725 | ✅ `text::francais::ajouter_tirets` |
| Filtre des frontières du dictionnaire par les règles FR | `main.js` 5650-5665 | ✅ `text::Cesure::coupes` |
| Cadratin, espaces insécables françaises | réparti dans `main.js` | ✅ `text::typographie` |

**Preuve mesurée** : `scripts/validate-cesure.mjs` charge le **vrai**
`hypher.js` + `hyphenation-fr.js` du dépôt, extrait les **vraies** règles
françaises de `main.js` (lecture seule) et compare les deux moteurs mot pour
mot. Voir la section « Mesure » plus bas.

### B2. Compression 🟡 → ✅ (fait)

| Étape de SuperPrint | Source actuelle | Rust |
|---|---|---|
| Compression **Flate** (zlib/DEFLATE) pour le PDF | absente : RunLength seul | ✅ `compress::deflate`, `compress::zlib` |
| Décompression Flate (flux PDF produits ailleurs) | `pako`/navigateur selon l'endroit | ✅ `compress::inflate` — blocs stockés, **figés et dynamiques** |
| Écriture `/FlateDecode` dans l'exporteur | jamais faite | ✅ `pdf::image` (choix automatique) |

**Preuve croisée** : `scripts/validate-compression.mjs` confronte le codec au
`zlib` **de Node**, sur 15 jeux (aplats, dégradés, vectoriel, texte, bruit,
le module `.wasm` livrable). Les deux sens sont éprouvés : ce que le Rust
compresse est relu par Node, et réciproquement. Les cinq formes de corruption
(en-tête, corps, somme, vide, aléatoire) sont **refusées nommément**.

**Limites, mesurées** : le compresseur emploie le **Huffman figé**, pas le
dynamique — 4 % de mieux en moyenne pour `zlib` sur le corpus, jusqu'à 4× sur
un aplat. Le **décompresseur**, lui, lit le Huffman dynamique : tout flux venu
d'ailleurs se relit. Un contenu **ne gonfle jamais** : le compresseur compare
avec un bloc stocké, et `ImageFilter::Auto` compare les trois encodages.

### B3. Imposition / montage en planches 🟡

Cité comme défaut mesuré dans le rapport interne : **« mode Planches ignoré »**.
C'est aujourd'hui `main.js` lignes 31627-31790.

À porter : imposition N-up (2, 4, 8, 16 poses), rotation, marges de coupe,
traits de coupe inter-poses, repérage, signature/cahier, dos carré collé.
**Géométrie pure** — aucune raison de rester en JavaScript.

### B4. Contrôle prépresse (preflight) 🟡

Aucun équivalent aujourd'hui dans le noyau Rust. À faire : image sous
300 dpi (connue par `image::resample::taille_cible`), tons directs déclarés
mais absents, noir quadrichrome sur un texte fin, dépassement du fond perdu,
police non embarquée, transparence non aplatie, Total Ink Coverage > 300 %.
Tout est calcul — et c'est exactement ce qu'un imprimeur veut lire avant
d'imprimer.

### B5. Nuanciers et bibliothèques de tons directs 🟡

`app/JS/swatchbooks.js` (1 015 l.) + les données `app/icc/`. Pantone, Toyo
Color Finder, Focoltone, HKS, RAL, NCS : nom → composantes CMJN/RVB. C'est une
**table + une recherche** : portable tel quel, et `SpotInk` existe déjà côté
Rust pour recevoir le résultat.

### B6. Traitement d'image avancé 🟡

| Étape | Source | Remarque |
|---|---|---|
| Recadrage / masque d'image | `main.js` 26531-26830 | rectangles et découpe — porté en partie par `ImageXObject` |
| Filtres (Instagram-style, niveaux, seuil, négatif) | `main.js` 73798-74344 | **convolutions** : calcul pur, à porter |
| Simulation d'encrage / soft proofing CMJN | `main.js` 23360-23475 | ~= `core::color` étendu |
| Décodage JPEG / PNG | délégué au navigateur | 🟠 gros morceau, mais faisable |

### B7. Géométrie vectorielle 🟡

| Étape | Source | Remarque |
|---|---|---|
| Plume / Bézier (dessin et édition de nœuds) | `simple-pen-tool.js` (1 010 l.) | la **géométrie** est portable ; la souris reste au navigateur |
| Pathfinder : union, soustraction, intersection | `main.js` 86085-90 000 | découpage polygonale — difficile mais calcul pur |
| Aplatissement de courbes, offsets, épaississement | réparti | réutilisable par le PDF (`Path` en manque) |

### B8. Import de documents 🟠

| Étape | Source | Remarque |
|---|---|---|
| `.docx` / `.xlsx` / `.odt` / `.ods` | `sp-doc-import.js` (1 233 l.) | ZIP + XML → demande un décodeur ZIP (`inflate` : ✅ fait) |
| RTF, HTML, TXT | `sp-doc-import.js` | analyse syntaxique, portable |
| EPS / AI (PostScript) | `sp-eps-import.js` (869 l.) | sous-ensemble PostScript — gros morceau |
| IDML (InDesign) | `main.js` 41812-45723 | ZIP + XML, ~4 000 l. de JS |
| SVG | délégué au navigateur | parseur XML + `Path` |

### B9. Profil ICC (module 7) 🟡

Lire en-tête et balises d'un profil ICC. La **transformation** reste à
`lcms-wasm` (Little CMS, C compilé — on ne réécrit pas un moteur de gestion de
couleurs). Savoir **lire** un profil permet déjà de vérifier la cohérence de
l'`OutputIntent` et de refuser un profil faux.

### B10. PDF/X et conformité 🟡

XMP (bloc de métadonnées XML), identification de la condition d'impression,
écriture du `GTS_PDFXVersion`. Aujourd'hui l'exporteur **ne revendique aucune**
conformité PDF/X, et le dit — c'est honnête, mais c'est le dernier verrou avant
qu'un imprimeur puisse accepter le fichier les yeux fermés.

### B11. Texte : pagination, chaînage, habillage 🟡

| Étape | Source | Remarque |
|---|---|---|
| Chaînage de blocs texte (le texte coule de bloc en bloc) | `main.js` 30890-31626 | logique pure, aujourd'hui mêlée au canvas |
| Auto-pagination, estimation de pages | `main.js` 25909-26530, 48456 | « coulage » de texte |
| Retraits de paragraphe | `main.js` 11889-11989 | règles typographiques |
| Clip de `TextBox` à hauteur fixe | `main.js` 12034-13748 | géométrie |
| Styles typographiques (16 combinaisons) | `main.js` 72158-73046 | données + règles |

Tout cela a besoin du module 5 (césure) — qui est **fait** — et du module 6
(polices) — qui est **fait**. Le chemin est donc ouvert.

---

## C. Ce qui reste en JavaScript, et pourquoi

Ce n'est pas une concession de paresse : porter ces domaines serait un
**contresens technique**.

| Domaine | Volume | Pourquoi ce n'est pas du Rust |
|---|---|---|
| Interface, canvas, Fabric.js, poignées, sélection, modales, i18n, raccourcis | `main.js` en grande partie | DOM, événements, `CanvasRenderingContext2D` : c'est le navigateur qui dessine |
| Aperçu 3D « magazine » | `sp-3d-preview.js` (1 372 l.) | WebGL + three.js |
| Collaboration P2P | `collab.js` (1 401 l.) | WebRTC, `RTCPeerConnection` |
| PWA, service worker, installation | `pwa.js`, `service-worker.js` | API navigateur |
| Assistant IA | `web-llm.esm.js` (14 291 l.) | réseau + modèles |
| `lcms-wasm` (Little CMS) | 498 l. de colle | C compilé : on **lie**, on ne réécrit pas un moteur ICC |
| `wawoff2` | 315 Ko | C compilé (Binaryen/Brotli) : idem |
| `pdf-lib`, `pdf.js`, `pdf.worker` | vendors | ce sont les **lecteurs de contrôle** du noyau Rust — les remplacer détruirait la preuve |
| Proxys PHP (IA, CORS, cache RSS) | 806 l. | côté serveur |

---

## D. Ordre de portage proposé

Du plus utile au moins utile, en tenant compte du risque :

| Rang | Module | Pourquoi maintenant |
|---|---|---|
| ~~1~~ | ~~Césure (module 5)~~ | ✅ **fait** — débloque toute la composition |
| ~~2~~ | ~~Compression Flate~~ | ✅ **fait** — 108× sur du vectoriel, 2,4× sur le `.wasm` |
| 3 | **Imposition (planches)** | défaut **mesuré** cité par le rapport interne |
| 4 | **Preflight** | c'est ce qui fait accepter un fichier par un imprimeur |
| 5 | **Nuanciers** | les tons directs existent déjà côté Rust : il manque les données |
| 6 | PDF/X : XMP | dernier verrou de conformité |
| 7 | Pagination / chaînage | débloqué par les modules 5 et 6, désormais présents |
| 8 | Filtres, niveaux, simulation d'encrage | calcul pur, réutilise `core::color` |
| 9 | Lecture de profil ICC | avantage immédiat limité (lcms fait le travail) |
| 10 | Import ZIP + XML (docx, idml, odt) | gros, mais `inflate` est fait |
| 11 | Pathfinder, PostScript/EPS | les deux plus difficiles |

---

## E. Mesure — comment la parité est prouvée

La règle du dépôt est « **parité mesurée** », et elle s'applique ici aussi.
Aucun portage n'est déclaré fait sans une comparaison avec le JS existant, lu
**sans être modifié**.

| Module | Outil de contrôle | Nature de la preuve |
|---|---|---|
| Couleurs | WAT écrit à la main | identique **au bit près**, 250 000 pixels |
| RunLength | décodeur écrit depuis l'ISO 32000-2 | flux relu à l'identique |
| Images | repli JavaScript | identique au bit près |
| PDF | `pdf-lib` (lecteur tiers) | ouvrable, boîtes et tons directs conformes |
| Texte | `pdf.js` (lecteur tiers) | **caractères relus en clair** |
| **Césure** | `hypher.js` + règles FR de `main.js` | **2 597 mots, six champs identiques** |
| **Compression** | `zlib` de Node | **aller-retour croisé**, 15 jeux, 2 sens |

Les scripts correspondants sont dans `scripts/` et sont tous enchaînés par
`scripts/check.ps1`.
