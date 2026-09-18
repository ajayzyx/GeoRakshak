# Data Strategy — GeoRakshak

> **Revision:** aligned with the official SIH26001 requirements (OR-01 to OR-21, see [product-spec.md §2](product-spec.md)). The official statement explicitly names soil moisture sensors, satellite imagery and feeds, IMD weather APIs, sensor data, road connectivity and weather-linked forecasts. These are now MVP data needs, not optional ones. New or changed sections: §1, §2.7, §2.8, §3.3, §3 recommendation, §7 MVP use, §8.3, §9.4, §11, §12.

## 0. Read this first

- **Verification status.** The sources below are well-known public datasets and portals, recorded from the team's existing knowledge. **None has yet been checked hands-on for this project.** Before anyone relies on a source, the owner must confirm the following, then set its `Status` to `VERIFIED` with the date:
  current availability, NER coverage, access steps, rate limits and licence text.
- **No invented endpoints.** This document deliberately names **portals and products, not API endpoint URLs**. Exact endpoints, product version identifiers and query parameters are recorded only after testing them, in a later `docs/data-sources/` log.
- **Provenance.** Every dataset loaded into GeoRakshak is tagged `REAL_LIVE`, `REAL_HISTORICAL`, `SIMULATED_DEMO` or `MODEL_OUTPUT` (see [CLAUDE.md §9](../CLAUDE.md)).
- **Licences.** "Licensing considerations" below are summaries to check, not legal advice. Read and record the actual licence text at verification time.
- **Owner:** AI/ML Engineer (acquisition and preprocessing). Product/Communication Lead tracks licence/attribution records (see [team.md](team.md)).

Status legend (source verification): `UNVERIFIED` (known to exist, not yet tested by us) · `VERIFIED (date)` · `REJECTED (reason)`

Connection status (runtime, stored in `data_sources.connection_status`, shown on the dashboard): `CONNECTED_LIVE` · `CONNECTED_HISTORICAL` · `SIMULATED` · `SANDBOX` · `AWAITING_ACCESS` · `NOT_CONNECTED`. A source reaches `CONNECTED_LIVE` only after a successful real call (see [CLAUDE.md §9](../CLAUDE.md)).

MVP classes per layer (CORE / LIGHTWEIGHT / INTEGRATION-READY) follow [product-spec.md §2](product-spec.md) and are listed in §1 and §12.

---

## 1. Data needs overview

| Layer | Official req | Role | Type | Static/Dynamic | MVP class | MVP data provenance |
|---|---|---|---|---|---|---|
| Rainfall (historical) | OR-01 | Trigger features, normal-rainfall baseline, replay | Gridded time series | Dynamic | CORE | **Real** (`REAL_HISTORICAL`) |
| Rainfall (live / forecast) | OR-01, OR-13, OR-17 | Current and forecast risk | Gridded / point time series | Dynamic | LIGHTWEIGHT | Real from an approved provider (`REAL_LIVE`), or replay (`SIMULATED_DEMO` / `REAL_HISTORICAL`) |
| IMD weather API | OR-17 | Live IMD observations/forecasts | API | Dynamic | INTEGRATION-READY | None until access is granted |
| Soil moisture sensors | OR-02, OR-19 | Wetness modifier, monitoring layer | Point time series | Dynamic | LIGHTWEIGHT | **Virtual stations** (`SIMULATED_DEMO`) |
| Soil moisture (satellite / reanalysis) | OR-02 (supporting) | Regional wetness context | Gridded raster | Dynamic | Optional | Real if used |
| Elevation (DEM) | OR-04 | Terrain base | Raster | Static | CORE | **Real** |
| Slope and derivatives | OR-04 | Susceptibility factors | Derived raster | Static | CORE | **Real** (derived) |
| Historical landslides | OR-05 | Labels, validation, map layer | Points/polygons | Mostly static | CORE | **Real** |
| Satellite imagery (derived layers) | OR-03 | Vegetation index, land cover, imagery layer | Raster | Periodic (precomputed) | LIGHTWEIGHT | **Real** with acquisition date |
| Satellite feed (IMERG) | OR-18 | Near-real-time satellite rainfall | Gridded time series | Dynamic | INTEGRATION-READY | None until connected |
| Roads | OR-09, OR-12 | Exposure, connectivity status | Lines | Static-ish | CORE / LIGHTWEIGHT | **Real** (OSM) + status derived from our model and reports |
| Villages | OR-09 | Exposure | Points/polygons + attributes | Static | CORE | **Real** |
| Critical infrastructure | OR-09 | Exposure, priority | Points/polygons | Static | CORE | **Real** (OSM, completeness caveat) |
| Administrative boundaries | — | Aggregation, jurisdiction | Polygons | Static | CORE | **Real** |

Grid proposal (pending ML validation): a uniform analysis grid over the pilot area, **250–500 m cells** over a pilot area of a few hundred km². Terrain and satellite attributes are aggregated from ~10–30 m inputs as cell statistics. Rainfall (~5–25 km) is assigned to cells with its coarse origin documented. A 30 m scoring grid over a whole district would mean millions of cells, which is impractical for the prototype.

### 1a. Source register (every source at a glance)

Column meanings:
- **MVP data status:** the provenance label and dashboard connection status this source will carry in the MVP.
- **Verification:** as of 2026-09-17, the Phase 0 data spike ([ml/reports/data-spike.md](../ml/reports/data-spike.md)) checked access for S1, S11, S15, S16, S18, S20, S22 and S23. "ACCESS VERIFIED" means data was actually retrieved. It is **not** final source selection, which stays pending (H10). No live source (IMD API, IMERG, sensor gateway) is connected.
- **Licence/attribution:** summaries to confirm against the actual licence text at verification.
- **Fallback:** what we use if this source fails verification or access.

