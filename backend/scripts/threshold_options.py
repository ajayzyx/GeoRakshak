"""Measure severity cut-off and road-status options on the loaded pilot, for the H11 decision.

Reads the latest stored assessments (no rescoring) and reports, per option:
  * share of pilot cells classed High/Very High
  * road segments marked AT_RISK, and the share of the network
  * villages whose mapped access would be flagged
  * how many recorded landslide points fall inside flagged cells

**The last column is not accuracy.** The served model uses past-landslide density as a feature, so cells
containing inventory points score higher by construction. Use these numbers to compare how selective the
options are, never as validation. Severity cut-offs are a pending team decision (H11).

Usage: python -m scripts.threshold_options [--database-url URL] [--lead-time-h 0]
"""
import argparse

import psycopg
from psycopg.rows import dict_row

from app.config import get_settings

# (label, High cut-off, Very High cut-off) — absolute score options
ABSOLUTE = [
    ("current (0.45 / 0.65)", 0.45, 0.65),
    ("0.50 / 0.68", 0.50, 0.68),
    ("0.55 / 0.70", 0.55, 0.70),
    ("0.60 / 0.75", 0.60, 0.75),
]
# (label, High = top x% of cells, Very High = top y%) — relative options, recomputed every cycle
RELATIVE = [("top 20% / top 5%", 0.20, 0.05), ("top 10% / top 2%", 0.10, 0.02), ("top 5% / top 1%", 0.05, 0.01)]


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    p.add_argument("--database-url", default=get_settings().database_url)
    p.add_argument("--lead-time-h", type=int, default=0)
    p.add_argument("--run-mode", default="DEMO_REPLAY")
    args = p.parse_args()

    with psycopg.connect(args.database_url, row_factory=dict_row) as conn:
        rows = conn.execute(
            """SELECT ra.risk_zone_id, ra.score FROM risk_assessments ra
               WHERE ra.is_latest AND ra.lead_time_h = %s AND ra.run_mode = %s ORDER BY ra.score DESC""",
            (args.lead_time_h, args.run_mode),
        ).fetchall()
        if not rows:
            raise SystemExit(f"no stored assessments for lead {args.lead_time_h} in {args.run_mode}; run the replay first")
        total_roads = conn.execute("SELECT count(*) AS n FROM road_segments").fetchone()["n"]
        total_villages = conn.execute("SELECT count(*) AS n FROM locations WHERE type IN ('VILLAGE', 'TOWN')").fetchone()["n"]
        inventory = conn.execute("SELECT count(*) AS n FROM historical_landslides").fetchone()["n"]
        as_of = conn.execute("SELECT value->>'as_of' AS a FROM system_state WHERE key = 'replay'").fetchone()
        scores = [r["score"] for r in rows]

        def measure(label: str, high: float, very: float) -> dict:
            flagged = [str(r["risk_zone_id"]) for r in rows if r["score"] >= high]
            roads = conn.execute(
                """SELECT count(DISTINCT rs.id) AS n FROM road_segments rs JOIN risk_zones rz ON ST_Intersects(rz.geom, rs.geom)
                   WHERE rz.id::text = ANY(%s)""", (flagged,)).fetchone()["n"] if flagged else 0
            villages = conn.execute(
                """SELECT count(*) AS n FROM locations l WHERE l.type IN ('VILLAGE', 'TOWN') AND EXISTS (
                     SELECT 1 FROM road_segments rs JOIN risk_zones rz ON ST_Intersects(rz.geom, rs.geom)
                     WHERE rz.id::text = ANY(%s) AND ST_DWithin(l.geom::geography, rs.geom::geography, 1000))""",
                (flagged,)).fetchone()["n"] if flagged else 0
            hits = conn.execute(
                """SELECT count(*) AS n FROM historical_landslides h JOIN risk_zones rz ON ST_Contains(rz.geom, h.geom)
                   WHERE rz.id::text = ANY(%s)""", (flagged,)).fetchone()["n"] if flagged else 0
            return {"label": label, "high": high, "very": very, "cells": len(flagged),
                    "very_cells": sum(1 for s in scores if s >= very), "roads": roads, "villages": villages, "hits": hits}

        print(f"pilot cells {len(rows)} · roads {total_roads} · villages/towns {total_villages} · inventory points {inventory}")
        print(f"lead {args.lead_time_h} h, {args.run_mode}" + (f", replay as_of {as_of['a'][:10]}" if as_of and as_of["a"] else ""))
        print(f"score range {min(scores):.3f}–{max(scores):.3f}\n")
        header = f"{'option':<24} {'High+ cells':>12} {'area':>7} {'VeryHigh':>9} {'roads AT_RISK':>14} {'network':>8} {'villages':>9} {'inv. pts':>9}"
        print(header)
        print("-" * len(header))
        options = [(label, h, v) for label, h, v in ABSOLUTE]
        for label, hq, vq in RELATIVE:
            options.append((label, scores[min(int(len(scores) * hq), len(scores) - 1)], scores[min(int(len(scores) * vq), len(scores) - 1)]))
        for label, high, very in options:
            m = measure(label, high, very)
            print(f"{m['label']:<24} {m['cells']:>12} {m['cells'] / len(rows):>6.1%} {m['very_cells']:>9} "
                  f"{m['roads']:>14} {m['roads'] / total_roads:>7.1%} {m['villages']:>9} {m['hits']:>4}/{inventory}")
        print("\nRoad rule variant: AT_RISK only where a segment crosses a Very High cell")
        for label, high, very in options:
            flagged_very = [str(r["risk_zone_id"]) for r in rows if r["score"] >= very]
            roads = conn.execute(
                """SELECT count(DISTINCT rs.id) AS n FROM road_segments rs JOIN risk_zones rz ON ST_Intersects(rz.geom, rs.geom)
                   WHERE rz.id::text = ANY(%s)""", (flagged_very,)).fetchone()["n"] if flagged_very else 0
            print(f"  {label:<24} {roads:>6} segments ({roads / total_roads:.1%} of the network)")
        print("\nInventory-point counts are circular (the model uses past-landslide density) and are not accuracy.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
