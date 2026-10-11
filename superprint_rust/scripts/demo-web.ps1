# Démonstration de bout en bout du BRANCHEMENT (la colle `web/superprint-core.js`).
#
# Enchaîne : construction du module, validation de la colle (chargement, parité
# avec le repli JavaScript, garde-fous, endurance), production de deux PDF par la
# colle, puis relecture de ces PDF par pdf-lib.
#
# La preuve NAVIGATEUR n'est pas automatisée ici — elle demande un navigateur, et
# le dépôt n'embarque aucune dépendance de pilotage. Elle se fait à la main, en
# deux commandes :
#
#     node scripts/serve-web.mjs
#     # puis ouvrir http://127.0.0.1:8777/superprint_rust/web/demo.html
#
# La page affiche le moteur actif (WebAssembly ou repli) et son bilan d'essais.
# Le `fetch` du `.wasm` est refusé en `file://` : il faut passer par le serveur.
#
# Usage : pwsh -File scripts/demo-web.ps1
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

# La colle, ses garde-fous, sa parité avec le repli JavaScript, et l'endurance.
Step 'colle : chargement, parite, garde-fous, endurance' {
  node scripts/validate-web.mjs
}

Step 'validation pdf-lib - PDF de la colle, tons directs' {
  node scripts/validate-pdf.mjs web-page.pdf --mm=196x266 --spots=2
}

Step 'validation pdf-lib - PDF de la colle, image embarquee' {
  node scripts/validate-pdf.mjs web-page-image.pdf --mm=196x266 --spots=2 --image=1004x1418
}

Step 'validation pdf-lib - DOCUMENT (2 pages, vectoriel, tons directs, image)' {
  node scripts/validate-pdf.mjs web-page-document.pdf --mm=196x266 --spots=2 --pages=2
}

Step 'validation pdf-lib - DOCUMENT avec destination de sortie' {
  node scripts/validate-pdf.mjs web-page-intent.pdf --mm=100x100 --spots=0 --pages=1
}

Pop-Location

if ($ok) {
  Write-Host "`nOK : la colle charge le noyau, tient la parite avec son repli, et ses PDF sont valides par pdf-lib." -ForegroundColor Green
  Write-Host "     (preuve navigateur : node scripts/serve-web.mjs, puis /superprint_rust/web/demo.html)" -ForegroundColor DarkGray
  exit 0
}

Write-Host "`nECHEC : au moins une etape a echoue." -ForegroundColor Red
exit 1
