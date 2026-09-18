"""Step 6: boundary.geojson + manifest.json (sources[] = what was really accessed, with verification dates).

verified_at dates are the dates the pipeline author actually downloaded/queried each source (data spike, 2026-09-17).
Re-running on a later date does NOT re-verify licences: update VERIFIED_AT and licence text by hand after checking.
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import pilot_config as P

VERIFIED_AT = "2026-09-17"


def exists(name):
    return (P.OUT / name).exists()


def load_meta(name, key):
    try:
        return json.loads((P.OUT / name).read_text()).get(key)
    except FileNotFoundError:
        return None


def sources():
    grid = load_meta("grid_cells.geojson", "grid") or {}
    osm_meta = load_meta("road_segments.geojson", "metadata") or {}
    s = []
    if exists("grid_cells.geojson"):
        s.append({
            "slug": "copernicus-dem-glo30", "kind": "TERRAIN", "provider": "ESA / Copernicus (via AWS Open Data, Sinergise)",
            "dataset": "Copernicus DEM GLO-30 Public (DGED, 2021 release), Cloud Optimized GeoTIFF",
            "connection_status": "CONNECTED_HISTORICAL", "verification_status": "VERIFIED", "verified_at": VERIFIED_AT,
            "licence": "Copernicus DEM licence (ESA User Licence + CCM Mission Specific Annex); GLO-30 'available worldwide with a free license' "
                       "per https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM",
            "attribution_text": "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 "
                                "provided under COPERNICUS by the European Union and ESA; all rights reserved",
            "provenance_default": "REAL_HISTORICAL",
            "status_note": "Surface model (DSM): includes buildings and tree canopy. Slope/relief derived by GeoRakshak pipeline.",
            "metadata": {"urls": grid.get("dem_urls"), "processing": grid.get("dem_processing"),
                         "resolution": "1 arc-second (~30 m), resampled to 25 m in " + P.PROJECTED_CRS},
        })
    if grid.get("landcover_url"):
        s.append({
            "slug": "esa-worldcover-2021", "kind": "SATELLITE_LAYER", "provider": "ESA WorldCover consortium (via AWS Open Data)",
            "dataset": "ESA WorldCover 10 m 2021 v200 (Sentinel-1 + Sentinel-2 derived land cover)",
            "connection_status": "CONNECTED_HISTORICAL", "verification_status": "VERIFIED", "verified_at": VERIFIED_AT,
            "licence": "CC-BY 4.0 (AWS Open Data registry entry esa-worldcover-vito)",
            "attribution_text": "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium",
            "provenance_default": "REAL_HISTORICAL",
            "status_note": "Per-cell majority class (landcover_class) and tree-cover share. Map year 2021; may not reflect later change.",
            "metadata": {"url": grid.get("landcover_url"), "acquisition_period": "2021-01-01/2021-12-31", "doi": "10.5281/zenodo.7254221"},
        })
    if exists("historical_landslides.geojson"):
        s.append({
            "slug": "nasa-glc", "kind": "INVENTORY", "provider": "NASA Goddard Space Flight Center",
            "dataset": "Global Landslide Catalog records via COOLR Reports Points feature service (GLC + Landslide Reporter)",
            "connection_status": "CONNECTED_HISTORICAL", "verification_status": "VERIFIED", "verified_at": VERIFIED_AT,
            "licence": "NASA 'Permission to Use, Reproduce, and Distribute' text attached to the NASA Landslide Viewer web map item "
                       "(gis.earthdata.nasa.gov item 316937f6b8934de7ba69b45c4688598c); data.nasa.gov legacy export lists 'License not specified'. "
                       "Citation requested: Kirschbaum et al. 2010 (doi:10.1007/s11069-009-9401-4); Kirschbaum et al. 2015 (doi:10.1016/j.geomorph.2015.03.016).",
            "attribution_text": "Landslide records: NASA Global Landslide Catalog / COOLR, NASA Goddard Space Flight Center (landslides.nasa.gov)",
            "provenance_default": "REAL_HISTORICAL",
            "status_note": "Media-derived catalogue: incomplete and biased toward roads/settlements; many locations accurate only to 1-50 km. "
                           "Records in pilot bbox span 2009-2021. Kept as a secondary inventory next to gsi-bhusanket (surveyed) and "
                           "zenodo-aizawl-rsf-2026 (dated); it was the v2 Stage A label source, v3 uses gsi-bhusanket.",
            "metadata": {"inventory_used_for_labels": False,
                         "url": "https://gis.earthdata.nasa.gov/portal/rest/services/Landslides/COOLR_Reports_Points/FeatureServer/0",
                         "cross_check": "https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/Global_Landslide_Catalog_Export_rows.csv",
                         "past_landslide_density_method": grid.get("past_landslide_density_method")},
        })
    if exists("road_segments.geojson"):
        s.append({
            "slug": "osm-roads", "kind": "EXPOSURE", "provider": "OpenStreetMap contributors (Overpass API, overpass-api.de)",
            "dataset": "OSM highway ways (" + ", ".join(P.ROAD_CLASSES) + ")",
            "connection_status": "CONNECTED_HISTORICAL", "verification_status": "VERIFIED", "verified_at": VERIFIED_AT,
            "licence": "Open Data Commons Open Database License (ODbL) 1.0 — https://www.openstreetmap.org/copyright",
            "attribution_text": "© OpenStreetMap contributors",
            "provenance_default": "REAL_HISTORICAL",
            "status_note": f"Snapshot; split at intersections and at <= {P.MAX_SEGMENT_M:.0f} m. Completeness not assessed.",
            "metadata": {"osm_base_timestamp": osm_meta.get("osm_base_timestamp_roads"), "endpoint": "https://overpass-api.de/api/interpreter"},
        })
    if exists("locations.geojson"):
        s.append({
            "slug": "osm-locations", "kind": "EXPOSURE", "provider": "OpenStreetMap contributors (Overpass API, overpass-api.de)",
            "dataset": "OSM places (city/town/village/hamlet), schools/colleges, health facilities, bridges (highway bridge=yes midpoints), "
                       "shelters (emergency=assembly_point, social_facility=shelter)",
            "connection_status": "CONNECTED_HISTORICAL", "verification_status": "VERIFIED", "verified_at": VERIFIED_AT,
            "licence": "Open Data Commons Open Database License (ODbL) 1.0 — https://www.openstreetmap.org/copyright",
            "attribution_text": "© OpenStreetMap contributors",
            "provenance_default": "REAL_HISTORICAL",
            "status_note": "OSM facility coverage in the pilot is visibly incomplete (e.g. few schools mapped). No population attached.",
            "metadata": {"osm_base_timestamp": osm_meta.get("osm_base_timestamp_locations"), "endpoint": "https://overpass-api.de/api/interpreter"},
        })
    if exists("rainfall_daily.csv"):
        s.append({
            "slug": "imd-gridded-rainfall", "kind": "WEATHER_HISTORICAL", "provider": "India Meteorological Department (IMD), Pune",
            "dataset": "IMD high-resolution 0.25x0.25 degree daily gridded rainfall (binary .grd), year " + str(P.RAIN_YEAR),
            "connection_status": "CONNECTED_HISTORICAL", "verification_status": "VERIFIED", "verified_at": VERIFIED_AT,
            "licence": "No open licence found. IMD Pune website disclaimer (https://imdpune.gov.in/disclaimer.html): data 'should not be "
                       "reproduced anywhere without prior permission'. Citation requested: Pai et al. 2014, MAUSAM 65(1):1-18. "
                       "Team decision/permission needed before redistribution or public display.",
            "attribution_text": "Rainfall: India Meteorological Department, 0.25° gridded daily rainfall (Pai et al., 2014)",
            "provenance_default": "REAL_HISTORICAL",
            "status_note": f"Replay window {P.RAIN_START}..{P.RAIN_END}. Nearest 0.25° grid point per cell (~25 km grid vs 500 m cells): "
                           "only 4 distinct series across the pilot.",
            "metadata": {"form_page": "https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_Bin.html",
                         "download": "POST https://imdpune.gov.in/cmpg/Griddata/rainfall.php rain=<year>",
                         "format": "little-endian float32, days x 129 x 135, lat 6.5-38.5N, lon 66.5-100E, undef -999"},
        })
    # Sources checked in the spike but not connected (status registry honesty).
    if exists("historical_landslides.geojson"):
        inv = json.loads((P.OUT / "historical_landslides.geojson").read_text())["metadata"]
        s.append({
            "slug": "gsi-bhusanket", "kind": "INVENTORY", "provider": "Geological Survey of India (Bhusanket portal)",
            "dataset": "GSI public landslide inventory (ArcGIS FeatureServer layer Landslide_Public), NER states",
            "connection_status": "CONNECTED_HISTORICAL", "verification_status": "VERIFIED", "verified_at": "2026-09-18",
            "licence": "GSI Bhusanket Terms of Use (https://bhusanket.gsi.gov.in/terms.html), quoted: 'Material featured on this Portal may be "
                       "reproduced free of charge after taking proper permission by sending a mail to us ... the source must be prominently acknowledged.' "
                       "No open licence. PERMISSION IS REQUIRED before any redistribution or public display of this data or maps derived from it.",
            "attribution_text": "Landslide inventory: Geological Survey of India (Bhusanket portal); individual records carry their own GSI report citation",
            "provenance_default": "REAL_HISTORICAL",
            "status_note": "Surveyed inventory / macro-scale (1:50,000) susceptibility mapping records: 8,691 in the 8 NER states, 132 in the pilot bbox. "
                           "Fields date, date_acc and geo_acc are empty for NER, so most records are undated (2,270 carry an initiation year) and no "
                           "position accuracy is asserted. Supports Stage A susceptibility only, not dated Stage B. Team action: request GSI permission "
                           "before publishing anything derived from it.",
            "metadata": {"layer": "https://bhusanket.gsi.gov.in/gisserver/rest/services/Hosted/Public_Portal_Dashboard_Map/FeatureServer/0",
                         "discovered_via": "https://bhusanket.gsi.gov.in/json/config.json",
                         "records_ner": 8691, "records_pilot_bbox": (inv.get("counts") or {}).get("gsi-bhusanket"),
                         "inventory_used_for_labels": True,
                         "attempt_log": "ml/data/raw/inventory_hunt/attempts.tsv",
                         "note": "bhukosh.gsi.gov.in (the portal named in data-strategy S15) is still unreachable; this is a different, reachable GSI host."},
        })
        s.append({
            "slug": "zenodo-aizawl-rsf-2026", "kind": "INVENTORY", "provider": "Sarma, P. & Paul, K. (Zenodo)",
            "dataset": "Aizawl landslide inventory 2015-2025 (19 dated events) accompanying the Mizoram rate-and-state friction study",
            "connection_status": "CONNECTED_HISTORICAL", "verification_status": "VERIFIED", "verified_at": "2026-09-18",
            "licence": "CC-BY-4.0 (Zenodo record 20783995, DOI 10.5281/zenodo.20783995)",
            "attribution_text": "Sarma, P. & Paul, K. (2026), Aizawl landslide inventory 2015-2025, Zenodo, DOI 10.5281/zenodo.20783995, CC-BY-4.0",
            "provenance_default": "REAL_HISTORICAL",
            "status_note": "18 of 19 events fall inside the pilot bbox, all dated (2016-2025) with fatality counts. Coordinates are 'Reported' (DMS from "
                           "the cited source) for 3 records and 'Approximate' (locality-derived) for the rest; the dataset states no metric accuracy.",
            "metadata": {"doi": "10.5281/zenodo.20783995", "records_pilot_bbox": (inv.get("counts") or {}).get("zenodo-aizawl-rsf-2026")},
        })
    s.append({
        "slug": "gsi-bhukosh-landslide-inventory", "kind": "INVENTORY", "provider": "Geological Survey of India (Bhukosh)",
        "dataset": "GSI national landslide inventory (Bhukosh portal)", "connection_status": "NOT_CONNECTED",
        "verification_status": "REJECTED", "verified_at": None, "licence": "Not checked (portal unreachable)",
        "attribution_text": "", "provenance_default": "REAL_HISTORICAL",
        "status_note": "Unreachable: 12 attempts on 2026-09-17 across three blocks, including guessed ArcGIS and GeoServer paths. DNS resolves to "
                       "144.24.99.164 but every TCP connect to 443 and 80 times out. Superseded for our purposes by the reachable GSI host "
                       "bhusanket.gsi.gov.in (slug gsi-bhusanket). Log: ml/data/raw/inventory_hunt/attempts.tsv.",
        "metadata": {"attempt_log": "ml/data/raw/inventory_hunt/attempts.tsv"},
    })
    s.append({
        "slug": "sentinel2-composite", "kind": "SATELLITE_LAYER", "provider": "ESA / Copernicus",
        "dataset": "Sentinel-2 NDVI composite (planned)", "connection_status": "NOT_CONNECTED",
        "verification_status": "UNVERIFIED", "verified_at": None, "licence": "Not checked",
        "attribution_text": "", "provenance_default": "REAL_HISTORICAL",
        "status_note": "Not processed yet; ndvi_mean absent from static_features.", "metadata": {},
    })
    return s


def main():
    b = P.BBOX
    ring = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]
    (P.OUT / "boundary.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [{
        "type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]},
        "properties": {"name": P.PILOT_NAME, "boundary_note": P.BOUNDARY_NOTE, "pilot_slug": P.PILOT_SLUG}}]}))
    grid = load_meta("grid_cells.geojson", "grid") or {}
    counts = {}
    for name in ("grid_cells.geojson", "historical_landslides.geojson", "locations.geojson", "road_segments.geojson"):
        if exists(name):
            counts[name] = len(json.loads((P.OUT / name).read_text())["features"])
    if exists("rainfall_daily.csv"):
        with open(P.OUT / "rainfall_daily.csv") as fh:
            counts["rainfall_daily.csv"] = sum(1 for _ in fh) - 1
    manifest = {
        "pilot_slug": P.PILOT_SLUG, "name": P.PILOT_NAME, "status": P.STATUS, "bbox": list(b),
        "cell_size_m": P.CELL_SIZE_M, "projected_crs": P.PROJECTED_CRS, "feature_version": P.FEATURE_VERSION,
        "generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "boundary_note": P.BOUNDARY_NOTE,
        "grid": {k: grid.get(k) for k in ("origin_xy", "ncols", "nrows", "row_order")},
        "grid_code_format": f"{P.GRID_CODE_PREFIX}-<row 4 digits, 0 = south>-<col 4 digits, 0 = west>",
        "static_features": {
            "slope_deg_mean": "deg", "slope_deg_max": "deg", "elevation_m_mean": "m", "relief_m": "m (max-min elevation in cell)",
            "landcover_class": "ESA WorldCover class code (majority)", "landcover_tree_share": "fraction of cell with class 10",
            "past_landslide_density": "count/km2 (all records; not fold-safe)",
        },
        "rainfall_period": {"start": P.RAIN_START, "end": P.RAIN_END} if exists("rainfall_daily.csv") else None,
        "counts": counts,
        "files": sorted(p.name for p in P.OUT.iterdir() if p.is_file()),
        "sources": sources(),
    }
    (P.OUT / "manifest.json").write_text(json.dumps(manifest, indent=2, ensure_ascii=False))
    print(json.dumps(counts))


if __name__ == "__main__":
    main()
