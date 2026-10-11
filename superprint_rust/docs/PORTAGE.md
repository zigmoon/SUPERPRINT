# Portage en Rust — inventaire complet, fonction par fonction

Ce document répond à une demande précise : **« relis bien chaque étape et
fonction de SuperPrint, tout doit être en Rust »**. Il relève donc **tout** ce
qui existe, et dit pour chaque domaine l'un de ces quatre états :

| État | Sens |
|---|---|
| ✅ **porté** | le Rust existe, il est testé, et sa sortie est vérifiée par un outil tiers |
| � **branché** | porté **et** appelé par l'application (ou offert par le branchement) |
| 🟡 **portable** | calcul pur et déterministe : **doit** passer en Rust, pas encore fait |
| 🟠 **portable plus tard** | faisable, mais demande une chaîne (ZIP+XML, décodage JPEG…) |
| ❌ **à garder en JS** | dépend du DOM, de WebGL, du réseau ou du navigateur — le porter n'aurait pas de sens, et la raison est écrite |

Les lignes sont **mesurées, pas estimées** (relevé du 2026-10-11) :

| | |
|---|---|
| Rust (`crates/`, 13 crates, tests compris) | **28 608 lignes** |
| dont annotations `#[test]` | 684 tests, tous verts |
| exports `sp_*` de la frontière C | **43** (0 import) |
| module livrable | 379 Ko |
| étapes de contrôle (`scripts/check.ps1`) | **22** |
| JavaScript applicatif (hors bibliothèques tierces) | **125 944 lignes** |
| dont `main.js` | 99 157 lignes |
| dont `web-llm.esm.js` (IA réseau, non portable) | 14 291 lignes |

**Avancement : il n'y a pas un pourcentage, il y en a quatre** — et ils ne mesurent
pas la même chose. Dire « 16 % » sans préciser serait trompeur.

| Métrique | Mesure | Ce qu'elle dit |
|---|---|---|
| **Domaines terminés** | **10 / 11** → **91 %** | l'avancement réel du travail identifié |
| dont **branchés** dans l'application | **1 / 10** construits → **10 %** | ce qui sert vraiment à l'utilisateur |
| **Volume JS porté** (somme des plages citées) | **6 512 / 18 803** → **35 %** | le poids du travail restant |
| **Lignes** Rust / JS | 28 608 / 111 501 → **25,7 %** | ⚠️ le plus trompeur des quatre |

Les 11 domaines, nommés, avec leur état : **césure** ✅ (le seul branché) ·
**compression Flate** ✅ · **imposition** ✅ · **prépresse** ✅ · **nuanciers** ✅ ·
**image** ✅ · **profils ICC** ✅ · **PDF/X** ✅ · **pagination et chaînage** ✅ ·
**géométrie vectorielle / Pathfinder** ✅ · **import docx/EPS/IDML** 🟠 **non fait,
et assumé**.

Le domaine restant est celui qui demande le plus de code pour le moins de valeur
immédiate (une chaîne ZIP + XML, plus un sous-ensemble de PostScript). Il est
declé « plus tard » depuis le début, et il ne bouge pas : c'est le seul endroit du
document où l'avancement n'est pas mesuré par un script de contrôle.

Pourquoi le ratio par lignes trompe : il compare du Rust qui contient ses tests, un
écrivain PDF complet **sans équivalent JS**, et 4 000 lignes de lecteur de polices,
à un JavaScript dont la moitié est de la gestion d'interface. Il ne bouge presque
pas quand un module est fini, et il bougerait beaucoup si on portait une plage
facile. **Le seul chiffre à suivre est le premier : les domaines.**

> ⚠️ **Ce qui est porté n'est pas pour autant branché.** Aujourd'hui, **la césure
> reste le seul composant que l'application utilise réellement.** La compression
> est employée par notre propre exporteur ; l'imposition, la réduction d'image,
> le prépresse, les nuanciers, les filtres d'image, la lecture ICC, la
déclaration PDF/X, la pagination et le Pathfinder sont **mesurés et offerts** par
> `SuperPrintBranchement` (ou livrés comme crates), mais ne remplacent rien dans
> l'espace de travail (voir la section F, et la raison : les fonctions
> correspondantes de `main.js` sont privées à son IIFE, et le prépresse attend un
> pont qui n'existe pas encore).

---

