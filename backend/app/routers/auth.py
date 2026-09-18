from typing import Literal

import psycopg
from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError
from app.security import CurrentUser, create_token, current_user, require_roles, verify_secret

router = APIRouter(tags=["auth"])

USER_COLS = "id, full_name, email, role::text AS role, preferred_language, admin_boundary_id, is_demo_account"


def _user_json(row: dict) -> dict:
    return {**row, "id": str(row["id"]), "admin_boundary_id": str(row["admin_boundary_id"]) if row["admin_boundary_id"] else None}


class LoginIn(BaseModel):
    email: str
    password: str


@router.post("/auth/login")
def login(body: LoginIn, db: psycopg.Connection = Depends(get_db)):
    row = db.execute(f"SELECT {USER_COLS}, password_hash, is_active FROM users WHERE lower(email) = lower(%s)", (body.email,)).fetchone()
    if not row or not row["is_active"] or not verify_secret(body.password, row["password_hash"]):
        raise ApiError(401, "Invalid email or password")
    user = {k: v for k, v in row.items() if k not in ("password_hash", "is_active")}
    return {"access_token": create_token(row["id"], row["role"]), "token_type": "bearer", "expires_in": get_settings().jwt_ttl_s, "user": _user_json(user)}


@router.get("/me")
def me(user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    return _user_json(db.execute(f"SELECT {USER_COLS} FROM users WHERE id = %s", (user.id,)).fetchone())


class MePatch(BaseModel):
    preferred_language: str | None = Field(default=None, min_length=2, max_length=16)
    sms_enabled: bool | None = None


@router.patch("/me")
def patch_me(body: MePatch, user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    db.execute(
        "UPDATE users SET preferred_language = COALESCE(%s, preferred_language), sms_enabled = COALESCE(%s, sms_enabled), updated_at = now() WHERE id = %s",
        (body.preferred_language, body.sms_enabled, user.id),
    )
    return _user_json(db.execute(f"SELECT {USER_COLS} FROM users WHERE id = %s", (user.id,)).fetchone())


class DeviceIn(BaseModel):
    platform: Literal["ANDROID", "IOS"]
    push_token: str = Field(min_length=10)
    app_version: str | None = None


@router.post("/me/devices", status_code=201)
def register_device(body: DeviceIn, user: CurrentUser = Depends(require_roles("FIELD_OFFICER", "CITIZEN")), db: psycopg.Connection = Depends(get_db)):
    row = db.execute(
        """INSERT INTO user_devices (user_id, platform, push_token, app_version) VALUES (%s, %s, %s, %s)
           ON CONFLICT (user_id, push_token) DO UPDATE SET last_seen_at = now(), app_version = EXCLUDED.app_version RETURNING id""",
        (user.id, body.platform, body.push_token, body.app_version),
    ).fetchone()
    return {"id": str(row["id"]), "push_channel_status": "NOT_CONNECTED", "note": "Token stored. FCM isn't configured yet, so no push is sent."}


@router.delete("/me/devices/{device_id}", status_code=204)
def delete_device(device_id: str, user: CurrentUser = Depends(current_user), db: psycopg.Connection = Depends(get_db)):
    if not db.execute("DELETE FROM user_devices WHERE id = %s AND user_id = %s", (device_id, user.id)).rowcount:
        raise ApiError(404, "Device not found")
