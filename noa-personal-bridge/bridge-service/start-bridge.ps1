# NOA Personal Bridge — one-command start for Windows (PowerShell 5.1+).
# Run from anywhere:
#   powershell -ExecutionPolicy Bypass -File "$HOME\ai-assistant\noa-personal-bridge\bridge-service\start-bridge.ps1"
# Add -Stub to run the free offline test engine instead of the real AI.
# The Anthropic key is asked for every run and kept only in this window's memory (never written to disk).
param(
    [switch]$Stub,
    [string]$OwnerName = "אורי",
    [int]$Port = 8787
)
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "== NOA Personal Bridge ==" -ForegroundColor Cyan

# 1. Python environment (first run only). pip is always run through python.exe because
#    Smart App Control may block pip.exe.
if (-not (Test-Path ".venv\Scripts\python.exe")) {
    Write-Host "Creating Python environment (first run only)..."
    py -m venv .venv
}
Write-Host "Checking packages..."
& .venv\Scripts\python.exe -m pip install --disable-pip-version-check -q -r requirements.txt

# 2. Engine + key
$env:BRIDGE_ENABLED = "true"
$env:BRIDGE_PORT = "$Port"
if ($Stub) {
    $env:BRIDGE_ENGINE = "stub"
    Write-Host "Engine: stub (offline test answers, no cost)" -ForegroundColor Yellow
} else {
    $env:BRIDGE_ENGINE = "anthropic"
    $env:BRIDGE_OWNER_DISPLAY_NAME = $OwnerName
    if (-not $env:BRIDGE_ANTHROPIC_API_KEY) {
        $secure = Read-Host "Paste your Anthropic API key (hidden)" -AsSecureString
        $bstr = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure)
        try { $env:BRIDGE_ANTHROPIC_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($bstr) }
        finally { [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($bstr) }
    }
    if (-not $env:BRIDGE_ANTHROPIC_API_KEY.StartsWith("sk-ant-")) {
        Write-Host "That does not look like an Anthropic key (should start with sk-ant-)." -ForegroundColor Red
        exit 1
    }
    Write-Host "Engine: anthropic (real AI, billed to your Anthropic account)" -ForegroundColor Green
}

# 3. HTTPS tunnel in its own window
$cloudflared = Join-Path $HOME "tools\cloudflared.exe"
if (-not (Test-Path $cloudflared)) {
    $cmd = Get-Command cloudflared -ErrorAction SilentlyContinue
    if ($cmd) { $cloudflared = $cmd.Source }
}
if (Test-Path $cloudflared) {
    Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '$cloudflared' tunnel --url http://127.0.0.1:$Port"
    Write-Host "Tunnel window opened. Copy the https://....trycloudflare.com address from it." -ForegroundColor Cyan
    Write-Host "If the address changed since last time, pair the phone again: open a new window and run:"
    Write-Host "  & `"$PSScriptRoot\.venv\Scripts\python.exe`" -m bridge_service.admin create-pairing-code" -ForegroundColor Gray
} else {
    Write-Host "cloudflared.exe not found in $HOME\tools - the phone will not reach this server." -ForegroundColor Red
}

# 4. Server (stays in this window; Ctrl+C to stop)
Write-Host "Starting server on http://127.0.0.1:$Port ... (Ctrl+C to stop)" -ForegroundColor Cyan
& .venv\Scripts\python.exe -m bridge_service.main
