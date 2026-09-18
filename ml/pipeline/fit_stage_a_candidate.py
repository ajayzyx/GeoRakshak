"""Fit a Stage A candidate (design E) and write per-pilot-cell susceptibility (+ contributions for LR).

Whether the output is served depends on the pre-registered gate in the matching evaluation report. When the gate
fails the file is a diagnostic artefact only and georakshak_ml keeps b0-rules-0.1.0.

Usage: ml/.venv/bin/python ml/pipeline/fit_stage_a_candidate.py [--kind rf|lr] [--version v2|v3] [--label TAG]
Output: ml/data/processed/training/<version>/pilot_susceptibility.csv
"""

from __future__ import annotations

import argparse
import csv
import json

import numpy as np

import train_stage_a_v2 as T

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--kind", default="rf", choices=["rf", "lr"])
    ap.add_argument("--version", default="v2", choices=["v2", "v3"])
    ap.add_argument("--label", default="CANDIDATE-NOT-ADOPTED")
    args = ap.parse_args()
    T.DATA = T.PROCESSED / "training" / args.version
    rows = T.read(T.DATA / f"stage_a_{args.version}_exposure.csv")
    pilot = T.read(T.DATA / "pilot_grid_features.csv")
    X, y = T.fnum(rows, T.FEATURES), np.array([int(r["label"]) for r in rows])
    coords = T.fnum(rows, ["lon", "lat"])
    groups = T.block_ids(rows, T.OFFSETS[0])
    model = T.make_model(args.kind).fit(X, y)
    t_op = T.inner_oof_threshold(args.kind, X, y, groups, coords)
    raw = T.predict(model, T.fnum(pilot, T.FEATURES))
    # Pre-registered normalisation: a cell at t_op maps to S = 0.9, i.e. exactly HIGH without rainfall.
    s = np.minimum(1.0, 0.9 * raw / t_op)
    out = T.DATA / "pilot_susceptibility.csv"
    with open(out, "w", newline="") as fh:
        w = csv.writer(fh)
        w.writerow(["grid_code", "raw_score", "susceptibility_score", "model"])
        for r, rw, sv in zip(pilot, raw, s):
            w.writerow([r["event_id"], round(float(rw), 6), round(float(sv), 6), f"stage-a-{args.kind}-0.1.0-{args.label}"])
    print(json.dumps({"kind": args.kind, "version": args.version, "t_op": t_op, "pilot_cells": len(pilot),
                      "raw_quantiles": {q: round(float(np.quantile(raw, float(q))), 4) for q in ("0.1", "0.5", "0.9")},
                      "S_quantiles": {q: round(float(np.quantile(s, float(q))), 4) for q in ("0.1", "0.5", "0.9")},
                      "share_S_ge_0.9": round(float((s >= 0.9).mean()), 4), "written": str(out)}, indent=1))


if __name__ == "__main__":
    main()
