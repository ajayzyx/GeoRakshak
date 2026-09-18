"""Stage A v4: add DEM hydrology and SoilGrids soil features to the unchanged v3 points.

The label design (GSI positives, exposure-matched negatives), the NER background and the pilot grid are the v3
files, point for point; only extra feature columns are added, so v3-vs-v4 is a clean before/after comparison.

Usage: ml/.venv/bin/python ml/pipeline/stage_a_v4_features.py
Outputs (ml/data/processed/training/v4/): the same file names as v3 plus the hydrology and soil columns,
and build_meta.json with per-feature missingness for every file.
"""

from __future__ import annotations

import csv
import json
import os
from concurrent.futures import ProcessPoolExecutor
from datetime import datetime, timezone

import rasterio

import hydro_features as H
import point_features as PF
import soil_features as S
from common import PROCESSED, RAW

V3 = PROCESSED / "training" / "v3"
OUT = PROCESSED / "training" / "v4"
FILES = ["positives.csv", "negatives_naive.csv", "negatives_exposure.csv", "background_ner.csv",
         "pilot_grid_features.csv"]
NEW_COLUMNS = H.H6 + H.H_REPORTED_ONLY + S.S5
HYDRO_RES = 90.0   # Copernicus DEM GLO-90; see fetch_dem_tiles.py for why the 6 km routing window uses 90 m


WORKERS = int(os.environ.get("V4_WORKERS", "6"))
_W: dict = {}


def _init_worker():
    """Each worker keeps its own GDAL environment, DEM handles and soil rasters (reads are network-bound)."""
    env = rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", VSI_CACHE="TRUE", VSI_CACHE_SIZE=100000000,
                       GDAL_CACHEMAX=256, GDAL_HTTP_MULTIPLEX="YES")
    env.__enter__()
    _W["env"] = env
    _W["dem"] = PF.DemSource(tile_dir=RAW / "copdem90")   # local GLO-90 tiles (see fetch_dem_tiles.py)
    _W["soil"] = S.SoilGrids()


def _one(task):
    idx, lon, lat = task
    try:
        h = H.hydro_features(_W["dem"], lon, lat, res=HYDRO_RES)
    except rasterio.errors.RasterioIOError:   # transient remote read failure: leave the row incomplete
        h = None
    return idx, h, (_W["soil"].sample(lon, lat) if h is not None else None)


def process(rows, label):
    """Feature extraction in parallel; the row order of the input is preserved."""
    tasks = [(i, float(r["lon"]), float(r["lat"])) for i, r in enumerate(rows)]
    out = [None] * len(rows)
    done = 0
    with ProcessPoolExecutor(max_workers=WORKERS, initializer=_init_worker) as ex:
        # contiguous slices keep each worker in one region, which keeps the GDAL block cache warm
        for idx, h, soil_vals in ex.map(_one, tasks, chunksize=25):
            r = rows[idx]
            if h is None:
                out[idx] = dict(r, **{k: "" for k in NEW_COLUMNS}, hydro_window_failed=1)
            else:
                out[idx] = dict(r, **{k: ("" if v is None else round(v, 6)) for k, v in h.items()},
                                **{k: ("" if v is None else round(v, 4)) for k, v in soil_vals.items()},
                                hydro_window_failed=0)
            done += 1
            if done % 250 == 0:
                print(f"  {label}: {done}/{len(rows)}", flush=True)
    return out


def missingness(rows, cols):
    return {c: round(sum(1 for r in rows if r.get(c) in (None, "")) / max(1, len(rows)), 4) for c in cols}


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    soil = S.SoilGrids()
    meta = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "source_points": "identical to ml/data/processed/training/v3 (same seeds, same designs)",
            "hydrology": {"source": "derived from Copernicus DEM GLO-90 (local tiles)", "window_m": 2 * H.WINDOW_HALF_M,
                          "res_m": HYDRO_RES, "drainage_threshold_m2": H.DRAINAGE_THRESHOLD_M2,
                          "features": H.H6, "reported_only": H.H_REPORTED_ONLY,
                          "algorithms": "priority-flood fill; D8 accumulation (window-truncated); "
                                        "TWI with tan(beta) floored at tan(0.5 deg); Zevenbergen-Thorne curvature; TRI"},
            "soil": {"features": S.S5, "layers": soil.meta.get("layers", {}),
                     "licence": soil.meta.get("licence"), "attribution": soil.meta.get("attribution"),
                     "retrieved_at": soil.meta.get("retrieved_at")},
            "missingness": {}}
    if True:
        for fn in FILES:
            rows = list(csv.DictReader(open(V3 / fn)))
            done = OUT / fn
            if done.exists():                      # resume: reuse a file that already has every row
                prev = list(csv.DictReader(open(done)))
                if len(prev) == len(rows) and all(c in prev[0] for c in NEW_COLUMNS):
                    rows = prev
                    meta["missingness"][fn] = {"rows": len(rows), **missingness(rows, NEW_COLUMNS)}
                    print(fn, "reused", json.dumps(meta["missingness"][fn]), flush=True)
                    continue
            rows = process(rows, fn)
            cols = list(rows[0].keys())
            with open(OUT / fn, "w", newline="") as fh:
                w = csv.DictWriter(fh, fieldnames=cols)
                w.writeheader()
                w.writerows(rows)
            meta["missingness"][fn] = {"rows": len(rows), **missingness(rows, NEW_COLUMNS)}
            print(fn, json.dumps(meta["missingness"][fn]), flush=True)
    for design in ("naive", "exposure"):
        pos = list(csv.DictReader(open(OUT / "positives.csv")))
        neg = list(csv.DictReader(open(OUT / f"negatives_{design}.csv")))
        cols = list(pos[0].keys())
        with open(OUT / f"stage_a_v4_{design}.csv", "w", newline="") as fh:
            w = csv.DictWriter(fh, fieldnames=cols)
            w.writeheader()
            w.writerows(pos + neg)
    (OUT / "build_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta["missingness"], indent=1))


if __name__ == "__main__":
    main()
