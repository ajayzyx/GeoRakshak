"""Shared helpers for the offline GeoRakshak data pipeline (network access happens only here)."""

from __future__ import annotations

import json
import time
from pathlib import Path

import requests

ML_DIR = Path(__file__).resolve().parents[1]
RAW = ML_DIR / "data" / "raw"
PROCESSED = ML_DIR / "data" / "processed"

USER_AGENT = "GeoRakshak-SIH2026-prototype/0.1 (landslide early-warning research prototype; offline pilot extract)"
OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Candidate pilot areas evaluated in the data spike (ml/reports/data-spike.md).
# 0.25 x 0.25 degree boxes centred on the town (approx. 25 x 28 km).
CANDIDATES = {
    "aizawl": {"name": "Aizawl, Mizoram", "center": (92.72, 23.73)},
    "kohima": {"name": "Kohima, Nagaland", "center": (94.11, 25.67)},
    "guwahati": {"name": "Guwahati hills, Assam", "center": (91.74, 26.14)},
}


def candidate_bbox(slug: str, half: float = 0.125) -> tuple[float, float, float, float]:
    lon, lat = CANDIDATES[slug]["center"]
    return (round(lon - half, 4), round(lat - half, 4), round(lon + half, 4), round(lat + half, 4))


def overpass(query: str, cache: Path | None = None, retries: int = 3) -> dict:
    """Run an Overpass QL query (fair use: one request at a time, pauses, descriptive UA)."""
    if cache is not None and cache.exists():
        return json.loads(cache.read_text())
    last = None
    for attempt in range(retries):
        r = requests.post(OVERPASS_URL, data={"data": query}, headers={"User-Agent": USER_AGENT}, timeout=240)
        if r.status_code == 200:
            data = r.json()
            if cache is not None:
                cache.parent.mkdir(parents=True, exist_ok=True)
                cache.write_text(json.dumps(data))
            time.sleep(5)
            return data
        last = f"HTTP {r.status_code}: {r.text[:300]}"
        time.sleep(30 * (attempt + 1))
    raise RuntimeError(f"Overpass failed: {last}")
