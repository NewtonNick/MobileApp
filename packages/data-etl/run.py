"""Restamp data/seed/*.json. Does not rebuild the cited cost tables."""

from __future__ import annotations

import csv
import io
import json
import ssl
import statistics
import subprocess
import sys
import urllib.error
import urllib.request
from collections import Counter, defaultdict
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SEED = ROOT / "data" / "seed"


def load(name: str) -> dict:
    return json.loads((SEED / name).read_text(encoding="utf-8"))


def save(name: str, payload: dict) -> None:
    path = SEED / name
    if path.exists():
        try:
            current = json.loads(path.read_text(encoding="utf-8"))
        except json.JSONDecodeError:
            current = None
        if current == payload:
            return
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


def _ssl_failure(exc: BaseException) -> bool:
    reason = getattr(exc, "reason", None)
    return isinstance(reason, ssl.SSLError) or "CERTIFICATE_VERIFY_FAILED" in str(exc)


def _fetch_with_curl(url: str, timeout: int) -> bytes:
    """Windows Python often has no CA bundle. curl.exe uses the OS certificate store."""
    try:
        completed = subprocess.run(
            ["curl.exe", "-fsSL", "--max-time", str(timeout), "-A", "asset-aware-etl/0.1", url],
            check=False,
            capture_output=True,
        )
    except FileNotFoundError as exc:
        raise urllib.error.URLError("certificate check failed and curl.exe was not available") from exc
    if completed.returncode != 0:
        detail = completed.stderr.decode("utf-8", errors="replace").strip()
        raise urllib.error.URLError(detail or f"curl exited {completed.returncode}")
    return completed.stdout


def fetch(url: str, timeout: int = 30) -> bytes:
    req = urllib.request.Request(url, headers={"User-Agent": "asset-aware-etl/0.1"})
    try:
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            return resp.read()
    except urllib.error.URLError as exc:
        if not _ssl_failure(exc):
            raise
        return _fetch_with_curl(url, timeout)


EPA_CATALOG_URL = "https://www.fueleconomy.gov/feg/epadata/vehicles.csv"
EPA_MIN_YEAR = 2000
# A collapsed 2000–present list is thousands of rows. Fewer than this means the file was unusable.
EPA_MIN_ROWS = 1000

# Light-duty file has no motorcycle or RV rows. These stay searchable and are not defaults.
NON_EPA_SAMPLES = [
    {"year": 2022, "make": "Harley-Davidson", "model": "Sportster", "class": "motorcycle", "mpg": 48},
    {"year": 2019, "make": "Winnebago", "model": "Minnie", "class": "rv", "mpg": 10},
]


def decode_epa(raw: bytes) -> str:
    for encoding in ("utf-8-sig", "latin-1"):
        try:
            return raw.decode(encoding)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def map_vclass(vclass: str) -> str | None:
    text = vclass.strip().lower()
    if not text:
        return None
    if "pickup" in text or text.endswith("truck") or text.endswith("trucks"):
        return "truck"
    if "van" in text:
        return "van"
    if "sport utility" in text or "suv" in text:
        return "suv"
    if "car" in text or "seater" in text or "wagon" in text:
        return "car"
    return None


def parse_float(raw: str) -> float | None:
    text = (raw or "").strip()
    if not text:
        return None
    try:
        value = float(text)
    except ValueError:
        return None
    if not value > 0:
        return None
    return value


def electricity_kwh_per_mile(comb_e: float | None, city_e: float | None, highway_e: float | None) -> float | None:
    """EPA electricity columns are kWh per 100 miles. Combined wins; city and highway are the fallback."""
    if comb_e is not None:
        hundred = comb_e
    elif city_e is not None and highway_e is not None:
        hundred = (city_e + highway_e) / 2
    else:
        hundred = city_e if city_e is not None else highway_e
    if hundred is None:
        return None
    per_mile = hundred / 100
    if per_mile < 0.05 or per_mile > 1:
        return None
    return per_mile


def liquid_mpg(fuel1: str, fuel2: str, comb08: float | None, comb_a08: float | None) -> float | None:
    """Gasoline or diesel MPG. Plug-in rows use the charge-sustaining figure, not MPGe."""
    if fuel1 == "electricity" and fuel2:
        mpg = comb_a08
    else:
        mpg = comb08
    if mpg is None or mpg < 5 or mpg > 150:
        return None
    return mpg


