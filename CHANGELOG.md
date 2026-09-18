# Changelog

All notable changes to **SuperPrint** — the web DTP application (`1.7.x`), the **SP213 Studio** AI layout assistant, and the npm launcher (`1.0.x`, versioned independently).

- **App version** is declared in `superprint/version.txt` and mirrored in `sp213-local/`.
- **Full release notes** (trilingual FR / EN / JP, with detail) are published at **https://app.zigmoon.com/release.html**.
- Every release is git-tagged `v1.7.NNN` — see the [Releases](https://github.com/zigmoon/SUPERPRINT/tags) tab.
- **SP213 Studio** is the AI layout page (`sp213-studio.html`). It talks to DeepSeek / OpenAI / OpenRouter / Groq / a local WebLLM model and produces native `.sp` documents that the editor opens directly.

---

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
