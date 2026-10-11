# Vérification complète du noyau Rust de SuperPrint.
#
# Enchaîne : formatage, types, lint, build WebAssembly, tests, puis la
# production et la validation réelle de deux PDF (relus par pdf-lib).
# Les tests tournent en WebAssembly (`wasm32-wasip1`, lancés par Node), ce qui
# évite d'exiger le linker natif MSVC de Visual Studio.
#
# Usage : pwsh -File scripts/check.ps1
# Retour : 0 si tout passe, 1 sinon.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$env:Path = "$(Join-Path $HOME '.cargo\bin');$env:Path"
$cargo = Join-Path $HOME '.cargo\bin\cargo.exe'

if (-not (Test-Path $cargo)) {
  throw "cargo introuvable : $cargo (installe Rust : winget install Rustlang.Rustup)"
}

Push-Location $root
$ok = $true
$echecs = [System.Collections.Generic.List[string]]::new()

function Step($label, $script) {
  Write-Host "-- $label" -ForegroundColor Cyan
  & $script
  if ($LASTEXITCODE -ne 0) {
    Write-Host "   x echec ($LASTEXITCODE) : $label" -ForegroundColor Red
    $script:echecs.Add("$label (code $LASTEXITCODE)")
    $script:ok = $false
  }
}

Step 'cargo fmt --check'                    { & $cargo fmt --check }
Step 'cargo check --all-targets'            { & $cargo check --workspace --all-targets }
Step 'cargo clippy -- -D warnings'          { & $cargo clippy --workspace --all-targets -- -D warnings }
Step 'cargo build (wasm32-unknown-unknown)' { & $cargo build --workspace --target wasm32-unknown-unknown }
Step 'cargo test (wasm32-wasip1)'           { & $cargo test --target wasm32-wasip1 -- --test-threads=1 }

# Validation RÉELLE, pas seulement unitaire : deux PDF sont produits par les
# exemples puis relus par pdf-lib (le lecteur emprunté au produit). C'est ce
# contrôle qui a révélé le bug des boîtes de page que les tests unitaires
# laissaient passer.
Step 'démonstration image → PDF + pdf-lib'  { pwsh -File (Join-Path $PSScriptRoot 'demo-image.ps1') | Out-Null }

# Validation du MODULE LIVRABLE : le .wasm navigateur est construit, chargé sans
# aucun import, comparé octet pour octet aux modules WAT écrits à la main, et ses
# PDF sont relus par pdf-lib. C'est l'étape qui distingue « bibliothèque Rust »
# de « module utilisable par le site ».
Step 'module wasm navigateur + parité + pdf-lib' { pwsh -File (Join-Path $PSScriptRoot 'demo-wasm.ps1') | Out-Null }

# Validation du BRANCHEMENT : la colle `web/superprint-core.js` charge le noyau,
# tient la parité octet pour octet avec son repli JavaScript, refuse les entrées
# illisibles au lieu d'approximer, et ses PDF sont relus par pdf-lib.
Step 'colle de branchement + repli + pdf-lib' { pwsh -File (Join-Path $PSScriptRoot 'demo-web.ps1') | Out-Null }

# Validation de la CÉSURE : les deux moteurs — le Rust et celui du produit
# (`hypher.js` + les règles françaises de `main.js`, lus sans être modifiés) —
# sont comparés mot pour mot, position par position, sur du vrai texte français.
Step 'cesure : parite mesuree contre hypher.js et les regles FR' {
  & $cargo build -p superprint-text --example cesure_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-cesure.mjs }
}

# Validation de la COMPRESSION : le codec est confronté au `zlib` de Node, qui
# est une autre implémentation. Les deux sens sont éprouvés — ce que le Rust
# compresse doit être relu par Node, et réciproquement — et les flux abîmés
# doivent être refusés, jamais approximés.
Step 'compression : DEFLATE verifie dans les deux sens contre zlib' {
  & $cargo build -p superprint-compress --example compression_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-compression.mjs }
}

