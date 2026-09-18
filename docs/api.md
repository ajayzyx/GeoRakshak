# API Design — GeoRakshak MVP Contract

> **Status:** **FROZEN MVP contract v1** (frozen 2026-09-17), **not implemented**. Aligned with official SIH26001 OR-01 to OR-21. Any change needs a PR that updates this file and [database.md](database.md) together, reviewed by the Backend owner and the affected client owners.
> All payloads here are **GeoRakshak's own contract**. They do not describe any external provider's API (IMD, NASA, SMS gateways, push providers). External formats are recorded only after real access, in the adapter code and data-strategy log.
> Example values are fictional and `SIMULATED_DEMO`. Coordinates are illustrative, not real assessed locations.
> Owners: Backend (HTTP API, adapter and channel interfaces), AI/ML (`georakshak_ml` interface, §7.1).

## 1. Conventions

| Topic | Convention |
|---|---|
| Base path | `/api/v1` |
| Format | JSON. Spatial collections are GeoJSON (RFC 7946, lon/lat). |
| Auth | `Authorization: Bearer <access_token>` for users. `X-Station-Key: <key>` for sensor ingestion. |
| IDs / time | UUID. ISO 8601 with timezone, returned in UTC. |
| Pagination | `?limit=&cursor=` → `next_cursor` |
| Spatial filter | `?bbox=minLon,minLat,maxLon,maxLat` |
| Forecast selector | `?lead_time_h=0|24|48|72` (0 = current, the default) |
| Language | `Accept-Language` for localised strings |
| Idempotency | `client_report_id`, `client_media_id`, and `(station_code, variable, observed_at)` for sensor readings |
| Provenance | Every data object includes `provenance`. Collections include a `metadata` block (§6.3). |
| Run mode | Responses from mode-dependent endpoints include `run_mode`: `LIVE` or `DEMO_REPLAY` |

