"""Point-window feature extraction shared by the Stage A v2 training table, the NER background and the pilot grid.

Terrain (T6): 500 m x 500 m square centred on the point in its UTM zone; Copernicus DEM GLO-30 bilinearly resampled to
25 m with a 1-pixel margin; Horn slope/aspect. Same method as build_grid_terrain.py (grid cells are 20 x 20 px at 25 m).
WorldCover: local 2021 v200 tiles (data/raw/worldcover/tiles) -> 500 m window class statistics and the exposure
variable X (built-up block density in an 11 x 11 neighbourhood of 100 m blocks).
"""

from __future__ import annotations

import json
import math
import time
from functools import lru_cache
from pathlib import Path

import numpy as np
import rasterio
from pyproj import Transformer
from rasterio.merge import merge
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from rasterio.windows import Window

from common import ML_DIR, RAW

RES = 25.0
HALF = 250.0
K = int(2 * HALF / RES)  # 20
SLOPE_MIN_FOR_ASPECT = 2.0
T6 = ["slope_deg_mean", "slope_deg_max", "elevation_m_mean", "relief_m", "aspect_sin_mean", "aspect_cos_mean"]

WC_TILES = RAW / "worldcover" / "tiles"
INTERIM = ML_DIR / "data" / "interim"
BLOCKS_PER_DEG = 1200  # 100 m-ish blocks = 10 x 10 WorldCover pixels (1/12000 deg)
GRID_LON0, GRID_LON1, GRID_LAT0, GRID_LAT1 = 87, 99, 21, 30


