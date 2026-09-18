"""Stage A evaluation (v2/v3): leakage-safe spatial block CV at two block-grid offsets, naive vs exposure-controlled.

Implements exactly the pre-registration in ml/reports/evaluation-2026-09-17-v2.md §1 (v2, NASA GLC labels) and
ml/reports/evaluation-2026-09-18-v3.md §1 (v3, GSI surveyed labels). The gate and every parameter are identical;
only the label source changes.

Usage: ml/.venv/bin/python ml/pipeline/train_stage_a_v2.py [--version v2|v3]
Output: ml/reports/evaluation-<version>-results.json
"""

from __future__ import annotations

import argparse
import csv
import json
import math
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.ensemble import RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GroupKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from georakshak_ml import score as b0_score  # noqa: E402

import point_features as PF  # noqa: E402
from common import ML_DIR, PROCESSED  # noqa: E402

DATA = PROCESSED / "training" / "v2"   # set by main() for v3
SEED = 42
N_FOLDS = 5
INNER_FOLDS = 3
BLOCK_DEG = 0.5
OFFSETS = [(0.0, 0.0), (0.25, 0.25)]
BUFFER_M = 5000.0
TARGET_RECALL = 0.70
AREA_FRACTIONS = [0.05, 0.10, 0.20, 0.30, 0.50]
FEATURES = PF.T6


def read(path):
    return list(csv.DictReader(open(path)))


def fnum(rows, cols):
    return np.array([[float(r[c]) for c in cols] for r in rows])


def block_ids(rows, off):
    return np.array([f"{math.floor((float(r['lat']) - off[0]) / BLOCK_DEG)}_{math.floor((float(r['lon']) - off[1]) / BLOCK_DEG)}"
                     for r in rows])


def haversine_matrix(a, b):
    lat1 = np.radians(a[:, 1])[:, None]
    lat2 = np.radians(b[:, 1])[None, :]
    dlat = lat2 - lat1
    dlon = np.radians(b[:, 0])[None, :] - np.radians(a[:, 0])[:, None]
    h = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * 6371008.8 * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def b0_scores(rows):
    cells = []
    for i, r in enumerate(rows):
        f = {"slope_deg_mean": float(r["slope_deg_mean"]), "relief_m": float(r["relief_m"])}
        if r.get("landcover_class") not in (None, ""):
            f["landcover_class"] = int(float(r["landcover_class"]))
        cells.append({"cell_id": i, "features": f, "feature_provenance": {}})
    return np.array([c["score"] for c in b0_score(cells)])


def make_model(kind):
    if kind == "lr":
        return make_pipeline(StandardScaler(), LogisticRegression(C=1.0, class_weight="balanced", max_iter=2000))
    if kind == "rf":
        return RandomForestClassifier(n_estimators=500, min_samples_leaf=5, max_features="sqrt",
                                      class_weight="balanced_subsample", random_state=SEED, n_jobs=-1)
    raise ValueError(kind)


def predict(model, X):
    return model.predict_proba(X)[:, 1]


def threshold_at_recall(pos_scores, recall=TARGET_RECALL):
    """Score t with `recall` of the given positive scores >= t."""
    return float(np.quantile(np.asarray(pos_scores, dtype=float), 1.0 - recall))


def inner_oof_threshold(kind, X, y, groups, coords):
    """t_op from inner GroupKFold OOF scores (same 5 km buffer rule); B0 uses raw training scores."""
    oof = np.full(len(y), np.nan)
    gk = GroupKFold(n_splits=min(INNER_FOLDS, len(set(groups))))
    for tr, te in gk.split(X, y, groups):
        d = haversine_matrix(coords[tr], coords[te])
        keep = tr[(d >= BUFFER_M).all(axis=1)]
        if len(set(y[keep])) < 2:
            continue
        m = make_model(kind).fit(X[keep], y[keep])
        oof[te] = predict(m, X[te])
    mask = ~np.isnan(oof) & (y == 1)
    if mask.sum() < 5:
        return None
    return threshold_at_recall(oof[mask])


def prediction_rate(pos_scores, bg_scores):
    """Capture of positives at given background-area fractions, plus the area under the curve."""
    out = {}
    if len(bg_scores) < 20 or len(pos_scores) == 0:
        return {"capture": {}, "auc": None, "n_background": int(len(bg_scores))}
    for q in AREA_FRACTIONS:
        t = np.quantile(bg_scores, 1.0 - q)
        out[str(q)] = float((np.asarray(pos_scores) >= t).mean())
    qs = np.linspace(0.01, 1.0, 100)
    caps = [float((np.asarray(pos_scores) >= np.quantile(bg_scores, 1.0 - q)).mean()) for q in qs]
    return {"capture": out, "auc": float(np.trapezoid(caps, qs)), "n_background": int(len(bg_scores))}


