"""DEMO_REPLAY: step through a rainfall period loaded from the pilot handoff, through the normal monitoring cycle."""
from datetime import datetime, timedelta, timezone

from app.services import system
from app.services.monitor import run_cycle
from app.services.sources import source_id

FORECAST_SLUG = "replay-forecast"


def available_dates(conn) -> list[str]:
    rows = conn.execute("SELECT DISTINCT period_start::date AS d FROM rainfall_observations ORDER BY 1").fetchall()
    return [r["d"].isoformat() for r in rows]


def scenario_provenance(conn) -> str:
    rows = conn.execute("SELECT DISTINCT provenance::text AS p FROM rainfall_observations").fetchall()
    vals = {r["p"] for r in rows}
    return "SIMULATED_DEMO" if "SIMULATED_DEMO" in vals else "REAL_HISTORICAL"


def _write_forecasts(conn, as_of: datetime) -> None:
    """Stand-in forecast: the next 3 days of the replay period. Always SIMULATED_DEMO, never presented as a real forecast."""
    fsrc = source_id(conn, FORECAST_SLUG)
    conn.execute("DELETE FROM rainfall_forecasts WHERE issue_time = %s", (as_of,))
    for lead in (24, 48, 72):
        conn.execute(
            """INSERT INTO rainfall_forecasts (risk_zone_id, issue_time, valid_start, valid_end, lead_time_h, rainfall_mm, source_id, provenance)
               SELECT risk_zone_id, %s, period_start, period_end, %s, rainfall_mm, %s, 'SIMULATED_DEMO'
               FROM rainfall_observations WHERE period_start = %s
               ON CONFLICT DO NOTHING""",
            (as_of, lead, fsrc, as_of + timedelta(hours=lead - 24)),
        )


def start(conn) -> dict:
    dates = available_dates(conn)
    if not dates:
        return {}
    state = {"scenario": "pilot-rainfall-replay", "provenance": scenario_provenance(conn), "dates": dates, "step": 0, "steps": len(dates)}
    system.set_state(conn, "replay", state)
    return step(conn, state)


def step(conn, state: dict) -> dict:
    day = datetime.fromisoformat(state["dates"][state["step"]]).replace(tzinfo=timezone.utc)
    as_of = day + timedelta(days=1)
    _write_forecasts(conn, as_of)
    cycle = run_cycle(conn, "DEMO_REPLAY", as_of)
    state = {**state, "as_of": as_of.isoformat()}
    system.set_state(conn, "replay", state)
    return {"replay": public_state(state), "cycle": cycle}


def public_state(state: dict | None) -> dict | None:
    if not state:
        return None
    return {k: state[k] for k in ("scenario", "provenance", "step", "steps", "as_of") if k in state}
