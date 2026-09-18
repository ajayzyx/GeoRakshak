"""Data spike: terrain summary per candidate from Copernicus DEM GLO-30 COGs read remotely (windowed, /vsicurl/).

Usage: ml/.venv/bin/python ml/pipeline/spike_terrain.py  -> appends "terrain" to ml/reports/data-spike-counts.json
"""
import json, math
import numpy as np
import rasterio
from rasterio.merge import merge
from common import CANDIDATES, ML_DIR, candidate_bbox

def dem_urls(bbox):
    for lat in range(math.floor(bbox[1]), math.floor(bbox[3]) + 1):
        for lon in range(math.floor(bbox[0]), math.floor(bbox[2]) + 1):
            n = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
            yield f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"

def main():
    p = ML_DIR / "reports" / "data-spike-counts.json"
    d = json.loads(p.read_text())
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR", CPL_VSIL_CURL_ALLOWED_EXTENSIONS=".tif"):
        for slug in CANDIDATES:
            bbox = candidate_bbox(slug)
            srcs = [rasterio.open(u) for u in dem_urls(bbox)]
            arr, tr = merge(srcs, bounds=bbox)
            z = arr[0].astype("float64")
            lat = (bbox[1] + bbox[3]) / 2
            dy = abs(tr.e) * 111320.0
            dx = tr.a * 111320.0 * math.cos(math.radians(lat))
            gy, gx = np.gradient(z, dy, dx)
            slope = np.degrees(np.arctan(np.hypot(gx, gy)))
            t = {
                "dem_pixels": list(z.shape),
                "elevation_m_min": round(float(z.min()), 1), "elevation_m_max": round(float(z.max()), 1),
                "slope_deg_median": round(float(np.median(slope)), 1),
                "share_slope_gt_15deg": round(float((slope > 15).mean()), 3),
                "share_slope_gt_25deg": round(float((slope > 25).mean()), 3),
                "note": "Approximate: slope from geographic-grid gradient with local metre scaling (spike only).",
            }
            d["candidates"][slug]["terrain"] = t
            print(slug, t, flush=True)
    p.write_text(json.dumps(d, indent=2))

if __name__ == "__main__":
    main()
