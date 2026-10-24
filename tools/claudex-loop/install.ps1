# Installs the Claudex Loop plugin for Claude Code at user scope, and adds the
# activation rule to ~\.claude\CLAUDE.md so it applies in every project.
# Safe to re-run: the previous block is replaced and a backup is kept.
# Messages are in English on purpose: Windows PowerShell 5.1 misreads Hebrew in BOM-less scripts.
$ErrorActionPreference = 'Stop'

$ruleFile = Join-Path $PSScriptRoot 'claudex-rule.md'
$claudeDir = if ($env:CLAUDE_CONFIG_DIR) { $env:CLAUDE_CONFIG_DIR } else { Join-Path $env:USERPROFILE '.claude' }
$claudeMd = Join-Path $claudeDir 'CLAUDE.md'

if (-not (Get-Command claude -ErrorAction SilentlyContinue)) { throw 'claude CLI not found - install Claude Code first' }
if (-not (Get-Command python -ErrorAction SilentlyContinue) -and -not (Get-Command py -ErrorAction SilentlyContinue)) {
    Write-Warning 'Python not found - Claudex Loop needs Python 3.10+'
}

claude plugin marketplace add chaseai-yt/claudex-loop
if ($LASTEXITCODE -ne 0) { throw 'Adding the marketplace failed' }
claude plugin install claudex-loop@claudex-loop
if ($LASTEXITCODE -ne 0) { throw 'Installing the plugin failed' }

New-Item -ItemType Directory -Force $claudeDir | Out-Null
$utf8 = New-Object System.Text.UTF8Encoding($false)
$text = ''
if (Test-Path $claudeMd) {
    Copy-Item $claudeMd "$claudeMd.bak-claudex" -Force
    $text = [System.IO.File]::ReadAllText($claudeMd, $utf8)
}

$start = '<!-- claudex-loop:start -->'
$end = '<!-- claudex-loop:end -->'
$rule = [System.IO.File]::ReadAllText($ruleFile, $utf8).Trim()
$text = [regex]::Replace($text, [regex]::Escape($start) + '[\s\S]*?' + [regex]::Escape($end), '').TrimEnd()
$block = "$start`n$rule`n$end`n"
$content = if ($text) { "$text`n`n$block" } else { $block }
[System.IO.File]::WriteAllText($claudeMd, $content, $utf8)
Write-Host "Rule written to $claudeMd"

if (Get-Command codex -ErrorAction SilentlyContinue) {
    codex --version
    codex login status
    if ($LASTEXITCODE -ne 0) { Write-Warning 'Codex is installed but not logged in - run: codex login' }
} else {
    Write-Warning 'Codex CLI not found - run: npm install -g @openai/codex ; codex login'
}
