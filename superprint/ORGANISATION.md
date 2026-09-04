# 🗂 SuperPrint — Organisation & Architecture (2026-08-27)

Document de référence pour la **nouvelle organisation** de SuperPrint après la refonte.
Cette page décrit la structure du dossier à déployer sur `superprint.cc`, les rôles de
chaque élément, les liens entre les pages, et la procédure de mise en ligne.

---

## 1. Vue d'ensemble

SuperPrint est désormais organisé autour de **trois entrées principales** :

| Entrée | URL | Rôle |
|---|---|---|
| **Pré-home** | `/` (index.html) | Page 1 — logo + installation locale + accès en ligne |
| **Studio SP213** | `/sp213-studio.html` | Maquettes IA (WebLLM local ou Groq cloud) |
| **App SuperPrint** | `/app/index.html` | L'éditeur PAO complet (ex-racine) |

Le **studio** et **l'app** sont accessibles **en ligne** (sur le serveur) et **en local**
(via le paquet Vite téléchargeable).

---

## 2. Arborescence complète (`superprint/`)

```
superprint.cc/
│
├── index.html              ← PRÉ-HOME (page 1) — logo + ligne à copier + accès en ligne
├── sp213-studio.html       ← STUDIO SP213 (maquettes IA) — à la racine
│
├── app/                    ← APPLICATION PAO COMPLÈTE (déménagée dans /app/)
│   ├── index.html          ← L'éditeur SuperPrint (ex-racine)
│   ├── JS/  CSS/  img/  icc/  SP/  icons/  tests/
│   ├── ai-proxy.php        ← proxy IA de l'app (anthropic/openai/deepseek/groq)
│   ├── download.php        ← téléchargements (convertisseur…)
│   └── ... (toutes les ressources de l'app, chemins relatifs)
│
├── JS/                     ← RACINE (allégée) : uniquement pour le studio
│   ├── fabric.min.js       ← moteur canvas (studio)
│   └── mammoth.min.js      ← extraction .docx (studio)
│
├── ai-proxy.php            ← proxy Groq à la racine (utilisé par le studio)
│
├── sp213-local.zip         ← paquet LOCAL téléchargeable (Vite + WebLLM, ~52 Mo)
│
├── icons/  favicon.png  superprint.ico  icon_256.png   ← assets partagés
├── robots.txt  sitemap.xml  llms.txt  llms-full.txt   ← SEO / GEO
├── manifest.webmanifest  service-worker.js            ← PWA
├── .htaccess                                          ← Apache (CSP, cache, HTTPS)
│
├── landing.html           ← landing (conservée)
├── documentation.html     ← documentation (conservée)
├── cmyk-landing-secure.html
├── super-print-cmyk-convert.html
└── google98ec41e577852dcf.html  ← vérification Google
```

---

## 3. Rôles détaillés

### 3.1 La pré-home — `index.html` (page 1)
- Design **blanc** sobre (DA SuperPrint), logo + « SuperPrint » à la ligne.
- **Installation locale** : une ligne à copier (icône copie) avec onglets Windows/macOS.
- **Accès en ligne** : deux barres — « SuperPrint Editor » → `app/index.html` et « Studio » → `sp213-studio.html`.
- SEO enrichi : title, description, Open Graph, Twitter Card, JSON-LD `WebSite`.

### 3.2 Le studio SP213 — `sp213-studio.html`
- Maquettes par conversation (WebLLM local via WebGPU, ou Groq cloud via `ai-proxy.php`).
- Liens vers l'app : « Voir dans SuperPrint » → `app/index.html?from=sp213`.
- Dépend de la racine : `JS/fabric.min.js`, `JS/mammoth.min.js`, `ai-proxy.php`, `favicon.png`, `icons/`.

### 3.3 L'app SuperPrint — `app/index.html`
- L'éditeur PAO complet (Fabric.js 5.3), fonctionne **entièrement en statique** (HTML/CSS/JS).
- Liens vers le studio : bouton IA → `../sp213-studio.html` (le studio est à la racine).
- Possède **ses propres** `JS/`, `CSS/`, `img/`, `icc/`, `SP/`, `icons/`, `tests/`, `ai-proxy.php`, `download.php`.
- `app/JS/main.js` corrigé : `openSp213Studio()` et `openCurrentInStudio()` pointent vers `../sp213-studio.html`.

