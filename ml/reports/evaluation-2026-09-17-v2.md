# Stage A evaluation v2: exposure-controlled, leakage-safe spatial CV (2026-09-17)

> Supersedes the modelling conclusions of `evaluation-2026-09-17.md` (naive design). That earlier report stays as a record.
> §1 (pre-registration) was written at **2026-09-17T17:52:54Z**, before any model was trained or evaluated on the rebuilt
> datasets. The only model results seen beforehand are those in `evaluation-2026-09-17.md`. §1 was not edited after results
> existed. Any deviation is listed in §5.

## 1. Pre-registration (written before results)

### 1.1 Inventory
- **GSI Bhukosh (S15)** was retried on 2026-09-17 between 17:48 and 17:49 UTC. DNS resolves to 144.24.99.164, but every TCP connect to ports 443 and 80 timed out after 6 s (7 attempts, log: `ml/data/raw/gsi/gsi_attempts_20260917.tsv`). `gsi.gov.in` loads, but its JS-rendered home page exposed no Bhukosh or GIS service link. **GSI is not used.**
- **Fallback used (approved S16): NASA Global Landslide Catalog records served by the NASA COOLR "Reports Points" feature service**, snapshot `ml/data/raw/nasa_glc/coolr_reports_points_ner_bbox.geojson` (retrieved 2026-09-17, 879 features in 88–97.5°E, 21.5–29.5°N).

### 1.2 Label checks done before design (data checks, not model results)
- No duplicate `event_id`s. One pair of records has identical coordinates. 7 pairs (accuracy ≤ 5 km) share an event date and lie within 2 km of each other, which suggests duplicate reports.
- **Dates:** the COOLR epoch equals the legacy CSV date and time read as UTC wall-clock for all but 3 of ~600 shared records. So the UTC calendar date is the catalogue date, and the handoff `event_date` convention is correct. 2 NER records have no date (irrelevant to Stage A).
- **Mask:** 504 records are labelled with one of the 8 NER states. 3 of them sit in border cells that the IMD 0.25° grid leaves undefined (Ngur, Mizoram; Sabroom, Tripura; Tuitung, Manipur). These are real Indian places, so **positives are selected by state label, not by a raster mask**.
- **Problems found in the old training table (`stage_a_*.csv`):** 9 of 489 negatives fall outside India according to the IMD grid mask, 12 fall outside the approximate NER mask, and negative exclusion ignored location accuracy. **Labels are rebuilt** as described below.
- `past_landslide_density` was not in any trained feature set, and stays out.

### 1.3 Datasets (seed 42 everywhere)
- **Primary label set:** COOLR records with `country_code = IN`, admin division (accent-folded) in the 8 NER states, and `location_accuracy ∈ {exact, 1km}`.
  - **Dedup,** processed in order of accuracy (exact first) then `event_id`: drop a record if an already-kept record has the same event date and lies within 2 km (duplicate report), or lies within 500 m (overlapping feature window).
  - The 5 km set is not run in v2.
- **Approximate NER-India mask** (for negatives and background only): IMD 0.25° cells defined in `ind2017_rfp25.grd` (India land) whose grid point has lon ≥ 90.0, or lat ≥ 27.25 and 88.0 ≤ lon ≤ 88.75 (Sikkim box). This is an approximation, **not an administrative boundary**.
- **Negative exclusion buffer:** candidates within `max(1 km, stated accuracy) + 0.5 km` of **any** COOLR record with accuracy ≤ 5 km (any country) are rejected. Records with 10 km or coarser accuracy cannot be buffered meaningfully and are ignored.
- **Candidate generator (both designs):** pick a random kept positive, then a random point uniformly within 30 km of it. The point must be inside the mask, outside the exclusion buffers, and have a 500 m WorldCover window that is not majority water (80) and has ≥ 50 % valid pixels.
- **Design N (naive):** 5 negatives per positive from the candidate generator.
- **Design E (exposure-controlled, target-group background):**
  - Exposure `X` is the fraction of 100 m blocks containing ≥ 1 WorldCover 2021 built-up (class 50) pixel within the 11 × 11 block (≈ 1.1 km) neighbourhood of the point.
  - Bins: `X = 0`, `(0, 0.1]`, `(0.1, 0.3]`, `(0.3, 0.6]`, `(0.6, 1]`.
  - Negatives are frequency-matched: 5 × (positives in bin) per bin, taken in candidate order. Any shortfall is reported.
