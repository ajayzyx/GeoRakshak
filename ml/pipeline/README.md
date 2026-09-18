# GeoRakshak ML offline data pipeline

These scripts build the ML → backend handoff files (docs/development.md §6) and the Stage A training table. They are
the **only** ML code that touches the network. `georakshak_ml` and its tests never do.

## Setup

```bash
/opt/homebrew/bin/python3.11 -m venv ml/.venv
ml/.venv/bin/pip install -e 'ml[test,pipeline]'     # numpy, rasterio, pyproj, shapely, requests, scikit-learn
cd ml/pipeline                                       # scripts import each other by module name
```

## Reproduce the provisional pilot (`aizawl-mizoram`)

```bash
../.venv/bin/python build_all.py        # runs the 6 steps below in order (~2-5 min, ~45 MB downloaded)
```

| Step | Script | Source (real, accessed 2026-09-17) | Output |
|---|---|---|---|
| 1 | `build_grid_terrain.py` | Copernicus DEM GLO-30 COG, remote windowed read (`copernicus-dem-30m` S3) | `grid_cells.geojson` with slope_deg_mean/max, elevation_m_mean, relief_m. Raw clip in `data/raw/copdem/` |
| 2 | `build_landcover.py` | ESA WorldCover 2021 v200 COG (`esa-worldcover` S3) | adds landcover_class (majority), landcover_tree_share |
| 3 | `build_osm.py` | Overpass API (`overpass-api.de`), cached in `data/raw/osm/` | `road_segments.geojson`, `locations.geojson` |
| 4 | `build_inventory.py` | NASA COOLR Reports Points feature service (GLC records), NER bbox | `historical_landslides.geojson`, adds past_landslide_density |
| 5 | `build_rainfall.py` | IMD Pune 0.25° daily gridded rainfall binary (POST `rainfall.php`, year 2017) | `rainfall_daily.csv` (2017-05-15..2017-06-30) |
| 6 | `build_manifest.py` | — | `boundary.geojson`, `manifest.json` (sources[], counts) |

Configuration lives in `pilot_config.py`: bbox, UTM zone (EPSG:32646), 500 m cells, replay window, road classes.
Cached raw files in `data/raw/` are reused. Delete them to force a re-download.

### Method notes
- **Grid:** the bbox envelope is transformed to UTM 46N and snapped outward to 500 m. Cells whose WGS84 centroid lies inside the bbox are kept. Polygons are UTM squares with their 4 corners transformed to EPSG:4326. `grid_code = AIZ-<row>-<col>`, where row 0 is the southernmost row and col 0 the westernmost.
- **Terrain:** the DEM is bilinearly resampled to a 25 m UTM grid aligned to the cells (20 × 20 px per cell), and slope uses the Horn method. The DEM is a *surface* model, so canopy and buildings are included.
- **Land cover:** nearest-neighbour resampling to 10 m UTM, then the per-cell majority class. Cells with < 50 % valid pixels get no landcover features. They are not imputed.
- **past_landslide_density:** the count of records with accuracy ≤ 5 km within 2 km of the cell centroid, divided by 12.57 km². It uses **all** records, so it is **not fold-safe** and must not be used in evaluation without per-fold recomputation.
- **Roads:** OSM highway ways of the classes in `ROAD_CLASSES` (service, footway, path and steps excluded) are split at nodes shared with another kept way, clipped to the bbox, and split again at vertices so pieces stay ≤ 1 km where possible. `osm_way_id` + `segment_index` identify a segment.
- **Locations:** OSM `place=city|town` → TOWN, `village|hamlet` → VILLAGE, `amenity=school|college` → SCHOOL, `amenity=hospital|clinic|doctors` or `healthcare=*` → HEALTH_FACILITY, `emergency=assembly_point` / `social_facility=shelter` → SHELTER, and highway ways with `bridge=*` → BRIDGE (midpoint). Ways and relations use the Overpass `center`. `amenity=shelter` (usually bus or picnic shelters) is deliberately **not** mapped to SHELTER. No population is attached.
- **Rainfall:** each cell takes the nearest 0.25° IMD grid point, with no interpolation. The pilot spans only 4 grid points, so there are only 4 distinct series. Undefined values (−999) would be skipped rather than imputed; there were none in this window. The IMD site disclaimer restricts reproduction without permission (see manifest `licence`).

## Data spike

