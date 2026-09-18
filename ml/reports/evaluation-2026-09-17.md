# Stage A evaluation: B1 logistic regression baseline (2026-09-17)

> **Superseded by `evaluation-2026-09-17-v2.md`** (rebuilt labels, exposure-controlled negatives, leakage-safe spatial CV, pre-registered gate). Kept as a record of the naive design.

> **Status: EXPERIMENTAL, NOT ADOPTED.** No trained model is deployed. `georakshak_ml` still serves `b0-rules-0.1.0`.
> Every number below comes from `ml/reports/evaluation-results-1km.json` and `evaluation-results-5km.json`, which
> `ml/pipeline/train_stage_a.py` computed from tables built by `ml/pipeline/stage_a_dataset.py` (seed 42).
> **Main finding:** the available real labels (NASA GLC/COOLR, media-derived) mostly encode *where landslides get reported*
> (built-up places), not *where the terrain is susceptible*. The best-scoring model owes its score to a reporting-bias proxy.

## 1. Why the training area is NER-wide, not the pilot

The Aizawl pilot bbox holds 19 catalogue records: 17 with accuracy ≤ 5 km, 8 with ≤ 1 km, and 18 of 19 within 3.7 km of the city centre.
That is too few, and too clustered, for spatial block CV (ml-strategy §7 step 1 allows a wider training area). So the training
area is **all COOLR/GLC records in the 8 NER states of India** (504 records, event years 2007–2021).

## 2. Data and labels (ml-strategy §4)

| | 1 km set | 5 km set |
|---|---|---|
| Positive records (accuracy `exact`/`1km` · or also `5km`) | 106 | 269 |
| Positives after dedup within 500 m | 101 | 240 |
| Negatives sampled (5 per positive) | 505 | 1,200 |
| Dropped: DEM window at tile edge / WorldCover edge or no-data / negative in water | 8 / 1 / 8 | 19 / 4 / 9 |
| **Rows used (positives)** | **590 (101)** | **1,412 (238)** |
| Spatial blocks (0.5° × 0.5°) / with positives | 70 / 38 | 89 / 56 |

- **Negatives are "unlabelled", not true negatives.** They are random points within 30 km of a positive and > 2 km from any NER record with accuracy ≤ 5 km. Some fall in Bangladesh, Myanmar or Bhutan near the border. I did not filter them by country, because I have no official boundary.
- **Features:** each ~500 m window is centred on the point. From Copernicus DEM GLO-30: slope mean/max, elevation mean, relief. From ESA WorldCover 2021: tree-cover share and built-up share. Slope uses a geographic window with local metre scaling (an approximation). `past_landslide_density` is excluded because it would leak labels. `dist_to_road_m` is not computed.
- **Label noise:** positive locations carry 1 km (or 5 km) uncertainty, while the feature windows are 500 m. Many records sit at the gazetteer or town location.

## 3. Validation scheme

- **Spatial block CV:** `GroupKFold(5)` over 0.5° blocks, so no block appears in both train and test.
- **Random stratified 5-fold:** reported only for comparison, and **optimistic** by construction.
- **Model:** `StandardScaler` + `LogisticRegression(class_weight="balanced")`, with no hyperparameter tuning and no calibration.
- **B0 comparison:** the `georakshak_ml` B0 score with no rainfall (slope_deg_mean, relief_m, landcover_class), untrained, scored on the same test folds.
- **Metrics:** ROC-AUC, PR-AUC (average precision), and recall of positives in the top 20 % of test **samples** by score. Because the data is case-control, this is not an area share, and "share of area flagged" (ml-strategy §9) **cannot** be computed from this design.

## 4. Results (spatial block CV, mean ± sample std across 5 folds; min–max in brackets)

### 4.1 1 km set (590 samples, 101 positives; test-fold positives 24/18/17/22/20; test prevalence 0.171 ± 0.024)

| Model | ROC-AUC | PR-AUC | Recall @ top 20 % samples | Random-CV ROC-AUC (optimistic) |
|---|---|---|---|---|
| B0 rules, terrain only (untrained) | 0.458 ± 0.060 [0.363–0.511] | 0.157 ± 0.020 | 0.116 ± 0.072 | — |
| B1 terrain | 0.627 ± 0.084 [0.544–0.752] | 0.320 ± 0.087 | 0.283 ± 0.066 | 0.644 |
| B1 terrain + tree share | 0.716 ± 0.082 [0.579–0.779] | 0.423 ± 0.090 | 0.480 ± 0.103 | 0.718 |
| B1 terrain + tree + **built-up share** | 0.854 ± 0.083 [0.709–0.919] | 0.763 ± 0.111 | 0.702 ± 0.102 | 0.854 |

### 4.2 5 km set (1,412 samples, 238 positives; test-fold positives 60/42/45/49/42; test prevalence 0.169 ± 0.026)

