# Démonstration de bout en bout du module image → PDF.
#
# Enchaîne : construction des exemples, production de deux PDF réels (tons
# directs seuls, puis tons directs + image) et validation indépendante de ces
# PDF par pdf-lib — l'analyseur emprunté au produit.
#
# Les exemples tournent sous WebAssembly (`wasm32-wasip1`) lancé par Node : cela
# évite d'exiger le linker natif MSVC de Visual Studio.
#
# Usage : pwsh -File scripts/demo-image.ps1
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

# Les deux exemples sont construits d'un coup : ils partagent leurs dépendances.
Write-Host "-- construction des exemples" -ForegroundColor Cyan
& $cargo build -p superprint-pdf --example spot_page --example spot_image_page --target wasm32-wasip1
if ($LASTEXITCODE -ne 0) { throw 'construction des exemples impossible' }

$examples = 'target/wasm32-wasip1/debug/examples'

Step 'PDF tons directs (spot_page)' {
  node scripts/run-wasi.mjs "$examples/spot_page.wasm" spot-page.pdf
}

Step 'PDF tons directs + image (spot_image_page)' {
  node scripts/run-wasi.mjs "$examples/spot_image_page.wasm" spot-image-page.pdf
}

Step 'validation pdf-lib - tons directs' {
  node scripts/validate-pdf.mjs spot-page.pdf
}

Step 'validation pdf-lib - image embarquee' {
  # 170 x 240 mm + 3 mm de fond perdu + 10 mm de traits de coupe = 196 x 266 mm.
  # L'image est un aplat de 300 DPI reduit a 150 DPI.
  node scripts/validate-pdf.mjs spot-image-page.pdf --mm=196x266 --spots=2 --image=1004x1418
}

Pop-Location

if ($ok) {
  Write-Host "`nOK : les deux PDF sont produits et valides par pdf-lib." -ForegroundColor Green
  exit 0
}

Write-Host "`nECHEC : au moins une etape a echoue." -ForegroundColor Red
exit 1
