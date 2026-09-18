"""Download the GSI public landslide inventory (Bhusanket portal, ArcGIS FeatureServer) for the NER states.

Service discovered 2026-09-18 from https://bhusanket.gsi.gov.in/json/config.json (no token needed for this layer):
  https://bhusanket.gsi.gov.in/gisserver/rest/services/Hosted/Public_Portal_Dashboard_Map/FeatureServer/0
Terms of use (https://bhusanket.gsi.gov.in/terms.html): material may be reproduced free of charge AFTER taking
permission by email, accurately, with the source prominently acknowledged. The download stays in gitignored
data/raw and is not redistributed.

Usage: ml/.venv/bin/python ml/pipeline/fetch_gsi_inventory.py
Output: ml/data/raw/gsi/gsi_landslide_public_ner.geojson (+ .meta.json)
"""
from __future__ import annotations

import json
import urllib.parse
from datetime import datetime, timezone

from common import RAW
from probe_sources import probe

LAYER = "https://bhusanket.gsi.gov.in/gisserver/rest/services/Hosted/Public_Portal_Dashboard_Map/FeatureServer/0"
NER_STATES = ["Mizoram", "Meghalaya", "Manipur", "Nagaland", "Assam", "Tripura", "Arunachal Pradesh", "Sikkim"]
FIELDS = ["objectid", "globalid", "state", "district", "subdivisio", "village", "locationde", "nh_sh_loca", "slide_name",
          "slide_no", "toposheet", "date", "date_acc", "geo_acc", "initiation", "initiati_1", "reactivati", "reactiva_1",
          "reactiva_2", "movement_t", "movement_r", "material_t", "triggering", "landslidec", "activity", "distributi",
          "style", "failure_me", "geology", "geomorphol", "landuse_la", "length", "width", "height", "depth", "ls_area",
          "ls_volume", "runout_dis", "peopledead", "peopleinju", "infrastruc", "roadblocke", "citation", "source",
          "class_type", "report", "latitude", "longitude"]
PAGE = 1000
OUT = RAW / "gsi" / "gsi_landslide_public_ner.geojson"


def fetch_state(state: str) -> list[dict]:
    feats, offset = [], 0
    while True:
        u = LAYER + "/query?" + urllib.parse.urlencode({
            "where": f"state='{state}'", "outFields": ",".join(FIELDS), "outSR": "4326", "f": "geojson",
            "resultOffset": offset, "resultRecordCount": PAGE, "orderByFields": "objectid ASC"})
        r = probe("gsi_bhusanket", u)
        if r["status"] != 200:
            raise RuntimeError(f"{state} offset {offset}: {r['result']}")
        d = json.loads(r["text"])
        got = d.get("features", [])
        feats.extend(got)
        if len(got) < PAGE:
            return feats
        offset += PAGE


def main():
    all_feats, per_state = [], {}
    for s in NER_STATES:
        f = fetch_state(s)
        per_state[s] = len(f)
        all_feats.extend(f)
        print(f"  {s}: {len(f)}", flush=True)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"type": "FeatureCollection", "features": all_feats}))
    meta = {"retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "layer": LAYER,
            "states": per_state, "total": len(all_feats), "fields": FIELDS,
            "terms_url": "https://bhusanket.gsi.gov.in/terms.html",
            "terms_summary": "Reproduction free of charge after permission by email; accurate use; source prominently acknowledged."}
    OUT.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2))
    print(json.dumps(meta, indent=1))


if __name__ == "__main__":
    main()
