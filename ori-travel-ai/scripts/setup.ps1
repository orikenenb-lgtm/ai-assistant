<#
.SYNOPSIS
  Ori Travel AI - first-time setup (Windows). Safe to run again.
.DESCRIPTION
  Creates apps\api\.venv, installs dependencies, creates apps\api\.env with a freshly
  generated ORI_DATA_KEY (never overwrites an existing one), applies DB migrations and
  installs the web dependencies.
.PARAMETER SkipWeb      Skip "npm ci" in apps\web.
.PARAMETER CreateOwner  Also create the owner account (needs -OwnerEmail and -OwnerName; password is prompted).
.PARAMETER SeedDemo     Add demo family members / sample data.
.EXAMPLE
  powershell -ExecutionPolicy Bypass -File .\scripts\setup.ps1 -CreateOwner -OwnerEmail me@example.com -OwnerName "Ori"
#>
[CmdletBinding()]
param(
    [switch]$SkipWeb,
    [switch]$CreateOwner,
    [string]$OwnerEmail,
    [string]$OwnerName,
    [switch]$SeedDemo
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

try {
    if ($CreateOwner -and ([string]::IsNullOrWhiteSpace($OwnerEmail) -or [string]::IsNullOrWhiteSpace($OwnerName))) {
        Stop-Script 'With -CreateOwner you must also pass -OwnerEmail and -OwnerName. / חובה לציין גם -OwnerEmail ו-OwnerName.'
    }

    # 1. Python ------------------------------------------------------------
    $sys = Find-SystemPython
    if ($null -eq $sys) {
        Stop-Script 'Python 3.12+ not found. Install from https://www.python.org/downloads/ (tick "Add python.exe to PATH"). / לא נמצא Python 3.12 ומעלה.'
    }
    Write-Ok "Python $($sys.Version) ($($sys.Exe))"

    # 2. Node --------------------------------------------------------------
    if (-not $SkipWeb) {
        if (-not (Test-NodeAvailable)) {
            Stop-Script 'Node.js 20+ and npm are required (Node 22 LTS recommended): https://nodejs.org/ . Use -SkipWeb to skip. / נדרש Node.js 20 ומעלה.'
        }
        Write-Ok "Node $((& node --version).Trim()), npm $((& npm --version).Trim())"
    }

    # 3. venv + dependencies -------------------------------------------------
    $py = Get-VenvPython
    if ($null -eq $py) {
        Write-Info 'Creating virtual environment apps\api\.venv / יוצר סביבה וירטואלית'
        Invoke-Native -Exe $sys.Exe -Arguments (@($sys.Args) + @('-m', 'venv', $script:VenvDir))
        $py = Get-VenvPython
        if ($null -eq $py) { Stop-Script 'Virtual environment was not created.' }
    }
    else {
        Write-Ok 'Existing virtual environment reused / משתמש בסביבה הקיימת'
    }
    Write-Info 'Installing API dependencies (requirements-dev.txt) / מתקין תלויות שרת'
    Invoke-Native -Exe $py -Arguments @('-m', 'pip', 'install', '--disable-pip-version-check', '-q', '-r', (Join-Path $script:ApiDir 'requirements-dev.txt'))
    Write-Ok 'API dependencies installed'

    # 4. .env + ORI_DATA_KEY --------------------------------------------------
    New-Item -ItemType Directory -Force -Path (Join-Path $script:ApiDir 'data') | Out-Null
    if (-not (Test-Path -LiteralPath $script:EnvFile)) {
        Copy-Item -LiteralPath $script:EnvExample -Destination $script:EnvFile
        Write-Info 'Created apps\api\.env from .env.example / נוצר קובץ .env'
    }
    # The Python snippet fills ORI_DATA_KEY only when it is missing/empty. It never prints the key.
    $keyScript = @'
import sys
path = sys.argv[1]
lines = open(path, encoding="utf-8").read().splitlines(keepends=True)
from cryptography.fernet import Fernet
for i, ln in enumerate(lines):
    if ln.startswith("ORI_DATA_KEY="):
        if ln.split("=", 1)[1].strip():
            print("present"); raise SystemExit
        lines[i] = "ORI_DATA_KEY=" + Fernet.generate_key().decode() + "\n"
        open(path, "w", encoding="utf-8", newline="").write("".join(lines))
        print("generated"); raise SystemExit
with open(path, "a", encoding="utf-8", newline="") as f:
    f.write("\nORI_DATA_KEY=" + Fernet.generate_key().decode() + "\n")
print("generated")
'@
    $global:LASTEXITCODE = 0
    $keyState = ($keyScript | & $py - $script:EnvFile | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0) { Stop-Script 'Could not prepare ORI_DATA_KEY.' }
    if ($keyState -eq 'generated') {
        Write-Ok 'ORI_DATA_KEY generated in apps\api\.env (value not shown) / נוצר מפתח הצפנה'
        Write-Warn 'BACK UP apps\api\.env securely. Losing ORI_DATA_KEY makes encrypted traveler data unreadable. / גבו את .env - אובדן המפתח = אובדן המידע המוצפן.'
    }
    else {
        Write-Ok 'Existing ORI_DATA_KEY kept untouched / מפתח הצפנה קיים נשמר'
    }

    # 5. migrations -----------------------------------------------------------
    Write-Info 'Applying database migrations / מעדכן מסד נתונים'
    Invoke-Native -Exe $py -Arguments @('-m', 'app.cli', 'migrate') -WorkingDirectory $script:ApiDir

    # 6. web -------------------------------------------------------------------
    if (-not $SkipWeb) {
        Write-Info 'Installing web dependencies (npm ci) / מתקין תלויות ממשק'
        Invoke-Native -Exe 'npm' -Arguments @('ci', '--no-audit', '--no-fund') -WorkingDirectory $script:WebDir
        Write-Ok 'Web dependencies installed'
    }
    else {
        Write-Warn 'Skipping web install (-SkipWeb)'
    }

    # 7. optional owner / demo ---------------------------------------------------
    if ($CreateOwner) {
        $secure = Read-Host -AsSecureString 'Owner password / סיסמה לבעל החשבון'
        $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try {
            $env:ORI_OWNER_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
            Invoke-Native -Exe $py -Arguments @('-m', 'app.cli', 'create-owner', '--email', $OwnerEmail, '--name', $OwnerName, '--password-env', 'ORI_OWNER_PASSWORD') -WorkingDirectory $script:ApiDir
        }
        finally {
            [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
            Remove-Item Env:\ORI_OWNER_PASSWORD -ErrorAction SilentlyContinue
        }
    }
    if ($SeedDemo) {
        Invoke-Native -Exe $py -Arguments @('-m', 'app.cli', 'seed-demo') -WorkingDirectory $script:ApiDir
    }

    Write-Ok 'Setup complete. Next: .\scripts\start.ps1 / ההתקנה הושלמה. להרצה: .\scripts\start.ps1'
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
