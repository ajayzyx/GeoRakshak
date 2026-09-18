import pytest

from app.config import get_settings


def test_risk_zones_geojson_with_metadata(client, authority):
    r = client.get("/api/v1/risk-zones", headers=authority)
    body = r.json()
    assert r.status_code == 200 and body["type"] == "FeatureCollection" and len(body["features"]) == 36
    meta = body["metadata"]
    assert meta["provenance"] == "MODEL_OUTPUT" and "SIMULATED_DEMO" in meta["input_provenance"]
    assert meta["forecast_skill_evaluated"] is False and "Not an official warning" in meta["disclaimer"]
    assert {"severity", "score", "confidence", "grid_code"} <= set(body["features"][0]["properties"])


def test_risk_zones_filters_and_validation(client, authority):
    assert client.get("/api/v1/risk-zones?lead_time_h=12", headers=authority).status_code == 422
    assert client.get("/api/v1/risk-zones?bbox=1,1,0,0", headers=authority).status_code == 422
    assert client.get("/api/v1/risk-zones?min_severity=EXTREME", headers=authority).status_code == 422
    inside = client.get("/api/v1/risk-zones?bbox=0,0,0.005,0.005", headers=authority).json()
    assert 0 < len(inside["features"]) < 36


def test_risk_zones_forbidden_for_citizen(client, citizen):
    assert client.get("/api/v1/risk-zones", headers=citizen).status_code == 403


def test_risk_zone_detail_explanations(client, authority):
    zid = client.get("/api/v1/risk-zones", headers=authority).json()["features"][0]["id"]
    d = client.get(f"/api/v1/risk-zones/{zid}", headers=authority).json()
    factors = d["assessment"]["factors"]
    assert len(factors) >= 3
    for f in factors:
        assert {"feature", "label", "contribution", "direction", "component", "text", "provenance"} <= set(f)
    assert "exposure" in d and "villages" in d["exposure"]


def test_risk_zone_detail_not_found(client, authority):
    assert client.get("/api/v1/risk-zones/not-a-uuid", headers=authority).status_code == 404
    assert client.get("/api/v1/risk-zones/00000000-0000-0000-0000-000000000000", headers=authority).status_code == 404


def test_risk_at_point(client, authority, citizen):
    full = client.get("/api/v1/risk/at?lat=0.001&lon=0.001", headers=authority).json()
    assert "factors" in full and full["provenance"] == "MODEL_OUTPUT"
    summary = client.get("/api/v1/risk/at?lat=0.001&lon=0.001", headers=citizen).json()
    assert "factors" not in summary and summary["severity"]
    assert client.get("/api/v1/risk/at?lat=10&lon=10", headers=authority).status_code == 404


def test_active_model(client, authority, officer):
    m = client.get("/api/v1/models/active", headers=authority).json()
    assert m["version"].startswith("b0-") and m["metrics"] is None
    assert client.get("/api/v1/models/active", headers=officer).status_code == 403


def test_layers(client, authority, citizen):
    locs = client.get("/api/v1/layers/locations?type=VILLAGE", headers=authority).json()
    assert len(locs["features"]) == 1 and locs["features"][0]["properties"]["access_status"]
    assert len(client.get("/api/v1/layers/historical-landslides", headers=authority).json()["features"]) == 1
    assert client.get("/api/v1/layers/satellite", headers=authority).json() == {"items": []}
    assert client.get("/api/v1/layers/locations", headers=citizen).status_code == 403
    assert client.get("/api/v1/layers/locations?bbox=bad", headers=authority).status_code == 422


def test_large_geojson_is_gzip_compressed_when_accepted(client, authority):
    res = client.get("/api/v1/risk-zones", headers={**authority, "Accept-Encoding": "gzip"})
    assert res.status_code == 200 and res.headers.get("content-encoding") == "gzip"
    assert res.json()["type"] == "FeatureCollection"
    plain = client.get("/api/v1/risk-zones", headers={**authority, "Accept-Encoding": "identity"})
    assert "content-encoding" not in plain.headers


def test_layer_collections_carry_provenance_metadata(client, authority):
    for path in ("/api/v1/layers/locations", "/api/v1/layers/historical-landslides", "/api/v1/sensor-stations"):
        meta = client.get(path, headers=authority).json().get("metadata")
        assert meta is not None and "provenance" in meta, f"{path} has no provenance metadata"
    roads = client.get("/api/v1/road-segments", headers=authority).json()
    assert roads["metadata"]["run_mode"] and roads["metadata"]["status_semantics"]
    assert all("villages_access_at_risk" in f["properties"] for f in roads["features"])


