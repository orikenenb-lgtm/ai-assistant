<#
.SYNOPSIS  Consistent timestamped SQLite backup into apps\api\data\backups\.
.NOTES     The encryption key (ORI_DATA_KEY in apps\api\.env) is NOT part of the backup - store it separately and securely.
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
try {
    $py = Get-VenvPython
    if ($null -eq $py) { Stop-Script 'No virtual environment. Run .\scripts\setup.ps1 first. / הריצו קודם setup.ps1' }
    Invoke-Native -Exe $py -Arguments @((Join-Path $PSScriptRoot '_backup_db.py')) -WorkingDirectory $script:ApiDir
    Write-Warn 'Encrypted traveler data needs ORI_DATA_KEY from apps\api\.env. / המידע המוצפן דורש את מפתח ההצפנה מקובץ .env.'
    Write-Warn 'Back up apps\api\.env SEPARATELY and securely (not next to the DB backup, never in git). / גבו את .env בנפרד ובמקום מאובטח.'
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
