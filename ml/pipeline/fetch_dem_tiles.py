"""Download the Copernicus DEM GLO-90 tiles needed for the v4 hydrology windows.

Why GLO-90 and not GLO-30: the hydrology features route flow over a 6 km window. Doing that from the 30 m tiles
meant thousands of remote range reads (measured at ~1 s and a few MB per point, i.e. tens of GB for the full point
set). The 90 m tiles are ~5.5 MB each, so the 46 tiles the point set needs are ~250 MB, everything is then read
locally, and the routing scale (6 km) is far coarser than either pixel. The 25 m terrain features (T6) are unchanged
and still come from GLO-30.

Usage: ml/.venv/bin/python ml/pipeline/fetch_dem_tiles.py
Output: ml/data/raw/copdem90/Copernicus_DSM_COG_30_N<lat>_00_E<lon>_00_DEM.tif (+ fetch_meta.json)
"""
from __future__ import annotations

import csv
import json
import math
from datetime import datetime, timezone

import point_features as PF
from common import PROCESSED, RAW
from probe_sources import probe

OUT = RAW / "copdem90"
MARGIN_DEG = 0.06
FILES = ["positives.csv", "negatives_naive.csv", "negatives_exposure.csv", "background_ner.csv",
         "pilot_grid_features.csv"]


def needed_tiles():
    tiles = set()
    for fn in FILES:
        for r in csv.DictReader(open(PROCESSED / "training" / "v3" / fn)):
            lon, lat = float(r["lon"]), float(r["lat"])
            for dlat in (-MARGIN_DEG, MARGIN_DEG):
                for dlon in (-MARGIN_DEG, MARGIN_DEG):
                    tiles.add((math.floor(lat + dlat), math.floor(lon + dlon)))
    return sorted(tiles)


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    tiles = needed_tiles()
    got, missing, total_bytes = [], [], 0
    for lat_i, lon_i in tiles:
        dest = OUT / PF.glo90_name(lat_i, lon_i)
        if dest.exists():
            got.append(dest.name)
            total_bytes += dest.stat().st_size
            continue
        r = probe("copdem90", PF.glo90_url(lat_i, lon_i), save=dest)
        if r["status"] == 200 and dest.exists():
            got.append(dest.name)
            total_bytes += dest.stat().st_size
        else:
            missing.append(PF.glo90_url(lat_i, lon_i))
    meta = {"retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "bucket": "https://copernicus-dem-90m.s3.amazonaws.com/", "tiles_needed": len(tiles),
            "tiles_downloaded": len(got), "bytes": total_bytes, "missing": missing,
            "licence": "Copernicus DEM licence (same as GLO-30); attribution: produced using Copernicus WorldDEM-90 "
                       "(c) DLR e.V. 2010-2014 and (c) Airbus Defence and Space GmbH 2014-2018 provided under "
                       "COPERNICUS by the European Union and ESA; all rights reserved"}
    (OUT / "fetch_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps({k: meta[k] for k in ("tiles_needed", "tiles_downloaded", "bytes", "missing")}, indent=1))


if __name__ == "__main__":
    main()
