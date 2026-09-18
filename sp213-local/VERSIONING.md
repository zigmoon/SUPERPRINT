# SUPERPRINT — VERSIONING (note officielle)

> **Dernière version : `1.7.471`** — 18 septembre 2026
> Ce document est la **source de vérité** pour le versioning de SuperPrint.
> Il décrit OÙ se trouve chaque numéro et COMMENT le bump à chaque release.

---

## 1. La version courante

| Champ | Valeur |
|---|---|
| Version app (affichée) | `1.7.471` |
| Cache Service Worker (app **et** racine) | `superprint-shell-v1.7.471-curseur` |
| Query JS (`main.js`) **et** CSS (`main.css`) | `?v=20260918-v471-curseur` |
| Badge preview (`spVersionBadge`) | `v1.7.471` — 5 marqueurs : commentaire, `title` (`JS v456`), `data-sp-js="v456"`, `data-sp-sw`, texte |
| Splash screen | `1.7.471` |
| Onboarding | `LAYOUT EDITOR — V 1.7.471` + `V 1.7.471 \| 09 2026` |
| JSON-LD `softwareVersion` (lanceur `index.html` + `landing.html` + `app/index.html` + `app/landing.html`) | `1.7.471` |
| Documentation (racine **et** `app/`) | `v1.7.471` (pastille + pieds de page datés + 214 numéros de ligne) |
| `api.html` (pastille `.version`) | `v1.7.471` |
| `version.txt` | `1.7.471` |
| `llms.txt` / `llms-full.txt` (racine **et** `app/`) | `1.7.471 (September 2026)` |
| `package.json` + `package-lock.json` (sp213-local) | `1.7.471` |
| Lanceur npm (`superprint-npm/package.json`) | `1.0.97` (version **indépendante**, voir plus bas) |

> ⚠️ Trois fichiers sont restés en arrière pendant des releases sans que rien ne le signale :
> `app/landing.html`, `app/llms.txt` et `app/llms-full.txt` (tous en `1.7.404` jusqu'au
> 18 septembre 2026). Le bump 1.7.471 les a remis à niveau — **vérifier leur présence dans
> le plan de bump**, pas seulement `app/index.html`.

> ⚠️ Le paquet **npm** (`superprint-npm`) a sa **propre version** (`1.0.x`) — c'est la version de *release du paquet*, indépendante de la version de l'app. Il lit la version de l'app depuis `https://superprint.cc/version.txt`.

---

## 2. Les fichiers à bump (lister exhaustivement à CHAQUE release)

Tous les fichiers ci-dessous contiennent le numéro de version. **Chacun doit être mis à jour** lors d'un bump. Ils existent en **double** (dossier web `superprint/` + copie locale `sp213-local/public/superprint/`) → toujours mettre à jour les 2.

### A. App (web)
- `app/index.html` — 17 occurrences de la version, dont **7 COMMENTAIRES HISTORIQUES** (`<!-- 🆕 vX.Y.Z — … -->`) à **NE PAS** toucher. Marqueurs VIVANTS : commentaire SEO (`SuperPrint vX.Y.Z — Zigmoon`), `<meta name="generator">`, JSON-LD `softwareVersion`, `.splash-version`, onboarding (`LAYOUT EDITOR — V X.Y.Z` + `V X.Y.Z | MM YYYY`), `#spVersionBadge` (commentaire + `title` + `data-sp-js` + `data-sp-sw` + texte), `<script src="JS/main.js?v=…">`.
- `app/service-worker.js` — `CACHE_NAME = 'superprint-shell-vX.Y.Z-…'`
- `app/landing.html` — JSON-LD `softwareVersion` + footer
- `app/llms.txt` + `app/llms-full.txt` — **uniquement** la ligne `- **Version**: X.Y.Z` + **AJOUTER** le billet de la version (les billets `- **X.Y.Z** — …` sont de l'HISTORIQUE : ne jamais les renommer)
- `app/documentation.html` — pastille `.version` + 2 pieds de page datés (⚠️ ce fichier est **souvent oublié** : il était resté en 1.7.404)

### B. Racine (pré-home + landing + doc)
- `install.html` — 🆕 v1.7.471 : **le lanceur** (ex-`index.html` de la racine) : pas de
  version affichée, mais le JSON-LD `softwareVersion` ; il est **précaché par le
  service worker racine** → c'est le bump du `CACHE_NAME` racine qui force sa mise
  à jour. Il est en `noindex` (page de démarrage locale, pas une page publique).
- `icons/` — logotypes du lanceur, à ajouter à l'`APP_SHELL` du SW racine quand on en ajoute un.
- `index.html` — 🆕 v1.7.471 : c'est LA LANDING (page d'accueil). JSON-LD
  `softwareVersion` + footer `© ... vX.Y.Z`
