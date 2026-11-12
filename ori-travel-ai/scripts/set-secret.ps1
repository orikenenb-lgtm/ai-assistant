<#
.SYNOPSIS
  Save one provider secret into apps\api\.env without it ever appearing on screen, in history or in a log.
.DESCRIPTION
  Prompts with Read-Host -AsSecureString (input is hidden), then writes NAME=value into apps\api\.env
  (replacing an existing NAME= line or appending one). The value is never printed; only its length is shown.
  apps\api\.env is git-ignored. Allowed names are limited to the known secret settings.
.EXAMPLE
  .\scripts\set-secret.ps1 ORI_DUFFEL_ACCESS_TOKEN
.EXAMPLE
  .\scripts\set-secret.ps1 ORI_VIATOR_API_KEY
#>
[CmdletBinding()]
param(
    [Parameter(Mandatory = $true, Position = 0)]
    [ValidateSet(
        'ORI_DUFFEL_ACCESS_TOKEN',
        'ORI_VIATOR_API_KEY',
        'ORI_ANTHROPIC_API_KEY',
        'ORI_BOOKING_DEMAND_API_KEY',
        'ORI_BOOKING_DEMAND_AFFILIATE_ID',
        'ORI_EXPEDIA_RAPID_API_KEY',
        'ORI_EXPEDIA_RAPID_SHARED_SECRET'
    )]
    [string]$Name,

    # Ask in a small Windows dialog (masked text box) instead of the console prompt.
    [switch]$Gui
)
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot '_common.ps1')

if (-not (Test-Path -LiteralPath $script:EnvFile)) {
    Stop-Script 'apps\api\.env is missing - run .\scripts\setup.ps1 first. / חסר קובץ .env - הריצו קודם setup.ps1'
}

function Show-Result([string]$Text, [bool]$IsError) {
    if ($Gui) {
        $icon = if ($IsError) { [System.Windows.Forms.MessageBoxIcon]::Error } else { [System.Windows.Forms.MessageBoxIcon]::Information }
        [void][System.Windows.Forms.MessageBox]::Show($Text, 'Ori Travel AI', [System.Windows.Forms.MessageBoxButtons]::OK, $icon)
    }
    if ($IsError) { Stop-Script $Text } else { Write-Ok $Text }
}

if ($Gui) {
    Add-Type -AssemblyName System.Windows.Forms
    Add-Type -AssemblyName System.Drawing
    $form = New-Object System.Windows.Forms.Form
    $form.Text = "Ori Travel AI - $Name"
    $form.Size = New-Object System.Drawing.Size(520, 190)
    $form.StartPosition = 'CenterScreen'
    $form.TopMost = $true
    $form.FormBorderStyle = 'FixedDialog'
    $form.MaximizeBox = $false
    $label = New-Object System.Windows.Forms.Label
    $label.Text = "Paste the value for $Name (hidden), then click Save.`nהדביקו את הערך (מוסתר) ולחצו Save."
    $label.Location = New-Object System.Drawing.Point(12, 12)
    $label.Size = New-Object System.Drawing.Size(480, 40)
    $box = New-Object System.Windows.Forms.TextBox
    $box.UseSystemPasswordChar = $true
    $box.Location = New-Object System.Drawing.Point(12, 60)
    $box.Size = New-Object System.Drawing.Size(480, 24)
    $ok = New-Object System.Windows.Forms.Button
    $ok.Text = 'Save'
    $ok.Location = New-Object System.Drawing.Point(316, 100)
    $ok.DialogResult = [System.Windows.Forms.DialogResult]::OK
    $cancel = New-Object System.Windows.Forms.Button
    $cancel.Text = 'Cancel'
    $cancel.Location = New-Object System.Drawing.Point(408, 100)
    $cancel.DialogResult = [System.Windows.Forms.DialogResult]::Cancel
    $form.Controls.AddRange(@($label, $box, $ok, $cancel))
    $form.AcceptButton = $ok
    $form.CancelButton = $cancel
    $form.Add_Shown({ $form.Activate(); $box.Focus() })
    $answer = $form.ShowDialog()
    $value = $box.Text.Trim()
    $box.Text = ''
    $form.Dispose()
    if ($answer -ne [System.Windows.Forms.DialogResult]::OK) { Show-Result 'Cancelled - nothing was saved. / בוטל - לא נשמר דבר.' $true }
}
else {
    $secure = Read-Host -Prompt "Paste the value for $Name and press Enter (input is hidden) / הדביקו את הערך ולחצו Enter (הקלט מוסתר)" -AsSecureString
    $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
    try {
        $value = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr).Trim()
    }
    finally {
        [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr)
    }
}

if ([string]::IsNullOrEmpty($value)) { Show-Result 'Empty value - nothing was saved. / הערך ריק - לא נשמר דבר.' $true }
if ($value -match '[\r\n]') { Show-Result 'The value contains a line break - nothing was saved. / הערך מכיל ירידת שורה - לא נשמר.' $true }
if ($value -match '\s') { Show-Result 'The value contains spaces - nothing was saved (check the copy). / הערך מכיל רווחים - לא נשמר.' $true }

# Light format checks so a wrong paste is caught before the app tries it (the value itself is never shown).
switch ($Name) {
    'ORI_DUFFEL_ACCESS_TOKEN' {
        if ($value -like 'duffel_live_*') { Write-Warn 'This is a LIVE Duffel token. The app blocks live tokens unless allow_live_mode=true. Prefer a duffel_test_ token. / זהו טוקן חי - מומלץ טוקן בדיקה.' }
        elseif ($value -notlike 'duffel_test_*') { Show-Result 'A Duffel token starts with duffel_test_ (or duffel_live_). Nothing was saved. / טוקן Duffel מתחיל ב-duffel_test_. לא נשמר.' $true }
    }
    'ORI_ANTHROPIC_API_KEY' {
        if ($value -notlike 'sk-ant-*') { Show-Result 'An Anthropic key starts with sk-ant-. Nothing was saved. / מפתח Anthropic מתחיל ב-sk-ant-. לא נשמר.' $true }
    }
}

$lines = [System.Collections.Generic.List[string]]::new()
foreach ($l in [System.IO.File]::ReadAllLines($script:EnvFile)) { $lines.Add($l) }
$pattern = '^\s*' + [regex]::Escape($Name) + '\s*='
$found = $false
for ($i = 0; $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match $pattern) {
        $lines[$i] = "$Name=$value"
        $found = $true
    }
}
if (-not $found) { $lines.Add("$Name=$value") }
[System.IO.File]::WriteAllLines($script:EnvFile, $lines, (New-Object System.Text.UTF8Encoding $false))
$len = $value.Length
$value = $null
Remove-Variable value -ErrorAction SilentlyContinue

# Read the file back and confirm the line really holds a value of the same length (value not shown).
$saved = @([System.IO.File]::ReadAllLines($script:EnvFile) | Where-Object { $_ -match $pattern })
$savedLen = if ($saved.Count -eq 1) { ($saved[0] -split '=', 2)[1].Length } else { -1 }
$saved = $null
if ($savedLen -ne $len) { Show-Result "Write check failed: $Name in apps\api\.env does not hold the new value. / הבדיקה נכשלה - הערך לא נשמר." $true }
Show-Result "$Name saved to apps\api\.env and verified (length $len; value not shown). / נשמר ואומת ב-.env (הערך לא מוצג)." $false
Write-Info 'Restart the app (start.ps1) so it picks up the change. / הפעילו מחדש את האפליקציה כדי שהשינוי ייקלט.'
