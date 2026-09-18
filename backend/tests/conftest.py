import os
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path

os.environ["DATABASE_URL"] = os.environ.get("TEST_DATABASE_URL", "postgresql://localhost:5432/georakshak_test")
os.environ["MEDIA_DIR"] = tempfile.mkdtemp(prefix="georakshak-media-")
os.environ["RUN_MODE"] = "DEMO_REPLAY"
os.environ["JWT_SECRET"] = "test-secret"
os.environ["DEMO_USER_PASSWORD"] = "test-password"

import psycopg  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from psycopg.rows import dict_row  # noqa: E402

from app.config import get_settings  # noqa: E402
from app.main import create_app  # noqa: E402
from app.services import roads, scoring  # noqa: E402
from scripts.load_pilot import load  # noqa: E402
from scripts.migrate import migrate  # noqa: E402
from scripts.make_mock_pilot import build  # noqa: E402
from scripts.seed import seed  # noqa: E402

DB = os.environ["DATABASE_URL"]
FIXTURE = Path(__file__).parent / "fixtures" / "mock-area"


def reset_database() -> None:
    with psycopg.connect(DB, autocommit=True) as conn:
        conn.execute("DROP SCHEMA public CASCADE; CREATE SCHEMA public;")
    migrate(DB)
    if not (FIXTURE / "manifest.json").exists():
        build(FIXTURE)
    load(FIXTURE, DB)
    seed(DB)
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        scoring.score_all(conn, "DEMO_REPLAY", datetime.now(timezone.utc))
        roads.recompute_model_status(conn, "DEMO_REPLAY")


@pytest.fixture(scope="module")
def client():
    reset_database()
    with TestClient(create_app()) as c:
        yield c


@pytest.fixture
def db():
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        yield conn


def login(client, email: str) -> dict:
    r = client.post("/api/v1/auth/login", json={"email": email, "password": get_settings().demo_user_password})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


@pytest.fixture
def admin(client):
    return login(client, "admin.demo@example.org")


@pytest.fixture
def authority(client):
    return login(client, "authority.demo@example.org")


@pytest.fixture
def officer(client):
    return login(client, "officer.demo@example.org")


@pytest.fixture
def citizen(client):
    return login(client, "citizen.demo@example.org")


def report_body(**overrides) -> dict:
    body = {
        "client_report_id": str(uuid.uuid4()), "category": "ROAD_BLOCKED", "severity": "HIGH", "description": "test",
        "location": {"type": "Point", "coordinates": [0.0135, 0.0137]}, "gps_accuracy_m": 8, "captured_at": "2026-09-17T12:00:00+05:30",
        "media_expected": 1,
    }
    body.update(overrides)
    return body


PNG_1PX = bytes.fromhex(
    "89504e470d0a1a0a0000000d4948445200000001000000010802000000907753de0000000c4944415478da63f8ffff3f0005fe02fea7d6a4b40000000049454e44ae426082"
)
