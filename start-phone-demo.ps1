$ErrorActionPreference = "Stop"
$projectRoot = $PSScriptRoot
$backendDir = Join-Path $projectRoot "backend"
$python = Join-Path $backendDir ".venv\Scripts\python.exe"
$vapid = Join-Path $backendDir ".venv\Scripts\vapid.exe"
$logDir = Join-Path $projectRoot ".phone-demo-logs"

if (-not (Test-Path $python)) { throw "Backend virtual environment not found. Run: cd backend; python -m venv .venv; pip install -r requirements.txt" }
if (-not (Get-Command .\cloudflared -ErrorAction SilentlyContinue)) { throw "cloudflared is not installed or is not on PATH." }

New-Item -ItemType Directory -Force -Path $logDir | Out-Null
$privateKey = Join-Path $backendDir "private_key.pem"
$publicKey = Join-Path $backendDir "public_key.pem"
if (-not (Test-Path $privateKey) -or -not (Test-Path $publicKey)) {
    Push-Location $backendDir
    & $vapid --gen
    Pop-Location
}

$publicValue = (& $vapid --applicationServerKey --private-key $privateKey).Trim()
$subject = "mailto:admin@example.com"

$backendEnv = "`$env:VAPID_PRIVATE_KEY_PATH = '$($privateKey.Replace("'", "''"))'; `$env:VAPID_PUBLIC_KEY = '$($publicValue.Replace("'", "''"))'; `$env:VAPID_SUBJECT = '$subject'; Set-Location '$backendDir'; & '$python' -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload"
$backendProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", $backendEnv -PassThru

Start-Sleep -Seconds 2
$backendTunnelLog = Join-Path $logDir "backend-tunnel.log"
$backendTunnelErrorLog = Join-Path $logDir "backend-tunnel-error.log"
$backendTunnel = Start-Process cloudflared -ArgumentList "tunnel", "--url", "http://127.0.0.1:8000" -RedirectStandardOutput $backendTunnelLog -RedirectStandardError $backendTunnelErrorLog -PassThru

$backendUrl = $null
for ($attempt = 0; $attempt -lt 30 -and -not $backendUrl; $attempt++) {
    Start-Sleep -Seconds 1
    $backendUrl = Get-Content @($backendTunnelLog, $backendTunnelErrorLog) -ErrorAction SilentlyContinue | Select-String -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches | ForEach-Object { $_.Matches.Value } | Select-Object -First 1
}
if (-not $backendUrl) { throw "Backend tunnel URL was not found. Check $backendTunnelLog" }

$frontendEnv = "`$env:VITE_API_BASE = '$backendUrl'; Set-Location '$projectRoot'; npm run dev -- --host 0.0.0.0"
$frontendProcess = Start-Process powershell -ArgumentList "-NoExit", "-Command", $frontendEnv -PassThru

Start-Sleep -Seconds 3
$frontendTunnelLog = Join-Path $logDir "frontend-tunnel.log"
$frontendTunnelErrorLog = Join-Path $logDir "frontend-tunnel-error.log"
$frontendTunnel = Start-Process cloudflared -ArgumentList "tunnel", "--url", "http://127.0.0.1:5173" -RedirectStandardOutput $frontendTunnelLog -RedirectStandardError $frontendTunnelErrorLog -PassThru

$frontendUrl = $null
for ($attempt = 0; $attempt -lt 30 -and -not $frontendUrl; $attempt++) {
    Start-Sleep -Seconds 1
    $frontendUrl = Get-Content @($frontendTunnelLog, $frontendTunnelErrorLog) -ErrorAction SilentlyContinue | Select-String -Pattern "https://[a-z0-9-]+\.trycloudflare\.com" -AllMatches | ForEach-Object { $_.Matches.Value } | Select-Object -First 1
}
if (-not $frontendUrl) { throw "Frontend tunnel URL was not found. Check $frontendTunnelLog" }

@"
Phone demo is running.

Frontend (open this on your phone): $frontendUrl
Backend API:                    $backendUrl
Backend push key check:         $backendUrl/api/push/public-key

Emergency alerts -> Enable push -> allow notifications -> run simulation.
Keep the opened PowerShell windows running.
To stop everything later, run: .\stop-phone-demo.ps1
"@ | Write-Host -ForegroundColor Green
