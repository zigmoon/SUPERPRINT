# AUDIT — HABILLAGE DE TEXTE (text wrap)

**Date** : 13 septembre 2026
**Version testée** : 1.7.370 (locale **et** en ligne — vérifié identiques)
**Méthode** : lecture du module complet + **tests d'exécution réels dans le navigateur** avec instrument de mesure
**Aucun code modifié.**

---

## 1. Réponse directe à votre question

> « en local ça marche mais en ligne les utilisateurs disent que ça ne marche pas — pourquoi ? »

### ✅ Le déploiement est innocenté — la version en ligne est à jour

| Contrôle | Résultat |
|---|---|
| `superprint.cc/version.txt` | **1.7.370** — identique au local |
| Tag servi | `JS/main.js?v=20260912-v370-release` — identique |
| `CACHE_NAME` | `superprint-shell-v1.7.370-no-whatsapp` — identique |
| **Contenu de `main.js`** | **HASH SHA256 IDENTIQUES** après normalisation des fins de ligne |

> ⚠️ **Piège que j'ai dû écarter** : le fichier en ligne fait 3 928 504 octets contre 3 998 980 en local — un écart de **70 476 octets**. J'ai d'abord cru à un déploiement obsolète. C'est en réalité **exactement le nombre de lignes** : le local est en CRLF, le déployé en LF. **Après normalisation, les hash sont identiques** (`339c51b1a645032e…`).

**Les 14 marqueurs des correctifs d'habillage sont tous présents en ligne** (`_spWrapLineWidthFor`, `getPointByOrigin`, `MIN_KEEP`, `__spParaLineCounts`, `spWrapSyncSize`, `spWrapIsTrulyChained`, `_spWrapOrigH`, `_spWrapReflowAll`, `_spOpenWrapPopin`…).

**Donc ce n'est ni un problème de déploiement, ni de cache.** Le bug est **réel dans le code**.

### ✅ Le moteur fonctionne — je l'ai mesuré

Test en conditions réelles (bloc 480 px + obstacle 140×120 au milieu) :

| | Avant | Après habillage |
|---|---|---|
| Lignes | 4 | **9** |
| Hauteur | 83 px | **198 px** |
| Lignes contraintes | — | **7** (largeur 154 px) |
| Lignes coupées | — | **0** |
| Texte | 212 car. | **212 car. (intégral)** |

**L'habillage fonctionne** : à l'application immédiate, le texte contourne l'obstacle et le bloc s'agrandit correctement.

---

## 2. 🚨 LE VRAI BUG — trouvé et reproduit

### BUG-1 — Après rechargement d'un document, la hauteur figée coupe les lignes ajoutées

**Reproduction exacte** (sauvegarde `.sp` → `loadProjectSP()` → mesure) :

```
AVANT rechargement :  fixedHeight = 183 px
APRÈS rechargement :  lignes         = 12
                      hauteurNaturelle = 282 px
                      fixedHeight    = 183 px   ← INCHANGÉ
                      lignesVisibles = 7
                      lignesMASQUÉES = 5        ← 5 lignes invisibles
```

### La chaîne du bug

1. `spWrapSyncSize()` **agrandit** le bloc pendant le reflow et fixe `_fixedHeight` à l'instant T.
2. Mais le texte **continue d'être redistribué** en plus de lignes (les coupes se recalculent à chaque passe).
3. Le masque (`applyTextboxClipPath`) reste figé à la hauteur de l'étape 1 → **282 px de contenu dans un masque de 183 px**.
4. **Le texte est correctement habillé, mais 5 lignes sur 12 sont invisibles.**

### Pourquoi « ça marche en local » et pas « en ligne »

| | Local (vos tests) | En ligne (utilisateurs) |
|---|---|---|
| Ordre des opérations | applique l'habillage **après** le chargement | ouvre un document **déjà sauvegardé** avec habillage |
| Résultat | l'ordre est favorable → **correct** | la hauteur figée est rejouée telle quelle → **coupé** |

