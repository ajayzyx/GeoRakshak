"""Monitoring-cycle scoring: build per-cell features, call georakshak_ml, store assessments."""
from datetime import datetime, timedelta, timezone

import georakshak_ml
from psycopg.types.json import Jsonb

from app.config import get_settings
from app.services.sources import source_id

SEVERITY_ORDER = {"LOW": 0, "MODERATE": 1, "HIGH": 2, "VERY_HIGH": 3}
RAIN_WINDOWS = {"rain_1d_mm": 1, "rain_3d_mm": 3, "rain_7d_mm": 7, "rain_antecedent_15d_mm": 15, "rain_antecedent_30d_mm": 30}
SENSOR_LIVE_WINDOW = timedelta(hours=6)
SENSOR_REPLAY_WINDOW = timedelta(hours=24)


def ensure_model_version(conn) -> dict:
    m = georakshak_ml.active_model()
    row = conn.execute(
        """INSERT INTO model_versions (version, model_type, stage, feature_config, thresholds, validation_scheme, metrics,
               forecast_skill_evaluated, model_card_uri, is_active)
           VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, true)
           ON CONFLICT (version) DO UPDATE SET is_active = true, thresholds = EXCLUDED.thresholds, metrics = EXCLUDED.metrics
           RETURNING id, version""",
        (m["version"], m.get("model_type", "UNKNOWN"), m.get("stage", "COMBINED"), Jsonb({"feature_list": m.get("feature_list", [])}),
         Jsonb(m.get("thresholds") or {}), m.get("validation_scheme"), Jsonb(m["metrics"]) if m.get("metrics") else None,
         bool(m.get("forecast_skill_evaluated")), m.get("model_card_uri")),
    ).fetchone()
    conn.execute("UPDATE model_versions SET is_active = (id = %s)", (row["id"],))
    return row


def _prov(values) -> str:
    vals = {v for v in values if v}
    if "SIMULATED_DEMO" in vals:
        return "SIMULATED_DEMO"
    if "REAL_LIVE" in vals:
        return "REAL_LIVE"
    return "REAL_HISTORICAL"


# One rainfall value per cell-day. When several sources cover the same day, the choice must be deterministic and
# explainable rather than "whichever row came back last": official IMD data wins, then other real data, then
# simulated. Values are never summed across sources, which would double-count the rainfall.
SOURCE_PRECEDENCE = """CASE WHEN ds.slug LIKE 'imd-%%' THEN 0
                            WHEN ro.provenance = 'REAL_LIVE' THEN 1
                            WHEN ro.provenance = 'REAL_HISTORICAL' THEN 2
                            ELSE 3 END"""


# A LIVE risk view must never be computed from simulated data (CLAUDE.md §9). Replay and mock rainfall are
# SIMULATED_DEMO, so LIVE scoring excludes them outright rather than silently mixing them in.
LIVE_ONLY_REAL = "AND {table}.provenance <> 'SIMULATED_DEMO'"


def _daily_series(conn, as_of: datetime, mode: str) -> dict:
    """{zone_id: {day_index_before_as_of: (mm, provenance)}} for the 30 days up to as_of (observed only)."""
    simulated_filter = LIVE_ONLY_REAL.format(table="ro") if mode == "LIVE" else ""
    rows = conn.execute(
        f"""SELECT DISTINCT ON (ro.risk_zone_id, ro.period_start)
                   ro.risk_zone_id, ro.period_start, ro.rainfall_mm, ro.provenance::text AS provenance
            FROM rainfall_observations ro JOIN data_sources ds ON ds.id = ro.source_id
            WHERE ro.period_end <= %s AND ro.period_start >= %s {simulated_filter}
            ORDER BY ro.risk_zone_id, ro.period_start, {SOURCE_PRECEDENCE}, ds.slug""",
        (as_of, as_of - timedelta(days=30)),
    ).fetchall()
    series: dict = {}
    for r in rows:
        days_back = (as_of - r["period_start"]).days  # 1 = the day ending at as_of
        series.setdefault(r["risk_zone_id"], {})[days_back] = (r["rainfall_mm"], r["provenance"])
    return series


