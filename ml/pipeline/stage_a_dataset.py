"""Stage A (susceptibility) training table for an NER-wide training area (ml-strategy §4, §7).

Why not the pilot alone: the Aizawl pilot bbox holds only 19 NASA GLC/COOLR records (17 with accuracy <= 5 km,
8 with <= 1 km), too few for spatial block CV. The training area is therefore India-NER (8 states) records.

Design (case-control sampling, documented):
- Positives: COOLR/GLC records with country_code IN, admin_division in the 8 NER states, location accuracy in
  POSITIVE_ACCURACY; deduplicated to one sample per ~500 m window.
- Negatives ("unlabelled"): random points within NEG_MAX_DIST_M of a positive (same reporting region) and
  farther than NEG_MIN_DIST_M from ANY NER record with accuracy <= 5 km; NEG_RATIO per positive; seed SEED;
  WorldCover permanent-water windows are dropped.
- Features per ~500 m window centred on the point (geographic window, local metre scaling, approximation):
  slope_deg_mean, slope_deg_max, elevation_m_mean, relief_m (Copernicus DEM GLO-30 COG, remote windowed read);
  landcover_class (majority), landcover_tree_share, landcover_builtup_share (ESA WorldCover 2021 v200).
- past_landslide_density is NOT used (would leak labels without per-fold recomputation).

Usage: ml/.venv/bin/python ml/pipeline/stage_a_dataset.py [--accuracy 1km|5km]
Output: ml/data/processed/training/stage_a_<accuracy>.csv
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import random
import unicodedata
from collections import defaultdict

import numpy as np
import rasterio
from rasterio.windows import Window

from common import PROCESSED, RAW

NER_STATES = {"assam", "meghalaya", "mizoram", "manipur", "nagaland", "tripura", "arunachal pradesh", "sikkim"}
INVENTORY = RAW / "nasa_glc" / "coolr_reports_points_ner_bbox.geojson"
SEED = 42
NEG_RATIO = 5
NEG_MAX_DIST_M = 30000.0
NEG_MIN_DIST_M = 2000.0
HALF_PX_DEM = 8     # 17 x 17 px (~500 m) + 1 px margin for slope
HALF_PX_LC = 25     # 50 x 50 px at 10 m (~500 m)
ACC = {"exact": 0.0, "1km": 1000.0, "5km": 5000.0}


def norm(s):
    return unicodedata.normalize("NFKD", s or "").encode("ascii", "ignore").decode().strip().lower()


def haversine_m(lon1, lat1, lon2, lat2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * 6371008.8 * math.asin(math.sqrt(a))


def load_records():
    d = json.loads(INVENTORY.read_text())
    out = []
    for f in d["features"]:
        p = f["properties"]
        if p.get("country_code") != "IN" or norm(p.get("admin_division_name")) not in NER_STATES:
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        out.append({"lon": lon, "lat": lat, "acc": p.get("location_accuracy"), "event_id": str(p.get("event_id")),
                    "event_date": p.get("event_date"), "state": norm(p.get("admin_division_name"))})
    return out


def dem_url(lon, lat):
    n = f"Copernicus_DSM_COG_10_N{math.floor(lat):02d}_00_E{math.floor(lon):03d}_00_DEM"
    return f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"


def wc_url(lon, lat):
    la, lo = 3 * math.floor(lat / 3), 3 * math.floor(lon / 3)
    return ("/vsicurl/https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
            f"ESA_WorldCover_10m_2021_v200_N{la:02d}E{lo:03d}_Map.tif")


def terrain_features(ds, lon, lat):
    row, col = ds.index(lon, lat)
    h = HALF_PX_DEM + 1
    if row - h < 0 or col - h < 0 or row + h >= ds.height or col + h >= ds.width:
        return None
    z = ds.read(1, window=Window(col - h, row - h, 2 * h + 1, 2 * h + 1)).astype("float64")
    dy = abs(ds.transform.e) * 110574.0
    dx = ds.transform.a * 111320.0 * math.cos(math.radians(lat))
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, f = z[1:-1, :-2], z[1:-1, 2:]
    g, hh, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * dx)
    dzdy = ((g + 2 * hh + i) - (a + 2 * b + c)) / (8 * dy)
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    inner = z[1:-1, 1:-1]
    return {"slope_deg_mean": float(slope.mean()), "slope_deg_max": float(slope.max()),
            "elevation_m_mean": float(inner.mean()), "relief_m": float(inner.max() - inner.min())}


def landcover_features(ds, lon, lat):
    row, col = ds.index(lon, lat)
    h = HALF_PX_LC
    if row - h < 0 or col - h < 0 or row + h > ds.height or col + h > ds.width:
        return None
    v = ds.read(1, window=Window(col - h, row - h, 2 * h, 2 * h)).ravel()
    v = v[v > 0]
    if v.size < 0.5 * (2 * h) ** 2:
        return None
    bc = np.bincount(v, minlength=101)
    return {"landcover_class": int(bc.argmax()), "landcover_tree_share": float(bc[10] / v.size),
            "landcover_builtup_share": float(bc[50] / v.size)}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accuracy", choices=["1km", "5km"], default="1km")
    args = ap.parse_args()
    max_acc = 1000.0 if args.accuracy == "1km" else 5000.0
    rng = random.Random(SEED)

    records = load_records()
    good = [r for r in records if r["acc"] in ACC]  # <= 5 km: used for negative exclusion
    pos_all = [r for r in records if r["acc"] in ACC and ACC[r["acc"]] <= max_acc]
    # deduplicate positives within ~500 m
    positives = []
    for r in sorted(pos_all, key=lambda r: r["event_id"]):
        if all(haversine_m(r["lon"], r["lat"], q["lon"], q["lat"]) > 500 for q in positives):
            positives.append(r)
    print(f"NER India records={len(records)} acc<=5km={len(good)} positives({args.accuracy})={len(pos_all)} dedup={len(positives)}")

    negatives, tries = [], 0
    target = NEG_RATIO * len(positives)
    while len(negatives) < target and tries < target * 200:
        tries += 1
        anchor = rng.choice(positives)
        dist = NEG_MAX_DIST_M * math.sqrt(rng.random())
        ang = rng.random() * 2 * math.pi
        lat = anchor["lat"] + (dist * math.sin(ang)) / 110574.0
        lon = anchor["lon"] + (dist * math.cos(ang)) / (111320.0 * math.cos(math.radians(anchor["lat"])))
        if any(haversine_m(lon, lat, g["lon"], g["lat"]) < NEG_MIN_DIST_M for g in good):
            continue
        negatives.append({"lon": lon, "lat": lat, "acc": None, "event_id": None, "event_date": None, "state": anchor["state"]})

    samples = [dict(r, label=1) for r in positives] + [dict(r, label=0) for r in negatives]
    by_dem, by_wc = defaultdict(list), defaultdict(list)
    for idx, s in enumerate(samples):
        by_dem[dem_url(s["lon"], s["lat"])].append(idx)
        by_wc[wc_url(s["lon"], s["lat"])].append(idx)
    dropped = defaultdict(int)
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", GDAL_CACHEMAX=512, VSI_CACHE="TRUE"):
        for url, idxs in sorted(by_dem.items()):
            try:
                with rasterio.open(url) as ds:
                    for i in idxs:
                        t = terrain_features(ds, samples[i]["lon"], samples[i]["lat"])
                        if t is None:
                            dropped["dem_tile_edge"] += 1
                        else:
                            samples[i].update(t)
            except rasterio.errors.RasterioIOError as e:  # e.g. no tile (outside public coverage)
                dropped["dem_tile_missing"] += len(idxs)
                print("DEM open failed:", url, e)
            print("dem", url.rsplit("/", 1)[-1], len(idxs), flush=True)
        for url, idxs in sorted(by_wc.items()):
            with rasterio.open(url) as ds:
                for i in idxs:
                    lc = landcover_features(ds, samples[i]["lon"], samples[i]["lat"])
                    if lc is None:
                        dropped["worldcover_edge_or_nodata"] += 1
                    else:
                        samples[i].update(lc)
            print("worldcover", url.rsplit("/", 1)[-1], len(idxs), flush=True)

    rows = []
    for s in samples:
        if "slope_deg_mean" not in s or "landcover_class" not in s:
            continue
        if s["label"] == 0 and s["landcover_class"] == 80:
            dropped["negative_in_water"] += 1
            continue
        s["block_id"] = f"{math.floor(s['lat'] / 0.5) * 0.5:.1f}_{math.floor(s['lon'] / 0.5) * 0.5:.1f}"
        rows.append(s)
    out = PROCESSED / "training" / f"stage_a_{args.accuracy}.csv"
    out.parent.mkdir(parents=True, exist_ok=True)
    cols = ["label", "lon", "lat", "block_id", "state", "event_id", "acc", "slope_deg_mean", "slope_deg_max",
            "elevation_m_mean", "relief_m", "landcover_class", "landcover_tree_share", "landcover_builtup_share"]
    with open(out, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=cols, extrasaction="ignore")
        w.writeheader()
        for r in rows:
            w.writerow({k: (round(v, 6) if isinstance(v, float) else v) for k, v in r.items()})
    meta = {"accuracy": args.accuracy, "seed": SEED, "neg_ratio": NEG_RATIO, "neg_max_dist_m": NEG_MAX_DIST_M,
            "neg_min_dist_m": NEG_MIN_DIST_M, "records_ner_india": len(records), "records_acc_le_5km": len(good),
            "positives_before_dedup": len(pos_all), "positives_dedup": len(positives), "negatives_sampled": len(negatives),
            "rows_written": len(rows), "positives_written": sum(r["label"] for r in rows), "dropped": dict(dropped),
            "dem_tiles": len(by_dem), "worldcover_tiles": len(by_wc)}
    out.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
