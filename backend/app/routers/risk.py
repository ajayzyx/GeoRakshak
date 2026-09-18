from datetime import timedelta

import psycopg
from fastapi import APIRouter, Depends, Query

from app.db import get_db
from app.errors import ApiError
from app.geo import collection, feature, parse_bbox
from app.routers.system import DISCLAIMER
from app.security import AUTHORITY_ROLES, CurrentUser, current_user, require_roles
from app.services import system

router = APIRouter(tags=["risk"])
SEV = ["LOW", "MODERATE", "HIGH", "VERY_HIGH"]
LEADS = (0, 24, 48, 72)


def _lead(lead_time_h: int) -> int:
    if lead_time_h not in LEADS:
        raise ApiError(422, "lead_time_h must be one of 0, 24, 48, 72")
    return lead_time_h


def _bbox(bbox):
    try:
        return parse_bbox(bbox)
    except ValueError as e:
        raise ApiError(422, str(e))


@router.get("/risk-zones")
def risk_zones(
    bbox: str | None = None, lead_time_h: int = 0, min_severity: str = "LOW",
    user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES, "FIELD_OFFICER")), db: psycopg.Connection = Depends(get_db),
):
    lead, box, mode = _lead(lead_time_h), _bbox(bbox), system.run_mode()
    if min_severity not in SEV:
        raise ApiError(422, "min_severity must be LOW, MODERATE, HIGH or VERY_HIGH")
    where, args = ["ra.is_latest", "ra.lead_time_h = %s", "ra.run_mode = %s", "ra.severity >= %s::severity"], [lead, mode, min_severity]
    if box:
        where.append("rz.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)")
        args += list(box)
    rows = db.execute(
        f"""SELECT rz.id, rz.grid_code, ST_AsGeoJSON(rz.geom, 6) AS g, ra.severity::text AS severity, ra.score, ra.confidence::text AS confidence,
                   ra.issue_time, ra.valid_from, ra.valid_until, ra.input_provenance, mv.version, ds.slug AS fslug, ds.dataset AS flabel,
                   ds.connection_status::text AS fstatus, mv.forecast_skill_evaluated
            FROM risk_zones rz JOIN risk_assessments ra ON ra.risk_zone_id = rz.id JOIN model_versions mv ON mv.id = ra.model_version_id
            LEFT JOIN data_sources ds ON ds.id = ra.forecast_source_id
            WHERE {' AND '.join(where)}""",
        args,
    ).fetchall()
    # Labels come from the assessment run itself, not from the filtered rows: a filter that matches no cell
    # must still say which model and forecast source the view represents.
    first = db.execute(
        """SELECT ra.issue_time, ra.valid_from, ra.valid_until, ra.input_provenance, mv.version, mv.forecast_skill_evaluated,
                  ds.slug AS fslug, ds.dataset AS flabel, ds.connection_status::text AS fstatus
           FROM risk_assessments ra JOIN model_versions mv ON mv.id = ra.model_version_id
           LEFT JOIN data_sources ds ON ds.id = ra.forecast_source_id
           WHERE ra.is_latest AND ra.lead_time_h = %s AND ra.run_mode = %s LIMIT 1""",
        (lead, mode),
    ).fetchone()
    meta = {
        "run_mode": mode, "lead_time_h": lead,
        "issue_time": first["issue_time"] if first else None, "valid_from": first["valid_from"] if first else None,
        "valid_until": first["valid_until"] if first else None, "model_version": first["version"] if first else None,
        "forecast_source": ({"slug": first["fslug"], "label": first["flabel"], "connection_status": first["fstatus"]} if first and first["fslug"] else None),
        "input_provenance": sorted({p for r in rows for p in (r["input_provenance"] or [])} or set((first["input_provenance"] or []) if first else [])),
        "provenance": "MODEL_OUTPUT", "forecast_skill_evaluated": bool(first and first["forecast_skill_evaluated"]), "disclaimer": DISCLAIMER,
    }
    feats = [feature(r["g"], {"grid_code": r["grid_code"], "severity": r["severity"], "score": round(r["score"], 3), "confidence": r["confidence"]}, r["id"]) for r in rows]
    return collection(feats, meta)


def _assessment(db, zone_id, lead: int, mode: str):
    return db.execute(
        """SELECT ra.id, ra.lead_time_h, ra.score, ra.severity::text AS severity, ra.confidence::text AS confidence, mv.version AS model_version,
                  ra.issue_time, ra.valid_from, ra.valid_until, ra.run_mode::text AS run_mode, ra.provenance::text AS provenance,
                  ra.input_provenance, ra.factors, ds.slug AS forecast_source, mv.forecast_skill_evaluated
           FROM risk_assessments ra JOIN model_versions mv ON mv.id = ra.model_version_id LEFT JOIN data_sources ds ON ds.id = ra.forecast_source_id
           WHERE ra.risk_zone_id = %s AND ra.is_latest AND ra.lead_time_h = %s AND ra.run_mode = %s""",
        (zone_id, lead, mode),
    ).fetchone()


