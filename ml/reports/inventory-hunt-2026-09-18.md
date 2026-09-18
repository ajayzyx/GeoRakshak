# Mapped landslide inventory hunt (2026-09-18)

> **Outcome: found and loaded.** The **GSI public landslide inventory** is reachable on a *different* GSI host,
> `bhusanket.gsi.gov.in`, which serves an open ArcGIS REST layer with **8,691 surveyed records in the 8 NER states
> and 132 inside the Aizawl pilot bbox**. Two open-licensed research inventories were also retrieved.
> All probes in this block ran between **2026-09-17T18:32Z and 18:47Z** (local date 2026-09-18, IST). Every attempt is
> logged with its UTC timestamp, the exact URL and the result in
> `ml/data/raw/inventory_hunt/attempts.tsv` (plus the earlier `ml/data/raw/gsi/gsi_attempts_20260917.tsv`).
> Nothing is recorded as a source unless the retrieval really succeeded.

## 1. GSI Bhukosh (data-strategy S15) — still blocked
| Attempt | Result |
|---|---|
| `https://bhukosh.gsi.gov.in/Bhukosh/Public` (6 s connect timeout) | ConnectTimeout |
| `https://gsi.gov.in/sitemap.xml` | HTTP 200 — a placeholder sitemap for "acme.com", no service discovery |
| `https://www.gsi.gov.in/robots.txt`, `https://gsi.gov.in/api/sitemap` | HTTP 404 |
| `https://gsi.gov.in/_next/static/.../_buildManifest.js` | HTTP 200 — 156 client-side routes, including `/landslide-hazard` and `/GeoSpatialWeb/GeoSpatial-map` |
| `https://gsi.gov.in/landslide-hazard`, `.../GeoSpatial-map` | HTTP 200 but JS-rendered with no data endpoint in the HTML |
| `https://gsi.gov.in/_next/static/chunks/pages/landslide-hazard-*.js` | HTTP 200 — the only external hosts it references are `bhukosh.gsi.gov.in` (unreachable) and `bisag-n.gov.in` |

Cumulative Bhukosh attempts: 11 earlier on 2026-09-17 (data spike and v2 block) and 1 more in this block. DNS resolves to 144.24.99.164; every TCP connect
to 443 and 80 times out. `data_sources.gsi-bhukosh-landslide-inventory` is now `NOT_CONNECTED` / `REJECTED` with that
evidence, and the team should still ask GSI whether Bhukosh is geo-restricted.

## 2. GSI Bhusanket (**new, reachable, now used**)
Found from the `Source(s)` column of the Zenodo Aizawl dataset (§4), which cites a GSI incidence-report PDF on
`bhusanket.gsi.gov.in`.

| Step | URL | Result |
|---|---|---|
| Portal | `https://bhusanket.gsi.gov.in/` | HTTP 200. Advertises "Landslide Inventory (Field Validated) — Download Data", NLSM 10K maps, state-wise reports |
| Incidence report PDF | `.../Output/LS_Incidence_Report/2021/Landslides at Ngaizel, Aizawl town … (13th June 2021).pdf` | HTTP 200, 1.98 MB (directory listing itself is 403) |
| Map config | `https://bhusanket.gsi.gov.in/json/config.json` | HTTP 200 — exposed the ArcGIS server `https://bhusanket.gsi.gov.in/gisserver/rest/services` |
| Service catalogue | `.../gisserver/rest/services?f=json` | HTTP 200 — folders GSI, Hosted, IMD, Sector_Map, Susceptibility, Test |
| `GSI/Landslide_Polygon`, `GSI/GSI_Landslide_India` | FeatureServer | HTTP 200 with `{"error":{"code":499,"message":"Token Required"}}` — **not public** |
| **`Hosted/Public_Portal_Dashboard_Map/FeatureServer/0`** (`Landslide_Public`, points) | query | HTTP 200, **31,545 records nationally, 10,932 in the NER bbox, 8,691 in the 8 NER states** |
| Terms | `https://bhusanket.gsi.gov.in/terms.html` | HTTP 200 (`Disclaimer.html` is 403) |

**Licence / terms, quoted:** "Material featured on this Portal may be reproduced free of charge after taking proper
permission by sending a mail to us. However, the material has to be reproduced accurately and not to be used in a
derogatory manner or in a misleading context. Wherever the material is being published or issued to others, the
source must be prominently acknowledged." → **no open licence**: internal prototype use with acknowledgement, and
**permission by e-mail is required before publishing or redistributing** anything derived from it. The raw download
stays in gitignored `data/raw/`. This is the same handling the team already accepted for the IMD rainfall grids.

