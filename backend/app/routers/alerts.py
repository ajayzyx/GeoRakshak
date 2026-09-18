from datetime import datetime
from typing import Literal

import psycopg
from fastapi import APIRouter, Depends
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.db import get_db
from app.errors import ApiError
from app.security import AUTHORITY_ROLES, REPORTER_ROLES, CurrentUser, require_roles
from app.services import alerts as alert_service
from app.services import system, templates

router = APIRouter(tags=["alerts"])

ALERT_SQL = """SELECT a.id, a.tier::text AS tier, a.status::text AS status, a.trigger_type, a.severity::text AS severity, a.lead_time_h,
       a.risk_zone_ids, a.admin_boundary_id, a.triggering_assessment_id, a.explanation_snapshot, a.messages, a.languages, a.recommended_actions,
       a.valid_until, a.created_at, a.dispatched_at, a.approved_at, a.closed_at, a.closed_reason, a.related_alert_id,
       a.run_mode::text AS run_mode, a.provenance::text AS provenance, a.is_demo,
       CASE WHEN u.id IS NULL THEN NULL ELSE json_build_object('id', u.id, 'full_name', u.full_name) END AS approved_by,
       (SELECT count(*) FROM risk_assessments ra WHERE ra.risk_zone_id = ANY(a.risk_zone_ids) AND ra.is_latest AND ra.lead_time_h = 0
          AND ra.run_mode = a.run_mode AND ra.severity IN ('HIGH', 'VERY_HIGH')) AS zones_currently_high
FROM alerts a LEFT JOIN users u ON u.id = a.approved_by"""


def _get(db, alert_id):
    try:
        return db.execute(f"{ALERT_SQL} WHERE a.id = %s", (alert_id,)).fetchone()
    except psycopg.errors.InvalidTextRepresentation:
        return None


def _require(db, alert_id) -> dict:
    a = _get(db, alert_id)
    if not a:
        raise ApiError(404, "Alert not found")
    return a


