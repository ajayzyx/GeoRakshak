# Product Specification — GeoRakshak

> **Revision:** aligned with the official SIH26001 requirement list (see §2). Earlier drafts treated soil-moisture sensors, satellite imagery, SMS, video, citizen reporting, road connectivity and forecasts as future work. **They are now represented in the MVP**, at the depth defined in §2.

## 1. Problem

Landslides in the North Eastern Region of India threaten lives, block roads and cut villages off. The main contributors are steep terrain, fragile geology and intense monsoon rainfall. SIH26001 asks for an AI-based early warning and landslide risk monitoring system that:
- combines rainfall, soil moisture sensor data, satellite imagery, terrain and historical landslide records
- identifies high-risk zones and predicts possible landslide events
- sends real-time, multilingual SMS/app warnings
- shows vulnerable roads, villages and infrastructure on a GIS map
- collects geo-tagged citizen/field photo and video reports
- tracks road connectivity, gives weather-linked risk forecasts and prioritises emergency response
- works in low-network conditions on a cloud architecture with offline sync

GeoRakshak meets this as a **decision-support platform**. It estimates and explains risk, warns the right people, collects ground evidence and helps authorities prioritise. It does not replace official warning agencies and does not claim exact prediction.

## 2. Official requirement compliance

### 2.1 Classification definitions

| Class | Meaning | What we may claim |
|---|---|---|
| **1 · MVP CORE** | Works end-to-end in the prototype on real data (or live user input) for the pilot area | "Implemented" |
| **2 · MVP LIGHTWEIGHT / DEMO** | Works end-to-end in the product, but with reduced scope and/or clearly labelled simulated or sample inputs | "Implemented in prototype form," with the limitation stated |
| **3 · INTEGRATION-READY** | Interface, data model, adapter slot and data flow exist and are tested with our own fixtures. **No real external source or device is connected.** The UI shows the honest connection status. | "Architecture supports it. Connection pending." Never "integrated." |
| **4 · POST-MVP** | Designed and documented only | "Planned" |

### 2.2 Compliance matrix

