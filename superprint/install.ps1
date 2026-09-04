# ============================================================
#  SuperPrint — Installateur Windows (PowerShell)
#  Utilisation :  irm https://superprint.cc/install.ps1 | iex
#  Télécharge, décompresse, installe et lance SuperPrint en local.
# ============================================================

$ErrorActionPreference = "Stop"
$ZIP_URL = "https://app.zigmoon.com/sp213-local.zip"

# Couleurs
function Write-Step($n, $msg) { Write-Host "`n[$n/4] $msg" -ForegroundColor Cyan }
function Write-OK($msg) { Write-Host "  OK  $msg" -ForegroundColor Green }
function Write-Info($msg) { Write-Host "  ..  $msg" -ForegroundColor DarkGray }

# Bannière
Write-Host ""
Write-Host "SUPERPRINT" -ForegroundColor Cyan
Write-Host "  PAO + Studio SP213 - 100% local" -ForegroundColor Green
Write-Host ""

# Étape 1 : se placer dans le dossier utilisateur (évite system32 protégé)
Write-Step 1 "Préparation du dossier"
$InstallRoot = Join-Path $HOME "sp213-local"
if (Test-Path (Join-Path $InstallRoot "package.json")) {
    Write-OK "Projet déjà présent dans $InstallRoot"
    Set-Location $InstallRoot
} else {
    if (Test-Path $InstallRoot) { Remove-Item $InstallRoot -Recurse -Force }
    New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
    Write-OK "Dossier créé : $InstallRoot"
}

# Étape 2 : téléchargement
Write-Step 2 "Téléchargement de SuperPrint"
$ZipPath = Join-Path $HOME "sp213-local.zip"
if (-not (Test-Path $ZipPath)) {
    Write-Host "  Téléchargement..." -ForegroundColor DarkGray
    Invoke-WebRequest -Uri $ZIP_URL -OutFile $ZipPath -UseBasicParsing
}
Write-OK "Zip téléchargé"

# Étape 3 : décompression + installation
Write-Step 3 "Décompression et installation"
Expand-Archive -Path $ZipPath -DestinationPath $InstallRoot -Force
Remove-Item $ZipPath -Force
Set-Location $InstallRoot
Write-OK "Paquet décompressé"

Write-Host "  Installation des dépendances (npm install)..." -ForegroundColor DarkGray
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    npm.cmd install
} else {
    npm install
}
Write-OK "Dépendances installées"

# Étape 4 : lancement
Write-Step 4 "Lancement du serveur"
Write-Host "  Ouvrez http://localhost:5173 dans votre navigateur" -ForegroundColor Green
Write-Host "  (Ctrl+C pour arrêter)`n" -ForegroundColor DarkGray
if (Get-Command npm.cmd -ErrorAction SilentlyContinue) {
    npm.cmd run dev
} else {
    npm run dev
}
