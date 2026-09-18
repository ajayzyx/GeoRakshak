from datetime import datetime, timezone

import psycopg
from fastapi import APIRouter, Depends
from psycopg.types.json import Jsonb
from pydantic import BaseModel, Field

from app.db import get_db
from app.errors import ApiError
from app.security import CurrentUser, require_roles
from app.services import replay, roads, scoring, system

router = APIRouter(prefix="/demo", tags=["demo"])


def _demo_only():
    if system.run_mode() != "DEMO_REPLAY":
        raise ApiError(409, "Demo controls are disabled in LIVE mode")


@router.post("/replay/start")
def start(user: CurrentUser = Depends(require_roles("ADMIN")), db: psycopg.Connection = Depends(get_db)):
    _demo_only()
    result = replay.start(db)
    if not result:
        raise ApiError(409, "No rainfall loaded for replay. Load a pilot handoff with rainfall_daily.csv first.")
    return result


class StepIn(BaseModel):
    to_step: int | None = Field(default=None, ge=0)


@router.post("/replay/step")
def step(body: StepIn | None = None, user: CurrentUser = Depends(require_roles("ADMIN")), db: psycopg.Connection = Depends(get_db)):
    _demo_only()
    state = system.get_state(db, "replay")
    if not state:
        raise ApiError(409, "Replay not started")
    target = body.to_step if body and body.to_step is not None else state["step"] + 1
    if target >= state["steps"]:
        raise ApiError(409, f"Replay has steps 0..{state['steps'] - 1}; cannot go to step {target}")
    if target <= state["step"]:
        raise ApiError(409, f"Replay is already at step {state['step']}; reset and start again to go back")
    # Every intermediate monitoring cycle runs, so jumping gives exactly the state that stepping one at a time would.
    result = None
    while state["step"] < target:
        state = {**state, "step": state["step"] + 1}
        result = replay.step(db, state)
        state = {**state, "as_of": result["replay"]["as_of"]}
    return result


class PlaceCitizenIn(BaseModel):
    lat: float = Field(ge=-90, le=90)
    lon: float = Field(ge=-180, le=180)


@router.post("/place-citizen")
def place_citizen(body: PlaceCitizenIn, user: CurrentUser = Depends(require_roles("ADMIN")), db: psycopg.Connection = Depends(get_db)):
    """Move DEMO citizen accounts' registered location, so an approved public WARNING reaches them in the demo.

    Demo accounts only: a real citizen's registered location is their own data and is never moved by a script.
    """
    _demo_only()
    moved = db.execute(
        """UPDATE users SET registered_location = ST_SetSRID(ST_MakePoint(%s, %s), 4326), updated_at = now()
           WHERE role = 'CITIZEN' AND is_demo_account""",
        (body.lon, body.lat),
    ).rowcount
    db.execute("INSERT INTO audit_events (actor_id, action, entity_type, details) VALUES (%s, 'DEMO_CITIZEN_PLACED', 'user', %s)",
               (user.id, Jsonb({"lat": body.lat, "lon": body.lon, "accounts": moved})))
    return {"moved": moved, "lat": body.lat, "lon": body.lon, "provenance": "SIMULATED_DEMO"}


@router.post("/reset")
def reset(user: CurrentUser = Depends(require_roles("ADMIN")), db: psycopg.Connection = Depends(get_db)):
    _demo_only()
    for sql in (
        "DELETE FROM notification_deliveries",
        "DELETE FROM alerts WHERE run_mode = 'DEMO_REPLAY'",
        "UPDATE road_segments SET status = 'OPEN', status_source = 'NONE', status_reason = 'No evidence of blockage', status_report_id = NULL, status_lead_time_h = NULL, status_updated_by = NULL",
        "DELETE FROM evidence WHERE report_id IN (SELECT id FROM reports WHERE provenance = 'SIMULATED_DEMO')",
        "DELETE FROM reports WHERE provenance = 'SIMULATED_DEMO'",
        "DELETE FROM sensor_readings WHERE provenance = 'SIMULATED_DEMO'",
        "DELETE FROM sensor_stations WHERE station_type = 'VIRTUAL'",
        "DELETE FROM rainfall_forecasts",
        "DELETE FROM risk_assessments WHERE run_mode = 'DEMO_REPLAY'",
    ):
        db.execute(sql)
    system.delete_state(db, "replay")
    summary = scoring.score_all(db, "DEMO_REPLAY", datetime.now(timezone.utc))
    # Recompute derived road and village state from the clean baseline so a reset leaves no flags behind.
    road_state = roads.recompute_model_status(db, "DEMO_REPLAY")
    return {"reset": True, "baseline_scoring": summary, "villages_access_at_risk": road_state["villages_access_at_risk"]}