def evaluate(design_rows, bg_rows, pilot_rows, kinds=("b0", "lr", "rf")):
    y = np.array([int(r["label"]) for r in design_rows])
    X = fnum(design_rows, FEATURES)
    coords = fnum(design_rows, ["lon", "lat"])
    Xbg, Xpilot = fnum(bg_rows, FEATURES), fnum(pilot_rows, FEATURES)
    bg_coords = fnum(bg_rows, ["lon", "lat"])
    b0_all, b0_bg, b0_pilot = b0_scores(design_rows), b0_scores(bg_rows), b0_scores(pilot_rows)
    res = {}
    for kind in kinds:
        per_offset = {}
        for off in OFFSETS:
            groups = block_ids(design_rows, off)
            bg_groups = block_ids(bg_rows, off)
            folds = []
            for tr, te in GroupKFold(n_splits=N_FOLDS).split(X, y, groups):
                d = haversine_matrix(coords[tr], coords[te])
                keep = tr[(d >= BUFFER_M).all(axis=1)]
                if kind == "b0":
                    s_te, s_bg, s_pilot = b0_all[te], b0_bg, b0_pilot
                    t_op = threshold_at_recall(b0_all[keep][y[keep] == 1])
                else:
                    m = make_model(kind).fit(X[keep], y[keep])
                    s_te, s_bg, s_pilot = predict(m, X[te]), predict(m, Xbg), predict(m, Xpilot)
                    t_op = inner_oof_threshold(kind, X[keep], y[keep], groups[keep], coords[keep])
                test_blocks = set(groups[te])
                in_fold = np.array([g in test_blocks for g in bg_groups])
                folds.append({
                    "n_test": int(len(te)), "test_positives": int(y[te].sum()),
                    "n_train_after_buffer": int(len(keep)), "train_positives": int(y[keep].sum()),
                    "train_dropped_by_buffer": int(len(tr) - len(keep)),
                    "roc_auc": float(roc_auc_score(y[te], s_te)) if len(set(y[te])) > 1 else None,
                    "pr_auc": float(average_precision_score(y[te], s_te)) if len(set(y[te])) > 1 else None,
                    "t_op": t_op,
                    "recall_at_t_op": float((s_te[y[te] == 1] >= t_op).mean()) if t_op is not None and y[te].sum() else None,
                    "pilot_area_share_at_t_op": float((s_pilot >= t_op).mean()) if t_op is not None else None,
                    "ner_area_share_at_t_op": float((s_bg >= t_op).mean()) if t_op is not None else None,
                    "prediction_rate_test_blocks": prediction_rate(s_te[y[te] == 1], s_bg[in_fold]),
                })
            per_offset[f"{off[0]}_{off[1]}"] = {"folds": folds, "summary": summarise(folds)}
        res[kind] = {"features": ["slope_deg_mean", "relief_m", "landcover_class"] if kind == "b0" else FEATURES,
                     "by_offset": per_offset, "pooled": pool(per_offset)}
        # final model on all rows of this design
        if kind != "b0":
            m = make_model(kind).fit(X, y)
            groups0 = block_ids(design_rows, OFFSETS[0])
            t_op = inner_oof_threshold(kind, X, y, groups0, coords)
            s_pilot, s_bg = predict(m, Xpilot), predict(m, Xbg)
            final = {"t_op": t_op,
                     "pilot_area_share_at_t_op": float((s_pilot >= t_op).mean()) if t_op else None,
                     "ner_area_share_at_t_op": float((s_bg >= t_op).mean()) if t_op else None,
                     "pilot_score_quantiles": {q: float(np.quantile(s_pilot, float(q))) for q in ("0.5", "0.9", "0.99")}}
            if kind == "lr":
                final["standardised_coefficients"] = dict(zip(FEATURES, [round(float(c), 4) for c in m[-1].coef_[0]]))
                final["intercept"] = float(m[-1].intercept_[0])
                final["scaler_mean"] = dict(zip(FEATURES, [round(float(v), 6) for v in m[0].mean_]))
                final["scaler_scale"] = dict(zip(FEATURES, [round(float(v), 6) for v in m[0].scale_]))
            else:
                final["feature_importances"] = dict(zip(FEATURES, [round(float(v), 4) for v in m.feature_importances_]))
            res[kind]["final_model"] = final
    # diagnostic: exposure proxy alone (never a candidate)
    Xp = fnum(design_rows, ["builtup_share_500m"])
    aucs = []
    for off in OFFSETS:
        groups = block_ids(design_rows, off)
        for tr, te in GroupKFold(n_splits=N_FOLDS).split(Xp, y, groups):
            d = haversine_matrix(coords[tr], coords[te])
            keep = tr[(d >= BUFFER_M).all(axis=1)]
            if len(set(y[keep])) < 2 or len(set(y[te])) < 2:
                continue
            m = make_model("lr").fit(Xp[keep], y[keep])
            aucs.append(float(roc_auc_score(y[te], predict(m, Xp[te]))))
    res["diagnostic_lr_builtup_share_only"] = {"features": ["builtup_share_500m"], "note": "diagnostic, never adoptable",
                                               "roc_auc_pooled_mean": round(float(np.mean(aucs)), 4),
                                               "roc_auc_pooled_std": round(float(np.std(aucs, ddof=1)), 4),
                                               "folds": [round(a, 4) for a in aucs]}
    return res


