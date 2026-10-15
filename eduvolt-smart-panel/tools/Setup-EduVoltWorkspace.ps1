<#
.SYNOPSIS
    Non-destructive Windows setup and inspection script for the EduVolt smart electrical panel final project.

.DESCRIPTION
    Runs on stock Windows PowerShell 5.1 (Windows 10/11) and on PowerShell 7.
    No external modules, no internet access, no downloads, no installs, no passwords,
    no changes to licensing or login.

    Steps:
      A  Detect the environment (Windows version, PowerShell, architecture, user name, screen).
      B  Look for EduVolt Designer: uninstall registry keys, Start Menu / Desktop shortcuts,
         EduVolt folders under Program Files / AppData, executable version info, running process.
         EduVolt configuration, library and project files are NEVER opened, parsed or modified:
         only their paths are listed. Login state and Free/Pro licence state cannot be seen from
         outside the app and are reported as UNKNOWN.
      C  List (never open) existing project-related files: names containing "eduvolt" and *.evc
         files under Documents, Desktop, Downloads and OneDrive (depth limited, max 500 results).
      D  Detect automation tools: python/py, node, npm, git, claude, pwsh, AutoHotkey,
         Windows UI Automation (.NET), Schneider Zelio Soft 2.
      E  Create the workspace folder <Documents>\<WorkspaceName> and its 11 sub-folders.
         Existing folders are left untouched.
      F  Copy the project deliverables from -SourcePath into the workspace (unless -SkipCopy).
         Missing file -> copied. Identical file (SHA256) -> skipped. Different file -> the existing
         file is NOT touched; the new version is written to 02_Backups\incoming_<timestamp>\ and
         listed as "needs manual merge".
      G  Optional (-BackupExistingEduVoltFiles): COPY (never move) every file found in step C into
         02_Backups\originals_<timestamp>\ and verify SHA256 of source and copy.
      H  Optional (-LaunchEduVolt): start EduVolt Designer only if exactly one launch target exists.
      I  Write 01_Project\ENVIRONMENT_REPORT_WINDOWS.md (Hebrew), 01_Project\environment_report.json
         and append to 01_Project\setup_log.txt. Existing report files are never overwritten: a new
         file with a timestamp suffix is written instead.

    Safety: the script never deletes, never moves and never overwrites a file. Every write is
    guarded by ShouldProcess, so -WhatIf shows the full plan without changing anything.

.PARAMETER SourcePath
    Folder that contains the project deliverables (the eduvolt-smart-panel folder of the cloned
    repository). Default: the parent folder of the folder that contains this script.

.PARAMETER WorkspaceName
    Name of the workspace folder created inside Documents. Default: EduVolt_Smart_Electrical_Panel.

.PARAMETER DocumentsPath
    The Documents folder. Default: [Environment]::GetFolderPath('MyDocuments'), which follows
    OneDrive folder redirection.

.PARAMETER SkipCopy
    Do not copy the deliverables (step F).

.PARAMETER BackupExistingEduVoltFiles
    Copy every file found in step C into 02_Backups\originals_<timestamp>\ and verify SHA256.
    Note: OneDrive "online-only" files are downloaded by Windows when they are read.

.PARAMETER LaunchEduVolt
    Start EduVolt Designer at the end, only if exactly one launch target was found and it is not
    already running.

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Setup-EduVoltWorkspace.ps1 -WhatIf

    Shows what would be created and copied. Nothing is written.

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Setup-EduVoltWorkspace.ps1

    Real run with default settings.

.EXAMPLE
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\Setup-EduVoltWorkspace.ps1 -BackupExistingEduVoltFiles -LaunchEduVolt

    Real run that also backs up existing EduVolt-related files and starts EduVolt Designer.

.NOTES
    Version 1.0.0
    - "-ExecutionPolicy Bypass" on the command line affects only that one PowerShell process;
      it does not change any system setting.
    - Console messages are in English because Windows consoles do not display Hebrew
      right-to-left. The Markdown report is in Hebrew.
    - The tools folder (this script and LOCAL_CLAUDE_CODE_PROMPT.md) IS copied into the workspace
      on purpose, so the workspace is self-contained for the local Claude Code session.
      Excluded from the copy: .git and __pycache__ folders and *.pyc files.
    - When the source folder and the workspace are the same folder (or one is inside the other),
      step F is skipped.
    - This file must stay saved as UTF-8 with BOM (it contains Hebrew text).
#>
#Requires -Version 5.1
[CmdletBinding(SupportsShouldProcess = $true)]
param(
    [string]$SourcePath = '',
    [string]$WorkspaceName = 'EduVolt_Smart_Electrical_Panel',
    [string]$DocumentsPath = [Environment]::GetFolderPath('MyDocuments'),
    [switch]$SkipCopy,
    [switch]$BackupExistingEduVoltFiles,
    [switch]$LaunchEduVolt
)

Set-StrictMode -Version Latest

# ---------------------------------------------------------------------------
# Script-wide state
# ---------------------------------------------------------------------------
$script:ScriptVersion = '1.0.0'
$script:ScriptCmdlet = $PSCmdlet
$script:RunStamp = (Get-Date).ToString('yyyyMMdd_HHmmss')
$script:StartTime = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
$script:LogLines = New-Object System.Collections.Generic.List[string]
$script:ErrorList = New-Object System.Collections.Generic.List[object]
$script:IsWhatIfRun = [bool]$WhatIfPreference
$script:EduVoltRegex = '(?i)edu[\s_.\-]?volt'
$script:UnknownState = 'UNKNOWN — check inside the app UI'
$script:OnWindows = ([System.Environment]::OSVersion.Platform -eq [System.PlatformID]::Win32NT)
$script:Sep = [System.IO.Path]::DirectorySeparatorChar
$script:FoundCap = 500
$script:ScanDepth = 5

# ---------------------------------------------------------------------------
# Helper functions (approved verbs only)
# ---------------------------------------------------------------------------
function Write-Status {
    param([string]$Message, [string]$Level = 'Info')
    $color = 'Gray'
    if ($Level -eq 'Step') { $color = 'Cyan' }
    elseif ($Level -eq 'Ok') { $color = 'Green' }
    elseif ($Level -eq 'Warn') { $color = 'Yellow' }
    elseif ($Level -eq 'Error') { $color = 'Red' }
    Write-Host $Message -ForegroundColor $color
}

function Add-LogEntry {
    param([string]$Step, [string]$Message)
    $flat = ([string]$Message).Replace("`r", ' ').Replace("`n", ' ')
    $line = '[{0}] [{1}] {2}' -f (Get-Date).ToString('yyyy-MM-dd HH:mm:ss'), $Step, $flat
    $script:LogLines.Add($line)
}

function Add-ErrorEntry {
    param([string]$Step, [string]$Message)
    $Message = ([string]$Message).Replace("`r", ' ').Replace("`n", ' ')
    $entry = [ordered]@{
        Step    = $Step
        Message = $Message
        Time    = (Get-Date).ToString('yyyy-MM-dd HH:mm:ss')
    }
    $script:ErrorList.Add($entry)
    Add-LogEntry -Step $Step -Message ('ERROR: ' + $Message)
    Write-Status -Message ('  [' + $Step + '] ERROR: ' + $Message) -Level 'Error'
}

function Test-CanWrite {
    param([string]$Target, [string]$Action)
    return [bool]$script:ScriptCmdlet.ShouldProcess($Target, $Action)
}

function Get-SafeProperty {
    param($InputObject, [string]$Name)
    if ($null -eq $InputObject) { return $null }
    if ($InputObject -is [System.Collections.IDictionary]) {
        if ($InputObject.Contains($Name)) { return $InputObject[$Name] }
        return $null
    }
    $prop = $InputObject.PSObject.Properties[$Name]
    if ($null -eq $prop) { return $null }
    try { return $prop.Value } catch { return $null }
}

function ConvertTo-PlainString {
    param($Value)
    if ($null -eq $Value) { return '' }
    return ([string]$Value).Trim()
}

