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

C'est tout. Le package `superprint@1.0.0` est en ligne.

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
| `sp213-local.zip` | L'application (téléchargée au 1er lancement, ~52 Mo) — hébergée sur `app.zigmoon.com/sp213-local.zip` |
| `version.txt` | Version en ligne (`1.7.260`) — permet la détection de mise à jour. **⚠️ Pas encore en ligne, à déployer.** |

> `version.txt` : si absent, le CLI affiche "Version en ligne : superprint.cc" sans version — pas bloquant, mais mieux vaut le déployer.

## 📋 La commande à copier-coller (nouvelle)

Après publication, la commande universelle devient :

```bash
npx superprint
```

- **Windows** (PowerShell) : `npx superprint`
- **macOS/Linux** (Terminal) : `npx superprint`
- Identique partout. ✅

> ⚠️ Il faut que Node.js soit installé (comme avant). `npx` est inclus avec npm.
