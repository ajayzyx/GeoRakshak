import time
from datetime import datetime
from typing import Literal
from uuid import UUID

import psycopg
from fastapi import APIRouter, Depends, File, Form, Query, UploadFile
from fastapi.responses import FileResponse, JSONResponse
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field, field_validator

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.security import AUTHORITY_ROLES, REPORTER_ROLES, CurrentUser, check_media_signature, current_user, require_roles, sign_media
from app.services import alerts, roads, storage, system

router = APIRouter(tags=["reports"])

Category = Literal["LANDSLIDE", "CRACK", "SEEPAGE", "ROCKFALL", "ROAD_BLOCKED", "SUBSIDENCE", "OTHER"]
PHOTO_TYPES = {"image/jpeg": ".jpg", "image/png": ".png"}
VIDEO_TYPES = {"video/mp4": ".mp4"}
PHOTO_MAX, VIDEO_MAX, VIDEO_MAX_S = 10 * 1024 * 1024, 25 * 1024 * 1024, 30
BLOCKING_CATEGORIES = ("ROAD_BLOCKED", "LANDSLIDE")


class PointIn(BaseModel):
    type: Literal["Point"]
    coordinates: list[float] = Field(min_length=2, max_length=2)

    @field_validator("coordinates")
    @classmethod
    def _range(cls, v):
        if not (-180 <= v[0] <= 180 and -90 <= v[1] <= 90):
            raise ValueError("coordinates must be [lon, lat] in range")
        return v


class ReportIn(BaseModel):
    client_report_id: UUID
    alert_id: UUID | None = None
    category: Category
    severity: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    description: str = Field(default="", max_length=4000)
    language: str = "en"
    location: PointIn
    gps_accuracy_m: float = Field(gt=0)
    location_adjusted_manually: bool = False
    captured_at: datetime
    media_expected: int = Field(default=0, ge=0, le=10)
    device_info: dict = {}


REPORT_SQL = """SELECT r.id, r.client_report_id, r.reporter_role::text AS reporter_role, u.full_name AS reporter_name, r.category::text AS category,
       r.severity::text AS severity, r.description, r.language, ST_AsGeoJSON(r.geom, 6)::json AS location, r.gps_accuracy_m,
       r.location_adjusted_manually, r.captured_at, r.submitted_at, r.verification_status::text AS verification_status,
       r.verified_by, r.verified_at, r.verification_note, r.risk_zone_id, r.road_segment_id, r.alert_id, r.media_expected,
       r.provenance::text AS provenance, r.reporter_id,
       COALESCE((SELECT json_agg(json_build_object('id', e.id, 'media_type', e.media_type, 'upload_status', e.upload_status) ORDER BY e.created_at)
                 FROM evidence e WHERE e.report_id = r.id), '[]'::json) AS media
FROM reports r JOIN users u ON u.id = r.reporter_id"""


def _out(row: dict) -> dict:
    row = dict(row)
    row.pop("reporter_id", None)
    for k in ("id", "client_report_id", "verified_by", "risk_zone_id", "road_segment_id", "alert_id"):
        row[k] = str(row[k]) if row[k] else None
    return row


def _get(db, report_id):
    try:
        return db.execute(f"{REPORT_SQL} WHERE r.id = %s AND r.deleted_at IS NULL", (str(report_id),)).fetchone()
    except psycopg.errors.InvalidTextRepresentation:
        return None


def _create(db, body: ReportIn, user: CurrentUser) -> tuple[dict, bool]:
    existing = db.execute("SELECT id, reporter_id FROM reports WHERE client_report_id = %s", (body.client_report_id,)).fetchone()
    if existing:
        if existing["reporter_id"] != user.id:
            raise ApiError(409, "client_report_id already used by another reporter")
        return _get(db, existing["id"]), False
    if body.alert_id and not db.execute("SELECT 1 FROM alerts WHERE id = %s", (body.alert_id,)).fetchone():
        raise ApiError(422, "alert_id does not exist", [{"field": "alert_id", "issue": "unknown alert"}])
    lon, lat = body.location.coordinates
    zone = db.execute("SELECT id FROM risk_zones WHERE ST_Contains(geom, ST_SetSRID(ST_MakePoint(%s, %s), 4326)) LIMIT 1", (lon, lat)).fetchone()
    row = db.execute(
        """INSERT INTO reports (client_report_id, reporter_id, reporter_role, alert_id, category, severity, description, language, geom,
               gps_accuracy_m, location_adjusted_manually, captured_at, risk_zone_id, road_segment_id, media_expected, device_info, provenance)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, ST_SetSRID(ST_MakePoint(%s, %s), 4326), %s, %s, %s, %s, %s, %s, %s, %s)
           ON CONFLICT (client_report_id) DO NOTHING RETURNING id""",
        (body.client_report_id, user.id, user.role, body.alert_id, body.category, body.severity, body.description, body.language, lon, lat,
         body.gps_accuracy_m, body.location_adjusted_manually, body.captured_at, zone["id"] if zone else None,
         roads.nearest_segment(db, lon, lat), body.media_expected, Jsonb(body.device_info),
         "SIMULATED_DEMO" if user.is_demo_account else "REAL_LIVE"),
    ).fetchone()
    if not row:  # concurrent duplicate
        return _get(db, db.execute("SELECT id FROM reports WHERE client_report_id = %s", (body.client_report_id,)).fetchone()["id"]), False
    return _get(db, row["id"]), True


