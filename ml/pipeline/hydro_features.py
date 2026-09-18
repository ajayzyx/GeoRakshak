"""Hydrology / drainage features derived from the Copernicus DEM GLO-30 (no new data source).

Method, applied identically to training points, the NER background and the pilot cells:
1. A 6 km x 6 km window centred on the point is reprojected (bilinear) to 25 m in the point's UTM zone
   (EPSG:326xx), giving 241 x 241 pixels. The central 500 m cell is the inner 20 x 20 pixels.
2. Depressions are filled with the priority-flood algorithm (Barnes, Lehman & Mulla 2014).
3. D8 flow directions follow the steepest descent on the filled surface, weighting diagonals by 1/sqrt(2).
4. Flow accumulation is the upslope contributing area in m^2 (each cell contributes its own 625 m^2), summed by
   processing cells in order of decreasing filled elevation. **The contributing area is truncated by the 6 km
   window (at most ~36 km^2)**: this is a bounded hillslope-scale estimate, not a basin-wide one, and the same
   truncation applies to every point, so the feature is comparable across points.
5. TWI = ln(a / tan(beta)), with a = accumulation / 25 m (specific catchment area) and tan(beta) floored at
   tan(0.5 deg) so flat filled cells cannot produce infinities.
6. Drainage cells are those with accumulation >= 0.25 km^2. `dist_to_drainage_m` is the Euclidean distance from the
   window centre to the nearest such cell (scipy distance transform on the 25 m grid). If the window contains no
   drainage cell the feature is **missing** (None) - it is never filled with a substitute value. Because the window
   truncates the contributing area, ridge-top points often have no qualifying cell, so this feature carries real
   missingness (measured and reported; see the evaluation report). `elev_above_window_min_m`, the height of the
   centre above the lowest point of the 6 km window, is always defined and carries the hillslope-position signal.
7. Plan and profile curvature use the Zevenbergen & Thorne (1987) second derivatives on the unfilled 25 m surface;
   both are averaged over the central 500 m cell. Roughness is the terrain ruggedness index (mean absolute
   elevation difference to the 8 neighbours) over the same cell.

All of this is derived from the Copernicus DEM, so it inherits that licence, attribution and REAL_HISTORICAL
provenance.
"""

from __future__ import annotations

import heapq
import math

import numpy as np
from rasterio.transform import from_origin
from rasterio.warp import Resampling, reproject
from scipy import ndimage

import point_features as PF

RES = 25.0
WINDOW_HALF_M = 3000.0
CELL_HALF_M = 250.0
DRAINAGE_THRESHOLD_M2 = 0.25e6
SLOPE_FLOOR_RAD = math.radians(0.5)
# Hydrology features offered to the model. `dist_to_drainage_m` is admitted only when its measured missingness is
# within the pre-registered 5 % budget (train_stage_a_v4.py enforces that rule; at 90 m routing it is ~0.2 %,
# at 25 m routing it was ~20 %).
H6 = ["flow_acc_log10_m2_mean", "twi_mean", "elev_above_window_min_m", "plan_curvature_mean",
      "profile_curvature_mean", "roughness_tri_m", "dist_to_drainage_m"]
H_REPORTED_ONLY: list[str] = []

_NEIGH = [(-1, -1), (-1, 0), (-1, 1), (0, -1), (0, 1), (1, -1), (1, 0), (1, 1)]


def fill_depressions(z: np.ndarray) -> np.ndarray:
    """Priority-flood depression filling. Returns a filled copy (no epsilon gradient)."""
    n, m = z.shape
    filled = np.full((n, m), np.inf)
    closed = np.zeros((n, m), dtype=bool)
    heap = []
    for i in range(n):
        for j in (0, m - 1):
            heapq.heappush(heap, (float(z[i, j]), i, j))
            closed[i, j] = True
            filled[i, j] = z[i, j]
    for j in range(m):
        for i in (0, n - 1):
            if not closed[i, j]:
                heapq.heappush(heap, (float(z[i, j]), i, j))
                closed[i, j] = True
                filled[i, j] = z[i, j]
    while heap:
        zc, i, j = heapq.heappop(heap)
        for di, dj in _NEIGH:
            a, b = i + di, j + dj
            if 0 <= a < n and 0 <= b < m and not closed[a, b]:
                closed[a, b] = True
                filled[a, b] = max(float(z[a, b]), zc)
                heapq.heappush(heap, (filled[a, b], a, b))
    return filled


def d8_directions(filled: np.ndarray, res: float = RES):
    """Vectorised steepest-descent D8. Returns (di, dj, has_downslope) arrays; flow off the window just stops."""
    n, m = filled.shape
    pad = np.pad(filled, 1, mode="constant", constant_values=np.inf)  # inf: outside is never lower
    best = np.zeros((n, m))
    di_arr = np.zeros((n, m), dtype="int8")
    dj_arr = np.zeros((n, m), dtype="int8")
    for di, dj in _NEIGH:
        nb = pad[1 + di:1 + di + n, 1 + dj:1 + dj + m]
        grad = (filled - nb) / (res * (math.sqrt(2) if di and dj else 1.0))
        better = grad > best
        best = np.where(better, grad, best)
        di_arr = np.where(better, di, di_arr).astype("int8")
        dj_arr = np.where(better, dj, dj_arr).astype("int8")
    return di_arr, dj_arr, best > 0


