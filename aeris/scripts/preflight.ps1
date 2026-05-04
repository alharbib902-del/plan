# Aeris local preflight
#
# Runs the same quality gates that GitHub Actions runs in CI, but
# locally and with no secrets. Exit code 0 means "safe to push and
# open a PR." Any failure exits non-zero immediately (fail fast).
#
# Usage (from anywhere):
#   pwsh aeris/scripts/preflight.ps1
#
# Or from inside aeris/:
#   pwsh scripts/preflight.ps1
#
# Notes:
# - Does not require, read, or write any secret.
# - Does not modify project files.
# - Does not deploy anything.
# - Mirrors the CI workflow at .github/workflows/ci.yml so a green
#   preflight strongly predicts a green CI run.

$ErrorActionPreference = 'Stop'

# Resolve the aeris/ directory regardless of where the script was launched.
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$AerisDir  = Resolve-Path (Join-Path $ScriptDir '..')

Push-Location $AerisDir
try {
    function Invoke-Step {
        param(
            [Parameter(Mandatory = $true)] [string] $Label,
            [Parameter(Mandatory = $true)] [string] $Command
        )
        Write-Host ""
        Write-Host "==> $Label"
        Write-Host "    $ $Command"
        & cmd /c $Command
        if ($LASTEXITCODE -ne 0) {
            Write-Host ""
            Write-Host "FAIL: '$Label' exited with code $LASTEXITCODE." -ForegroundColor Red
            exit $LASTEXITCODE
        }
    }

    Write-Host "Aeris preflight"
    Write-Host "Working directory: $AerisDir"

    Invoke-Step -Label 'Type-check'   -Command 'npm run type-check'
    Invoke-Step -Label 'Build'        -Command 'npm run build'
    Invoke-Step -Label 'Lint (strict)' -Command 'npm run lint:strict'

    Write-Host ""
    Write-Host "Preflight passed. Safe to push." -ForegroundColor Green
}
finally {
    Pop-Location
}
