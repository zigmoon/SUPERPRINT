# Branchement du noyau Rust dans l'application

Ce dossier contient **tout ce qu'il faut** pour que l'application utilise le noyau
Rust/WebAssembly. Rien n'a été écrit dans `superprint/` : ce document explique
pourquoi, et ce qu'il reste à faire pour l'activer.

## En une phrase

`web/superprint-core.js` est une colle qui charge `dist/superprint_core.wasm` et
présente au code de l'application des fonctions simples — et si le
WebAssembly n'est pas disponible, elle **retombe sur des implémentations
JavaScript** en le signalant, sans jamais casser le produit.

## Les trois fichiers à connaître

| Fichier | Rôle |
|---|---|
| `dist/superprint_core.wasm` | le module compilé (≈ 262 Ko, **aucun import**) |
| `web/superprint-core.js` | la colle : chargement, fonctions amicales, repli |
| `web/demo.html` + `web/demo.js` | le banc d'essai : 27 mesures affichées dans le navigateur |

Rien d'autre n'est nécessaire. Pas de `wasm-bindgen`, pas de `wasm-pack`, pas
d'étape de compilation côté JavaScript.

## Utiliser la colle

```html
<script src="superprint-core.js"></script>
<script>
  SuperPrintCore.load({ url: 'superprint_core.wasm' }).then(function (noyau) {
    // noyau.backend vaut 'wasm' ou 'js' — à journaliser, pas à ignorer.
    console.log('noyau SuperPrint :', noyau.backend, noyau.version);

    var cmyk = noyau.rgbToCmyk(rgb);            // Uint8Array en entrée, en sortie
    var gris = noyau.luma(rgb);
    var reduit = noyau.downscaleBilinearRgb(rgb, 6000, 4000, 3000, 2000);
    var t = noyau.targetSizeForDpi(6000, 4000, 600, 300);   // { width, height }
  });
</script>
```

### Ce qui est exposé

`rgbToCmyk` · `cmykToRgb` · `luma` · `runLengthEncode` · `runLengthDecode` ·
`targetSizeForDpi` · `downscaleBilinearRgb` · `downscaleNearestRgb` ·
`mmToPt` · `ptToMm` · `mmToPx` · `pxToMm` · `writeSpotPage` ·
`writeSpotPageGray` · `loadFont` · **`createDocument`** · **`ouvrirPlanche`**

### Écrire une planche imposée

`ouvrirPlanche()` rend un objet qui **pose des faces** — une par page du PDF — et
les oublie au fur et à mesure : c'est ce qui permet d'imposer un livret sans
garder tous ses rendus en mémoire.

```js
const planche = noyau.ouvrirPlanche({
  largeurPageMm: 210, hauteurPageMm: 297, fondPerduMm: 3, inclureFondPerdu: true,
  decoupePageAPage: false, reperesDeCoupe: true,
  mode: 'cmjn',                      // 'rvb' | 'cmjn' | 'gris'
  fondBlanc: true,
  filtre: 'auto',                    // 'auto' | 'aucun' | 'rle' | 'flate'
  icc: octetsIcc,                    // facultatif
  sortie: { composantes: 4, identifiant: 'FOGRA39', description: 'Coated FOGRA39',
            conformite: 'pdfx-1a' },
});

// Deux pages côte à côte : le rendu de gauche et celui de droite, en RVB,
// trois octets par pixel, ligne du HAUT en premier — l'ordre d'un ImageData.
planche.face({
  places: [4, 1],
  rendus: [{ pixels: rvbGauche, width: 159, height: 215 },
           { pixels: rvbDroite, width: 159, height: 215 }],
});

const { pdf, rapport } = planche.ecrire();
// rapport.faces, rapport.planches[i].formatFiniMm / mediaMm / reperes / zonesMm
```

Ce que le montage **ne fait pas**, et qu'il faut savoir avant de s'en servir : il
pose les pages **en image**, donc le texte de la planche n'est pas du texte ; il
ne porte pas les tons directs ; et il refuse ce qu'il ne peut pas tenir (PDF/X-1a
en RVB, conformité sans profil) plutôt que de le revendiquer.

### Écrire un document complet

`createDocument()` rend un objet à construire par étapes. Le modèle de
coordonnées est celui d'un logiciel de PAO : les **millimètres du format fini**,
`(0, 0)` en bas à gauche, ordonnée croissante. Le fond perdu et les traits de
coupe sont hors de ce repère.

