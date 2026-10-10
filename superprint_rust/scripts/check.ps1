# Compile-check de superprint-core SANS cargo.
#
# Pourquoi : sur la machine de développement, Smart App Control bloque
# `cargo.exe` et le linker (`rust-lld`, erreur 4551). `rustc` reste utilisable :
# ce script vérifie donc que le crate compile, en natif ET pour wasm32.
#
# Usage : pwsh -File scripts/check.ps1
# Retour : code 0 si tout compile, 1 sinon.

$ErrorActionPreference = 'Stop'

$root  = Split-Path $PSScriptRoot -Parent
$rustc = Join-Path $HOME '.cargo\bin\rustc.exe'

if (-not (Test-Path $rustc)) {
  throw "rustc introuvable : $rustc (installe Rust : winget install Rustlang.Rustup)"
}

$src = Join-Path $root 'crates/superprint-core/src/lib.rs'
$out = Join-Path $env:TEMP 'superprint_core_check'

Write-Host "rustc : $(& $rustc --version)" -ForegroundColor Cyan

Write-Host "1/2 compilation native (rlib)..." -ForegroundColor Cyan
& $rustc --edition 2021 --crate-type lib --deny warnings $src -o "$out.rlib"
if ($LASTEXITCODE -ne 0) { throw "echec compilation native" }

Write-Host "2/2 compilation wasm32 (rlib)..." -ForegroundColor Cyan
& $rustc --edition 2021 --target wasm32-unknown-unknown --crate-type rlib --deny warnings $src -o "$out.wasm.rlib"
if ($LASTEXITCODE -ne 0) { throw "echec compilation wasm32" }

Write-Host "OK : superprint-core compile en natif et en wasm32." -ForegroundColor Green
