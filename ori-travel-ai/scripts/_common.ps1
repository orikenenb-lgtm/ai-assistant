# Shared helpers for Ori Travel AI PowerShell scripts (dot-sourced, not run directly).
# Compatible with Windows PowerShell 5.1 and PowerShell 7+.
# NOTE: this file is saved as UTF-8 WITH BOM so Windows PowerShell 5.1 reads Hebrew correctly.

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

try { [Console]::OutputEncoding = [System.Text.Encoding]::UTF8 } catch { }
# Python on Windows would otherwise use the ANSI code page when output is redirected (start.ps1 *> log) and choke on Hebrew.
$env:PYTHONUTF8 = '1'

$script:RootDir = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path
$script:ApiDir  = Join-Path $script:RootDir 'apps\api'
$script:WebDir  = Join-Path $script:RootDir 'apps\web'
$script:VenvDir = Join-Path $script:ApiDir '.venv'
$script:EnvFile = Join-Path $script:ApiDir '.env'
$script:EnvExample = Join-Path $script:ApiDir '.env.example'

function Write-Info([string]$Message) { Write-Host "[..] $Message" -ForegroundColor Cyan }
function Write-Ok([string]$Message)   { Write-Host "[OK] $Message" -ForegroundColor Green }
function Write-Warn([string]$Message) { Write-Host "[!!] $Message" -ForegroundColor Yellow }
function Write-Err([string]$Message)  { Write-Host "[XX] $Message" -ForegroundColor Red }

function Stop-Script([string]$Message) {
    Write-Err $Message
    exit 1
}

# Path of the virtualenv interpreter, or $null when the venv does not exist yet.
function Get-VenvPython {
    $p = Join-Path $script:VenvDir 'Scripts\python.exe'
    if (Test-Path -LiteralPath $p) { return $p }
    return $null
}

# Run a native command and fail when its exit code is non-zero.
function Invoke-Native {
    param(
        [Parameter(Mandatory = $true)][string]$Exe,
        [string[]]$Arguments = @(),
        [string]$WorkingDirectory = $null
    )
    $global:LASTEXITCODE = 0
    if ($WorkingDirectory) { Push-Location -LiteralPath $WorkingDirectory }
    try {
        & $Exe @Arguments
        $code = $LASTEXITCODE
    }
    finally {
        if ($WorkingDirectory) { Pop-Location }
    }
    if ($code -ne 0) {
        throw "Command failed (exit code $code): $Exe $($Arguments -join ' ')"
    }
}

# Find a system Python >= 3.12. Returns @{ Exe = '...'; Args = @(...); Version = '3.12' } or $null.
function Find-SystemPython {
    $candidates = @(
        @{ Exe = 'py';      Args = @('-3.13') },
        @{ Exe = 'py';      Args = @('-3.12') },
        @{ Exe = 'py';      Args = @('-3') },
        @{ Exe = 'python';  Args = @() },
        @{ Exe = 'python3'; Args = @() }
    )
    foreach ($c in $candidates) {
        if (-not (Get-Command $c.Exe -ErrorAction SilentlyContinue)) { continue }
        try {
            $global:LASTEXITCODE = 0
            $probe = @($c.Args) + @('-c', 'import sys; print(str(sys.version_info[0]) + "." + str(sys.version_info[1]))')
            $out = & $c.Exe @probe 2>$null
            if ($LASTEXITCODE -ne 0 -or -not $out) { continue }
            $ver = [version](($out | Select-Object -First 1).ToString().Trim())
            if ($ver -ge [version]'3.12') {
                return @{ Exe = $c.Exe; Args = $c.Args; Version = $ver.ToString() }
            }
        }
        catch { continue }
    }
    return $null
}

# True when Node >= 20 and npm are available.
function Test-NodeAvailable {
    if (-not (Get-Command node -ErrorAction SilentlyContinue)) { return $false }
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) { return $false }
    try {
        $v = (& node --version 2>$null | Select-Object -First 1).ToString().Trim().TrimStart('v')
        return ([version]$v).Major -ge 20
    }
    catch { return $false }
}

# True when nothing is listening on the TCP port (127.0.0.1).
function Test-PortFree([int]$Port) {
    $listener = $null
    try {
        $listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Loopback, $Port)
        $listener.Start()
        return $true
    }
    catch { return $false }
    finally {
        if ($null -ne $listener) { try { $listener.Stop() } catch { } }
    }
}

# Kill a process and its children (Windows). Never throws.
function Stop-ProcessTree([int]$ProcessId) {
    try { & taskkill.exe /PID $ProcessId /T /F *> $null } catch { }
}

# Apply DB migrations. When the SQLite database already exists and is behind the code, a timestamped
# backup (apps\api\data\backups\*-pre-migrate-*.db) is taken FIRST; if the backup fails nothing is migrated.
function Invoke-SafeMigrate([string]$Python) {
    Write-Info 'Checking whether a pre-migration backup is needed / בודק אם נדרש גיבוי לפני עדכון המסד'
    try {
        Invoke-Native -Exe $Python -Arguments @((Join-Path $PSScriptRoot '_backup_db.py'), '--if-pending-migrations', '--label', 'pre-migrate') -WorkingDirectory $script:ApiDir
    }
    catch {
        throw "Backup failed - migrations were NOT applied. / הגיבוי נכשל, המסד לא עודכן. $($_.Exception.Message)"
    }
    Write-Info 'Applying database migrations / מעדכן מסד נתונים'
    Invoke-Native -Exe $Python -Arguments @('-m', 'app.cli', 'migrate') -WorkingDirectory $script:ApiDir
}