@router.get("/risk-zones/{zone_id}")
def risk_zone(zone_id: str, lead_time_h: int = 0, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES, "FIELD_OFFICER")), db: psycopg.Connection = Depends(get_db)):
    lead, mode = _lead(lead_time_h), system.run_mode()
    try:
        zone = db.execute(
            """SELECT rz.id, rz.grid_code, rz.static_features, rz.feature_provenance, ab.id AS ab_id, ab.name AS ab_name
               FROM risk_zones rz LEFT JOIN admin_boundaries ab ON ab.id = rz.admin_boundary_id WHERE rz.id = %s""",
            (zone_id,),
        ).fetchone()
    except psycopg.errors.InvalidTextRepresentation:
        raise ApiError(404, "Risk zone not found")
    if not zone:
        raise ApiError(404, "Risk zone not found")
    exposure = db.execute(
        """SELECT count(*) FILTER (WHERE l.type IN ('VILLAGE', 'TOWN')) AS villages, count(*) FILTER (WHERE l.type = 'SCHOOL') AS schools,
                  count(*) FILTER (WHERE l.type = 'HEALTH_FACILITY') AS health_facilities,
                  count(*) FILTER (WHERE l.type IN ('VILLAGE', 'TOWN') AND l.access_status = 'ACCESS_AT_RISK') AS villages_access_at_risk
           FROM locations l, risk_zones rz WHERE rz.id = %s AND ST_DWithin(l.geom, rz.geom, 0.01) AND ST_DWithin(l.geom::geography, rz.geom::geography, 1000)""",
        (zone_id,),
    ).fetchone()
    roads = db.execute(
        "SELECT count(*) FILTER (WHERE rs.status = 'AT_RISK') AS at_risk, count(*) FILTER (WHERE rs.status = 'BLOCKED') AS blocked FROM road_segments rs, risk_zones rz WHERE rz.id = %s AND ST_Intersects(rs.geom, rz.geom)",
        (zone_id,),
    ).fetchone()
    alerts = db.execute(
        "SELECT id, tier::text AS tier, status::text AS status FROM alerts WHERE %s = ANY(risk_zone_ids) AND status NOT IN ('CLOSED', 'REJECTED') AND run_mode = %s",
        (zone_id, mode),
    ).fetchall()
    return {
        "id": str(zone["id"]), "grid_code": zone["grid_code"],
        "admin_boundary": {"id": str(zone["ab_id"]), "name": zone["ab_name"]} if zone["ab_id"] else None,
        "static_features": zone["static_features"], "feature_provenance": zone["feature_provenance"],
        "assessment": _assessment(db, zone_id, lead, mode),
        "exposure": {**exposure, "road_segments_at_risk": roads["at_risk"], "road_segments_blocked": roads["blocked"]},
        "open_alerts": [{**a, "id": str(a["id"])} for a in alerts],
        "disclaimer": DISCLAIMER,
    }


@router.get("/risk/at")
def risk_at(lat: float = Query(ge=-90, le=90), lon: float = Query(ge=-180, le=180), lead_time_h: int = 0,
            user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    lead, mode = _lead(lead_time_h), system.run_mode()
    zone = db.execute("SELECT id, grid_code FROM risk_zones WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326)) LIMIT 1", (lon, lat)).fetchone()
    if not zone:
        raise ApiError(404, "Location is outside the monitored pilot area")
    a = _assessment(db, zone["id"], lead, mode)
    if not a:
        raise ApiError(404, "No assessment available for this location yet")
    out = {"risk_zone_id": str(zone["id"]), "grid_code": zone["grid_code"], "lead_time_h": lead, "severity": a["severity"], "issue_time": a["issue_time"],
           "run_mode": mode, "provenance": "MODEL_OUTPUT", "disclaimer": DISCLAIMER}
    if user.role != "CITIZEN":
        out.update({"score": a["score"], "confidence": a["confidence"], "model_version": a["model_version"], "factors": a["factors"]})
    return out


@router.get("/risk-zones/{zone_id}/rainfall")
def rainfall(zone_id: str, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES, "FIELD_OFFICER")), db: psycopg.Connection = Depends(get_db)):
    mode = system.run_mode()
    state = system.get_state(db, "replay") if mode == "DEMO_REPLAY" else None
    as_of = state["as_of"] if state and state.get("as_of") else None
    obs = db.execute(
        """SELECT ro.period_start, ro.period_end, ro.rainfall_mm, ro.provenance::text AS provenance, ds.slug AS source
           FROM rainfall_observations ro JOIN data_sources ds ON ds.id = ro.source_id
           WHERE ro.risk_zone_id = %s AND (%s::timestamptz IS NULL OR (ro.period_end <= %s::timestamptz AND ro.period_start >= %s::timestamptz - interval '30 days'))
           ORDER BY ro.period_start""",
        (zone_id, as_of, as_of, as_of),
    ).fetchall()
    fc = db.execute(
        """SELECT rf.issue_time, rf.valid_start, rf.valid_end, rf.lead_time_h, rf.rainfall_mm, rf.provenance::text AS provenance, ds.slug AS source
           FROM rainfall_forecasts rf JOIN data_sources ds ON ds.id = rf.source_id
           WHERE rf.risk_zone_id = %s AND rf.issue_time = (SELECT max(issue_time) FROM rainfall_forecasts WHERE risk_zone_id = %s)
           ORDER BY rf.lead_time_h""",
        (zone_id, zone_id),
    ).fetchall()
    return {"risk_zone_id": zone_id, "run_mode": mode, "as_of": as_of, "observed": obs, "forecast": fc}


@router.get("/models/active")
def active_model(user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    row = db.execute(
        "SELECT version, model_type, stage, feature_config, thresholds, validation_scheme, metrics, forecast_skill_evaluated, model_card_uri, registered_at FROM model_versions WHERE is_active LIMIT 1"
    ).fetchone()
    if not row:
        raise ApiError(404, "No active model registered yet")
    return row
