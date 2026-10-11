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
$targetArgs = @('build', '-p', 'superprint-wasm', '--target', 'wasm32-unknown-unknown')
if ($profile -eq 'release') { $targetArgs += '--release' }

Write-Host "-- cargo build ($profile, wasm32-unknown-unknown)" -ForegroundColor Cyan
& $cargo @targetArgs
if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'compilation du module wasm impossible' }

$built = Join-Path $root "target\wasm32-unknown-unknown\$profile\superprint_wasm.wasm"
if (-not (Test-Path $built)) { Pop-Location; throw "module introuvable : $built" }

$dist = Join-Path $root 'dist'
New-Item -ItemType Directory -Force -Path $dist | Out-Null
$final = Join-Path $dist 'superprint_core.wasm'
Copy-Item $built $final -Force

$ko = [math]::Round((Get-Item $final).Length / 1KB, 1)
Write-Host "`nOK : $final ($ko Ko)" -ForegroundColor Green

Pop-Location
exit 0
