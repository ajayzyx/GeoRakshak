# Development Guide — GeoRakshak

> Engineering contract for the parallel workstreams (backend, web, mobile, ML, integration).
> Product and API rules live in [CLAUDE.md](../CLAUDE.md), [api.md](api.md) (frozen contract v1) and [database.md](database.md). This file pins the concrete implementation choices so the tracks stay compatible.

## 1. Recorded implementation choices (under approved decisions)

| Decision | Choice | Notes |
|---|---|---|
| H1 Backend | Python 3.11 + FastAPI + psycopg 3 (plain SQL, no ORM) | Plain SQL files as migrations. PostGIS does the spatial work. |
| H2 Web | React + TypeScript + Vite + MapLibre GL JS | No UI framework. Plain CSS. |
| H3 Mobile | Expo SDK 57 (React Native) + TypeScript | `expo-sqlite` (local-first queue), `expo-location`, `expo-image-picker` (video capture capped at 29 s so clips stay under the 30 s limit), `expo-secure-store`, `expo-file-system`, `expo-crypto`, `@react-native-community/netinfo`. State-based navigation (four screens, no router library). Tests need Node ≥ 22.13 (`node:sqlite`). |
| H5 Basemap | **No third-party basemap by default.** Plain background + our own GeoJSON layers. | Optional `VITE_BASEMAP_STYLE_URL`, only after a terms check. Public OSM tile servers must not be used by default. |
| H8 Push | Inbox polling now. FCM added once a Firebase project exists. | FCM needs a project the team owns (credential). |
| Local database | Homebrew PostgreSQL 17 + PostGIS | Docker isn't available on the primary dev machine. `docker-compose.yml` is kept for cloud/dev parity. |

## 2. Repository layout

```
backend/                 FastAPI service (single deployable)
  app/                   modules: auth, risk, reports, sources, alerts, roads, priority, ...
  migrations/            ordered SQL files (0001_*.sql, ...)
  scripts/               migrate, seed, load_pilot
  tests/                 pytest (uses a separate test database)
ml/                      georakshak_ml package + offline data pipeline
  georakshak_ml/         importable scoring package (light dependencies only)
  pipeline/              acquisition, grid, features, training scripts
  data/raw/              downloaded source data (gitignored)
  data/processed/<slug>/ handoff files for the backend (gitignored except small manifests)
  reports/               data spike, evaluation reports, model cards
web/                     React + Vite dashboard
mobile/                  Expo app (field + citizen modes)
docs/
docker-compose.yml       PostGIS + backend + web (parity; not used on machines without Docker)
```

## 3. Local ports and environment

| Service | Port | Key env vars |
|---|---|---|
| PostgreSQL/PostGIS | 5432 | `DATABASE_URL=postgresql://localhost:5432/georakshak`, `TEST_DATABASE_URL=.../georakshak_test` |
| Backend | 8000 | `JWT_SECRET`, `CORS_ORIGINS`, `MEDIA_DIR`, `RUN_MODE=DEMO_REPLAY\|LIVE`, `PILOT_DATA_DIR`, `MONITOR_INTERVAL_S` (LIVE only, default 900; 0 disables), `WEATHER_PROVIDER` (default `none`) |
| Web | 5173 | `VITE_API_BASE_URL=http://localhost:8000/api/v1`, `VITE_API_MODE=live\|mock`, `VITE_BASEMAP_STYLE_URL` (empty by default, H5) |
| Mobile (Expo) | 8081 | `EXPO_PUBLIC_API_BASE_URL`, `EXPO_PUBLIC_API_MODE=live\|mock` |

Every secret has a placeholder in `.env.example`. Never commit real values.
Demo users are seeded with a **local-development-only** password taken from `DEMO_USER_PASSWORD`. It must be changed for any cloud deployment.

## 4. Mocks and placeholders

- Web and mobile ship a `mock` API mode built **from the api.md examples**. Mock data is fictional, labelled `SIMULATED_DEMO`, and uses an obviously fictional area name ("Mock Area — not a real location").
- Mock mode shows a visible **MOCK DATA** banner.
- Adapters with no real access (IMD API, IMERG, sensor gateway, SMS gateway, FCM) exist as stubs that report `AWAITING_ACCESS` / `NOT_CONNECTED` / `SANDBOX` and never return data.
- Real-world data is never invented. If real data isn't available yet, the feature runs on labelled mock or replay data until it is.

## 5. `georakshak_ml` interface (owner: AI/ML)

