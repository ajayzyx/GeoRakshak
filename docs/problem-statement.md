# Problem Statement — SIH26001

## Tag legend

| Tag | Meaning |
|---|---|
| **[OFFICIAL REQUIREMENT]** | Stated in the official SIH26001 requirement list (§1). Quoted exactly. |
| **[OUR MVP IMPLEMENTATION]** | How GeoRakshak addresses it in the MVP, with its compliance class |
| **[FUTURE ENHANCEMENT]** | Planned beyond the MVP |
| **[TECHNICAL ASSUMPTION]** | Our interpretation or assumption. Not an official requirement. |

Compliance classes (defined in [product-spec.md §2.1](product-spec.md)):
- **1 CORE:** works end-to-end on real data or live user input.
- **2 LIGHTWEIGHT:** works end-to-end with reduced scope and/or labelled simulated or sandbox inputs.
- **3 INTEGRATION-READY:** the interface and data flow exist, no real external source is connected, and the status is shown honestly.
- **4 POST-MVP:** designed only.

---

## 1. Official problem statement

**[OFFICIAL REQUIREMENT]**

- **ID:** SIH26001
- **Title:** AI-Based Early Warning and Landslide Risk Monitoring System in NER
- **Source of §1.1:** official SIH26001 requirement list, provided by the project lead and confirmed as the authoritative requirement source on 2026-09-17.

### 1.1 Official requirements (verbatim, as provided)

The official problem statement explicitly requires:

- Rainfall patterns
- Soil moisture sensors
- Satellite imagery
- Terrain/slope data
- Historical landslide records
- AI/ML identification of high-risk zones and prediction of possible landslide events
- Real-time alerts
- GIS visualization
- Vulnerable roads, villages and infrastructure
- Geo-tagged citizen/field photo/video reporting
- Risk severity levels
- Road connectivity status
- Weather-linked risk forecasts
- Emergency response prioritisation
- Multilingual notifications
- Low-network/offline functionality
- Integration with IMD weather APIs
- Satellite feeds
- Sensor data
- Automated SMS/app-based early warning
- Cloud-based architecture with offline sync

### 1.2 Portal metadata (not yet recorded)

```
Full prose description (if different from §1.1): NOT PROVIDED. Do not paraphrase or invent.
Organisation / ministry: NOT PROVIDED
Category (Software/Hardware): NOT PROVIDED
Theme: NOT PROVIDED
```

If this metadata is added later and changes any requirement, re-run the mapping in §2 and update [product-spec.md §2](product-spec.md).

### 1.3 Requirement IDs

We refer to the official requirements as OR-01 to OR-21, in the order listed in §1.1. The IDs are ours. The wording is official.

---

## 2. Requirement mapping

### OR-01 — Rainfall patterns
- **[OFFICIAL REQUIREMENT]** "Rainfall patterns"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** Real IMD gridded historical rainfall per grid cell. Rainfall totals over the previous 3/7/15/30 days, and anomaly against the cell's normal for that date. Scheduled update pipeline with live and replay modes.
- **[FUTURE ENHANCEMENT]** Station and rain-gauge data. Sub-daily intensity from satellite rainfall.
- **[TECHNICAL ASSUMPTION]** Daily gridded rainfall is adequate for a prototype trigger signal. Its coarse resolution is a documented limitation.

### OR-02 — Soil moisture sensors
- **[OFFICIAL REQUIREMENT]** "Soil moisture sensors"
- **[OUR MVP IMPLEMENTATION]** **Class 2.** Real sensor ingestion API and station registry. **Virtual sensor stations** post readings through that API, labelled `SIMULATED_DEMO` and shown as "Virtual sensor (simulated)." Readings appear as a map layer and act as a bounded, documented risk adjustment. They are never used for training or reported metrics.
- **[FUTURE ENHANCEMENT]** Physical sensor nodes or partner sensor networks connected to the same API.
- **[TECHNICAL ASSUMPTION]** No open, real-time in-situ soil moisture feed for NER is available to the team. Hardware deployment is outside the prototype's scope.

