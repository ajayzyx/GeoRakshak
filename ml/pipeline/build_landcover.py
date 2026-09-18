"""Step 2: majority ESA WorldCover 2021 v200 class per cell -> static_features.landcover_class (+ tree share).

Reads the public 10 m COG remotely (windowed), saves the clipped raster to data/raw/worldcover/.
"""

from __future__ import annotations

import json
import math

import numpy as np
import rasterio
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from rasterio.windows import from_bounds

import pilot_config as P

BUF = 0.01


def tile_url(lat3, lon3):
    return ("https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/"
            f"ESA_WorldCover_10m_2021_v200_N{lat3:02d}E{lon3:03d}_Map.tif")


def main():
    b = P.BBOX
    bounds = (b[0] - BUF, b[1] - BUF, b[2] + BUF, b[3] + BUF)
    tiles = {(3 * math.floor(la / 3), 3 * math.floor(lo / 3)) for la in (bounds[1], bounds[3]) for lo in (bounds[0], bounds[2])}
    if len(tiles) != 1:
        raise NotImplementedError("pilot bbox spans several WorldCover tiles")
    url = tile_url(*tiles.pop())
    raw = P.RAW_DIR / "worldcover" / f"{P.PILOT_SLUG}_worldcover_2021_v200.tif"
    if not raw.exists():
        raw.parent.mkdir(parents=True, exist_ok=True)
        with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"), rasterio.open("/vsicurl/" + url) as src:
            win = from_bounds(*bounds, transform=src.transform).round_offsets().round_lengths()
            arr = src.read(1, window=win)
            prof = {"driver": "GTiff", "dtype": arr.dtype, "count": 1, "height": arr.shape[0], "width": arr.shape[1],
                    "crs": src.crs, "transform": src.window_transform(win), "compress": "deflate", "nodata": 0}
        with rasterio.open(raw, "w", **prof) as dst:
            dst.write(arr, 1)

    gpath = P.OUT / "grid_cells.geojson"
    fc = json.loads(gpath.read_text())
    g = fc["grid"]
    x0, y0, ncols, nrows = g["origin_xy"][0], g["origin_xy"][1], g["ncols"], g["nrows"]
    k = P.CELL_SIZE_M // P.LC_RES_M
    lc = np.zeros((nrows * k, ncols * k), dtype="uint8")
    tr = from_origin(x0, y0 + nrows * P.CELL_SIZE_M, P.LC_RES_M, P.LC_RES_M)
    with rasterio.open(raw) as src:
        reproject(rasterio.band(src, 1), lc, dst_transform=tr, dst_crs=P.PROJECTED_CRS,
                  resampling=Resampling.nearest, src_nodata=0, dst_nodata=0)
    counts = {}
    for f in fc["features"]:
        _, row, col = f["properties"]["grid_code"].split("-")
        row, col = int(row), int(col)
        pr0 = (nrows - 1 - row) * k
        block = lc[pr0:pr0 + k, col * k:col * k + k]
        valid = block[block > 0]
        sf, prov, src_ = f["properties"]["static_features"], f["properties"]["feature_provenance"], f["properties"]["feature_sources"]
        if valid.size < 0.5 * block.size:
            continue  # not enough valid pixels: leave feature absent (no imputation)
        bc = np.bincount(valid, minlength=101)
        cls = int(bc.argmax())
        sf["landcover_class"] = cls
        sf["landcover_tree_share"] = round(float(bc[10] / valid.size), 3)
        for name in ("landcover_class", "landcover_tree_share"):
            prov[name] = "REAL_HISTORICAL"
            src_[name] = "esa-worldcover-2021"
        counts[cls] = counts.get(cls, 0) + 1
    fc["grid"]["landcover_url"] = url
    gpath.write_text(json.dumps(fc))
    print("majority class counts:", dict(sorted(counts.items())))


if __name__ == "__main__":
    main()