**Votre test local passe parce que vous appliquez l'habillage sur un document fraîchement ouvert.**
Vos utilisateurs, eux, rouvrent des documents où la hauteur a été figée dans un état incohérent.

### Pourquoi c'est cohérent avec les retours que vous recevez

Le retour « ça ne marche pas » est **exact du point de vue de l'utilisateur** : il ouvre son document, voit du texte qui **chevauche l'image** ou des lignes **manquantes**, et conclut que l'habillage est inopérant. Techniquement le calcul est bon, mais **le rendu ne suit pas**.

---

## 3. Ce qui est CORRECT (vérifié — ne pas « réparer »)

Ne perdez pas de temps à chercher de ce côté, j'ai vérifié :

| Point | Verdict |
|---|---|
| **Persistance de l'habillage** | ✅ Fonctionne — le `.sp` contient `_spWrapMode`, `_spWrapTop/Left/Bottom/Right` |
| **`SP_CUSTOM_PROPS`** | ✅ 78 entrées, les 7 clés d'habillage **sont** déclarées |
| **Sérialisation** | ✅ `saveAllPages()` appelle bien `obj.toObject(SP_CUSTOM_PROPS)` |
| **`getPointByOrigin('left','top')`** | ✅ Utilisé (pas le centre du bbox) — le fix tient |
| **Garde-fou `MIN_KEEP = 28`** | ✅ Correct — voir la note ci-dessous |
| **Bloc à hauteur AUTO** | ✅ Fonctionne (8 lignes, 6 contraintes) |
| **Texte intégral** | ✅ Aucun caractère perdu (208/208, 212/212) |
| **Service Worker** | ✅ HTML en network-first ; le tag change à chaque release |

> ⚠️ **Note importante sur `MIN_KEEP = 28`** : si l'obstacle est à **moins de 28 px** du bord gauche du bloc, le moteur **renonce volontairement** à contraindre la ligne (il renvoie la largeur pleine). C'est un choix **délibéré et documenté** : en dessous, le moteur de wrap de Fabric coupe les mots **caractère par caractère** (mesuré à l'époque : 119 lignes au lieu de 4, 21 caractères perdus).
> **Conséquence visible pour l'utilisateur** : un obstacle collé au bord gauche ne provoque **aucun** habillage. Ce n'est pas un bug, mais c'est **contre-intuitif** et mérite peut-être un garde-fou visuel (avertissement dans la pop-in).

---

## 4. Deux causes secondaires plausibles (à vérifier)

### Piste A — Service Worker : 2ᵉ chargement nécessaire

`staleWhileRevalidate` rend **le cache en premier** et met à jour **en arrière-plan**. Un utilisateur qui garde son onglet ouvert ou recharge une seule fois peut donc **rester sur l'ancienne version**.
→ **Le correctif arrive au 2ᵉ chargement, pas au 1er.** Cela peut expliquer une partie des retours « ça ne marche toujours pas » juste après une mise à jour.

### Piste B — La pop-in ne déclenche pas toujours le reflow

La pop-in appelle `reflowAll()` → `window._spWrapReflowAll()`. Or cette fonction **sort immédiatement** si aucun objet du canvas ne porte `_spWrapMode`. Sur un document rechargé, si `reflowAllTexts` est appelé avant que les objets soient tous chargés, le reflow peut être **sauté**.
→ À vérifier : le reflow est-il appelé **après** la fin du chargement des pages ?

---

## 5. Recommandations

| Priorité | Action | Nature |
|---|---|---|
| **1** | **Recalculer la hauteur au chargement d'un document** : après `loadProjectSP`, appeler `_spWrapReflowAll()` sur chaque canvas **une fois les objets en place**. C'est le correctif du BUG-1. | ~5 lignes |
| **2** | **Filet de sécurité dans `spWrapSyncSize`** : ne jamais laisser `_fixedHeight` **inférieur** à la hauteur naturelle du contenu. Un test `if (natural > fixed) → agrandir` rend le bug impossible, quel que soit l'ordre des appels. | ~3 lignes |
| **3** | Vérifier que `applyTextboxClipPath` ne peut pas **rogner** un bloc dont `_fixedHeight < natural` (même filet au niveau du masque). | ~2 lignes |
| **4** | Avertir dans la pop-in quand l'obstacle est à moins de 28 px du bord (l'habillage est alors volontairement inactif). | UI |
| **5** | Forcer la mise à jour du SW au 1er chargement (`skipWaiting` sur action utilisateur) pour que les correctifs arrivent immédiatement. | ~5 lignes |

