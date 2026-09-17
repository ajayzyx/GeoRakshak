# Jury Demo Plan (3 minutes) — GeoRakshak

> **Status:** DESIGN. To be built in Phase 7.
> Owner: Product/Communication Lead. Backup video: Video Editor.

## 1. Demo principles

- **Honest:** the rainfall event is a **simulated scenario on real terrain**, and the screen says so. Never imply a real disaster occurred.
- **Decision support:** a human approves the alert on screen. Say "helps authorities decide", never "predicts landslides".
- **One story, one location:** a single pilot-area location carries the whole narrative.
- **Live first, video fallback:** run live, with the backup video cued.
- **Resettable:** one command restores the initial state.

## 2. Story

```
Risk detected → AI explains risk → Alert generated → Field officer receives situation
→ Field officer submits geo-tagged evidence → Authority dashboard updates → Response priority generated
```

## 3. Cast and setup

| Role on stage | Device | Account |
|---|---|---|
| Presenter / narrator | — | — |
| "District Authority" operator | Laptop (web dashboard) on projector | `Demo District Authority` (demo account) |
| "Field Officer" | Android phone, screen mirrored | `Demo Field Officer` (demo account) |

Pre-demo state:
- The dashboard is open on the pilot district with the risk map showing mostly Low/Moderate.
- A persistent **"DEMO MODE — simulated rainfall scenario on real terrain data"** banner is visible.
- The phone is logged in, with the app open on the alert inbox and **mobile data/Wi-Fi ON**.
- The demo scenario is loaded but not triggered.

## 4. Script (timed)

| Time | Beat | On screen | Narration (draft) |
|---|---|---|---|
| 0:00–0:20 | **Hook + problem** | Title slide → dashboard map of pilot district | "Every monsoon, landslides in the North East cut roads and cut off villages. Authorities need to know where risk is rising, why, and what to act on first. GeoRakshak is a decision-support system for exactly that." |
| 0:20–0:45 | **1. Risk detected** | Operator triggers the scenario replay → cells in one valley turn High / Very High. A "last updated" time and SIMULATED badge are shown. | "We're replaying a simulated heavy-rain scenario over real terrain and historical landslide data. As rainfall accumulates, the risk engine re-scores each grid cell and this slope moves to High." |
| 0:45–1:10 | **2. AI explains risk** | Click the High cell → detail panel: score, class, confidence, model version, and top 3 factors with values | "The system doesn't just say 'high'. It shows why: three-day rainfall far above normal, slopes steeper than 35 degrees, and landslides recorded nearby before. Every score comes with its reasons." |
| 1:10–1:30 | **3. Alert generated** | A draft alert appears → operator reviews, selects English + one regional language, and assigns the field officer → **Approve** | "The system drafts an alert, but a human authority approves it. GeoRakshak supports official decision-making. It doesn't replace it." |
| 1:30–1:50 | **4. Field officer receives situation** | Phone: notification/inbox shows the alert in the selected language, with the map pin and requested action → Acknowledge | "The field officer gets the alert in their language, with the exact location and what to check." |
| 1:50–2:20 | **5. Field officer submits geo-tagged evidence** | Phone: turn **airplane mode ON** → create report (category Crack, severity High, auto GPS, take photo) → shows "Queued offline" → airplane mode OFF → "Synced ✓" | "Connectivity in the hills is unreliable, so reports are saved offline with GPS and a photo, then sync automatically once the signal returns. They're never lost and never duplicated." |
| 2:20–2:40 | **6. Authority dashboard updates** | Dashboard: a new report pin appears next to the High cell, marked UNVERIFIED → operator opens the photo → **Verify** | "The report lands on the dashboard next to the risk area. The authority reviews the photo and verifies it." |
| 2:40–2:55 | **7. Response priority generated** | Priority panel re-ranks: this incident becomes **P1**, with its reasons listed (verified evidence + High risk + villages and road nearby) | "Now the system ranks what needs attention first, again with clear reasons: verified evidence, high risk, and three villages and a road nearby." |
| 2:55–3:00 | **Close** | Summary slide: flow diagram + "Decision support · Explainable · Offline-ready · Multilingual" | "GeoRakshak: from risk signal to verified ground response, explainable at every step." |

Target runtime: **2:50–3:00**. The presenter keeps a visible timer.

## 5. Data shown in the demo

| Element | Provenance | On-screen label |
|---|---|---|
| Terrain (slope, elevation) | `REAL_HISTORICAL` | Source attribution in map footer |
| Historical landslide points | `REAL_HISTORICAL` | Source attribution in layer legend |
| Villages / roads | `REAL_HISTORICAL` (for example OSM) | "© OpenStreetMap contributors" if OSM is used |
| Rainfall scenario | `SIMULATED_DEMO` | "SIMULATED" badge + banner |
| Risk scores / explanations | `MODEL_OUTPUT` | Model version shown |
| Field report + photo | `SIMULATED_DEMO` | Demo account badge |
| Officer / authority names | `SIMULATED_DEMO` | Fictional |

The photo used should be taken by the team (for example of a crack in a staged or public setting), or be licensed imagery with attribution. It must not be passed off as a real landslide event.

## 6. Pre-demo checklist

- [ ] Run the demo reset script. Confirm the initial map state.
- [ ] Backend, ML service and DB are healthy (`/health`).
- [ ] Phone charged, logged in, notifications on, screen mirroring tested.
- [ ] Venue network tested. Mobile hotspot available as backup.
- [ ] Camera permission granted. GPS fix acquired (test indoors in advance or allow manual pin fallback).
- [ ] Language templates render correctly on both devices.
- [ ] Backup video cued on a second laptop/USB.
- [ ] Timer ready.

## 7. Failure fallbacks

| Failure | Fallback |
|---|---|
| Venue internet down | Local deployment on laptop + phone on laptop hotspot |
| GPS fix fails indoors | Report form's "adjust pin" control (disclosed if used) |
| Sync delay | Narrate the queue, then continue with a pre-synced second report |
| Mirroring fails | Switch to pre-recorded phone clip for beats 4–5 |
| Total failure | Play the backup video (same script, same timing) |

## 8. Anticipated jury questions (prep)

| Question | Answer direction |
|---|---|
| "How accurate is it?" | Cite spatial-CV metrics from the evaluation report, with limitations. No unsupported numbers. |
| "Is this real data?" | Terrain/inventory real (sources named). Rainfall scenario simulated for the demo. Live ingestion design explained. |
| "Can it predict when a landslide happens?" | No. It estimates rising risk to support decisions. Field verification closes the loop. |
| "Why should authorities trust the AI?" | Explanations per score, human approval, audit log, baseline comparison, model card. |
| "How does it work offline?" | Local queue, idempotent sync, metadata before media. |
| "How does it scale to all of NER?" | Grid/data pipeline is region-agnostic. Per-area validation required. Scaling path in architecture.md. |
| "Who issues official warnings?" | Mandated agencies. GeoRakshak supports them. |

## 9. Rehearsal plan

- Rehearsal 1: script read-through with click-path, and adjust timings.
- Rehearsal 2: full live run with a failure drill (kill network mid-demo).
- Rehearsal 3+: timed full runs until three consecutive runs are ≤ 3:00.
