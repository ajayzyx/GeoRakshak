"""Stage A v3 dataset: positives from the GSI (Bhusanket) surveyed landslide inventory, same designs as v2.

Pre-registration: ml/reports/evaluation-2026-09-18-v3.md §1. Reuses the v2 candidate generator, NER mask,
exposure matching and feature extraction unchanged; only the label source and the exclusion rule change.

Usage: ml/.venv/bin/python ml/pipeline/stage_a_v3_dataset.py
Outputs (ml/data/processed/training/v3/): positives.csv, negatives_naive.csv, negatives_exposure.csv,
stage_a_v3_{naive,exposure}.csv, build_meta.json  (background and pilot features are reused from v2)
"""

from __future__ import annotations

import csv
import json
import math
import random
from collections import Counter
from datetime import datetime, timezone

import rasterio

import point_features as PF
import stage_a_v2_dataset as V2
from common import PROCESSED, RAW

OUT = PROCESSED / "training" / "v3"
V2_DIR = PROCESSED / "training" / "v2"
GSI = RAW / "gsi" / "gsi_landslide_public_ner.geojson"
SEED = 42
POSITIVE_SAMPLE = 1000          # compute budget: 1000 positives x 3 negatives of remote DEM window reads
NEG_RATIO = 3
GSI_EXCLUSION_M = 1000.0        # negatives must be >= 1 km from ANY GSI record (surveyed locations)
SOURCE_SLUG = "gsi-bhusanket"


def load_gsi():
    d = json.loads(GSI.read_text())
    out = []
    for f in d["features"]:
        lon, lat = f["geometry"]["coordinates"][:2] if f.get("geometry") else (None, None)
        if lon is None or not (88.0 <= lon <= 97.5 and 21.5 <= lat <= 29.5):
            continue
        p = f["properties"]
        out.append({"lon": lon, "lat": lat, "state": (p.get("state") or "").strip().lower(),
                    "event_id": str(p.get("objectid")), "slide_no": p.get("slide_no"),
                    "acc": "gsi_surveyed", "event_date": None})
    return out


