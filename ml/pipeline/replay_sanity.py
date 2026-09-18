"""Replay sanity check (report only, no skill claim): score the pilot grid over the real IMD replay window.

Rain features are derived exactly as backend/app/services/scoring.py does: for as_of = end of day D,
rain_Nd_mm = sum of the daily values of days D-N+1..D that exist (partial windows allowed).
Sensors are not used. Optionally compares a Stage A candidate susceptibility (pilot_susceptibility.csv).

Usage: ml/.venv/bin/python ml/pipeline/replay_sanity.py
Output: ml/reports/replay-sanity-<date>.json
"""

from __future__ import annotations

import csv
import json
import math
import sys
from collections import Counter, defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import georakshak_ml
from georakshak_ml import config as C
from georakshak_ml import score as gk_score

import pilot_config as P
from common import ML_DIR, PROCESSED

RAIN_WINDOWS = {"rain_1d_mm": 1, "rain_3d_mm": 3, "rain_7d_mm": 7, "rain_antecedent_15d_mm": 15}
SUSC_CSV = PROCESSED / "training" / "v3" / "pilot_susceptibility.csv"


def ramp(x, lo, hi):  # mirrors georakshak_ml.b0._ramp
    return min(1.0, max(0.0, (x - lo) / (hi - lo)))


def candidate_score(susceptibility: float, feats: dict) -> tuple[float, str]:
    """Stage A susceptibility + the unchanged rule-based rainfall trigger (no sensor input)."""
    rain = [(s, ramp(feats[n], s["lo"], s["hi"])) for n, s in C.TRIGGER_FACTORS.items() if n in feats]
    t = sum(s["weight"] / sum(r[0]["weight"] for r in rain) * v for s, v in rain) if rain else 0.0
    raw = C.W_SUSCEPTIBILITY * susceptibility + C.W_TRIGGER * susceptibility * t
    s = round(min(1.0, max(0.0, raw)), 4)
    return s, next(label for lo, label in C.severity_thresholds() if s >= lo)


def load_rain():
    series = defaultdict(dict)
    with open(P.OUT / "rainfall_daily.csv") as fh:
        for r in csv.DictReader(fh):
            series[r["grid_code"]][date.fromisoformat(r["date"])] = float(r["rainfall_mm"])
    return series


def rain_features(day_map, d):
    out = {}
    for name, n in RAIN_WINDOWS.items():
        vals = [day_map[d - timedelta(days=k)] for k in range(n) if (d - timedelta(days=k)) in day_map]
        if vals:
            out[name] = round(sum(vals), 2)
    return out


def main():
    fc = json.loads((P.OUT / "grid_cells.geojson").read_text())
    cells = [{"grid_code": f["properties"]["grid_code"], "centroid": f["properties"]["centroid"],
              "static": f["properties"]["static_features"], "prov": f["properties"]["feature_provenance"]}
             for f in fc["features"]]
    series = load_rain()
    susc = {}
    if SUSC_CSV.exists():
        susc = {r["grid_code"]: (float(r["susceptibility_score"]), r["model"]) for r in csv.DictReader(open(SUSC_CSV))}

    events = [(f["properties"]["event_date"], f["geometry"]["coordinates"])
              for f in json.loads((P.OUT / "historical_landslides.geojson").read_text())["features"]
              if (f["properties"]["event_date"] or "") >= P.RAIN_START and (f["properties"]["event_date"] or "") <= P.RAIN_END]

    def nearest(lon, lat):
        return min(cells, key=lambda c: (c["centroid"][0] - lon) ** 2 + (c["centroid"][1] - lat) ** 2)["grid_code"]

    event_cells = {ev_date: nearest(*coords[:2]) for ev_date, coords in events}
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "pilot_slug": P.PILOT_SLUG, "window": [P.RAIN_START, P.RAIN_END],
           "served_model": georakshak_ml.active_model()["version"],
           "candidate_model": sorted({m for _, m in susc.values()}) or None,
           "rain_feature_derivation": "rolling sums of rainfall_daily.csv with period_end <= as_of (backend convention)",
           "events_in_window": [{"event_date": d, "grid_code": event_cells[d]} for d, _ in events],
           "days": [], "note": "Diagnostic only. Two events cannot validate event prediction; no event-prediction claim is made."}

    d0, d1 = date.fromisoformat(P.RAIN_START), date.fromisoformat(P.RAIN_END)
    d = d0
    while d <= d1:
        scored = []
        for c in cells:
            rf = rain_features(series.get(c["grid_code"], {}), d)
            scored.append({"cell_id": c["grid_code"], "features": {**c["static"], **rf},
                           "feature_provenance": {**c["prov"], **{k: "REAL_HISTORICAL" for k in rf}}})
        b0 = gk_score(scored)
        row = {"date": d.isoformat(), "rain_1d_mm_max": max((s["features"].get("rain_1d_mm", 0.0) for s in scored), default=0.0),
               "b0": {"counts": dict(Counter(r["severity"] for r in b0)),
                      "max_score": max(r["score"] for r in b0)}}
        if susc:
            cand = [candidate_score(susc[s["cell_id"]][0], s["features"]) for s in scored if s["cell_id"] in susc]
            row["candidate"] = {"counts": dict(Counter(sev for _, sev in cand)), "max_score": max(s for s, _ in cand)}
        by_code_b0 = {r["cell_id"]: r for r in b0}
        ranks = sorted((r["score"] for r in b0), reverse=True)
        for ev_date, code in event_cells.items():
            if ev_date != d.isoformat():
                continue
            r = by_code_b0[code]
            entry = {"grid_code": code, "b0_score": r["score"], "b0_severity": r["severity"],
                     "b0_percentile_in_pilot": round(1 - ranks.index(r["score"]) / len(ranks), 3)}
            if susc and code in susc:
                feats = next(s for s in scored if s["cell_id"] == code)["features"]
                cs, csev = candidate_score(susc[code][0], feats)
                cand_all = sorted((candidate_score(susc[s["cell_id"]][0], s["features"])[0]
                                   for s in scored if s["cell_id"] in susc), reverse=True)
                entry.update({"candidate_score": cs, "candidate_severity": csev,
                              "candidate_percentile_in_pilot": round(1 - cand_all.index(cs) / len(cand_all), 3)})
            row.setdefault("event_cells", []).append(entry)
        out["days"].append(row)
        d += timedelta(days=1)

    peak = max(out["days"], key=lambda r: r["rain_1d_mm_max"])
    out["baseline_day"] = out["days"][0]
    out["peak_rain_day"] = peak
    path = ML_DIR / "reports" / f"replay-sanity-{datetime.now(timezone.utc).date()}.json"
    path.write_text(json.dumps(out, indent=2))
    print("baseline", out["days"][0]["date"], out["days"][0]["b0"], out["days"][0].get("candidate"))
    print("peak", peak["date"], "rain_1d_max", peak["rain_1d_mm_max"], peak["b0"], peak.get("candidate"))
    for r in out["days"]:
        if "event_cells" in r:
            print("event day", r["date"], r["event_cells"])
    print("wrote", path)


if __name__ == "__main__":
    main()
