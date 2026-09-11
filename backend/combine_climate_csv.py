"""Join city coordinates/population with daily climate data and score risk.

Example:
    python backend/combine_climate_csv.py \
      "India Cities LatLng.csv" "Indian_Climate_Dataset_2024_2025.csv" \
      -o data/ner_climate_risk.csv --ner-only

Risk model:
    hazard = 35% heat + 35% rainfall + 15% wind + 15% air quality
    exposure = normalized log(population)
    vulnerability_factor = 0.5 + 0.5 * exposure / 100
    risk_score = hazard * vulnerability_factor

When no climate observations match a location, the output uses the exposure
score as a clearly documented operational proxy so locations can still be
prioritized. It is not a substitute for a weather hazard score.

This is a screening score, not an official disaster warning. A city without
matching climate observations receives an exposure-based proxy score when
population data is available.
"""

import argparse
import csv
import math
import unicodedata
from collections import defaultdict
from pathlib import Path

from csv_processing import NER_STATES, _canonical_state

OUTPUT_COLUMNS = (
    "id", "name", "type", "state", "latitude", "longitude", "status",
    "risk_score", "risk_level", "score_basis", "hazard_score", "exposure_score",
    "population", "max_temperature_c", "max_rainfall_mm", "max_wind_kmh",
    "max_aqi", "climate_observations",
)


def key(value: str) -> str:
    plain = unicodedata.normalize("NFKD", value or "")
    return "".join(c for c in plain if not unicodedata.combining(c)).casefold().strip()


def number(row: dict[str, str], column: str) -> float | None:
    try:
        value = row.get(column, "").strip()
        return float(value) if value else None
    except (AttributeError, ValueError):
        return None


def read_rows(path: Path) -> list[dict[str, str]]:
    with path.open("r", encoding="utf-8-sig", newline="") as source:
        reader = csv.DictReader(source)
        if not reader.fieldnames:
            raise ValueError(f"{path} has no header row")
        return [{(k or "").strip(): (v or "").strip() for k, v in row.items()} for row in reader]


def average(values: list[float]) -> float | None:
    return sum(values) / len(values) if values else None


def clamp(value: float, low: float = 0, high: float = 100) -> float:
    return max(low, min(high, value))


def score_level(score: float | None) -> str:
    if score is None:
        return "Unassessed"
    if score >= 80:
        return "Critical"
    if score >= 60:
        return "High"
    if score >= 35:
        return "Medium"
    return "Low"


def write_rows(rows: list[dict[str, str]], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8", newline="") as destination:
        writer = csv.DictWriter(destination, fieldnames=OUTPUT_COLUMNS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)


def main() -> int:
    parser = argparse.ArgumentParser(description="Combine city and climate CSVs into a project-ready risk dataset.")
    parser.add_argument("cities", type=Path, help="City coordinates/population CSV")
    parser.add_argument("climate", type=Path, help="Daily climate CSV")
    parser.add_argument("-o", "--output", type=Path, required=True, help="Output CSV path")
    parser.add_argument("--ner-only", action="store_true", help="Keep only the eight North-Eastern states")
    args = parser.parse_args()

    cities = read_rows(args.cities)
    climate = read_rows(args.climate)
    ner_keys = {key(state) for state in NER_STATES}

    observations: dict[str, dict[str, list[float]]] = defaultdict(lambda: defaultdict(list))
    for row in climate:
        city_key = key(row.get("City", ""))
        if not city_key:
            continue
        for output, source in (
            ("temperature", "Temperature_Max (°C)"),
            ("rainfall", "Rainfall (mm)"),
            ("wind", "Wind_Speed (km/h)"),
            ("aqi", "AQI"),
        ):
            value = number(row, source)
            if value is not None:
                observations[city_key][output].append(value)

    selected = [row for row in cities if not args.ner_only or key(_canonical_state(row.get("admin_name", ""))) in ner_keys]
    populations = [number(row, "population") for row in selected]
    valid_populations = [value for value in populations if value is not None and value > 0]
    min_log = min((math.log1p(value) for value in valid_populations), default=0)
    max_log = max((math.log1p(value) for value in valid_populations), default=1)
    results: list[dict[str, str]] = []
    matched = 0

    for index, city in enumerate(selected, start=1):
        city_key = key(city.get("city", ""))
        data = observations.get(city_key, {})
        maximums = {name: max(values) if values else None for name, values in data.items()}
        if data:
            matched += 1
        heat = clamp((maximums.get("temperature", 32) - 32) / 12 * 100) if maximums.get("temperature") is not None else None
        rainfall = clamp(maximums.get("rainfall", 0) / 100 * 100) if maximums.get("rainfall") is not None else None
        wind = clamp(maximums.get("wind", 0) / 50 * 100) if maximums.get("wind") is not None else None
        air = clamp(maximums.get("aqi", 0) / 300 * 100) if maximums.get("aqi") is not None else None
        components = [value for value in (heat, rainfall, wind, air) if value is not None]
        hazard = (0.35 * heat + 0.35 * rainfall + 0.15 * wind + 0.15 * air) if all(value is not None for value in (heat, rainfall, wind, air)) else (sum(components) / len(components) if components else None)
        population = number(city, "population")
        population_log = math.log1p(population) if population and population > 0 else None
        exposure = ((population_log - min_log) / (max_log - min_log) * 100) if population_log is not None and max_log > min_log else None
        factor = 0.5 + 0.5 * (exposure or 0) / 100
        risk = round(clamp(hazard * factor), 1) if hazard is not None else (
            round(clamp(exposure), 1) if exposure is not None else None
        )
        state = _canonical_state(city.get("admin_name", ""))
        results.append({
            "id": city.get("city", f"city-{index}"), "name": city.get("city", f"Imported city {index}"),
            "type": "climate monitoring point", "state": state,
            "latitude": city.get("lat", ""), "longitude": city.get("lng", ""),
            "status": score_level(risk).lower(), "risk_score": "" if risk is None else str(risk),
            "risk_level": score_level(risk),
            "score_basis": "climate_hazard_adjusted" if hazard is not None else "exposure_proxy",
            "hazard_score": "" if hazard is None else str(round(hazard, 1)),
            "exposure_score": "" if exposure is None else str(round(exposure, 1)),
            "population": city.get("population", ""),
            "max_temperature_c": "" if maximums.get("temperature") is None else str(round(maximums["temperature"], 1)),
            "max_rainfall_mm": "" if maximums.get("rainfall") is None else str(round(maximums["rainfall"], 1)),
            "max_wind_kmh": "" if maximums.get("wind") is None else str(round(maximums["wind"], 1)),
            "max_aqi": "" if maximums.get("aqi") is None else str(round(maximums["aqi"], 1)),
            "climate_observations": str(len(data.get("temperature", []))),
        })

    write_rows(results, args.output)
    print(f"Wrote {len(results)} rows to {args.output}; matched climate data for {matched} cities")
    if matched == 0:
        print("Warning: no city names overlap; risk scores use the exposure proxy.")
    elif matched < len(results):
        print(f"Warning: {len(results) - matched} cities have no climate observations and remain Unassessed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
