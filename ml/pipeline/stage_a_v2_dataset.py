"""Stage A v2 datasets: rebuilt labels, naive and exposure-controlled negatives, NER background, pilot grid features.

Design is pre-registered in ml/reports/evaluation-2026-09-17-v2.md §1. Inventory: NASA GLC/COOLR (GSI Bhukosh blocked).

Usage: ml/.venv/bin/python ml/pipeline/stage_a_v2_dataset.py [--step all|grid|labels|features]
Outputs (ml/data/processed/training/v2/): positives.csv, negatives_naive.csv, negatives_exposure.csv,
background_ner.csv, pilot_grid_features.csv, stage_a_v2_{naive,exposure}.csv, build_meta.json
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import unicodedata
from collections import Counter, defaultdict
from datetime import datetime, timezone

import numpy as np
import rasterio

import pilot_config as P
import point_features as PF
from common import PROCESSED, RAW

OUT = PROCESSED / "training" / "v2"
INVENTORY = RAW / "nasa_glc" / "coolr_reports_points_ner_bbox.geojson"
IMD_GRD = RAW / "imd_rf25" / "ind2017_rfp25.grd"
NER_STATES = {"assam", "meghalaya", "mizoram", "manipur", "nagaland", "tripura", "arunachal pradesh", "sikkim"}
POSITIVE_ACCURACY = {"exact", "1km"}
ACCURACY_M = {"exact": 0.0, "1km": 1000.0, "5km": 5000.0}
SEED = 42
NEG_RATIO = 5
NEG_MAX_DIST_M = 30000.0
DEDUP_SAME_EVENT_M = 2000.0
DEDUP_WINDOW_M = 500.0
BG_PATCHES = 60
BG_PER_PATCH = 25          # 5 x 5 points at 1.2 km spacing (clustered sample; see report deviation note)
BG_SPACING_M = 1200.0
MAX_CANDIDATE_DRAWS = 400000
INVENTORY_SOURCE_SLUG = "nasa-glc"


def norm(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().strip().lower()


def haversine_m(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(a))


# ------------------------------------------------------------------ inventory and masks

def load_records():
    d = json.loads(INVENTORY.read_text())
    out = []
    for f in d["features"]:
        lon, lat = f["geometry"]["coordinates"][:2]
        p = f["properties"]
        out.append({"lon": lon, "lat": lat, "acc": p.get("location_accuracy"), "event_id": str(p.get("event_id")),
                    "event_date": p.get("event_date"), "country": p.get("country_code"),
                    "state": norm(p.get("admin_division_name"))})
    return out


def imd_mask():
    a = np.fromfile(IMD_GRD, dtype="<f4").reshape(365, 129, 135)
    return a[0] > -998


class NerMask:
    """Approximate NER-India mask: IMD 0.25 deg land cells with lon >= 90, plus the Sikkim box."""

    def __init__(self):
        self.m = imd_mask()

    def __call__(self, lon, lat):
        i, j = round((lat - 6.5) / 0.25), round((lon - 66.5) / 0.25)
        if not (0 <= i < 129 and 0 <= j < 135 and self.m[i, j]):
            return False
        gla, glo = 6.5 + i * 0.25, 66.5 + j * 0.25
        return glo >= 90.0 or (gla >= 27.25 and 88.0 <= glo <= 88.75)

    def cells(self):
        out = []
        for i in range(129):
            for j in range(135):
                la, lo = 6.5 + i * 0.25, 66.5 + j * 0.25
                if self.m[i, j] and (lo >= 90.0 or (la >= 27.25 and 88.0 <= lo <= 88.75)) and 21.5 <= la <= 29.75:
                    out.append((lo, la))
        return out


def positives(records):
    cand = [r for r in records if r["country"] == "IN" and r["state"] in NER_STATES and r["acc"] in POSITIVE_ACCURACY]
    cand.sort(key=lambda r: (0 if r["acc"] == "exact" else 1, int(r["event_id"])))
    kept, dropped = [], Counter()
    for r in cand:
        dup_event = any(q["event_date"] == r["event_date"] and haversine_m(r["lon"], r["lat"], q["lon"], q["lat"]) < DEDUP_SAME_EVENT_M
                        for q in kept)
        if dup_event:
            dropped["same_event_within_2km"] += 1
            continue
        if any(haversine_m(r["lon"], r["lat"], q["lon"], q["lat"]) < DEDUP_WINDOW_M for q in kept):
            dropped["within_500m"] += 1
            continue
        kept.append(r)
    return cand, kept, dropped


def exclusion_points(records):
    """(lon, lat, buffer_m) for every record with accuracy <= 5 km, any country."""
    return [(r["lon"], r["lat"], max(1000.0, ACCURACY_M[r["acc"]]) + 500.0) for r in records if r["acc"] in ACCURACY_M]


# ------------------------------------------------------------------ candidates

def candidate_stream(pos, mask, excl, wc, exposure, rng):
    """Yield accepted background candidates (dict with lon, lat, X, exposure_bin, landcover fields)."""
    draws = 0
    while draws < MAX_CANDIDATE_DRAWS:
        draws += 1
        anchor = pos[rng.randrange(len(pos))]
        dist = NEG_MAX_DIST_M * math.sqrt(rng.random())
        ang = rng.random() * 2 * math.pi
        lat = anchor["lat"] + (dist * math.sin(ang)) / 110574.0
        lon = anchor["lon"] + (dist * math.cos(ang)) / (111320.0 * math.cos(math.radians(anchor["lat"])))
        if not mask(lon, lat):
            continue
        if any(haversine_m(lon, lat, x, y) < b for x, y, b in excl):
            continue
        st = wc.window_stats(lon, lat)
        if st is None or st["landcover_class"] == 80:
            continue
        x = exposure.x(lon, lat)
        if x is None:
            continue
        yield {"lon": lon, "lat": lat, "exposure_x": x, "exposure_bin": PF.exposure_bin(x), "anchor": anchor["event_id"], **st}


# ------------------------------------------------------------------ feature writing

FIELDS = ["label", "lon", "lat", "state", "event_id", "acc", "exposure_x", "exposure_bin", "landcover_class",
          "landcover_tree_share", "builtup_share_500m", "utm_epsg"] + PF.T6


def write_rows(path, rows):
    with open(path, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=FIELDS, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 6) if isinstance(v, float) else v) for k, v in r.items()})


def add_terrain(points, dem, dropped, key):
    """Sort by DEM tile then position (block-cache friendly), attach T6, drop points with gaps."""
    points = sorted(points, key=lambda p: (math.floor(p["lat"]), math.floor(p["lon"]), round(p["lat"], 2), round(p["lon"], 2)))
    out = []
    for i, p in enumerate(points):
        t = PF.terrain_features(dem, p["lon"], p["lat"])
        if t is None:
            dropped[f"{key}_dem_gap"] += 1
            continue
        out.append({**p, **t})
        if (i + 1) % 200 == 0:
            print(f"  {key}: {i + 1}/{len(points)}", flush=True)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--step", default="all", choices=["all", "grid", "labels", "features"])
    args = ap.parse_args()
    OUT.mkdir(parents=True, exist_ok=True)

    if args.step in ("all", "grid") and not PF.builtup_grid_path().exists():
        tiles = sorted(PF.WC_TILES.glob("ESA_WorldCover_10m_2021_v200_*_Map.tif"))
        print("building 100 m built-up grid from", len(tiles), "tiles", flush=True)
        PF.build_builtup_grid(tiles)
    if args.step == "grid":
        return

    records = load_records()
    cand_pos, pos, pos_dropped = positives(records)
    mask, excl = NerMask(), exclusion_points(records)
    wc, exposure = PF.WorldCover(), PF.Exposure()
    meta = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": SEED,
            "inventory": {"source_slug": INVENTORY_SOURCE_SLUG, "file": str(INVENTORY.relative_to(RAW.parent.parent)),
                          "gsi_used": False, "records_total": len(records)},
            "positives": {"candidates": len(cand_pos), "kept": len(pos), "dropped": dict(pos_dropped)},
            "exclusion_records": len(excl), "neg_ratio": NEG_RATIO, "neg_max_dist_m": NEG_MAX_DIST_M,
            "exposure_bins": [list(b) for b in PF.EXPOSURE_BINS]}

    # exposure and land cover for positives
    prows, dropped = [], Counter()
    for r in pos:
        st = wc.window_stats(r["lon"], r["lat"])
        x = exposure.x(r["lon"], r["lat"])
        if st is None or x is None:
            dropped["positive_no_worldcover"] += 1
            continue
        prows.append({"label": 1, "lon": r["lon"], "lat": r["lat"], "state": r["state"], "event_id": r["event_id"],
                      "acc": r["acc"], "exposure_x": x, "exposure_bin": PF.exposure_bin(x), **st})
    pos_bins = Counter(p["exposure_bin"] for p in prows)
    meta["positives"]["with_worldcover"] = len(prows)
    meta["positives"]["dropped_no_worldcover"] = dropped["positive_no_worldcover"]
    meta["positive_exposure_bins"] = {str(k): v for k, v in sorted(pos_bins.items())}
    print("positives kept:", len(prows), "exposure bins:", dict(sorted(pos_bins.items())), flush=True)

    # negatives: one candidate stream per design, both seeded identically
    rng_n = random.Random(SEED)
    stream_n = candidate_stream(pos, mask, excl, wc, exposure, rng_n)
    naive = [next(stream_n) for _ in range(NEG_RATIO * len(prows))]

    rng_e = random.Random(SEED)
    quota = {b: NEG_RATIO * n for b, n in pos_bins.items()}
    have = Counter()
    expo, draws = [], 0
    for c in candidate_stream(pos, mask, excl, wc, exposure, rng_e):
        draws += 1
        b = c["exposure_bin"]
        if have[b] < quota.get(b, 0):
            expo.append(c)
            have[b] += 1
        if sum(have.values()) >= sum(quota.values()):
            break
    meta["negatives"] = {"naive": len(naive), "exposure_controlled": len(expo),
                         "exposure_quota": {str(k): v for k, v in sorted(quota.items())},
                         "exposure_filled": {str(k): v for k, v in sorted(have.items())},
                         "exposure_shortfall": {str(k): quota[k] - have[k] for k in quota if quota[k] > have[k]},
                         "candidates_examined_for_matching": draws}
    print("negatives naive:", len(naive), "exposure:", len(expo), "shortfall:", meta["negatives"]["exposure_shortfall"], flush=True)

    # NER background: clustered patches (see deviation note in the report)
    rng_b = random.Random(SEED)
    cells = mask.cells()
    w = np.array([math.cos(math.radians(la)) for _, la in cells])
    w = w / w.sum()
    bg = []
    tries = 0
    while len(bg) < BG_PATCHES * BG_PER_PATCH and tries < 20000:
        tries += 1
        lo, la = cells[int(np.searchsorted(np.cumsum(w), rng_b.random()))]
        clon = lo + (rng_b.random() - 0.5) * 0.25
        clat = la + (rng_b.random() - 0.5) * 0.25
        side = int(math.isqrt(BG_PER_PATCH))
        patch = []
        for i in range(side):
            for j in range(side):
                dlat = (i - (side - 1) / 2) * BG_SPACING_M / 110574.0
                dlon = (j - (side - 1) / 2) * BG_SPACING_M / (111320.0 * math.cos(math.radians(clat)))
                plon, plat = clon + dlon, clat + dlat
                if not mask(plon, plat):
                    continue
                st = wc.window_stats(plon, plat)
                if st is None:
                    continue
                x = exposure.x(plon, plat)
                patch.append({"label": -1, "lon": plon, "lat": plat, "exposure_x": x if x is not None else "",
                              "exposure_bin": PF.exposure_bin(x) if x is not None else "", **st})
        if len(patch) >= BG_PER_PATCH * 0.6:
            bg.extend(patch)
    meta["background_ner"] = {"patches_target": BG_PATCHES, "per_patch": BG_PER_PATCH, "points": len(bg),
                              "spacing_m": BG_SPACING_M, "sampling": "clustered patches, area-weighted cell choice"}
    print("background points:", len(bg), flush=True)

    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", VSI_CACHE="TRUE", VSI_CACHE_SIZE=200000000,
                      GDAL_CACHEMAX=512, GDAL_HTTP_MULTIPLEX="YES"):
        dem = PF.DemSource()
        prows = add_terrain(prows, dem, dropped, "positives")
        naive = add_terrain([{**c, "label": 0} for c in naive], dem, dropped, "negatives_naive")
        expo = add_terrain([{**c, "label": 0} for c in expo], dem, dropped, "negatives_exposure")
        bg = add_terrain(bg, dem, dropped, "background")
    pilot_dem = PF.DemSource(P.RAW_DIR / "copdem" / f"{P.PILOT_SLUG}_copdem_glo30.tif")
    fc = json.loads((P.OUT / "grid_cells.geojson").read_text())
    pilot = []
    for f in fc["features"]:
        lon, lat = f["properties"]["centroid"]
        t = PF.terrain_features(pilot_dem, lon, lat)
        if t is None:
            dropped["pilot_dem_gap"] += 1
            continue
        sf = f["properties"]["static_features"]
        pilot.append({"label": -1, "lon": lon, "lat": lat, "event_id": f["properties"]["grid_code"],
                      "landcover_class": sf.get("landcover_class", ""),
                      "landcover_tree_share": sf.get("landcover_tree_share", ""), **t})

    write_rows(OUT / "positives.csv", prows)
    write_rows(OUT / "negatives_naive.csv", naive)
    write_rows(OUT / "negatives_exposure.csv", expo)
    write_rows(OUT / "background_ner.csv", bg)
    write_rows(OUT / "pilot_grid_features.csv", pilot)
    write_rows(OUT / "stage_a_v2_naive.csv", prows + naive)
    write_rows(OUT / "stage_a_v2_exposure.csv", prows + expo)
    meta["rows"] = {"positives": len(prows), "negatives_naive": len(naive), "negatives_exposure": len(expo),
                    "background_ner": len(bg), "pilot_cells": len(pilot)}
    meta["dropped"] = dict(dropped)
    # sanity: no positive/negative coincidence
    mind = {}
    for name, negs in (("naive", naive), ("exposure", expo)):
        mind[name] = round(min(haversine_m(n["lon"], n["lat"], p["lon"], p["lat"]) for n in negs for p in prows), 1)
    meta["min_positive_negative_distance_m"] = mind
    (OUT / "build_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
