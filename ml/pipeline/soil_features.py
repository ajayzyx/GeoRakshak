"""Soil features sampled from the locally cached ISRIC SoilGrids rasters (fetch_soilgrids.py).

- SoilGrids v2 (250 m, CC-BY 4.0): clay, sand, bulk density (bdod) and coarse-fragment volume (cfvo) for the
  5-15 cm layer, downloaded over the NER training area through the ISRIC WCS.
- SoilGrids 2017 (v1) BDTICM: absolute depth to bedrock in cm (SoilGrids v2 has no depth-to-bedrock layer).

Each point takes the mean of the valid pixels in a 3 x 3 window (about 750 m at 250 m resolution, so it covers the
500 m analysis cell). MapServer returns 0 outside the soil mask, and 0 clay/sand/bulk-density/bedrock-depth is
physically implausible, so 0 is treated as **missing**. Missing stays missing: nothing is imputed.
"""

from __future__ import annotations

import json

import numpy as np
import rasterio
from rasterio.windows import Window

from common import RAW

DIR = RAW / "soilgrids"
S5 = ["clay_pct", "sand_pct", "bdod_kg_dm3", "cfvo_pct_vol", "bedrock_depth_cm"]
LAYERS = {  # feature -> (file, conversion factor to the unit in the feature name)
    "clay_pct": ("ner_clay_5-15cm.tif", 0.1),
    "sand_pct": ("ner_sand_5-15cm.tif", 0.1),
    "bdod_kg_dm3": ("ner_bdod_5-15cm.tif", 0.01),
    "cfvo_pct_vol": ("ner_cfvo_5-15cm.tif", 0.1),
    "bedrock_depth_cm": ("ner_bdticm_2017.tif", 1.0),
}


class SoilGrids:
    def __init__(self):
        self.ds = {}
        for name, (fn, _) in LAYERS.items():
            p = DIR / fn
            self.ds[name] = rasterio.open(p) if p.exists() else None
        meta_path = DIR / "fetch_meta.json"
        self.meta = json.loads(meta_path.read_text()) if meta_path.exists() else {}

    def sample(self, lon: float, lat: float) -> dict:
        out = {}
        for name, (_, factor) in LAYERS.items():
            ds = self.ds[name]
            out[name] = None
            if ds is None:
                continue
            row, col = ds.index(lon, lat)
            if not (0 <= row < ds.height and 0 <= col < ds.width):
                continue
            a = ds.read(1, window=Window(col - 1, row - 1, 3, 3), boundless=True,
                        fill_value=0 if ds.nodata is None else ds.nodata).astype("float64")
            bad = (a == 0) if ds.nodata is None else ((a == ds.nodata) | (a <= 0))
            valid = a[~bad]
            if valid.size:
                out[name] = float(valid.mean() * factor)
        return out