## A. Ce qui est déjà porté, et vérifié

| # | Étape de SuperPrint | Rust | Preuve | Branché |
|---|---|---|---|---|
| 1 | Unités mm / pt / px / cm / in | `core::units` | comparé à la formule, 42 conversions | — |
| 2 | RVB → CMJN, CMJN → RVB, luminance | `core::color`, `core::color8` | parité **au bit près** vs WAT, 250 000 pixels | — |
| 3 | Fond perdu, traits de coupe, format fini | `core::geometry`, `pdf::boxes` | `pdf-lib` (3 boîtes, toujours écrites) | — |
| 4 | Tons directs `/Separation` + **teintes** | `pdf::spot`, `pdf::colorspace` | `pdf-lib` : 2 `/Separation`, teintes relues | — |
| 5 | `MediaBox` / `TrimBox` / `BleedBox` | `pdf::boxes` | `pdf-lib`, 196 × 266 mm | — |
| 6 | Document multi-pages, vectoriel, images | `pdf::document` | 6 PDF relus par `pdf-lib` | — |
| 7 | Filtre `RunLength` | `image::compress` | décodeur écrit depuis l'ISO 32000-2 | — |
| 8 | Réduction d'image, ciblage DPI | `image::resample` | **motif fin préservé**, énergie conservée | 🟢 offert |
| 9 | Métadonnées `/Info` (accents, typographie FR) | `pdf::object` | lues par `pdf-lib` : « café », tiret cadratin | — |
| 10 | `OutputIntent` + profil ICC fourni | `pdf::document` | `pdf-lib` : `/S /GTS_PDFX` | — |
| 11 | Analyse de police TrueType (`cmap`, métriques) | `superprint-font` | 31 tests, police synthétique **et** vraie police | — |
| 12 | Texte : `Type0` / `Identity-H` / `/FontFile2` | `pdf::font`, `pdf::document` | **`pdf.js` relit les caractères en clair** | — |
| 13 | Texte extractible (`/ToUnicode`) | `pdf::font` | `pdf.js` : accents, apostrophe, tiret cadratin | — |
| 14 | Frontière C (**41** fonctions, 0 import) | `superprint-wasm` | `WebAssembly.Module.imports` = ∅ | — |
| 15 | Colle web + repli JS mesuré | `web/superprint-core.js` | parité du repli octet pour octet | — |
| 16 | **Césure** (Liang + règles FR) | `text::motifs`, `text::francais`, `text::Cesure` | `hypher.js`, **2 644 mots, 7 champs identiques** | ✅ **branché** |
| 17 | **Compression DEFLATE / zlib** | `compress::{deflate,inflate,zlib}` | croisé avec `zlib` de Node, 15 jeux, 2 sens | 🟢 exporteur |
| 18 | **Imposition** (ordre, feuille, repères) | `superprint-impose` | `main.js` **extrait tel quel** : 25 tailles, 3 copies, 16 traits | 🟢 offert |
| 19 | **Réduction par moyenne de surface** | `image::resample::downscale_area` | exact **au bit près**, anti-crénelage mesuré | 🟢 offert |
| 20 | **Prépresse** (9 contrôles) | `superprint-preflight` | détection **et** silence, 45 tests, refus des règles illisibles | 🟢 offert |
| 21 | **Nuanciers** (7 bibliothèques, 688 teintes) | `superprint-swatch`, `core::lab` | catalogue comparé **octet par octet** à `swatchbooks.js`, lecture `.ase`, recherche | 🟢 offert |
| 22 | **Traitement d'image** (niveaux, courbes, filtres, netteté, médiane, encrage, alpha, recadrage) | `superprint-image` | repli JS indépendant écrit à part, comparaison octet pour octet | 🟢 offert |
| 23 | **Lecture de profil ICC** | `superprint-icc` | relecture indépendante des 3 profils du produit, **écart à la spécification mesuré** | 🟢 offert |
| 24 | **PDF/X** (XMP, `OutputIntent`, revendication) | `pdf::xmp`, `pdf::document` | `pdf-lib` relit le paquet XMP et les quatre clés de conformité | 🟢 offert |
| 25 | **Pagination et chaînage** | `superprint-flow` | invariante vérifiée (16 cas), défaut de la méthode du produit **mesuré** (18 coupures au milieu d'un mot contre 0) | 🟢 offert |
| 26 | **Géométrie vectorielle et Pathfinder** | `superprint-path` | surface du résultat vérifiée sur **212 000 points**, 45 identités d'aires | 🟢 offert |

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

### B4. Contrôle prépresse (preflight) 🟡 → ✅ (fait, et mesuré)

Le produit n'avait **aucun** contrôle avant impression : on pouvait envoyer à un
imprimeur un fichier sans fond perdu, avec une photo à 85 dpi et du noir
quadrichrome sur du 6 pt. Le noyau le dit maintenant, avant l'envoi.

| Contrôle | Rust | Ce qu'il attrape |
|---|---|---|
| Résolution des images | `preflight::verificateurs` | la **pire** des deux dimensions, à la taille **posée** (85 dpi pour une photo de 400 × 300 px sur 120 mm) |
| Couverture d'encre | idem | total > 300 % (240 % en offset couché, 260 % en journal) |
| Noir quadrichrome | idem | noir riche sur un texte fin ou un trait fin — le défaut qui fait bouger la mise en register |
| Fond perdu, réserve de repères | idem | page sans fond perdu, réserve plus courte que les 5 mm d'un trait |
| Débordement | idem | objet qui sort du fond perdu |
| Polices | idem | police référencée mais absente, police embarquée mais inutilisée |
| Profil de sortie | idem | `OutputIntent` absent, ou dont le nombre de canaux ne correspond pas à la quadri |
| Texte vivant | idem | texte non vectorisé, signalé **une fois** par page |

**Preuve mesurée** : `scripts/validate-preflight.mjs` construit les documents
par les **mêmes** outils que l'application (`createDocument`), et lit le rapport
avec le **même** lecteur. Il mesure les **deux moitiés** de chaque contrôle :

- ce qu'il doit **détecter** — un fichier fautif produit bien ses constats ;
- ce sur quoi il doit **se taire** — un document correct ne produit **rien**. Un
  contrôle qui signale tout le temps se fait désactiver et devient aussi inutile
  qu'un contrôle qui ne détecte rien, en pire : il aura fait perdre la confiance.

S'y ajoutent le tri par gravité, le refus des règles illisibles (10 formes
éprouvées), et la vérification que contrôler **ne modifie pas** le document.

