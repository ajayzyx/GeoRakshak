import hashlib
import secrets
from datetime import datetime, timezone
from typing import Literal

import psycopg
from fastapi import APIRouter, Depends, Header
from pydantic import BaseModel, Field

from app.db import get_db
from app.errors import ApiError
from app.geo import collection, feature
from app.security import AUTHORITY_ROLES, CurrentUser, require_roles
from app.services.sources import mark_success, source_id

router = APIRouter(tags=["sensors"])
VARIABLES = {"SOIL_MOISTURE_VWC": ("m3/m3", 0.0, 1.0)}


def _key_hash(key: str) -> str:
    return hashlib.sha256(key.encode()).hexdigest()


class StationIn(BaseModel):
    station_code: str = Field(pattern=r"^[A-Z0-9-]{2,32}$")
    name: str
    station_type: Literal["VIRTUAL", "PHYSICAL"]
    location: dict
    depth_cm: float | None = None
    influence_radius_m: float = Field(default=1500, gt=0, le=10000)


@router.post("/sensor-stations", status_code=201)
def register_station(body: StationIn, user: CurrentUser = Depends(require_roles("ADMIN")), db: psycopg.Connection = Depends(get_db)):
    if body.location.get("type") != "Point":
        raise ApiError(422, "location must be a GeoJSON Point")
    lon, lat = body.location["coordinates"]
    if db.execute("SELECT 1 FROM sensor_stations WHERE station_code = %s", (body.station_code,)).fetchone():
        raise ApiError(409, "station_code already registered")
    key = secrets.token_urlsafe(24)
    slug = "virtual-soil-moisture" if body.station_type == "VIRTUAL" else "sensor-gateway"
    # A physical station is only REAL_LIVE once real readings arrive; virtual stations are always SIMULATED_DEMO.
    prov = "SIMULATED_DEMO" if body.station_type == "VIRTUAL" else "REAL_LIVE"
    row = db.execute(
        """INSERT INTO sensor_stations (station_code, name, station_type, geom, depth_cm, influence_radius_m, api_key_hash, source_id, provenance)
           VALUES (%s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s, %s) RETURNING id""",
        (body.station_code, body.name, body.station_type, lon, lat, body.depth_cm, body.influence_radius_m, _key_hash(key), source_id(db, slug), prov),
    ).fetchone()
    return {"id": str(row["id"]), "station_code": body.station_code, "station_key": key, "note": "Store this key now. It is not shown again."}


@router.get("/sensor-stations")
def stations(bbox: str | None = None, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES, "FIELD_OFFICER")), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT ss.id, ST_AsGeoJSON(ss.geom, 6) AS g, ss.station_code, ss.name, ss.station_type, ss.status, ss.provenance::text AS provenance,
                  (SELECT json_build_object('variable', sr.variable, 'value', sr.value, 'unit', sr.unit, 'observed_at', sr.observed_at)
                   FROM sensor_readings sr WHERE sr.station_id = ss.id ORDER BY sr.observed_at DESC LIMIT 1) AS latest_reading
           FROM sensor_stations ss ORDER BY ss.station_code"""
    ).fetchall()
    return collection([feature(r.pop("g"), {k: v for k, v in r.items() if k != "id"}, r["id"]) for r in rows],
                      {"provenance": sorted({r["provenance"] for r in rows}) if rows else [],
                       "note": "Virtual stations are simulated and never used for training or reported metrics (CLAUDE.md §9 rule 10)"})


@router.get("/sensor-stations/{station_id}/readings")
def readings(station_id: str, limit: int = 200, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    try:
        rows = db.execute(
            "SELECT variable, value, unit, observed_at, received_at, quality_flag, provenance::text AS provenance FROM sensor_readings WHERE station_id = %s ORDER BY observed_at DESC LIMIT %s",
            (station_id, min(limit, 1000)),
        ).fetchall()
    except psycopg.errors.InvalidTextRepresentation:
        raise ApiError(404, "Station not found")
    return {"items": rows}


class ReadingIn(BaseModel):
    variable: str
    value: float
    unit: str
    observed_at: datetime


class ReadingsIn(BaseModel):
    station_code: str
    readings: list[ReadingIn] = Field(min_length=1, max_length=500)


@router.post("/sensor-readings")
def ingest(body: ReadingsIn, x_station_key: str | None = Header(default=None), db: psycopg.Connection = Depends(get_db)):
    station = db.execute("SELECT id, api_key_hash, provenance::text AS provenance, station_type, status FROM sensor_stations WHERE station_code = %s", (body.station_code,)).fetchone()
    if not station or not x_station_key or not secrets.compare_digest(station["api_key_hash"], _key_hash(x_station_key)):
        raise ApiError(401, "Unknown station or invalid station key")
    if station["status"] != "ACTIVE":
        raise ApiError(403, "Station is inactive")
    for r in body.readings:
        spec = VARIABLES.get(r.variable)
        if not spec:
            raise ApiError(422, f"Unknown variable {r.variable}", [{"field": "variable", "issue": "unsupported"}])
        if r.unit != spec[0]:
            raise ApiError(422, f"{r.variable} must use unit {spec[0]}", [{"field": "unit", "issue": "wrong unit"}])
        if not spec[1] <= r.value <= spec[2]:
            raise ApiError(422, f"{r.variable} value out of range", [{"field": "value", "issue": "out of range"}])
        if r.observed_at.tzinfo is None:
            raise ApiError(422, "observed_at must include a timezone", [{"field": "observed_at", "issue": "naive datetime"}])
    results, accepted = [], 0
    for r in body.readings:
        row = db.execute(
            """INSERT INTO sensor_readings (station_id, variable, value, unit, observed_at, provenance) VALUES (%s, %s, %s, %s, %s, %s)
               ON CONFLICT (station_id, variable, observed_at) DO NOTHING RETURNING id""",
            (station["id"], r.variable, r.value, r.unit, r.observed_at, station["provenance"]),
        ).fetchone()
        accepted += bool(row)
        results.append({"observed_at": r.observed_at, "status": "ACCEPTED" if row else "DUPLICATE", **({"quality_flag": "OK"} if row else {})})
    db.execute("UPDATE sensor_stations SET last_reading_at = (SELECT max(observed_at) FROM sensor_readings WHERE station_id = %s) WHERE id = %s", (station["id"], station["id"]))
    if accepted and station["station_type"] == "PHYSICAL":
        mark_success(db, "sensor-gateway", "CONNECTED_LIVE")
    elif accepted:
        mark_success(db, "virtual-soil-moisture")
    return {"station_code": body.station_code, "accepted": accepted, "duplicates": len(results) - accepted, "rejected": 0,
            "results": results, "provenance": station["provenance"]}