- **Features, both designs:** a 500 m × 500 m square centred on the point in its UTM zone (EPSG:32645/46/47). Copernicus DEM GLO-30 is bilinearly resampled to 25 m with a 1-pixel margin, then Horn slope/aspect is computed. This is the same method as the pilot grid.
  - **Candidate feature set T6 (terrain only):** `slope_deg_mean`, `slope_deg_max`, `elevation_m_mean`, `relief_m`, `aspect_sin_mean`, `aspect_cos_mean`. Aspect means use pixels with slope ≥ 2°.
  - **Exposure proxies, excluded from every candidate:** built-up share, `X`, distance to road/settlement, population, `landcover_class` (includes class 50 = built-up), and `landcover_tree_share` (partial proxy for settlement clearing).
  - **Diagnostic only, never adoptable:** a one-feature LR on the 500 m built-up share. It checks whether design E removed the exposure signal.
- **Regular backgrounds** (unlabelled, used for area shares):
  - (i) the Aizawl pilot grid: 2,798 cells, T6 computed at cell centroids with the same point function;
  - (ii) the **NER background**: 2,000 points uniform by area within the approximate NER mask, seed 42.

### 1.4 Validation
- **Spatial block CV:** 0.5° × 0.5° blocks, `GroupKFold(n_splits=5)` without shuffle, at **two block-grid offsets**: (0°, 0°) and (0.25°, 0.25°).
- **Leakage buffer 5 km:** every training sample within 5 km (haversine) of any test sample of that fold is removed from training.
  - **Why 5 km:** positives carry ≤ 1 km location uncertainty and a 0.5 km feature window, and duplicate reports of one event were found up to 2 km apart. 5 km exceeds the sum of these (≈ 3.5 km) with margin, and also covers the hillslope-scale autocorrelation of 25 m terrain derivatives.
- **Models,** fixed hyperparameters with no tuning:
  - **B0:** `georakshak_ml` b0-rules-0.1.0 score without rainfall, from `slope_deg_mean`, `relief_m` and the 500 m majority `landcover_class`. Untrained, comparison only.
  - **LR:** `StandardScaler` + `LogisticRegression(C=1.0, class_weight="balanced", max_iter=2000)`.
  - **RF:** `RandomForestClassifier(n_estimators=500, min_samples_leaf=5, max_features="sqrt", class_weight="balanced_subsample", random_state=42)`.
- **Operating threshold `t_op`,** per outer fold and model: the score at which 70 % of training-fold positives score ≥ `t_op`. It is computed on **inner out-of-fold** scores from `GroupKFold(3)` over the same blocks inside the training fold, with the same 5 km buffer. For B0, the raw training-fold scores are used.
- **Per-fold metrics:**
  - ROC-AUC and PR-AUC on the test fold;
  - recall of test positives at `t_op`;
  - share of pilot cells with score ≥ `t_op`;
  - share of all NER background points with score ≥ `t_op`;
  - a prediction-rate curve: capture of test positives at 10 / 20 / 30 / 50 % of background area, using background points inside the test-fold blocks, plus the area under that curve.
- **Reporting:** mean ± sample std across folds, per offset, with test positive counts. Random-split numbers are not computed.

### 1.5 Adoption gate (design E, primary label set, candidates LR-T6 and RF-T6)
A candidate is adopted only if **all** of the following hold:

| # | Criterion |
|---|---|
| a | For **each** offset: mean test ROC-AUC ≥ 0.65, **and** every fold ROC-AUC > 0.5 |
| b | For **each** offset: mean ROC-AUC > B0's mean ROC-AUC on the same folds |
| c | RF may be adopted only if its mean ROC-AUC, pooled over both offsets' 10 folds, exceeds LR's by more than LR's pooled fold std. Otherwise LR is the choice if LR passes. RF cannot be adopted when (c) fails, even if LR fails |
| d | No exposure-proxy feature (T6 satisfies this by construction; verified in code) |
| e | Mean pilot-area share at `t_op` across all 10 folds ≤ 0.30, **and** the final model's pilot share ≤ 0.30. The final model is fit on all design-E data, with `t_op` at 70 % recall of offset-(0,0) out-of-fold positive scores. Reported together with recall |

If nothing passes, `b0-rules-0.1.0` stays the served model.

**If adopted:**
- Serving normalisation: `S = min(1, 0.9 · raw / t_op)`, so a cell at `t_op` reaches exactly HIGH (0.45) without rain. Severity cut-offs are unchanged (H11 pending).
- Contributions are precomputed offline: LR as coefficient × standardised value; RF as exact Shapley values over the 6 features.
- Model version: `stage-a-<lr|rf>-0.1.0+trigger-rules-0.1.0`.

## 2. Results

All numbers come from `ml/reports/evaluation-v2-results.json` (build inputs: `ml/data/processed/training/v2/build_meta.json`).

