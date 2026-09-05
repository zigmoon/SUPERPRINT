# SuperPrint

<p align="center">
  <b>Professional desktop publishing, in your browser.</b><br>
  L'atelier de PAO qui tient dans un navigateur. · ブラウザの中のプロのレイアウト工房。
</p>

<p align="center">
  <a href="https://superprint.cc"><b>🌐 superprint.cc</b></a> ·
  <a href="https://github.com/zigmoon/superprint"><b>GitHub</b></a> ·
  <a href="https://superprint.cc/documentation.html">Documentation</a>
</p>

**SuperPrint** is a **professional page-layout and prepress (DTP) application that runs entirely in the browser** — free, no subscription, no account, no ads. It combines a **real multi-page layout editor** (bleed, CMYK, fine typography, master pages…) with an **AI layout studio, SP213**, which turns a plain written brief into a print-ready, fully editable document.

The application runs in your browser on Windows, macOS and Linux. Your projects use SuperPrint's native editable `.sp` format and remain **on your computer** unless you explicitly export or send content to an optional cloud AI provider.

---

## ✦ Why SuperPrint?

- **A real DTP tool, not a toy** — real millimeter formats, trim marks, bleed, master pages, layers, linked text frames, editorial typography with automatic hyphenation (FR · EN · DE · ES · IT · JA).
- **Offset-ready export** — **CMYK** PDF with ICC profiles (Coated FOGRA39, SWOP, Japan Color), Pantone spot-color support, on-screen soft-proof simulation, and offset **imposition**.
- **100 % browser-based** — nothing to install for online use — Chrome, Firefox, Safari, Edge.
- **No subscription, no account, no tracking** — open it and start composing.
- **Offline PWA** — installable as a desktop app; auto-save every 12 s to local IndexedDB.
- **AI layout (SP213)** — from brief to draft through conversation — DeepSeek, Groq, OpenRouter, or fully local WebLLM models over WebGPU.
- **Interoperability** — import your documents (Word, OpenDocument, PDF, SVG/PNG/JPG/WebP images, IDML) and export to many formats.

---

## ✦ What can you compose?

| | | |
|---|---|---|
| 🎉 Flyers & posters | 📚 Brochures & catalogs | 📰 Magazines & newsletters |
| 🎓 Course material | 📊 Reports & business docs | 🎵 Sleeves, programs, booklets |

---

## ✦ How to use it

### Online (nothing to install)
→ **[https://superprint.cc](https://superprint.cc)** — the app opens in seconds.

### Locally with this package (single command)
Prerequisite: [Node.js 18+](https://nodejs.org) (npm included).

**Windows PowerShell**

The `npm i superprint` command displayed automatically by npm installs the package but does not launch SuperPrint. On Windows PowerShell, script execution policies may also block `npm.ps1` and `npx.ps1`.

Launch SuperPrint with the Windows command wrapper instead:

```powershell
npx.cmd superprint@latest
```

This does not require changing your PowerShell execution policy. If you specifically want to install the package first, use `npm.cmd i superprint`, then launch it with `npx.cmd superprint`.

**macOS / Linux**

```bash
npx superprint
```

On first launch, the launcher downloads the application (about 50 MB), installs its local dependencies and opens **http://127.0.0.1:5173**. Later launches reuse the installed copy and automatically detect application updates. The server binds to the loopback interface by default, so it is not exposed to your local network or the Internet.

---

## ✦ Feature highlights

- Multi-page documents, facing-page spreads and offset **imposition**
- **CMYK / RGB / grayscale** PDF export up to **600 DPI** with bleed, trim marks and color bars
- **Vector typography** export — real selectable text with embedded fonts (no rasterization)
- Import: Word (.docx), OpenDocument (.odt), RTF, PDF page-by-page, IDML, images, SVG
- Export: PDF, PNG, JPG, IDML, native `.sp`
- Master pages, layers, guides & grids, linked text frames, multilingual hyphenation engine
- Pathfinder boolean operations, image masking, Bézier pen tool, image filters
- GPU acceleration (WebGL), light & dark themes, keyboard-first workflow
- **SP213 Studio** — AI-generated layouts, online (DeepSeek/Groq/OpenRouter) or fully local (WebLLM via WebGPU)

### What is included

- **SuperPrint Editor:** multi-page layouts, precise millimetre dimensions, typography, shapes, images, layers, guides, grids, bleed and safe areas.
- **Print and prepress tools:** RGB/CMYK document workflows, print preview, preflight checks and PDF, PNG and SVG output.
- **SP213 AI Studio:** generate posters, brochures, catalogues, reports, menus and other editable layouts through conversation.
- **Native projects:** save, reopen and exchange editable `.sp` documents between SP213 and the full editor.
- **Document imports:** integrate common image, SVG, PDF, Word and spreadsheet content into layouts.
- **Local AI:** run open-source WebLLM models in the browser through WebGPU, including lightweight options for machines with limited graphics memory.
- **Optional cloud AI:** OpenAI, Groq, DeepSeek and OpenRouter can be configured when higher-capacity models are preferred.
- **Responsive interface:** use the Studio on desktop or mobile, with the full editor designed for precision desktop work.

---

## ✦ Privacy and local operation

SuperPrint is designed to be **privacy-friendly**:

- The editor, project storage and local WebLLM execution run on your machine. Local models are downloaded once and cached by the browser; prompts processed by WebLLM stay local.
- No account, no telemetry, no advertising.
- Cloud AI is optional. When you choose a cloud provider, the prompt and the context required for generation are sent to that provider using the API key you configure. SuperPrint does not require a cloud model for local WebLLM use.

---

## ✦ Requirements

- Node.js 18 or newer, with npm/npx.
- A current Chromium-based browser is recommended.
- WebGPU-compatible graphics hardware and browser support are required only for local WebLLM inference.
- Internet access is required for the first application download, updates, model downloads and optional cloud services.

You can pass Vite options to the launcher, for example:

```bash
npx superprint --host 127.0.0.1 --port 5173
```

Network access is opt-in. Only use `--host 0.0.0.0` on a trusted network when you deliberately want another device to reach the application.

---

## ✦ Links

### Repository
[github.com/zigmoon/superprint](https://github.com/zigmoon/superprint)

- [SuperPrint web application](https://superprint.cc)
- [Technical documentation](https://superprint.cc/documentation.html)
- [2.13 — developer and maintainer](https://2points13.fr)
- [2.13 applications](https://2points13.fr/applications.html)
- Support: [all@2points13.fr](mailto:all@2points13.fr)

## ✦ About 2.13

[2.13](https://2points13.fr) is an independent senior web, design, security and AI collective founded in 2013. SuperPrint is part of its suite of browser-based creative applications, designed to be lightweight, private and directly usable without a traditional desktop installation.

---

## ✦ License

MIT. SuperPrint is developed by 2.13.
