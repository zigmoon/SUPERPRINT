﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿﻿# Changelog

All notable changes to **SuperPrint** — the web DTP application (`1.7.x`), the **SP213 Studio** AI layout assistant, and the npm launcher (`1.0.x`, versioned independently).

- **App version** is declared in `superprint/version.txt` and mirrored in `sp213-local/`.
- **Full release notes** (trilingual FR / EN / JP, with detail) are published at **https://app.zigmoon.com/release.html**.
- Every release is git-tagged `v1.7.NNN` — see the [Releases](https://github.com/zigmoon/SUPERPRINT/tags) tab.
- **SP213 Studio** is the AI layout page (`sp213-studio.html`). It talks to DeepSeek / OpenAI / OpenRouter / Groq / a local WebLLM model and produces native `.sp` documents that the editor opens directly.

---

## [1.7.547] — 2026-09-25

_Text frame options survive a template retouch, and they apply straight away_

### Fixed
- **Text frame options lost while retouching a template** (user request: « lorsque je retouche un gabarit, je perds quelques réglages comme les réglages du text frame options. Un bloc se remet en une colonne alors qu’il était en 2 colonnes. Et un deuxième bloc s’insère. Au clic, le deuxième bloc disparaît. Aussi, au moment de l’enregistrement et sur le gabarit enregistré qui se trouve sur la page de preview, le réglage du text frame options est perdu »). Three causes, all measured on a 320 px block with a 120 px frame, 2 columns and a long text. - **(a) Columns are not a Fabric geometry.** They are FLOWED by the text-wrap engine: `__spLineAvailWidth()` returns the width of ONE column (main.js ~L5402) and the call is made by the page render exit (`finalizeRender` → `_spWrapReflowAll()`, v1.7.372). The template editor only did a `loadFromJSON`, so the block stayed flowed on a single column. Measured in the editor: **17 lines / 1 column** against **35 lines / 2 columns** on the page. Fixed: the editor now replays exactly the page pass — `restoreTextboxAfterLoad()` on every text block, then `window._spWrapReflowAll()`. - **(b) The frame height was only restored on load.** `restoreTextboxAfterLoad()` (called by the pages) sets `height = _fixedHeight`, re-patches `initDimensions` and applies the frame mask (`applyTextboxClipPath`). Neither the template editor nor the options panel went through it: measured right after validating the options, the block grew from 120 px to **548 px** with a **268 px** mask, and in the editor to **265 px** — and that wrong height was then written INTO THE SAVED TEMPLATE (`height: 265` instead of the 120 px frame). Fixed: `spRelayout()` (the text frame options panel) now recalls the frame, re-applies the mask and re-runs the composition, so a setting applies immediately instead of waiting for a reload. - **(c) Display markers could be saved into a template** (« un deuxième bloc s’insère. Au clic, le deuxième bloc disparaît »). The OVERFLOW indicator (the triangle shown when the text exceeds the frame), the chaining badge, the link arrow, tab stops and page numbers are application display objects: they were written into the template and then reappeared on every page fed by it, vanishing again as soon as a click recomposed the page. Fixed: saving a template now uses exactly the same filter as saving a page (`saveAllPages`). User guides placed in the template (`_isMasterGuide`) are still saved, as before. 
### Verified
- **The four states are now identical** (2 columns, 35 lines, capacity 14, height 120 px, mask 120 px): the page right after setting the options, the template editor, the saved template, and the page fed by that template. Before the fix: 548 px / mask 268 px on the page, 265 px in the editor, and `height: 265` inside the saved template. - **No regression**: plain text block (natural height 29 px, mask floor 32 px), block with insets only (height unchanged at 29 px), short text set to 2 columns (a single column is used, capacity 2). - The template keeps its own guides (`_isMasterGuide`, `excludeFromExport`) while the overflow indicator stays out of it (measured: the saved template contains only the text block). 

## [1.7.546] — 2026-09-25

_Templates exact on double pages, and a studio round trip that loses nothing_

### Fixed
- **Templates on double pages** (user request: « recontrole le nouveau gabarit cela doit etre parfait »). Three measured defects, all reproduced and fixed. - **(a) Elements of the two pages interleaved.** A spread holds two pages on ONE canvas. When both pages are fed by the SAME template their elements share the same ranks, and the re-ordering of 1.7.545 interleaved them. Measured on a 2|3 spread: `textbox, textbox, rect, rect, circle, circle, group, group` instead of the template order for each page. Fixed: each injected element now also remembers its PAGE (`_spMasterPage`, a runtime mark that is never serialised) and `spRangerGabarit()` groups by page before sorting by rank. - **(b) The spread layer optimisation destroyed the template order.** `optimizePairZIndex()` re-sorts every object of a spread by `calculateSpreadPriority` (1000 − top, plus bonuses). Measured on a spread: `rect, textbox, image, group` instead of `rect, image, textbox, group`. Fixed: template elements (`_isMasterRuntime` / `_spMasterIdx`) and page-number blocks are EXCLUDED from that sort — they keep the place the re-ordering has just given them, at the bottom of the stack, under the page content. - **(c) A single page was paired with a spread.** The loop paired two ADJACENT canvases. On a 4-page document `canvases` is `[page 1, spread 2|3, page 4]`, so page 1 was paired with the 2|3 spread and its objects were re-sorted by vertical position (measured: `rect, image, textbox` became `rect, textbox, image`) — very exactly the « la page se modifie légèrement » reported by the user. Fixed: only canvases that really are a spread (`bleedInfo.isSpread`) are processed, and the objects of a spread are counted once (the same canvas is passed as both sides). - **Studio: objects lost after a page without elements** (part of the same user request: « controle le .sp du studio »). `buildSPFile()` looked its page up by POSITION in `state.doc.pages` (`state.doc.pages[p.pageIndex]`) while the import RE-INDEXES that array (it keeps a `pageIndex` field per entry). As soon as one page was skipped, every following page was read from the wrong slot: measured, page 3 with 4 objects exported with 0 object. Fixed: `spDocPagePour()` looks the page up by its `pageIndex` FIELD. - **Studio: a page fed by a template was deleted.** The import filter `filter(p => p.elements.length > 0)` removed every page without elements of its own — exactly the case of a page whose whole content comes from a template (1.7.545). Measured: a 3-page template document came back with 2 pages (and its objects with it). Fixed: a page without elements is kept when it is linked to a template. - **Studio: shape groups were lost.** `spVecteurVersElementImage()` only converted children carrying a `path` (pen stroke, SVG/EPS logo); a GROUP OF SHAPES (rect, circle, line…) has none, so it returned null and the object vanished (measured: a page with 4 objects came back with 3). Fixed: geometric fallback `spSvgPrimitives()` writes the SVG primitives directly (rect/rectangle, circle, ellipse, line, triangle, polygon, path), honouring originX/originY, scale, opacity, stroke and rotation. Verified: a 141×101 px group of two rectangles placed at 100,200 comes back into the application as a vector image of 161×121 px at 100,200 — same position, same size. 
### Verified
- **Templates, every case measured**: four pages in double-page mode (including a spread and a single page paired with it), template assigned to all of them — the four template elements are in the template’s own order on EVERY page and at the template’s exact coordinates (11.5,11.5 / 51.5,111.5 / 31.5,51.5 / 31.5,591.5), identical after `renderAllPages()`, after a page change and after a guide redraw; a page whose template is released keeps its own objects and is not fed again. - **Application .sp round trip**: export → import → export is IDENTICAL (15,728 characters both times, ignoring timestamps), with `masters.templates`, `masters.assignments`, `pages[].masterId`, the template’s numbering flag, the `_spGabaritLibere` marks and the template’s object ORDER. No runtime mark (`_spMasterIdx`, `_spMasterPage`, `_isMasterRuntime`) appears anywhere in the file. - **Application .json round trip**: export → import through the real file field → export is IDENTICAL (17,248 characters), with `masterPages`, `pageMasterAssignments`, the liberation marks and the template’s numbering. - **Studio .sp**: `masters` re-emitted as-is (objects, coordinates and order identical to the input), `pages[].masterId` preserved, 3 pages preserved where 2 were before, and shape groups preserved as vector images. 

## [1.7.545] — 2026-09-25

_Page templates apply reliably (exact layer order and position), the template editor moves into the preview, and Lock is removed_

### Fixed
- **Page templates applied unstably** (user request: « après avoir créé une page et que je l’enregistre en gabarit, lorsque j’applique ce gabarit dans flatplan à une page, au moment où je retourne sur la page dans la préview qui a le nouveau gabarit celle-ci se modifie légèrement ou bug »). Three measured defects, all reproduced and fixed. - **(a) Reversed layer order.** A template’s elements are placed in two waves: the text synchronously (created natively to work around the `Textbox.fromObject` bug), the other objects later through `fabric.util.enlivenObjects`, which is asynchronous as soon as it contains an image. Every placement used `insertAt(obj, 0)` — the bottom of the stack, so that template items stay BELOW the page content — so the template order came out reversed. Measured with a « background, image, title » template: the page received `image > background > title` instead of `background > image > title`, i.e. the background covered the image. Fixed: each element carries its index inside the template (`_spMasterIdx`, a runtime mark that is never serialised) and `spRangerGabarit()` puts the stack back in template order with `canvas.moveTo()` — which fires neither `object:added` nor `object:removed` (firing them triggered a `saveAllPages()` per move, the lesson of 1.7.543). Same fix in the export path (`injectMasterItemsForExport`), so the PDF stacks like the screen. - **(b) One bleed (3 mm) of shift.** A template lives in the PAGE coordinate system (origin = trim corner — that is what the template editor has always used, and what the injection expects, adding the bleed back), while a page lives in the CANVAS system (origin = bleed corner). `addPageAsMasterFromChemin()` (the flatplan’s « ⊕G » button) copied the page coordinates as they were, so every template element was shifted right and down by one bleed. Measured: an object at 20,20 on the source page landed at 29,29 on the target page. Fixed: top-level coordinates are converted to the page reference when the template is created (group children stay in their group reference). Verified end to end: page 2 receives `rect|20,20 > image|60,120 > textbox|40,60`, identical to page 1, and stable when sampled at 0.4 s, 1.5 s and 4 s. - **(c) Text wrap not re-run.** A text only flows around an image once that image is placed. `finalizeRender()` (the single exit of every document render) re-runs the wrap with a `setTimeout(0)`, which happens BEFORE the asynchronous wave of template images; the page was therefore sometimes left without wrapping, and reloading the page fixed it — hence the « parfois » in the report. Fixed: `spReflowApresGabarit()` re-runs the wrap right after each wave of template elements is placed (it returns immediately when no element carries a wrap mode). - **Disposed canvas guard**: the asynchronous wave now checks that the canvas is still attached to the document (`lowerCanvasEl.isConnected`) before placing its elements, so a `renderAllPages()` that replaces the canvas mid-flight can no longer leave elements on a dead canvas. - **« Verrouiller le gabarit de cette page » removed from the right-click menu** (user request: « il faudrait retirer l’option de locker une page après l’avoir libérée »). The inverse action deleted the released elements, i.e. the work done on the page. On an already released page there is now no template entry at all, and `spEtatGabaritPourPoint()` returns null there so that a right-click on an empty area no longer opens an empty dark menu either. `window.spVerrouillerGabaritPage()` is kept as an API (tests, manual repair) but is no longer offered. 
### Added
- **Template editing in the preview** (user request: « lorsque l’on ouvre édition de gabarit, il faudrait que la page s’ouvre dans la préview afin d’avoir accès à tous les réglages de page. Le background de la preview sera plus foncé au moment de l’édition du gabarit. Ce mode édition de gabarit aura 2 boutons (annuler et enregistrer le gabarit) »). `openMasterEditor()` no longer opens the 800 px modal with its 450-px-high canvas: it closes the flatplan (applying pending changes), then installs the template on the workbench at the place of the pages — measured 525×743 px for an A4 against the old 700×450 canvas — with the preview background darkened from `rgb(232,232,232)` to `rgb(182,182,182)` and exactly TWO floating buttons, « Annuler » and « Enregistrer le gabarit ». `getActiveCanvas()` returns the template canvas while the mode is active, so every panel and tool works on the template; `findCanvasFromTarget()` recognises it too, so the right-click menu (text wrap, path editing, order, duplicate, delete) is fully available — verified by a real right-click on a template object. The template canvas never enters `canvases`: it is neither serialised as a page nor rebuilt by `renderAllPages()`. - **Page settings follow the template**: `spRedessinerReperesMarges()` and `renderAllPages()` now also refresh the template board, so its margin frame and its size follow the document settings while you edit (measured: margins 20 → 8 mm moves the frame from 57 to 23 px; width 210 → 148 mm resizes the board from 525×743 to 370×743). The « Numérotation » checkbox of the template stays available in the bar; its `change` handler used to call a function that was not global (silent `ReferenceError`, the box did nothing) and is now a real listener. - **Save / Cancel** keep the old filters (margin frame excluded, template guides kept) and `window.spMasterEditEntrer|Sortir|Enregistrer|Reperes|Barre|Actif` are exposed for tests. Saving re-renders the document, so assigned pages immediately show the updated template (verified: a shape added to the template appears on the assigned page, and the template numbering option adds the folio). 

## [1.7.544] — 2026-09-25

_Contour text wrap reliable again, an Anthropic Claude 5 engine in the studio, a mobile documentation that fits_

### Fixed
- **Text wrap — « Contour » fell back to « Bounding box »** (user request: « lors de mes derniers tests, lorsque je règle l’option contour et que je sélectionne l’objet cela fonctionne, mais lorsque je relâche l’objet l’option Bounding box se met à la place de contour »). **Cause, measured and reproduced**: the ink-band cache added in 1.7.540 memorised a FAILED measurement. When the outline is measured before the object image is loaded — the normal case when opening a document with photos — the off-screen rasterisation finds no ink, and that result was stored against the object geometry signature. Since the signature no longer changes, Contour silently reused the bounding box for ever, even after the image loaded and even after re-selecting the option. Measured with a 200×200 image loaded after the first pass: box 93,83,75,74 and contour 93,83,75,74 (identical) before the fix; 93,83,75,74 against 154,128,119,103 after. - Fixed on four fronts: (1) an object that is not ready (image element not loaded, including inside a group, a clipPath or a mirror) is never cached; (2) a measurement that finds no ink forces `dirty = true` on the object (Fabric cache rebuilt) and re-measures once — verified against an artificially emptied cache bitmap; (3) `window._spWrapOublierContour(obj)` clears the cached measurement of one object and `setMode()` calls it, so choosing a mode always re-measures; (4) the panel re-reads the mode from the object on mouse release (`resyncDepuisObjet`), so the display can no longer freeze on a stale state. A first attempt put that re-read inside `refreshSeg()`, which runs between the user’s click and its application: measured, clicking « Contour » left « Aucun » highlighted and applied nothing — the re-read was moved to the release handler. - **Mobile documentation** (user request: « le header top nav en mobile de la documentation.html buggait, ça décale toute la page et on voit même pas le deuxième bouton »). Measured: `app/documentation.html` overflowed at every mobile width (385 px for a 382 px viewport) and « Documentation technique » ended at **549 px**, i.e. off screen; `documentation.html` forced the page to 381 px because of a long `<code>` that could not break. Fixed: two-row header with both tabs sharing the width, wrappable code, content top margin computed from the real header height (load, resize, rotation) and an overflow safety net. Measured after: no overflow and both tabs visible at 320, 360, 390 and 430 px, title clear of the bar. 
### Added
- **Studio SP213: Anthropic Claude 5 engine** (user request: « mets à jour les nouveaux modèles d’OpenAI et d’Anthropic aussi dans le studio213 »). The studio had OpenAI (GPT-6 since 1.7.543), DeepSeek, OpenRouter, Groq and the local engine, but no Anthropic at all. Added end to end: the « Anthropic Claude » option, a key field (`sk-ant-…` + console.anthropic.com link) and a model list — `claude-opus-5-5` (default), `claude-sonnet-5`, `claude-fable-5-1`, `claude-haiku-4-5-20251001`, `claude-opus-4-5-20251101` — localStorage shared with the application (`sp_ai_key_anthropic`), key checks at start-up and generation, model label, and `callAnthropic()`: POST `ai-proxy.php?provider=anthropic` (the PHP proxy already relays the Messages API) with a direct fallback to api.anthropic.com via the `anthropic-dangerous-direct-browser-access` header, the `system` field extracted from the messages, user/assistant alternation, answer read from `data.content[].text` and truncation reported. Verified with a real intercepted request: model `claude-opus-5-5`, `max_tokens: 32000`, `anthropicVersion: 2023-06-01`, a 34,620-character system and a single `user` message. 
### Verified
- **`.sp` and `.json` audit** (user request: « suite à nos dernières modifications, mets bien à jour le format .sp et .json dans l’app et aussi dans le studio213 pour le .sp ») — nothing to change, everything measured: the application `.sp` round trip is identical for the wrap (`_spWrapMode: shape` + 8 px standoff), the tab stops, `document.colGrid {cols:12, opacity:18, margins:true}`, the templates, the margins and the inks; the `.json` export carries the same values (verified by reading `pages[i].objects`); the decorative grid guides (`isGridGuide`, `isBaselineGuide`, `isColumnGrid`) appear in NEITHER format; and the studio re-emits all of it after an import from SuperPrint (wrap `circle:shape:8`, 1 tab stop, colGrid, margins, templates). 

## [1.7.543] — 2026-09-25

_Grid & Guides no longer freeze the app; the AI assistant gains GPT-6 and Claude 5_

### Fixed
- **Grid & Guides panel: the real cause of the slowness** (user request: « le module GRILLE ET REPERE est très lent, les boutons à cliquer sont super lents […] audit »). The red column bands were created with `isGridGuide` and `isColumnGrid` but **without `isGuide`**, while the `object:removed` handler spares a `saveAllPages()` only for `isMargin|isBleed|isTrimBox|isGuide|isManualGuide|isPage|isPageBorder|isBleedMask`. Every removed band therefore triggered a **full document serialisation** (all pages, all images): 32 bands × 6 boards = 192 saves per action. Measured on 6 boards holding a 3 MB photo each: `rebuildGridAll()` = **984 ms, of which 222 × `canvas.remove()` = 978 ms** (4.4 ms per removal); the « Baseline » checkbox cost 920 ms and « Show the grid » 2 989 ms. On a light document it only cost ~40 ms per action, which is why the bug went unnoticed. - **After**: bands carry `isGuide: true` (they are decorative and already `excludeFromExport`), the safeguard now also tests `isGridGuide || isBaselineGuide || isColumnGrid`, and the general clean-ups (overflow indicators, chain badges) no longer run for a removed guide. Measured: `rebuildGridAll()` = **6.3 ms**, 222 removals = 0.5 ms, baseline click 2-5 ms, grid toggle 0.3-1.5 ms. - **Colour, opacity and repetition no longer rebuild anything**: `spMajCouleurGrille()` / `spMajOpaciteColonnes()` update the existing guide objects (measured: ten colour-picker moves **441 ms → 0.3 ms**), number fields are coalesced through `spPlanifierGrille()` (140 ms) and colour/opacity through `spGrillePlanifier(mode)` (90 ms). - **Visible boards first**: `rebuildGridAll()` now redraws the boards on screen immediately and hands the others to `spGrilleDiffere()` (a single pending `requestIdleCallback`, generation-counter guarded, cancelled by `spGrilleDiffereAnnuler()` when the grid is switched off), and `_spReassertPasteboardLayout` runs only on the boards actually modified. The deferred pass re-reads `getGridSettings()` so a colour chosen right after a click reaches every board. 
### Added
- **AI assistant pop-in — layout** (user request: « mets les boutons Tester la connexion et Sauvegarder à droite […] le champ du soufflet Journal doit faire toute la largeur »): `.ai-actions` gets `justify-content: flex-end` (measured: buttons at 579→718 and 726→817 px inside an 860 px card) and `.ai-log` gets `width: 100%; box-sizing: border-box` (measured: 755 px inside a 785 px accordion, i.e. 783 minus the 2×14 px padding). - **OpenAI: GPT-6 generation** (source: developers.openai.com/api/docs/models, checked 2026-09-25). New list: `gpt-6-astra` (flagship, 1.05 M context, 128 K output, Chat Completions supported), `gpt-6-sol`, `gpt-6-luna`, then `gpt-5.6-sol/terra/luna` and `gpt-5.1` as fallbacks. Output budget 32 000 tokens for GPT-6 through `max_completion_tokens` (these reasoning models reject `max_tokens`), and native JSON mode extended to GPT-6. Default model: `gpt-6-astra`. - **Anthropic: Claude 5 generation** (source: platform.claude.com/docs/en/about-claude/models/overview, checked 2026-09-25). New list: `claude-opus-5-5` (recommended), `claude-sonnet-5`, `claude-fable-5-1` (1 M context, adaptive thinking), `claude-haiku-4-5-20251001`, with `claude-opus-4-5-20251101` as a fallback. Output budget raised to 32 000 tokens (the 5.x models allow 128 K). Default model: `claude-opus-5-5`. - The **studio SP213** receives the same OpenAI range (it has no Anthropic engine yet), and the published documentation plus the context text sent to the engines are updated. - **Verified at the bench** by intercepting the real payloads: OpenAI `gpt-6-astra` → `max_completion_tokens: 32000`, `gpt-5.6-sol` → 16000; Anthropic `claude-sonnet-5` → `max_tokens: 32000` with `anthropicVersion: 2023-06-01`; both dropdowns show the new ranges with readable labels. 

## [1.7.542] — 2026-09-24

_The print pop-in: the network printers move to the first tab and actually work_

### Added
- **Network printers in the first tab** (user request: « revois la pop-in print VPS, tu penses qu’on pourrait voir le réseau des imprimantes disponible dans le premier onglet […] je souhaiterais qu’il marche »). The « Imprimantes réseau » block (scan button, printer list, state line) leaves the Pre-flight tab and opens the Settings tab, above the print settings. - The scan button (`#vpsNetScanBtn`) is wired to `detectPrintBridge()` then `scanNetworkPrinters()` with `?force=1`: it disables itself while scanning, and the state line reports honestly (`n imprimante(s) détectée(s)`, `Aucune imprimante réseau trouvée` + hint, or `Pont local non détecté`). A printer without IPP is listed but disabled, with « sans IPP — impression directe indisponible ». 
### Fixed
- **Print bridge (`sp213-local/scripts/print-bridge.mjs`) — three blocking bugs.** (1) the printer id was a **fresh random UUID on every scan**, so `POST /api/print` always answered « Printer not found », even for a printer listed a second earlier: the id is now the **sha1 of the service url** (16 hex, stable across scans). (2) the preflight answer carried **no `Access-Control-Allow-Private-Network`**, which Chrome requires for a public (https) page to reach `127.0.0.1` — added (with `X-Requested-With` in the allowed headers). (3) `sides` was compared to `'duplex'` while the pop-in sends `'two-sided-long-edge'`, so duplex was **always ignored** — the bridge now understands both spellings. - **The print settings really travel**: the pop-in sent `media: 'A4'` in **both** branches of a ternary (the custom size was ignored) and never sent the printer url; the job now carries the real media (`_vpsIppMedia()` → A4/A3/A5/Letter/Legal/B5 or `custom_<w>x<h>mm`), the real colour mode (`monochrome` for black and white), the real duplex value and the printer url as a fallback lookup. - **Tab 1 layout**: the print settings became a **two-column grid** (Orientation | Quality, Colour | Copies, Parity | Duplex) of 260 px columns instead of full-width rows — measured in the browser: panel 540 px high, grid `260px 260px`, 9 children, no console error. - **`start.mjs` starts the bridge with the local studio** (`npm run dev`) and stops it on exit; the three help texts in the pop-in said `npm run print:bridge` as a manual step and now say the bridge comes with the studio. _Measured live: `/api/health` → 200 ok, version 2; OPTIONS preflight → `Access-Control-Allow-Private-Network: true`; `/api/printers?force=1` → an empty list (this development machine exposes no IPP printer); `POST /api/print` with an unknown id → 404 « Imprimante introuvable — relancez un scan du réseau »._ 

## [1.7.541] — 2026-09-24

_The studio keeps page templates: a document with master pages no longer loses them on the way through Studio IA_

### Fixed
- **The studio dropped the page templates** (user request: « suite à nos 3 derniers retours, mets bien à jour le .sp et le .json dans l’application et dans le Studio pour le .sp, puis aligne la version local et web, puis bump une nouvelle version, git, zip »). `sp213-studio.html` never read `spFile.masters` (0 occurrence), and both writers rebuilt `masters: { templates: {}, assignments: {} }` with `masterId: null` **hard-coded**. Measured consequence: app → studio → app returned a document **without any template** — pages were no longer fed by their master, and the « Libérer / Verrouiller le gabarit de cette page » entry disappeared from the right-click menu, since `spEtatGabaritPage()` requires an assignment. - The import now remembers `spFile.masters` in `state.doc.masters` (so it travels with the studio session) and the page `masterId`; both writers re-emit `masters` **as they are** (falling back to empty dictionaries when the document had none, so the key is still always present). The page `masterId` is read from `masters.assignments` — the authoritative source, the one the application reads back; `state.pages` does not carry it (it is built by `createPageCanvas` as `{ pageIndex, canvas, label }`). - **Application side: nothing to fix.** Measured on a document carrying a template, a released page, tab stops, a Contour wrap, a red frame, 12/18/15/25 mm margins, a 3-column grid and a spot ink: the in-memory `.sp` round trip is **identical** (masters.templates [m1], masters.assignments {0:m1}, pages[0].masterId m1, 2 `_spGabaritLibere` markers, `_spTabs.active` with 1 stop, `_spWrapMode` shape, `_spFrameStroke` #ff0000, margins, grid, CMYK, ink #FCEE21) and the exported `.json` carries `masterPages`, `pageMasterAssignments` and both release markers. - **Measured after** (app → studio → app): the studio `.sp` leaves with `templates [m1]`, `assignments {0: m1}`, `masterId m1`, both release markers, the block with active tab stops, wrap shape, frame #ff0000, margins {top:12, right:25, bottom:18, left:15} and grid {cols:3, opacity:12, margins:true}; back in the application, `spEtatGabaritPage(0)` returns `{ masterId: m1, nom: Gabarit 538, libere: true }` — the right-click menu offers « Verrouiller le gabarit de cette page » again — with 0 template elements injected, which is correct on a released page. - Local and web versions were checked file by file (version.txt on both sides, package.json, package-lock.json, CONTENU.txt, index.html): already aligned, and this bump moves them together to 1.7.541.

## [1.7.540] — 2026-09-24

_The Contour text-wrap option really follows the shape now, instead of copying the bounding box_

### Fixed
- **The Contour wrap option did exactly the same thing as Bounding box** (user report: « dans superprint, dans text wrap, je ne vois pas de différence entre l’option « Bounding box » et « Contour ». Peux-tu auditer cela ? »). Measured on the bench (141 px circle and 121 px triangle over a text frame): `shapeBands()` returned 26 bands **all equal to the bounding box** (153 px for the circle, 133 px for the triangle), and the text was identical in both modes — 9 lines, widths 283.8 / 286.1 / 288.4 / 38.1 / 49.5 / 33.9 / 41.1 / 43.9 / 34.1 px. **Cause**: the contour was derived from `obj.getCoords()`. Fabric only overrides `getCoords()` for the bounding box: an object always returns its four corners, whatever shape it draws. Contour could not differ from Bounding box. - **The contour is now detected from the pixels** (`bandsEncre()`, `_SP_HABILLAGE_540`): the object is rasterised once into an offscreen canvas (capped at 480 px) and, over 28 horizontal bands, the min/max x of the **non-transparent pixels** is recorded — the « detect edges » method of layout applications. A circle, a star, a pen path, a vectorised glyph and the silhouette of a cut-out image are all covered by the same code. The result is cached by a geometry signature (the reflow calls the function at every line), and the fallback stays the bounding box when rasterisation is impossible (tainted canvas from a cross-origin image, object with no ink, render failure). - `shapeBands()` applies the standoff to the ink bands (so the cache does not depend on the offset) and returns `xmin = xmax = null` for a band with **no ink**; `lineWidthFor()` then **ignores the obstacle on that height** (corners of a circle, tip of a triangle, hollow of a star) instead of falling back to the bounding box. - **The wrap dialog help now states what each mode does**: Bounding box = the text stops at the object rectangle, Contour = it follows the real shape (circle, star, cut-out image, path). - **Measured after**: circle profile 63 → 153 → 67 px (was 153 px everywhere), triangle 17 → 133 px; the text in Contour mode is **7 lines** instead of 9; **80 text pixels** were measured inside a corner of the circle’s box (an area the box covers but the disc does not) in Contour mode, against **0** in Bounding box mode — the text really flows into the hollows of the shape. Non-regression: the Bounding box line widths are unchanged. Performance: 3 full reflows = **4.2 ms** (warm cache).

## [1.7.539] — 2026-09-24

_The tab-stop ruler only shows when the Tabulation function is switched on, instead of appearing on every text block you edit_

### Fixed
- **The tab-stop ruler appeared above every text block** (user report: « à chaque fois que je mets un bloc texte dans la page de préview, une règle apparait au-dessus du bloc texte. Attention, cette règle ne doit apparaitre que lorsque la fonction « tabulation » de la side barre de gauche est enclenchée »). Measured: `regleEstVisible()` (app/JS/main.js, tab-stop module) returned `true` as soon as the first text block was **in edit mode** — `if (b.isEditing) return true;`, a clause added by v1.7.505 — and creating a block or clicking inside one goes through edit mode. That clause is **removed**: the ruler now has only the two legitimate entry points, (1) the **Tabulation function is switched on** (the « Taquets de tabulation » panel, opened from the left sidebar — `panneauOuvert()`), or (2) the block’s tab stops were enabled **on purpose** (the « Taquets actifs sur le bloc » box of the same panel, carried by `_spTabs.active` and saved with the document). The panel’s help text (`app/index.html`) was rewritten accordingly: it used to state that the ruler shows as soon as the cursor is in a text block. - **Measured after** (bench 8144, real text blocks): block in edit mode with the panel closed → **0 ruler** (was 1); Tabulation function opened → **1 ruler**; panel closed again → **0 ruler**; block merely selected, panel closed → **0 ruler**; block tab stops enabled with the panel closed → **1 ruler** (intended state, kept).

## [1.7.538] — 2026-09-24

_The page-template entry is now part of the right-click menu, with a release/lock toggle, and only appears on pages that have a template_

### Changed
- **The page-template action left its own white pop-in and joined the right-click menu** (user report: « lorsque je fais un clic droit sur une page de préview, il apparait automatiquement une popin blanche sur la popin du clic droit « page 1 - libérer le gabarit de cette page - fermer » … cette popin blanche doit être mise avec les autres fonctions du clic droit »). Measured: a right-click on a page opened **two** menus — `#spGabaritContextMenu` (white box, `z-index: 100000`, added by the v1.7.533 capture listener) and `#spObjectCtxMenu` (the dark object menu) — with the white one painted above the other. The white box and its listener are removed (6.5 kB); the entry is appended to `#spObjectCtxMenu`, at the bottom after « Delete », with a padlock icon. - **The label toggles: « Libérer le gabarit de cette page » ↔ « Verrouiller le gabarit de cette page »** (user report: « lorsque l’on actionne cette fonction, le texte change et dit « verrouiller la gabarit de cette page » »). **Locking is new**: `window.spVerrouillerGabaritPage()` removes the objects tagged `_spGabaritLibere` — the only ones that came from the released template, and only those of the clicked page in spread mode — then `renderAllPages()` feeds the page from the template again. `saveState()` is called, so the removal is persisted (.sp, export, reload) and Ctrl+Z returns to the released page. - **Both actions now appear only on pages that have a template** (user report: « Ces 2 actions ne sont possibles que sur les pages où un gabarit est appliqué »). `window.spEtatGabaritPage(pageIdx)` returns `null` when no template is assigned to the page; the menu entry is then absent. The object menu now also opens on an **empty** page area, but only when a template is applied there (otherwise the browser menu stays available, as before v1.7.533 — the white pop-in was what intercepted it everywhere). - **Measured after** (French labels): page with a template → right-click on an empty area = a single entry « Libérer le gabarit de cette page », no white pop-in; after the action = « Verrouiller le gabarit de cette page »; locking restores the template elements (template items 0 → 2, tagged objects 0 → 2 → 0), and `spEtatGabaritPage(0).libere` goes false → true → false. Page without a template → no menu on an empty area, and the usual object menu (9 entries) **without** the template entry. In spread mode, only the clicked page is affected.

## [1.7.537] — 2026-09-24

_The .json keeps its four per-side margins; the studio returns the text-block frame, the freed-template marker and embedded fonts_

### Fixed
- **The four `.json` margins were lost on import**. Audit of the file round trips (user request: « contrôle le .sp et le .json en import/export et le .sp dans le studio »). Measured: a document set to 12 / 18 / 15 / 25 mm, saved as `.json` and reopened, came back **25 mm on all four sides** — the reader called `spSetMargesMm(null, <scalar>)`, and the scalar `margin` is the MAXIMUM of the four. Both `.json` readers now pass the `margins` object (`_SP_MARGES_JSON_537`): the `#loadProject` handler (Open from computer) and the `#importJsonInput` handler, exactly like `loadProjectSP` already did. Older files without `margins` keep their single-margin fallback (checked: `margin: 14` → 14 mm on all four sides). - **The text-block frame was lost through the studio**. Measured: `_spFrameStroke` / `_spFrameStrokeWidth` had **0 occurrence** in `sp213-studio.html`, so a block with a 2 px red frame came back without it. The app reads the frame only from `_spFrameStroke` (`obj.stroke` stays « no stroke ») and the PDF export does the same (main.js ~L46983): the stroke disappeared from the document **and** from the exported PDF. It is now transported both ways (import → element, return → object), in the same place as the other block settings, together with `_spGabaritLibere` (marker of an element freed from the page template, v1.7.533). - **Embedded fonts were lost through the studio**. `resources.customFonts` was not re-emitted by either studio writer, so a document with an embedded font (base64, v1.7.415) came back without it and the app recomposed the layout in a **fallback font**. The list is now remembered on import and rewritten on export (kept in memory only — a base64 font in `localStorage` would blow the quota). - **Checked as already faithful, no change needed**: `.sp` app → app round trip (colour mode, four margins, column grid, spot inks + plate names, text columns and hyphenation, wrap, text background, insets — only the content height and the hyphen markers are recomputed at load, by design, and the painted result is pixel-identical); studio transport of colour mode, four margins, column grid, spot inks, text columns, hyphenation and language, wrap, text background, insets, tabs and variable font. Measured after the fixes: `.json` 12/18/15/25 → 12/18/15/25; studio round trip → frame `#ff0000` 2 px, template marker, inks, margins, grid and columns all present, embedded font `Audit Police 537` present in the re-exported `.sp`.

## [1.7.536] — 2026-09-23

_The COLORS swatch books use the house scrollbars, and the selected shade is highlighted in light grey instead of black_

### Fixed
- **The swatch books had the browser scrollbar** (user report: « Les ascenseurs (scroll barre) interne au box et de select a swatch book sont vieux, mets nos ascenseurs design de SuperPrint. »). Measured: `.swatch-book-body` had a **15 px native scrollbar** (`scrollbar-width: auto`) while the rest of SuperPrint uses the house scrollbar (6 px). It now uses `::-webkit-scrollbar { width: 6px }` with a transparent track and a `#ccc` thumb (radius 3 px, hover `#aaa`; dark theme `#444` → `#555`), applied to `.swatch-books`, `.swatch-book-list`, `.swatch-book-body` and `#spotColorGroup` — the exact values of `.rightbar` and `.sp-dock-body`. ⚠️ No `scrollbar-width` / `scrollbar-color` is declared: measured, a non-auto value on either property switches Chromium to standard scrollbars and **disables `::-webkit-scrollbar`** (10 px with « thin » instead of 6 px). - **The selected shade was highlighted on a black row** (user report: « à la selection d’une couleur on ne voit plus rien avec le fond noir, met un fond gris light pas noir »). Measured: `.swatch-item.is-active` was `background: #1a1a1a; color: #fff` — a dark swatch circle (12 px) was invisible on it. It is now `background: #e6e6e6; color: #1a1a1a`, and `.swatch-item.is-active .swatch-dot` gets an ink ring (`border-color: #1a1a1a`) so the colour stays readable whatever the shade. Dark theme unchanged (light row `#f2f2f2`, `#121212` text). Measured after: sidebar scrollbar 15 → **6 px**, active row `rgb(230,230,230)` with `rgb(26,26,26)` text and an ink dot ring; detached **Colors widget**: list scrollbar 6 px, book body 6 px, same light grey; clicking a shade still applies it to the block (`#FCEE21` on the test rectangle); dark theme: 6 px and a light active row. `JS/swatchbooks.js` is unchanged in this version (its cache tag stays at the 1.7.534 value).

## [1.7.535] — 2026-09-23

_In CMYK mode, the Fill/Stroke selector now shows the colour of the selected block_

### Fixed
- **In CMYK mode the Fill/Stroke selector kept the previous block colour** (user report: « je mets dans un bloc une couleur ou un ton direct et lorsque je dé-sélectionne mon bloc et que je le re-sélectionne après, la couleur du bloc sélectionné n’apparaît pas dans la partie couleurs de la sidebar de droite. Elle apparaît bien lorsque « activer les couleurs CMYK » n’est pas activé. »). Measured on the test bench with two rectangles (#cc0000 and #0000cc): `#blockFill` correctly received each block colour (which is why the RGB side looked right), but the CMYK **sliders stayed frozen at 0/59/100/0** and the preview swatch stayed `rgb(255,105,0)` for both blocks — only the small inline text under the sliders was correct. Cause: in `window.updateColorInfo()` (CMYK branch) the sliders were only synced when the fill AND the stroke were both defined (`if (!window._blockFillNone && !fillIsGradient && !window._blockStrokeNone) { updateCMYKDisplay(); } else { …text only… }`), so a coloured block **without a stroke** — the common case — fell into the text-only branch and kept the previous block’s colour. Fix (`_SP_CMJN_SEL_535`): `_syncCmykSlidersFromRgb('fill')` and `('stroke')` are now always called in the CMYK branch, so sliders, numeric fields and preview swatch follow the selection exactly like the RGB group; a block with no fill keeps the « Aucun » label and the hatched swatch (same signal as the red-outlined « Sans fond » button on the RGB side). Measured after: #cc0000 → 0/100/100/20 with swatch `rgb(204,0,0)` · #0000cc → 100/100/0/20 · fill #00aa00 + stroke #333333 → 100/0/100/33 and 0/0/0/80 for the stroke · block with no fill → « Aucun » + hatched swatch · spot ink Pantone Yellow C (#FCEE21) → 0/6/87/1 with the plate name « Yellow C ». Also verified with real mouse clicks (click on empty space, then click the block): 0/100/100/20 and `rgb(204,0,0)`. Non-regression checked in RGB mode (`#blockFill` = #0000cc, hex label « #0000CC », CMYK text hidden). The swatch-book module `JS/swatchbooks.js` is unchanged in this version, so its cache tag stays at the 1.7.534 value.

## [1.7.534] — 2026-09-23

_The Pantone swatch book is active: a 50-shade sample covering all 21 Pantone families_

### Added
- **The Pantone swatch book is no longer greyed out** (user report: « partie Pantone > mettre comme les autres couleurs un échantillon d une cinquantaine de couleurs et le rendre actif »). The Pantone row of “Select a swatch book” was hard-coded in `app/index.html` as `div.swatch-book.is-disabled` with a `disabled` header and a “soon” badge — it could not be opened, while the real books (Toyo 46, Focoltone 48, HKS 54, RAL 191, NCS 55, DIC 49) were built by `JS/swatchbooks.js` from its `BOOKS` table. The Pantone book is now a normal `BOOKS` entry flagged `depuisSelect: true`: the module reads the Pantone `<optgroup>`s already present in the hidden `#spotColorSelect` (21 families, 246 shades — the source of truth for spot inks, detection and export) and samples **50 shades in round-robin across the families**, so the preview covers every family. Nothing is copied and nothing is added to the selector for this book: **the catalogue stays at 246 Pantone shades** (689 options in total, measured — no duplicate), so plate names, spot detection, CMYK + Pantone export and the .sp round-trip are unchanged. Measured: the row shows 50 swatches over 21 family headings, opens like the others (`is-open`, no `is-disabled`, no `disabled`), and clicking « Pantone Yellow C » (#FCEE21) turns a selected rectangle from #CCCCCC to #FCEE21 with `_spSpotInk = #FCEE21` and `_spSpotInkName = PANTONE YELLOW C` (the catalogue plate name). The row keeps stable ids (`spSwBook_pantone`, `spSwHead_pantone`, `spSwItem_pantone_n`) so it also works inside the detached widget. The hard-coded disabled block was removed from `app/index.html`, and the module version string in `JS/swatchbooks.js` goes from 1.7.525 to 1.7.534.

## [1.7.533] — 2026-09-23

_A right-click on a page releases its master page; the items become normal, editable objects of that page_

### Added
- **Release the master page of a page (right-click)** (user report: « il faudrait pouvoir libérer les éléments du gabarit ... permettre au clic droit sur la page de preview de libérer le gabarit »). Master items were created on the page by `addSpecialTextObjectsToCanvas()` with `selectable/evented = false` and the `_isMasterItem` / `_isMasterRuntime` / `_masterPageId` flags (measured: text, line and rect of the master all locked), and there was no context menu on a page at all (only crop and mask had one). The right-click menu now shows the page, the master name and the number of items, then **releases** them: `selectable/evented = true`, `excludeFromExport = false`, master flags removed, `_spGabaritLibere` mark set (added to `SP_CUSTOM_PROPS`, so it is serialized). Measured: text and rectangle become selectable, the released rectangle moves with the mouse (59,59 → 98,88), and the toast reports « Gabarit libéré : 2 élément(s) modifiable(s) sur cette page ».
- **Master guides stay guides** (`_isMasterGuide` items are never released, and keep their own behaviour) and a released page is no longer fed by the master: the same guard was added to the display path (`addSpecialTextObjectsToCanvas`) and to the export path (`injectMasterItemsForExport`, used by every PDF route) — measured after a full re-render: 6 objects (released text, guide, released rectangle, 3 page guides), **no duplicates**; without the export guard the PDF would have painted the master background and texts twice.
- **Persistence and undo**: the release is saved with the document (the page carries the mark of its released items, so a `.sp` round-trip, a reload and the export all keep it). `spLibererGabaritPage()` records a state just before and just after the change, so Ctrl+Z always comes back to the master-fed page. Non-regression measured on a fresh document for a page that is NOT released: master text, rectangle and guide are still created.
- Public hook: `window.spLibererGabaritPage(canvas, pointer)` and `window.spPageGabaritLibere(pageIndex)` (used by the two injection guards).

## [1.7.532] — 2026-09-23

_The columns of a text block stay on screen while you edit it; caret, selection and clicks follow the column flow_

### Fixed
- **Editing a multi-column text block made the columns disappear and the text fall back to its initial shape** (user report: « lorsque je souhaite corriger le texte d un bloc texte qui a été mis en forme avec texte frame options en 2 columns, les colonnes disparaissent et le texte reprend sa forme initiale ... les colonnes ne sont plus visibles »). Measured before (320 × 200 px block, two 148 px columns, 12 px gutter): outside editing the line wrap was 148 px / 61 lines laid out in columns; entering edit mode the wrap went back to **320 px** (the block width) and to 28 lines, and `spColGeom()` returned null — three `!isEditing` guards (`spColsActives`, `_renderChar`, `_getLineLeftOffset`) switched the whole column engine off during typing. Those guards are removed: wrap, line placement, capacity and mask now follow the columns while editing. Measured after: same values as at rest (148 px, 61 lines, 2 columns) with ink in **both** columns (6 229 px / 6 133 px on the canvas); a real double-click inside the text keeps the columns and puts the caret on the right line of the right column.
- **The caret, the selection highlight and every mouse gesture were computed on a single-column flow**: `_getCursorBoundariesOffsets()` (caret + highlight) accumulated single-column line heights, and `getSelectionStartFromPointer()` — the only entry point for click, drag, double-click and triple-click in fabric 5.1.0 — looked the line up the same way. Both are now hooked (only while editing a block with columns): the first adds the vertical offset of the caret line column, the second inverts the column layout (column from x, line from y **inside** that column, then the character index with the line own column offset). Measured: a real click in column 2 (3rd line, 4th character) gives index **172**, the exact expected value (0 characters off); a drag from the 3rd to the 6th line of column 2 gives [170, 218] against an expected [170, 219]; typing one character keeps 61 lines and the 148 px wrap.
- **The selection highlight overflowed the column**: `renderSelection()` drew each line at `t.top + t.topOffset` (cumulative single-column heights) and stretched justified wrapped lines to `this.width` — the **block** width. For columns it is replaced by a line-by-line version (fabric 5.1.0 algorithm reproduced: composition mode, justification, hyphenation, RTL) using the column own ordinate and the column width. Measured: highlight x 166 → 300 inside a column spanning 166 → 314, y 27 → 189 over the selected lines.
- **Fallbacks**: the two new hooks only run while editing a block with `_spCols > 1`; RTL text, a point outside the frame, an empty column or any exception falls back to Fabric — so a block without columns, and everything outside edit mode, is untouched (measured: single-column block click, drag and highlight unchanged).

## [1.7.531] — 2026-09-23

_The tab-stop ruler stays draggable at any zoom; clicking it can no longer deselect the text block_

### Fixed
- **The tab-stop ruler became ungrabbable above 100 % and every click on it deselected the text block** (user report: “on ne peux plus bouger les taquets de tabulations dans la règle au dessus du bloc avec la souris. Le bloc texte se dé-sélectionne à chaque clic”). Measured cause: `taquetSousLeCurseur()` and `bandeSousLeCurseur()` returned immediately whenever the ruler state was incomplete (`_regle` / `_regleGeom` missing), so `debutGlisser()` let the event through without `preventDefault()`; Fabric then received a press on empty space and cleared the block selection — and the disabled ruler disappeared. Reproduced in the lab (ruler reference invalidated: hover cursor « default », press deselects). The band geometry is now recalculated from the **block** (`geomBandeDepuisBloc`), the ruler remembers its block (`_spOwner`), the ruler is **repaired** before a press, and any press inside the **ruler band zone** is consumed (`preventDefault` + `stopPropagation`) even when no stop is hit: a click on the ruler can no longer deselect the block.
- **The grab tolerance did not follow the zoom**: the zoom of SuperPrint is a CSS `transform: scale()`, so `canvas.getZoom()` (`viewportTransform[0]`) always returns 1 (measured at 100 %, 110 % and 120 %), while `REGLE_TOL` is documented “in screen pixels”. `applyZoom()` now publishes the real zoom (`window.spZoomActuel`) and the ruler reads it, so the grab zone keeps a constant screen size at any zoom. Measured: 120 % → a 40 px screen drag moves the stop 32.9 document px (expected 33.3); 200 % → grabbing 6 screen px away still works; 100 % → 40 px screen = 40 px document (unchanged).
- **A stop drag could stay stuck**, making every stop ungrabbable (`taquetSousLeCurseur()` exits while `_glisser` is set): the drag used to end only on a window `mouseup`. It is now also settled when the window loses focus, when the pointer leaves it, or when the zoom changes (`window.spTabEnGlisser` / `spTabAnnulerGlisser`). The ruler is refreshed right after a zoom change (`_updateCanvasDPRForZoom`).
- **Diagnostics**: `window.spTabDiag()` returns the ruler state on one line (ruler, geometry, marks, blocks, owner, selection, real zoom, `getZoom()`, current drag); a band press that grabs nothing logs it to the console and the status bar.
- Non-regressions measured: clicking the band still creates a stop (2 stops / 2 marks, block still selected), 100 % dragging unchanged, and the whole flow with the « Taquets de tabulation » widget open at 120 % (stop placed then dragged to 26 mm — panel reports “appliqué”).

## [1.7.530] — 2026-09-23

_Fond and Contour paint the text block frame; the text is only coloured when characters are selected with the mouse_

### Fixed
- **A colour applied to a selected text block coloured the text instead of the block** — `applyColors()` did `obj.set({ fill })`, i.e. it set the object fill = the glyph colour, and `backgroundColor` (the frame background) stayed empty. For a text block, Fond now paints the **frame background** (`backgroundColor`) and Contour its **frame outline** (`_spFrameStroke` / `_spFrameStrokeWidth`, new properties added to `SP_CUSTOM_PROPS`), so the glyphs are untouched. Measured: fill `#00cc00` → 19 247 green pixels on screen, stroke `#0000ff` 8 px → 2 084 blue pixels, text still black (4 236 px).
- **The text is now coloured only for a character selection**: with `obj.isEditing` and `selectionStart < selectionEnd`, Fond/Contour go through `setSelectionStyles()` on that range only. Measured on the first 3 characters: styles 0/1/2 set to `#ff00ff`, character 3 and the whole block unchanged (background, stroke and text colour identical before/after).
- **The right-hand panel follows the new rule**: for a text block the Fond/Contour row shows (and drives) the **frame** colours, and the stroke-width field shows the frame stroke width. The text colour keeps its own control (typography panel + character selection).
- **Swatch books** (Pantone, RAL, HKS, imported `.ase`) follow the same rule through the swatch `change` handler: applied to a text block the ink paints the frame, and the ink scan now also looks at `backgroundColor` so the plate is still declared (export modal stays in CMYK/RGB + spot mode).
### Fixed (export)
- **The frame background was not exported at all by the default engine**: with “Format fini” checked the export uses the **native pdf-lib path** (`[confirmExport] ➜ Chemin NATIF pdf-lib`), which drew neither the frame background nor any frame outline — 0 background pixels measured in the exported PDF, while the preview showed it and the crop-marks path (jsPDF, `_SP_FOND_520`) painted it. The frame (background via `drawSvgPath` on the 4 corners through `localToPagePt`, so rotation/scale/origin are honoured, then the outline via `borderColor`) is now drawn before the glyphs. Measured: default export 69 724 background px / 29 463 outline px / 2 189 px for the 3 coloured characters; crop-marks export 77 363 / 7 678.
- **Spot inks on a frame no longer contaminate the text**: the spot path used to open a `/SPOT<n>` marked block around the **whole object**, and the colour interception replaces every fill operator inside it — a black title on a Pantone band would have been printed entirely in the ink colour. When the ink sits on the frame background (and the glyph colour differs), the object is no longer marked: the frame path opens **its own** marker instead. Verified on the PDF operator list: the `/SPOT0` block wraps the frame fill (1 fill inside), the text is drawn **outside** the marker, and the glyphs stay black (5 789 px measured).
- On-screen outline: `_spFrameStroke` is stroked around the frame in the object’s local space (patch of `_render` for `Text`/`IText`/`Textbox`), with the width divided by the current scale so an outline does not grow when the block is resized.
- Other objects (rectangles, images) keep their historical behaviour, and a `.sp` round-trip keeps `backgroundColor`, `_spFrameStroke` and `_spFrameStrokeWidth`.
## [1.7.529] — 2026-09-22

_The remove cross of an imported swatch book now sits just left of its shade count_

### Fixed
- **The ✕ that removes an imported `.ase` swatch book was badly placed** — too far right, and it slipped **under** the shade count. Cause: the cross was **absolutely positioned** in the row header (`position: absolute; right: 5px; top: 4px`) while the shade count is a row item aligned to the right by `margin-left: auto` — both occupied the same corner. The cross is a row item again, inserted **before** the counter, with the cross taking the `margin-left: auto` (a `has-remove` class on the header keeps the rule away from rows that have no cross): result **`[chevron] Name … [✕] [3]`**. Measured on an imported book (“Client”): in the detached widget the cross is at **x = 1004** (18 × 18 px) and the number at **x = 1028** — left of it, on the same line (centres within 3 px, 6 px gap); in the right-hand bar, cross x = 1341 / number x = 1365, same alignment. Built-in books keep their number alone on the right.
- Verified in the **detached widget** too: its cross relays to the original panel (like the shades since 1.7.528), removing a book there really removes it and the copy rebuilds at once (11 → 10 rows); clicking the cross does not open the accordion.
## [1.7.528] — 2026-09-22

_The detachable Colours widget is wider, and the swatch books work inside it_

### Fixed
- **The swatch books did nothing inside the detached Colours widget.** A widget is a **copy** of the panel and the dock only relays clicks on controls it can recognise (it swaps `id` for `data-sp-ref`). The generated swatch elements had no id at all — measured **457 shades with no reference**, plus 12 book headers — so a click on a shade, a header or the ✕ inside the widget was relayed to nothing, while the right-hand bar kept its own listeners (hence “OK in the sidebar”). Now every book row, header, shade and ✕ carries a stable id (`spSwBook_…`, `spSwHead_…`, `spSwItem_…_<n>`, `spSwRm_…`), so the widget relays the click to the original control and the full path runs: fill or stroke, CMYK slider sync, `_spSpotInk` tagging, undo history. Measured inside the widget: opening a book opens its accordion (126 px body), picking **HKS 45 K** sets `#4CA82F` on the object, tags the spot ink, lights the swatch up and updates the Fill field **on both sides**.
- **The widget could not show a book as open, nor the chosen shade.** The dock mirrors state classes only on referenced elements; the `is-open` class lives on the book row (which had no id) and `is-active` on the shade. Both are now mirrored, along with `is-disabled` (the greyed Pantone row), so the widget follows: open book, chosen shade, greyed row.
- **A colour chosen in the widget could be overwritten.** The widget resyncs with the right-hand bar every 450 ms; while a native colour picker is open the field is no longer `document.activeElement`, so the resync wrote the old value back and the choice was lost (“cannot validate the colour”). A field with a recent interaction (pointer down or typing) is now left alone for **4 seconds**.
- **The CMYK switch did not change the widget.** `rgbPickersGroup` / `cmykSlidersGroup` swap their `display` in the panel; that visibility is now mirrored too — measured: RGB `flex → none`, CMYK `none → block`, both ways.

### Changed
- **The Colours widget is now the widest template** (`sp-dock-xl`, like the “Animated background” widget): **470 px**, minimum 380, maximum 540, instead of 400. Measured after the change: 469 px body, nothing cut on the right, and **nothing left to scroll** (content 521 px for 521 px visible). At the historical 200 px widget width the Fill colour field was only **11 px** wide.
- **Inside a widget the swatch list is capped at 230 px and scrolls on its own**, so “Import a swatch book” stays reachable; the right-hand bar keeps showing every book at once (no cap there).

### Added
- **`spDockWidgets.rafraichir(nom)`**: an open widget can rebuild its copy. The Colours widget calls it when a swatch book is imported or removed, so the new book appears in the widget immediately (measured: 13 → 12 books after removing one).
## [1.7.527] — 2026-09-22

_An ink imported as .ase (or taken from any swatch book) gets its own, correctly named plate in the PDF export_

### Verified
- **It already worked like Pantone for the plate count.** One-page document, four blocks painted from the swatch panels, spot-colour export, analysed with pdf-lib (the dictionaries live in compressed object streams, so searching the raw bytes finds nothing): the PDF holds **four `/Separation` colour spaces** — one per ink — and the export banner reads “8 color channels — CMYK (4) + 4 spot ink(s)”. Two of those plates came from an **imported `.ase`** file, so an imported colour does produce its own plate alongside the RGB or CMYK layer.

### Fixed
- **Accents were dropped from plate names.** `_spSpotChannelName()` strips everything outside `A-Z0-9` after upper-casing, so “Écarlate maison” came out as **“CARLATE MAISON”** and “Küsten Grün” as “K STEN GR N” — the accented letter was **lost**, not folded. Diacritics (NFD) and common ligatures are now folded first: `É→E`, `ü→u`, `ß→SS`, `Ø→O`, `Œ→OE`, `Đ→D`, `Ł→L`… Measured after the fix: `/ECARLATE MAISON`, `/KUSTEN GRUN`.
- **A plate could carry another book’s name.** The spot catalogue is keyed by hex code and holds **33 duplicate codes**, 20 of them between our own books (magenta `#D6006E` exists in Toyo, Focoltone, HKS and DIC). Two causes, both fixed: (1) the swatch panel wrote `sel.value = hex`, so the browser fell back to the *first* option carrying that code and the object was tagged with the wrong book’s label — a swatch now selects **the exact option you clicked** (same code **and** same name) by index; (2) the export scan could only name the catalogue’s first entry for an ambiguous code — it now prefers the **object’s own ink name** whenever the code is ambiguous. Measured: clicking “Focoltone 1018 — Magenta” used to produce a `/TOYO 019` plate, it now produces `/FOCOLTONE 1018`.
- **The ink name is now serialized with the object** (`_spSpotInkName` / `_spSpotStrokeInkName` added to `SP_CUSTOM_PROPS`), so a reopened `.sp`, a `.json` or a browser autosave keeps the plate name instead of falling back to another book sharing the code. When no usable name is left, the fallback was “PANTONE 123456” — it is now **“SPOT 123456”**, which does not claim a Pantone for a client swatch book.

### Changed
- **The export box now says “spot inks” instead of “Pantone”**, in French, English and Japanese, because an ink can come from Toyo, Focoltone, HKS, RAL, NCS, DIC or an imported `.ase`: `CMJN + tons directs` / `CMYK + spot inks`, `Document avec tons directs` / `Document contains spot colours`, and the channel summary `… + 3 tons directs` / `… + 3 spot ink(s)`, plus the loader title, the end-of-export message and the console log. The quadri-layer mode, the plate count and the technique (`/Separation` spaces compliant with ISO 32000-2) are unchanged.

### Notes
- Test method worth reusing: export through `window.confirmExport()` with `URL.createObjectURL` intercepted, POST the bytes to the test server, then read the `/Separation` spaces back with **pdf-lib** (`page.node.Resources()` → `ColorSpace` → resolve the value **twice**, a `PDFRef` may hide a `PDFRef`). A plain text search for “Separation” in the bytes returns 0 and proves nothing.
## [1.7.526] — 2026-09-22

_Colours panel: Fill / Stroke and the colour line move above the swatch books_

### Changed
- **In the right-hand Colours panel, the Fill / Stroke module now comes first**, right under the CMYK switch, as asked (“mets le FILL et STROKE + la phrase qui dit la couleur par-dessus les nouveaux outils pour les teintes… FILL et STROKE module trop bas”). The swatch books — and their Fill / Stroke target buttons — come after it. Measured with the panel open (1400 × 900, 273 px column): `#rgbPickersGroup` y **616 → 355**, and the colour line (hex or CMYK value plus the spot-ink name) y **672 → 411**, i.e. **261 px higher**. It is a pure DOM reorder — the block was extracted by anchors and re-inserted as-is, so **no id changed and no code line was touched**: Fill / Stroke, the pipettes, the “no fill / no stroke” buttons, the CMYK sliders, the value line and the spot-ink badge behave exactly as before.
- **The swatch-book list is no longer cramped.** The 120 px cap (150 px with a book open) and the `has-open` class behind it were introduced in 1.7.525 *only* to keep Fill / Stroke visible below the list; with the module now above, that workaround is gone. The seven rows — the six books plus the greyed Pantone row — show in one go (measured list height **162 px**, no scrollbar of its own), followed by “Import a swatch book”; only the shade list of an opened book scrolls, inside its own row (126 px).

### Notes
- Untouched: the ink application path (shade → hidden `#spotColorSelect` → the original `main.js` handler), the spot catalogue, the export layers, the .ase import, the French / English / Japanese strings and the service-worker precache. `JS/swatchbooks.js` gets its own cache tag bumped (`JS/swatchbooks.js?v=…`) alongside `main.js` and `main.css`.
## [1.7.525] — 2026-09-22

_Swatch books in the right column: Toyo Color Finder, Focoltone, HKS, RAL, NCS and DIC in an accordion, plus your own .ase import_

### Added
- **The colour list is now a list of swatch books.** “Sélectionner un nuancier” / “Select a swatch book” replaces “Sélectionner un Pantone”. Each book — **Toyo Color Finder** (46 shades), **Focoltone** (48), **HKS** (54), **RAL** (191), **NCS** (55), **DIC** (49) — opens as an accordion: click the row to open it, click again to close, and several books can stay open at once. Every shade is a row with **its colour dot and its name** (“RAL 3020 — Rouge signalisation”), the families are captioned inside the book (Yellows, Oranges, Reds & pinks, Purples, Blues, Greens, Browns, Greys…), each shade list scrolls on its own past 126 px, and the row shows the shade count. Clicking a shade applies the ink exactly like the old list did: same **Fill / Stroke** target, same spot-ink badge under the pickers, same CMYK sliders, same spot layer in the PDF export. Measured: picking RAL 3020 sets `fill = #CC0605`, tags `_spSpotInk = #CC0605` with the channel name `RAL 3020`; with the Stroke target, `#D0021B` gives `_spSpotStrokeInk` and the channel name `HKS 14 K`.
- **Import your own .ase swatch books.** A new “Importer un nuancier” / “Import a swatch book” row opens the file picker; the chosen **Adobe Swatch Exchange** (.ase) file is parsed locally — RGB, CMYK, Lab and Grey entries, groups and names kept — and joins the list **under the file name**, its shades inside. Imported books are remembered in the browser and come back on the next visit, and each one has a ✕ on its row to remove it (list, catalogue and storage are cleaned together). Tested with a generated .ase holding one colour of each model: `RGB(1,0,0) → #FF0000`, `CMYK(1,0,0,0) → #00FFFF`, `Lab(87.74,−86.18,83.18) → #00FF00`, `Gray 0.5 → #808080`. Nothing is uploaded: the file never leaves the browser.

### Changed
- **Pantone is parked for now**, as requested: its row stays at the bottom of the list, **greyed out with a “soon” badge and not openable**. The palette itself is untouched.
- **The catalogue keeps a single source of truth.** `#spotColorSelect` is still there (hidden) and `JS/swatchbooks.js` only *appends* one `<optgroup>` per book to it: `_spSpotBuildCatalog()`, `_spSpotScanDocument()` and the spot-layer export read the same options as before. Measured: the select goes from 246 to 689 `<option>`s, with the 21 original Pantone groups **unchanged and in the same order**, so existing documents keep recognising, naming and exporting their spot colours identically.
- **No application logic was duplicated.** Picking a shade writes the value into that select and dispatches a real `change` event: the original handler in `main.js` still does the work (fill or stroke, CMYK slider sync, `_spSpotInk` tagging, undo history) and still resets the select afterwards.
- **The swatch area stays compact**, so FILL / STROKE and the ink name stay within reach: the list of books is capped at **120 px** and scrolls in place (it grows to **150 px** while a book is open, the exact height of a 24 px header plus its 126 px shade list), book headers are 24 px tall, the import row is 24 px and the sRGB note fits on one line. Measured: FILL / STROKE moves up ~100 px (from y≈704 to y≈604 on a 1400×900 window, RGB mode, everything folded).
- **Spot Colours wording**: the panel label drops “Pantone” (now “Tons directs” / “Spot colours” / “スポットカラー”) and all four new strings (title, import row, “soon” badge, note) exist in French, English and Japanese.

### Notes
- The books shipped with the app are **screen-preview sRGB references**, not the manufacturers’ official libraries — this is stated under the list (“Valeurs sRGB d’aperçu — pour les valeurs exactes, importez un fichier .ase.”). No commercial library was copied into the app; importing a manufacturer’s .ase is the way to work from its exact values.
- `JS/swatchbooks.js` is precached by the service worker (`app/service-worker.js`), so the swatch books work offline too.
## [1.7.524] — 2026-09-21

_Mobile top bar: the burger menu closes with a cross, and Undo / Redo sit facing it_

### Fixed
- **On a phone the burger menu could be opened but never closed.** Measured at 390 × 844 with the 1.7.523 build: `#burgerMenu` sits in the top bar (rect `284,14,28,28`, `z-index: 6`) while the open menu has been a **full-screen layer** since 1.7.472 — `top:0;bottom:0;left:0;right:0; z-index:9999`, introduced so the tool list could scroll. The layer therefore covered the top bar: the second tap landed on the layer and never reached the burger, and the only way out was to trigger one of the menu items. The layer now stops **under the bar** (`top:56px`, measured rect `0,56,390,788`): the bar stays visible, the burger stays exactly where it is and turns into a ×, and the point under the finger at the burger’s place is the button again (tap 1 = open ≡, tap 2 = close ×). The cross is also drawn explicitly (22 × 2 px bars rotated ±45°) and the active burger is raised above the layer (`z-index:10000`) so it stays clickable even if the menu were to go full screen again. The full-height scrolling list and its bottom safety margin from 1.7.472 are kept.

### Added
- **Undo / Redo shortcuts in the mobile top bar, facing the burger.** Two ↩ ↪ buttons (`.mobile-quick-actions`, left of the burger, same height — measured `70,14,62,28`) relay the click to the desktop `#undo` / `#redo`: same `undo()` / `redo()` functions and the same history stack, nothing duplicated (verified: exactly one click received by the desktop button). They grey out like their desktop counterparts when the stack is empty (mirrored through a `MutationObserver` on the `disabled` attribute). They are hidden on desktop (measured `display: none` at 1280 × 800 — the centred bar keeps its own ↩ ↪) and they disappear as soon as the menu is open, so only the cross remains: that state is carried by the `sp-mobile-menu-open` class on `<body>`, kept in sync by a `MutationObserver` on `#mobileMenu`, which also covers the closure triggered by the mobile widget sheets (`mobile-widgets.js`). Bonus: the burger now follows the real menu state instead of remaining as a cross after such a programmatic closure.
## [1.7.523] — 2026-09-21

_Page numbering on double pages, and a master page can carry the numbering_

### Fixed
- **In double-page mode, page numbers were missing on every spread.** They only appeared on the single pages (the first one and, when the page count is even, the last one). Measured on a 6-page document in spread mode: folio “1” on the lone page, **nothing** on spreads 2/3 and 4/5, folio “6” on the last page. Cause: `loadSpreadContent()` has two branches — when the spread holds **no object at all**, the “empty pages” branch never called `addSpecialTextObjectsToCanvas()`, so neither the master items nor the folio were injected. `createPageCanvas()` had received that fix back in 2026-05-06 (“create master textboxes + folios even on an empty canvas”); the double-page version never did. Fixed: an empty spread is now handled exactly like an empty single page (guarded by `_spRenderEpoch`, 50 ms — same as `createPageCanvas`). After: folios “1” · “2 + 3” · “4 + 5” · “6” on screen, and folios 1 to 6 in the exported PDF (verified page by page with pdf.js). The same omission also made **master items** invisible on an empty spread — also fixed (measured: 2 master texts, one per page).

### Added
- **A master page can now carry the page numbering.** A “🔢 Numbering” checkbox was added to the master page editor (open a master from the flatplan). Ticked, the folio is drawn on **every page using that master** even when the global “Enable numbering” switch is off — and it is not drawn on pages using other masters. The folio **style** (position, font, size, colour, prefix/suffix, side/bottom margins) still comes from the “Page numbering” panel: the master only decides whether the number appears. A live preview of the folio is drawn inside the master editor (it is flagged `_spMasterFolioPreview` + `excludeFromExport`, so it is never saved into the master). The setting is stored as `masterPages[id].numbering`, saved with the master and carried by the `.sp` file (`masters.templates`) — verified by a save/load round-trip. It is only committed by “💾 Save master”, so “Cancel” leaves the master untouched. Both rules (display and PDF export) go through one helper, `spPageNumberingActive(pageIndex)`, so screen and print can no longer diverge.
## [1.7.522] — 2026-09-21

_Justified text stays justified when a block overflows its frame_

### Fixed
- **The last visible line of a justified text block that overflows its frame was exported ragged.** Both export engines decided “end of paragraph” from the last **rendered** line (`if (_li >= maxLines - 1) return true;`), where `maxLines` is the number of lines the frame can show. When the text holds more lines than the frame displays, that last rendered line is a *wrap* line in the middle of the paragraph: the preview stretches it to the edge of the block (`enlargeSpaces` iterates over all `_textLines`) while the export left it “fer à gauche”. Measured on a recipe document (260 px block, Open Sans 11 pt, 8 lines of text in a 3-line frame, `_fixedHeight`), all three modes: the first two visible lines reached the edge (260 px) but the third one stopped at **250 px** (HD 300 dpi with crop marks), **251 px** (bleed without crop marks) and **251 px** (CMYK Finished format) — i.e. 9–10 pt ≈ **3.2 mm short**, plainly visible in the PDF. Fixed in `_spIsParaLastLine` (native pdf-lib path) and `_spJIsParaLastLine` (hybrid jsPDF path): the test is now `_li >= lines.length - 1`, i.e. the last line of the *text* (plus, unchanged, the lines closed by a hard `\n`), exactly like the preview. Blocks that fully fit in their frame keep the previous behaviour bit for bit (verified: 260 px at the edge, 256 px + hyphen on hyphenated lines, 173/214/142 px on paragraph ends).
- This release also carries the 1.7.521 (the title's real font embedded in the crop-marks overlay, hyphenation no longer forced), 1.7.520 (text block backgrounds exported, last line preserved) and 1.7.519 (vector typography honoured with crop marks) fixes.

### Verified
- Recipe bench, three exports of the same document (`522_crop`, `522_natbleed`, `522_natif`): every non-final line of the overflowing blocks now reaches the column edge, in both engines; paragraph ends and hyphen-reserved lines are unchanged.
## [1.7.521] — 2026-09-21

_Titles keep their font and their line breaks in the PDF export with crop marks_

### Fixed
- **A text block rendered by the “Finished format” vector engine was written in Helvetica instead of its own font.** The overlay document built for blocks the hybrid engine cannot vectorise (per-character styles, variable font, …) created a `PDFDocument` **without registering fontkit**, so `embedFont()` failed for every TTF (“no fontkit instance was found”, 14 times on the reported document); the native renderer then fell back to its `helvetica` default. Measured on `Maquette SP213.sp` (281 × 215 mm, 3 mm bleed, HD 300 dpi + CMYK + crop marks): the 45.33 pt Bebas Neue title came out with **26–43 pt advances instead of 16–18** (“L” x=498, “’” x=524, “U” x=534, “S” x=566 …) → the title overflowed its block and the page and was cut off. Fixed by registering fontkit on the overlay document (as `_spEmbedTextsWithPdfLib` already did) and by **refusing the overlay** — i.e. keeping the faithful raster rendering — when fontkit is unavailable or when the block's font could not be embedded: a substitute font is never used. After: advances 16–19 pt, i.e. **identical to the bleed-without-crop-marks export** (constant 28.3 pt offset = the 10 mm crop-mark margin, verified).
- **Hyphenation was forced on every text block in the crop-marks export.** The “hyphenate on export” option (ticked by default) set `enableHyphenation = true` on all textboxes, which **recomputed the line breaks** and overwrote the preview's ones. The native path only forces it when the block was never configured (`enableHyphenation === undefined`, the v1.7.380 fix); the hybrid path now applies the same guard. Measured: the title came out as “L'USAGE DES MON- / DES RETROUVÉS” instead of “L'USAGE DES / MONDES RETROUVÉS”. After: both exports contain the **same 933 characters** at the same positions.
- This release also carries the 1.7.519 (vector typography honoured with crop marks: mixed per-character styles and variable fonts) and 1.7.520 (text block and line backgrounds exported; last line preserved) fixes — a single package.

## [1.7.520] — 2026-09-20

_Text block backgrounds are exported — a title is no longer invisible in the crop-marks PDF_

### Fixed
- **A text block background was never written in the crop-marks PDF export, making white titles invisible.** The hybrid jsPDF engine (used as soon as crop marks or colour bars are requested) drew the glyphs only: `textBackgroundColor` (the band behind the lines) and `backgroundColor` (the block frame) were skipped, while the preview shows them and the native pdf-lib engine (“Finished format”, bleed without crop marks) keeps them because it rasterises those blocks. A **white** title on a dark band therefore came out **white on white** — nothing visible on the page. The engine now draws both surfaces where the preview draws them, with the same geometry as Fabric (`Text._renderTextLinesBackground`: one band per line, from the first to the last drawn character, height `fontSize × _fontSizeMult` at the top of the line box; frame background = `width × height`), as a filled quad so rotation, scale and origin follow the block.
- **The last line of a text block could be dropped in the crop-marks export.** Line clipping used its own strict test (sum of full line heights versus frame + 0.5 px); Fabric's constant bottom-leading deficit means the last line never “fitted”, so it was lost. Measured: 3-line block, 48.77 px frame, 17.04 px line height → 2 lines written instead of 3. The path now calls the same shared helper as the native renderer (`window.spCountVisibleLines(obj, frameHeight, true)`). Measured on the editorial CV template: **910 → 968 characters** exported (native: 969 — the remaining character is the soft hyphen, deliberately kept out of the selectable text and still visible in the ink).
- **No other change.** Control document (no block background, no clipped line): vector-operator counts identical (9 `Tj` / 1 image), byte-identical positions, sizes within 2 bytes; the two previously fixed cases (mixed per-character styles, variable fonts) still emit 59 and 17 text operators with a single raster image.

## [1.7.519] — 2026-09-20

_Vector typography is honoured again in the PDF export with crop marks_

### Fixed
- **Text blocks are no longer rasterised in the crop-marks export when “vector typography” is ticked.** The hybrid PDF engine (used as soon as crop marks or colour bars are requested) drives text through OpenType.js and refused two families of blocks, rasterising them on the spot: blocks where **only some characters** carry a distinct style (one word in bold / another size / another colour — the app writes those as per-character styles) and blocks set in a **variable font** whose axis was adjusted (`spVarFont`; the real instance cannot be reproduced by OpenType.js). The same document exported through “Finished format” (native pdf-lib engine) kept its text vector, hence the inconsistency reported. Measured on the recipe document (HD 300 dpi + CMYK + crop marks + 3 mm bleed): 8 text-showing operators before — the block was an image on top of the photo — **59 after** for the mixed-style block (per-character styles preserved) and **17 after** for the variable-font block, with a single raster image left instead of two.
- **How it is fixed.** When the hybrid engine cannot vectorise a text block, the block is no longer rasterised: it is rendered by the **native pdf-lib engine** (the one behind “Finished format”: embedded font, per-character styles, variable-font instance applied through `_spVarPdfPose`) into a transparent overlay page of exactly the same size as the jsPDF page, then merged on top with `drawPage()` and the crop-mark margin offset. Raster fallback is kept whenever the native engine would itself rasterise or substitute a font: text with a stroke, shadow, block background, skew/mirror, complex clip or gradient/pattern fill, and unresolvable fonts — measured byte-for-byte identical output for those (stroked-text recipe: 848 966 bytes before and after).
- **No other change.** Control document (no mixed styles, no variable font): pixel difference with 1.7.518 is **0.000**; blocks now vectorised keep the very same ink position (bounding boxes identical to the pixel, mean pixel difference 0.06 / 255 for the variable-font block, 1.27 / 255 for the mixed-style block whose synthetic bold differs slightly from the browser preview).

## [1.7.518] — 2026-09-20

_Thin rules (lines) were shifted in the PDF export with crop marks_

### Fixed
- **Lines are no longer shifted in the PDF export.** In the HD 300 dpi + CMYK + crop marks + bleed path, the line branch of the vector renderer treated `left`/`top` as the **centre** of the line, while Fabric.js stores there the **top-left corner of its bounding box** (`calcLinePoints()` returns the end points *relative to the centre*, and `calcTransformMatrix()` maps `(0,0)` to `getCenterPoint()`, not to `left`/`top`). Every rule drawn with the line tool was therefore displaced by exactly **half its length**. Measured on the recipe document (A4 + 3 mm bleed, crop-mark margin 10 mm): a 380 px horizontal rule (100 → 480 px) was written at **−21.75 mm** instead of **45.278 mm** (67.03 mm off) and a 600 px vertical rule at **−60.556 mm** instead of **45.278 mm** (105.83 mm off); on the rendered PDF the white rule could be found at x = 20–110 mm and was absent from its true span, 45–179 mm. Fixed by applying **exactly the same transformation the native pdf-lib path already used** (middle-of-segment subtraction + `calcTransformMatrix()`), which is why the “Finished format” export was already correct. After: both rules are written at **45.278 mm**; on the rendered PDF the white rule runs from **45 to 179 mm** and the yellow one from **45 to 257 mm**. Nothing else changes: the same recipe in CMYK without vector typography (single full-page raster) and the bleed/background/photo/text placements are byte-identical in position.

## [1.7.517] — 2026-09-20

_Widget “Fonds”: buttons show their state · PDF export: no more white blocks with crop marks_

### Fixed
- **The detached widget mirrors the state of its controls.** A widget is a clone of the sidebar controls; the application set its states (`active` on the chosen effect button, the `Geler/Reprendre` label, the slider read-outs) on the **originals only**, while the widget bridge relayed clicks and values but never the state. Measured before the fix: clicking “Fluide” changed the effect (origin fine) yet the widget kept **DOT** lit. Added `refletEtat()`: the widget now follows the `active` class, the disabled state and any label flagged `data-sp-miroir-texte` (`#rbFreeze` and the four slider read-outs); it runs from the 450 ms watchdog, right after a relayed click and after every slider change. After: DOT → Fluide → Organic, 72 → 150 → 300 → 600, “⏸ Geler” → “▶ Reprendre” and `1.00` → `0.40` all follow the widget.
- **No more opaque white blocks in CMYK PDF exports with crop marks.** With vector typography the export groups objects into runs (vector / raster). Each raster run was rendered **alone** and cropped to its objects’ bounding box; everything not covered by those objects inside that rectangle stayed **transparent**, and the CMYK conversion pre-composites the alpha on **white** and drops the SMask (the BUG 19/20 fix, needed so transparent pixels — raw RGB 0,0,0 — do not turn into solid black). The rectangle therefore became an **opaque white block painted over** the background and the vector text already written into the PDF. This is why an export without crop marks (native pdf-lib vector path) looked correct. Measured on “blue background + white text + 2 photos”, A4, 3 mm bleed, CMYK HD + vector typography + crop marks: **8 850 white cells out of 14 768** rendered (60 % of the page); 0 without crop marks. Fix: objects **below** the run (the background) stay visible and only those **above** it are hidden, so the run image contains exactly what the preview shows and the alpha-on-white pre-composite has nothing left to cover. After: **466 white cells** (the crop-mark margin alone) and a mean difference to the reference render of **1.0** instead of **100.6**.

### Markers
`data-sp-js="v517"`, cache tag `20260920-v517-etat-widget-et-blocs-blancs`, `CACHE_NAME` bumped, local package rebuilt with `tools/make-release-zip.mjs`.

## [1.7.516] — 2026-09-20

_Fond widget: the title stays FONDS in black, the grey line below shows OPTIONS_

### Fixed
- **The two labels are now separate.** The widget system reads the widget title from `[data-dock-title]` — the very element that also carried the grey line. My previous change (“Fond” → “OPTIONS”) therefore altered both. There are now:
  - a **hidden** `[data-dock-title]` label reading **`FONDS`**, which the widget header displays in black capitals (the tool name);
  - the **visible grey line** reading **`OPTIONS`** just below it, without `data-dock-title`.
- Measured: header `FONDS`, grey line `OPTIONS` visible at 0.70 opacity, 408 px widget without scrolling, nine effects and four resolutions untouched, sidebar tool still named “Fond”.

### Markers
`data-sp-js="v516"`, cache tag `20260920-v516-titre-fonds-et-ligne-options`, `CACHE_NAME` bumped, local package rebuilt with `tools/make-release-zip.mjs`.

## [1.7.515] — 2026-09-20

_Fond widget: only the essentials — the grey text lines are gone_

### Changed
- **The panel's grey title becomes `OPTIONS`** (the sidebar tool keeps the name “Fond”), so “Fond” is no longer displayed twice on screen.
- **Removed the resolution status line** that repeated the chosen definition under the 72 / 150 / 300 / 600 buttons (“300 dpi — 2480 × 1395 px — resolution computed on the width of an A4 page…”). The active button stays black and every button keeps its **hover tooltip** (web / low / medium / HD).
- **Removed the hint under the preview** (“Click the preview: freeze / resume. (Preview cropped — the inserted image is complete.)”).
- **Removed the widget's bottom note** (“Insertion recomputed at the chosen resolution. Second click on « Fond »: close.”).
- Result: the widget goes from 504 to **408 px high**, still without any scrolling, and shows only: the title, the nine effects, the four resolutions, the preview, the four sliders and the four actions.

### Verified
| Check | Result |
|---|---|
| Panel title | `OPTIONS` (measured in the DOM and inside the widget) |
| Grey text lines in the panel | none left (every `.rb-petit` / `.rb-note` removed) |
| Resolution status element | removed (`majDpi` already guards its absence) |
| Four resolution buttons | present, “300” active by default |
| Widget height / scrolling | 408 px, no scrolling |
| Page background insertion | still working (1 background object) |
| Application / studio syntax | `node --check` OK / `SYNTAXE OK` |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v515"`, cache tag `20260920-v515-widget-fond-allège`, `CACHE_NAME` bumped, local package rebuilt |

## [1.7.514] — 2026-09-20

_Animated background becomes “Fond”, with four output resolutions — and the Speed slider fixed_

### Changed
- **The widget is simply called “Fond”.** Renamed everywhere the user reads it: sidebar tool label, widget title, tooltip, icon `alt` text, undo labels, bottom note. Internal ids (`randomBackMenu`, `rb…`) are untouched, so nothing else in the application is affected.
- **Four output resolutions**, computed on the width of an A4 page (210 mm) and measured on the inserted image:
  | Choice | Output | PNG data URL |
  |---|---|---|
  | 72 dpi (web) | 595 × 335 px | 177 KB |
  | 150 dpi (low) | 1240 × 698 px | 500 KB |
  | 300 dpi (medium, default) | 2480 × 1395 px | 2.5 MB |
  | 600 dpi (HD) | 4961 × 2791 px | 7 MB |
  The image stays 16:9, and the current resolution is displayed under the buttons.

### Fixed
- **Low resolution stays clean.** At 72 and 150 dpi the scene is now drawn **twice as large** and then scaled down with high-quality smoothing (`imageSmoothingQuality = high`): dots, fine lines and halftone screens stay sharp instead of being jagged. At 300 and 600 dpi the scene is drawn directly at the final size (already dense; ×2 would be needlessly heavy).
- **Speed slider.** The widget slider now listens to **both** `input` and `change` (dragging *and* release/keyboard arrows), writes the value back into the original control and copies the `--rb-p` fill onto both elements. Measured: pushed from 1 to 0.4 → 0.4 on the widget, the original and the engine, displayed 0.40, fill 8.7 % on both elements (exact value); then 2.5 through the release event → 2.5 and 2.50.

### Verified
| Check | Result |
|---|---|
| Renaming | tool label “Fond”, widget title “Fond”, icon alt “Fond”, tooltip and note updated |
| Four resolutions | 595 × 335 / 1240 × 698 / 2480 × 1395 / 4961 × 2791 px, state label updated each time |
| Speed slider to 0.4 then 2.5 | value 0.4 / 2.5 everywhere, displayed 0.40 / 2.50, fill 8.7 % on both elements |
| `.sp`, `.json`, Studio with a 600 dpi background | saved, read back and imported without loss (data URL intact) |
| Application / studio syntax | `node --check` OK / `SYNTAXE OK` |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v514"`, cache tag `20260920-v514-fond-et-quatre-definitions`, `CACHE_NAME` bumped, local package rebuilt with `tools/make-release-zip.mjs` |

## [1.7.513] — 2026-09-20

_Animated background: a third-shorter preview, live sliders, a LIVE page background — and every transport verified_

### Changed
- **Preview a third shorter.** Measured **449 × 168 px** instead of 449 × 252 (−33 %), still full widget width: the widget gives back 84 px of useful height and everything fits without scrolling. The **scene stays 16:9** (960 × 540 preview bitmap, 2560 × 1440 insertion output); the box being shorter than the image, the preview is **cropped** top and bottom (`object-fit: cover`) — no distortion — and the inserted image stays complete, which the help line now states.

### Fixed
- **“We lose the slider ball.”** Measured: dragging inside the widget did reach the engine, but the widget's black fill stayed behind (34.8 % instead of 95.7 % for Speed = 2.4) — the thumb moved on its own. Cause: a race with the dock's resynchronisation (450 ms) plus a copy of the `--rb-p` gauge in the wrong direction. The widget sliders are now listened to **directly** (`input`), the value is written into the original control, the gauge is mirrored onto **both** elements, and a frame is **redrawn immediately** — even when the animation is frozen, so adjustments are visible at once.
- **No live preview in the page.** “Page background” used to place a frozen snapshot. It now places a **live** background: a Fabric image whose source is the engine canvas (measured: `_element` = CANVAS 960 × 540). The page therefore really animates and every effect/setting applies instantly. Just before serialisation the image's `getSrc`/`toObject` are hooked to return a **fresh snapshot** (measured: two successive calls give 1,078,398 then 1,064,702 characters), so `.sp`, `.json` and the PDF always contain the current frame.
- **Replacing the background stacked images.** Previous widget backgrounds (tagged `_spRandBackBg`) are now **purged** before every insertion: one background at a time (measured: 1 object before, 1 object after).

### Verified — animated backgrounds through every transport
| Transport | Measurement |
|---|---|
| `.sp` written | one `image` object, `src` = PNG data URL of **380,714 characters**, `scaleX` 0.596 |
| `.sp` read back | 1 page, 1 object, source **2560 × 1440**, on-page cover **1526 × 858** on a 612 × 859 page |
| `.json` | 383,838 characters, PNG data URL present, `colGrid` present |
| PDF export (native vector typography) | **3.9 MB**, **two image objects** embedded → the background is printed |
| Studio SP213 import | one `image` element, `imageUrl` = the same 380,714-character PNG data URL, visible in the preview |
| Widget background replacement | 1 object before, 1 after (previous purged) |
| Live background source | Fabric image backed by the engine CANVAS 960 × 540 |
| Slider dragged to 2.4 in the widget | engine 2.4, displayed 2.40, fill 95.7 % on both original and widget |

Known points: a background weighs ~400 KB in the file and in the PDF (a 2560 × 1440 PNG) — normal for a bitmap. And the **Studio re-fits images to its own page**, so a 16:9 background does not overflow there the way it does in the application (data correct, scaling differs; to handle on a next Studio pass).

### Markers
`data-sp-js="v513"`, cache tag `20260920-v513-apercu-compact-et-transports-verifies`, `CACHE_NAME` bumped, local package (`sp213-local.zip`) rebuilt with `tools/make-release-zip.mjs`.

## [1.7.512] — 2026-09-20

_Animated background: house-style black and grey, five effects per row, full-width preview_

### Changed
- **No blue anywhere.** My previous version leaned on `var(--sp-accent, #2bb7ff)`, a blue accent colour that does not exist in the house style: sliders had a blue track and thumb, and the effect button active on opening (DOT) showed up blue.
  - Sliders: **grey track with a black fill**, white thumb ringed in black; the fill now follows the **exact slider value** through a `--rb-p` variable set by the engine (measured: 34.8 % for Speed = 1, i.e. (1 − 0.2) / (2.5 − 0.2)). The dark theme simply inverts black and white. Verified: **zero blue rule** in the whole widget.
  - Effect buttons: **22 px high with a 9 px label** (they were 32 px, too big) and the active state is the house **black** `#1a1a1a` on white — inverted in the dark theme. It now reads as a real selected SuperPrint button.
  - **Five effects per row** (5 then 4) instead of three: the nine effects fit in two rows and take half the height.
- **Preview at the widget width** — measured **449 × 252 px**, 16:9 kept through `aspect-ratio` (the bitmap stays 960 × 540 for sharpness).
- **Widget a little narrower**: **470 px** instead of 560 (the previous width was excessive).
- **Height made to fit.** Since this widget contains a preview, its body gets `max-height: min(80vh, 580px)` instead of the common `58vh`: measured, the content fits **exactly** in the window (body 471 / 471 px) and **nothing scrolls any more**, even in a small 627 px-high window. The last slider (Teinte) and the “Page background” button used to fall 70 px below the widget.
- Help texts shortened to one line each.

### Verified
| Check | Result |
|---|---|
| Widget | 470 × 504 px, body 471 / 471 px → **no scrolling** |
| Preview | 449 × 252 px, ratio 1.78 (16:9), full widget width |
| Effect grid | five columns of 85.3 px, nine effects, 5 + 4 |
| Active effect button | background `rgb(26,26,26)` = #1a1a1a, white text, height 22 px |
| Inactive effect button | transparent background, grey label (85,85,85) |
| Slider fill | `--rb-p: 34.8%` for Speed = 1 (exact value) |
| Blue rules in the widget | **0** |
| Controls cut off | none |
| Nine effects | still nine distinct pixel fingerprints |
| Freeze on click / insertion | unchanged (freeze + resume, image, uniform-cover page background) |
| Application / studio syntax | `node --check` OK / `SYNTAXE OK` |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v512"`, cache tag `20260920-v512-fond-anime-au-noir`, `CACHE_NAME` bumped |


## [1.7.511] — 2026-09-20

_Animated background: nine effects, a 16:9 preview, house-style sliders — and no more scrolling_

### Added
- **Three new effects** (nine in total) in the Animated background widget:
  - **Organic** — soft blobs (radius modulated by two sine waves) mask an orange/blue colour sheet: a living, organic background.
  - **Isometric cubes** — an isometric grid of cubes rising and falling, three faces with three values: ideal as a cover background or behind a title.
  - **Holo print** — holographic/printed look: three offset screens of neon dots (cyan, magenta, fluo yellow), like a boosted fluo CMYK.
- The nine effects fit in a **3 × 3 grid** of buttons; the effect in use is highlighted.

### Changed
- **16:9 preview.** The portrait preview (560 × 792) is replaced by a 16:9 view capped at 150 px high — measured **267 × 150** on screen (ratio 1.78, 960 × 540 bitmap). The animation itself is 16:9 too.
- **High-resolution insertion is now 2560 × 1440 px** (16:9), and the page background is placed in **uniform cover** (same factor on X and Y, centred): a 16:9 background can no longer be squashed into an A4 page (measured scaleX = scaleY = 0.596).
- **Sliders redesigned in the house style.** The native sliders (grey, thick) looked wrong in this panel: thin gradient track, round white thumb with a coloured ring, small-caps label and the **value displayed on the right**, like the type sheet (`.rb-range`).
- **The widget no longer needs scrolling.** Nine effects in three rows of three, four sliders in two columns, four actions on one row, note shortened, preview capped: measured — **no control falls outside the visible widget area, even in a small 627 px-high window** (previously the panel scrolled ~110 px to reach the last buttons).

### Verified
| Check | Result |
|---|---|
| Widget | 560 px wide (`sp-dock-xl`), 397 px high in the test window |
| Preview | 267 × 150 on screen, ratio 1.78 (16:9), bitmap 960 × 540 |
| Nine effects, nine sample points | **9 different pixel fingerprints** |
| Insertion as image / page background | source 2560 × 1440 px, cover with scaleX = scaleY = 0.596 (no distortion) |
| Sliders | class `rb-range`, values displayed (1.00 / 0.50), house colours |
| Controls cut off in a 627 px-high window | none |
| Freeze on preview click | freezes, second click resumes |
| Application / studio syntax | `node --check` OK / `SYNTAXE OK` |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v511"`, cache tag `20260920-v511-fond-anime-neuf-effets`, `CACHE_NAME` bumped |


## [1.7.510] — 2026-09-20

_Animated backgrounds you build live in the app, and tab-stop text that stays readable in the PDF_

### Added
- **“Animated background” tool (Random Back)**, in the left Shapes menu right after “Free form”. It does not add a shape: it opens a **wide widget (520 px)** where a background is generated live, frozen with a click on the preview, then inserted into the layout.
  - Three effects to start with: **DOT** (a grid of dots that breathe), **Fluide colors** (additive radial-gradient sheets flowing on a dark base) and **Pastel** (very soft bands plus a light grain).
  - Four sliders — speed, density, intensity, hue — and a **Variante** button that redistributes the scene at random.
  - Clicking the preview **freezes** the animation (a second click resumes it), or use the **Geler / Reprendre** button.
  - **Insérer l’image** adds a movable, centred image; **Fond de page** adds it at the exact page size and sends it to the back. Insertion is **not** a screen grab: the same scene is recomputed at **1754 × 2480 px** (A4 at 212 dpi) with a scale factor, so it stays printable.
  - Implementation note: **no external library**. The backgrounds use native canvas 2D, so the application remains fully usable offline (the project explicitly forbids adding CDNs). The animation runs only while the widget is open.
  - The panel is cloned by the dock-widget system; since `cloneNode` does not copy canvas pixels, the loop paints the original panel **and** the detached widget canvas (found through `data-dock`). Clicks are recognised by document-level delegation, because the widget bridge does not forward clicks from a cloned canvas (measured: the button stayed on “Geler”).

### Fixed
- **A tab-stop text block was exported as one text run per letter.** Measured with a spy on `PDFLib.PDFPage.prototype.drawText` for an “Article ⇥ Prix” block in vector-typography mode: **eleven single-character calls** (“A”, “r”, “t”, “i”, “c”, “l”, “e”, “P”, “r”, “i”, “x”). The text was real and the font embedded, but copying from a PDF reader produced “A r t i c l e” and searching for “Article” failed. Cause: the character loop forced by the tab support (v1.7.480) is needed for the **position**, not for the **splitting**. Fix: when a tabbed line has no character styling, no letter spacing and no justification, it is drawn **one text run per tab-separated piece**; positions are unchanged (same measurements, and pdf-lib applies no kerning to a whole run) and the block font is kept. The other cases keep the character loop.
- **Broken Shapes icon (404).** `setupShapesDropdown()` copies the clicked menu item’s icon into the Shapes button (`mainIcon.src = icon.src`); the new tool used an inline `<svg>`, so `src` was `undefined` and the button showed a broken image. The tool now ships a real icon file (`app/icons/randback.svg`).

### Verified
| Check | Result |
|---|---|
| Tool present in the Shapes menu, after “Free form” | button opens the widget, second click closes it |
| Widget width class `sp-dock-xl` | measured 520 px |
| Live preview inside the widget | canvas inked (454 sampled pixels), the three effects give different pixels (DOT bright, Fluid dark `10,21,37`, Pastel `232,237,215`) |
| Click on the preview | freezes (two captures 500 ms apart are identical), second click resumes (captures differ) |
| Insert as image / as page background | 486 × 687 px on screen / 612 × 859 px = the whole A4 page, source recomputed at 1754 × 2480 px |
| Tab-stop block, vector typography export | 2 calls — `Article`, `Prix` — font `OpenSans-Regular`, **Δx = 140 pt = the stop** |
| Same block, CMYK export | 2 calls, same font, same Δx = 140 pt |
| Icon of the Shapes button after clicking the new tool | `icons/randback.svg`, loads (no 404) |
| Application / studio syntax | `node --check` OK / `SYNTAXE OK` |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v510"`, cache tag `20260920-v510-fond-anime-et-pdf-vectoriel`, `CACHE_NAME` bumped |


## [1.7.509] — 2026-09-20

_The column grid travels with the document, and the studio preview applies the tab stops_

### Fixed
- **The column grid was not part of the document.** Audited on request: `.sp`, `.json`, autosave, Web3, the API and the studio already carried the tab stops and the manual guides — but the column grid (`6/12/24/32` columns, opacity, margins) lived **only** in `localStorage['sp_col_grid']`, so it was lost on another machine or after clearing the cache while everything else came back.
- **The studio preview did not apply the tab stops.** Measured on an “Article ⇥ Prix” block with a 140 px stop: the studio preview drew “Prix” glued to “Article” (82 backing px apart instead of 280) while the tab data itself travelled correctly. Two causes, both found by measurement:
  - the studio embeds **Fabric 5.1.0** (the application runs 5.3.0) and 5.1's `_measureLine` never calls `_getGraphemeBox`, so the tab box kept the font metric of a letter;
  - worse, `fabric.Textbox._splitTextIntoLines` → `_wrapText` reassembles words with a **space**, so a tabulation was converted to a space **before any measurement** — measured: `new fabric.Textbox('A\tB').textLines` returned `["A B"]`. No tab-aware code could ever see it.

### Added
- `document.colGrid` in **all five writers** (`saveProjectSP_toObject`, `.json`, `autoSaveProject`, Web3, API) and its counterpart in **all four readers** plus the autosave restore and the `.sp` reader (`spColGridAppliquer`). The studio stores it at import (`state.doc.colGrid`) and re-emits it in both of its exporters.
- `_SP_STUDIO_509` engine in the studio + `_SP_TRANS_509C` post-measurement correction in the application: the tab box is corrected **after** `_measureLine`, a hook that is stable across Fabric versions. Idempotent by construction — if the measurement already applied the advance (5.3 + `_getGraphemeBox`), the delta is zero. Verified in the application: the model is unchanged and the ink is unchanged (no double shift).
- `_SP_STUDIO_509D` in the studio: tabulations survive the textbox — during wrapping the tab is swapped for a private-use character (not a word separator) and restored in `lines`, `graphemeLines`, `_unwrappedLines` and `graphemeText`. Text without tabulation goes straight to the original function.

### Verified
| Check | Result |
|---|---|
| `.sp` written by the application, read back | `document.colGrid` = `{"cols":12,"opacity":25,"margins":false}`, text `Article\tPrix` with both stops (140 / 300) |
| Studio preview, tab stop 140 px (document) | “Article” [181..254], “Prix” [462..504] → 281 px apart (was 82) |
| Application preview after the post-measurement patch | model `[…,"53+87","140+11",…]` unchanged, ink [1..52] / [143..171] → no double shift |
| PDF export advance engine | 70.63 + 69.37 = **140.00** → the text lands on the 140 pt stop (engine shared with the screen, unchanged by this version) |
| Studio round trip | import from `.sp` keeps `_spTabs` + `colGrid`; “Open in SuperPrint” sends them back unchanged |
| Studio syntax / application syntax | `SYNTAXE OK` / `node --check` OK |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v509"`, cache tag `20260920-v509-grille-et-taquets-transportes`, `CACHE_NAME` bumped, `CSS/main.css` tag bumped |


## [1.7.508] — 2026-09-20

_The letters follow the caret to the tab stop, and two widget adjustments_

### Fixed
- **The text did not follow the caret to the tab stop on screen.** Measured, pixel by pixel, on a block “A ⇥ B” with a 150 px stop: the MODEL was right (`__charBounds` put the tab box from 15.2 to 150 and B at 150) — so the caret moved to the stop, the ruler marked the stop in the right place, and the PDF exports and the vectoriser put B at 150. Only the SCREEN differed: B was drawn at [24..35], glued to A. Cause: for a line with no character-level styling and no letter spacing, Fabric draws the whole line in one `fillText` (the `isFullLine` shortcut of `_renderChars`), and a tab inside a string is rendered by the browser as a plain space — the advance computed for the stop was never used. It was the only drawing path left outside the advance engine.
- **Fix:** `fabric.Text.prototype._renderChars` is now bypassed for a line containing a tabulation on a block with active tab stops: the line is drawn character by character at `__charBounds` positions — the same source of truth as the caret, the selection, the ruler and the exports. After the fix the ink of B measures [153..164].
- **“Grid &amp; guides” was cramped: 57 px of content were cut off.** Measured at the historical widget width (200 px): the widget body had `clientWidth` 199 for a `scrollWidth` of 256, so the right-hand labels and fields were simply not visible (the panel is wide by nature: five column buttons on one row and two pairs of side-by-side fields). It now gets the `sp-dock-wide` class — 400 px, bounds 320/480 — and `scrollWidth` equals `clientWidth`.

### Changed
- **No close cross in the tab-stops widget.** As requested, the widget is closed with the original “Tabulation” button (second click) or with Escape. The panel inner title bar — which carried the cross and repeated the title — is removed from the WIDGET ONLY (the original panel, source of the next copies, is untouched).
- The panel help line is updated accordingly (it no longer mentions the cross).

### Verified
| Check | Result |
|---|---|
| Block “A ⇥ B”, 150 px stop, ink of B on screen | [153..164] — was [24..35] before the fix |
| Real mouse click in a word + real Tab key | “Bonjour le monde” → “Bonjo ⇥ ur le monde”, caret after the tab, ink of the rest from 203 px |
| Caret at index 0 + Tab | whole text moves to the 200 px stop (model 0+200 / 200+16) |
| Two successive tabulations, stops at 120 and 260 | second tab reaches 260 (model 65+55 / 120+140) |
| Bold + letter spacing 120, stop 200 | ink after the tab starts at 202 px |
| Two-line block, caret on line 2, stop 200 | tab honoured on line 2, line 1 untouched |
| Centred block with a tight stop | the line offset is applied as Fabric does (known limit: the stop is measured from the line box, not from the frame) |
| Native PDF export after the change | draws at 141.5 pt and 241.5 pt → Δ 100 pt, unchanged |
| Grid &amp; guides widget body | clientWidth 399 / scrollWidth 399 (was 199 / 256), 10 controls hit-tested |
| Tab-stops widget | no cross in the widget, cross kept in the original, list and buttons still driven, closed by the original button |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v508"`, cache tag `20260920-v508-lettres-suivent-le-taquet`, `CACHE_NAME` bumped, `CSS/main.css` tag bumped |


## [1.7.507] — 2026-09-20

_Tab stops panel becomes a widget, and tab stops reach the PDF exports_

### Fixed
- **Vectorised text ignored the tab stops.** Measured: a block “A ⇥ B” with a 100 px stop exported with B glued to A (x = 150 and 176.6 px) while the preview, the pdf-lib path and the jsPDF path all placed it at the stop. The glyph loop of `_spDoVectorize` knew nothing about tabulation and measured `\t` with the font metrics; it now asks `window.spTabAvance` — the same advance engine as the preview — converting the cursor through the block scale so the stop (expressed in text pixels) is honoured.
- **The font-fallback block lost every block setting.** When the font was not resolved yet, vectorisation worked on the substitute block built by `_spFallbackVector`, which copied none of the original settings: the tab stops fell back to a default 10 mm step (or to none at all), and the vertical metrics and line-breaking rules were lost too. The substitute now carries `_spTabs`, `_fontSizeMult`, `_fontSizeFraction`, `charSpacing`, `breakWords` and `splitByGrapheme` from the original block.

### Added
- **The tab-stop panel is now a docked widget** (`window.spDockWidgets`, one click on “Tabulation” opens it, a second closes it, its cross and Escape close it too), living in `#canvasScrollArea` like Styles / Pathfinder / Swatches / Filters. The old dropdown stuck to the rail and the pop-in over the pasteboard are gone, along with the “click elsewhere closes it” rule — clicking in the text or on the ruler is precisely how one places the caret.
- **A cloned panel is a two-faced panel.** The dock widget is a copy of `#tabsMenu`, so every command that writes into the panel (stop list, status line, disabled buttons, target label) now writes into ALL copies (`racines()` / `dans()`), and the delegation is wired on each copy. Without this the list would only be drawn in the original — that is, nowhere. Generated row controls carry a `data-sp-ref` with no real target so the widget bridge leaves the event to their own copy instead of routing it to the original.
- The widget gets the `sp-dock-large` width (320 px) and the panel help line stays visible inside it (the stylesheet hides `.hint` in every docked widget; here it is the operating manual for the Tab key and the ruler gestures).

### Verified
| Check | Result |
|---|---|
| Widget geometry, sidebar collapsed / open | inside `#canvasScrollArea` (80 → 400 px collapsed; 304 px with the sidebar open, 0 px overlap) |
| Point under the pointer on each widget field | the field itself (`tabStep`, `tabNewPos`, `tabAddBtn`, `tabApplyBtn`, `tabsVisibleToggle`) |
| “+ Stop” clicked in the widget | exactly one stop added (1 → 2) |
| Row cross clicked in the widget | the correct stop removed (2 → 1) |
| Step 25 mm / position 77 mm set in the widget | 70.866 px / 218.268 px — exact |
| Second click on “Tabulation”, then Escape | widget closed both times |
| Tab in an editing block with a 90 px stop | “ABC” → “A ⇥ BC”, caret after the tab, next letter at 90 px |
| Native PDF export, stop at 100 px | draws at x = 141.5 pt and 241.5 pt → Δ 100 pt |
| jsPDF PDF export, same document | draws at x = 62.92 mm and 98.19 mm → Δ 35.28 mm (= 100 px) |
| Vectorisation with tabs, font cached | glyphs at 150 px and 252 px (stop honoured) |
| Vectorisation via the font fallback | glyphs at 150 px and 252 px (was 150 / 176.6) |
| .sp round trip | `_spTabs` in the saved page JSON; after reload the stops are identical and the tab box measures 87.35 px with the letter at 100 px |
| Studio transport | `_spTabs` copied both ways by `spAppliquerReglagesTypo` (only when the text is unchanged) |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v507"`, cache tag `20260920-v507-tabulation-en-widget`, `CACHE_NAME` bumped |


## [1.7.506] — 2026-09-20

_Grid & guides becomes a widget, and the red column grid arrives (6 · 12 · 24 · 32)_

### Fixed
- **The Grid & guides panel was unusable in one of the two sidebar states.** Measured with the sidebar collapsed: the panel opened as a dropdown stuck to the rail and its fields took no value at all; with the sidebar open it switched to a centred pop-in (behind an overlay with z-index 9998) right on top of the pasteboard, so every click was swallowed — the same family of defect as the tabulation palette fixed in 1.7.505.
- **Two click listeners cancelled each other** on the “Grid & guides” button: the first opened the widget, the second closed it in the same click (measured: nothing appeared). The toggle now lives in a single handler and asks the widget system whether it is already open.
- **The remembered opacity was overwritten at start-up.** Measured: 30% stored, reload gave 12% and rewrote 12% to storage — the initialisation read the input value instead of pushing the saved state into it.

### Added
- **Grid & guides is now a docked widget** (`window.spDockWidgets`, one click opens, a second closes, cross closes too), living in `#canvasScrollArea` like Styles / Pathfinder / Swatches / Filters. The dock system accepts a `[data-dock-title]` title and ignores `[data-dock-ignore]` elements (the panel cross), and exposes `estOuvert()`.
- **Translucent red column grids (6 · 12 · 24 · 32).** Five buttons (None · 6 · 12 · 24 · 32) place the guide immediately, with an opacity field (4–40%, default 12%) and an “inside margins / whole page” choice. The bands reuse the gutter field, are never selectable and carry `excludeFromExport` (never printed nor exported, like the blue grid guides). State is stored in `localStorage` (`sp_col_grid`) and restored on load.
- The column grid is independent from the blue grid (`window._spColonnesActives`): it can be shown without enabling the layout grid, and both coexist. Page creation hooks (`createPageCanvas`, `createSpreadCanvas`, `_spRenderReady`) re-plan a grouped redraw (`window.spPlanifierGrille`) so the bands follow added pages and double-page spreads.

### Verified
| Check | Result |
|---|---|
| Widget geometry, sidebar collapsed / open | inside `#canvasScrollArea`, 0 px overlap with the bars (80→280 / 304→504) |
| Point under the pointer on a widget field | the field itself (bridge routes to the original) |
| 12 columns inside margins | 12 bands `rgba(255,0,0,0.120)`, 27.2 px wide, 728.5 px tall, starting at 65.2 px |
| Opacity 30% / full page | `rgba(255,0,0,0.300)` / start 8.5 px, height 841.9 px |
| With the blue grid on | 24 red bands + 10 blue lines, no interference |
| New page / reload | bands present on the new page; 12 bands restored with the saved opacity |
| Drag outside the work area | clamped to 288 px, position remembered |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v506"`, cache tag `20260920-v506-widget-grille-colonnes`, `CACHE_NAME` bumped |


## [1.7.505] — 2026-09-20

_Tabulation mode: the ruler, the palette and the cursor now behave like QuarkXPress_

### Fixed
- **The tab palette used to cover the page.** With the sidebar open the panel switched to a centred pop-in (measured 400 × 384 px, left 425) right on top of the pasteboard (canvas at left 429) and an overlay with z-index 9998 swallowed every click: no caret could be placed and no tab stop could be grabbed. The palette now opens inside the left column (measured 8 → 248 px, fully on screen) and no overlay is created.
- **The tab ruler only appeared in tab mode.** Standalone `regleEstVisible` required an open panel or already-active tab stops, so nothing was shown while typing. The ruler is now displayed as soon as a text block is being edited (canvas events `text:editing:entered` / `text:editing:exited`), default interval drawn as small ticks.
- **Clicking the ruler did nothing.** Only the button “+ Taquet” with a typed-in position added a stop. A click on the band now places a stop at that exact spot (half-millimetre snap, tabs activated) and starts dragging it in the same gesture; a click inside the text block is never captured by the ruler (guarded by `containsPoint`), so the caret always wins.
- **No way to remove a stop with the mouse.** Dragging a handle below the ruler now marks it for removal (it fades, status “Release to REMOVE this tab stop”) and deletes the stop on release; Escape on a stop created by a ruler click removes it entirely.
- **Any canvas click closed the panel**, so the palette (and the ruler, when the block had no active stops) disappeared just when the caret was being placed. Clicks inside the current text block or on the ruler now keep it open; a click elsewhere still closes it.
- **Tab did nothing at all after a panel setting.** Measured: `document.activeElement` was BODY while the block stayed `isEditing`, and the handler required the Fabric hidden textarea to hold the focus — no insertion, no caret move, and the next keystroke did not go back into the text. The condition now accepts any block being edited while still refusing real UI fields; `poserCurseur` gives the focus back to the hidden textarea.
- **Tabs were invisible.** The “invisible characters” markers covered spaces only; a tabulation is now drawn as a pink arrow at its start (`_spDrawInvisibleMarkers`).

### Added
- `_dev/scripts/_tab_505.cjs`, `_tab_505b.cjs`, `_tab_505c.cjs`, `_tab_505d.cjs` patch both trees idempotently (markers `_SP_TAB_505_DEBUT` to `_SP_TAB_505D_DEBUT`); the panel hint now describes the three gestures.

### Verified
| Check | Result |
|---|---|
| Panel geometry, sidebar open | left 8, right 248 (column 280), fully on screen |
| Point under the pointer inside the text | `elementFromPoint` returns the upper canvas |
| Ruler while editing, no stop yet | 1 ruler object, 0 mark |
| Click on the ruler 100 px from the left edge | tab stop at 35 mm, tabs activated, panel row created |
| Tab with the cursor in front of a letter | `Bonjour t⟶arif…`, letter restarts at 99 px = the 35 mm stop |
| Drag the handle to 60 mm | stop at 59.5 mm (half-millimetre snap) |
| Drag the handle below the ruler | stop removed, status “Taquet retiré.” |
| Tab with `activeElement` = BODY, block editing | insertion + focus back in the hidden textarea |
| Click in the block / far from it | panel kept / panel closed |
| Block selected without a click (rubber band) + Tab | unchanged: editing entered, caret at the end, no insertion |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v505"`, cache tag `20260920-v505-tabulation-ergonomie`, `CACHE_NAME` bumped |


## [1.7.504] — 2026-09-20

_Tabulations: in a text block the letters now really follow the cursor_

### Fixed
- **Tabulation in the middle of a text block did nothing.** Putting the cursor in front of a letter and pressing Tab moved the cursor to the next tab stop without shifting any character. Measured on a fresh build: the gesture is a click inside a block that is **not active** — Fabric only enters editing on the *second* click, so no caret existed yet, and the old code parked the caret at the **end of the text** without inserting anything. That is the reported "only the cursor moves, not the letters".
- **The tabulation could be inserted away from the caret.** The call `obj.insertChars(tab)` inserts at the block own `selectionStart/selectionEnd`, which can lag behind the real caret held by the hidden textarea of Fabric. `insererTabulation` now passes the measured caret position explicitly (3rd and 4th arguments) and falls back to aligning the block selection when nothing was inserted.
- **A click that only selected a block is no longer lost.** The tabulation module remembers the last click received by the pasteboard; when Tab lands on a merely selected text block **and** that click was inside the block, the software enters editing, places the cursor with the Fabric function `setCursorByClick` and inserts the tabulation in the same gesture. Selections made with the rubber band or the keyboard keep the previous behaviour (editing entered, caret at the end, status message, no insertion).

### Added
- `_dev/scripts/_tab_504.cjs` patches both trees idempotently: three anchors in `app/JS/main.js` (the click memory and the selected-block path carry the marker `_SP_TAB_504_DEBUT`, the insertion position carries the `v1.7.504` comment).

### Verified
| Check | Result |
|---|---|
| Block being edited, cursor mid-text, Tab | tabulation inserted at the cursor, letters shift (`Bonjour tarif…` → `Bonjo / ur t / arif…`) |
| Block merely selected after a click in the text, Tab | caret placed where clicked (`sel` 9), tabulation inserted at index 9 |
| Same gesture before the fix | caret jumped to the end of the text (`sel` 25), nothing inserted |
| Selection without a click inside the block, Tab | unchanged: editing entered, caret at the end, status message, no insertion |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v504"`, cache tag `20260920-v504-tabulation-curseur`, `CACHE_NAME` bumped |


## [1.7.503] — 2026-09-20

_The language chosen on the presentation page follows the visitor into the tools_

### Added
- **The chosen language now travels to the applications.** Picking French or Japanese on the home page (or the help page — same script) writes the **shared key** `sp_lang` and appends `?lang=xx` to the links of the three tools (`app/index.html`, `sp213-studio.html`, `supertypo/index.html`), including the template links that already carry `?tpl=…`. The application, the studio and SuperTyPo read that parameter at start-up, apply it and remove it from their address. Without the parameter nothing changes: the application falls back to `sp_lang`, the studio to its own preference, and SuperTyPo still starts in English (its 1.7.425 rule).
- `_dev/scripts/_lang_503.cjs` patches both trees idempotently (5 files each): `index.html`, `help-us.html`, `app/JS/main.js`, `sp213-studio.html`, `supertypo/JS/supertypo.js`.

### Fixed
- **`history` was shadowed in the application.** `main.js` declares `let history = []` for its undo stack, so `history.replaceState()` inside that scope called a method on an array and threw — silently swallowed by the surrounding `try`. The URL clean-up now goes through `window.history.replaceState` (the same trap the `tpl` clean-up already guarded against).

### Verified
| Check | Result |
|---|---|
| Home in Japanese | 69 tool links carry `?lang=ja`, shared key written |
| App with `?lang=fr` (fresh storage) | starts in French, address cleaned, `sp_lang` = fr |
| App with `?lang=ja` while `sp_lang` = fr | the parameter wins: Japanese, address cleaned |
| Studio with `?lang=ja` | select on `日本語`, storage `ja`, UI Japanese, address cleaned |
| SuperTyPo with `?lang=ja` | Japanese interface, select `ja` |
| SuperTyPo without parameter | starts in English (1.7.425 rule kept) |
| Home without parameter | touches no preference (`sp_lang` stays null) |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v503"`, cache tag `20260920-v503-langue-partagee`, `CACHE_NAME` bumped |


## [1.7.502] — 2026-09-20

_The home page FAQ opens on click again in all three languages_

### Fixed
- **The FAQ of the home page did not answer the click.** Every question carried three `<summary>` tags — one per language — while a collapsible block has only one control: its **first** tag. The first one being French, and the page opening in English (and in Japanese), the *visible* question was not the control, so clicking it did nothing. French worked, which is why the fault only showed on the live site, whose default language is English.
- **Fix**: a single `<summary class="faq-q">` per question, the three languages moved inside as `<span data-lang="fr|en|ja">`. The control is now the right one in the three languages; the question number, the `+` icon and the two-column layout are untouched, and the 1.7.493 search filter keeps working (it searches the text of all three languages).
- `_dev/scripts/_faq_502.cjs` performs the change idempotently on both trees (10 questions each) and checks that there is exactly one `<summary>` per `<details>`.

### Verified
| Check | Result |
|---|---|
| Real click on the visible question (FR, EN, JA) | answer opens, 128 px measured |
| Visible language spans | 1 of 3 at a time (FR 0 px, EN 477 px, JA 0 px) |
| Number and `+` icons | kept (`::before` / `::after` on the single summary) |
| Search filter | “pantone” → 1 of 10 questions, clearing → 10 |
| `<details>` / `<summary>` | 17 / 17 — the 20 extra summaries are gone |
| Parity web ↔ local copy | 22 identical |
| Markers | `data-sp-js="v502"`, cache tag `20260920-v502-faq-cliquable`, `CACHE_NAME` bumped |


## [1.7.501] — 2026-09-20

_The dev tool documented in our own documentation, a lighter home page, author cards without numbers_

### Added
- **A “dev tool” chapter in the documentation.** `documentation.html` (and the copy embedded by the application, `app/documentation.html`) now carries a full bilingual chapter: what the panel is for, how to open it (sidebar button, F12, Escape), the three tabs, the sandbox (`SuperPrint`, `canvas`, `log()`, `mm()`, `px()`, `save()`, `getActiveCanvas()`, `spToast()`, `fabric`), the six built-in snippets with what they change, an annotated script and the caveats. Its entry sits in the Reference group of the sidebar, under the GPU chapter.
- **Two helper scripts**, both idempotent: `_dev/scripts/_devtool_500.{html,js,cjs}` (panel shell, panel module, injector) and `_dev/scripts/_pagedoc_500.cjs` (home page and documentation edits).

### Changed
- **The dev tool footer now opens our documentation** instead of the Fabric.js site: the `dtDocs` label was updated in the three dictionaries and the link points to `documentation.html#m-devtool`.
- **The “Trois portes d'entrée” fold is gone** from the home page. The three applications stay presented by the three large entry cards at the top of the page (logo, description, button); the chapter list now opens straight on “L'inventaire”.
- **The authors lose their numbers**: the `01` and `02` marks were removed from the two author cards. The drawn monogram and the CMYK dots remain, and nothing else changed (names, roles, texts, links).

### Verified
| Check | Result |
|---|---|
| Documentation chapter | reached by `#m-devtool`, 6 tables, sidebar entry in place (FR/EN) |
| Panel link | resolves to `app/documentation.html#m-devtool`, label “Documentation · dev tool” (FR/EN/JA) |
| Home page | fold absent, three entries still present, 0 author number |
| Panel | 3 tabs, 6 snippets, 0 emoji |
| JavaScript errors | none |
| Markers | `data-sp-js="v501"`, cache tag `20260920-v501-devtool-doc-et-page`, `CACHE_NAME` bumped |


## [1.7.500] — 2026-09-20

_Edit any vector path, a rebuilt “dev tool”, and path identity carried through .sp and .json_

### Added
- **“Edit path” on every vector object.** Right click a rectangle, circle, ellipse, polygon, triangle, line, imported path or vectorised glyph and the traced editor opens in place: square anchors, round curve handles, add a point on a segment, delete a point, convert to curves, apply, cancel. The handles are DOM elements, never Fabric objects — they never enter the selection, the history, the export or the page saves.
- **The `dev tool` panel** (sidebar and window) replaces “Developer Tools”. Three tabs — Snippets, Editor, API reference —, no emoji at all (every icon is an inline SVG), and six new snippets: document inventory (read-only), 12-column grid, swatch strip, editorial block, footer on every page, overflow check. The panel console timestamps lines, captures `console.log`, shows return value and duration, and the sandbox exposes `SuperPrint`, `canvas`, `log()`, `mm()`, `px()`, `save()`.

### Fixed
- **A converted path keeps its origin.** `_spPathFrom` is carried both ways by the application and the studio, in `.sp` as well as `.json`: after a full round trip the path comes back with its origin intact, so the original shape stays identifiable.
- **The conversion is pixel-exact.** Building the path used to keep the default 1 px stroke width of `new fabric.Path()` when positioning `left`/`top` (a rectangle with no stroke landed at 89.5/59.5 instead of 90/60). The position is now recomputed with the final stroke width and the flattened scale, and the stroke itself is rescaled when `strokeUniform` is off. Measured: 0.00 mm difference on rectangle (plain, rounded, 4 px stroke), ellipse, circle, polygon, triangle and a ×2 scaled rectangle; “Cancel” restores the original shape with its properties.

### Verified
| Check | Result |
|---|---|
| Conversion (8 shapes) | bounding box difference 0.00 mm |
| Cancel | original shape restored (rounded rectangle back with `rx 12`) |
| Real mouse drag on an anchor | path command and bounding box follow the gesture |
| Right-click menu | “Edit path” first entry, editor opens with 4 handles |
| `dev tool` | 3 tabs, 6 snippets run without error, 0 emoji, FR/EN/JA labels |
| `.sp` / `.json` round trip | `_spPathFrom` preserved both ways |
| JavaScript errors | none |
| Markers | `data-sp-js="v500"`, cache tag `20260920-v500-pathedit-et-dev-tool`, `CACHE_NAME` bumped |


## [1.7.499] — 2026-09-20

_The author marks without their plaque, the right links, a leaner help page, and tabulation that follows the caret_

### Changed
- **The two author marks lose their plaque.** `.auteur-marque` keeps no rule, no background and no padding; the drawing alone, at `clamp(104px,12vw,148px)` (it was a ruled plaque of `clamp(84px,9vw,108px)`). The CMYK dots and the card number stay on the same line, on the right.
- **The help page sheds two sections**: “Three tools, two people, no shop” (with its three application cards) and “What a donation means, concretely” (its four explanations and closing line). The two headings that remain — “Make a donation” and “Found a bug?” — take the **exact typography of the main title** (Playfair Display, `clamp(28px,3.4vw,44px)`, weight 700); they were `--f-caps` narrow capitals at 20-26 px.

### Fixed
- **The author links.** Clémence Brunet’s site is `2points13.fr` (not `clemencebrunet.fr`) and Simon Dupont-Gellert’s card opens `app.zigmoon.com` (not `zigmoon.com`) — corrected in the JSON-LD too, for each **Person** entity (the Zigmoon publisher and the breadcrumb keep `zigmoon.com`).
- **Tabulation: the caret position is read from the input field itself** (`hiddenTextarea`) when it has the focus, instead of the block’s own copy. A tabulation placed at a stale position landed **at the end of the text**, where it moves nothing: on screen, only the caret went to the next stop while the letters stayed. Measured with real gestures (four `ArrowLeft`, then a real `Tab`): the tabulation lands in front of the letter the caret sits at, the following letters move to the next stop (21 px at a 10 mm step), and the caret lands right after the tabulation.

### Verified
| Check | Result |
|---|---|
| Author marks | 148 × 148 px, `background: rgba(0,0,0,0)`, `border: 0`, `padding: 0`, both loaded |
| Author links | `2points13.fr` and `app.zigmoon.com`, in the cards and in the Person data |
| Help page sections | `help-apps` and `help-more` gone (0 cards) |
| Help page headings | `Playfair Display 44px / 700` — the main title’s own values |
| Tabulation (real gestures) | tab at index 2 = in front of “C”, “C” from x = 36 to x = 57 |
| JavaScript errors | none |
| Markers | `data-sp-js="v499"`, cache tag `20260920-v499-auteurs-et-aide`, `CACHE_NAME` bumped |


## [1.7.498] — 2026-09-20

_Rules instead of a panel, the grid rules return, one single interior typography, and the author marks_

### Changed
- **The hero install box keeps only its rules.** `#hero .install-shell` was a white panel with a large drop shadow — a pale patch in the middle of the cover. It is transparent now, with `--line-strong` around it and no shadow. **Only the npx field (`.cmd-block`) keeps a background, and it is `--white`** (measured `rgb(255, 255, 255)`).

### Fixed
- **The grey vertical rules are back in the block grids.** They were drawn by the grid’s own background (`gap: 1px` over `background: var(--line)`), and the 1.7.488 background flattening had set that same element to `transparent` — so the cards were only separated by the outer frame, and “L’inventaire” lost its vertical lines as soon as the block was opened. The grid background is the rule again and the cards take `--paper` (the page paper, so no pale patch): measured `rgb(220, 211, 195)` for the grid, `rgb(247, 243, 236)` for the cards.
- **One single interior typography**, the prepress one: card title `21px`, grey text `13px`. The inventory had `18px`, the presses `20px` with `12.5px` text, the analysis lists `14px` — four interiors, four measures. The per-block exceptions are removed; all five grids now measure exactly the same.

### Added
- **The two author marks**, dropped into `img/` by the user (a crown for Simon Dupont-Gellert, a C for Clémence Brunet): each sits in its own card, in a ruled plaque on the page paper, the mark centred inside, with the CMYK dots and the card number moved to the right of the same line. Both are decorative (`alt=""` + `aria-hidden`) and lazily loaded (`loading="lazy"`, 435 KB each).

### Verified
| Check | Result |
|---|---|
| Install box | background `rgba(0, 0, 0, 0)`, no shadow, `1px` `--line-strong` |
| npx field | `rgb(255, 255, 255)` |
| Five grids | background `rgb(220, 211, 195)`, cards `rgb(247, 243, 236)` |
| Interior typography | title `21px`, grey text `13px` — identical in all five |
| Author marks | both `200`, painted in a 108 px plaque |
| JavaScript errors | none |
| Markers | `data-sp-js="v498"`, cache tag `20260920-v498-filets-et-marques`, `CACHE_NAME` bumped |


## [1.7.497] — 2026-09-20

_The footer holds still and follows the top bar, “atelier” becomes “bureau”, and the help page is trimmed_

### Fixed
- **The footer no longer shifts on hover.** The yellow dash grew from `0` to `14px`; the link being an inline flex, the line widened by 22 px (dash + 8 px gutter), the column followed and the next column moved with it. The dash now keeps its place (`flex: 0 0 14px`) and opens through `transform: scaleX()`, which takes no space: measured, the first link (141 px), the next column (x = 1161) and the whole footer (362 px) are **identical before and after hovering**.

### Changed
- **The footer follows the top bar.** The first column — now headed **Bureau SuperPrint** — opens with the three applications (**SuperPrint Editor**, **Studio SP213**, **SuperTyPo**) then repeats the top bar in order (Fonctions, Manuel, Auteurs, Questions fréquentes, Participer); the second keeps the project links.

### Changed (wording)
- **“atelier” gives way to “bureau”** — `desk` in English, `デスク` in Japanese: 26 sentences in the three languages, on the home page and the help page (cover kicker, the three application blurbs, the features lead, the prepress band button, the format cards, the authors, the questions, the footer brand and heading, the JSON-LD and the visible FAQ answer). Measured: **zero** “atelier”, “workshop” or “工房” left in the painted text of either page, in the three languages.

### Help page
- **“Make a donation”**: the PayPal button’s consent sentence (`I would like to receive the latest news and features regarding the app.zigmoon.com applications for free.`) now comes first, translated into the three languages, and **the whole block takes the body text size** — 16.5 px like the heading above, where it was 13 px and the €19 line 10.5 px monospace.
- **The three columns “Pourquoi nous aider” / “Ce que ça finance” / “Ce que ça n’achète pas” are removed** (0 cards left).
- **The big sections follow the home page’s margins**: they carried the general `section` padding (72-140 px); they now take the home’s half-breath — **112 px** between two sections on desktop, 80 px at 1000, 68 px at 390. The two later rules (`.help-apps`/`.help-more { margin-top: 50px }`) had to fall too, otherwise their margin added to the padding.

### Verified
| Check | Result |
|---|---|
| Footer hover | first link 141 px, next column x = 1161, footer 362 px — identical before/after |
| Footer content | 3 applications + the 6 top-bar entries + the project links |
| “atelier” / “workshop” / “工房” | **0** in `fr` / `en` / `ja`, both pages |
| Donation block | 3 sentences at 16.5 px = the heading above |
| Amputated translations | **none** on either page |
| Legal windows | 11 sub-headings (legal) / 5 (privacy) in the three languages, same links |
| Help page rhythm | 112 / 80 / 68 px — the home page’s values |
| Markers | `data-sp-js="v497"`, cache tag `20260920-v497-bureau-et-pied-de-page`, `CACHE_NAME` bumped |


## [1.7.496] — 2026-09-20

_One single margin between the big sections, and the help page’s burger menu_

### Changed
- **One single margin between the four content sections** (templates, features, authors, questions): they all take `padding: clamp(34px,4vw,56px) 24px` — the values “The SuperPrint inventory” already had. Measured before: 113 px between templates and features, **56 px only** before the authors, 94 px before the questions (which started *higher* than the others, 26-44 px instead of 34-56). Now: **112 px** between two sections on desktop, 80 px at 1000 px, 68 px at 390 px.
- **The ending of the questions is wider**: `#faq { padding-bottom: clamp(56px,7vw,96px) }` — the last margin of the page, before the final band, was 50 px.

### Fixed
- **The burger menu of `help-us.html`** (composed from the home page, hence the same fault): the logotype band is now out of flow and laid exactly on the page’s own band, so the logo icon no longer drops 146 px when the menu opens. Measured on both pages at 390 / 700 / 820 / 1000 px: **0 px difference**.

### Verified
| Check | Result |
|---|---|
| Gaps between sections (1440 px) | 112 / 112 / 112 px + **96 px** after the questions |
| Same at 1000 px / 390 px | 80 / 80 / 80 px + 70 px · 68 / 68 / 68 px + 56 px |
| FAQ top padding | `56px` = the features section’s own value |
| Burger menu, index | 0 px at 390 / 700 / 820 / 1000 px |
| Burger menu, `help-us.html` | 0 px at 390 / 700 / 820 / 1000 px |
| Language leaks | **0** in `fr` / `en` / `ja`, on both pages |
| JavaScript errors | none |
| Markers | `data-sp-js="v496"`, cache tag `20260920-v496-marges-et-menu-aide`, `CACHE_NAME` bumped |


## [1.7.495] — 2026-09-20

_The burger menu keeps the logo in place, and the browser bar turns black on phones_

### Added
- **A black browser bar on phones.** `index.html` declares `theme-color` twice: black without a media condition (so a browser that cannot read media conditions — Safari — takes that one), then the paper colour above 1000 px (Chrome keeps the last declaration whose condition is true). Chrome on Android and Safari on iOS tint the address / status bar with it.

### Fixed
- **The logo icon no longer drops when the burger menu opens.** The full-screen menu reproduces the page’s logotype band (it used to hide it), but that band was stacked *under* the sticky bar after the measured offset: on opening, the logo fell **146 px** — a third of a phone screen. The band is now **out of flow** and the script lays it exactly on the page’s own band (same top, same height, same paddings, same rule). Measured at 390 / 700 / 820 / 1000 px wide: **0 px difference**, image and band alike. If the band has left the screen (scrolled page), it tucks under the bar as before.

### Verified
| Check | Result |
|---|---|
| Logo before / after opening | 390 px: `5→77` both · 700 px: `5→86` · 820 px: `5→58` · 1000 px: `5→58` |
| Difference | **0 px** at all four widths (band and image) |
| First menu link | 151 / 160 / 132 px — unchanged, under the band |
| `theme-color` | `#000000` then `#F7F3EC` `(min-width: 1001px)` |
| Language leaks | **0** in `fr` / `en` / `ja` |
| JavaScript errors | none |
| Markers | `data-sp-js="v495"`, cache tag `20260920-v495-menu-et-theme`, `CACHE_NAME` bumped, `title` follow-through |


## [1.7.494] — 2026-09-19

_The prepress block’s interior treatment, given to the other blocks_

### Changed
- **One single interior treatment for the blocks of the “Fonctions” part.** The recipe of the favouried block (`#prepress`, “La chambre noire”) is now the rule for all: a lead paragraph, a **framed grid of numbered cards** (cyan number, capitalised title, 13 px text, bordered tag) and a **closing band** (italic Playfair sentence + `.btn-paper` button). Applied to `#inventaire` (15 cards), `#use-cases` (8 cards, four per row), `#vs-indesign` (the two facing lists become two cards) and `#formats` (the two format families become two cards).
- **No content was retyped**: every trilingual text is reused as is. Only the lead paragraphs and the closing bands are new — written in French, English and Japanese.

### Fixed
- **The comparison table had two identical buttons** (“Voir la suite du tableau”): the one living *inside* `.cmp-wrapper` (hence scrolling with the table) is removed; the one below the table stays.
- **The output chips were unreadable** (`#formats .fmt-chip.out`): the 1.7.488 background flattening had left them with `background: transparent` while their text colour was still `var(--paper)` — paper on paper. The ink background is restored.
- **On a phone**, the `+` of the formats block wrapped alone to the left (its right-hand marker takes two lines): the sign is now pinned in the corner and the marker set flush left.
- **Version drift repaired**: `help-us.html` was still stamped 1.7.492 and `VERSIONING.md` had not been bumped since 1.7.492.

### Verified
| Check | Result |
|---|---|
| Blocks 2 · 4 · 6 · 7 vs block 3 | same classes measured identical (`pp-grid` / `pp-card` / `pp-band`) |
| Cards | `#inventaire` 15 · `#use-cases` 8 · `#vs-indesign` 2 · `#formats` 2 |
| Columns | 3 / 4 / 2 / 2 on desktop, 1 at 390 px |
| Table buttons | **1** (was 2) |
| Output chips | `rgb(23, 19, 13)` on `rgb(247, 243, 236)` |
| Language leaks | **0** in `fr` / `en` / `ja` |
| Mobile 390 px | 1 column, no horizontal overflow |
| JavaScript errors | none |
| Markers | `data-sp-js="v494"`, cache tag `20260919-v494-traitement-unifie`, `CACHE_NAME` bumped |


## [1.7.493] — 2026-09-19

_A search field in the FAQ, and no background on open questions_

### Added
- **A search field in the FAQ**, between the heading and the questions: it filters the ten questions as you type and searches **all three languages at once** (each question carries its French, English and Japanese variants). A counter shows how many are left, a **Clear** button appears as soon as you type, **Escape** resets, and without JavaScript nothing breaks (the field stays, the whole list shows).

### Fixed
- **Open questions no longer get a background** (`details.faq-item[open]` was set in `paper-3`): an open question is told apart by its number, its × sign and the rule.

### Verified
| Check | Result |
|---|---|
| Open question background | measured `rgba(0, 0, 0, 0)` |
| Search | “Pantone” → 1/10 · “hors-ligne” → 2/10 · “サブスク” → 2/10 · “zzzz” → 0 with a message · Escape → 10/10 |
| Counter | “1 question sur 10” / “2 questions sur 10” / “2 / 10 件” |
| Placeholder | follows the language (fr / en / ja) |
| Language leaks | **0** in `fr` / `en` / `ja` |
| Mobile 390 px | 1 column, no overflow |
| Parity web ↔ mirror | **22 / 22 identical** |
| Markers | `data-sp-js="v493"`, cache tag `20260919-v493-recherche-faq`, `CACHE_NAME` bumped |
| Package | `sp213-local.zip` rebuilt


## [1.7.492] — 2026-09-19

_Eight aligned bars, and the sections stop sticking together_

### Fixed
- **The first and last blocks had no pink kicker** (the three applications, the screenshots), so their bar was shorter than the six others and the pile never lined up. Each has its own now — “Trois portes d’entrée” / “Une capture par outil” — and all **eight bars measure 90 px**, 30 px apart (measured: a single distinct height).
- **The bottoms of sections were at zero**: the paragraph “SuperPrint est publié par Zigmoon…” stuck to the part that follows, and the FAQ stuck to the closing call. Both sections get a real bottom again (30 to 50 px).

### Verified
| Check | Result |
|---|---|
| Bar heights | `showcase=90 · inventaire=90 · prepress=90 · use-cases=90 · comparison=90 · vs-indesign=90 · formats=90 · planches=90` — 1 distinct height |
| Kickers | 8 of 8 (18 px each) |
| Rhythm | 30 px between blocks, 30 px from the heading to the first bar |
| Section bottoms | authors 50 px, FAQ 50 px |
| Language leaks | **0** in `fr` / `en` / `ja` |
| Parity web ↔ mirror | **22 / 22 identical** |
| Markers | `data-sp-js="v492"`, `data-sp-sw="v1.7.492"`, cache tag `20260919-v492-huit-surtitres`, `CACHE_NAME` bumped |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.491] — 2026-09-19

_No chapters, one background everywhere, a held rhythm, and the FAQ back on the home page in two columns_

### Changed
- **The chapter idea is gone**: no more “Chapter 01 · …” labels nor numbers, and **“atelier” gives way to SuperPrint** in the headings of the technical part (“L’inventaire de SuperPrint”, “SuperPrint face aux grandes maisons”, “Les trois applications de SuperPrint”, “Sur la table de SuperPrint”).
- **One single background inside the blocks**: prepress was the only one set in ink (light text on black) — it is like the others now. The variety stays in the layout and the cards.
- **The rhythm is held**: the general section padding (72 to 140 px) also applied to that zone. The sections are aligned on 34–56 px, the part has no bottom padding, its heading sits 22 px above the first bar, the blocks stay 18 px apart, and the FAQ’s bottom follows the same breath.

### Added — the FAQ comes home
- The ten questions are back on the home page, **numbered and on two columns** on desktop (one on mobile), with the number hanging on the left and the `+` pinned right, so a question no longer breaks before its “?”.
- **`faq.html` is deleted** (both trees, sitemap cleaned). The navigation bar and the help page point back to `#faq`, and the home page gains the **`FAQPage`** structured data.

### Verified
| Check | Result |
|---|---|
| Kickers | no chapter numbers, no “atelier” left in the part’s headings |
| Block backgrounds | the eight `.spf-in` measured `rgba(0, 0, 0, 0)` (page paper) |
| Rhythm | heading → first bar 22 px · between blocks 18/18/18/18/18/18/18 px |
| FAQ | 10 questions, `columns: 2` on desktop (2 horizontal positions), 1 column on mobile |
| `faq.html` | HTTP 404 — the page no longer exists |
| Mobile 390 px | 1 column, no horizontal overflow, block bar 105 px, no JavaScript error |
| Language leaks | **0** in `fr` / `en` / `ja` |
| Parity web ↔ mirror | **22 / 22 identical** |
| Markers | `data-sp-js="v490"`, `data-sp-sw="v1.7.491"`, cache tag `20260919-v490-rythme-et-faq-2colonnes`, `CACHE_NAME` bumped |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.490] — 2026-09-19

_No chapters, one background everywhere, a held rhythm, and the FAQ back on the home page in two columns_

### Changed
- **The chapter idea is gone**: no more “Chapter 01 · …” labels nor numbers, and **“atelier” gives way to SuperPrint** in the headings of the technical part (“L’inventaire de SuperPrint”, “SuperPrint face aux grandes maisons”, “Les trois applications de SuperPrint”, “Sur la table de SuperPrint”).
- **One single background inside the blocks**: prepress was the only one set in ink (light text on black) — it is like the others now. The variety stays in the layout and the cards.
- **The rhythm is held**: the general section padding (72 to 140 px) also applied to that zone. The sections are aligned on 34–56 px, the part has no bottom padding, its heading sits 22 px above the first bar, the blocks stay 18 px apart, and the FAQ’s bottom follows the same breath.

### Added — the FAQ comes home
- The ten questions are back on the home page, **numbered and on two columns** on desktop (one on mobile), with the number hanging on the left and the `+` pinned right, so a question no longer breaks before its “?”.
- **`faq.html` is deleted** (both trees, sitemap cleaned). The navigation bar and the help page point back to `#faq`, and the home page gains the **`FAQPage`** structured data.

### Verified
| Check | Result |
|---|---|
| Kickers | no chapter numbers, no “atelier” left in the part’s headings |
| Block backgrounds | the eight `.spf-in` measured `rgba(0, 0, 0, 0)` (page paper) |
| Rhythm | heading → first bar 22 px · between blocks 18/18/18/18/18/18/18 px |
| FAQ | 10 questions, `columns: 2` on desktop (2 horizontal positions), 1 column on mobile |
| `faq.html` | HTTP 404 — the page no longer exists |
| Mobile 390 px | 1 column, no horizontal overflow, block bar 105 px, no JavaScript error |
| Language leaks | **0** in `fr` / `en` / `ja` |
| Parity web ↔ mirror | **22 / 22 identical** |
| Markers | `data-sp-js="v490"`, `data-sp-sw="v1.7.490"`, cache tag `20260919-v490-rythme-et-faq-2colonnes`, `CACHE_NAME` bumped |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.489] — 2026-09-19

_Clean backgrounds, a tighter pile, and the manual section leaves the home page_

### Fixed
- **The blocks kept the background of the old chapters.** The chapter ids were kept when the six chapters became one part — and their background rules with them: `#showcase`, `#comparison` and `#formats` were set in `paper-3`, `#prepress` and `#vs-indesign` in `paper-2`. The blocks therefore stood out lighter than the page, and prepress looked “not like the others”. All eight blocks are neutralised (only the rules between them remain), the watermarks that lived inside those old sections are hidden, and the frame around the comparison table is transparent too.
- **Too much air between the chapters**: 26 to 44 px of margin plus 20/16 px of padding. Measured at **18 px** now, with a **72 px bar** instead of 104 px, so the eight blocks read as one single list.

### Changed
- **The “Chapitre 02 · Le manuel” section leaves the home page** (3,900 characters): the navigation bar already leads to the documentation. The “Manual” entry of the bar and the mobile menu now points straight to `documentation.html`, on the home page, the help page and the FAQ page, and the authors move up to chapter 02.

### Verified
| Check | Result |
|---|---|
| Block backgrounds | the eight blocks measured `rgba(0, 0, 0, 0)` or the page paper (`rgb(247, 243, 236)`) |
| Old section watermarks | hidden (0 remaining inside the blocks) |
| Spacing | gap between blocks `18 / 18 / 18 / 18 / 18 / 18 / 18 px`, bar 72 px |
| Manual section | absent from the page, no `#manuel` link left, navigation leads to `documentation.html` |
| Language leaks | **0** in `fr` / `en` / `ja` |
| JavaScript | no page error |
| Parity web ↔ mirror | **22 / 22 identical** |
| Markers | `version.txt`, colophon, `data-sp-js="v489"`, `data-sp-sw="v1.7.489"`, cache tag `20260919-v489-fonds-et-manuel`, `CACHE_NAME` bumped |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.488] — 2026-09-19

_The FAQ has its own page, the manual enters the bar, every block starts folded, no lighter background_

### Added — `faq.html`
- **The ten questions leave the home page** (which kept getting longer) and become their own page, built on the same chrome as `help-us.html`: same header, navigation bar, mobile menu, footer, styles and language script. Questions are **numbered** (01 → 10) and each answer opens under its question.
- The page carries its own **`FAQPage`** structured data (it inherited the donation schema before), the bar leads to it from the home page, the help page and itself, the **sitemap** gains the URL, and the home page loses **12,300 characters**.
- The PayPal SDK inherited from the help page was removed there (it threw “Element with id js-sdk-container-… not found”).

### Changed
- **The manual enters the navigation bar, before the authors**: it only existed in the mobile menu. It is now in both, on the home page, the help page and the FAQ page. The following chapters were renumbered once more (manual 02, authors 03) so the numbering stays continuous.
- **Every block of the « Fonctions » part starts folded** — each announces what it holds by its bar, and you open the one you need.
- **No block keeps a background lighter than the page**: the cards, grids, table and chips were measured and are now transparent (only the rules remain). Two deliberate exceptions: the « Prix » row of the comparison table and the whole prepress block, which keep their ink background.

### Verified
| Check | Result |
|---|---|
| FAQ page | `HTTP 200`, 10 questions, numbered, one language shown per answer, **no JavaScript error** |
| Home page | no `#faq` section, **8 blocks, 0 open** on arrival |
| Navigation | `manuel` before `auteurs` in the desktop bar and the mobile menu, on the home, help and FAQ pages |
| Backgrounds | every block, grid, card and chip measured `rgba(0, 0, 0, 0)` or the page paper (`rgb(247, 243, 236)`) |
| Language leaks | **0** in `fr` / `en` / `ja` on the home page, the help page and the FAQ page |
| Sitemap | `faq.html` added with its three `hreflang` alternates |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing |
| Markers | `version.txt`, footer colophon, `data-sp-js="v488"`, `data-sp-sw="v1.7.488"`, cache tag `20260919-v488-faq-a-part`, `CACHE_NAME` bumped |
| Package | `sp213-local.zip` rebuilt and verified file by file, **FAQ page inside** |

## [1.7.487] — 2026-09-19

_One readable part for every feature: eight blocks, one shared bar, a different treatment inside each_

### Changed — the home page technical zone
- **Six stacked chapters became one part.** The comparison table, prepress, the tool inventory, the presses, the analysis and the formats now live in a single `<section id="features">` that follows the navigation bar, in the order the tools are used.
- **One shared bar per block** (kicker · title · marker · plus sign) with a different treatment inside each: large cards for the applications, a tight three-column grid for the fifteen tools (descriptions held to three lines), **ink** for prepress (light text on black), four columns for the presses, a framed table for the comparison, two facing columns for the analysis, chip rows for the formats, screenshots for the gallery.
- **Nothing deleted, nothing lost**: the old chapter intros moved **inside** their block and appear when it opens; the trilingual titles are the ones that were already there; the old anchors (`#showcase`, `#comparison`, `#prepress`, `#use-cases`, `#vs-indesign`, `#formats`) still land on their block; a folded block opens by itself when reached through an anchor. The following chapters were renumbered (FAQ 02, manual 03, authors 04) so the numbering stays continuous.

### Fixed
- **The language trap came back through the back door.** A class rule used to clamp the card text set a `display` on language-tagged elements and therefore beat the rule hiding the other languages: the fifteen descriptions were displayed **in French, English and Japanese at once** inside the same card. All **six language combinations** are now covered with `!important` — measured at **zero leak** in the three languages afterwards.
- **The ink block** kept a light grid behind its light text (backgrounds neutralised, contrast restored) and its band button was white on white (readable now, inverting on hover).

### Verified
| Check | Result |
|---|---|
| Structure | 8 blocks, 2 open on arrival (`showcase`, `inventaire`), 6 announced by their bar |
| Bars | one single title displayed per bar and per language — checked in `fr` / `en` / `ja` |
| Language leaks | **0** in the three languages, on the home page and on the help page |
| Contents | every block opened shows its original content (prepress grid + band, presses, comparison table + its own fold button, two columns, chips, gallery grid + “+9 tools”) |
| Anchors | `#features`, `#showcase`, `#comparison`, `#prepress`, `#use-cases`, `#vs-indesign`, `#formats` all resolve; `#cmpTable` opens the comparison block |
| JavaScript | no page error on the home page or on the help page |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing |
| Markers | `version.txt`, footer colophon, `data-sp-js="v487"`, `data-sp-sw="v1.7.487"`, cache tag `20260919-v487-partie-fonctions`, `CACHE_NAME` bumped |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.486] — 2026-09-19