```js
const doc = noyau.createDocument();

// Métadonnées (facultatif).
doc.info('title', 'Affiche — concert').info('author', 'Zigmoon');

// Page 1 : CMJN, 170 × 240 mm, 3 mm de fond perdu, 10 mm réservés aux traits.
doc.addPage({ trimWidthMm: 170, trimHeightMm: 240, bleedMm: 3, markMm: 10, quadri: 'cmyk' });

// Encres directes : leur rang sert ensuite à les peindre.
const rouge = doc.addInk({ space: 'cmyk', name: 'PANTONE WARM RED C', c: 0, m: 0.9, y: 0.8, k: 0 });
const bleu  = doc.addInk({ space: 'rgb',  name: 'PANTONE 300 C',      r: 0, g: 94, b: 184 });

// Formes : remplissage et contour, épaisseur en millimètres.
doc
  .fillRect({ x: 15, y: 150, width: 80, height: 60, paint: { spot: { index: rouge, tint: 0.5 } } })
  .strokeRect({ x: 15, y: 150, width: 80, height: 60, widthMm: 0.5, paint: { cmyk: { c: 0, m: 0, y: 0, k: 1 } } })
  .fillCircle({ cx: 120, cy: 180, radius: 25, paint: { spot: { index: bleu, tint: 1 } } })
  .fillPolygon({ points: [[20, 40], [80, 100], [140, 40]], paint: { cmyk: { c: 1, m: 0, y: 0.3, k: 0 } } })
  .line({ x1: 0, y1: 130, x2: 170, y2: 130, widthMm: 0.35, paint: { cmyk: { c: 0, m: 0, y: 0, k: 1 } } });

// Image : les pixels entrent, un descripteur sort. La réduire d'abord.
const image = doc.addImageGray(grisReduit, 1004, 1418, 'auto');
doc.placeImage({ image, x: 25, y: 20, width: 60, height: 85 });

// Texte : la police d'abord (TrueType obligatoire), puis les lignes.
const police = doc.addFont(await noyau.loadFont('fonts/IBMPlexSans-400-normal.ttf'));
doc.text({
  font: police,
  size: 12,                       // corps, en points
  x: 20, y: 200,                  // mm du format fini, y = ligne de base
  paint: { spot: { index: rouge, tint: 1 } },
  text: 'À l’imprimeur\ncafé — déjà vu',   // `\n` = ligne suivante (interligne 1,2 × corps)
});

// Page 2 : un autre format, une autre quadri.
doc.addPage({ trimWidthMm: 100, trimHeightMm: 100, bleedMm: 0, markMm: 0, quadri: 'rgb' });
doc.fillRect({ x: 10, y: 10, width: 80, height: 80, paint: { rgb: { r: 230, g: 60, b: 40 } } });

// Destination de sortie : facultatif, mais les octets ICC sont exigés.
// doc.outputIntent({ components: 4, identifier: 'FOGRA39', info: 'Coated FOGRA39', icc: octetsIcc });

doc.marks(false);   // pour couper les traits de coupe (tracés par défaut)
const pdf = doc.write();   // Uint8Array prêt à télécharger

// Un PDF peut s'écrire et rester incomplet : la police peut ne pas dessiner
// une lettre. Ce compteur le dit — 0 veut dire « tout s'imprimera ».
if (doc.substitutions() > 0) {
  console.warn(doc.substitutions() + ' caractère(s) sans dessin dans la police choisie');
}
```

### Le texte en trois points

1. **`addFont(octets)` accepte un fichier TrueType** (`.ttf`). Les contours
   **CFF** (`.otf`, `.otc`), les collections (`.ttc`) et les formats compressés
   (`.woff`, `.woff2`) sont **refusés** — avec un message qui dit pourquoi, plutôt
   qu'un PDF dont le texte ne s'imprimerait pas. `loadFont(url)` télécharge le
   fichier si besoin.
2. **La police est embarquée en entier.** Le sous-ensemble n'est pas fait : le
   fichier est plus lourd (comptez la taille de la police), mais **aucun glyphe
   ne peut manquer à l'impression**.
3. **Le texte est extractible.** Le noyau écrit une table `/ToUnicode`, donc le
   texte reste sélectionnable, copiable et cherchable. C'est vérifié à
   l'extraction par `pdf.js` dans `scripts/validate-text.mjs` : sans cette table,
   le PDF s'afficherait sans qu'aucun lecteur ne puisse relire un mot.

### Ce que l'exporteur sait faire, et ce qu'il ne sait pas

