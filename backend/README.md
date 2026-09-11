# NER Logistics API

Small FastAPI backend for the NER logistics MVP. It uses typed Pydantic models
and in-memory demo data, so no database setup is required (data resets on
restart). CORS is enabled for `http://localhost:3000` and `http://localhost:5173`.

## Run locally

```bash
cd backend
python -m venv .venv
.venv\Scripts\activate       # Windows
pip install -r requirements.txt
uvicorn main:app --reload
```

Open `http://localhost:8000/docs` for the interactive API documentation.
The API is rooted at `/api`; health is also available at `/health`.

## Preprocess a dataset

The standalone importer converts common dataset columns into the schema used
by the map and CSV upload flow. It preserves every row and can limit output to
the eight North-Eastern states:

```powershell
python backend/preprocess_csv.py "India Cities LatLng.csv" `
	--output data/ner_cities.csv --ner-only
```

The normalized output columns are `id`, `name`, `type`, `state`, `latitude`,
`longitude`, `status`, and `risk_score`. The script recognizes
aliases such as `city`, `lat`, `lng`, `admin_name`, `road_name`, `condition`,
and `States/UTs`.

To combine the city coordinates/population file with daily climate data and
create a screening risk score:

```powershell
python backend/combine_climate_csv.py `
	"India Cities LatLng.csv" `
	"Indian_Climate_Dataset_2024_2025.csv" `
	--output data/ner_climate_risk.csv --ner-only
```

The output includes `risk_score`, `risk_level`, `score_basis`, `hazard_score`,
`exposure_score`, weather extremes, population, and observation count. Risk
bands are Low (0-34), Medium (35-59), High (60-79), and Critical (80-100).
Rows without matching climate observations use `exposure_score` as an
operational prioritization proxy for `risk_score`; this is labeled in the
documentation and should not be interpreted as a measured weather hazard.
The supplied `Indian_Climate_Dataset_2024_2025.csv` currently covers
Ahmedabad, Bengaluru, Bhopal, Chennai, Delhi, Hyderabad, Jaipur, Kolkata,
Lucknow, and Mumbai, so it does not provide NER weather observations. Running
the command with `--ner-only` therefore produces NER locations with
exposure-proxy scores until an NER climate dataset is supplied. Without
`--ner-only`, the overlapping cities receive climate-hazard-adjusted scores.

Endpoints include dashboard summary, GeoJSON map features, route suggestions,
vehicles, shipments, alerts, field reports, and `POST /api/sync/offline` for
batching reports created while offline.

## NER-DRR map layers

The frontend uses public NER-DRR GeoServer layers for the NER state boundary
and an optional lightning observation overlay. The project does not scrape the
NER-DRR page; it consumes the map services directly:

- `https://nerdrr.gov.in/geoserver/wms?` with `workgroup:NER_STATES`
- `https://geoserver.nesdr.gov.in/geoserver/smartAxom/wms?` with `smartAxom:lightning_data_iitm`

These services are third-party public infrastructure and may change or have
availability limits. The dashboard retains its OpenStreetMap base layer and
local CSV/API markers if an NER-DRR overlay is unavailable.

## Emergency alert simulation

The **Emergency alerts** workspace provides a training simulation only. The
endpoint `POST /api/emergency-alerts/simulate` models area-wide BCC cell
broadcast when towers are available. When `towers_available` is zero, it
automatically selects `Satellite L-band`, `Satellite S-band`, and `AM/FM
broadcast` fallback channels. It does not control telecom, satellite, radio,
or government infrastructure and does not transmit real alerts.

## Phone web push

Web Push requires HTTPS on a phone (localhost is the browser exception). Set
VAPID keys in the backend environment before starting FastAPI:

```powershell
pip install -r requirements.txt
vapid --gen --key private_key.pem --pubkey public_key.txt
$env:VAPID_PRIVATE_KEY_PATH = (Resolve-Path .\private_key.pem).Path
$env:VAPID_PUBLIC_KEY = (Get-Content .\public_key.txt -Raw).Trim()
$env:VAPID_SUBJECT = "mailto:admin@example.com"
uvicorn main:app --reload --host 0.0.0.0 --port 8000
```

Open the HTTPS frontend on the phone, select **Emergency alerts**, press
**Enable push**, grant notification permission, then run a simulation. The
backend sends the simulated alert to registered browser subscriptions. Push
subscriptions are stored in memory and cleared when the backend restarts.

For a phone test, expose both services through HTTPS. If the frontend and API
use different public URLs, start Vite with the backend URL configured before
building:

```powershell
$env:VITE_API_BASE = "https://your-api-tunnel.example"
npm run dev -- --host 0.0.0.0
```

Android Chrome supports Web Push on an HTTPS site. On iPhone, use Safari and
add the site to the Home Screen first; iOS Web Push is restricted to installed
Home Screen web apps.
