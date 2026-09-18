"""Stage A v4 evaluation: terrain vs terrain+hydrology vs terrain+hydrology+soil, same protocol and gate as v3.

Implements ml/reports/evaluation-2026-09-18-v4.md §1. Reuses every helper from train_stage_a_v2 (blocks, 5 km
leakage buffer, inner-OOF operating threshold, prediction-rate curve, B0 comparison) so v3 and v4 differ only in
the feature columns.

Usage: ml/.venv/bin/python ml/pipeline/train_stage_a_v4.py
Output: ml/reports/evaluation-v4-results.json
"""

from __future__ import annotations

import json
from datetime import datetime, timezone

import numpy as np
from sklearn.inspection import permutation_importance
from sklearn.metrics import average_precision_score, roc_auc_score
from sklearn.model_selection import GroupKFold

import hydro_features as H
import soil_features as S
import train_stage_a_v2 as T
from common import ML_DIR, PROCESSED

DATA = PROCESSED / "training" / "v4"
T6 = T.FEATURES
FEATURE_SETS = {"T6": T6, "T6+H6": T6 + H.H6, "T6+H6+S": T6 + H.H6 + S.S5}
PRIMARY = "T6+H6+S"
MAX_MISSINGNESS = 0.05
FIXED_PILOT_AREA = 0.30
TARGET_RECALL_FOR_AREA = 0.70


def complete(rows, feats):
    ok = [r for r in rows if all(r.get(f) not in (None, "") for f in feats)]
    return ok, len(rows) - len(ok)


def missing_share(rows, feats):
    return {f: round(sum(1 for r in rows if r.get(f) in (None, "")) / max(1, len(rows)), 4) for f in feats}


def evaluate_set(name, feats, rows, bg, pilot, want_importance=False):
    rows, dropped = complete(rows, feats)
    bg_rows, bg_dropped = complete(bg, feats)
    pilot_rows, pilot_dropped = complete(pilot, feats)
    y = np.array([int(r["label"]) for r in rows])
    X, coords = T.fnum(rows, feats), T.fnum(rows, ["lon", "lat"])
    Xbg, Xpilot = T.fnum(bg_rows, feats), T.fnum(pilot_rows, feats)
    bg_coords_groups = {off: T.block_ids(bg_rows, off) for off in T.OFFSETS}
    b0_all, b0_bg, b0_pilot = T.b0_scores(rows), T.b0_scores(bg_rows), T.b0_scores(pilot_rows)
    res = {"features": feats, "rows": len(rows), "positives": int(y.sum()),
           "dropped_incomplete": {"training": dropped, "background": bg_dropped, "pilot": pilot_dropped},
           "models": {}}
    for kind in ("b0", "lr", "rf"):
        per_offset, imps = {}, []
        for off in T.OFFSETS:
            groups = T.block_ids(rows, off)
            folds = []
            for tr, te in GroupKFold(n_splits=T.N_FOLDS).split(X, y, groups):
                d = T.haversine_matrix(coords[tr], coords[te])
                keep = tr[(d >= T.BUFFER_M).all(axis=1)]
                if kind == "b0":
                    s_te, s_bg, s_pilot = b0_all[te], b0_bg, b0_pilot
                    t_op = T.threshold_at_recall(b0_all[keep][y[keep] == 1])
                else:
                    m = T.make_model(kind).fit(X[keep], y[keep])
                    s_te, s_bg, s_pilot = T.predict(m, X[te]), T.predict(m, Xbg), T.predict(m, Xpilot)
                    t_op = T.inner_oof_threshold(kind, X[keep], y[keep], groups[keep], coords[keep])
                    if want_importance:
                        pi = permutation_importance(m, X[te], y[te], scoring="roc_auc", n_repeats=5, random_state=T.SEED)
                        imps.append(pi.importances_mean)
                pos = s_te[y[te] == 1]
                # extra metrics requested for v4
                t_fixed_area = float(np.quantile(s_pilot, 1 - FIXED_PILOT_AREA))
                t_recall = float(np.quantile(pos, 1 - TARGET_RECALL_FOR_AREA)) if pos.size else None
                in_fold = np.array([g in set(groups[te]) for g in bg_coords_groups[off]])
                folds.append({
                    "n_test": int(len(te)), "test_positives": int(y[te].sum()),
                    "n_train_after_buffer": int(len(keep)),
                    "roc_auc": float(roc_auc_score(y[te], s_te)) if len(set(y[te])) > 1 else None,
                    "pr_auc": float(average_precision_score(y[te], s_te)) if len(set(y[te])) > 1 else None,
                    "t_op": t_op,
                    "recall_at_t_op": float((pos >= t_op).mean()) if t_op is not None and pos.size else None,
                    "pilot_area_share_at_t_op": float((s_pilot >= t_op).mean()) if t_op is not None else None,
                    "ner_area_share_at_t_op": float((s_bg >= t_op).mean()) if t_op is not None else None,
                    "recall_at_30pct_pilot_area": float((pos >= t_fixed_area).mean()) if pos.size else None,
                    "pilot_area_for_70pct_recall": float((s_pilot >= t_recall).mean()) if t_recall is not None else None,
                    "ner_area_for_70pct_recall": float((s_bg >= t_recall).mean()) if t_recall is not None else None,
                    "prediction_rate_test_blocks": T.prediction_rate(pos, s_bg[in_fold]),
                })
            per_offset[f"{off[0]}_{off[1]}"] = {"folds": folds, "summary": summarise(folds)}
        entry = {"by_offset": per_offset, "pooled": pool(per_offset)}
        if kind != "b0":
            m = T.make_model(kind).fit(X, y)
            groups0 = T.block_ids(rows, T.OFFSETS[0])
            t_op = T.inner_oof_threshold(kind, X, y, groups0, coords)
            s_pilot = T.predict(m, Xpilot)
            entry["final_model"] = {"t_op": t_op,
                                    "pilot_area_share_at_t_op": float((s_pilot >= t_op).mean()) if t_op else None,
                                    "ner_area_share_at_t_op": float((T.predict(m, Xbg) >= t_op).mean()) if t_op else None}
            if kind == "lr":
                entry["final_model"]["standardised_coefficients"] = dict(
                    zip(feats, [round(float(c), 4) for c in m[-1].coef_[0]]))
            else:
                entry["final_model"]["feature_importances"] = dict(
                    zip(feats, [round(float(v), 4) for v in m.feature_importances_]))
            if want_importance and imps:
                arr = np.vstack(imps)
                entry["permutation_importance_roc_auc"] = {
                    f: {"mean": round(float(arr[:, i].mean()), 4), "std": round(float(arr[:, i].std(ddof=1)), 4)}
                    for i, f in enumerate(feats)}
        res["models"][kind] = entry
    return res