def _forecasts(conn, as_of: datetime, mode: str) -> dict:
    simulated_filter = LIVE_ONLY_REAL.format(table="rf") if mode == "LIVE" else ""
    rows = conn.execute(
        f"""SELECT DISTINCT ON (rf.risk_zone_id, rf.lead_time_h)
                  rf.risk_zone_id, rf.lead_time_h, rf.rainfall_mm, rf.provenance::text AS provenance, rf.source_id
           FROM rainfall_forecasts rf JOIN data_sources ds ON ds.id = rf.source_id
           WHERE rf.issue_time = (SELECT max(issue_time) FROM rainfall_forecasts rf2
                                  WHERE rf2.issue_time <= %s {simulated_filter.replace('rf.', 'rf2.')})
             {simulated_filter}
           ORDER BY rf.risk_zone_id, rf.lead_time_h,
                    CASE WHEN ds.slug LIKE 'imd-%%' THEN 0 WHEN rf.provenance = 'REAL_LIVE' THEN 1 ELSE 2 END, ds.slug""",
        (as_of,),
    ).fetchall()
    out: dict = {}
    for r in rows:
        out.setdefault(r["risk_zone_id"], {})[r["lead_time_h"]] = (r["rainfall_mm"], r["provenance"], r["source_id"])
    return out


def _sensor_inputs(conn, zones: list[dict], as_of: datetime, mode: str) -> list[dict]:
    if mode == "LIVE":
        window_sql, window_args = "sr.observed_at <= %s AND sr.observed_at >= %s", (as_of, as_of - SENSOR_LIVE_WINDOW)
    else:
        # Replay runs on historical dates while virtual stations post "now"; use recent wall-clock receipts.
        window_sql, window_args = "sr.received_at >= %s", (datetime.now(timezone.utc) - SENSOR_REPLAY_WINDOW,)
    rows = conn.execute(
        f"""SELECT DISTINCT ON (ss.id, rz.id) rz.id AS cell_id, ss.station_code, sr.variable, sr.value, sr.unit, sr.observed_at,
                sr.provenance::text AS provenance, ST_Distance(ss.geom::geography, rz.centroid::geography) AS distance_m
            FROM sensor_stations ss
            JOIN sensor_readings sr ON sr.station_id = ss.id AND sr.quality_flag = 'OK' AND {window_sql}
            JOIN risk_zones rz ON ST_DWithin(ss.geom::geography, rz.centroid::geography, ss.influence_radius_m)
            WHERE ss.status = 'ACTIVE'
            ORDER BY ss.id, rz.id, sr.observed_at DESC""",
        window_args,
    ).fetchall()
    return [{**r, "cell_id": str(r["cell_id"]), "observed_at": r["observed_at"].isoformat()} for r in rows]


def _cell(zone: dict, rain: dict | None) -> dict:
    features = dict(zone["static_features"])
    prov = dict(zone["feature_provenance"])
    if rain:
        for name, days in RAIN_WINDOWS.items():
            vals = [rain[d] for d in range(1, days + 1) if d in rain]
            if vals:
                features[name] = round(sum(v[0] for v in vals), 2)
                prov[name] = _prov(v[1] for v in vals)
    return {"cell_id": str(zone["id"]), "features": features, "feature_provenance": prov}


