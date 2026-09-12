# AUDIT — RÉGLAGE TAILLE / INTERLIGNAGE PERDU DANS UN BLOC TEXTE

**Date** : 13 septembre 2026
**Version** : 1.7.370 (locale = en ligne, contenu vérifié identique)
**Méthode** : lecture du code + **reproduction mesurée dans le navigateur**
**Aucun code modifié.**

---

## 1. Le bug signalé est confirmé — et il est plus grave que décrit

Retour utilisateur :
> « lorsque je modifie la taille et l'interlignage d'une typographie sélectionnée et placée dans un bloc texte, ce changement s'effectue pendant que l'on écrit nos choix dans la sidebar de droite. Cependant, le réglage n'est pas conservé au relâchement de la souris, à la désélection du texte. »

**Le rapport est exact.** J'ai reproduit le bug en mesurant trois tailles successives sur un bloc texte :

| Taille appliquée | `_fixedHeight` | Hauteur réelle du contenu | Lignes | **Lignes visibles** |
|---|---|---|---|---|
| 16 pt (départ) | 42 | 42 | 2 | 2 |
| **20 pt** | **18** | 59 | 2 | **0** |
| **30 pt** | **18** | 88 | 2 | **0** |
| **42 pt** | **18** | 185 | 3 | **0** |

**Le cadre ne grandit jamais — et dans certains cas il se réduit même (42 → 18 px).** Résultat : le texte agrandi est **entièrement rogné par le masque**, il devient **invisible**. L'utilisateur voit le texte changer pendant la saisie, puis **disparaître** dès qu'il relâche.

---

## 2. Cause racine — identifiée et tracée

### Le mécanisme fautif

Dans **les deux** gestionnaires (`#fontSize` ~ligne 26395, `#lineHeight` ~ligne 26785), on trouve le même enchaînement :

```js
// 1. On lit la hauteur AVANT modification
const fixedH = (typeof window.spFixedHeight === 'function')
             ? window.spFixedHeight(obj)          // ← 41,58 px (ancienne hauteur)
             : (obj._fixedHeight || obj.height);

// 2. On change la typographie (le texte a besoin de PLUS de hauteur)
obj.set({ fontSize: newSize, dirty: true });      // ou lineHeight

// 3. On RESTAURE la hauteur d'AVANT  ← LE BUG
obj._fixedWidth  = fixedW;
obj._fixedHeight = fixedH;                        // ← 41,58 px réinjecté
obj.width  = fixedW;
obj.height = fixedH;
applyTextboxClipPath(obj);                        // ← le masque se cale sur 41,58 px
```

**Preuve par instrumentation** (j'ai enveloppé `spFixedHeight` pour capturer les valeurs réelles au moment de l'exécution) :
```
captureAuMomentDuHandler : { fixedHeight: 41.583999999999996, height: 41.583999999999996, retour: 41.583999999999996 }
après changement         : { _fixedHeight: 42, height: 42, fontSize: 32 }
```
→ `fontSize` passe bien à 32, mais **`_fixedHeight` reste figé à 42**. La hauteur est **périmée dès la ligne suivante**.

### La logique était bonne à l'origine

Restaurer `_fixedWidth` / `_fixedHeight` est **volontaire et documenté** : c'est pour **empêcher le bloc de rétrécir ou de changer de largeur** quand on modifie la typographie (comportement PAO attendu — agrandir le texte ne doit pas déplacer le bloc).

**Le défaut** : la restauration rétablit une hauteur **figée** au lieu d'une hauteur **revalidée**. Il faudrait restaurer `max(hauteur_avant, hauteur_naturelle_nouvelle)`.

---

## 3. Deuxième bug trouvé (interlignage) — distinct et plus grave

Le champ `#lineHeight` **n'est pas un multiplicateur, c'est un nombre de points.** Le code fait :

```js
const lineHeightPt  = Math.max(1, parseFloat(this.value) || 16);
const lineHeightRatio = lineHeightPt / fontSizeForLH;    // ← division
obj.set({ lineHeight: lineHeightRatio });
```

Dans la sidebar, le champ affiche `1.3` — **la valeur du multiplicateur**. L'utilisateur croit donc saisir un multiplicateur, alors que le champ attend des **points**.