def build_epa_catalog(raw: bytes) -> tuple[list[dict], Counter]:
    text = decode_epa(raw)
    reader = csv.DictReader(io.StringIO(text))
    fields = set(reader.fieldnames or [])
    required = {"year", "make", "model", "VClass", "fuelType1", "comb08"}
    missing = required - fields
    if missing:
        raise ValueError(f"vehicles.csv missing columns: {', '.join(sorted(missing))}")

    groups: dict[tuple[int, str, str], dict] = defaultdict(
        lambda: {"electric": [], "mpg": [], "classes": []}
    )
    unmapped: Counter = Counter()

    for record in reader:
        try:
            year = int((record.get("year") or "").strip())
        except ValueError:
            continue
        if year < EPA_MIN_YEAR:
            continue
        make = (record.get("make") or "").strip()
        model = (record.get("model") or "").strip()
        if not make or not model:
            continue
        fuel1 = (record.get("fuelType1") or "").strip().lower()
        fuel2 = (record.get("fuelType2") or "").strip().lower()
        bucket = groups[(year, make, model)]
        if fuel1 == "electricity" and not fuel2:
            kwh = electricity_kwh_per_mile(
                parse_float(record.get("combE") or ""),
                parse_float(record.get("cityE") or ""),
                parse_float(record.get("highwayE") or ""),
            )
            bucket["electric"].append(kwh)
            continue
        body = map_vclass(record.get("VClass") or "")
        if body is None:
            unmapped[(record.get("VClass") or "").strip() or "(blank)"] += 1
        else:
            bucket["classes"].append(body)
        mpg = liquid_mpg(
            fuel1,
            fuel2,
            parse_float(record.get("comb08") or ""),
            parse_float(record.get("combA08") or ""),
        )
        if mpg is not None:
            bucket["mpg"].append(mpg)

    catalog: list[dict] = []
    for (year, make, model), bucket in groups.items():
        electric = bucket["electric"]
        if electric and not bucket["classes"] and not bucket["mpg"]:
            row: dict = {"year": year, "make": make, "model": model, "class": "ev"}
            measured = [kwh for kwh in electric if kwh is not None]
            if measured:
                row["kwhPerMile"] = round(statistics.median(measured), 3)
            catalog.append(row)
            continue
        if not bucket["classes"]:
            continue
        counts = Counter(bucket["classes"])
        body = sorted(counts.items(), key=lambda item: (-item[1], item[0]))[0][0]
        row = {"year": year, "make": make, "model": model, "class": body}
        if bucket["mpg"]:
            row["mpg"] = int(statistics.median(bucket["mpg"]) + 0.5)
        catalog.append(row)

    have = {(row["year"], row["make"], row["model"]) for row in catalog}
    for sample in NON_EPA_SAMPLES:
        key = (sample["year"], sample["make"], sample["model"])
        if key not in have:
            catalog.append(dict(sample))
    catalog.sort(key=lambda row: (row["make"].lower(), row["model"].lower(), -row["year"]))
    return catalog, unmapped


def stamp_epa_source(vehicle: dict) -> None:
    sources = vehicle.setdefault("sources", [])
    for source in sources:
        url = source.get("url") or ""
        label = source.get("source") or ""
        if "fueleconomy.gov" in url or "EPA" in label:
            source["source"] = (
                "EPA fueleconomy.gov year/make/model catalog, one row per model year from 2000 "
                "through the latest published year"
            )
            source["vintage"] = date.today().isoformat()
            source["url"] = EPA_CATALOG_URL
            source["license"] = "U.S. government public domain"
            return
    sources.append(
        {
            "source": (
                "EPA fueleconomy.gov year/make/model catalog, one row per model year from 2000 "
                "through the latest published year"
            ),
            "vintage": date.today().isoformat(),
            "url": EPA_CATALOG_URL,
            "license": "U.S. government public domain",
        }
    )


def refresh_epa_catalog(vehicle: dict) -> int:
    """Collapse EPA vehicles.csv to one row per year, make, and model from 2000 onward."""
    try:
        raw = fetch(EPA_CATALOG_URL, timeout=120)
    except Exception as exc:  # noqa: BLE001
        print(f"EPA catalog skipped: {exc}")
        return 0
    if not raw:
        print("EPA catalog skipped: empty download")
        return 0
    try:
        catalog, unmapped = build_epa_catalog(raw)
    except Exception as exc:  # noqa: BLE001
        print(f"EPA catalog skipped: {exc}")
        return 0
    if len(catalog) < EPA_MIN_ROWS:
        print(f"EPA catalog skipped: only {len(catalog)} rows, keeping the existing list")
        return 0
    vehicle["catalog"] = catalog
    stamp_epa_source(vehicle)
    years = [row["year"] for row in catalog]
    counts = Counter(row["class"] for row in catalog)
    print(
        f"EPA catalog: {len(catalog)} rows, {min(years)}–{max(years)}, "
        + ", ".join(f"{name} {counts[name]}" for name in CLASS_ORDER if counts[name])
    )
    if unmapped:
        skipped = ", ".join(f"{name} ({n})" for name, n in unmapped.most_common(8))
        print(f"Unmapped EPA body classes left out of non-electric rows: {skipped}")
    return len(catalog)


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
