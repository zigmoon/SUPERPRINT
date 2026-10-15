# Publier SuperPrint sur npm

Le package est **prêt** dans le dossier `superprint-npm/`.
Une seule commande pour l'utilisateur final : **`npx superprint`** (identique Mac + PC).

## 1. Créer le compte npm (si pas déjà fait)

1. Va sur [npmjs.com](https://www.npmjs.com/signup) et crée ton compte.
2. Vérifie ton email (obligatoire pour publier).

## 2. Se connecter en ligne de commande

Ouvre un terminal **dans le dossier `superprint-npm/`** :

```bash
cd superprint-npm
npm login
```

> Saisis ton **username**, ton **email**, puis ton **password** (il ne s'affiche pas, c'est normal).
> Vérifie l'OTP/2FA si tu l'as activé.

## 3. Publier (la 1ʳᵉ fois)

```bash
npm publish
```

C'est tout. Le package `superprint` est en ligne (version du paquet : **1.0.112**).

> ⚠️ **npm 12 et preuve de présence (2FA)** : si `npm publish` affiche « Authenticate your account at … Press ENTER to open in the browser… », la publication est **staged** (préparée mais non publiée) et attend une approbation dans le navigateur — ou un code : `npm publish --otp=XXXXXX`. Ne pas relancer `npm publish` tel quel : npm répond **E409 « Cannot publish over previously staged version »**. Dans ce cas, bumper (`npm version patch --no-git-tag-version`) puis republier, ou approuver le stage (`npm stage list`, `npm stage approve <stage-id>`).

> 🔴 **MESURÉ LE 14/10/2026 — LE CATALOGUE MENT PENDANT PLUSIEURS MINUTES. NE JAMAIS EN CONCLURE QU'UNE PUBLICATION A ÉCHOUÉ.** Une publication qui réussit (`+ superprint@1.0.NNN`) n'est **pas** immédiatement lisible : les chemins de **lecture** (le packument, `dist-tags`, et **le tarball lui-même**) sont servis par un cache qui peut rester en arrière **plusieurs minutes**. Relevé ce jour-là, sur une version réellement publiée à 19:21:11 UTC :
>   · `npm view superprint version` → annonçait encore l'**ancienne** version ;
>   · `dist-tags.latest` → encore l'ancienne ;
>   · `https://registry.npmjs.org/superprint/1.0.NNN` → **404** ;
>   · `https://registry.npmjs.org/superprint/-/superprint-1.0.NNN.tgz` → **404**, alors que la version **existait**.
> Le chemin d'**écriture**, lui, est autoritaire : un `409` (« already staged » / « previously published ») signifie que la version **est là**. C'est la **contradiction entre les deux** qui doit alerter — pas le 404 seul.
> **Conséquence pratique** : après une publication, attendre quelques minutes et revérifier, au lieu de conclure trop vite. Le contrôle fiable est la lecture de `time` dans le packument (`(Invoke-RestMethod https://registry.npmjs.org/superprint).time`), qui finit par lister la version avec **son horodatage** — c'est la preuve de la publication, et non un simple 200 sur le tarball.
> ❌ **Erreur commise ce jour-là, et consignée pour ne pas la refaire** : ayant vu un 404 sur le catalogue **et** sur le tarball, j'ai conclu que la version n'existait pas et publié un **numéro neuf** (1.0.111 → 1.0.112). Les deux existent désormais, avec un contenu identique. Rien de cassé — `latest` pointe sur la plus récente — mais un numéro a été consommé pour rien.

## 4. Mettre à jour plus tard (après modification)

Bump la version dans `superprint-npm/package.json` puis republie :

```bash
npm version patch   # 1.0.0 -> 1.0.1 (ou minor / major)
npm publish
```

## 5. Vérifier

```bash
npm view superprint
```

Tu dois voir la description, la version, etc.

## ⚠️ Avant de publier — fichiers à déployer sur superprint.cc

Le CLI télécharge 2 fichiers depuis superprint.cc. Ils doivent être à jour sur le FTP :

| Fichier | Rôle |
|---|---|
| `sp213-local.zip` | L'application (téléchargée au 1er lancement, ~58 Mo) — hébergée sur `app.zigmoon.com/sp213-local.zip` |
| `version.txt` | Version en ligne (`1.7.617`) — permet la détection de mise à jour. À déployer en même temps que le zip. |

> `version.txt` : si absent, le CLI affiche "Version en ligne : superprint.cc" sans version — pas bloquant, mais mieux vaut le déployer.

> 📦 Le zip est régénéré par **`node tools/make-release-zip.mjs`** (depuis la racine du repo : il crée `superprint/sp213-local.zip` puis contrôle le résultat). ⚠️ Le script est **suivi par git** — celui-ci et non un script de `_dev/`, qui est ignoré et n'existerait pas sur une autre machine. Il n'est **pas commité** dans git (~58 Mo) — il se déploie par FTP sur `app.zigmoon.com/sp213-local.zip`, accompagné de `superprint/version.txt` → `https://superprint.cc/version.txt`.

> ⚠️ **Ordre impératif** : téléverser le zip ET le site **avant** d'avancer `MIN_APP_VERSION` dans `cli.mjs`, sinon `npx superprint` s'arrête sur « downloaded version is invalid or older than the online version ». Plancher actuel : **1.7.617**, aligné sur ce qui est EN LIGNE (zip **1.7.617**, 56 459 564 octets vérifiés le 14/10/2026 sur app.zigmoon.com — le fichier a été **retéléchargé et haché**, sha256 `EAB82EEA…8B951`, identique octet pour octet au zip local, donc l'archive est complète —, et `version.txt` = **1.7.617** sur superprint.cc).

> ⚠️ **Une version ÉGALE ne déclenche AUCUNE mise à jour.** L'étape 1/4 compare `version.txt` en ligne à la version installée : si elles sont égales, rien n'est rejoué. Relever le zip sans changer de version ne sert donc qu'aux nouvelles installations — les autres gardent l'ancienne application, sans que rien ne le signale. C'est la raison du passage à 1.7.617 : le correctif de l'ordre des calques vit dans `app/JS/main.js`, et l'application charge ce fichier avec une empreinte **figée sur la version** (`JS/main.js?v=…-v617-…`) et le met en cache sous un nom qui la porte aussi (`superprint-shell-v1.7.617-…`). Déployer le fichier sans relever ces deux chaînes n'aurait rien livré.

> 🔁 **Prochain cycle** : régénérer le zip (`node tools/make-release-zip.mjs`), le téléverser avec `version.txt`, **puis** avancer `MIN_APP_VERSION` d'une ligne dans `cli.mjs`, puis `npm version patch` + `npm publish`.

## 📋 La commande à copier-coller (nouvelle)

Après publication, la commande universelle devient :

```bash
npx superprint
```

- **Windows** (PowerShell) : `npx superprint`
- **macOS/Linux** (Terminal) : `npx superprint`
- Identique partout. ✅

> ⚠️ Il faut que Node.js soit installé (comme avant). `npx` est inclus avec npm.