_One language at a time on the home page, and a home page that follows the navigation bar_

### Fixed — trilingual display (home page and help page)
- **French had no strong hiding rule.** The site hid English and Japanese with `[data-lang="en"], [data-lang="ja"] { display: none }` (specificity 0,1,0) — a rule that **any class rule (0,1,1) beats**. Strong rules existed for `html[lang="en"]` and `html[lang="ja"]`, but not for `html[lang="fr"]`, the default language.
- **Measured consequence:** inside the ten FAQ items, **the twenty summaries of the three languages were displayed at once in the same panel**; the template grid also mixed two English kickers and four English headings into the French text.
- **The missing rule is added** — `html[lang="fr"] [data-lang="en"], html[lang="fr"] [data-lang="ja"]` (0,2,1) — **without `!important`**, so the EN / FR / JA buttons (`html .mm-lang-toggle button[data-lang] { display: inline-flex !important }`) keep showing. Checked afterwards: **zero leak in the three languages** on both pages.

### Changed — the home page follows the navigation bar
- The page carried thirteen chapters in a row. What the navigation bar offers now stays **visible** (the three applications, the tool inventory “Fonctions”, the FAQ, the manual, the authors); **the other chapters announce themselves by their title and fold away** behind a “Read on”: comparison, prepress, presses, analysis, formats, and the tool gallery.
- **Nothing is deleted and nothing is moved**: the “Chapter 0X” labels encode the document order, and folded content stays in the DOM (findable with `Ctrl+F`, readable by search engines).
- A folded chapter **opens by itself** when reached from a menu link, a shared anchor or a reload (native `<details>`, no dependency on JavaScript for opening).
- **Measured:** visible text `17,312 → 12,892` characters in French (−26 %), page height `16,678 → 13,214 px` (−21 %). Header, hero and template grid **untouched** — 133,649 characters compared character by character.