### 3.4 Le paquet local — `sp213-local.zip`
- Téléchargé par la ligne de commande, décompressé puis lancé via Vite.
- Contient : `index.html` (pré-home locale), `src/main.js` (studio local), `public/superprint/` (copie de l'app pour le mode local), `scripts/setup.mjs` (assistant), `scripts/start.mjs` (bannière).
- **Structure plate** : `package.json` est à la racine du zip (pas de dossier imbriqué).
- Commande d'installation (Windows) :
  ```
  Invoke-WebRequest -Uri "https://app.zigmoon.com/sp213-local.zip" -OutFile sp213-local.zip; Expand-Archive sp213-local.zip -DestinationPath sp213-local -Force; cd sp213-local; node scripts/setup.mjs
  ```

---

## 4. Liens entre les pages (matrice)

| Depuis | Vers | Cible |
|---|---|---|
| Pré-home (`/`) | App | `<a href="app/index.html">` |
| Pré-home (`/`) | Studio | `<a href="sp213-studio.html">` |
| Studio (`/sp213-studio.html`) | App | `app/index.html?from=sp213` |
| App (`/app/index.html`) | Studio (bouton IA) | `../sp213-studio.html` |
| App (`/app/index.html`) | Studio (maquette actuelle) | `../sp213-studio.html?from=sp` |
| Local (pré-home) | App locale | `superprint/app/index.html` |
| Local (pré-home) | Studio local | `startStudio('webllm')` |

**Mécanisme de transfert de maquette** (via `localStorage`, même domaine) :
- Studio → App : clé `sp213_import_sp` + `?from=sp213`.
- App → Studio : clé `sp213_from_sp` + `?from=sp`.

---

## 5. La version locale (Vite) — `sp213-local/`

Le dossier source de la version locale (hors du site, dans le workspace) :

```
sp213-local/
├── index.html              # Pré-home locale (logo + « Démarrer SuperPrint »)
├── src/main.js             # Studio local (WebLLM npm + Groq direct, sans proxy)
├── scripts/
│   ├── setup.mjs           # Assistant d'installation (étapes 1/4 → 4/4, bannière)
│   └── start.mjs           # Launcher dev avec bannière SUPERPRINT
├── public/
│   ├── superprint/         # COPIE de l'app pour le mode local (même structure que superprint/)
│   ├── js/                 # fabric.min.js + mammoth.min.js
│   └── favicon.png
├── package.json            # scripts : dev / dev:plain / setup / build / preview
├── vite.config.js
└── README.md
```

**Commandes** :
```bash
npm run dev        # lance avec bannière SUPERPRINT (via scripts/start.mjs)
npm run dev:plain  # lance Vite sans bannière
npm run setup      # assistant d'installation interactif
npm run build      # build de production
```

---

## 6. Déploiement sur superprint.cc

### Fichiers à uploader (ensemble, ne pas oublier le zip)

| Fichier | Rôle | Critique |
|---|---|---|
| `index.html` | Pré-home (commande + liens) | ✅ Oui |
| `sp213-studio.html` | Studio web | ✅ Oui |
| `app/` (dossier entier) | App complète | ✅ Oui |
| `sp213-local.zip` | Paquet local téléchargeable | ✅ Oui (le zip ET la commande vont ensemble) |
| `JS/` (fabric + mammoth) | Dépendances studio | ✅ Oui |
| `ai-proxy.php` | Proxy Groq (studio) | ✅ Oui |
| `robots.txt`, `sitemap.xml` | SEO (référence /, studio, app/) | ✅ Oui |
| `.htaccess` | CSP (autorise esm.run, huggingface, groq) | ✅ Oui |
| `icons/`, `favicon.png`, etc. | Assets | ✅ Oui |

### Après upload
- **Rechargement forcé** : `Ctrl+Shift+R` (les caches PWA/service-worker peuvent servir l'ancienne version).
- **Tester** : `/` (pré-home) → `app/index.html` et `sp213-studio.html`.

---

## 7. Notes techniques

- **CSP** (`.htaccess`) : autorise `esm.run` (WebLLM CDN), `huggingface.co`, `raw.githubusercontent.com`, `api.groq.com`.
- **Groq en local** : le studio local appelle `api.groq.com` **directement** (CORS OK depuis localhost), sans passer par le proxy PHP.
- **Service worker** : attention au cache — penser à bump le tag de version pour forcer le rechargement.
- **`llms.txt` / `llms-full.txt`** : maintenus pour le GEO (référencement par les moteurs IA).

---

_© SuperPrint — document d'organisation interne, version du 27 août 2026._