EXTRA = ("roc_auc", "pr_auc", "recall_at_t_op", "pilot_area_share_at_t_op", "ner_area_share_at_t_op",
         "recall_at_30pct_pilot_area", "pilot_area_for_70pct_recall", "ner_area_for_70pct_recall")


def summarise(folds):
    out = {"n_folds": len(folds), "test_positives": [f["test_positives"] for f in folds]}
    for k in EXTRA:
        v = np.array([f[k] for f in folds if f.get(k) is not None], dtype=float)
        if v.size:
            out[k] = {"mean": round(float(v.mean()), 4), "std": round(float(v.std(ddof=1)) if v.size > 1 else 0.0, 4),
                      "min": round(float(v.min()), 4), "max": round(float(v.max()), 4)}
    caps = [f["prediction_rate_test_blocks"] for f in folds]
    cap = {}
    for q in T.AREA_FRACTIONS:
        v = np.array([c["capture"].get(str(q)) for c in caps if c["capture"]], dtype=float)
        if v.size:
            cap[str(q)] = round(float(v.mean()), 4)
    out["prediction_rate_capture_mean"] = cap
    aucs = np.array([c["auc"] for c in caps if c["auc"] is not None], dtype=float)
    if aucs.size:
        out["prediction_rate_auc"] = {"mean": round(float(aucs.mean()), 4), "std": round(float(aucs.std(ddof=1)), 4)}
    return out


def pool(per_offset):
    return summarise([f for o in per_offset.values() for f in o["folds"]])


def main():
    meta = json.loads((DATA / "build_meta.json").read_text())
    bg = T.read(DATA / "background_ner.csv")
    pilot = T.read(DATA / "pilot_grid_features.csv")
    out = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
           "protocol": "identical to v3 (GSI positives, exposure-matched negatives, 0.5 deg blocks, 2 offsets, "
                       "5 km leakage buffer, seed 42, t_op at 70 % training recall from inner OOF)",
           "feature_sets": FEATURE_SETS, "primary": PRIMARY, "max_missingness_for_inclusion": MAX_MISSINGNESS,
           "build_meta": meta, "n_background": len(bg), "n_pilot_cells": len(pilot), "designs": {}}
    # missingness check that decides which features may be in the candidate set
    exposure_rows = T.read(DATA / "stage_a_v4_exposure.csv")
    checked = H.H6 + H.H_REPORTED_ONLY + S.S5
    out["missingness_training_exposure"] = missing_share(exposure_rows, checked)
    out["missingness_pilot"] = missing_share(pilot, checked)
    out["excluded_for_missingness"] = [f for f in checked
                                       if out["missingness_training_exposure"][f] > MAX_MISSINGNESS
                                       or out["missingness_pilot"][f] > MAX_MISSINGNESS]
    print("missingness (training):", json.dumps(out["missingness_training_exposure"]))
    print("missingness (pilot):", json.dumps(out["missingness_pilot"]))
    print("excluded for missingness:", out["excluded_for_missingness"], flush=True)

    for design, fn in (("exposure_controlled", "stage_a_v4_exposure.csv"), ("naive", "stage_a_v4_naive.csv")):
        rows = T.read(DATA / fn)
        out["designs"][design] = {}
        for name, feats in FEATURE_SETS.items():
            feats = [f for f in feats if f not in out["excluded_for_missingness"]]
            r = evaluate_set(name, feats, rows, bg, pilot, want_importance=(name == PRIMARY))
            out["designs"][design][name] = r
            print(f"== {design} / {name} ({len(feats)} features, {r['rows']} rows, {r['positives']} pos, "
                  f"dropped {r['dropped_incomplete']})", flush=True)
            for kind in ("b0", "lr", "rf"):
                p = r["models"][kind]["pooled"]
                print(f"   {kind:3s} ROC {p['roc_auc']['mean']:.3f}±{p['roc_auc']['std']:.3f} "
                      f"PR {p['pr_auc']['mean']:.3f} recall@t_op {p['recall_at_t_op']['mean']:.3f} "
                      f"pilot@t_op {p['pilot_area_share_at_t_op']['mean']:.3f} "
                      f"recall@30%pilot {p['recall_at_30pct_pilot_area']['mean']:.3f} "
                      f"pilotArea@70%recall {p['pilot_area_for_70pct_recall']['mean']:.3f}", flush=True)
    path = ML_DIR / "reports" / "evaluation-v4-results.json"
    path.write_text(json.dumps(out, indent=2))
    print("wrote", path)


if __name__ == "__main__":
    main()