### Fixed — a name collision found on the way
- The home **already** had a generic fold (1.7.473) that scans every `[data-fold]`, looks up the id equal to the attribute value and, **if the target holds no `.is-folded`, hides the button’s parent**. The new chapter folds first carried `data-fold` too: the script took them for its own buttons and **made whole chapters disappear** (only the watermark word was left). They now carry `data-chapitre`, and the warning is written in the CSS.

### Verified
| Check | Result |
|---|---|
| Language leaks | **0** in `fr` / `en` / `ja`, on the home page and on the help page (checked on every `[data-lang]` element whose language differs) |
| Folded chapters | 6 folds, 0 open at start-up; each opens (`#prepress` 53 → 814 px) and closes back to the pixel |
| Hidden anchors | arriving on `#cmpTable` opens the `comparison` fold; a chapter opens from a menu link |
| Original folds | comparison table (8 folded rows) and tool gallery button still wired and visible |
| Header / hero | untouched character by character (133,649 identical characters, CSS block aside) |
| Help page | regenerated from the home (same `<style>`), 0 leak in three languages, form intact, no JS error |
| Visible text · height | FR 17,312 → 12,892 chars (−26 %) · 16,678 → 13,214 px (−21 %) |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing |
| Markers | `version.txt`, footer colophon, `data-sp-js="v486"`, `data-sp-sw="v1.7.486"`, cache tag `20260919-v486-home-allegee`, `CACHE_NAME` bumped |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.485] — 2026-09-19