### 2.0 Datasets actually built
- Positives: 106 NER-India records with accuracy `exact`/`1km` → **100 kept** (dedup dropped 4 as same-event-within-2 km and 2 as within-500 m). 523 records (any country, accuracy ≤ 5 km) supplied the negative exclusion buffers. Exposure bins (`X` = built-up block density in ≈1.1 km): `X=0`: 10, `(0,0.1]`: 10, `(0.1,0.3]`: 24, `(0.3,0.6]`: 19, `(0.6,1]`: 37.
- Negatives: 500 per design. Design E filled every bin quota (50/50/120/95/185) with no shortfall, from 38,085 examined candidates.
- Minimum positive-to-negative distance: 2,015 m (design N), 1,512 m (design E), consistent with the accuracy-aware buffers.
- Backgrounds: 1,500 NER points (60 clustered patches, see §5) and 2,798 pilot cells. No point was dropped for a DEM or WorldCover gap.

### 2.1 Design E (exposure-controlled) — gated results, T6 terrain-only features

| Model | Offset | ROC-AUC (mean ± std) | fold ROC-AUC min–max | PR-AUC | Recall @ t_op | Pilot area flagged @ t_op | NER area flagged @ t_op |
|---|---|---|---|---|---|---|---|
| B0 (untrained) | (0, 0) | 0.694 ± 0.138 | 0.497 – 0.875 | 0.327 | 0.678 | 0.936 | 0.582 |
| B0 (untrained) | (0.25, 0.25) | 0.729 ± 0.108 | 0.568 – 0.852 | 0.307 | 0.669 | 0.937 | 0.583 |
| **LR-T6** | (0, 0) | 0.685 ± 0.122 | **0.476** – 0.767 | 0.320 | 0.693 | 0.915 | 0.597 |
| **LR-T6** | (0.25, 0.25) | 0.711 ± 0.080 | 0.617 – 0.802 | 0.318 | 0.707 | 0.912 | 0.610 |
| **RF-T6** | (0, 0) | 0.743 ± 0.079 | 0.656 – 0.845 | 0.409 | 0.643 | 0.620 | 0.388 |
| **RF-T6** | (0.25, 0.25) | 0.751 ± 0.060 | 0.702 – 0.853 | 0.416 | 0.661 | 0.741 | 0.494 |

Pooled over both offsets (10 folds): B0 0.711 ± 0.119, LR 0.698 ± 0.099, RF 0.747 ± 0.066.
Test positives per fold: 15/11/18/25/31 (offset 0) and 9/16/20/30/25 (offset 0.25).
Prediction-rate curve (capture of test positives at 5 / 10 / 20 / 30 / 50 % of NER background area, offset 0):
B0 0.03 / 0.03 / 0.04 / 0.17 / 0.30 · LR 0.02 / 0.08 / 0.25 / 0.28 / 0.40 · **RF 0.24 / 0.29 / 0.35 / 0.47 / 0.72**.
Curve area (mean ± std over 10 folds): B0 0.48 ± 0.20, LR 0.53 ± 0.16, RF 0.59 ± 0.17.

### 2.2 Design N (naive) — side by side, same features and folds

| Model | Pooled ROC-AUC | Pooled PR-AUC | Recall @ t_op | Pilot area flagged @ t_op |
|---|---|---|---|---|
| B0 | 0.438 ± 0.082 | 0.150 | 0.683 | 0.935 |
| LR-T6 | 0.617 ± 0.078 | 0.272 | 0.735 | 0.415 |
| RF-T6 | 0.551 ± 0.056 | 0.219 | 0.728 | 0.477 |

### 2.3 Exposure diagnostic (never a candidate)
A one-feature LR on the 500 m built-up share, same folds:
- Design N: ROC-AUC **0.895 ± 0.042** — the naive labels are almost separable by exposure alone.
- Design E: ROC-AUC **0.640 ± 0.095** — matching removed most of it, but **not all**. Some of RF-T6's 0.747 may still be exposure that leaks through terrain.

### 2.4 Pre-registered gate

| # | Criterion | LR-T6 | RF-T6 |
|---|---|---|---|
| a | mean ROC-AUC ≥ 0.65 and every fold > 0.5, per offset | **FAIL** (offset 0: mean 0.685, but one fold 0.476) | **PASS** (0.743 / 0.751; worst fold 0.656) |
| b | mean ROC-AUC > B0 on the same folds, per offset | **FAIL** (0.685 vs 0.694; 0.711 vs 0.729) | **PASS** (0.743 vs 0.694; 0.751 vs 0.729) |
| c | RF beats LR by more than LR's pooled fold std | n/a | **FAIL** (0.747 − 0.698 = 0.049 < 0.099) |
| d | no exposure-proxy features | PASS | PASS |
| e | pilot area flagged ≤ 30 % (fold mean and final model) | **FAIL** (0.914 / 0.944) | **FAIL** (0.681 / 0.570) |

