"""Load an ML handoff directory (docs/development.md §6) into PostGIS, replacing the previous pilot.

Usage: python -m scripts.load_pilot <handoff_dir> [--database-url URL]
"""
import argparse
import csv
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

import psycopg
from psycopg.types.json import Jsonb

from app.config import get_settings

# Ordered so that referencing rows go first (road_segments points at reports, alerts at assessments).
SPATIAL_TABLES = [
    "notification_deliveries", "alerts", "evidence", "road_segments", "reports", "locations", "risk_assessments",
    "rainfall_observations", "rainfall_forecasts", "historical_landslides", "sensor_readings", "sensor_stations",
]


def _load_fc(path: Path) -> list[dict]:
    return json.loads(path.read_text())["features"] if path.exists() else []


def _source_id(conn, slug: str | None, cache: dict) -> str | None:
    if not slug:
        return None
    if slug not in cache:
        row = conn.execute("SELECT id FROM data_sources WHERE slug = %s", (slug,)).fetchone()
        cache[slug] = row[0] if row else None
    return cache[slug]


def upsert_source(conn, s: dict) -> None:
    conn.execute(
        """INSERT INTO data_sources (slug, kind, provider, dataset, connection_status, status_note, verification_status,
               verified_at, licence, attribution_text, provenance_default, metadata, last_success_at)
           VALUES (%(slug)s, %(kind)s, %(provider)s, %(dataset)s, %(connection_status)s, %(status_note)s, %(verification_status)s,
               %(verified_at)s, %(licence)s, %(attribution_text)s, %(provenance_default)s, %(metadata)s, %(last_success_at)s)
           ON CONFLICT (slug) DO UPDATE SET kind = EXCLUDED.kind, provider = EXCLUDED.provider, dataset = EXCLUDED.dataset,
               connection_status = EXCLUDED.connection_status, status_note = EXCLUDED.status_note,
               verification_status = EXCLUDED.verification_status, verified_at = EXCLUDED.verified_at, licence = EXCLUDED.licence,
               attribution_text = EXCLUDED.attribution_text, provenance_default = EXCLUDED.provenance_default,
               metadata = EXCLUDED.metadata, last_success_at = EXCLUDED.last_success_at""",
        {
            "slug": s["slug"], "kind": s.get("kind", "OTHER"), "provider": s.get("provider", ""), "dataset": s.get("dataset", ""),
            "connection_status": s.get("connection_status", "NOT_CONNECTED"), "status_note": s.get("status_note"),
            "verification_status": s.get("verification_status", "UNVERIFIED"), "verified_at": s.get("verified_at"),
            "licence": s.get("licence"), "attribution_text": s.get("attribution_text"), "provenance_default": s.get("provenance_default"),
            "metadata": Jsonb(s.get("metadata") or {}),
            "last_success_at": datetime.now(timezone.utc) if s.get("connection_status") in ("CONNECTED_HISTORICAL", "CONNECTED_LIVE") else None,
        },
    )


