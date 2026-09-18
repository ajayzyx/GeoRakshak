"""Step 4: historical landslides in the pilot bbox from three real inventories + past_landslide_density.

Sources (each record keeps its own source_slug):
1. `gsi-bhusanket`  - Geological Survey of India public landslide inventory (Bhusanket portal ArcGIS FeatureServer),
   surveyed points from GSI inventory / macro-scale (1:50,000) susceptibility mapping. Downloaded by
   fetch_gsi_inventory.py. Terms: reproduction after permission by e-mail, source prominently acknowledged.
2. `nasa-glc`       - NASA Global Landslide Catalog records via the COOLR Reports Points service (media-derived).
3. `zenodo-aizawl-rsf-2026` - Sarma & Paul (2026) Aizawl landslide inventory 2016-2025, CC-BY-4.0, dated events.

past_landslide_density now comes from the GSI inventory (surveyed) rather than the media catalogue.

Usage: ml/.venv/bin/python ml/pipeline/build_inventory.py
"""

from __future__ import annotations

import json
import math
from datetime import datetime, timezone

import requests
from pyproj import Transformer

import pilot_config as P
from common import USER_AGENT

GLC_SLUG = "nasa-glc"
GSI_SLUG = "gsi-bhusanket"
ZEN_SLUG = "zenodo-aizawl-rsf-2026"
COOLR_URL = "https://gis.earthdata.nasa.gov/portal/rest/services/Landslides/COOLR_Reports_Points/FeatureServer/0/query"
GSI_LAYER = "https://bhusanket.gsi.gov.in/gisserver/rest/services/Hosted/Public_Portal_Dashboard_Map/FeatureServer/0"
NER_BBOX = "88,21.5,97.5,29.5"
RAW_COOLR = P.RAW_DIR / "nasa_glc" / "coolr_reports_points_ner_bbox.geojson"
RAW_GSI = P.RAW_DIR / "gsi" / "gsi_landslide_public_ner.geojson"
RAW_ZEN = P.RAW_DIR / "zenodo" / "20783995" / "Aizawl_Landslide_Inventory_2015_2025.xlsx"
ACCURACY_M = {"1km": 1000.0, "5km": 5000.0, "10km": 10000.0, "25km": 25000.0, "50km": 50000.0,
              "100km": 100000.0, "250km": 250000.0}

# past_landslide_density: GSI records within DENSITY_RADIUS_M of the cell centroid / disc area.
DENSITY_SLUG = GSI_SLUG


def fetch_inventory():
    if RAW_COOLR.exists():
        return
    params = {"where": "1=1", "geometry": NER_BBOX, "geometryType": "esriGeometryEnvelope", "inSR": "4326",
              "spatialRel": "esriSpatialRelIntersects", "outFields": "*", "outSR": "4326", "f": "geojson"}
    r = requests.get(COOLR_URL, params=params, headers={"User-Agent": USER_AGENT}, timeout=300)
    r.raise_for_status()
    d = r.json()
    if d.get("exceededTransferLimit") or (d.get("properties") or {}).get("exceededTransferLimit"):
        raise RuntimeError("transfer limit exceeded; paginate")
    RAW_COOLR.parent.mkdir(parents=True, exist_ok=True)
    RAW_COOLR.write_text(r.text)


def to_date(ms):
    return None if ms is None else datetime.fromtimestamp(ms / 1000, timezone.utc).date().isoformat()


def in_bbox(lon, lat):
    b = P.BBOX
    return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]


def glc_features():
    out = []
    for f in json.loads(RAW_COOLR.read_text())["features"]:
        lon, lat = f["geometry"]["coordinates"][:2]
        if not in_bbox(lon, lat):
            continue
        p = f["properties"]
        out.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": {
            "event_date": to_date(p.get("event_date")),
            "event_date_precision": "EXACT" if p.get("event_date") else "UNKNOWN",
            "location_accuracy_m": ACCURACY_M.get(p.get("location_accuracy")),
            "location_accuracy_raw": p.get("location_accuracy"),
            "trigger": p.get("landslide_trigger"), "landslide_type": p.get("landslide_category"),
            "landslide_size": p.get("landslide_size"), "fatalities": p.get("fatality_count"),
            "title": p.get("event_title"), "location_description": p.get("location_description"),
            "source_name": p.get("source_name"), "source_link": p.get("source_link"),
            "catalog_import_source": p.get("event_import_source"),
            "source_slug": GLC_SLUG, "source_record_id": str(p.get("event_id")), "provenance": "REAL_HISTORICAL"}})
    return out


def gsi_features():
    out = []
    for f in json.loads(RAW_GSI.read_text())["features"]:
        if not f.get("geometry"):
            continue
        lon, lat = f["geometry"]["coordinates"][:2]
        if not in_bbox(lon, lat):
            continue
        p = f["properties"]
        year = p.get("initiati_1") or p.get("initiation") or None
        year = int(year) if year and 1900 < int(year) < 2100 else None
        out.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [lon, lat]}, "properties": {
            # GSI gives an initiation YEAR for some records and no date at all for the rest. A year is stored as
            # <year>-01-01 with event_date_precision YEAR; nothing is invented.
            "event_date": f"{year}-01-01" if year else None,
            "event_date_precision": "YEAR" if year else "UNKNOWN",
            "initiation_year": year, "reactivation_year": p.get("reactivati") or None,
            # GSI's geo_acc field is empty for every NER record, so no accuracy is asserted.
            "location_accuracy_m": None, "location_accuracy_raw": p.get("geo_acc") or None,
            "trigger": p.get("triggering"), "landslide_type": p.get("movement_t"),
            "landslide_size": p.get("landslides") or None, "fatalities": None,
            "title": p.get("slide_name") or p.get("nh_sh_loca"),
            "location_description": " / ".join(x for x in (p.get("village"), p.get("nh_sh_loca"), p.get("locationde"),
                                                           p.get("district"), p.get("state")) if x),
            "material": p.get("material_t"), "failure_mechanism": p.get("failure_me"), "geology": p.get("geology"),
            "activity": p.get("activity"), "slide_no": p.get("slide_no"), "toposheet": p.get("toposheet"),
            "dimensions_m": {k: p.get(k) for k in ("length", "width", "height", "depth") if p.get(k)},
            "source_name": "Geological Survey of India (Bhusanket portal)", "source_link": p.get("report") or None,
            "citation": p.get("citation"),
            "source_slug": GSI_SLUG, "source_record_id": str(p.get("objectid")), "provenance": "REAL_HISTORICAL"}})
    return out


