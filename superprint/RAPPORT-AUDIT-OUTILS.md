# RAPPORT D'AUDIT — Qualité des outils de SuperPrint

**Date** : 12 septembre 2026
**Version auditée** : 1.7.370 web + miroir local (identiques, SHA256)
**Périmètre** : tous les outils de l'app `superprint/app/`
**Hors périmètre (à votre demande)** : export PDF · imposition · outil Plume
**Méthode** : analyse statique de `main.js` (70 477 lignes) + **exécution réelle dans le navigateur** pour confirmer chaque défaut. **Aucun fichier n'a été modifié.**

---

## 1. Synthèse

*Rapport établi en deux passes : première analyse ciblée, puis **balayage exhaustif de toutes les classes de bugs** (handlers inline, appels `window.X`, écouteurs, IDs, raccourcis) sur l'app **et** le studio. La seconde passe a ajouté le BUG-3.*

| Sévérité | Nombre | Nature |
|---|---|---|
| 🔴 **Critique** | 2 | `Ctrl+O` inutilisable · FAQ non fermable |
| 🟠 **Majeur** | 2 | `Ctrl+E` cassé · import Excel inutilisable hors-ligne |
| 🟡 **Moyen** | 3 | Code mort Word · 94 clés JA · 16 libellés non traduits |
| 🔵 **Mineur** | 4 | Incohérences, dette technique |

**Verdict général : l'app est de bonne qualité.** Le cœur métier (édition texte, formes, calques, alignement, chaînage, import/export `.sp`/`.json`, IDML) est **fonctionnel et bien implémenté**, avec des garde-fous réfléchis (protection des dimensions, gestion du zéro, messages d'erreur explicites). Les défauts trouvés sont **périphériques** — des raccourcis et des chemins secondaires — pas structurels.

**Indicateur de santé** : sur **95 fonctions appelées depuis les handlers inline** du HTML, **1 seule** est introuvable. Sur **71 appels `window.X()`**, **0 orphelin**. Sur **66 IDs référencés sans élément HTML**, **1 seul** provoque un crash. La discipline est bonne.

---

## 2. 🔴 CRITIQUE

### BUG-1 — `Ctrl+O` plante et ne peut pas ouvrir de fichier

**Preuve d'exécution** (navigateur, page fraîche) :
```
Ctrl+O → Uncaught TypeError: Cannot read properties of null (reading 'click')
```

**Cause** : `main.js` ligne 22863
```js
if (cmdOrCtrl && e.key === 'o') {
    e.preventDefault();
    document.getElementById('fileInput').click();   // ← fileInput N'EXISTE PAS
    return;
}
```

**Vérifié** : aucun élément `id="fileInput"` dans `index.html`. Les 21 vrais inputs de fichier s'appellent `importPdfInput`, `importDocxInput`, `importSPInput`, etc.

**Impact** :
- Le raccourci ne fait rien et lève une erreur à chaque frappe.
- `e.preventDefault()` est appelé **avant** le crash → le comportement natif du navigateur (ouvrir un sélecteur de fichier) est **bloqué**. L'utilisateur ne peut donc pas ouvrir de fichier via `Ctrl+O`, ni même par le sélecteur natif.

**Portée** : toute la base d'utilisateurs qui utilise les raccourcis clavier. C'est le raccourci d'ouverture universel de tous les logiciels PAO.

**Correctif suggéré** (non appliqué) : faire pointer vers le vrai chemin d'import — `openImportModal()` (le bouton visible existe, vérifié dans le navigateur). Une ligne.

### BUG-2 — La fenêtre FAQ ne peut PAS être fermée

**Découvert au balayage exhaustif** des handlers inline (2ᵉ passe).

**Preuve d'exécution** :
```
Clic sur l'overlay FAQ → Uncaught ReferenceError: closeFaqModal is not defined
(l'overlay reste ouvert)
```

**Cause** : `index.html` ligne 3577
```html
<div class="modal-overlay" id="faqModal" onclick="if(event.target === this) closeFaqModal()">
```
La fonction `closeFaqModal` **n'existe nulle part dans tout le projet** (vérifié sur les 48 fichiers JS/HTML).

