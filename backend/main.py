"""NER Logistics MVP backend.

The service deliberately uses in-memory stores so it can be started locally
without provisioning a database. Data is reset whenever the process restarts.
"""

import io
import json
import math
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Annotated, Any, Literal
from uuid import uuid4

from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat
from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field
from py_vapid import Vapid
from py_vapid.utils import b64urlencode
from pywebpush import WebPushException, webpush

from csv_processing import normalize_csv_rows, parse_csv, valid_coordinates


def now() -> datetime:
    return datetime.now(timezone.utc)


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = "ner-logistics-api"
    timestamp: datetime


class Vehicle(BaseModel):
    id: str
    registration: str
    type: str
    status: Literal["available", "in_transit", "maintenance", "offline"]
    driver: str
    location: tuple[float, float] = Field(description="latitude, longitude")
    capacity_kg: float
    current_load_kg: float
    last_updated: datetime


class Shipment(BaseModel):
    id: str
    reference: str
    origin: str
    destination: str
    status: Literal["planned", "in_transit", "delivered", "delayed"]
    priority: Literal["low", "normal", "high", "critical"]
    cargo: str
    weight_kg: float
    vehicle_id: str | None = None
    eta: datetime | None = None


class Alert(BaseModel):
    id: str
    severity: Literal["info", "warning", "critical"]
    title: str
    message: str
    area: str
    created_at: datetime
    acknowledged: bool = False


class FieldReportCreate(BaseModel):
    reporter: str = Field(min_length=1, max_length=120)
    category: Literal["road", "vehicle", "delivery", "safety", "other"]
    description: str = Field(min_length=1, max_length=2000)
    location: tuple[
        Annotated[float, Field(ge=-90, le=90, allow_inf_nan=False)],
        Annotated[float, Field(ge=-180, le=180, allow_inf_nan=False)],
    ] | None = None
    occurred_at: datetime | None = None
    client_id: str | None = Field(default=None, min_length=1, max_length=120)


class FieldReport(FieldReportCreate):
    id: str
    status: Literal["new", "reviewed", "resolved"] = "new"
    created_at: datetime
    synced_at: datetime | None = None


class SyncItem(BaseModel):
    client_id: str = Field(min_length=1, max_length=120)
    report: FieldReportCreate


class SyncRequest(BaseModel):
    items: list[SyncItem] = Field(default_factory=list, max_length=100)


class SyncResponse(BaseModel):
    accepted: int
    reports: list[FieldReport]
    errors: list[str] = Field(default_factory=list)
    synced_at: datetime


class DashboardSummary(BaseModel):
    # These camel-case fields mirror the approved frontend dashboard contract.
    accessible: int
    monitored: int
    highRisk: int
    activeShipments: int
    alerts: list["DashboardAlert"]
    active_vehicles: int
    available_vehicles: int
    shipments_in_transit: int
    delayed_shipments: int
    open_alerts: int
    reports_today: int
    total_cargo_kg: float


class DashboardAlert(BaseModel):
    id: str
    severity: Literal["High", "Medium", "Low"]
    title: str
    location: str
    time: datetime


class RouteSuggestion(BaseModel):
    id: str
    name: str
    origin: str
    destination: str
    distance_km: float
    duration_minutes: int
    risk: Literal["low", "medium", "high"]
    reason: str
    waypoints: list[tuple[float, float]]


class FeatureCollection(BaseModel):
    type: Literal["FeatureCollection"] = "FeatureCollection"
    features: list[dict[str, Any]]


class CsvImportResponse(BaseModel):
    filename: str
    columns: list[str]
    row_count: int
    preview: list[dict[str, str]]
    normalized_preview: list[dict[str, str]]
    map_points: list[dict[str, str]]
    coordinate_count: int
    numeric_summary: dict[str, dict[str, float]]


class EmergencyAlertSimulationRequest(BaseModel):
    area: str = Field(min_length=2, max_length=120)
    message: str = Field(min_length=5, max_length=500)
    severity: Literal["warning", "high", "critical"] = "high"
    towers_available: int = Field(default=12, ge=0, le=10000)
    target_devices: int = Field(default=25000, ge=1, le=100000000)