_A local AI that can no longer lock the editor, a Tabulation tool that is actually usable, and three interface details_

### Fixed — AI assistant (measured with a real DeepSeek key)
- **The “generating” flag could stay stuck.** The spinner ran forever and **every following click was refused without the slightest message**. A reset is now exposed (`_spAiResetUI()`), a **3-minute watchdog** frees the interface, and a second click **forces the restart** past 45 seconds.
- **Element types were dropped although the model had answered.** `rect`, `square`, `textbox`, `paragraph`, `oval`, `divider`… came back as “unauthorised type”. Aliases are now **translated** to a valid type, with a console warning, instead of being thrown away.
- **Attached images never reached the page.** The prompt had asked for `type:"userImage"` since 1.7.174 and the generator had its branch, but the validator refused that type — the branch was dead code. `userImage` is now accepted, with the same size clamps as the other images.
- **The AI Studio accepts image synonyms** (`img`, `photo`, `picture`) and converts them to `image` before the document is built.

### Fixed — Tabulation tool
- **Tab in a block being edited did nothing at all.** Fabric stops the event on its hidden field before the document’s bubble phase, and the browser moved the focus out of the block (“it moves the block and does not make a tab”). The key listener now works in the **capture** phase, guarded so it never steals the key from the interface fields.
- **Two tabs for one key press.** `boot()` is called twice, so the listener was installed twice and each press inserted two tabs (traced: `insertChars` called twice). Guarded by a single flag.
- **The caret is placed after the inserted tab** — Fabric does not move it, so the next character used to land *before* the tab.
- **Tab stops are now independent, grabbable markers on the ruler** (the ruler is not an evented object and its markers lived inside it): ↔ cursor on hover, drag with a ½ mm magnet, live text reflow, Escape cancels.
- **Validation step in the panel**: target block, status line, next free position, and a “✓ Validate” button that saves (undoable) and confirms.

