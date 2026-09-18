# Jury Demo Plan (3–5 minutes) — GeoRakshak

> **Status:** APPROVED DESIGN (4-minute core, 5-minute hard stop). To be built in Phase 7. Nothing shown here exists yet.
> **Revision:** covers every official SIH26001 requirement (OR-01 to OR-21) at its declared class ([product-spec.md §2](product-spec.md)).
> Owner: Product/Communication Lead. Backup video: Video Editor.

## 1. Demo principles

- **Honest:** everything simulated, sandboxed or awaiting access is labelled on screen, and the presenter says so once, plainly.
- **Decision support:** automated internal watches, human-approved public warnings. Never "predicts landslides."
- **One story, one place:** a single pilot-area slope near a village and a road carries the narrative.
- **Show, don't list:** each official requirement appears as something visible, not only on a slide.
- **Live first, video fallback. Resettable in under 1 minute.**

## 2. Story

```
Monitoring (rainfall + sensors + satellite + terrain) → Risk detected + forecast → AI explains
→ Automated warning (app + SMS, multilingual) → Field officer and citizen report (offline, photo/video)
→ Road connectivity + dashboard update → Response priority → Architecture & integration honesty
```

## 3. Cast and setup

| Role | Device | Account |
|---|---|---|
| Presenter | — | — |
| District control-room operator | Laptop, web dashboard, projected | Demo District Authority |
| Field officer | Android phone 1, mirrored | Demo Field Officer |
| Citizen | Android phone 2 (or a pre-submitted report if only one phone) | Demo Citizen (Hindi) — a second demo citizen prefers English, so the delivery log shows both |

**Pre-demo state:**
- Dashboard on the pilot area with the **DEMO REPLAY MODE** banner and the data-source status panel visible.
- Replay paused at "day 0". Virtual sensors idle.
- Both phones logged in, with notifications on.
- The SMS log view is open in a second browser tab.

## 4. Script (timed)

**Core path: 4:00. Hard stop: 5:00.** Beats marked ✂ can be cut for a 3-minute slot.

