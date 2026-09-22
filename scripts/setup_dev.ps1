# ProFAQ local dev setup
# Run from the repo root: .\scripts\setup_dev.ps1
# Creates venv + pip cache inside the project folder - nothing lands on C:\Users

param(
    [switch]$Force
)

$ErrorActionPreference = "Stop"
$root = $PSScriptRoot | Split-Path -Parent

$venvDir  = Join-Path $root ".venv"
$cacheDir = Join-Path $root ".pip_cache"
$hfDir    = Join-Path $root "data\hf_cache"
$dataDir  = Join-Path $root "data"

foreach ($dir in @($cacheDir, $hfDir, "$dataDir\uploads", "$dataDir\db", "$dataDir\qdrant")) {
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
}

if ($Force -and (Test-Path $venvDir)) {
    Remove-Item -Recurse -Force $venvDir
}

if (-not (Test-Path $venvDir)) {
    Write-Host "Creating virtualenv at $venvDir"
    python -m venv $venvDir
}

$pip = Join-Path $venvDir "Scripts\pip.exe"
$python = Join-Path $venvDir "Scripts\python.exe"

Write-Host "Installing backend dependencies (pip cache -> $cacheDir)"
& $pip install --cache-dir $cacheDir -r (Join-Path $root "backend\requirements.txt")

# Write a .env if one doesn't exist yet
$envFile = Join-Path $root ".env"
if (-not (Test-Path $envFile)) {
    Copy-Item (Join-Path $root ".env.example") $envFile
    Write-Host "Created .env from .env.example - review and edit if needed"
}

Write-Host ""
Write-Host "Done. Activate with: .\.venv\Scripts\Activate.ps1"
Write-Host "Then run backend:    cd backend && uvicorn app.main:app --reload"
