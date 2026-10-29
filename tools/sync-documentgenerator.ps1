<#
.SYNOPSIS
    Synchronise le générateur de documents LICRA depuis sa source unique vers le
    miroir servi par le site WordPress.

.DESCRIPTION
    `documentgenerator/` est la SEULE source de vérité. `licra-loiret/documentgenerator/`
    n'est qu'un miroir de déploiement : il ne doit jamais être édité à la main.
    (Les deux dossiers étaient identiques au 28/10/2026 — 904 fichiers — ce qui rendait
    toute correction risquée : un fichier modifié d'un côté restait invisible de l'autre.)

    Par défaut le script ne fait qu'un DIAGNOSTIC (aucune écriture) et sort en code 1
    s'il existe un écart, ce qui permet de l'appeler depuis une vérification automatique.
    Avec -Apply il copie les fichiers modifiés/ajoutés, supprime ceux qui ont disparu de
    la source, puis revérifie.

    Les artefacts de développement ne sont jamais copiés ni supprimés :
    .venv, .github, __pycache__, *.pyc, *.pdf, *.zip, .DS_Store, Thumbs.db.

.PARAMETER Source
    Dossier source (par défaut : ../documentgenerator).

.PARAMETER Destination
    Dossier miroir (par défaut : ../licra-loiret/documentgenerator).

.PARAMETER Apply
    Applique réellement la synchronisation (sinon simple diagnostic).

.EXAMPLE
    pwsh -File tools/sync-documentgenerator.ps1
    Diagnostic : liste les écarts entre la source et le site.

.EXAMPLE
    pwsh -File tools/sync-documentgenerator.ps1 -Apply
    Aligne le miroir du site sur la source.
#>
[CmdletBinding()]
param(
    [string]$Source = (Join-Path $PSScriptRoot '..\documentgenerator'),
    [string]$Destination = (Join-Path $PSScriptRoot '..\licra-loiret\documentgenerator'),
    [switch]$Apply
)

$ErrorActionPreference = 'Stop'

# Development artefacts: never synchronised, never deleted from the mirror.
$ExcludedNames = @('.venv', '.github', '__pycache__', '.DS_Store', 'Thumbs.db')
$ExcludedExts = @('.pyc', '.pdf', '.zip', '.log')

function Resolve-Folder([string]$path, [string]$label) {
    if (-not (Test-Path -LiteralPath $path -PathType Container)) {
        throw "$label introuvable : $path"
    }
    return (Resolve-Path -LiteralPath $path).ProviderPath.TrimEnd('\')
}

$src = Resolve-Folder $Source 'Dossier source'
$dst = Resolve-Folder $Destination 'Dossier miroir'

function Test-Excluded([string]$relativePath) {
    $parts = $relativePath -split '[\\/]'
    foreach ($part in $parts) {
        if ($ExcludedNames -contains $part) { return $true }
    }
    $ext = [System.IO.Path]::GetExtension($relativePath).ToLowerInvariant()
    return ($ExcludedExts -contains $ext)
}

function Get-FileMap([string]$root) {
    $map = @{}
    Get-ChildItem -LiteralPath $root -Recurse -File -Force | ForEach-Object {
        $rel = $_.FullName.Substring($root.Length).TrimStart('\')
        if (Test-Excluded $rel) { return }
        $map[$rel] = (Get-FileHash -LiteralPath $_.FullName -Algorithm MD5).Hash
    }
    return $map
}

Write-Host "Source      : $src"
Write-Host "Destination : $dst"
Write-Host ''

$srcMap = Get-FileMap $src
$dstMap = Get-FileMap $dst

$toCopy = @($srcMap.Keys | Where-Object { -not $dstMap.ContainsKey($_) -or $dstMap[$_] -ne $srcMap[$_] } | Sort-Object)
$toDelete = @($dstMap.Keys | Where-Object { -not $srcMap.ContainsKey($_) } | Sort-Object)

if ($toCopy.Count -eq 0 -and $toDelete.Count -eq 0) {
    Write-Host "✓ Miroir identique à la source ($($srcMap.Count) fichiers comparés)." -ForegroundColor Green
    exit 0
}

if ($toCopy.Count -gt 0) {
    Write-Host "Fichiers à copier ($($toCopy.Count)) :" -ForegroundColor Yellow
    foreach ($rel in $toCopy) {
        $state = if ($dstMap.ContainsKey($rel)) { 'modifié' } else { 'nouveau ' }
        Write-Host ("  [{0}] {1}" -f $state, $rel)
    }
}

if ($toDelete.Count -gt 0) {
    Write-Host "Fichiers à supprimer du miroir ($($toDelete.Count)) :" -ForegroundColor Yellow
    foreach ($rel in $toDelete) { Write-Host "  [absent de la source] $rel" }
}

if (-not $Apply) {
    Write-Host ''
    Write-Host 'Diagnostic seul — relancez avec -Apply pour synchroniser.' -ForegroundColor Cyan
    exit 1
}

foreach ($rel in $toCopy) {
    $from = Join-Path $src $rel
    $to = Join-Path $dst $rel
    $parent = Split-Path -Parent $to
    if (-not (Test-Path -LiteralPath $parent)) {
        New-Item -ItemType Directory -Path $parent -Force | Out-Null
    }
    Copy-Item -LiteralPath $from -Destination $to -Force
}

foreach ($rel in $toDelete) {
    Remove-Item -LiteralPath (Join-Path $dst $rel) -Force
}

# Empty folders left behind by deletions
Get-ChildItem -LiteralPath $dst -Recurse -Directory -Force |
    Where-Object { (Get-ChildItem -LiteralPath $_.FullName -Force | Measure-Object).Count -eq 0 } |
    Sort-Object { $_.FullName.Length } -Descending |
    ForEach-Object { Remove-Item -LiteralPath $_.FullName -Force }

# Verification: a second pass must come back clean.
$verifySrc = Get-FileMap $src
$verifyDst = Get-FileMap $dst
$drift = @($verifySrc.Keys | Where-Object {
    -not $verifyDst.ContainsKey($_) -or $verifyDst[$_] -ne $verifySrc[$_]
})
$extra = @($verifyDst.Keys | Where-Object { -not $verifySrc.ContainsKey($_) })

if ($drift.Count -or $extra.Count) {
    Write-Host "✗ Synchronisation incomplète : $($drift.Count) écart(s), $($extra.Count) fichier(s) en trop." -ForegroundColor Red
    exit 1
}

Write-Host ''
Write-Host "✓ Miroir synchronisé ($($toCopy.Count) copié(s), $($toDelete.Count) supprimé(s), $($verifySrc.Count) fichiers vérifiés)." -ForegroundColor Green
exit 0
