$ErrorActionPreference = "SilentlyContinue"
Get-CimInstance Win32_Process | Where-Object {
    $_.CommandLine -match "cloudflared tunnel --url http://127\.0\.0\.1:(8000|5173)" -or
    $_.CommandLine -match "uvicorn main:app" -or
    $_.CommandLine -match "npm run dev -- --host 0\.0\.0\.0"
} | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Write-Host "Phone demo processes stopped." -ForegroundColor Yellow