### Changed — interface
- **The Select tool no longer shows a grey “active” background at start-up**; it comes back as soon as Select is really chosen (Pen/Pencil menu, or the V key).
- **The paper & CMYK simulation tool is hidden while the left sidebar is collapsed**, and available as soon as the bar is open.
- **The Tab shortcut wording** (FR / EN / JA preferences, FR / EN in both documentation pages) now says that Tab **inserts** a tab.

### Verified
| Check | Result |
|---|---|
| AI fix | exercised with a real DeepSeek key: watchdog message, forced restart, tolerant types (3 console warnings), attached image placed (scaleX 1.4173) |
| Tabulation | 9 browser cases: one single tab inserted, caret after it, editing and focus kept, entry without insertion, drag with live reflow, Escape restores, status, Validate |
| Marker geometry | placement error **0.00 px** against an independent block-based computation, exact also on a block rotated 20° |
| PDF of a tabbed block | 4 lines × 4 columns, vector typography: **92 characters compared one by one, max deviation 0.01 pt**, no marker colour in the page operators |
| Interface | Select tool background transparent / white (collapsed and open), simulation tool absent when collapsed (7 tools) and present when open (8), Tab wording updated in FR/EN/JA |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing |
| `node --check` · markers | clean · version markers consistent (1.7.485) |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.484] — 2026-09-18

_The local package launcher no longer offers to install itself_

### Changed
- **The package launcher loses its “Install locally” box.** The page `npx superprint` opens still showed, under its five destinations, an “or install locally” separator, an “Install locally” panel, the `npx.cmd superprint` command, WIN / MACOS / LINUX tabs and a copy button. Inside the package itself that box is pointless — the user asked for it to go (“it does not make much sense to offer it again”). The site page (`superprint/install.html`) keeps it: that is where it makes sense, since one reaches it without having installed anything.
- **The removal happens at generation time**, in `_dev/scripts/_mk_index_paquet_480.cjs` (1 942 characters dropped from the HTML, plus the guard below), so the box cannot come back at the next rebuild of the package. The launcher keeps the same five destinations and the same CSS/JS: only the dead markup is gone.

### Fixed
- **The launcher script died without its installation block.** `applyOS()` looked up `.cmd-tab[data-os="win"]` and immediately called `tab.classList.add('active')`: with the block removed, `querySelector` returned `null` and the TypeError **killed the rest of the page script** (copy handlers, language panel, legal pop-ins). An early return `if (!tab) return;` was added.

### Verified
| Check | Result |
|---|---|
| Launcher HTML | no `.or-sep`, no `.install-section`, no `#installCmd`, no `#osIcon`, no `.cmd-tab`, no “npx” text (measured on the served page) |
| Destinations | editor, AI studio, SuperTyPo, documentation, API — **5 links, all 200** |
| Page script | **0 console error, 0 pageerror**; language switch EN → FR → EN works |
| Generator | removal + guard anchored and counted; 0 failed control; tag balance `<div>/<span>/<a>` verified |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing |
| `node --check` · markers | clean · 13 version markers consistent (1.7.484) |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.483] — 2026-09-18

_Sober sliders for the variable-font panel, a readable detached widget, and a local package that works without any CDN_

### Changed
- **The panel slider now uses the project’s canonical slider look.** The pink accent of 1.7.482 is gone (the application is black / white / grey); the sliders copy the corner-radius and CMYK sliders exactly: 4 px rounded track, black fill on the left, white thumb ringed in black, same hover and drag reactions.
- **The track is filled over the axis RANGE, not over `value / max`.** A weight axis running 300–700 starts at 25 % of the bar instead of 57 %. The fill follows the value live, in the panel **and** in the detached widget.
- **The detached “Variable font” widget gets its own 320 px layout.** It was handed the historical 200 px widget template, where its two sliders were crushed and unreadable; font sizes are raised one step, the panel’s negative margins (meant for the full-width separators of the column) are reset, and its duplicate title is hidden.

### Fixed
- **The panel and the widget no longer show two different fills for the same value.** Measured: dragging the slider *of the widget* kept the RAW dragged value (83) while the panel snapped it to the rendering step (87.5, stored as 88 because of the `step`), so the two tracks displayed 32 % and 52 % for the same value and the widget’s thumb no longer sat in front of the number it showed. `majPiste` now realigns every copy on the original slider before computing the fill (writing `.value` in JavaScript fires no `input` event, so there is no loop with the widget bridge).
- **The duplicate title in the widget is gone.** “Variable font” was written twice, one line under the other: the generic rule that hides such a label inside a widget (`.sp-dock-body > .sp-docked > label`) was losing against the `display: block !important` of the column’s “+” button, so it is now repeated with `!important` and a higher specificity. `copier()` strips the +/− button from the clone, so hiding the label takes nothing away.
- **The local package no longer calls a CDN for the Excel library.** The audit that walks the launcher and its five destination pages found the Excel library was loaded from a CDN *first*, which contradicted the “everything runs locally” promise of the `npx` installer.

### Added
- **`app/JS/xlsx.full.min.js`** — the Excel library (930 KB) is now vendored **inside the application**, like the other libraries already shipped locally (Word reading, type engine, PDF reading). `ensureXlsxLibs()` tries the local copy, then the `public/`-mounted `node_modules/@e965/xlsx` build, then the SheetJS CDN — the alert only appears when all three fail.
- **The AI studio loads Excel and WebLLM locally first too** (`app/JS/xlsx.full.min.js`, then `@mlc-ai/web-llm`, then the CDN/module-CDN fallbacks).
- **`_dev/scripts/_audit_liens_paquet_483.cjs`** — walks the six pages of the local package (launcher, editor, studio, SuperTyPo, documentation, API) link by link, resolving each URL to a file on disk with the **exact case** (macOS and Linux are case-sensitive), and checks that the launcher holds no absolute path and that `vite.config.js` declares a single build entry.

### Verified
| Check | Result |
|---|---|
| Sliders | height 4 px, fill `linear-gradient(#1a1a1a)`, `background-size: 25% 100%` on a 300–700 axis, `accent-color: auto` (no pink left, in both themes) |
| Widget | `sp-dock-host … sp-dock-large`, width **320 px**, panel margins reset, duplicate label `display: none` |
| Panel vs widget | after a drag on the widget slider: both inputs `88`, both fills `52 %`, both labels `87.5`, block instance `{wdth: 87.5}` |
| Width on screen | ink columns 70 / 60 / 53 and ink width **119 / 102 / 85 px** for width 100 / 87.5 / 75 |
| Local package links | **68 local links, 0 problem**, exact-case resolution, no absolute path in the launcher, one build entry |
| Local package chain | served from the **extracted zip**: 5 pages (`/`, editor, studio, SuperTyPo, documentation, API) loaded, **0 console error**, **66 / 66 URLs at 200**, editor canvas present |
| Offline libraries | `app/JS/xlsx.full.min.js` present in both trees and served 200 by Vite, plus `/node_modules/@e965/xlsx/dist/xlsx.full.min.js` |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing (full tree diff: 0 different) |
| `node --check` · markers | clean on both `main.js` · 13 version markers consistent (1.7.483) |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.482] — 2026-09-18

_The variable-font control becomes a detachable panel, and the PDF embeds the configured font instance (the preview applies the width at last)_

### Added
- **The variable-font control is now a full panel of the right column**, placed under the B / I / U styles and framed by a full-width separator above and below. It appears only when the selected block's font declares axes.
- **Detachable as a widget**: the “+” of its title (and the “Variable font” button of the typography card) opens it as a floating widget over the workspace, movable like the other right-hand panels; the widget and the column stay in sync in both directions, and the widget position is remembered.
- **Only the axes the preview can really drive get a slider** (weight, width). The others (optical size…) are listed for information, so as not to promise a setting the preview cannot render.

### Changed
- **The typography-card button is smaller (10 px) and breathes vertically.** It was crushed by `.rightbar .btn` (28 px high, `padding: 0 10px`, 9 px) and a long label wrapped on two tight lines; the label is now short (“Variable font”) and the height is free.
- **The font key carries the instance width** (`family|weight|style|d87.5`) and is the single source for the opentype cache, the pdf-lib embedding and the drawing. The 4th argument is optional: without it the key is exactly what it was, so **no existing document changes behaviour**.

### Fixed
- **The preview really applies the width now.** Measured cause: on canvas, assigning `ctx.font = …` resets `font-stretch`, and Fabric re-assigns that shorthand in `Text.prototype._renderChar` right before drawing each chunk. The width was therefore honoured by the *metrics* (hyphenation, tab stops, advances) but **not by the drawing** — letters came out crowded on screen, and the PDF could never match the preview. An accessor installed on the drawing context restores the width after every font assignment (the bundle contains only two `.font` assignments: `_setTextStyles` and `_renderChar` — both covered). Measured ink / drawn width for “Hamburg” at 40 px: **4 461 / 237** at 700-100, **4 028 / 205** at 700-87.5, **3 656 / 171** at 700-75.
- **The width is snapped to the CSS width step** (the only value the canvas can draw) and **that value is what the document stores**, so preview and PDF work on the same instance. Numeric check: advance measured on screen **118.48 px** = advance reported by the instancing engine **118.48 pt** for the same text at the same size.
- **The “Finished format” (pdf-lib) export embeds the instance.** Measured in the bundle: pdf-lib re-encodes the font from the object returned by the registered fontkit (`fontkit.create`, then `font.createSubset()` and `subset.encodeStream()`). Wrapping fontkit so it returns `font.getVariation(coords)` therefore puts the real outlines in the PDF. Measured on a real PDF rendered with pdf.js: “Hamburg” at 40 pt measures **119.36 pt** at width 75 % instead of **164.45 pt** on the default instance, and the ink grows from **17 436 to 26 292 px** between weight 300 and weight 700.
- **No more fake bold on top of the instance.** The old test read `usWeightClass` from the opentype font, which stays 400 on a variable font, so it concluded “not bold enough” and added a fake bold — the PDF came out twice as bold. A key carrying an instance is now recognised as already bold.
- **The hybrid jsPDF path (crop marks, colour bars, spreads) no longer vectorises those blocks.** jsPDF writes the font as it is (default instance) while the layout comes from the preview: glyphs would overlap. Those blocks are **rasterised at the exact preview rendering** instead.

### Verified
| Check | Result |
|---|---|
| Panel | appears for a variable font, 2 sliders (wght 300–700, wdth 75–100 from the real `fvar` table), “Réinitialiser” → `fontWeight` 400 and the setting removed |
| Widget | opened from the “+” **and** from the button; widget slider drives the block (`spVarFont` updated) and the column slider follows; both labels in sync |
| Width in the preview | ink / drawn width 4 461/237 → 4 028/205 → 3 656/171 for width 100 → 87.5 → 75 |
| Weight in the preview | ink 2 574 / 4 461 for weight 300 / 700 at the same width |
| Width in the PDF | text item **119.36 pt** at width 75 (default instance: 164.45 pt) |
| Weight in the PDF | ink 17 436 → 26 292 px between weight 300 and 700 |
| `.sp` round-trip | written by `saveProjectSP_toObject()` with `spVarFont`, restored by `loadProjectSP()` after the property was deleted |
| `.json` | same whitelist (`SP_CUSTOM_PROPS`) and same loader as the `.sp` |
| Studio trip | app → studio: `spVarFont` on the element; studio → app: present in the re-written `.sp` |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing |
| `node --check` · markers | clean on both `main.js` · 13 version markers consistent (1.7.482) |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.481] — 2026-09-18

_Tab stops visible on the ruler, the Tabulation panel working again, and a variable-font control_

### Fixed
- **The tab-stop ruler showed no mark for the stops.** The band was drawn, but a stop was only a small symbol on its lower edge. Each stop now carries a vertical line through the band, an **arrow pointing down at the text** and the symbol of its type (left, centre, right, decimal), in a strong colour — the stop is located at a glance.
- **The Tabulation panel looked dead**: the checkbox “tab stops active on the block”, “+ Stop” and “Clear” did nothing (and the checkbox unchecked itself). Cause measured: the panel searched the selected block in *the last canvas it had remembered* (`window._spLastCanvas`), which the application overwrites as soon as another canvas asks for its active object (text measurement, page switch…). The panel now asks **every known canvas** and keeps the one carrying a selection; the ruler and the controls therefore always act on the block you selected.
- **Wiring and feedback**: the panel is wired by delegation on its container (it survives its elements being rebuilt, where a page reload used to be needed), the row “×” removes the right stop (it used to aim at the wrong one after a removal in the middle of the list), and when no text block is selected the buttons are greyed out with an explicit message.

