# Démonstration de bout en bout du MODULE WebAssembly livrable.
#
# Enchaîne : construction du module navigateur (`dist/superprint_core.wasm`),
# validation de sa chargeabilité et de sa parité, production de deux PDF depuis
# le module, puis relecture de ces PDF par pdf-lib.
#
# C'est le contrôle qui répond à la question « le noyau Rust est-il utilisable
# par le site, oui ou non ? » : le module n'a aucun import, donc un navigateur le
# charge tel quel, et sa sortie est relue par un outil tiers.
#
# Usage : pwsh -File scripts/demo-wasm.ps1
# Retour : 0 si tout passe, 1 sinon.

$ErrorActionPreference = 'Stop'

$root = Split-Path $PSScriptRoot -Parent

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

Step 'construction du module wasm navigateur' {
  pwsh -File (Join-Path $PSScriptRoot 'build-wasm.ps1')
}

# Charge le module, vérifie qu'il n'a aucun import, compare ses sorties octet
# pour octet aux modules WAT écrits à la main, et écrit les deux PDF.
Step 'chargeabilite + parite Rust/WAT + ecriture PDF' {
  node scripts/validate-wasm.mjs
}

Step 'validation pdf-lib - tons directs' {
  node scripts/validate-pdf.mjs wasm-page.pdf --mm=196x266 --spots=2
}

Step 'validation pdf-lib - image embarquee' {
  # 170 x 240 mm + 3 mm de fond perdu + 10 mm de traits de coupe = 196 x 266 mm.
  node scripts/validate-pdf.mjs wasm-page-image.pdf --mm=196x266 --spots=2 --image=1004x1418
}

Pop-Location

if ($ok) {
  Write-Host "`nOK : le module wasm se charge, sa sortie est conforme, et ses deux PDF sont valides par pdf-lib." -ForegroundColor Green
  exit 0
}

Write-Host "`nECHEC : au moins une etape a echoue." -ForegroundColor Red
exit 1
