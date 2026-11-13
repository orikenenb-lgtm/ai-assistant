<#
.SYNOPSIS  Add demo family members / sample data (DEMO data only; blocked when ORI_ENV=production).
#>
[CmdletBinding()]
param()
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
try {
    $py = Get-VenvPython
    if ($null -eq $py) { Stop-Script 'No virtual environment. Run .\scripts\setup.ps1 first. / הריצו קודם setup.ps1' }
    Invoke-Native -Exe $py -Arguments @('-m', 'app.cli', 'seed-demo') -WorkingDirectory $script:ApiDir
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
