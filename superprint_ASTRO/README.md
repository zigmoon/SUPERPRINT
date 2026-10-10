# SuperPrint — site Astro

Code source du site **[superprint.cc](https://superprint.cc)**, migré vers
[Astro](https://astro.build). Le site était auparavant une collection de pages
HTML autonomes (chacune avec son `<head>` complet, sa grande feuille `<style>`
et ses `<script>` en ligne) ; Astro reprend la génération : mêmes URLs, même
rendu servi, mais un `<head>` factorisé, des composants partagés (barre quadri,
bandeau, navigation, pied de page, bloc SEO) et les scripts extraits en fichiers.

> ⚠️ **Les URLs publiées ne changent pas.** `build.format: 'preserve'` reproduit
> l'arborescence des sources : `src/pages/faq.astro` → `/faq.html`,
> `src/pages/supertypo/index.astro` → `/supertypo/index.html`.

Ce dépôt contient **le site** (pages marketing, documentation, studio, SuperTyPo)
et **le paquet applicatif servi** dans `public/app/` (l'éditeur PAO SuperPrint,
en HTML/CSS/JavaScript, qui fonctionne entièrement côté navigateur).

## Prérequis

- Node **≥ 20.3** (voir `engines` dans `package.json`).

## Commandes

| Commande | Rôle |
|---|---|
| `npm install` | Installe les dépendances |
| `npm run dev` | Serveur de développement (`http://localhost:4321`) |
| `npm run build` | Génère le site dans `dist/` |
| `npm run preview` | Sert `dist/` pour contrôle |
| `npm run check` | Contrôle de types (`@astrojs/check` + TypeScript) |
| `npm run convert` | Rejoue la conversion « HTML → Astro » (depuis `_legacy/`) |
| `npm run verify` | Compare `dist/` aux sources `_legacy/` (non-régression) |
| `npm run analyze` | Recense balises/scripts/CSS des sources historiques |

## Structure du dépôt

```
src/
├─ pages/         une page par URL : index, faq, price, rock, documentation,
│                 api, install, landing, sp213-studio, supertypo/index
├─ layouts/       BaseLayout (coquille HTML) + MarketingLayout / MinimalLayout
├─ components/    QuadriBar, BrandHeader, SiteNav, SiteFooter, Seo
├─ data/site.ts   URL du site, version publiée, entrées de navigation
├─ lib/           types des props de layout (layout.ts) et du <head> (seo.ts)
└─ styles/pages/  feuilles extraites du <style> historique, une par page

public/           fichiers servis tels quels, recopiés dans dist/ :
  ├─ app/         application PAO SuperPrint (éditeur complet, HTML/CSS/JS)
  ├─ CSS/  JS/    styles et scripts partagés (polices, moteurs canvas…)
  ├─ icons/  img/  SP/  favicon, logos, images
  ├─ supertypo/   assets du SuperTyPo (polices, moteur)
  ├─ *.php        proxies IA (ai-proxy.php, sp213-charte.php)
  ├─ .htaccess    configuration Apache (CSP, cache, HTTPS)
  └─ robots.txt, sitemap.xml, llms*.txt, manifest, service-worker.js, version.txt

_legacy/          sources HTML d'origine, entrée de la conversion et référence
                  de comparaison (voir « Conversion » ci-dessous)
supertypo/        README du sous-projet SuperTyPo
tools/            outillage de migration « HTML historique → Astro »
```

## Conversion & non-régression

La bascule « HTML historique → Astro » est pilotée par `tools/legacy-migration/`.
Les pages HTML d'origine sont conservées telles quelles dans `_legacy/` :
`convert.mjs` les **lit**, `verify.mjs` les **compare** à la sortie de `dist/`.

| Script | Rôle |
|---|---|
| `convert.mjs` | Répartit chaque page source (composants, CSS, scripts) et écrit `src/pages/<route>.astro` |
| `verify.mjs` | Compare `dist/` à `_legacy/` : éléments + attributs, texte visible, scripts |
| `analyze.mjs` | Recense `<meta>`, `<link>`, `<style>`, `<script>` et les blocs partagés |
| `probe.mjs` | Compte les `{` / `}` que le compilateur Astro interpréterait |
| `head-dump.mjs` | Extrait le `<head>` brut pour concevoir les props du layout |
| `pages.mjs` | Inventaire des pages à convertir et de leur destination Astro |

La conversion est **idempotente** : `npm run convert` reproduit à l'octet près
les fichiers déjà présents (aucune dérive). Après un `npm run build`,
`npm run verify` doit afficher « structure, texte et scripts conformes » — les
seuls écarts tolérés sont l'ordre de certaines balises `<head>` et les
commentaires des composants partagés (désormais factorisés).

> Le contenu n'est jamais réécrit : seuls `{` et `}` hors `<script>`/`<style>`
> sont encodés en entités, parce qu'Astro les lirait comme des expressions.

## Déploiement

1. `npm run build` → le site complet est dans `dist/`.
2. Publier le contenu de `dist/` à la racine de `superprint.cc`.

Le serveur cible reste **Apache/PHP** : `public/.htaccess` et les proxies
(`ai-proxy.php`, `sp213-charte.php`) sont recopiés tels quels dans `dist/`.
`dist/` étant un artefact, il n'est pas versionné.

## Documentation

| Fichier | Contenu |
|---|---|
| [`NOTICE.md`](NOTICE.md) | Composants tiers embarqués et leurs licences |
| [`TRADEMARKS.md`](TRADEMARKS.md) | Politique de marque (nom, logo, domaines) |
| [`AUDIT-ASSET-LIBRARY-2026-09-27.md`](AUDIT-ASSET-LIBRARY-2026-09-27.md) | Rapport produit : bibliothèque d'assets de l'éditeur |

> Restent **hors du dépôt public** (conservés en local, comme pour la version
> classique) : `ORGANISATION.md` (architecture interne), `VERSIONING.md`
> (procédure de version) et `RAPPORT-WORKFLOW-415.md` (rapport de test interne).

## Licence

Le code est distribué sous **GNU Affero General Public License v3.0** (AGPL-3.0) —
voir [`LICENSE`](LICENSE). Les composants tiers embarqués restent sous leurs
licences respectives ([`NOTICE.md`](NOTICE.md)) ; les noms et logos « SuperPrint »,
« SP213 » et « SuperTyPo » sont des marques, régies séparément
([`TRADEMARKS.md`](TRADEMARKS.md)).

© 2026 Simon Dupont-Gellert (Zigmoon) — publié par 2.13.
