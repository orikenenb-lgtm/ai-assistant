<#
.SYNOPSIS
  Run all checks: API (ruff, pytest) and web (typecheck, lint, vitest, build); -E2E adds Playwright.
  Exits non-zero when any step fails and prints a summary table.
.PARAMETER ApiOnly  Only API checks.
.PARAMETER WebOnly  Only web checks.
.PARAMETER E2E      Also run Playwright end-to-end tests against a throwaway DB (run once beforehand:
                    cd apps\web; npx playwright install chromium).
#>
[CmdletBinding()]
param(
    [switch]$ApiOnly,
    [switch]$WebOnly,
    [switch]$E2E
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$results = New-Object System.Collections.Generic.List[object]

function Invoke-Step([string]$Name, [scriptblock]$Action) {
    Write-Info $Name
    $status = 'PASS'
    $started = Get-Date
    try { & $Action }
    catch {
        $status = 'FAIL'
        Write-Err $_.Exception.Message
    }
    $seconds = [math]::Round(((Get-Date) - $started).TotalSeconds, 1)
    $results.Add([pscustomobject]@{ Step = $Name; Result = $status; Seconds = $seconds }) | Out-Null
}

try {
    $py = Get-VenvPython
    if (-not $WebOnly) {
        if ($null -eq $py) { Stop-Script 'No virtual environment. Run .\scripts\setup.ps1 first. / הריצו קודם setup.ps1' }
        Invoke-Step 'api: ruff'   { Invoke-Native -Exe $py -Arguments @('-m', 'ruff', 'check', '.') -WorkingDirectory $script:ApiDir }
        Invoke-Step 'api: pytest' { Invoke-Native -Exe $py -Arguments @('-m', 'pytest') -WorkingDirectory $script:ApiDir }
    }
    if (-not $ApiOnly) {
        if (-not (Test-NodeAvailable)) { Stop-Script 'Node.js 20+ is required (or use -ApiOnly). / נדרש Node.js 20+.' }
        if (-not (Test-Path -LiteralPath (Join-Path $script:WebDir 'node_modules'))) { Stop-Script 'apps\web\node_modules missing. Run setup.ps1.' }
        Invoke-Step 'web: typecheck' { Invoke-Native -Exe 'npm' -Arguments @('run', 'typecheck') -WorkingDirectory $script:WebDir }
        Invoke-Step 'web: lint'      { Invoke-Native -Exe 'npm' -Arguments @('run', 'lint') -WorkingDirectory $script:WebDir }
        Invoke-Step 'web: vitest'    { Invoke-Native -Exe 'npm' -Arguments @('test') -WorkingDirectory $script:WebDir }
        Invoke-Step 'web: build'     { Invoke-Native -Exe 'npm' -Arguments @('run', 'build') -WorkingDirectory $script:WebDir }
    }
    if ($E2E) {
        if ($null -eq $py) { Stop-Script 'No virtual environment. Run setup.ps1 first.' }
        Invoke-Step 'web: e2e (playwright)' {
            $e2ePort = 8765
            if (-not (Test-PortFree $e2ePort)) { throw "Port $e2ePort is busy." }
            if (-not (Test-Path -LiteralPath (Join-Path $script:WebDir 'dist\index.html'))) {
                Invoke-Native -Exe 'npm' -Arguments @('run', 'build') -WorkingDirectory $script:WebDir
            }
            $tmp = Join-Path ([System.IO.Path]::GetTempPath()) ("ori-e2e-" + [guid]::NewGuid().ToString('N'))
            New-Item -ItemType Directory -Force -Path $tmp | Out-Null
            $server = $null
            $savedDb = $env:ORI_DATABASE_URL
            $savedKey = $env:ORI_DATA_KEY
            try {
                $env:ORI_DATABASE_URL = 'sqlite:///' + ((Join-Path $tmp 'e2e.db') -replace '\\', '/')
                $env:ORI_OWNER_PASSWORD = 'E2e-Passw0rd-Local-1'   # throwaway test-only value
                # Throwaway encryption key for the throwaway DB (traveler-profile specs need one)
                Push-Location $script:ApiDir
                try { $env:ORI_DATA_KEY = ((& $py -m app.cli gen-key) | Select-Object -Last 1).Trim() } finally { Pop-Location }
                Invoke-Native -Exe $py -Arguments @('-m', 'app.cli', 'migrate') -WorkingDirectory $script:ApiDir
                Invoke-Native -Exe $py -Arguments @('-m', 'app.cli', 'create-owner', '--email', 'owner@e2e.test', '--name', 'E2E Owner', '--password-env', 'ORI_OWNER_PASSWORD') -WorkingDirectory $script:ApiDir
                $server = Start-Process -FilePath $py -ArgumentList "-m uvicorn app.main:app --no-proxy-headers --host 127.0.0.1 --port $e2ePort" -WorkingDirectory $script:ApiDir -NoNewWindow -PassThru
                $ready = $false
                for ($i = 0; $i -lt 40 -and -not $ready; $i++) {
                    Start-Sleep -Milliseconds 500
                    try { $null = Invoke-WebRequest -Uri "http://127.0.0.1:$e2ePort/api/health" -UseBasicParsing -TimeoutSec 2; $ready = $true } catch { }
                }
                if (-not $ready) { throw 'API did not become ready for e2e.' }
                $env:E2E_BASE_URL = "http://127.0.0.1:$e2ePort"
                Invoke-Native -Exe 'npm' -Arguments @('run', 'e2e') -WorkingDirectory $script:WebDir
            }
            finally {
                if ($null -ne $server -and -not $server.HasExited) { Stop-ProcessTree $server.Id }
                Remove-Item Env:\ORI_OWNER_PASSWORD -ErrorAction SilentlyContinue
                Remove-Item Env:\E2E_BASE_URL -ErrorAction SilentlyContinue
                if ($null -ne $savedDb) { $env:ORI_DATABASE_URL = $savedDb } else { Remove-Item Env:\ORI_DATABASE_URL -ErrorAction SilentlyContinue }
                if ($null -ne $savedKey) { $env:ORI_DATA_KEY = $savedKey } else { Remove-Item Env:\ORI_DATA_KEY -ErrorAction SilentlyContinue }
                Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
            }
        }
    }
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}

Write-Host ''
Write-Host '================ Summary / סיכום ================'
$results | Format-Table -AutoSize | Out-String | Write-Host
$failed = @($results | Where-Object { $_.Result -ne 'PASS' })
if ($failed.Count -gt 0) {
    Write-Err "$($failed.Count) step(s) failed / שלבים שנכשלו"
    exit 1
}
Write-Ok 'All checks passed / כל הבדיקות עברו'
exit 0
