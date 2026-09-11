"""CSV preprocessing shared by the API and command-line importer."""

import csv
import math
import unicodedata
from pathlib import Path
from typing import TextIO

NORMALIZED_COLUMNS = (
    "id", "name", "type", "state", "latitude", "longitude",
    "status", "risk_score",
)
NER_STATES = {
    "Arunachal Pradesh", "Assam", "Manipur", "Meghalaya",
    "Mizoram", "Nagaland", "Sikkim", "Tripura",
}

ALIASES = {
    "id": ("id", "ID", "asset_id", "road_id", "bridge_id"),
    "name": ("name", "Name", "city", "City", "road_name", "bridge_name", "location", "place", "States/UTs"),
    "type": ("type", "Type", "category", "asset_type", "road_type"),
    "state": ("state", "State", "state_name", "admin_name", "admin1", "province", "States/UTs"),
    "latitude": ("latitude", "lat", "Latitude", "y"),
    "longitude": ("longitude", "lon", "lng", "Longitude", "long", "x"),
    "status": ("status", "Status", "condition", "road_condition", "accessibility"),
    "risk_score": ("risk_score", "risk", "risk_index", "hazard_score"),
}


def _value(row: dict[str, str], names: tuple[str, ...], default: str = "") -> str:
    for name in names:
        value = row.get(name, "").strip()
        if value:
            return value
    return default


def _canonical_state(value: str) -> str:
    plain = "".join(
        character for character in unicodedata.normalize("NFKD", value)
        if not unicodedata.combining(character)
    ).casefold().strip()
    aliases = {
        "arunachal pradesh": "Arunachal Pradesh",
        "assam": "Assam",
        "manipur": "Manipur",
        "meghalaya": "Meghalaya",
        "mizoram": "Mizoram",
        "nagaland": "Nagaland",
        "sikkim": "Sikkim",
        "tripura": "Tripura",
    }
    return aliases.get(plain, value)


def normalize_csv_rows(rows: list[dict[str, str]]) -> list[dict[str, str]]:
    normalized = []
    for index, row in enumerate(rows, start=1):
        normalized.append({
            "id": _value(row, ALIASES["id"], f"dataset-{index}"),
            "name": _value(row, ALIASES["name"], f"Imported point {index}"),
            "type": _value(row, ALIASES["type"], "network feature"),
            "state": _canonical_state(_value(row, ALIASES["state"])),
            "latitude": _value(row, ALIASES["latitude"]),
            "longitude": _value(row, ALIASES["longitude"]),
            "status": _value(row, ALIASES["status"], "unknown"),
            "risk_score": _value(row, ALIASES["risk_score"]),
        })
    return normalized


def parse_csv(source: TextIO) -> tuple[list[str], list[dict[str, str]]]:
    reader = csv.DictReader(source, strict=True)
    if not reader.fieldnames:
        raise ValueError("The CSV must include a header row")
    columns = [column.strip() for column in reader.fieldnames]
    if any(not column for column in columns) or len(set(columns)) != len(columns):
        raise ValueError("CSV headers must be non-empty and unique")
    reader.fieldnames = columns
    rows = []
    for row in reader:
        if None in row:
            raise ValueError(f"Row ending at line {reader.line_num} has more values than headers")
        rows.append({key: (value or "").strip() for key, value in row.items()})
    return columns, rows

def valid_coordinates(row: dict[str, str]) -> bool:
    try:
        latitude, longitude = float(row["latitude"]), float(row["longitude"])
        return math.isfinite(latitude) and math.isfinite(longitude) and -90 <= latitude <= 90 and -180 <= longitude <= 180
    except (KeyError, TypeError, ValueError):
        return False

def read_csv(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        try:
            return parse_csv(source)[1]
        except csv.Error as exc:
            raise ValueError(f"Invalid CSV: {exc}") from exc


def write_normalized(rows: list[dict[str, str]], destination: TextIO) -> None:
    writer = csv.DictWriter(destination, fieldnames=NORMALIZED_COLUMNS, lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