class EmergencyAlertSimulationResponse(BaseModel):
    simulation_id: str
    area: str
    severity: str
    delivery_mode: Literal["bcc", "satellite_and_broadcast_fallback"]
    channels: list[str]
    towers_available: int
    target_devices: int
    estimated_reached_devices: int
    estimated_unreachable_devices: int
    requires_sim_or_data: bool = False
    simulated: bool = True
    message: str
    explanation: str
    push_sent: int
    push_failed: int
    push_error: str | None = None
    # Offline fallback: SMS is attempted for every device whose Web Push address
    # is no longer reachable.
    sms_attempted: int = 0
    sms_sent: int = 0
    sms_failed: int = 0
    sms_error: str | None = None
    created_at: datetime
class PushSubscription(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2000)
    keys: dict[str, str]
    # Optional E.164 phone number for the user who owns this device. When the
    # device goes offline (push becomes undeliverable) the backend falls back to
    # an SMS on this number.
    phone_number: str | None = Field(default=None, max_length=20)

class PushSubscriptionResponse(BaseModel):
    subscribed: bool = True
    subscription_count: int
    sms_fallback: bool = False
class PhoneRegistration(BaseModel):
    endpoint: str = Field(min_length=1, max_length=2000)
    phone_number: str = Field(min_length=6, max_length=20)


vehicles: dict[str, Vehicle] = {
    "veh-001": Vehicle(
        id="veh-001", registration="NER-2041", type="Refrigerated truck",
        status="in_transit", driver="Tashi Dorjee", location=(26.1445, 91.7362),
        capacity_kg=12000, current_load_kg=8500, last_updated=now(),
    ),
    "veh-002": Vehicle(
        id="veh-002", registration="NER-1178", type="Box truck",
        status="available", driver="Ritu Sharma", location=(27.0844, 93.6053),
        capacity_kg=9000, current_load_kg=0, last_updated=now(),
    ),
    "veh-003": Vehicle(
        id="veh-003", registration="NER-3088", type="Motorbike",
        status="maintenance", driver="Lalhmingliani", location=(23.7271, 92.7176),
        capacity_kg=250, current_load_kg=0, last_updated=now(),
    ),
}

shipments: dict[str, Shipment] = {
    "shp-001": Shipment(
        id="shp-001", reference="NER-GUW-ITA-2401", origin="Guwahati, Assam",
        destination="Itanagar, Arunachal Pradesh", status="in_transit", priority="high",
        cargo="Medical supplies", weight_kg=8500, vehicle_id="veh-001",
        eta=datetime(2026, 9, 12, 14, tzinfo=timezone.utc),
    ),
    "shp-002": Shipment(
        id="shp-002", reference="NER-SHL-GNG-2402", origin="Shillong, Meghalaya",
        destination="Gangtok, Sikkim", status="delayed", priority="critical",
        cargo="Cold-chain vaccines", weight_kg=2100, vehicle_id=None,
    ),
    "shp-003": Shipment(
        id="shp-003", reference="NER-AGT-KOH-2403", origin="Agartala, Tripura",
        destination="Kohima, Nagaland", status="planned", priority="normal",
        cargo="Food relief", weight_kg=4600, vehicle_id="veh-002",
    ),
}

alerts: dict[str, Alert] = {
    "alt-001": Alert(
        id="alt-001", severity="critical", title="Shipment delayed",
        message="Cold-chain shipment NER-SHL-GNG-2402 has exceeded its delivery window.",
        area="Shillong-Gangtok corridor", created_at=now(),
    ),
    "alt-002": Alert(
        id="alt-002", severity="warning", title="Road condition reported",
        message="Landslide risk reported near the Bomdila checkpoint.",
        area="West Kameng, Arunachal Pradesh", created_at=now(),
    ),
    "alt-003": Alert(
        id="alt-003", severity="info", title="Delivery checkpoint reached",
        message="Relief convoy checked in at Aizawl.",
        area="Aizawl, Mizoram", created_at=now(),
    ),
    "alt-004": Alert(
        id="alt-004", severity="info", title="Field team online",
        message="Field team has checked in from the Imphal distribution hub.",
        area="Imphal, Manipur", created_at=now(),
    ),
}
field_reports: dict[str, FieldReport] = {}
push_subscriptions: dict[str, PushSubscription] = {}
# Remembers the phone number of devices that were saved online but can no longer
# be reached over Web Push, so alerts can still be texted to the user offline.
_offline_phone_numbers: dict[str, str] = {}


