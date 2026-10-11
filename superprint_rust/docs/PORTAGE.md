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

**Branché dans l'application** : `superprint/app/JS/superprint-branchement.js`
remplace le moteur de césure par le noyau Rust, pour les **cinq** langues
(fr, en, de, es, it), sans toucher à `main.js`. Voir la section « Branchement »
plus bas.

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

### B3. Imposition / montage en planches 🟡 → ✅ (fait, et mesuré)

Cité comme défaut mesuré dans le rapport interne : **« mode Planches ignoré »**.
C'était aujourd'hui `main.js` lignes 31627-31790, et trois autres endroits.

| Étape de SuperPrint | Source actuelle | Rust |
|---|---|---|
| Ordre des pages du livret (convergence vers le centre) | `main.js` 31629 `calculateImposition` | ✅ `impose::ordre` |
| Taille de la feuille (2 pages + fonds perdus + gouttière + marges) | `main.js` 50934, 55001, 54713 | ✅ `impose::plan::Reglages` |
| Place de chaque page, en mm | `main.js` 50934, 55000, 54713 | ✅ `impose::plan::Place` |
| Traits de coupe (12, et 4 intérieurs en découpe page à page) | `main.js` 55212 et 51456 | ✅ `impose::reperes` |
| Lecture de la spécification | dispersée | ✅ `impose::Specification::lire` — **un seul lecteur** |

**Ce que le portage supprime, et c'est son vrai apport** : les quatre formules
sont écrites **trois fois** dans `main.js`, avec deux dérives constatées entre
les copies.

1. L'**épaisseur des traits de coupe** vaut `0,08 mm` dans le chemin raster
   (`renderImposedSheet`) et `0,25 mm` dans le chemin tons directs
   (`_spSpotDrawCropMarks`). Les deux exports ne donnent donc pas les mêmes
   repères.
2. La **largeur de demi-page** du chemin raster de secours vaut
   `page + fond perdu` — le fond perdu compté d'un seul côté — là où le chemin
   vectoriel charge la page avec ses `2 × fond perdu`. Les deux chemins ne
   placent donc pas les pages de la même façon.

Aucun de ces deux écarts n'est un défaut du portage : ce sont deux défauts du
produit, que la formule unique rend impossibles.

**Preuve mesurée** : `scripts/validate-imposition.mjs` extrait de `main.js`, sans
le modifier, la fonction `calculateImposition` **telle quelle**, les trois copies
des expressions de taille de feuille, et les arguments de chaque `pdf.line()` du
bloc des traits de coupe. Les trois confrontations passent :

- l'ordre est identique pour **25 tailles**, de 0 à 1 000 pages ;
- la taille de feuille concorde sur les **3 copies × 4 configurations** ;
- les **16 traits de coupe** (12 + 4 intérieurs) coïncident, position par
  position, au centième de micromètre.

**Non porté, et pourquoi** : l'imposition N-up (4, 8, 16 poses), la rotation,
la signature/cahier et le dos carré collé. Le produit ne les a pas non plus :
le mode actuel est un livret 2 poses. Les porter serait ajouter une fonction,
pas en déplacer une.

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

### B6. Traitement d'image avancé 🟡 → 🟢 (réduction faite)

| Étape | Source | Rust |
|---|---|---|
| Réduction à la résolution utile | `drawImage` du navigateur | ✅ `image::resample::downscale_area` |
| Taille utile pour un placement | `main.js` (implicite) | ✅ `image::resample::target_size_for_dpi` |
| Réduction rapide (plus proche voisin) | — | ✅ `image::resample::downscale_nearest` |
| Recadrage / masque d'image | `main.js` 26531-26830 | 🟡 porté en partie par `ImageXObject` |
| Filtres (niveaux, seuil, négatif) | `main.js` 73798-74344 | 🟡 **convolutions** : calcul pur, à porter |
| Simulation d'encrage / soft proofing CMJN | `main.js` 23360-23475 | 🟡 ≈ `core::color` étendu |
| Décodage JPEG / PNG | délégué au navigateur | 🟠 gros morceau, mais faisable |
| Canal alpha | — | ❌ **non géré** : le noyau travaille en RVB et en gris |

