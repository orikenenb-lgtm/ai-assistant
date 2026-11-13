<#
.SYNOPSIS  Create the family owner account (password prompted securely, never echoed).
.EXAMPLE   .\scripts\create-owner.ps1 -Email me@example.com -Name "Ori"
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)][string]$Email,
    [Parameter(Mandatory = $true)][string]$Name
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')
try {
    $py = Get-VenvPython
    if ($null -eq $py) { Stop-Script 'No virtual environment. Run .\scripts\setup.ps1 first. / הריצו קודם setup.ps1' }
    $secure = Read-Host -AsSecureString 'Owner password / סיסמה לבעל החשבון'
    $bstr = [System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $env:ORI_OWNER_PASSWORD = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr)
        Invoke-Native -Exe $py -Arguments @('-m', 'app.cli', 'create-owner', '--email', $Email, '--name', $Name, '--password-env', 'ORI_OWNER_PASSWORD') -WorkingDirectory $script:ApiDir
    }
    finally {
        [System.Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
        Remove-Item Env:\ORI_OWNER_PASSWORD -ErrorAction SilentlyContinue
    }
}
catch {
    Write-Err $_.Exception.Message
    exit 1
}
