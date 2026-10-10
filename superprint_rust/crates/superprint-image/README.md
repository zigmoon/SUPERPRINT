# superprint-image

Cœur **traitement d'image** du noyau Rust de SuperPrint. C'est la réponse
directe au défaut « **PDF de 131 Mo** » relevé par le **rapport de test
interne** (non publié, conservé hors du dépôt).

| Module | Rôle |
|---|---|
| `buffer` | Tampons typés : `RgbImage` (3 canaux), `GrayImage` (1 canal), erreurs de construction |
| `resample` | Réduction **bilinéaire** ou **plus proche voisin**, ciblage DPI |
| `compress` | Filtre PDF **RunLength** — encodage et décodage |

## Le raisonnement

Un PDF de 131 Mo n'est pas un problème de PDF : c'est un problème de **ce qu'on
met dedans**. Deux causes, deux leviers.

### Levier 1 — réduire (resample)

Un cliché de 24 Mpx en RVB brut pèse **72 Mo**. S'il est destiné à une
impression à 300 DPI, la moitié de ces pixels ne sera jamais rendue. Les ramener
à la résolution utile divise le poids par le carré du rapport :

| Source | Cible | Facteur de poids |
|---|---|---|
| 600 DPI | 300 DPI | **÷ 4** |
| 600 DPI | 150 DPI | **÷ 16** |

`target_size_for_dpi` ne **grossit jamais** une image : une source déjà en
dessous de la cible est renvoyée inchangée. `downscale_bilinear` aligne les
**centres** de pixels (`(i + 0,5) · ratio − 0,5`), sans quoi l'image dérive d'un
demi-pixel et les bords bavent.

### Levier 2 — compresser (compress)

Le format PDF définit des filtres **sans perte**. *RunLength*
(`/RunLengthDecode`, ISO 32000-2 §7.4.5) est le plus simple. Sur un **aplat** —
logo, habillage de pack, fond uni — un run répété remplace jusqu'à 128 octets
par 2.

**N'embellissons pas le résultat.** *RunLength* ne gagne **rien** sur une
photographie : en RVB entrelacé, un aplat coloré se répète tous les 3 octets,
donc les runs sont courts. Sur du bruit, le filtre **grossit** même les données
d'1 octet par tranche de 128 — c'est pourquoi `superprint-pdf` compare les deux
tailles et refuse le filtre s'il n'est pas rentable (`ImageFilter::Auto`).

## Vérifier

```powershell
cd superprint_rust

# Tests unitaires (via WebAssembly, sans linker natif) :
cargo test --target wasm32-wasip1 -p superprint-image -- --test-threads=1

# Démonstration chiffrée de bout en bout (image → PDF) :
cargo build --target wasm32-wasip1 -p superprint-pdf --example spot_image_page
node scripts/run-wasi.mjs target/wasm32-wasip1/debug/examples/spot_image_page.wasm spot-image-page.pdf
```

La démonstration affiche, à chaque étape, la taille réelle : image source, après
réduction, après compression, puis taille du PDF écrit. Elle imprime aussi la
**contre-épreuve** sur du bruit, pour montrer que le filtre y est refusé.

## Limite du harnais de test (pas de la bibliothèque)

Les exemples tournent sous **Node/WASI** parce que `cargo test` ne peut pas se
lier sans Visual Studio sur cette machine. Or le WASI de Node plafonne autour de
**32 Mo de tas** : une image de 600 DPI (65 Mo de pixels bruts) fait tomber le
processus Node (`exit -1073741819`, violation d'accès). C'est pour cela que la
démonstration vise 300 → 150 DPI par défaut.

Dans un **navigateur**, la mémoire WebAssembly monte à 4 Go : 600 → 300 DPI
passe sans difficulté. Le code de ce crate est **linéaire** en nombre de pixels,
sans copie superflue ni croissance quadratique.

## Limites (à venir, voir `docs/PLAN.md`)

- **Aucun décodeur d'image** : ce crate reçoit des pixels, il ne lit pas un
  JPEG ou un PNG. Le décodage (et donc `/DCTDecode` en sortie) viendra avec le
  reste du module n° 4.
- **Pas de `/FlateDecode`** : c'est le filtre sans perte qui conviendrait aux
  photographies. Reporté, avec le choix d'une implémentation (deflate maison ou
  crate Rust).
- **Pas de niveau de gris 1 bit** pour les planches en noir et blanc pures :
  aujourd'hui le module `buffer` fournit 8 bits par pixel, pas 1.