**Vérifié dans le navigateur** :
- `typeof window.closeFaqModal` → `undefined`
- Le modal ne contient **aucun bouton de fermeture** (ni `×`, ni « Fermer ») — mesuré : `boutonsInternes: []`
- Le clic sur l'overlay lève l'erreur et **ne ferme pas** la fenêtre

**Impact** : la FAQ s'ouvre depuis Préférences → FAQ (`switchSettingsTab('faq')`) et **reste bloquée à l'écran**. L'utilisateur doit recharger la page. C'est un cul-de-sac d'interface.

**Contraste significatif** : le projet définit `closeManualModal`, `closeGlyphsModal`, `closeCropModal`, `closeSettings`… (`close*` existe pour tous les autres modals) — la FAQ est la seule oubliée. **Un `closeFaqModal` a visiblement été supprimé ou jamais créé**, alors que son appel est resté dans le HTML.

**Correctif suggéré** (non appliqué) : la fonction manque ; le plus simple est de la définir à côté des autres `close*` (`document.getElementById('faqModal').style.display = 'none'`), ou de retirer le `onclick` et d'ajouter un vrai bouton de fermeture.

---

## 3. 🟠 MAJEUR

### BUG-3 — `Ctrl+E` (exporter) appelle une fonction inexistante

**Preuve d'exécution** :
```
Ctrl+E → Uncaught ReferenceError: showExportModal is not defined
        (la modale d'export reste fermée)
```

**Cause** : ligne 23835 appelle `showExportModal()`. La fonction réellement définie est `openExportModal()` (confirmé au runtime : `typeof openExportModal === "function"`, `typeof showExportModal === "undefined"`).

**Bonne nouvelle** : `Ctrl+P` fait la même chose **correctement** (il appelle `openExportModal()`). Le bouton `EXPORT` de la barre d'outils fonctionne aussi. Seul le raccourci `Ctrl+E` est cassé.

**Correctif suggéré** (non appliqué) : renommer l'appel en `openExportModal()`. Une ligne.

### BUG-4 — Import Excel (.xlsx) inutilisable hors-ligne

**Cause** : la librairie SheetJS est chargée **uniquement depuis un CDN externe**
```js
s.src = 'https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js';
```

**Vérifié** : **aucun fichier de repli local** n'existe dans l'app. Toutes les autres librairies lourdes (fabric, jspdf, mammoth, pdf-lib, jszip…) sont **auto-hébergées** dans `JS/` — c'est visiblement la règle du projet, et XLSX est la seule exception (le commentaire dit même « Fallback : le fichier local s'il existe », mais ce fichier n'existe pas).

**Impact** : SuperPrint est un logiciel qui se présente comme **100 % local**. L'import Excel échoue silencieusement (le `onerror` du `<script>` ne produit qu'un message) dès qu'il n'y a pas d'accès Internet — situation normale pour un poste PAO en atelier.

**Note** : l'import Excel est le **seul** outil du projet dans ce cas. C'est une incohérence avec la promesse du produit.

---

## 4. 🟡 MOYEN

### BUG-5 — `wordFileInput` : importeur orphelin (code mort)

Deux importeurs Word coexistent :

| Chemin | Déclencheur | État |
|---|---|---|
| `importDocxBtn` → `importDocxInput` | bouton de la modale Import + glisser-déposer | ✅ **actif**, avec images (`convertImage`) |
| `importWord` → `wordFileInput` | bouton `#importWord` | ❌ **mort** — `#importWord` n'existe pas |

**Vérifié au runtime** : `document.getElementById('importWord')` → absent (mon `getElementById('importWord')?.addEventListener` utilise `?.`, donc pas de crash). Les 21 inputs de fichier du HTML incluent bien `wordFileInput`, mais rien ne peut déclencher son `click()`.

**Impact utilisateur** : **aucun aujourd'hui** (le bon chemin fonctionne, et il est même supérieur — il conserve les images). C'est de la dette : ~90 lignes de code mort qui prêtent à confusion et qu'un futur correctif pourrait « réparer » à tort en préférant la mauvaise version.

### BUG-6 — Traductions japonaises incomplètes (94 clés)

| Pack | Clés | Taille |
|---|---|---|
| FR | 731 | 42 691 car. |
| EN | 732 | 47 896 car. |
| **JA** | **638** | **35 224 car.** |

