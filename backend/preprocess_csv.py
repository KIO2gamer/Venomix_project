"""Prepare project-ready CSV data.

Examples (run from the repository root):
    python backend/preprocess_csv.py "India Cities LatLng.csv" -o data/ner_cities.csv --ner-only
    python backend/preprocess_csv.py Length_of_National_Highways.csv -o data/highways.csv
"""

import argparse
from pathlib import Path
import sys

from csv_processing import NER_STATES, normalize_csv_rows, read_csv, write_normalized


def main() -> int:
    parser = argparse.ArgumentParser(description="Normalize a logistics CSV for NER Logistics Intelligence.")
    parser.add_argument("input", type=Path, help="Source CSV file")
    parser.add_argument("-o", "--output", type=Path, help="Output CSV path; prints to stdout when omitted")
    parser.add_argument("--ner-only", action="store_true", help="Keep only the eight North-Eastern states")
    args = parser.parse_args()

    if not args.input.exists():
        parser.error(f"Input file not found: {args.input}")
    try:
        rows = normalize_csv_rows(read_csv(args.input))
    except (OSError, UnicodeError, ValueError) as exc:
        parser.error(str(exc))

    if args.ner_only:
        rows = [row for row in rows if row["state"].casefold() in {state.casefold() for state in NER_STATES}]

    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        with args.output.open("w", encoding="utf-8", newline="") as destination:
            write_normalized(rows, destination)
        print(f"Wrote {len(rows)} rows to {args.output}")
    else:
        write_normalized(rows, sys.stdout)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