function Resolve-FullPath {
    param([string]$Path)
    if ([string]::IsNullOrWhiteSpace($Path)) { return '' }
    $p = $ExecutionContext.SessionState.Path.GetUnresolvedProviderPathFromPSPath($Path)
    $p = [System.IO.Path]::GetFullPath($p)
    if ($p.Length -gt 3) { $p = $p.TrimEnd([char[]]@('\', '/')) }
    return $p
}

function Test-PathInside {
    param([string]$Path, [string]$Parent)
    if ([string]::IsNullOrEmpty($Path) -or [string]::IsNullOrEmpty($Parent)) { return $false }
    $p = $Path.TrimEnd([char[]]@('\', '/'))
    $q = $Parent.TrimEnd([char[]]@('\', '/'))
    if ($p.Equals($q, [System.StringComparison]::OrdinalIgnoreCase)) { return $true }
    return $p.StartsWith($q + $script:Sep, [System.StringComparison]::OrdinalIgnoreCase)
}

function Find-FileSystemItem {
    # Breadth-first, depth-limited listing that works the same on PowerShell 5.1 and 7.
    # Level 1 = direct children of Root. Junctions and symbolic links are listed but not followed.
    # Nothing is opened: only names and metadata are read.
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][scriptblock]$Predicate,
        [int]$MaxDepth = 5,
        [string[]]$ExcludeDirName = @(),
        [string[]]$ExcludePath = @(),
        [switch]$IncludeDescendantsOfMatches,
        [int]$MaxMatches = 0,
        [int]$MaxDirectories = 20000
    )
    $found = New-Object System.Collections.Generic.List[object]
    $stats = [ordered]@{
        RootExists         = $false
        DirectoriesScanned = 0
        AccessErrors       = 0
        Truncated          = $false
        TruncatedReason    = ''
    }
    if ([string]::IsNullOrEmpty($Root) -or -not [System.IO.Directory]::Exists($Root)) {
        return [pscustomobject]@{ Items = $found; Stats = $stats }
    }
    $stats['RootExists'] = $true
    $queue = New-Object System.Collections.Generic.Queue[object]
    $queue.Enqueue(@($Root, 1, $false))
    while ($queue.Count -gt 0) {
        if ($stats['DirectoriesScanned'] -ge $MaxDirectories) {
            $stats['Truncated'] = $true
            $stats['TruncatedReason'] = 'MaxDirectories'
            break
        }
        $entry = $queue.Dequeue()
        $dirPath = [string]$entry[0]
        $level = [int]$entry[1]
        $inherited = [bool]$entry[2]
        $stats['DirectoriesScanned'] = $stats['DirectoriesScanned'] + 1
        $children = @()
        try {
            $children = @(Get-ChildItem -LiteralPath $dirPath -Force -ErrorAction Stop)
        } catch {
            $stats['AccessErrors'] = $stats['AccessErrors'] + 1
            continue
        }
        foreach ($child in $children) {
            $isDir = [bool]$child.PSIsContainer
            if ($isDir) {
                $skip = $false
                foreach ($n in $ExcludeDirName) {
                    if ($child.Name -eq $n) { $skip = $true }
                }
                if (-not $skip) {
                    foreach ($x in $ExcludePath) {
                        if (Test-PathInside -Path $child.FullName -Parent $x) { $skip = $true }
                    }
                }
                if ($skip) { continue }
            }
            $isMatch = $inherited
            if (-not $isMatch) { $isMatch = [bool](& $Predicate $child) }
            if ($isMatch) {
                $found.Add([pscustomobject]@{ Item = $child; Level = $level; Inherited = $inherited })
                if ($MaxMatches -gt 0 -and $found.Count -ge $MaxMatches) {
                    $stats['Truncated'] = $true
                    $stats['TruncatedReason'] = 'MaxMatches'
                    $queue.Clear()
                    break
                }
            }
            if ($isDir -and $level -lt $MaxDepth) {
                $linkType = ConvertTo-PlainString (Get-SafeProperty -InputObject $child -Name 'LinkType')
                if ($linkType -ne '') { continue }
                $passDown = $inherited -or ($isMatch -and $IncludeDescendantsOfMatches)
                $queue.Enqueue(@($child.FullName, ($level + 1), $passDown))
            }
        }
    }
    return [pscustomobject]@{ Items = $found; Stats = $stats }
}

function Get-UninstallEntry {
    $list = New-Object System.Collections.Generic.List[object]
    $roots = @(
        'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall',
        'HKCU:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall'
    )
    foreach ($root in $roots) {
        $keys = @()
        try {
            $keys = @(Get-ChildItem -LiteralPath $root -ErrorAction SilentlyContinue)
        } catch {
            Add-LogEntry -Step 'B1' -Message ('Could not read ' + $root + ': ' + $_.Exception.Message)
            continue
        }
        foreach ($k in $keys) {
            try {
                $dn = ConvertTo-PlainString ($k.GetValue('DisplayName'))
                if ($dn -eq '') { continue }
                $list.Add([ordered]@{
                        DisplayName     = $dn
                        DisplayVersion  = ConvertTo-PlainString ($k.GetValue('DisplayVersion'))
                        Publisher       = ConvertTo-PlainString ($k.GetValue('Publisher'))
                        InstallLocation = ConvertTo-PlainString ($k.GetValue('InstallLocation'))
                        DisplayIcon     = ConvertTo-PlainString ($k.GetValue('DisplayIcon'))
                        UninstallString = ConvertTo-PlainString ($k.GetValue('UninstallString'))
                        RegistryKey     = ConvertTo-PlainString $k.Name
                    })
            } catch {
                continue
            }
        }
    }
    return , $list
}

function Find-Shortcut {
    # Lists *.lnk files whose name matches the regex. The shortcut is only read, never saved.
    param([string]$NameRegex, [string[]]$Roots, [int]$MaxDepth = 4)
    $result = New-Object System.Collections.Generic.List[object]
    $rx = $NameRegex
    $predicate = {
        param($Item)
        return ((-not $Item.PSIsContainer) -and ($Item.Extension -eq '.lnk') -and ($Item.Name -match $rx))
    }.GetNewClosure()
    $shell = $null
    try {
        foreach ($root in $Roots) {
            if ([string]::IsNullOrEmpty($root)) { continue }
            $scan = Find-FileSystemItem -Root $root -Predicate $predicate -MaxDepth $MaxDepth
            foreach ($hit in $scan.Items) {
                $lnk = $hit.Item.FullName
                $info = [ordered]@{
                    Shortcut         = $lnk
                    Name             = $hit.Item.Name
                    TargetPath       = ''
                    Arguments        = ''
                    WorkingDirectory = ''
                    TargetExists     = $false
                    Error            = ''
                }
                try {
                    if ($null -eq $shell) { $shell = New-Object -ComObject WScript.Shell }
                    $sc = $shell.CreateShortcut($lnk)
                    $info['TargetPath'] = ConvertTo-PlainString $sc.TargetPath
                    $info['Arguments'] = ConvertTo-PlainString $sc.Arguments
                    $info['WorkingDirectory'] = ConvertTo-PlainString $sc.WorkingDirectory
                    if ($info['TargetPath'] -ne '') {
                        $info['TargetExists'] = [System.IO.File]::Exists($info['TargetPath'])
                    }
                    try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($sc) } catch { }
                } catch {
                    $info['Error'] = 'Could not resolve shortcut target: ' + $_.Exception.Message
                }
                $result.Add($info)
            }
        }
    } finally {
        if ($null -ne $shell) {
            try { [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($shell) } catch { }
        }
    }
    return , $result
}

function Resolve-DisplayIconPath {
    param([string]$Value)
    if ([string]::IsNullOrWhiteSpace($Value)) { return '' }
    $v = $Value.Trim()
    if ($v.StartsWith('"')) {
        $end = $v.IndexOf('"', 1)
        if ($end -gt 1) { $v = $v.Substring(1, $end - 1) }
    } else {
        $comma = $v.LastIndexOf(',')
        if ($comma -gt 0) {
            $tail = $v.Substring($comma + 1).Trim()
            if ($tail -match '^-?\d+$') { $v = $v.Substring(0, $comma) }
        }
    }
    return $v.Trim()
}

function Test-LikelyMainExe {
    param([string]$Path)
    $name = [System.IO.Path]::GetFileNameWithoutExtension($Path)
    if ($name -match '(?i)unins|uninstall|update|crash|elevate|helper|setup|install|squirrel|notif') {
        return $false
    }
    return $true
}

function Get-ExeVersionInfo {
    param([string]$Path)
    $r = [ordered]@{
        ProductName     = ''
        ProductVersion  = ''
        FileVersion     = ''
        CompanyName     = ''
        FileDescription = ''
        Error           = ''
    }
    try {
        $vi = [System.Diagnostics.FileVersionInfo]::GetVersionInfo($Path)
        $r['ProductName'] = ConvertTo-PlainString $vi.ProductName
        $r['ProductVersion'] = ConvertTo-PlainString $vi.ProductVersion
        $r['FileVersion'] = ConvertTo-PlainString $vi.FileVersion
        $r['CompanyName'] = ConvertTo-PlainString $vi.CompanyName
        $r['FileDescription'] = ConvertTo-PlainString $vi.FileDescription
    } catch {
        $r['Error'] = $_.Exception.Message
    }
    return $r
}

function Invoke-VersionCommand {
    # Runs "<tool> --version" with a timeout. Output is captured, nothing is installed or changed.
    param([string]$FilePath, [string]$Arguments = '--version', [int]$TimeoutMs = 20000)
    $r = [ordered]@{ Output = ''; ExitCode = $null; TimedOut = $false; Error = '' }
    $proc = $null
    try {
        $psi = New-Object System.Diagnostics.ProcessStartInfo
        $ext = [System.IO.Path]::GetExtension($FilePath)
        if ($ext -eq '.cmd' -or $ext -eq '.bat') {
            $comSpec = ConvertTo-PlainString $env:ComSpec
            if ($comSpec -eq '') { $comSpec = 'cmd.exe' }
            $psi.FileName = $comSpec
            $psi.Arguments = '/d /s /c ""' + $FilePath + '" ' + $Arguments + '"'
        } else {
            $psi.FileName = $FilePath
            $psi.Arguments = $Arguments
        }
        $psi.UseShellExecute = $false
        $psi.CreateNoWindow = $true
        $psi.RedirectStandardInput = $true
        $psi.RedirectStandardOutput = $true
        $psi.RedirectStandardError = $true
        $proc = [System.Diagnostics.Process]::Start($psi)
        $proc.StandardInput.Close()
        $outTask = $proc.StandardOutput.ReadToEndAsync()
        $errTask = $proc.StandardError.ReadToEndAsync()
        if ($proc.WaitForExit($TimeoutMs)) {
            $r['ExitCode'] = $proc.ExitCode
        } else {
            $r['TimedOut'] = $true
            try { $proc.Kill() } catch { }
        }
        $text = ''
        if ($outTask.Wait(3000)) { $text = $text + [string]$outTask.Result }
        if ($errTask.Wait(3000)) { $text = $text + "`n" + [string]$errTask.Result }
        $lines = @($text -split "`r?`n" | Where-Object { -not [string]::IsNullOrWhiteSpace($_) })
        if ($lines.Count -gt 0) {
            $r['Output'] = (@($lines | Select-Object -First 3) -join ' | ').Trim()
        }
    } catch {
        $r['Error'] = $_.Exception.Message
    } finally {
        if ($null -ne $proc) { $proc.Dispose() }
    }
    return $r
}

function Find-ToolCommand {
    param([string]$Name)
    $cmds = @(Get-Command -Name $Name -CommandType Application -All -ErrorAction SilentlyContinue)
    foreach ($c in $cmds) {
        $p = ConvertTo-PlainString (Get-SafeProperty -InputObject $c -Name 'Path')
        if ($p -eq '') { $p = ConvertTo-PlainString (Get-SafeProperty -InputObject $c -Name 'Definition') }
        if ($p -eq '') { continue }
        $ext = [System.IO.Path]::GetExtension($p).ToLowerInvariant()
        if ((-not $script:OnWindows) -or ($ext -eq '.exe') -or ($ext -eq '.cmd') -or ($ext -eq '.bat') -or ($ext -eq '.com')) {
            return $p
        }
    }
    return ''
}

function New-SafeDirectory {
    param([string]$Path, [string]$Step)
    if ([System.IO.Directory]::Exists($Path)) { return 'Existing' }
    if ([System.IO.File]::Exists($Path)) { throw ('A file with this name already exists, cannot create folder: ' + $Path) }
    if (Test-CanWrite -Target $Path -Action 'Create directory') {
        [void][System.IO.Directory]::CreateDirectory($Path)
        Add-LogEntry -Step $Step -Message ('Created directory: ' + $Path)
        return 'Created'
    }
    return 'WhatIf'
}

function Copy-FileNoOverwrite {
    # Returns $true when copied, $false in -WhatIf mode. Throws if the destination exists.
    param([string]$Source, [string]$Destination, [string]$Step, [string]$Action = 'Copy file')
    if ([System.IO.File]::Exists($Destination) -or [System.IO.Directory]::Exists($Destination)) {
        throw ('Destination already exists, not overwriting: ' + $Destination)
    }
    if (-not (Test-CanWrite -Target $Destination -Action ($Action + ' (source: ' + $Source + ')'))) {
        return $false
    }
    $parent = [System.IO.Path]::GetDirectoryName($Destination)
    if (-not [System.IO.Directory]::Exists($parent)) {
        [void][System.IO.Directory]::CreateDirectory($parent)
    }
    [System.IO.File]::Copy($Source, $Destination, $false)
    Add-LogEntry -Step $Step -Message ('Copied: ' + $Source + ' -> ' + $Destination)
    return $true
}

function Get-FileSha256 {
    param([string]$Path)
    $h = Get-FileHash -LiteralPath $Path -Algorithm SHA256 -ErrorAction Stop
    return [string]$h.Hash
}

function ConvertTo-SafeRelativePath {
    # C:\Users\x\file.evc -> C\Users\x\file.evc ; \\server\share\f -> UNC\server\share\f
    param([string]$Path)
    $p = $Path
    if ($p.StartsWith('\\?\')) { $p = $p.Substring(4) }
    if ($p.StartsWith('\\')) { return ('UNC' + $script:Sep + $p.TrimStart([char[]]@('\'))) }
    if ($p.Length -ge 2 -and $p[1] -eq ':') {
        $rest = $p.Substring(2).TrimStart([char[]]@('\', '/'))
        return ($p.Substring(0, 1).ToUpperInvariant() + $script:Sep + $rest)
    }
    return $p.TrimStart([char[]]@('\', '/'))
}

function Get-RelativePath {
    param([string]$FullPath, [string]$Root)
    return $FullPath.Substring($Root.Length).TrimStart([char[]]@('\', '/'))
}

function Save-NewTextFile {
    # Creates a NEW file (FileMode.CreateNew). If the name is taken, a timestamp suffix is added.
    param([string]$Directory, [string]$BaseName, [string]$Extension, [string]$Content, [bool]$WithBom)
    $path = Join-Path $Directory ($BaseName + $Extension)
    if ([System.IO.File]::Exists($path)) {
        $path = Join-Path $Directory ($BaseName + '_' + $script:RunStamp + $Extension)
    }
    $i = 2
    while ([System.IO.File]::Exists($path)) {
        $path = Join-Path $Directory ($BaseName + '_' + $script:RunStamp + '_' + $i + $Extension)
        $i++
    }
    if (-not (Test-CanWrite -Target $path -Action 'Create report file')) { return '' }
    $enc = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $WithBom
    $fs = New-Object -TypeName System.IO.FileStream -ArgumentList @($path, [System.IO.FileMode]::CreateNew, [System.IO.FileAccess]::Write, [System.IO.FileShare]::None)
    try {
        $sw = New-Object -TypeName System.IO.StreamWriter -ArgumentList @($fs, $enc)
        try { $sw.Write($Content) } finally { $sw.Dispose() }
    } finally {
        $fs.Dispose()
    }
    return $path
}

function ConvertTo-MdCode {
    param($Value)
    $s = ConvertTo-PlainString $Value
    if ($s -eq '') { return '—' }
    $s = $s.Replace('`', "'").Replace('|', '\|').Replace("`r", ' ').Replace("`n", ' ')
    return ('`' + $s + '`')
}

function Format-YesNo {
    param($Value)
    if ([bool]$Value) { return 'כן' }
    return 'לא'
}

# ---------------------------------------------------------------------------
# Parameter resolution and validation
# ---------------------------------------------------------------------------
Write-Status -Message ('Setup-EduVoltWorkspace.ps1 v' + $script:ScriptVersion + '  (' + $script:StartTime + ')') -Level 'Step'
if ($script:IsWhatIfRun) {
    Write-Status -Message 'WhatIf mode: nothing will be created, copied or launched.' -Level 'Warn'
}

$invalidNameChars = [System.IO.Path]::GetInvalidFileNameChars()
if ([string]::IsNullOrWhiteSpace($WorkspaceName) -or $WorkspaceName.IndexOfAny($invalidNameChars) -ge 0 -or $WorkspaceName -eq '.' -or $WorkspaceName -eq '..') {
    Write-Status -Message ('Invalid -WorkspaceName: "' + $WorkspaceName + '". Use a plain folder name.') -Level 'Error'
    exit 2
}

if ([string]::IsNullOrWhiteSpace($DocumentsPath)) {
    $userProfileDir = ConvertTo-PlainString $env:USERPROFILE
    if ($userProfileDir -eq '') { $userProfileDir = [string]$HOME }
    $DocumentsPath = Join-Path $userProfileDir 'Documents'
}
$DocumentsPath = Resolve-FullPath $DocumentsPath
if (-not [System.IO.Directory]::Exists($DocumentsPath)) {
    Write-Status -Message ('Documents folder not found: ' + $DocumentsPath + '. Pass -DocumentsPath with an existing folder.') -Level 'Error'
    exit 2
}

$scriptDir = ConvertTo-PlainString $PSScriptRoot
if ($scriptDir -eq '') {
    $scriptFile = ConvertTo-PlainString (Get-SafeProperty -InputObject $MyInvocation.MyCommand -Name 'Path')
    if ($scriptFile -ne '') { $scriptDir = Split-Path -Parent $scriptFile }
}
if ([string]::IsNullOrWhiteSpace($SourcePath)) {
    if ($scriptDir -ne '') { $SourcePath = Split-Path -Parent $scriptDir }
}
$SourcePath = Resolve-FullPath $SourcePath

$WorkspacePath = Join-Path $DocumentsPath $WorkspaceName
$ProjectDir = Join-Path $WorkspacePath '01_Project'
$BackupsDir = Join-Path $WorkspacePath '02_Backups'

$Report = [ordered]@{
    Script      = 'Setup-EduVoltWorkspace.ps1'
    Version     = $script:ScriptVersion
    GeneratedAt = $script:StartTime
    RunMode     = $(if ($script:IsWhatIfRun) { 'WhatIf' } else { 'Real' })
    Parameters  = [ordered]@{
        SourcePath                 = $SourcePath
        WorkspaceName              = $WorkspaceName
        DocumentsPath              = $DocumentsPath
        WorkspacePath              = $WorkspacePath
        SkipCopy                   = [bool]$SkipCopy
        BackupExistingEduVoltFiles = [bool]$BackupExistingEduVoltFiles
        LaunchEduVolt              = [bool]$LaunchEduVolt
    }
    Environment = [ordered]@{}
    EduVolt     = [ordered]@{}
    ExistingFiles = [ordered]@{}
    Tools       = [ordered]@{}
    Workspace   = [ordered]@{}
    Copy        = [ordered]@{}
    Backup      = [ordered]@{}
    Launch      = [ordered]@{}
    Errors      = $script:ErrorList
}
Add-LogEntry -Step 'start' -Message ('===== Run ' + $script:RunStamp + ' | mode: ' + $Report['RunMode'] + ' | source: ' + $SourcePath + ' | workspace: ' + $WorkspacePath + ' =====')

# ---------------------------------------------------------------------------
# Step A - Environment detection (report only)
# ---------------------------------------------------------------------------
Write-Status -Message '[A] Detecting environment...' -Level 'Step'
$envInfo = $Report['Environment']
$oneDriveRoots = New-Object System.Collections.Generic.List[string]
try {
    $envInfo['OSCaption'] = ''
    $envInfo['OSVersion'] = ''
    $envInfo['OSBuild'] = ''
    $envInfo['OSDisplayVersion'] = ''
    $envInfo['OSArchitecture'] = ''
    try {
        $os = Get-CimInstance -ClassName Win32_OperatingSystem -ErrorAction Stop
        $envInfo['OSCaption'] = ConvertTo-PlainString (Get-SafeProperty -InputObject $os -Name 'Caption')
        $envInfo['OSVersion'] = ConvertTo-PlainString (Get-SafeProperty -InputObject $os -Name 'Version')
        $envInfo['OSBuild'] = ConvertTo-PlainString (Get-SafeProperty -InputObject $os -Name 'BuildNumber')
        $envInfo['OSArchitecture'] = ConvertTo-PlainString (Get-SafeProperty -InputObject $os -Name 'OSArchitecture')
    } catch {
        $envInfo['OSCaption'] = [System.Environment]::OSVersion.VersionString
        Add-ErrorEntry -Step 'A' -Message ('Win32_OperatingSystem query failed: ' + $_.Exception.Message)
    }
    try {
        $cv = Get-Item -LiteralPath 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion' -ErrorAction Stop
        $envInfo['OSDisplayVersion'] = ConvertTo-PlainString ($cv.GetValue('DisplayVersion'))
        $ubr = ConvertTo-PlainString ($cv.GetValue('UBR'))
        if ($ubr -ne '' -and $envInfo['OSBuild'] -ne '') { $envInfo['OSBuild'] = $envInfo['OSBuild'] + '.' + $ubr }
    } catch {
        Add-LogEntry -Step 'A' -Message ('Windows display version not available: ' + $_.Exception.Message)
    }
    $envInfo['PowerShellVersion'] = $PSVersionTable.PSVersion.ToString()
    $envInfo['PowerShellEdition'] = ConvertTo-PlainString $PSVersionTable['PSEdition']
    $envInfo['Is64BitOS'] = [System.Environment]::Is64BitOperatingSystem
    $envInfo['Is64BitProcess'] = [System.Environment]::Is64BitProcess
    $envInfo['ProcessorArchitecture'] = ConvertTo-PlainString $env:PROCESSOR_ARCHITECTURE
    $envInfo['UserName'] = [System.Environment]::UserName
    $envInfo['UICulture'] = [System.Globalization.CultureInfo]::CurrentUICulture.Name
    $envInfo['ExecutionPolicy'] = ''
    try { $envInfo['ExecutionPolicy'] = [string](Get-ExecutionPolicy) } catch { }
    $envInfo['DocumentsPath'] = $DocumentsPath
    foreach ($od in @($env:OneDrive, $env:OneDriveCommercial, $env:OneDriveConsumer)) {
        $odPath = ConvertTo-PlainString $od
        if ($odPath -ne '' -and [System.IO.Directory]::Exists($odPath)) {
            $odFull = Resolve-FullPath $odPath
            $dup = $false
            foreach ($existingOd in $oneDriveRoots) {
                if ($existingOd.Equals($odFull, [System.StringComparison]::OrdinalIgnoreCase)) { $dup = $true }
            }
            if (-not $dup) { $oneDriveRoots.Add($odFull) }
        }
    }
    $docsInOneDrive = $false
    foreach ($odRoot in $oneDriveRoots) {
        if (Test-PathInside -Path $DocumentsPath -Parent $odRoot) { $docsInOneDrive = $true }
    }
    $envInfo['DocumentsInOneDrive'] = $docsInOneDrive
    $screens = New-Object System.Collections.Generic.List[string]
    try {
        $vcs = @(Get-CimInstance -ClassName Win32_VideoController -ErrorAction Stop)
        foreach ($vc in $vcs) {
            $w = ConvertTo-PlainString (Get-SafeProperty -InputObject $vc -Name 'CurrentHorizontalResolution')
            $h = ConvertTo-PlainString (Get-SafeProperty -InputObject $vc -Name 'CurrentVerticalResolution')
            if ($w -ne '' -and $h -ne '') { $screens.Add($w + 'x' + $h) }
        }
    } catch {
        Add-LogEntry -Step 'A' -Message ('Win32_VideoController not available: ' + $_.Exception.Message)
    }
    if ($screens.Count -eq 0 -and $script:OnWindows) {
        try {
            Add-Type -AssemblyName System.Windows.Forms -ErrorAction Stop
            foreach ($scr in [System.Windows.Forms.Screen]::AllScreens) {
                $screens.Add([string]$scr.Bounds.Width + 'x' + [string]$scr.Bounds.Height)
            }
        } catch {
            Add-LogEntry -Step 'A' -Message ('Screen size not available: ' + $_.Exception.Message)
        }
    }
    $envInfo['ScreenResolution'] = ($screens -join ', ')
    Write-Status -Message ('    Windows: ' + $envInfo['OSCaption'] + ' ' + $envInfo['OSDisplayVersion'] + ' build ' + $envInfo['OSBuild'] + ' | PowerShell ' + $envInfo['PowerShellVersion'])
} catch {
    Add-ErrorEntry -Step 'A' -Message $_.Exception.Message
}

# ---------------------------------------------------------------------------
# Step B - Find EduVolt Designer (paths only, nothing is opened)
# ---------------------------------------------------------------------------
Write-Status -Message '[B] Looking for EduVolt Designer...' -Level 'Step'
$ev = $Report['EduVolt']
$ev['Found'] = $false
$ev['Version'] = ''
$ev['UninstallEntries'] = New-Object System.Collections.Generic.List[object]
$ev['StorePackages'] = New-Object System.Collections.Generic.List[object]
$ev['Shortcuts'] = New-Object System.Collections.Generic.List[object]
$ev['Folders'] = New-Object System.Collections.Generic.List[string]
$ev['Executables'] = New-Object System.Collections.Generic.List[object]
$ev['RunningProcesses'] = New-Object System.Collections.Generic.List[object]
$ev['LaunchTargets'] = New-Object System.Collections.Generic.List[object]
$ev['LoginState'] = $script:UnknownState
$ev['LicenseState'] = $script:UnknownState
$ev['Note'] = 'EduVolt configuration, library and project files were not opened, parsed or modified. Only paths were listed.'
$allUninstall = New-Object System.Collections.Generic.List[object]
$exeIndex = @{}
$exePredicate = {
    param($Item)
    return ((-not $Item.PSIsContainer) -and ($Item.Extension -eq '.exe'))
}

function Add-ExeCandidate {
    param([string]$Path, [string]$Source)
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    if (-not $Path.EndsWith('.exe', [System.StringComparison]::OrdinalIgnoreCase)) { return }
    if (-not [System.IO.File]::Exists($Path)) { return }
    $key = $Path.ToLowerInvariant()
    if ($exeIndex.ContainsKey($key)) {
        $existing = $exeIndex[$key]
        if (-not $existing['Sources'].Contains($Source)) { $existing['Sources'].Add($Source) }
        return
    }
    if ($exeIndex.Count -ge 50) { return }
    $vi = Get-ExeVersionInfo -Path $Path
    $item = [ordered]@{
        Path            = $Path
        Sources         = New-Object System.Collections.Generic.List[string]
        LikelyMainExe   = (Test-LikelyMainExe -Path $Path)
        ProductName     = $vi['ProductName']
        ProductVersion  = $vi['ProductVersion']
        FileVersion     = $vi['FileVersion']
        CompanyName     = $vi['CompanyName']
        FileDescription = $vi['FileDescription']
        VersionInfoError = $vi['Error']
    }
    $item['Sources'].Add($Source)
    $exeIndex[$key] = $item
    $ev['Executables'].Add($item)
}

# B1 - uninstall registry keys
try {
    $allUninstall = Get-UninstallEntry
    foreach ($u in $allUninstall) {
        if (($u['DisplayName'] -match $script:EduVoltRegex) -or ($u['Publisher'] -match $script:EduVoltRegex)) {
            $ev['UninstallEntries'].Add($u)
        }
    }
    Write-Status -Message ('    Uninstall registry entries: ' + $ev['UninstallEntries'].Count)
} catch {
    Add-ErrorEntry -Step 'B1' -Message $_.Exception.Message
}

# B1b - Microsoft Store (MSIX/Appx) packages, read-only query.
# Only on Windows PowerShell 5.1: in PowerShell 7 the Appx module loads through a compatibility layer.
try {
    if ($script:OnWindows -and ((ConvertTo-PlainString $PSVersionTable['PSEdition']) -eq 'Desktop') -and $null -ne (Get-Command -Name 'Get-AppxPackage' -ErrorAction SilentlyContinue)) {
        $pkgs = @(Get-AppxPackage -ErrorAction Stop | Where-Object { ($_.Name -match $script:EduVoltRegex) -or ($_.PackageFullName -match $script:EduVoltRegex) })
        foreach ($pkg in $pkgs) {
            $ev['StorePackages'].Add([ordered]@{
                    Name            = ConvertTo-PlainString $pkg.Name
                    Version         = ConvertTo-PlainString (Get-SafeProperty -InputObject $pkg -Name 'Version')
                    Publisher       = ConvertTo-PlainString (Get-SafeProperty -InputObject $pkg -Name 'Publisher')
                    InstallLocation = ConvertTo-PlainString (Get-SafeProperty -InputObject $pkg -Name 'InstallLocation')
                })
        }
        Write-Status -Message ('    Microsoft Store packages: ' + $ev['StorePackages'].Count)
    }
} catch {
    Add-LogEntry -Step 'B1b' -Message ('Store package query not available: ' + $_.Exception.Message)
}

# B2 - Start Menu and Desktop shortcuts
$startMenuRoots = @(
    [Environment]::GetFolderPath('CommonStartMenu'),
    [Environment]::GetFolderPath('StartMenu')
)
$desktopRoots = @(
    [Environment]::GetFolderPath('CommonDesktopDirectory'),
    [Environment]::GetFolderPath('Desktop')
)
try {
    foreach ($s in (Find-Shortcut -NameRegex $script:EduVoltRegex -Roots $startMenuRoots -MaxDepth 4)) { $ev['Shortcuts'].Add($s) }
    foreach ($s in (Find-Shortcut -NameRegex $script:EduVoltRegex -Roots $desktopRoots -MaxDepth 1)) { $ev['Shortcuts'].Add($s) }
    Write-Status -Message ('    Shortcuts: ' + $ev['Shortcuts'].Count)
} catch {
    Add-ErrorEntry -Step 'B2' -Message $_.Exception.Message
}

# B3 - folders named *EduVolt* directly under the usual install / data roots
try {
    $folderRoots = New-Object System.Collections.Generic.List[string]
    foreach ($fr in @($env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA, $env:APPDATA)) {
        $frPath = ConvertTo-PlainString $fr
        if ($frPath -ne '' -and -not $folderRoots.Contains($frPath)) { $folderRoots.Add($frPath) }
    }
    $localAppData = ConvertTo-PlainString $env:LOCALAPPDATA
    if ($localAppData -ne '') { $folderRoots.Add((Join-Path $localAppData 'Programs')) }
    foreach ($fr in $folderRoots) {
        if (-not [System.IO.Directory]::Exists($fr)) { continue }
        $dirs = @(Get-ChildItem -LiteralPath $fr -Directory -Force -ErrorAction SilentlyContinue)
        foreach ($d in $dirs) {
            if ($d.Name -match $script:EduVoltRegex) {
                if (-not $ev['Folders'].Contains($d.FullName)) { $ev['Folders'].Add($d.FullName) }
            }
        }
    }
    Write-Status -Message ('    Folders named *EduVolt*: ' + $ev['Folders'].Count)
} catch {
    Add-ErrorEntry -Step 'B3' -Message $_.Exception.Message
}

# B4 - candidate executables and their version info (FileVersionInfo only)
try {
    foreach ($s in $ev['Shortcuts']) {
        Add-ExeCandidate -Path $s['TargetPath'] -Source ('Shortcut: ' + $s['Shortcut'])
    }
    foreach ($u in $ev['UninstallEntries']) {
        Add-ExeCandidate -Path (Resolve-DisplayIconPath -Value $u['DisplayIcon']) -Source ('Registry DisplayIcon: ' + $u['DisplayName'])
        $loc = Resolve-DisplayIconPath -Value $u['InstallLocation']
        if ($loc -ne '' -and $loc -match $script:EduVoltRegex -and [System.IO.Directory]::Exists($loc)) {
            $scan = Find-FileSystemItem -Root $loc -Predicate $exePredicate -MaxDepth 2 -MaxMatches 50
            foreach ($hit in $scan.Items) { Add-ExeCandidate -Path $hit.Item.FullName -Source ('Registry InstallLocation: ' + $u['DisplayName']) }
        }
    }
    foreach ($f in $ev['Folders']) {
        $scan = Find-FileSystemItem -Root $f -Predicate $exePredicate -MaxDepth 3 -MaxMatches 50
        foreach ($hit in $scan.Items) { Add-ExeCandidate -Path $hit.Item.FullName -Source ('Folder: ' + $f) }
    }
    Write-Status -Message ('    Executables: ' + $ev['Executables'].Count)
} catch {
    Add-ErrorEntry -Step 'B4' -Message $_.Exception.Message
}

# B5 - is it running now?
try {
    $procs = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -match $script:EduVoltRegex })
    foreach ($p in $procs) {
        $ev['RunningProcesses'].Add([ordered]@{
                Name = ConvertTo-PlainString $p.ProcessName
                Id   = [int]$p.Id
                Path = ConvertTo-PlainString (Get-SafeProperty -InputObject $p -Name 'Path')
            })
    }
    Write-Status -Message ('    Running EduVolt processes: ' + $ev['RunningProcesses'].Count)
} catch {
    Add-ErrorEntry -Step 'B5' -Message $_.Exception.Message
}

# B6 - summary and launch targets (used by step H)
try {
    $mainExes = @($ev['Executables'] | Where-Object { $_['LikelyMainExe'] })
    $ev['Found'] = ($ev['UninstallEntries'].Count -gt 0) -or ($ev['StorePackages'].Count -gt 0) -or ($ev['Shortcuts'].Count -gt 0) -or ($mainExes.Count -gt 0)
    foreach ($u in $ev['UninstallEntries']) {
        if ($ev['Version'] -eq '' -and $u['DisplayVersion'] -ne '') { $ev['Version'] = $u['DisplayVersion'] }
    }
    foreach ($pkg in $ev['StorePackages']) {
        if ($ev['Version'] -eq '' -and $pkg['Version'] -ne '') { $ev['Version'] = $pkg['Version'] }
    }
    foreach ($x in $mainExes) {
        if ($ev['Version'] -eq '' -and $x['ProductVersion'] -ne '') { $ev['Version'] = $x['ProductVersion'] }
    }
    # Launch targets: distinct shortcut targets first (the official way to start the app);
    # only when there is no shortcut, the likely main executables.
    $targetKeys = @{}
    foreach ($s in $ev['Shortcuts']) {
        $tkey = 'lnk:' + $s['Name'].ToLowerInvariant()
        if ($s['TargetPath'] -ne '') { $tkey = ($s['TargetPath'] + '|' + $s['Arguments']).ToLowerInvariant() }
        if (-not $targetKeys.ContainsKey($tkey)) {
            $targetKeys[$tkey] = $true
            $ev['LaunchTargets'].Add([ordered]@{ Kind = 'Shortcut'; Path = $s['Shortcut']; Target = $s['TargetPath']; Arguments = $s['Arguments'] })
        }
    }
    if ($ev['LaunchTargets'].Count -eq 0) {
        foreach ($x in $mainExes) {
            $ev['LaunchTargets'].Add([ordered]@{ Kind = 'Executable'; Path = $x['Path']; Target = $x['Path']; Arguments = '' })
        }
    }
    $foundText = 'No'
    if ($ev['Found']) { $foundText = 'Yes' }
    Write-Status -Message ('    EduVolt Designer found: ' + $foundText + '  version: ' + $(if ($ev['Version'] -ne '') { $ev['Version'] } else { 'unknown' })) -Level 'Ok'
    Write-Status -Message ('    Login / licence state: ' + $script:UnknownState) -Level 'Warn'
} catch {
    Add-ErrorEntry -Step 'B6' -Message $_.Exception.Message
}

# ---------------------------------------------------------------------------
# Step C - Find existing project-related files (LIST ONLY)
# ---------------------------------------------------------------------------
Write-Status -Message '[C] Listing existing EduVolt-related files (names and sizes only)...' -Level 'Step'
$ef = $Report['ExistingFiles']
$ef['MaxDepth'] = $script:ScanDepth
$ef['Cap'] = $script:FoundCap
$ef['Capped'] = $false
$ef['Roots'] = New-Object System.Collections.Generic.List[object]
$ef['ExcludedPaths'] = New-Object System.Collections.Generic.List[string]
$ef['ExcludedFolderNames'] = @('.git', 'node_modules', '__pycache__')
$ef['Items'] = New-Object System.Collections.Generic.List[object]
$ef['TotalFound'] = 0
try {
    $downloads = ''
    try {
        $usf = Get-Item -LiteralPath 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders' -ErrorAction Stop
        $downloads = ConvertTo-PlainString ($usf.GetValue('{374DE290-123F-4565-9164-39C4925E467B}'))
    } catch {
        $downloads = ''
    }
    if ($downloads -eq '') {
        $up = ConvertTo-PlainString $env:USERPROFILE
        if ($up -eq '') { $up = [string]$HOME }
        $downloads = Join-Path $up 'Downloads'
    }
    $candidateRoots = New-Object System.Collections.Generic.List[object]
    $candidateRoots.Add([ordered]@{ Name = 'Documents'; Path = $DocumentsPath })
    $candidateRoots.Add([ordered]@{ Name = 'Desktop'; Path = [Environment]::GetFolderPath('Desktop') })
    $candidateRoots.Add([ordered]@{ Name = 'Downloads'; Path = $downloads })
    foreach ($odRoot in $oneDriveRoots) { $candidateRoots.Add([ordered]@{ Name = 'OneDrive'; Path = $odRoot }) }

    $scanRoots = New-Object System.Collections.Generic.List[object]
    foreach ($cr in $candidateRoots) {
        $crPath = ConvertTo-PlainString $cr['Path']
        if ($crPath -eq '') { continue }
        $crPath = Resolve-FullPath $crPath
        $dup = $false
        foreach ($sr in $scanRoots) {
            if ($sr['Path'].Equals($crPath, [System.StringComparison]::OrdinalIgnoreCase)) { $dup = $true }
        }
        if (-not $dup) { $scanRoots.Add([ordered]@{ Name = $cr['Name']; Path = $crPath }) }
    }
    $ef['ExcludedPaths'].Add($WorkspacePath)
    if ($SourcePath -ne '') { $ef['ExcludedPaths'].Add($SourcePath) }

    $seen = New-Object -TypeName 'System.Collections.Generic.HashSet[string]' -ArgumentList ([System.StringComparer]::OrdinalIgnoreCase)
    $stepCPredicate = {
        param($Item)
        if ($Item.Name -match '(?i)edu[\s_.\-]?volt') { return $true }
        if ((-not $Item.PSIsContainer) -and ($Item.Extension -eq '.evc')) { return $true }
        return $false
    }
    foreach ($sr in $scanRoots) {
        $rootInfo = [ordered]@{ Name = $sr['Name']; Path = $sr['Path']; Exists = $false; DirectoriesScanned = 0; AccessErrors = 0; Truncated = $false }
        $ef['Roots'].Add($rootInfo)
        if ($ef['Items'].Count -gt $script:FoundCap) { continue }
        # Other scan roots nested inside this one are scanned on their own, so skip them here.
        $excl = New-Object System.Collections.Generic.List[string]
        foreach ($e in $ef['ExcludedPaths']) { $excl.Add($e) }
        foreach ($other in $scanRoots) {
            if ((-not $other['Path'].Equals($sr['Path'], [System.StringComparison]::OrdinalIgnoreCase)) -and (Test-PathInside -Path $other['Path'] -Parent $sr['Path'])) {
                $excl.Add($other['Path'])
            }
        }
        $remaining = $script:FoundCap + 1 - $ef['Items'].Count
        $scan = Find-FileSystemItem -Root $sr['Path'] -Predicate $stepCPredicate -MaxDepth $script:ScanDepth -ExcludeDirName $ef['ExcludedFolderNames'] -ExcludePath $excl.ToArray() -IncludeDescendantsOfMatches -MaxMatches $remaining
        $rootInfo['Exists'] = $scan.Stats['RootExists']
        $rootInfo['DirectoriesScanned'] = $scan.Stats['DirectoriesScanned']
        $rootInfo['AccessErrors'] = $scan.Stats['AccessErrors']
        $rootInfo['Truncated'] = $scan.Stats['Truncated']
        foreach ($hit in $scan.Items) {
            $it = $hit.Item
            if (-not $seen.Add($it.FullName)) { continue }
            $isFolder = [bool]$it.PSIsContainer
            $reason = 'NameContainsEduVolt'
            if ($hit.Inherited) { $reason = 'InsideEduVoltFolder' }
            elseif ((-not $isFolder) -and ($it.Extension -eq '.evc') -and -not ($it.Name -match $script:EduVoltRegex)) { $reason = 'EvcExtension' }
            $size = $null
            if (-not $isFolder) { $size = [long]$it.Length }
            $ef['Items'].Add([ordered]@{
                    Path          = $it.FullName
                    Type          = $(if ($isFolder) { 'Folder' } else { 'File' })
                    SizeBytes     = $size
                    LastWriteTime = $it.LastWriteTime.ToString('yyyy-MM-dd HH:mm:ss')
                    Reason        = $reason
                    Root          = $sr['Name']
                })
        }
    }
    if ($ef['Items'].Count -gt $script:FoundCap) {
        $ef['Capped'] = $true
        $ef['Items'].RemoveRange($script:FoundCap, $ef['Items'].Count - $script:FoundCap)
    }
    $ef['TotalFound'] = $ef['Items'].Count
    $capText = ''
    if ($ef['Capped']) { $capText = ' (capped at ' + $script:FoundCap + ', there may be more)' }
    Write-Status -Message ('    Found: ' + $ef['TotalFound'] + $capText) -Level 'Ok'
} catch {
    Add-ErrorEntry -Step 'C' -Message $_.Exception.Message
}

# ---------------------------------------------------------------------------
# Step D - Detect automation tools
# ---------------------------------------------------------------------------
Write-Status -Message '[D] Detecting automation tools...' -Level 'Step'
$tools = $Report['Tools']
try {
    foreach ($toolName in @('python', 'py', 'node', 'npm', 'git', 'claude', 'pwsh')) {
        $t = [ordered]@{ Found = $false; Path = ''; Version = ''; ExitCode = $null; Note = '' }
        try {
            $toolPath = Find-ToolCommand -Name $toolName
            if ($toolPath -ne '') {
                $t['Found'] = $true
                $t['Path'] = $toolPath
                $vr = Invoke-VersionCommand -FilePath $toolPath -Arguments '--version'
                $t['Version'] = $vr['Output']
                $t['ExitCode'] = $vr['ExitCode']
                if ($vr['TimedOut']) { $t['Note'] = 'Timed out while running --version.' }
                if ($vr['Error'] -ne '') { $t['Note'] = 'Could not run --version: ' + $vr['Error'] }
                if ($toolPath -match '(?i)\\WindowsApps\\') {
                    if ($vr['ExitCode'] -eq 9009) {
                        $t['Found'] = $false
                        $t['Version'] = ''
                        $t['Note'] = 'Only the Microsoft Store app alias exists (exit code 9009); the tool is not installed.'
                    } else {
                        $t['Note'] = ($t['Note'] + ' Microsoft Store app alias.').Trim()
                    }
                }
            }
        } catch {
            $t['Note'] = 'Detection failed: ' + $_.Exception.Message
        }
        $tools[$toolName] = $t
        $shown = 'not found'
        if ($t['Found']) { $shown = $t['Version'] }
        Write-Status -Message ('    ' + $toolName + ': ' + $shown)
    }

    $ahk = [ordered]@{ Found = $false; Path = ''; Version = ''; ExitCode = $null; Note = '' }
    try {
        foreach ($k in @('HKLM:\SOFTWARE\AutoHotkey', 'HKLM:\SOFTWARE\WOW6432Node\AutoHotkey', 'HKCU:\SOFTWARE\AutoHotkey')) {
            $key = Get-Item -LiteralPath $k -ErrorAction SilentlyContinue
            if ($null -ne $key) {
                $ahk['Found'] = $true
                $ahk['Path'] = ConvertTo-PlainString ($key.GetValue('InstallDir'))
                $ahk['Version'] = ConvertTo-PlainString ($key.GetValue('Version'))
                $ahk['Note'] = 'Registry: ' + $k
                break
            }
        }
        if (-not $ahk['Found']) {
            foreach ($u in $allUninstall) {
                if ((-not $ahk['Found']) -and ($u['DisplayName'] -match '(?i)autohotkey')) {
                    $ahk['Found'] = $true
                    $ahk['Path'] = $u['InstallLocation']
                    $ahk['Version'] = $u['DisplayVersion']
                    $ahk['Note'] = 'Uninstall entry: ' + $u['DisplayName']
                }
            }
        }
        if (-not $ahk['Found']) {
            $ahkCmd = @(Get-Command -Name 'AutoHotkey*' -CommandType Application -ErrorAction SilentlyContinue | Select-Object -First 1)
            if ($ahkCmd.Count -gt 0) {
                $ahk['Found'] = $true
                $ahk['Path'] = ConvertTo-PlainString (Get-SafeProperty -InputObject $ahkCmd[0] -Name 'Path')
                $ahk['Note'] = 'Found on PATH (not executed).'
            }
        }
    } catch {
        $ahk['Note'] = 'Detection failed: ' + $_.Exception.Message
    }
    $tools['AutoHotkey'] = $ahk
    Write-Status -Message ('    AutoHotkey: ' + $(if ($ahk['Found']) { 'found ' + $ahk['Version'] } else { 'not found' }))

    $uia = [ordered]@{ Found = $false; Path = ''; Version = ''; ExitCode = $null; Note = '' }
    try {
        Add-Type -AssemblyName UIAutomationClient -ErrorAction Stop
        Add-Type -AssemblyName UIAutomationTypes -ErrorAction Stop
        $uia['Found'] = $true
        $uia['Note'] = 'UIAutomationClient and UIAutomationTypes can be loaded.'
    } catch {
        $uia['Note'] = 'Not loadable: ' + $_.Exception.Message
    }
    $tools['DotNetUIAutomation'] = $uia
    Write-Status -Message ('    .NET UI Automation: ' + $(if ($uia['Found']) { 'loadable' } else { 'not loadable' }))

    $zelio = [ordered]@{ Found = $false; Path = ''; Version = ''; ExitCode = $null; Note = '' }
    try {
        $zelioNames = New-Object System.Collections.Generic.List[string]
        foreach ($u in $allUninstall) {
            if ($u['DisplayName'] -match '(?i)zelio') {
                $zelio['Found'] = $true
                if ($zelio['Version'] -eq '') { $zelio['Version'] = $u['DisplayVersion'] }
                if ($zelio['Path'] -eq '') { $zelio['Path'] = $u['InstallLocation'] }
                $zelioNames.Add($u['DisplayName'])
            }
        }
        $zelioShortcuts = Find-Shortcut -NameRegex '(?i)zelio' -Roots $startMenuRoots -MaxDepth 4
        if ($zelioShortcuts.Count -gt 0) {
            $zelio['Found'] = $true
            if ($zelio['Path'] -eq '') { $zelio['Path'] = $zelioShortcuts[0]['TargetPath'] }
            $zelioNames.Add('Start Menu shortcut: ' + $zelioShortcuts[0]['Name'])
        }
        $zelio['Note'] = ($zelioNames -join '; ')
    } catch {
        $zelio['Note'] = 'Detection failed: ' + $_.Exception.Message
    }
    $tools['ZelioSoft2'] = $zelio
    Write-Status -Message ('    Schneider Zelio Soft 2: ' + $(if ($zelio['Found']) { 'found ' + $zelio['Version'] } else { 'not found' }))
} catch {
    Add-ErrorEntry -Step 'D' -Message $_.Exception.Message
}

# ---------------------------------------------------------------------------
# Step E - Create the workspace (existing folders are left untouched)
# ---------------------------------------------------------------------------
Write-Status -Message ('[E] Workspace: ' + $WorkspacePath) -Level 'Step'
$ws = $Report['Workspace']
$ws['Path'] = $WorkspacePath
$ws['Folders'] = New-Object System.Collections.Generic.List[object]
$subFolders = @('01_Project', '02_Backups', '03_Custom_Components', '04_Schematics', '05_Panel_Layout', '06_PLC_Logic', '07_Simulation', '08_Test_Reports', '09_Exports', '10_Documentation', '11_References')
try {
    $rootState = New-SafeDirectory -Path $WorkspacePath -Step 'E'
    $ws['Folders'].Add([ordered]@{ Name = '.'; State = $rootState })
    foreach ($sf in $subFolders) {
        $state = 'Error'
        try {
            $state = New-SafeDirectory -Path (Join-Path $WorkspacePath $sf) -Step 'E'
        } catch {
            Add-ErrorEntry -Step 'E' -Message $_.Exception.Message
        }
        $ws['Folders'].Add([ordered]@{ Name = $sf; State = $state })
    }
    $createdCount = @($ws['Folders'] | Where-Object { $_['State'] -eq 'Created' }).Count
    $existingCount = @($ws['Folders'] | Where-Object { $_['State'] -eq 'Existing' }).Count
    Write-Status -Message ('    Folders created: ' + $createdCount + ', already existing: ' + $existingCount) -Level 'Ok'
} catch {
    Add-ErrorEntry -Step 'E' -Message $_.Exception.Message
}

# ---------------------------------------------------------------------------
# Step F - Copy deliverables (never overwrite)
# ---------------------------------------------------------------------------
Write-Status -Message '[F] Copying project deliverables...' -Level 'Step'
$cp = $Report['Copy']
$cp['Performed'] = $false
$cp['SkippedReason'] = ''
$cp['SourcePath'] = $SourcePath
$cp['ExcludedRules'] = '.git and __pycache__ folders, *.pyc files'
$cp['IncomingFolder'] = ''
$cp['Copied'] = New-Object System.Collections.Generic.List[string]
$cp['WouldCopy'] = New-Object System.Collections.Generic.List[string]
$cp['Identical'] = New-Object System.Collections.Generic.List[string]
$cp['NeedsMerge'] = New-Object System.Collections.Generic.List[object]
$cp['Failed'] = New-Object System.Collections.Generic.List[object]
try {
    if ($SkipCopy) {
        $cp['SkippedReason'] = 'SkipCopy switch was used.'
    } elseif ($SourcePath -eq '' -or -not [System.IO.Directory]::Exists($SourcePath)) {
        $cp['SkippedReason'] = 'Source folder not found: ' + $SourcePath
        Add-ErrorEntry -Step 'F' -Message $cp['SkippedReason']
    } elseif ((Test-PathInside -Path $WorkspacePath -Parent $SourcePath) -or (Test-PathInside -Path $SourcePath -Parent $WorkspacePath)) {
        $cp['SkippedReason'] = 'Source and workspace are the same folder or nested in each other; nothing to copy.'
    } else {
        $cp['Performed'] = $true
        $incoming = Join-Path $BackupsDir ('incoming_' + $script:RunStamp)
        $sourcePredicate = {
            param($Item)
            return ((-not $Item.PSIsContainer) -and ($Item.Extension -ne '.pyc'))
        }
        $srcScan = Find-FileSystemItem -Root $SourcePath -Predicate $sourcePredicate -MaxDepth 32 -ExcludeDirName @('.git', '__pycache__') -MaxDirectories 5000
        if ($srcScan.Stats['Truncated']) {
            Add-ErrorEntry -Step 'F' -Message ('Source listing was truncated (' + $srcScan.Stats['TruncatedReason'] + ').')
        }
        foreach ($hit in $srcScan.Items) {
            $srcFile = $hit.Item.FullName
            $rel = Get-RelativePath -FullPath $srcFile -Root $SourcePath
            $dest = Join-Path $WorkspacePath $rel
            try {
                if ([System.IO.Directory]::Exists($dest)) {
                    throw ('A folder exists where a file is expected: ' + $dest)
                }
                if (-not [System.IO.File]::Exists($dest)) {
                    if (Copy-FileNoOverwrite -Source $srcFile -Destination $dest -Step 'F') {
                        $cp['Copied'].Add($rel)
                    } else {
                        $cp['WouldCopy'].Add($rel)
                    }
                } else {
                    $srcHash = Get-FileSha256 -Path $srcFile
                    $dstHash = Get-FileSha256 -Path $dest
                    if ($srcHash -eq $dstHash) {
                        $cp['Identical'].Add($rel)
                    } else {
                        $cp['IncomingFolder'] = $incoming
                        $incomingFile = Join-Path $incoming $rel
                        $written = Copy-FileNoOverwrite -Source $srcFile -Destination $incomingFile -Step 'F' -Action 'Save new version for manual merge'
                        $cp['NeedsMerge'].Add([ordered]@{
                                Relative = $rel
                                Existing = $dest
                                Incoming = $incomingFile
                                Written  = $written
                            })
                        Add-LogEntry -Step 'F' -Message ('Needs manual merge: ' + $rel)
                    }
                }
            } catch {
                $cp['Failed'].Add([ordered]@{ Relative = $rel; Error = $_.Exception.Message })
                Add-ErrorEntry -Step 'F' -Message ($rel + ': ' + $_.Exception.Message)
            }
        }
    }
    if ($cp['SkippedReason'] -ne '') {
        Write-Status -Message ('    Copy skipped: ' + $cp['SkippedReason']) -Level 'Warn'
    } else {
        Write-Status -Message ('    Copied: ' + $cp['Copied'].Count + ', would copy (WhatIf): ' + $cp['WouldCopy'].Count + ', identical (skipped): ' + $cp['Identical'].Count + ', needs manual merge: ' + $cp['NeedsMerge'].Count + ', failed: ' + $cp['Failed'].Count) -Level 'Ok'
    }
} catch {
    Add-ErrorEntry -Step 'F' -Message $_.Exception.Message
}

# ---------------------------------------------------------------------------
# Step G - Optional backup of existing EduVolt-related files (COPY only)
# ---------------------------------------------------------------------------
$bk = $Report['Backup']
$bk['Requested'] = [bool]$BackupExistingEduVoltFiles
$bk['Folder'] = ''
$bk['Files'] = New-Object System.Collections.Generic.List[object]
$bk['Verified'] = 0
$bk['Mismatched'] = 0
$bk['FailedCount'] = 0
if ($BackupExistingEduVoltFiles) {
    Write-Status -Message '[G] Backing up existing EduVolt-related files (copy only)...' -Level 'Step'
    try {
        $originals = Join-Path $BackupsDir ('originals_' + $script:RunStamp)
        $bk['Folder'] = $originals
        foreach ($item in $ef['Items']) {
            if ($item['Type'] -ne 'File') { continue }
            $entry = [ordered]@{ Source = $item['Path']; Copy = ''; SourceSha256 = ''; CopySha256 = ''; Match = $false; State = '' }
            try {
                $dest = Join-Path $originals (ConvertTo-SafeRelativePath -Path $item['Path'])
                $entry['Copy'] = $dest
                if (Copy-FileNoOverwrite -Source $item['Path'] -Destination $dest -Step 'G' -Action 'Backup copy') {
                    $entry['SourceSha256'] = Get-FileSha256 -Path $item['Path']
                    $entry['CopySha256'] = Get-FileSha256 -Path $dest
                    $entry['Match'] = ($entry['SourceSha256'] -eq $entry['CopySha256'])
                    if ($entry['Match']) {
                        $entry['State'] = 'Verified'
                        $bk['Verified'] = $bk['Verified'] + 1
                    } else {
                        $entry['State'] = 'HashMismatch'
                        $bk['Mismatched'] = $bk['Mismatched'] + 1
                        Add-ErrorEntry -Step 'G' -Message ('SHA256 mismatch after copy (source may have changed while copying): ' + $item['Path'])
                    }
                } else {
                    $entry['State'] = 'WhatIf'
                }
            } catch {
                $entry['State'] = 'Failed: ' + $_.Exception.Message
                $bk['FailedCount'] = $bk['FailedCount'] + 1
                Add-ErrorEntry -Step 'G' -Message ($item['Path'] + ': ' + $_.Exception.Message)
            }
            $bk['Files'].Add($entry)
        }
        Write-Status -Message ('    Backed up and verified: ' + $bk['Verified'] + ', mismatched: ' + $bk['Mismatched'] + ', failed: ' + $bk['FailedCount']) -Level 'Ok'
    } catch {
        Add-ErrorEntry -Step 'G' -Message $_.Exception.Message
    }
} else {
    Write-Status -Message '[G] Backup of existing files: not requested (use -BackupExistingEduVoltFiles).' -Level 'Step'
}

# ---------------------------------------------------------------------------
# Step H - Optional launch of EduVolt Designer
# ---------------------------------------------------------------------------
$ln = $Report['Launch']
$ln['Requested'] = [bool]$LaunchEduVolt
$ln['Launched'] = $false
$ln['Target'] = ''
$ln['Message'] = 'Not requested.'
if ($LaunchEduVolt) {
    Write-Status -Message '[H] Launching EduVolt Designer...' -Level 'Step'
    try {
        $targets = $ev['LaunchTargets']
        if ($ev['RunningProcesses'].Count -gt 0) {
            $ln['Message'] = 'EduVolt is already running; not starting a second instance.'
        } elseif ($targets.Count -eq 0) {
            $ln['Message'] = 'No EduVolt launch target was found; nothing was started.'
        } elseif ($targets.Count -gt 1) {
            $ln['Message'] = 'Several launch targets were found (' + $targets.Count + '); nothing was started. Start it from the official shortcut.'
        } else {
            $t = $targets[0]
            $ln['Target'] = $t['Path']
            if (Test-CanWrite -Target $t['Path'] -Action 'Start EduVolt Designer') {
                # Same as Start-Process, but behaves identically on PowerShell 5.1 and 7 and does not
                # ask a second confirmation. A shortcut (.lnk) is opened through the Windows shell,
                # so its own arguments and working folder are used.
                $startInfo = New-Object System.Diagnostics.ProcessStartInfo
                $startInfo.FileName = $t['Path']
                $startInfo.UseShellExecute = $true
                if ($t['Kind'] -eq 'Executable') {
                    $startInfo.WorkingDirectory = [System.IO.Path]::GetDirectoryName($t['Path'])
                }
                $started = [System.Diagnostics.Process]::Start($startInfo)
                if ($null -ne $started) { $started.Dispose() }
                $ln['Launched'] = $true
                $ln['Message'] = 'Started: ' + $t['Path']
                Add-LogEntry -Step 'H' -Message $ln['Message']
            } else {
                $ln['Message'] = 'WhatIf: would start ' + $t['Path']
            }
        }
        Write-Status -Message ('    ' + $ln['Message']) -Level 'Ok'
    } catch {
        $ln['Message'] = 'Launch failed: ' + $_.Exception.Message
        Add-ErrorEntry -Step 'H' -Message $_.Exception.Message
    }
}

# ---------------------------------------------------------------------------
# Step I - Reports (Markdown in Hebrew, JSON, appended log)
# ---------------------------------------------------------------------------
Write-Status -Message '[I] Writing reports...' -Level 'Step'
$mdPath = ''
$jsonPath = ''
$logPath = ''
try {
    $md = New-Object System.Collections.Generic.List[string]
    $md.Add('# דוח סביבה — מחשב Windows')
    $md.Add('')
    $md.Add('> הדוח נוצר אוטומטית. הסקריפט קרא ותיעד, יצר תיקיות חסרות והעתיק קבצים חדשים בלבד.')
    $md.Add('> הוא לא מחק, לא העביר ולא דרס אף קובץ קיים.')
    $md.Add('')
    $md.Add('| פרט | ערך |')
    $md.Add('|---|---|')
    $md.Add('| תאריך ושעה | ' + (ConvertTo-MdCode $script:StartTime) + ' |')
    $md.Add('| סקריפט | ' + (ConvertTo-MdCode ('Setup-EduVoltWorkspace.ps1 v' + $script:ScriptVersion)) + ' |')
    $md.Add('| מצב הרצה | ' + (ConvertTo-MdCode $Report['RunMode']) + ' |')
    $md.Add('| תיקיית המקור | ' + (ConvertTo-MdCode $SourcePath) + ' |')
    $md.Add('| תיקיית העבודה | ' + (ConvertTo-MdCode $WorkspacePath) + ' |')
    $md.Add('')

    $md.Add('## 1. מערכת ההפעלה והסביבה')
    $md.Add('')
    $md.Add('| פריט | ערך |')
    $md.Add('|---|---|')
    $md.Add('| מערכת הפעלה | ' + (ConvertTo-MdCode (Get-SafeProperty $envInfo 'OSCaption')) + ' |')
    $md.Add('| גרסה | ' + (ConvertTo-MdCode (Get-SafeProperty $envInfo 'OSVersion')) + ' |')
    $md.Add('| גרסת תצוגה | ' + (ConvertTo-MdCode (Get-SafeProperty $envInfo 'OSDisplayVersion')) + ' |')
    $md.Add('| מספר בנייה | ' + (ConvertTo-MdCode (Get-SafeProperty $envInfo 'OSBuild')) + ' |')
    $md.Add('| ארכיטקטורה | ' + (ConvertTo-MdCode ((ConvertTo-PlainString (Get-SafeProperty $envInfo 'OSArchitecture')) + ' ' + (ConvertTo-PlainString (Get-SafeProperty $envInfo 'ProcessorArchitecture')))) + ' |')
    $md.Add('| תהליך של 64 ביט | ' + (Format-YesNo (Get-SafeProperty $envInfo 'Is64BitProcess')) + ' |')
    $md.Add('| גרסת PowerShell | ' + (ConvertTo-MdCode ((ConvertTo-PlainString (Get-SafeProperty $envInfo 'PowerShellVersion')) + ' ' + (ConvertTo-PlainString (Get-SafeProperty $envInfo 'PowerShellEdition')))) + ' |')
    $md.Add('| מדיניות הרצת סקריפטים | ' + (ConvertTo-MdCode (Get-SafeProperty $envInfo 'ExecutionPolicy')) + ' |')
    $md.Add('| שם משתמש | ' + (ConvertTo-MdCode (Get-SafeProperty $envInfo 'UserName')) + ' |')
    $md.Add('| שפת ממשק | ' + (ConvertTo-MdCode (Get-SafeProperty $envInfo 'UICulture')) + ' |')
    $md.Add('| רזולוציית מסך | ' + (ConvertTo-MdCode (Get-SafeProperty $envInfo 'ScreenResolution')) + ' |')
    $md.Add('| תיקיית המסמכים | ' + (ConvertTo-MdCode $DocumentsPath) + ' |')
    $md.Add('| המסמכים מסונכרנים בענן | ' + (Format-YesNo (Get-SafeProperty $envInfo 'DocumentsInOneDrive')) + ' |')
    $md.Add('')

    $md.Add('## 2. איתור התוכנה')
    $md.Add('')
    $md.Add('שם התוכנה שחיפשנו:')
    $md.Add('')
    $md.Add('```')
    $md.Add('EduVolt Designer')
    $md.Add('```')
    $md.Add('')
    $md.Add('- נמצאה התקנה: **' + (Format-YesNo $ev['Found']) + '**')
    $md.Add('- גרסה מזוהה: ' + (ConvertTo-MdCode $ev['Version']))
    $md.Add('')
    if (-not $ev['Found']) {
        $md.Add('התוכנה לא נמצאה. ייתכן שהיא לא מותקנת, שהיא מותקנת בשם אחר, או שהיא פועלת דרך הדפדפן.')
        $md.Add('אין להוריד או להתקין דבר אלא מהאתר הרשמי של היצרן.')
        $md.Add('')
    }
    $md.Add('### 2.1 רשומות התקנה במרשם')
    $md.Add('')
    if ($ev['UninstallEntries'].Count -eq 0) {
        $md.Add('לא נמצאו רשומות.')
    } else {
        $n = 0
        foreach ($u in $ev['UninstallEntries']) {
            $n++
            $md.Add('- רשומה ' + $n + ':')
            $md.Add('  - שם תצוגה: ' + (ConvertTo-MdCode $u['DisplayName']))
            $md.Add('  - גרסה: ' + (ConvertTo-MdCode $u['DisplayVersion']))
            $md.Add('  - מפרסם: ' + (ConvertTo-MdCode $u['Publisher']))
            $md.Add('  - תיקיית התקנה: ' + (ConvertTo-MdCode $u['InstallLocation']))
            $md.Add('  - קובץ סמל: ' + (ConvertTo-MdCode $u['DisplayIcon']))
            $md.Add('  - פקודת הסרה (לא הופעלה): ' + (ConvertTo-MdCode $u['UninstallString']))
            $md.Add('  - מפתח במרשם: ' + (ConvertTo-MdCode $u['RegistryKey']))
        }
    }
    $md.Add('')
    if ($ev['StorePackages'].Count -gt 0) {
        $md.Add('חבילות שהותקנו מחנות האפליקציות:')
        $md.Add('')
        foreach ($pkg in $ev['StorePackages']) {
            $md.Add('- ' + (ConvertTo-MdCode $pkg['Name']) + ' ' + (ConvertTo-MdCode $pkg['Version']))
        }
        $md.Add('')
    }
    $md.Add('### 2.2 קיצורי דרך')
    $md.Add('')
    if ($ev['Shortcuts'].Count -eq 0) {
        $md.Add('לא נמצאו קיצורי דרך בתפריט התחל או בשולחן העבודה.')
    } else {
        $n = 0
        foreach ($s in $ev['Shortcuts']) {
            $n++
            $md.Add('- קיצור דרך ' + $n + ':')
            $md.Add('  - קובץ הקיצור: ' + (ConvertTo-MdCode $s['Shortcut']))
            $md.Add('  - יעד: ' + (ConvertTo-MdCode $s['TargetPath']))
            $md.Add('  - פרמטרים: ' + (ConvertTo-MdCode $s['Arguments']))
            $md.Add('  - תיקיית עבודה: ' + (ConvertTo-MdCode $s['WorkingDirectory']))
            $md.Add('  - היעד קיים: ' + (Format-YesNo $s['TargetExists']))
            if ($s['Error'] -ne '') { $md.Add('  - שגיאה: ' + (ConvertTo-MdCode $s['Error'])) }
        }
    }
    $md.Add('')
    $md.Add('### 2.3 תיקיות ששמן מכיל את שם התוכנה')
    $md.Add('')
    if ($ev['Folders'].Count -eq 0) {
        $md.Add('לא נמצאו תיקיות כאלה.')
    } else {
        $md.Add('נרשמו נתיבים בלבד. תוכן התיקיות לא נפתח ולא נקרא.')
        $md.Add('')
        foreach ($f in $ev['Folders']) { $md.Add('- ' + (ConvertTo-MdCode $f)) }
    }
    $md.Add('')
    $md.Add('### 2.4 קבצי הפעלה ופרטי גרסה')
    $md.Add('')
    if ($ev['Executables'].Count -eq 0) {
        $md.Add('לא נמצאו קבצי הפעלה.')
    } else {
        $n = 0
        foreach ($x in $ev['Executables']) {
            $n++
            $md.Add('- קובץ ' + $n + ':')
            $md.Add('  - נתיב: ' + (ConvertTo-MdCode $x['Path']))
            $md.Add('  - שם מוצר: ' + (ConvertTo-MdCode $x['ProductName']))
            $md.Add('  - גרסת מוצר: ' + (ConvertTo-MdCode $x['ProductVersion']))
            $md.Add('  - גרסת קובץ: ' + (ConvertTo-MdCode $x['FileVersion']))
            $md.Add('  - חברה: ' + (ConvertTo-MdCode $x['CompanyName']))
            $md.Add('  - כנראה קובץ ההפעלה הראשי: ' + (Format-YesNo $x['LikelyMainExe']))
            $md.Add('  - מקור הזיהוי: ' + (ConvertTo-MdCode ($x['Sources'] -join '; ')))
        }
    }
    $md.Add('')
    $md.Add('### 2.5 האם התוכנה פועלת כרגע')
    $md.Add('')
    if ($ev['RunningProcesses'].Count -eq 0) {
        $md.Add('לא נמצא תהליך פעיל של התוכנה.')
    } else {
        foreach ($p in $ev['RunningProcesses']) {
            $md.Add('- ' + (ConvertTo-MdCode ($p['Name'] + ' (PID ' + $p['Id'] + ')')) + ' ' + (ConvertTo-MdCode $p['Path']))
        }
    }
    $md.Add('')
    $md.Add('### 2.6 מצב התחברות ורישיון')
    $md.Add('')
    $md.Add('אי אפשר לדעת מבחוץ אם המשתמש מחובר, ואם הרישיון חינמי או בתשלום. יש לבדוק זאת בתוך ממשק התוכנה.')
    $md.Add('')
    $md.Add('- מצב התחברות: ' + (ConvertTo-MdCode $script:UnknownState))
    $md.Add('- סוג רישיון: ' + (ConvertTo-MdCode $script:UnknownState))
    $md.Add('')
    $md.Add('### 2.7 הערה חשובה')
    $md.Add('')
    $md.Add('הסקריפט לא פתח, לא קרא ולא שינה קבצי הגדרות, ספריות רכיבים או פרויקטים של התוכנה. נרשמו נתיבים בלבד.')
    $md.Add('')

    $md.Add('## 3. קבצים קיימים שקשורים לפרויקט')
    $md.Add('')
    $md.Add('החיפוש כלל שני סוגים של פריטים:')
    $md.Add('')
    $md.Add('- קבצים ותיקיות ששמם מכיל את המחרוזת: ' + (ConvertTo-MdCode 'eduvolt'))
    $md.Add('- קבצים עם הסיומת: ' + (ConvertTo-MdCode '.evc'))
    $md.Add('')
    $md.Add('נכללו גם קבצים שנמצאים בתוך תיקייה כזו. הקבצים לא נפתחו: נרשמו רק נתיב, גודל ותאריך שינוי.')
    $md.Add('')
    $md.Add('- עומק חיפוש מרבי (רמה 1 היא התוכן הישיר של תיקיית הבסיס): ' + (ConvertTo-MdCode $script:ScanDepth))
    $md.Add('- מספר פריטים שנמצאו: ' + (ConvertTo-MdCode (Get-SafeProperty $ef 'TotalFound')))
    if ([bool](Get-SafeProperty $ef 'Capped')) {
        $md.Add('- **הרשימה נקטעה אחרי ' + $script:FoundCap + ' פריטים. ייתכן שיש עוד.**')
    }
    $md.Add('')
    $md.Add('תיקיות בסיס שנסרקו:')
    $md.Add('')
    $md.Add('| שם | קיימת | תיקיות שנסרקו | נתיב |')
    $md.Add('|---|---|---|---|')
    foreach ($r in $ef['Roots']) {
        $md.Add('| ' + $r['Name'] + ' | ' + (Format-YesNo $r['Exists']) + ' | ' + $r['DirectoriesScanned'] + ' | ' + (ConvertTo-MdCode $r['Path']) + ' |')
    }
    $md.Add('')
    $md.Add('תיקיות שהוחרגו מהחיפוש (תיקיית העבודה ותיקיית המקור):')
    $md.Add('')
    foreach ($x in $ef['ExcludedPaths']) { $md.Add('- ' + (ConvertTo-MdCode $x)) }
    $md.Add('')
    $md.Add('שמות תיקיות שדולגו בכל מקום:')
    $md.Add('')
    $md.Add('- ' + (ConvertTo-MdCode ($ef['ExcludedFolderNames'] -join ', ')))
    $md.Add('')
    if ($ef['Items'].Count -gt 0) {
        $md.Add('| # | סוג | גודל בבתים | שינוי אחרון | סיבה | נתיב |')
        $md.Add('|---|---|---|---|---|---|')
        $n = 0
        foreach ($it in $ef['Items']) {
            $n++
            $typeHe = 'קובץ'
            if ($it['Type'] -eq 'Folder') { $typeHe = 'תיקייה' }
            $md.Add('| ' + $n + ' | ' + $typeHe + ' | ' + (ConvertTo-MdCode $it['SizeBytes']) + ' | ' + (ConvertTo-MdCode $it['LastWriteTime']) + ' | ' + (ConvertTo-MdCode $it['Reason']) + ' | ' + (ConvertTo-MdCode $it['Path']) + ' |')
        }
    } else {
        $md.Add('לא נמצאו קבצים קיימים.')
    }
    $md.Add('')

    $md.Add('## 4. כלים לאוטומציה')
    $md.Add('')
    $md.Add('| כלי | נמצא | גרסה | נתיב | הערה |')
    $md.Add('|---|---|---|---|---|')
    foreach ($toolKey in $tools.Keys) {
        $t = $tools[$toolKey]
        $md.Add('| ' + (ConvertTo-MdCode $toolKey) + ' | ' + (Format-YesNo $t['Found']) + ' | ' + (ConvertTo-MdCode $t['Version']) + ' | ' + (ConvertTo-MdCode $t['Path']) + ' | ' + (ConvertTo-MdCode $t['Note']) + ' |')
    }
    $md.Add('')

    $md.Add('## 5. תיקיית העבודה')
    $md.Add('')
    $md.Add('נתיב התיקייה:')
    $md.Add('')
    $md.Add('```')
    $md.Add($WorkspacePath)
    $md.Add('```')
    $md.Add('')
    $md.Add('| תיקייה | מצב |')
    $md.Add('|---|---|')
    foreach ($fo in $ws['Folders']) {
        $stateHe = 'קיימת — לא שונתה'
        if ($fo['State'] -eq 'Created') { $stateHe = 'נוצרה עכשיו' }
        elseif ($fo['State'] -eq 'WhatIf') { $stateHe = 'תיווצר בהרצה אמיתית' }
        elseif ($fo['State'] -eq 'Error') { $stateHe = 'שגיאה' }
        $md.Add('| ' + (ConvertTo-MdCode $fo['Name']) + ' | ' + $stateHe + ' |')
    }
    $md.Add('')

    $md.Add('## 6. העתקת קבצי הפרויקט')
    $md.Add('')
    if ($cp['SkippedReason'] -ne '') {
        $md.Add('ההעתקה לא בוצעה. הסיבה:')
        $md.Add('')
        $md.Add('```')
        $md.Add($cp['SkippedReason'])
        $md.Add('```')
    } else {
        $md.Add('- הועתקו: ' + (ConvertTo-MdCode $cp['Copied'].Count))
        $md.Add('- זהים לקיים ולכן דולגו: ' + (ConvertTo-MdCode $cp['Identical'].Count))
        $md.Add('- דורשים מיזוג ידני: ' + (ConvertTo-MdCode $cp['NeedsMerge'].Count))
        $md.Add('- נכשלו: ' + (ConvertTo-MdCode $cp['Failed'].Count))
        if ($cp['WouldCopy'].Count -gt 0) { $md.Add('- יועתקו בהרצה אמיתית: ' + (ConvertTo-MdCode $cp['WouldCopy'].Count)) }
        $md.Add('- הוחרגו מההעתקה: ' + (ConvertTo-MdCode $cp['ExcludedRules']))
        $md.Add('')
        if ($cp['NeedsMerge'].Count -gt 0) {
            $md.Add('### 6.1 קבצים שדורשים מיזוג ידני')
            $md.Add('')
            $md.Add('הקובץ שכבר קיים בתיקיית העבודה שונה מהגרסה החדשה. הקובץ הקיים לא שונה.')
            $md.Add('הגרסה החדשה נשמרה בנפרד, בתיקייה הזאת:')
            $md.Add('')
            $md.Add('```')
            $md.Add($cp['IncomingFolder'])
            $md.Add('```')
            $md.Add('')
            foreach ($nm in $cp['NeedsMerge']) {
                $md.Add('- ' + (ConvertTo-MdCode $nm['Relative']))
                $md.Add('  - הקובץ הקיים: ' + (ConvertTo-MdCode $nm['Existing']))
                $md.Add('  - הגרסה החדשה: ' + (ConvertTo-MdCode $nm['Incoming']))
            }
            $md.Add('')
        }
        if ($cp['Failed'].Count -gt 0) {
            $md.Add('### 6.2 קבצים שההעתקה שלהם נכשלה')
            $md.Add('')
            foreach ($fl in $cp['Failed']) { $md.Add('- ' + (ConvertTo-MdCode $fl['Relative']) + ' ' + (ConvertTo-MdCode $fl['Error'])) }
            $md.Add('')
        }
        if ($cp['Copied'].Count -gt 0) {
            $md.Add('### 6.3 קבצים שהועתקו')
            $md.Add('')
            foreach ($c in $cp['Copied']) { $md.Add('- ' + (ConvertTo-MdCode $c)) }
            $md.Add('')
        }
    }

    $md.Add('## 7. גיבוי קבצים קיימים')
    $md.Add('')
    if (-not $bk['Requested']) {
        $md.Add('הגיבוי לא התבקש בהרצה הזאת. כדי לגבות, יש להריץ שוב עם הפרמטר:')
        $md.Add('')
        $md.Add('```')
        $md.Add('-BackupExistingEduVoltFiles')
        $md.Add('```')
    } else {
        $md.Add('הקבצים הועתקו בלבד. המקור לא הוזז ולא שונה. תיקיית הגיבוי:')
        $md.Add('')
        $md.Add('```')
        $md.Add($bk['Folder'])
        $md.Add('```')
        $md.Add('')
        $md.Add('- גובו ואומתו: ' + (ConvertTo-MdCode $bk['Verified']))
        $md.Add('- אי־התאמה בטביעת האצבע: ' + (ConvertTo-MdCode $bk['Mismatched']))
        $md.Add('- נכשלו: ' + (ConvertTo-MdCode $bk['FailedCount']))
        $md.Add('')
        foreach ($b in $bk['Files']) {
            $md.Add('- ' + (ConvertTo-MdCode $b['Source']))
            $md.Add('  - עותק: ' + (ConvertTo-MdCode $b['Copy']))
            $md.Add('  - מצב: ' + (ConvertTo-MdCode $b['State']))
            $md.Add('  - טביעת אצבע: ' + (ConvertTo-MdCode $b['SourceSha256']))
        }
    }
    $md.Add('')

    $md.Add('## 8. הפעלת התוכנה')
    $md.Add('')
    if (-not $ln['Requested']) {
        $md.Add('ההפעלה לא התבקשה. כדי להפעיל אוטומטית, יש להריץ עם הפרמטר:')
        $md.Add('')
        $md.Add('```')
        $md.Add('-LaunchEduVolt')
        $md.Add('```')
    } else {
        $md.Add('- הופעלה: ' + (Format-YesNo $ln['Launched']))
        $md.Add('- פירוט:')
        $md.Add('')
        $md.Add('```')
        $md.Add($ln['Message'])
        $md.Add('```')
    }
    $md.Add('')

    $md.Add('## 9. שגיאות ואזהרות')
    $md.Add('')
    if ($script:ErrorList.Count -eq 0) {
        $md.Add('לא נרשמו שגיאות.')
    } else {
        foreach ($er in $script:ErrorList) {
            $md.Add('- שלב ' + (ConvertTo-MdCode $er['Step']) + ': ' + (ConvertTo-MdCode $er['Message']))
        }
    }
    $md.Add('')

    $md.Add('## 10. הצעדים הבאים')
    $md.Add('')
    $md.Add('1. לפתוח את הקובץ הבא, ולהדביק את התוכן שלו בחלון של סשן מקומי של Claude Code:')
    $md.Add('')
    $md.Add('```')
    $md.Add((Join-Path (Join-Path $WorkspacePath 'tools') 'LOCAL_CLAUDE_CODE_PROMPT.md'))
    $md.Add('```')
    $md.Add('')
    $md.Add('2. לבדוק בתוך התוכנה את מצב ההתחברות ואת סוג הרישיון, ולעדכן את קובץ הסטטוס של הפרויקט.')
    if ($cp['NeedsMerge'].Count -gt 0) {
        $md.Add('3. למזג ידנית את הקבצים שמופיעים ברשימת המיזוג בסעיף 6.1.')
    }
    if (-not $ev['Found']) {
        $md.Add('4. התוכנה לא נמצאה: להתקין אותה רק מהאתר הרשמי, ואז להריץ את הסקריפט שוב.')
    }
    $md.Add('')
    $mdText = ($md -join "`r`n")

    $jsonText = ConvertTo-Json -InputObject $Report -Depth 6

    if ([System.IO.Directory]::Exists($ProjectDir)) {
        $mdPath = Save-NewTextFile -Directory $ProjectDir -BaseName 'ENVIRONMENT_REPORT_WINDOWS' -Extension '.md' -Content $mdText -WithBom $true
        $jsonPath = Save-NewTextFile -Directory $ProjectDir -BaseName 'environment_report' -Extension '.json' -Content $jsonText -WithBom $false
        if ($mdPath -ne '') { Add-LogEntry -Step 'I' -Message ('Report written: ' + $mdPath) }
        if ($jsonPath -ne '') { Add-LogEntry -Step 'I' -Message ('Report written: ' + $jsonPath) }
        $logPath = Join-Path $ProjectDir 'setup_log.txt'
        Add-LogEntry -Step 'end' -Message ('Errors recorded: ' + $script:ErrorList.Count)
        if (Test-CanWrite -Target $logPath -Action 'Append to setup log') {
            $logEnc = New-Object -TypeName System.Text.UTF8Encoding -ArgumentList $true
            [System.IO.File]::AppendAllText($logPath, (($script:LogLines -join "`r`n") + "`r`n"), $logEnc)
        } else {
            $logPath = ''
        }
    } else {
        Write-Status -Message ('    01_Project folder does not exist (WhatIf or creation failed); reports were not written: ' + $ProjectDir) -Level 'Warn'
    }
} catch {
    Add-ErrorEntry -Step 'I' -Message $_.Exception.Message
}

# ---------------------------------------------------------------------------
# Summary
# ---------------------------------------------------------------------------
Write-Host ''
Write-Status -Message '================ Summary ================' -Level 'Step'
if ($script:IsWhatIfRun) {
    Write-Status -Message 'WhatIf mode: no folders or files were created, copied or launched.' -Level 'Warn'
}
$evFoundText = 'No'
if ([bool](Get-SafeProperty $ev 'Found')) { $evFoundText = 'Yes' }
$evVersionText = ConvertTo-PlainString (Get-SafeProperty $ev 'Version')
if ($evVersionText -eq '') { $evVersionText = 'unknown' }
Write-Status -Message ('EduVolt Designer found      : ' + $evFoundText + ' (version: ' + $evVersionText + ')')
Write-Status -Message ('Login / licence state       : ' + $script:UnknownState)
$capNote = ''
if ([bool](Get-SafeProperty $ef 'Capped')) { $capNote = ' (capped, there may be more)' }
Write-Status -Message ('Existing EduVolt-related    : ' + (ConvertTo-PlainString (Get-SafeProperty $ef 'TotalFound')) + $capNote)
if ([string](Get-SafeProperty $cp 'SkippedReason') -ne '') {
    Write-Status -Message ('Deliverables copy           : skipped - ' + $cp['SkippedReason'])
} else {
    Write-Status -Message ('Deliverables copy           : copied ' + $cp['Copied'].Count + ', identical/skipped ' + $cp['Identical'].Count + ', needs manual merge ' + $cp['NeedsMerge'].Count + ', failed ' + $cp['Failed'].Count + ', would copy (WhatIf) ' + $cp['WouldCopy'].Count)
}
if ($BackupExistingEduVoltFiles) {
    Write-Status -Message ('Backup of existing files    : verified ' + $bk['Verified'] + ', mismatched ' + $bk['Mismatched'] + ', failed ' + $bk['FailedCount'])
}
if ($LaunchEduVolt) {
    Write-Status -Message ('Launch                      : ' + $ln['Message'])
}
Write-Status -Message ('Errors recorded             : ' + $script:ErrorList.Count) -Level $(if ($script:ErrorList.Count -gt 0) { 'Warn' } else { 'Info' })
if ($mdPath -ne '') {
    Write-Status -Message ('Report (Hebrew, Markdown)   : ' + $mdPath) -Level 'Ok'
    Write-Status -Message ('Report (JSON)               : ' + $jsonPath) -Level 'Ok'
    Write-Status -Message ('Log                         : ' + $logPath) -Level 'Ok'
} else {
    Write-Status -Message 'Report                      : not written in this run.' -Level 'Warn'
}
if ($cp['NeedsMerge'].Count -gt 0) {
    Write-Status -Message ('Some files need a manual merge. New versions are in: ' + $cp['IncomingFolder']) -Level 'Warn'
}
