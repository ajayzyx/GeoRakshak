"""Step 1: 500 m analysis grid (built in UTM 46N, written as EPSG:4326) + terrain features from Copernicus DEM GLO-30.

Reads the public COG remotely (windowed), saves the clipped DEM to data/raw/copdem/, and writes
data/processed/<slug>/grid_cells.geojson with slope_deg_mean, slope_deg_max, elevation_m_mean, relief_m.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject

import pilot_config as P

DEM_BUFFER_DEG = 0.01


def dem_urls(bbox):
    for lat in range(math.floor(bbox[1] - DEM_BUFFER_DEG), math.floor(bbox[3] + DEM_BUFFER_DEG) + 1):
        for lon in range(math.floor(bbox[0] - DEM_BUFFER_DEG), math.floor(bbox[2] + DEM_BUFFER_DEG) + 1):
            n = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
            yield f"https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"


def grid_definition():
    """Snap the bbox envelope in UTM outward to CELL_SIZE_M. Returns (x0, y0, ncols, nrows)."""
    to_utm = Transformer.from_crs("EPSG:4326", P.PROJECTED_CRS, always_xy=True)
    b = P.BBOX
    xs, ys = to_utm.transform([b[0], b[2], b[0], b[2]], [b[1], b[1], b[3], b[3]])
    c = P.CELL_SIZE_M
    x0, y0 = math.floor(min(xs) / c) * c, math.floor(min(ys) / c) * c
    x1, y1 = math.ceil(max(xs) / c) * c, math.ceil(max(ys) / c) * c
    return x0, y0, int((x1 - x0) / c), int((y1 - y0) / c)


def fetch_dem(raw_path: Path):
    urls = list(dem_urls(P.BBOX))
    b = P.BBOX
    bounds = (b[0] - DEM_BUFFER_DEG, b[1] - DEM_BUFFER_DEG, b[2] + DEM_BUFFER_DEG, b[3] + DEM_BUFFER_DEG)
    if not raw_path.exists():
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"):
            srcs = [rasterio.open("/vsicurl/" + u) for u in urls]
            arr, tr = merge(srcs, bounds=bounds)
            profile = srcs[0].profile
        profile.update(driver="GTiff", height=arr.shape[1], width=arr.shape[2], transform=tr, count=1,
                       compress="deflate", tiled=False, blockxsize=None, blockysize=None)
        profile.pop("blockxsize"); profile.pop("blockysize")
        raw_path.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.open(raw_path, "w", **profile) as dst:
            dst.write(arr)
    return urls


def horn_slope_deg(z: np.ndarray, res: float) -> np.ndarray:
    p = np.pad(z, 1, mode="constant", constant_values=np.nan)
    a, b_, c = p[:-2, :-2], p[:-2, 1:-1], p[:-2, 2:]
    d, f = p[1:-1, :-2], p[1:-1, 2:]
    g, h, i = p[2:, :-2], p[2:, 1:-1], p[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * res)
    dzdy = ((g + 2 * h + i) - (a + 2 * b_ + c)) / (8 * res)
    return np.degrees(np.arctan(np.hypot(dzdx, dzdy)))


def main():
    P.OUT.mkdir(parents=True, exist_ok=True)
    raw_dem = P.RAW_DIR / "copdem" / f"{P.PILOT_SLUG}_copdem_glo30.tif"
    urls = fetch_dem(raw_dem)

    x0, y0, ncols, nrows = grid_definition()
    r = P.DEM_RES_M
    k = P.CELL_SIZE_M // r
    # 1 cell (k px) margin on each side so the slope kernel has neighbours at the grid edge
    width, height = (ncols + 2) * k, (nrows + 2) * k
    dst_tr = from_origin(x0 - P.CELL_SIZE_M, y0 + nrows * P.CELL_SIZE_M + P.CELL_SIZE_M, r, r)
    z = np.full((height, width), np.nan, dtype="float64")
    with rasterio.open(raw_dem) as src:
        reproject(rasterio.band(src, 1), z, dst_transform=dst_tr, dst_crs=P.PROJECTED_CRS,
                  resampling=Resampling.bilinear, dst_nodata=np.nan)
    slope = horn_slope_deg(z, r)

    to_wgs = Transformer.from_crs(P.PROJECTED_CRS, "EPSG:4326", always_xy=True)
    b = P.BBOX
    feats = []
    for row in range(nrows):  # row 0 = southernmost
        for col in range(ncols):
            cx0, cy0 = x0 + col * P.CELL_SIZE_M, y0 + row * P.CELL_SIZE_M
            ccx, ccy = cx0 + P.CELL_SIZE_M / 2, cy0 + P.CELL_SIZE_M / 2
            lon, lat = to_wgs.transform(ccx, ccy)
            if not (b[0] <= lon <= b[2] and b[1] <= lat <= b[3]):
                continue
            # pixel window (raster row 0 is north); +k for margin
            pr0 = (nrows - 1 - row) * k + k
            pc0 = col * k + k
            zc = z[pr0:pr0 + k, pc0:pc0 + k]
            sc = slope[pr0:pr0 + k, pc0:pc0 + k]
            if np.isnan(zc).any() or np.isnan(sc).any():
                raise RuntimeError(f"DEM gap in cell row={row} col={col}")
            ring_utm = [(cx0, cy0), (cx0 + P.CELL_SIZE_M, cy0), (cx0 + P.CELL_SIZE_M, cy0 + P.CELL_SIZE_M),
                        (cx0, cy0 + P.CELL_SIZE_M), (cx0, cy0)]
            ring = [[round(v, 6) for v in to_wgs.transform(x, y)] for x, y in ring_utm]
            feats.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "grid_code": f"{P.GRID_CODE_PREFIX}-{row:04d}-{col:04d}",
                    "centroid": [round(lon, 6), round(lat, 6)],
                    "static_features": {
                        "slope_deg_mean": round(float(sc.mean()), 2),
                        "slope_deg_max": round(float(sc.max()), 2),
                        "elevation_m_mean": round(float(zc.mean()), 1),
                        "relief_m": round(float(zc.max() - zc.min()), 1),
                    },
                    "feature_provenance": {
                        "slope_deg_mean": "REAL_HISTORICAL",
                        "slope_deg_max": "REAL_HISTORICAL",
                        "elevation_m_mean": "REAL_HISTORICAL",
                        "relief_m": "REAL_HISTORICAL",
                    },
                    "feature_sources": {
                        "slope_deg_mean": "copernicus-dem-glo30",
                        "slope_deg_max": "copernicus-dem-glo30",
                        "elevation_m_mean": "copernicus-dem-glo30",
                        "relief_m": "copernicus-dem-glo30",
                    },
                },
            })
    fc = {"type": "FeatureCollection",
          "grid": {"projected_crs": P.PROJECTED_CRS, "origin_xy": [x0, y0], "ncols": ncols, "nrows": nrows,
                   "cell_size_m": P.CELL_SIZE_M, "row_order": "row 0 = south", "dem_urls": urls,
                   "dem_processing": f"COG window -> bilinear reproject to {P.PROJECTED_CRS} at {r} m -> Horn slope; "
                                     "per-cell mean/max slope, mean elevation, relief = max-min elevation"},
          "features": feats}
    (P.OUT / "grid_cells.geojson").write_text(json.dumps(fc))
    s = np.array([f["properties"]["static_features"]["slope_deg_mean"] for f in feats])
    print(f"cells={len(feats)} grid={ncols}x{nrows} slope_mean: min={s.min()} median={np.median(s)} max={s.max()}")


if __name__ == "__main__":
    main()
