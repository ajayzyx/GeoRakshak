# Data spike: pilot area candidates (roadmap task 0.3)

> **Date:** 2026-09-17 · **Author:** AI/ML track · **Status:** complete for DEM, OSM, NASA landslide catalogue, IMD gridded rainfall and ESA WorldCover. GSI Bhukosh is **blocked**. Sentinel-2 was **not attempted**.
> **Pilot recommendation: Aizawl, Mizoram. PROVISIONAL**, pending team sign-off under H4.
> Raw numbers: `ml/reports/data-spike-counts.json`, produced by `ml/pipeline/spike_counts.py` and `ml/pipeline/spike_terrain.py`.
> Every access result below is from a real request made on 2026-09-17 from the development machine. Nothing here is assumed.

## 1. How the candidates were chosen

I did not pick candidates from memory. I downloaded the NASA landslide catalogue (§2.3) and ran a sliding 0.25° window over the NER bbox (88–97.5°E, 21.5–29.5°N). For each window I counted Indian records with location accuracy ≤ 5 km. The densest windows were:

| Window centre (approx.) | Records (≤ 5 km, legacy export) | Main gazetteer points |
|---|---|---|
| Guwahati / Dispur, Assam | 33 | Guwahati, Dispur |
| Kurseong / Darjeeling, West Bengal | 30 | *not NER*, excluded |
| Kohima, Nagaland | 12 | Kohima |
| Aizawl, Mizoram | 12 | Aizawl, Serchhip |
| Gangtok, Sikkim | 10 | Gangtok, Rangpo |
| Mokokchung, Nagaland | 8 | Mokokchung |

I evaluated three NER candidates: **Aizawl**, **Kohima** and **Guwahati hills**. Each uses a 0.25° × 0.25° box (≈ 25.5 km × 27.7 km) centred on the town.

## 2. Per-source access results

### 2.1 Copernicus DEM GLO-30 (S11) — WORKS
- **Bucket:** `https://copernicus-dem-30m.s3.amazonaws.com/` (AWS Open Data, eu-central-1, public, no credentials). Verified by listing with `?list-type=2&prefix=Copernicus_DSM_COG_10_N25` and by HEAD requests.
- **Object naming (verified):** `Copernicus_DSM_COG_10_N{lat:02}_00_E{lon:03}_00_DEM/Copernicus_DSM_COG_10_N{lat:02}_00_E{lon:03}_00_DEM.tif`, plus `AUXFILES/` (EDM, FLM, HEM, WBM, ACM). COG, 3600 px high, 1 arc-second.
- **Tiles (all HTTP 200):** Aizawl `N23_00_E092` (49.7 MB) · Kohima `N25_00_E093` (46.4 MB) + `N25_00_E094` (44.3 MB) · Guwahati `N26_00_E091` (45.2 MB). No full tile was downloaded. The pipeline reads windows remotely through GDAL `/vsicurl/`. The Aizawl clip is 3.3 MB.
- **Licence found:** the AWS registry entry (`awslabs/open-data-registry/datasets/copernicus-dem.yaml`) says "GLO-30 Public and GLO-90 are available on a free basis for the general public under the terms and conditions of the Licence". It points to the CDSE COP-DEM page, which states "The GLO-30 and GLO-90 datasets are available worldwide with a free license". The required notice for adapted data is "produced using Copernicus WorldDEM-30 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved".
- **Caveat:** this is a surface model (DSM), so it includes tree canopy and buildings.

