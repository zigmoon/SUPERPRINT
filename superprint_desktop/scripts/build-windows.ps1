# Build des applications de bureau SuperPrint, Studio IA et SuperTyPo (Tauri).
#
# Ce script n'a qu'une raison d'être : rendre la compilation REPRODUCTIBLE sur une
# machine Windows qui n'a que Rust. Tauri, lui, a besoin d'un éditeur de liens
# Windows — soit l'édition « C++ build tools » de Visual Studio (la voie
# recommandée), soit, à défaut, une chaîne MinGW-w64 GCC.
#
#   .\scripts\build-windows.ps1                      # les trois, installeur NSIS + MSI
#   .\scripts\build-windows.ps1 -App studio          # Studio IA seul
#   .\scripts\build-windows.ps1 -Bundles nsis        # installeur NSIS seul
#   .\scripts\build-windows.ps1 -App supertypo -NoBundle
#
# LES TROIS APPLICATIONS SONT UN SEUL PROJET TAURI, compilé trois fois avec trois
# surcouches de configuration (`src-tauri/apps/<app>.json`). La coquille native
# est identique — une fenêtre, une webview — et seule change la page qu'elle
# ouvre. Chaque surcouche désigne aussi ce que son paquet embarque.
#
# Variables d'environnement reconnues :
#   SUPERPRINT_MINGW_BIN   dossier « bin » de MinGW-w64, si la détection échoue
#
# Sorties (par application) :
#   src-tauri/target/release/superprint-desktop.exe
#   src-tauri/target/release/bundle/nsis/<nom>_<version>_x64-setup.exe
#   src-tauri/target/release/bundle/msi/<nom>_<version>_x64_en-US.msi

[CmdletBinding()]
param(
    [ValidateSet('superprint', 'studio', 'supertypo', 'tous')]
    [string]   $App = 'tous',
    [string]   $Bundles = 'nsis,msi',
    [switch]   $NoBundle,
    [ValidateSet('release', 'debug')]
    [string]   $Profile = 'release'
)

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $PSScriptRoot

function Test-MsvcLinker {
    # `link.exe` de MSVC vit sous « VC\Tools\MSVC\...\bin\Hostx64\x64 ». Le `link.exe`
    # de Git for Windows porte le même nom : on teste donc le chemin, pas seulement
    # la présence sur le PATH.
    $candidates = @(
        "$env:ProgramFiles\Microsoft Visual Studio",
        "${env:ProgramFiles(x86)}\Microsoft Visual Studio"
    ) | Where-Object { Test-Path $_ }

    foreach ($root in $candidates) {
        $found = Get-ChildItem $root -Recurse -Filter 'link.exe' -ErrorAction SilentlyContinue |
                 Where-Object { $_.FullName -match '\\VC\\Tools\\MSVC\\' } |
                 Select-Object -First 1
        if ($found) { return $true }
    }
    return $false
}

function Resolve-MingwBin {
    if ($env:SUPERPRINT_MINGW_BIN -and (Test-Path "$env:SUPERPRINT_MINGW_BIN\x86_64-w64-mingw32-gcc.exe")) {
        return $env:SUPERPRINT_MINGW_BIN
    }

    # WinLibs installé par winget, ou une archive posée à la main.
    $roots = @(
        "$env:LOCALAPPDATA\Microsoft\WinGet\Packages",
        'C:\mingw64',
        'C:\msys64\mingw64',
        "$env:ProgramFiles\mingw64"
    ) | Where-Object { Test-Path $_ }

    foreach ($root in $roots) {
        $found = Get-ChildItem $root -Recurse -Filter 'x86_64-w64-mingw32-gcc.exe' -ErrorAction SilentlyContinue |
                 Select-Object -First 1
        if ($found) { return $found.Directory.FullName }
    }
    return $null
}

$env:RUSTUP_TOOLCHAIN = $null

if (Test-MsvcLinker) {
    Write-Host 'Éditeur de liens : MSVC (Visual Studio) — voie standard.' -ForegroundColor Green
}
else {
    $mingw = Resolve-MingwBin
    if (-not $mingw) {
        throw @'
Aucun editeur de liens Windows trouve.

Deux solutions :
  1. (recommandee) installer les « C++ build tools » de Visual Studio ;
  2. installer MinGW-w64 GCC, par exemple :
       winget install BrechtSanders.WinLibs.POSIX.UCRT
     puis relancer ce script, ou definir SUPERPRINT_MINGW_BIN vers son dossier « bin ».
'@
    }

    Write-Host "Editeur de liens : MinGW-w64 GCC ($mingw)" -ForegroundColor Yellow
    # La cible GNU de Rust reclame libgcc : LLVM-MinGW ne la fournit pas, GCC si.
    $env:Path = "$mingw;$env:Path"
    $env:RUSTUP_TOOLCHAIN = 'stable-x86_64-pc-windows-gnu'
    Write-Host 'Toolchain Rust : stable-x86_64-pc-windows-gnu' -ForegroundColor Yellow
}

Push-Location $here
try {
    # La CLI Tauri est celle du projet : `npm install` d'abord.
    if (-not (Test-Path 'node_modules\@tauri-apps\cli')) {
        Write-Host 'Installation de la CLI Tauri (@tauri-apps/cli)...' -ForegroundColor Cyan
        npm install
        if ($LASTEXITCODE -ne 0) { throw 'npm install a echoue' }
    }

    $apps = if ($App -eq 'tous') { @('superprint', 'studio', 'supertypo') } else { @($App) }

    foreach ($une in $apps) {
        Write-Host ''
        Write-Host "── $une ──────────────────────────────────" -ForegroundColor Cyan

        $args = @('tauri', 'build', '--config', "src-tauri/apps/$une.json")
        if ($Profile -eq 'debug') { $args += '--debug' }
        if ($NoBundle) { $args += '--no-bundle' } else { $args += @('--bundles', $Bundles) }

        Write-Host "npx $($args -join ' ')" -ForegroundColor Cyan
        npx @args
        if ($LASTEXITCODE -ne 0) { throw "la compilation de « $une » a echoue" }
    }

    Write-Host ''
    Write-Host 'Artefacts :' -ForegroundColor Green
    Get-ChildItem 'src-tauri\target\*\bundle' -Recurse -File -ErrorAction SilentlyContinue |
        Where-Object { $_.Extension -in '.exe', '.msi' } |
        Sort-Object Name |
        ForEach-Object { Write-Host ("  {0,-46} {1,8:N1} Mo" -f $_.Name, ($_.Length / 1MB)) }
}
finally {
    Pop-Location
}
