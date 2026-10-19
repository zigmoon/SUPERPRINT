# SuperPrint

<p align="center">
  <b>Professional desktop publishing, in your browser.</b><br>
  L'atelier de PAO qui tient dans un navigateur. · ブラウザの中のプロのレイアウト工房。
</p>

<p align="center">
  <a href="https://superprint.cc"><b>🌐 superprint.cc</b></a> ·
  <a href="https://github.com/zigmoon/superprint">GitHub</a> ·
  <a href="https://superprint.cc/sp213-studio.html">Studio IA</a> ·
  <a href="https://superprint.cc/supertypo/">SuperTyPo</a> ·
  <a href="https://superprint.cc/documentation.html">Documentation</a> ·
  <a href="https://superprint.cc/api.html">Script API</a>
</p>

<p align="center">
  <img alt="App" src="https://img.shields.io/badge/app-1.7.678-000000?style=flat-square">
  <img alt="Launcher" src="https://img.shields.io/badge/npm-1.0.115-CB3837?style=flat-square">
  <img alt="Desktop beta" src="https://img.shields.io/badge/desktop-Windows%20%7C%20macOS%20%7C%20Linux-F2B90B?style=flat-square">
  <img alt="License" src="https://img.shields.io/badge/license-Proprietary-blue?style=flat-square">
</p>

<p align="center">
  <a href="https://superprint.cc">
    <img src="https://raw.githubusercontent.com/zigmoon/SUPERPRINT/main/superprint/superprint_readme.webp"
         alt="SuperPrint — the DTP desk in your browser: pages, guides, prepress and export" width="900">
  </a>
</p>