### Added
- **Variable font control.** When a text block uses an imported font that declares axes, a “Variable font” button appears under the font list and opens a popin with one slider per axis (weight, width, slant) plus the axis range. Detection is real: the file's `fvar` table is parsed (no guess from the name) — measured examples: `Bahnschrift` → weight 300–700 + width 75–100 %, `Segoe UI Variable` → weight 300–700 + optical size 5–36.
- **The variation is really applied, not merely stored.** The font is re-registered with its weight/stretch **ranges** so the browser instances the axis (canvas `fontVariationSettings` was measured to be accepted but ineffective). Ink measured on the drawn text: 3482 / 4666 / 5997 pixels for weight 300 / 400 / 700; width 524 → 386 at “width 75 %”. The setting is stored on the block (`spVarFont`) and travels with `.sp`, `.json` and copy-paste.

### Verified
| Check | Result |
|---|---|
| Tab ruler | 4 stops of 4 types: line + arrow + type symbol each, drawn above the block, never exported |
| Tabulation panel | checkbox → `active`, “+ Stop” → 1 stop, “Clear” → 0, row “×” → the right stop, **0 JS error** |
| Variable font detection | `Bahnschrift` (wght + wdth), `Segoe UI Variable` (wght + opsz) read from the real `fvar` table |
| Variation applied | ink 3482 / 4666 / 5997 (wght 300 / 400 / 700) · width 524 → 386 (wdth 75) |
| Known limit (documented in the popin) | the “Finished format” PDF export embeds the font as-is → default instance |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing |
| `node --check` · markers | clean on both `main.js` · 13 version markers consistent (1.7.481) |
| Package | `sp213-local.zip` rebuilt and verified file by file |

## [1.7.480] — 2026-09-18

_Tab stops and columns reach the PDF, and the local package opens on its launcher with a single AI-studio entry_

### Fixed
- **Tab stops and columns were ignored by the PDF export.** Both export chains drew a text line in one single run, so the tabs only existed in the editor and the preview. Measured on a real PDF: a column announced at 130 pt came out at 43.8 pt — the width of the first word. The pen advance now comes from the same function as the editor (`spTabAvance`), and the measured values match everywhere: 0 / 130 / 220.4 / 313.3 pt for stops left 130, right 240 (the text really aligns on 240) and decimal 330.
- **The jsPDF chain lost the column offset on justified lines.** A justified line started at 0 instead of the block left edge, so every column fell back on the block margin. The loop now starts at `xStart` (the pdf-lib chain, used by default, was already correct).
- **The legacy local-studio engine could not be compiled.** `sp213-local/src/main.js` declared `const effEl` and then assigned to it: esbuild rejected the file (“Cannot assign to `effEl` because it is a constant”), so Vite's dependency optimisation failed at startup and `npm run build` was broken. Fixed (`let`). The engine was no longer used — the application's studio does the job — and its page has been removed (see *Removed*).

### Added
- **The local package now opens on its launcher.** The home page of the package installed by `npx superprint` was the old pre-home, with no version number and always behind: it is now the website launcher (`install.html`), adapted to the package with ten rewritten links and nothing else. Five rows: application, AI studio, SuperTyPo, documentation, API.
- **A map of the package**: `CONTENU.txt` at the root of the zip says where the launcher, the application, the studio and SuperTyPo live, and lists the local addresses once the server is running.

### Removed
- **`sp213-local/studio.html`,** a duplicate of the application's studio: the one bundled with the app (`public/superprint/sp213-studio.html`) already runs locally — models executed on your machine through WebLLM (no key, no network once the model is cached) — or with a Groq key for the cloud. Its build entry went with it: `vite.config.js` now declares `index.html` only.

### Verified
| Check | Result |
|---|---|
| Tab stops in the PDF (pdf-lib, default) | 0 / 130 / 220.4 / **313.3 pt** — identical to the editor and the preview |
| Tab stops in the PDF (jsPDF hybrid) | same four values, plus the justified-line offset fixed |
| Known limit (documented) | the jsPDF chain re-wraps its own lines (hyphenation) → column 2 of a 2-column block can stay empty |
| `.sp` / `.json` round-trips | tab stops, columns and margins preserved, geometry identical |
| Package audit | every file of the zip byte-identical to the working folder; the site copy embedded in the package identical to `superprint/` |
| Installer test | zip extracted into a clean folder then served by Vite: launcher (5 rows), application (badge v1.7.480), local AI studio and SuperTyPo open with **0 console errors** |
| Build | `npm run build` passes and emits the launcher page |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing |
| `node --check` · markers | clean on both `main.js` · 13 version markers consistent (1.7.480) |

## [1.7.479] — 2026-09-18

_Small / large margins applied again, a graduated tab-stop ruler, and a 22-release catch-up_

### Fixed
- **The “small margin / large margin” fields of the sidebar were ignored.** One margin was stored under two names at once (`inner`/`left` for the small margin, `outer`/`right` for the large one). The four sidebar fields wrote `left` and `right`, while the engine read `inner` and `outer` first — so the typed value was discarded. Top and Bottom worked; the small and large margins had been dead since 1.7.469. A margin now has a single slot with two names, so writing either one updates the same value (measured: 8 of 10 checks failed before, 10 of 10 after).
- **Changing a margin wiped a sheet’s guides on double pages.** The sidebar ran the single-page margin routine on spread canvases, replacing the two mirrored guides with one page-wide rectangle. It now goes through the same single entry point as the rest of the application, and the optimisation guard compares a signature of all four margins (`20/20/10/30`) instead of the single maximum.
- **A page alone on the left used right-hand geometry**, so its two margins came out swapped. That case — the last page of an even document — is now treated as a verso: large margin on the trimmed edge, small margin on the fold side. Measured on a 4-page document (small 8 mm / large 32 mm): page 1 → 8 mm, sheet [2-3] → 32 mm left / 8 mm right, page 4 alone → 32 mm.
- **Runaway “Guide removed accidentally, restoring…” loop.** The safety net that rebuilds a spread’s guides expected 8 guides where a healthy sheet holds 7, so it considered itself short every time: it removed and rebuilt the guides every 100 ms, endlessly — the log grew and the tab stopped responding. Deliberate removals are now flagged, and the threshold is correct (measured: 0 warnings while creating a 4-page document and while changing a margin on a double page).

### Added
- **A graduated ruler above the text block shows where the tab stops are.** Millimetre ticks every 10 mm, numbers every 50 mm, the default step as short ticks, and one symbol per stop — left, right, centred, decimal. It is attached to the block (zoom, dragging, resizing, rotation) and repositioned rather than rebuilt when nothing changed. It shows while the Tabulation window is open or when the selected block carries stops, and is flagged “do not export”: it never enters `.sp`, `.json`, the autosave, the PDF or the PNG.
- **Catch-up release notes for 1.7.458 → 1.7.478** (21 releases that had no entry): text block columns and per-side margins (1.7.458–459), text wrap in both PDF exports and the divider of the collapsed sidebar (1.7.460–462), the reworked home page with the 43-template carousel and the trilingual legal pop-ins (1.7.463–467), the home page becoming the superprint.cc entry page with per-language canonical/hreflang and a rebuilt sitemap, the print-shop cursor, the “Help us” page, the authors section (1.7.468–472), then the fix for templates losing their photos, the simplified home page, the “Take part” naming, the pixel-adjusted collapsed-sidebar logotype, preloaded critical fonts and refreshed structured data (1.7.473–478).

### Verified
| Check | Result |
|---|---|
| Margin model | 10 / 10 audit checks (2 failures before), 6 keys serialised, `structuredClone` clean |
| Margin guides, 4-page document | page 1 → 8 mm · sheet [2-3] → 32 / 8 mm · page 4 alone → 32 mm |
| Guide-restore warnings | **0** while creating the document and while changing a margin on a spread |
| Tab-stop ruler | 1 group, 34 children, left edge on the block’s left edge, 5 px above, not serialised, not exported |
| Parity web ↔ mirror | **22 / 22 identical**, 0 different, 0 missing |
| `node --check` | clean on both `main.js` · version coherence 13 / 13 markers |
| Local package | `sp213-local.zip` rebuilt and verified |

## [1.7.456] — 2026-09-16

_A squarer top bar, a search button where you expect it, and a full advanced search panel_

### Changed
- **Toolbar boxes are true squares now.** Measured before: `+` was 28.1 × 32 px (ratio 0.88), `−` 31.3 × 32 (0.98), `⚙` 29.1 × 32 (0.91) — taller than wide, which is exactly what made them look rectangular. All four icon buttons (`+`, search, `−`, preferences) are strict **32 × 32** squares with `padding: 0`; `Page +` and `EXPORT` keep their label at the same 32 px height.
- **The vertical rule between `+` (new document) and `Page +` is gone**, in the markup and in the CSS.
- **Search button in the top bar**, right after the AI assistant: borderless (`border: 0`), `rgb(26,26,26)` like the print and AI icons (it used to be `rgb(85,85,85)` with a grey 1 px frame), 1.8 px stroke, 32 × 32. It opens Find & replace — the real shortcut is **Ctrl+F** (Ctrl+H opens it with the replacement field).
- **“Replace” is black and sits on the same row as “Replace all”** (the black style used to span a full grid row, pushing the two buttons apart).
- **New project pop-in**: the obsolete **Automatic** tab is removed — button, panel and the three functions (`npAutoGenerate`, `npAutoRandomPrompt`, `_npRenderChips`) that only lived for it; the **Studio IA** and **SuperTyPo** tabs now show their logo (15 px, two-colour SVG, no background plate, checked on light **and** dark).

### Added
- **Advanced options in Find & replace.** The row with the chevron widens the window from 400 to 470 px and reveals: **match case**, **whole words**, **regular expressions**, **whole-document / current-page** scope, **eleven special characters insertable in one click** (non-breaking space, narrow non-breaking space, discretionary hyphen, forced line break, tab, typographic apostrophe, French quotes, em dash, en dash, middle dot, ellipsis) and **three French typography checks** (ordinary space before `; : ! ?`, repeated spaces, space before a comma or a period).
  - The matcher was rewritten: each match now stores its **real length**, so highlighting and replacement stay exact in regular-expression mode, and capture groups (`$1`, `$2`…) work in the replacement; an invalid pattern reports “Expression régulière invalide” instead of failing silently.
  - Whole words are boundary-checked against Unicode letters (accents included) and digits; “whole document / current page” maps the scope through `bleedInfo`, so it also works in spread mode.
  - The opened/closed state is remembered (`sp_fr_adv`), and the panel keeps its screen width on mobile (measured 676 px at a 700 px viewport).

### Fixed
- **The dark theme made the active tab label invisible.** `npSwitchTab` wrote the tab colours as hard-coded HEX, so the active tab and the two action tabs rendered `rgb(26,26,26)` on a `rgb(12,12,15)` modal body — black on black. Colours are now theme-aware (`#f2f2f2` / `#8f8f8f` in dark).
- **Three files had been stuck on old versions for dozens of releases**: `app/landing.html` (1.7.404 — JSON-LD, feature tag and footer), `app/llms.txt` and `app/llms-full.txt` (1.7.404). Bumped and checked, and flagged in `VERSIONING.md`.
- **Documentation**: the 214 line numbers of the function table were regenerated from the real `main.js` (28 of them had moved since the previous release) and the four dated footers per file were updated — on all four copies.

### Verified
| Check | Result |
|---|---|
| Toolbar icon boxes | `+` / search / `−` / `⚙` = **32 × 32, ratio 1.00** (measured in the browser) |
| Search button | border `0px none` · colour `rgb(26,26,26)` · stroke `rgb(26,26,26)` at 1.8 px · sits right after `#openAIBtn` |
| Replace / Replace all | both `rgb(17,17,17)`, same row, same width |
| Advanced panel | 400 → **470 px** wide, chips laid out 7 + 4 per row, always fully on screen |
| Mobile ≤ 760 px | panel 676 px wide on a 700 px viewport, no overflow |
| Special characters | clicking the chips inserts exactly `U+00A0` and `« »` (`U+AB U+A0 U+BB`) |
| Search engine | `bonjour` finds “Bonjour”, 0 with match case · `n.j` literal 0 / regex 1 · invalid regex reported |
| Inline handlers | **102 handlers, 0 orphan** · web ↔ mirror parity **16/16** · recursive sync **0 different** |

- Cache: JS/CSS `20260916-v456-release` · service worker `superprint-shell-v1.7.456-no-whatsapp` (app **and** root).
- Version **1.7.456** follows 1.7.455 (text blocks / Studio round trip), whose notes are below.

---

## [1.7.455] — 2026-09-16

_Text blocks keep their frame, the PDF export is faithful, and the SP213 Studio round trip loses nothing_

### Fixed
- **Changing the size or the leading resized the text frame.** Measured: a 300 × 160 px block went 14 → 30 → 60 pt and back and its frame **stayed at 166.62 px** — an auto-height block still follows its content.
  - The mask no longer slices the last line: it now snaps to **whole lines** (it used to cut **6.95 px** under the previous line) and leaves a 0.4 px margin below it.
  - The leading no longer shifts around an enlarged word on click or move: `getHeightOfLine` reused cached line heights computed **during** the previous wrapping pass.
