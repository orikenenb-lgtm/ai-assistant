<#
.SYNOPSIS
  Run Ori Travel AI locally (Windows).
.DESCRIPTION
  Default ("app" mode): builds apps\web when dist\ is missing (or -Rebuild) and runs FastAPI, which
  serves both the API and the web app at http://localhost:8000.
  -Dev: API with --reload on 8000 + Vite dev server on 5173 (two processes; Ctrl+C stops both).
  Binds to 127.0.0.1 only (this PC). -Lan binds to all interfaces - read the warning first.
.PARAMETER Dev      Developer mode (hot reload).
.PARAMETER Rebuild  Force rebuilding the web app in app mode.
.PARAMETER Lan      Listen on the local network (0.0.0.0). Plain HTTP - see docs\operations\windows-setup.md.
.PARAMETER Port     API port (default 8000).
.PARAMETER WebPort  Vite port in -Dev mode (default 5173).
#>
[CmdletBinding()]
param(
    [switch]$Dev,
    [switch]$Rebuild,
    [switch]$Lan,
    [int]$Port = 8000,
    [int]$WebPort = 5173
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

$apiProc = $null
$webProc = $null
try {
    $py = Get-VenvPython
    if ($null -eq $py) { Stop-Script 'No virtual environment. Run .\scripts\setup.ps1 first. / הריצו קודם setup.ps1' }
    if (-not (Test-Path -LiteralPath $script:EnvFile)) {
        Write-Warn 'apps\api\.env is missing - run setup.ps1 (encrypted traveler data will be unavailable). / חסר קובץ .env'
    }

    $bindHost = '127.0.0.1'
    if ($Lan) {
        $bindHost = '0.0.0.0'
        Write-Warn 'LAN mode: other devices on your network can reach the login page over plain HTTP (no encryption).'
        Write-Warn 'Use only on a trusted home network. Over HTTPS (reverse proxy) set ORI_COOKIE_SECURE=true. Windows Firewall will ask for permission.'
        Write-Warn 'מצב רשת מקומית: מכשירים ברשת יוכלו להגיע למסך ההתחברות ב-HTTP לא מוצפן. השתמשו רק ברשת ביתית מהימנה.'
    }

    if (-not (Test-PortFree $Port)) { Stop-Script "Port $Port is busy. Use -Port <other>. / הפורט $Port תפוס." }

    if (-not $Dev) {
        # ---- app mode ---------------------------------------------------------
        $index = Join-Path $script:WebDir 'dist\index.html'
        if ($Rebuild -or -not (Test-Path -LiteralPath $index)) {
            if (-not (Test-NodeAvailable)) { Stop-Script 'Node.js 20+ is required to build the web app. / נדרש Node.js 20+.' }
            Write-Info 'Building the web app / בונה את הממשק'
            Invoke-Native -Exe 'npm' -Arguments @('run', 'build') -WorkingDirectory $script:WebDir
        }
        Write-Ok "Open / פתחו בדפדפן:  http://localhost:$Port    (Ctrl+C to stop / לעצירה)"
        Push-Location -LiteralPath $script:ApiDir
        try {
            $global:LASTEXITCODE = 0
            & $py -m uvicorn app.main:app --host $bindHost --port $Port
            if ($LASTEXITCODE -ne 0) { Write-Warn "Server stopped with exit code $LASTEXITCODE" }
        }
        finally { Pop-Location }
        return
    }

    # ---- dev mode --------------------------------------------------------------
    if (-not (Test-NodeAvailable)) { Stop-Script 'Node.js 20+ is required for -Dev. / נדרש Node.js 20+.' }
    if (-not (Test-Path -LiteralPath (Join-Path $script:WebDir 'node_modules'))) {
        Stop-Script 'apps\web\node_modules is missing. Run .\scripts\setup.ps1 first. / הריצו setup.ps1'
    }
    if (-not (Test-PortFree $WebPort)) { Stop-Script "Port $WebPort is busy. Use -WebPort <other>. / הפורט $WebPort תפוס." }

    $env:VITE_API_TARGET = "http://127.0.0.1:$Port"
    $env:VITE_PORT = "$WebPort"
    Write-Info 'Starting API (--reload) and Vite / מפעיל שרת וממשק במצב פיתוח'
    $apiArgs = "-m uvicorn app.main:app --reload --host $bindHost --port $Port"
    $apiProc = Start-Process -FilePath $py -ArgumentList $apiArgs -WorkingDirectory $script:ApiDir -NoNewWindow -PassThru
    $webProc = Start-Process -FilePath 'cmd.exe' -ArgumentList '/c npm run dev' -WorkingDirectory $script:WebDir -NoNewWindow -PassThru
    Write-Ok "API: http://127.0.0.1:$Port    Web (dev): http://localhost:$WebPort    (Ctrl+C stops both / לעצירה)"
    while (-not $apiProc.HasExited -and -not $webProc.HasExited) { Start-Sleep -Seconds 1 }
    if ($apiProc.HasExited) { Write-Warn "API process exited (code $($apiProc.ExitCode))." }
    if ($webProc.HasExited) { Write-Warn "Vite process exited (code $($webProc.ExitCode))." }
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
finally {
    foreach ($p in @($apiProc, $webProc)) {
        if ($null -ne $p -and -not $p.HasExited) { Stop-ProcessTree $p.Id }
    }
    Remove-Item Env:\VITE_API_TARGET -ErrorAction SilentlyContinue
    Remove-Item Env:\VITE_PORT -ErrorAction SilentlyContinue
}
