# tools/

Small, dependency-free helpers that build or serve SuperPrint. They are the **only**
scripts tracked by this repository — everything else used during development lives in
`_dev/`, which is git-ignored.

| Script | What it does |
|---|---|
| `serve.mjs` | Static server for local testing. `node tools/serve.mjs` serves `superprint/` on port 8080. No build step needed — the editor is plain HTML/CSS/JS. |
| `make-release-zip.mjs` | Assembles `superprint/sp213-local.zip` from `sp213-local/`. That zip is the artefact published to `app.zigmoon.com` and downloaded by the npm launcher. It is **git-ignored** on purpose. |
| `sync-documentgenerator.ps1` | Mirrors the LICRA document generator (`documentgenerator/`) into its deployment copy (`licra-loiret/documentgenerator/`). Diagnostic by default, `-Apply` to write. |

Both **node** scripts resolve the repository root from their own location, so they work from any
working directory and can be moved as a folder.

```bash
node tools/serve.mjs                  # http://127.0.0.1:8080/app/index.html
node tools/serve.mjs superprint 9000  # custom folder and port
node tools/make-release-zip.mjs       # rebuild superprint/sp213-local.zip
```

### Synchronising the LICRA document generator

`documentgenerator/` is the single source of truth; `licra-loiret/documentgenerator/` is
only the deployment mirror of that same app inside the WordPress tree. Both were byte-for-byte
identical (904 files, 15.8 MB), including `.venv/` and `.github/`, so an edit made on one side
could silently stay invisible on the other. Never edit the mirror.

```powershell
pwsh -File tools/sync-documentgenerator.ps1          # diagnostic only, exit code 1 on drift
pwsh -File tools/sync-documentgenerator.ps1 -Apply   # copy/delete, then verify again
```

`-Source` and `-Destination` override the defaults. Development artefacts (`.venv`,
`.github`, `__pycache__`, `*.pdf`, `*.zip`, `*.log`) are neither copied nor deleted.

### Building `sp213-local/`

`sp213-local/` is the Vite + WebLLM distribution used by the npm launcher. Unlike the
editor, it does need a build:

```bash
cd sp213-local
npm install
npm run build      # outputs dist/
```

Then regenerate the zip with `node tools/make-release-zip.mjs` (run from the repository
root). Note that `dist/` and `node_modules/` are excluded from the zip.

### Testing a change despite the service worker

The app registers a service worker, which may serve a cached copy of `main.js` or
`index.html`. Two options:

1. Append a cache-busting query: `?v=test`, or the project's own `?t=<timestamp>`.
2. Unregister and clear caches from the browser console:

```js
const regs = await navigator.serviceWorker.getRegistrations();
for (const r of regs) await r.unregister();
for (const k of await caches.keys()) await caches.delete(k);
location.reload();
```

### A note on `superprint/`

⚠️ **Everything inside `superprint/` is deployed as-is** — that folder *is* the published
website. Never place tooling, reports, virtual environments or editor state in there.
The `.gitignore` enforces this with a safety net (`superprint/_*`,
`superprint/RAPPORT-*.md`, `superprint/.venv/`, `superprint/.vscode/`), but the rule is
worth remembering before copying anything into that folder.