def mark_device_offline(endpoint: str) -> None:
    """Retire a subscription and remember the phone number to text as a fallback."""
    subscription = push_subscriptions.pop(endpoint, None)
    phone_number = normalize_phone_number(subscription.phone_number if subscription else None)
    if phone_number:
        _offline_phone_numbers[endpoint] = phone_number


app = FastAPI(title="NER Logistics API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_origin_regex=r"https?://(localhost|127\.0\.0\.1|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+|[a-z0-9-]+\.trycloudflare\.com)(:\d+)?$",
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", response_model=HealthResponse, tags=["health"])
@app.get("/api/health", response_model=HealthResponse, include_in_schema=False)
def health() -> HealthResponse:
    return HealthResponse(timestamp=now())


@app.get("/api/dashboard/summary", response_model=DashboardSummary, tags=["dashboard"])
def dashboard_summary() -> DashboardSummary:
    today = now().date()
    dashboard_alerts = [
        DashboardAlert(
            id=alert.id,
            severity={"critical": "High", "warning": "Medium", "info": "Low"}[alert.severity],
            title=alert.title,
            location=alert.area,
            time=alert.created_at,
        )
        for alert in alerts.values()
        if not alert.acknowledged
    ]
    return DashboardSummary(
        # Demo network metrics represent the seeded district/road coverage,
        # while the detailed vehicle and shipment counts remain data-derived.
        accessible=68,
        monitored=127,
        highRisk=14,
        activeShipments=sum(s.status in ("in_transit", "delayed") for s in shipments.values()),
        alerts=dashboard_alerts,
        active_vehicles=sum(v.status == "in_transit" for v in vehicles.values()),
        available_vehicles=sum(v.status == "available" for v in vehicles.values()),
        shipments_in_transit=sum(s.status == "in_transit" for s in shipments.values()),
        delayed_shipments=sum(s.status == "delayed" for s in shipments.values()),
        open_alerts=sum(not a.acknowledged for a in alerts.values()),
        reports_today=sum(r.created_at.date() == today for r in field_reports.values()),
        total_cargo_kg=sum(s.weight_kg for s in shipments.values()),
    )


_cached_vapid: Vapid | None = None
_cached_public_key: str | None = None


def get_vapid() -> tuple[Vapid | None, str | None]:
    """Resolve or generate VAPID keys, returning (vapid_instance, public_key_base64url)."""
    global _cached_vapid, _cached_public_key
    if _cached_vapid is not None and _cached_public_key is not None:
        return _cached_vapid, _cached_public_key

    backend_dir = Path(__file__).resolve().parent
    project_root = backend_dir.parent
    key_path_env = os.getenv("VAPID_PRIVATE_KEY_PATH", "").strip()

    candidate_paths = [
        key_path_env,
        str(backend_dir / "private_key.pem"),
        str(project_root / "private_key.pem"),
        "private_key.pem",
    ]

    v: Vapid | None = None
    for p in candidate_paths:
        if p and os.path.isfile(p):
            try:
                v = Vapid.from_file(p)
                break
            except Exception:
                continue

    if v is None:
        raw_key = os.getenv("VAPID_PRIVATE_KEY", "").strip()
        if raw_key:
            try:
                if "BEGIN PRIVATE KEY" in raw_key or "BEGIN EC PRIVATE KEY" in raw_key:
                    v = Vapid.from_pem(raw_key.encode("utf-8"))
                else:
                    v = Vapid.from_string(raw_key)
            except Exception:
                pass

    # Automatically generate keys if none exist so push notifications work immediately
    if v is None:
        try:
            v = Vapid()
            v.generate_keys()
            priv_path = str(backend_dir / "private_key.pem")
            pub_path = str(backend_dir / "public_key.pem")
            v.save_key(priv_path)
            v.save_public_key(pub_path)
        except Exception:
            pass

    if v is None:
        return None, None

    # Extract clean raw uncompressed P-256 public key (65 bytes) in URL-safe base64
    try:
        raw_pub = v.public_key.public_bytes(Encoding.X962, PublicFormat.UncompressedPoint)
        pub_key = b64urlencode(raw_pub)
    except Exception:
        pub_key = None

    env_pub = os.getenv("VAPID_PUBLIC_KEY", "").strip()
    if env_pub:
        if "=" in env_pub and "Application Server Key" in env_pub:
            env_pub = env_pub.split("=", 1)[1].strip()
        if env_pub and not env_pub.startswith("-----BEGIN"):
            pub_key = env_pub

    _cached_vapid = v
    _cached_public_key = pub_key
    return _cached_vapid, _cached_public_key


class SmsDeliveryResult(BaseModel):
    attempted: int = 0
    sent: int = 0
    failed: int = 0
    error: str | None = None

def normalize_phone_number(raw: str | None) -> str | None:
    """Normalize a user-supplied phone number to E.164 (e.g. +919876543210)."""
    if not raw:
        return None
    cleaned = "".join(ch for ch in raw if ch.isdigit() or ch == "+")
    if cleaned.startswith("00"):
        cleaned = f"+{cleaned[2:]}"
    digits = cleaned.lstrip("+")
    if not digits.isdigit() or not 6 <= len(digits) <= 15:
        return None
    return f"+{digits}"


def send_sms(phone_number: str, message: str) -> tuple[bool, str | None]:
    """Send a single SMS through the configured provider.

    Uses Twilio's REST API when credentials are present. Without credentials the
    message is logged only so the offline fallback stays observable in local and
    training runs instead of silently failing.
    """
    account_sid = os.getenv("TWILIO_ACCOUNT_SID", "").strip()
    auth_token = os.getenv("TWILIO_AUTH_TOKEN", "").strip()
    from_number = os.getenv("TWILIO_FROM_NUMBER", "").strip()

    if not (account_sid and auth_token and from_number):
        print(f"[sms-fallback] to={phone_number} body={message}")
        return True, None
    import urllib.error
    import urllib.parse
    import urllib.request
    from base64 import b64encode
    url = f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json"
    body = urllib.parse.urlencode({"To": phone_number, "From": from_number, "Body": message}).encode("utf-8")
    credentials = b64encode(f"{account_sid}:{auth_token}".encode("utf-8")).decode("ascii")
    request = urllib.request.Request(
        url,
        data=body,
        headers={
            "Authorization": f"Basic {credentials}",
            "Content-Type": "application/x-www-form-urlencoded",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            if 200 <= response.status < 300:
                return True, None
            return False, f"SMS provider returned HTTP {response.status}"
    except urllib.error.HTTPError as exc:
        return False, f"SMS provider rejected the message (HTTP {exc.code})"
    except Exception as exc:
        return False, f"{type(exc).__name__}: {exc}"


def send_offline_sms_fallback(area: str, severity: str, message: str) -> SmsDeliveryResult:
    """Text every registered user whose device is known to be offline.

    A device is considered offline once its push subscription is gone or the
    push was rejected because the endpoint is no longer reachable, so the only
    channel left is the phone number saved alongside the subscription.
    """
    result = SmsDeliveryResult()
    body = f"[{severity.upper()}] NER emergency alert - {area}: {message}"

    for endpoint, phone_number in list(_offline_phone_numbers.items()):
        if endpoint in push_subscriptions:
            continue
        result.attempted += 1
        ok, error = send_sms(phone_number, body)
        if ok:
            result.sent += 1
            _offline_phone_numbers.pop(endpoint, None)
        else:
            result.failed += 1
            result.error = error
    return result

def send_push_alert(area: str, severity: str, message: str) -> tuple[int, int, str | None, SmsDeliveryResult]:
    vapid_instance, _ = get_vapid()
    payload = json.dumps({"title": f"{severity.title()} emergency alert", "body": message, "area": area})

    if not vapid_instance:
        sms = send_offline_sms_fallback(area, severity, message)
        return 0, len(push_subscriptions), "VAPID key is not configured and could not be loaded", sms
    subject = os.getenv("VAPID_SUBJECT", "mailto:admin@example.com")
    sent = 0
    failed = 0
    last_error: str | None = None
    for endpoint, subscription in list(push_subscriptions.items()):
        try:
            webpush(
                subscription_info=subscription.model_dump(exclude_none=True),
                data=payload,
                vapid_private_key=vapid_instance,
                vapid_claims={"sub": subject},
                ttl=120,
            )
            sent += 1
        except WebPushException as exc:
            failed += 1
            response = getattr(exc, "response", None)
            status = getattr(response, "status_code", "unknown")
            last_error = f"Web Push rejected subscription (HTTP {status})"
            # 404 (Not Found) or 410 (Gone) indicate the client unregistered or token expired
            if status in (404, 410):
                mark_device_offline(endpoint)
        except Exception as exc:
            failed += 1
            last_error = f"{type(exc).__name__}: {exc}"
            if "invalid" in str(exc).lower() or "expired" in str(exc).lower():
                mark_device_offline(endpoint)

    # Some devices could not be reached over Web Push: they are offline, so the
    # notification is re-sent to the user by text message.
    sms = send_offline_sms_fallback(area, severity, message) if failed else SmsDeliveryResult()

    return sent, failed, last_error, sms


@app.post("/api/emergency-alerts/simulate", response_model=EmergencyAlertSimulationResponse, tags=["emergency alerts"])
def simulate_emergency_alert(payload: EmergencyAlertSimulationRequest) -> EmergencyAlertSimulationResponse:
    """Simulate government alert delivery; this does not access telecom hardware."""
    towers = payload.towers_available
    reached = payload.target_devices
    push_sent, push_failed, push_error, sms = send_push_alert(payload.area, payload.severity, payload.message)

    if towers > 0:
        return EmergencyAlertSimulationResponse(
            simulation_id=f"sim-{uuid4().hex[:10]}", area=payload.area,
            severity=payload.severity, delivery_mode="bcc",
            channels=["Cell Broadcast / BCC"], towers_available=towers,
            target_devices=payload.target_devices, estimated_reached_devices=reached,
            estimated_unreachable_devices=0, message=payload.message,
            explanation="Simulation: BCC delivers the same area-targeted message through available cell towers without per-device routing.",
            push_sent=push_sent, push_failed=push_failed,
            push_error=push_error,
            sms_attempted=sms.attempted, sms_sent=sms.sent,
            sms_failed=sms.failed, sms_error=sms.error,
            created_at=now(),
        )

    return EmergencyAlertSimulationResponse(
        simulation_id=f"sim-{uuid4().hex[:10]}", area=payload.area,
        severity=payload.severity, delivery_mode="satellite_and_broadcast_fallback",
        channels=["Satellite L-band", "Satellite S-band", "AM/FM broadcast"],
        towers_available=0, target_devices=payload.target_devices,
        estimated_reached_devices=reached, estimated_unreachable_devices=0,
        message=payload.message,
        explanation="Simulation: all towers are down, so the routine switches to satellite and AM/FM broadcast coverage. No real transmission is performed.",
        push_sent=push_sent, push_failed=push_failed,
        push_error=push_error,
        sms_attempted=sms.attempted, sms_sent=sms.sent,
        sms_failed=sms.failed, sms_error=sms.error,
        created_at=now(),
    )


@app.get("/api/push/public-key", tags=["push notifications"])
def push_public_key() -> dict[str, str]:
    _, public_key = get_vapid()
    if not public_key:
        raise HTTPException(status_code=503, detail="VAPID key is not available")
    return {"public_key": public_key}


@app.post("/api/push/subscribe", response_model=PushSubscriptionResponse, tags=["push notifications"])
def push_subscribe(subscription: PushSubscription) -> PushSubscriptionResponse:
    phone_number = normalize_phone_number(subscription.phone_number)
    subscription.phone_number = phone_number
    push_subscriptions[subscription.endpoint] = subscription
    # A device that reconnects is no longer offline; keep its number on file for
    # the next time it drops out.
    _offline_phone_numbers.pop(subscription.endpoint, None)
    return PushSubscriptionResponse(
        subscription_count=len(push_subscriptions),
        sms_fallback=phone_number is not None,
    )

@app.post("/api/push/phone", response_model=PushSubscriptionResponse, tags=["push notifications"])
def push_register_phone(registration: PhoneRegistration) -> PushSubscriptionResponse:
    """Attach a phone number to a device that was already saved online."""
    phone_number = normalize_phone_number(registration.phone_number)
    if not phone_number:
        raise HTTPException(status_code=422, detail="Enter a valid phone number in international format")
    subscription = push_subscriptions.get(registration.endpoint)
    if subscription is None:
        raise HTTPException(status_code=404, detail="Device is not registered; subscribe to push first")
    subscription.phone_number = phone_number
    push_subscriptions[registration.endpoint] = subscription
    return PushSubscriptionResponse(
        subscription_count=len(push_subscriptions),
        sms_fallback=True,
    )


@app.post("/api/push/test", tags=["push notifications"])
def test_push_notification() -> dict[str, Any]:
    sent, failed, error, sms = send_push_alert(
        area="Assam & North East",
        severity="info",
        message="Test alert: Emergency broadcast notification delivery is operational.",
    )
    return {
        "sent": sent,
        "failed": failed,
        "error": error,
        "subscriptions": len(push_subscriptions),
        "sms_attempted": sms.attempted,
        "sms_sent": sms.sent,
        "sms_failed": sms.failed,
        "sms_error": sms.error,
    }


@app.get("/api/map/features", response_model=FeatureCollection, tags=["map"])
def map_features() -> FeatureCollection:
    features: list[dict[str, Any]] = []
    for vehicle in vehicles.values():
        lat, lon = vehicle.location
        features.append({
            "type": "Feature",
            "id": vehicle.id,
            "geometry": {"type": "Point", "coordinates": [lon, lat]},
            "properties": {"kind": "vehicle", **vehicle.model_dump(mode="json")},
        })
    for report in field_reports.values():
        if report.location:
            lat, lon = report.location
            features.append({
                "type": "Feature",
                "id": report.id,
                "geometry": {"type": "Point", "coordinates": [lon, lat]},
                "properties": {"kind": "field_report", **report.model_dump(mode="json")},
            })
    return FeatureCollection(features=features)


@app.get("/api/routes/suggestions", response_model=list[RouteSuggestion], tags=["routes"])
def route_suggestions(
    origin: str = "Guwahati",
    destination: str = "Itanagar",
) -> list[RouteSuggestion]:
    return [
        RouteSuggestion(
            id="route-primary", name="Primary corridor", origin=origin,
            destination=destination, distance_km=760, duration_minutes=690,
            risk="medium", reason="Fastest available corridor; monitor monsoon road conditions.",
            waypoints=[(26.1445, 91.7362), (27.0844, 93.6053)],
        ),
        RouteSuggestion(
            id="route-safe", name="Lower-risk alternative", origin=origin,
            destination=destination, distance_km=825, duration_minutes=770,
            risk="low", reason="Alternative via Shillong and Kohima with lower reported risk.",
            waypoints=[(26.1445, 91.7362), (25.5788, 91.8933), (25.6751, 94.1086), (27.0844, 93.6053)],
        ),
    ]


@app.get("/api/vehicles", response_model=list[Vehicle], tags=["vehicles"])
def list_vehicles(status: str | None = None) -> list[Vehicle]:
    result = list(vehicles.values())
    return [v for v in result if status is None or v.status == status]


@app.post("/api/datasets/csv", response_model=CsvImportResponse, tags=["datasets"])
async def import_csv(file: UploadFile = File(...)) -> CsvImportResponse:
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Please upload a .csv file")
    raw = await file.read(10 * 1024 * 1024 + 1)
    if len(raw) > 10 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="CSV files must not exceed 10 MB")
    try:
        text = raw.decode("utf-8-sig")
        columns, rows = parse_csv(io.StringIO(text))
    except (UnicodeDecodeError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Invalid CSV: {exc}") from exc

    normalized_rows = normalize_csv_rows(rows)
    numeric_summary: dict[str, dict[str, float]] = {}
    for column in columns:
        values: list[float] = []
        for row in rows:
            try:
                value = float(row[column])
                if math.isfinite(value):
                    values.append(value)
            except (TypeError, ValueError):
                continue
        if values:
            # Scale before summing to avoid overflowing on large finite inputs.
            scale = max(abs(value) for value in values)
            average = (math.fsum(value / scale / len(values) for value in values) * scale) if scale else 0.0
            numeric_summary[column] = {
                "min": min(values), "max": max(values), "average": average,
            }
    map_points = [row for row in normalized_rows if valid_coordinates(row)]
    return CsvImportResponse(
        filename=file.filename, columns=columns, row_count=len(rows),
        preview=rows[:8], normalized_preview=normalized_rows[:8],
        map_points=map_points, coordinate_count=len(map_points),
        numeric_summary=numeric_summary,
    )


@app.get("/api/vehicles/{vehicle_id}", response_model=Vehicle, tags=["vehicles"])
def get_vehicle(vehicle_id: str) -> Vehicle:
    vehicle = vehicles.get(vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    return vehicle


@app.get("/api/shipments", response_model=list[Shipment], tags=["shipments"])
def list_shipments(status: str | None = None) -> list[Shipment]:
    result = list(shipments.values())
    return [s for s in result if status is None or s.status == status]


@app.get("/api/shipments/{shipment_id}", response_model=Shipment, tags=["shipments"])
def get_shipment(shipment_id: str) -> Shipment:
    shipment = shipments.get(shipment_id)
    if shipment is None:
        raise HTTPException(status_code=404, detail="Shipment not found")
    return shipment


@app.get("/api/alerts", response_model=list[Alert], tags=["alerts"])
def list_alerts(include_acknowledged: bool = False) -> list[Alert]:
    return [a for a in alerts.values() if include_acknowledged or not a.acknowledged]


@app.post("/api/alerts/{alert_id}/acknowledge", response_model=Alert, tags=["alerts"])
def acknowledge_alert(alert_id: str) -> Alert:
    alert = alerts.get(alert_id)
    if alert is None:
        raise HTTPException(status_code=404, detail="Alert not found")
    alert.acknowledged = True
    return alert


@app.get("/api/field-reports", response_model=list[FieldReport], tags=["field reports"])
def list_field_reports(status: str | None = None) -> list[FieldReport]:
    result = list(field_reports.values())
    return [r for r in result if status is None or r.status == status]


@app.post("/api/field-reports", response_model=FieldReport, status_code=201, tags=["field reports"])
def create_field_report(payload: FieldReportCreate) -> FieldReport:
    report = FieldReport(
        id=f"rpt-{uuid4().hex[:8]}", **payload.model_dump(), created_at=now(),
    )
    field_reports[report.id] = report
    return report


@app.post("/api/sync/offline", response_model=SyncResponse, tags=["sync"])
def sync_offline(payload: SyncRequest) -> SyncResponse:
    accepted: list[FieldReport] = []
    errors: list[str] = []
    for item in payload.items:
        try:
            # item.report.model_dump() already contains client_id, so override it
            # explicitly instead of passing it again (which raised a duplicate
            # keyword argument error and rejected every synced report).
            report = FieldReport(
                id=f"rpt-{uuid4().hex[:8]}",
                **{**item.report.model_dump(), "client_id": item.client_id},
                created_at=now(), synced_at=now(),
            )
            field_reports[report.id] = report
            accepted.append(report)
        except Exception as exc:  # defensive per-item sync isolation
            errors.append(f"{item.client_id}: {exc}")
    return SyncResponse(
        accepted=len(accepted), reports=accepted, errors=errors, synced_at=now(),
    )
