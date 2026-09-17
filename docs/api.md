# API Design (Proposed) — GeoRakshak

> **Status:** PROPOSED. Nothing is implemented. Examples use fictional, `SIMULATED_DEMO` values.
> Owner: Backend Developer (public API), AI/ML Engineer (internal ML API contract).

## 1. General conventions

| Topic | Convention |
|---|---|
| Base path | `/api/v1` |
| Format | JSON. Spatial collections as **GeoJSON** (RFC 7946, WGS84 lon/lat order). |
| Auth | `Authorization: Bearer <access_token>` (token type/issuer decided with the backend framework) |
| IDs | UUID |
| Time | ISO 8601 with timezone, stored/returned in UTC |
| Pagination | `?limit=&cursor=`, and the response includes `next_cursor` |
| Filtering | Query params, for example `?status=OPEN&district_id=...&bbox=minLon,minLat,maxLon,maxLat` |
| Language | `Accept-Language` header for localised strings |
| Idempotency | `client_*_id` fields for offline-created resources. `Idempotency-Key` header on other unsafe retries. |
| Provenance | Every data-bearing object includes `provenance` and, where relevant, `as_of` |
| Errors | Uniform error envelope (below) |

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

Standard codes: `VALIDATION_ERROR` (400/422), `UNAUTHENTICATED` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `CONFLICT` (409), `RATE_LIMITED` (429), `UPSTREAM_UNAVAILABLE` (503), `INTERNAL_ERROR` (500).

### Roles
`ADMIN`, `STATE_AUTHORITY`, `DISTRICT_AUTHORITY`, `FIELD_OFFICER`. Authority users are also scoped by jurisdiction.

## 2. API boundaries

| Boundary | Consumer | Exposure |
|---|---|---|
| **Public API** `/api/v1/*` | Web app, mobile app | HTTPS, authenticated |
| **Internal ML API** `/internal/ml/v1/*` | Backend, batch jobs | Private network only |
| **Ingestion jobs** | Scheduler | No HTTP API. Writes to the DB. Status exposed via the admin API. |

## 3. Endpoint summary (public)

| Area | Method & Path | Roles |
|---|---|---|
| Auth | `POST /auth/login`, `POST /auth/refresh`, `POST /auth/logout`, `GET /me` | all |
| Boundaries | `GET /admin-boundaries?level=DISTRICT` | all |
| Risk map | `GET /risk-zones?bbox=&min_class=` (GeoJSON) | all |
| Risk detail | `GET /risk-zones/{id}` | all |
| Risk at point | `GET /risk/at?lat=&lon=` | all |
| Risk history | `GET /risk-zones/{id}/assessments?from=&to=` | authorities |
| Layers | `GET /layers/historical-landslides?bbox=`, `GET /layers/locations?bbox=&type=` | all |
| Observations | `GET /observations?risk_zone_id=&variable=RAINFALL&from=&to=` | authorities |
| Alerts | `GET /alerts`, `GET /alerts/{id}` | all (scoped) |
| Alerts | `POST /alerts` (manual draft), `PATCH /alerts/{id}` (edit draft) | authorities |
| Alerts | `POST /alerts/{id}/approve`, `POST /alerts/{id}/reject`, `POST /alerts/{id}/close` | authorities |
| Alerts | `POST /alerts/{id}/acknowledge` | recipients |
| Field reports | `POST /field-reports` (idempotent) | field officers |
| Field reports | `POST /field-reports/sync` (batch, idempotent) | field officers |
| Field reports | `GET /field-reports`, `GET /field-reports/{id}` | scoped |
| Field reports | `POST /field-reports/{id}/verify` | authorities |
| Evidence | `POST /field-reports/{id}/evidence` (multipart) | field officers |
| Evidence | `GET /evidence/{id}` (returns short-lived signed URL) | scoped |
| Incidents | `GET /incidents`, `GET /incidents/{id}`, `PATCH /incidents/{id}` | authorities |
| Priority | `GET /response-priorities?district_id=` | authorities |
| Dashboard | `GET /dashboard/summary?district_id=` | authorities |
| Admin | `GET/POST/PATCH /admin/users`, `GET/PUT /admin/thresholds`, `GET/POST /admin/alert-templates`, `GET /admin/data-sources`, `GET /admin/ingestion-runs` | admin |
| Health | `GET /health` | public |

## 4. Example requests and responses

### 4.1 Login
`POST /api/v1/auth/login`
```json
{ "email": "officer.demo@example.org", "password": "********" }
```
`200 OK`
```json
{
  "access_token": "<token>",
  "refresh_token": "<token>",
  "expires_in": 3600,
  "user": {
    "id": "6f1c...", "full_name": "Demo Field Officer", "role": "FIELD_OFFICER",
    "preferred_language": "en", "is_demo_account": true
  }
}
```

