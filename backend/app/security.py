import hashlib
import hmac
import time
from dataclasses import dataclass
from uuid import UUID

import bcrypt
import jwt
import psycopg
from fastapi import Depends, Header

from app.config import get_settings
from app.db import get_db
from app.errors import ApiError

AUTHORITY_ROLES = ("ADMIN", "STATE_AUTHORITY", "DISTRICT_AUTHORITY")
REPORTER_ROLES = ("FIELD_OFFICER", "CITIZEN")


def hash_secret(secret: str) -> str:
    return bcrypt.hashpw(secret.encode(), bcrypt.gensalt()).decode()


def verify_secret(secret: str, hashed: str) -> bool:
    try:
        return bcrypt.checkpw(secret.encode(), hashed.encode())
    except ValueError:
        return False


def create_token(user_id: UUID, role: str) -> str:
    s = get_settings()
    now = int(time.time())
    return jwt.encode({"sub": str(user_id), "role": role, "iat": now, "exp": now + s.jwt_ttl_s}, s.jwt_secret, "HS256")


@dataclass
class CurrentUser:
    id: UUID
    role: str
    full_name: str
    admin_boundary_id: UUID | None
    preferred_language: str
    is_demo_account: bool

    @property
    def is_authority(self) -> bool:
        return self.role in AUTHORITY_ROLES


def current_user(authorization: str | None = Header(default=None), db: psycopg.Connection = Depends(get_db)) -> CurrentUser:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise ApiError(401, "Missing bearer token")
    try:
        claims = jwt.decode(authorization[7:], get_settings().jwt_secret, algorithms=["HS256"])
    except jwt.PyJWTError:
        raise ApiError(401, "Invalid or expired token")
    row = db.execute(
        "SELECT id, role, full_name, admin_boundary_id, preferred_language, is_demo_account FROM users WHERE id = %s AND is_active",
        (claims["sub"],),
    ).fetchone()
    if not row:
        raise ApiError(401, "User not found or inactive")
    return CurrentUser(**row)


def require_roles(*roles: str):
    def _dep(user: CurrentUser = Depends(current_user)) -> CurrentUser:
        if user.role not in roles:
            raise ApiError(403, f"Role {user.role} may not perform this action")
        return user

    return _dep


def sign_media(media_id: str, expires: int) -> str:
    msg = f"{media_id}:{expires}".encode()
    return hmac.new(get_settings().jwt_secret.encode(), msg, hashlib.sha256).hexdigest()


def check_media_signature(media_id: str, expires: int, signature: str) -> bool:
    return expires >= time.time() and hmac.compare_digest(sign_media(media_id, expires), signature)