**Limites, mesurées et assumées** : le prépresse **ne voit pas** ce qui n'est pas
dans le document du noyau — transparence non aplatie, surimpression, séparation
des tons directs par canal, épaisseur de trait en dessous de 0,25 pt. Ces
contrôles demandent des informations que le modèle ne porte pas encore.

**Non branché, et pourquoi** : le prépresse examine un `Document` **du noyau**,
et ce document n'existe pas dans l'application — la composition vit dans Fabric,
et rien ne la convertit. `SuperPrintBranchement.prepresse(doc)` est donc offert
et mesuré, mais la relier à l'espace de travail demande le pont
Fabric → `Document` qui reste à faire.

### B5. Nuanciers et bibliothèques de tons directs 🟡 → ✅ (fait, et mesuré)

| Étape de SuperPrint | Source actuelle | Rust |
|---|---|---|
| Catalogue des bibliothèques (Pantone, Toyo, Focoltone, HKS, RAL, NCS) | `app/JS/swatchbooks.js` (1 015 l.) | ✅ `swatch::catalogue`, données engendrées par `scripts/extract-swatchbooks.mjs` |
| Lecture d'un nuancier au format **`.ase`** (Adobe Swatch Exchange) | `main.js` (`lireAse`) | ✅ `swatch::ase` |
| Recherche d'une teinte par son nom | `main.js` | ✅ `swatch::recherche` (accents et casse repliés) |
| Teinte la plus proche dans un espace perceptuel | absent du produit | ✅ `swatch::plus_proche`, `core::lab::delta_e2000` |

**7 bibliothèques, 688 teintes**, extraites du produit et comparées **octet par
octet**. La conversion hexadécimal ↔ RVB et la recherche sont vérifiées contre un
repli JavaScript construit sur la décomposition Unicode, indépendamment de la
table d'accents explicite du noyau.

`core::lab` apporte ce que le produit n'avait pas : XYZ, Lab, adaptation
chromatique de Bradford, `ΔE*76` et `ΔE*2000`. Ce dernier est validé contre le
**jeu d'essai publié** (Sharma, Wu et Dalal) à 2 × 10⁻⁴ près — une référence
scientifique, pas un chiffre maison.