### 4.2 Risk map (GeoJSON)
`GET /api/v1/risk-zones?bbox=91.70,25.50,91.95,25.70&min_class=MODERATE`
```json
{
  "type": "FeatureCollection",
  "metadata": {
    "as_of": "2026-07-14T06:00:00Z",
    "model_version": "b0-rules-0.1.0",
    "input_provenance": ["REAL_HISTORICAL", "SIMULATED_DEMO"],
    "provenance": "MODEL_OUTPUT",
    "disclaimer": "Decision-support risk estimate. Not an official warning."
  },
  "features": [
    {
      "type": "Feature",
      "id": "a3b9...",
      "geometry": { "type": "Polygon", "coordinates": [[[91.80,25.60],[91.81,25.60],[91.81,25.61],[91.80,25.61],[91.80,25.60]]] },
      "properties": {
        "grid_code": "PILOT-0412-0877",
        "risk_class": "HIGH",
        "score": 0.71,
        "assessed_at": "2026-07-14T06:00:00Z"
      }
    }
  ]
}
```
> Coordinates are illustrative only. They do not represent a real assessed location.

### 4.3 Risk detail with explanation
`GET /api/v1/risk-zones/a3b9...`
```json
{
  "id": "a3b9...",
  "grid_code": "PILOT-0412-0877",
  "district": { "id": "d01...", "name": "Pilot District (demo)" },
  "current_assessment": {
    "id": "ra77...",
    "score": 0.71,
    "risk_class": "HIGH",
    "confidence": "MEDIUM",
    "model_version": "b0-rules-0.1.0",
    "assessed_at": "2026-07-14T06:00:00Z",
    "valid_until": "2026-07-15T06:00:00Z",
    "provenance": "MODEL_OUTPUT",
    "input_provenance": ["REAL_HISTORICAL", "SIMULATED_DEMO"],
    "factors": [
      { "feature": "rain_3d_mm", "label": "3-day rainfall", "value": 182.0, "unit": "mm",
        "contribution": 0.24, "direction": "increases_risk",
        "text": "3-day rainfall is far above this area's usual level for this time of year",
        "provenance": "SIMULATED_DEMO" },
      { "feature": "slope_deg", "label": "Slope", "value": 38.5, "unit": "deg",
        "contribution": 0.19, "direction": "increases_risk",
        "text": "Very steep slope", "provenance": "REAL_HISTORICAL" },
      { "feature": "past_landslide_density", "label": "Past landslides nearby", "value": 1.8, "unit": "per km²",
        "contribution": 0.12, "direction": "increases_risk",
        "text": "Landslides have been recorded near this area before", "provenance": "REAL_HISTORICAL" }
    ]
  },
  "exposure": { "villages_within_2km": 3, "road_segments_within_500m": 2 },
  "open_alert_id": "al55...",
  "disclaimer": "Decision-support risk estimate. Not an official warning."
}
```

### 4.4 Approve alert
`POST /api/v1/alerts/al55.../approve`
```json
{
  "languages": ["en", "hi"],
  "recipient_user_ids": ["6f1c..."],
  "recommended_actions": "Verify slope condition near the road cut. Report cracks or seepage.",
  "valid_until": "2026-07-15T06:00:00Z"
}
```
`200 OK`
```json
{
  "id": "al55...",
  "status": "PUBLISHED",
  "severity": "WARNING",
  "approved_by": { "id": "u900...", "full_name": "Demo District Authority" },
  "approved_at": "2026-07-14T06:05:12Z",
  "published_at": "2026-07-14T06:05:12Z",
  "messages": [
    { "language": "en", "title": "High landslide risk — verification requested", "body": "..." },
    { "language": "hi", "title": "...", "body": "..." }
  ],
  "provenance": "MODEL_OUTPUT",
  "is_demo": true
}
```
`409 CONFLICT` if the alert is not in `DRAFT`. `403 FORBIDDEN` if the user lacks jurisdiction.

### 4.5 Submit field report (offline-safe)
`POST /api/v1/field-reports`
```json
{
  "client_report_id": "0c8e6f0a-4d2b-4b8e-9b1e-3f1b2a7c9d10",
  "alert_id": "al55...",
  "category": "CRACK",
  "severity": "HIGH",
  "description": "Fresh tension crack above road cut, about 10 m long. Water seeping.",
  "language": "en",
  "location": { "type": "Point", "coordinates": [91.8043, 25.6051] },
  "gps_accuracy_m": 8.0,
  "captured_at": "2026-07-14T06:41:00+05:30",
  "evidence_count_expected": 2,
  "device_info": { "app_version": "0.1.0", "platform": "android" }
}
```
`201 Created` (new) or `200 OK` (duplicate `client_report_id`, returns the existing record)
```json
{
  "id": "fr21...",
  "client_report_id": "0c8e6f0a-4d2b-4b8e-9b1e-3f1b2a7c9d10",
  "verification_status": "UNVERIFIED",
  "incident_id": "in09...",
  "risk_zone_id": "a3b9...",
  "submitted_at": "2026-07-14T01:20:03Z",
  "evidence_upload": { "expected": 2, "received": 0 },
  "provenance": "SIMULATED_DEMO"
}
```