def flow_accumulation(filled: np.ndarray, res: float = RES) -> np.ndarray:
    """D8 accumulation in m^2 (own cell included). Flow leaving the window is simply lost (documented truncation)."""
    n, m = filled.shape
    acc = np.full((n, m), res * res, dtype="float64")
    di_arr, dj_arr, has_down = d8_directions(filled, res)
    order = np.argsort(filled, axis=None)[::-1]
    accf, dif, djf, downf = acc.ravel(), di_arr.ravel(), dj_arr.ravel(), has_down.ravel()
    for idx in order:
        idx = int(idx)
        if not downf[idx]:
            continue
        i, j = divmod(idx, m)
        accf[(i + int(dif[idx])) * m + (j + int(djf[idx]))] += accf[idx]
    return acc


def zevenbergen_thorne(z: np.ndarray, res: float = RES):
    """Plan and profile curvature (1/m) on the interior of z (edges are NaN)."""
    zx = (np.roll(z, -1, 1) - np.roll(z, 1, 1)) / (2 * res)
    zy = (np.roll(z, 1, 0) - np.roll(z, -1, 0)) / (2 * res)      # +y = north
    zxx = (np.roll(z, -1, 1) - 2 * z + np.roll(z, 1, 1)) / res ** 2
    zyy = (np.roll(z, -1, 0) - 2 * z + np.roll(z, 1, 0)) / res ** 2
    zxy = (np.roll(np.roll(z, 1, 0), 1, 1) - np.roll(np.roll(z, 1, 0), -1, 1)
           - np.roll(np.roll(z, -1, 0), 1, 1) + np.roll(np.roll(z, -1, 0), -1, 1)) / (4 * res ** 2)
    p = zx ** 2 + zy ** 2
    small = p < 1e-12
    p_safe = np.where(small, 1.0, p)
    plan = (zxx * zy ** 2 - 2 * zxy * zx * zy + zyy * zx ** 2) / p_safe ** 1.5
    prof = (zxx * zx ** 2 + 2 * zxy * zx * zy + zyy * zy ** 2) / (p_safe * (1 + p_safe) ** 1.5)
    plan[small] = 0.0
    prof[small] = 0.0
    for arr in (plan, prof):
        arr[0, :] = arr[-1, :] = arr[:, 0] = arr[:, -1] = np.nan
    return plan, prof


def ruggedness(z: np.ndarray) -> np.ndarray:
    """Terrain ruggedness index: mean |dz| to the 8 neighbours (edges NaN)."""
    total = np.zeros_like(z)
    for di, dj in _NEIGH:
        total += np.abs(z - np.roll(np.roll(z, di, 0), dj, 1))
    tri = total / 8.0
    tri[0, :] = tri[-1, :] = tri[:, 0] = tri[:, -1] = np.nan
    return tri


def twi(acc: np.ndarray, filled: np.ndarray, res: float = RES) -> np.ndarray:
    """ln(a / tan beta) with a = accumulation / res and tan(beta) floored at tan(SLOPE_FLOOR_RAD)."""
    slope_tan = np.maximum(np.hypot((np.roll(filled, -1, 1) - np.roll(filled, 1, 1)) / (2 * res),
                                    (np.roll(filled, -1, 0) - np.roll(filled, 1, 0)) / (2 * res)),
                           math.tan(SLOPE_FLOOR_RAD))
    return np.log((acc / res) / slope_tan)


def hydro_features(dem: PF.DemSource, lon: float, lat: float, res: float = RES) -> dict | None:
    epsg = PF.utm_epsg(lon)
    cx, cy = PF._to_utm(epsg).transform(lon, lat)
    half = WINDOW_HALF_M + res
    xs, ys = PF._to_wgs(epsg).transform([cx - half, cx + half, cx - half, cx + half],
                                        [cy - half, cy - half, cy + half, cy + half])
    pad = 0.01
    got = dem.read((min(xs) - pad, min(ys) - pad, max(xs) + pad, max(ys) + pad))
    if got is None:
        return None
    src, src_tr, src_crs = got
    n = int(2 * WINDOW_HALF_M / res) + 1          # 241 at 25 m, 67 at 90 m
    z = np.full((n, n), np.nan)
    tr = from_origin(cx - WINDOW_HALF_M - res / 2, cy + WINDOW_HALF_M + res / 2, res, res)
    reproject(src, z, src_transform=src_tr, src_crs=src_crs, dst_transform=tr, dst_crs=f"EPSG:{epsg}",
              resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
    if np.isnan(z).any():
        return None

    filled = fill_depressions(z)
    acc = flow_accumulation(filled, res)
    twi_grid = twi(acc, filled, res)
    plan, prof = zevenbergen_thorne(z, res)
    tri = ruggedness(z)

    c = n // 2
    k = max(1, int(round(CELL_HALF_M / res)))     # 10 px at 25 m, 3 px at 90 m
    sl = (slice(c - k, c + k), slice(c - k, c + k))
    drainage = acc >= DRAINAGE_THRESHOLD_M2
    if drainage.any():
        dist = ndimage.distance_transform_edt(~drainage, sampling=(res, res))
        dist_to_drainage = float(dist[c, c])
    else:
        dist_to_drainage = None                   # missing, never substituted
    return {
        "flow_acc_log10_m2_mean": float(np.log10(acc[sl]).mean()),
        "twi_mean": float(twi_grid[sl].mean()),
        "elev_above_window_min_m": float(z[c, c] - z.min()),
        "dist_to_drainage_m": dist_to_drainage,
        "plan_curvature_mean": float(np.nanmean(plan[sl])),
        "profile_curvature_mean": float(np.nanmean(prof[sl])),
        "roughness_tri_m": float(np.nanmean(tri[sl])),
    }