# Validation du BRANCHEMENT dans l'application : la colle et le noyau reels sont
# mis face aux dictionnaires reels du produit, et les fragments doivent etre
# identiques mot pour mot. C'est la mesure qui autorise a poser le branchement
# dans `superprint/app/`.
Step 'branchement : la colle contre les dictionnaires du produit' { node scripts/validate-branchement.mjs }
# Aucune derive possible entre la colle du depot et celle qui est livree : ce
# sont les memes octets, sinon l'etape suivante mesurerait autre chose que ce
# qui est dans l'application.
Step 'colle livree identique a celle du depot' {
  $paires = @(
    @{ Source = 'web/superprint-core.js'; Livree = '../superprint/app/JS/superprint-core.js' },
    @{ Source = 'dist/superprint_core.wasm'; Livree = '../superprint/app/JS/superprint_core.wasm' },
    # Meme regle pour l'import PostScript : la colle ET son noyau.
    @{ Source = 'web/superprint-eps.js'; Livree = '../superprint/app/JS/superprint-eps.js' },
    @{ Source = 'dist/superprint_eps.wasm'; Livree = '../superprint/app/JS/superprint_eps.wasm' }
  )
  $identiques = $true
  foreach ($paire in $paires) {
    if (-not (Test-Path $paire.Livree)) {
      Write-Host "   fichier absent : $($paire.Livree)" -ForegroundColor Red
      $identiques = $false
      continue
    }
    $a = (Get-FileHash $paire.Source -Algorithm SHA256).Hash
    $b = (Get-FileHash $paire.Livree -Algorithm SHA256).Hash
    if ($a -ne $b) {
      Write-Host "   DIVERGENCE : $($paire.Livree) differe de $($paire.Source)" -ForegroundColor Red
      Write-Host "   copier avec : Copy-Item $($paire.Source) $($paire.Livree) -Force" -ForegroundColor Yellow
      $identiques = $false
    }
  }
  if (-not $identiques) {
    $script:echecs.Add('colle livree identique a celle du depot (hash different)')
    $script:ok = $false
  }
}

# Validation du branchement TEL QU'IL EST LIVRE : les fichiers de
# `superprint/app/JS/` sont evalues dans un contexte qui imite le navigateur,
# puis le moteur installe est compare a `Hypher` — parite, reversibilite, repli.
Step 'branchement livre : parite, reversibilite, repli' { node scripts/validate-branchement-app.mjs }

# Validation de l'IMPOSITION : l'ordre des pages est compare a la fonction
# `calculateImposition` **extraite de main.js**, les tailles de feuille aux trois
# copies de la formule dans le produit, et chaque trait de coupe aux arguments
# des `pdf.line()` — extraits, pas reecrits.
Step 'imposition : ordre, feuille et traits de coupe contre main.js' {
  & $cargo build -p superprint-impose --example impose_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-imposition.mjs }
}

# Validation de la REDUCTION D'IMAGE : exactitude au bit pres contre une moyenne
# entiere calculee independamment, survie d'un motif fin que l'echantillonnage
# fait disparaitre, conservation de l'energie, et invariants.
Step 'reduction d''image : exactitude, anti-crenelage, energie' { node scripts/validate-reduction.mjs }

# Validation du PREPRESSE : chaque controle doit se declencher sur le defaut
# qu'il cherche — et, tout aussi important, un document correct ne doit RIEN
# produire. Les deux moities sont mesurees, sur les documents construits par la
# colle elle-meme.
Step 'prepresse : detection, silence, tri et refus des regles illisibles' { node scripts/validate-preflight.mjs }

# Validation des NUANCIERS : le catalogue engage dans le crate est compare aux
# nuanciers du PRODUIT (le tableau BOOKS de swatchbooks.js et les <optgroup> de
# index.html, lus sur place), et le lecteur .ase du noyau a la fonction lireAse
# du produit, sur des fichiers engendres. L'ecart voulu sur un gris en dernier
# bloc est mesure explicitement, pas passe sous silence.
Step 'nuanciers : catalogue du produit, lecteur .ase, recherche' {
  & $cargo build -p superprint-swatch --example swatch_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-swatch.mjs }
}

