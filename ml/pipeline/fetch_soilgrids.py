"""Download ISRIC SoilGrids v2 layers over the NER training area (WCS) + SoilGrids 2017 depth to bedrock.

SoilGrids v2 (250 m, CC-BY 4.0): WCS 2.0.1 GetCoverage at https://maps.isric.org/mapserv?map=/map/<layer>.map
SoilGrids 2017 (v1) BDTICM (absolute depth to bedrock, cm, 250 m): global GeoTIFF read as a window via /vsicurl/.
Licence: ISRIC data policy, CC-BY 4.0 (https://www.isric.org/about/data-policy).

Usage: ml/.venv/bin/python ml/pipeline/fetch_soilgrids.py
Output: ml/data/raw/soilgrids/ner_<layer>.tif (+ fetch_meta.json)
"""
from __future__ import annotations

import json
import urllib.parse
from datetime import datetime, timezone

import numpy as np
import rasterio
from rasterio.windows import from_bounds

from common import RAW
from probe_sources import probe

BBOX = (88.0, 21.5, 97.5, 29.5)   # NER training area
WCS = "https://maps.isric.org/mapserv?"
LAYERS = {  # local name -> (map file, coverage id, unit, conversion factor to the stated unit)
    "clay_5-15cm": ("clay", "clay_5-15cm_mean", "percent", 0.1),
    "sand_5-15cm": ("sand", "sand_5-15cm_mean", "percent", 0.1),
    "bdod_5-15cm": ("bdod", "bdod_5-15cm_mean", "kg/dm3", 0.01),
    "cfvo_5-15cm": ("cfvo", "cfvo_5-15cm_mean", "percent_volume", 0.1),
}
BDTICM = "/vsicurl/https://files.isric.org/soilgrids/former/2017-03-10/data/BDTICM_M_250m_ll.tif"
OUT = RAW / "soilgrids"


def fetch_wcs(name, mapfile, coverage):
    dest = OUT / f"ner_{name}.tif"
    if dest.exists():
        return dest
    params = {"map": f"/map/{mapfile}.map", "SERVICE": "WCS", "VERSION": "2.0.1", "REQUEST": "GetCoverage",
              "COVERAGEID": coverage, "FORMAT": "image/tiff",
              "SUBSETTINGCRS": "http://www.opengis.net/def/crs/EPSG/0/4326",
              "SUBSET": [f"Long({BBOX[0]},{BBOX[2]})", f"Lat({BBOX[1]},{BBOX[3]})"],
              "OUTPUTCRS": "http://www.opengis.net/def/crs/EPSG/0/4326"}
    r = probe("soilgrids", WCS + urllib.parse.urlencode(params, doseq=True), save=dest)
    if r["status"] != 200 or not r["content_type"].startswith("image"):
        raise RuntimeError(f"{name}: {r['result']} {r['content_type']}")
    return dest


def fetch_bdticm():
    dest = OUT / "ner_bdticm_2017.tif"
    if dest.exists():
        return dest
    with rasterio.Env(GDAL_DISABLE_READDIR_ON_OPEN="EMPTY_DIR"), rasterio.open(BDTICM) as src:
        win = from_bounds(*BBOX, transform=src.transform).round_offsets().round_lengths()
        arr = src.read(1, window=win)
        prof = {"driver": "GTiff", "dtype": arr.dtype, "count": 1, "height": arr.shape[0], "width": arr.shape[1],
                "crs": src.crs, "transform": src.window_transform(win), "compress": "deflate", "nodata": src.nodata}
    dest.parent.mkdir(parents=True, exist_ok=True)
    with rasterio.open(dest, "w", **prof) as dst:
        dst.write(arr, 1)
    return dest


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    meta = {"retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "bbox": list(BBOX),
            "licence": "CC-BY 4.0 (ISRIC data policy, https://www.isric.org/about/data-policy)",
            "attribution": "Soil data: ISRIC - World Soil Information, SoilGrids v2 (250 m) and SoilGrids 2017 BDTICM",
            "layers": {}}
    for name, (mapfile, coverage, unit, factor) in LAYERS.items():
        p = fetch_wcs(name, mapfile, coverage)
        with rasterio.open(p) as s:
            a = s.read(1)
            meta["layers"][name] = {"endpoint": f"{WCS}map=/map/{mapfile}.map&…&COVERAGEID={coverage}",
                                    "file": p.name, "width": s.width, "height": s.height,
                                    "res_deg": [abs(s.res[0]), abs(s.res[1])], "dtype": str(a.dtype),
                                    "unit": unit, "conversion_factor": factor,
                                    "zero_share": round(float((a == 0).mean()), 4),
                                    "note": "value 0 is treated as no data (MapServer emits 0 outside the soil mask)"}
        print(name, meta["layers"][name]["width"], meta["layers"][name]["height"], meta["layers"][name]["zero_share"], flush=True)
    p = fetch_bdticm()
    with rasterio.open(p) as s:
        a = s.read(1)
        nod = s.nodata
        miss = float(np.mean(a == nod)) if nod is not None else float(np.mean(a <= 0))
        meta["layers"]["bdticm_2017"] = {"endpoint": BDTICM.replace("/vsicurl/", ""), "file": p.name,
                                         "width": s.width, "height": s.height, "res_deg": [abs(s.res[0]), abs(s.res[1])],
                                         "dtype": str(a.dtype), "unit": "cm (absolute depth to bedrock)",
                                         "conversion_factor": 1, "nodata": nod, "missing_share": round(miss, 4),
                                         "note": "SoilGrids 2017 (v1) product; v2 has no depth-to-bedrock layer"}
    print("bdticm", meta["layers"]["bdticm_2017"]["width"], meta["layers"]["bdticm_2017"]["missing_share"], flush=True)
    (OUT / "fetch_meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta["layers"], indent=1)[:600])


if __name__ == "__main__":
    main()
