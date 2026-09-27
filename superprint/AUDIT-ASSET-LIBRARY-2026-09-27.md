# AUDIT — Bibliothèque d'assets : images qui disparaissent

**Date** : 2026-09-27
**Périmètre** : `app/JS/main.js`, `app/CSS/main.css` (SuperPrint app)
**Symptôme signalé** : « dans Asset Library, lorsque je change une image, le fond de la page
disparaît. Je vais en page 2 pour changer une autre image, le fond de la page disparaît et
l'image en dessous disparaît aussi ; après plusieurs clics, les pages bug avec des blocs qui
disparaissent ou se déplacent. »

---

## 1. Cause racine — MESURÉE ET REPRODUITE

**Une modification faite pendant qu'une planche charge n'est jamais enregistrée.**

### La séquence

1. Un rendu complet (`renderAllPages()`) recrée les planches et les remplit en JSON de façon
   **asynchrone** : chaque planche porte `_isLoading = true` le temps de son `loadFromJSON`.
   C'est le cas **à chaque changement de page** — donc exactement dans le scénario décrit.
2. On ajoute une image depuis la bibliothèque d'assets : elle est bien posée sur la planche.
3. `saveState('Image ajoutée')` rencontre le garde-fou :

   ```js
   // AVANT (1.7.573)
   if (canvases && canvases.some(c => c && c._isLoading)) return;   // ⛔ sortie SILENCIEUSE
   ```

   → `saveAllPages()` n'est **jamais** appelé → `pages[i].objects` reste inchangé.
4. Au rendu suivant (changement de page, fermeture du panneau, annuler…), les planches sont
   reconstruites **depuis `pages[]`** : l'image ajoutée **a disparu**.

### Les mesures

