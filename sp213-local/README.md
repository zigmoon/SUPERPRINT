# SuperPrint Local — Vite + WebLLM

The **whole** SuperPrint application (DTP + SP213 studio) runs **100% locally**: AI models are
downloaded **once**, then executed on your machine via WebGPU. No data leaves your computer.

## ⚡ Quick start

### 1. Prerequisites
Install [Node.js LTS](https://nodejs.org) (it includes `npm`).

### 2. Copy-paste in a terminal (single line)

**Windows (PowerShell):**
```powershell
npx.cmd superprint
```
> ⚠️ Use `npx.cmd` (not `npx`): on some PCs PowerShell blocks `npx.ps1` (PSSecurityException). The `.cmd` wrapper bypasses the execution policy.

**macOS / Linux (Terminal):**
```bash
npx superprint
```

> 💡 You can also **download `sp213-local.zip`** from app.zigmoon.com, unzip it,
> then: `cd sp213-local && npm install && npm run dev`.

### 3. Open the pre-home
On launch, the terminal shows a **SUPERPRINT banner** in large letters, then the address: **http://localhost:5173**

> 💡 To start without the banner: `npm run dev:plain`

Open it in Chrome or Edge (WebGPU is required for local mode).

From the pre-home (white SuperPrint design), two choices:

| Choice | What it does |
|---|---|
| **SuperPrint Local** (recommended) | Opens the full SuperPrint DTP application served by Vite |
| **Web Studio** | Opens the SP213 studio (local WebLLM or Groq cloud) |

## 🧠 Local models (SP213 studio)

| Model | Size | Use |
|---|---|---|
| Qwen3 4B | ~3.4 GB | ✅ Recommended — quality + conversation |
| Qwen2.5 3B | ~2.4 GB | Fast / lightweight |
| Llama 3.2 3B | ~2.2 GB | Basic |
| Qwen3 1.7B | ~2.0 GB | Very light |
| Qwen3 8B | ~5.7 GB | Most powerful (requires a lot of VRAM) |

The first load downloads the model (a few minutes). Afterwards it is **cached**: subsequent
launches are almost instant.

## ☁️ Groq mode (optional)

Local mode is self-contained. If you want very rich mockups, a **Groq (cloud)** mode is available
from the home screen — it only requires a `gsk_...` API key (stored only in your browser).

## 🗂 Structure

```
sp213-local/
├── index.html              # Pre-home (white SuperPrint design) + studio
├── src/main.js             # Full logic (WebLLM npm + direct Groq)
├── public/
│   ├── superprint/         # Complete SuperPrint application (copy, served as-is)
│   │   ├── index.html      # The SuperPrint DTP app
│   │   ├── sp213-studio.html
│   │   ├── JS/  CSS/  img/ ...
│   ├── js/fabric.min.js
│   ├── js/mammoth.min.js
│   └── favicon.png
├── package.json
└── vite.config.js
```

> The `public/superprint/` folder is copied as-is into `dist/` at build time (not bundled).

## 🚀 Production build

```bash
npm run build
npm run preview
```

## 🔁 Interop with SuperPrint

- **Export .sp**: downloads the mockup in SuperPrint's native format.
- **Open in SuperPrint**: the `.sp` file imports via SuperPrint → Import.

## 🤖 Setup assistant

`npm run setup` launches the interactive assistant (download → unzip → install → launch) with a clear terminal interface.
