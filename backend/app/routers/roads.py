from datetime import datetime, timezone
from typing import Literal

import psycopg
from fastapi import APIRouter, Depends
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.db import get_db
from app.errors import ApiError
from app.geo import collection, feature, parse_bbox
from app.security import AUTHORITY_ROLES, CurrentUser, require_roles
from app.services import roads, system

router = APIRouter(tags=["roads"])
SEMANTICS = "OPEN means no evidence of blockage, not confirmed passable"


def _segment_props(r: dict) -> dict:
    return {
        "osm_way_id": r["osm_way_id"], "name": r["name"], "road_class": r["road_class"], "status": r["status"], "status_source": r["status_source"],
        "status_reason": r["status_reason"], "status_report_id": str(r["status_report_id"]) if r["status_report_id"] else None,
        "status_updated_at": r["status_updated_at"], "provenance": r["provenance"],
        "villages_access_at_risk": r.get("villages_access_at_risk"),
    }


SEGMENT_SQL = f"""SELECT rs.id, ST_AsGeoJSON(rs.geom, 6) AS g, rs.osm_way_id, rs.name, rs.road_class, rs.status::text AS status,
                        rs.status_source::text AS status_source, rs.status_reason, rs.status_report_id, rs.status_updated_at, rs.provenance::text AS provenance,
                        (SELECT count(*) FROM locations l WHERE l.type IN ('VILLAGE', 'TOWN') AND l.access_status = 'ACCESS_AT_RISK'
                           AND ST_DWithin(l.geom, rs.geom, 0.02)
                           AND ST_DWithin(l.geom::geography, rs.geom::geography, {roads.VILLAGE_ACCESS_RADIUS_M})) AS villages_access_at_risk
                 FROM road_segments rs"""


@router.get("/road-segments")
def segments(bbox: str | None = None, status: str | None = None, lead_time_h: int = 0,
             user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES, "FIELD_OFFICER")), db: psycopg.Connection = Depends(get_db)):
    where, args = ["true"], []
    try:
        box = parse_bbox(bbox)
    except ValueError as e:
        raise ApiError(422, str(e))
    if box:
        where.append("rs.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)")
        args += list(box)
    if status:
        where.append("rs.status::text = ANY(%s)")
        args.append(status.split(","))
    rows = db.execute(f"{SEGMENT_SQL} WHERE {' AND '.join(where)}", args).fetchall()
    attribution = db.execute("SELECT string_agg(DISTINCT ds.attribution_text, '; ') AS a FROM road_segments rs JOIN data_sources ds ON ds.id = rs.source_id").fetchone()["a"]
    return collection([feature(r["g"], _segment_props(r), r["id"]) for r in rows],
                      {"status_semantics": SEMANTICS, "attribution": attribution, "lead_time_h": lead_time_h,
                       "run_mode": system.run_mode(), "provenance": "MODEL_OUTPUT"})


class OverrideIn(BaseModel):
    status: Literal["OPEN", "AT_RISK", "BLOCKED", "UNKNOWN"]
    reason: str = Field(min_length=3)


@router.post("/road-segments/{segment_id}/status-override")
def override(segment_id: str, body: OverrideIn, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    try:
        before = db.execute(f"{SEGMENT_SQL} WHERE rs.id = %s", (segment_id,)).fetchone()
    except psycopg.errors.InvalidTextRepresentation:
        before = None
    if not before:
        raise ApiError(404, "Road segment not found")
    db.execute(
        """UPDATE road_segments SET status = %s, status_source = 'AUTHORITY_OVERRIDE', status_reason = %s, status_updated_by = %s,
               status_updated_at = %s WHERE id = %s""",
        (body.status, body.reason, user.id, datetime.now(timezone.utc), segment_id),
    )
    roads.recompute_village_access(db)
    db.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details) VALUES (%s, 'ROAD_STATUS_OVERRIDDEN', 'road_segment', %s, %s)",
        (user.id, segment_id, Jsonb({"from": before["status"], "to": body.status, "reason": body.reason})),
    )
    r = db.execute(f"{SEGMENT_SQL} WHERE rs.id = %s", (segment_id,)).fetchone()
    return feature(r["g"], _segment_props(r), r["id"])
