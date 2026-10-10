# superprint-core

Primitives **pures** du noyau Rust de SuperPrint — sans dépendance, sans état :

| Module | Rôle |
|---|---|
| `units` | Conversions typographiques et d'impression (mm, pt, px, cm, in) |
| `color` | Couleurs RVB (8 bits) et CMJN **en virgule flottante**, luminance Rec. 709 |
| `color8` | Mêmes conversions **sur octets** (arithmétique entière, reproductible au bit) |
| `geometry` | Format de page, fond perdu, traits de coupe |

Utilisable en natif *et* en WebAssembly.

```powershell
cargo test --target wasm32-wasip1 -p superprint-core -- --test-threads=1
```

> Les tests s'exécutent **en WebAssembly** (`wasm32-wasip1`, lancés par Node) :
> cette machine n'a pas le linker natif MSVC. Voir le
> [README de `superprint_rust`](../../README.md).

## Ce que `color8` apporte

`color` travaille en `f64` (précision, lisibilité). `color8` travaille **sur
octets** — la forme sous laquelle une image est réellement manipulée — et
n'utilise que de l'arithmétique **entière** : le résultat est donc identique au
bit près, sans dépendre de la virgule flottante, et **rigoureusement le même**
que le module écrit à la main en assembleur WebAssembly
(`superprint_asm/src/color8.wat`), ce que la vérification croisée confirme
pixel par pixel.

> Les conversions de couleur sont **naïves** (formule algébrique, sans profil
> ICC). La gestion colorimétrique réelle passera par un module dédié
> (voir [`docs/PLAN.md`](../../docs/PLAN.md), module n° 7).