### OR-03 — Satellite imagery
- **[OFFICIAL REQUIREMENT]** "Satellite imagery"
- **[OUR MVP IMPLEMENTATION]** **Class 2.** Real, precomputed satellite-derived layers for the pilot area, each with its acquisition date range: Sentinel-2 true-colour imagery and vegetation index, and ESA WorldCover land cover. Used as model features and map layers.
- **[FUTURE ENHANCEMENT]** Recurring imagery updates, change detection for new slides, SAR/InSAR.
- **[TECHNICAL ASSUMPTION]** Monsoon cloud cover limits optical imagery, so a dated composite is suitable for static features.

### OR-04 — Terrain/slope data
- **[OFFICIAL REQUIREMENT]** "Terrain/slope data"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** Real elevation model → slope, relief, curvature per grid cell.
- **[FUTURE ENHANCEMENT]** Higher-resolution elevation data where licensable. Geology and soil depth layers.
- **[TECHNICAL ASSUMPTION]** ~30 m elevation data aggregated to 250–500 m cells balances detail and prototype performance.

### OR-05 — Historical landslide records
- **[OFFICIAL REQUIREMENT]** "Historical landslide records"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** Real landslide inventory (GSI primary, NASA Global Landslide Catalog fallback, subject to verification). Used as training labels and as a map layer.
- **[FUTURE ENHANCEMENT]** Verified field reports added to the inventory over time.
- **[TECHNICAL ASSUMPTION]** At least one inventory is downloadable with enough records for the pilot or training area.

### OR-06 — AI/ML identification of high-risk zones and prediction of possible landslide events
- **[OFFICIAL REQUIREMENT]** "AI/ML identification of high-risk zones and prediction of possible landslide events"
- **[OUR MVP IMPLEMENTATION]** **Class 1.**
  - **Zones:** a susceptibility model trained on real data, checked on held-out areas, with a model card and per-cell explanations.
  - **Events:** a rainfall-conditioned likelihood of landslides for the next 24–72 h. It uses a trained model only if enough dated events exist, and a documented rule-based trigger otherwise.
  - Always presented as a risk estimate.
- **[FUTURE ENHANCEMENT]** Trained time-based model with a time-split holdout, and learning from verified reports.
- **[TECHNICAL ASSUMPTION]** "Prediction" means a likelihood estimate over a time window, not an exact time and place.

### OR-07 — Real-time alerts
- **[OFFICIAL REQUIREMENT]** "Real-time alerts"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** Alert rules run on every monitoring cycle. Dispatch is immediate. Data freshness depends on each source's own latency, which is displayed.
- **[FUTURE ENHANCEMENT]** Event-driven processing for sub-minute sensor streams.
- **[TECHNICAL ASSUMPTION]** "Real-time" for rainfall data means as soon as the source publishes, not continuous measurement.

### OR-08 — GIS visualization
- **[OFFICIAL REQUIREMENT]** "GIS visualization"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** Web map with current and forecast risk, severity levels, landslide history, satellite layers, sensors, villages and facilities, road status and reports.
- **[FUTURE ENHANCEMENT]** Full-NER coverage with vector tiles. Offline map tiles on mobile.
- **[TECHNICAL ASSUMPTION]** The map view is limited to the pilot area and avoids showing national boundaries from non-official datasets.

### OR-09 — Vulnerable roads, villages and infrastructure
- **[OFFICIAL REQUIREMENT]** "Vulnerable roads, villages and infrastructure"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** Real OpenStreetMap roads, villages and facilities (schools, health facilities, bridges and shelters where mapped), overlaid with risk. Exposure counts per zone.
- **[FUTURE ENHANCEMENT]** Official asset registries, population and vulnerability indicators.
- **[TECHNICAL ASSUMPTION]** OSM completeness in rural NER varies, so exposure counts are lower bounds.