- **A bigger word enlarged the whole block in the PDF export.** The export took that single word's size as the block size (measured: **15 text blocks at 30 pt** instead of 14 pt). The heuristic now only applies when the inline size covers ≥ 90 % of the characters.
- **The last line was missing from the PDF.** `obj.height` excludes the leading below the last line (deficit measured 2.71 → 12.43 px depending on `lineHeight`), so 5 lines on screen produced **4 text blocks** in the file. Fixed in both the clip mask and the exporter through the shared `spTextMetrics` / `spCountVisibleLines` helpers.
- **The bleed was applied twice in CMYK.** The whole page shifted **5 mm** down and right when bleed was requested without crop marks. After the fix the offset is +8 pt, i.e. exactly the 3 mm of bleed.
- **The SP213 Studio round trip lost settings.** App → Studio → App returned a recalculated height with **no** `_fixedWidth` / `_fixedHeight` marker (so the block resized again at the first typography change), dropped per-character styles (an enlarged word came back at block size) and forced `colorMode` back to `rgb`. All three are now transported, with the Studio restoring the frame and position **exactly** (measured 28.5039 / 42.5197 px, 300 × 120 px) and keeping the original colour mode.
- **“Open from computer” restored neither spot colours nor embedded fonts** in a project file. Fixed and verified (ink registry went from `#FCEE21` to the file's real ink).
- **`breakWords` and `splitByGrapheme` were serialised nowhere**, so the first layout after reopening a `.sp` / `.json` stopped breaking long words. Now serialised as their effective value and restored **before any measurement**.
- **Mobile Studio**: the bar under “OPEN IN SUPERPRINT” is entirely white (the dark theme stays dark).
- **Documentation**: the manual described `.sp` as a ZIP archive although `saveProjectSP` writes plain JSON (`application/x-superprint+json`); all **214** line numbers of its function table were stale (213 wrong) and are regenerated from the real code.

### Verified
| Check | Result |
|---|---|
| Frame height, 14 → 30 → 60 → 14 pt | **166.62 px constant** (measured on the real UI path) |
| Text block on screen / in the PDF | **5 lines / 5 lines** (was 5 / 4) |
| Bigger word in a 14 pt block | `A:14 A:14 A:14 B:30 B:30 B:30 C:14` (was 15 blocks at 30 pt) |
| Bleed without crop marks (CMYK) | +8 pt = 3 mm exactly (was +17 pt) |
| App → Studio → App round trip | frame, position, per-character styles and CMYK mode returned **identical** |
| Manual date / version markers | 13/13 coherent · web ↔ mirror parity **16/16** · recursive sync **0 different** |

- Cache: JS `20260916-v455-release` · shared module `JS/sp-doc-import.js` · service worker `superprint-shell-v1.7.455-no-whatsapp` (app **and** root).
- Versions **1.7.415 → 1.7.454** are grouped in the release page recap (“Since 1.7.422”), published at https://app.zigmoon.com/release.html — each one also carries its own git tag.

---
## [1.7.414] — 2026-09-14

_Text blocks stay stable when the typography changes, and the last line is no longer clipped_

### Fixed
- **The last line of a flowed text block was clipped.** Measured: the blocks produced by the bulk-paste flow held **26 visual lines (406.8 px) inside a 400 px frame**, so the mask shaved **6.8 px** off the bottom of the last line — while the first block was fine.
  - Root cause, measured: the wrapping engine reads hyphenation by strict comparison (`enableHyphenation !== false`), so **`undefined` means “hyphenation ON”**. But `toObject()` wrote `!!undefined` = **`false`**. A fresh block was therefore **measured with hyphenation** (1,286 characters fit) and **rendered without** (1,235 fit) — exactly one line, 15.73 px. The first block escaped by chance: its content happened to fit in 25 lines either way.
  - Fixed by serialising the **effective** value (true unless explicitly false), which makes a JSON round-trip neutral for layout.
  - Also fixed in the flow: `if ('enableHyphenation' in bloc)` is **false** on a new Textbox (the property does not exist on the prototype), so the “Hyphenation” option was **never** applied. The value is now always set explicitly, inside *and* outside the typography branch.
- **The text frame grew and never came back.** Changing the line height grew the frame (300 → 311.88 px) and it then **stayed** at 311.88 px although the content fell back to 212.44 px (16 pt) and then 162.72 px (12 pt) — the “the text changes size” symptom.
  - Cause: `spReflowWithSafeHeight` used `max(fixedH, orig)` as the floor, where `fixedH` is the **current** height, hence already grown. Every growth was permanent.
  - Fixed with a **reversible reference height** (`_spReflowBaseH`), redefined only when the current height is not the one this code imposed — i.e. when the user resized the block by hand. Measured: 300 → 311.88 → **300** → 300 → 300, and a manual resize to 500 px is respected.
  - Second-pass defect found while measuring: the handlers call this function **twice** (immediately, then deferred at 0 ms and 30 ms) with a `fixedH` captured **before** the first call, so the second call took a stale height as a new reference and pushed the frame back up to 311.88 px. The function now reads the object’s **current** `_fixedHeight` instead.
- **Part of the text kept a different line height.** Applying a line height **on a selection** wrote one style per character (measured: **120** entries `{"lineHeight": 2.5}` for 120 selected characters). Those styles **survived** a block-level line-height change: measured line heights of `[33.9 ; 18.08 ; 18.08 ; …]` — the user saw “part of the text change size”.
  - Fixed with `removeInlineLineHeightStyles`, the counterpart of `removeInlineFontSizeStyles`, which only existed for font size. Measured after the fix: **0** residual styles and uniform line heights `[18.08 ; 18.08 ; 18.08 ; …]`.

### Verified
| Check | Result |
|---|---|
| Flowed blocks, 20,000 characters | **25 lines / 391.07 px** in a 400 px frame — **−8.93 px** of margin (before: 26 lines / 406.8 px, **+6.8 px** of overflow) |
| Flow, 200,000 characters → 154 pages | every block inside its frame; **0** block with content taller than its frame |
| Hyphenation across a save/load round-trip | preserved (`true`) instead of silently lost |
| Frame height, 300 px block, 24 → 16 → 12 → 16 pt | 300 → 311.88 → **300** → 300 → 300 |
| Manual resize to 500 px, then a line-height change | stays at **500 px** (the user’s decision wins) |
| Line height on a 120-character selection, then a block-level change | 120 styles → **0**; heights `[33.9 ; 18.08…]` → `[18.08 ; 18.08…]` |
| Non-regression | small paste and bulk-paste flow unchanged; `node --check` clean on both copies, web/mirror parity **14/14**, **13/13** version markers, no live residue, package **56,311,572 bytes** verified by extraction |

- Cache: JS `20260913-v414-typographie-stable` · shared module `20260914-v414-typographie-stable` · service worker `superprint-shell-v1.7.414-no-whatsapp` (app **and** root).

## [1.7.413] — 2026-09-14

_Bulk paste: the interface no longer freezes, and pasting hundreds of pages now offers layout options_

### Fixed
- **The interface froze after chaining about three pages of pasted text.** Measured first — and the reported cause turned out **not** to be the culprit: there is **no `getData('text/html')` anywhere in the code**, so Word styles never reach a text block through Ctrl+V. The real cause is the **cost of text wrapping**, which is strongly super-linear. Measured on a 300 × 400 px block in Open Sans 14 pt (`initDimensions()`):

  | Characters | Time |
  |---|---|
  | 1,000 | 1.9 ms |
  | 20,000 | 17.6 ms |
  | 50,000 | 45.8 ms |
  | 120,000 | 1,130 ms |
  | 300,000 | 8,270 ms |

  The binary search for the cut point started at `fullText.length / 2`: for 600,000 characters (about 200 Word pages) the **first** probe alone measured 300,000 characters (~8 s) in a block that only holds about 2,500. Multiplied by ~20 probes and by the number of blocks, the interface froze.
- **Fixed — the search window is now bounded.** A single 4,000-character probe estimates the block capacity, then the binary search runs inside roughly 1.6× that capacity, widening and retrying (at most six times) if the bound is reached. A final linear climb recovers the **exact** cut point, because line height steps by whole lines and therefore defeats a binary search.
- **`splitTextToFit` no longer measures the whole text first** ("does everything fit?"). At 600,000 characters that single test cost about 40 s before pagination had even started.
- **`estimatePagesForText` no longer re-measures the remaining text on every page.** The block capacity is estimated once and only a bounded window is ever sliced.

### Added — bulk paste options
Pasting more than 3,000 characters into a text block now opens a **bulk paste panel before anything is inserted**, offering:
- **Style breaker** (flatten styles) — measured: per-character styles slow wrapping down by **2.9×**;
- **Typography** — body size, leading, justification, hyphenation;
- **Distribution** — everything in this block, or **flow across chained pages**, with pages and linked blocks created automatically;
- **Automatic document margins** for every new block;
- **Paragraph indents** — first line, left, right;
- **Live progress bar with a stop button**, plus a preview of the text.

### Verified
| Check | Result |
|---|---|
| `getFittingTextIndex`, 200,000 characters | **47 ms** (was: several seconds — the first probe alone measured 100,000) |
| Cut-point accuracy vs the unbounded reference | **identical** (six block sizes, 8–30 pt); the returned index always fits and index + 1 never does |
| Chained reflow, 4 blocks, 20,000 characters | **88 ms** (was 299 ms) |
| Chained reflow, 4 blocks, 50,000 characters | **77 ms** (was 547 ms) |
| Chained reflow, 4 blocks, 200,000 characters | **59 ms** (previously unusable) |
| Flow, 200,000 characters into **153 pages** | **13.95 s**, **0 characters lost**, **1 trailing empty page** |
| "Everything in this block", 20,000 characters | **645 ms** |
| Small paste (500 characters) | **not intercepted** — normal paste untouched |
| Progress / stop | page counter and percentage update live; stopping keeps the remaining text in the last block |

- Three further defects were found and fixed while measuring: new blocks inherited a `_fixedHeight` of **13.56 px** (an empty block's height), which overrode `_maxTextHeight` — page 1 received 1,072 characters while every later page received **48**; `renderAllPages()` destroys every canvas, so the departure block was orphaned (1,283 characters lost, first page empty); and flowing one page at a time meant only the **first and last** pages kept their content.
- `node --check` clean on both copies, web/mirror parity **14/14**, **13/13** live version markers coherent, no live residue, package regenerated (**56,309,703 bytes**) and verified by extraction.
- Cache: JS `20260913-v413-collage-masse` · shared module `20260914-v413-collage-masse` · service worker `superprint-shell-v1.7.413-no-whatsapp` (app **and** root).

## [1.7.412] — 2026-09-14

_Colour picker on Safari: the window now opens under the eyedropper button instead of the bottom-left of the screen_

### Fixed
- **The fallback colour field was never positioned.** The `EyeDropper` API (a real screen eyedropper) only exists on Chromium. On Safari the fallback created a 1×1 px colour field and positioned it **only if the target button’s width was non-zero**:
  ```js
  if (r && r.width) { proxy.style.left = ...; proxy.style.top = ...; }
  ```
  As soon as the targeted button was hidden (width 0), `left`/`top` were **never set**: the `position: fixed` element stayed at its **static** position (last child of `<body>`), i.e. **at the bottom-left of the screen** — exactly the reported defect. A 1×1 px element also gives the system nothing to anchor its panel to.
- **The window is now the application’s own, anchored under the pipette.** A self-contained **“Couleurs” window** (no dependency): saturation/lightness area, hue slider, preview, hex field and a 12-colour swatch row. It opens **under the clicked button**, right edge aligned with it, and flips above when there is not enough room below. Being an app element, its placement no longer depends on the OS. Escape and outside-click close it (no `scroll` listener — a Mac trackpad fires dozens of them and would close the window the instant it opened). A **“Sélecteur système…”** button still gives access to the macOS panel. Each pipette now passes the **actually clicked element**, so anchoring no longer depends on `colorMode`.
- **In RGB mode the pipette replaced the picked colour with white.** Found while testing the above. `pick()` called `_applyCmykSliders()`, which **recomputes** the hex from the CMYK sliders. In RGB mode no sync takes place, so the sliders kept their default `0/0/0/0` values → `_cmykToHex(0,0,0,0)` = `#ffffff`. Measured: clicking `#0EA5E9` gave `#blockFill = #ffffff`, painting the object white. The picked colour is now applied directly in RGB mode.

### Verified
| Check | Result |
|---|---|
| Window position (RGB and CMYK) | **under the pipette** (gap < 20 px), right edge aligned, fully inside the viewport |
| Swatch `#EF4444` | `#blockFill = #ef4444` (exact) |
| RGB, swatch `#0EA5E9` | `#blockFill = #0ea5e9` — no more white |
| Saturation/lightness drag | `#056591` · hue `120` → `#9bff9b` · typing `#FF8800` → `#ff8800` and the hue slider snaps to 32 |
| Opening the window | applies nothing and does **not** clear the “no fill” flag (measured: flag stays `true`) |
| Escape / outside click | closes |
| **Chromium non-regression** | with `EyeDropper` present the API is called and the in-app window stays hidden |
- `node --check` clean on both copies, web/mirror parity **14/14**, **13/13** live version markers coherent, package regenerated (**56,298,968 bytes**) and verified by extraction.
- The bump script **no longer rewrites the version inside `main.js`**: its 15 occurrences of `1.7.411` are **all historical comments** (`// v1.7.411 - …`). Only the shared-module cache tag is updated there.
- Cache: JS `20260913-v412-pipette-couleurs` · shared module `20260914-v412-pipette-couleurs` · service worker `superprint-shell-v1.7.412-no-whatsapp` (app **and** root).

## [1.7.411] — 2026-09-14

_Large formats: page unit no longer tied to the UI language, and PDF import adapts its render scale_

### Fixed
- **The page unit was inferred from the UI language instead of the unit selector.** Measured: with an English interface, typing `1115 × 1875` produced a canvas of **28321 × 47625 mm** — a blank screen, nothing rendered any more. The handlers converted via `currentLanguage === 'en' ? inToMm(v) : v`, while the field displayed the label “W (in)” although **no “in” button exists** (the selector only offers mm / cm / px). The real unit (`currentUnit`) was ignored.
  - Fixed with two helpers, `spPageUnitVersMm()` / `spPageMmVersUnite()`, which read the **unit selector**. Applied to all four fields: width, height, margin, bleed.
  - **Bleed was converted by language as well** (same defect, found in a second pass): 3 mm typed gave **76.2 mm** in the exported PDF (3 read as 3 inches).
- **PDF import rendered at a hard-coded scale of 6.0.** Measured: a 1115 × 1875 mm page needed a **605 Mpx** canvas, while `toDataURL()` fails beyond roughly **250 Mpx** (250 OK, 300 fails) and returns an empty 6-byte string. The imported page vanished silently.
  - The scale now adapts to the page format, capped at **220 Mpx**.
  - An explicit message is emitted when the browser still refuses the image (“Image PDF trop grande pour ce navigateur”), instead of a silent no-op.
- **Large-format warning** beyond a 16000 px side, emitted once every 15 s, so the user knows where the browser limit lies.

### Verified
- English interface, `1115 × 1875` → **1115 × 1875 mm**, canvas **4766 × 7997 px**, centre pixel white (page actually rendered). Back to `210 × 297` → **210 × 297**. `spPageUnitVersMm('1115')` → **1115**.
- **Justified-block non-regression** (1.7.410): justified block still **34 px clipped** before, **0 px** after; a 40 px frame still clips 91 px of content.
- `node --check` clean on both copies, 13/13 live version markers coherent, web/mirror parity **14/14**, package regenerated (**56,293,733 bytes**) and verified by extraction.
- Cache: JS `20260913-v411-grands-formats` · shared module `20260914-v411-grands-formats` · service worker `superprint-shell-v1.7.411-no-whatsapp` (app **and** root).

## [1.7.410] — 2026-09-14

_Letters are no longer clipped on the right edge of a justified text block_

### Fixed
- **The rightmost glyph of a justified line was being shaved.** Measured on a 300 px block holding the same text, changing only the alignment — the right edge of the **ink** at render time:

  | Alignment | 12 pt | 18 pt | 24 pt |
  |---|---|---|---|
  | Left-aligned | 291 px | 291 px | 294 px |
  | **Justified** | **302 px** | **304 px** | **307 px** |

  Justification pushes the line **right up to the edge** (advance = block width), so the last glyph’s ink overshoots its advance by **+2 to +7 px** depending on size (the sidebearing of `t`, `e`, `r`). The mask was laid exactly on the block width and clipped that overshoot. Comparing images with and without the mask over 12 cases: ink lost in **4 cases, up to 8 pixels, always exactly on the right border**.
- The mask exists to stop a **layout overflow** (extra lines vertically, a word wider than the block). It must not shave glyph **sidebearings**, which are a normal, invisible overflow of the ink area alone.
- The mask now carries a **side margin proportional to the type size**: `max(2, fontSize × 0.32)` — 3.84 px at 12 pt, 5.76 px at 18 pt, 7.68 px at 24 pt. That covers the measured overshoot (7 px max) and stays invisible (≈ 0.65 mm at 300 dpi).

### Verified
- Ink beyond the block: **+2 / +4 / +7 px before → 0 px after** on all six measured cases.
- Pixels lost sideways: **0** — none lost, including on the right border.
- **Mask non-regression**: a block with a 40 px fixed height holding 91 px of text is **still clipped to 40 px** (ink 91 → 40).
- 13/13 live version markers coherent, 0 leftover, web/mirror parity 14/14, dist rebuilt at 1.7.410, package (56,291,729 bytes) regenerated.

## [1.7.409] — 2026-09-14

_With no format asked, the layout takes the document's own — and mm, cm, pt and A0–A8 are understood_

### Added
- **Paper size is read from the file structure**, never guessed from text:
  - `.docx` → `word/document.xml`, `<w:pgSz w:w w:h/>` (twips) — **never read before**, which is why a Word file could not hand over its page setup;
  - `.odt` → `styles.xml`, `<style:page-layout-properties fo:page-width/height>` (the size is *not* in `content.xml`);
  - `.rtf` → the `\paperw` / `\paperh` header (already read).
- **Units and ISO formats**: `mm`, `cm`, **`pt`** (1 pt = 25.4/72 mm), `in`/`inch`, decimal commas, and **A0 to A8**. `A4` in capitals is recognised on its own; in lower case a keyword is required, otherwise the French article “a” would be mistaken for a page size.

### Fixed
- **A `.docx` attached to the AI bar was laid out instead of being read.** Measured: **0 attachments, 0 characters sent** — and the document's texts appeared **on the canvas**, because the app pointed the shared module at its *canvas importer*. The studio had its own reader, so the same file behaved differently in each tool. The reading logic now lives in the module itself (single source), so app and studio behave identically: the Word file becomes an attachment (structured text + images) and the canvas is left untouched.
- **The page size used to be read from the document's own prose.** A regex over the attachment block picked up any “W × H mm” it found — measured **2 false positives out of 5**: a line reading “print at 100 × 150 mm” or a table cell “300 × 400 mm” was taken for the page setup. The size now comes from the structure, and the text fallback only accepts the `FORMAT : …` line written by the decoders.
- **Priority order, stated plainly**: your requested format → the document's format → the current format (unchanged). Nothing changes silently.

### Verified
- 21/21 checks against the real code (structured size, body ignored, `FORMAT` fallback, units, priority).
- Browser, A5 `.docx` dropped into the actual import field: **1 attachment, 328 characters, size `148×210` read via `w:pgSz`**, canvas untouched (3 objects before and after).
- 4/4 on the final format: no request → **A5 from the document** (starting from A4); request A4 → 210×297; A3 landscape → 420×297; “420 × 595 pt” → 148×210.
- 13/13 live version markers coherent, 0 leftover, web/mirror parity 14/14, dist rebuilt at 1.7.409, package (56,291,145 bytes) regenerated.

## [1.7.408] — 2026-09-14

_Your requested page format is now honoured, even with a Word or RTF file attached_

### Fixed
- **The attached document used to override your requested format.** When you asked to reuse the text from a **Word** or **RTF** file, it was the format **of that file** that got applied. An RTF exported from a word processor announces its own page setup — `FORMAT : A4 paysage (297 x 210 mm)` — and that figure was read as **your** instruction, overriding the “A5” you had just typed. Measured with the real detection function: prompt “A5” + such an RTF gave **297×210 instead of 148×210**, and a prompt with no format at all picked up **210×297** from a document merely mentioning “A4”.
- **Setting the format _before_ typing the prompt changed nothing**, for the same reason: the value was rewritten once the file was attached.
- **The application's own attachment note was counted as your request.** `_spDocBuildContext()` told the model “about 12 page(s)” as a plain **volume measurement**, and the page-count detection read that sentence as a 12-page request. The wording no longer reads as a pagination instruction.

### Changed
- **Your request is now the only source of truth** for format, orientation and page count. Attached file contents are treated as **documentary reference**, never as an instruction, and the attachment block is explicitly delimited (`=== PIECES JOINTES UTILISATEUR` … `=== FIN DES PIECES JOINTES ===`) so nothing inside it can be mistaken for a demand.
- **Safety net:** the format finally applied is compared with the one you asked for. If they ever differ, yours is **restored** and the operation is written to the log — no format can change silently any more.

### Verified
- Against the **real code** (functions extracted from `main.js`): 10/10 checks — 6 format cases, 3 pagination cases, and the volume note now excluded.
- In the browser with a **real RTF file** dropped into the **actual import field**: the document goes from 210×297 mm to **148×210 mm (A5)** while the RTF announces “A4 landscape”.
- Non-regression 4/4: A4 portrait, A4 landscape, business card and free dimensions (120×80 mm) are all honoured.
- 13/13 live version markers coherent, 0 leftover, web/mirror parity 14/14, dist rebuilt at 1.7.408, package (56,287,005 bytes) verified by extraction.

## [1.7.407] — 2026-09-14

_Colour picker: the eyedropper now works on Safari, in both RGB and CMYK modes_

### Fixed
- **The eyedropper did nothing on Safari.** `EyeDropper` only exists on Chromium, so Safari took the fallback path — which targeted the native colour inputs `#blockFill` / `#blockStroke`. Measured with Safari simulated (`window.EyeDropper` deleted): in **CMYK mode the button was visible (22×22) while no `input[type=color]` was rendered anywhere in the panel**, because the RGB group is `display:none`. WebKit **silently ignores a `.click()` on a non-rendered element** — that is precisely “the eyedropper does not fire”. In RGB mode a picker did open, but somewhere else than under the button.
- The fallback now builds a **dedicated, rendered colour input** (`_spPipetteProxy`): 1×1 px with a **non-zero opacity** (an `opacity:0` or `visibility:hidden` element is treated as non-rendered by WebKit and will not open either), positioned **on top of the clicked button** so the native picker anchors in the right place. It feeds the **same code path** as the eyedropper, so CMYK conversion is handled identically.
- The two empty `catch` blocks are gone: a real failure is now logged and distinguished from `AbortError`, which simply means the user cancelled.

### Verified
- Real mouse clicks with `window.EyeDropper` removed: **all four eyedroppers** (fill/stroke × RGB/CMYK) create a proxy correctly aligned to their button, and `showPicker()` is called **exactly once**, with **no “A user gesture is required” warning**.
- End-to-end value flow: `#ff0000` chosen → CMYK sliders read **C:0 M:100 Y:100 K:0**.
- 13/13 live version markers coherent, 0 leftover, web/mirror parity 14/14, dist rebuilt at 1.7.407, package (56,282,424 bytes) verified by extraction.

> The fix also repairs **Firefox**, which does not implement the `EyeDropper` API either.

## [1.7.406] — 2026-09-14

_Import: headings get breathing room, dialogs adopt SuperPrint’s design, PDFs arrive with their images_

### Added
- **PDF images are now extracted.** `extractPdfAttachment()` previously read **text only** (`getTextContent`) — the images inside a PDF were simply ignored, so a brochure laid out from a PDF arrived with no photos at all. The studio now walks each page’s operator list, recovers the images actually painted, renders them to PNG data URIs and adds them as **image attachments**, which the AI places by `imageIndex` like any other attachment. Both pdf.js storage forms are handled (`imgData.data` RGBA *and* `imgData.bitmap`), otherwise extraction would only work on some files. Bullets and decorative rules are filtered out (80 px threshold), at most 24 images are kept (the largest ones) and exploration stops after 60 pages.
- **The studio page ceiling rises from 120 to 300**, through a single named constant (`SP_MAX_PAGES`) — it used to be hard-coded in three separate places. The estimated duration is announced from 40 pages upwards, with a reminder that generation can be stopped at any time while keeping the pages already composed.

### Fixed
- **Headings were glued to the previous block.** They had no space above them, an oversized heading scale (3× the body text) and too much leading (1.35). Both import modes now apply a **safety margin above** (7 mm for a main heading, 5.5 mm for a subheading, 4 mm for a minor one), a reduced scale (**2.1× / 1.65× / 1.32×**) and tighter heading leading (**1.05**, body text stays at 1.35). A heading with less than 12 mm left below it moves to the next column, avoiding orphan headings.
- **The import dialogs did not follow SuperPrint’s design**: 12 px rounded corners, blue `#4361ee` buttons, emoji in titles, 18 px titles and 8 px button corners. They now reuse the existing classes (`.sp-modal-card`, `.sp-modal-header`, `.sp-modal-title`, `.sp-modal-close`, `.modal-btn`) and therefore inherit both the design language and the **dark theme**. Measured on the rendered dialog: 0 px radius, 13 px/600 title, 40 px black buttons in IBM Plex Mono.
- **Two translation oversights**: the insert-page question appeared in English in the French interface, and the main button label was missing in Japanese (it fell back to French). All 7 labels are now verified in three languages, with zero emoji.

### Verified
- Real browser tests: a purpose-built PDF (3 pages, 3 RGB images 400×300, compressed text) — **3 canvases of 400×300 converted to valid PNG base64**, studio reporting “PDF read: 3 text page(s), 3 image(s) extracted”. A 120-page Word document re-imported through the actual field.
- `node --check` on `main.js` (web and mirror), `_check_studio` on the studio (web and mirror), web/mirror parity 14/14, no leftover version markers, dist rebuilt at 1.7.406, package (56,281,340 bytes) regenerated.

> ⚠️ **`superprint.cc` still serves 1.7.405.** Version 1.7.406 is invisible online until the manual FTP deployment is done.

## [1.7.405] — 2026-09-14

_Word / ODT / PDF imports become linked, flowed text — and long documents finally complete in Studio IA_

### Added
- **Import documents as linked, flowed text.** Paragraphs are no longer isolated blocks: consecutive paragraphs are merged into a single flow, distributed across columns then pages, and the resulting blocks are **linked** (`textLinkId` + `textLinks`) column to column and page to page. Adjusting one block’s width now adjusts the whole document, as in professional page-layout software.
- **A composition option in the import dialog**: **Flowed text** (recommended) or **One block per paragraph** (the previous behaviour, kept for fine-tuning short texts).
- **Studio IA generations can be stopped.** During a long page-by-page run, a second click on *Send* stops the process cleanly and **keeps the pages already composed** — previously the only option was closing the tab and losing everything.

### Fixed
- **The studio sent the whole document with every page.** In page-by-page mode the document body was already sent as a slice, but `buildAttachmentContext()` added the **entire document** (truncated to 60,000 characters) to *each* call. Measured on a 200-page document capped at 120 pages: **120 × ~122,000 = ~14.6 million characters**. That is hours of processing — and because `callAI()` had **no timeout**, a single unresponsive call left the loop hanging forever: the loader kept spinning and nothing ever reached the canvas. The attached context now carries **only the image list** (about a 10× reduction), and every call has a **120-second timeout** so one failure no longer blocks the whole document.
- **A flaw in our own first fix, found by measurement.** An instrumented trace showed `{ blocs: 462, liensAvantRendu: 0 }`: all 462 blocks carried an identifier but **no link existed at all**. Cause: `colonneSuivante()` reset the chain pointer at every column change — and the body changes column on almost every block (an A4 column holds ~2,600 characters), so the chain broke before it could exist. The chain now continues across columns and pages; only headings and images interrupt the flow, as they should.

### Verified
- Real browser test — a **120-page Word document** (1,319 paragraphs, 401,961 characters, built for the occasion) dropped into the actual import field: **462 linked blocks across 136 pages, 103 links persisted in the `.sp`**, and **402,446 characters found in the blocks** — no text lost (the 485-character difference is the paragraph separators).
- `node --check` on `main.js` (web and mirror), `_check_studio` on the studio (web and mirror), web/mirror parity 14/14, no leftover version markers, dist rebuilt at 1.7.405, package (56,278,026 bytes) regenerated.

> ⚠️ **`superprint.cc` still serves 1.7.404.** Version 1.7.405 is invisible online until the manual FTP deployment is done.

## [1.7.404] — 2026-09-14

_RTF finally hands over its page setup: format, margins, columns and pagination_

### Fixed
- **The prompt bar read an RTF’s text but discarded its entire page setup.** Measured on a purpose-built realistic RTF (A4 landscape, printer margins, gutter, 2 columns, header and footer, 2 page breaks) run through **both shipped decoders**: only **5 pieces of information out of 16** reached the AI. The 11 lost items were **page format** (\paperw 16838 / \paperh 11906), a second section in portrait, **printer margins** (\margl 1701, \margt 1417, \margr 1134, \margb 1701), **gutter** (113), **columns** (\cols2 with a 284 twip gutter), **orientation**, **page number** (\chpgn), **header** ({\header Page \chpgn}), **footer** ({\footer CONFIDENTIEL}), **page breaks** (\page) and **page count**. The page breaks were the worst loss: pagination vanished entirely, so the model could not tell where a page began.
- **Two defects in my own first fix, found by measurement.** (a) The header and footer **leaked into the body text** — the words «Page» and «CONFIDENTIEL» appeared mid-document. I filtered them *after* extraction, but the decoder has already stripped the braces, so the `{\header` sequence no longer exists. They are now ignored in the body and read **straight from the raw source**. (b) The format came out as «landscape» instead of «A4 landscape»: the format lookup table is **sorted ascending** ('210 x 297' = A4), but the code built the pair as width × height — so `297 x 210` in landscape, which matched nothing. Sorting the pair for the lookup fixed it.

### Added
- **The AI now receives a readable page setup header** at the top of the extracted text: `FORMAT : A4 paysage (297 x 210 mm)`, the four margins in millimetres, the gutter, the number of columns with their gutter, the page count, the header and footer contents, and the detected automatic fields (page number, total pages, date).
- **Every page break becomes a visible marker** — `[PAGE 2]`, `[PAGE 3]` — so the model knows where each page begins and can honour the document structure instead of pouring everything into one block.

### Verified
- Probe printed the **exact text sent to the AI**; all **11 targeted checks** pass (format, margins, gutter, columns, orientation, page number, header, footer, page markers, page count, body intact, no leftover markup).
- Both decoders **return an identical result** (the app’s shared `sp-doc-import.js` module and the studio’s inline copy).
- Web/mirror parity 14/14, coherence 13/13, no leftover version markers, `sp-doc-import.js` compilable, `_check_studio` clean, dist rebuilt at 1.7.404, package (56 272 098 bytes) regenerated.

> ⚠️ **`superprint.cc` still serves 1.7.390.** Fourteen versions are invisible online until the FTP deployment is done manually — including this one.

## [1.7.403] — 2026-09-14

_Separator rule centred, attachments adopt the Studio IA styling_

### Fixed
- **The separator rule in the «New project» window was stuck to the top.** Measured in the rendered window: the rule occupied **0 to 18 px** while the buttons span **33 px** — 0 px of air above, 15 px below. Root cause is subtle: `.np-tabs` is a `display:flex` row **without** `align-items`, so the default is `normal` (= `stretch`). But the rule carries an inline **fixed height**, so it cannot stretch, and flex falls back to aligning it at the **top** (`flex-start`). Fixed with `align-self: center`. Measured after: **8 px above and 8 px below** — exactly centred, hence visibly lower.
- **Attachment chips no longer use emoji.** They previously showed a per-type emoji (document, PDF, spreadsheet, page), a coloured `<img>` thumbnail for images, rounded corners (7 px) and a plain text «×» remove button. They now use the **exact line icons of the studio** `renderAttachBar()`: a photo frame for images, a lined page for documents, plus an SVG remove cross. The five emoji are gone from the code (0 occurrences).

### Changed
- **Attachment chips now match the Studio IA design, value for value.** The studio styling was read straight from `sp213-studio.html` and applied identically: background `#f2f2f2` (`--attach-bg`), border `#d9d9d9` (`--border`), text `#1a1a1a`, metadata `#555` (`--muted`) in 9 px uppercase, **square corners** (`border-radius: 0`), padding `4px 8px`, gap `6px`, 10 px type, 14 px line icons (`stroke-width: 1.6`, `fill: none`), and a remove cross that turns **red** (`#d32f2f`) on hover. Dark theme mirrors the studio variables (`#2a2a2a` / `#333333` / `#eaeaea` / `#aaaaaa`).

### Verified
- Rule position read before and after (top 0→8, bottom 18→26). Chip computed styles compared against the studio values, and emoji presence tested by regular expression: `emojiPresent = false`, no `<img>` left, `border-radius: 0px`, `fill: none`, SVGs at 14×14.
- Web/mirror parity 14/14, coherence 13/13, no leftover version markers, `node --check` clean on `main.js` (web and mirror), `_check_studio` clean, dist rebuilt at 1.7.403, package (56 267 182 bytes) verified by extraction.

> ⚠️ **`superprint.cc` still serves 1.7.390.** Thirteen versions are invisible online until the FTP deployment is done manually — including this one.

## [1.7.402] — 2026-09-14

_Five interface reports: pop-in order, API key indicator, attachments, focus colour_

### Added
- **The API key indicator now reflects reality.** The dot left of the «Prompt IA» title was **hard-coded black** (`background:#1a1a1a`), so an active key and a missing one looked identical. It is now **green** (`#22c55e`, with a soft green ring) as soon as a key exists for the selected engine, and **amber** (`#f59e0b`) otherwise, with a tooltip stating it in words («DeepSeek key active» / «no key for DeepSeek»). The state is re-measured when the bar opens, when the engine changes, right after the key is saved, and by a 900 ms watcher that only touches the DOM when the signature actually changes. Verified without reloading: green → amber (key removed) → green (key restored).
- **Attachment chips laid out like the Studio IA ones.** Each chip now shows a **type icon** (Word, PDF, ODT, spreadsheet…) or the **real thumbnail** for an image, the file name, the character count and the **actual file weight**. Several files coexist and the area keeps **zero height** when empty, so the bar stays compact. Chips already present are redrawn when the bar opens. Measured on two files: «Rapport annuel.docx · 45.2k chars · 278 KB» and «couverture.jpg · 1600×1000px · 1.2 MB».

### Changed
- **«Studio IA» and «SuperTyPo» moved to the end of the «New project» tab list**, after the configuration tabs and separated by a rule. They are **actions** (they close the dialog and open another tool), not content tabs: sitting in the middle made them read as settings for the current document, which suggested two clicks were needed. Final order: **Basic · Advanced · Automatic · Templates │ Studio IA · SuperTyPo**. Verified: the two buttons stay black (`rgb(26,26,26)`, weight 600).
- **The prompt field focus outline is black instead of blue.** It was `#3b82f6` with a blue glow. Now `#111111` (and `#f4f4f5` in dark theme), with the drop-zone hover turned black too. The **scrollbar** was redrawn: thin, rounded, never the system blue. Verified by reading the computed styles — no blue rule left on the field, glow at `rgba(17,17,17)`.
- **Studio page ceiling raised from 40 to 120.** A document estimated at 200 pages was silently capped at 40, with no way for the user to know the rest was never laid out. The final message now **states the cut** instead of implying everything was composed.

### Fixed
- **«`text.indexOf is not a function`» on a ~200-page `.docx`.** The fix **already existed in the repository** since 1.7.393 (`parseAIResponse` normalises string/object and `spGenerateByPages` returns a JSON **string**), but the **online** studio had stayed on 1.7.390: measured `superprint.cc/sp213-studio.html` at **427 205 bytes** against **495 843** locally, with **0 occurrences** of the `if (typeof text !== 'string')` guard online against 1 locally. No code change was needed — only the deployment was missing. This is the clearest case so far of a fixed bug that keeps being reported because the fix was never published.

### Verified
- Tab order and computed styles read in the browser; the dot cycle tested without reloading; chips measured on two files of different types.
- Web/mirror parity 14/14, coherence 13/13, no leftover version markers, `node --check` clean on `main.js` (web and mirror), `_check_studio` clean, dist rebuilt at 1.7.402, package (56 266 279 bytes) verified by extraction.

> ⚠️ **`superprint.cc` still serves 1.7.390.** The studio deployed online is twelve versions behind: the `text.indexOf` fix and everything since are invisible until the FTP deployment is done manually. This is the direct cause of the recurring report above.

## [1.7.401] — 2026-09-14

_The button says what it will do, hyphenation is honoured, and an edit preserves the document_

### Fixed
- **An edit could shrink a 6-page magazine to a single page.** Measured with a real DeepSeek key: **7 pages / 17 objects** before, **1 page / 5 objects** after a plain correction prompt. Root cause: `aiFooterGenerate` set `window._aiDocType = 'single'` **as a hard-coded value**, which forced `_requestedPages = 0` — the AI was therefore never asked in multi-page mode again. The bar now infers the requested format from the actual sentence (“6 pages”, magazine, catalog, booklet, book, journal) and keeps multi-page context when the document already holds more than one page (`_dejaMulti`). Verified: **6 pages and 84 objects preserved** after a page-1 targeted edit.
- **Requested hyphenation never reached the layout.** Measured across 45 text blocks generated on a 6-page magazine: **45/45** came out with `enableHyphenation: false` and `hyphenLanguage: 'en'`, even though the system prompt states that a justified block must always be hyphenated, and even when the user wrote “justified with hyphenation”. Three causes stacked along the AI path, all fixed: (a) `_spAiBuildFabricObject()` did not copy the two properties into the Fabric object; (b) `sanitizeElement()` stripped them on the single-page path; (c) `enableHyphenation: false` was **written hard** in the single-page text constructor, overriding any instruction. A justified block without an explicit instruction now receives hyphenation, and the language falls back to the interface language instead of a hard-coded English.
- **A blank document wrongly read “Retouch”.** Measured on an empty A4 page: `canvases[0].getObjects()` returns **3 objects** — the technical marks (bleed, margins, page outline), all `excludeFromExport: true` and recognised by `_spAiIsSystemObj()`. Counting them made the button claim the layout had content. They are now excluded through the very same predicate used for the AI inventory, so button and prompt can never disagree.
- **Remaining `enableHyphenation: false` occurrences are intentional.** They live in non-AI helpers (`createSimpleTextBox`, `addTextOriginal`, `createThreeColumnLinkedText`, `placeTextIntoDocument`, `estimatePagesForText`, `openTextFlowPreview`, `aiTypoSuggestion`, `_dropPatternOnCanvasInner`), where word-by-word wrapping is the documented behaviour for manually created text.

### Added
- **The prompt button now names its real action.** The same field served both creating and editing, with nothing to indicate which would run. The button reads **Create** on a blank layout and **Retouch** as soon as content exists, with the tooltip and the field placeholder following the same state, in French, English and Japanese. A 500 ms watcher keeps the label in sync and repairs itself if `updateInterface()` resets it on a language change.

### Verified
- **End-to-end, real DeepSeek key, no mock:** a 6-page A4 French magazine was created from the prompt bar, then edited with a page-1-only instruction.
  - creation: **6 pages, 84 objects**, multi-page mode confirmed in the outgoing prompt;
  - edit: **6 pages and 84 objects preserved** (the previous behaviour collapsed to 1 page);
  - the inventory was present in the prompt (`MAQUETTE ACTUELLE` + `REGLE DE RETOUCHE`);
  - hyphenation after the fix: justified paragraph `enableHyphenation: true`, `hyphenLanguage: 'fr'` on 8 of 8 blocks.
- **HD vector PDF export, analysed at byte level:** 300 DPI, CMYK, PDF/X-3, vector typography → **6 pages**, **0 raster images**, **510 vector text blocks** (`BT`/`Tj`), **10 fonts of which 9 embedded**, `OutputIntent` + `DestOutputProfile` (Coated FOGRA39 ICC), and French accents correctly mapped through `ToUnicode`, so the text is genuinely selectable and sharp at any scale.
- Web/mirror parity 14/14, 13/13 live version markers, 0 leftover traces, distributed package verified by extraction.

> ⚠️ **`superprint.cc` still serves 1.7.390.** None of the last eleven releases is visible online until the FTP deployment is done manually.

## [1.7.400] — 2026-09-14

_The prompt now edits the current layout instead of rebuilding it_

### Added
- **The AI finally receives an inventory of what is already on the page.** Measured in `main.js`: “OBJETS EXISTANTS” / “existingElements” / “currentLayout” → **0 occurrences** — the request carried only the page format and page number. Meanwhile `pages[idx].objects = …` (2 occurrences) **replaced the whole page**. Consequence: typing “make the title bigger” made the AI regenerate a complete page, and the user's work disappeared. This is the gap with the studio, which does know the layout.
- **`_spAiDescribeCurrentLayout(canvas)`** builds a factual inventory of the active page — type, position and size in mm, **actual text**, font, size, colour — injected into the prompt with a **priority editing rule**: if the request concerns an existing element, return **that element modified** rather than creating another; keep everything else identical; do not start over. Technical marks (bleed, margins, crop marks, spread mirror) are **excluded** — they are not content. The inventory is capped at 40 objects then summarised.

### Fixed
- **A page could be silently emptied.** `_spAiProcessMultiPageResponse` wrote `pages[idx].objects` without checking that the AI had actually returned content, so a truncated or malformed reply wiped the page. It is now **left untouched** when the reply is empty, with an explicit message; and when objects really are replaced, the count is logged.
- **The loader could stay stuck forever** — the “you can't tell what it's doing” report. The `catch (parseError)` block of `aiCustomPrompt` displayed the error and then ended **without ever calling `_aiResetGenerating()`**. `window._aiGenerating` therefore stayed `true` permanently: the button stuck on “Generation…”, the loader still shown, and no way to retry. This is the **most common path in practice** — any non-JSON reply lands there. The 1.7.398 watchdog could not help: it watches `_aiGenerating`, which nobody was resetting. `_aiResetGenerating()` is now called in that catch, with a message stating the layout was left untouched.

### Verified
- Browser test on a 3-object layout (background, title, paragraph) with a **deliberately non-JSON reply** to follow the faulty path:
  - **before**: loader shown, button stuck on “Generation…”, `_aiGenerating` stayed `true`, no retry possible;
  - **after**: loader cleared, button re-enabled, `_aiGenerating` false, **3 objects intact**, and the inventory reached the AI (`MAQUETTE ACTUELLE` + `REGLE DE RETOUCHE` both present in the prompt).
- Web/mirror parity 14/14, 13/13 live version markers, 0 leftover traces, distributed package verified by extraction.

> ⚠️ **`superprint.cc` still serves 1.7.390** (checked during this session). None of the last ten releases is visible online until the FTP deployment is done manually.

## [1.7.399] — 2026-09-14

_Studio IA shown in black like SuperTyPo in the new-document window_

### Fixed
- **“Studio IA” now appears in black in the new-document window, exactly like “SuperTyPo”.** Measured on the open window before the fix: `npTabStudio` → `rgb(153,153,153)`, weight 400 (**grey**) while `npTabSupertypo` → `rgb(26,26,26)`, weight 600 (**black**) — although both were declared `color: #1a1a1a` in the page. The 1.7.397 fix was therefore **insufficient**, and only measuring the actual display could reveal it.
- **The cause was elsewhere in the code.** `npSwitchTab()` (a legacy setting, v1.7.284) rewrites the tab colours when the dialog opens and forced the **inactive-tab grey** onto the Studio button only:
  ```js
  // Tab Studio (décoratif — ne reste jamais actif, il ouvre le studio)
  if (tStudio) { tStudio.style.color = '#999'; tStudio.style.fontWeight = '400'; ... }
  ```
  SuperTyPo was **not listed in that rule**, so it was never touched and kept its black **by accident** — exactly the asymmetry the user was seeing.
- **These two buttons are not tabs:** clicking them **closes the dialog and opens the tool** in a new tab, so they are never “active” nor “inactive”. Both are now handled **together**, with a constant style: black (`#1a1a1a`), weight 600, no underline. A single rule drives the two, so a future third launch action only has to join the list.

### Verified
- Same measurements as before, on the open window: `npTabStudio` and `npTabSupertypo` both `rgb(26,26,26)` / weight 600 / transparent underline. The real tabs (Advanced, Automatic, Templates) keep their inactive grey, and Basic stays black and underlined since it is active — nothing else moved.
- Web/mirror parity 14/14, 13/13 live version markers, 0 leftover traces, distributed package verified by extraction.

## [1.7.398] — 2026-09-14

_Editor prompt bar aligned with Studio IA — shared document import module_

### Added
- **The editor's prompt bar now works exactly like the Studio IA one: same icons, same accepted formats, same structure understanding.** The studio's document-import code (Word OLE `.doc`, `.docx` via mammoth, OpenDocument `.odt`/`.ods`/`.odp`, RTF, Excel, PDF, HTML entities) was **extracted verbatim** into a new shared module `app/JS/sp-doc-import.js` (44 KB) loaded by **both** interfaces. Nothing was duplicated, so the studio and the editor cannot drift apart.
- **New prompt bar layout:** `[ 📎 attachments ] [ 🌐 web image ] [ 🎤 voice ] [ ☑ Images ]` … `[ Create ]`. The large permanent dashed drop zone is gone — that zone was what made the bar tall. Drag and drop still works anywhere on the bar.
- **Attachment chips** under the field, showing the character count, removable one by one. The area only appears when there really is an attachment, so it costs no height at rest.
- **Overlay loader.** Loading is drawn **on top of** the bar (`position:absolute`), so it adds no height at all; it disappears when generation finishes and the button becomes active again. This is what keeps the bar compact during long generations.
- **Images checkbox** (as in the studio): adds a prompt instruction to plan 1–3 photo areas with a generic caption, because the model cannot see the photo and must not invent its subject.
- **Voice prompt** (Web Speech API, following the interface language) and **web image** (free photo via picsum) buttons.

### Fixed
- **`\u2026` displayed literally** in the loader text instead of “…”, at two places (double escaping in the generator script).
- **The Create button reverted to English after every generation** — its label was hard-coded as `'Create'` regardless of the chosen language. It now remembers the label actually displayed and restores it, so all three languages are honoured with no translation to maintain.
- **The loader could stay on screen and leave the button stuck.** When a response produced no usable page, the code exited through a path that never re-enabled the interface. Rather than patching that single case, a **watchdog on the real generation state** now resets the display as soon as generation is no longer running — covering every path, including ones added later.
- **OpenDocument files failed in the editor with a silent 404** (`/app/app/JS/jszip.min.js`). The module was written for the studio, which is served from the site **root** (`app/JS/jszip.min.js`), while the editor is served from `/app/` — so the path resolved to `/app/app/JS/…`. The module now contains **no hard-coded path**: each host resolves its own via `resolveLib`, with the studio behaviour unchanged as fallback. A **cache-buster** was added to the module URL, without which the browser kept serving the previous file and the fix stayed invisible (a defect that would have been serious in production).

### Verified
- Browser test on the real flow, with `fetch` intercepted: `.doc` → “DOCUMENT WORD (ancien format .doc) · 238 car.”, `.odt` → “DOCUMENT OPEN OFFICE · 398 car.” **plus its extracted image**, `.rtf` → “DOCUMENT RTF · 218 car.”, all three attached together. The prompt contains `PIECES JOINTES UTILISATEUR`, the document text correctly decoded, and the “CONVENTIONS DU TEXTE FOURNI” instructions. 0 console errors.
- 13/13 live version markers, 0 leftover traces, web/mirror parity 14/14, distributed package checked by extraction (version 1.7.398, module present at 45 740 bytes, `resolveLib` ×1, bar icons ×4, overlay loader ×6).

## [1.7.397] — 2026-09-14

_Studio renamed “Studio IA”, studio design fixes, New document dialog reordered_

### Changed
- **The AI studio is now called “Studio IA” everywhere.** The launch row, the name shown when hovering the logo, and the French / English / Japanese translations all use the same name. Descriptions were sharpened at the same time (“Studio de maquettes IA”, “AI layout studio”, “AIレイアウトスタジオ”).
- **Both READMEs were aligned and updated.** The GitHub README (6 mentions plus the badge) and the npm README (5 mentions) now read “Studio IA”, each with direct links to the studio — **4** on GitHub, **2** on npm. Both also document the 1.7.396 addition: a document can be attached in Word `.doc`/`.docx`, OpenDocument `.odt`/`.ods`/`.odp`, RTF, Excel or PDF, and is read with its full structure (heading levels, lists, tables, images).
- **Studio header** now reads the logo, then **STUDIO IA**, then “Layout & Canvas”. The browser tab title, the welcome screen and the generator name recorded inside exported documents follow the same brand.
- **New document dialog reordered:** Basic (active, first) · Studio IA · SuperTyPo · Advanced · Automatic · Templates. Studio IA and SuperTyPo are now plain black with no underline, because they are **actions, not tabs** — clicking them closes the dialog and opens the tool in a new tab. Showed in the inactive-tab grey, they suggested a double click was needed. The real tabs (Advanced, Automatic, Templates) keep their inactive grey.

### Fixed
- **The “Images” checkbox no longer paints itself blue when ticked.** Cause: `#imgToggleWrap input[type="checkbox"] { accent-color: #3b82f6 }`. The `accent-color` property paints both the fill and the tick; it is a colour outside the design language. Now black (`#111111`), and white (`#f4f4f5`) in dark theme.
- **The page number moved to the footer.** “Page 1” was inserted **before** the canvas with `margin-bottom: 8px`; it is now appended **after** it with `margin-top: 8px` — the same margin, but below the page, giving the top room to breathe.
- **A second page builder had been missed.** The studio builds page cards in **two different places**: `renderBlankPage()` (startup and the New button) and the multi-page render (after an AI generation). Fixing only the second left “Page 1” at the top on load — found by a **browser test** (`indexDansLaCarte` 0, `labelTop` 126 < `canvasTop` 139), not by reading the code. Both paths are now fixed.
- **The attachment tooltip was out of date.** It still advertised “Word (.docx), Excel or PDF” and had become **false** after 1.7.396. Corrected in all three languages with the real format list.

### Notes
- `app/JS/main.js` is **not** modified by this release. Aligning the editor's prompt bar on the studio's (attachment / mic / Images icons, document import, overlay loader, no multi-conversation) is a separate piece of work on that file and is not shipped here.
- Verified: 13/13 live version markers, 0 leftover traces, web/mirror parity 14/14, distributed package checked by extraction (version 1.7.397, `STUDIO IA` ×11, black `accent-color` ×1, footer label in both builders, dialog order Basic · Studio IA · SuperTyPo · Advanced).

## [1.7.396] — 2026-09-14

_Studio: universal document import — legacy Word `.doc`, OpenDocument and RTF_

### Added
- **The studio now reads every document format, whatever its extension.** Measured before the fix:

  | format | behaviour before |
  |---|---|
  | `.docx` | OK (mammoth + images) |
  | `.doc` (Word 97-2003) | **0 characters** — “legacy binary format, not readable in the browser” |
  | `.odt` / `.ods` / `.odp` | **0 characters** — fell through to “unsupported type” |
  | `.rtf` | the **raw markup** (`{\rtf1\ansi\deff0{\fonttbl…`) was sent to the AI |

- **A router that reads the real file signature, never the extension.** A `.doc` sent by Gmail, Outlook or LibreOffice is almost always a renamed `.docx` or `.rtf`; trusting the extension condemned those files. Verified both ways: a `.doc` that is actually an OpenDocument is read as one, and an `.odt` that is actually RTF is read as RTF.
- **Word 97-2003 (`.doc`): a genuine structural decoder.** A `.doc` is an OLE (Compound File Binary) container holding several streams. The studio now opens the real structure — header, DIFAT → FAT, non-contiguous sector chains, stream directory, mini-stream for entries under 4096 bytes — then walks the FIB (signature `0xA5EC`, `fWhichTblStm`, `ccpText`, `fcClx`) → CLX → **PlcPcd** → text pieces, honouring the `FcCompressed` rule (bit `0x40000000` = 8-bit text, with the offset stored halved; a UTF-16LE piece keeps its raw offset). A mixed file (half 8-bit, half UTF-16 — the real case when text is pasted from elsewhere) is read correctly piece by piece.
- **OpenDocument (`.odt` / `.ods` / `.odp`): fully parsed.** The archive's `content.xml` is converted into the same structure language used for `.docx`: headings with their real `text:outline-level`, bulleted lists, tables cell by cell (including the numeric `office:value` of a spreadsheet), and images from `Pictures/*` attached as genuine attachments the AI places by index.
- **Smart text conventions in the prompt.** The decoders emit `#` for a heading, `-` for a list, `|` for a table and `[IMAGE_n]` for a photo — but **no instruction explained those conventions to the model**, so it treated them as literal text and flattened the document hierarchy. A “Conventions of the supplied text” section now tells it what each mark means: a level-1 heading opens a new page, a list becomes a real bulleted list, a table becomes a real table, and photo order is respected.
- **RTF: specification-compliant decoding.** Ignorable destination groups are skipped (font table, colour table, generator, pictures), `\'hh` escapes are decoded through **CP1252** (essential for French quotation marks and dashes), `\uNNNN` is read as a **decimal** code point, and `\ucN` controls how many fallback characters to skip.
- **HTML entities fully decoded.** Twelve were hard-coded; every other one — accents, symbols, typographic punctuation — reached the prompt as-is and the AI copied them into the layout. The table now covers **140** entities, with a decimal and hexadecimal numeric fallback.

### Fixed
- **A short document was wrongly rejected.** The reliability check demanded a minimum volume of text, so a document that had decoded perfectly stayed below the threshold and the user saw a failure message although the content was good. The criterion now concerns the **quality** of the recognised text, not its length. This defect only appeared **in the browser** — the automated tests had missed it.

### Notes
- The structural `.doc` decoder replaced a first heuristic approach that was **measured and then dropped**: on a real file, binary padding and text looked too much alike and the useful text was rejected along with the binary.
- This release does **not** modify `main.js` (the editor); all changes are in `sp213-studio.html`.
- Tooling shipped with the release: `_mk_oledoc_396.cjs` (builds real OLE containers to specification), `_mk_fixtures_396.cjs`, `_test_oledoc_396.cjs`, `_test_import_396.cjs`, `_fix_import_396.cjs` and `_reapply_396.cjs` (the patch is not idempotent, so it restores from git and reapplies).

## [1.7.395] — 2026-09-13

_Studio: multi-line titles finally clear the text below them_

### Fixed
- **A multi-line title no longer collides with the text underneath.** Reported on page 12 (“Le Pavé Mosaïque, l'Équerre et le Compas”). Method: the studio's four layout passes were **extracted from the file and chained in the real order** on a reproduction of that page, measuring overlaps **after each pass** — which showed the overlap was **solved and then re-created**:
  ```
  after _spResolveCollisions   → none
  after _spFitRowsToMargins    → 47.2 mm overlap   ← reappeared here
  ```
- **Cause 1 — a guessed height.** `_spFitRowsToMargins` measured text height with `el.height`, a value **supplied by the AI**. But the prompt never asks for a height on a text element, so it is missing or wrong. Consequence: the 4-line/34 pt title (47.2 mm tall in reality) was seen as a near-zero band and judged to be **in the same row** as the paragraph on its right — so the pass aligned them side by side instead of clearing the title above. Row height now comes from `spMeasureTextBlock` (real Fabric measurement).
- **Cause 2 — the passes ran in the wrong order.** The anti-overlap pass ran **before** the passes that change **widths**. A title that narrows gains lines, so it grows taller, and the overlap just fixed came back. Widths are now settled first (margins and row scaling), and the stacking pass runs **last**.
- **Also:** `_spResolveCollisions` only pushed downwards and only past blocks it had already placed, so two side-by-side blocks never pushed each other. It now requires a genuine **horizontal** overlap (sharing the same column), so legitimately adjacent blocks are left alone.

### Verified
- Same case, same passes, same order: **no overlap after any pass** (was 47.2 mm). Final position: the 34 pt title spans 42 → 89.2 mm, the introduction starts at 95.2 mm — the title is clear, with 6 mm of breathing room.

## [1.7.394] — 2026-09-13

_Studio: targeted rework repaired, and three off-brand colours removed_

### Fixed
- **Reworking a selected block did nothing — and could silently delete it.** Reported as *“I think the earlier error happened on a re-prompt where I had selected a block (green) in the document”*. Root cause, found in the code and confirmed by test: `mergeTargetedChanges` matched the elements returned by the AI against the selected ones **by their `id`** — but **the prompt never asks the AI for an id**, so it never returns one. The lookup table stayed empty, so **no replacement ever happened**. Worse, the deletion pass that followed **removed the selected elements** when the AI returned none — the user's block vanished with no message.
- **Fixed by matching on position** (the order of selected elements in the layout, which the model follows naturally), keeping the id-match as a first choice if the model happens to provide one, and **refusing to delete anything when the response is empty** (layout left untouched, with a console trace instead of silent loss). The replaced element keeps its original id and position.
- **Verified** by extracting the function and running it on a real 3-element case: AI returns 1 element **without id** → element 2 replaced (text, size and colour applied), id kept, elements 1 and 3 intact. AI returns an **empty** response → the selected block is **kept** (it used to disappear). 2 targets, 2 elements → correct pairing.

### Changed
- **The “Images” checkbox is no longer blue.** Reported as *“the blue for Images right of the mic doesn't fit the design language, keep it like the others even when checked”*. Measured before: border `rgb(59,130,246)` and a blue tint when checked. Now: neutral grey border `rgb(217,217,217)` and a transparent background — **identical to the neighbouring icons, checked or not**; only the label turns bold to show the state.
- **The targeted-rework block is amber, not green.** Reported as *“green may not be the right colour, I'd prefer we stay in dark black”*. `#1a7f37` → `#b45309` (the sober amber already in the palette), with light handles so they stay readable on dark backgrounds.
- **Targeted rework is now clearly visible.** Reported as *“not visually strong enough when it's a rework by zone”*. The `#selectionBar` gains a thick left border (4 px), bold text and letter-spacing, so there is no doubt you are in targeted mode.

### Note
- **The prompt button was already black** — measured live at `rgb(26,26,26)` (`--accent: #1a1a1a`). Nothing green to remove there; the perception came from the green selected block, fixed above.
- **Editor app audited**: no defect of this class to report. There is no `parseAIResponse` in `main.js`, and the two `text.indexOf` calls operate on local Fabric objects.

## [1.7.393] — 2026-09-13

_Studio: “text.indexOf is not a function” when a Word document is attached_

### Fixed
- **Crash on a long Word attachment.** Reported as *“Erreur : text.indexOf is not a function”*. Root cause, measured: `spCallAI()` has two paths returning **different types** — the single call returns a **string**, the page-by-page generation returned an **object** `{ reply, pages, targetPages }`. `sendMessage()` then passed either to `parseAIResponse(text)`, which starts with `text.indexOf(...)`. On an object that is an immediate `TypeError`.
- **The trigger explains the intermittency:** the page-by-page path only starts when the attached document exceeds **4 000 characters AND 2 pages**. A short prompt on the same Word file did not crash — which is why the bug looked erratic.
- **Fixed at three levels** so it cannot come back: `parseAIResponse` now accepts a string **or an already-parsed object**; `spGenerateByPages` returns a **JSON string** like the other path, making both branches interchangeable and keeping the truncation marker usable; `extractJSONObject` also accepts an object.

### Verified
- A test `.docx` was built with **15 083 characters and 3 images**, forcing the page-by-page path.
- **Before:** the error, zero pages. **After:** progress `SP213 1/6` → `5/6`, then *“Document traité intégralement : 6 pages composées à partir de vos 15083 caractères”*, `Layout: 6 page(s)`.
- **0 unhandled JS errors, 0 alerts**, and all 6 pages really drawn (per-page pixel counts measured).

## [1.7.392] — 2026-09-13

_Studio: configurable bleed, and layouts finally stop dating themselves 2025_

### Fixed
- **The AI did not understand bleed — it framed every full-page element flush to the trim.** Measured: the studio had **no bleed setting at all** (`state.bleed = 3` was hard-coded) and the prompt wrote `3` / `+ 6` / `-3` **in hard-coded form at 19 places**. A user who set 5 mm in SuperPrint still got a 3 mm bleed. A **"Bleed" field** now sits in the studio settings (default 3 mm, 0–20 mm, remembered), and every bleed value in the prompt derives from it.
- **Two sources of hard-coded bleed survived the first pass** — `Bleed: 3 mm` and `negatives only for bleed (-3 mm)` — and the three JSON examples showed `"left": -3`. Found by intercepting the real API request, not by reading the code.
- **Root cause of a subtler failure:** `SP213_LAYOUT_SYSTEM` is a **constant evaluated once at load, before the setting is read**, so a `${bled()}` placed inside it stayed frozen at 3. Those spots now use `@BLED@` / `@BLED2@` tokens resolved at every prompt build. Verified: `3 mm` occurrences went from 2 to **0**, `"left": -3` from 3 to **0**, `-5` (the actual setting) now appears **19 times**.
- **The AI dated layouts 2025.** The prompt contained **no date instruction at all** (0 occurrences), so models used their training year. A date note is now injected: today's date, the current year stated plainly, an explicit ban on the previous year for upcoming events, and the rule that a past year is only allowed if the user asks for one. Measured: the note is present in the outgoing request with "nous sommes en 2026".

## [1.7.391] — 2026-09-13

_Studio: an "Images" checkbox right of the attachments, web and mic buttons_

### Added
- **A checkbox that makes the AI compose with photos.** Unchecked by default (layouts without photos, as before). When checked, the studio does two complementary things: it tells the AI to reserve photo areas and write captions, and it fetches one to three illustration photos and attaches them so the model can place them with `imageIndex`. Verified: photo area covering **45 % of the page**, full-bleed framing (`left:-3, top:-3`), and a caption.
- **The instruction works even offline.** If no photo can be fetched, the layout still reserves grey photo areas (3:2 or 4:5), and the chat says so plainly.
- **Honest captions.** Measured beforehand: the model **does not see the images** (`image_url` = 0, `content: [` = 0) — it only receives the name and the format, never the subject. The instruction therefore explicitly forbids inventing what a photo shows and requires a generic caption ("Illustration", "Opening visual"). Measured output: *"Illustration — visuel d'ouverture"*.
- **Photo count follows the document**: 1 for a single page, 2 up to 4 pages, 3 beyond — or as soon as a multi-page format is requested. The checkbox state is remembered between sessions, and the label and tooltip are translated (FR/EN/JP).

### Verified
- Checked: photo instruction present in the system prompt, 1 photo attached automatically (1600×1000, 139 KB), `IMAGE 0` sent in the request, `{"type":"image","imageIndex":0}` returned, photo rendered on the canvas (341 distinct hues).
- Unchecked (counter-test): instruction absent, **0 photos attached, 0 `IMAGE` entries, no `image` element** in the generated layout.
- The existing manual 🌐 web-image button is kept unchanged, as an explicit choice.

## [1.7.390] — 2026-09-13

_Word import (editor): the four dead options now really drive the layout_

### Fixed
- **Four of the six Word-import options did nothing.** The options window shipped in 1.7.389 exposes columns, margins, body size, maximum image width, keep Word headings and real-size images. Measured: only `margin` and `cols` were read — `bodyPt`, `titres`, `imgWidth` and `imgReelle` had **zero occurrences** in the code. All four now drive the import.
- **Body text and headings were hard-coded.** The import used fixed 14 pt (body and lists), 42 / 32 / 24 pt (h1 / h2 / h3) and 12 pt (tables), so "body size" and "keep Word headings" could never change anything. Everything now derives from the chosen body size; headings are 3× / 2.28× / 1.7× the body when the Word hierarchy is kept, and drop back to body size (bold) when it is unchecked.
- **Image width was capped to the column and ignored the option.** The scale was computed from the column width alone, so "maximum image width" and "real-size images" were inert. The cap is now the chosen width (or the full text-block width in multi-column), images are centred in their column, and "real size" never upscales beyond the source.

### Added
- **Single reusable Word pipeline.** `importDocxFile(file, options)` and `lancerImportWord(file)` group page selection, mammoth HTML conversion with embedded-image extraction, and the page-by-page composer. The import button uses them, and they are exposed for reuse.

### Verified
- Measured in the browser with the real engine on a 47-paragraph `.docx` with two embedded PNGs: body 20 pt → single 20 pt size; headings unchecked → 20 pt everywhere, bold kept; 25 mm margins → 453 px block = 210 − 2×25 mm; image width 20 mm → **84 px** measured (87 expected) and 40 mm → **170 px** (175 expected); both images imported and placed.
- Dropping a `.docx` onto the page was audited and **already routed correctly** to the import input — no change needed there.

## [1.7.389] — 2026-09-13

_AI titles overlapping the text below · Word import options · studio conversation continues_

### Fixed
- **AI titles overlapped the text beneath them.** The studio estimated a character's width **without the font, the weight or the size** — 5.22 mm for Playfair Display 36 pt against 15.82 mm measured (factor 3.0) — so a 3-line title was seen as 2 lines and the block below was placed 15.2 mm too high. The height also omitted the engine's 1.13 factor, and nothing checked collisions between blocks. The studio now **measures with Fabric** (`initDimensions` + `getHeightOfLine`) instead of guessing, and a new **collision pass** stacks overlapping blocks and shrinks the font only if the page bottom is reached. Measured: 4/4 cases fixed (5.1 → −4.0 mm, 32.1 → −4.0 mm).
- **The AI never received the list of images.** The page-by-page generator did not include the attachment context, so the model could not return `imageIndex` — **0 images were placed** while the attachment bar held 2. Measured: 0 occurrences of `IMAGE n` in the request. After: `IMAGE 0` and `IMAGE 1` transmitted on all 9 page calls.
- **The studio opened a new conversation instead of continuing.** The decision relied on a **list of verbs** (modify, change, add…); any prompt without them — "make it more modern", "the title is too big", "continue" — called `newConversation()` and abandoned the layout on screen. Measured: **7 of 13 prompts switched wrongly**. The logic is now inverted: it **continues by default**, and only starts a new document on an explicit request (creation verb + "new" + a document word, or "start over" / "from scratch"). 13/13 prompts classified correctly.

### Added
- **Word import options (editor).** A pop-in now appears after choosing a `.doc`/`.docx` file: columns (Auto / 1 / 2 / 3), margins, body size, max image width, keep Word heading hierarchy, images at real size. This fixes the reported "it arrives multi-column while my document is single column": `flowHtmlIntoPages` forced **2 columns above 40 text blocks**, silently. **1 column is now the default**; "Auto" reproduces the previous behaviour.

## [1.7.388] — 2026-09-13

_Studio: Word import rebuilt — images extracted, whole document processed_

### Fixed
- **No images were extracted from a `.docx`.** The studio used `mammoth.extractRawText()`, which returns plain text and **drops every image** — and loses all structure (headings, bold, lists, tables). It now uses `convertToHtml` + `convertImage`, like the editor (`main.js` ~29164): the text is converted to a readable structure (headings `#`, lists `-`, tables `|`) **and every image in the document is extracted** and added as a separate attachment the AI can place via `imageIndex`.
- **The attachment text limit was 24 000 characters** — an 80 000-character book was sent at 30 %. Raised to **60 000** (cloud models have 128k+ context).
- **The truncation notice told the model to stop.** It read "if the passage you are looking for is not in this excerpt, formulate a keyword search" — an obedient model would then *stop and ask* instead of composing, which is exactly the "the AI tends to stop" being reported. It now says **"process what is provided… do not stop, do not ask for clarification"**.
- **Multi-page detection only read the user's prompt.** A 21 000-character `.docx` attached without the user typing "N pages" produced `isMulti = false` → **a single page was requested**. The message also said "produce **the requested number** of entries" (no number given) while the completeness note announced 9 — contradictory instructions.
- **The studio now drives the page generation.** When a long document is attached, it sends **one call per page**, each receiving **its own slice** of the document (cut at the nearest word). Progress is shown (`SP213 3/9`) and a failing page does not abort the whole document. This guarantees the whole document is processed regardless of how well the model follows volume instructions.

### Verified
Real `.docx` (21 424 characters, 2 embedded PNGs) with DeepSeek V4.1 Flash: **before 1 page / 10 texts / 0 images** → **after 4 pages, none empty** (10 / 22 / 10 / 11 elements, 39 text blocks) with a real editorial structure: cover, content, closing page with ISBN, website and folio.

## [1.7.387] — 2026-09-13

_Two-page spreads were not understood by the studio (fold line, imposition, folios)_

### Fixed
- **The fold line was drawn at the sheet edge.** `addGuides()` receives the **sheet** width in spread mode but computed `foldX = bleedPx + pageWpx` → 1199 px instead of 604 px, exactly on top of the crop mark. Measured: 845 ink px at the right edge, only 7 px at the centre. Now `bleedPx + pageWpx / 2`, matching the editor's reference (`centerX = canvasWidth / 2`, the `bindingLine`). After: **593 ink px at x=604**, the exact centre.
- **The AI instructions contradicted each other.** One section said "think in *page* coordinates: (0,0) = top-left of **each** page" while every numeric constraint and the studio's own sanitiser expect **sheet** coordinates (right page starting at 210 mm). The model followed the contradictory section. A single explicit rule now applies: origin = top-left of the whole sheet, left page 0–210 mm, fold at 210 mm, right page 210–420 mm, with an explicit "never restart from zero for the right page".
- **Book folios.** An 8-page book produced 5 sheets (correct) but the last one carried "folio 8 on the left **and folio 9 on the right**" — a page that does not exist. A numbered imposition table is now generated and injected, one line per sheet with its composition and the folios to print.

### Verified
Live DeepSeek V4.1 Flash, spread mode: **4 pages → 3 sheets** (p1 alone right / p2+p3 / p4 alone left) and **8 pages → 5 sheets** (p8 alone left) — zero duplicate folios, no folio beyond the last page.

## [1.7.386] — 2026-09-13

_Studio: the prompt area was completely reworked_

### Fixed
- The prompt field was **frozen at 72 px (2 lines)**: five typed lines (133 px of content) sat in 71 visible pixels behind a scrollbar. Now **3 lines at rest (90 px)** growing to **8 lines**, then scrolling cleanly.
- The field only used **364 px of the 444 available** — its action buttons were stacked in a 72 px column beside it. Now full width, with a **horizontal action bar underneath**: `[📎 🌐 🎤] ←→ [Send]`.
- **After sending**, the field kept the previous brief's height and its helper text stayed hidden (the value was cleared without firing an `input` event). Now returns exactly to 3 lines.
- **Tooltips were glued together**: `<b>Title</b>Text` had its tags stripped with no separator → `"Voice promptClick then speak…"`. Now `"Voice prompt — Click then speak…"`.
- Buttons enlarged from 20 × 20 px to **30 × 30 px** (42 px on mobile).

### Verified
Desktop (1405 px) and mobile (420 px): 3 lines at rest, 8 maximum, back to 3 after sending, 0 horizontal overflow. Attachment test: the AI correctly identified the attached image as the main visual (`imageIndex: 0`, 180 × 180 mm) and applied `justify` + `enableHyphenation: true` + `hyphenLanguage: "fr"` to the body paragraph only.

## [1.7.385] — 2026-09-13

_The studio's right-hand page was never used_

### Fixed
- **Everything composed on the right page of a spread was crushed into a one-character column glued to the gutter.** The raw AI JSON was correct (`left 231 / width 174`) but `sanitizeAIElement`'s text branch assumed each block was alone on a 210 mm page: `maxW = Math.max(5, 210 - 231)` → **5 mm**, and `left` pulled back to 195 mm. Calculations now run in the **frame of the page containing the block**, then the origin is restored.
- Single pages and the left page of a spread are strictly unchanged (origin = 0). A block as wide as the whole sheet is not classified as "right page", otherwise the 210 mm origin would push it off the sheet.

## [1.7.384] — 2026-09-13

_SP213 Studio: chat header, fold line, book imposition_

### Fixed
- The AI model name appeared **twice** on the same chat header line.
- **No separation between the two pages** of a sheet. A dashed fold line is now drawn at the exact centre (plus a red centre marker on the horizontal ruler, as in the editor).
- The prompt contradicted itself about sheet width (header said 420 mm, the numeric block computed on 210 mm), so the model composed **two A4 pages per sheet**. Both blocks are now consistent.
- **"One entry = one sheet"**: for a 4-page book the studio produced 4 sheets instead of the real imposition (3 sheets: p1 alone | p2+p3 | p4 alone).

## [1.7.383] — 2026-09-13

_SP213 Studio: row scaling read the wrong width_

### Fixed
- `const W = doc.w` then `PW = W / 2` placed the **fold at 105 mm instead of 210 mm**, so everything right of 105 mm was treated as the right page and the outer margin was sought at 192 mm — in the middle of the right page. Inner and outer margins became equal and the classic four-margin hierarchy was lost. Fixed in `_spFitRowsToMargins` and `_spEnforceMargins` using `doc.effW`.
- Two stray `\r` characters in `landing.html` (invisible on screen, but the file differed from the published site by 2 bytes).

## [1.7.382] — 2026-09-13

_AI typography and hyphenation, InDesign text language, release page default language_

### Fixed
- **Hyphenation was never taught to the AI.** Audit: the editor prompt scored 13/18, the studio 11/18. A full `TYPOGRAPHIE DU TEXTE ET CESURE` section now teaches the French rules (never break after an elision apostrophe — `l'ha-billage`, never `l'-`; single consonant broken before; doubled consonant between; inseparable clusters kept together; at least two characters each side), the last-line rule, FR vs EN micro-typography, dashes, widows and orphans. Now **18/18** and **17/18**.
- **InDesign import never read the text language.** An English document opened in a French interface was hyphenated with French rules, silently (`prin-ting` instead of `print-ing`). `idmlHyphenLang()` now maps `$ID/English:USA`, `nLanguage/french`… to fr/en/de/es/it — unit-tested 15/15.
- `release.html` could switch to Japanese based on the browser language and then persist that choice. It now defaults to English (`lang="en"`, `hreflang="en"` + `x-default`) while a manual choice is still honoured.
- Two forgotten version markers: the `api.html` version badge and the **root** service worker's `CACHE_NAME` (it precaches the launcher, documentation and api page).

## [1.7.381] — 2026-09-13

_The last line of justified text was stretched to both edges_

### Fixed
- **A subtle typographic detail visible on every justified paragraph.** The last line should stop where the words stop and stay flush left; it was stretched to the right edge like a full line. Root cause: the `enlargeSpaces` patch returned to vanilla Fabric whenever a block had neither hyphenation nor a soft break — and vanilla Fabric's `justify` branch stretches **every** line. The early return was removed. Measured on a 300 pt block: last line natural 196.76 pt, painted **300 pt (100 %)**; now 111.86 / 297.38 / 238.66 pt with **0.00 pt** divergence between preview and PDF, across all four alignments.
- The **studio** carried the same defect (it loads its own unpatched Fabric 5.1.0): it now lets Fabric work, then detends the last line by exactly the amount added, re-aligning `justify-right`.

## [1.7.380] — 2026-09-13

_Hyphenation: 7 typographic fixes, French and English_

### Fixed
- **The hyphen overlapped the word.** The preview justified hyphenated lines on `(block width − hyphen width)` while both exports stretched on the full width, pushing the hyphen **into** the last word (measured overlap **4.13 pt**). Both export paths now use the same target, with the hyphen anchored to the line's real end.
- **Hyphenation was forced regardless of the block setting.** The "force hyphenation" export checkbox (ticked by default) set `enableHyphenation = true` on every block, so a block deliberately set to **no hyphenation** came out hyphenated (3 extra hyphens measured).
- **`L'-`**: a break right after an elision apostrophe. Hypher + the French dictionary return `["L'","ha","billage"]` and the code took the first element. `fallbackHyphenate` was also unsuitable for French (it produced `cés-ure`, `étro-ite`, `esp-aces`). Rewritten with the real French rules — **0 wrong breaks out of 1 571 hyphens** (360 combinations).
- **Character styles: justification and hyphen anchoring** — in a justified block with mixed styles the PDF placed the hyphen up to **50 pt too early**.
- **The hyphenation language was hard-coded to French.** An English interface still showed `fr` in the "Hyphenation language" selector, applying French rules to English (11 of 22 test words wrong: `prin-ting` instead of `print-ing`). `currentHyphenLanguage` now follows the interface language until the user touches the selector.
- **A CSS font stack ("Open Sans, sans-serif") was treated as a font name**, making the vector-export preflight fail even though Open Sans 700 is available.
- **Silently hidden text**: a fixed-height block with more lines than it can show — 3 blocks were masking 2, 6 and 6 lines with no warning. Truncated blocks are now counted before export and reported.

### Verified
25/25 typographic cases (mixed styles, four alignments, hyphenation on/off, 5 fonts, FR and EN); 14/14 font families; a 3-page vector PDF with **374 BT / 374 Tj**, 0 images, 13 correctly broken hyphens and no preview↔PDF divergence.

## [1.7.379] — 2026-09-13

_Text block height snapping · landing page menu and typography_

### Added
- **Height snapping on text-block handles**: dragging a handle no longer cuts a line in half. The height snaps to the nearest complete line via the shared `spTextMetrics` helper (the same one used by the PDF export and the clip path, so preview and PDF cannot diverge). Line height and font size are never touched.

## [1.7.378] — 2026-09-13

_Landing page enriched_

### Documentation
- Added sections on prepress, Pantone / spot colours and layer separation, and on InDesign (IDML) import.

## [1.7.377] — 2026-09-13

_Text wrap: the menu entry was missing when text covers a shape_

### Fixed
- The "Text wrap…" entry only appeared for **non-text** objects. In the most common real case — a rectangle with a text block on top — the right click lands on the **text**, so the entry never appeared. A new `spWrapTrouverObstacleSousTexte()` finds the non-text object underneath and offers "Wrap this text…".

## [1.7.376] — 2026-09-13

_Text wrap: explicit buttons, diagnostics, wrapping inside a shape_

### Added
- **Validate** and **Remove wrap** buttons, plus a visible confirmation message.
- **No more silent failure**: `lineWidthFor` reports why it did nothing ("an object is too close to the text edge — 20 px missing").
- Wrapping now works for **text inside a shape**, with the frame height preserved.
- Two `scroll` listeners registered in **capture** could close the contextual menu before the user reached the entry (especially on Mac trackpads) — both removed.
- The word-safety threshold dropped from 28 px to 18 px so narrow columns wrap instead of giving up.

## [1.7.375] — 2026-09-13

_Version markers and diagnostic tag aligned_

### Fixed
- `data-sp-js` on the preview badge was frozen at `v368` (release 1.7.368) while `data-sp-sw` kept following releases. The bump scripts now handle it explicitly with occurrence counting.

## [1.7.374] — 2026-09-13

_An AI text block collapsed to 1 px on the first click_

### Fixed
- **A text block created by the AI shrank to a single pixel as soon as it was touched.** `spForceInlineStyleRewrap` was called **during** `new fabric.Textbox(txt, {fontSize, lineHeight})` (through a `set()` patch) while `_textLines` did not exist yet; it froze the transient `1` as a legitimate fixed height, and `spIsFixedSize(1)` returned true so every guard let it through. The function now returns early when the measurement is unavailable, and never freezes a height ≤ 2 px.

## [1.7.371] — 2026-09-13

_Typography: size and leading are preserved_

### Fixed
- **Changing font size or leading then clicking away lost the setting.** The handlers captured `fixedH` before the change and wrote it back after, so the frame never grew (42 → 18 px) and the text became **invisible**. Two new helpers (`spNaturalContentHeight`, `spReflowWithSafeHeight`) revalidate the height upwards across 7 call sites.
- A visibility floor in `applyTextboxClipPath` — the mask can still crop, but never below the first line.
- Three interface fixes: **Ctrl+O** targeted a non-existent `#fileInput` (now `#openImportModal`), **Ctrl+E** called the non-existent `showExportModal()` (now `openExportModal()`), and `closeFaqModal()` was undefined.

## [1.7.370] — 2026-09-12

_API page header aligned with the manual_

### Changed
- The API page header now uses the manual's exact metrics (52 px bar, 17px/900/2.5px logo, 12 px version chip radius, 30 px toggles). Wide tables wrapped in `.tbl-wrap` to stop horizontal overflow on mobile.

## [1.7.369] — 2026-09-12

_Printer's four margins guaranteed · API header_

### Added
- **The four classic printer's margins** — *petit fond* (inner, gutter side, smallest) < *tête* (head) < *grand fond* (outer, largest) < *queue* (tail) — with the classic 2/3/4/5 ratio. `_spFitRowsToMargins` scales a **row** of blocks proportionally (preserving gutters), `_spEnforceMargins` handles vertical margins. Backgrounds are never touched: a full-page fill must bleed.

## [1.7.368] — 2026-09-12

_AI typography quality_

### Fixed
- **Nothing tied font size to column width.** Prompts gave absolute ranges ("cover title 60–120 pt"), so the model chose 78 pt in a 130 mm column → 5–7 characters per line with broken words. Prompts now include the formula, a reference table and **two regimes** (short display titles may be large; long titles are capped), plus an anti-overflow rule based on the longest word.
- **The engine's hidden 1.13 factor** was invisible to the model: real line pitch = `fontSize × lineHeight × 1.13`. A 78 pt title at lineHeight 1.2 is 74.7 mm tall, not the 55 mm the model assumed — the real cause of "too much leading".
- A deterministic guard in `sanitizeAIElement` (longest word must fit; 10 characters/line floor for long titles, 7 for short display; leading caps; `top + height ≤ page height`), calibrated **not** to break the validated poster-style page.

## [1.7.332] – [1.7.367] — 2026-09-04 → 2026-09-12

Condensed list of earlier releases. Full detail in the commit history and on the release page.

### Added
- **Spot colours (Pantone)** — 220-swatch catalogue, CMYK **or** RGB quadri layers, one output channel **per spot ink**, 300 DPI locked, crop marks and a colour bar. PDF/X-3:2003 with a FOGRA39 output intent. Spot inks persist through `.sp`, `.json` and autosave. (*1.7.347, 1.7.347b, 1.7.348, 1.7.349, 1.7.353*)
- **Text wrap** — flow text around a bounding box or a shape contour, with side scope and stand-off. (*1.7.350, 1.7.351*)
- **IDML (InDesign) import** — real stories, full affine geometry (`ItemTransform` + page origin), linked and base64-embedded images, real font family names, recursive groups, rotation, opacity, dashes, polygons and thin strokes; `.zip` packages and dropped folders. (*1.7.337, 1.7.342, 1.7.343, 1.7.349*)
- **Script API** — `window.SuperPrint` with 13 methods (addText, addRect, bulkText, exportPDF, aiGenerate…), documented at `superprint/api.html`. (*1.7.353*)
- **SP213 Studio** — AI layout assistant with DeepSeek / OpenAI / OpenRouter / Groq / local WebLLM backends, attachments (image, text, Word, Excel, PDF), web image search, conversation tabs, undo/redo, targeted rework of selected elements. (*1.7.366, 1.7.367*)
- **Collaboration (P2P)** over WebRTC, no server. (*1.7.332*)

### Changed
- **Launcher page** (`index.html`) rebuilt across twelve releases: five CTAs, hover logotypes, WIN/MACOS/LINUX install tabs, full legal notice in FR/EN/JA, SEO. (*1.7.352 – 1.7.365*)
- **Documentation and manual** — light top bar, global search moved to the sidebar, `/` shortcut. (*1.7.345*)

### Fixed
- **PDF export fidelity** — vector typography aligned with the preview (including the 1.13 line factor), justified text word-by-word without stretching the last line, virtual hyphenation marks preserved, half-point font sizes, imported fonts re-laid out before export, cropped raster runs no longer flattening to opaque white under CMYK. (*1.7.341, 1.7.342, 1.7.344*)
- **CMYK export** — 4 channels, and the spot colours' separation alternation space is now correct (previously they went through the CMYK gamut even in RGB mode, clipping bright yellows and darkening jade). (*1.7.348*)
- **Font weight fallback** — bold text was not vectorised when the exact weight file was missing. (*1.7.332*)
- **Vectorised text** — descenders (g, p, y, q, j) were misaligned: Fabric positions paths by their bbox centre, not the baseline. (*1.7.332*)
- **Alt+drag duplication** — the original moved instead of the copy (Fabric locks `_currentTransform.target` before our handler runs). (*1.7.344*)
- **Delete key while editing text** deleted the whole block instead of one character. (*1.7.345*)
- **Text block collapsing** — the `_fixedHeight ?? height` idiom (40 occurrences) is broken when `_fixedHeight === 0`, because `??` does not catch zero. (*1.7.348, 1.7.350*)
- **Tool shortcuts** T/I/R/C/P now require ⌥/Alt so typing them while editing a text block no longer switches tools. (*1.7.344*)
- **Colour picker** missing in RGB mode, and inert on Safari (`EyeDropper` is Chromium-only; the fallback opened a colour input outside a user gesture). (*1.7.373*)
- **Pantone swatch** hidden in RGB mode — it was nested inside the CMYK controls, which are hidden when the CMYK toggle is off. (*1.7.348*)
- **Import IDML** produced empty canvases: the Story lookup hit the root element, modern IDML has no `GeometricBounds` (geometry lives in `PathGeometry` + `ItemTransform`), and some images are base64-embedded with line breaks. (*1.7.343*)

[1.7.332]: https://github.com/zigmoon/SUPERPRINT/releases/tag/v1.7.332
[1.7.387]: https://github.com/zigmoon/SUPERPRINT/releases/tag/v1.7.387