**Mesuré** : saisir `2.2` → `lineHeight` calculé = **0,0846** (2,2 ÷ 26), hauteur naturelle **7 px** au lieu de 140 px. **Le texte s'écrase littéralement** (interlignage négatif visuel).

| Ce que l'utilisateur tape | Ce que le code comprend | Résultat |
|---|---|---|
| `2.2` (croit : ×2,2) | 2,2 pt ÷ 26 pt = **0,085** | texte **écrasé** |
| `1.3` (croit : ×1,3) | 1,3 pt ÷ 26 pt = 0,05 | texte écrasé |
| `34` (18 pt × 1,9) | 34 ÷ 18 = 1,89 | **correct** |

C'est cohérent avec le retour : l'utilisateur **voit** son réglage s'appliquer pendant la frappe (le multiplicateur brut est interprété), puis le résultat est incohérent au relâchement.

> ⚠️ Ce point mérite votre arbitrage : soit le champ doit être **étiqueté en points**, soit le handler doit **détecter** une saisie de type multiplicateur (valeur < 5 = multiplicateur). Je ne tranche pas — c'est un choix d'ergonomie.

---

## 4. Le troisième symptôme — « pas conservé à la désélection »

J'ai vérifié la désélection : **les valeurs `fontSize` et `lineHeight` SONT conservées** dans l'objet, et la sauvegarde `.sp` les contient bien.

**Ce qui est « perdu », c'est la VISIBILITÉ** : masqué pendant l'édition (hauteur figée), le texte **reste masqué** après désélection. L'utilisateur interprète légitimement cela comme « mon réglage n'a pas été conservé ».

**Il n'y a donc pas de bug de persistance** — c'est un bug d'**affichage**. C'est une distinction importante : elle évite de chercher au mauvais endroit (sérialisation, `saveAllPages`, `selection:cleared` — tous sains).

---

## 5. Ce qui est CORRECT (vérifié, ne pas chercher là)

| Point | Verdict |
|---|---|
| Persistance `fontSize` dans `.sp` | ✅ correct |
| Persistance `lineHeight` dans `.sp` | ✅ correct |
| `selection:cleared` (3 gestionnaires) | ✅ inoffensifs |
| `saveAllPages()` | ✅ correct |
| `spFixedHeight()` / `spIsFixedSize()` | ✅ fonctionnent (renvoient bien 42) |
| Le texte est intégral | ✅ aucun caractère perdu |

**Le bug est purement dans la remise à la hauteur figée, à 2 endroits.**

---

## 6. Correctif recommandé

### Volet 1 — Ne jamais restaurer une hauteur inférieure au contenu (les 2 handlers)

```js
// APRÈS avoir appliqué fontSize / lineHeight :
// revalider la hauteur au lieu de restaurer l'ancienne
const naturalH = (typeof spWrapNaturalHeight === 'function') ? spWrapNaturalHeight(obj) : null;
const safeH = (obj._spWrapOrigH > 0)                       // bloc déjà ajusté par l'habillage
  ? Math.max(obj._spWrapOrigH, naturalH || 0)
  : Math.max(fixedH, naturalH || 0);                       // sinon : jamais moins que le contenu
obj._fixedHeight = safeH;
obj.height = safeH;
obj._fixedWidth = fixedW;                                  // la LARGEUR reste figée (correct)
obj.width = fixedW;
```