### OR-10 — Geo-tagged citizen/field photo/video reporting
- **[OFFICIAL REQUIREMENT]** "Geo-tagged citizen/field photo/video reporting"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** One mobile app with field officer and citizen modes. GPS with accuracy, photo, and video up to 30 s. Citizen reports require verification before they affect road status or priority.
- **[FUTURE ENHANCEMENT]** Citizen sign-up with OTP, moderation tooling at scale, drone imagery.
- **[TECHNICAL ASSUMPTION]** MVP citizens use demo accounts.

### OR-11 — Risk severity levels
- **[OFFICIAL REQUIREMENT]** "Risk severity levels"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** Low / Moderate / High / Very High. Thresholds are proposed from validation results and reviewed by the team.
- **[FUTURE ENHANCEMENT]** Thresholds aligned with any official severity scheme, once one is identified.
- **[TECHNICAL ASSUMPTION]** A four-level scale is understandable to authorities and citizens. Level names must not be confused with official agency terminology.

### OR-12 — Road connectivity status
- **[OFFICIAL REQUIREMENT]** "Road connectivity status"
- **[OUR MVP IMPLEMENTATION]** **Class 2.** Status per road segment: `OPEN` (no evidence of blockage), `AT_RISK` (crosses High/Very High cells), `BLOCKED` (from a verified report or authority action), `UNKNOWN`. Villages are flagged "access at risk" by a simple distance rule. **No route calculation.**
- **[FUTURE ENHANCEMENT]** Route calculation for true reachability and alternate routes. Official road-status feeds.
- **[TECHNICAL ASSUMPTION]** Segment-level status plus a village access flag is enough to show connectivity impact in a prototype.

### OR-13 — Weather-linked risk forecasts
- **[OFFICIAL REQUIREMENT]** "Weather-linked risk forecasts"
- **[OUR MVP IMPLEMENTATION]** **Class 2.** The same scorer runs on forecast rainfall for +24/+48/+72 h. Source and issue time are labelled. The forecast source is IMD (if access is granted), an approved provider labelled non-IMD, or the replay scenario. **Forecast accuracy is not claimed until it has been evaluated.**
- **[FUTURE ENHANCEMENT]** Validation against archived forecasts. Ensemble uncertainty.
- **[TECHNICAL ASSUMPTION]** Forecast rainfall uncertainty passes directly into forecast risk.

### OR-14 — Emergency response prioritisation
- **[OFFICIAL REQUIREMENT]** "Emergency response prioritisation"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** Transparent rules combining risk, verified evidence, exposure (villages, facilities, blocked access) and recency. Reasons shown per item.
- **[FUTURE ENHANCEMENT]** Resource and team allocation, and learned prioritisation once response data exists.
- **[TECHNICAL ASSUMPTION]** Authorities prefer explainable rules over opaque ranking for response decisions.

### OR-15 — Multilingual notifications
- **[OFFICIAL REQUIREMENT]** "Multilingual notifications"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** App and SMS notification text from human-reviewed templates in English, Hindi and one pilot-area language.
- **[FUTURE ENHANCEMENT]** More NER languages, voice/IVR, full UI translation.
- **[TECHNICAL ASSUMPTION]** Safety-critical text must not be machine-translated without review.

### OR-16 — Low-network/offline functionality
- **[OFFICIAL REQUIREMENT]** "Low-network/offline functionality"
- **[OUR MVP IMPLEMENTATION]** **Class 1.** Reports are stored on the phone first and synced without duplicates, with report data before media. Last-known risk and alerts are cached. SMS reaches phones without data.
- **[FUTURE ENHANCEMENT]** Offline map tiles, SMS-based report submission.
- **[TECHNICAL ASSUMPTION]** Field connectivity is intermittent, especially during severe weather.

