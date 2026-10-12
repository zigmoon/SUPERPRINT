# Construit le module WebAssembly du noyau Rust, chargeable par un navigateur.
#
# Ce n'est PAS un exemple de test : c'est l'artefact livrable. Il sort du crate
# `superprint-wasm`, le seul déclaré en `cdylib`, et il est copié dans `dist/`
# sous un nom stable :
#
#     dist/superprint_core.wasm
#
# Le module n'a AUCUN import : il se charge avec `WebAssembly.instantiate(bytes, {})`,
# sans WASI ni fonction hôte. C'est ce que vérifie `scripts/validate-wasm.mjs`.
#
# Usage : pwsh -File scripts/build-wasm.ps1
# Retour : 0 si tout passe, 1 sinon.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent
$env:Path = "$(Join-Path $HOME '.cargo\bin');$env:Path"
$cargo = Join-Path $HOME '.cargo\bin\cargo.exe'

if (-not (Test-Path $cargo)) {
  throw "cargo introuvable : $cargo (installe Rust : winget install Rustlang.Rustup)"
}

Push-Location $root

$profile = if ($args -contains '--debug') { 'debug' } else { 'release' }
$commun = @('build', '-p', 'superprint-wasm', '--target', 'wasm32-unknown-unknown')
if ($profile -eq 'release') { $commun += '--release' }

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$built = Join-Path $root "target\wasm32-unknown-unknown\$profile\superprint_wasm.wasm"
$builtEps = Join-Path $root "target\wasm32-unknown-unknown\$profile\superprint_eps_wasm.wasm"

# ── 1. Le module principal, SANS l'EPS ────────────────────────────────────────
#
# C'est celui que le service worker précache : il est donc téléchargé par TOUT
# LE MONDE, y compris par qui n'importera jamais un fichier PostScript. Lui
# ajouter l'interpréteur EPS le ferait passer de 380 à 540 Ko — mesuré. L'EPS
# vit donc dans son propre module, chargé à la demande.
#
# L'assemblage d'une planche imposée, lui, est DANS ce module, et c'est un choix
# mesuré aussi : il a fait passer le module de 380,6 à 406,5 Ko, soit **+25,9 Ko
# (+6,8 %)**. Ce coût est payé parce que le montage ne fait que poser et rogner
# ce que `superprint-pdf` et `superprint-impose` savent déjà faire — deux crates
# que ce module embarque déjà. Un module séparé aurait recopié tout le noyau
# (406 Ko) plus le montage, soit seize fois le prix, pour un export qu'on
# déclenche d'un clic. Le module EPS, lui, apportait un interpréteur entier
# (+160 Ko).
Write-Host "-- cargo build ($profile, wasm32-unknown-unknown)" -ForegroundColor Cyan
& $cargo @commun
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'compilation du module wasm impossible' }
if (-not (Test-Path $built)) { Pop-Location; throw "module introuvable : $built" }
$final = Join-Path $dist 'superprint_core.wasm'
Copy-Item $built $final -Force
$octetsCoeur = (Get-Item $final).Length
$ko = [math]::Round($octetsCoeur / 1KB, 1)
Write-Host "OK : $final ($ko Ko)" -ForegroundColor Green

# ── 2. Le module d'import PostScript / EPS ────────────────────────────────────
#
# Un crate À PART (`superprint-eps-wasm`), et non une fonctionnalité du
# précédent. La différence est mesurée : une fonctionnalité aurait produit un
# second module contenant TOUT le noyau en double (406 Ko) plus l'EPS, soit
# 570 Ko. Ce crate ne dépend que de `superprint-ps` : le module livré fait
# 324,8 Ko, et il n'est JAMAIS précaché — la colle `web/superprint-eps.js` le
# demande quand l'utilisateur ouvre un `.eps`, exactement comme
# `sp-eps-import.js` (44 Ko) l'était avant.
#
# ⚠️ Ce module est PLUS GROS que le JavaScript qu'il remplace (245 Ko contre
# 44 Ko), et c'est un fait à dire : WebAssembly rattrape le JavaScript à partir
# d'une certaine taille de code, pas en dessous. Le gain n'est donc pas la
# taille, c'est que le même code serve le noyau et le navigateur — et que les
# bornes et les refus nommés y soient vérifiés par des tests.
Write-Host "-- cargo build -p superprint-eps-wasm ($profile)" -ForegroundColor Cyan
& $cargo build -p superprint-eps-wasm --target wasm32-unknown-unknown $(if ($profile -eq 'release') { '--release' })
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'compilation du module EPS impossible' }
$finalEps = Join-Path $dist 'superprint_eps.wasm'
Copy-Item $builtEps $finalEps -Force
$koEps = [math]::Round((Get-Item $finalEps).Length / 1KB, 1)
Write-Host "OK : $finalEps ($koEps Ko)" -ForegroundColor Green

# ── 3. Le module d'import de documents ────────────────────────────────────────
#
# Troisieme module, et c'est la MEME mesure qui le justifie. Les deux chiffres
# ont ete releves en construisant les deux variantes :
#
#   le lecteur de documents DANS le module precache : 406,5 -> 585,8 Ko, soit
#   +179,3 Ko payes par TOUT LE MONDE, a vie ;
#   le lecteur de documents dans son propre module   : 406,5 Ko inchange,
#   +290,1 Ko a la demande.
#
# Le module a part coute donc 110,8 Ko de PLUS en valeur absolue (290,1 - 179,3),
# parce qu'il reembarque le lecteur ZIP que le noyau possede deja. Mais il ne les
# fait payer qu'a qui ouvre un document. C'est l'arbitrage du service worker
# applique au noyau, pour la troisieme fois.
#
# ⚠️ Ce que ce module REMPLACE, mesure aussi : rien. Le JavaScript qu'il double
# (`_spTexteOdf`, trente lignes) a besoin de JSZip, qui reste charge pour le
# `.docx`. Le gain n'est donc pas la taille, c'est que le texte cesse d'etre
# approximatif (une balise au milieu d'un mot le coupait en deux) et qu'un
# `.idml`, qui tombait sur un decodage binaire, devient lisible.
Write-Host "-- cargo build -p superprint-doc-wasm ($profile)" -ForegroundColor Cyan
& $cargo build -p superprint-doc-wasm --target wasm32-unknown-unknown $(if ($profile -eq 'release') { '--release' })
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'compilation du module de documents impossible' }
$builtDoc = Join-Path $root "target\wasm32-unknown-unknown\$profile\superprint_doc_wasm.wasm"
if (-not (Test-Path $builtDoc)) { Pop-Location; throw "module introuvable : $builtDoc" }
$finalDoc = Join-Path $dist 'superprint_doc.wasm'
Copy-Item $builtDoc $finalDoc -Force
$koDoc = [math]::Round((Get-Item $finalDoc).Length / 1KB, 1)
Write-Host "OK : $finalDoc ($koDoc Ko)" -ForegroundColor Green

Write-Host "`nLe module principal fait $ko Ko, l'EPS $koEps Ko et les documents $koDoc Ko." -ForegroundColor Green
Write-Host "Ni l'EPS ni les documents n'alourdissent le module precache : chacun vit dans le sien." -ForegroundColor Green

Pop-Location
exit 0