| Model | ROC-AUC | PR-AUC | Recall @ top 20 % samples | Random-CV ROC-AUC (optimistic) |
|---|---|---|---|---|
| B0 rules, terrain only (untrained) | 0.432 ± 0.058 [0.341–0.486] | 0.144 ± 0.024 | 0.119 ± 0.033 | — |
| B1 terrain | 0.609 ± 0.041 [0.549–0.653] | 0.254 ± 0.073 | 0.266 ± 0.070 | 0.627 |
| B1 terrain + tree share | 0.678 ± 0.046 [0.621–0.730] | 0.342 ± 0.076 | 0.367 ± 0.059 | 0.688 |
| B1 terrain + tree + **built-up share** | 0.817 ± 0.048 [0.767–0.869] | 0.680 ± 0.083 | 0.636 ± 0.061 | 0.828 |

### 4.3 Standardised coefficients (full-data fit, 1 km set)
- terrain: slope_deg_mean −1.89, slope_deg_max +1.28, elevation +0.15, relief +0.38
- terrain + tree + built-up: slope_deg_mean −1.20, slope_deg_max +1.30, elevation +0.05, relief +0.32, tree −0.09, **built-up +2.73**

### 4.4 Diagnostic: medians/means by label (from the training tables)

| Set | Label | n | median slope_deg_mean | median relief_m | mean built-up share | share of windows with built-up > 0.2 | mean tree share |
|---|---|---|---|---|---|---|---|
| 1 km | positive | 101 | 16.3 | 134.7 | 0.269 | 0.475 | 0.616 |
| 1 km | unlabelled | 489 | 20.1 | 161.1 | 0.009 | 0.010 | 0.818 |
| 5 km | positive | 238 | 17.4 | 140.2 | 0.230 | 0.403 | 0.646 |
| 5 km | unlabelled | 1,174 | 21.6 | 180.7 | 0.008 | 0.007 | 0.801 |

## 5. Interpretation

1. **Reporting bias dominates.** Catalogue positives lie in built-up windows about 40–48 % of the time, against ~1 % for random nearby points. Adding built-up share lifts spatial ROC-AUC from 0.72 to 0.85 (1 km set). This matches the warning in ml-strategy §4 about road/settlement proxies. **The 0.85 score must not be presented as landslide susceptibility skill.**
2. **Terrain signal is weak and inverted in the mean.** Positives have *lower* median mean-slope than nearby random points (16° vs 20°). Towns sit on ridges and gentler benches, and that is where reports are geolocated. A positive `slope_deg_max` coefficient alongside a negative `slope_deg_mean` coefficient is consistent with local cut slopes inside settled areas. It could also be label-location noise.
3. **B0's terrain ranking scores below 0.5 ROC-AUC against these labels.** That does not show B0 is wrong about physical susceptibility. It shows these labels cannot validate or calibrate a terrain susceptibility index. In the other direction, B0 has no validated skill either.
4. **Fold variance is large** (1 km ROC-AUC range 0.54–0.75 for terrain-only). With ~20 test positives per fold, differences under ~0.1 AUC between models are not reliable.
5. Spatial and random CV give similar numbers here, so spatial autocorrelation at the 0.5° block scale is not the main source of optimism. Label bias is.

## 6. Decision and what data is missing

- **Do not adopt B1.** Keep `b0-rules-0.1.0` (uncalibrated, stated as such) until a model beats it on a label set that is not dominated by reporting location. `active_model()` keeps returning `metrics: None`.
- **Missing data needed for a meaningful Stage A model:**
  1. **A mapped (polygon or precise point) landslide inventory** independent of media reporting: the GSI national landslide inventory (Bhukosh was unreachable in the spike), or published NER research inventories mapped from imagery.
  2. **Exposure-controlled negatives:** sample negatives stratified by built-up share and road distance, or restrict the analysis to non-built-up windows. That requires `dist_to_road_m` (OSM) NER-wide.
  3. **Geology/lithology** (GSI), and an NDVI composite (Sentinel-2) for OR-03.
  4. **Stage B (dated, rainfall-triggered):** 502 of the 504 NER records carry an event date, but with 1–50 km location accuracy against 25 km IMD rainfall. There are only 4 records after 2018. A temporal holdout (for example train ≤ 2015, test 2016–2021) is feasible in size, but has not been run. The data-sufficiency gate (ml-strategy §9) is **not yet evaluated**.
- **Not computed (so not claimed):** calibration/Brier score, success-rate curves, area-based recall vs. area flagged, performance by elevation band, any Stage B or forecast skill.

## 7. Reproduce

```bash
cd ml/pipeline
../.venv/bin/python stage_a_dataset.py --accuracy 1km && ../.venv/bin/python train_stage_a.py --accuracy 1km
../.venv/bin/python stage_a_dataset.py --accuracy 5km && ../.venv/bin/python train_stage_a.py --accuracy 5km
```
Negative sampling depends on the COOLR snapshot in `data/raw/nasa_glc/` (retrieved 2026-09-17), so a re-download may change the numbers.