def utm_epsg(lon: float) -> int:
    return 32600 + int((lon + 180) // 6) + 1


@lru_cache(maxsize=8)
def _to_utm(epsg: int) -> Transformer:
    return Transformer.from_crs("EPSG:4326", f"EPSG:{epsg}", always_xy=True)


@lru_cache(maxsize=8)
def _to_wgs(epsg: int) -> Transformer:
    return Transformer.from_crs(f"EPSG:{epsg}", "EPSG:4326", always_xy=True)


def dem_url(lat_i: int, lon_i: int) -> str:
    n = f"Copernicus_DSM_COG_10_N{lat_i:02d}_00_E{lon_i:03d}_00_DEM"
    return f"/vsicurl/https://copernicus-dem-30m.s3.amazonaws.com/{n}/{n}.tif"


def glo90_name(lat_i: int, lon_i: int) -> str:
    return f"Copernicus_DSM_COG_30_N{lat_i:02d}_00_E{lon_i:03d}_00_DEM.tif"


def glo90_url(lat_i: int, lon_i: int) -> str:
    stem = glo90_name(lat_i, lon_i)[:-4]
    return f"https://copernicus-dem-90m.s3.amazonaws.com/{stem}/{stem}.tif"


class DemSource:
    """Copernicus DEM tiles: remote GLO-30 by default, a single local raster, or a local GLO-90 tile directory."""

    def __init__(self, local_path: Path | None = None, tile_dir: Path | None = None):
        self.local = rasterio.open(local_path) if local_path else None
        self.tile_dir = tile_dir
        self.open = {}

    def _ds(self, lat_i, lon_i):
        key = (lat_i, lon_i)
        if key not in self.open:
            try:
                if self.tile_dir is not None:
                    p = self.tile_dir / glo90_name(lat_i, lon_i)
                    self.open[key] = rasterio.open(p) if p.exists() else None
                else:
                    self.open[key] = rasterio.open(dem_url(lat_i, lon_i))
            except rasterio.errors.RasterioIOError:
                self.open[key] = None
        return self.open[key]

    def read(self, bounds, retries: int = 3):
        """Return (array, transform, crs) covering lon/lat bounds, or None.

        Remote range reads occasionally fail (truncated tile); the read is retried with fresh datasets.
        """
        tiles = []
        if self.local is None:
            for la in range(math.floor(bounds[1]), math.floor(bounds[3]) + 1):
                for lo in range(math.floor(bounds[0]), math.floor(bounds[2]) + 1):
                    tiles.append((la, lo))
        for attempt in range(retries):
            if self.local is not None:
                srcs = [self.local]
            else:
                srcs = []
                for key in tiles:
                    ds = self._ds(*key)
                    if ds is None:
                        return None
                    srcs.append(ds)
            b = srcs[0].bounds
            if len(srcs) == 1 and not (b.left <= bounds[0] and b.right >= bounds[2]
                                       and b.bottom <= bounds[1] and b.top >= bounds[3]):
                return None
            try:
                arr, tr = merge(srcs, bounds=bounds, nodata=np.nan, dtype="float64")
                return arr[0], tr, srcs[0].crs
            except rasterio.errors.RasterioIOError:
                if self.local is not None or self.tile_dir is not None or attempt == retries - 1:
                    return None
                for key in tiles:          # drop the cached handles and reopen on the next attempt
                    ds = self.open.pop(key, None)
                    if ds is not None:
                        ds.close()
                time.sleep(2 * (attempt + 1))
        return None


def terrain_features(dem: DemSource, lon: float, lat: float) -> dict | None:
    epsg = utm_epsg(lon)
    cx, cy = _to_utm(epsg).transform(lon, lat)
    m = HALF + RES
    xs, ys = _to_wgs(epsg).transform([cx - m, cx + m, cx - m, cx + m], [cy - m, cy - m, cy + m, cy + m])
    pad = 0.0015
    bounds = (min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad)
    got = dem.read(bounds)
    if got is None:
        return None
    src, src_tr, src_crs = got
    z = np.full((K + 2, K + 2), np.nan)
    reproject(src, z, src_transform=src_tr, src_crs=src_crs, dst_transform=from_origin(cx - m, cy + m, RES, RES),
              dst_crs=f"EPSG:{epsg}", resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
    if np.isnan(z).any():
        return None
    a, b, c = z[:-2, :-2], z[:-2, 1:-1], z[:-2, 2:]
    d, f = z[1:-1, :-2], z[1:-1, 2:]
    g, h, i = z[2:, :-2], z[2:, 1:-1], z[2:, 2:]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * RES)   # east
    dzdy = ((g + 2 * h + i) - (a + 2 * b + c)) / (8 * RES)   # toward south
    slope = np.degrees(np.arctan(np.hypot(dzdx, dzdy)))
    aspect = np.arctan2(-dzdx, dzdy)  # downslope direction, clockwise from north
    inner = z[1:-1, 1:-1]
    sel = slope >= SLOPE_MIN_FOR_ASPECT
    return {
        "slope_deg_mean": float(slope.mean()), "slope_deg_max": float(slope.max()),
        "elevation_m_mean": float(inner.mean()), "relief_m": float(inner.max() - inner.min()),
        "aspect_sin_mean": float(np.sin(aspect[sel]).mean()) if sel.any() else 0.0,
        "aspect_cos_mean": float(np.cos(aspect[sel]).mean()) if sel.any() else 0.0,
        "utm_epsg": epsg,
    }


# ----------------------------------------------------------------------------------------------- WorldCover

def wc_tile_path(lat: float, lon: float) -> Path:
    la, lo = 3 * math.floor(lat / 3), 3 * math.floor(lon / 3)
    return WC_TILES / f"ESA_WorldCover_10m_2021_v200_N{la:02d}E{lo:03d}_Map.tif"


class WorldCover:
    def __init__(self):
        self.open = {}

    def _ds(self, path: Path):
        if path not in self.open:
            self.open[path] = rasterio.open(path) if path.exists() else None
        return self.open[path]

    def window_stats(self, lon: float, lat: float) -> dict | None:
        ds = self._ds(wc_tile_path(lat, lon))
        if ds is None:
            return None
        hr = round(HALF / (ds.res[1] * 111320.0))
        hc = round(HALF / (ds.res[0] * 111320.0 * math.cos(math.radians(lat))))
        row, col = ds.index(lon, lat)
        v = ds.read(1, window=Window(col - hc, row - hr, 2 * hc, 2 * hr), boundless=True, fill_value=0).ravel()
        valid = v[v > 0]
        if valid.size < 0.5 * v.size:
            return None
        bc = np.bincount(valid, minlength=101)
        return {"landcover_class": int(bc.argmax()), "landcover_tree_share": float(bc[10] / valid.size),
                "builtup_share_500m": float(bc[50] / valid.size), "wc_valid_share": float(valid.size / v.size)}


def builtup_grid_path() -> Path:
    return INTERIM / "worldcover2021_builtup_any_100m.npy"


def build_builtup_grid(tiles: list[Path]) -> np.ndarray:
    """uint8 grid (rows from 30N southward, cols from 87E eastward) of 10x10-pixel blocks containing any class 50."""
    rows, cols = (GRID_LAT1 - GRID_LAT0) * BLOCKS_PER_DEG, (GRID_LON1 - GRID_LON0) * BLOCKS_PER_DEG
    grid = np.zeros((rows, cols), dtype=np.uint8)
    covered = np.zeros((rows, cols), dtype=np.uint8)
    for p in tiles:
        with rasterio.open(p) as ds:
            lon0, lat1 = round(ds.bounds.left), round(ds.bounds.top)
            r0, c0 = (GRID_LAT1 - lat1) * BLOCKS_PER_DEG, (lon0 - GRID_LON0) * BLOCKS_PER_DEG
            step = 3600
            for pr in range(0, ds.height, step):
                for pc in range(0, ds.width, step):
                    a = ds.read(1, window=Window(pc, pr, step, step))
                    blk = a.reshape(step // 10, 10, step // 10, 10)
                    grid[r0 + pr // 10:r0 + (pr + step) // 10, c0 + pc // 10:c0 + (pc + step) // 10] = (blk == 50).any(axis=(1, 3))
                    covered[r0 + pr // 10:r0 + (pr + step) // 10, c0 + pc // 10:c0 + (pc + step) // 10] = (blk > 0).any(axis=(1, 3))
        print("builtup grid:", p.name, flush=True)
    INTERIM.mkdir(parents=True, exist_ok=True)
    np.save(builtup_grid_path(), grid)
    np.save(INTERIM / "worldcover2021_covered_100m.npy", covered)
    (INTERIM / "worldcover2021_builtup_any_100m.json").write_text(json.dumps({
        "blocks_per_deg": BLOCKS_PER_DEG, "lon0": GRID_LON0, "lat1": GRID_LAT1, "tiles": [p.name for p in tiles],
        "definition": "1 if any ESA WorldCover 2021 v200 pixel in the 10x10 pixel block has class 50 (built-up)"}))
    return grid


class Exposure:
    NEIGH = 5  # 11 x 11 blocks

    def __init__(self):
        self.grid = np.load(builtup_grid_path(), mmap_mode="r")
        self.covered = np.load(INTERIM / "worldcover2021_covered_100m.npy", mmap_mode="r")

    def x(self, lon: float, lat: float) -> float | None:
        r = int(math.floor((GRID_LAT1 - lat) * BLOCKS_PER_DEG))
        c = int(math.floor((lon - GRID_LON0) * BLOCKS_PER_DEG))
        n = self.NEIGH
        if r - n < 0 or c - n < 0 or r + n >= self.grid.shape[0] or c + n >= self.grid.shape[1]:
            return None
        cov = self.covered[r - n:r + n + 1, c - n:c + n + 1]
        if cov.mean() < 0.5:
            return None
        return float(self.grid[r - n:r + n + 1, c - n:c + n + 1].mean())


EXPOSURE_BINS = [(-1e-9, 0.0), (0.0, 0.1), (0.1, 0.3), (0.3, 0.6), (0.6, 1.0)]  # (lo, hi]; first bin is X == 0


def exposure_bin(x: float) -> int:
    if x <= 0.0:
        return 0
    for i, (lo, hi) in enumerate(EXPOSURE_BINS[1:], start=1):
        if lo < x <= hi:
            return i
    return len(EXPOSURE_BINS) - 1