### OR-17 — Integration with IMD weather APIs
- **[OFFICIAL REQUIREMENT]** "Integration with IMD weather APIs"
- **[OUR MVP IMPLEMENTATION]** **Class 3.** A provider-independent weather interface. IMD **gridded rainfall data** is really used. The **IMD API adapter** shows `AWAITING_ACCESS` until IMD grants access. No IMD API request or response format is assumed in code, tests or docs.
- **[FUTURE ENHANCEMENT]** Live IMD observations and forecasts through the adapter, once access and documentation are available.
- **[TECHNICAL ASSUMPTION]** IMD API access is granted on request. Product list, terms and access process are **unverified**.

### OR-18 — Satellite feeds
- **[OFFICIAL REQUIREMENT]** "Satellite feeds"
- **[OUR MVP IMPLEMENTATION]** **Class 3.** A satellite-feed interface and scheduled job slot, first target GPM IMERG rainfall. Status `NOT_CONNECTED`, becoming class 2 only if the Phase 0/3 check really connects it.
- **[FUTURE ENHANCEMENT]** Live IMERG, recurring Sentinel-2/Sentinel-1 feeds.
- **[TECHNICAL ASSUMPTION]** Satellite feeds need accounts and format handling that may not fit the prototype timeline.

### OR-19 — Sensor data
- **[OFFICIAL REQUIREMENT]** "Sensor data"
- **[OUR MVP IMPLEMENTATION]** **Class 3.** A general sensor ingestion format (station registry, reading types, units, quality flags, per-station API key) that any gateway able to POST JSON can use. Only virtual stations are connected (see OR-02).
- **[FUTURE ENHANCEMENT]** Rain gauges, piezometers, tilt meters. LoRa/MQTT gateway bridge.
- **[TECHNICAL ASSUMPTION]** An HTTP ingestion format is a sufficient integration point for a prototype.

### OR-20 — Automated SMS/app-based early warning
- **[OFFICIAL REQUIREMENT]** "Automated SMS/app-based early warning"
- **[OUR MVP IMPLEMENTATION]** **Class 2.** Tiered automation:
  - **Internal watch alerts** to field officers and the control room are dispatched **automatically**.
  - **Public warnings** to citizens are drafted automatically and dispatched **only after human approval**.
  - The app channel is real. The SMS channel runs in **SANDBOX** mode by default: it renders and logs the exact message and marks it `SANDBOXED`, not sent.
- **[FUTURE ENHANCEMENT]** A regulator-compliant SMS gateway, IVR, cell broadcast through authorised channels.
- **[TECHNICAL ASSUMPTION]** Commercial SMS in India requires DLT registration. GeoRakshak is decision support, not an official warning authority, so public warnings stay under human control.

### OR-21 — Cloud-based architecture with offline sync
- **[OFFICIAL REQUIREMENT]** "Cloud-based architecture with offline sync"
- **[OUR MVP IMPLEMENTATION]** **Class 2.** A containerised single-region cloud deployment with a database, object storage and HTTPS, and real mobile offline sync. A laptop fallback runs the same containers. Not high-availability or autoscaled.
- **[FUTURE ENHANCEMENT]** Multi-zone high availability, message queues, service split, CDN.
- **[TECHNICAL ASSUMPTION]** A single-region deployment demonstrates a cloud-based architecture at prototype scale.

---

## 3. Explicit non-claims

- GeoRakshak does not claim to predict the exact time or location of a landslide.
- GeoRakshak is not an official warning authority. Public warnings require human approval.
- No integration marked `AWAITING_ACCESS`, `NOT_CONNECTED`, `SIMULATED` or `SANDBOX` is presented as live.
- Reported metrics come from real data with a stated validation method, never from simulated data. Forecast accuracy is not claimed until evaluated.

## 4. Open questions

1. Is there full prose, organisation, category or theme metadata for SIH26001 beyond §1.1? (§1.2)
2. Does the problem statement's organisation provide datasets, sensor data or API access (for example IMD) to participants?
3. Is there a preferred pilot state or district?