**Divergence mesurée, et assumée.** Sur un `.ase` dont le **dernier** bloc est en
niveaux de gris, le produit lit trois flottants alors que le modèle en déclare un :
il lit hors du tampon, lève une exception et **perd la teinte**. Le noyau lit le
nombre déclaré, et rend une teinte de plus. Ce n'est pas une correction opportune :
c'est un écart mesuré sur un fichier réel, et le script de contrôle l'affiche
(« produit 1 teinte, noyau 2 »).

### B6. Traitement d'image 🟡 → ✅ (fait, et mesuré)

| Étape | Source | Rust |
|---|---|---|
| Réduction à la résolution utile | `drawImage` du navigateur | ✅ `image::resample::downscale_area` |
| Taille utile pour un placement | `main.js` (implicite) | ✅ `image::resample::target_size_for_dpi` |
| Réduction rapide (plus proche voisin) | — | ✅ `image::resample::downscale_nearest` |
| Recadrage | `main.js` 26531-26830 | ✅ `RgbImage::recadrer`, `GrayImage::recadrer` |
| Niveaux, courbes, gamma, auto-niveaux | `main.js` 73798-74344 | ✅ `image::niveaux` |
| Flou gaussien, netteté (masque flou), médiane | `main.js` 73798-74344 | ✅ `image::filtres` |
| Simulation d'encrage, GCR, limite de taux | `main.js` 23360-23475 | ✅ `image::encrage` |
| Canal alpha, composition, aplatissement | **absent** du produit | ✅ `image::alpha` |
| Décodage JPEG / PNG | délégué au navigateur | 🟠 **reste au navigateur**, comme avant |

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