| Étape | Avant correctif | Après correctif |
|---|---|---|
| Objets dans `pages[0]` juste après le clic | `0` (différé — normal) | `0` (différé — normal) |
| Objets dans `pages[0]` une fois le chargement fini | **`0` — PERDU** | **`1` — enregistré** |
| Objets dans `pages[0]` après un rendu complet | **`0` — l'image a disparu** | **`1` — l'image survit** |
| Objets sur le canvas juste après le clic | `4` (l'image EST là) | `4` |

Le décalage entre « le canvas montre 4 objets » et « `pages[0]` en contient 0 » est le défaut
lui-même : **l'écran et le document avaient divergé**.

### Pourquoi « parfois » et « après plusieurs clics »

Le défaut ne se produit que si l'on agit **pendant la fenêtre de chargement**. Elle est courte
(quelques centaines de ms après chaque rendu), d'où le caractère intermittent — et d'autant
plus fréquent qu'on enchaîne les allers-retours entre les pages.

### Pourquoi le fond de page et les images du dessous disparaissent aussi

`saveState()` sortait **pour tout le document** : les modifications en attente sur *les autres*
planches (fond de page, objet posé, image ajoutée) étaient perdues dans le même mouvement.
Le rendu suivant restaurait un état antérieur — d'où l'impression que des blocs « disparaissent
ou se déplacent ».

### Le correctif — `_SP_SAVE_DIFFERE_574`

Le garde-fou est **justifié** (on ne doit pas sérialiser une planche à moitié chargée : elle
produirait un `pages[]` corrompu). Il ne doit pas pour autant faire *perdre* la modification :
on la **met en attente** et on la rejoue dès que les planches ont fini.

```js
if (canvases && canvases.some(c => c && c._isLoading)) { _spSaveDiffere(action); return; }
```

`_spSaveDiffere()` réessaie toutes les 100 ms (≈20 s de patience), puis renonce en le
signalant dans la console. La relecture de l'état se fait **au moment de l'exécution** : c'est
donc toujours l'état courant qui est enregistré, jamais un instantané périmé.

---

## 2. Défauts secondaires trouvés pendant l'audit

### 2.1 Le champ « fond » restait désynchronisé (MESURÉ)

À chaque ajout d'image, la console émettait **deux avertissements** :

```
The specified value "rgb(0,0,0)" does not conform to the required format.
The format is "#rrggbb" …
```

**Cause** : un `<input type="color">` n'accepte que `#rrggbb`. Fabric pose `rgb(0,0,0)` par
défaut sur tout objet sans fond explicite — une **image**, justement. L'assignation était
refusée par le navigateur : le champ gardait l'**ancienne** couleur.

**Conséquence réelle** : le réglage suivant appliquait une couleur que l'utilisateur n'avait
pas choisie (le code lit `document.getElementById('blockFill').value` pour peindre l'objet).

**Correctif** `_SP_RGB_HEX_574` : normalisation systématique avant écriture
(`rgb()`/`rgba()` → `#rrggbb`, `#abc` → `#aabbcc`). Une couleur non représentable dans un
sélecteur natif (nom CSS, dégradé, motif) est traitée comme « sans fond ». Vérifié :
`rgb(0,0,0)` → `#000000`, `#abc` → `#aabbcc`, `red` → *non représentable*.

### 2.2 Correspondance page ↔ canvas fausse dans les dépôts par glisser-déposer

Trois gestionnaires de `drop` font :

```js
const idMatch = canvasEl.id && canvasEl.id.match(/^canvas-(\d+)$/);
const pageIndex = idMatch ? parseInt(idMatch[1], 10) : NaN;
if (!isNaN(pageIndex) && canvases[pageIndex]) { /* … */ }
```

**Mesuré sur un document de 4 pages en mode double page** :

```
canvases = 3        pageToCanvasMap = {0:0, 1:1, 2:1, 3:2}
identifiants réels des canvas = ["canvas-0", "spread-canvas-1", "canvas-3"]
```

Deux erreurs :

1. la planche double page s'appelle **`spread-canvas-1`** → la regex ne matche pas
   (`pageIndex = NaN`) → la planche sous le curseur est **ignorée** ;
2. `canvases[pageIndex]` confond *index de page* et *index dans le tableau* : pour la page 4,
   `canvases[3]` **n'existe pas** (3 canvas). Or `pageToCanvasMap` existe précisément pour ça.

**Conséquence** : le fichier est déposé sur la mauvaise page (repli sur le canvas actif), ou
pas du tout — ce qui se lit comme « des blocs qui se déplacent ».

**Statut** : ✅ **CORRIGÉ** (`_SP_CANVAS_574`). Les quatre gestionnaires de dépôt retrouvent
désormais la planche par **son élément DOM** (`spCanvasDepuisElement`), sans passer ni par
l'identifiant ni par un index de tableau. Vérifié : plus aucune occurrence de
`/^canvas-(\d+)$/` dans le code (hors commentaire).

### 2.3 `getActiveCanvas()` — avertissement transitoire

Pendant le rendu, `bleedInfo` n'est pas encore posé et la fonction retombe sur
`canvases[0]` avec un avertissement console. Après rendu complet, la résolution est correcte
sur les 4 pages (vérifié). Pas de défaut fonctionnel, mais l'avertissement pollue les
diagnostics.

---

## 3. Ce qui a été vérifié (non-régression)

### 3.1 Recette sur un magazine COMPLET (pas une image seule)

Composition **« Hair Journal (4p) »** appliquée depuis l'onglet *Layouts*, puis quatre
changements d'images avec navigation entre les pages, suivis d'un rendu complet.
La signature comparée porte sur **toute la géométrie** de chaque objet
(`type|left|top|width|texte`, triée) — un bloc déplacé ne peut donc pas passer inaperçu.

| Étape | Objets par planche (canvas) | Objets dans `pages[]` | Fonds de planche |
|---|---|---|---|
| Référence (magazine appliqué) | `[12, 19, 23, 19]` | `[12, 19, 23, 19]` | 4 × `#ffffff` |
| + image A (page 3) | `[12, 19, 24, 19]` | `[12, 19, 24, 19]` | 4 × `#ffffff` |
| + image B (page 4) | `[12, 19, 24, 20]` | `[12, 19, 24, 20]` | 4 × `#ffffff` |
| + image C (retour page 3) | `[12, 19, 25, 20]` | `[12, 19, 25, 20]` | 4 × `#ffffff` |
| + image D (page 4, 2ᵉ passage) | `[12, 19, 25, 21]` | `[12, 19, 25, 21]` | 4 × `#ffffff` |
| **Après rendu complet** | **`[12, 19, 25, 21]`** | **`[12, 19, 25, 21]`** | **4 × `#ffffff`** |

- **`objetsOriginePerdus: []`** — aucun objet d'origine perdu ni déplacé, alors que 4 images
  ont été ajoutées et que les planches ont été détruites puis reconstruites.
- **`errs: []`** — aucune erreur console, aucun crash (écoute `pageerror` + `console.error`
  active pendant tout le scénario).
- **canvas et `pages[]` concordent à CHAQUE étape** : c'est la preuve directe que le correctif
  `_SP_SAVE_DIFFERE_574` fait son travail (avant, l'écart apparaissait immédiatement).
- Contrôle visuel : la page 1 du magazine (« The Hair Journal », l'image de couverture, le
  titre, l'accroche, le filet et les mentions de pied de page) est intacte après le test.

### 3.2 Autres contrôles

- Ajout de 5 images depuis la bibliothèque sur un document simple : toutes persistées.
- Aucun avertissement `does not conform` après correction (5 ajouts d'affilée).
- Boîtes de dialogue : filet, badge et boutons **noirs** en toute circonstance
  (`rgb(26,26,26)`), y compris pour les erreurs et les confirmations destructrices.
- Hauteur du bandeau de logo : 56 px dans les deux états de la barre latérale.

---

## 4. Méthode de reproduction (pour contrôle)

```js
// 1. Deux pages propres
pages.length = 0;
for (let i = 0; i < 2; i++) pages.push({ objects: JSON.stringify({ objects: [] }), background: '#ffffff' });
renderAllPages();
// attendre la fin du rendu…

// 2. Simuler une AUTRE planche en cours de chargement (ce que fait un changement de page)
canvases[1]._isLoading = true;

// 3. Ajouter une image depuis la bibliothèque (onglet Images → bouton Select)
//    AVANT correctif : pages[0].objects reste à 0 → un rendu complet fait disparaître l'image.
//    APRÈS correctif : le différé se rejoue dès que _isLoading repasse à false.
```

**Piège de test** : après toute modification de `main.js`, purger le Service Worker et les
caches — sinon on teste l'ancien fichier (cf. `superprint-mainjs-pieges`).
