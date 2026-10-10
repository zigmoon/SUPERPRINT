# SuperPrint — noyau en assembleur (WebAssembly Text)

Le noyau de calcul de SuperPrint, écrit **à la main en assembleur**.

> ⚠️ **Dossier indépendant.** Il ne modifie ni `superprint/` (l'application
> servie en production) ni `superprint_ASTRO/` ni `superprint_rust/`.

## Pourquoi « WebAssembly Text » et pas x86-64

SuperPrint est une application qui tourne **dans le navigateur**. Un assembleur
natif (x86-64, ARM…) y serait **inexploitable** : il faudrait réimplémenter le
DOM, le canevas, le réseau — des années de travail, sans aucun bénéfice.

**WebAssembly Text (WAT)** est *l'assembleur du Web* : la forme textuelle et
lisible de l'assembleur que le navigateur exécute. C'est le seul langage
d'assemblage qui a un sens ici, et il sert là où il brille : les **boucles
serrées sur les pixels**.

## Ce que contient ce dépôt

Un module écrit à la main, `src/luma.wat` : la **luminance Rec. 709**
(RVB → niveaux de gris) sur un tampon de pixels.

```wat
y = arrondi(0.2126·r + 0.7152·g + 0.0722·b), borné 0..255
```

C'est exactement le calcul du chemin « export N&B » de SuperPrint — celui du
défaut **PDF de 131 Mo** décrit dans `superprint/RAPPORT-WORKFLOW-415.md`
(images stockées brutes, non compressées).

**Fonctions exportées**

| Fonction | Rôle |
|---|---|
| `luma_rgb_to_gray8(src, dst, n)` | Lit `n` triplets RVB à `src`, écrit `n` octets de gris à `dst` |
| `luma_rgb(r, g, b)` | Luminance d'un seul pixel RVB |
| `memory` | Mémoire linéaire du module (512 pages = 32 Mio) |

## Point délicat, traité

L'arrondi doit être **identique à celui du noyau Rust** (`f64::round` :
« au plus proche, loin de zéro »), sinon les deux étages divergent au
demi-point exact. On utilise donc `floor(y + 0.5)` — et **surtout pas**
`f64.nearest` de WebAssembly, qui arrondit au pair et donnerait un autre
résultat. Le fichier `src/luma.wat` le documente.

## Prérequis

- [Node.js](https://nodejs.org) 20+ et `npm`.
- L'assembleur **`wabt`** (WebAssembly Binary Toolkit), installé par npm —
  aucune chaîne de compilation native n'est nécessaire.

```powershell
npm install
```

## Commandes

| Commande | Rôle |
|---|---|
| `npm run build` | Assemble `src/*.wat` → `dist/*.wasm` (via `wabt`) |
| `npm test` | Tests du module : cas connus, tampon, diagonale de gris, bornage |
| `npm run cross-check` | **Parité avec le noyau Rust** (`luma_dump`, 5000 triplets) |
| `node tools/bench.mjs` | WebAssembly contre JavaScript sur un grand tampon |
| `npm run verify` | `build` + `test` + `cross-check` |

## Vérification

```
✓ noir · blanc · gris neutre · primaires (rouge, vert, bleu)
✓ tampon de 1000 pixels identique au calcul de référence
✓ diagonale de gris (256 valeurs)
✓ aucune luminance hors 0..255
✓ parité Rust ↔ WebAssembly : 2000 triplets, 0 écart
```

La vérification croisée compare, **entrée par entrée**, la sortie du module
WebAssembly et celle du noyau Rust (`superprint_rust`) : les deux doivent
donner le même octet pour chaque pixel. C'est la preuve que les étages
**JS (référence) → Rust → WebAssembly** concordent.

## Chaîne complète

| Étage | Dossier | Rôle |
|---|---|---|
| Référence | `superprint/` | Application en HTML/CSS/JS (comportement de référence) |
| Vérifié | `superprint_rust/` | Noyau Rust (typage fort, tests, WebAssembly) |
| Bas niveau | **`superprint_asm/`** | Assembleur WebAssembly écrit à la main |

## Mesure, sans enjoliver

`node tools/bench.mjs 4000000` — 4 millions de pixels RVB → gris, sur la
machine de développement :

| Implémentation | Temps |
|---|---|
| WebAssembly (WAT écrit à la main) | **30,0 ms** |
| JavaScript (boucle pure) | **26,6 ms** |

Écart de résultat : **0**.

**Lecture honnête** : ici, le JavaScript est légèrement *plus rapide* — le
moteur V8 excelle sur une boucle aussi simple. WebAssembly n'apporte donc pas
un gain de vitesse sur ce cas précis. Ce qu'il apporte, et qui compte :

- **Prévisibilité** : le même résultat sur tous les moteurs et toutes les
  machines, sans dépendre des optimisations du JIT ;
- **Compacité** : le module complet fait **303 octets** ;
- **Robustesse** : mémoire linéaire bornée, sans ramasse-miettes ;
- **Socle commun** : le même code sert au navigateur et, demain, hors du
  navigateur.

Aucune promesse de « 10× plus vite » ici : ce document dit ce qui a été mesuré.

## Limites, honnêtement

Ce module couvre **une** primitive critique, démontrée et mesurée. Ce n'est
**pas** un portage de SuperPrint en assembleur — un tel portage n'aurait ni
sens ni fin. Le but est de disposer, au niveau le plus bas, d'une brique
**prouvée identique** au Rust et au JS, sur laquelle on peut s'appuyer.

## Licence

**AGPL-3.0-or-later** — voir [`LICENSE`](LICENSE). Composants tiers :
[`NOTICE.md`](NOTICE.md). Marques : [`TRADEMARKS.md`](TRADEMARKS.md).
