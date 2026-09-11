# NER Logistics Intelligence

Demo-ready MVP for monitoring transport accessibility and essential supply movement across India's North Eastern Region.

## Stack

- React + TypeScript + Vite responsive dashboard
- FastAPI typed API with CORS and offline field-report synchronization
- Demo data is kept in memory for fast evaluation; the API boundary is ready for PostgreSQL/PostGIS

## Run locally

```powershell
npm install
npm run dev
```

In a second terminal:

```powershell
cd backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
uvicorn main:app --reload
```

Open `http://localhost:5173`. The dashboard uses a safe local fallback while the API is unavailable and automatically loads the API summary when it is running. API documentation is available at `http://localhost:8000/docs`.

## One-command phone demo

After installing `cloudflared` and completing the VAPID setup, run this from
the project root:

```powershell
.\start-phone-demo.ps1
```

The script starts FastAPI, both Cloudflare Quick Tunnels, and Vite, then prints
the HTTPS frontend URL to open on your phone. Stop the processes with:

```powershell
.\stop-phone-demo.ps1
```

## MVP behavior

- The map uses Leaflet with OpenStreetMap tiles. It displays backend vehicle and field-report features, supports browser geolocation, and includes Nominatim place search without requiring an API key.
- Network status, shipments, field reports, alert rules, and data sources are available from the command-centre navigation.
- Incident reports are submitted to `POST /api/field-reports` and remain in the backend's in-memory store until restart.
- CSV files can be uploaded from **Data sources**. The API accepts UTF-8 CSV files up to 10 MB at `POST /api/datasets/csv` and returns detected columns, row count, an eight-row preview, and numeric min/max/average values.
- CSV rows are plotted on the map when they include `latitude` and `longitude` columns. `lat` and `lon` are also accepted. Nominatim is a public service with usage limits; use a hosted geocoder or self-hosted instance for production traffic.
- CSV preprocessing maps common aliases into the standard fields `id`, `name`, `type`, `state`, `latitude`, `longitude`, `status`, `risk_score`, and `last_updated`. For example, `road_name`, `category`, `state_name`, `lat`, `lng`, `condition`, and `risk` are supported automatically.
- Dataset provenance, CRS validation, persistence, and government/open data connectors are the next integration boundary before operational deployment.
