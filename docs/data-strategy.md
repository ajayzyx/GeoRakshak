# Data Strategy — GeoRakshak

## 0. Read this first

- **Verification status.** The sources below are well-known public datasets and portals, recorded from the team's existing knowledge. **None has yet been checked hands-on for this project.** Before anyone relies on a source, the owner must confirm the following, then set its `Status` to `VERIFIED` with the date:
  current availability, NER coverage, access steps, rate limits and licence text.
- **No invented endpoints.** This document deliberately names **portals and products, not API endpoint URLs**. Exact endpoints, product version identifiers and query parameters are recorded only after testing them, in a later `docs/data-sources/` log.
- **Provenance.** Every dataset loaded into GeoRakshak is tagged `REAL_LIVE`, `REAL_HISTORICAL`, `SIMULATED_DEMO` or `MODEL_OUTPUT` (see [CLAUDE.md §9](../CLAUDE.md)).
- **Licences.** "Licensing considerations" below are summaries to check, not legal advice. Read and record the actual licence text at verification time.
- **Owner:** AI/ML Engineer (acquisition and preprocessing). Product/Communication Lead tracks licence/attribution records (see [team.md](team.md)).

Status legend: `UNVERIFIED` (known to exist, not yet tested by us) · `VERIFIED (date)` · `REJECTED (reason)`

---

## 1. Data needs overview

| Layer | Role in risk model | Type | Static/Dynamic | MVP priority |
|---|---|---|---|---|
| Rainfall | Main trigger for landslides in NER monsoon conditions | Gridded raster / time series | Dynamic | **Must** |
| Soil moisture | Antecedent wetness | Gridded raster | Dynamic | Should |
| Elevation (DEM) | Terrain base, derives slope/aspect/curvature | Raster | Static | **Must** |
| Slope | Key susceptibility factor | Derived raster | Static | **Must** |
| Historical landslides | Training labels and validation | Points/polygons | Mostly static | **Must** |
| Satellite / remote sensing | Land cover, vegetation, change detection | Raster | Periodic | Could (MVP: land cover only) |
| Roads | Exposure and access, and a known bias in inventories | Lines | Static-ish | **Must** |
| Villages | Exposure for response priority | Points/polygons + attributes | Static | **Must** |
| Administrative boundaries | Aggregation, filtering, authority jurisdiction | Polygons | Static | **Must** |

Grid proposal (pending ML validation): a uniform analysis grid over the pilot area. Cell size is chosen between the resolution of the DEM (~30 m) and that of the rainfall data (~5–25 km). Terrain attributes come at fine resolution, and rainfall is resampled or assigned to cells with its coarse origin documented.

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

**MVP recommendation:** use **antecedent rainfall** (for example cumulative rainfall over 3, 7, 15 and 30 days) as the primary wetness proxy. Soil moisture is an optional feature, added only if it improves spatial validation.

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
| Access method | GSI Bhukosh geoportal (viewing and download options to verify) |
| API requirements | Possibly registration. Download formats to verify. |
| Availability | To verify (view-only vs. downloadable) |
| Licensing considerations | GSI terms of use. Attribution. Redistribution limits likely need checking. |
| Prototype suitability | **High** if downloadable: the most authoritative Indian inventory. The susceptibility map is also a useful **comparison benchmark**. |
| Backup option | NASA Global Landslide Catalog (6.2) |
| Status | UNVERIFIED |

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
| Rainfall scenario | Scripted rainfall time series over the **real** pilot-area grid. Magnitude is chosen to be plausible and documented as synthetic. | `SIMULATED_DEMO` |
| Field report | Created live by a team member during the demo | `SIMULATED_DEMO` (demo account) |
| Users/officers | Fictional names and roles, with no real officials | `SIMULATED_DEMO` |
| Risk output | Real model applied to simulated input | `MODEL_OUTPUT` (input provenance recorded) |

Simulated data never feeds reported model metrics.

---

## 12. Recommended MVP data stack (pending verification and approval)

| Layer | Primary | Backup |
|---|---|---|
| Rainfall (training/history) | IMD gridded 0.25° | CHIRPS |
| Rainfall (latest) | GPM IMERG Early/Late | ERA5-Land / Open-Meteo |
| Soil moisture | Antecedent-rainfall proxy (derived) | SMAP / ERA5-Land |
| Elevation | Copernicus DEM GLO-30 | SRTM / CartoDEM |
| Slope | Derived from DEM | Derived from backup DEM |
| Landslide inventory | GSI (Bhukosh) | NASA GLC |
| Land cover | ESA WorldCover | Bhuvan LULC |
| Roads | OSM | PMGSY (if available) |
| Villages | OSM places + Census 2011 attributes | Village polygons (licence permitting) |
| Admin boundaries | Survey of India + LGD codes | Community dataset (dev only) |

🔶 **Requires human approval:** final selection, after the Phase 0 verification spike.

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
