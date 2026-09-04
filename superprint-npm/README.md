# SuperPrint

**SuperPrint** is a free, local-first DTP and prepress application developed and maintained by [2.13](https://2points13.fr). It combines a complete browser-based page-layout editor with **SP213**, an AI studio that turns a written brief into editable, print-ready documents.

The application runs in your browser on Windows, macOS and Linux. Your projects use SuperPrint's native editable `.sp` format and remain on your computer unless you explicitly export or send content to an optional cloud AI provider.

## Use SuperPrint online

No installation is required. Open the official web application:

### [https://superprint.cc](https://superprint.cc)

Use the npm launcher below when you prefer to run SuperPrint locally on your computer.

## Start with one command

Prerequisite: [Node.js 18+](https://nodejs.org) (npm included).

### Windows PowerShell

The `npm i superprint` command displayed automatically by npm installs the package but does not launch SuperPrint. On Windows PowerShell, script execution policies may also block `npm.ps1` and `npx.ps1`.

Launch SuperPrint with the Windows command wrapper instead:

```powershell
npx.cmd superprint@latest
```

This does not require changing your PowerShell execution policy. If you specifically want to install the package first, use `npm.cmd i superprint`, then launch it with `npx.cmd superprint`.

### macOS and Linux

```bash
npx superprint
```

On first launch, the launcher downloads the application (about 50 MB), installs its local dependencies and opens **http://127.0.0.1:5173**. Later launches reuse the installed copy and automatically detect application updates. The server binds to the loopback interface by default, so it is not exposed to your local network or the Internet.

## What is included

- **SuperPrint Editor:** multi-page layouts, precise millimetre dimensions, typography, shapes, images, layers, guides, grids, bleed and safe areas.
- **Print and prepress tools:** RGB/CMYK document workflows, print preview, preflight checks and PDF, PNG and SVG output.
- **SP213 AI Studio:** generate posters, brochures, catalogues, reports, menus and other editable layouts through conversation.
- **Native projects:** save, reopen and exchange editable `.sp` documents between SP213 and the full editor.
- **Document imports:** integrate common image, SVG, PDF, Word and spreadsheet content into layouts.
- **Local AI:** run open-source WebLLM models in the browser through WebGPU, including lightweight options for machines with limited graphics memory.
- **Optional cloud AI:** OpenAI, Groq, DeepSeek and OpenRouter can be configured when higher-capacity models are preferred.
- **Responsive interface:** use the Studio on desktop or mobile, with the full editor designed for precision desktop work.

## Privacy and local operation

The editor, project storage and local WLLM execution run on your machine. Local models are downloaded once and cached by the browser; prompts processed by WLLM stay local.

Cloud AI is optional. When you choose a cloud provider, the prompt and the context required for generation are sent to that provider using the API key you configure. SuperPrint does not require a cloud model for local WLLM use.

## Requirements

- Node.js 18 or newer, with npm/npx.
- A current Chromium-based browser is recommended.
- WebGPU-compatible graphics hardware and browser support are required only for local WLLM inference.
- Internet access is required for the first application download, updates, model downloads and optional cloud services.

You can pass Vite options to the launcher, for example:

```bash
npx superprint --host 127.0.0.1 --port 5173
```

Network access is opt-in. Only use `--host 0.0.0.0` on a trusted network when you deliberately want another device to reach the application.

## Links

- [SuperPrint web application](https://superprint.cc)
- [Technical documentation](https://superprint.cc/documentation.html)
- [2.13 — developer and maintainer](https://2points13.fr)
- [2.13 applications](https://2points13.fr/applications.html)
- Support: [all@2points13.fr](mailto:all@2points13.fr)

## About 2.13

[2.13](https://2points13.fr) is an independent senior web, design, security and AI collective founded in 2013. SuperPrint is part of its suite of browser-based creative applications, designed to be lightweight, private and directly usable without a traditional desktop installation.

## License

MIT. SuperPrint is developed by 2.13.