> ### 🖥️ Desktop versions — Windows · macOS · Linux — **out in beta**
>
> **EN** — The **PC (Windows)**, **macOS** and **Linux** versions are **in beta**: complete and usable, but still young. They download freely, without an account — **3 applications × 3 systems = 21 installers**. This npm package is unaffected: it stays the launcher for the browser application.
>
> **FR** — Les versions **PC (Windows)**, **macOS** et **Linux** sont en **beta** : complètes et utilisables, mais encore jeunes. Elles se téléchargent librement, sans compte — **3 applications × 3 systèmes = 21 installeurs**. Ce paquet npm n'est pas concerné : il reste le lanceur de l'application dans le navigateur.
>
> **JA** — **PC（Windows）**・**macOS**・**Linux** 版は**ベータ**です。完成していて使えますが、まだ若い版です。アカウント不要で自由にダウンロードできます — **3つのアプリ × 3つのシステム = 21のインストーラー**。この npm パッケージは対象外で、ブラウザ版のランチャーのままです。
>
> 👉 **[Download the desktop applications](https://github.com/zigmoon/SUPERPRINT/releases/tag/desktop-latest)**


**SuperPrint** is a **professional page-layout and prepress (DTP) application that runs entirely in the browser** — free, no subscription, no account, no ads. It combines a **real multi-page layout editor** (bleed, CMYK, **spot inks**, master pages, linked text frames, fine typography) with an **AI layout studio** that turns a written brief into a print-ready, fully editable document.

This package is the **launcher**. It downloads the application once, installs its local dependencies and serves it on **`http://127.0.0.1:5173`**. Your projects use SuperPrint's native editable `.sp` format and stay **on your computer** unless you deliberately export them or enable a cloud AI provider.

> **No Node.js, or prefer a real application?** The three applications also install natively on **Windows, macOS and Linux** — see the desktop table at the top of this README. Those builds are **in beta**, and they do not need Node.js at all.

---

## ✦ Install and run

Prerequisite: [Node.js 18+](https://nodejs.org) (npm included).

There is nothing to install permanently — `npx` fetches the launcher, which then downloads the app (**~54 MB**) on first run.

### Windows (PowerShell)

```powershell
npx.cmd superprint@latest
```

The `.cmd` wrapper is deliberate: `npm.ps1` / `npx.ps1` can be blocked by the PowerShell execution policy, and `npx.cmd` avoids having to change it. If you prefer installing first, `npm.cmd i superprint` then `npx.cmd superprint`.

### macOS / Linux

```bash
npx superprint
```

### Options

Vite options are passed straight through:

```bash
npx superprint --port 5174
```

The server binds to the **loopback interface** by default, so it is not reachable from your network or the Internet. Use `--host 0.0.0.0` **only** on a trusted network, when you deliberately want another device to reach the app.

### Updating

The launcher checks the published version and re-downloads the application when a newer one is available. Existing local copies are reused otherwise, so later launches are fast and work offline.

### Desktop — without Node.js (**beta**)

> ⚠️ **Beta.** The desktop builds are complete and usable, but still young. They are **free, without an account**, and they install alongside the browser version — nothing is replaced.

**One installer per application** — 3 applications × 3 systems = **21 files**. Each build carries only its own application, so it downloads only what it needs: **SuperPrint 58 MB**, **Studio IA 9.8 MB**, **SuperTyPo 1 MB**. They all live under the versionless [`desktop-latest`](https://github.com/zigmoon/SUPERPRINT/releases/tag/desktop-latest) tag, which is why these links never go stale.

| System | SuperPrint | Studio IA | SuperTyPo |
|---|---|---|---|
| **PC — Windows** | [`.exe`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Windows-x64-setup.exe) · [`.msi`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Windows-x64.msi) | [`.exe`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/Studio-IA-Windows-x64-setup.exe) · [`.msi`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/Studio-IA-Windows-x64.msi) | [`.exe`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperTyPo-Windows-x64-setup.exe) · [`.msi`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperTyPo-Windows-x64.msi) |
| **MAC — macOS** | [Apple silicon](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-macOS-AppleSilicon.dmg) · [Intel](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-macOS-Intel.dmg) | [Apple silicon](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/Studio-IA-macOS-AppleSilicon.dmg) · [Intel](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/Studio-IA-macOS-Intel.dmg) | [Apple silicon](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperTyPo-macOS-AppleSilicon.dmg) · [Intel](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperTyPo-macOS-Intel.dmg) |
| **LINUX** | [`.AppImage`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Linux-x86_64.AppImage) · [`.deb`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Linux-x86_64.deb) · [`.rpm`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperPrint-Linux-x86_64.rpm) | [`.AppImage`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/Studio-IA-Linux-x86_64.AppImage) · [`.deb`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/Studio-IA-Linux-x86_64.deb) · [`.rpm`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/Studio-IA-Linux-x86_64.rpm) | [`.AppImage`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperTyPo-Linux-x86_64.AppImage) · [`.deb`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperTyPo-Linux-x86_64.deb) · [`.rpm`](https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/SuperTyPo-Linux-x86_64.rpm) |

The `.msi` exists for managed deployment (GPO, SCCM). The `.rpm` covers Fedora, RHEL and openSUSE, where an AppImage offers no integration with the package manager. The three installed applications keep **their own name, their own icon and their own launcher entry** — `superprint`, `studio-ia`, `supertypo` — and never overwrite one another.

---

## ✦ The SuperPrint family

This package launches SuperPrint, but the project is a small **family of browser-based creative applications** sharing the same design language and workflow:

- **SuperPrint** — the full DTP / prepress **layout editor**: pages, spreads, bleed, CMYK, master pages, typography, imposition.
- **Studio IA** — the **AI layout studio**. Describe a brief in plain language and get a print-ready editable document. Attach documents in **any office format** — Word `.doc` / `.docx`, OpenDocument `.odt` / `.ods` / `.odp`, RTF `.rtf`, Excel, PDF — and they are read with their **full structure**: heading levels, lists, tables and images. Runs on cloud models (DeepSeek, Groq, OpenRouter, Anthropic) **or fully locally** with WebLLM over WebGPU.
- **SuperTyPo** — a **font decomposer & typeface editor**. Drop a `.ttf` / `.otf` / `.woff` / `.woff2`, reshape each glyph as vector contours with a Bézier pen, then **re-export** the typeface. Boolean operations, mirror & 90° rotation, glyph metrics, FR / EN / JP interface, and the versioned `.sf` (SuperFont) project format. Open it at [superprint.cc/supertypo](https://superprint.cc/supertypo/), or from the **« SuperTyPo »** entry of the *New project* dialog inside SuperPrint.

---

## ✦ Why SuperPrint?

- **A real DTP tool, not a toy** — real millimetre formats, bleed, trim marks, master pages, layers, guides & grids, linked text frames, editorial typography with **automatic hyphenation**.
- **Offset-ready output** — CMYK + ICC profiles, spot inks from **six built-in swatch books** (**Toyo Color Finder, Focoltone, HKS, RAL, NCS, DIC**) plus **your own `.ase` libraries**, PDF/X-3, imposition, and a soft-proof preview.
- **Typography that survives export** — vector PDF keeps text selectable and searchable. Hyphenation dictionaries for **French, English, German, Spanish and Italian**.
- **100 % browser-based** — Chrome, Firefox, Safari, Edge.
- **No subscription, no account, no tracking.**
- **Offline PWA** — installable as a desktop app, with an auto-save net in **IndexedDB**.
- **AI that can stay local** — cloud models, or entirely offline with WebLLM over WebGPU.

---

## ✦ Formats

**Import** — Word `.docx` / `.doc` (with image extraction; `.doc` through a real Compound File Binary parser), OpenDocument `.odt` / `.ods` / `.odp`, **RTF** (page setup decoded: format, margins, gutter, columns, headers/footers, page breaks), PDF, InDesign `.idml`, Excel `.xlsx` / `.xls` *(SheetJS is loaded from a CDN — Excel import needs a network connection)*, images (PNG, JPG, WebP, GIF, SVG, TIFF, EPS, AI, PSD), Scribus `.sla` *(BETA)*, the native `.sp` / `.json` project formats, and **Adobe Swatch Exchange `.ase`** colour libraries (see below).

**Export** — **PDF** in four qualities (**72 / 200 / 300 / 600 DPI**) with bleed, trim marks, colour bar and **imposition**; `PDF/X-3:2003` with `OutputIntent` and `DestOutputProfile`; **CMYK** through ICC profiles (three bundled: **Coated FOGRA39**, **US Web Coated SWOP**, **Japan Color 2001 Coated** — custom profiles can be loaded); **Pantone** spot channels as real `/Separation` colour spaces, on a CMYK **or** RGB quadri layer; **vector typography** (selectable text, embedded fonts); **PNG** (white or transparent) and **JPG**; native `.sp` and `.json`.

> ℹ️ **IDML is import-only.** There is no IDML export — the native exchange format is `.sp`.

---

## ✦ Spot colours & swatch books

The Colour panel is a **list of colour libraries**, each one an accordion: open a book, pick a shade — every row shows its **colour dot and its name**, and the ink is applied to the **fill or the stroke** of your selection.

| Swatch book | Shades | |
|---|---|---|
| **Toyo Color Finder** | 46 | Japanese ink system, grouped by family |
| **Focoltone** | 48 | Process-oriented reference set |
| **HKS** | 54 | HKS K (coated) reference |
| **RAL** | 191 | RAL Classic, with French colour names |
| **NCS** | 55 | Natural Colour System notation |
| **DIC** | 49 | Japanese DIC reference |
| **Pantone** | 246 | Kept in the catalogue — its accordion arrives in a coming release |
| **Your own** | any | Import an Adobe Swatch Exchange **`.ase`** file → a new book named after the file |

- **`.ase` import is local**: RGB, CMYK, Lab and Grey entries are parsed in the browser, nothing is uploaded, the imported book comes back on the next visit and can be removed with a ✕.
- The built-in shade values are **screen-preview sRGB conversions**, not the manufacturers' official libraries (this is stated in the interface). For exact values, import the library the manufacturer provides as `.ase`.
- On export, every ink still becomes its **own named `/Separation` colour channel** — adding libraries does not change the way plates are produced.

---

## ✦ What is included

- **SuperPrint Editor** — multi-page layouts, millimetre precision, typography, shapes, images, layers, guides, grids, bleed and safe areas.
- **Print & prepress tools** — RGB / CMYK document workflows, print preview, preflight checks, PDF output.
- **Studio IA** — posters, brochures, catalogues, reports and menus, generated through conversation (up to 120 pages).
- **SuperTyPo** — font decomposition, glyph editing, `.sf` projects, TTF re-export.
- **Native projects** — editable `.sp` documents, exchangeable between Studio IA and the full editor.
- **Local AI** — open-source WebLLM models in the browser through WebGPU, including lightweight options for machines with limited graphics memory.
- **Optional cloud AI** — DeepSeek, Groq, OpenRouter and Anthropic can be configured when higher-capacity models are preferred.
- **Responsive interface** — the Studio works on desktop and mobile; the full editor targets precision desktop work.

---

## ✦ Privacy and local operation

- The editor, project storage and local WebLLM execution run **on your machine**. Local models are downloaded once, cached by the browser, and prompts stay local.
- **No account, no telemetry, no advertising.**
- Cloud AI is **optional**. When you choose a provider, only the prompt and the context required for generation are sent, using the API key you configure. Nothing is sent while you use local models.

---

## ✦ Requirements

- Node.js **18** or newer, with npm / npx.
- A current Chromium-based browser is recommended.
- **WebGPU**-compatible hardware and browser support are required **only** for local WebLLM inference.
- Internet access is needed for the first application download, for updates, for WebLLM model downloads, for **Excel import** (SheetJS comes from a CDN) and for any **cloud AI** provider.

---

## ✦ Links

### Repository
[github.com/zigmoon/superprint](https://github.com/zigmoon/superprint)

- [SuperPrint web application](https://superprint.cc)
- [Technical documentation](https://superprint.cc/documentation.html)
- [Script API](https://superprint.cc/api.html)
- [Studio IA](https://superprint.cc/sp213-studio.html)
- [SuperTyPo font editor](https://superprint.cc/supertypo/)
- [Release notes, trilingual FR / EN / JP](https://app.zigmoon.com/release.html)
- [2.13 — developer and maintainer](https://2points13.fr)
- [2.13 applications](https://2points13.fr/applications.html)
- Support: [all@2points13.fr](mailto:all@2points13.fr)

## ✦ About 2.13

[2.13](https://2points13.fr) is an independent senior web, design, security and AI collective founded in 2013. SuperPrint is part of its suite of browser-based creative applications, designed to be lightweight, private and directly usable without a traditional desktop installation.

---

## ✦ License

**Proprietary — all rights reserved. Not open source.**
SuperPrint — the page-layout editor, the SP213 AI layout studio, the SuperTyPo font editor,
their source code, documentation and build tooling — is **proprietary software**: free to
use, but not free to copy, modify or redistribute. See the full text in [LICENSE](LICENSE).

Copyright (C) 2026 Simon Dupont-Gellert (Zigmoon) & Clémence Brunet · 2.13.

**In short** — use SuperPrint for any purpose, including commercial work, with no fee and no
account; everything **you produce** with it belongs to you — your documents, images, fonts,
templates and your exported PDF / PNG / JPG files. SuperPrint runs in a browser, so its source
can be read, but **readable is not free to reuse**: without the publisher's prior written
permission you may not copy, redistribute, resell, sublicense, host, mirror or publish it, nor
modify it or build a derivative work from it, nor remove the copyright notices or this license.
Self-hosting is part of that permission, not a right: it is available on request, like the
commercial, custom-build and white-label options below.

**Trademarks.** The license covers the *code*, not the *name*: "SuperPrint", "SP213" and
"SuperTyPo", and their logos, are trademarks of Simon Dupont-Gellert (Zigmoon), governed
separately — see [TRADEMARKS.md](TRADEMARKS.md). An authorised derivative or hosted instance
must not present itself under these names in a way that implies official origin or endorsement.

**Third-party components** bundled with the application (Fabric.js, pdf-lib, pdf.js, JSZip,
Mammoth, SheetJS, WebLLM, Little CMS `lcms-wasm`), the bundled fonts and the Pantone ink names
keep their own licenses and trademarks, which prevail over SuperPrint's license for the parts
they cover — see [NOTICE.md](NOTICE.md).

Commercial licensing, custom builds, white-labelling and partnerships:
**contact@superprint.cc** · **all@2points13.fr**