# Validation du TRAITEMENT D'IMAGE (niveaux, courbes, flou, nettete, mediane,
# encrage, alpha) : chaque filtre est compare a un repli JavaScript ecrit
# independamment — a l'octet pres quand la formule est une definition, a l'unite
# pres pour le flou (separable d'un cote, 2D de l'autre).
Step 'image : niveaux, flou, mediane, encrage, alpha contre un repli JS' {
  & $cargo build -p superprint-image --example image_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-image.mjs }
}

# Validation des PROFILS ICC : les trois profils livres sont relus octet par octet
# en JavaScript puis compares au noyau (en-tete, table des balises, types, tailles,
# nom, point blanc). Et surtout : l'ECART entre la taille de la specification ICC
# et la taille declaree par les balises Adobe est chiffre et compare. Un profil
# d'ecran doit etre lu, puis refuse comme OutputIntent.
Step 'profils ICC : en-tete, balises, nom, ecarts a la specification, refus' {
  & $cargo build -p superprint-icc --example icc_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-icc.mjs }
}

# Validation de PDF/X : le fichier produit est relu par pdf-lib, son paquet XMP
# est controle (bonne formation, pdfaid:part et conformance, GTS_PDFXVersion) et
# les octets du profil ICC embarques sont compares a ceux du fichier de profil.
# Les refus comptent autant : PDF/X sans OutputIntent, profil d'ecran comme
# OutputIntent, fichier qui n'est pas un profil.
Step 'PDF/X : XMP, OutputIntent, profil embarque, et les refus' {
  & $cargo build -p superprint-pdf --example pdfx_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-pdfx.mjs }
}

# Validation de la PAGINATION : la repartition du noyau (composer une fois, puis
# repartir les lignes) est mise face a la methode du produit (bissection sur le
# nombre de caracteres). Mesure de l'invariante — aucun caractere perdu —, du
# DEFAUT de la methode par caracteres (elle coupe AU MILIEU DES MOTS : 18 fois sur
# les cas de controle, contre 0 pour le noyau), et du cout en recompositions.
Step 'pagination : invariant, coupures entre lignes, cout en recompositions' {
  & $cargo build -p superprint-flow --example flow_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-flow.mjs }
}

# Validation de la GEOMETRIE VECTORIELLE : l'aplatissement des courbes (la
# polyligne doit rester dans la tolerance demandee, verifie en recalculant la
# courbe de l'autre cote) et le Pathfinder (union, intersection, difference,
# exclusion). C'est le domaine que le produit confiait a Paper.js — 235 Ko de
# bibliotheque tierce. La verification est independante : le script demande au
# RESULTAT, pour 212 000 points, s'il les contient, et compare avec la definition
# ensembliste appliquee aux deux formes d'entree.
Step 'vecteurs : aplatissement dans la tolerance, et Pathfinder verifie par la surface' {
  & $cargo build -p superprint-path --example path_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-path.mjs }
}

# Validation du CONTENEUR ZIP : un .docx, un .odt, un .xlsx et un .idml sont la
# meme chose — une archive ZIP contenant du XML. Le noyau en a un lecteur ; le
# controle le confronte a un lecteur ECRIT A PART (annuaire central + zlib de
# Node) sur les fichiers reels du depot, entree par entree. Puis il eprouve les
# refus : .doc renomme, .rtf renomme, archive tronquee, CRC abime, chiffree,
# methode BZIP2, nom qui sort de l'archive.
Step 'conteneur ZIP : fichiers reels contre un lecteur independant, et refus' {
  & $cargo build -p superprint-zip --example zip_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-zip.mjs }
}

# Validation de l'IMPORT DE DOCUMENTS : .docx (OOXML), .odt (OpenDocument) et
# .idml (InDesign), analyses depuis le conteneur ZIP. Le controle confronte le
# noyau a un EXTRACTEUR ECRIT A PART (son propre analyseur XML et ses propres
# extracteurs), sur les documents reels du depot, paragraphe par paragraphe. Puis
# il verifie l'invariante — le texte importe est exactement le texte du XML —
# et les refus : RTF renomme, PDF renomme, XML abime, entite inconnue, classeur
# ODF renomme en .odt.
Step 'import : docx, odt et idml contre un extracteur independant, et invariante' {
  & $cargo build -p superprint-doc --example doc_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-doc.mjs }
}

