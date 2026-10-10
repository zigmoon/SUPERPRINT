# Third-party notices

SuperPrint's own code is licensed under the AGPL-3.0 (see [LICENSE](LICENSE)). It bundles or
loads the following third-party components, which remain governed by their own licenses:

| Component | Role in SuperPrint | License |
|---|---|---|
| [Fabric.js](https://github.com/fabricjs/fabric.js) | Canvas rendering engine for the editor | MIT |
| [pdf.js](https://github.com/mozilla/pdf.js) | PDF import / page preview | Apache-2.0 |
| [pdf-lib](https://github.com/Hopding/pdf-lib) | CMYK PDF post-processing, PDF/X export | MIT |
| [jsPDF](https://github.com/parallax/jsPDF) | RGB PDF export | MIT |
| [JSZip](https://github.com/Stuk/jszip) | IDML / SLA / ODT archive reading & writing | MIT / GPL-3.0 (dual) |
| [Paper.js](https://github.com/paperjs/paper.js) | Boolean path operations (union / subtract / intersect / exclude) | MIT |
| [Mammoth.js](https://github.com/mwilliamson/mammoth.js) | DOCX import with image extraction | BSD-2-Clause |
| [SheetJS (xlsx)](https://github.com/SheetJS/sheetjs) | XLSX / XLS import (loaded lazily from a CDN) | Apache-2.0 |
| [Hypher](https://github.com/bramstein/hypher) | Multilingual hyphenation (FR, EN, DE, ES, IT) | BSD-2-Clause |
| [WebLLM](https://github.com/mlc-ai/web-llm) | Fully local AI inference for Studio IA (WebGPU) | Apache-2.0 |
| [Little CMS / lcms-wasm](https://github.com/mm2/Little-CMS) | ICC colour management (WebAssembly build) | MIT |

Each of these projects' license text is included with its own distribution (see, for
example, [`app/JS/lcms-wasm/LICENSE.md`](app/JS/lcms-wasm/LICENSE.md) and
[`app/JS/lcms-wasm/README-upstream.md`](app/JS/lcms-wasm/README-upstream.md)). Nothing in
SuperPrint's AGPL-3.0 license restricts the rights granted by these upstream licenses, and
nothing in these upstream licenses is superseded by the AGPL-3.0 for the parts they cover.

## Fonts

Bundled and Google Fonts–served typefaces (Open Sans, Montserrat, Roboto, Lato, Poppins,
Playfair Display, Bebas Neue, IBM Plex Mono/Sans, JetBrains Mono, Fira Code, Space Mono,
Noto Sans JP) are distributed under the SIL Open Font License (OFL) or Apache-2.0 by their
respective foundries, independently of SuperPrint's own license.

## Spot-colour libraries

The reference names and indicative values of **Pantone**, **Toyo Color Finder**,
**Focoltone**, **HKS**, **RAL**, **NCS** and **DIC** are the property of their respective
rights holders / trademark owners. SuperPrint ships **screen-preview sRGB approximations**
for on-screen reference only — not the manufacturers' official, calibrated libraries. These
names and values are not covered by SuperPrint's AGPL-3.0 license. Importing a manufacturer's
own `.ase` (Adobe Swatch Exchange) file gives exact, manufacturer-supplied values; that file
and its content remain the property of its creator.

## Trademarks

The names "SuperPrint", "SP213" and "SuperTyPo", and their logos, are trademarks of Simon
Dupont-Gellert (Zigmoon) and are governed separately from the AGPL-3.0 code license — see
[TRADEMARKS.md](TRADEMARKS.md).