| ID | Official requirement | Class | MVP scope (what actually exists) |
|---|---|---|---|
| OR-01 | Rainfall patterns | **1 CORE** | Real IMD gridded historical rainfall per grid cell. Antecedent rainfall (3/7/15/30-day) and anomaly against the cell's normal for that date. Scheduled rainfall update pipeline. |
| OR-02 | Soil moisture sensors | **2 LIGHTWEIGHT** | Real sensor ingestion API, sensor station registry and readings store. **Virtual sensor stations** (emulator) post readings through that same API, labelled `SIMULATED_DEMO`. Readings show on the map and feed the risk trigger as a documented rule-based modifier. |
| OR-03 | Satellite imagery | **2 LIGHTWEIGHT** | Real satellite-derived layers for the pilot area, precomputed: land cover (ESA WorldCover), a vegetation index from Sentinel-2, and a Sentinel-2 imagery layer showing its acquisition date. Used as model features and map layers. No live imagery stream. |
| OR-04 | Terrain / slope data | **1 CORE** | Real DEM → slope, relief, curvature per cell |
| OR-05 | Historical landslide records | **1 CORE** | Real inventory (GSI or NASA Global Landslide Catalog), used as labels and as a map layer |
| OR-06 | AI/ML identification of high-risk zones and prediction of possible landslide events | **1 CORE** | Trained susceptibility model with spatial validation and per-cell explanations. Rainfall-conditioned likelihood of landslide occurrence for the next 24–72 h window. Always described as a risk estimate. |
| OR-07 | Real-time alerts | **1 CORE** | Alert rules run on every data update. Alerts reach app users as soon as they are dispatched. |
| OR-08 | GIS visualization | **1 CORE** | Web map: risk, forecast risk, exposure, roads, sensors, satellite layers, reports |
| OR-09 | Vulnerable roads, villages and infrastructure | **1 CORE** | Real OpenStreetMap roads, villages and key facilities (schools, health facilities, bridges where mapped), overlaid with risk. Exposure counts per zone. |
| OR-10 | Geo-tagged citizen/field photo/video reporting | **1 CORE** | Mobile app with **field officer and citizen modes**. GPS, photo and **short video (≤30 s)**. Citizen reports go to a moderation queue. |
| OR-11 | Risk severity levels | **1 CORE** | Low / Moderate / High / Very High, with thresholds set from validation |
| OR-12 | Road connectivity status | **2 LIGHTWEIGHT** | Status per road segment: `OPEN` / `AT_RISK` (in High or Very High cells) / `BLOCKED` (from a verified report) / `UNKNOWN`. Villages flagged "access at risk" when their nearby access roads are blocked or at risk. **No full network routing.** |
| OR-13 | Weather-linked risk forecasts | **2 LIGHTWEIGHT** | The same scorer runs on **forecast** rainfall for +24/+48/+72 h. Outputs are labelled as forecast model output with the forecast source named. The source is an approved provider or the demo scenario. |
| OR-14 | Emergency response prioritisation | **1 CORE** | Transparent rules: risk × verified evidence × exposure (villages, facilities, blocked roads) × recency. Reasons shown for each item. |
| OR-15 | Multilingual notifications | **1 CORE** | App and SMS notification text from reviewed templates in English, Hindi and one pilot-area language. *Current state: English is working text, Hindi is machine-drafted and marked `DRAFT_UNREVIEWED` pending a native speaker, and the third language waits on the H4 pilot sign-off. Severity terms are translated; an authority's free-text actions are sent verbatim, never machine-translated.* |
| OR-16 | Low-network / offline functionality | **1 CORE** | Local-first report queue with duplicate-safe sync. Media syncs after the report data. Last-known risk and alerts cached on the phone. SMS reaches phones without data. |
| OR-17 | Integration with IMD weather APIs | **3 INTEGRATION-READY** | Provider-independent weather interface. IMD **gridded data** (real) already drives the model. The **IMD live API adapter** slot is defined, and access is requested in Phase 0. Status shown as `AWAITING_ACCESS` until it is really connected. |
| OR-18 | Satellite feeds | **3 INTEGRATION-READY** | Satellite-source interface and scheduled feed slot (first target: GPM IMERG satellite rainfall). Status is shown honestly. It moves to class 2 only if the Phase 0 spike connects it for real. |
| OR-19 | Sensor data | **3 INTEGRATION-READY** | A general sensor ingestion contract (station registry, reading types, units, quality flags) accepts any gateway that can POST JSON. Only virtual stations are connected (see OR-02). |
| OR-20 | Automated SMS / app-based early warning | **2 LIGHTWEIGHT** | **Automated** detection and dispatch under a tiered policy (§5.3). App channel is real. SMS channel renders and logs the real multilingual SMS in **sandbox mode** by default. It sends real SMS to consenting team numbers only if a gateway is approved. |
| OR-21 | Cloud-based architecture with offline sync | **2 LIGHTWEIGHT** | Containerised stack deployed to one cloud region (single node), object storage for media, real offline sync. **Not** high-availability or autoscaled. Laptop fallback for the venue. |

No official requirement is class 4. Post-MVP work extends requirements that already have an MVP representation (see §7).

### 2.3 Honesty mechanisms (apply to every class 2 and class 3 item)

1. **Data-source status panel** on the dashboard. Each source or channel shows one of: `CONNECTED_LIVE` · `CONNECTED_HISTORICAL` · `SIMULATED` · `SANDBOX` · `AWAITING_ACCESS` · `NOT_CONNECTED`.
2. **Provenance badge** on every value: `REAL_LIVE` / `REAL_HISTORICAL` / `SIMULATED_DEMO` / `MODEL_OUTPUT`.
3. **Mode banner:** `LIVE MODE` or `DEMO REPLAY MODE`.
4. Sensor stations show "Virtual sensor (simulated)." SMS log entries show "SANDBOX — not sent" unless really sent.
5. Satellite layers show their acquisition date. Forecast layers show their source and issue time.

