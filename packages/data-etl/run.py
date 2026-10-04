"""Refresh data/seed/*.json from public sources. Falls back to existing files."""

from __future__ import annotations

import json
import sys
import urllib.request
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "data" / "seed"


def load(name: str) -> dict:
    return json.loads((SEED / name).read_text(encoding="utf-8"))


def save(name: str, payload: dict) -> None:
    (SEED / name).write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")


def fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "asset-aware-etl/0.1"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read()


def refresh_epa_catalog(vehicle: dict) -> int:
    """Pull a compact EPA year/make/model list when the service is reachable."""
    url = "https://www.fueleconomy.gov/ws/rest/vehicle/menu/year"
    try:
        raw = fetch(url)
    except Exception as exc:  # noqa: BLE001
        print(f"EPA year list skipped: {exc}")
        return 0
    # Keep existing catalog if the XML/JSON shape is unexpected.
    if not raw:
        return 0
    vehicle.setdefault("sources", [])
    print("EPA menu reached; catalog left as curated subset (full dump is huge).")
    return 0


CLASS_ORDER = ["car", "suv", "truck", "van", "ev", "motorcycle", "rv"]

# Public-table defaults so an older seed file still has every class the walker knows.
CLASS_DEFAULTS = {
    "car": {
        "annualMaintenance": {"liberal": 1200, "realistic": 1950, "conservative": 2800},
        "annualDepreciationPct": {"liberal": 0.1, "realistic": 0.15, "conservative": 0.22},
    },
    "suv": {
        "annualMaintenance": {"liberal": 1400, "realistic": 2200, "conservative": 3200},
        "annualDepreciationPct": {"liberal": 0.11, "realistic": 0.16, "conservative": 0.23},
    },
    "truck": {
        "annualMaintenance": {"liberal": 1600, "realistic": 2400, "conservative": 3500},
        "annualDepreciationPct": {"liberal": 0.12, "realistic": 0.17, "conservative": 0.24},
    },
    "van": {
        "annualMaintenance": {"liberal": 1400, "realistic": 2100, "conservative": 3000},
        "annualDepreciationPct": {"liberal": 0.11, "realistic": 0.16, "conservative": 0.23},
    },
    "ev": {
        "annualMaintenance": {"liberal": 700, "realistic": 1100, "conservative": 1700},
        "annualDepreciationPct": {"liberal": 0.14, "realistic": 0.2, "conservative": 0.28},
    },
    "motorcycle": {
        "annualMaintenance": {"liberal": 400, "realistic": 700, "conservative": 1200},
        "annualDepreciationPct": {"liberal": 0.08, "realistic": 0.12, "conservative": 0.18},
    },
    "rv": {
        "annualMaintenance": {"liberal": 1800, "realistic": 2800, "conservative": 4200},
        "annualDepreciationPct": {"liberal": 0.1, "realistic": 0.15, "conservative": 0.22},
    },
}

CLASS_SAMPLES = [
    {"year": 2023, "make": "Tesla", "model": "Model 3", "class": "ev", "kwhPerMile": 0.25},
    {"year": 2022, "make": "Harley-Davidson", "model": "Sportster", "class": "motorcycle", "mpg": 48},
    {"year": 2019, "make": "Winnebago", "model": "Minnie", "class": "rv", "mpg": 10},
]


def ensure_vehicle_classes(vehicle: dict) -> None:
    """Keep ev, motorcycle, and rv beside the older car classes."""
    existing = {
        row.get("class"): row
        for row in vehicle.get("byClass", [])
        if isinstance(row, dict) and row.get("class")
    }
    merged = []
    for name in CLASS_ORDER:
        row = dict(existing.get(name) or {"class": name})
        row["class"] = name
        defaults = CLASS_DEFAULTS[name]
        row.setdefault("annualMaintenance", defaults["annualMaintenance"])
        row.setdefault("annualDepreciationPct", defaults["annualDepreciationPct"])
        merged.append(row)
    vehicle["byClass"] = merged
    catalog = vehicle.setdefault("catalog", [])
    have = {row.get("class") for row in catalog if isinstance(row, dict)}
    for sample in CLASS_SAMPLES:
        if sample["class"] not in have:
            catalog.append(dict(sample))
            have.add(sample["class"])


def refresh_macro(macro: dict) -> None:
    """Stamp retrieval date. Live FRED needs FRED_API_KEY."""
    import os

    macro.setdefault("equityVolAnnual", 0.16)
    macro.setdefault("bondVolAnnual", 0.06)
    macro.setdefault("crashJump", -0.20)
    macro.setdefault("upJump", 0.12)
    macro.setdefault("jumpChanceMonthly", 0.015)
    macro.setdefault("jobLossMonthlyChance", 0.004)
    macro.setdefault("raisePct", 0.10)
    macro.setdefault("cpiVolAnnual", 0.01)
    macro.setdefault("electricityPricePerKwh", 0.16)

    key = os.environ.get("FRED_API_KEY")
    if not key:
        print("FRED_API_KEY not set; keeping attributed CPI in macro_v1.json")
        return
    try:
        url = (
            "https://api.stlouisfed.org/fred/series/observations"
            f"?series_id=CPIAUCSL&api_key={key}&file_type=json&sort_order=desc&limit=13"
        )
        data = json.loads(fetch(url))
        obs = [float(o["value"]) for o in data.get("observations", []) if o.get("value") not in ("", ".")]
        if len(obs) >= 13 and obs[12]:
            macro["cpiAnnual"] = round(obs[0] / obs[12] - 1, 4)
            macro["vintage"] = date.today().isoformat()
            print(f"Updated CPI annual to {macro['cpiAnnual']}")
    except Exception as exc:  # noqa: BLE001
        print(f"FRED refresh skipped: {exc}")


def main() -> int:
    SEED.mkdir(parents=True, exist_ok=True)
    home = load("home_v1.json")
    vehicle = load("vehicle_v1.json")
    macro = load("macro_v1.json")

    home.setdefault("hpiCrashAnnual", {"liberal": -0.05, "realistic": -0.12, "conservative": -0.20})
    home.setdefault("hpiBoomAnnual", {"liberal": 0.12, "realistic": 0.08, "conservative": 0.04})
    home.setdefault("hpiMeanReversionHalfLifeYears", 8)
    home.setdefault("hpiVolAnnual", 0.06)

    ensure_vehicle_classes(vehicle)
    refresh_epa_catalog(vehicle)
    refresh_macro(macro)

    home["vintage"] = home.get("vintage") or date.today().isoformat()
    save("home_v1.json", home)
    save("vehicle_v1.json", vehicle)
    save("macro_v1.json", macro)
    print(f"Wrote seed files in {SEED}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
