> **English** · **[Français](#français)** plus bas

# SuperPrint @VERSION@ — desktop applications

Three applications, **three systems, one version number**:

| | Application | What it is |
|---|---|---|
| 1 | **SuperPrint** | The DTP desk: multipage layout, prepress, CMYK separations, PDF export and imposition. |
| 2 | **Studio IA** | Describe a layout in one sentence — the AI composes it, you refine it, you export it. |
| 3 | **SuperTyPo** | The type engine: take a typeface apart, redraw each character as curves, export it again. |

**Free · no account · fully offline once installed.** The desktop builds are in **beta**:
complete and usable, still young.

**Sizes** — around **32 MB** per installer for SuperPrint and Studio IA, **2 MB** for SuperTyPo.
The Linux `.AppImage` is larger (**107 MB**, **77 MB** for SuperTyPo): it carries its own runtime
so that it runs everywhere without installing anything.

## ⚠️ The file names never change

This is the **living** release: its files are **replaced at every build**. That is exactly
why the download links on the site always serve the newest version — a link only has to
keep this shape:

```
https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/<file name>
```

The 21 file names are the assets listed below this text — `SuperPrint-Windows-x64-setup.exe`,
`Studio-IA-macOS-AppleSilicon.dmg`, `SuperTyPo-Linux-x86_64.deb`, and so on. Because they
never change, nothing on the site has to be edited when a version ships.

**Looking for one particular version?** The frozen archives are never rewritten:
[SuperPrint @VERSION@](https://github.com/zigmoon/SUPERPRINT/releases/tag/desktop-v@VERSION@) ·
[every version ever built](https://github.com/zigmoon/SUPERPRINT/releases).

## Easier than GitHub

| | |
|---|---|
| **Download page** | <https://superprint.cc/> — Windows, macOS and Linux, in English, French and Japanese |
| **Nothing to install** | <https://superprint.cc/app/index.html> — the full editor in the browser |
| **Changelog** | <https://app.zigmoon.com/release.html> — what changed, version by version |
| **Documentation** | <https://superprint.cc/documentation.html> |
| **Questions** | <https://superprint.cc/faq.html> |

## Installing

- **Windows** — `.exe` (installer) or `.msi` (for managed deployments). Remove it from
  *Settings → Apps*.
- **macOS** — `.dmg`, for **Apple silicon** or **Intel**. Open the disk image, drag the
  application to *Applications*. The image also holds **`Désinstaller <application>.command`**,
  which removes the application and its preferences.
  *These builds are not notarised by Apple: if macOS blocks the first launch, right-click the
  application → **Open**, or allow it under System Settings → Privacy & Security →
  **Open Anyway**.*
- **Linux** — `.deb` (Debian, Ubuntu), `.rpm` (Fedora, openSUSE) or `.AppImage` (no
  installation: make it executable and run it). The packages uninstall through your package
  manager.

## Integrity

The **frozen archives** — one per version, tag `desktop-v*` — carry a `SHA256SUMS` file with
the checksum of each of the 21 files. This living release does not: its files are replaced,
so a checksum published here would be wrong the next day.

## Licence, authors, contact

SuperPrint is **proprietary** software, designed, written and published by
**Simon Dupont-Gellert** and **Clémence Brunet**. The client-side source lives in this
repository; the terms are in [LICENSE](https://github.com/zigmoon/SUPERPRINT/blob/main/LICENSE).

**Write to us: <contact@superprint.cc>** — bug reports, feature requests, and “how do I do X”
questions are all welcome. We usually answer within 24–48 h.

---

<a id="français"></a>

> **[English](#superprint-version--desktop-applications)** ci-dessus · **Français**

# SuperPrint @VERSION@ — applications de bureau

Trois applications, **trois systèmes, un seul numéro de version** :

| | Application | Ce que c'est |
|---|---|---|
| 1 | **SuperPrint** | Le bureau de PAO : mise en page multipage, prépresse, séparations CMJN, export PDF et imposition. |
| 2 | **Studio IA** | Décrivez une maquette en une phrase — l'IA la compose, vous la corrigez, vous l'exportez. |
| 3 | **SuperTyPo** | Le moteur typographique : décomposez une police, redessinez chaque caractère en courbes, réexportez-la. |

**Gratuit · sans compte · entièrement hors ligne une fois installé.** Les versions de bureau
sont en **beta** : complètes et utilisables, mais encore jeunes.

**Tailles** — environ **32 Mo** par installeur pour SuperPrint et Studio IA, **2 Mo** pour
SuperTyPo. L'`.AppImage` Linux est plus gros (**107 Mo**, **77 Mo** pour SuperTyPo) : il
embarque son propre moteur d'exécution, ce qui lui permet de tourner partout sans rien installer.

## ⚠️ Les noms de fichiers ne changent jamais

C'est la version **vivante** : ses fichiers sont **remplacés à chaque construction**. C'est
précisément pourquoi les liens de téléchargement du site servent toujours la version la plus
récente — un lien n'a qu'à garder cette forme :

```
https://github.com/zigmoon/SUPERPRINT/releases/download/desktop-latest/<nom de fichier>
```

Les 21 noms de fichiers sont les fichiers listés sous ce texte — `SuperPrint-Windows-x64-setup.exe`,
`Studio-IA-macOS-AppleSilicon.dmg`, `SuperTyPo-Linux-x86_64.deb`, etc. Comme ils ne changent
jamais, rien n'est à modifier sur le site quand une version paraît.

**Vous cherchez une version précise ?** Les archives figées ne sont jamais réécrites :
[SuperPrint @VERSION@](https://github.com/zigmoon/SUPERPRINT/releases/tag/desktop-v@VERSION@) ·
[toutes les versions jamais construites](https://github.com/zigmoon/SUPERPRINT/releases).

## Plus simple que GitHub

| | |
|---|---|
| **Page de téléchargement** | <https://superprint.cc/> — Windows, macOS et Linux, en français, anglais et japonais |
| **Rien à installer** | <https://superprint.cc/app/index.html> — l'éditeur complet dans le navigateur |
| **Journal des versions** | <https://app.zigmoon.com/release.html> — ce qui a changé, version par version |
| **Documentation** | <https://superprint.cc/documentation.html> |
| **Questions** | <https://superprint.cc/faq.html> |

## Installation

- **Windows** — `.exe` (installeur) ou `.msi` (déploiements gérés). La désinstallation se fait
  dans *Paramètres → Applications*.
- **macOS** — `.dmg`, pour **Apple silicon** ou **Intel**. Ouvrez l'image disque, glissez
  l'application dans *Applications*. L'image contient aussi
  **`Désinstaller <application>.command`**, qui retire l'application et ses préférences.
  *Ces versions ne sont pas notarisées par Apple : si macOS bloque le premier lancement,
  faites un clic droit sur l'application → **Ouvrir**, ou autorisez-la dans Réglages du
  système → Confidentialité et sécurité → **Ouvrir quand même**.*
- **Linux** — `.deb` (Debian, Ubuntu), `.rpm` (Fedora, openSUSE) ou `.AppImage` (sans
  installation : rendez-le exécutable et lancez-le). Les paquets se désinstallent par votre
  gestionnaire de paquets.

## Intégrité

Les **archives figées** — une par version, étiquette `desktop-v*` — portent un fichier
`SHA256SUMS` avec l'empreinte de chacun des 21 fichiers. Cette version vivante n'en a pas :
ses fichiers sont remplacés, une empreinte publiée ici serait donc fausse le lendemain.

## Licence, auteurs, contact

SuperPrint est un logiciel **propriétaire**, conçu, écrit et édité par
**Simon Dupont-Gellert** et **Clémence Brunet**. Le code côté client vit dans ce dépôt ; les
termes sont dans [LICENSE](https://github.com/zigmoon/SUPERPRINT/blob/main/LICENSE).

**Écrivez-nous : <contact@superprint.cc>** — signalements de bogues, demandes de
fonctionnalités et questions « comment je fais pour… » sont tous bienvenus. Nous répondons
généralement sous 24–48 h.
