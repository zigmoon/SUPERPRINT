# superprint-core

Primitives **pures** du noyau Rust de SuperPrint — sans dépendance, sans état :

- `units` — conversions typographiques et d'impression (mm, pt, px, cm, in) ;
- `color` — couleurs RVB (8 bits) et CMJN, luminance, conversions naïves ;
- `geometry` — format de page, fond perdu, traits de coupe.

Utilisable en natif *et* en WebAssembly. Chaque fonction a ses tests unitaires ;
`cargo test` les exécute.

> Les conversions de couleur sont **naïves** (sans profil ICC). La gestion
> colorimétrique réelle passera par un module dédié (voir `docs/PLAN.md`).
