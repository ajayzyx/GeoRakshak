# Team & Ownership — GeoRakshak

## 1. Principles

- **One owner per area.** The owner is accountable and approves PRs in their area. Others can contribute.
- **Contracts at boundaries.** Where two areas meet, the owner of the *contract* is listed explicitly (see §3).
- **Decisions pending human approval** are raised by the listed proposer and approved by the team (§5).

## 2. Roles

### 2.1 Frontend Developer (FE)
**Owns:**
- Web application (authority dashboard + admin UI)
- GIS risk map UI: layers, legend, provenance badges, location detail panel
- Alert review/approval screens
- Report verification and incident screens
- Response-priority panel
- Web UI localisation (string files and rendering)
- Web accessibility and performance

**Doesn't own:** API implementation, risk logic, alert text content.

### 2.2 Backend Developer (BE)
**Owns:**
- Backend API (`/api/v1`) and its documentation ([api.md](api.md))
- Database schema, migrations, spatial queries ([database.md](database.md))
- Auth, RBAC, audit log
- Alert service (rules, state machine, deduplication, delivery, acknowledgement)
- Incident grouping and response-priority engine
- Field report + evidence APIs, including idempotent sync
- Object storage integration
- Ingestion **scheduling and run tracking** (`data_ingestion_runs`)
- CI pipeline, dev environment, deployment, security hardening
- Demo reset script

**Doesn't own:** ML models, dataset selection/preprocessing, UI.

### 2.3 AI/ML Engineer (ML)
**Owns:**
- [ml-strategy.md](ml-strategy.md) and [data-strategy.md](data-strategy.md) (technical content)
- Data source verification spikes
- Data acquisition and preprocessing **scripts** (download, clean, reproject, aggregate to grid)
- Pilot grid generation and terrain feature derivation
- Feature table and labels
- Rule-based baseline and trained models
- ML service (`/internal/ml/v1`) and its contract
- Batch scoring job logic
- Evaluation reports, model cards, threshold proposals
- Simulated rainfall scenario for the demo

**Doesn't own:** DB schema/migrations (requests changes from BE), alert rules, UI.

### 2.4 Mobile App Developer (MOB)
**Owns:**
- Mobile application (field officer)
- Geo-tagged report form, GPS capture, photo/video capture
- Offline local storage, queue and background sync client
- Sync status UX
- Alert inbox + acknowledgement UI
- Mobile UI localisation
- APK build and demo device setup

**Doesn't own:** sync API server-side (BE), alert content (PC).

### 2.5 Video Editor (VID)
**Owns:**
- Demo backup video (full 3-minute story)
- Screen recordings of each product flow
- Pitch video / explainer assets required by SIH submission rules (to confirm)
- Visual consistency of video assets (captions, "SIMULATED" labels visible)

**Doesn't own:** demo script (PC), product UI.

### 2.6 Product / Communication Lead (PC)
**Owns:**
- [problem-statement.md](problem-statement.md), [product-spec.md](product-spec.md), [roadmap.md](roadmap.md), [demo.md](demo.md), and this file
- Traceability of features to SIH26001
- Scope control (MVP vs. future), and the decision log for approvals
- Licence and attribution records for datasets
- Alert template **content** and native-speaker review coordination
- Stakeholder/mentor communication
- Pitch deck, demo script, jury Q&A sheet
- Rehearsal schedule

**Doesn't own:** technical implementation decisions (the proposer is the technical owner), code.

## 3. Ownership of boundaries (avoiding duplication)

| Boundary | Owner | Collaborator(s) | Rule |
|---|---|---|---|
| Public API contract | BE | FE, MOB | BE publishes the contract in api.md. FE/MOB request changes via PR. |
| Internal ML API contract | ML | BE | ML publishes. BE consumes. |
| DB schema | BE | ML | ML requests tables/columns. BE implements migrations. |
| Data pipeline | ML (scripts, logic) | BE (scheduling, run records) | ML's scripts are invoked by BE's scheduler |
| Batch scoring | ML (logic) | BE (persistence) | ML writes via the agreed interface |
| Offline sync | MOB (client) | BE (server idempotency) | Shared test cases, each side owns its own code |
| Alert content (text) | PC | BE (rendering) | Templates reviewed before activation |
| Localisation strings | FE (web), MOB (mobile) | PC (translation review) | — |
| Risk thresholds | ML (proposal) | PC (runs review) | Team approves (H11) |
| Demo | PC (script, story) | VID (backup video), BE (reset), all (live) | — |

## 4. RACI summary for MVP features

R = Responsible, A = Accountable, C = Consulted, I = Informed

| Feature | FE | BE | ML | MOB | VID | PC |
|---|---|---|---|---|---|---|
| F1 GIS risk map | **A/R** | R (API) | C | I | I | C |
| F2 Location risk score | C | R (API/storage) | **A/R** | I | I | I |
| F3 Explainable factors | R (UI) | R (API) | **A/R** | C | I | C (wording) |
| F4 Geo-tagged reporting | I | R (API) | I | **A/R** | I | C |
| F5 Photo/video evidence | R (viewing) | R (storage/API) | I | **A/R** | I | I |
| F6 Authority dashboard | **A/R** | R (API) | C | I | I | C |
| F7 Alert generation | R (UI) | **A/R** | C | R (inbox) | I | C (content) |
| F8 Offline queue | I | R (idempotent API) | I | **A/R** | I | I |
| F9 Multilingual warnings | R (web strings) | R (templates) | I | R (mobile strings) | I | **A/R** (content) |
| Demo | C | R | R | R | R (video) | **A/R** |

## 5. Decision process

1. The proposer writes the options + recommendation in the relevant doc, marked 🔶 REQUIRES HUMAN APPROVAL.
2. The team discusses (async or standup).
3. PC records the outcome in the decision log (`architecture.md` §8 or the relevant doc), with date and approvers.
4. The owner updates the status to APPROVED before implementation.

## 6. Team roster

| Role | Name | GitHub handle |
|---|---|---|
| Frontend Developer | TODO | TODO |
| Backend Developer | TODO | TODO |
| AI/ML Engineer | TODO | TODO |
| Mobile App Developer | TODO | TODO |
| Video Editor | TODO | TODO |
| Product/Communication Lead | TODO | TODO |