**94 clés présentes en FR/EN manquent en japonais**, dont des messages d'erreur critiques que l'utilisateur japonais verra en anglais : `alertCannotReadSpFile`, `alertDocxImportError`, `alertFontLoadError`, `alertCannotDeleteStructure`, `alertFormatInvalid`…

**Atténuation intégrée** (bien vu de la part du développement) : la fonction `translate()` retombe automatiquement sur l'anglais puis le français, et détecte même les packs japonais corrompus (`/\?{2,}/`). Donc **pas de texte cassé** — mais une expérience japonophone partiellement en anglais.

**Point positif** : `en` ne manque **aucune** clé. L'anglais et le français sont complets et cohérents.

### BUG-7 — 16 libellés de l'interface sans traduction

Clés `data-translate` présentes dans le HTML mais absentes des trois dictionnaires :
```
cornerRadius        justify           indentLeftLabel     indentRightLabel
indentFirstLineLabel paragraphIndentLabel  indentHint     thinNbspBtn
nbspBtn             cornerLinkToggle  localBadgeTitle     pasteboardToggleTitle
printVps            gpuInfoPlaceholder spotTargetFillTitle spotTargetStrokeTitle
```

**Visible concrètement** : le libellé « Coins arrondis » (panneau rectangle) s'affichera en français même en anglais ou en japonais, car `translate()` retourne la clé… et le HTML affiche son texte par défaut. Concerné aussi : les 3 libellés d'**indentation de paragraphe** et `spotTargetFillTitle`/`spotTargetStrokeTitle` (les infobulles du nuancier Pantone Fond/Contour ajoutées récemment).

### BUG-8 — 980 `catch` vides avalent les erreurs silencieusement

Recensement :
```
catch vides  : 980       catch (e) exploités : 249
console.error : 65       console.warn : 221
```

**Nuance importante** : une grande partie est **légitime** — sauvegarde de préférences `localStorage`, sondes de compatibilité, restaurations optionnelles. C'est un choix assumé et souvent correct (le projet documente d'ailleurs ces `try/catch` comme normaux lors des audits).

**Le vrai risque** : sur 980, certains masquent des pannes réelles. C'est le **terreau du BUG-2** — un appel à une fonction inexistante ailleurs serait passé inaperçu exactement de cette façon. Recommandation : ne pas tout changer, mais ajouter un `console.warn` là où l'échec est *anormal* (par opposition à *optionnel*).

---

## 5. 🔵 MINEUR