| # | Source (provider · dataset) | Purpose | MVP data status | Licence / attribution | Update mode | Fallback | Verification |
|---|---|---|---|---|---|---|---|
| S1 | IMD · gridded daily rainfall 0.25° (§2.1) | Rainfall features, normal baseline, replay (OR-01) | **Real** · `REAL_HISTORICAL` / `CONNECTED_HISTORICAL` | IMD Pune disclaimer: no reproduction without prior permission. Cite Pai et al. 2014 (MAUSAM 65(1)). | Batch file download, periodic reload | S6 CHIRPS | ACCESS VERIFIED 2026-09-17: `POST https://imdpune.gov.in/cmpg/Griddata/rainfall.php` returns yearly `.grd` files (the `www.` host timed out). ⚠️ No open licence found: the IMD Pune disclaimer says data "should not be reproduced anywhere without prior permission". Local development use only until permission is obtained or the team decides otherwise. Cite Pai et al. 2014. [data spike](../ml/reports/data-spike.md) |
| S2 | IMD · weather API (§2.7) | Live IMD observations/forecasts (OR-17) | **Integration-ready** · no data · `AWAITING_ACCESS` | IMD API terms (unknown) | Scheduled poll once granted | S3, then S4 | UNVERIFIED (access to be requested) |
| S3 | Non-IMD forecast provider, **Open-Meteo** (§2.5, §2.8) | Forecast risk, and recent rainfall, if IMD access isn't granted (OR-13, H16) | **Real, labelled non-IMD** · `REAL_LIVE` | **CC-BY 4.0**, non-commercial use, <10,000 calls/day ([terms](https://open-meteo.com/en/terms), read 2026-09-18). Attribution to Open-Meteo and the underlying national weather services. | Scheduled poll (LIVE cycle) or on demand | S4 replay | **ACCESS VERIFIED 2026-09-18** with one real call for the pilot: 9 provider points → 10 days of recent daily precipitation and 3 forecast days, stored as `REAL_LIVE`. Adapter implemented and **disabled by default** (`WEATHER_PROVIDER=none`) pending the H10 source decision. Its "recent" precipitation is **model output, not gauge observations** — labelled as such, and never presented as IMD. |
| S4 | GeoRakshak replay scenario (§11) | Deterministic demo rainfall + forecast | **Real historical** period (`REAL_HISTORICAL`) preferred, else **simulated** (`SIMULATED_DEMO`) | Inherits S1 terms if real | On demand (replay job) | Synthetic scenario | n/a (team-built) |
| S5 | NASA · GPM IMERG (§2.2) | Satellite rainfall feed (OR-18) | **Integration-ready** · no data · `NOT_CONNECTED` | NASA open data, citation | Scheduled download, if connected | S1 | UNVERIFIED |
| S6 | UCSB CHC · CHIRPS (§2.3) | Historical rainfall backup | Real (`REAL_HISTORICAL`) if used | CHC licence + citation (to verify) | Batch | S7 | UNVERIFIED |
| S7 | ECMWF/C3S · ERA5-Land (§2.4) | Reanalysis rainfall / soil water backup | Real (`REAL_HISTORICAL`, model-based) if used | Copernicus licence, attribution | Batch via CDS | S5 | UNVERIFIED |
| S8 | GeoRakshak · virtual soil moisture stations (§3.3) | Sensor monitoring layer + rule adjustment (OR-02) | **Simulated** · `SIMULATED_DEMO` / `SIMULATED` | None (team-generated) | Push via sensor ingestion API (minutes) | "No sensor coverage" path | n/a (team-built) |
| S9 | Real sensor gateway / partner network (§3.3) | Real in-situ sensor data (OR-19) | **Integration-ready** · no data · `NOT_CONNECTED` | Partner agreement (future) | Push via sensor ingestion API | S8 | No source identified |
| S10 | NASA SMAP / ESA CCI SM (§3.1, §3.2) | Optional regional soil moisture context | Real (`REAL_HISTORICAL`) if used | NASA / ESA CCI policy, citation | Batch | Antecedent rainfall proxy | UNVERIFIED |
| S11 | Copernicus · DEM GLO-30 (§4.1) | Terrain base (OR-04) | **Real** · `REAL_HISTORICAL` | Copernicus DEM licence, attribution | One-off load | S12 / S13 | ACCESS VERIFIED 2026-09-17: public bucket `copernicus-dem-30m.s3.amazonaws.com`, COG tiles. Surface model (includes canopy/buildings). [data spike](../ml/reports/data-spike.md) |
| S12 | NASA/USGS · SRTM / NASADEM (§4.2) | Terrain backup | Real if used | US government data, citation | One-off | S11 | UNVERIFIED |
| S13 | NRSC/ISRO · CartoDEM via Bhuvan (§4.3) | Terrain backup | Real if used | NRSC data policy (to verify) | One-off | S11 | UNVERIFIED as a DEM source. Checked 2026-09-18 for landslide data and **rejected**: Bhuvan WMS advertises 13,343 layers, none of them landslide; Bhuvan WFS returns "Service WFS is disabled"; downloads need a login; the NRSC Landslide Atlas is published as a PDF only. Not a data source for us. [inventory hunt](../ml/reports/inventory-hunt-2026-09-18.md) |
| S14 | GeoRakshak · slope and derivatives (§5) | Susceptibility features (OR-04) | **Real, derived** · `REAL_HISTORICAL` | Inherits DEM licence | Recomputed when the DEM changes | Derive from backup DEM | n/a (derived) |
| S15 | GSI · landslide inventory via Bhukosh (§6.1) | Labels, map layer (OR-05) | **Integration-ready** · not connected, **not in use** | GSI terms, attribution (unknown; portal unreachable) | One-off / periodic reload | S16 (in use) | UNREACHABLE 2026-09-17: `bhukosh.gsi.gov.in` timed out (4 attempts, https and http). Retried 7 more times 17:48–17:49 UTC with guessed ArcGIS/GeoServer paths: DNS resolves (144.24.99.164) but every TCP connect to 443 and 80 timed out; `gsi.gov.in` loads but exposes no GIS service link. Logs: `ml/data/raw/gsi/gsi_attempts_20260917.tsv`, `ml/data/raw/inventory_hunt/attempts.tsv`. **REJECTED for now** in favour of S15b, which serves GSI inventory data from a reachable host. The Bhukosh polygon services stay the target for mapped (polygon) labels. |
| **S15b** | **GSI · landslide inventory via Bhusanket portal (§6.1)** | **Stage A labels, map layer, `past_landslide_density` (OR-05)** | **Real** · `REAL_HISTORICAL` / `CONNECTED_HISTORICAL` | 🔶 **No open licence.** [GSI Bhusanket terms](https://bhusanket.gsi.gov.in/terms.html): material "may be reproduced free of charge after taking proper permission by sending a mail to us", reproduced accurately, and "the source must be prominently acknowledged". Treated like S1 IMD: development use only until permission is obtained. | One-off / periodic reload | S16 | **ACCESS VERIFIED 2026-09-18**: open ArcGIS REST layer `bhusanket.gsi.gov.in/gisserver/rest/services/Hosted/Public_Portal_Dashboard_Map/FeatureServer/0` (layer `Landslide_Public`, points, 134 fields), discovered from the portal's `json/config.json`. Independently re-checked: 31,545 records nationally, 8,691 in the 8 NER states, 132 in the Aizawl pilot bbox. **Surveyed** records (movement type, material, trigger, mechanism, geology, dimensions, GSI citations). Limitations: `date`, `date_acc` and `geo_acc` are empty for every NER record (2,270 carry an initiation year), so it supports Stage A only, not dated Stage B; the `Landslide_Polygon` / `GSI_Landslide_India` polygon services return `499 Token Required`. [inventory hunt](../ml/reports/inventory-hunt-2026-09-18.md) |
| S16 | NASA · Global Landslide Catalog (§6.2) | Dated labels, backup inventory | **Real** · `REAL_HISTORICAL` | NASA open data | One-off | S15 | ACCESS VERIFIED 2026-09-17 via NASA COOLR FeatureServer `gis.earthdata.nasa.gov/portal/rest/services/Landslides/COOLR_Reports_Points/FeatureServer/0` (live; carries NASA permission-to-use text). The old data.nasa.gov Socrata URL returns 404. The legacy CSV export states "License not specified" and is not used. Media-derived and biased toward roads/settlements (quantified in [ml-strategy.md §4](ml-strategy.md)). **Secondary inventory** since 2026-09-18: the map layer keeps its 19 pilot records, but Stage A labels now come from S15b (surveyed). [data spike](../ml/reports/data-spike.md) |
| S17 | ESA/Copernicus · Sentinel-2 composite (§7.1, §7.5) | Vegetation index feature, imagery layer (OR-03) | **Real, precomputed** · `REAL_HISTORICAL` + acquisition dates | Copernicus Sentinel terms, attribution | Precomputed once (re-run per season if needed) | Landsat 8/9 (§7.3) | UNVERIFIED |
| S18 | ESA · WorldCover (§7.4) | Land cover feature and layer (OR-03) | **Real** · `REAL_HISTORICAL` + product version | CC-BY 4.0 with attribution "© ESA WorldCover project 2021 / Contains modified Copernicus Sentinel data (2021)" | One-off | Bhuvan LULC | ACCESS VERIFIED 2026-09-17: WorldCover 2021 v200 S3 tiles, CC-BY 4.0. 10 NER tiles (832 MB) downloaded for the NER-wide Stage A background; acquisition range 2021-01-01/2021-12-31 is served with the layer. [data spike](../ml/reports/data-spike.md) |
| S19 | ESA/Copernicus · Sentinel-1 (§7.2) | SAR / InSAR | **Post-MVP** · not used | Copernicus Sentinel terms | — | — | UNVERIFIED |
| S20 | OSM via Geofabrik · roads (§8.1) | Exposure, road segments (OR-09) | **Real** · `REAL_HISTORICAL` | ODbL: "© OpenStreetMap contributors", share-alike | Extract reload (manual/periodic) | PMGSY (§8.2, unverified) | ACCESS VERIFIED 2026-09-17 via Overpass API (`overpass-api.de`), not Geofabrik. ODbL. Snapshot; completeness not assessed. [data spike](../ml/reports/data-spike.md) |
| S21 | GeoRakshak · road connectivity status (§8.3) | Road status (OR-12) | **Our output** · `MODEL_OUTPUT` + verified reports | Geometry inherits ODbL | Every monitoring cycle and on verification | Manual authority status | n/a (derived) |
| S22 | OSM · villages/places (§9.2) | Exposure (OR-09) | **Real** · `REAL_HISTORICAL` | ODbL | Extract reload | Village polygons (§9.3) | ACCESS VERIFIED 2026-09-17 via Overpass API. ODbL. [data spike](../ml/reports/data-spike.md) |
| S23 | OSM · facilities (§9.4) | Exposure, priority (OR-09, OR-14) | **Real** · `REAL_HISTORICAL` (completeness caveat) | ODbL | Extract reload | Government directories (unverified) | ACCESS VERIFIED 2026-09-17 via Overpass API. Coverage visibly incomplete in the pilot (5 schools mapped). [data spike](../ml/reports/data-spike.md) |
| S24 | Census 2011 + LGD (§9.1, §10.2) | Village attributes, admin codes | **Real** · `REAL_HISTORICAL` (2011 labelled) | Government terms (to verify) | One-off | OSM attributes | UNVERIFIED |
| S25 | Survey of India · boundaries (§10.1) | Admin boundaries, jurisdiction | **Real** · `REAL_HISTORICAL` | SoI terms. Official boundary depiction required. | One-off | Community dataset, development only (§10.3) | UNVERIFIED |
| S26 | GeoRakshak mobile · field/citizen reports and media | Ground evidence (OR-10) | `REAL_LIVE` in operations. **Simulated** (`SIMULATED_DEMO`, team-captured media) in the demo. | Team-captured media | Pushed from mobile (offline sync) | — | n/a |
| S27 | NDMA · SACHET alerts overlay (§2) | Official-warning context layer | **Post-MVP** · not used | Unknown | — | — | UNVERIFIED. 🔶 Requires approval. |
| S28 | Zenodo 20783995 · Sarma & Paul (2026) Aizawl landslide dataset (§6.3) | Dated pilot events, map layer (OR-05) | **Real** · `REAL_HISTORICAL` | **CC-BY-4.0** (DOI 10.5281/zenodo.20783995), attribution required | One-off | — | VERIFIED 2026-09-18 (licence re-checked against the Zenodo API): 19 dated events 2016–2025, 18 inside the pilot bbox. **Loaded.** |
| S29 | Zenodo 8169506 · southern Sikkim mapped landslide polygons + mapped extent (§6.3) | Future true-absence negatives for Stage A | Real if used | CC-BY-4.0, attribution required | One-off | — | VERIFIED 2026-09-18, downloaded, **not yet used**. The best available route to real negatives, since it records the surveyed extent. |
| S30 | Zenodo 18931430 · Eastern Himalaya large-landslide inventory (§6.3) | Optional extra Stage A labels | Real if used | CC-BY-4.0, attribution required | One-off | — | VERIFIED 2026-09-18, downloaded, **unused** (420 points, 226 inside the NER mask). |
| S31 | ISRIC · SoilGrids v2 (clay, sand, bulk density, coarse fragments, 5–15 cm) | Stage A soil features | Real (`REAL_HISTORICAL`) **if adopted**; currently candidate only | 🔶 CC-BY 4.0 **as stated by ISRIC, not independently confirmed here**. Attribution "Soil data: ISRIC — World Soil Information, SoilGrids". Confirm before any publication. | Batch via WCS | None (drop the features) | **ENDPOINT VERIFIED 2026-09-18** by this session: `maps.isric.org/mapserv?map=/map/{clay,sand,bdod,cfvo}.map` WCS 2.0.1 returns capabilities (HTTP 200, `Fees: None`, `AccessConstraints: None`). 250 m, 88–97.5°E / 21.5–29.5°N. Missingness 0.6 % training / 0.3 % pilot / 4.8 % NER background; a zero means no data and is never imputed. **Not in the handoff** — the candidate model was not adopted ([v4 evaluation](../ml/reports/evaluation-2026-09-18-v4.md)). |
| S32 | ISRIC · SoilGrids 2017 `BDTICM` (depth to bedrock) | Stage A soil feature | As S31 | As S31 (v2 has no bedrock-depth layer) | One-off | None | **ENDPOINT VERIFIED 2026-09-18**: `files.isric.org/soilgrids/former/2017-03-10/data/BDTICM_M_250m_ll.tif` (HTTP 200). Missingness 0.2 % training / 0 % pilot / 5.8 % background. Not in the handoff. |
| S33 | Copernicus · DEM GLO-90 | Hydrology routing for Stage A candidates (flow accumulation, TWI, distance to drainage) | Real, derived (`REAL_HISTORICAL`) if adopted | Copernicus DEM licence; WorldDEM-90 notice recorded | One-off | S11 GLO-30 | **VERIFIED 2026-09-18**: `copernicus-dem-90m.s3.amazonaws.com` tile HTTP 200. 46 tiles (250 MB) for NER-wide routing at 90 m; accumulation is **window-truncated at ≤ 36 km²**, applied identically to every point. GLO-30 (S11) remains the source for slope and relief. |
| S34 | GLiM global lithological map (PANGAEA doi:10.1594/PANGAEA.788537) | Lithology feature (§6.1 alternative) | **Rejected for now** | CC-BY-3.0 | — | GSI geology (label-only, unusable) | REACHABLE but **REJECTED 2026-09-18**: only gridded to 0.5° (~55 km), which at 500 m cells is a regional constant that would partly encode the spatial CV block. OneGeology WMS returns 404 and its portal fails TLS verification. **Lithology remains unavailable**; GSI's per-record `geology` exists only at positives and would leak the label. |

**Rule:** a row may move to `CONNECTED_LIVE` (or `VERIFIED`) only after a successful real access, recorded with date in the per-source section and in `data_sources`.

---

## 2. Rainfall

### 2.1 IMD Gridded Rainfall (primary historical)
| Field | Details |
|---|---|
| Provider | India Meteorological Department (IMD), Pune |
| Dataset | High-resolution daily gridded rainfall over India (0.25° × 0.25°) |
| Geographic coverage | Indian landmass, including NER |
| Update frequency | Daily values. Archive extends back many decades. Release lag for recent years to be verified. |
| Access method | File download from the IMD Pune data portal |
| API requirements | No documented REST API known to the team. File download (possibly via form). Community Python tools exist for reading these files. |
| Availability | Publicly downloadable (to verify) |
| Licensing considerations | IMD data-use terms, and citation of the dataset publication. Check for redistribution limits. |
| Prototype suitability | **High** for training and historical analysis. **Low** for near-real-time. |
| Backup option | CHIRPS (2.3) or GPM IMERG Final (2.2) |
| Status | UNVERIFIED |

### 2.2 NASA GPM IMERG (primary near-real-time)
| Field | Details |
|---|---|
| Provider | NASA (Global Precipitation Measurement mission). Distributed via NASA GES DISC. |
| Dataset | IMERG precipitation: Early, Late and Final runs |
| Geographic coverage | Near-global (roughly 60°N–60°S), including all of NER, ~0.1° grid |
| Update frequency | Half-hourly product. Early and Late runs have latency of hours, Final has latency of months (exact latency to verify). |
| Access method | Download from NASA Earthdata / GES DISC (HTTPS file access, and data subsetting services) |
| API requirements | Free NASA Earthdata Login account and credentials for programmatic download |
| Availability | Public |
| Licensing considerations | NASA open data policy. Citation/acknowledgement requested. |
| Prototype suitability | **High**: best candidate for a "latest rainfall" layer. Satellite estimates in steep terrain carry known bias, which must be documented. |
| Backup option | ERA5-Land (2.4) or Open-Meteo (2.5) |
| Status | UNVERIFIED |

### 2.3 CHIRPS
| Field | Details |
|---|---|
| Provider | Climate Hazards Center, University of California, Santa Barbara |
| Dataset | CHIRPS (Climate Hazards Group InfraRed Precipitation with Station data) |
| Geographic coverage | Quasi-global land (roughly 50°S–50°N), ~0.05° |
| Update frequency | Daily/pentadal/monthly. A preliminary product is released within weeks and the final one later (to verify). |
| Access method | File download from the CHC data server. Also available on some cloud geospatial platforms. |
| API requirements | None known for file download |
| Availability | Public |
| Licensing considerations | Check the CHC-stated licence and the citation requirement |
| Prototype suitability | **Medium**: good historical backup. Not real-time. |
| Backup option | IMD gridded (2.1) |
| Status | UNVERIFIED |

### 2.4 ERA5-Land (reanalysis)
| Field | Details |
|---|---|
| Provider | ECMWF / Copernicus Climate Change Service (C3S) |
| Dataset | ERA5-Land hourly data (total precipitation, and soil water layers) |
| Geographic coverage | Global land, ~0.1° |
| Update frequency | Hourly values, released with a lag of days (to verify) |
| Access method | Copernicus Climate Data Store (CDS) web download and the official CDS API client |
| API requirements | Free CDS account, API key, and acceptance of dataset licence terms |
| Availability | Public |
| Licensing considerations | Copernicus licence. Attribution required. |
| Prototype suitability | **Medium**: consistent reanalysis useful for features and gap filling. Model-based, not observed. |
| Backup option | GPM IMERG (2.2) |
| Status | UNVERIFIED |

### 2.5 Open-Meteo (forecast / convenience backup)
| Field | Details |
|---|---|
| Provider | Open-Meteo (aggregates national weather model outputs) |
| Dataset | Weather forecast and historical weather APIs (precipitation) |
| Geographic coverage | Global point queries |
| Update frequency | Forecasts updated several times a day (to verify) |
| Access method | HTTP JSON API |
| API requirements | No key for non-commercial use (to verify current terms and rate limits) |
| Availability | Public |
| Licensing considerations | Non-commercial free tier terms and attribution (verify). Data licence of underlying models. |
| Prototype suitability | **Medium**: easy for demo "forecast rainfall" context. Model output, so label it as a forecast and not an observation. |
| Backup option | GPM IMERG (2.2) |
| Status | UNVERIFIED |

### 2.6 IMD station / AWS / ARG observations
| Field | Details |
|---|---|
| Provider | IMD |
| Dataset | Automatic Weather Station / Automatic Rain Gauge observations |
| Geographic coverage | Station network, sparse in mountainous NER |
| Update frequency | Sub-daily (to verify) |
| Access method | Unknown to the team. May require a formal data request. |
| API requirements | Unknown |
| Availability | Possibly restricted |
| Licensing considerations | IMD data policy |
| Prototype suitability | **Low** for the MVP. Valuable for validating satellite rainfall later. |
| Backup option | GPM IMERG (2.2) |
| Status | UNVERIFIED (access route unknown) |

### 2.7 IMD weather APIs (official requirement OR-17)
| Field | Details |
|---|---|
| Provider | India Meteorological Department (IMD) |
| Dataset | IMD weather data services through an API (the product set may include current weather, forecasts, nowcasts and warnings; **the exact product list is unverified**) |
| Geographic coverage | India (per product, to verify) |
| Update frequency | Per product (to verify) |
| Access method | The team understands IMD provides API access **on request**, possibly with registration or IP whitelisting. **Unverified.** |
| API requirements | Unknown until access is granted. **No endpoints, parameters or response formats are recorded here**, and none may be assumed in code. |
| Availability | Restricted / on request (to verify) |
| Licensing considerations | IMD terms for API use and display, attribution, and redistribution limits (to verify) |
| Prototype suitability | **High value, uncertain access.** Product/Communication Lead submits the access request in Phase 0. |
| Backup option | IMD gridded files (2.1) for real historical IMD data. An approved forecast provider (2.8) for live/forecast. |
| MVP class | **INTEGRATION-READY:** adapter slot behind the provider-independent `WeatherProvider` interface. The dashboard shows `AWAITING_ACCESS`. |
| Status | UNVERIFIED |

### 2.8 Weather forecast source for risk forecasts (OR-13)
| Option | Provenance label | Notes |
|---|---|---|
| IMD API forecast products (2.7) | `REAL_LIVE` | Preferred if access is granted in time |
| Other approved forecast provider (candidate: Open-Meteo, 2.5) | `REAL_LIVE`, marked **non-IMD** | Used only if IMD access isn't granted (H16, approved rule). Provider recorded after a terms check (non-commercial use, attribution, rate limits). Status UNVERIFIED until then. |
| Replay scenario forecast | `SIMULATED_DEMO` or `REAL_HISTORICAL` | Deterministic demo. Always labelled. |

Forecast records store **issue time**, **valid time** and **lead time**. Forecast rainfall is never shown or stored as an observation.

**Context layer (not model input):** NDMA's SACHET portal publishes official alerts from authorised agencies. It could be shown as an "official warnings" overlay so users can tell GeoRakshak risk apart from official warnings. Access method and terms are unknown. Status: UNVERIFIED. Requires human approval.

---

## 3. Soil moisture

### 3.1 NASA SMAP
| Field | Details |
|---|---|
| Provider | NASA (Soil Moisture Active Passive). Distributed via NSIDC DAAC. |
| Dataset | SMAP Level-3 radiometer soil moisture (standard ~36 km, enhanced ~9 km products) |
| Geographic coverage | Global |
| Update frequency | Daily composites with a revisit of ~2–3 days. Latency to verify. |
| Access method | NASA Earthdata / NSIDC download |
| API requirements | NASA Earthdata Login |
| Availability | Public |
| Licensing considerations | NASA open data policy. Citation requested. |
| Prototype suitability | **Medium**: coarse relative to hillslopes. Retrieval quality degrades in dense forest and steep terrain, which is common in NER. Use as a regional wetness indicator only. |
| Backup option | ERA5-Land soil water (2.4) or ESA CCI SM (3.2) |
| Status | UNVERIFIED |

### 3.2 ESA CCI Soil Moisture
| Field | Details |
|---|---|
| Provider | European Space Agency Climate Change Initiative |
| Dataset | CCI Soil Moisture (combined active/passive), ~0.25° |
| Geographic coverage | Global |
| Update frequency | Daily values. Released periodically, not near-real-time (to verify). |
| Access method | Download from the ESA CCI data portal |
| API requirements | Possibly registration (to verify) |
| Availability | Public |
| Licensing considerations | ESA CCI data policy. Citation required. |
| Prototype suitability | **Medium** for historical training features. **Low** for live use. |
| Backup option | ERA5-Land soil water (2.4) |
| Status | UNVERIFIED |

### 3.3 In-situ soil moisture sensors (official requirement OR-02, OR-19)
| Field | Details |
|---|---|
| Provider | **No public, open, real-time in-situ soil moisture sensor feed for NER has been identified by the team.** Possible sources (state agencies, research landslide monitoring deployments, academic partners) are **unknown and unverified**. |
| Dataset | Point time series: volumetric water content (m³/m³) at stated depth(s), timestamp, station ID, battery/quality flags |
| Geographic coverage | Point locations only |
| Update frequency | Typically minutes to hours, depending on the device |
| Access method | **GeoRakshak sensor ingestion API** (HTTP POST JSON, per-station API key). Our own contract, documented in [api.md §5.5](api.md) (not implemented). |
| API requirements | Our contract: station registry, units, depth, reading time, quality flag, duplicate-safe via station ID + reading time |
| Availability | MVP: **virtual stations only** |
| Licensing considerations | Partner data agreements if real sensors are ever connected |
| Prototype suitability | **Virtual sensor emulator:** a small number of virtual stations at documented pilot-area points post plausible readings through the real API. Every reading is labelled `SIMULATED_DEMO`, and stations show "Virtual sensor (simulated)." |
| Backup option | Satellite/reanalysis soil moisture (3.1, 3.2, ERA5-Land 2.4) as real regional context. Antecedent rainfall proxy. |
| Physical node | **Not in the MVP** (H17 approved: none by default). A future physical node would post to the same API, labelled `REAL_LIVE`, with uncalibrated readings disclosed. |
| MVP class | OR-02 **LIGHTWEIGHT** (virtual stations through the real ingestion path). OR-19 **INTEGRATION-READY** (general contract, no real device connected). |
| Status | Ingestion contract designed ([api.md §5.5](api.md), [database.md §4.9–4.10](database.md)). Not implemented. No real source identified. |

**MVP recommendation (revised):**
- **Trained model features:** antecedent rainfall (3/7/15/30-day) as the wetness proxy, because historical sensor data does not exist for training. Satellite/reanalysis soil moisture may be added if it improves spatial validation.
- **Sensor readings:** applied as a **documented rule-based modifier** in the rainfall trigger layer (see [ml-strategy.md §2.4](ml-strategy.md)). They are displayed as a monitoring layer. **They are never used to train or to compute reported metrics while they are simulated.**

---

## 4. Elevation (DEM)

### 4.1 Copernicus DEM GLO-30
| Field | Details |
|---|---|
| Provider | European Space Agency / Copernicus programme |
| Dataset | Copernicus DEM GLO-30 (~30 m) |
| Geographic coverage | Global |
| Update frequency | Static |
| Access method | Copernicus data portals, and public cloud open-data mirrors (to verify) |
| API requirements | Registration may be needed on some portals |
| Availability | Public (GLO-30 released openly; verify current terms) |
| Licensing considerations | Copernicus DEM licence, attribution required. Check terms for any tiles with restrictions. |
| Prototype suitability | **High** |
| Backup option | SRTM (4.2) or CartoDEM (4.3) |
| Status | UNVERIFIED |

### 4.2 SRTM 1 arc-second / NASADEM
| Field | Details |
|---|---|
| Provider | NASA / USGS |
| Dataset | SRTM Global 1 arc-second (~30 m). NASADEM is the reprocessed version. |
| Geographic coverage | ~60°N–56°S, including NER. Voids possible in steep terrain. |
| Update frequency | Static (acquired in 2000) |
| Access method | USGS EarthExplorer, NASA Earthdata |
| API requirements | USGS or Earthdata account |
| Availability | Public |
| Licensing considerations | US government data, generally public domain. Citation requested. |
| Prototype suitability | **High** |
| Backup option | Copernicus DEM (4.1) |
| Status | UNVERIFIED |

### 4.3 CartoDEM
| Field | Details |
|---|---|
| Provider | NRSC / ISRO, via the Bhuvan geoportal |
| Dataset | CartoDEM (Cartosat-1 derived, ~30 m public version) |
| Geographic coverage | India |
| Update frequency | Static |
| Access method | Bhuvan download section |
| API requirements | Bhuvan user registration |
| Availability | Public with registration (to verify) |
| Licensing considerations | NRSC data policy. Check redistribution and attribution terms. |
| Prototype suitability | **Medium–High**: an Indian source, good for the narrative. Access friction to verify. |
| Backup option | Copernicus DEM (4.1) |
| Status | UNVERIFIED |

---

## 5. Slope (and other terrain derivatives)

| Field | Details |
|---|---|
| Provider | **Derived by GeoRakshak** from the selected DEM. Not an external source. |
| Dataset | Slope (degrees), aspect, curvature, relief, and optionally a topographic wetness index |
| Geographic coverage | Same as source DEM, clipped to the pilot area |
| Update frequency | Recomputed only when the DEM changes |
| Access method | Standard GIS processing (for example GDAL terrain tools) in a versioned script |
| API requirements | None |
| Availability | N/A |
| Licensing considerations | A derivative of the DEM, so it inherits the DEM licence and attribution |
| Prototype suitability | **High** |
| Backup option | Derive from the backup DEM |
| Provenance label | `REAL_HISTORICAL` (derived). The processing script and parameters are recorded. |

Notes: compute slope in a projected CRS (for example the appropriate UTM zone for the pilot area) to avoid degree-based distortion. Record the zone.

---

## 6. Historical landslides

### 6.1 GSI landslide inventory and susceptibility (primary)
| Field | Details |
|---|---|
| Provider | Geological Survey of India (GSI) |
| Dataset | Landslide inventory and National Landslide Susceptibility Mapping (NLSM) outputs |
| Geographic coverage | Landslide-prone regions of India, including NER (coverage per district to verify) |
| Update frequency | Irregular / programme-based |
| Access method | **In use (2026-09-18):** the Bhusanket portal's public ArcGIS REST layer, `bhusanket.gsi.gov.in/gisserver/rest/services/Hosted/Public_Portal_Dashboard_Map/FeatureServer/0`. The older Bhukosh geoportal is unreachable from our network (TCP timeouts). |
| API requirements | None for the point layer: open ArcGIS REST, paged queries. The polygon services require a token (`499 Token Required`). |
| Availability | Point inventory: available and queried. Polygons and susceptibility rasters: **not available** without credentials. |
| Licensing considerations | 🔶 Reproduction requires **prior GSI permission by e-mail**, accurate reproduction, and prominent source acknowledgement. Raw data is not redistributed and stays gitignored. Same handling as IMD rainfall (S1). |
| Prototype suitability | **High.** Surveyed records, 8,691 in the NER states and 132 in the pilot, with movement type, material, trigger, mechanism, geology and dimensions. Replacing the media-derived catalogue removed the measured reporting bias (see [ml-strategy.md §4](ml-strategy.md)). |
| Limitations | No usable dates (`date`, `date_acc`, `geo_acc` empty for every NER record; 2,270 carry an initiation year) → Stage A only, no dated Stage B. No mapped extent → negatives remain "unlabelled", not true absences. |
| Backup option | NASA Global Landslide Catalog (6.2), research inventories (6.3) |
| Status | **VERIFIED 2026-09-18** (independently re-checked). Open team actions: request permission to publish derived maps, and access to the polygon services and record dates. |

### 6.2 NASA Global Landslide Catalog (GLC)
| Field | Details |
|---|---|
| Provider | NASA Goddard Space Flight Center |
| Dataset | Global Landslide Catalog (rainfall-triggered events compiled mainly from media and reports). Related citizen-science Landslide Reporter / COOLR data. |
| Geographic coverage | Global point events, including some in NER |
| Update frequency | Static archive for the compiled period (end date to verify) |
| Access method | NASA open data portal download (CSV/GeoJSON; to verify) |
| API requirements | None known |
| Availability | Public |
| Licensing considerations | NASA open data. Check any terms for citizen-science components. |
| Prototype suitability | **Medium**: has event **dates** (useful for rainfall-trigger analysis). Location accuracy varies per record (the catalogue includes an accuracy field, to verify). It is biased toward reported, road-adjacent and fatal events. |
| Backup option | GSI inventory (6.1) |
| Status | UNVERIFIED |

### 6.3 Published research inventories and official disaster reports
| Field | Details |
|---|---|
| Provider | Peer-reviewed publications. State disaster management authorities / NDMA reports. |
| Dataset | Event-specific inventories (for example post-monsoon mapping studies), situation reports |
| Geographic coverage | Localised |
| Update frequency | Irregular |
| Access method | Supplementary material of papers, and published PDFs (manual digitisation) |
| API requirements | None |
| Availability | Varies |
| Licensing considerations | Per publication. Many are not openly licensed for redistribution. Cite. |
| Prototype suitability | **Low–Medium**: labour-intensive. Useful for validating the pilot area. |
| Backup option | 6.1 / 6.2 |
| Status | UNVERIFIED (none specifically identified yet) |

**Reference model (not labels):** NASA's LHASA (Landslide Hazard Assessment for Situational Awareness) global model outputs could serve as an external comparison baseline. Access and licence: UNVERIFIED.

---

## 7. Satellite / remote sensing

### 7.1 Sentinel-2 (optical)
| Field | Details |
|---|---|
| Provider | ESA / European Commission (Copernicus) |
| Dataset | Sentinel-2 MSI Level-2A surface reflectance (10–60 m) |
| Geographic coverage | Global land |
| Update frequency | ~5-day revisit (cloud cover in the NER monsoon severely limits usable scenes) |
| Access method | Copernicus Data Space Ecosystem (browser and APIs, to verify), and cloud platforms |
| API requirements | Free account |
| Availability | Public |
| Licensing considerations | Copernicus Sentinel data terms: free, full and open. Attribution. |
| Prototype suitability | **Medium**: NDVI / land-cover feature, and post-event visual evidence. Not a real-time trigger. |
| Backup option | Landsat 8/9 (7.3) |
| Status | UNVERIFIED |

### 7.2 Sentinel-1 (SAR)
| Field | Details |
|---|---|
| Provider | ESA / European Commission (Copernicus) |
| Dataset | Sentinel-1 C-band SAR (GRD, SLC) |
| Geographic coverage | Global (acquisition plan varies by region) |
| Update frequency | Revisit of days to ~12 days depending on constellation status (to verify) |
| Access method | Copernicus Data Space Ecosystem |
| API requirements | Free account |
| Availability | Public |
| Licensing considerations | Copernicus Sentinel data terms |
| Prototype suitability | **Low for the MVP**: cloud-independent change detection and InSAR are strong **future** features but need specialist processing. |
| Backup option | None equivalent for the MVP |
| Status | UNVERIFIED |

### 7.3 Landsat 8/9
| Field | Details |
|---|---|
| Provider | USGS / NASA |
| Dataset | Landsat Collection 2 Level-2 (30 m) |
| Geographic coverage | Global |
| Update frequency | 16-day per satellite (~8 days combined) |
| Access method | USGS EarthExplorer, and cloud mirrors |
| API requirements | USGS account for EarthExplorer |
| Availability | Public |
| Licensing considerations | US government data, generally public domain. Citation requested. |
| Prototype suitability | **Medium**: backup for vegetation/land-cover features |
| Backup option | Sentinel-2 (7.1) |
| Status | UNVERIFIED |

### 7.4 Land cover (derived products)
| Field | Details |
|---|---|
| Provider | ESA (WorldCover), and NRSC/Bhuvan (Land Use Land Cover products) |
| Dataset | ESA WorldCover 10 m, and Bhuvan LULC |
| Geographic coverage | Global (ESA) / India (Bhuvan) |
| Update frequency | Periodic versions |
| Access method | Portal download (ESA). Bhuvan registration (to verify). |
| API requirements | To verify |
| Availability | Public (ESA). Bhuvan to verify. |
| Licensing considerations | ESA WorldCover open licence with attribution (verify version). NRSC policy. |
| Prototype suitability | **High** as a static land-cover feature |
| Backup option | NDVI derived from Sentinel-2 |
| Status | UNVERIFIED |

### 7.5 MVP use of satellite data (OR-03, OR-18)

| Use | Source | Class | Label |
|---|---|---|---|
| Land cover feature and layer | ESA WorldCover (7.4) | LIGHTWEIGHT (real, precomputed) | `REAL_HISTORICAL` + product version |
| Vegetation index (for example NDVI) feature | Low-cloud Sentinel-2 composite for a stated date range (7.1) | LIGHTWEIGHT (real, precomputed) | `REAL_HISTORICAL` + date range |
| Satellite imagery map layer | Same Sentinel-2 composite, true colour | LIGHTWEIGHT (real, precomputed) | Acquisition date range shown on the map |
| Terrain | Copernicus DEM / SRTM (satellite-derived, §4) | CORE | `REAL_HISTORICAL` |
| Near-real-time satellite rainfall feed | GPM IMERG (2.2) | **INTEGRATION-READY** (moves to LIGHTWEIGHT if the spike connects it) | `REAL_LIVE` only when really connected |
| Post-event change detection, SAR/InSAR | Sentinel-2 / Sentinel-1 | POST-MVP | — |

Rules: never show an old image as current, and never show before/after imagery of an event unless the event and dates are real and documented. Monsoon cloud cover makes optical composites hard. Use a dry-season composite for static features and say so.

**Processing platform option:** Google Earth Engine hosts many of the above. It needs registration and acceptance of its terms (non-commercial/research eligibility to verify). 🔶 Requires human approval before we depend on it.

---

## 8. Roads

### 8.1 OpenStreetMap
| Field | Details |
|---|---|
| Provider | OpenStreetMap contributors. Regional extracts by Geofabrik. |
| Dataset | OSM `highway=*` features |
| Geographic coverage | Global. Completeness in rural NER varies and must be checked for the pilot area. |
| Update frequency | Continuous. Extracts refreshed roughly daily (to verify). |
| Access method | Geofabrik regional extract download (India / sub-region), or the Overpass API for small areas |
| API requirements | None for extracts. Overpass has fair-use limits. |
| Availability | Public |
| Licensing considerations | **ODbL**: attribution "© OpenStreetMap contributors", with share-alike on derived databases |
| Prototype suitability | **High** |
| Backup option | PMGSY rural road data (8.2) |
| Status | UNVERIFIED |

### 8.2 PMGSY rural roads (GIS)
| Field | Details |
|---|---|
| Provider | Ministry of Rural Development (PMGSY programme) |
| Dataset | Rural road network GIS data |
| Geographic coverage | India (rural roads) |
| Update frequency | Unknown |
| Access method | Unknown to the team. Possibly public viewers, and bulk download uncertain. |
| API requirements | Unknown |
| Availability | Unknown |
| Licensing considerations | Unknown |
| Prototype suitability | **Low** until verified |
| Backup option | OSM (8.1) |
| Status | UNVERIFIED (existence of downloadable GIS data not confirmed) |

---

### 8.3 Road connectivity status (derived, OR-12)
| Field | Details |
|---|---|
| Provider | **Derived by GeoRakshak.** No external source. |
| Dataset | Road segments (OSM 8.1, split at intersections) with `status`: `OPEN`, `AT_RISK`, `BLOCKED`, `UNKNOWN`, plus `status_reason`, `status_source` and `updated_at` |
| Inputs | Risk (current/forecast) per cell (`MODEL_OUTPUT`), verified field reports (`REAL_LIVE` in operations, `SIMULATED_DEMO` in the demo), authority overrides |
| Update frequency | Every monitoring cycle, and on each verification |
| Access method | Internal |
| Licensing considerations | Road geometry inherits ODbL (attribution, share-alike on the derived database) |
| Prototype suitability | **High.** Segment status + a village "access at risk" rule. **No routing/reachability in the MVP.** |
| Backup option | Manual status by the authority |
| Limitations | OSM completeness in rural NER varies. `OPEN` means "no evidence of blockage," not confirmed passable. The UI must say this. |

**Official road status feeds** (for example from state public works departments or national highway agencies): none identified. Unverified. Post-MVP integration candidate.

## 9. Villages

### 9.1 Census of India 2011 + Local Government Directory (attributes)
| Field | Details |
|---|---|
| Provider | Office of the Registrar General & Census Commissioner (Census 2011). Ministry of Panchayati Raj (Local Government Directory, LGD). |
| Dataset | Village directory / Primary Census Abstract (population, households). LGD village codes and hierarchy. |
| Geographic coverage | India |
| Update frequency | Census 2011 is static and dated. LGD is updated continuously. |
| Access method | Portal downloads (tabular) |
| API requirements | To verify |
| Availability | Public (tabular). **Village geometries are not included** in these tabular releases. |
| Licensing considerations | Government open data terms (verify) |
| Prototype suitability | **Medium**: attributes for exposure. Population figures are from 2011 and must be labelled as such. |
| Backup option | OSM place attributes (9.2) |
| Status | UNVERIFIED |

### 9.2 OpenStreetMap places
| Field | Details |
|---|---|
| Provider | OpenStreetMap contributors |
| Dataset | `place=village`, `place=hamlet`, `place=town` points, and building footprints where mapped |
| Geographic coverage | Global. Completeness varies. |
| Update frequency | Continuous |
| Access method | Geofabrik extract / Overpass API |
| API requirements | None for extracts |
| Availability | Public |
| Licensing considerations | ODbL |
| Prototype suitability | **High** for locations. No reliable population. |
| Backup option | Village polygons from research datasets (9.3) |
| Status | UNVERIFIED |

### 9.3 Village boundary polygons (research / government)
| Field | Details |
|---|---|
| Provider | Candidates: SHRUG open polygons (Development Data Lab), Bhuvan/Survey of India village layers |
| Dataset | 2011 village/town boundary polygons |
| Geographic coverage | India (completeness to verify for NER) |
| Update frequency | Static |
| Access method | Download from the provider (to verify) |
| API requirements | Possibly registration |
| Availability | To verify |
| Licensing considerations | Research licences may be non-commercial / share-alike. Government terms. **Must verify.** |
| Prototype suitability | **Medium** |
| Backup option | OSM places (9.2) with buffer-based exposure |
| Status | UNVERIFIED |

---

### 9.4 Critical infrastructure (OR-09)
| Field | Details |
|---|---|
| Provider | OpenStreetMap contributors |
| Dataset | Facilities tagged in OSM, for example schools, hospitals/clinics, bridges, shelters, police/fire stations (tag list to be fixed at verification) |
| Geographic coverage | Global. **Completeness in rural NER is uncertain** and must be sampled for the pilot area. |
| Update frequency | Continuous |
| Access method | Geofabrik extract / Overpass API |
| API requirements | None for extracts |
| Availability | Public |
| Licensing considerations | ODbL |
| Prototype suitability | **Medium–High.** Missing facilities mean exposure counts are lower bounds. The UI must say so. |
| Backup option | Government facility directories (for example health/school registries). Availability and geocoding unverified. |
| Status | UNVERIFIED |

## 10. Administrative boundaries

### 10.1 Survey of India (official)
| Field | Details |
|---|---|
| Provider | Survey of India (SoI) |
| Dataset | Official administrative boundaries (state, district, sub-district) |
| Geographic coverage | India |
| Update frequency | Periodic |
| Access method | SoI online geoportal (download availability and formats to verify) |
| API requirements | Registration likely (to verify) |
| Availability | To verify. Liberalised under India's geospatial guidelines (2021) and National Geospatial Policy (2022); specifics to verify. |
| Licensing considerations | SoI terms. **Any map of India we display must show India's external boundaries as officially depicted.** Treat this as a hard requirement for a government-facing demo. |
| Prototype suitability | **High** if obtainable, since it is the safest for official use |
| Backup option | LGD codes (10.2) combined with a community boundary dataset (10.3) |
| Status | UNVERIFIED |

### 10.2 Local Government Directory (codes)
| Field | Details |
|---|---|
| Provider | Ministry of Panchayati Raj |
| Dataset | Standard codes for states, districts, sub-districts, blocks, panchayats and villages |
| Geographic coverage | India |
| Update frequency | Continuous |
| Access method | LGD portal downloads |
| API requirements | To verify |
| Availability | Public (tabular) |
| Licensing considerations | Government terms (verify) |
| Prototype suitability | **High** as the canonical join key. Not geometry. |
| Backup option | Census 2011 codes |
| Status | UNVERIFIED |

### 10.3 Community / global boundary datasets
| Field | Details |
|---|---|
| Provider | Candidates: DataMeet community maps, geoBoundaries, GADM |
| Dataset | State/district boundary polygons |
| Geographic coverage | India / global |
| Update frequency | Irregular |
| Access method | Repository / portal download |
| API requirements | None known |
| Availability | Public |
| Licensing considerations | Varies: open with attribution (some), **non-commercial only (GADM)**. International boundaries may **not** match India's official depiction, so they are unsuitable for display without correction. |
| Prototype suitability | **Medium** for internal development only |
| Backup option | Survey of India (10.1) |
| Status | UNVERIFIED |

---

## 11. Simulated demo data

Some demo moments need events on demand (a heavy-rain scenario, a field report). These use **clearly labelled simulated data**:

| Item | Approach | Label |
|---|---|---|
| Rainfall scenario | **Preferred:** replay of a real historical rainfall period from IMD gridded data (`REAL_HISTORICAL`). Never claim a landslide happened unless the inventory records one. **Fallback:** scripted rainfall over the real pilot-area grid, documented as synthetic. | `REAL_HISTORICAL` or `SIMULATED_DEMO` |
| Forecast rainfall (demo) | Scenario continuation for +24/48/72 h | `SIMULATED_DEMO` |
| Soil moisture sensor readings | Virtual stations (emulator) posting through the real ingestion API | `SIMULATED_DEMO` |
| Field and citizen reports, photos, videos | Created live by team members. Media captured by the team, never passed off as a real event. | `SIMULATED_DEMO` (demo accounts) |
| Users, officers, citizens | Fictional names. Phone numbers are team-owned test numbers or fictional (sandbox). | `SIMULATED_DEMO` |
| SMS dispatches | Rendered and logged in sandbox mode unless a gateway is approved | Status `SANDBOXED` |
| Risk, forecast risk, road status, priority | Real model and rules applied to mixed inputs | `MODEL_OUTPUT` (input provenance recorded) |

Simulated data never feeds reported model metrics.

---

## 12. Recommended MVP data stack (sources pending Phase 0 verification)

| Layer | Official req | Primary | Backup | MVP class |
|---|---|---|---|---|
| Rainfall (training/history) | OR-01 | IMD gridded 0.25° | CHIRPS | CORE |
| Rainfall (live) | OR-01, OR-07 | IMD API (if granted) | Approved provider (non-IMD label) or replay | LIGHTWEIGHT |
| Rainfall forecast | OR-13 | IMD API forecast (if granted) | Approved provider or replay scenario | LIGHTWEIGHT |
| IMD weather API | OR-17 | Adapter slot, access requested | — | INTEGRATION-READY |
| Satellite rainfall feed | OR-18 | GPM IMERG adapter | — | INTEGRATION-READY |
| Soil moisture sensors | OR-02, OR-19 | Virtual stations via sensor API | Post-MVP: physical nodes / partner gateway | LIGHTWEIGHT / INTEGRATION-READY |
| Soil moisture (model feature) | OR-02 | Antecedent-rainfall proxy (derived) | SMAP / ERA5-Land | CORE (proxy) |
| Elevation | OR-04 | Copernicus DEM GLO-30 | SRTM / CartoDEM | CORE |
| Slope | OR-04 | Derived from DEM | Derived from backup DEM | CORE |
| Landslide inventory | OR-05 | GSI (Bhukosh) | NASA GLC | CORE |
| Satellite imagery / vegetation | OR-03 | Sentinel-2 composite (precomputed) | Landsat 8/9 | LIGHTWEIGHT |
| Land cover | OR-03 | ESA WorldCover | Bhuvan LULC | LIGHTWEIGHT |
| Roads | OR-09 | OSM | PMGSY (if available) | CORE |
| Road connectivity status | OR-12 | Derived (8.3) | Manual authority status | LIGHTWEIGHT |
| Villages | OR-09 | OSM places + Census 2011 attributes | Village polygons (licence permitting) | CORE |
| Critical infrastructure | OR-09 | OSM facilities | Government directories (unverified) | CORE |
| Admin boundaries | — | Survey of India + LGD codes | Community dataset (dev only) | CORE |

🔶 **Requires human approval (H10):** final selection per layer, after the Phase 0 verification spike and licence review.

## 13. Dataset registry record (template)

Every dataset loaded gets a `data_sources` row and a markdown entry:

```yaml
id: <slug>
provider: <name>
dataset: <product name + version>
status: VERIFIED (YYYY-MM-DD) | UNVERIFIED | REJECTED
provenance: REAL_LIVE | REAL_HISTORICAL | SIMULATED_DEMO | MODEL_OUTPUT
coverage_spatial: <bbox or region>
coverage_temporal: <start–end>
resolution: <spatial / temporal>
access_method: <download | API | request>
credentials_required: <yes/no, type>
licence: <name + link to licence text>
attribution_text: <exact text>
retrieved_at: <ISO 8601>
processing: <script path + parameters>
known_limitations: <text>
```
