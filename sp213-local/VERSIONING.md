# SUPERPRINT — VERSIONING (note officielle)

> **Dernière version : `1.7.333`** — 4 septembre 2026
> Ce document est la **source de vérité** pour le versioning de SuperPrint.
> Il décrit OÙ se trouve chaque numéro et COMMENT le bump à chaque release.

---

## 1. La version courante

| Champ | Valeur |
|---|---|
| Version app (affichée) | `1.7.333` |
| Cache Service Worker | `superprint-shell-v1.7.333-no-whatsapp` |
| Query JS (`main.js`) | `?v=20260904-v333-sp213` |
| Badge preview (`spVersionBadge`) | `v1.7.333` |
| Splash screen | `v1.7.333` |
| Préférences (panneau SUPERPRINT) | `v1.7.333` |
| Préférences (bas de page) | `SuperPrint v1.7.333 — 4 septembre 2026` |
| Onboarding (`V 1.7.333`) | `1.7.333` |
| Landing (`softwareVersion` + footer) | `1.7.333` |
| Documentation | `v1.7.333` |
| `version.txt` | `1.7.333` |
| `llms.txt` / `llms-full.txt` | `1.7.333 (September 2026)` |
| `package.json` (sp213-local) | `1.7.333` |

> ⚠️ Le paquet **npm** (`superprint-npm`) a sa **propre version** (`1.0.x`) — c'est la version de *release du paquet*, indépendante de la version de l'app. Il lit la version de l'app depuis `https://superprint.cc/version.txt`.

---

## 2. Les fichiers à bump (lister exhaustivement à CHAQUE release)

Tous les fichiers ci-dessous contiennent le numéro de version. **Chacun doit être mis à jour** lors d'un bump. Ils existent en **double** (dossier web `superprint/` + copie locale `sp213-local/public/superprint/`) → toujours mettre à jour les 2.

### A. App (web)
- `app/index.html` — 12 occurrences :
  - commentaire SEO `SuperPrint vX.Y.Z — Zigmoon`
  - `<meta name="generator" content="SuperPrint vX.Y.Z — Zigmoon">`
  - JSON-LD `"softwareVersion": "X.Y.Z"`
  - `.splash-version` → `vX.Y.Z`
  - `#spVersionBadge` : commentaire, `title`, `data-sp-js`, `data-sp-sw`, texte `vX.Y.Z`
  - panneau préférences : `vX.Y.Z` (info SUPERPRINT) + `SuperPrint vX.Y.Z — <date>`
  - onboarding : `LAYOUT EDITOR — V X.Y.Z` + `V X.Y.Z | MM YYYY`
  - `<script src="JS/main.js?v=YYYYMMDD-vXYZ-...">`
- `app/service-worker.js` — `CACHE_NAME = 'superprint-shell-vX.Y.Z-...'`
- `app/landing.html` — JSON-LD `softwareVersion` + `feat-tag` + footer `© ... vX.Y.Z`
- `app/llms.txt` + `app/llms-full.txt` — `Version: X.Y.Z`
- `app/documentation.html` — topbar `.version`, footers (4 lignes)

### B. Racine (pré-home + landing + doc)
- `index.html` — (pas de numéro de version affiché, mais vérifier)
- `landing.html` — JSON-LD `softwareVersion`, `feat-tag`, footer
- `service-worker.js` — `CACHE_NAME`
- `llms.txt` + `llms-full.txt` — `Version: X.Y.Z`
- `documentation.html` — topbar `.version`, footers (4 lignes)
- `version.txt` — `X.Y.Z` (source de vérité pour le CLI npm)

### C. Studio SP213
- `sp213-studio.html` — pas de version affichée directement, mais le fichier doit être re-synchronisé
- `src/main.js` (sp213-local) — pas de version affichée

### D. Local (zip + package)
- `sp213-local/package.json` + `package-lock.json` — `"version": "X.Y.Z"`
- `sp213-local.zip` — régénéré après chaque bump

---

## 3. RÈGLE D'OR — cache Service Worker

Le **Service Worker** ne se met à jour que si `CACHE_NAME` change.
⇒ Le numéro de version dans `service-worker.js` **doit toujours être > au dernier déployé**.
Ex. si le badge affichait `1.7.271`, bump vers `1.7.333` minimum.

---

## 4. OÙ NE PAS toucher

- `app/JS/main.js` : les commentaires `// v1.7.2xx` sont des **notes de changelog historiques** (légitimes) — ne PAS les modifier.
- `_sp` dans `buildSPFile()` / `startStudio()` : `version: '1.0.0'` = **format de fichier `.sp`** (ne pas confondre avec la version de l'app).

---

## 5. Procédure complète de release

1. Choisir le nouveau numéro (ex. `1.7.333`) — **toujours > au cache SW actuel**.
2. Mettre à jour TOUS les fichiers de la section 2 (web + copie locale).
3. Vérifier : `grep -r "1.7.333" superprint/` → plus aucune occurrence (sauf changelog main.js).
4. Vérifier synchro web/local : md5 identiques pour chaque fichier.
5. Régénérer `sp213-local.zip` via `_make_zip.mjs`.
6. Vérifier le zip : contient bien `app/index.html` à jour, `version.txt`, `service-worker.js`.
7. Publier sur superprint.cc + app.zigmoon.com (zip + fichiers).
8. Si changement du CLI : bump `superprint-npm/package.json` (`npm version patch`) + `npm publish`.

---

## 6. Scripts utiles

```bash
# Vérifier toutes les occurrences de version dans le projet
grep -r "1\.7\.2[0-9][0-9]" superprint/

# Vérifier qu'aucune ancienne version ne traîne
grep -r "1\.7\.26[0-3]" superprint/

# Comparer synchro web/local
# (voir script md5 dans les notes du projet)
```