```python
from georakshak_ml import score, explain, active_model

# cell: {"cell_id": str, "features": {name: float|str|None}, "feature_provenance": {name: provenance}}
# sensor_inputs (optional): [{"cell_id", "station_code", "variable": "SOIL_MOISTURE_VWC", "value", "unit": "m3/m3",
#                             "observed_at", "distance_m", "provenance"}]
score(cells: list[dict], lead_time_h: int = 0, sensor_inputs: list[dict] | None = None) -> list[dict]
# -> [{"cell_id", "score": float 0..1, "severity": "LOW|MODERATE|HIGH|VERY_HIGH",
#      "confidence": "LOW|MEDIUM|HIGH", "model_version": str, "factors": [Factor, ...]}]

explain(cell: dict, lead_time_h: int = 0, sensor_inputs: list[dict] | None = None) -> list[dict]
# -> the Factor list for one cell (same objects as score()["factors"])

active_model() -> dict
# -> {"version", "model_type", "stage", "feature_list", "thresholds", "validation_scheme",
#     "metrics": None|dict, "forecast_skill_evaluated": bool, "model_card_uri": str|None}
```
Factor = [api.md §6.2](api.md). Missing **required** features raise `MissingFeaturesError`, with no silent imputation. Rainfall features are optional. Without them, the trigger component contributes nothing and a factor says "No rainfall input for this cell."

`b0-rules-0.1.0` (model card: `ml/georakshak_ml/README.md`):
- **Required:** `slope_deg_mean`, `relief_m`.
- **Optional:** `landcover_class`, `ndvi_mean`, `past_landslide_density`, `rain_1d_mm`, `rain_3d_mm`, `rain_7d_mm`, `rain_antecedent_15d_mm`, `rain_anomaly`.
- **Note factors** ("no rainfall input", "no sensor coverage") have `value: null`, `contribution: 0` and provenance `MODEL_OUTPUT`. Clients show them as having no effect.
- A factor's `provenance` is `null` when the cell's `feature_provenance` omits that feature. Clients must show "provenance not reported", not guess.

## 6. ML → backend handoff files

`ml/data/processed/<pilot_slug>/`:

| File | Content |
|---|---|
| `manifest.json` | `pilot_slug`, `name`, `status` (`PROVISIONAL`\|`SELECTED`), `bbox` [minLon,minLat,maxLon,maxLat], `cell_size_m`, `projected_crs`, `feature_version`, `generated_at`, `boundary_note`, `sources[]` (fields of the `data_sources` table: `slug`, `kind`, `provider`, `dataset`, `connection_status`, `verification_status`, `verified_at`, `licence`, `attribution_text`, `provenance_default`, `status_note`, `metadata`) |
| `grid_cells.geojson` | Polygon features (EPSG:4326). Properties: `grid_code`, `static_features` {…}, `feature_provenance` {…}. |
| `historical_landslides.geojson` | Properties per database.md §4.11 (`event_date`, `event_date_precision`, `location_accuracy_m`, `trigger`, `landslide_type`, `source_slug`, `source_record_id`) |
| `locations.geojson` | Properties: `type`, `name`, `osm_id`, `attributes`, `source_slug` |
| `road_segments.geojson` | LineString features. Properties: `osm_way_id`, `name`, `road_class`, `source_slug`. |
| `boundary.geojson` | Pilot boundary. If no official boundary is loaded yet, the pilot bbox with `boundary_note: "Pilot bounding box — not an official administrative boundary"`. |
| `rainfall_daily.csv` (when available) | `grid_code,date,rainfall_mm,source_slug,provenance` |

The backend loads these with `backend/scripts/load_pilot.py`. Only files that exist are loaded.
- Extra feature properties (e.g. `centroid`, `feature_sources`, `segment_index`, `ref`) are allowed and ignored unless listed above.
- `rainfall_daily.csv` holds daily totals only. The **backend** derives the rolling rainfall features (`rain_1d/3d/7d_mm`, `rain_antecedent_15d_mm`) at each scoring time. `rain_anomaly` needs a climatology that isn't provided yet.
- Loading a pilot removes the previous pilot's `data_sources` entries (tagged `metadata.pilot_slug`) and keeps seeded integrations.
- Provisional real pilot: `ml/data/processed/aizawl-mizoram/` (rebuild with `ml/pipeline/build_all.py`). Its IMD rainfall is for local development only until the S1 licence question is resolved ([data-strategy.md §1a](data-strategy.md)).

## 6a. Monitoring cycle

One cycle = score every cell → recompute road status and village access → evaluate the alert policy (internal `WATCH` automatic, public `WARNING` drafted only).

| Run mode | What drives cycles |
|---|---|
| `DEMO_REPLAY` | Each `POST /demo/replay/step` runs exactly one cycle. No timer. |
| `LIVE` | A background task in the API process runs one every `MONITOR_INTERVAL_S` seconds. `POST /system/monitor/run` (admin) runs one immediately. |