**La réduction, et ce qui la rend nécessaire.** Le produit laissait le navigateur
rééchantillonner par `drawImage` — c'est-à-dire, en pratique, une interpolation
bilinéaire. Sur un motif fin, celle-ci ne donne pas seulement une image plus
molle : elle rend une **couleur qui n'existe pas dans l'image**, et parfois fait
disparaître le motif entièrement.

Mesuré sur une image où une colonne sur huit est blanche, réduite huit fois —
la bonne réponse est le gris moyen, 32 :

| Méthode | Résultat |
|---|---|
| moyenne de surface (portée) | **32** |
| interpolation bilinéaire (≈ `drawImage`) | **0** |
| plus proche voisin | **0** |

**Preuve mesurée** : `scripts/validate-reduction.mjs` vérifie l'exactitude **au
bit près** contre une moyenne arithmétique entière calculée indépendamment, la
survie du motif fin, la conservation de l'énergie (0,005 à 0,4 % d'écart), et
les invariants (jamais d'agrandissement, identité à taille égale, déterminisme).

**Ce que la mesure a appris** : la vitesse **n'est pas** l'argument. Sur
3 000 × 2 000 pixels, le noyau Rust met le même temps qu'une boucle JavaScript
équivalente (0,99×) — la copie des 18 Mo de pixels dans la mémoire du module
annule le gain du calcul. Ce module vaut par sa **méthode**, pas par sa vitesse.
À comparer à la césure (section F) : elle est branchée et 1,6 à 2,5 fois plus
**lente**. La bonne question n'est donc jamais « est-ce que Rust va plus vite ? »
mais « est-ce que le calcul est juste, et assez gros pour un seul appel ? ».

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
| ~~1~~ | ~~Césure (module 5)~~ | ✅ **fait**, et ✅ **branché** dans l'application (5 langues) |
| ~~2~~ | ~~Compression Flate~~ | ✅ **fait** — 108× sur du vectoriel, 2,4× sur le `.wasm` |
| ~~3~~ | ~~Imposition (planches)~~ | ✅ **fait et mesuré** — ordre, feuille et traits de coupe contre `main.js` |
| ~~8~~ | ~~Réduction d'image~~ | ✅ **fait et mesuré** — remonte ici : c'est le défaut de **justesse** le plus net |
| 4 | **Preflight** | c'est ce qui fait accepter un fichier par un imprimeur |
| 5 | **Nuanciers** | les tons directs existent déjà côté Rust : il manque les données |
| 6 | PDF/X : XMP | dernier verrou de conformité |
| 7 | Pagination / chaînage | débloqué par les modules 5 et 6, désormais présents |
| 8 | Filtres, niveaux, simulation d'encrage | calcul pur, réutilise `core::color` |
| 9 | Lecture de profil ICC | avantage immédiat limité (lcms fait le travail) |
| 10 | Import ZIP + XML (docx, idml, odt) | gros, mais `inflate` est fait |
| 11 | Pathfinder, PostScript/EPS | les deux plus difficiles |

**Ce qui est porté n'est pas pour autant branché, et ce qui est branché n'est
pas pour autant utile.** Les deux leçons des deux derniers composants, à relire
avant de choisir le suivant :

- La **césure** est branchée et **plus lente** (1,6 à 2,5×) : elle vivait en
  Rust pour l'unification, pas pour la vitesse.
- La **réduction d'image** est plus juste (elle retrouve un motif que
  l'échantillonnage fait disparaître) mais **pas plus rapide** : à volume égal,
  la copie des pixels dans la mémoire du module annule le gain du calcul.

Rester à brancher, parmi ce qui existe : les conversions de couleurs, les
unités, le RunLength. L'imposition et la réduction d'image sont **offertes**
par `SuperPrintBranchement` mais pas branchées : les fonctions correspondantes de
`main.js` sont privées à son IIFE, et la règle est de **ne pas modifier**
`main.js`. Voir la section F pour la ligne exacte à changer.

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
| **Césure** | `hypher.js` + règles FR de `main.js` | **2 644 mots, sept champs identiques** |
| **Compression** | `zlib` de Node | **aller-retour croisé**, 15 jeux, 2 sens |
| **Imposition** | `calculateImposition`, les 3 copies de la taille de feuille et les `pdf.line()` **extraits de `main.js`** | **25 tailles d'ordre, 3 copies × 4 configurations, 16 traits de coupe** |
| **Réduction d'image** | moyenne arithmétique entière calculée indépendamment | **au bit près**, motif fin préservé, énergie conservée |
| **Branchement césure (colle)** | `hypher.js` + dictionnaires du produit | **5 langues, 2 433 mots identiques** |
| **Branchement césure (livré)** | fichiers réels de `superprint/app/JS/` | **2 129 mots × 5 langues, réversibilité et repli** |
| **Branchement imposition + réduction** | fichiers réels, dans un bac à sable navigateur | **plan conforme, composants indépendants de la césure** |

Les scripts correspondants sont dans `scripts/` et sont tous enchaînés par
`scripts/check.ps1`.

---

## F. Branchement dans l'application

Un module Rust n'est utile que **branché**. Le branchement se fait
**composant par composant**, selon une règle stricte :

> **Ajouter, jamais modifier.** Chaque composant branché est un fichier
> nouveau, plus une ligne dans `index.html`. Retirer cette ligne remet
> l'application exactement dans son état précédent.

Aucune ligne de `main.js` n'est touchée — ni maintenant, ni plus tard. C'est ce
qui rend le branchement réversible et le diagnostic simple : un défaut vient
forcément du fichier ajouté.

### Le point d'accroche, et pourquoi c'est le bon

`main.js` consulte **déjà** un moteur externe avant le sien :

```js
// main.js, ligne 5201 (et 11462, au moment du calcul)
const hyphenator = (window.hyphenators && window.hyphenators[lang]) || hyphenators[lang];
```

C'est une couture prévue par le produit. Poser `window.hyphenators[lang]`
remplace donc **le dictionnaire de césure et lui seul** : tout le reste —
bornes de composition, groupes insécables, digraphes, filtrage, traits de
césure — continue dans `main.js`, intact. Un branchement à un autre endroit
aurait forcément dupliqué ces règles.

### Ce qui a été posé

| Fichier | Rôle |
|---|---|
| `superprint/app/JS/superprint_core.wasm` | le noyau compilé (copie de `superprint_rust/dist/`) |
| `superprint/app/JS/superprint-core.js` | la colle (copie de `superprint_rust/web/`) |
| `superprint/app/JS/superprint-branchement.js` | **le branchement** |
| `superprint/app/index.html` | deux lignes `<script>`, après les dictionnaires |
| `superprint/app/service-worker.js` | les trois fichiers précachés, `CACHE_NAME` incrémenté |

### Les garanties

1. **Délégation immédiate.** Au chargement, `window.hyphenators` est posé avec
des moteurs qui appellent `Hypher`. Il n'existe donc **aucun instant** où la
césure serait absente.
2. **Bascule, jamais substitution.** Quand le noyau est prêt, chaque moteur
commence à répondre par Rust. Ce n'est pas un remplacement d'objet : le moteur
posé garde la même forme, donc toute référence déjà prise continue de
fonctionner.
3. **Repli automatique.** Si un appel au noyau échoue en cours de route, le
moteur repasse **sur-le-champ** à `Hypher` et le signale une fois. La
composition en cours ne casse pas.
4. **Réversibilité.** `SuperPrintBranchement.desactiver()` repasse tout sur
`Hypher` ; retirer les deux lignes de `index.html` retire le branchement.
5. **Découpage en points de code.** Les positions rendues par le noyau comptent
des caractères, pas des unités UTF-16 : le découpage se fait sur
`Array.from(mot)`. C'est documenté aux deux bouts (Rust et colle).

### Ce que le branchement ne fait pas

Il ne replie **rien** en JavaScript. Si le module WebAssembly est refusé par le
navigateur, la césure reste sur `Hypher` — qui est exactement le comportement
d'aujourd'hui. Réécrire un second moteur de césure aurait produit une variante
approximative, donc un défaut visible ; le refus est préférable.

### L'imposition et la réduction d'image : offertes, pas branchées

Les deux composants sont **mesurés et disponibles** dans
`SuperPrintBranchement` :

```js
SuperPrintBranchement.orderPages(20);   // [20, 1, 2, 19, 18, 3, …]
SuperPrintBranchement.imposition({ largeurPageMm: 210, hauteurPageMm: 297, gauche: 20, droite: 1 });
SuperPrintBranchement.reduireImage(rgb, 6000, 4000, 210, 300);
```

Mais ils ne **remplacent** rien. La raison est nette : `calculateImposition`,
`renderImposedSheet` et `buildImposedSheetCanvas` sont **privées à l'IIFE de
`main.js`** — aucune n'est posée sur `window`. Rien ne peut donc les remplacer
sans toucher au fichier, et la règle du branchement est de ne pas y toucher.

C'est un choix, pas un oubli. Le jour où l'utilisateur décidera de brancher
l'imposition pour de bon, le changement tient en trois lignes dans `main.js` :

```js
// main.js, ~31629 — remplacer le corps de calculateImposition par :
const order = (window.SuperPrintBranchement
  && window.SuperPrintBranchement.orderPages(numPages))
  || calculateImposition(numPages);   // repli : le code d'origine
```

La valeur de la réduction d'image, elle, se branche **dans notre propre
exporteur** : `sp_reduce_for_placement` réduit avant d'embarquer l'image, et ce
chemin-là est entièrement à nous — aucune ligne de `main.js` en jeu.

### La mesure, et l'anti-dérive

Trois contrôles, tous dans `check.ps1` :

- `scripts/validate-branchement.mjs` — la colle et le noyau contre les
  dictionnaires du produit, cinq langues.
- `scripts/validate-branchement-app.mjs` — les **fichiers livrés** évalués dans
  un contexte qui imite le navigateur (ordre de `index.html`, `fetch` simulé),
  puis comparés à `Hypher` : parité, **réversibilité**, **repli** quand le noyau
  manque, et **indépendance des composants** — l'imposition et la réduction
  doivent marcher même si les dictionnaires de césure sont absents.
- `scripts/validate-imposition.mjs` — l'ordre, la taille de feuille et les
  traits de coupe contre le **code de `main.js` extrait tel quel**.

Un composant qui en rend un autre dépendant est un défaut : c'est ce que le
troisième contrôle ci-dessus interdit. Lier le chargement du noyau à la présence
d'un fichier de motifs ferait échouer deux composants parce qu'un troisième n'a
pas trouvé ses données.

Une étape du même fichier compare les **empreintes SHA-256** de
`web/superprint-core.js` et `dist/superprint_core.wasm` avec leurs copies dans
`superprint/app/JS/`. Sans elle, le contrôle vérifierait autre chose que ce qui
est livré.

### Ce que la mesure a appris — lire avant de brancher le composant suivant

La césure a été chronométrée **dans le navigateur**, sur la page réelle, cinq
mille compositions successives d'un même paragraphe de 72 mots (288 000 appels
à `hyphenate`) :