| # | Constat | Détail |
|---|---|---|
| M-1 | **Pas de contrôle de version au chargement `.sp`** | `_spValidateProjectFile` vérifie `_sp.format`, `document.format.width/height` et `pages[].objects` — mais **jamais `_sp.version`**. Un `.sp` d'une version passée ou future est accepté sans avertissement. Le format est à `1.0.0` depuis longtemps, donc l'impact est théorique aujourd'hui — mais il n'existe aucun filet si le format évolue. |
| M-2 | **Deux clés de traduction sans définition** | `alertSelectTextFirst` (ligne 53926 — appelée avec un repli `\|\| 'Select a text block…'`, donc sans conséquence visible) et `key` (ligne 50809, faux positif : c'est le paramètre de `translate(key)`, pas un appel littéral). |
| M-3 | **`showExportModal` et `openExportModal` coexistent** | Deux noms pour une fonction, dont un inexistant. Même famille que BUG-1/BUG-2 : la barre d'outils, `Ctrl+P` et `Ctrl+E` n'empruntent pas le même chemin. |
| M-4 | **66 IDs référencés sans être dans le HTML** | Après classement fin (voir §6bis), **1 seul présente un risque réel** : `fileInput` (= BUG-1). 18 sont protégés par `if (el)`/`?.`, 10 sont dans des blocs commentés `/* … */`, le reste est créé dynamiquement en JS. |

---

## 6. Ce qui est de bonne qualité (points forts vérifiés)

Il serait injuste de ne lister que les défauts — plusieurs points sont **au-dessus de la moyenne** :

**Persistance `.sp` / `.json`** — la revue de `SP_CUSTOM_PROPS` (78 propriétés) montre un travail sérieux et documenté. Chaque propriété non évidente porte un commentaire expliquant **ce qui casse sans elle**. Les cas récents sont bien couverts : habillage de texte (`_spWrapMode`…`_spWrapOrigH`), tons directs Pantone, overflow de planches doubles, métriques typographiques (`_fontSizeMult`). J'ai vérifié les 5 propriétés que je soupçonnais manquantes : **toutes étaient bien déclarées** (mon outil avait un défaut de portée, pas le code).

**Alignement / distribution** — implémentation PAO correcte : **1 objet sélectionné → alignement sur le plan de travail ; plusieurs objets → bounding box de la sélection**. C'est le comportement attendu, et il est traité explicitement en spread (alignement sur la page active, gauche ou droite).

**Garde-fous métier** — distribution protégée si moins de 3 objets, chaînage de texte avec détection de débordement, imports qui préviennent l'utilisateur au lieu d'échouer en silence.

**Défense en profondeur** — `Ctrl+S` teste l'existence de chaque fonction avant de l'appeler (`typeof window._spAutoSave === 'function'`). Les 3 autres raccourcis auditée ne le font pas — c'est exactement la différence entre `Ctrl+S` (robuste) et `Ctrl+O`/`Ctrl+E` (cassés).

**Auto-save** — 36 clés de stockage, 8 points de sauvegarde différée. Aucun conflit détecté.

**API publique** — 56 fonctions exposées sur `window`, dont `window.SuperPrint` (13 méthodes documentées). Surface stable et cohérente.

---

## 6bis. LISTE COMPLÈTE ET CLASSÉE DES IDs SANS ÉLÉMENT HTML

Votre remarque était pertinente : *ces IDs viennent-ils du studio ?* **Non** — vérifié en §7bis, il n'existe **aucune** dépendance DOM croisée. Voici le classement complet des 66 IDs, établi en tenant compte des **77 IDs que l'app crée elle-même** en JavaScript et des **blocs commentés `/* … */`**.

### Catégorie A — risque réel de crash : **1 ID**

| ID | Ligne | Code |
|---|---|---|
| `fileInput` | 22863 | `document.getElementById('fileInput').click();` |

C'est **BUG-1** (§2). **Un seul cas sur 66 fait réellement planter quelque chose** — plutôt rassurant sur la santé du code.

### Catégorie B — protégés, aucun crash possible : **18 IDs**

Suivis d'un test `if (el)`, d'un `?.`, ou déclarés en variable puis testés :

```
toggleLeftSidebar    toggleRightSidebar   linkedBlocksInfo     linkedBlocksCount
linkedBlocksOverflow unchainTextButton    cmykPreviewLabel     loadProject
customWidth          customHeight         embedColorProfile    npOrientPortrait
npOrientLandscape    designScroll         assetsScrollRight    trappeTabs
importWord           npHasCover
```

L'app vérifie l'existence avant d'agir — bonne pratique appliquée systématiquement.

### Catégorie C — créés dynamiquement en JavaScript : **~37 IDs**

Modales et panneaux construits à la volée : `sp3DViewer*` (7), `spMissingFonts*` (5), `_askInsert*` (3), `gridPopinOverlay`, `spToastHost`, `sp-toast-stack`, `spMobileTouchMenu*`, `pdfProgressText`, `cheminMasterPanel`, `spPdfBar`, `widgetsOverlay`… **Tout à fait normaux** : le JS crée l'élément puis le référence.

### Catégorie D — dans du code commenté : **10 IDs**

```
maskPositionPanel  addLinkedText     chainTextButton   cmykPreviewOverlay
pageFormat         loadColorProfile  colorProfileInfo  assetsScrollLeft
importPDF          deletePageBtn     (+ toggleGuides, dans un bloc /* */)
```

Fonctionnalités volontairement désactivées (« Bouton Repères auto supprimé », anciens boutons de chaînage, ancien bouton de suppression de page). **Rien à corriger** — mais supprimer ce code améliorerait la lisibilité.

### Précision sur `wordFileInput` (BUG-4)

Le bloc est **actif** (non commenté), mais écrit défensivement :
```js
document.getElementById('importWord')?.addEventListener('click', () => {   // ?. absorbe le null
    document.getElementById('wordFileInput').click();                      // jamais atteint
});
```
Le bouton `#importWord` n'existe pas → le `?.` évite le crash → l'importeur est simplement **jamais branché**. C'est de la dette, pas un bug utilisateur : le chemin `importDocxBtn` fonctionne et gère les images.

---

## 7. Recommandations par ordre de priorité

| Priorité | Action | Effort |
|---|---|---|
| **1** | Corriger `Ctrl+O` → remplacer `fileInput` par le vrai chemin d'import | 1 ligne |
| **2** | **Définir `closeFaqModal`** (ou retirer le `onclick`) → la FAQ redevient fermable | 3 lignes |
| **3** | Corriger `Ctrl+E` → `openExportModal()` | 1 ligne |
| **4** | Supprimer le chemin `importWord`/`wordFileInput` mort **ou** le brancher | ~90 lignes à retirer |
| **5** | Compléter les 16 `data-translate` manquants (FR/EN/JA) | 48 chaînes |
| **6** | Héberger SheetJS localement (aligner sur la règle du projet) | 1 fichier + 1 ligne |
| **7** | Compléter le pack JA (94 clés) — priorité aux alertes | variable |

**Les points 1 à 3 sont à faire immédiatement** : cinq lignes au total, pour deux raccourcis universels et une fenêtre bloquante réparés.

---

## 7bis. AUDIT CROISÉ app ↔ studio SP213 (vérification importante)

Vous avez eu raison d'insister sur ce point : **si le studio partageait des IDs avec l'app, plusieurs de mes conclusions auraient été fausses.**

**Vérification faite** (`_audit_croise2.cjs`, en tenant compte du helper `$()` du studio — 213 appels, invisibles à mon premier passage) :

| Contrôle | Résultat |
|---|---|
| IDs identiques dans les deux outils | **2** : `zoomIn`, `zoomOut` |
| Références de l'app vers un ID du studio | **0** |
| Références du studio vers un ID de l'app | **0** |

**Conclusion : les deux outils sont totalement isolés au niveau du DOM.** Aucun de mes constats n'est invalidé par un partage d'ID. Les 66 « IDs introuvables » côté app le restent bien — ce sont des références à des éléments créés dynamiquement en JS, ou du code commenté.

### Canaux réels de communication

Les deux outils ne communiquent **jamais** par le DOM, uniquement par `localStorage` et par paramètre d'URL — **6 canaux réels** (j'ai dû résoudre les 16 constantes `LS.*` du studio, qui masquaient les noms littéraux) :

