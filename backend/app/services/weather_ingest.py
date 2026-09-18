"""Fetch real rainfall from a configured weather adapter into the monitoring tables.

Honest labelling rules applied here:
* Provider points are coarse (a small sampling grid over the pilot), exactly like the IMD 0.25° grid. Each cell
  takes its nearest provider point, and the source note says so.
* A non-IMD provider's data is stored with its own source rows, whose notes state that it is **model output and
  not Indian gauge observations**, and that it is not IMD (H16).
* Sources become `CONNECTED_LIVE` only after a real successful call.
* Nothing is written when the provider raises; the failure is recorded on the source row instead.
"""
from datetime import datetime, time, timedelta, timezone

from psycopg.types.json import Jsonb

from app.adapters import weather
from app.services.sources import mark_success, source_id

SAMPLE_SIDE = 3  # 3x3 provider points across the pilot bbox
FORECAST_LEADS = (24, 48, 72)


def _register(conn, provider: weather.WeatherProvider, kind: str, suffix: str, dataset: str, note: str) -> str:
    slug = f"{provider.slug}-{suffix}"
    licence = weather.OPEN_METEO_LICENCE if provider.slug == "open-meteo" else None
    conn.execute(
        """INSERT INTO data_sources (slug, kind, provider, dataset, connection_status, verification_status, licence,
               attribution_text, provenance_default, status_note, metadata)
           VALUES (%s, %s, %s, %s, 'NOT_CONNECTED', 'UNVERIFIED', %s, %s, 'REAL_LIVE', %s, %s)
           ON CONFLICT (slug) DO UPDATE SET status_note = EXCLUDED.status_note, licence = EXCLUDED.licence,
               attribution_text = EXCLUDED.attribution_text, dataset = EXCLUDED.dataset""",
        (slug, kind, provider.label, dataset, licence, provider.label, note,
         Jsonb({"is_imd": provider.is_imd, "provider_slug": provider.slug})),
    )
    return slug


def sample_points(conn) -> list[tuple[float, float]]:
    row = conn.execute("SELECT bbox FROM pilot_area WHERE is_active LIMIT 1").fetchone()
    if not row:
        raise RuntimeError("no active pilot area")
    min_lon, min_lat, max_lon, max_lat = row["bbox"]
    step = 1 / (SAMPLE_SIDE + 1)
    return [(min_lat + (max_lat - min_lat) * (j + 1) * step, min_lon + (max_lon - min_lon) * (i + 1) * step)
            for j in range(SAMPLE_SIDE) for i in range(SAMPLE_SIDE)]


def _zones_by_point(conn, points: list[tuple[float, float]]) -> dict[int, list[str]]:
    """Assign every cell to its nearest provider point (nearest-neighbour, like the IMD grid mapping)."""
    values = ", ".join(f"({i}, {lon}, {lat})" for i, (lat, lon) in enumerate(points))
    rows = conn.execute(
        f"""SELECT rz.id, nearest.idx FROM risk_zones rz
            CROSS JOIN LATERAL (
                SELECT p.idx FROM (VALUES {values}) AS p(idx, lon, lat)
                ORDER BY ST_Centroid(rz.geom) <-> ST_SetSRID(ST_MakePoint(p.lon, p.lat), 4326) LIMIT 1
            ) AS nearest"""
    ).fetchall()
    mapping: dict[int, list[str]] = {}
    for r in rows:
        mapping.setdefault(r["idx"], []).append(str(r["id"]))
    return mapping


def ingest(conn, provider: weather.WeatherProvider, observed_days: int = 10, forecast_days: int = 3) -> dict:
    points = sample_points(conn)
    obs_slug = _register(
        conn, provider, "WEATHER_HISTORICAL", "recent",
        f"{provider.label}: recent daily precipitation",
        f"Model-derived daily precipitation for the last {observed_days} days, not gauge observations"
        + ("" if provider.is_imd else ". Non-IMD source (H16).")
        + f" {SAMPLE_SIDE}x{SAMPLE_SIDE} provider points across the pilot; each cell takes its nearest point.")
    fc_slug = _register(
        conn, provider, "WEATHER_FORECAST", "forecast",
        f"{provider.label}: daily precipitation forecast",
        f"Daily precipitation forecast, leads {'/'.join(str(l) for l in FORECAST_LEADS)} h"
        + ("" if provider.is_imd else ". Non-IMD source (H16).")
        + " Forecast skill has not been evaluated.")
    mapping = _zones_by_point(conn, points)
    result = {"provider": provider.slug, "points": len(points), "observations": 0, "forecasts": 0,
              "observed_source": obs_slug, "forecast_source": fc_slug, "is_imd": provider.is_imd}

    try:
        observed = provider.observed_daily(points, observed_days)
        batch = provider.forecast_daily(points, forecast_days)
    except weather.NotConnected as e:
        conn.execute("UPDATE data_sources SET last_error = %s WHERE slug = ANY(%s)", (str(e)[:500], [obs_slug, fc_slug]))
        raise

    obs_id, fc_id = source_id(conn, obs_slug), source_id(conn, fc_slug)
    for row in observed:
        start = datetime.combine(row.day, time.min, tzinfo=timezone.utc)
        zones = mapping.get(row.point_index, [])
        if not zones:
            continue
        result["observations"] += conn.execute(
            """INSERT INTO rainfall_observations (risk_zone_id, period_start, period_end, rainfall_mm, source_id, provenance)
               SELECT id, %s, %s, %s, %s, 'REAL_LIVE' FROM risk_zones WHERE id::text = ANY(%s)
               ON CONFLICT (risk_zone_id, period_start, period_end, source_id) DO UPDATE SET rainfall_mm = EXCLUDED.rainfall_mm""",
            (start, start + timedelta(days=1), row.rainfall_mm, obs_id, zones),
        ).rowcount

    issue = batch.issue_time
    by_day = sorted({r.day for r in batch.days})
    for row in batch.days:
        lead_index = by_day.index(row.day)
        if lead_index >= len(FORECAST_LEADS):
            continue
        lead = FORECAST_LEADS[lead_index]
        start = datetime.combine(row.day, time.min, tzinfo=timezone.utc)
        zones = mapping.get(row.point_index, [])
        if not zones:
            continue
        result["forecasts"] += conn.execute(
            """INSERT INTO rainfall_forecasts (risk_zone_id, issue_time, valid_start, valid_end, lead_time_h, rainfall_mm, source_id, provenance)
               SELECT id, %s, %s, %s, %s, %s, %s, 'REAL_LIVE' FROM risk_zones WHERE id::text = ANY(%s)
               ON CONFLICT (risk_zone_id, issue_time, lead_time_h, source_id) DO UPDATE SET rainfall_mm = EXCLUDED.rainfall_mm""",
            (issue, start, start + timedelta(days=1), lead, row.rainfall_mm, fc_id, zones),
        ).rowcount

    # Only now, after real data has arrived and been stored.
    if result["observations"]:
        mark_success(conn, obs_slug, "CONNECTED_LIVE")
    if result["forecasts"]:
        mark_success(conn, fc_slug, "CONNECTED_LIVE")
    return result
