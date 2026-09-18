# Team & Ownership — GeoRakshak

> **Revision:** aligned with the approved MVP for official SIH26001 OR-01 to OR-21. Adds owners for sensor ingestion and emulator, notification channels, citizen mode, road status, forecasting, adapters and the status registry, replay mode and cloud deployment.

## 1. Principles

- **One accountable owner per module.** Others may contribute through PRs the owner reviews.
- **Contracts at boundaries.** The owner of each contract is named explicitly (§3).
- **Realistic load.** The Backend role carries the most modules, so UI for backend features sits with Frontend/Mobile, data-heavy logic with AI/ML, and external coordination with Product/Communication (§6).
- **Decisions:** H1–H9 and H13–H18 are approved ([architecture.md §9](architecture.md)). Where an approved rule leaves a concrete choice (web/mobile framework, pilot area, basemap, cloud provider, non-IMD forecast provider), the named owner records it in Phase 0. Still-pending items follow §5.
- **Git:** the human developer owns Git operations, per [CLAUDE.md](../CLAUDE.md).

## 2. Roles

### 2.1 Frontend Developer (FE)
**Owns (web dashboard):**
- Risk map: severity legend, **current / forecast (+24/48/72 h) toggle**, layer control
- Layers: historical landslides, **satellite layers with acquisition dates**, villages/facilities, **road status**, **sensor stations** ("Virtual sensor" badge), reports
- Cell detail panel with explanation factors and provenance badges
- **Data-source status panel** and **run-mode banner**
- Alert views: automatic watches, **public warning approval**, **dispatch/delivery log** (incl. SMS `SANDBOXED` entries)
- **Report moderation and verification** UI with photo/video player
- **Road status override** UI
- Response-priority panel, dashboard summary
- Web UI strings, accessibility and map performance

**Doesn't own:** API, rules, scoring, template text.

### 2.2 Backend Developer (BE)
**Owns:**
- Single backend deployable, API contract ([api.md](api.md)), schema and migrations ([database.md](database.md))
- Auth and roles for 5 roles, `audit_events`
- **Adapter interfaces and data-source status registry** (`WeatherProvider`, `SatelliteSource`, `SensorSource`, `NotificationChannel`)
- **Adapter stubs:** IMD API (`AWAITING_ACCESS`) and IMERG feed slot (`NOT_CONNECTED`)
- **Scheduler / monitoring cycle** and **replay job** (running the scenario data ML provides)
- **Sensor ingestion API:** station registry, keys, validation, duplicate-safe storage
- **Forecast storage** and the risk/forecast endpoints (`lead_time_h`)
- **Road status module:** precedence rules, `AT_RISK` from risk, `BLOCKED` from verified reports, overrides, village access flags
- **Notification service:** tier policy (automatic internal `WATCH`, human-approved public `WARNING`), template rendering, **channels** (FCM push server side, app inbox, **SMS sandbox**, SMS gateway only after H14 compliance and cost clearance), delivery log
- Reports and media APIs (duplicate-safe sync, object storage, limits), verification effects
- Response-priority rules
- **Cloud deployment**, laptop fallback stack, CI, security hardening, demo reset script

**Doesn't own:** model training, features, emulator logic, UI, template wording.

### 2.3 AI/ML Engineer (ML)
**Owns:**
- [ml-strategy.md](ml-strategy.md) and the technical content of [data-strategy.md](data-strategy.md)
- Data spike and verification. Pilot-area recommendation.
- Offline pipeline: grid, terrain features, **satellite-derived features and layer preparation** (Sentinel-2 composite, WorldCover)
- OSM exposure preparation: villages, facilities, **road segment splitting**
- IMD gridded rainfall preparation. **Replay scenario data** (real historical period preferred).
- Labels, B0, trained susceptibility model, spatial validation, **model card**, threshold proposal
- `georakshak_ml` package: `score()` incl. **trigger rule, sensor adjustment and forecast mode**, `active_model()`
- **Forecast features** (observed + forecast rainfall), forecast-mode confidence rule
- **Virtual sensor emulator:** station placement, reading generation, posting to the sensor API
- **IMERG feasibility check** and the real IMERG adapter only if it proves feasible

**Doesn't own:** migrations (requests them from BE), endpoints, alert policy, UI.

### 2.4 Mobile App Developer (MOB)
**Owns (Android-first app):**
- Login and **field officer / citizen modes**
- **Local-first storage**, offline queue, background sync client (report data, then media), sync status UX
- Report form: GPS + accuracy, disclosed pin adjustment, category (incl. `ROAD_BLOCKED`), **photo and video (≤30 s) capture and compression**
- Inboxes: field (watch, warnings) and citizen (warnings). Acknowledge.
- **Push notification receipt** via FCM and device token registration (H8), with inbox polling fallback
- **Offline cache** of last-known area risk and received alerts
- Language selection and mobile UI strings
- APK builds and demo device setup

**Doesn't own:** server-side sync, notification dispatch, template wording.

### 2.5 Video Editor (VID)
**Owns:**
- Storyboard with PC (Phase 0)
- **Per-requirement clips** recorded as each slice lands (Phase 2 onward)
- Full backup demo video (4-minute core story), with on-screen labels (SIMULATED / SANDBOX / AWAITING ACCESS) kept visible
- Submission video assets required by SIH rules (to confirm)

**Doesn't own:** script content (PC), product UI.

