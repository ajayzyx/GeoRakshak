"""Data spike: per-candidate counts from real sources (NASA GLC, OSM Overpass, Copernicus DEM, WorldCover).

Usage: ml/.venv/bin/python ml/pipeline/spike_counts.py
Writes ml/reports/data-spike-counts.json (inputs to ml/reports/data-spike.md).
"""

from __future__ import annotations

import collections
import csv
import json
import math
from datetime import datetime, timezone

import requests

from common import CANDIDATES, ML_DIR, RAW, USER_AGENT, candidate_bbox, overpass

GLC_CSV = RAW / "nasa_glc" / "Global_Landslide_Catalog_Export_rows.csv"
COOLR_GEOJSON = RAW / "nasa_glc" / "coolr_reports_points_ner_bbox.geojson"


def coolr_counts(bbox):
    feats = json.loads(COOLR_GEOJSON.read_text())["features"]
    ins = [f["properties"] for f in feats
           if bbox[0] <= f["geometry"]["coordinates"][0] <= bbox[2] and bbox[1] <= f["geometry"]["coordinates"][1] <= bbox[3]]
    years = collections.Counter(
        datetime.fromtimestamp(p["event_date"] / 1000, timezone.utc).year for p in ins if p["event_date"])
    return {
        "total": len(ins),
        "by_location_accuracy": dict(collections.Counter(p["location_accuracy"] for p in ins)),
        "accuracy_le_5km": sum(p["location_accuracy"] in ("exact", "1km", "5km") for p in ins),
        "by_year": dict(sorted(years.items())),
        "by_import_source": dict(collections.Counter(p["event_import_source"] for p in ins)),
        "with_fatalities": sum(1 for p in ins if (p["fatality_count"] or 0) > 0),
    }


def glc_counts(bbox):
    rows = list(csv.DictReader(open(GLC_CSV, encoding="utf-8")))
    ins = [r for r in rows if bbox[0] <= float(r["longitude"]) <= bbox[2] and bbox[1] <= float(r["latitude"]) <= bbox[3]]
    return {
        "total": len(ins),
        "by_location_accuracy": dict(collections.Counter(r["location_accuracy"] for r in ins)),
        "accuracy_le_5km": sum(r["location_accuracy"] in ("exact", "1km", "5km") for r in ins),
        "by_year": dict(sorted(collections.Counter(r["event_date"][6:10] for r in ins).items())),
        "by_category": dict(collections.Counter(r["landslide_category"] for r in ins)),
        "by_trigger": dict(collections.Counter(r["landslide_trigger"] for r in ins)),
    }


def osm_counts(slug, bbox):
    s, w, n, e = bbox[1], bbox[0], bbox[3], bbox[2]
    b = f"{s},{w},{n},{e}"
    q = f"""[out:json][timeout:90];
way[highway~"^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|track|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$"]({b});out count;
node[place~"^(city|town|village|hamlet)$"]({b});out count;
nwr[amenity~"^(school|college)$"]({b});out count;
nwr[amenity~"^(hospital|clinic|doctors)$"]({b});out count;
way[highway][bridge=yes]({b});out count;
nwr[amenity=shelter]({b});out count;
nwr[emergency=assembly_point]({b});out count;
"""
    d = overpass(q, cache=RAW / "osm" / f"spike_counts_{slug}.json")
    labels = ["highway_ways", "place_city_town_village_hamlet_nodes", "schools_colleges",
              "hospitals_clinics_doctors", "highway_bridge_ways", "amenity_shelter", "emergency_assembly_point"]
    return {
        "osm_base_timestamp": d.get("osm3s", {}).get("timestamp_osm_base"),
        **{lab: int(el["tags"]["total"]) for lab, el in zip(labels, d["elements"])},
    }


def dem_tiles(bbox):
    out = []
    for lat in range(math.floor(bbox[1]), math.floor(bbox[3]) + 1):
        for lon in range(math.floor(bbox[0]), math.floor(bbox[2]) + 1):
            name = f"Copernicus_DSM_COG_10_N{lat:02d}_00_E{lon:03d}_00_DEM"
            url = f"https://copernicus-dem-30m.s3.amazonaws.com/{name}/{name}.tif"
            r = requests.head(url, headers={"User-Agent": USER_AGENT}, timeout=60)
            out.append({"url": url, "http_status": r.status_code, "bytes": int(r.headers.get("Content-Length", 0))})
    return out


def worldcover_tiles(bbox):
    out = []
    for lat in {3 * math.floor(bbox[1] / 3), 3 * math.floor(bbox[3] / 3)}:
        for lon in {3 * math.floor(bbox[0] / 3), 3 * math.floor(bbox[2] / 3)}:
            url = f"https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N{lat:02d}E{lon:03d}_Map.tif"
            r = requests.head(url, headers={"User-Agent": USER_AGENT}, timeout=60)
            out.append({"url": url, "http_status": r.status_code, "bytes": int(r.headers.get("Content-Length", 0))})
    return out


def main():
    result = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "candidates": {}}
    for slug, c in CANDIDATES.items():
        bbox = candidate_bbox(slug)
        print("==", slug, bbox, flush=True)
        result["candidates"][slug] = {
            "name": c["name"], "bbox": bbox,
            "nasa_glc_legacy_export_csv": glc_counts(bbox),
            "nasa_coolr_reports_points": coolr_counts(bbox),
            "osm": osm_counts(slug, bbox),
            "copernicus_dem_tiles": dem_tiles(bbox),
            "worldcover_tiles": worldcover_tiles(bbox),
        }
        print(json.dumps(result["candidates"][slug], indent=1), flush=True)
    out = ML_DIR / "reports" / "data-spike-counts.json"
    out.write_text(json.dumps(result, indent=2))
    print("wrote", out)


if __name__ == "__main__":
    main()