## 3. Users

| User | Description | Surface | MVP? |
|---|---|---|---|
| **District Authority / Control Room** (primary) | Monitors risk and forecasts, approves public warnings, verifies reports, sets response priority | Web dashboard | Yes |
| **Field Officer** | Receives internal warnings and tasks, verifies sites, reports road and slope status with photo/video | Mobile app (field mode) | Yes |
| **Citizen** | Receives warnings (SMS/app), submits geo-tagged observations | Mobile app (citizen mode), SMS | Yes (light: demo accounts, moderated reports) |
| **State Authority** | Multi-district oversight | Web dashboard | Role exists. Single-district demo. |
| **System Administrator** | Users, thresholds, templates, data-source status | Seed/config for the MVP, admin UI later | Minimal |

User roles are assumptions until validated with domain stakeholders.

## 4. User journeys

### J1 — Monitoring: authority sees rising and forecast risk
1. The dashboard shows the pilot area risk map, the mode banner and the data-source status panel.
2. Rainfall updates arrive (live provider or replay). Virtual soil moisture stations report rising readings.
3. Cells move to High. The **Forecast +48 h** toggle shows where risk is expected to spread.
4. Road segments inside High cells turn `AT_RISK`. Exposed villages and facilities are listed.

### J2 — AI explains risk
1. The authority clicks a cell and sees the score, severity level, confidence, model version and top factors (rainfall anomaly, slope, vegetation from satellite, past landslides, soil moisture reading), each with its provenance.

### J3 — Automated early warning (tiered)
1. **Internal watch (automatic):** when a cell crosses into High, the system automatically notifies assigned field officers and the control room in-app, and by SMS if enabled.
2. **Public warning (human-approved):** the system drafts a multilingual citizen warning. The authority reviews and approves it. It is then dispatched through app and SMS channels to citizens registered in the affected area.
3. Every dispatch is logged per channel, language and recipient.

### J4 — Field and citizen reporting in low network
1. The field officer opens the task and goes to the site. There is no signal.
2. They record a report: category (for example `ROAD_BLOCKED`, `CRACK`), severity, GPS, photo and a short video. It is saved locally as **Queued**.
3. When connectivity returns, the report data syncs first, then the media. The status becomes **Synced**.
4. A citizen submits an observation from citizen mode. It lands as `UNVERIFIED` in moderation.

### J5 — Response
1. The dashboard shows new reports next to risk zones.
2. The authority verifies the field report. A verified `ROAD_BLOCKED` report sets the nearest road segment to `BLOCKED`. Villages depending on it are flagged "access at risk."
3. The priority list recalculates. The top item shows its reasons (verified evidence, Very High risk, 3 villages with access at risk, health facility nearby).

## 5. Core workflows

### 5.1 Data → risk
```
[Weather provider: IMD gridded (real) | forecast provider | replay]──┐
[Sensor ingestion API ← virtual stations / future gateways]──────────┤
[Satellite-derived static layers (real, precomputed)]────────────────┼─► [Features per cell] ─► [Scorer + explanations]
[Terrain, inventory, exposure (real)]────────────────────────────────┘          │
                                                     ┌──────────────────────────┴────────────┐
                                               [Current risk]                     [Forecast risk +24/48/72 h]
                                                     │
                                         [Road segment status] ─► [Exposure] ─► [Alert rules]
```

### 5.2 State machines
- **Alert:** `DRAFT → APPROVED → DISPATCHED → CLOSED`. A draft can become `REJECTED`. Internal watch alerts go `AUTO_DISPATCHED → CLOSED`.
- **Delivery (per recipient, per channel):** `QUEUED → SENT | SANDBOXED | FAILED → ACKNOWLEDGED (app only)`
- **Report:** `QUEUED_OFFLINE (device) → SUBMITTED → UNVERIFIED → VERIFIED | REJECTED`
- **Road segment:** `UNKNOWN | OPEN | AT_RISK | BLOCKED` (manual reopen by an authority)