### 4.6 Batch sync
`POST /api/v1/field-reports/sync`
```json
{ "reports": [ { "client_report_id": "…", "...": "same shape as 4.5" } ] }
```
`200 OK`
```json
{
  "results": [
    { "client_report_id": "…", "status": "CREATED", "id": "fr21..." },
    { "client_report_id": "…", "status": "DUPLICATE", "id": "fr19..." },
    { "client_report_id": "…", "status": "REJECTED", "error": { "code": "VALIDATION_ERROR", "message": "location required" } }
  ]
}
```

### 4.7 Upload evidence
`POST /api/v1/field-reports/fr21.../evidence` (`multipart/form-data`)
Fields: `client_evidence_id`, `media_type` (`PHOTO`|`VIDEO`), `captured_at`, `lat`, `lon`, `file`.

`201 Created`
```json
{
  "id": "ev40...",
  "client_evidence_id": "5d1f...",
  "media_type": "PHOTO",
  "mime_type": "image/jpeg",
  "size_bytes": 842113,
  "sha256": "9a1f...",
  "upload_status": "UPLOADED"
}
```
Limits (proposed, to confirm): photos ≤ 10 MB, videos ≤ 50 MB / ≤ 60 s. Allowed MIME types are enforced server-side.

### 4.8 Verify report
`POST /api/v1/field-reports/fr21.../verify`
```json
{ "decision": "VERIFIED", "note": "Photos consistent with active slope movement." }
```
`200 OK` returns the updated report and triggers a priority recalculation.

### 4.9 Response priorities
`GET /api/v1/response-priorities?district_id=d01...`
```json
{
  "computed_at": "2026-07-14T01:22:00Z",
  "rule_version": "priority-rules-0.1.0",
  "items": [
    {
      "rank": 1,
      "incident_id": "in09...",
      "risk_zone_id": "a3b9...",
      "priority_score": 0.86,
      "priority_level": "P1",
      "reasons": [
        "Verified HIGH-severity crack report with photo evidence",
        "Area risk class HIGH (3-day rainfall far above normal)",
        "3 villages within 2 km. Road segment within 500 m."
      ],
      "provenance": "MODEL_OUTPUT"
    }
  ]
}
```

### 4.10 Dashboard summary
`GET /api/v1/dashboard/summary?district_id=d01...`
```json
{
  "as_of": "2026-07-14T01:22:00Z",
  "risk_zone_counts": { "LOW": 812, "MODERATE": 140, "HIGH": 31, "VERY_HIGH": 4 },
  "alerts": { "DRAFT": 1, "PUBLISHED": 2, "acknowledged_pct": 50 },
  "reports": { "UNVERIFIED": 3, "VERIFIED": 1, "REJECTED": 0 },
  "incidents_open": 2,
  "data_freshness": [
    { "source": "rainfall", "last_success": "2026-07-14T00:00:00Z", "provenance": "SIMULATED_DEMO" }
  ],
  "demo_mode": true
}
```

## 5. Internal ML API (contract)

### 5.1 `POST /internal/ml/v1/predict`
```json
{
  "model_version": "active",
  "items": [
    { "risk_zone_id": "a3b9...", "as_of": "2026-07-14T06:00:00Z",
      "features": { "slope_deg": 38.5, "relief_m": 210, "landcover_class": "shrubland",
                    "past_landslide_density": 1.8, "rain_1d_mm": 64, "rain_3d_mm": 182,
                    "rain_antecedent_15d_mm": 410 },
      "feature_provenance": { "rain_3d_mm": "SIMULATED_DEMO", "slope_deg": "REAL_HISTORICAL" } }
  ],
  "explain": true,
  "top_k_factors": 5
}
```
`200 OK`
```json
{
  "model_version": "b0-rules-0.1.0",
  "results": [
    { "risk_zone_id": "a3b9...", "score": 0.71, "risk_class": "HIGH", "confidence": "MEDIUM",
      "factors": [ { "feature": "rain_3d_mm", "value": 182, "contribution": 0.24, "direction": "increases_risk" } ] }
  ]
}
```
Missing required features: `422` with the list of missing features. The service never imputes silently.

### 5.2 `GET /internal/ml/v1/model`
Returns the active model version, type, feature list, thresholds, a metrics summary and a model card reference.

### 5.3 `GET /internal/ml/v1/health`

## 6. Versioning and change rules

- Breaking changes require `/api/v2` or a deprecation window.
- Update this document **in the same PR** as any API change.
- Machine-readable spec: an OpenAPI document is generated from the implementation once the framework is approved. This file remains the design reference.