def load(handoff: Path, database_url: str) -> dict:
    manifest = json.loads((handoff / "manifest.json").read_text())
    default_prov = "SIMULATED_DEMO" if manifest.get("status") == "MOCK" else "REAL_HISTORICAL"
    counts: dict[str, int] = {}
    with psycopg.connect(database_url) as conn:
        # TRUNCATE in one statement: it ignores the circular reports <-> road_segments references, and it
        # reclaims space instead of leaving hundreds of thousands of dead rows behind (a plain DELETE of the
        # replay's assessments stalled for minutes). admin_boundaries stays a DELETE because users reference it.
        conn.execute("UPDATE users SET admin_boundary_id = NULL")
        conn.execute("TRUNCATE " + ", ".join(SPATIAL_TABLES + ["risk_zones", "pilot_area"]))
        conn.execute("DELETE FROM admin_boundaries")
        conn.execute("DELETE FROM system_state WHERE key = 'replay'")
        # Sources registered by a previous pilot would otherwise stay on the status panel next to the new pilot's data.
        conn.execute("DELETE FROM data_sources WHERE metadata ? 'pilot_slug' AND metadata->>'pilot_slug' <> %s", (manifest["pilot_slug"],))
        for s in manifest.get("sources", []):
            upsert_source(conn, {**s, "metadata": {**(s.get("metadata") or {}), "pilot_slug": manifest["pilot_slug"]}})
        cache: dict = {}

        boundary = _load_fc(handoff / "boundary.geojson")
        if boundary:
            geom = json.dumps(boundary[0]["geometry"])
        else:
            b = manifest["bbox"]
            geom = json.dumps({"type": "Polygon", "coordinates": [[[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]], [b[0], b[1]]]]})
        boundary_id = conn.execute(
            "INSERT INTO admin_boundaries (level, name, geom, note) VALUES ('PILOT_AREA', %s, ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), %s) RETURNING id",
            (manifest["name"], geom, manifest.get("boundary_note")),
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO pilot_area (slug, name, status, bbox, cell_size_m, boundary_id, boundary_note, manifest) VALUES (%s,%s,%s,%s,%s,%s,%s,%s)",
            (manifest["pilot_slug"], manifest["name"], manifest["status"], manifest["bbox"], manifest["cell_size_m"], boundary_id,
             manifest.get("boundary_note"), Jsonb(manifest)),
        )
        conn.execute("UPDATE users SET admin_boundary_id = %s", (boundary_id,))

        cells = _load_fc(handoff / "grid_cells.geojson")
        with conn.cursor() as cur:
            for f in cells:
                p = f["properties"]
                cur.execute(
                    """INSERT INTO risk_zones (grid_code, geom, centroid, admin_boundary_id, static_features, feature_provenance, static_feature_version)
                       VALUES (%s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), ST_Centroid(ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)), %s, %s, %s, %s)""",
                    (p["grid_code"], json.dumps(f["geometry"]), json.dumps(f["geometry"]), boundary_id, Jsonb(p.get("static_features", {})),
                     Jsonb(p.get("feature_provenance", {})), manifest.get("feature_version")),
                )
        counts["risk_zones"] = len(cells)

        rows = _load_fc(handoff / "historical_landslides.geojson")
        for f in rows:
            p = f["properties"]
            conn.execute(
                """INSERT INTO historical_landslides (geom, event_date, event_date_precision, location_accuracy_m, trigger, landslide_type, fatalities, source_id, source_record_id, provenance)
                   VALUES (ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
                (json.dumps(f["geometry"]), p.get("event_date"), p.get("event_date_precision") or "UNKNOWN", p.get("location_accuracy_m"),
                 p.get("trigger"), p.get("landslide_type"), p.get("fatalities"), _source_id(conn, p.get("source_slug"), cache),
                 p.get("source_record_id"), p.get("provenance", default_prov)),
            )
        counts["historical_landslides"] = len(rows)

        rows = _load_fc(handoff / "locations.geojson")
        for f in rows:
            p = f["properties"]
            conn.execute(
                """INSERT INTO locations (type, name, geom, admin_boundary_id, population, population_source_year, osm_id, attributes, source_id, provenance)
                   VALUES (%s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), %s, %s, %s, %s, %s, %s, %s)""",
                (p["type"], p.get("name"), json.dumps(f["geometry"]), boundary_id, p.get("population"), p.get("population_source_year"),
                 p.get("osm_id"), Jsonb(p.get("attributes") or {}), _source_id(conn, p.get("source_slug"), cache), p.get("provenance", default_prov)),
            )
        counts["locations"] = len(rows)

        rows = [f for f in _load_fc(handoff / "road_segments.geojson") if f["geometry"]["type"] == "LineString"]
        for f in rows:
            p = f["properties"]
            conn.execute(
                """INSERT INTO road_segments (osm_way_id, name, road_class, geom, status, status_source, status_reason, source_id, provenance)
                   VALUES (%s, %s, %s, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326), 'OPEN', 'NONE', 'No evidence of blockage', %s, %s)""",
                (p.get("osm_way_id"), p.get("name"), p.get("road_class"), json.dumps(f["geometry"]),
                 _source_id(conn, p.get("source_slug"), cache), p.get("provenance", default_prov)),
            )
        counts["road_segments"] = len(rows)

        rain = handoff / "rainfall_daily.csv"
        n = 0
        if rain.exists():
            zone_ids = dict(conn.execute("SELECT grid_code, id FROM risk_zones").fetchall())
            with open(rain) as fh, conn.cursor() as cur:
                for r in csv.DictReader(fh):
                    zid = zone_ids.get(r["grid_code"])
                    if not zid:
                        continue
                    start = datetime.fromisoformat(r["date"]).replace(tzinfo=timezone.utc)
                    cur.execute(
                        """INSERT INTO rainfall_observations (risk_zone_id, period_start, period_end, rainfall_mm, source_id, provenance)
                           VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING""",
                        (zid, start, start + timedelta(days=1), float(r["rainfall_mm"]), _source_id(conn, r["source_slug"], cache), r["provenance"]),
                    )
                    n += 1
        counts["rainfall_observations"] = n
        conn.commit()
    return counts


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("handoff", type=Path)
    parser.add_argument("--database-url", default=get_settings().database_url)
    args = parser.parse_args()
    print(load(args.handoff, args.database_url))
