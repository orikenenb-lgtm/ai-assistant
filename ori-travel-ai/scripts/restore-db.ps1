<#
.SYNOPSIS  Restore the SQLite database from a backup file. STOP THE SERVER FIRST.
.DESCRIPTION
  The current database is saved as apps\api\data\backups\<db>-pre-restore-<timestamp>.db before being overwritten.
  The restored data must match the ORI_DATA_KEY in apps\api\.env (the key in use when the backup was made).
.EXAMPLE   .\scripts\restore-db.ps1 -BackupFile .\apps\api\data\backups\ori_travel-20261112-101500.db
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$BackupFile
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
try {
    $py = Get-VenvPython
    if ($null -eq $py) { Stop-Script 'No virtual environment. Run .\scripts\setup.ps1 first. / הריצו קודם setup.ps1' }
    if (-not (Test-Path -LiteralPath $BackupFile -PathType Leaf)) { Stop-Script "Backup file not found: $BackupFile / קובץ הגיבוי לא נמצא" }
    # Resolve against the caller's directory: the Python helper runs from apps\api.
    $full = (Resolve-Path -LiteralPath $BackupFile).ProviderPath
    Invoke-Native -Exe $py -Arguments @((Join-Path $PSScriptRoot '_backup_db.py'), '--restore', $full) -WorkingDirectory $script:ApiDir
    Write-Warn 'The restored data must match ORI_DATA_KEY in apps\api\.env. / המידע המוצפן דורש את מפתח ההצפנה שהיה בשימוש בזמן הגיבוי.'
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
