from datetime import datetime, timedelta, timezone


def _register(client, admin, code="VS-T1", station_type="VIRTUAL"):
    return client.post("/api/v1/sensor-stations", headers=admin, json={
        "station_code": code, "name": "Virtual test station", "station_type": station_type,
        "location": {"type": "Point", "coordinates": [0.02, 0.013]}})


def _reading(value=0.4, when=None, unit="m3/m3", variable="SOIL_MOISTURE_VWC"):
    return {"variable": variable, "value": value, "unit": unit, "observed_at": (when or datetime.now(timezone.utc)).isoformat()}


def test_station_registration(client, admin, authority):
    r = _register(client, admin)
    assert r.status_code == 201 and r.json()["station_key"]
    assert _register(client, admin).status_code == 409
    assert _register(client, authority, code="VS-T2").status_code == 403


def test_ingestion_duplicates_and_provenance(client, admin, authority):
    key = _register(client, admin, code="VS-T3").json()["station_key"]
    t = datetime.now(timezone.utc)
    body = {"station_code": "VS-T3", "readings": [_reading(0.41, t), _reading(0.42, t + timedelta(minutes=15))]}
    r1 = client.post("/api/v1/sensor-readings", headers={"X-Station-Key": key}, json=body).json()
    assert r1["accepted"] == 2 and r1["provenance"] == "SIMULATED_DEMO"
    r2 = client.post("/api/v1/sensor-readings", headers={"X-Station-Key": key}, json=body).json()
    assert r2["accepted"] == 0 and r2["duplicates"] == 2
    stations = client.get("/api/v1/sensor-stations", headers=authority).json()["features"]
    props = next(f["properties"] for f in stations if f["properties"]["station_code"] == "VS-T3")
    assert props["station_type"] == "VIRTUAL" and props["latest_reading"]["value"] == 0.42


def test_ingestion_rejections(client, admin):
    key = _register(client, admin, code="VS-T4").json()["station_key"]
    h = {"X-Station-Key": key}
    assert client.post("/api/v1/sensor-readings", headers={"X-Station-Key": "wrong"}, json={"station_code": "VS-T4", "readings": [_reading()]}).status_code == 401
    assert client.post("/api/v1/sensor-readings", json={"station_code": "VS-T4", "readings": [_reading()]}).status_code == 401
    assert client.post("/api/v1/sensor-readings", headers=h, json={"station_code": "VS-T4", "readings": [_reading(1.5)]}).status_code == 422
    assert client.post("/api/v1/sensor-readings", headers=h, json={"station_code": "VS-T4", "readings": [_reading(unit="%")]}).status_code == 422
    assert client.post("/api/v1/sensor-readings", headers=h, json={"station_code": "VS-T4", "readings": [_reading(variable="TILT")]}).status_code == 422


def test_virtual_station_cannot_be_real(db):
    import psycopg
    import pytest

    with pytest.raises(psycopg.errors.CheckViolation):
        db.execute("""INSERT INTO sensor_stations (station_code, name, station_type, geom, api_key_hash, provenance)
                      VALUES ('VS-BAD', 'bad', 'VIRTUAL', ST_SetSRID(ST_MakePoint(0,0),4326), 'x', 'REAL_LIVE')""")