| Variante | Temps | Rapport |
|---|---|---|
| `Hypher` (aujourd'hui) | 344 ms | 1,00 |
| Branché sur le noyau Rust | 856 ms | **2,49× plus lent** |
| `Hypher` **avec cache de mots** | 5 ms | 0,01 |
| Rust **avec cache de mots** | 5 ms | 0,01 |

Deux enseignements, et ils valent pour tout le portage :

1. **Un appel par mot ne se branche pas.** Traverser la frontière WebAssembly
   coûte — sérialiser le mot, allouer, appeler, relire — et ce coût est
   *supérieur* à celui du calcul lui-même. Le trie JavaScript d'`Hypher` est
   déjà rapide : la dichotomie ajoutée côté Rust (les enfants du trie sont
   désormais triés, et cherchés par dichotomie au lieu d'un balayage) a fait
   passer le rapport de 2,6× à 1,6×, mais l'a pas annulé.

2. **Ce qui compte, c'est le cache, pas le moteur.** Un paragraphe recomposé —
   à chaque frappe, à chaque redimensionnement — refait la même césure sur les
   mêmes mots. Un simple annuaire mot → fragments divise le temps par **69**,
   et rend le choix du moteur **sans effet** (0,98 entre les deux).

Conséquence à retenir pour la suite : **brancher ce qui traite de gros
volumes en un seul appel** (une image entière, une compression, une planche,
une vérification), pas ce qui est appelé des milliers de fois sur de petites
données. Et quand un composant est appelé en boucle, regarder d'abord s'il y a
un cache à poser : c'est presque toujours là que se trouve le gain.

La césure reste branchée parce qu'elle a été demandée et qu'elle est
**mesurée identique** — mais elle est le contre-exemple à garder en tête, pas
le modèle.
