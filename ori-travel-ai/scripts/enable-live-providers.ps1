<#
.SYNOPSIS
  Enable the verified integrations (Duffel SANDBOX flights + ECB exchange rates) and prove they work.
.DESCRIPTION
  1. Checks apps\api\.env: the Duffel token must exist and be a TEST token (value never shown).
  2. Refuses if real booking / paid AI flags or other live provider keys are set.
  3. Backs up .env (apps\api\data\backups\env-*.bak) and sets ORI_LIVE_PROVIDERS_ENABLED=true, ORI_FX_LIVE_ENABLED=true.
  4. Stops ONLY this project's running server (python from apps\api\.venv running uvicorn app.main:app).
  5. Runs "python -m app.cli verify-providers": a real Duffel health check, ONE sandbox search TLV-ATH, ECB rates.
  6. Starts the app again in a new window (unless -NoStart).
  Real bookings and payments stay disabled: live booking execution is refused in code regardless of any setting.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\enable-live-providers.ps1
#>
[CmdletBinding()]
param(
    [switch]$NoStart
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

try {
    $py = Get-VenvPython
    if ($null -eq $py) { Stop-Script 'No virtual environment. Run .\scripts\setup.ps1 first. / הריצו קודם setup.ps1' }

    # 1-3. configure .env (Python helper: never prints values)
    Write-Info 'Configuring apps\api\.env / מגדיר את .env'
    $backupDir = Join-Path $script:ApiDir 'data\backups'
    Invoke-Native -Exe $py -Arguments @((Join-Path $PSScriptRoot '_configure_live.py'), $script:EnvFile, $backupDir)

    # 4. stop only this project's server processes
    $venvPrefix = [System.IO.Path]::GetFullPath($script:VenvDir)
    $procs = @(Get-CimInstance Win32_Process -Filter "Name = 'python.exe'" -ErrorAction SilentlyContinue | Where-Object {
        $_.CommandLine -and $_.CommandLine -like '*uvicorn*app.main:app*' -and $_.ExecutablePath -and
        $_.ExecutablePath.StartsWith($venvPrefix, [System.StringComparison]::OrdinalIgnoreCase)
    })
    if ($procs.Count -gt 0) {
        foreach ($p in $procs) { Stop-ProcessTree ([int]$p.ProcessId) }
        Start-Sleep -Seconds 1
        Write-Ok "Stopped $($procs.Count) running Ori Travel AI server process(es) / השרת הקודם נעצר"
    }
    else {
        Write-Info 'No running Ori Travel AI server found / לא נמצא שרת פעיל'
    }

    # 5. verify against the real providers
    Write-Info 'Verifying Duffel sandbox + ECB against their real APIs / מאמת מול Duffel ו-ECB'
    $global:LASTEXITCODE = 0
    Push-Location -LiteralPath $script:ApiDir
    try { & $py -m app.cli verify-providers; $verifyCode = $LASTEXITCODE }
    finally { Pop-Location }
    if ($verifyCode -ne 0) {
        Stop-Script 'Verification failed - see the lines above. The .env backup is in apps\api\data\backups. / האימות נכשל'
    }

    # 6. start again
    if (-not $NoStart) {
        $start = Join-Path $PSScriptRoot 'start.ps1'
        Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoExit', '-ExecutionPolicy', 'Bypass', '-File', "`"$start`"", '-Rebuild') -WorkingDirectory $script:RootDir
        Write-Ok 'The app is starting in a new window: http://localhost:8000 / האפליקציה עולה בחלון חדש'
    }
    Write-Ok 'Done. Duffel offers are labeled "בדיקה (Sandbox)" and cannot be booked. / הסתיים'
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