**Weather adapters** (`app/adapters/weather.py`, api.md §7.2). `WEATHER_PROVIDER` selects one:

| Value | Behaviour |
|---|---|
| `none` (default) | Nothing is fetched. Both Open-Meteo source rows stay `NOT_CONNECTED`. |
| `open-meteo` | Approved non-IMD fallback (H16). Free API, CC-BY 4.0, non-commercial, <10,000 calls/day. 3×3 provider points across the pilot bbox; every cell takes its nearest point. Recent daily precipitation is stored as **model output, not gauge observations, and not IMD**; forecasts fill leads 24/48/72 h. |
| `imd-weather-api` | Interface only. Raises `NotConnected` and stays `AWAITING_ACCESS` until access is granted; no request format is assumed. |

A LIVE cycle fetches weather first, but **at most once every `WEATHER_MIN_INTERVAL_S`** (default 3600): providers publish a few times a day, and fetching every cycle only churns rows and burns the rate limit. In between, the cycle reuses stored data and reports `weather.skipped`. `POST /system/weather/ingest` (admin) always fetches. A weather failure is recorded (`weather_error`) and the risk cycle still runs on stored data. A source becomes `CONNECTED_LIVE` only after a real successful call.

**History retention (LIVE only).** Each cycle writes one assessment per cell per lead, so history grows quickly (about 11,000 rows per cycle on the Aizawl pilot). A cycle prunes superseded assessments and stale forecast issues older than `ASSESSMENT_RETENTION_DAYS` (default 7). `DEMO_REPLAY` is never pruned, because its issue times are the replayed historical dates.

`GET /system/mode` reports `monitor`: whether the scheduler is enabled, the interval, the last run and its status, the last error and the next run. **A failed cycle is recorded and served, never swallowed.** With no weather source connected, LIVE cycles score terrain only and each explanation says there is no rainfall input.

## 7. Milestones

**M1:** Login → map → pilot terrain → risk cells → click cell → explanation → submit field report (photo) → report appears on the dashboard.

**M2:** Rainfall replay → risk change → automatic watch + approved warning → mobile inbox and acknowledgement → offline report → verification → road status → priority.

## 8. Quality gates (every track)

- Backend: `pytest` passes. Every endpoint has a success test and a failure test.
- End-to-end: `backend/.venv/bin/python -m scripts.smoke_e2e` passes against a running backend (resets demo data, then replay → risk change → explanation → WATCH → held WARNING → report + photo → verification → road status → priority → approval → sandboxed deliveries). Run it before any demo rehearsal.
- Web: `npm run smoke:browser` drives the dashboard in headless Chrome.
- Mobile: `npm run check:live` checks the report, media, inbox and risk endpoints against a running backend. It is not part of `npm test`, because tests never touch the network.
- `georakshak_ml`: fixed-input unit tests.
- Web and mobile: `tsc --noEmit` and unit tests pass.
- Mobile: offline queue tests cover (a) offline save, (b) restart persistence and resumed uploads, (c) reconnect sync with no overlapping runs, and (d) duplicate-safe sync.
- No test calls a live external API.

## 9. Running locally

See each component's `README.md` (`backend/`, `web/`, `mobile/`, `ml/`). Short version:

```
# backend (Homebrew Postgres + PostGIS running)
cd backend && .venv/bin/python -m scripts.migrate && .venv/bin/python -m scripts.load_pilot <handoff dir> && .venv/bin/python -m scripts.seed
.venv/bin/uvicorn app.main:app --port 8000 --reload --reload-dir app
.venv/bin/python -m scripts.smoke_e2e                 # end-to-end check (resets demo data)
.venv/bin/python -m scripts.demo_prepare --to-step 29 # repeatable demo state with virtual sensors
cd web && npm run dev          # live mode; `npm run dev:mock` for the bundled mock
cd mobile && npx expo start    # EXPO_PUBLIC_API_MODE=live and EXPO_PUBLIC_API_BASE_URL=http://<laptop LAN IP>:8000/api/v1 for a phone
```

- The backend `CORS_ORIGINS` must include the web origin (`http://localhost:5173` by default).
- **LIVE mode refuses to start with development secrets** (`JWT_SECRET`, `DEMO_USER_PASSWORD` defaults, or `CORS_ORIGINS=*`). Set real values, or `ALLOW_DEV_SETTINGS=true` for local LIVE testing only — it logs a loud warning and must never be used on a deployment.
- Mobile unit tests need Node ≥ 22.13 (they use the built-in `node:sqlite`).
- A phone reaching the laptop over plain HTTP on the LAN is for local development only.
