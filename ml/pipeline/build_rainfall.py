"""Step 5: rainfall_daily.csv for a real monsoon replay window from IMD 0.25 deg gridded daily rainfall.

Download: HTTP POST rain=<year> to https://imdpune.gov.in/cmpg/Griddata/rainfall.php (form on
https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_Bin.html). File ind<year>_rfp25.grd: little-endian float32,
365/366 x 129 (lat 6.5..38.5 N, south->north) x 135 (lon 66.5..100.0 E), undefined = -999.0, unit mm/day.
Each pilot cell gets the value of the NEAREST 0.25 deg grid point (no interpolation). IMD's daily value at date D is
the 24 h accumulation reported for that date (see IMD documentation for the exact observation window).
"""

from __future__ import annotations

import csv
import json
from datetime import date, timedelta

import numpy as np
import requests

import pilot_config as P
from common import USER_AGENT

IMD_FORM = "https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_Bin.html"
IMD_POST = "https://imdpune.gov.in/cmpg/Griddata/rainfall.php"
SOURCE_SLUG = "imd-gridded-rainfall"
NLAT, NLON = 129, 135


def fetch_year(year: int):
    path = P.RAW_DIR / "imd_rf25" / f"ind{year}_rfp25.grd"
    if not path.exists():
        path.parent.mkdir(parents=True, exist_ok=True)
        r = requests.post(IMD_POST, data={"rain": str(year)}, headers={"User-Agent": USER_AGENT, "Referer": IMD_FORM},
                          timeout=600)
        r.raise_for_status()
        path.write_bytes(r.content)
    ndays = 366 if (year % 4 == 0 and (year % 100 != 0 or year % 400 == 0)) else 365
    size = path.stat().st_size
    if size != ndays * NLAT * NLON * 4:
        raise RuntimeError(f"unexpected IMD file size {size} for {year}")
    return np.fromfile(path, dtype="<f4").reshape(ndays, NLAT, NLON)


def main():
    arr = fetch_year(P.RAIN_YEAR)
    start, end = date.fromisoformat(P.RAIN_START), date.fromisoformat(P.RAIN_END)
    jan1 = date(P.RAIN_YEAR, 1, 1)
    fc = json.loads((P.OUT / "grid_cells.geojson").read_text())
    rows, skipped, gridpoints = 0, 0, set()
    with open(P.OUT / "rainfall_daily.csv", "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["grid_code", "date", "rainfall_mm", "source_slug", "provenance"])
        cells = []
        for c in fc["features"]:
            lon, lat = c["properties"]["centroid"]
            i, j = round((lat - 6.5) / 0.25), round((lon - 66.5) / 0.25)
            gridpoints.add((6.5 + i * 0.25, 66.5 + j * 0.25))
            cells.append((c["properties"]["grid_code"], i, j))
        d = start
        while d <= end:
            k = (d - jan1).days
            for code, i, j in cells:
                v = float(arr[k, i, j])
                if v <= -998:  # undefined in source: no row, no imputation
                    skipped += 1
                    continue
                w.writerow([code, d.isoformat(), round(v, 2), SOURCE_SLUG, "REAL_HISTORICAL"])
                rows += 1
            d += timedelta(days=1)
    summary = {}
    for la, lo in sorted(gridpoints):
        i, j = round((la - 6.5) / 0.25), round((lo - 66.5) / 0.25)
        s = arr[(start - jan1).days:(end - jan1).days + 1, i, j]
        summary[f"{la:.2f}N,{lo:.2f}E"] = {"total_mm": round(float(s.sum()), 1), "max_day_mm": round(float(s.max()), 1)}
    print(f"rows={rows} skipped_undefined={skipped} imd_gridpoints_used={len(gridpoints)}")
    print(json.dumps(summary, indent=1))


if __name__ == "__main__":
    main()
