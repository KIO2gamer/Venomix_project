"""Regression tests for the NER Logistics API using FastAPI's TestClient."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

client = TestClient(main.app)


def upload_csv(text: str, filename: str = "sample.csv"):
    return client.post(
        "/api/datasets/csv",
        files={"file": (filename, text.encode("utf-8"), "text/csv")},
    )


def test_health():
    response = client.get("/api/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"


def test_summary_active_shipments_is_derived():
    summary = client.get("/api/dashboard/summary").json()
    expected = sum(
        shipment.status in ("in_transit", "delayed") for shipment in main.shipments.values()
    )
    assert summary["activeShipments"] == expected
    assert summary["active_vehicles"] + summary["available_vehicles"] <= len(main.vehicles)


def test_csv_import_maps_every_plottable_row():
    response = upload_csv(
        "road_name,lat,lng,condition,risk,admin_name\n"
        "NH-10,27.06,88.47,good,25,Sikkim\n"
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["row_count"] == 1
    assert body["coordinate_count"] == 1
    assert len(body["map_points"]) == 1
    assert body["normalized_preview"][0]["name"] == "NH-10"
    assert body["normalized_preview"][0]["state"] == "Sikkim"
    assert body["normalized_preview"][0]["status"] == "good"
    assert body["normalized_preview"][0]["risk_score"] == "25"


def test_csv_import_reports_all_map_points_beyond_preview():
    lines = ["name,latitude,longitude"] + [f"Point {i},{20 + i},{90 + i}" for i in range(30)]
    response = upload_csv("\n".join(lines) + "\n")
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["row_count"] == 30
    assert body["coordinate_count"] == 30
    assert len(body["map_points"]) == 30
    assert len(body["normalized_preview"]) == 8


def test_csv_import_ignores_out_of_range_and_non_finite_coordinates():
    response = upload_csv(
        "name,latitude,longitude\nGood,26.1,91.7\nToo far,999,91.7\nBlank,,\nText,abc,91.7\n"
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["coordinate_count"] == 1
    assert [point["name"] for point in body["map_points"]] == ["Good"]


def test_csv_import_rejects_ragged_rows_with_400():
    response = upload_csv("name,latitude,longitude\nBad,26.1,91.7,extra\n")
    assert response.status_code == 400
    assert "more values" in response.json()["detail"]


def test_csv_numeric_summary_stays_finite():
    response = upload_csv("name,latitude,longitude,value\nBig,26.1,91.7,1e308\nBigger,26.2,91.8,1e308\n")
    assert response.status_code == 200, response.text
    summary = response.json()["numeric_summary"]["value"]
    assert summary["max"] == 1e308
    assert abs(summary["average"] - 1e308) < 1e295
    assert abs(summary["min"] - 1e308) < 1e295


def test_field_report_with_location_reaches_the_map():
    response = client.post(
        "/api/field-reports",
        json={
            "reporter": "Test Runner",
            "category": "road",
            "description": "Bridge washout near the district checkpoint.",
            "location": [26.1445, 91.7362],
        },
    )
    assert response.status_code == 201, response.text
    report = response.json()
    features = client.get("/api/map/features").json()["features"]
    assert any(feature["id"] == report["id"] for feature in features)


def test_field_report_rejects_invalid_coordinates():
    response = client.post(
        "/api/field-reports",
        json={"reporter": "Test Runner", "category": "road", "description": "Bad point.", "location": [999, 91.7]},
    )
    assert response.status_code == 422


def test_offline_sync_accepts_item_client_id_without_duplicate_keyword():
    response = client.post(
        "/api/sync/offline",
        json={
            "items": [
                {
                    "client_id": "device-42",
                    "report": {"reporter": "Field Team", "category": "delivery", "description": "Offline note."},
                }
            ]
        },
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["accepted"] == 1
    assert body["errors"] == []
    assert body["reports"][0]["client_id"] == "device-42"


def test_acknowledge_alert_removes_it_from_the_open_summary():
    alert_id = next(iter(main.alerts))
    assert summary_alert_ids().count(alert_id) == 1
    assert client.post(f"/api/alerts/{alert_id}/acknowledge").status_code == 200
    assert alert_id not in summary_alert_ids()
    main.alerts[alert_id].acknowledged = False  # keep the shared demo state clean


def test_acknowledge_unknown_alert_returns_404():
    assert client.post("/api/alerts/does-not-exist/acknowledge").status_code == 404


def test_emergency_simulation_uses_bcc_when_towers_are_available():
    response = client.post(
        "/api/emergency-alerts/simulate",
        json={"area": "Assam", "message": "Severe weather warning.", "severity": "high", "towers_available": 5},
    )
    assert response.status_code == 200, response.text
    body = response.json()
    assert body["delivery_mode"] == "bcc"
    assert body["channels"] == ["Cell Broadcast / BCC"]


def test_emergency_simulation_falls_back_without_towers():
    response = client.post(
        "/api/emergency-alerts/simulate",
        json={"area": "Assam", "message": "Severe weather warning.", "severity": "critical", "towers_available": 0},
    )
    assert response.status_code == 200, response.text
    assert response.json()["delivery_mode"] == "satellite_and_broadcast_fallback"


def summary_alert_ids() -> list[str]:
    return [alert["id"] for alert in client.get("/api/dashboard/summary").json()["alerts"]]