```bash
../.venv/bin/python spike_counts.py        # candidate counts -> ml/reports/data-spike-counts.json
../.venv/bin/python spike_terrain.py       # adds terrain summary to the same JSON
```

See `ml/reports/data-spike.md`.

## Stage A modelling

v1 (naive design, superseded, kept for the record):

```bash
../.venv/bin/python stage_a_dataset.py --accuracy 1km && ../.venv/bin/python train_stage_a.py --accuracy 1km
```

v2 (NASA GLC labels) and v3 (GSI surveyed labels) share every parameter and the same pre-registered gate; only the
label source differs. Both need the NER WorldCover tiles in `data/raw/worldcover/tiles/` (10 tiles, ~830 MB; download
URLs are in `point_features.py`):

```bash
../.venv/bin/python stage_a_v2_dataset.py --step grid       # 100 m built-up presence grid -> data/interim/
../.venv/bin/python stage_a_v2_dataset.py --step features   # positives, both negative designs, NER background, pilot features
../.venv/bin/python train_stage_a_v2.py                     # spatial block CV, 2 offsets -> ml/reports/evaluation-v2-results.json
../.venv/bin/python fit_stage_a_candidate.py --kind rf      # diagnostic pilot susceptibility of the NON-adopted candidate
../.venv/bin/python replay_sanity.py                        # served-model replay over the IMD window -> ml/reports/replay-sanity-<date>.json

# v3: GSI surveyed inventory as the label source
../.venv/bin/python probe_sources.py <group> <url> ...      # logged source probes -> data/raw/inventory_hunt/attempts.tsv
../.venv/bin/python fetch_gsi_inventory.py                  # GSI Bhusanket inventory for the 8 NER states -> data/raw/gsi/
../.venv/bin/python stage_a_v3_dataset.py                   # GSI positives + both negative designs (background/pilot reused from v2)
../.venv/bin/python train_stage_a_v2.py --version v3        # same gate -> ml/reports/evaluation-v3-results.json
```

GSI data carries no open licence: reproduction needs permission by e-mail (`https://bhusanket.gsi.gov.in/terms.html`),
so `data/raw/gsi/` stays gitignored and is never redistributed.

v4 (hydrology + soil features on the same v3 points, same gate):

```bash
../.venv/bin/python fetch_dem_tiles.py       # 46 Copernicus GLO-90 tiles (~250 MB) for the 6 km routing windows
../.venv/bin/python fetch_soilgrids.py       # ISRIC SoilGrids v2 (WCS) + SoilGrids-2017 depth to bedrock, NER window
V4_WORKERS=8 ../.venv/bin/python stage_a_v4_features.py   # adds hydrology + soil columns -> data/processed/training/v4/
../.venv/bin/python train_stage_a_v4.py      # T6 vs T6+H6 vs T6+H6+S, same gate -> ml/reports/evaluation-v4-results.json
```

`hydro_features.py` documents the routing algorithms (priority-flood fill, vectorised D8, window-truncated
accumulation, TWI, Zevenbergen-Thorne curvature, TRI) and `soil_features.py` the SoilGrids sampling, including that
a 0 value means no data and is never imputed.

`point_features.py` holds the shared 500 m point-window feature extraction (terrain T6 + WorldCover stats + the
exposure variable), so training samples, the NER background and the pilot grid all use the same method.
Reports: `ml/reports/evaluation-2026-09-17-v2.md` (gate first, then results) and `ml/reports/evaluation-2026-09-17.md` (v1).

## Attribution required wherever the outputs are shown
- produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved
- © ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021) processed by ESA WorldCover consortium (CC-BY 4.0)
- © OpenStreetMap contributors (ODbL)
- NASA Global Landslide Catalog / COOLR, NASA Goddard Space Flight Center (Kirschbaum et al. 2010, 2015)
- India Meteorological Department 0.25° gridded rainfall (Pai et al. 2014), subject to IMD permission for reproduction
- Landslide inventory: Geological Survey of India (Bhusanket portal), subject to GSI permission for reproduction
- Sarma, P. & Paul, K. (2026), Aizawl landslide inventory 2015-2025, Zenodo, DOI 10.5281/zenodo.20783995, CC-BY-4.0
- Soil data: ISRIC - World Soil Information, SoilGrids v2 (250 m) and SoilGrids 2017 BDTICM (CC-BY 4.0)
- produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved
