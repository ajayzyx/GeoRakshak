# Product Specification — GeoRakshak

## 1. Problem

Landslides in the North Eastern Region of India threaten lives, block roads and isolate communities. The main contributors are steep terrain, fragile geology, intense monsoon rainfall and changes in land use. Decision-makers face four gaps:

1. **Visibility:** no single, current, map-based view of where landslide risk is elevated.
2. **Explanation:** risk information, where it exists, rarely explains *why* an area is risky today.
3. **Ground truth:** field observations (cracks, seepage, small slips, road damage) reach authorities slowly, on scattered channels and without location or evidence.
4. **Prioritisation:** with limited teams and blocked roads, authorities need help deciding what to respond to first.

GeoRakshak joins these into one decision-support workflow. It supports authorities and does not replace official warning agencies.

## 2. Users

| User | Description | Primary surface |
|---|---|---|
| **District Authority** (for example a District Disaster Management Authority officer) | Monitors district risk, approves alerts, assigns field verification, sets response priority | Web dashboard |
| **State Authority / Control Room** | Sees multiple districts, oversees alerts and escalations | Web dashboard |
| **Field Officer** (for example a block/circle-level official or a public works engineer) | Receives assignments and alerts, visits sites, submits geo-tagged evidence | Mobile app |
| **System Administrator** | Manages users, roles, thresholds, data sources and alert templates | Web (admin) |
| **Community member** *(future)* | Receives warnings and optionally reports observations | SMS / app (future) |

User roles are **assumptions** until they are validated with domain experts or the problem statement's organisation.

## 3. User journeys

### J1 — Authority sees rising risk
1. The authority opens the dashboard and sees the map coloured by risk class.
2. A location has moved to **High**. A badge shows the data provenance and last update time.
3. The authority clicks the location and sees the score, class, confidence and top contributing factors (for example "72-hour rainfall well above local normal", "slope > 35°", "past landslides within 2 km").

### J2 — Alert drafted and approved
1. The threshold crossing makes the system draft an alert with location, risk class, explanation and suggested actions.
2. The authority reviews it, edits if needed, selects language(s) and recipients, and approves.
3. The alert is published to assigned field officers (in-app). The audit log records who approved it and when.

### J3 — Field officer verifies on the ground
1. The field officer receives the alert or verification task on mobile, with the location on a map.
2. At the site, the officer creates an incident report with auto-captured GPS, category, severity, a description and photos/videos.
3. With no signal, the report is saved to the offline queue and shows as "Pending sync".
4. When connectivity returns, the report syncs automatically. The officer sees "Synced".

### J4 — Dashboard updates and priority is generated
1. The new report appears on the dashboard as `UNVERIFIED`, linked to the nearby alert or risk zone.
2. The authority reviews the evidence and marks it `VERIFIED`.
3. The response-priority list recalculates using risk level, verified evidence and nearby exposure (villages, roads). Each priority shows its reasons.
4. The authority acts (outside the system for the MVP) and closes or escalates the incident.

### J5 — Admin configures the system
1. The admin manages users and roles.
2. The admin sets risk thresholds and maintains alert templates per language.
3. The admin checks data-source status (last successful ingest, provenance).

## 4. Core workflows

```
[Ingest data] → [Compute features] → [Score risk + explanations] → [Update risk map]
                                                   │
                                  threshold crossed ▼
                                        [Draft alert] → [Human approval] → [Publish alert]
                                                                                 │
                                                                                 ▼
                              [Field officer receives] → [Geo-tagged report + evidence]
                                                                  │ (offline queue if needed)
                                                                  ▼
                                   [Dashboard update] → [Verify report] → [Response priority]
```

State machines (conceptual):

- **Alert:** `DRAFT → APPROVED → PUBLISHED → ACKNOWLEDGED(per recipient) → CLOSED`. A draft can also become `REJECTED`.
- **Field report:** `QUEUED_OFFLINE (device only) → SUBMITTED → UNVERIFIED → VERIFIED | REJECTED`
- **Incident:** `OPEN → IN_RESPONSE → RESOLVED | ESCALATED`

## 5. MVP features

| # | Feature | Description | Primary users | Acceptance summary |
|---|---|---|---|---|
| F1 | GIS risk map | Map of the pilot area coloured by risk class, with layers for historical landslides, incidents, villages and roads | Authorities | Loads the pilot area, toggles layers, shows a provenance badge |
| F2 | Location risk score | Score (0–1) plus class (Low/Moderate/High/Very High) for a grid cell or location | Authorities, field officers | Score, class, model version and timestamp shown |
| F3 | Explainable factors | Top contributing factors in plain language, with values | Authorities | Every score shows ≥3 factors with direction of effect |
| F4 | Geo-tagged incident reporting | Mobile form with GPS, category, severity, description | Field officers | Report saved with coordinates, accuracy and timestamp |
| F5 | Photo/video evidence | Attach media to reports | Field officers | Media uploaded, linked and viewable on the dashboard |
| F6 | Authority dashboard | Risk overview, alerts, incidents, reports, priority list | Authorities | All four panels work on pilot data |
| F7 | Alert generation | Threshold-based draft, then human approval, then in-app publish | Authorities, field officers | No alert publishes without approval, and the audit log is recorded |
| F8 | Offline report queue | Local queue with automatic, idempotent sync | Field officers | Reports survive app restart offline, with no duplicates after sync |
| F9 | Basic multilingual warnings | Human-reviewed templates in the initial language set | Authorities, field officers | Alert shows in each selected language |

## 6. Future features

- SMS / IVR / voice warnings, and integration with official alerting channels (subject to authorisation)
- Community reporting with moderation
- Rain gauge / soil moisture / tilt sensor (IoT) integration
- InSAR-based ground deformation monitoring
- Satellite/drone image analysis for new slide detection
- Road network impact and alternate route suggestions
- Resource/team allocation and task management
- Offline map tiles and SMS-based reporting fallback
- More NER languages and accessibility (audio, low-literacy UI)
- Multi-state rollout and inter-agency data sharing

## 7. Success criteria

### Hackathon (prototype)
- The end-to-end demo flow ([docs/demo.md](demo.md)) runs live, without errors, in under 3 minutes.
- Every displayed data element carries a correct provenance label.
- Every risk score shows explanations.
- The offline report is shown syncing successfully in the demo.
- Model evaluation on real historical data is documented with spatial validation. Metrics are reported honestly, including limitations.
- The team can trace every MVP feature to SIH26001 (see [problem-statement.md](problem-statement.md)).

### Product (post-hackathon, indicative)
- Recall of historically recorded landslide locations within High/Very High zones, measured on held-out regions and reported next to the share of area flagged (to guard against over-flagging).
- Median time from field observation to dashboard visibility.
- Share of alerts acknowledged by recipients.
- Positive usability feedback from at least one real disaster-management stakeholder (target, not guaranteed).