**Preuve mesurée** : `scripts/validate-reduction.mjs` vérifie la réduction **au
bit près** contre une moyenne arithmétique entière calculée indépendamment, la
survie du motif fin, la conservation de l'énergie (0,005 à 0,4 % d'écart), et les
invariants (jamais d'agrandissement, identité à taille égale, déterminisme).
`scripts/validate-image.mjs` traite le reste du domaine : niveaux, courbes, flou
(en 2D d'un seul tenant côté repli, séparable côté noyau), médiane, netteté,
limite d'encrage, composition alpha, recadrage. La comparaison est **à l'octet
près**, sauf le flou, toléré à une unité — l'écart entre un filtre séparable et un
filtre 2D est un arrondi, et il est mesuré plutôt que caché.

Les **propriétés** sont vérifiées, et pas seulement les valeurs : la limite
d'encrage est idempotente et ne relève jamais un canal ; un calque entièrement
transparent laisse le fond intact ; un recadrage ne fabrique jamais de pixel et
refuse un rectangle qui ne recouvre rien ; un document déjà sous la limite
ressort **inchangé, octet pour octet**.

**Ce que la mesure a appris** : la vitesse **n'est pas** l'argument. Sur
3 000 × 2 000 pixels, le noyau Rust met le même temps qu'une boucle JavaScript
équivalente (0,99×) — la copie des 18 Mo de pixels dans la mémoire du module
annule le gain du calcul. Ce module vaut par sa **méthode**, pas par sa vitesse.
À comparer à la césure (section F) : elle est branchée et 1,6 à 2,5 fois plus
**lente**. La bonne question n'est donc jamais « est-ce que Rust va plus vite ? »
mais « est-ce que le calcul est juste, et assez gros pour un seul appel ? ».

### B7. Géométrie vectorielle 🟡 → ✅ (fait, et mesuré)

| Étape | Source | Rust |
|---|---|---|
| Plume / Bézier : évaluation, subdivision, boîte exacte | `simple-pen-tool.js` (1 010 l.) | ✅ `path::courbe` |
| **Aplatissement** de courbes à une tolérance donnée | Paper.js | ✅ `path::courbe::aplatir` — et la tolérance est **vérifiée** |
| Règles de remplissage `nonzero` / pair-impair | Paper.js | ✅ `path::polygone::{enroulements, croisements}` |
| Pathfinder : union, soustraction, intersection, exclusion | Paper.js (`unite`, `subtract`, `intersect`, `exclude`) | ✅ `path::booleen` |
| Normalisation d'anneaux (sommets confondus, alignés) | Paper.js | ✅ `Polygone::nettoyer` |

La **géométrie** est portée ; la **souris** et le rendu de la plume restent au
navigateur, et c'est leur place.

**Le produit ne calculait rien lui-même** : `performPaperOperation` convertit les
formes Fabric en chemins Paper.js et appelle la bibliothèque — **235 Ko de code
tiers**. Ce crate porte l'algèbre booléenne, sans aucune dépendance.

**La méthode, et pourquoi elle résiste aux cas tordus.** Les arêtes des deux
formes sont découpées à tous leurs contacts ; chaque morceau est ensuite classé par
une question **purement ensembliste** — la forme du résultat est-elle remplie d'un
côté du segment, et pas de l'autre ? — puis orienté avec la partie remplie à
gauche, et enfin enchaîné en anneaux. L'élégance du classement est qu'il ne connaît
pas l'opération : union, intersection, différence et exclusion ne diffèrent que par
une fonction de deux booléens. Les arêtes **colinéaires** — deux carrés qui se
touchent, cas où les implémentations naïves se cassent — tombent donc naturellement,
sans code particulier.

Quand deux formes ne se touchent qu'en un **point**, le sommet voit quatre
segments : le noyau prend le virage **le plus à gauche**, ce qui détache les deux
formes l'une de l'autre et rend deux anneaux **simples**. Un anneau qui se croise
en un point serait une forme dont « dedans » n'a pas de sens, ce qui est la moindre
des choses à éviter pour un résultat de Pathfinder.

**La vérification** (`scripts/validate-path.mjs`) ne demande pas au noyau s'il est
content de lui : elle prend les anneaux du résultat, demande à ce résultat s'il
contient chaque point d'un échantillon, et compare avec la **définition
ensembliste** appliquée aux deux formes d'entrée, recalculée en JavaScript.

| Contrôle | Résultat mesuré |
|---|---|
| surface du résultat, point par point | **212 000 points, 0 désaccord** |
| anneaux du résultat non auto-intersectants | 53 / 53 |
| identités d'aires (`A∪B + A∩B = A + B`, etc.) | 45 / 45 |
| refus, et refus injustifiés | 7 refus justifiés, **0 injustifié** |
| aplatissement dans la tolérance (5 courbes × 4 tolérances) | pire rapport écart/tolérance : **0,98** |

**Une faute de tracé trouvée par la mesure, et corrigée.** Le critère de platitude
classique — l'écart des points de contrôle à la corde — déclarait **plate** une
courbe dont tous les points de contrôle sont **alignés** sur la corde. C'est
exactement le cas d'une poignée tirée en arrière, ce qui arrive dès qu'on édite un
nœud. La courbe **rebrousse** au-delà de ses extrémités, et la polyligne restait à
0,74 de la courbe **quelle que soit la tolérance demandée** — 0,1 comme 0,001 —
parce que la subdivision s'arrêtait au premier niveau. Aucun test unitaire ne
l'avait vu ; c'est le contrôle d'écart qui l'a montré. Le critère exige maintenant
que les points de contrôle se **projettent** sur la corde, et la régression est
testée.

**Ce qui n'est pas fait** : l'épaississement d'un trait (transformer un contour en
surface, avec joins et extrémités) et les décalages de courbe. Ils sont utiles mais
ne sont pas ce que le produit demandait au Pathfinder ; ils viendraient avec
l'import SVG et le rendu de plume.

### B8. Import de documents 🟠 (toujours pas fait, et c'est le seul)

| Étape | Source | Remarque |
|---|---|---|
| `.docx` / `.xlsx` / `.odt` / `.ods` | `sp-doc-import.js` (1 233 l.) | ZIP + XML → demande un décodeur ZIP (`inflate` : ✅ fait) |
| RTF, HTML, TXT | `sp-doc-import.js` | analyse syntaxique, portable |
| EPS / AI (PostScript) | `sp-eps-import.js` (869 l.) | sous-ensemble PostScript — gros morceau |
| IDML (InDesign) | `main.js` 41812-45723 | ZIP + XML, ~4 000 l. de JS |
| SVG | délégué au navigateur | parseur XML + `path::{Courbe, Polygone}`, désormais disponibles |

C'est le **seul** domaine encore ouvert. Ce qui existe déjà et servira :
`compress::inflate` pour le ZIP, `path::Courbe` et `path::Polygone` pour les tracés
importés.

### B9. Profil ICC (module 7) 🟡 → ✅ (fait, et mesuré)

Lire l'en-tête et les balises d'un profil ICC. La **transformation** reste à
`lcms-wasm` (Little CMS, C compilé — on ne réécrit pas un moteur de gestion de
couleurs), et le noyau ne cherche pas à la refaire.

Ce que `superprint-icc` sait faire : identité (`Espace`, `Classe`), version, point
blanc, description du profil (encodage v2 et v4), tables de balises avec taille
déclarée et taille calculée, et les **trois conditions** qui font qu'un profil peut
servir de condition d'impression.

**Ce que la mesure a appris, et qui vaut d'être su.** Les profils livrés par Adobe
**ne suivent pas la mise en page de la spécification**. Sur `CoatedFOGRA39`, les
balises `mft2` sont **1 520 octets plus courtes** que la spécification ne l'exige
(en-tête de 52 octets au lieu de 48, table de sortie de 12 octets au lieu de
1 536), et les balises `mft1` **40 octets plus longues**. La mise en page réelle est
déductible — et c'est **précisément pourquoi le noyau refuse de la déduire** : un
lecteur qui connaît la particularité d'Adobe se casse en silence sur un profil
conforme. Le noyau mesure l'écart et le publie ; il ne devine pas.

`scripts/validate-icc.mjs` relit les trois profils réels de façon indépendante
(en-tête, nom, point blanc, les 10 à 14 balises avec leur décalage, leur taille et
leur type), vérifie les écarts, éprouve les refus (fichier tronqué, signature
détruite, taille déclarée absurde, table de balises débordante, balise pointant
hors du fichier), et passe **83 fichiers tronqués ou corrompus** au noyau : aucun
plantage, un refus à chaque fois.

### B10. PDF/X et conformité 🟡 → ✅ (fait, et mesuré)

Le noyau écrivait un `/Info` complet et un `OutputIntent` porteur du profil, et
**rien d'autre** : un imprimeur recevait un fichier qui **avait l'air** d'un PDF/X
sans en porter la déclaration. Sur un PDF/X, c'est la déclaration qui engage, pas
la ressemblance.

Ce qui est écrit : paquet **XMP** complet (`/Metadata` en flux `Subtype /XML`),
`GTS_PDFXVersion`, `GTS_PDFXConformance`, `pdfaid:part`, `pdfaid:conformance`, les
métadonnées `dc:` et `pdf:`, et une date stockée **une seule fois** en ISO 8601,
convertie à l'écriture — une date illisible est **omise** plutôt que recopiée.

La conformité est un **type à trois valeurs**, pas une chaîne libre : `PDF/X-1a`,
`PDF/X-3` et `PDF/X-4`, chacune portant ce qu'elle engage. Il en découle des
**refus**, et c'est là que le module vaut quelque chose : revendiquer PDF/X **sans**
profil fourni est refusé (un faux PDF/X est pire qu'un PDF ordinaire) ; `PDF/X-1a`
avec une image en RVB est refusé ; le **même fichier** sous `PDF/X-3` est accepté.

`scripts/validate-pdfx.mjs` relit le PDF avec `pdf-lib`, vérifie l'équilibre des
balises XML, les quatre clés de conformité attendues pour chaque norme, compare le
profil ICC embarqué **octet par octet** (639 Ko), éprouve les trois refus, et ajoute
un **contrôle négatif** : le même document sans revendication ne doit porter **ni**
XMP, **ni** `/Metadata`, **ni** `GTS_PDFXVersion`.

### B11. Texte : pagination, chaînage, habillage 🟡 → ✅ (fait, et mesuré)

| Étape | Source | Rust |
|---|---|---|
| Chaînage de blocs texte | `main.js` 30890-31626 | ✅ `flow::repartition`, `flow::chaine` |
| Auto-pagination, coulage de texte | `main.js` 25909-26530, 48456 | ✅ `flow::repartition::repartir` |
| Retraits de paragraphe, espaces avant/après | `main.js` 11889-11989 | ✅ `flow::flux::Paragraphe` |
| Veuves et orphelines | absent du produit | ✅ `coupure_inacceptable` |
| Clip de `TextBox` à hauteur fixe | `main.js` 12034-13748 | 🟠 reste au navigateur : c'est du rendu |
| Styles typographiques (16 combinaisons) | `main.js` 72158-73046 | 🟠 données d'interface, à porter avec le branchement |

**Le défaut que ce domaine traite est mesuré dans le produit lui-même.**
`initDimensions()` coûte 1,9 ms sur 1 000 caractères, 45,8 ms sur 50 000,
8 270 ms sur 300 000. Une chaîne de **124 blocs sur 403 123 caractères prend
128 secondes**, application gelée. Et ce n'est pas seulement lent : couper sur un
indice de **caractère** tombe **au milieu d'un mot**.

Le noyau compose **une fois** en lignes, puis répartit les lignes. Mesuré :

| | méthode du produit | noyau |
|---|---|---|
| coupures au milieu d'un mot (8 géométries de contrôle) | **18** | **0** |
| recompositions, 18 059 caractères sur 40 cadres | **101** | **1** |
| coût de 200 → 800 paragraphes | — | 1 400 → 5 600 mesures, 1 ms → 4 ms (linéaire) |

**Aucun caractère perdu ni dupliqué** : c'est une invariante, pas un espoir.
`Repartition::verifier` compare le flux de caractères du texte placé et du reste à
celui de l'entrée, et le nombre de cadres à celui de la chaîne. Seize cas la
vérifient, et trois tests fabriquent **délibérément** une perte, une ligne perdue,
un doublon et un mauvais nombre de cadres pour s'assurer que le contrôle les
attrape.

**Limite de l'invariante, écrite là où elle s'applique** : le compositionneur insère
des tirets conditionnels de césure, et un tiret conditionnel est indistinguable d'un
tiret authentique une fois le texte placé. L'invariante porte donc sur les caractères
**hors espaces et hors tirets**. Ce n'est pas une faiblesse cachée : c'est la limite
exacte de ce qui est vérifiable sur du texte composé.

**Espaces, veuves et orphelines.** L'espace après un paragraphe appartient à la
**transition**, pas au paragraphe : il est reporté sur la première ligne du
paragraphe suivant et fusionné par `max` avec son espace avant. Une coupure entre
deux cadres est refusée si elle laisse moins de deux lignes d'un côté ou de l'autre,
et un paragraphe qui tiendrait entier dans un cadre part au cadre suivant plutôt que
d'être coupé.

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

| Rang | Module | État |
|---|---|---|
| ~~1~~ | ~~Césure (module 5)~~ | ✅ **fait**, et ✅ **branché** dans l'application (5 langues) |
| ~~2~~ | ~~Compression Flate~~ | ✅ **fait** — 108× sur du vectoriel, 2,4× sur le `.wasm` |
| ~~3~~ | ~~Imposition (planches)~~ | ✅ **fait et mesuré** — ordre, feuille et traits de coupe contre `main.js` |
| ~~4~~ | ~~Preflight~~ | ✅ **fait et mesuré** — 9 contrôles, détection **et** silence |
| ~~5~~ | ~~Nuanciers~~ | ✅ **fait et mesuré** — catalogue comparé octet par octet, 688 teintes |
| ~~6~~ | ~~PDF/X : XMP~~ | ✅ **fait et mesuré** — déclaration écrite, et refusée quand elle serait un mensonge |
| ~~7~~ | ~~Pagination / chaînage~~ | ✅ **fait et mesuré** — défaut du produit mesuré (18 coupures au milieu d'un mot contre 0) |
| ~~8~~ | ~~Filtres, niveaux, encrage, alpha~~ | ✅ **fait et mesuré** — repli JS indépendant, à l'octet près |
| ~~9~~ | ~~Lecture de profil ICC~~ | ✅ **fait et mesuré** — et l'écart des profils Adobe à la spécification est publié |
| ~~10~~ | ~~Réduction d'image~~ | ✅ **fait et mesuré** — remonté au rang 4 : c'était le défaut de **justesse** le plus net |
| ~~11~~ | ~~Pathfinder~~ | ✅ **fait et mesuré** — 212 000 points vérifiés contre la définition ensembliste |
| **12** | **Import ZIP + XML (docx, idml, odt)** | 🟠 **le seul qui reste** — gros, mais `inflate` est fait |
| **13** | **PostScript / EPS** | 🟠 sous-ensemble de PostScript : le morceau le plus ingrat du lot |

**Ce qui est porté n'est pas pour autant branché, et ce qui est branché n'est
pas pour autant utile.** Les leçons, à relire avant de brancher le composant
suivant :

- La **césure** est branchée et **plus lente** (1,6 à 2,5×) : elle vivait en
  Rust pour l'unification, pas pour la vitesse.
- La **réduction d'image** est plus juste (elle retrouve un motif que
  l'échantillonnage fait disparaître) mais **pas plus rapide** : à volume égal,
  la copie des pixels dans la mémoire du module annule le gain du calcul.
- Le **chaînage** est le premier composant dont la mesure a montré, non pas une
  différence de vitesse, mais un **défaut de justesse chez le produit** : couper
  sur un indice de caractère coupe au milieu des mots. C'est ce défaut, et non un
  gain de temps, qui justifie son branchement.

Rester à brancher, parmi ce qui existe : les conversions de couleurs, les unités,
le RunLength. L'imposition, la réduction d'image, le prépresse, les nuanciers, les
filtres, la lecture ICC, la déclaration PDF/X, le chaînage et le Pathfinder sont
**offerts** par `SuperPrintBranchement` (ou livrés comme crates), mais pas branchés :
les fonctions correspondantes de `main.js` sont privées à son IIFE, et la règle est
de **ne pas modifier** `main.js`. Voir la section F pour la ligne exacte à changer.

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
| **Prépresse** | documents construits et rapport relu par les **mêmes** outils que l'application | **détection *et* silence** : 9 contrôles, chacune des deux moitiés mesurée |
| **Nuanciers** | `swatchbooks.js`, `index.html` et le `lireAse` du produit, **extraits** | **catalogue identique octet par octet**, 7 bibliothèques, 688 teintes, divergence `.ase` exposée |
| **Traitement d'image** | repli JavaScript écrit à part, et formules de la spécification | **à l'octet près** (flou : ±1, mesuré), plus les propriétés (idempotence, ne relève jamais un canal) |
| **Profils ICC** | relecture indépendante des 3 profils réels + 83 fichiers abîmés | **écart à la spécification calculé** (1 520 octets sur `mft2`), aucun plantage, un refus par fichier |
| **PDF/X** | `pdf-lib` + contrôle d'équilibre XML + comparaison octet par octet du profil | **déclaration exacte, refus des trois mensonges, et contrôle négatif** |
| **Pagination et chaînage** | invariante de caractères + méthode du produit rejouée en JS | **16 cas sans perte, 18 coupures au milieu d'un mot contre 0, 101 recompositions contre 1** |
| **Géométrie vectorielle** | définition ensembliste des opérations, appliquée aux entrées en JS | **212 000 points sans désaccord, 45 identités d'aires, 0 refus injustifié** |
| **Branchement césure (colle)** | `hypher.js` + dictionnaires du produit | **5 langues, 2 433 mots identiques** |
| **Branchement césure (livré)** | fichiers réels de `superprint/app/JS/` | **2 129 mots × 5 langues, réversibilité et repli** |
| **Branchement imposition + réduction** | fichiers réels, dans un bac à sable navigateur | **plan conforme, composants indépendants de la césure** |
| **Branchement prépresse** | fichiers réels, dans le **navigateur** | document correct accepté, document fautif **dénoncé** (4 constats), règle illisible **refusée** |

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

### Le prépresse : offert, et volontairement pas branché

`SuperPrintBranchement.prepresse(document)` examine un document **du noyau** :

```js
const rapport = SuperPrintBranchement.prepresse(doc);
rapport.acceptable;        // false si au moins une erreur
rapport.compte;            // { erreurs, avertissements, informations }
rapport.constats;          // [{ code, gravite, page, message, … }]
```

Il n'est **pas** branché, et cette fois la raison n'est pas une fonction privée :
c'est que **le document n'existe pas**. La composition vit dans Fabric ; rien ne
la convertit en `Document` du noyau. Brancher le prépresse pour de bon demande
donc d'abord un pont Fabric → `Document` — un vrai morceau de travail, et pas une
ligne dans `main.js`. Tant que ce pont n'existe pas, un prépresse « branché »
rendrait un rapport vide sur un document vide : exactement le genre de contrôle
qui fait perdre confiance. Il attend donc son pont, et il le dit.

### La mesure, et l'anti-dérive

Trois contrôles de branchement, tous dans `check.ps1` :

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
