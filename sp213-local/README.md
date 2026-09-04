# SuperPrint Local — Vite + WebLLM

**Toute** l'application SuperPrint (PAO + studio SP213) tourne **100% en local** : les modèles IA
sont téléchargés **une seule fois** puis exécutés sur votre machine via WebGPU. Aucune donnée ne
quitte votre ordinateur.

## ⚡ Démarrage rapide

### 1. Prérequis
Installez [Node.js LTS](https://nodejs.org) (il inclut `npm`).

### 2. Copiez-collez dans un terminal (une seule ligne)

**Windows (PowerShell) :**
```powershell
npx.cmd superprint
```
> ⚠️ `npx.cmd` (et non `npx`) : sur certains PC, PowerShell bloque `npx.ps1` (PSSecurityException). Le `.cmd` contourne la politique d'exécution.

**macOS / Linux (Terminal) :**
```bash
npx superprint
```

> 💡 Vous pouvez aussi **télécharger `sp213-local.zip`** depuis app.zigmoon.com, le décompresser,
> puis : `cd sp213-local && npm install && npm run dev`.

### 3. Ouvrez la pré-home
Au lancement, le terminal affiche une **bannière SUPERPRINT** en grosses lettres, puis l'adresse : **http://localhost:5173**

> 💡 Pour relancer sans la bannière : `npm run dev:plain`

Ouvrez-la dans Chrome ou Edge (WebGPU requis pour le mode local).

Depuis la pré-home (design blanc SuperPrint), deux choix :

| Choix | Ce que ça fait |
|---|---|
| **SuperPrint Local** (recommandé) | Ouvre l'application PAO SuperPrint complète servie par Vite |
| **Studio Web** | Ouvre le studio SP213 (WebLLM local ou Groq cloud) |

## 🧠 Modèles locaux (studio SP213)

| Modèle | Taille | Usage |
|---|---|---|
| Qwen3 4B | ~3.4 Go | ✅ Recommandé — qualité + conversation |
| Qwen2.5 3B | ~2.4 Go | Rapide / économique |
| Llama 3.2 3B | ~2.2 Go | Basique |
| Qwen3 1.7B | ~2.0 Go | Très léger |
| Qwen3 8B | ~5.7 Go | Le plus puissant (demande beaucoup de VRAM) |

Le premier chargement télécharge le modèle (quelques minutes). Ensuite il est **en cache** : les
lancements suivants sont quasi instantanés.

## ☁️ Mode Groq (optionnel)

Le mode local est indépendant. Si vous voulez des maquettes très riches, un mode **Groq (cloud)**
est disponible depuis l'écran d'accueil — il ne nécessite qu'une clé API `gsk_...` (stockée
uniquement dans votre navigateur).

## 🗂 Structure

```
sp213-local/
├── index.html              # Pré-home (design blanc SuperPrint) + studio
├── src/main.js             # Logique complète (WebLLM npm + Groq direct)
├── public/
│   ├── superprint/         # Application SuperPrint COMPLÈTE (copie, servie telle quelle)
│   │   ├── index.html      # L'app PAO SuperPrint
│   │   ├── sp213-studio.html
│   │   ├── JS/  CSS/  img/ ...
│   ├── js/fabric.min.js
│   ├── js/mammoth.min.js
│   └── favicon.png
├── package.json
└── vite.config.js
```

> Le dossier `public/superprint/` est copié tel quel dans `dist/` au build (pas bundlé).

## 🚀 Build de production

```bash
npm run build
npm run preview
```

## 🔁 Interop avec SuperPrint

- **Exporter .sp** : télécharge la maquette au format natif SuperPrint.
- **Ouvrir dans SuperPrint** : le fichier `.sp` s'importe via SuperPrint → Importer.


## 🤖 Assistant d installation

`npm run setup` lance l assistant interactif (téléchargement → décompression → installation → lancement) avec une interface claire dans le terminal.
