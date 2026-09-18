"""Road connectivity status (architecture.md §3.8). Precedence: AUTHORITY_OVERRIDE > VERIFIED_REPORT > MODEL_RISK."""
from datetime import datetime, timezone

VILLAGE_ACCESS_RADIUS_M = 1000
REPORT_SNAP_RADIUS_M = 100


def recompute_model_status(conn, mode: str) -> dict:
    now = datetime.now(timezone.utc)
    conn.execute(
        """UPDATE road_segments SET status = 'OPEN', status_source = 'NONE', status_reason = 'No evidence of blockage',
               status_lead_time_h = NULL, status_updated_at = %s WHERE status_source = 'MODEL_RISK'""",
        (now,),
    )
    n = conn.execute(
        """UPDATE road_segments rs SET status = 'AT_RISK', status_source = 'MODEL_RISK', status_lead_time_h = 0, status_updated_at = %s,
               status_reason = 'Crosses a cell with current risk ' || hit.sev
           FROM (SELECT rs2.id, max(ra.severity)::text AS sev FROM road_segments rs2
                 JOIN risk_zones rz ON ST_Intersects(rz.geom, rs2.geom)
                 JOIN risk_assessments ra ON ra.risk_zone_id = rz.id AND ra.is_latest AND ra.lead_time_h = 0 AND ra.run_mode = %s
                 WHERE ra.severity IN ('HIGH', 'VERY_HIGH') GROUP BY rs2.id) hit
           WHERE rs.id = hit.id AND rs.status_source = 'NONE'""",
        (now, mode),
    ).rowcount
    return {"at_risk": n, **recompute_village_access(conn)}


def recompute_village_access(conn) -> dict:
    now = datetime.now(timezone.utc)
    conn.execute(
        f"""UPDATE locations l SET access_status = CASE WHEN s.n = 0 THEN 'UNKNOWN'::access_status
                                                   WHEN s.n_bad = s.n THEN 'ACCESS_AT_RISK'::access_status
                                                   ELSE 'OK'::access_status END,
               access_status_reason = CASE WHEN s.n = 0 THEN 'No mapped road within {VILLAGE_ACCESS_RADIUS_M} m'
                                           ELSE s.n_bad || ' of ' || s.n || ' road segments within {VILLAGE_ACCESS_RADIUS_M} m blocked or at risk' END,
               access_status_updated_at = %s
           FROM (SELECT l2.id, count(rs.id) AS n, count(rs.id) FILTER (WHERE rs.status IN ('BLOCKED', 'AT_RISK')) AS n_bad
                 FROM locations l2
                 LEFT JOIN road_segments rs ON ST_DWithin(rs.geom, l2.geom, 0.02)
                      AND ST_DWithin(rs.geom::geography, l2.geom::geography, {VILLAGE_ACCESS_RADIUS_M})
                 WHERE l2.type IN ('VILLAGE', 'TOWN') GROUP BY l2.id) s
           WHERE l.id = s.id""",
        (now,),
    )
    n = conn.execute("SELECT count(*) AS n FROM locations WHERE access_status = 'ACCESS_AT_RISK'").fetchone()["n"]
    return {"villages_access_at_risk": n}


def nearest_segment(conn, lon: float, lat: float):
    row = conn.execute(
        f"""SELECT id FROM road_segments
            WHERE ST_DWithin(geom::geography, ST_SetSRID(ST_MakePoint(%s, %s), 4326)::geography, {REPORT_SNAP_RADIUS_M})
            ORDER BY geom <-> ST_SetSRID(ST_MakePoint(%s, %s), 4326) LIMIT 1""",
        (lon, lat, lon, lat),
    ).fetchone()
    return row["id"] if row else None


def block_from_report(conn, segment_id, report_id, reason: str) -> None:
    conn.execute(
        """UPDATE road_segments SET status = 'BLOCKED', status_source = 'VERIFIED_REPORT', status_reason = %s, status_report_id = %s,
               status_lead_time_h = NULL, status_updated_at = %s WHERE id = %s""",
        (reason, report_id, datetime.now(timezone.utc), segment_id),
    )