def _response(report: dict) -> dict:
    out = _out(report)
    received = sum(1 for m in out["media"] if m["upload_status"] == "UPLOADED")
    return {**out, "media_summary": {"expected": out["media_expected"], "received": received}}


@router.post("/reports")
def create_report(body: ReportIn, user: CurrentUser = Depends(require_roles(*REPORTER_ROLES)), db: psycopg.Connection = Depends(get_db)):
    report, created = _create(db, body, user)
    return JSONResponse(status_code=201 if created else 200, content=_jsonable(_response(report)))


class SyncIn(BaseModel):
    reports: list[dict] = Field(max_length=100)


@router.post("/reports/sync")
def sync_reports(body: SyncIn, user: CurrentUser = Depends(require_roles(*REPORTER_ROLES)), db: psycopg.Connection = Depends(get_db)):
    results = []
    for raw in body.reports:
        cid = raw.get("client_report_id")
        try:
            parsed = ReportIn.model_validate(raw)
        except Exception as e:  # pydantic.ValidationError
            results.append({"client_report_id": cid, "status": "REJECTED", "error": {"code": "VALIDATION_ERROR", "message": str(e).splitlines()[0]}})
            continue
        try:
            with db.transaction():
                report, created = _create(db, parsed, user)
            results.append({"client_report_id": str(parsed.client_report_id), "status": "CREATED" if created else "DUPLICATE", "id": str(report["id"])})
        except ApiError as e:
            results.append({"client_report_id": cid, "status": "REJECTED", "error": {"code": e.code, "message": e.message}})
    return {"results": results}


