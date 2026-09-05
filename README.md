<p align="center">
  <a href="https://superprint.cc">
    <img src="superprint/favicon.png" alt="SuperPrint" width="120" height="120">
  </a>
</p>

<h1 align="center">SuperPrint</h1>

<p align="center">
  <b>L'atelier de PAO qui tient dans un navigateur.</b><br>
  The professional layout atelier that lives in your browser. · ブラウザの中のプロのレイアウト工房。
</p>

<p align="center">
  <a href="https://superprint.cc"><b>🌐 superprint.cc</b></a> ·
  <a href="https://superprint.cc/landing.html">Landing</a> ·
  <a href="https://superprint.cc/sp213-studio.html">Studio SP213</a> ·
  <a href="https://superprint.cc/documentation.html">Documentation</a> ·
  <a href="mailto:contact@superprint.cc">contact@superprint.cc</a>
</p>

<p align="center">
  <img alt="Version" src="https://img.shields.io/badge/version-1.7.332-000000?style=flat-square">
  <img alt="DTP" src="https://img.shields.io/badge/type-DTP%20%2B%20prepress-00A7C7?style=flat-square">
  <img alt="Print" src="https://img.shields.io/badge/print-CMYK%20ready-E1237B?style=flat-square">
  <img alt="AI" src="https://img.shields.io/badge/AI-SP213%20studio-F2B90B?style=flat-square">
  <img alt="Languages" src="https://img.shields.io/badge/FR%20%7C%20EN%20%7C%20JP-17130D?style=flat-square">
</p>

---

## ✦ Le projet en une phrase

**SuperPrint** est un logiciel de **mise en page et de préparation à l'impression (PAO / DTP)** entièrement conçu pour le navigateur — gratuit, sans abonnement, sans compte, sans publicité. Il marie un **éditeur multi-pages professionnel** (fond perdu, CMJN, typographie fine, gabarits…) et un **studio IA, SP213**, qui transforme une simple consigne écrite en document prêt à imprimer et entièrement modifiable.

> En ligne ou en local, vos projets restent **sur votre machine**. Rien ne part chez un tiers sauf si vous choisissez vous-même un fournisseur IA.

---

## ✦ Pourquoi SuperPrint ?

- **Un vrai outil de PAO, pas un jouet** : formats réels en millimètres, repères, fonds perdus, gabarits, calques, chaînage de blocs texte, typographie d'éditeur (césure FR · EN · DE · ES · IT · JA).
- **Export prêt pour l'offset** : PDF **CMYK**, tons directs Pantone, simulation d'épreuve écran.
- **100 % navigateur** : aucune installation pour l'usage en ligne — Chrome, Firefox, Safari, Edge.
- **Sans abonnement, sans compte, sans tracking** : on ouvre, on compose.
- **PWA hors-ligne** : installable comme une application de bureau.
- **IA de mise en page (SP213)** : du brief à la maquette par la conversation — DeepSeek, Groq, OpenRouter ou modèles locaux WebLLM via WebGPU.
- **Interopérabilité** : import de vos documents (Word, OpenDocument, PDF, images SVG/PNG/JPG/WebP) et export vers de nombreux formats.

---

## ✦ Ça compose quoi ?

| | | |
|---|---|---|
| 🎉 Flyers & affiches | 📚 Brochures & catalogues | 📰 Magazines & newsletters |
| 🎓 Supports de cours | 📊 Rapports & documents pro | 🎵 Pochettes, programmes, livrets |

---

## ✦ Comment l'utiliser

### En ligne (rien à installer)
→ **[https://superprint.cc](https://superprint.cc)** — l'app s'ouvre en quelques secondes.

### En local (une seule ligne)
Prérequis : [Node.js 18+](https://nodejs.org)

**Windows (PowerShell)**
```powershell
npx.cmd superprint@latest
```

**macOS / Linux**
```bash
npx superprint
```

Au premier lancement, le paquet télécharge l'application (~50 Mo), installe ses dépendances et ouvre **http://127.0.0.1:5173** — le serveur reste en boucle locale (pas exposé sur le réseau).

---

## ✦ Le dépôt

| Dossier | Rôle |
|---|---|
| `superprint/` | L'application web complète + la landing + le studio SP213 + la documentation |
| `sp213-local/` | La distribution locale (Vite + WebLLM), servie par le lanceur npm |
| `superprint-npm/` | Le lanceur npm `superprint` (`npx superprint`) |

---

## ✦ Contacts

- **Site** : [superprint.cc](https://superprint.cc)
- **Email** : [contact@superprint.cc](mailto:contact@superprint.cc)
- **X / Twitter** : [@SUPER_PRINT_app](https://x.com/SUPER_PRINT_app)
- **Studio IA** : [superprint.cc/sp213-studio.html](https://superprint.cc/sp213-studio.html)

**Édité par** Simon Dupont-Gellert & Clémence Brunet — un projet indépendant, sans publicité, sans collecte de données.

---

*SuperPrint est fourni gratuitement, « en l'état ». Les marques citées appartiennent à leurs détenteurs respectifs.*