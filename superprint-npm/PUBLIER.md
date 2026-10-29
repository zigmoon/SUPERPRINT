# Publier SuperPrint sur npm

Le package est **prêt** dans le dossier `superprint-npm/`.
Une seule commande pour l'utilisateur final : **`npx superprint`** (identique Mac + PC).

## 1. Créer le compte npm (si pas déjà fait)

1. Va sur [npmjs.com](https://www.npmjs.com/signup) et crée ton compte.
2. Vérifie ton email (obligatoire pour publier).

## 2. Se connecter en ligne de commande

Ouvre un terminal **dans le dossier `superprint-npm/`** :

```bash
npm login --auth-type=web
```

> 🔴 **MESURÉ LE 15/10/2026 — LE COMPTE `zigmoon` NE SAISIT NI NOM NI MOT DE PASSE.**
> `npm login --auth-type=web` n'affiche **aucun** champ « Username » / « Password » utilisable : il imprime une
> URL `https://www.npmjs.com/login?next=/login/cli/<identifiant>` et **attend**, en laissant la connexion
> ouverte côté npm. Il faut ouvrir cette URL dans un navigateur **où la session npmjs.com est déjà active**, et
> valider. npm écrit alors `Logged in on https://registry.npmjs.org/.` et **remplace le jeton de `~/.npmrc`**.
>   · Le contrôle qui ne trompe pas est `npm whoami` → il doit répondre `zigmoon`, et non `E401`.
>   · ⚠️ Un `npm login` **interrompu** (Ctrl-C, ou un prompt « Username: » collé puis abandonné) **laisse le
>     `.npmrc` intact** — donc l'ancien jeton, probablement expiré. **La date de `~/.npmrc` est le contrôle** :
>     si elle n'a pas bougé, la connexion n'a pas eu lieu, quoi qu'ait affiché le terminal.
>   · ⚠️ Et un lien de connexion **appartient à UNE session** : l'URL d'un `npm login` déjà terminé ne connecte
>     rien. Il faut celle de la session en cours — le processus doit tourner pendant la validation.

## 3. Publier (la 1ʳᵉ fois)

```bash
npm publish
```

C'est tout. Le package `superprint` est en ligne (version du paquet : **1.0.122** — la 1.0.120 est celle publiée le 26/10/2026 à 20:40:30 UTC, voir l'état mesuré plus bas ; la 1.0.121 a été préparée mais **n'a pas été publiée**).

> 🔑 **MESURÉ LE 15/10/2026 — LA PUBLICATION EXIGE UNE CLÉ DE SÉCURITÉ, ET UN CODE DE 16 CHIFFRES.**
> Ce compte a une 2FA de type **clé de sécurité** (WebAuthn), **pas** un code TOTP à 6 chiffres : `npm publish`
> échoue donc en `EOTP`, et **aucun code à 6 chiffres ne marchera**, même frais — essayé pour rien trois fois.
> Le message de npm parle vaguement d'« authenticator » ; c'est le **registre** qui dit la vérité, dans un
> en-tête de sa réponse 401 : `npm-notice: Open https://www.npmjs.com/login/<uuid> to use your security key for
> authentication`. Ouvrir cette URL, valider avec la clé : la page affiche **« Use the following one-time
> password in your terminal »** suivi d'un code de **16 chiffres**, à passer ensuite en
> `npm publish --otp=<16 chiffres>`.
>
> ⚠️ **npm MASQUE CETTE URL QUAND IL N'Y A PAS DE TERMINAL INTERACTIF** : il imprime
> `https://www.npmjs.com/auth/cli/***`, et le `***` est **littéral** — il est **aussi** dans le journal de
> débogage, donc le chercher là ne sert à rien. Pour la retrouver malgré tout, on interroge le registre
> directement (l'en-tête `npm-notice` accompagne un `PUT` refusé) :
>
> ```bash
> curl -sS -i -X PUT -H "Authorization: Bearer <jeton de ~/.npmrc>" \
>      -H "Content-Type: application/json" --data '{}' \
>      https://registry.npmjs.org/superprint | grep -i npm-notice
> ```
>
> Un `PUT` à corps vide ne peut **rien** publier : c'est une sonde sans effet, faite exprès.

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

> 🔎 **MAIS `npm view` NE PROUVE RIEN SUR LE CONTENU.** Le contrôle qui fait foi, mesuré le 19/10/2026, est de **télécharger le tarball publié et de l'ouvrir** :
>
> ```powershell
> $d = Invoke-RestMethod https://registry.npmjs.org/superprint
> $d.'dist-tags'.latest          # doit dire 1.0.116
> $d.time.'1.0.116'              # horodatage = preuve de publication
> Invoke-WebRequest $d.versions.'1.0.116'.dist.tarball -OutFile sp.tgz
> (Get-FileHash sp.tgz -Algorithm SHA1).Hash.ToLower()   # == $d.versions.'1.0.116'.dist.shasum
> tar -xzf sp.tgz ; Select-String .\package\cli.mjs -Pattern "MIN_APP_VERSION ="
> ```
>
> Une empreinte prouve qu'un fichier est intact, **pas** qu'il est le bon : c'est la **lecture dans l'archive** qui tranche. C'est ainsi qu'a été établi que le `1.0.116` en ligne contient bien `MIN_APP_VERSION = '1.7.683'`.

## ⚠️ Avant de publier — fichiers à déployer sur superprint.cc

Le CLI télécharge 2 fichiers depuis superprint.cc. Ils doivent être à jour sur le FTP :

| Fichier | Rôle |
|---|---|
| `sp213-local.zip` | L'application (téléchargée au 1er lancement, ~58 Mo) — hébergée sur `app.zigmoon.com/sp213-local.zip` |
| `version.txt` | Version en ligne (`1.7.700`) — permet la détection de mise à jour. À déployer en même temps que le zip. |

> `version.txt` : si absent, le CLI affiche "Version en ligne : superprint.cc" sans version — pas bloquant, mais mieux vaut le déployer.

> 📦 Le zip est régénéré par **`node tools/make-release-zip.mjs`** (depuis la racine du repo : il crée `superprint/sp213-local.zip` puis contrôle le résultat). ⚠️ Le script est **suivi par git** — celui-ci et non un script de `_dev/`, qui est ignoré et n'existerait pas sur une autre machine. Il n'est **pas commité** dans git (~58 Mo) — il se déploie par FTP sur `app.zigmoon.com/sp213-local.zip`, accompagné de `superprint/version.txt` → `https://superprint.cc/version.txt`.

> ⚠️ **Ordre impératif** : téléverser le zip ET le site **avant** d'avancer `MIN_APP_VERSION` dans `cli.mjs`, sinon `npx superprint` s'arrête sur « downloaded version is invalid or older than the online version ». Plancher actuel : **1.7.700** — celui de la version **réellement déployée**, vérifié dans l'archive téléchargée. Rappel de la mécanique : le CLI prend le **plus récent** des deux (`newestVersion(version.txt, MIN_APP_VERSION)`), donc un plancher **en retard** accepte tout ce qui est plus nouveau — il ne bloque personne ; un plancher **en avance**, lui, bloque tout le monde.
>
> 📊 **ÉTAT RÉEL LE 29/10/2026 — LA 1.7.700 EST CONSTRUITE, RIEN N'EST TÉLÉVERSÉ.**
> Dernière version en ligne, mesurée et ouverte : **1.7.697** (`superprint.cc/version.txt`,
> Last-Modified `Tue, 27 Oct 2026 01:03:09 GMT` ; zip servi **56 881 718 octets**, Last-Modified
> `Tue, 27 Oct 2026 01:13:10 GMT`, sha256 `6701b4f5…1ffa1f8`, `main.js` 6 492 024 octets, zéro CR).
> La 1.7.700 est construite et contrôlée, mais **rien n'a été déposé** : `version.txt` répond encore
> `1.7.697`. **Le plancher reste donc à 1.7.697**, qui est la version réellement en ligne — un
> plancher en avance bloquerait `npx superprint` pour tout le monde.
> Mesures du zip **1.7.700** prêt à déposer : **56 889 938 octets**, sha256
> `6AF188EB…9DBD4F3`, `public/superprint/version.txt` = `1.7.700`, `public/superprint/app/JS/main.js`
> **6 508 318 octets**, sha256 `04FF20E6…4FEA8AD` — **le même hachage que la source du dépôt**,
> ce qui est le contrôle qui compte : l'archive contient bien le correctif d'export, pas l'ancien
> fichier. Aucun `node_modules` dans l'archive.
> ⚠️ **CE PARAGRAPHE EST RÉÉCRIT À LA MAIN À CHAQUE LIVRAISON, ET C'EST LA CINQUIÈME FOIS.** Le
> script de bump remplace le numéro de version partout, y compris dans cette prose : il venait
> encore d'écrire « LA 1.7.700 EST EN LIGNE, VÉRIFIÉE DANS L'ARCHIVE » avec l'ancienne empreinte de
> cache et les anciennes tailles, alors que rien n'était déposé. **Après chaque bump, relire ce bloc
> et le remettre sur des mesures réelles** — c'est la seule partie du fichier que le script ne peut
> pas mesurer. (`cli.mjs` est dans la liste d'exclusion du bump : ses mesures, elles, restent
> justes.)
>
> ⚠️ **CE QUI RESTE EN RETARD, ET QU'IL FAUT DIRE** : `release.html` sur `app.zigmoon.com`
> s'arrête à la **1.7.694** (329 blocs ; le dépôt en porte **333**, avec 695 à 698) — c'est un
> fichier à déposer séparément, il ne suit pas le dossier `superprint/`. Les notes de version sont en
> retard sur les fichiers, pas l'inverse.
> Pour npm : le registre est à **`latest = 1.0.122`**, publié le **28/10/2026**. Le présent paquet est
> préparé en **1.0.124** avec le plancher à **1.7.697** — la version réellement en ligne. Il est
> publiable **tel quel**, sans attendre le déploiement de la 1.7.700. `npm publish` reste à faire
> (clé de sécurité WebAuthn + code de 16 chiffres, §3), `npm whoami` répondant **401** sur cette
> machine.
>
> 📊 **ÉTAT EN LIGNE, MESURÉ LE 19/10/2026 à 21 h 45 — le téléversement a eu lieu** : `superprint.cc/version.txt` répond **`1.7.685`** (`Last-Modified 19:27:34 GMT`) ; `app.zigmoon.com/sp213-local.zip` sert **56 795 983 octets**, `Last-Modified 19:25:40 GMT`, et son sha256 (`8A9CFE8B…0C4406`) est **identique** à celui du zip local — ce n'est donc pas une empreinte supposée, c'est le même fichier, et `version.txt` dit `1.7.685` **DANS** l'archive. `superprint.cc/index.html` et `superprint.cc/app/index.html` portent la 1.7.685 (86 et 27 occurrences, aucune autre version vivante). Le plancher peut donc suivre : **1.7.685**, et `superprint@1.0.117` est publié avec.<br>*(La mesure du 17 h — « 1.7.682 partout, zip 1.7.683 prêt mais pas en ligne » — était exacte à l'instant où elle a été prise, et c'est précisément ce qu'il fallait : le plancher n'a pas bougé d'un cran tant que le téléversement n'avait pas eu lieu.)*
>
> 🔴 **CE QUE LE BUMP DE 1.7.683 A APPRIS, ET QU'IL FAUT RELIRE À CHAQUE FOIS** : le script de bump remplace « 1.7.682 » **partout**, y compris dans les commentaires. Il avait donc réécrit le bloc de mesures de `cli.mjs` en affirmant « version.txt = 1.7.683 — À JOUR » et « avancer le plancher est sûr », alors que rien n'était téléversé — et il avait avancé `MIN_APP_VERSION` à 1.7.683, ce qui aurait **cassé `npx superprint` pour tout le monde** (zip 1.7.682 < plancher 1.7.683). Un plancher en avance ne se voit pas à la lecture du code : il n'apparaît qu'à l'exécution. Après chaque bump : **relire ce bloc et `MIN_APP_VERSION`, et les remettre sur les mesures réelles.**
>
> 📊 **ÉTAT EN LIGNE, MESURÉ LE 16/10/2026 à 22 h — et lu DANS l'archive**, comme la leçon sur les empreintes l'exige plus bas : `version.txt` sur superprint.cc répond **`1.7.630`** ; le zip servi par `app.zigmoon.com/sp213-local.zip` pèse **55 837 339 octets**, et son `public/superprint/version.txt` interne dit **`1.7.630`**. En revanche `maquettePanel` et `_SP_MAQUETTE_631` y sont **absents** de `main.js` : la **1.7.631 n'est donc pas encore téléversée**, ce qui est l'état attendu au moment d'écrire ces lignes. *(La mesure précédente, « 55 835 569 octets, sha256 `2DD44B96…` », reste exacte — pour le zip de la 1.7.629.)*
>
> 🆕 **1.7.631 EST PRÊTE À TÉLÉVERSER** — régénérée le 16/10/2026 avec `node tools/make-release-zip.mjs`, le script **suivi par git** (les deux scripts de zip, celui-ci et `_dev/scripts/_make_zip.cjs`, produisent le même contenu : 831 entrées, mêmes 14 entrées racine, même taille ; seul l'agencement des octets diffère). **55 852 256 octets**, tous les contrôles verts : `version.txt` et `package.json` à `1.7.631`, badge `v1.7.631`, `CACHE_NAME` `superprint-shell-v1.7.631-trappe-reglages-maquette`, empreinte `20261015-v631-trappe-reglages-maquette`, 46 vignettes de modèles, `node_modules` **absent**, les quatre documents de licence présents. **Avancer `MIN_APP_VERSION` à `1.7.631` SEULEMENT après avoir téléversé le zip ET `version.txt`.**
>
> ✅ **PUBLICATION `superprint@1.0.115` — ÉTAT MESURÉ le 16/10/2026 à 12:09 (10:07:26 UTC).** Cette livraison ne change pas le lanceur : elle ajoute l'**image de présentation** aux README, visible **sur GitHub ET sur npm**. Le README affiché par npm vient du paquet publié, donc il fallait republier pour que l'image y apparaisse.
>
> 🔴 **CE QUE CETTE PUBLICATION A APPRIS SUR LE CODE 2FA, ET C'EST UTILE POUR LES PROCHAINES FOIS.** Le premier essai a échoué en `EOTP` — et **un second essai avec le MÊME code a échoué aussi**, ce qui est le piège : ces codes ne durent que quelques minutes, et un code recopié après coup est expiré. Ce qui marche : ouvrir l'URL du `npm-notice`, valider la clé, **lire le code affiché sur la page** et publier dans la foulée. Deux détails concrets : (1) la page npm affiche le code dans un `<h1>`, donc le lire directement évite tout intermédiaire et toute faute de recopie ; (2) le code **change à chaque validation** — un code noté d'une fois précédente ne vaut plus rien.
>
> Et le cache de lecture a retardé comme d'habitude : `dist-tags` annonçait encore `1.0.114` et le tarball renvoyait 404 pendant les premières minutes, **sans que rien n'ait échoué**. Puis dans l'ordre : `time` a listé `1.0.115` à 10:07:26 UTC, `dist-tags.latest` est passé à `1.0.115`, et la page npm a affiché la nouvelle version **avec l'image chargée** (1883 × 1286 px naturelle, affichée 731 × 499).>
> ✅ **ET LE CLI A ÉTÉ ESSAYÉ POUR DE VRAI, PAS SEULEMENT INSPECTÉ.** Lancé dans un dossier personnel **isolé** (pour ne pas toucher l'installation de la machine), l'enchaînement complet a été observé : `[1/4] Latest online version: v1.7.629` → `[2/4] Downloaded (53 MB)` → `[3/4] Application extracted` **sans l'erreur de version**, donc le contrôle `compareVersions(downloadedVersion, onlineVersion)` **passe** → `[4/4] Dependencies installed` → `SuperPrint runs at: http://127.0.0.1:5173/`. L'application installée porte `version.txt` = `1.7.629`, le `CACHE_NAME` `superprint-shell-v1.7.629-regles-qui-suivent-la-page`, l'empreinte `JS/main.js?v=20261015-v629-regles-qui-suivent-la-page`, et son `main.js` contient les marqueurs du correctif des règles. ⚠️ L'URL de l'éditeur sur le serveur local est `/superprint/app/index.html` — la racine `/` sert la page d'accueil, dont les mentions de version sont historiques et ne disent rien de la version installée.
>
> 🔴 **ET LA LEÇON SUR LES EMPREINTES, À NE PAS OUBLIER** : le chiffre qui figurait ici avant, « zip 1.7.617, 56 459 564 octets, sha256 `EAB82EEA…8B951` », était **exact** — mais pour le zip de la version **PRÉCÉDENTE**. Le fichier déployé avait été retéléchargé et **haché**, jamais **ouvert**. Une empreinte prouve qu'un fichier est intact, **pas** qu'il est le bon. La lecture qui fait foi est **DANS l'archive** : `version.txt` et le `package.json` interne, plus le `CACHE_NAME` du service worker (`superprint-shell-v1.7.629-regles-qui-suivent-la-page` pour cette version).

> ✅ **PUBLICATION `superprint@1.0.116` — ÉTAT MESURÉ le 19/10/2026 à 12:56:52 UTC.** Cette livraison aligne le plancher : `MIN_APP_VERSION` passe de `1.7.629` à **`1.7.683`** (53 versions de retard). Le tarball **publié** a été retéléchargé et **ouvert**, pas seulement haché : `package/cli.mjs` porte `const MIN_APP_VERSION = '1.7.683';`, `package.json` dit `1.0.116`, 7 fichiers, `shasum` local `e3b76f41aa97ac5f5220613455f7b3720789f6d7` **identique** au `dist.shasum` du registre.
>
> 🔑 **CE QUI A DÉBLOQUÉ LA PUBLICATION — ET C'EST LA VRAIE LEÇON : npm FAIT TOUTE LA 2FA TOUT SEUL, À CONDITION D'AVOIR UN VRAI TERMINAL.** Depuis un shell **non interactif** (sortie redirigée, pas de TTY), `npm publish` échoue en `EOTP` **immédiatement** en imprimant `https://www.npmjs.com/auth/cli/***` — un `***` **littéral**, présent **aussi** dans le journal de débogage : inutilisable. C'est ce qui avait fait croire qu'il fallait un code de 16 chiffres recopié à la main. Lancé dans une **console réelle** (`Start-Process $env:ComSpec -ArgumentList '/k', 'npm publish'`), npm ouvre lui-même le navigateur, puis **attend en interrogeant** `GET https://registry.npmjs.org/-/v1/done?authId=…` — `202` = toujours en attente, `200` = validé — et **rejoue le `PUT` tout seul**. Relevé du journal de ce jour : `202` de 12:55:13 à 12:56:36, puis `200`, `verbose web auth done-check finished`, `notice Your package is being processed…`, **`PUT 202`**, `exit 0`. Aucun code à recopier, donc aucune faute de recopie possible.
>   · **À retenir** : npm **masque les URL d'authentification dès que la sortie n'est pas un terminal**. Ne pas tenter de les récupérer (ni en ligne de commande, ni dans `_logs`, ni via l'en-tête `npm-notice`) : **ouvrir une console** et laisser npm piloter le navigateur. La méthode du code de 16 chiffres plus haut reste valable en secours, mais elle n'est **pas** nécessaire.
>   · Avant cela, `npm whoami` répondait déjà `zigmoon` : le `E404` sur `PUT /superprint` n'était qu'un **masque** d'erreur d'authentification, et `EOTP` la seule chose qui manquait réellement.
>   · Le cache de lecture a retardé comme d'habitude : `dist-tags.latest` est resté à `1.0.115` pendant environ **50 s** après le `PUT 202`, puis est passé à `1.0.116`. Rien n'avait échoué.

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