| Sait faire | Ne sait pas (encore) |
|---|---|
| Plusieurs pages, formats différents | **Sous-ensemble de police** (police entière embarquée) |
| `MediaBox` / `TrimBox` / `BleedBox` | Crénage, écritures complexes, bidirectionnel |
| Traits de coupe | `/FlateDecode`, `/DCTDecode` (RunLength seul) |
| Tons directs `/Separation` **avec teintes** | Chaînes UTF-16BE en métadonnée (hors PDFDocEncoding → `?`) |
| Quadri CMJN ou RVB, page par page | Écriture XMP, donc pas de PDF/X revendiqué |
| Rectangles, cercles, polygones, segments | Décodage JPEG/PNG à l'entrée |
| Images grises ou RVB placées et mises à l'échelle | Césure / habillage du texte |
| **Texte dans une police TrueType embarquée** | |
| **Texte extractible** (accents, typographie française) | |
| Métadonnées en PDFDocEncoding (accents et typographie) | |
| `OutputIntent` avec un profil ICC fourni | |

### Écrire un PDF

```js
var pdf = noyau.writeSpotPage({
  trimWidthMm: 170, trimHeightMm: 240, bleedMm: 3, markMm: 10,
  quadri: 'cmyk',
  inks: [
    { space: 'cmyk', name: 'PANTONE WARM RED C', c: 0, m: 0.9, y: 0.8, k: 0 },
    { space: 'rgb',  name: 'PANTONE 300 C', r: 0, g: 94, b: 184 },
  ],
});
// `pdf` est un Uint8Array : à confier à un Blob ou à un téléchargement.
```

## Les deux pièges, et comment la colle les traite

### 1. `memory.buffer` se détache

Dès qu'une fonction Rust agrandit la mémoire du module, le `ArrayBuffer` change
d'identité : toute vue `TypedArray` construite **avant** l'appel devient
inutilisable (longueur 0, accès qui lèvent). La règle est simple :

> Ne jamais garder une vue au-delà de l'appel courant.

La colle applique cette règle partout et rend toujours des **copies**
(`Uint8Array`) : le code appelant n'a jamais à y penser.

### 2. La mémoire n'est pas ramassée toute seule

Le module n'a pas de ramasse-miettes : chaque `sp_alloc` doit être rendu par un
`sp_free`. La colle encapsule chaque appel dans une portée qui **rend tous ses
blocs**, y compris quand une exception est levée. Un contrôle d'endurance
(2 000 tours × 4 appels) vérifie que la mémoire ne dérive pas.

## Le repli JavaScript

Si le module ne se charge pas — fichier absent d'un déploiement, navigateur sans
WebAssembly, politique de sécurité — `load()` **ne fait pas échouer
l'application**. Elle rend un moteur `js` et renseigne `fallbackReason`.

Ce repli couvre les couleurs, la luminance, le filtre RunLength, le ciblage DPI,
la réduction d'image et les unités. Ses résultats sont comparés **octet pour
octet** à ceux du noyau Rust : 250 000 pixels pour les couleurs, des images
synthétiques pour la réduction. Deux implémentations écrites indépendamment,
mêmes sorties au bit près — c'est mesuré, pas supposé.

**Ce qu'il ne couvre pas : l'écriture PDF.** On ne réécrit pas un assembleur PDF
en JavaScript par-dessus le marché. `writeSpotPage`, `writeSpotPageGray`,
`createDocument` et `ouvrirPlanche` — donc tout le texte, les polices et les
planches imposées — **lèvent une erreur explicite** (`CoreError`, code
`UNAVAILABLE`) au lieu de rendre un résultat approximatif. Dans ce cas, c'est
l'exporteur JavaScript existant de SuperPrint qui prend le relais — c'est
exactement ce que la règle « aucune bascule à l'aveugle » demande. `loadFont` fait
exception : c'est un simple téléchargement, sans noyau, et il fonctionne donc
aussi en repli.

```js
if (noyau.backend === 'js') {
  // on garde l'exporteur JS pour le PDF, on profite du reste
}
```

## Ce qui est branché dans `superprint/`, aujourd'hui

Ce document a longtemps dit « rien n'est branché ». Ce n'est plus vrai, et voici
l'état exact — chaque ligne est un fichier **ajouté** plus une ligne `<script>`,
donc retirer la ligne remet l'application à l'identique :

