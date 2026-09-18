# GeoRakshak backend

FastAPI + PostgreSQL/PostGIS. Implements the frozen API contract in [docs/api.md](../docs/api.md) and the schema in [docs/database.md](../docs/database.md).

## Local setup (no Docker)

Prerequisites: Python 3.11, PostgreSQL 17 with PostGIS (`brew install postgresql@17 postgis`).

```bash
cd backend
python3.11 -m venv .venv && .venv/bin/pip install -r requirements-dev.txt && .venv/bin/pip install -e ../ml
createdb georakshak && createdb georakshak_test
.venv/bin/python -m scripts.migrate
.venv/bin/python -m scripts.load_pilot <handoff dir>      # e.g. ../ml/data/processed/<pilot_slug> or tests/fixtures/mock-area
.venv/bin/python -m scripts.seed                           # demo users + honest integration registry
.venv/bin/uvicorn app.main:app --reload --port 8000        # API at http://localhost:8000/api/v1, docs at /docs
```

After loading or reloading a pilot, run a baseline scoring pass: log in as the admin and `POST /api/v1/demo/reset`, or start the replay.

Demo accounts (fictional, local development only; password = `DEMO_USER_PASSWORD`, default `georakshak-local-demo`):
`admin.demo@example.org`, `authority.demo@example.org`, `officer.demo@example.org`, `citizen.demo@example.org`.

## Tests

```bash
.venv/bin/python -m pytest -q     # uses georakshak_test; resets its schema on each test module
```

## Demo flow (DEMO_REPLAY mode)

One command puts the system into a repeatable demo state (reset → replay to a step → virtual sensors on the top cells):

```bash
.venv/bin/python -m scripts.demo_prepare --to-step 29   # Aizawl pilot: the 2017-06-14 peak
.venv/bin/python -m scripts.smoke_e2e                   # full end-to-end check (resets demo data first)
.venv/bin/python -m scripts.threshold_options           # severity / road-status options measured on the loaded pilot (H11)
```

By hand: `POST /demo/reset` → `POST /demo/replay/start` → `POST /demo/replay/step` (optionally `{"to_step": n}`) → automatic internal WATCH → public WARNING draft → authority approves → app inbox deliveries plus an SMS **sandbox** log with its encoding and segment count. `python -m scripts.virtual_sensors` posts **simulated** soil-moisture readings through the real ingestion API.

## Monitoring cycle and weather adapters

| Run mode | Cycles |
|---|---|
| `DEMO_REPLAY` | one per replay step |
| `LIVE` | background scheduler every `MONITOR_INTERVAL_S` (default 900 s); `POST /system/monitor/run` for one now |

`GET /system/mode` reports the last run, its status, any error and the next run, so a failing cycle is visible.
`WEATHER_PROVIDER` selects an adapter: `none` (default, nothing fetched), `open-meteo` (approved non-IMD fallback, CC-BY 4.0, model output rather than gauge data) or `imd-weather-api` (interface only, awaiting access). `POST /system/weather/ingest` fetches on demand.

**LIVE mode refuses to start with the development `JWT_SECRET`, `DEMO_USER_PASSWORD` or `CORS_ORIGINS=*`.** Set real values, or `ALLOW_DEV_SETTINGS=true` for local LIVE testing only.

## Integration honesty

| Adapter / channel | Status in this build |
|---|---|
| IMD weather API | `AWAITING_ACCESS` (no calls made) |
| IMERG satellite feed | `NOT_CONNECTED` |
| Physical sensor gateway | `NOT_CONNECTED` (ingestion API ready) |
| Virtual soil-moisture stations | `SIMULATED` |
| Replay forecast | `SIMULATED` (later days of the replay period stand in for a forecast) |
| Open-Meteo (non-IMD fallback) | `NOT_CONNECTED` by default; `CONNECTED_LIVE` only after a real call, and only when `WEATHER_PROVIDER=open-meteo` |
| FCM push | `NOT_CONNECTED` (tokens stored, nothing sent) |
| SMS | `SANDBOX` (rendered + logged, never sent) |
| In-app inbox | `CONNECTED_LIVE` after its first real delivery |

## Layout

`app/routers` (HTTP), `app/adapters` (weather providers), `app/services` (monitoring cycle, scoring, roads, alerts + channels + SMS cost, priority, replay, weather ingest, storage), `migrations/` (plain SQL), `scripts/` (migrate, seed, load_pilot, make_mock_pilot, virtual_sensors, demo_prepare, smoke_e2e, threshold_options), `tests/`.