**Outcome: no trained Stage A model is adopted. `b0-rules-0.1.0` stays the served model**, and `active_model()` keeps `metrics: None`. Nothing in `georakshak_ml` changed, so the interface, required features and factor shape are untouched.

### 2.5 What the numbers mean
1. **RF-T6 has real but weak terrain signal** (ROC-AUC ≈ 0.75, stable across offsets, best prediction-rate curve). It fails on operational usefulness: to reach 70 % recall of reported events it flags 57–68 % of the pilot. That is not a usable High/Very High class.
2. **B0 flips sign with the design** (0.44 naive → 0.71 exposure-controlled). B0 reads `landcover_class`, so under matching it exploits the residual difference between majority built-up (positives) and majority tree cover (matched negatives). Both numbers say the same thing: these labels track settlement, not slope.
3. **Exposure control works but is partial** (§2.3), so RF's edge over B0 (0.05 ROC-AUC, less than one fold std) is not a safe basis for adoption. Criterion (c) is what blocks it.
4. **Fold variance is still the limiting factor.** With 9–31 test positives per fold, an 0.05 AUC difference is noise.
5. LR is close to B0 and below it on both offsets, so the linear terrain signal adds nothing over the hand-written rules.

## 3. Replay sanity check (diagnostic, no claim)

Pilot grid, real IMD replay window 2017-05-15 to 2017-06-30, rain features derived as the backend does
(rolling 1/3/7-day and 15-day antecedent sums with `period_end ≤ as_of`), no sensors.
Full output: `ml/reports/replay-sanity-2026-09-17.json`. The candidate column is the **non-adopted** RF
(`stage-a-rf-0.1.0-CANDIDATE-NOT-ADOPTED`, `S = min(1, 0.9 · raw / t_op)`).

| Day | Max 1-day rain | B0 severity counts (2,798 cells) | Candidate (not served) |
|---|---|---|---|
| 2017-05-15 (first day, partial windows) | 18 mm | LOW 1,100 · MODERATE 1,698 | LOW 103 · MODERATE 1,101 · HIGH 1,594 |
| 2017-06-13 (peak) | 191.5 mm | LOW 216 · MODERATE 1,001 · HIGH 1,579 · VERY_HIGH 2 | MODERATE 118 · HIGH 573 · VERY_HIGH 2,107 |

- The two recorded pilot events: the 2017-06-01 event cell was in the **top 3.5 %** of pilot cells by B0 score that day (0.357, MODERATE); the 2017-06-10 event cell was at the **71st percentile** (0.336, MODERATE). Neither reached HIGH.
- The candidate would put 75 % of the pilot in VERY_HIGH on the peak day, which is another view of the gate (e) failure.
- **Two events cannot validate event prediction. No event-prediction or forecast-skill claim is made or supported.**

## 4. Decision and what is still missing
- **Served model unchanged:** `b0-rules-0.1.0`. No handoff features changed, so `feature_version` stays `pilot-features-0.1.0`.
- **Inventory used:** NASA GLC via the COOLR Reports Points service (`source_slug: nasa-glc`). **GSI Bhukosh is not used** and is not implied anywhere.
- To get past the gate, in order of expected value:
  1. **A mapped inventory** (GSI Bhukosh, or a published NER inventory digitised from imagery) so labels stop encoding media reporting. This is the blocker, not the model class.
  2. Positives at 500 m accuracy or better; the current labels are ±1 km against 500 m windows.
  3. Physical covariates the labels could reward: lithology, soil depth, drainage/stream distance, cut-slope proximity (which is also an exposure proxy and needs matched negatives).
  4. Stage B remains blocked by the data gate: 502 dated NER records, but 1–50 km location accuracy against 25 km rainfall grids, and only 4 records after 2018.

## 5. Deviations from the pre-registration
1. **NER background is clustered, not uniform.** 60 patches × 25 points at 1.2 km spacing (1,500 points) instead of 2,000 independent uniform points. Reason: independent points each hit a different ~30 km Copernicus DEM COG block, which would have meant several GB of remote reads. Consequence: the effective sample size for area shares is smaller than 1,500 (patch-level clustering), and per-fold curves rest on 5–15 patches. The pilot-grid area share, which the gate uses, is unaffected because it is a full census of 2,798 cells.
2. The 5 km set was not run, as pre-registered.
3. Everything else (label rules, buffers, masks, models, hyperparameters, thresholds, metrics, gate) ran as written in §1.
