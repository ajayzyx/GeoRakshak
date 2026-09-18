# GeoRakshak web dashboard

React + TypeScript + Vite + MapLibre GL JS (decision H2, [docs/development.md](../docs/development.md)). No UI framework, plain CSS.
The dashboard is a **decision-support** tool, not an official warning authority. It follows the frozen API contract in [docs/api.md](../docs/api.md).

## Requirements

Node 24 and npm 11.

```bash
cd web
npm install
```

## Run in mock mode (no backend)

```bash
npm run dev:mock        # same as: VITE_API_MODE=mock npx vite
```

Open http://localhost:5173. Mock accounts (fictional, mock mode only), password `mock`:

| Email | Role |
|---|---|
| `authority.mock@example.org` | DISTRICT_AUTHORITY |
| `admin.mock@example.org` | ADMIN (also sees demo controls) |
| `field.mock@example.org` | FIELD_OFFICER (map and details only) |

Mock mode:
- makes no network calls. Data comes from `src/mock/mock-fixtures_simulated.ts`, built from the api.md example shapes.
- is fictional and labelled `SIMULATED_DEMO`. The area is "Mock Area — not a real location", and a **MOCK DATA** banner is always shown.
- never reports a source as `CONNECTED_LIVE` and never shows a delivery as sent (every mock delivery is `SANDBOXED`).
- keeps its state in memory: verify, approve, override and demo step change it. A page reload resets it, and you have to log in again.

## Run against the backend

Start the backend on port 8000 (see `backend/README.md`), then:

```bash
npm run dev             # live mode, VITE_API_BASE_URL defaults to http://localhost:8000/api/v1
```

Against another backend instance (for example a second database on port 8001):

```bash
VITE_API_MODE=live VITE_API_BASE_URL=http://localhost:8001/api/v1 npx vite --port 5174
```

The backend must allow the dashboard origin (`CORS_ORIGINS=http://localhost:5173`).

## Environment variables

Copy `.env.example` to `.env.local` to override. Never commit real values.

| Variable | Default | Meaning |
|---|---|---|
| `VITE_API_MODE` | `live` | `live` calls the backend. `mock` uses the bundled fictional fixtures. |
| `VITE_API_BASE_URL` | `http://localhost:8000/api/v1` | Backend base URL including `/api/v1` |
| `VITE_BASEMAP_STYLE_URL` | empty | Optional MapLibre style URL. Empty means a plain background with our own GeoJSON layers only. Set it only after a terms check (H5). Don't use public OSM tile servers. |

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` / `npm run dev:mock` | Dev server on port 5173 (live / mock) |
| `npm run build` | `tsc --noEmit` then `vite build` into `dist/` |
| `npm test` | Vitest (jsdom). Tests stub `fetch` and fail on any real network call. |
| `npm run smoke:browser` | Browser smoke test against a running dev server and backend (see below) |

## Structure

```
src/api/types.ts        types mirroring docs/api.md v1
src/api/client.ts       the only API client (live HTTP + mock switch, error envelope, 401 handling)
src/mock/               in-memory mock client and SIMULATED_DEMO fixtures
src/lib/                severity/road/provenance/status labels and colours, session storage, polling hook
src/components/         login, dashboard layout, map, detail panels, reports, alerts, priorities, demo controls
```

## Honesty rules implemented in the UI

- A provenance badge (`REAL_LIVE` / `REAL_HISTORICAL` / `SIMULATED_DEMO` / `MODEL_OUTPUT`) is shown on factors, assessments, reports, alerts, priorities, stations, layers and features. If the API doesn't report provenance, the badge says "Provenance not reported". It never guesses one.
- Run-mode banner from `GET /system/mode` (`LIVE MODE` / `DEMO REPLAY MODE` with scenario, step and replay provenance).
- Data-source status panel (`GET /data-sources`, polled every 15 s) with `connection_status` and `status_note`.
- "Virtual sensor (simulated)" badge for `VIRTUAL` stations.
- SMS deliveries with status `SANDBOXED` read "Sandbox — not sent". A sandbox-mode delivery reported as `SENT` is flagged as inconsistent.
- Disclaimer "Decision-support risk estimate. Not an official warning." in the header, the risk layer info and the cell detail.
- Forecast lead times show the forecast source, issue time, validity window and "Forecast skill not yet evaluated".
- Satellite layers show their acquisition date range.
- The road legend says "OPEN = no evidence of blockage, not confirmed passable".
- A public `WARNING` is dispatched only through the explicit approve action. `WATCH` alerts have no approve button.

## Browser smoke test

`npm run smoke:browser` drives a locally installed Google Chrome over the DevTools Protocol with Node's
built-in `fetch` and `WebSocket` (no extra dependencies). It is **read-only**: it logs in and inspects the
dashboard, and never resets, steps or changes anything.

```bash
npm run smoke:browser
WEB_URL=http://localhost:5174 API_URL=http://localhost:8001/api/v1 OUT_DIR=/tmp/shots npm run smoke:browser
```

| Variable | Default | Meaning |
|---|---|---|
| `WEB_URL` | `http://localhost:5173` | Dashboard URL |
| `API_URL` | `http://localhost:8000/api/v1` | Backend, health-checked first and compared with the origin the page actually calls |
| `EMAIL` / `PASSWORD` | `authority.demo@example.org` / `georakshak-local-demo` | Login |
| `CHROME_PATH` | macOS Chrome, then Chromium and Linux paths | Browser binary |
| `OUT_DIR` | unset | Directory for step screenshots |
| `EXPECTED_HTTP` | `404 /models/active` | Comma-separated allow-list of expected HTTP failures |
| `TIMEOUT_MS`, `CDP_PORT`, `HEADLESS=0` | `40000`, `9444`, headless | Waits, DevTools port, visible browser |

