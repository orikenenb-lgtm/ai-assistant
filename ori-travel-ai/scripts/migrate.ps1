<#
.SYNOPSIS  Apply DB migrations safely: a timestamped backup is taken first when the database exists and is behind the code.
.NOTES     Stop the server first. Backups: apps\api\data\backups\<db>-pre-migrate-<timestamp>.db. Restore: .\scripts\restore-db.ps1
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
try {
    $py = Get-VenvPython
    if ($null -eq $py) { Stop-Script 'No virtual environment. Run .\scripts\setup.ps1 first. / הריצו קודם setup.ps1' }
    Invoke-SafeMigrate -Python $py
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