### 5.3 Warning automation policy (APPROVED)

| Tier | Trigger | Audience | Approval | Channels |
|---|---|---|---|---|
| Watch (internal) | Cell reaches High (current or forecast) | Field officers, control room | **Automatic** | App (+ SMS if enabled) |
| Warning (public) | Cell reaches Very High, or High plus a verified report | Citizens in the affected area | **Human approval required** | App + SMS |
| Update / all-clear | Authority action | Previous recipients | Human | App + SMS |

This satisfies "automated SMS/app-based early warning" while keeping public warnings under human control. GeoRakshak is not an official warning authority.

## 6. MVP features

| # | Feature | Official reqs | Class |
|---|---|---|---|
| F1 | GIS risk map with severity levels and layers (risk, forecast, exposure, roads, sensors, satellite, landslide history, reports) | OR-08, OR-11, OR-03 | 1 (satellite layers 2) |
| F2 | AI risk scoring with explanations (trained susceptibility model + rainfall-conditioned likelihood) | OR-06, OR-01, OR-04, OR-05 | 1 |
| F3 | Weather-linked risk forecast (+24/48/72 h) | OR-13 | 2 |
| F4 | Environmental ingestion framework: weather-provider, sensor and satellite adapters, virtual soil moisture stations, data-source status panel | OR-01, OR-02, OR-17, OR-18, OR-19 | 1 / 2 / 3 |
| F5 | Vulnerable roads, villages, infrastructure and road connectivity status | OR-09, OR-12 | 1 / 2 |
| F6 | Geo-tagged photo/video reporting, field and citizen modes | OR-10 | 1 |
| F7 | Offline-first mobile: report queue, cached risk and alerts | OR-16, OR-21 | 1 |
| F8 | Automated tiered warnings through app + SMS (sandbox) channels | OR-07, OR-20 | 1 / 2 |
| F9 | Multilingual notifications (en, hi, + one pilot-area language) | OR-15 | 1 |
| F10 | Report verification and emergency response prioritisation | OR-14 | 1 |
| F11 | Cloud deployment (single region) with offline sync | OR-21 | 2 |

## 7. Post-MVP extensions

- Physical soil moisture / rain gauge / tilt sensor network, and gateway integrations (LoRa/MQTT)
- Live IMD API (once access is granted), live IMERG and Sentinel-2/Sentinel-1 feeds
- Satellite change detection for new slides, and InSAR deformation monitoring
- Trained dynamic (time-based) landslide model, if enough dated events exist
- Road network routing: true reachability, alternate routes
- Production SMS via a regulator-compliant gateway, IVR/voice, and cell broadcast via authorised channels
- Community registration and OTP verification at scale, and moderation tooling
- High-availability multi-zone cloud deployment, CDN for media, message queue for channels
- More NER languages, full UI localisation, accessibility (audio, low-literacy UI)
- Offline map tiles, and SMS-based report submission

## 8. Success criteria

### Hackathon prototype
- Every official requirement OR-01 to OR-21 is **visibly represented** in the demo at its declared class, with the matching status label (§2.3).
- The core demo runs live without errors within the planned time (see [demo.md](demo.md)).
- The trained model has a spatial-validation report and a model card. No metric uses simulated data.
- An airplane-mode report with photo and video syncs exactly once.
- An automated internal watch alert and a human-approved public warning are both dispatched, in at least two languages, through the app channel and the SMS channel (sandbox or real).
- A verified road-blocked report changes road status and response priority.
- Nothing simulated, sandboxed or awaiting access is presented as real.

### Product (post-hackathon, indicative)
- Recall of recorded landslides in High/Very High zones, reported next to the share of area flagged, on held-out areas
- Median time from field observation to dashboard visibility
- Warning delivery and acknowledgement rates per channel
- Validation of the workflow with at least one real disaster-management stakeholder (target)