| Clé / paramètre | Sens |
|---|---|
| `sp213_import_sp` | studio écrit le `.sp` → app le lit au démarrage |
| `?from=sp213` | déclencheur d'ouverture (`_spLoadStudioImport`) |
| `sp_typo_styles` | studio → app (styles nommés) |
| `sp_color_swatches` | studio → app (nuancier) |
| `sp_spot_inks` | app → studio (tons directs) |
| `sp213_from_sp` | drapeau de contexte |

### Point vérifié et finalement VALIDE : synchronisation des clés IA

Mon audit a d'abord signalé une « divergence de nommage » (l'app utiliserait `sp_ai_key_deepseek`, le studio `sp213_deepseek_key`). **Vérification faite : c'est un faux positif de ma part.** L'app implémente une **chaîne de repli à 3 niveaux** (`AI_STUDIO_KEY_MAP`, ligne 45207) :

```
1. sp_ai_key_<provider>     (clé propre à l'app)
2. sp_ai_key                (ancienne clé générique)
3. sp213_<provider>_key     (clé saisie dans le studio)   ← synchro réelle
```

**Une clé saisie une seule fois dans le studio est donc utilisable dans l'app sans ressaisie.** C'est un bon design, et il corrige mon observation initiale.

### Autres divergences de nommage (volontaires, non problématiques)

| Rôle | Clé app | Clé studio |
|---|---|---|
| Thème | `sp_theme` | `sp213_theme_v1` |
| Langue | `sp_lang` | `sp213_studio_lang_v2` |

