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

# ── 1. Le module principal, SANS l'EPS ────────────────────────────────────────
#
# C'est celui que le service worker précache : il est donc téléchargé par TOUT
# LE MONDE, y compris par qui n'importera jamais un fichier PostScript. Lui
# ajouter l'interpréteur EPS le ferait passer de 380 à 540 Ko — mesuré. Il reste
# donc à 380 Ko, et l'EPS vit dans son propre module, chargé à la demande.
Write-Host "-- cargo build ($profile, wasm32-unknown-unknown)" -ForegroundColor Cyan
& $cargo @commun
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'compilation du module wasm impossible' }
if (-not (Test-Path $built)) { Pop-Location; throw "module introuvable : $built" }
$final = Join-Path $dist 'superprint_core.wasm'
Copy-Item $built $final -Force
$ko = [math]::Round((Get-Item $final).Length / 1KB, 1)
Write-Host "OK : $final ($ko Ko)" -ForegroundColor Green

# ── 2. Le module d'import PostScript / EPS ────────────────────────────────────
#
# Même crate, fonctionnalité `eps`. Il n'est JAMAIS précaché : la colle
# `web/superprint-eps.js` le demande au moment où l'utilisateur ouvre un `.eps`,
# exactement comme `sp-eps-import.js` l'était avant. Le coût pour les autres
# utilisateurs est donc nul — c'est ce que la mesure imposait.
Write-Host "-- cargo build ($profile, features=eps)" -ForegroundColor Cyan
& $cargo @commun '--features' 'eps'
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'compilation du module EPS impossible' }
$finalEps = Join-Path $dist 'superprint_eps.wasm'
Copy-Item $built $finalEps -Force
$koEps = [math]::Round((Get-Item $finalEps).Length / 1KB, 1)
Write-Host "OK : $finalEps ($koEps Ko)" -ForegroundColor Green

Write-Host "`nLe module principal a grandi de 0 Ko : l'EPS est dans le second." -ForegroundColor Green

Pop-Location
exit 0