@router.get("/reports")
def list_reports(bbox: str | None = None, reporter_role: str | None = None, verification_status: str | None = None, limit: int = Query(100, le=500),
                 user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    where, args = ["r.deleted_at IS NULL"], []
    if not user.is_authority:
        where.append("r.reporter_id = %s")
        args.append(user.id)
    if bbox:
        parts = [float(p) for p in bbox.split(",")]
        where.append("r.geom && ST_MakeEnvelope(%s, %s, %s, %s, 4326)")
        args += parts
    if reporter_role:
        where.append("r.reporter_role::text = ANY(%s)")
        args.append(reporter_role.split(","))
    if verification_status:
        where.append("r.verification_status::text = ANY(%s)")
        args.append(verification_status.split(","))
    rows = db.execute(f"{REPORT_SQL} WHERE {' AND '.join(where)} ORDER BY r.submitted_at DESC LIMIT %s", [*args, limit]).fetchall()
    return {"items": [_out(r) for r in rows], "next_cursor": None}


@router.get("/reports/{report_id}")
def get_report(report_id: str, user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    r = _get(db, report_id)
    if not r or (not user.is_authority and r["reporter_id"] != user.id):
        raise ApiError(404, "Report not found")
    return _out(r)


@router.post("/reports/{report_id}/media")
def upload_media(
    report_id: str, client_media_id: UUID = Form(...), media_type: Literal["PHOTO", "VIDEO"] = Form(...), captured_at: datetime | None = Form(None),
    lat: float | None = Form(None), lon: float | None = Form(None), duration_s: float | None = Form(None), file: UploadFile = File(...),
    user: CurrentUser = Depends(require_roles(*REPORTER_ROLES)), db: psycopg.Connection = Depends(get_db),
):
    report = _get(db, report_id)
    if not report or report["reporter_id"] != user.id:
        raise ApiError(404, "Report not found")
    existing = db.execute("SELECT * FROM evidence WHERE client_media_id = %s", (client_media_id,)).fetchone()
    if existing:
        if existing["report_id"] != report["id"]:
            raise ApiError(409, "client_media_id already used for another report")
        return JSONResponse(status_code=200, content=_jsonable(_media_out(existing)))
    allowed = PHOTO_TYPES if media_type == "PHOTO" else VIDEO_TYPES
    mime = (file.content_type or "").lower()
    if mime not in allowed:
        raise ApiError(422, f"{media_type} must be one of {sorted(allowed)}", [{"field": "file", "issue": f"unsupported type {mime}"}])
    if media_type == "VIDEO" and duration_s is not None and duration_s > VIDEO_MAX_S:
        raise ApiError(422, f"Video must be {VIDEO_MAX_S} s or shorter", [{"field": "duration_s", "issue": "too long"}])
    try:
        key, size, sha = storage.save_stream(file.file, allowed[mime], PHOTO_MAX if media_type == "PHOTO" else VIDEO_MAX)
    except storage.TooLarge:
        raise ApiError(413, f"{media_type} exceeds the size limit")
    row = db.execute(
        """INSERT INTO evidence (report_id, client_media_id, media_type, mime_type, storage_key, size_bytes, sha256, duration_s, geom, captured_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, CASE WHEN %s::float IS NULL OR %s::float IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint(%s, %s), 4326) END, %s)
           RETURNING *""",
        (report["id"], client_media_id, media_type, mime, key, size, sha, duration_s, lon, lat, lon, lat, captured_at),
    ).fetchone()
    return JSONResponse(status_code=201, content=_jsonable(_media_out(row)))


def _media_out(row: dict) -> dict:
    return {"id": str(row["id"]), "client_media_id": str(row["client_media_id"]), "media_type": row["media_type"], "mime_type": row["mime_type"],
            "size_bytes": row["size_bytes"], "duration_s": row["duration_s"], "sha256": row["sha256"], "upload_status": row["upload_status"]}


@router.get("/media/{media_id}")
def media_url(media_id: str, user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    try:
        row = db.execute("SELECT e.id, e.media_type::text AS media_type, e.mime_type, r.reporter_id FROM evidence e JOIN reports r ON r.id = e.report_id WHERE e.id = %s", (media_id,)).fetchone()
    except psycopg.errors.InvalidTextRepresentation:
        row = None
    if not row or (not user.is_authority and row["reporter_id"] != user.id):
        raise ApiError(404, "Media not found")
    s = get_settings()
    expires = int(time.time()) + s.media_url_ttl_s
    url = f"{s.public_base_url}/api/v1/media/{media_id}/content?expires={expires}&sig={sign_media(media_id, expires)}"
    return {"id": media_id, "media_type": row["media_type"], "mime_type": row["mime_type"], "url": url,
            "expires_at": datetime.fromtimestamp(expires).astimezone().isoformat()}


@router.get("/media/{media_id}/content")
def media_content(media_id: str, expires: int, sig: str, db: psycopg.Connection = Depends(get_db)):
    if not check_media_signature(media_id, expires, sig):
        raise ApiError(403, "Invalid or expired media link")
    row = db.execute("SELECT storage_key, mime_type FROM evidence WHERE id = %s", (media_id,)).fetchone()
    if not row:
        raise ApiError(404, "Media not found")
    return FileResponse(storage.path_for(row["storage_key"]), media_type=row["mime_type"])


class VerifyIn(BaseModel):
    decision: Literal["VERIFIED", "REJECTED"]
    note: str = ""


@router.post("/reports/{report_id}/verify")
def verify(report_id: str, body: VerifyIn, user: CurrentUser = Depends(require_roles(*AUTHORITY_ROLES)), db: psycopg.Connection = Depends(get_db)):
    report = _get(db, report_id)
    if not report:
        raise ApiError(404, "Report not found")
    db.execute(
        "UPDATE reports SET verification_status = %s, verified_by = %s, verified_at = now(), verification_note = %s WHERE id = %s",
        (body.decision, user.id, body.note, report["id"]),
    )
    effects: dict = {"road_segment": None, "villages_access_at_risk": None, "priority_recomputed": False, "alerts": None}
    if body.decision == "VERIFIED":
        if report["category"] in BLOCKING_CATEGORIES and report["road_segment_id"]:
            roads.block_from_report(db, report["road_segment_id"], report["id"], f"Verified report: {report['category'].replace('_', ' ').lower()}")
            effects["road_segment"] = {"id": str(report["road_segment_id"]), "status": "BLOCKED"}
        effects["villages_access_at_risk"] = roads.recompute_village_access(db)["villages_access_at_risk"]
        effects["alerts"] = alerts.evaluate(db, system.run_mode())
        effects["priority_recomputed"] = True
    db.execute(
        "INSERT INTO audit_events (actor_id, action, entity_type, entity_id, details) VALUES (%s, 'REPORT_VERIFIED', 'report', %s, %s)",
        (user.id, report["id"], Jsonb({"decision": body.decision, "note": body.note})),
    )
    return {"id": str(report["id"]), "verification_status": body.decision, "effects": effects}


def _jsonable(obj):
    from fastapi.encoders import jsonable_encoder

    return jsonable_encoder(obj)