def dedup(recs, rng):
    """Drop records within 500 m of an already-kept record (overlapping 500 m feature windows)."""
    order = sorted(recs, key=lambda r: int(r["event_id"]))
    kept, dropped = [], 0
    cell = {}
    for r in order:
        key = (round(r["lat"] / 0.005), round(r["lon"] / 0.005))
        near = [q for dk in ((0, 0), (0, 1), (1, 0), (1, 1), (0, -1), (-1, 0), (-1, -1), (1, -1), (-1, 1))
                for q in cell.get((key[0] + dk[0], key[1] + dk[1]), [])]
        if any(V2.haversine_m(r["lon"], r["lat"], q["lon"], q["lat"]) < V2.DEDUP_WINDOW_M for q in near):
            dropped += 1
            continue
        kept.append(r)
        cell.setdefault(key, []).append(r)
    rng.shuffle(kept)
    return kept, dropped


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    rng = random.Random(SEED)
    gsi = load_gsi()
    kept, dropped_dedup = dedup(gsi, rng)
    sample = sorted(kept[:POSITIVE_SAMPLE], key=lambda r: int(r["event_id"]))
    coolr = V2.load_records()
    excl = V2.exclusion_points(coolr) + [(r["lon"], r["lat"], GSI_EXCLUSION_M) for r in gsi]
    mask, wc, exposure = V2.NerMask(), PF.WorldCover(), PF.Exposure()
    print(f"GSI records={len(gsi)} deduped={len(kept)} (dropped {dropped_dedup}) sample={len(sample)} "
          f"exclusion points={len(excl)}", flush=True)

    prows, dropped = [], Counter()
    for r in sample:
        st = wc.window_stats(r["lon"], r["lat"])
        x = exposure.x(r["lon"], r["lat"])
        if st is None or x is None:
            dropped["positive_no_worldcover"] += 1
            continue
        prows.append({"label": 1, "lon": r["lon"], "lat": r["lat"], "state": r["state"], "event_id": r["event_id"],
                      "acc": r["acc"], "exposure_x": x, "exposure_bin": PF.exposure_bin(x), **st})
    pos_bins = Counter(p["exposure_bin"] for p in prows)
    print("positives with WorldCover:", len(prows), "bins:", dict(sorted(pos_bins.items())), flush=True)

    rng_n = random.Random(SEED)
    stream_n = V2.candidate_stream(sample, mask, excl, wc, exposure, rng_n)
    naive = [next(stream_n) for _ in range(NEG_RATIO * len(prows))]

    rng_e = random.Random(SEED)
    quota = {b: NEG_RATIO * n for b, n in pos_bins.items()}
    have, expo, draws = Counter(), [], 0
    for c in V2.candidate_stream(sample, mask, excl, wc, exposure, rng_e):
        draws += 1
        b = c["exposure_bin"]
        if have[b] < quota.get(b, 0):
            expo.append(c)
            have[b] += 1
        if sum(have.values()) >= sum(quota.values()):
            break
    print("negatives naive:", len(naive), "exposure:", len(expo), flush=True)

    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", VSI_CACHE="TRUE", VSI_CACHE_SIZE=200000000,
                      GDAL_CACHEMAX=512, GDAL_HTTP_MULTIPLEX="YES"):
        dem = PF.DemSource()
        prows = V2.add_terrain(prows, dem, dropped, "positives")
        naive = V2.add_terrain([{**c, "label": 0} for c in naive], dem, dropped, "negatives_naive")
        expo = V2.add_terrain([{**c, "label": 0} for c in expo], dem, dropped, "negatives_exposure")

    V2.write_rows(OUT / "positives.csv", prows)
    V2.write_rows(OUT / "negatives_naive.csv", naive)
    V2.write_rows(OUT / "negatives_exposure.csv", expo)
    V2.write_rows(OUT / "stage_a_v3_naive.csv", prows + naive)
    V2.write_rows(OUT / "stage_a_v3_exposure.csv", prows + expo)
    for name in ("background_ner.csv", "pilot_grid_features.csv"):
        (OUT / name).write_text((V2_DIR / name).read_text())  # reused unchanged from v2
    meta = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": SEED,
            "inventory": {"source_slug": SOURCE_SLUG, "file": "data/raw/gsi/gsi_landslide_public_ner.geojson",
                          "records_ner": len(gsi), "deduped_500m": len(kept), "dropped_dedup": dropped_dedup,
                          "positive_sample": len(sample), "sampling": "random sample of deduped records, seed 42"},
            "neg_ratio": NEG_RATIO, "gsi_exclusion_m": GSI_EXCLUSION_M,
            "coolr_exclusion_records": len(V2.exclusion_points(coolr)),
            "positive_exposure_bins": {str(k): v for k, v in sorted(pos_bins.items())},
            "negatives": {"naive": len(naive), "exposure_controlled": len(expo),
                          "exposure_quota": {str(k): v for k, v in sorted(quota.items())},
                          "exposure_filled": {str(k): v for k, v in sorted(have.items())},
                          "exposure_shortfall": {str(k): quota[k] - have[k] for k in quota if quota[k] > have[k]},
                          "candidates_examined_for_matching": draws},
            "rows": {"positives": len(prows), "negatives_naive": len(naive), "negatives_exposure": len(expo)},
            "dropped": dict(dropped),
            "min_positive_negative_distance_m": {
                name: round(min(V2.haversine_m(n["lon"], n["lat"], p["lon"], p["lat"]) for n in negs for p in prows), 1)
                for name, negs in (("naive", naive), ("exposure", expo))},
            "reused_from_v2": ["background_ner.csv", "pilot_grid_features.csv"]}
    (OUT / "build_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps({k: meta[k] for k in ("inventory", "negatives", "rows", "dropped", "min_positive_negative_distance_m")}, indent=1))


if __name__ == "__main__":
    main()