# Validation de l'IMPORT SVG : un lecteur ECRIT A PART (son propre analyseur XML,
# son propre lecteur de commandes de chemin, sa propre matrice, sa propre
# conversion d'arc et son propre aplatissement) confronte le noyau sur les 40 SVG
# reels du depot, FORME PAR FORME et SOMMET PAR SOMMET. Puis les aires connues par
# construction, la tolerance d'aplatissement mesuree contre la courbe vraie, les
# refus nommes, et la table des couleurs nommees comparee a celle du produit
# (`jspdf.umd.min.js`, lue sans etre modifiee).
Step 'import SVG : 40 SVG reels, sommets et aires, tolerance, refus, couleurs' {
  & $cargo build -p superprint-doc --example svg_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-svg.mjs }
}

# Validation de l'IMPORT POSTSCRIPT : .eps, et les .ai enregistres en EPS. Le
# controle confronte le noyau a un INTERPRETEUR ECRIT A PART (son propre lexeur,
# sa propre pile, sa propre matrice, son propre aplatissement), dessin par dessin
# et sommet par sommet, sur les fichiers reels du depot. Puis il verifie les
# AIRES CONNUES par construction, la TOLERANCE D'APLATISSEMENT PAR LA MESURE de
# l'ecart a la courbe vraie, les REFUS NOMMES (le texte, les images) contre les
# SIGNALEMENTS qui ne bloquent pas, et le fait qu'un .ai qui est un PDF est
# refuse en le disant.
Step 'postscript : en-tete DSC, dessins, tolerance mesuree et refus nommes' {
  & $cargo build -p superprint-ps --example ps_dump --target wasm32-wasip1 --release
  if ($LASTEXITCODE -eq 0) { node scripts/validate-ps.mjs }
}

# Validation de la CONVERSION RVB -> CMJN, en Rust et branchee.
# La fonction du produit est EXTRAITE de main.js (lu sans etre modifie) et
# confrontee au noyau sur 655 000 conversions, pour huit jeux de reglages :
# l'ecart doit etre NUL, parce que cette couleur part dans le PDF livre. Le
# controle mesure aussi le defaut du produit — le GCR n'a aucun effet, le
# minimum de C, M, J etant toujours nul — et verifie que le noyau le reproduit
# plutot que de le corriger en silence.
Step 'couleurs : parite bit a bit avec main.js, et le defaut du GCR mesure' {
  node scripts/validate-cmyk.mjs
}

# Verification de la FRONTIERE EPS : le second module WebAssembly, celui qui
# n'est PAS precache et n'est charge que si l'utilisateur ouvre un .eps. Ses deux
# exports (detection, analyse) sont exerces sur les temoins reels, et le module
# principal doit rester a 380 Ko — c'est la raison d'etre de la separation.
Step 'module EPS : detection, analyse reelle, et zero surcout pour les autres' {
  node scripts/verifier-eps-wasm.mjs
}

# Validation du BRANCHEMENT de l'import PostScript : la colle est evaluee dans un
# contexte qui imite le navigateur, le CONTRAT est 
# **mesure dans main.js** (quels noms sont vraiment appeles sur l'objet du module)
# au lieu d'etre recopie, la transformation de repere est verifiee sur les
# temoins reels, et le repli est exerce avec un noyau absent.
Step 'import EPS branche : contrat mesure dans main.js, repere, repli' {
  node scripts/validate-eps-branchement.mjs
}

Pop-Location

if ($ok) {
  Write-Host "`nOK : tout est vert (fmt, check, clippy, wasm, tests, PDF validés)." -ForegroundColor Green
  exit 0
}

Write-Host "`nECHEC : au moins une etape a echoue." -ForegroundColor Red
foreach ($e in $echecs) { Write-Host "  - $e" -ForegroundColor Red }
exit 1
