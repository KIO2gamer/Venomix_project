# ==============================================================================
# NER Logistics Intelligence System - Unified Master Execution Script
# ==============================================================================

$ErrorActionPreference = "Stop"

Write-Host "=== 1. Setting up Python Virtual Environment & Dependencies ===" -ForegroundColor Cyan
if (-not (Test-Path ".venv")) {
    python -m venv .venv
}
& .\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
pip install -r requirements.txt

Write-Host "=== 2. Preprocessing Datasets & Generating Risk Scores ===" -ForegroundColor Cyan
python preprocess_csv.py "India Cities LatLng.csv" -o ner_cities.csv --ner-only
python combine_climate_csv.py "India Cities LatLng.csv" "Indian_Climate_Dataset_2024_2025.csv" -o ner_climate_risk.csv --ner-only

Write-Host "=== 3. Installing Frontend Dependencies ===" -ForegroundColor Cyan
npm install

Write-Host "=== 4. Launching Backend & Frontend Services ===" -ForegroundColor Cyan
Write-Host "FastAPI API: http://localhost:8000/docs" -ForegroundColor Green
Write-Host "React Dashboard: http://localhost:5173" -ForegroundColor Green

# Launch Backend and Frontend in separate jobs/processes
$backend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "& '.\.venv\Scripts\Activate.ps1'; uvicorn main:app --reload --host 0.0.0.0 --port 8000" -PassThru
$frontend = Start-Process powershell -ArgumentList "-NoExit", "-Command", "npm run dev -- --host 0.0.0.0" -PassThru

Write-Host "Both services are running! Close the opened terminal windows to stop them." -ForegroundColor Yellow