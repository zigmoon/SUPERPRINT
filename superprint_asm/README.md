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

Deux modules écrits à la main.

### `src/luma.wat` — luminance Rec. 709 (RVB → niveaux de gris)

```wat
y = arrondi(0.2126·r + 0.7152·g + 0.0722·b), borné 0..255
```

C'est exactement le calcul du chemin « export N&B » de SuperPrint — celui du
défaut **PDF de 131 Mo** relevé par le **rapport de test interne** (non publié,
conservé hors du dépôt) : images stockées brutes, non compressées.

### `src/color8.wat` — CMJN ↔ RVB (arithmétique entière)

```wat
RVB → CMJN :  max = max(r,g,b) ; k = 255 - max
              c = ((max - r)·255 + max/2) / max      (idem m, y)
CMJN → RVB :  kc = 255 - k
              r = ((255 - c)·kc + 127) / 255         (idem g, b)
```

Tout est **entier** (divisions tronquées) : le résultat est reproductible au bit
près et ne dépend d'aucun réglage de virgule flottante. C'est la brique de la
chaîne **imprimeur** (conversion d'image CMJN).

**Fonctions exportées**

| Fonction | Module | Rôle |
|---|---|---|
| `luma_rgb_to_gray8(src, dst, n)` | `luma` | Lit `n` triplets RVB à `src`, écrit `n` octets de gris à `dst` |
| `luma_rgb(r, g, b)` | `luma` | Luminance d'un seul pixel RVB |
| `rgb_to_cmyk(src, dst, n)` | `color8` | Lit `n` triplets RVB, écrit `n` quadruplets CMJN |
| `cmyk_to_rgb(src, dst, n)` | `color8` | Lit `n` quadruplets CMJN, écrit `n` triplets RVB |
| `rgb_to_cmyk_px` · `cmyk_to_rgb_px` | `color8` | Un pixel, résultat empaqueté en `i64` |
| `memory` | — | Mémoire linéaire (512 pages = 32 Mio) |

## Point délicat, traité

L'arrondi doit être **identique à celui du noyau Rust** (`f64::round` :
« au plus proche, loin de zéro »), sinon les deux étages divergent au
demi-point exact. On utilise donc `floor(y + 0.5)` — et **surtout pas**
`f64.nearest` de WebAssembly, qui arrondit au pair et donnerait un autre
résultat. Le fichier `src/luma.wat` le documente.

Pour **CMJN ↔ RVB**, le piège est ailleurs : si l'on **tronque** à l'aller et
qu'on arrondit au retour, l'aller-retour dérive d'un cran sur **près d'un pixel
sur deux** (mesuré : 9720 écarts sur 20 000). Les deux sens arrondissent donc :
l'aller-retour redevient exact (0 écart sur 20 000).

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
| `npm test` | Tests des deux modules : cas connus, tampons, aller-retour, bornage |
| `npm run cross-check` | **Parité avec le noyau Rust** (`luma_dump` + `color8_dump`, 5000 pixels chacun) |
| `node tools/bench.mjs` | WebAssembly contre JavaScript sur un grand tampon |
| `npm run verify` | `build` + `test` + `cross-check` |

## Vérification

`npm run verify` enchaîne l'assemblage, les tests et la parité Rust. Voici sa
sortie sur la machine de développement :

```
── luma.wasm (luminance)
✓ noir · blanc · gris neutre · primaires (rouge, vert, bleu)
✓ tampon de 1000 pixels identique au calcul de référence
── color8.wasm (RVB ↔ CMJN)
✓ rouge pur · blanc · noir → CMJN attendus
✓ RVB → CMJN : 20 000 pixels conformes à la référence
✓ CMJN → RVB : 20 000 pixels conformes à la référence
✓ aller-retour RVB → CMJN → RVB : 20 000 pixels, 0 écart
── parité Rust ↔ WebAssembly
✓ luma   : 5000 pixels, 0 écart
✓ color8 : 5000 pixels, 0 écart
```

La vérification croisée compare, **entrée par entrée**, la sortie des modules
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

| Implémentation | Temps (4 Mpx) |
|---|---|
| WebAssembly (WAT écrit à la main) | **≈ 30 ms** |
| JavaScript (boucle pure) | **≈ 27 ms** |

Écart de **résultat** : **0**. Ce sont des mesures **indicatives** : elles
varient de quelques millisecondes d'une exécution à l'autre, et l'ordre de
grandeur seul compte.

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

Ces modules couvrent **deux** primitives critiques (luminance, CMJN ↔ RVB),
démontrées et mesurées. Ce n'est **pas** un portage de SuperPrint en assembleur
— un tel portage n'aurait ni sens ni fin. Le but est de disposer, au niveau le
plus bas, de briques **prouvées identiques** au Rust et au JS, sur lesquelles on
peut s'appuyer.

## Licence

**AGPL-3.0-or-later** — voir [`LICENSE`](LICENSE). Composants tiers :
[`NOTICE.md`](NOTICE.md). Marques : [`TRADEMARKS.md`](TRADEMARKS.md).