**Le point 1 est le correctif du bug. Le point 2 le rend impossible à reproduire**, même si un autre chemin d'appel apparaît plus tard. Je recommande **les deux** : le premier corrige le cas connu, le second ferme la classe entière de bugs.

---

## 6. Méthode et instruments (réutilisables)

**Instrument de mesure principal** : `window._spWrap._debug.lineWidthFor(bloc, indexLigne, {free, paraOff})`
→ renvoie la largeur calculée pour une ligne. **500 = non contrainte, < 500 = contrainte**. C'est ce qui permet de distinguer « le calcul ne marche pas » de « le calcul marche mais le rendu ne suit pas ».

**Accès au canvas** : `window.getActiveCanvas()` est exposé — pas besoin de percer l'IIFE.

**Séquence de test** :
```js
const txt  = new fabric.Textbox(texte, {left, top, width, fontSize});
const rect = new fabric.Rect({left, top, width, height});
txt._fixedHeight = txt.height;   // simule l'outil Texte (zone dessinée)
window._spWrap.setMode(rect, 'box');
window._spWrap.reflow(txt);
window._spWrapReflowAll(canvas);
```

**Pièges rencontrés pendant l'audit** :
1. **`rect.toObject()` sans argument ne renvoie AUCUNE propriété custom** en Fabric 5 → j'ai cru à tort que la sérialisation était cassée. Toujours passer les props : `rect.toObject(SP_CUSTOM_PROPS)`.
2. **Un obstacle à moins de 28 px d'offset** ne contraint rien (garde-fou `MIN_KEEP`) → un test à 20 px conclut faussement « ça ne marche pas ».
3. **Extraction de `SP_CUSTOM_PROPS`** : mon premier script s'arrêtait au premier `]` dans un commentaire et renvoyait 35 entrées au lieu de 78 → 5 « propriétés manquantes » fantômes.
4. **L'écart CRLF/LF** : ne jamais conclure à une divergence de déploiement sur la taille brute d'un fichier.
5. La page peut rester sur l'écran d'accueil (`initReady: false`) → cliquer `#sp-startup-new`.

---

## 7. Bilan

| Question | Réponse |
|---|---|
| Le déploiement est-il en retard ? | **Non** — contenu identique au local (hash égal après normalisation) |
| L'habillage fonctionne-t-il en local ? | **Oui** — 4 → 9 lignes, 0 ligne coupée |
| Pourquoi les utilisateurs disent que non ? | **Parce que c'est vrai chez eux** : au rechargement d'un document, `_fixedHeight` reste figé et **5 lignes sur 12 deviennent invisibles** |
| Le bug est-il reproduit ? | **Oui**, mesuré : `hauteurNaturelle 282` vs `fixedHeight 183` |

**En résumé** : le moteur d'habillage est bien écrit et fonctionne. Le défaut est dans le **cycle de vie de la hauteur** — elle est figée dans un état transitoire et jamais revalidée au chargement. C'est un bug discret qui touche **tous les documents sauvegardés avec habillage**, donc tous vos utilisateurs en production — ce qui explique le volume de retours, alors que vos tests locaux (sur document frais) passent.
