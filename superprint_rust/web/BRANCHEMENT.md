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
| `dist/superprint_core.wasm` | le module compilé (≈ 110 Ko, **aucun import**) |
| `web/superprint-core.js` | la colle : chargement, fonctions amicales, repli |
| `web/demo.html` + `web/demo.js` | le banc d'essai : 17 mesures affichées dans le navigateur |

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
`writeSpotPageGray` · **`createDocument`**

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

// Page 2 : un autre format, une autre quadri.
doc.addPage({ trimWidthMm: 100, trimHeightMm: 100, bleedMm: 0, markMm: 0, quadri: 'rgb' });
doc.fillRect({ x: 10, y: 10, width: 80, height: 80, paint: { rgb: { r: 230, g: 60, b: 40 } } });

// Destination de sortie : facultatif, mais les octets ICC sont exigés.
// doc.outputIntent({ components: 4, identifier: 'FOGRA39', info: 'Coated FOGRA39', icc: octetsIcc });

doc.marks(false);   // pour couper les traits de coupe (tracés par défaut)
const pdf = doc.write();   // Uint8Array prêt à télécharger
```

### Ce que l'exporteur sait faire, et ce qu'il ne sait pas

| Sait faire | Ne sait pas (encore) |
|---|---|
| Plusieurs pages, formats différents | **Texte et polices** — le manque principal |
| `MediaBox` / `TrimBox` / `BleedBox` | `/FlateDecode`, `/DCTDecode` (RunLength seul) |
| Traits de coupe | Chaînes UTF-16BE (CJK) |
| Tons directs `/Separation` **avec teintes** | Écriture XMP, donc pas de PDF/X revendiqué |
| Quadri CMJN ou RVB, page par page | Décodage JPEG/PNG à l'entrée |
| Rectangles, cercles, polygones, segments | |
| Images grises ou RVB placées et mises à l'échelle | |
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
en JavaScript par-dessus le marché. `writeSpotPage` et `writeSpotPageGray`
**lèvent une erreur explicite** (`CoreError`, code `UNAVAILABLE`) au lieu de
rendre un résultat approximatif. Dans ce cas, c'est l'exporteur JavaScript
existant de SuperPrint qui prend le relais — c'est exactement ce que la règle
« aucune bascule à l'aveugle » demande.

```js
if (noyau.backend === 'js') {
  // on garde l'exporteur JS pour le PDF, on profite du reste
}
```

## Ce qui reste à faire pour l'activer dans `superprint/`

Rien de technique n'est en attente : c'est une décision, pas un chantier. Il faut

1. copier `superprint_core.wasm` et `superprint-core.js` dans l'arborescence du
   site (par exemple sous `JS/`),
2. ajouter deux lignes à `superprint/index.html` :

   ```html
   <script src="JS/superprint-core.js"></script>
   ```

3. au démarrage, charger le noyau et **brancher un seul module à la fois**,
   derrière un drapeau, en gardant le repli JS actif.

Aucune de ces trois étapes n'a été faite : `superprint/` n'a **pas** été modifié.
C'est un choix explicite — le dossier est en production.

## Vérifier

```powershell
# module + colle + repli + PDF relus par pdf-lib
pwsh -File scripts/check.ps1

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
| moteur | WebAssembly, 163,7 Ko |
| essais | 19 / 19 |
| RVB → CMJN, 65 536 pixels | identique au repli, octet pour octet |
| luminance, 65 536 pixels | identique au repli, octet pour octet |
| aplat 65 536 octets (RunLength) | 1 024 octets, ×64 |
| 1 200 × 1 200 → 300 × 300 | identique au repli |
| page PDF, 2 tons directs | 1 058 octets, 2 `/Separation`, relue par pdf-lib |
| page PDF avec image 1004 × 1418 | 23 811 octets au lieu de 1 423 672 pixels bruts |
| **document 2 pages** (vectoriel, 2 tons directs, image) | 6 495 octets, relu par pdf-lib : 2 pages, 2 `/Separation`, 196 × 266 mm |
| titre des métadonnées du PDF produit **par le navigateur** | « SuperPrint — banc d'essai — café » — accents, tiret cadratin et apostrophe courbe conservés |
| repli forcé (module absent) | couleurs identiques, PDF refusé avec un message clair |