### 2.2 OpenStreetMap via Overpass API (S20, S22, S23) — WORKS
- **Endpoint:** `https://overpass-api.de/api/interpreter` (POST). User-Agent was `GeoRakshak-SIH2026-prototype/0.1 (...)`. I ran one query at a time with pauses, `out count` for the spike, and cached every response.
- **Licence found** (https://www.openstreetmap.org/copyright): "licensed under the Open Data Commons Open Database License (ODbL) by the OpenStreetMap Foundation". Attribution: "© OpenStreetMap contributors".
- **Counts** (OSM base ≈ 2026-09-17T15:30Z):

| Candidate | highway ways (major→track/service) | place nodes (city/town/village/hamlet) | schools/colleges | hospitals/clinics/doctors | highway bridge ways | shelters / assembly points |
|---|---|---|---|---|---|---|
| Aizawl | 2,876 | 13 | 5 | 23 | 37 | 0 / 0 |
| Kohima | 1,044 | 40 | 9 | 14 | 32 | 2 / 0 |
| Guwahati | 12,585 | 5 | 111 | 299 | 271 | 0 / 0 |

- **Observation:** facility mapping is clearly incomplete in the hill towns. Five schools for all of Aizawl is implausible. OSM exposure layers need a completeness caveat in the UI.

### 2.3 Landslide inventory: NASA Global Landslide Catalog (S16) — WORKS (two real access routes)
1. **Legacy export on data.nasa.gov.** The Socrata URL `https://data.nasa.gov/api/views/dd9e-wu2v/rows.csv?accessType=DOWNLOAD` returns **HTTP 404**, because the portal has migrated. The CKAN dataset page `https://data.nasa.gov/dataset/global-landslide-catalog-export` links to `https://data.nasa.gov/docs/legacy/Global_Landslide_Catalog_Export/Global_Landslide_Catalog_Export_rows.csv`. That file downloaded fine (HTTP 200, 8,479,717 bytes, 11,033 records, event years 1988–2017, sha256 `2c4898…8b04`). The CKAN `package_show` metadata lists `"license_title": "License not specified"`. It says the export is a one-time copy and asks users to cite Kirschbaum et al. 2010 and 2015.
2. **Live COOLR service (used for the handoff).** The NASA Landslide Viewer (`https://landslides.nasa.gov/viewer`, which redirects to an ArcGIS Experience on `gis.earthdata.nasa.gov`) references `https://gis.earthdata.nasa.gov/portal/rest/services/Landslides/COOLR_Reports_Points/FeatureServer/0`. Its service description says it holds GLC records (`event_import_source='GLC'`) plus Landslide Reporter citizen-science records (`'LRC'`). I queried the NER bbox with `f=geojson`: HTTP 200, 879 features, no transfer-limit flag, sha256 `cb069f…ebe7`. Of these, 592 have `country_code=IN` (589 GLC, 2 SMMML, 1 LRC), with event years 2007–2021. The viewer's web map item (`316937f6b8934de7ba69b45c4688598c`) carries a "NASA Landslide Catalog (GLC) — PERMISSION TO USE, REPRODUCE, AND DISTRIBUTE" licence text. That text allows reproduction and distribution with notice retention, and says NASA data are "research-grade … may not be appropriate for operational use".
   - The separate `COOLR_Events_Points` layer (40,154 features) has **no Indian records** in the NER bbox. Inside the NER bbox it holds only Myanmar (6,823 'Automatic') and Bangladesh (1,811 'Manual') records.
- **Counts in candidate bboxes:**

| Candidate | COOLR total | accuracy ≤ 5 km | 1 km / exact | years | records with fatalities | legacy CSV total (≤ 5 km) |
|---|---|---|---|---|---|---|
| Aizawl | 19 | 17 | 8 | 2009–2021 | 8 | 16 (14) |
| Kohima | 28 | 15 | 8 | 2007–2018 | 0 | 26 (13) |
| Guwahati | 41 | 36 | 14 | 2007–2017 | 17 | 41 (36) |

- **Caveats:** the catalogue is compiled from media reports, so it is incomplete and biased toward roads and settlements. The records in all three boxes cluster around the town. In Aizawl, 18 of 19 records lie within 3.7 km of 92.72°E, 23.73°N and 11 within 1.5 km. Location accuracy is 1–50 km. For NER India as a whole, 504 records fall in the 8 states, but only 106 have accuracy ≤ 1 km.

### 2.4 GSI Bhukosh landslide inventory (S15) — BLOCKED (unreachable)
- `https://bhukosh.gsi.gov.in/Bhukosh/Public`, `.../Bhukosh/MapViewer.aspx`, `https://bhukosh.gsi.gov.in/` → **connection timed out after 40 s**. `http://bhukosh.gsi.gov.in/Bhukosh/Public` → **timed out after 30 s**. That is four attempts on 2026-09-17.
- `https://www.gsi.gov.in/` responds (HTTP 200, redirected to `https://gsi.gov.in:443/`). My guessed NLSM quick-link path returned 404. That path was a guess, not a documented URL.
- Retried on 2026-09-17 at 17:48-17:49 UTC with 6 s connect timeouts (7 attempts, including guessed ArcGIS and GeoServer paths): DNS resolves to 144.24.99.164, every TCP connect to 443 and 80 timed out. Attempt log: `ml/data/raw/gsi/gsi_attempts_20260917.tsv`.
- **Could not determine** whether the inventory can be downloaded without login, or under what licence. A team member should retry from an Indian network, and if needed request access from GSI. **No GSI data is used.**

### 2.5 IMD gridded daily rainfall 0.25° (S1) — WORKS (licence restriction noted)
- **Pages:** `https://imdpune.gov.in/cmpg/Griddata/Rainfall_25_Bin.html` (binary) and `.../Rainfall_25_NetCDF.html` (NetCDF, form action `RF25.php`). The `www.` host timed out, but the bare `imdpune.gov.in` host worked. The pages describe "IMD New High Spatial Resolution (0.25X0.25 degree) Long Period (1901-2024) Daily Gridded Rainfall", 135 × 129 grid points, first point 6.5N 66.5E, last 38.5N 100.0E, 365/366 records per year. The binary year selector lists 1901–2025.
- **Download that worked:** `POST https://imdpune.gov.in/cmpg/Griddata/rainfall.php` with form field `rain=2017` returned HTTP 200 `application/octet-stream`, `Content-disposition: attachment; filename=Rainfall/ind2017_rfp25.grd`, 25,425,900 bytes (= 365 × 129 × 135 × 4, sha256 `dc9109…c23a`).
- **Format (verified by decoding):** little-endian float32, days × lat (south→north) × lon, undefined = −999.0 (71.5 % of the grid, i.e. ocean and outside India), unit mm/day. Sanity check on 2017 annual totals at the nearest grid point: Cherrapunji ≈ 7,803 mm, Mumbai ≈ 2,807 mm, Delhi ≈ 441 mm, Aizawl ≈ 3,163 mm. All are plausible.
- **Licence/terms found:** no open licence. The page asks users to cite Pai et al. (2014), MAUSAM 65(1):1–18. The site disclaimer (`https://imdpune.gov.in/disclaimer.html`) says: "Data on this website are intended for information only. But the same should not be reproduced anywhere without prior permission or used for any other legal purposes." **The team must decide or seek permission before redistributing IMD-derived values or showing them publicly.** For now they are gitignored and used only for local replay.
- **Resolution caveat:** 0.25° ≈ 25–28 km. The Aizawl pilot box falls on only **4** IMD grid points.

### 2.6 ESA WorldCover 10 m (S18) — WORKS
- **Bucket:** `https://esa-worldcover.s3.eu-central-1.amazonaws.com/v200/2021/map/ESA_WorldCover_10m_2021_v200_N{lat3}E{lon3}_Map.tif` uses 3° tiles, named by SW corner. Verified by S3 listing and HEAD: `N21E090` (58.9 MB, Aizawl), `N24E093` (55.4 MB, Kohima), `N24E090` (98.8 MB, Guwahati). All return HTTP 200.
- **Licence found:** the AWS registry `esa-worldcover-vito.yaml` says `License: "CC-BY 4.0"`, with v200 DOI 10.5281/zenodo.7254221.
- Read remotely by window. The Aizawl clip is 368 KB.

### 2.7 Not evaluated in this spike
- **Sentinel-2 NDVI composite (S17):** not attempted, so `ndvi_mean` is absent from the handoff.
- **SRTM/NASADEM, CartoDEM, CHIRPS, IMERG, ERA5-Land, Census/LGD, Survey of India boundaries:** not attempted.

## 3. Terrain character (from the DEM, spike approximation)

| Candidate | elevation range (m) | median slope | share > 15° | share > 25° |
|---|---|---|---|---|
| Aizawl | 52 – 1,476 | 25.4° | 81 % | 51 % |
| Kohima | 435 – 3,019 | 21.8° | 78 % | 37 % |
| Guwahati | 39 – 642 | 5.7° | 31 % | 9 % |

The slope is computed from the geographic grid with local metre scaling, so treat it as indicative. The pilot pipeline recomputes it properly in UTM.

## 4. Recommendation (PROVISIONAL)

**Pilot: Aizawl, Mizoram.** Slug `aizawl-mizoram`, bbox [92.595, 23.605, 92.845, 23.855], 500 m cells → 2,798 cells.

Justification against the approved H4 criterion (inventory count + data coverage):
1. **Inventory:** 17 records with accuracy ≤ 5 km (8 at ≤ 1 km), 8 of them fatal, spanning 2009–2021, including dated events on 2017-06-01 and 2017-06-10 that suit a real rainfall replay. Guwahati has more records (36). Kohima has more records overall but fewer precise ones (15 at ≤ 5 km).
2. **Terrain representativeness:** Aizawl is steep hill terrain (median slope ≈ 25°), typical of NER landslide settings. The Guwahati box is mostly flat Brahmaputra floodplain and city (median slope ≈ 6°), so most of its cells would be trivially low risk. Its high count reflects urban hill-cut slides and dense media coverage.
3. **Data coverage:** DEM, WorldCover and IMD gridded rainfall all worked. The OSM road network is dense (2,876 ways), with a trunk/primary network (OSM `ref` tags NH6, NH108 and NH2 on trunk segments) that suits road connectivity status.
4. **Alternate:** Kohima (Nagaland), which has more mapped villages (40) and a highway corridor setting but coarser inventory locations. If the team values record count over terrain representativeness, Guwahati is the alternative.

**Known weaknesses of the Aizawl choice:** the inventory is concentrated in the city (reporting bias), 19 records are far too few to train a model on the pilot alone (see `ml/reports/evaluation-2026-09-17.md`), OSM facility coverage is sparse, and IMD rainfall supplies only 4 distinct series.

## 5. Follow-ups for the team
- H4 sign-off on the pilot (ML + PC), and the choice of third notification language (Mizo if Aizawl is confirmed).
- Retry GSI Bhukosh from an Indian network, then record login and licence findings.
- Decide on IMD data use given the "not reproduced without prior permission" disclaimer. Options: request permission, or show derived risk only.
- Sentinel-2 NDVI composite (OR-03) remains to be done.
- Update `docs/data-strategy.md` §1a verification statuses from this report (see the final ML report for the list).