def _write(conn, results: list[dict], zones_by_id: dict, cells_by_id: dict, model_id, lead: int, as_of: datetime, mode: str, forecast_source) -> None:
    if mode == "DEMO_REPLAY":
        # A replay step would otherwise rewrite ~2,800 rows per lead and keep them: 47 steps leave 300k+ rows and
        # matching bloat, which is what made occasional steps stall. Superseded replay rows are dropped instead,
        # except any an alert points at, so the alert's triggering assessment survives.
        conn.execute(
            """DELETE FROM risk_assessments ra WHERE ra.is_latest AND ra.lead_time_h = %s AND ra.run_mode = %s
                 AND NOT EXISTS (SELECT 1 FROM alerts a WHERE a.triggering_assessment_id = ra.id)""",
            (lead, mode),
        )
    conn.execute(
        "UPDATE risk_assessments SET is_latest = false WHERE is_latest AND lead_time_h = %s AND run_mode = %s", (lead, mode)
    )
    valid_from = as_of + timedelta(hours=max(lead - 24, 0)) if lead else as_of
    valid_until = as_of + timedelta(hours=lead if lead else 24)
    rows = []
    for r in results:
        cell = cells_by_id[r["cell_id"]]
        input_prov = sorted({p for p in cell["feature_provenance"].values() if p} | {f.get("provenance") for f in r["factors"] if f.get("provenance")})
        rows.append((r["cell_id"], model_id, lead, as_of, valid_from, valid_until, r["score"], r["severity"], r["confidence"],
                     Jsonb(r["factors"]), input_prov, forecast_source, mode))
    # One batched statement instead of a round trip per cell: a pilot cycle writes ~2,800 rows per lead.
    with conn.cursor() as cur:
        cur.executemany(
            """INSERT INTO risk_assessments (risk_zone_id, model_version_id, lead_time_h, issue_time, valid_from, valid_until, score, severity,
                   confidence, factors, input_provenance, forecast_source_id, run_mode)
               VALUES (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)""",
            rows,
        )
    if lead == 0:
        # Point each cell at the assessment just written, in one statement.
        conn.execute(
            """UPDATE risk_zones rz SET current_severity = ra.severity, current_assessment_id = ra.id
               FROM risk_assessments ra
               WHERE ra.risk_zone_id = rz.id AND ra.is_latest AND ra.lead_time_h = 0 AND ra.run_mode = %s""",
            (mode,),
        )


def apply_severity_thresholds() -> tuple:
    """Push the configured H11 operating bands into the scoring package before any run."""
    s = get_settings()
    moderate, high, very_high = s.severity_threshold_values
    return georakshak_ml.set_severity_thresholds(moderate, high, very_high, source="BACKEND_CONFIG")


def score_all(conn, mode: str, as_of: datetime | None = None) -> dict:
    as_of = as_of or datetime.now(timezone.utc)
    apply_severity_thresholds()
    model = ensure_model_version(conn)
    zones = conn.execute("SELECT id, static_features, feature_provenance FROM risk_zones").fetchall()
    if not zones:
        return {"scored": 0}
    series = _daily_series(conn, as_of, mode)
    zones_by_id = {str(z["id"]): z for z in zones}
    cells = [_cell(z, series.get(z["id"])) for z in zones]
    cells_by_id = {c["cell_id"]: c for c in cells}
    sensors = _sensor_inputs(conn, zones, as_of, mode)
    results = georakshak_ml.score(cells, lead_time_h=0, sensor_inputs=sensors or None)
    _write(conn, results, zones_by_id, cells_by_id, model["id"], 0, as_of, mode, None)
    summary = {"scored": len(results), "model_version": model["version"], "as_of": as_of.isoformat(), "forecast_leads": []}

    forecasts = _forecasts(conn, as_of, mode)
    for lead in (24, 48, 72):
        fcells, fsource = [], None
        for z in zones:
            f = forecasts.get(z["id"], {})
            if lead not in f:
                continue
            # Rainfall window ending at the valid time: forecast days replace the most recent days.
            shift = lead // 24
            rain = {}
            for d in range(1, shift + 1):
                mm, prov, fsource = f[24 * (shift - d + 1)] if 24 * (shift - d + 1) in f else (None, None, fsource)
                if mm is not None:
                    rain[d] = (mm, prov)
            for d, v in (series.get(z["id"]) or {}).items():
                if d + shift <= 30:
                    rain[d + shift] = v
            fcells.append(_cell(z, rain))
        if not fcells:
            continue
        fresults = georakshak_ml.score(fcells, lead_time_h=lead, sensor_inputs=sensors or None)
        _write(conn, fresults, zones_by_id, {c["cell_id"]: c for c in fcells}, model["id"], lead, as_of, mode, fsource)
        summary["forecast_leads"].append(lead)
    return summary
