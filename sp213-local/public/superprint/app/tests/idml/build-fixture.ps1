param(
    [string]$Fixture = 'styled-reflow'
)

$source = Join-Path $PSScriptRoot "fixtures\$Fixture"
$destination = Join-Path $PSScriptRoot "$Fixture.idml"

if (-not (Test-Path $source)) {
    throw "Unknown IDML fixture: $Fixture"
}

Remove-Item -LiteralPath $destination -Force -ErrorAction SilentlyContinue
Compress-Archive -Path (Join-Path $source '*') -DestinationPath $destination -Force
Write-Output "Built $destination"