⚠️ **Important** : garder la **largeur** figée (c'est voulu, ça évite que le bloc se rétrécisse à chaque changement de taille). **Seule la hauteur** doit être revalidée vers le haut.

### Volet 2 — Filet de sécurité dans `applyTextboxClipPath`

**Localisation précise** : `applyTextboxClipPath` ligne **5785**, et à la ligne **5844** :
```js
let clipHeight = Math.max(1, frameHeight);   // ← le masque n'est JAMAIS comparé au contenu
```
Le masque est calculé **uniquement** à partir de `frameHeight` (= `_fixedHeight`). Il n'existe **aucune** comparaison avec la somme des `getHeightOfLine()`. C'est ce qui permet au masque de rogner.

```js
// APRÈS le calcul de clipHeight :
const naturalH = /* somme des getHeightOfLine(i) pour les lignes incluses */;
if (clipHeight < naturalH - 0.5) clipHeight = naturalH;   // ne jamais rogner le contenu
```

Ce filet rend la classe entière de bugs impossible, même si un autre chemin d'appel apparaît — et il y en a d'autres (voir ci-dessous).

### ⚠️ Portée réelle : **9 sites**, pas 2

`grep 'obj._fixedHeight = fixedH'` remonte **35 occurrences**. J'ai vérifié chacune : **9 seulement** sont précédées d'une modification de typographie — ce sont les candidats au bug.

| Site | Contexte | Modification typo |
|---|---|---|
| **26415, 26423, 26449, 26463** | handler `#fontSize` | ligne 26403 |
| **26840, 26853** | handler `#lineHeight` | ligne 26816 |
| **27573** | panneau typographie | ligne 27494 |
| **44161, 44181** | (autre handler typo) | ligne 44069 |

**Les 26 autres occurrences sont saines** — ce sont des normalisations d'échelle légitimes (redimensionnement, import, duplication). **Ne pas les patcher en masse** : ce serait une régression.

> L'outil d'inventaire est `_audit_fixedh.cjs` : il détecte pour chaque site la fonction englobante **et** si un `obj.set({fontSize|lineHeight})` ou `setSelectionStyles` le précède. C'est ce qui permet de distinguer les 9 vrais des 26 faux.

**Recommandation** : corriger les **2 handlers** (volet 1) **et** poser le **filet** (volet 2). Le filet couvre les 7 sites restants sans avoir à les toucher un par un — c'est la correction la plus sûre et la plus durable.

### Volet 3 — Champ interlignage

Décider : **points** (étiqueter clairement) ou **multiplicateur** (détecter `value < 5`). Aujourd'hui le champ affiche un multiplicateur mais attend des points — c'est la source de confusion.

---

## 7. Recommandation de priorité

| Priorité | Action | Effort |
|---|---|---|
| **1** | Voler 1 : revalider la hauteur (2 handlers) → **le texte reste visible** | ~10 lignes |
| **2** | Volet 2 : filet dans `applyTextboxClipPath` (ferme la classe de bugs) | ~3 lignes |
| **3** | Volet 3 : clarifier le champ interlignage | UI + arbitrage |

**Les volets 1 et 2 corrigent le bug signalé.** Le volet 3 corrige un bug distinct que j'ai trouvé en chemin et qui touche le même champ.

---

## 8. Méthode de test (réutilisable)

```js
const fc = window.getActiveCanvas();            // exposé, pas besoin de percer l'IIFE
const txt = new fabric.Textbox(texte, {width: 400, fontSize: 16, lineHeight: 1.3});
fc.add(txt); txt.initDimensions();
txt._fixedWidth = txt.width; txt._fixedHeight = txt.height;   // simule l'outil Texte
fc.setActiveObject(txt);

document.getElementById('fontSize').value = '32';
document.getElementById('fontSize').dispatchEvent(new Event('change', {bubbles:true}));
// puis mesurer : _fixedHeight vs somme des getHeightOfLine(i)
```

**Indicateur décisif** : comparer `_fixedHeight` (le masque) à la **somme des `getHeightOfLine(i)`** (le contenu réel). Si `maque < contenu` → des lignes sont coupées.

**Instrument utile** : envelopper `window.spFixedHeight` pour capturer la valeur au moment exact où le handler la lit — c'est ce qui a prouvé que la hauteur capturée est celle d'**avant** la modification.

**Piège de test** : un `fabric.Textbox` créé à la main a `_fixedHeight = 1` par défaut (Fabric le pose à 0 pendant `initialize`). Il faut **explicitement** poser `_fixedHeight = height` pour simuler l'outil Texte, sinon le bug ne se reproduit pas.

---

## 9. Bilan

| Question | Réponse |
|---|---|
| Le bug est-il reproductible ? | **Oui**, mesuré : `_fixedHeight` 18 px pour 185 px de contenu |
| Pourquoi pendant la frappe ça marche ? | Le texte se redessine, mais le **masque** reste figé — on voit la partie non rognée |
| Pourquoi après désélection c'est perdu ? | Ce n'est **pas** perdu : c'est **masqué**. Valeurs et `.sp` sont corrects |
| Cause | La hauteur d'**avant** modification est réappliquée après le changement de typographie |
| Combien d'endroits à corriger ? | **2** (`#fontSize`, `#lineHeight`) + 1 filet dans `applyTextboxClipPath` |
| Bug supplémentaire trouvé | Champ interlignage : attend des **points**, affiche un **multiplicateur** |