### 2.6 Product / Communication Lead (PC)
**Owns:**
- [problem-statement.md](problem-statement.md), [product-spec.md](product-spec.md), [roadmap.md](roadmap.md), [demo.md](demo.md), this file
- Compliance matrix upkeep (OR-01 to OR-21) and scope control
- **External access and compliance:** IMD API access request and follow-up, SMS gateway/DLT feasibility, dataset licence and attribution sheet
- **Notification template content** in en, hi and the pilot-area language, plus native-speaker review
- Decision log for approvals
- Pitch deck (incl. integration-status slide), demo script, jury Q&A sheet, rehearsals

**Doesn't own:** technical implementation or code.

## 3. Boundary ownership

| Boundary | Owner | Collaborators | Rule |
|---|---|---|---|
| Public API contract | BE | FE, MOB, ML | Changes via PR to api.md |
| `georakshak_ml` interface | ML | BE | ML publishes the signature. BE calls it. |
| Adapter interfaces + status registry | BE | ML (weather/satellite semantics) | No status set to connected without a real call |
| Sensor ingestion contract | BE | ML (emulator is the first client) | Emulator uses only the public contract |
| Weather/forecast data | ML (preparation, features) | BE (adapter, storage, scheduling) | — |
| Satellite layers | ML (processing) | BE (metadata and serving), FE (display) | Acquisition dates always attached |
| Road status | BE (rules) | ML (segments), FE (layer, override UI), MOB (report category) | Only verified reports block roads |
| Notification channels | BE (dispatch, FCM server side) | MOB (FCM receipt), PC (text, DLT/cost check), FE (log UI) | SMS stays `SANDBOX` until DLT compliance and cost are cleared and documented (H14) |
| Citizen mode | MOB (app) | BE (role, moderation API), FE (moderation UI) | Citizen reports always start `UNVERIFIED` |
| Offline sync | MOB (client) | BE (duplicate-safe server) | Shared test cases |
| Replay mode | BE (job) | ML (scenario data), FE (banner) | Disabled in LIVE mode |
| DB schema | BE | ML | ML requests. BE migrates. |
| Severity thresholds | ML (proposal) | PC (review meeting) | Team approves (H11) |
| Demo | PC (script) | VID (video), BE (reset), all (live) | — |

## 4. MVP feature matrix

R = Responsible, A = Accountable, C = Consulted

| Feature (product-spec §6) | FE | BE | ML | MOB | VID | PC |
|---|---|---|---|---|---|---|
| F1 GIS risk map + layers | **A/R** | R (API) | R (layers) | — | — | C |
| F2 AI risk scoring + explanations | R (UI) | R (persistence) | **A/R** | — | — | C (wording) |
| F3 Weather-linked forecast | R (toggle) | R (adapter, storage) | **A/R** (features, forecast mode) | — | — | C |
| F4 Ingestion framework, sensors, status registry | R (panel, layer) | **A/R** (adapters, sensor API) | R (emulator, data) | — | — | C (access status) |
| F5 Exposure + road connectivity | R (layers, override) | **A/R** (rules) | R (segments, exposure) | R (category) | — | C |
| F6 Photo/video reporting, field + citizen | R (viewer, moderation) | R (API, storage) | — | **A/R** | — | C |
| F7 Offline-first mobile | — | R (duplicate-safe API) | — | **A/R** | — | C |
| F8 Automated tiered warnings, app + SMS | R (approval, log) | **A/R** | C (trigger levels) | R (push, inbox) | — | R (policy text) |
| F9 Multilingual notifications | R (web strings) | R (rendering) | — | R (mobile strings) | — | **A/R** (content) |
| F10 Verification + priority | R (UI) | **A/R** | C | — | — | C |
| F11 Cloud deployment | — | **A/R** | — | C (endpoints) | — | C |
| Demo | R | R | R | R | R (video) | **A/R** |

## 5. Decision process

1. The owner writes options and a recommendation in the relevant doc, marked 🔶 REQUIRES HUMAN APPROVAL.
2. The team discusses.
3. PC records the outcome with date and approvers in [architecture.md §9](architecture.md) or the relevant doc.
4. The owner updates the status before implementation.

## 6. Load management and fallback order

Backend carries the most modules. Mitigations:
- UI for backend features sits with FE and MOB.
- The emulator, replay data and forecast features sit with ML.
- Access and compliance work sits with PC.
- FE and MOB build against mocks from Phase 1.

If the schedule slips, **reduce depth in this order, never removing a requirement's representation:**

| Step | Reduce | Requirement still represented by |
|---|---|---|
| 1 | Skip the real IMERG connection attempt | OR-18 stub + status panel |
| 2 | Skip the real SMS gateway | OR-20 SMS sandbox |
| 3 | Push → inbox polling only | OR-07/OR-20 app inbox |
| 4 | Forecast source → replay scenario only | OR-13 forecast toggle (labelled simulated) |
| 5 | Citizen mode → report form only, no citizen inbox | OR-10 citizen report in moderation |
| 6 | Trained tree model → logistic regression only | OR-06 trained, validated model |

## 7. Team roster

| Role | Name | GitHub handle |
|---|---|---|
| Frontend Developer | TODO | TODO |
| Backend Developer | TODO | TODO |
| AI/ML Engineer | TODO | TODO |
| Mobile App Developer | TODO | TODO |
| Video Editor | TODO | TODO |
| Product/Communication Lead | TODO | TODO |