def zenodo_features():
    import openpyxl
    wb = openpyxl.load_workbook(RAW_ZEN)
    ws = wb["Aizawl Landslide Inventory"]
    out = []
    for row in ws.iter_rows(min_row=2, values_only=True):
        sno, code, date, time, loc, lat, lon, coord_type, fatalities, impact, ls_type, sources = row[:12]
        if not code or lat is None or lon is None or not isinstance(lat, (int, float)):
            continue
        if not in_bbox(float(lon), float(lat)):
            continue
        out.append({"type": "Feature", "geometry": {"type": "Point", "coordinates": [float(lon), float(lat)]},
                    "properties": {
            "event_date": str(date)[:10], "event_date_precision": "EXACT" if date else "UNKNOWN",
            # The dataset states 'Reported' (DMS from the source) or 'Approximate' (estimated from a locality name);
            # it gives no metric accuracy, so none is asserted.
            "location_accuracy_m": None, "location_accuracy_raw": coord_type,
            "trigger": None, "landslide_type": ls_type, "landslide_size": None,
            "fatalities": int(fatalities) if isinstance(fatalities, (int, float)) else None,
            "title": f"{code} {loc}" if loc else code, "location_description": loc,
            "time_reported": time, "impact_summary": impact,
            "source_name": "Sarma & Paul (2026), Aizawl landslide inventory 2015-2025 (Zenodo 10.5281/zenodo.20783995)",
            "source_link": "https://doi.org/10.5281/zenodo.20783995", "source_references": sources,
            "source_slug": ZEN_SLUG, "source_record_id": str(code), "provenance": "REAL_HISTORICAL"}})
    return out


def main():
    fetch_inventory()
    feats = gsi_features() + glc_features() + zenodo_features()
    feats.sort(key=lambda x: (x["properties"]["source_slug"], x["properties"]["event_date"] or "",
                              x["properties"]["source_record_id"]))
    counts = {}
    for f in feats:
        counts[f["properties"]["source_slug"]] = counts.get(f["properties"]["source_slug"], 0) + 1
    (P.OUT / "historical_landslides.geojson").write_text(json.dumps({
        "type": "FeatureCollection",
        "metadata": {
            "sources": {
                GSI_SLUG: {"url": GSI_LAYER, "retrieved_at": json.loads((RAW_GSI.with_suffix(".meta.json")).read_text())["retrieved_at"],
                           "terms": "https://bhusanket.gsi.gov.in/terms.html (reproduction after permission by e-mail; acknowledge source)",
                           "attribution": "Landslide inventory: Geological Survey of India (Bhusanket portal)"},
                GLC_SLUG: {"url": COOLR_URL, "query_bbox": NER_BBOX,
                           "attribution": "NASA Global Landslide Catalog / COOLR, NASA Goddard Space Flight Center"},
                ZEN_SLUG: {"url": "https://doi.org/10.5281/zenodo.20783995", "licence": "CC-BY-4.0",
                           "attribution": "Sarma, P. & Paul, K. (2026), Aizawl landslide inventory 2015-2025, Zenodo, CC-BY-4.0"},
            },
            "note": "Records from different inventories may describe the same landslide; each keeps its own source_slug.",
            "counts": counts},
        "features": feats}))

    # ---- past_landslide_density from the GSI inventory (surveyed locations)
    to_utm = Transformer.from_crs("EPSG:4326", P.PROJECTED_CRS, always_xy=True)
    pts = [to_utm.transform(*f["geometry"]["coordinates"][:2])
           for f in json.loads(RAW_GSI.read_text())["features"] if f.get("geometry")]
    area_km2 = math.pi * (P.DENSITY_RADIUS_M / 1000) ** 2
    gpath = P.OUT / "grid_cells.geojson"
    fc = json.loads(gpath.read_text())
    nonzero, mx = 0, 0.0
    for c in fc["features"]:
        cx, cy = to_utm.transform(*c["properties"]["centroid"])
        n = sum(1 for x, y in pts if (x - cx) ** 2 + (y - cy) ** 2 <= P.DENSITY_RADIUS_M ** 2)
        v = round(n / area_km2, 4)
        c["properties"]["static_features"]["past_landslide_density"] = v
        c["properties"]["feature_provenance"]["past_landslide_density"] = "REAL_HISTORICAL"
        c["properties"]["feature_sources"]["past_landslide_density"] = DENSITY_SLUG
        nonzero += n > 0
        mx = max(mx, v)
    fc["grid"]["past_landslide_density_method"] = (
        f"count of {DENSITY_SLUG} (GSI surveyed) records within {P.DENSITY_RADIUS_M:.0f} m of the cell centroid "
        f"/ {area_km2:.2f} km2 (all records; not fold-safe)")
    gpath.write_text(json.dumps(fc))
    print(f"records in pilot bbox by source: {counts} | density: cells>0={nonzero} max={mx}")


if __name__ == "__main__":
    main()