def test_satellite_layers_always_report_an_acquisition_range(client, authority, db):
    db.execute("""INSERT INTO data_sources (slug, kind, provider, dataset, connection_status, verification_status, provenance_default, metadata)
                  VALUES ('test-sat-period', 'SATELLITE_LAYER', 'Test', 'Interval form', 'CONNECTED_HISTORICAL', 'VERIFIED', 'REAL_HISTORICAL',
                          '{"acquisition_period": "2021-01-01/2021-12-31"}'::jsonb),
                         ('test-sat-none', 'SATELLITE_LAYER', 'Test', 'No dates', 'NOT_CONNECTED', 'UNVERIFIED', 'REAL_HISTORICAL', '{}'::jsonb)""")
    db.commit()
    try:
        items = {i["slug"]: i for i in client.get("/api/v1/layers/satellite", headers=authority).json()["items"]}
        assert items["test-sat-period"]["acquisition_start"] == "2021-01-01" and items["test-sat-period"]["acquisition_end"] == "2021-12-31"
        assert items["test-sat-period"]["acquisition_note"] is None
        assert items["test-sat-none"]["acquisition_start"] is None and items["test-sat-none"]["acquisition_note"]
    finally:
        db.execute("DELETE FROM data_sources WHERE slug IN ('test-sat-period', 'test-sat-none')")
        db.commit()


def test_timestamps_are_returned_in_utc(client, authority):
    meta = client.get("/api/v1/risk-zones", headers=authority).json()["metadata"]
    assert meta["issue_time"].endswith("+00:00") or meta["issue_time"].endswith("Z"), meta["issue_time"]
    assert client.get("/api/v1/dashboard/summary", headers=authority).json()["as_of"].endswith(("+00:00", "Z"))


def test_landcover_layer_carries_labels_and_acquisition_dates(client, authority, db):
    db.execute("""INSERT INTO data_sources (slug, kind, provider, dataset, connection_status, verification_status,
                      provenance_default, attribution_text, metadata)
                  VALUES ('test-landcover', 'SATELLITE_LAYER', 'Test', 'Land cover fixture', 'CONNECTED_HISTORICAL', 'VERIFIED',
                          'REAL_HISTORICAL', 'Test attribution', '{"acquisition_period": "2021-01-01/2021-12-31"}'::jsonb)
                  ON CONFLICT (slug) DO NOTHING""")
    db.commit()
    fc = client.get("/api/v1/layers/landcover", headers=authority).json()
    meta = fc["metadata"]
    assert meta["acquisition_start"] == "2021-01-01" and meta["acquisition_end"] == "2021-12-31"
    assert meta["attribution"] and meta["class_labels"]["10"] == "Tree cover" and "Not an image" in meta["note"]
    if fc["features"]:
        p = fc["features"][0]["properties"]
        assert p["landcover_label"] and p["landcover_class"] is not None
    db.execute("DELETE FROM data_sources WHERE slug = 'test-landcover'")
    db.commit()


def test_rainfall_series_is_visible_to_field_officers_not_citizens(client, officer, citizen, authority):
    zone = client.get("/api/v1/risk-zones", headers=authority).json()["features"][0]["id"]
    ok = client.get(f"/api/v1/risk-zones/{zone}/rainfall", headers=officer)
    assert ok.status_code == 200, "field officers see the evidence behind the rainfall factor"
    body = ok.json()
    assert "observed" in body and "forecast" in body
    assert client.get(f"/api/v1/risk-zones/{zone}/rainfall", headers=citizen).status_code == 403


def test_configured_severity_thresholds_are_applied_and_reported(client, authority, monkeypatch):
    """H11 bands are operator configuration: whatever is set must drive scoring and be visible in the API."""
    from app.services import scoring

    bands = scoring.apply_severity_thresholds()
    assert dict((label, lo) for lo, label in bands) == {"VERY_HIGH": 0.70, "HIGH": 0.55, "MODERATE": 0.25, "LOW": 0.0}

    model = client.get("/api/v1/models/active", headers=authority).json()
    reported = model["thresholds"]["severity_lower_bounds"]
    assert reported["HIGH"] == 0.55 and reported["VERY_HIGH"] == 0.70
    assert model["thresholds"]["severity_thresholds_source"] == "BACKEND_CONFIG"
    assert "not statistically optimal" in model["thresholds"]["severity_thresholds_note"].lower()
    assert model["thresholds"]["calibrated"] is False

    monkeypatch.setattr(get_settings(), "severity_thresholds", "0.25,0.45,0.65")
    assert dict((label, lo) for lo, label in scoring.apply_severity_thresholds())["HIGH"] == 0.45
    monkeypatch.setattr(get_settings(), "severity_thresholds", "0.25,0.55,0.70")
    scoring.apply_severity_thresholds()

    monkeypatch.setattr(get_settings(), "severity_thresholds", "0.9,0.5,0.7")
    with pytest.raises(ValueError):
        scoring.apply_severity_thresholds()
    monkeypatch.setattr(get_settings(), "severity_thresholds", "0.25,0.55,0.70")
    scoring.apply_severity_thresholds()