It checks: login and run-mode banner · pilot name · risk cells present **and rendered** on the map (or a
labelled empty state) · scheduler state, weather provider, source rows and ingest counts, and that a
failed/stopped/overdue cycle shows the map warning · the audit trail of the selected alert ·
cell detail with factors and provenance badges · the +48 h forecast banner (and that a simulated stand-in
says so) · a road segment's status and status source · the road legend wording · the Alerts tab tiers ·
every "Data in this view" entry and the header model chip. It fails with a non-zero exit on any missing
element, any console error or exception, or any unexpected HTTP status ≥ 400.

Selectors are `data-testid` values (`map`, `top-cell`, `cell-detail`, `factor`, `provenance-badge`,
`lead-0`/`lead-24`/`lead-48`/`lead-72`, `forecast-banner`, `road-item`, `road-detail`, `road-status`,
`road-status-source`, `tab-alerts`, `alert-item`, `alert-tier`, `strip-*`, `model-chip`, `demo-step`,
`jump-input`), so layout changes do not break it.

## Loading, error, empty and stale states

Every view (map layers, cell and road detail, reports, alerts, priorities, data sources, summary, pilot)
uses one resource hook with the same states:

- **First load:** a spinner with the view's name.
- **Failure with nothing to show:** the error envelope (code, message, `request_id`) and a **Retry** button.
- **Failure while data is on screen:** the data stays, marked "stale since HH:MM" with a retry link. Old data
  is never shown as current.
- **Backend unreachable:** a red top banner naming the base URL, cleared automatically on recovery.
- **Empty states:** "No assessment for this cell at this lead time yet", "No reports yet", "No alerts",
  "Replay not started", "No priority items yet", and "No pilot area loaded" when `GET /pilot` returns 404.

Requests are keyed by identity (cell, lead time). Changing the lead time or the selected cell clears the old
data and aborts the in-flight request, so a slow response can never be shown under another lead time or cell.
Replay steps, a new assessment time and successful actions (verify, approve, override) refresh in place.

## Polling intervals

`/system/mode` (including monitoring and weather state), `/data-sources`, `/dashboard/summary` and `/response-priorities` every 15 s. `/reports` every 8 s.
`/alerts` every 10 s. `/sensor-stations` every 30 s. `/risk-zones` every 60 s. `/road-segments` every 120 s
(the collection is about 1 MB gzipped for a real pilot). Layers also reload whenever the lead time changes, the
replay state or assessment time changes, or an action succeeds.

## Data in this view

A strip under the banners states, always visibly, what is real and what is not. It is derived from
`/data-sources`, `/system/mode`, `/models/active` and the risk-layer metadata — never assumed:

- terrain, landslide records, roads, villages/facilities and satellite layers: `REAL historical` with the source names;
- rainfall: "Replay of real historical IMD rainfall (<year>)" when the replay provenance is `REAL_HISTORICAL`,
  otherwise simulated, or "Replay not started"; the IMD licence text is shown as a note;
- forecast: "Simulated stand-in … — not a weather forecast" while the forecast source is `SIMULATED`;
- soil moisture: "Virtual sensors (simulated)"; SMS: "Sandbox — not sent"; push: "Not connected";
- model: version and stage, plus "rule-based baseline — no validated accuracy" while `metrics` is null or
  `thresholds.calibrated` is false, or the headline metric and validation scheme once they exist.

Anything the API does not report reads "not loaded" or "not reported" instead of a guess.

## System status (judge-facing panel)