@router.get("/alerts")
def list_alerts(tier: str | None = None, status: str | None = None, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    where, args = ["a.run_mode = %s"], [system.run_mode()]
    if tier:
        where.append("a.tier::text = ANY(%s)")
        args.append(tier.split(","))
    if status:
        where.append("a.status::text = ANY(%s)")
        args.append(status.split(","))
    return {"items": db.execute(f"{ALERT_SQL} WHERE {' AND '.join(where)} ORDER BY a.created_at DESC LIMIT 200", args).fetchall()}


@router.get("/alerts/{alert_id}")
def get_alert(alert_id: str, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    return _require(db, alert_id)


class ManualAlertIn(BaseModel):
    tier: Literal["WARNING", "UPDATE"]
    risk_zone_ids: list[str] = Field(default_factory=list)
    related_alert_id: str | None = None
    severity: Literal["HIGH", "VERY_HIGH"] = "HIGH"
    recommended_actions: str = ""


@router.post("/alerts", status_code=201)
def create_manual(body: ManualAlertIn, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    zone_ids = body.risk_zone_ids
    if body.tier == "UPDATE":
        related = _get(db, body.related_alert_id) if body.related_alert_id else None
        if not related or related["tier"] not in ("WARNING", "UPDATE") or related["status"] not in ("DISPATCHED", "CLOSED"):
            raise ApiError(422, "An UPDATE must reference a dispatched public WARNING or UPDATE", [{"field": "related_alert_id", "issue": "required"}])
        zone_ids = zone_ids or [str(z) for z in related["risk_zone_ids"]]
        if not body.recommended_actions.strip():
            raise ApiError(422, "An UPDATE needs its message text", [{"field": "recommended_actions", "issue": "required"}])
    elif body.related_alert_id:
        raise ApiError(422, "related_alert_id is only used for UPDATE", [{"field": "related_alert_id", "issue": "not allowed"}])
    if not zone_ids:
        raise ApiError(422, "risk_zone_ids is required", [{"field": "risk_zone_ids", "issue": "required"}])
    try:
        n = db.execute("SELECT count(*) AS n FROM risk_zones WHERE id::text = ANY(%s)", (zone_ids,)).fetchone()["n"]
    except psycopg.errors.InvalidTextRepresentation:
        n = -1
    if n != len(set(zone_ids)):
        raise ApiError(422, "Unknown risk_zone_ids")
    msgs = templates.render(body.tier, alert_service.DRAFT_LANGUAGES, severity=body.severity.replace("_", " ").title(), n=n, reason="",
                            actions=body.recommended_actions, lead=0)
    row = db.execute(
        """INSERT INTO alerts (tier, status, severity, trigger_type, area_geom, risk_zone_ids, admin_boundary_id, messages, languages,
               recommended_actions, run_mode, is_demo, related_alert_id)
           SELECT %s, 'DRAFT', %s, 'MANUAL', ST_Multi(ST_Collect(geom)), array_agg(id), min(admin_boundary_id::text)::uuid, %s, %s, %s, %s, %s, %s
           FROM risk_zones WHERE id::text = ANY(%s) RETURNING id""",
        (body.tier, body.severity, Jsonb(msgs), alert_service.DRAFT_LANGUAGES, body.recommended_actions, system.run_mode(), user.is_demo_account,
         body.related_alert_id, zone_ids),
    ).fetchone()
    return _get(db, row["id"])


def _check_languages(languages: list[str] | None) -> None:
    # Fail visibly: a language without a template would otherwise be dropped from the dispatched warning.
    if languages is None:
        return
    unsupported = sorted(set(languages) - set(templates.SUPPORTED_LANGUAGES))
    if not languages or unsupported:
        raise ApiError(422, "Unsupported notification language", {"unsupported": unsupported, "supported": list(templates.SUPPORTED_LANGUAGES)})


class AlertPatch(BaseModel):
    recommended_actions: str | None = None
    languages: list[str] | None = None
    valid_until: datetime | None = None


@router.patch("/alerts/{alert_id}")
def patch_alert(alert_id: str, body: AlertPatch, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    a = _require(db, alert_id)
    if a["status"] != "DRAFT":
        raise ApiError(409, "Only DRAFT alerts can be edited")
    _check_languages(body.languages)
    db.execute(
        "UPDATE alerts SET recommended_actions = COALESCE(%s, recommended_actions), languages = COALESCE(%s, languages), valid_until = COALESCE(%s, valid_until) WHERE id = %s",
        (body.recommended_actions, body.languages, body.valid_until, alert_id),
    )
    return _get(db, alert_id)


class ApproveIn(BaseModel):
    languages: list[str] = ["en"]
    channels: list[Literal["APP_PUSH", "APP_INBOX", "SMS"]] = ["APP_PUSH", "APP_INBOX", "SMS"]
    recommended_actions: str | None = None
    valid_until: datetime | None = None


@router.post("/alerts/{alert_id}/approve")
def approve(alert_id: str, body: ApproveIn, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    a = _require(db, alert_id)
    if a["tier"] == "WATCH":
        raise ApiError(409, "WATCH alerts are dispatched automatically and cannot be approved")
    if a["status"] != "DRAFT":
        raise ApiError(409, f"Alert is {a['status']}, not DRAFT")
    _check_languages(body.languages)
    raw = db.execute("SELECT * FROM alerts WHERE id = %s", (alert_id,)).fetchone()
    result = alert_service.approve(db, raw, user.id, body.languages, list(body.channels), body.recommended_actions, body.valid_until)
    return {**_get(db, alert_id), "delivery_summary": result["delivery_summary"]}


class NoteIn(BaseModel):
    note: str = Field(default="", max_length=1000)


def _transition(db, alert_id: str, user: CurrentUser, allowed_from: tuple, to: str, action: str, note: str):
    a = _require(db, alert_id)
    if a["status"] not in allowed_from:
        raise ApiError(409, f"Alert is {a['status']}; cannot move to {to}")
    if to == "CLOSED":
        db.execute("UPDATE alerts SET status = 'CLOSED', closed_at = now(), closed_reason = %s WHERE id = %s",
                   (f"Authority: {note}" if note else "Authority action", alert_id))
    else:
        db.execute("UPDATE alerts SET status = %s WHERE id = %s", (to, alert_id))
    db.execute("INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details) VALUES (%s, %s, 'alert', %s, %s)",
               (user.id, action, alert_id, Jsonb({"note": note})))
    return _get(db, alert_id)


@router.post("/alerts/{alert_id}/reject")
def reject(alert_id: str, body: NoteIn | None = None, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    return _transition(db, alert_id, user, ("DRAFT",), "REJECTED", "ALERT_REJECTED", (body or NoteIn()).note.strip())


@router.post("/alerts/{alert_id}/close")
def close(alert_id: str, body: NoteIn | None = None, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    return _transition(db, alert_id, user, ("AUTO_DISPATCHED", "APPROVED", "DISPATCHED"), "CLOSED", "ALERT_CLOSED", (body or NoteIn()).note.strip())


@router.get("/alerts/{alert_id}/deliveries")
def deliveries(alert_id: str, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    _require(db, alert_id)
    rows = db.execute(
        """SELECT d.id, u.full_name AS recipient, u.role::text AS recipient_role, d.channel::text AS channel, d.channel_mode::text AS channel_mode, d.language,
                  d.destination_masked, d.status::text AS status, d.rendered_text, d.error, d.queued_at, d.sent_at, d.acknowledged_at,
                  d.sms_encoding, d.sms_segments
           FROM notification_deliveries d JOIN users u ON u.id = d.recipient_id WHERE d.alert_id = %s ORDER BY d.queued_at, d.channel""",
        (alert_id,),
    ).fetchall()
    return {"items": rows}


@router.get("/me/inbox")
def inbox(user: CurrentUser = Depends(require_roles(*REPORTER_ROLES, *AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    rows = db.execute(
        """SELECT a.id AS alert_id, a.tier::text AS tier, a.severity::text AS severity, a.messages, d.language, a.dispatched_at, d.acknowledged_at,
                  a.risk_zone_ids, a.lead_time_h, a.is_demo, a.status::text AS status, a.recommended_actions
           FROM notification_deliveries d JOIN alerts a ON a.id = d.alert_id
           WHERE d.recipient_id = %s AND d.channel = 'APP_INBOX' ORDER BY a.dispatched_at DESC NULLS LAST LIMIT 100""",
        (user.id,),
    ).fetchall()
    items = []
    for r in rows:
        msg = (r.pop("messages") or {}).get(r["language"]) or {}
        items.append({**r, "title": msg.get("title", ""), "body": msg.get("body", ""), "review_status": msg.get("review_status")})
    return {"items": items}


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge(alert_id: str, user: CurrentUser = Depends(require_roles(*REPORTER_ROLES, *AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    try:
        row = db.execute(
            """UPDATE notification_deliveries SET status = 'ACKNOWLEDGED', acknowledged_at = COALESCE(acknowledged_at, now())
               WHERE alert_id = %s AND recipient_id = %s AND channel = 'APP_INBOX' RETURNING acknowledged_at""",
            (alert_id, user.id),
        ).fetchone()
    except psycopg.errors.InvalidTextRepresentation:
        row = None
    if not row:
        raise ApiError(404, "No delivery of this alert to you")
    return {"alert_id": alert_id, "acknowledged_at": row["acknowledged_at"]}
