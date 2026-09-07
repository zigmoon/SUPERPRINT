# SuperTyPo — Décomposeur & éditeur de typographie

> Brique applicative de **SuperPrint** — inspirée de FontGrapher / FontLab.
> Déposez une police, chaque caractère est **décomposé en contours vectoriels**
> (nœuds + poignées de Bézier), vous le retravaillez à la plume, puis vous
> **réexportez la typo** modifiée. Format natif : `.sf` (SuperFont).

## Démarrage

Servez le dossier `superprint/` (racine) en HTTP, puis ouvrez `supertypo/index.html`.

```powershell
cd superprint
python -m http.server 8890
# → http://localhost:8890/supertypo/index.html
```

Zéro dépendance externe : `opentype.min.js` (parser/générateur de polices) et
`wawoff2.js` (décompresseur WOFF2) sont copiés depuis `app/JS/`.

## Workflow

1. **Charger une police** — `.ttf`, `.otf`, `.woff`, `.woff2` (glisser-déposer ou bouton).
2. **Grille des caractères** — chaque glyphe est affiché (rendu plein ou contours),
   avec son nom. Recherche par caractère ou nom de glyphe, zoom, « tous les glyphes ».
3. **Clic sur un caractère** → **éditeur plein écran** :
   - Outils : Sélection (V), Plume (P), Nœud (N), Formes, Suppression.
   - **Plume** : clic pour poser des points, *glisser* pour créer une courbe/tangente,
     clic sur le premier point pour **refermer** le contour.
   - Panneau droit : transformations (position X/Y, advance width), liste des
     contours, type de nœud (angle / lisse / symétrique), repères (grille, baseline,
     x-height, cap-height, ascender/descender), magnétisme.
   - Zoom : `Ctrl+molette`, boutons −/+, `Ctrl+0` = 100%, `⤢` ajuste à l'écran.
   - Raccourcis : `Échap` ferme, `Suppr` supprime, `Ctrl+Z`/`Ctrl+Y` annule/rétablit.
4. **Refermer** (Échap) → retour à la grille. Les glyphes modifiés portent un ●.
5. **Enregistrer .sf** — projet SuperFont (JSON versionné : glyphes, contours,
   métriques, historique dirty). **Autosave** automatique dans IndexedDB : au
   rechargement, une bannière propose de **Reprendre** le travail.
6. **Exporter la typo** — régénère un `.ttf` avec toutes vos modifications vectorielles.

## Raccourcis

| Touche | Action |
|---|---|
| `V` / `P` / `N` | Sélection / Plume / Nœud |
| `Suppr` | Supprimer la sélection |
| `Échap` | Fermer l'éditeur |
| `Ctrl+Z` / `Ctrl+Y` | Annuler / Rétablir |
| `Ctrl+0` | Zoom 100 % éditeur |
| `Ctrl+molette` | Zoom éditeur |
| `Ctrl+F` | Recherche glyphe |
| `Ctrl+E` | Exporter la typo (TTF) |
| `Ctrl+S` | Enregistrer `.sf` |

## Structure

```
supertypo/
├─ index.html          UI (topbar + grille + éditeur + aide)
├─ CSS/supertypo.css   Design (DA SuperPrint : clair/sombre)
└─ JS/
   ├─ supertypo.js     Tout le moteur (état, import contours, grille, éditeur, export)
   ├─ opentype.min.js  Parser / générateur TTF (copié depuis app/JS)
   └─ wawoff2.js       Décompresseur WOFF2 (chargé à la demande)
```

## Convention de coordonnées (important)

Le moteur stocke les contours en **Y↑** (convention native des fontes, unités em).
`opentype.js` renvoie les paths en Y↓ via `getPath()` et écrit le `glyf` en Y↑.
→ L'import inverse le Y ; l'export redonne le Y↑ ; l'affichage canvas fait la
transformation `scale(z, -z)`.

## Format `.sf` (SuperFont)

```json
{
  "sf": "superfont",
  "version": "1.0",
  "savedAt": "…",
  "meta": { "name": "…", "file": "…", "tool": "SuperTyPo" },
  "font": { "unitsPerEm": 1000, "ascender": …, "descender": …,
            "capHeight": …, "xHeight": … },
  "glyphs": [
    { "name": "A", "unicode": 65, "char": "A", "advanceWidth": 600,
      "contours": [ { "closed": true, "nodes": [
          { "x":…, "y":…, "type":"corner|smooth|symmetric",
            "in":{"x":…,"y":…}|null, "out":{…}|null }
      ] } ], "dirty": true }
  ]
}
```