| Time | Beat | On screen | Narration (draft) | Reqs |
|---|---|---|---|---|
| 0:00–0:20 | **Problem** | Title → pilot-area map | "Monsoon landslides in the North East cut roads and isolate villages. GeoRakshak helps district authorities see risk early, warn the right people, and act on verified ground evidence." | — |
| 0:20–0:50 | **Monitoring inputs** | Toggle layers: terrain/slope, historical landslides (GSI surveyed records), **satellite-derived land cover (ESA WorldCover 2021, acquisition range on screen)**, villages/schools/health facilities/roads. Point at the **"Data in this view" strip**. | "Real terrain, real surveyed landslide records from the Geological Survey of India, real satellite-derived land cover, and real roads and villages. The strip shows where every input comes from. IMD gridded rainfall is loaded as historical data. The IMD live API is awaiting access, so no live IMD data is shown. These soil-moisture stations are virtual sensors for this demo." | OR-03, 04, 05, 08, 09, 17, 18, 19 |
| 0:50–1:20 | **Risk detected** | Start replay: rainfall accumulates, **virtual sensor readings rise**, cells turn High/Very High. Road segments turn **AT_RISK** (amber). | "We're replaying a monsoon rainfall period. Soil-moisture readings arrive through the same API a real sensor would use. Risk rises on this slope, and the road below is now at risk." | OR-01, 02, 07, 11, 12 |
| 1:20–1:40 | **Weather-linked forecast** ✂ | Toggle **Forecast +48 h**: High area spreads. Forecast source and issue time shown. | "Using forecast rainfall, the same model shows where risk is expected over the next 48 hours." | OR-13 |
| 1:40–2:05 | **AI explains** | **Judge clicks the cell:** severity, score, model version, factors (rainfall anomaly, slope, vegetation from satellite, past landslides, soil-moisture sensor, labelled virtual) | "It shows why: rainfall far above normal, slopes over 35 degrees, sparse vegetation, past landslides nearby, and high soil moisture. The model was trained on real landslide records and checked on areas it hadn't seen." | OR-06, 11 |
| 2:05–2:35 | **Automated warning** | (1) Watch **auto-dispatched** to field officers: phone 1 buzzes. (2) Public warning draft → operator picks languages → **Approve** → phone 2 shows it in Hindi (that demo citizen's preferred language). SMS log shows the message per recipient language — **English and Hindi today** (the Hindi text is a machine draft marked `DRAFT_UNREVIEWED`; the third pilot-area language waits on the pilot sign-off), marked **SANDBOX**, with the segment count that a real gateway would bill (English 1, Hindi 2). It shows SENT to a consenting team number only if the H14 DLT/cost clearance has been completed. | "Field teams are alerted automatically. Public warnings go out by app and SMS only after the authority approves, each person in their own language. Hindi here is a draft translation awaiting native review, and SMS is sandboxed." | OR-07, 15, 20 |
| 2:35–3:10 | **Offline field report (judge holds phone 1)** | Airplane mode ON → report `ROAD_BLOCKED`, severity High, GPS, **photo + 10 s video** → "Queued" → airplane mode OFF → "Synced" | "No signal on the hillside. The report, photo and video are saved on the phone, then sync on their own when the network returns, without duplicates." | OR-10, 16, 21 |
| 3:10–3:20 | **Citizen report** ✂ | Citizen observation appears as UNVERIFIED in the moderation queue | "Citizens can report too. Their reports go to moderation first." | OR-10 |
| 3:20–3:45 | **Road connectivity + dashboard** | Report pin with video → operator **Verify** → road segment turns **BLOCKED** (red) → open the nearest village and read its access line ("N of M road segments within 1000 m blocked or at risk") | "Once verified, the road shows blocked, and the village that depends on it shows how much of its access is affected. A village is only flagged *access at risk* when every road within a kilometre is blocked or at risk — so in a town with many roads this stays a count, not a flag." | OR-12, 09, 14 |
| 3:45–4:00 | **Response priority** | Priority panel: this location is **P1**, with reasons (verified blockage, Very High risk, villages with access at risk, health facility nearby) | "The system ranks what needs attention first, with its reasons." | OR-14 |
| 4:00–4:30 | **Architecture and honesty** ✂ | Open the **System status** drawer (header button): counts line, mode, scheduler, weather in use, every adapter with its label (REAL_LIVE · REAL_REPLAY · REAL_HISTORICAL · SIMULATED · SANDBOX · AWAITING_ACCESS · NOT_CONNECTED) and the legend. Then one slide: deployment diagram + scale path | "This runs on our cloud deployment, with offline sync. Sensors, IMD's live API, satellite feeds and SMS gateways plug into adapters that already exist. Today the connections that aren't live are labelled that way." | OR-17, 18, 19, 21 |
| 4:30–5:00 | Buffer / judge questions | — | — | — |

**3-minute cut:** drop the ✂ beats and shorten monitoring to 20 s. OR-13 and OR-19 are then covered by one line during the explanation beat and on the status panel.

## 4a. Presenter notes from the timed rehearsal (2026-09-18)

Measured with `backend/scripts/rehearsal.py` against the real Aizawl pilot: **5.2 s of API time across all ten beats**, none over its narration budget. What the rehearsal told us to say and do:

- **Pre-position the replay.** Do not start it from day 0 on stage: 29 steps take about 46 s. Run `scripts/demo_prepare --to-step 26`, then step 3 times live (~1.7 s each) to reach the 2017-06-14 peak. That is inside the 0:50–1:20 beat.
- **Say "provisional pilot area"** on the title beat: Aizawl is approved as the pilot, and the boundary on screen is a bounding box, not an administrative boundary.
- **Say "permission pending"** when the IMD rainfall or GSI inventory rows are on screen: both allow reproduction only with prior written permission, and the status panel marks them.
- **Village access is a count, not a flag**, in a town with hundreds of nearby roads (see the 3:20 beat).
- **Two languages, not three.** English and Hindi render; Hindi is an unreviewed draft.
- **Risk bands are 0.55 / 0.70** (current operating thresholds, chosen from the measured decision table — not statistically optimal). At the peak this is 690 High and 6 Very High cells of 2,798, and 2,084 of 5,660 road segments at risk.

Run `scripts/rehearsal.py` again after any change to the pilot data, thresholds or alert rules: it fails loudly if a beat would show an empty screen.

## 5. Requirement coverage checklist (verify in every rehearsal)

| Req | Shown in beat | Label on screen |
|---|---|---|
| OR-01 Rainfall patterns | Risk detected | Replay provenance |
| OR-02 Soil moisture sensors | Risk detected, AI explains | "Virtual sensor (simulated)" |
| OR-03 Satellite imagery | Monitoring inputs, AI explains | Land-cover layer with its acquisition date range. **Say "satellite-derived land cover", not "imagery": no image tiles are served.** |
| OR-04 Terrain/slope | Monitoring inputs, AI explains | Source attribution |
| OR-05 Historical landslides | Monitoring inputs, AI explains | Source attribution |
| OR-06 AI/ML zones + prediction | AI explains | Model version, "risk estimate" |
| OR-07 Real-time alerts | Risk detected → Automated warning | Dispatch timestamps |
| OR-08 GIS visualization | Throughout | — |
| OR-09 Roads, villages, infrastructure | Monitoring inputs, Road connectivity | OSM attribution |
| OR-10 Citizen/field photo/video | Offline report, Citizen report | Demo accounts |
| OR-11 Severity levels | Risk detected, AI explains | Legend |
| OR-12 Road connectivity status | Risk detected, Road connectivity | Status legend: "OPEN = no evidence of blockage". Village access shows the affected-road count; `ACCESS_AT_RISK` needs every road within 1 km bad. |
| OR-13 Weather-linked forecast | Forecast | Source + issue time |
| OR-14 Response prioritisation | Response priority | Rule version |
| OR-15 Multilingual notifications | Automated warning | Language tags. Say "English and Hindi today, Hindi pending native review; the third language follows the pilot sign-off." Never claim three reviewed languages. |
| OR-16 Offline | Offline report | Queued / Synced |
| OR-17 IMD APIs | Monitoring inputs, Architecture | `AWAITING_ACCESS` (or connected if granted) |
| OR-18 Satellite feeds | Monitoring inputs, Architecture | `NOT_CONNECTED` (or connected if spike succeeded) |
| OR-19 Sensor data | Monitoring inputs, Architecture | Virtual stations via real ingestion API |
| OR-20 Automated SMS/app warning | Automated warning | `SANDBOX` / `SENT` |
| OR-21 Cloud + offline sync | Offline report, Architecture | Cloud URL visible |

## 6. Data shown in the demo

| Element | Provenance | On-screen label |
|---|---|---|
| Terrain, landslide history, villages, roads, facilities | `REAL_HISTORICAL` | Source attribution |
| Satellite-derived land cover (ESA WorldCover 2021) | `REAL_HISTORICAL` | Acquisition date range, ESA attribution |
| Rainfall replay | `REAL_HISTORICAL` (preferred) or `SIMULATED_DEMO` | Mode banner + badge |
| Forecast rainfall | `SIMULATED_DEMO` (replay) or `REAL_LIVE` (approved provider) | Source + issue time |
| Soil moisture readings | `SIMULATED_DEMO` | "Virtual sensor" |
| Risk, forecast risk, road status, priority | `MODEL_OUTPUT` | Model / rule version |
| Reports, photos, videos, users | `SIMULATED_DEMO` | Demo account badge |
| SMS | Sandbox or real to team numbers | `SANDBOXED` / `SENT` |

Media must be captured by the team and never presented as a real event. If replaying a real historical rainfall period, don't claim a landslide occurred unless the inventory records one.

## 7. Pre-demo checklist

- [ ] `backend/.venv/bin/python -m scripts.demo_prepare --to-step <peak step>` run: it resets, replays to the chosen step, and places virtual soil-moisture stations on the highest-risk cells. Same step in, same state out. Without `--to-step` it searches for the first public WARNING draft and prints the step to use.
  - Aizawl provisional pilot: `--to-step 29` (2017-06-14) gives 1,579 High and 3 Very High cells, an auto-dispatched internal watch, a held public WARNING draft, and 2 virtual stations.
- [ ] `backend/.venv/bin/python -m scripts.smoke_e2e` passed on the demo machine (it resets the data, so run it **before** `demo_prepare`).
- [ ] Status panel correct: nothing shows a live connection that isn't live.
- [ ] Cloud deployment healthy. Laptop fallback stack started and tested.
- [ ] Both phones charged, logged in, notifications on, mirroring tested, camera/video permission granted, GPS fix acquired.
- [ ] Push delivery tested on the venue network. Inbox polling fallback works.
- [ ] SMS log view open. If gateway mode: team test numbers only, balance checked.
- [ ] Templates render in English and Hindi on phone and in the SMS log (two demo citizens, one per language). The third language is **not implemented** — do not claim it.
- [ ] Short video (≤30 s, ≤25 MB, per the frozen API limits) upload tested on a throttled network.
- [ ] Backup video cued. Timer ready.

## 8. Failure fallbacks

| Failure | Fallback |
|---|---|
| Venue internet down | Laptop-local stack, phones on the laptop hotspot. Say "running locally" (don't claim cloud during that run). |
| Push notification delayed | Open the app inbox (polling) |
| GPS fails indoors | Disclosed manual pin adjustment |
| Video upload slow | Continue. Report data has synced and the media shows "uploading." Show a pre-synced video from an earlier report. |
| Replay job error | `scripts/demo_prepare --to-step N` (reset + jump, running every intermediate cycle) |
| Mirroring fails | Pre-recorded phone clips (VID) |
| Total failure | Backup video with the same script |

## 9. Anticipated jury questions

| Question | Answer direction |
|---|---|
| "Is the landslide inventory official?" | Yes: 132 surveyed GSI records inside the pilot, from the Bhusanket portal, plus NASA's catalogue and a CC-BY research dataset as secondary sources. GSI data may be reproduced only with prior written permission. **We have not contacted GSI yet**; the request checklist is ready at [gsi-access-request.md](gsi-access-request.md), and until permission exists we do not publish derived maps. |
| "Are the soil moisture sensors real?" | No. These are virtual stations using the real ingestion API. Any gateway that can post readings plugs in. The readings don't train the model and aren't in our metrics. |
| "Is it integrated with IMD?" | We use IMD gridded rainfall data. Live IMD API access was requested on <date>. The adapter slot is ready, and it shows "awaiting access" until connected. |
| "Where is the satellite imagery?" | We use satellite-**derived** data, not image tiles: ESA WorldCover 2021 land cover per analysis cell, with its acquisition range on screen, and it feeds the model. A Sentinel-2 composite is planned and shows as `NOT_CONNECTED`. Live satellite feeds are integration-ready. |
| "Does it really send SMS?" | Sandbox mode renders and logs the exact SMS. Real sending needs a compliant gateway (DLT), so it's approval-dependent. |
| "How accurate is it?" | Spatial-CV metrics from the evaluation report, with limitations. Forecast skill isn't yet validated. |
| "Can it predict when a landslide happens?" | It estimates elevated likelihood over the next 24–72 h. It doesn't predict exact time or place. |
| "Who issues official warnings?" | Mandated agencies. GeoRakshak supports authorities. Public warnings need human approval. |
| "Is it cloud-based? Does it scale?" | Deployed on the cloud in one region. The scale path is on the architecture slide. |
| "Is road status real?" | Road geometry is real OSM. Status comes from our risk model and verified reports. "Open" means no evidence of blockage. |

## 10. Rehearsal plan

- Rehearsal 1: click-path read-through and coverage checklist (§5).
- Rehearsal 2: full live run + failure drill (network drop, push delay).
- Rehearsal 3+: timed runs until three consecutive runs pass: 4:00 core, and the 3-minute cut ready.