### Error envelope
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "gps_accuracy_m must be a positive number",
    "details": [{"field": "gps_accuracy_m", "issue": "must be > 0"}],
    "request_id": "c1d2..."
  }
}
```
Codes: `VALIDATION_ERROR` (400/422), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `PAYLOAD_TOO_LARGE` (413), `RATE_LIMITED` (429), `UPSTREAM_UNAVAILABLE` (503), `INTERNAL_ERROR` (500).

## 2. Boundaries

| Boundary | Consumer | Transport |
|---|---|---|
| **Public API** `/api/v1/*` | Web dashboard, mobile app | HTTPS, user token |
| **Sensor ingestion API** `/api/v1/sensor-readings` | Virtual sensor emulator (MVP), future gateways | HTTPS, per-station key |
| **Demo control API** `/api/v1/demo/*` | Admin during the demo | HTTPS, `ADMIN`, **disabled in `LIVE` mode** |
| **Internal Python interfaces** | Backend modules | In-process function calls (§7). Not HTTP. |

## 2a. End-to-end data flows (MVP)

Each flow lists the calls in order. `→ internal` marks a server-side step with no client call.

| Flow | Sequence | Reqs |
|---|---|---|
| **Monitoring cycle (live or replay)** | → internal: scheduler → `WeatherProvider.observed/forecast` → `rainfall_observations` / `rainfall_forecasts` → read `sensor_readings` → `georakshak_ml.score()` for `lead_time_h` 0/24/48/72 → `risk_assessments` → road status + village access → alert rules | OR-01, 02, 06, 07, 12, 13 |
| **Risk + forecast view** | `GET /risk-zones?lead_time_h=` → `GET /risk-zones/{id}?lead_time_h=` → `GET /risk-zones/{id}/rainfall` | OR-06, 08, 11, 13 |
| **Exposure view** | `GET /layers/locations` · `GET /layers/historical-landslides` · `GET /layers/satellite` | OR-03, 05, 09 |
| **Road status** | `GET /road-segments?status=` → (authority) `POST /road-segments/{id}/status-override` | OR-12 |
| **Sensor ingestion** | (admin, once) `POST /sensor-stations` → (station/emulator, repeated) `POST /sensor-readings` → `GET /sensor-stations` → picked up by the next monitoring cycle | OR-02, 19 |
| **Report + evidence (offline-safe)** | (device) store locally → `POST /reports` or `POST /reports/sync` → `POST /reports/{id}/media` per file → (authority) `GET /reports` → `GET /media/{id}` | OR-10, 16 |
| **Verification** | `POST /reports/{id}/verify` → internal: road status update, village access, priority recompute → `GET /road-segments`, `GET /response-priorities` | OR-12, 14 |
| **Internal watch (automatic)** | internal: alert rule → `alerts` (`WATCH`, `AUTO_DISPATCHED`) → `NotificationChannel.send` → `notification_deliveries` → (device) push or `GET /me/inbox` → `POST /alerts/{id}/acknowledge` | OR-07, 20 |
| **Public warning (human-approved)** | internal: draft `WARNING` → `GET /alerts?status=DRAFT` → `PATCH /alerts/{id}` → `POST /alerts/{id}/approve` → channels (app push, inbox, SMS sandbox) → `GET /alerts/{id}/deliveries` | OR-15, 20 |
| **Priority** | `GET /response-priorities` (computed on request from verified reports, risk, exposure, road status) | OR-14 |
| **Data-source status** | `GET /data-sources` (dashboard panel, polled) | OR-17, 18, 19, 20 |

## 3. Roles

| Role | Can |
|---|---|
| `ADMIN` | Everything, plus station registration and demo control |
| `STATE_AUTHORITY` / `DISTRICT_AUTHORITY` | Read within jurisdiction. Approve/reject/close alerts. Verify reports. Override road status. |
| `FIELD_OFFICER` | Read risk in jurisdiction. Receive WATCH/WARNING. Submit reports. Acknowledge. |
| `CITIZEN` | Receive WARNING for registered area. Submit reports (moderated). Read public risk summary for own area. |

## 4. Endpoint summary

| Area | Method & path | Roles | Reqs |
|---|---|---|---|
| **Auth** | `POST /auth/login` · `GET /me` · `PATCH /me` (language, SMS preference) | all | OR-15 |
| | `POST /me/devices` (register FCM push token, H8) · `DELETE /me/devices/{id}` | FIELD_OFFICER, CITIZEN | OR-20 |
| **System** | `GET /health` · `GET /system/mode` (run mode, replay, monitoring cycle) · `GET /pilot` | public / all | — |
| | `GET /system/status` (one poll: mode, cycle, model, pilot, every adapter with an honest label) | authorities, field | OR-17, 18, 19, 20 |
| | `POST /system/monitor/run` (LIVE only) · `POST /system/weather/ingest` | admin | OR-01, 13, 17 |
| | `GET /audit-events?entity_type=&entity_id=&action=&limit=` | authorities | OR-14, 20 |
| **Data-source status** | `GET /data-sources` · `GET /data-sources/{slug}` | authorities, admin | OR-17, 18, 19, 20 |
| **Boundaries** | `GET /admin-boundaries?level=` | all | OR-08 |
| **Risk & forecast** | `GET /risk-zones?bbox=&lead_time_h=&min_severity=` (GeoJSON) | authorities, field | OR-06, 08, 11, 13 |
| | `GET /risk-zones/{id}?lead_time_h=` | authorities, field | OR-06, 13 |
| | `GET /risk/at?lat=&lon=&lead_time_h=` | all (citizens: own area only, summary) | OR-06 |
| | `GET /risk-zones/{id}/rainfall?from=&to=` (observed + forecast series) | authorities | OR-01, 13 |
| | `GET /models/active` | authorities, admin | OR-06 |
| **Exposure** | `GET /layers/locations?bbox=&type=&access_status=` (GeoJSON) | authorities, field | OR-09 |
| | `GET /layers/historical-landslides?bbox=` (GeoJSON) | authorities, field | OR-05 |
| | `GET /layers/satellite` (layer metadata incl. acquisition dates and display source) | authorities, field | OR-03 |
| | `GET /layers/landcover?bbox=` (GeoJSON: satellite-derived class per cell, with acquisition range) | authorities, field | OR-03 |
| **Roads** | `GET /road-segments?bbox=&status=&lead_time_h=` (GeoJSON) | authorities, field | OR-12 |
| | `POST /road-segments/{id}/status-override` | authorities | OR-12 |
| **Sensors** | `POST /sensor-stations` (register) | admin | OR-19 |
| | `GET /sensor-stations?bbox=` (GeoJSON, latest reading) | authorities, field | OR-02 |
| | `GET /sensor-stations/{id}/readings?from=&to=` | authorities | OR-02 |
| | `POST /sensor-readings` (batch, idempotent) | station key | OR-02, 19 |
| **Reports & media** | `POST /reports` (idempotent) · `POST /reports/sync` (batch) | FIELD_OFFICER, CITIZEN | OR-10, 16 |
| | `POST /reports/{id}/media` (multipart, idempotent) | reporter | OR-10 |
| | `GET /reports?bbox=&reporter_role=&verification_status=` · `GET /reports/{id}` | authorities (own reports for reporters) | OR-10 |
| | `GET /media/{id}` → short-lived signed URL | authorities, reporter | OR-10 |
| **Verification** | `POST /reports/{id}/verify` | authorities | OR-14 |
| **Alerts & dispatch** | `GET /alerts?tier=&status=` · `GET /alerts/{id}` | authorities | OR-07, 20 |
| | `POST /alerts` (manual draft) · `PATCH /alerts/{id}` (edit draft) | authorities | OR-20 |
| | `POST /alerts/{id}/approve` (dispatch WARNING) · `/reject` · `/close` | authorities | OR-20 |
| | `GET /alerts/{id}/deliveries` | authorities | OR-15, 20 |
| | `GET /me/inbox` · `POST /alerts/{id}/acknowledge` | FIELD_OFFICER, CITIZEN | OR-07, 16 |
| **Priority** | `GET /response-priorities?admin_boundary_id=&lead_time_h=` | authorities | OR-14 |
| **Dashboard** | `GET /dashboard/summary?admin_boundary_id=` | authorities | OR-08 |
| **Demo control** | `POST /demo/replay/start` · `POST /demo/replay/step` (optional `{to_step}`) · `POST /demo/reset` | admin, DEMO_REPLAY only | — |

There is no endpoint that directly calls IMD, IMERG, SMS gateways or push providers. Those run inside adapters and channels (§7).

## 5. Examples

### 5.1 Data-source status (the honesty contract)
`GET /api/v1/data-sources`
```json
{
  "run_mode": "DEMO_REPLAY",
  "items": [
    { "slug": "imd-gridded-rainfall", "kind": "WEATHER_HISTORICAL", "connection_status": "CONNECTED_HISTORICAL",
      "verification_status": "VERIFIED", "last_success_at": "2026-09-30T10:00:00Z", "attribution_text": "<recorded at verification>" },
    { "slug": "imd-weather-api", "kind": "WEATHER_LIVE", "connection_status": "AWAITING_ACCESS",
      "status_note": "Access requested <date>. No live IMD data in use.", "last_success_at": null },
    { "slug": "imerg-feed", "kind": "SATELLITE_FEED", "connection_status": "NOT_CONNECTED", "last_success_at": null },
    { "slug": "sentinel2-composite", "kind": "SATELLITE_LAYER", "connection_status": "CONNECTED_HISTORICAL",
      "metadata": { "acquisition_start": "<date>", "acquisition_end": "<date>" } },
    { "slug": "virtual-soil-moisture", "kind": "SENSOR", "connection_status": "SIMULATED",
      "status_note": "Virtual stations posting through the sensor ingestion API" },
    { "slug": "sensor-gateway", "kind": "SENSOR", "connection_status": "NOT_CONNECTED" },
    { "slug": "app-push-channel", "kind": "NOTIFICATION_CHANNEL", "connection_status": "CONNECTED_LIVE" },
    { "slug": "sms-channel", "kind": "NOTIFICATION_CHANNEL", "connection_status": "SANDBOX",
      "status_note": "Messages rendered and logged, not sent" }
  ]
}
```
`<...>` placeholders are filled from real records. They are never invented.

### 5.2 Risk map (current or forecast)
`GET /api/v1/risk-zones?bbox=91.70,25.50,91.95,25.70&lead_time_h=48&min_severity=MODERATE`
```json
{
  "type": "FeatureCollection",
  "metadata": {
    "run_mode": "DEMO_REPLAY",
    "lead_time_h": 48,
    "issue_time": "2026-07-14T06:00:00Z",
    "valid_from": "2026-07-15T06:00:00Z",
    "valid_until": "2026-07-16T06:00:00Z",
    "model_version": "susc-gbm-0.1.0+trigger-rules-0.1.0",
    "forecast_source": { "slug": "demo-replay-forecast", "label": "Replay scenario (simulated)" },
    "input_provenance": ["REAL_HISTORICAL", "SIMULATED_DEMO"],
    "provenance": "MODEL_OUTPUT",
    "forecast_skill_evaluated": false,
    "disclaimer": "Decision-support risk estimate. Not an official warning."
  },
  "features": [
    {
      "type": "Feature",
      "id": "a3b9...",
      "geometry": { "type": "Polygon", "coordinates": [[[91.800,25.600],[91.805,25.600],[91.805,25.605],[91.800,25.605],[91.800,25.600]]] },
      "properties": { "grid_code": "PILOT-0412-0877", "severity": "HIGH", "score": 0.71, "confidence": "LOW" }
    }
  ]
}
```

### 5.3 Risk zone detail with explanations
`GET /api/v1/risk-zones/a3b9...?lead_time_h=0`
```json
{
  "id": "a3b9...",
  "grid_code": "PILOT-0412-0877",
  "admin_boundary": { "id": "d01...", "name": "Pilot District (demo)" },
  "assessment": {
    "id": "ra77...",
    "lead_time_h": 0,
    "score": 0.78,
    "severity": "VERY_HIGH",
    "confidence": "MEDIUM",
    "model_version": "susc-gbm-0.1.0+trigger-rules-0.1.0",
    "issue_time": "2026-07-14T06:00:00Z",
    "run_mode": "DEMO_REPLAY",
    "provenance": "MODEL_OUTPUT",
    "factors": [
      { "feature": "rain_3d_mm", "label": "3-day rainfall", "value": 182.0, "unit": "mm",
        "contribution": 0.24, "direction": "increases_risk", "component": "TRIGGER",
        "text": "3-day rainfall is far above this area's usual level for this time of year",
        "provenance": "REAL_HISTORICAL" },
      { "feature": "slope_deg_mean", "label": "Slope", "value": 38.5, "unit": "deg",
        "contribution": 0.19, "direction": "increases_risk", "component": "SUSCEPTIBILITY",
        "text": "Very steep slope", "provenance": "REAL_HISTORICAL" },
      { "feature": "ndvi_mean", "label": "Vegetation (satellite)", "value": 0.31, "unit": null,
        "contribution": 0.08, "direction": "increases_risk", "component": "SUSCEPTIBILITY",
        "text": "Sparse vegetation cover (Sentinel-2 composite, <date range>)", "provenance": "REAL_HISTORICAL" },
      { "feature": "sensor_vwc", "label": "Soil moisture sensor", "value": 0.44, "unit": "m3/m3",
        "contribution": 0.06, "direction": "increases_risk", "component": "SENSOR_ADJUSTMENT",
        "text": "Nearby soil moisture reading is high (virtual sensor, simulated)",
        "provenance": "SIMULATED_DEMO", "station_code": "VS-02" }
    ]
  },
  "exposure": { "villages": 3, "schools": 1, "health_facilities": 1, "road_segments_at_risk": 2 },
  "open_alerts": [ { "id": "al55...", "tier": "WATCH", "status": "AUTO_DISPATCHED" } ],
  "disclaimer": "Decision-support risk estimate. Not an official warning."
}
```

### 5.4 Road segments
`GET /api/v1/road-segments?bbox=...&status=AT_RISK,BLOCKED`
```json
{
  "type": "FeatureCollection",
  "metadata": { "run_mode": "DEMO_REPLAY", "status_semantics": "OPEN means no evidence of blockage, not confirmed passable", "attribution": "© OpenStreetMap contributors" },
  "features": [
    { "type": "Feature", "id": "rs12...",
      "geometry": { "type": "LineString", "coordinates": [[91.801,25.598],[91.806,25.603]] },
      "properties": { "road_class": "secondary", "status": "BLOCKED", "status_source": "VERIFIED_REPORT",
        "status_reason": "Verified report: road blocked by debris", "status_report_id": "rp21...",
        "status_updated_at": "2026-07-14T06:52:00Z", "villages_access_at_risk": 2 } }
  ]
}
```

`POST /api/v1/road-segments/rs12.../status-override`
```json
{ "status": "OPEN", "reason": "Cleared, confirmed by field team" }
```
→ `200 OK` with the updated segment. Recorded in `audit_events`.

### 5.5 Sensor ingestion
`POST /api/v1/sensor-readings` · header `X-Station-Key: <station key>`
```json
{
  "station_code": "VS-02",
  "readings": [
    { "variable": "SOIL_MOISTURE_VWC", "value": 0.44, "unit": "m3/m3", "observed_at": "2026-07-14T06:30:00Z" },
    { "variable": "SOIL_MOISTURE_VWC", "value": 0.45, "unit": "m3/m3", "observed_at": "2026-07-14T06:45:00Z" }
  ]
}
```
`200 OK`
```json
{ "station_code": "VS-02", "accepted": 1, "duplicates": 1, "rejected": 0,
  "results": [
    { "observed_at": "2026-07-14T06:30:00Z", "status": "DUPLICATE" },
    { "observed_at": "2026-07-14T06:45:00Z", "status": "ACCEPTED", "quality_flag": "OK" }
  ],
  "provenance": "SIMULATED_DEMO" }
```
Provenance comes from the **station record**, never from the payload. `401` for a bad key. `422` for an unknown variable, unit, or out-of-range value.

### 5.6 Submit report (field or citizen, offline-safe)
`POST /api/v1/reports`
```json
{
  "client_report_id": "0c8e6f0a-4d2b-4b8e-9b1e-3f1b2a7c9d10",
  "alert_id": "al55...",
  "category": "ROAD_BLOCKED",
  "severity": "HIGH",
  "description": "Debris across the road below the slope. Vehicles cannot pass.",
  "language": "en",
  "location": { "type": "Point", "coordinates": [91.8043, 25.6011] },
  "gps_accuracy_m": 8.0,
  "location_adjusted_manually": false,
  "captured_at": "2026-07-14T12:11:00+05:30",
  "media_expected": 2,
  "device_info": { "app_version": "0.1.0", "platform": "android" }
}
```
`201 Created` (new) or `200 OK` (same `client_report_id` → existing record)
```json
{
  "id": "rp21...",
  "client_report_id": "0c8e6f0a-4d2b-4b8e-9b1e-3f1b2a7c9d10",
  "reporter_role": "FIELD_OFFICER",
  "verification_status": "UNVERIFIED",
  "risk_zone_id": "a3b9...",
  "road_segment_id": "rs12...",
  "submitted_at": "2026-07-14T06:41:30Z",
  "media": { "expected": 2, "received": 0 },
  "provenance": "SIMULATED_DEMO"
}
```

`POST /api/v1/reports/sync` → `{ "reports": [ ...same shape... ] }` → per-item `CREATED` / `DUPLICATE` / `REJECTED` with error.

### 5.7 Upload media
`POST /api/v1/reports/rp21.../media` (`multipart/form-data`)
Fields: `client_media_id`, `media_type` (`PHOTO`|`VIDEO`), `captured_at`, optional `lat`/`lon`, optional `duration_s` (videos; >30 → `422`), `file`.

`201 Created` or `200 OK` (duplicate `client_media_id`)
```json
{ "id": "ev40...", "client_media_id": "5d1f...", "media_type": "VIDEO", "mime_type": "video/mp4",
  "size_bytes": 7421133, "duration_s": 10.4, "sha256": "9a1f...", "upload_status": "UPLOADED" }
```
Frozen limits: photo ≤10 MB (`image/jpeg`, `image/png`), video ≤30 s and ≤25 MB (`video/mp4`). Over the limit → `413` / `422`. The mobile app compresses before upload.

### 5.8 Verify report
`POST /api/v1/reports/rp21.../verify`
```json
{ "decision": "VERIFIED", "note": "Photo and video show debris across the carriageway." }
```
`200 OK`
```json
{ "id": "rp21...", "verification_status": "VERIFIED",
  "effects": { "road_segment": { "id": "rs12...", "status": "BLOCKED" },
               "villages_access_at_risk": 2, "priority_recomputed": true } }
```

### 5.9 Alerts: automatic internal watch
`GET /api/v1/alerts/al55...`
```json
{
  "id": "al55...", "tier": "WATCH", "status": "AUTO_DISPATCHED", "trigger_type": "AUTOMATIC_THRESHOLD",
  "severity": "HIGH", "lead_time_h": 0, "risk_zone_ids": ["a3b9..."],
  "explanation_snapshot": [ { "label": "3-day rainfall", "text": "far above usual" } ],
  "languages": ["en", "hi", "<pilot-language>"],
  "dispatched_at": "2026-07-14T06:05:02Z", "approved_by": null,
  "run_mode": "DEMO_REPLAY", "provenance": "MODEL_OUTPUT", "is_demo": true
}
```

### 5.10 Alerts: approve a public warning
`POST /api/v1/alerts/al60.../approve`
```json
{ "languages": ["en", "hi", "<pilot-language>"], "channels": ["APP_PUSH", "APP_INBOX", "SMS"],
  "recommended_actions": "Avoid the road below the slope. Follow instructions from local authorities.",
  "valid_until": "2026-07-15T06:00:00Z" }
```
`200 OK`
```json
{ "id": "al60...", "tier": "WARNING", "status": "DISPATCHED",
  "approved_by": { "id": "u900...", "full_name": "Demo District Authority" },
  "approved_at": "2026-07-14T06:20:10Z", "dispatched_at": "2026-07-14T06:20:10Z",
  "delivery_summary": { "APP_PUSH": { "SENT": 1 }, "APP_INBOX": { "SENT": 1 }, "SMS": { "SANDBOXED": 1 } } }
```
- `409 CONFLICT` if not in `DRAFT`. `403` without jurisdiction.
- `WATCH` alerts cannot be "approved". They are automatic.
- While FCM isn't configured, `delivery_summary.APP_PUSH` reports `{"NOT_CONNECTED": n}` and no push delivery rows are created. Nothing is claimed as sent.
- Open alerts are deduplicated: newly affected cells extend the open `WATCH` (or open `WARNING` draft) instead of creating new ones.
- A `WARNING` can never reach `DISPATCHED` without this call.

### 5.11 Deliveries
`GET /api/v1/alerts/al60.../deliveries`
```json
{ "items": [
  { "recipient": "Demo Citizen", "channel": "SMS", "channel_mode": "SANDBOX", "language": "hi",
    "destination_masked": "+91******0000", "status": "SANDBOXED",
    "rendered_text": "<rendered from the reviewed Hindi template>", "queued_at": "2026-07-14T06:20:10Z" },
  { "recipient": "Demo Citizen", "channel": "APP_PUSH", "channel_mode": "LIVE", "language": "hi",
    "status": "ACKNOWLEDGED", "sent_at": "2026-07-14T06:20:11Z", "acknowledged_at": "2026-07-14T06:20:40Z" }
] }
```

### 5.12 Response priorities
`GET /api/v1/response-priorities?admin_boundary_id=d01...`
```json
{
  "computed_at": "2026-07-14T06:53:00Z", "rule_version": "priority-rules-0.1.0", "run_mode": "DEMO_REPLAY",
  "items": [
    { "rank": 1, "priority_level": "P1", "priority_score": 0.88, "risk_zone_id": "a3b9...",
      "reasons": [
        "Verified report: road blocked (photo + video)",
        "Risk VERY_HIGH (3-day rainfall far above usual)",
        "2 villages with access at risk; 1 health facility within 2 km"
      ],
      "provenance": "MODEL_OUTPUT" }
  ]
}
```
Only `VERIFIED` reports count toward priority.

### 5.13 System mode
`GET /api/v1/system/mode` → `{ "run_mode": "DEMO_REPLAY", "replay": { "scenario": "<name>", "provenance": "REAL_HISTORICAL", "step": 4, "steps": 12 } }`

### 5.14 Additional response shapes (frozen with v1)

**Login:** `POST /auth/login` `{ "email": "...", "password": "..." }` → `200`
```json
{ "access_token": "<jwt>", "token_type": "bearer", "expires_in": 3600,
  "user": { "id": "u900...", "full_name": "Demo District Authority", "email": "authority.demo@example.org",
            "role": "DISTRICT_AUTHORITY", "preferred_language": "en", "admin_boundary_id": "d01...", "is_demo_account": true } }
```
`401 UNAUTHENTICATED` on bad credentials. `GET /me` returns the `user` object.

**Reports list:** `GET /reports` → `{ "items": [Report], "next_cursor": null }`, where
```json
{ "id": "rp21...", "client_report_id": "0c8e...", "reporter_role": "FIELD_OFFICER", "reporter_name": "Demo Field Officer",
  "category": "ROAD_BLOCKED", "severity": "HIGH", "description": "...", "language": "en",
  "location": { "type": "Point", "coordinates": [91.8043, 25.6011] }, "gps_accuracy_m": 8.0,
  "location_adjusted_manually": false, "captured_at": "...", "submitted_at": "...",
  "verification_status": "UNVERIFIED", "verified_by": null, "verified_at": null, "verification_note": null,
  "risk_zone_id": "a3b9...", "road_segment_id": "rs12...", "alert_id": null,
  "media": [ { "id": "ev40...", "media_type": "PHOTO", "upload_status": "UPLOADED" } ],
  "media_expected": 1, "provenance": "SIMULATED_DEMO" }
```
`GET /reports/{id}` returns one Report.

**Media URL:** `GET /media/{id}` → `{ "id": "ev40...", "media_type": "PHOTO", "mime_type": "image/jpeg", "url": "<short-lived signed URL>", "expires_at": "..." }`

**Inbox:** `GET /me/inbox` → `{ "items": [ { "alert_id", "tier", "severity", "title", "body", "language", "dispatched_at", "acknowledged_at", "risk_zone_ids", "lead_time_h", "is_demo" } ] }`. Title and body are in the user's `preferred_language`.
`POST /alerts/{id}/acknowledge` → `{ "alert_id": "...", "acknowledged_at": "..." }`

**Alerts list:** `GET /alerts` → `{ "items": [Alert] }` (Alert shape as §5.9, plus `messages` and `recommended_actions`)

**Sensor stations:** `GET /sensor-stations` → FeatureCollection of Points. Properties: `station_code`, `name`, `station_type` (`VIRTUAL`|`PHYSICAL`), `status`, `latest_reading` (`{variable, value, unit, observed_at}` or null), `provenance`.

**Locations layer:** `GET /layers/locations` → FeatureCollection. Properties: `type`, `name`, `access_status`, `population`, `population_source_year`, `source_slug`, `provenance`.

**Historical landslides layer:** `GET /layers/historical-landslides` → FeatureCollection. Properties: `event_date`, `event_date_precision`, `trigger`, `landslide_type`, `location_accuracy_m`, `source_slug`, `provenance`.

**Satellite layers:** `GET /layers/satellite` → `{ "items": [ { "slug", "title", "kind": "IMAGERY|NDVI|LANDCOVER", "acquisition_start", "acquisition_end", "bounds": [minLon,minLat,maxLon,maxLat], "display": { "type": "image", "url": "..." } | null, "attribution_text", "provenance" } ] }`. `display` is null when no renderable layer exists yet.

**Pilot area:** `GET /pilot` → `{ "slug", "name", "status": "PROVISIONAL|SELECTED", "bbox": [..], "cell_size_m", "boundary": GeoJSON geometry, "boundary_note" }` (lets clients frame the map)

**Dashboard summary:** `GET /dashboard/summary` → `{ "run_mode", "risk_zone_counts": {"LOW": n, "MODERATE": n, "HIGH": n, "VERY_HIGH": n}, "alerts": {"DRAFT": n, "AUTO_DISPATCHED": n, "DISPATCHED": n}, "reports": {"UNVERIFIED": n, "VERIFIED": n, "REJECTED": n}, "road_segments": {"OPEN": n, "AT_RISK": n, "BLOCKED": n, "UNKNOWN": n}, "as_of": "..." }`

### 5.15 Request/response details clarified during integration (v1, non-breaking)

Recorded from the first web/mobile integration. They describe the implemented behaviour.

- **Rainfall series:** `GET /risk-zones/{id}/rainfall` is available to authorities **and field officers** (it is the evidence behind the rainfall factor), and returns `observed` and `forecast` series with each point's source and provenance. Citizens get `403`.
- **Risk at a point (frozen):** `GET /risk/at?lat=&lon=&lead_time_h=` → `{ "risk_zone_id", "grid_code", "lead_time_h", "severity", "issue_time", "run_mode", "provenance": "MODEL_OUTPUT", "disclaimer" }`. Non-citizen roles also get `score`, `confidence`, `model_version`, `factors` (§6.2). `404` with distinct messages for "outside the monitored pilot area" and "no assessment available for this location yet".
- **Update own profile:** `PATCH /me` `{ "preferred_language"?: string, "sms_enabled"?: bool }` → the `user` object (§5.14).
- **Edit a draft alert:** `PATCH /alerts/{id}` `{ "recommended_actions"?, "languages"?, "valid_until"? }` → Alert. `409` unless `DRAFT`.
- **Notification languages:** `languages` in approve/PATCH must be codes that have a template. An unknown code, or an empty list, returns `422` with `details: {"unsupported": [...], "supported": [...]}`. Languages are never dropped silently. Each recipient receives their `preferred_language` when it is among the approved languages, otherwise English (if approved), otherwise the first approved language.
- **Reject / close alert:** `POST /alerts/{id}/reject` and `/close` take no required body (a `{ "note" }` body is accepted and currently not stored). `409` from a disallowed status.
- **Report severity** is observation severity `LOW|MEDIUM|HIGH|CRITICAL` (database.md §4.15), distinct from risk severity `LOW|MODERATE|HIGH|VERY_HIGH`.
- **Report limits:** `description` ≤ 4000 characters, `media_expected` 0–10. Reusing a `client_report_id` from the same reporter returns `200` with the existing report. From another reporter it returns `409`. A report response carries `media[]` and `media_summary` (`{expected, received}`).
- **`gps_accuracy_m` is required and must be > 0**, including when `location_adjusted_manually` is true: send the reporter's own uncertainty estimate for a manually placed pin, never a fabricated fix accuracy.
- **Media:** multipart fields are `client_media_id`, `media_type`, `captured_at`, `lat`, `lon`, `duration_s` and `file`. Limits are binary megabytes (10 MiB photo, 25 MiB video); clients may apply the stricter 10^6-byte reading. Videos send `duration_s`; over 30 s returns `422`. Reusing a `client_media_id` for the same report returns `200`, for another report `409`. Media URLs are absolute.
- **Push device registration:** `POST /me/devices` `{ "platform": "ANDROID"|"IOS", "push_token": string (≥10 chars), "app_version"?: string }` → `201 { "id", "push_channel_status": "NOT_CONNECTED", "note" }`. The token is stored; no push is sent while FCM is unconfigured (H8). `DELETE /me/devices/{id}` → `204`.
- **Sessions:** there is no refresh endpoint. `expires_in` is 3600 s (`JWT_TTL_S`), so a field officer offline for longer must sign in again before syncing; queued reports are kept. 🔶 Decide whether to raise the mobile token lifetime or add refresh tokens.
- **Demo control:** `POST /demo/replay/start`, `/demo/replay/step`, `/demo/reset` take no body. Start and step return `{ "replay": {"scenario", "provenance", "step", "steps", "as_of"}, "cycle": {...} }`. Reset returns `{ "reset": true, "baseline_scoring": {...} }`. `409` when there is no replay rainfall, when stepping before start or past the last step, and in `LIVE` mode. `POST /demo/sensors/start` is **not implemented**. Virtual sensors run as a separate emulator process (`backend/scripts/virtual_sensors.py`) that posts through the real ingestion API.
- **SMS cost accounting (H14 input, no gateway connected):** each SMS delivery records `sms_encoding` (`GSM7`|`UCS2`) and `sms_segments`, and an approval's `delivery_summary` includes `SMS_COST.segments`. Measured with the current templates: an English warning is **1 GSM-7 segment**, the Hindi one **2 UCS-2 segments** (Indic scripts allow only 70 characters per segment). Non-SMS deliveries must leave both fields null, enforced by a database constraint.
- **Translation scope:** severity is a fixed vocabulary and **is** translated per language (`Very High` → `बहुत अधिक`). The authority's `recommended_actions` is inserted **verbatim into every language** — it is never machine-translated (CLAUDE.md §10 rule 9). Clients must tell the operator that this text goes out untranslated. Unknown severities and languages fall back to the English term rather than inventing one.
- **Alert lifecycle** (implemented, tested):
  - An internal `WATCH` is raised automatically for **current** High/Very High cells (`lead_time_h: 0`) and, separately, for cells **forecast** to reach High (`lead_time_h` = the earliest lead, message from the forecast template). One open WATCH per run mode and horizon; new cells extend it.
  - An open `WATCH` is **closed automatically** when none of its cells is still High in the latest assessment for its horizon. `status` becomes `CLOSED` with `closed_reason` starting `AUTO:`, no message is sent, and the closure is audited. A later rise then raises a new WATCH and notifies again instead of silently extending a stale one. Only `WATCH` may close this way; the database enforces that.
  - Public `WARNING` drafts come from **current** risk only (Very High, or High with a verified report) and are never closed automatically.
  - `UPDATE` requires `related_alert_id` referencing a dispatched `WARNING`/`UPDATE` plus non-empty `recommended_actions`, and on approval goes to **that alert's previous recipients**. Enforced by the API and by database constraints.
  - Alert objects also carry `related_alert_id`, `closed_reason` and `zones_currently_high` (how many of the alert's cells are High right now, so an operator can see whether a draft still applies).
  - `POST /alerts/{id}/reject` and `/close` accept `{ "note" }`; a close stores it as `closed_reason` prefixed `Authority:`.
- **Replay jump:** `POST /demo/replay/step` accepts `{ "to_step": n }`. Every intermediate monitoring cycle runs, so the result is identical to stepping one at a time (about 3 s per step on the Aizawl pilot). `409` if `to_step` ≤ the current step or ≥ `steps`; replays never run backwards, so reset and start again.
- **Risk map metadata** (`GET /risk-zones`) describes the assessment run, not the filtered rows: `model_version`, `issue_time`, `forecast_source` and `forecast_skill_evaluated` are present even when a `min_severity` or `bbox` filter matches no cell. The severity filter parameter is `min_severity`, not `severity`.
- **Response fields frozen after the first integration pass** (previously undocumented, all present in the implementation):
  - `GET /system/mode` → `{ "run_mode", "replay": {"scenario", "provenance", "step", "steps", "as_of"} | null, "monitor": {...} }`. `replay` is null until a replay is started. `monitor` carries `enabled`, `interval_s`, `weather_provider`, `last_run_at`, **`last_success_at`** (kept through failures, so clients can state exactly how stale the displayed risk is), `last_status` (`OK`|`FAILED`), `last_error`, `next_run_at`, `result` (`scored`, `model_version`, `roads_at_risk`, `villages_access_at_risk`, `watch_created`, `forecast_watch_created`, `warning_draft_created`, `watches_auto_closed`, and `retention` with the pruned counts in LIVE mode), `weather`, `weather_error` and, in `DEMO_REPLAY`, a `note` that cycles run on replay steps. Clients must show a `FAILED` monitoring cycle rather than hide it. A scheduled cycle fetches weather at most once every `WEATHER_MIN_INTERVAL_S`; in between, `weather` reports `skipped: "fetched recently"` with explicit zero counts and `last_fetch_at`, which is normal rather than an error.
  - `GET /system/status` → `{ "run_mode", "replay", "monitor", "pilot": {slug, name, status}, "model": {version, model_type, stage, calibrated, validated, metrics, validation_scheme, forecast_skill_evaluated, model_card_uri}, "adapters": {weather: [...], satellite: [...], sensor: [...], inventory: [...], terrain: [...], exposure: [...], notification: [...], other: [...]}, "label_counts", "labels", "disclaimer", "as_of" }`. Each adapter entry carries the stored `connection_status` **and** a derived display `effective_label` from a fixed vocabulary — `REAL_LIVE`, `REAL_REPLAY`, `REAL_HISTORICAL`, `SIMULATED`, `SANDBOX`, `AWAITING_ACCESS`, `NOT_CONNECTED` — plus `is_imd`, `is_fallback` (a non-IMD weather provider), `licence_class` (`OPEN`|`RESTRICTED`|`UNKNOWN`, from an explicit `metadata.publication_restricted` flag or else the licence wording), `publication_restricted`, `age_s` (seconds since `last_success_at`), `last_error`, licence and attribution. `model.caveat` carries the model's own wording (for B0: uncalibrated heuristics, not validated thresholds). `REAL_REPLAY` is derived only for real archived rainfall while `run_mode` is `DEMO_REPLAY`; it is not a stored provenance value. `model.validated` is true only when validated metrics exist, so the rule-based baseline reads as unvalidated.
  - `POST /system/weather/ingest` (admin) fetches rainfall from the configured weather adapter and returns `{provider, points, observations, forecasts, observed_source, forecast_source, is_imd}`. `409` when `WEATHER_PROVIDER` is `none`, `503` when the provider is not connected (for example the IMD API, which stays `AWAITING_ACCESS`).
  - `POST /system/monitor/run` (admin, **LIVE only**) runs one monitoring cycle immediately and returns the recorded state; `409` in `DEMO_REPLAY`, `500` with the error detail if the cycle fails.
  - `GET /risk-zones` metadata: `forecast_source.connection_status`, `input_provenance[]`, `provenance`, `forecast_skill_evaluated`, `disclaimer`.
  - `GET /risk-zones/{id}`: `static_features`, `feature_provenance`, assessment `valid_from` / `valid_until` / `input_provenance` / `forecast_source` / `forecast_skill_evaluated`, and exposure `road_segments_blocked` and `villages_access_at_risk`.
  - `GET /road-segments`: feature property `status_source` may be `NONE` (no status evidence yet) as well as `MODEL_RISK`, `VERIFIED_REPORT` or `AUTHORITY_OVERRIDE`; each feature carries `villages_access_at_risk`; metadata carries `run_mode`, `status_semantics`, `attribution`, `lead_time_h` and `provenance`.
  - `GET /layers/landcover` → FeatureCollection of analysis cells. Feature properties: `grid_code`, `landcover_class` (ESA WorldCover code), `landcover_label`, `landcover_tree_share`, `provenance`. Metadata: `source_slug`, `dataset`, `connection_status`, `acquisition_start`, `acquisition_end`, `acquisition_note`, `attribution`, `provenance`, `class_labels`, and a note that it is a class per cell, not an image.
  - `GET /layers/locations`, `/layers/historical-landslides` and `/sensor-stations` return a `metadata` block with `provenance`, `source_slugs` and `attribution` (sensor stations also carry a note that virtual stations are simulated).
  - `GET /layers/satellite`: each item carries `acquisition_start`, `acquisition_end` and, when the source records no range, `acquisition_note` explaining that. A source may record the range as an ISO interval (`acquisition_period: "2021-01-01/2021-12-31"`); the API splits it. Never present a layer without its range (CLAUDE.md §9 rule 12).
  - `GET /audit-events` (authorities) → `{ "items": [ { "id", "at", "action", "entity_type", "entity_id", "details", "actor": {"id", "full_name", "role"} | null } ], "note" }`. Filters: `entity_type`, `entity_id` (UUID, else `422`), `action` (comma-separated), `limit` (1–500). **`actor: null` means the system acted automatically**, for example an auto-dispatched `WATCH` or an auto-closed watch. Actions in use: `ALERT_APPROVED`, `ALERT_AUTO_DISPATCHED`, `ALERT_AUTO_CLOSED`, `ALERT_REJECTED`, `ALERT_CLOSED`, `REPORT_VERIFIED`, road status overrides. `id` is a bigint, not a UUID, because this is an append-only log rather than a domain entity, and `details` varies per action (clients display it, they do not parse it).
  - `GET /dashboard/summary`: `alerts` also counts `CLOSED`; clients must tolerate extra status keys. `as_of` is null when nothing has been assessed yet.
  - `GET /models/active` returns `404` until a model version is registered, and returns the stored row: `version`, `model_type`, `stage`, `feature_config` (which wraps the package's `feature_list`), `thresholds` (with `calibrated`), `validation_scheme`, `metrics` (null while no validated model exists), `forecast_skill_evaluated`, `model_card_uri`, `registered_at`.
- **Timestamps** are serialised in UTC (`+00:00`); the database session is pinned to UTC regardless of the server's local timezone.
- **Fixtures:** the §5.1 example shows `CONNECTED_LIVE` for illustration only. Mocks and fixtures must never use it (CLAUDE.md §9 rule 8).

## 6. Shared objects

### 6.1 Enums
- `provenance`: `REAL_LIVE` · `REAL_HISTORICAL` · `SIMULATED_DEMO` · `MODEL_OUTPUT`
- `connection_status`: `CONNECTED_LIVE` · `CONNECTED_HISTORICAL` · `SIMULATED` · `SANDBOX` · `AWAITING_ACCESS` · `NOT_CONNECTED`
- `severity`: `LOW` · `MODERATE` · `HIGH` · `VERY_HIGH`
- `road status`: `OPEN` · `AT_RISK` · `BLOCKED` · `UNKNOWN`
- `alert tier`: `WATCH` · `WARNING` · `UPDATE`
- `alert status`: `DRAFT` · `AUTO_DISPATCHED` · `APPROVED` · `DISPATCHED` · `REJECTED` · `CLOSED`
- `delivery status`: `QUEUED` · `SENT` · `SANDBOXED` · `FAILED` · `ACKNOWLEDGED`

### 6.2 Explanation factor
```json
{ "feature": "string", "label": "string", "value": 0.0, "unit": "string|null",
  "contribution": 0.0, "direction": "increases_risk|decreases_risk",
  "component": "SUSCEPTIBILITY|TRIGGER|SENSOR_ADJUSTMENT",
  "text": "template-rendered plain language", "provenance": "enum|null", "station_code": "optional" }
```
`value` is `null` for note factors (e.g. no rainfall input). Those have `contribution: 0`, and clients show them as having no effect. `provenance` is `null` only when the input's provenance wasn't reported. Clients must label that and never guess.

### 6.3 Collection metadata
`run_mode`, `lead_time_h`, `issue_time`, `valid_from`, `valid_until`, `model_version`, `forecast_source`, `input_provenance[]`, `provenance`, `forecast_skill_evaluated`, `disclaimer`, `attribution`.

## 7. Internal interfaces (in-process, not HTTP)

Language-neutral signatures. Finalised in Phase 1 (task 1.7).

### 7.1 `georakshak_ml` (owner: AI/ML)
```
score(cells: list[CellFeatures], lead_time_h: int, sensor_inputs: list[SensorInput] | None)
  -> list[{ cell_id, score, severity, confidence, factors: list[Factor] }]

explain(cell: CellFeatures, lead_time_h: int, sensor_inputs: list[SensorInput] | None)
  -> list[Factor]                                   # same factors as score() for one cell

active_model() -> { version, model_type, stage, feature_list, thresholds, validation_scheme,
                    metrics | null, forecast_skill_evaluated, model_card_uri }
```
Missing required features → explicit error. **No silent imputation.**

### 7.2 Adapters (owner: Backend, semantics with AI/ML)
```
WeatherProvider:   slug, connection_status()
                   observed(area, period) -> list[RainfallObservation]      # normalised to our schema
                   forecast(area, lead_times) -> list[RainfallForecast]     # with issue_time, valid window
SatelliteSource:   slug, connection_status()
                   static_layers() -> list[LayerMetadata]                  # precomputed, dated
                   fetch_latest(area) -> FeedResult                         # feed adapters only
SensorSource:      slug, connection_status()                                # HTTP ingestion is the MVP source
NotificationChannel: slug, mode (LIVE|SANDBOX), connection_status()
                   send(recipient, rendered_message) -> DeliveryResult
```
Implementations planned for the MVP:
- `ImdGriddedFiles`: historical.
- `ForecastProvider`: IMD if access is granted, else the approved non-IMD provider (labelled non-IMD), else replay (H16).
- `ReplayScenario`.
- `ImdApi`: **stub**, status `AWAITING_ACCESS`, and every method raises "not connected."
- `ImergFeed`: **stub**, `NOT_CONNECTED`, unless the spike connects it.
- `Sentinel2Composite` and `WorldCover`: static layers.
- `AppPushChannel` (FCM, H8) and `AppInboxChannel` (polling fallback).
- `SmsChannel` in `SANDBOX` mode.

**Rule:** adapter tests use GeoRakshak's normalised types and our own fixtures. No external response format is invented.

## 8. Versioning and change rules

- Breaking changes require `/api/v2` or a deprecation window.
- Update this document and [database.md](database.md) **in the same PR** as any contract change.
- An OpenAPI document will be generated from the implementation. This file remains the design reference.