| Ce qui est branché | Colle | Noyau | Repli |
|---|---|---|---|
| césure (5 langues) et conversion des couleurs | `app/JS/superprint-branchement.js` | `superprint_core.wasm` (406,5 Ko, précaché) | `Hypher`, `_spCmykConvert` |
| import PostScript / EPS | `app/JS/superprint-eps.js` | `superprint_eps.wasm` (324,8 Ko, **à la demande**) | `sp-eps-import.js` |
| export PDF imposé | `app/JS/superprint-montage.js` | le **même** module que le branchement | l'export vectoriel du produit |
| import de documents (`.odt`/`.ods`/`.odp`, `.idml`) | `app/JS/superprint-doc.js` | `superprint_doc.wasm` (290,1 Ko, **à la demande**) | `_spTexteOdf` du produit, conservée dans `window.__spTexteOdfJs` |
| contrôle prépresse | `app/JS/superprint-prepresse.js` | le **même** module que le branchement — **aucun octet de plus** | aucun : sans noyau, la colle ne dit rien et l'export part |

`main.js` n'a **jamais** été modifié pour les trois premiers : chaque joint est une
couture que le produit offrait déjà (`window.hyphenators`, `window._spCmykConvert`,
`if (window.SPEps)`, `window.exportImposedPDF || exportImposedPDF`). Le
**prépresse** non plus : `window.confirmExport` était déjà posé et lu par
`index.html`.

Le quatrième a demandé **trois lignes ajoutées** — c'est une première, et elle est
écrite pour ne pas être découverte :

```js
window._spTexteOdf = _spTexteOdf;                        // AJOUT : la porte d'entrée
var lireOdf = window._spTexteOdf || _spTexteOdf;         // AJOUT : le noyau, sinon le produit
if (type === 'idml' || ext === 'idml') { … }             // AJOUT : gardé par window.SuperPrintDoc
```

Aucune ligne existante n'a changé de sens : sans la colle, `window._spTexteOdf`
vaut exactement la fonction d'avant, et la branche `.idml` ne se déclenche pas.
Retirer les trois lignes remet l'application à l'identique.

## Vérifier

```powershell
# module + colle + repli + PDF relus par pdf-lib
pwsh -File scripts/check.ps1

# l'export imposé BRANCHÉ : contrat mesuré dans main.js, refus, replis, et la
# chaîne complète jusqu'au PDF relu par pdf-lib
node scripts/validate-montage-branchement.mjs

# l'import de documents BRANCHÉ : le texte du produit et celui du noyau sur les
# mêmes octets, puis la chaîne complète (repli compris)
node scripts/validate-doc-branchement.mjs

# le prépresse BRANCHÉ : le contrat relu dans main.js, l'échelle mesurée (85 dpi
# sur le témoin documenté), l'invariance du retournement mesurée elle aussi, et
# le repli
node scripts/validate-prepresse-branchement.mjs

# le TEXTE : police embarquée, composition, puis relecture des caractères par
# pdf.js — c'est la table /ToUnicode qui est mise à l'épreuve
node scripts/validate-text.mjs

# banc d'essai navigateur (le fetch du .wasm est refusé en file://)
node scripts/serve-web.mjs
# puis ouvrir http://127.0.0.1:8777/superprint_rust/web/demo.html
```

Le banc d'essai affiche le moteur actif et son bilan. Il expose aussi ses
résultats dans `window.__preuve`, ce qui permet à un contrôle automatisé de lire
des faits plutôt que l'apparence de la page.

## Résultat mesuré dans Chrome

| Mesure | Résultat |
|---|---|
| moteur | WebAssembly, 261,8 Ko |
| essais | 27 / 27 |
| RVB → CMJN, 65 536 pixels | identique au repli, octet pour octet |
| luminance, 65 536 pixels | identique au repli, octet pour octet |
| aplat 65 536 octets (RunLength) | 1 024 octets, ×64 |
| 1 200 × 1 200 → 300 × 300 | identique au repli |
| page PDF, 2 tons directs | 1 058 octets, 2 `/Separation`, relue par pdf-lib |
| page PDF avec image 1004 × 1418 | 23 811 octets au lieu de 1 423 672 pixels bruts |
| **document 2 pages** (vectoriel, 2 tons directs, image) | 6 495 octets, relu par pdf-lib : 2 pages, 2 `/Separation`, 196 × 266 mm |
| **page de texte** (police IBM Plex Sans embarquée, 3 lignes) | 95 821 octets ; **pdf.js relit « À l’imprimeur café — déjà vu, çà et là PANTONE 300 C »** |
| titre des métadonnées du PDF produit **par le navigateur** | « SuperPrint — banc d'essai — café » — accents, tiret cadratin et apostrophe courbe conservés |
| repli forcé (module absent) | couleurs identiques, PDF refusé avec un message clair |