def summarise(folds):
    out = {"n_folds": len(folds)}
    for k in ("roc_auc", "pr_auc", "recall_at_t_op", "pilot_area_share_at_t_op", "ner_area_share_at_t_op"):
        v = np.array([f[k] for f in folds if f.get(k) is not None], dtype=float)
        if v.size:
            out[k] = {"mean": round(float(v.mean()), 4), "std": round(float(v.std(ddof=1)) if v.size > 1 else 0.0, 4),
                      "min": round(float(v.min()), 4), "max": round(float(v.max()), 4)}
    caps = [f["prediction_rate_test_blocks"] for f in folds]
    cap = {}
    for q in AREA_FRACTIONS:
        v = np.array([c["capture"].get(str(q)) for c in caps if c["capture"]], dtype=float)
        if v.size:
            cap[str(q)] = {"mean": round(float(v.mean()), 4), "std": round(float(v.std(ddof=1)) if v.size > 1 else 0.0, 4)}
    aucs = np.array([c["auc"] for c in caps if c["auc"] is not None], dtype=float)
    out["prediction_rate_capture"] = cap
    if aucs.size:
        out["prediction_rate_auc"] = {"mean": round(float(aucs.mean()), 4), "std": round(float(aucs.std(ddof=1)) if aucs.size > 1 else 0.0, 4)}
    out["test_positives"] = [f["test_positives"] for f in folds]
    return out


def pool(per_offset):
    folds = [f for o in per_offset.values() for f in o["folds"]]
    return summarise(folds)


def main():
    global DATA
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", default="v2", choices=["v2", "v3"])
    args = ap.parse_args()
    DATA = PROCESSED / "training" / args.version
    bg = read(DATA / "background_ner.csv")
    pilot = read(DATA / "pilot_grid_features.csv")
    meta = json.loads((DATA / "build_meta.json").read_text())
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "seed": SEED,
           "features": FEATURES, "buffer_m": BUFFER_M, "block_deg": BLOCK_DEG, "offsets": OFFSETS,
           "target_recall_for_t_op": TARGET_RECALL, "build_meta": meta,
           "n_background_ner": len(bg), "n_pilot_cells": len(pilot), "designs": {}}
    out["label_version"] = args.version
    for design, path in (("exposure_controlled", f"stage_a_{args.version}_exposure.csv"),
                         ("naive", f"stage_a_{args.version}_naive.csv")):
        rows = read(DATA / path)
        print("==", design, len(rows), "rows,", sum(int(r["label"]) == 1 for r in rows), "positives", flush=True)
        out["designs"][design] = evaluate(rows, bg, pilot)
        for kind in ("b0", "lr", "rf"):
            p = out["designs"][design][kind]["pooled"]
            print(f"  {kind:3s} pooled ROC-AUC {p['roc_auc']['mean']:.3f}±{p['roc_auc']['std']:.3f} "
                  f"PR-AUC {p['pr_auc']['mean']:.3f} recall@t_op {p.get('recall_at_t_op', {}).get('mean')} "
                  f"pilot-area {p.get('pilot_area_share_at_t_op', {}).get('mean')}", flush=True)
        print("  diagnostic built-up-share-only ROC-AUC:",
              out["designs"][design]["diagnostic_lr_builtup_share_only"]["roc_auc_pooled_mean"], flush=True)
    path = ML_DIR / "reports" / f"evaluation-{args.version}-results.json"
    path.write_text(json.dumps(out, indent=2))
    print("wrote", path)


if __name__ == "__main__":
    main()
