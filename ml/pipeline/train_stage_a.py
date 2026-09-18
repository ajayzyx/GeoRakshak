"""Stage A baseline B1: logistic regression with spatial block cross-validation (ml-strategy §5-§9).

Usage: ml/.venv/bin/python ml/pipeline/train_stage_a.py --accuracy 1km
Reads ml/data/processed/training/stage_a_<acc>.csv, writes ml/reports/evaluation-results-<acc>.json.
Every number in the evaluation report must come from this JSON.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GroupKFold, StratifiedKFold
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from georakshak_ml import score as b0_score  # noqa: E402

from common import ML_DIR, PROCESSED  # noqa: E402

SEED = 42
N_FOLDS = 5
FEATURE_SETS = {
    "terrain": ["slope_deg_mean", "slope_deg_max", "elevation_m_mean", "relief_m"],
    "terrain+landcover": ["slope_deg_mean", "slope_deg_max", "elevation_m_mean", "relief_m", "landcover_tree_share"],
    "terrain+landcover+builtup": ["slope_deg_mean", "slope_deg_max", "elevation_m_mean", "relief_m",
                                  "landcover_tree_share", "landcover_builtup_share"],
}


def load(path):
    import csv
    rows = list(csv.DictReader(open(path)))
    return rows


def top_share_recall(y, s, share=0.2):
    """Recall of positives among the top `share` of test SAMPLES by score (sample-based, NOT area-based)."""
    k = max(1, int(round(share * len(s))))
    idx = np.argsort(-s, kind="stable")[:k]
    return float(y[idx].sum() / max(1, y.sum()))


def fold_metrics(y, s):
    if len(set(y)) < 2:
        return None
    return {"n": int(len(y)), "positives": int(y.sum()), "roc_auc": float(roc_auc_score(y, s)),
            "pr_auc": float(average_precision_score(y, s)), "prevalence": float(y.mean()),
            "recall_top20pct_samples": top_share_recall(y, s)}


def summarise(folds):
    folds = [f for f in folds if f is not None]
    out = {"folds_evaluated": len(folds)}
    for k in ("roc_auc", "pr_auc", "recall_top20pct_samples", "prevalence"):
        v = np.array([f[k] for f in folds])
        out[k] = {"mean": round(float(v.mean()), 4), "std": round(float(v.std(ddof=1)) if len(v) > 1 else 0.0, 4),
                  "min": round(float(v.min()), 4), "max": round(float(v.max()), 4)}
    return out


def b0_terrain_scores(rows):
    cells = [{"cell_id": i, "features": {"slope_deg_mean": float(r["slope_deg_mean"]), "relief_m": float(r["relief_m"]),
                                         "landcover_class": int(r["landcover_class"])}, "feature_provenance": {}}
             for i, r in enumerate(rows)]
    return np.array([c["score"] for c in b0_score(cells)])


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accuracy", choices=["1km", "5km"], default="1km")
    args = ap.parse_args()
    path = PROCESSED / "training" / f"stage_a_{args.accuracy}.csv"
    rows = load(path)
    meta = json.loads(path.with_suffix(".meta.json").read_text())
    y = np.array([int(r["label"]) for r in rows])
    groups = np.array([r["block_id"] for r in rows])
    blocks_with_pos = sorted({g for g, l in zip(groups, y) if l == 1})
    b0 = b0_terrain_scores(rows)

    result = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "dataset": str(path.relative_to(ML_DIR)),
              "dataset_meta": meta, "n_samples": int(len(y)), "n_positives": int(y.sum()),
              "n_blocks": int(len(set(groups))), "n_blocks_with_positives": len(blocks_with_pos),
              "block_size_deg": 0.5, "seed": SEED, "models": {}}

    gkf = GroupKFold(n_splits=N_FOLDS)
    skf = StratifiedKFold(n_splits=N_FOLDS, shuffle=True, random_state=SEED)
    for name, feats in FEATURE_SETS.items():
        X = np.array([[float(r[f]) for f in feats] for r in rows])
        spatial, random_cv, b0_spatial = [], [], []
        for tr, te in gkf.split(X, y, groups):
            m = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000))
            m.fit(X[tr], y[tr])
            spatial.append(fold_metrics(y[te], m.predict_proba(X[te])[:, 1]))
            b0_spatial.append(fold_metrics(y[te], b0[te]))
        for tr, te in skf.split(X, y):
            m = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000))
            m.fit(X[tr], y[tr])
            random_cv.append(fold_metrics(y[te], m.predict_proba(X[te])[:, 1]))
        full = make_pipeline(StandardScaler(), LogisticRegression(class_weight="balanced", max_iter=1000)).fit(X, y)
        coefs = dict(zip(feats, [round(float(c), 4) for c in full[-1].coef_[0]]))
        result["models"][f"b1_logreg[{name}]"] = {
            "features": feats, "spatial_block_cv": {"folds": spatial, "summary": summarise(spatial)},
            "random_stratified_cv_OPTIMISTIC": {"summary": summarise(random_cv)},
            "standardised_coefficients_full_fit": coefs,
        }
        if "b0_terrain_rules_same_folds" not in result["models"]:
            result["models"]["b0_terrain_rules_same_folds"] = {
                "features": ["slope_deg_mean", "relief_m", "landcover_class"],
                "note": "georakshak_ml B0 score without rainfall; untrained; evaluated on the same spatial test folds",
                "spatial_block_cv": {"folds": b0_spatial, "summary": summarise(b0_spatial)}}
    out = ML_DIR / "reports" / f"evaluation-results-{args.accuracy}.json"
    out.write_text(json.dumps(result, indent=2))
    for k, v in result["models"].items():
        s = v["spatial_block_cv"]["summary"]
        print(f"{k:45s} spatial ROC-AUC {s['roc_auc']['mean']:.3f}±{s['roc_auc']['std']:.3f} "
              f"PR-AUC {s['pr_auc']['mean']:.3f}±{s['pr_auc']['std']:.3f}  "
              + (f"random ROC-AUC {v['random_stratified_cv_OPTIMISTIC']['summary']['roc_auc']['mean']:.3f}"
                 if "random_stratified_cv_OPTIMISTIC" in v else ""))
    print("n", result["n_samples"], "pos", result["n_positives"], "blocks", result["n_blocks"], "blocks w/ pos", result["n_blocks_with_positives"])


if __name__ == "__main__":
    main()
