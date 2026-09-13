# Changelog

All notable changes to **SuperPrint** — the web DTP application (`1.7.x`), the **SP213 Studio** AI layout assistant, and the npm launcher (`1.0.x`, versioned independently).

- **App version** is declared in `superprint/version.txt` and mirrored in `sp213-local/`.
- **Full release notes** (trilingual FR / EN / JP, with detail) are published at **https://app.zigmoon.com/release.html**.
- Every release is git-tagged `v1.7.NNN` — see the [Releases](https://github.com/zigmoon/SUPERPRINT/tags) tab.
- **SP213 Studio** is the AI layout page (`sp213-studio.html`). It talks to DeepSeek / OpenAI / OpenRouter / Groq / a local WebLLM model and produces native `.sp` documents that the editor opens directly.

---

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
