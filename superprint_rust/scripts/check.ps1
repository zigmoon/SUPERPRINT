# Vérification complète du noyau Rust de SuperPrint.
#
# Enchaîne : formatage, types, lint, build WebAssembly et tests.
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

function Step($label, $script) {
  Write-Host "-- $label" -ForegroundColor Cyan
  & $script
  if ($LASTEXITCODE -ne 0) {
    Write-Host "   x echec : $label" -ForegroundColor Red
    $script:ok = $false
  }
}

Step 'cargo fmt --check'                    { & $cargo fmt --check }
Step 'cargo check --all-targets'            { & $cargo check --workspace --all-targets }
Step 'cargo clippy -- -D warnings'          { & $cargo clippy --workspace --all-targets -- -D warnings }
Step 'cargo build (wasm32-unknown-unknown)' { & $cargo build --workspace --target wasm32-unknown-unknown }
Step 'cargo test (wasm32-wasip1)'           { & $cargo test --target wasm32-wasip1 -- --test-threads=1 }

Pop-Location

if ($ok) {
  Write-Host "`nOK : tout est vert (fmt, check, clippy, wasm, tests)." -ForegroundColor Green
  exit 0
}

Write-Host "`nECHEC : au moins une etape a echoue." -ForegroundColor Red
exit 1