- `landing.html` — 🆕 v1.7.471 : page de secours 301, aucun numéro de version
- `service-worker.js` — `CACHE_NAME`
- `llms.txt` + `llms-full.txt` — ligne `- **Version**:` + nouveau billet (voir ci-dessus)
- `documentation.html` — pastille `.version` + 2 pieds de page datés
- `version.txt` — `X.Y.Z` (source de vérité pour le CLI npm)

### C. Studio SP213
- `sp213-studio.html` — aucun numéro de version affiché, mais le fichier doit être **re-synchronisé** (copie locale). Il est ouvert depuis l'app avec `?v=…` (cache-busting) : voir `app/JS/main.js`.

### D. Local (zip + package)
- `sp213-local/package.json` + `package-lock.json` — `"version": "X.Y.Z"`
- `sp213-local.zip` — régénéré après chaque bump (`_dev/scripts/_make_zip.cjs`)
- ⚠️ **NE PAS** bumper `main.js` : ses occurrences de version sont TOUTES des commentaires historiques.
- ⚠️ **NE PAS** avancer `MIN_APP_VERSION` (`superprint-npm/cli.mjs`) avant le téléversement du zip (le CLI refuse un zip plus ancien que ce plancher).

---

## 3. RÈGLE D'OR — cache Service Worker

Le **Service Worker** ne se met à jour que si `CACHE_NAME` change.
⇒ Le numéro de version dans `service-worker.js` **doit toujours être > au dernier déployé**.
Ex. si le badge affichait `1.7.271`, bump vers `1.7.368` minimum.

---

## 4. OÙ NE PAS toucher

- `app/JS/main.js` : les commentaires `// v1.7.2xx` sont des **notes de changelog historiques** (légitimes) — ne PAS les modifier.
- `_sp` dans `buildSPFile()` / `startStudio()` : `version: '1.0.0'` = **format de fichier `.sp`** (ne pas confondre avec la version de l'app).

---

## 5. Procédure complète de release

1. Choisir le nouveau numéro (ex. `1.7.455`) — **toujours > au cache SW actuel**.
2. **Bump ciblé** : `node _dev/scripts/_mk_bump_XXX.cjs` (dry-run) puis `--apply`.
   ⚠️ Un `replaceAll` global est INTERDIT : il renomme les commentaires historiques `🆕 vX.Y.Z`
   de `app/index.html` et les billets des llms. Chaque remplacement du plan est compté (throw si ≠ attendu).
3. **Documentation** : `node _dev/scripts/_patch455_doc.cjs` régénère les **214 numéros de ligne**
   de la table des fonctions (mesuré : 213/214 étaient périmés) et corrige les pieds de page datés.
4. **Synchro web ↔ copie locale** : `node _dev/scripts/_parite_382.cjs` (16 paires clés) +
   `node _dev/scripts/_sync_450_full.cjs` → attendu **« différents : 0 »**.
5. **Cohérence** : `node _dev/scripts/_verif_coherence.cjs` → marqueurs vivants cohérents, 0 résidu.
6. **Build local** : `npm run build` dans `sp213-local` (régénère `dist/`).
7. **Zip** : `node _dev/scripts/_make_zip.cjs` → `superprint/sp213-local.zip` + contrôles internes
   (`--verif` pour contrôler sans recréer).
8. **Billet** : `release.html` (racine du dépôt, **gitignoré**, déployé séparément sur
   app.zigmoon.com) + `CHANGELOG.md` (sans BOM).
9. **Git** : commit (message via `-F fichier`, jamais `-m` avec accents/apostrophes) + `git tag vX.Y.Z` + push.
10. Publier sur superprint.cc + app.zigmoon.com (zip + fichiers) **puis** avancer `MIN_APP_VERSION`.
11. Si changement du CLI : bump `superprint-npm/package.json` (`npm version patch`) + `npm publish`
    (2FA validée par l'utilisateur dans le navigateur).

---

## 6. Scripts utiles (`_dev/scripts/`, gitignorés)

```bash
node _dev/scripts/_mk_bump_455.cjs          # bump ciblé (dry-run, --apply)
node _dev/scripts/_patch455_doc.cjs         # doc : contenu + 214 numéros de ligne
node _dev/scripts/_audit_doc_455.cjs        # audit doc + inventaire des versions/tags
node _dev/scripts/_sync_450_full.cjs        # synchro récursive web ↔ copie locale (md5)
node _dev/scripts/_parite_382.cjs           # 16 paires clés
node _dev/scripts/_verif_coherence.cjs      # marqueurs de version vivants
node _dev/scripts/_make_zip.cjs             # zip du paquet local (+ --verif)
```