**What the records contain** (real fields, checked): surveyed `latitude`/`longitude` (5 decimals), `slide_no`,
`toposheet`, `state`/`district`/`village`, `movement_t`, `material_t`, `triggering`, `failure_me`, `geology`,
`geomorphol`, `landuse_la`, dimensions (`length`, `width`, `height`, `depth`, `ls_area`), `activity`, `citation`
(e.g. "Theophilus, P.K. and Megotsohe Chasie, 2014. Updation of existing landslide inventory of North Eastern Region.
GSI, RHQ, NER, Shillong" and macro-scale 1:50,000 susceptibility mapping reports). Per state: Mizoram 2,046,
Nagaland 1,636, Manipur 1,578, Arunachal Pradesh 1,059, Meghalaya 902, Sikkim 768, Assam 635, Tripura 67.

**Gaps, stated honestly:** `date`, `date_acc` and `geo_acc` are empty for every NER record (2,270 carry an initiation
year, 489 a reactivation year), so this supports Stage A susceptibility, **not** dated Stage B. Points, not polygons —
the polygon service needs a token. 8,230 of 8,691 coordinates are distinct.

## 3. Other official Indian sources
| Source | URL(s) probed | Result |
|---|---|---|
| NRSC/ISRO Bhuvan WMS | `https://bhuvan-vec1.nrsc.gov.in/bhuvan/wms?…GetCapabilities` | HTTP 200, 7.5 MB, **13,343 layers, none matching landslide/LSZ/hazard** |
| Bhuvan WFS | `.../bhuvan/wfs?…GetCapabilities` | HTTP 200 with `ServiceUnavailable: Service WFS is disabled` — **no vector download** |
| Bhuvan disaster viewer | `https://bhuvan-app1.nrsc.gov.in/disaster/disaster.php?id=landslide` | HTTP 200. A viewer app (NDEM); landslide layers are not exposed as downloadable services in the page |
| Bhuvan open data | `https://bhuvan-app3.nrsc.gov.in/data/download/index.php` | HTTP 200, download portal (no landslide entry in the page, and downloads need a Bhuvan login) |
| NRSC Landslide Atlas of India | `https://www.nrsc.gov.in/nrscnew/resources_atlas_landslide.php` → `assets/pdf/atlas/landslide/Landslides_Atlas_of_India_Updated_25Aug2023.pdf` | HTTP 200 — **PDF report only, no machine-readable inventory** |
| NDMA | `https://ndma.gov.in/` | HTTP 200, no inventory dataset found |
| Mizoram DM&R | `https://dmr.mizoram.gov.in/` | HTTP 200; the only data-ish link is a GIS **tender** page. No published inventory |
| Mizoram SDMA | `https://sdma.mizoram.gov.in/` | HTTP 404 |
| data.gov.in | `https://api.data.gov.in/catalog?…`, `https://www.data.gov.in/search/site/landslide` | 404 / redirect to "page not found" — no dataset retrieved, so nothing recorded |

## 4. Published research inventories (open licence)
Searched Zenodo's API for five query strings (logged). Retrieved:

| Dataset | Licence | What it is | Use |
|---|---|---|---|
| **Sarma, P. & Paul, K. (2026), Aizawl landslide inventory 2015-2025** — Zenodo 20783995, DOI 10.5281/zenodo.20783995 | **CC-BY-4.0** | 19 **dated** events in/around Aizawl (2016-2025) with fatalities, coordinates flagged "Reported" (DMS) or "Approximate", and a source citation per event | **Loaded** into the pilot handoff as `zenodo-aizawl-rsf-2026` (18 inside the bbox). Also the lead that revealed the Bhusanket host |
| **Heijenk, R. et al. (2023), Multi-temporal landslide inventory for southern Sikkim** — Zenodo 8169506 | **CC-BY-4.0** | 255 mapped landslide **polygons** + the mapped-extent polygon (88.05-88.92 E, 27.07-27.55 N) from Google Earth, and 67 Cartosat stereo polygons with image extents | Downloaded. Not used for v3 because the GSI inventory covers all of NER; kept as the best option for a *true-absence* design (negatives inside a mapped extent) |
| Chen, P. et al. (2026), Large Landslide Inventory of the Eastern Himalaya — Zenodo 18931430 | CC-BY-4.0 | 420 large-landslide point locations, KML, 284 KB, bbox 90.4-97.2 E / 27.0-30.3 N; **226 fall inside our approximate NER-India mask** | Downloaded, not used in v3 (large slope-scale failures, no dates or extents); a usable cross-check for a future model |
| Titti, G. (2022), Dataset of landslide susceptibility in north-east India — Zenodo 6575572 | CC-BY-4.0 | 2.3 GB GeoPackage of susceptibility model inputs/outputs | Not downloaded: it is model output, not an inventory, and exceeds the download budget |

## 5. What this changed
- `historical_landslides.geojson` now carries **169 records from three sources**: `gsi-bhusanket` 132,
  `nasa-glc` 19, `zenodo-aizawl-rsf-2026` 18. Records from different inventories may describe the same landslide;
  each keeps its own `source_slug`.
- `past_landslide_density` is now computed from the **GSI surveyed** records (1,428 of 2,798 pilot cells > 0,
  max 2.23 /km²) instead of the 17 media-derived points. `feature_version` is therefore `pilot-features-0.2.0`.
- Stage A labels were rebuilt from the GSI inventory and re-run through the unchanged pre-registered gate:
  see `ml/reports/evaluation-2026-09-18-v3.md`.

## 6. Smallest usable inventory, if the team escalates further
For a Stage A model that can pass the gate with margin, the missing piece is now **polygon extents and dates**, not
record count. Concretely, the useful asks are:
1. **GSI `Landslide_Polygon` / `GSI_Landslide_India` services** (token-protected on the same reachable host) — polygon
   geometry would let us label cells by intersection instead of by a point, and would remove the 500 m window guess.
2. **GSI permission e-mail** for the Bhusanket data, so derived maps can be shown outside the team.
3. **Dates** for the NER records (`date` is empty in the public layer). With ~500 dated events in one state and
   accuracy ≤ 500 m, Stage B (rainfall-timed) becomes testable against the 0.25° IMD grids.
4. A **mapped extent** (surveyed-area polygon) for at least one district, which is what makes negatives true absences
   rather than "unlabelled". The southern-Sikkim Zenodo dataset has this for ~0.9° × 0.5°, and the same for a
   Mizoram district would be enough to validate the pilot directly.