Volontaire : le studio est un outil séparé, il a ses propres préférences. Le thème et la langue ne sont **pas** censés être synchronisés (l'app est FR/EN/JA, le studio a son propre sélecteur).

---

## 8. Méthode et limites

### Déroulé de l'audit (2 passes)

**Passe 1 — analyse ciblée.** Sondages sur les zones à risque : raccourcis, persistance, i18n, dépendances, écouteurs.

**Passe 2 — balayage exhaustif.** Vous avez demandé si la liste était complète : elle ne l'était pas. J'ai relancé un scan systématique de **toutes** les classes de bugs, sur l'app **et** le studio :

| Contrôle exhaustif | Résultat |
|---|---|
| Handlers inline du HTML (`onclick`, `onchange`…) → fonction existe ? | 95 fonctions appelées · **1 introuvable** (`closeFaqModal` → BUG-2) |
| Appels `window.X()` → fonction exposée ? | 71 appels · **0 orphelin** |
| `addEventListener` non protégés sur ID absent | 2 (dans du code commenté) |
| `getElementById` non protégés sur ID absent | **1** (`fileInput` → BUG-1) |
| Raccourcis clavier en doublon | 0 |
| Écouteurs globaux en double | 0 |
| Fonctions définies plusieurs fois | 0 |
| Attributs `data-*` jamais lus | 0 |

**Cette 2ᵉ passe a apporté le BUG-2 (FAQ), qui manquait au premier rapport.**

**Limites de cet audit** :
- L'audit est **statique et par échantillonnage**, pas un parcours exhaustif de chaque fonctionnalité à la main.
- Les zones que vous avez exclues (export PDF, imposition, Plume) **n'ont pas été analysées**.
- Certains faux positifs initiaux de mes outils ont été écartés un par un par lecture du code source — les chiffres du rapport sont ceux **vérifiés**, pas les bruts.
- Aucune modification n'a été apportée au code.

**Fichiers de travail temporaires** créés pour l'analyse (à supprimer si vous le souhaitez) : `_audit_tools.cjs`, `_audit_tools2.cjs`, `_audit_guard.cjs`, `_audit_calls.cjs`, `_audit_persist.cjs`, `_audit_persist2.cjs`, `_audit_props3.cjs`, `_audit_i18n.cjs`, `_audit_tools4.cjs`, `_audit_croise.cjs`, `_audit_croise2.cjs`, `_audit_canaux.cjs`.

### Faux positifs écartés (traçabilité)

Pour que le rapport soit utilisable, voici ce que j'ai **cru** trouver puis **invalidé** par vérification :

| Fausse alerte | Réalité |
|---|---|
| 5 propriétés `.sp` manquantes (`_spShapeTextPairId`, `_spWrapOrigH`…) | **Toutes déclarées** — bug de portée dans mon extracteur |
| Appels d'alignement absents (`alignTop`, `groupObjects`…) | Fonctionnent via l'attribut `data-align` → `alignSelectedObjects()`, noms de fonctions différents |
| `pageFormat` / `customWidth` / `customHeight` manquants | **Protégés** par `if (el)` — sans danger |
| `toggleGuides` manquant | **Code volontairement commenté** (bouton « Repères auto » retiré) |
| Clés IA app ≠ studio | **Synchro réelle** via chaîne de repli `AI_STUDIO_KEY_MAP` |
| 980 `catch` vides = risque | Grande majorité **légitime** (préférences, sondes optionnelles) |
| IDs partagés app/studio | **Aucun** (2 seulement : `zoomIn`/`zoomOut`, sans conséquence) |
| `pageImg` / `current` / `prev` / `next` « manquants » | Dans un **template literal généré** (`${pages.length}`) — HTML créé dynamiquement |
| `aiPromptModal` « absent » | **Présent** dans le HTML — faux positif de mon extracteur |
| `_spLcmsTransformRgbColor` orphelin | **Exposée** par `cmyk-lcms.js` (fichier hors de mon premier périmètre de scan) |
| `window.gc()` orphelin | **Normal** : API DevTools, protégée par `if (aggressive && window.gc)` |
| `window.CreateMLCEngine()` orphelin (studio) | **Normal** : chargé dynamiquement depuis le CDN WebLLM |
| Bruit de « fonctions introuvables » dans les handlers inline | **Texte de contenu** dans les attributs (`value='Éditorial premium…'`) — écarté en retirant les chaînes littérales |