The **System status** button in the header opens a drawer driven by one poll of `GET /system/status` (every
15 s). It replaces the separate mode, model and data-source polls and shows, in order: a one-line count
("4 real live · 9 real historical · …"), the **mode** (LIVE or REPLAY with the replay step and date, the
pilot with its PROVISIONAL badge, the model and whether it is validated), the **scheduler** block (the same
component as the monitoring panel), the **weather in use** with IMD versus fallback stated explicitly
("Open-Meteo — non-IMD fallback; IMD API awaiting access"), the **data sources** grouped as IMD weather ·
Weather fallback (non-IMD) · Satellite · Soil / sensors · Historical landslides · Terrain · Exposure ·
Notifications, and a **legend** of the seven display labels with the API's own one-line meanings.

Every badge in the panel, and every tag in the "Data in this view" strip, uses the API's `effective_label`
vocabulary — REAL_LIVE · REAL_REPLAY · REAL_HISTORICAL · SIMULATED · SANDBOX · AWAITING_ACCESS ·
NOT_CONNECTED — so the two never disagree. Each source row shows its dataset, verification status,
freshness from `age_s` ("updated 4 min ago" / "never"), the status note on hover and in an expandable
details block, and a "permission required for publication" marker read from the licence text (IMD gridded
rainfall, GSI). Empty groups say so rather than disappearing. Weather is split into "IMD weather" and
"Weather fallback (non-IMD)" so a non-IMD provider is never listed under an IMD heading.

## Monitoring cycle and weather

The "Monitoring cycle" panel and a header chip read the `monitor` block of `GET /system/mode`, so a stopped
or failed cycle can never look like fresh data:

- **LIVE:** scheduler state (LIVE / STOPPED / FAILED / OVERDUE / NO CYCLE YET), the interval, the last run
  (absolute and relative) with its status, the error text when it failed, the next scheduled run
  ("in 2 min · 21:06 UTC"), and what the last cycle produced (cells scored, roads at risk, alerts created).
- **DEMO_REPLAY:** the backend's note that cycles run on replay steps, instead of a pretend scheduler.
- **A failed, stopped, overdue (older than ~3 intervals) or never-run cycle** raises a prominent warning over
  the risk map saying the displayed risk may be out of date, quoting the API's `last_success_at` (which
  survives a later failure), or saying plainly that no successful cycle is recorded.
- **A throttled weather fetch** (`skipped: "fetched recently"`) reads "Using data fetched at HH:MM" with the
  minimum interval, not as an error.
- **Weather:** the active provider, whether it is IMD or non-IMD (H16), both source rows
  (`observed_source`/`forecast_source`) with their `connection_status` and status notes (for example
  "model-derived … not gauge observations"), the last ingest counts, and `weather_error` when present. With
  `WEATHER_PROVIDER=none` it says plainly that no weather source is connected and that rainfall comes from
  the replay or stored history. Missing counts read "not reported", never 0.
- **Admin only:** "Run cycle now" (LIVE only) and "Fetch weather now" (only when a provider is configured),
  each showing its result or error inline. They are hidden where the endpoints would return 409.

The "Data in this view" strip separates three cases visually and in words: **● REAL live** (connected now),
**▣ REAL historical** or **◌ SIMULATED** (stored, replayed or simulated), and **✕ NOT CONNECTED** /
awaiting access. In LIVE mode the rainfall and forecast entries follow what the cycle actually ingested, and
the IMD live API's own status is shown next to them so "IMD" is never implied while it is only awaiting access.

## Land cover and rainfall evidence

- **Land cover** (`GET /layers/landcover`) is a toggleable layer drawn under the risk fill, coloured by the
  ESA WorldCover class. The legend lists only the classes present, with counts, the acquisition range
  (CLAUDE.md §9 rule 12), the attribution and the API's note that this is a majority class per analysis cell,
  **not an image**. The selected cell's class and tree-cover share also appear in the cell panel, worded as a
  satellite-derived class rather than imagery.
- **Rainfall evidence** (`GET /risk-zones/{id}/rainfall`) appears in the cell panel as a small bar strip:
  solid blue observed days, hatched orange forecast days, with each series' sources, every provenance present
  (a series can mix stored history with a live provider), the forecast issue time, and a "replayed" badge in
  DEMO_REPLAY. Empty and failed states are labelled, with Retry.

## Recorded actions (audit trail)

Alert and report panels list `GET /audit-events` for that entity: "Alert approved by <name> (District
authority)" or "Alert auto dispatched by the system (automatic)" — `actor: null` is always rendered as the
system acting automatically, which keeps the human-approval rule visible.

## Demo controls (ADMIN, DEMO_REPLAY only)

Start or restart the replay, step once, jump to a step, or reset. The current position shows as
"Step X/Y · date", where X is the backend's zero-based step and Y is the last valid step (`steps - 1`).
"Jump to step" posts `{"to_step": n}`, allows about 2.5 s per intermediate cycle plus a margin before timing
out, disables the controls while it runs, and says so if the backend lands on a different step. Reset asks for
confirmation, then clears the selection and every cached view before refetching.
