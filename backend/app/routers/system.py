import uuid

import psycopg
from fastapi import APIRouter, Depends, Query

from app.db import get_db
from app.errors import ApiError
from app.security import AUTHORITY_ROLES, CurrentUser, current_user, require_roles
from app.adapters import weather
from app.config import get_settings
from app.services import monitor, replay, status, system, weather_ingest

router = APIRouter(tags=["system"])
DISCLAIMER = "Decision-support risk estimate. Not an official warning."


@router.get("/health")
def health(db: psycopg.Connection = Depends(get_db)):
    db.execute("SELECT 1")
    postgis = db.execute("SELECT postgis_lib_version() AS v").fetchone()["v"]
    return {"status": "ok", "database": "ok", "postgis": postgis}


@router.get("/system/mode")
def mode(user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    return {"run_mode": system.run_mode(), "replay": replay.public_state(system.get_state(db, "replay")),
            "monitor": monitor.public_state(system.get_state(db, monitor.STATE_KEY))}


@router.get("/system/status")
def system_status(user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES, "FIELD_OFFICER")), db: psycopg.Connection = Depends(get_db)):
    """Everything the dashboard's status panel needs in one poll: mode, cycle, model, pilot and every adapter's honest state."""
    return status.build(db)


@router.post("/system/monitor/run")
def run_monitor(user: CurrentUser = Depends(require_roles("ADMIN")), db: psycopg.Connection = Depends(get_db)):
    """Run one monitoring cycle now (LIVE mode only; in DEMO_REPLAY the replay steps drive cycles)."""
    if system.run_mode() != "LIVE":
        raise ApiError(409, "In DEMO_REPLAY, cycles run on replay steps. Use POST /demo/replay/step.")
    state = monitor.run_and_record("MANUAL")
    if state["last_status"] != "OK":
        raise ApiError(500, "Monitoring cycle failed", [{"field": "monitor", "issue": state["last_error"]}])
    return state


@router.post("/system/weather/ingest")
def ingest_weather(user: CurrentUser = Depends(require_roles("ADMIN")), db: psycopg.Connection = Depends(get_db)):
    """Fetch real rainfall from the configured weather adapter (WEATHER_PROVIDER). Nothing is fetched by default."""
    try:
        provider = weather.get_provider(get_settings().weather_provider)
    except ValueError as e:
        raise ApiError(422, str(e))
    if provider is None:
        raise ApiError(409, "No weather provider configured; set WEATHER_PROVIDER (see docs/development.md)")
    try:
        return weather_ingest.ingest(db, provider)
    except weather.NotConnected as e:
        raise ApiError(503, "Weather provider is not connected", [{"field": "weather_provider", "issue": str(e)[:300]}])


@router.get("/pilot")
def pilot(user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    row = db.execute(
        """SELECT p.slug, p.name, p.status, p.bbox, p.cell_size_m, p.boundary_note, ST_AsGeoJSON(b.geom, 6)::json AS boundary
           FROM pilot_area p LEFT JOIN admin_boundaries b ON b.id = p.boundary_id WHERE p.is_active LIMIT 1"""
    ).fetchone()
    if not row:
        raise ApiError(404, "No pilot area loaded")
    return row


@router.get("/data-sources")
def data_sources(user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT slug, kind, provider, dataset, connection_status::text AS connection_status, status_note, access_requested_at,
                  last_success_at, last_error, verification_status, verified_at, licence, attribution_text, provenance_default::text AS provenance_default, metadata
           FROM data_sources ORDER BY kind, slug"""
    ).fetchall()
    return {"run_mode": system.run_mode(), "items": rows}


@router.get("/data-sources/{slug}")
def data_source(slug: str, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT slug, kind, provider, dataset, connection_status::text AS connection_status, status_note, access_requested_at, last_success_at, last_error, verification_status, verified_at, licence, attribution_text, metadata FROM data_sources WHERE slug = %s",
        (slug,),
    ).fetchone()
    if not row:
        raise ApiError(404, "Unknown data source")
    return row


@router.get("/audit-events")
def audit_events(entity_type: str | None = None, entity_id: str | None = None, action: str | None = None,
                 limit: int = Query(100, ge=1, le=500), user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)),
                 db: psycopg.Connection = Depends(get_db)):
    """Who did what: alert approvals and rejections, report verifications, road overrides, automatic dispatch and closure."""
    where, args = ["true"], []
    for column, value in (("entity_type", entity_type), ("action", action)):
        if value:
            where.append(f"a.{column} = ANY(%s)")
            args.append(value.split(","))
    if entity_id:
        try:
            uuid.UUID(entity_id)
        except ValueError:
            raise ApiError(422, "entity_id must be a UUID", [{"field": "entity_id", "issue": "not a UUID"}])
        where.append("a.entity_id = %s")
        args.append(entity_id)
    args.append(limit)
    try:
        rows = db.execute(
            f"""SELECT a.id, a.at, a.action, a.entity_type, a.entity_id, a.details,
                       CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'full_name', u.full_name, 'role', u.role::text) END AS actor
                FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id
                WHERE {' AND '.join(where)} ORDER BY a.at DESC, a.id DESC LIMIT %s""",
            args,
        ).fetchall()
    except psycopg.errors.InvalidTextRepresentation:
        raise ApiError(422, "entity_id must be a UUID")
    return {"items": rows, "note": "An actor of null means the system acted automatically (for example an auto-dispatched WATCH)."}


@router.get("/dashboard/summary")
def summary(user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    mode = system.run_mode()

    def counts(sql, args=()):
        return {r["k"]: r["n"] for r in db.execute(sql, args).fetchall()}

    return {
        "run_mode": mode,
        "risk_zone_counts": {"LOW": 0, "MODERATE": 0, "HIGH": 0, "VERY_HIGH": 0} | counts(
            "SELECT severity::text AS k, count(*) AS n FROM risk_assessments WHERE is_latest AND lead_time_h = 0 AND run_mode = %s GROUP BY 1", (mode,)),
        "alerts": {"DRAFT": 0, "AUTO_DISPATCHED": 0, "DISPATCHED": 0} | counts("SELECT status::text AS k, count(*) AS n FROM alerts WHERE run_mode = %s GROUP BY 1", (mode,)),
        "reports": {"UNVERIFIED": 0, "VERIFIED": 0, "REJECTED": 0} | counts("SELECT verification_status::text AS k, count(*) AS n FROM reports WHERE deleted_at IS NULL GROUP BY 1"),
        "road_segments": {"OPEN": 0, "AT_RISK": 0, "BLOCKED": 0, "UNKNOWN": 0} | counts("SELECT status::text AS k, count(*) AS n FROM road_segments GROUP BY 1"),
        "as_of": db.execute("SELECT max(issue_time) AS t FROM risk_assessments WHERE is_latest AND run_mode = %s", (mode,)).fetchone()["t"],
    }
