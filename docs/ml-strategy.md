# ML Strategy — GeoRakshak

> **Status:** APPROVED MVP approach (terrain + satellite + rainfall + sensor adjustment). **Implemented:** rule-based baseline `b0-rules-0.1.0` (uncalibrated heuristic, model card: [ml/georakshak_ml/README.md](../ml/georakshak_ml/README.md)). **No trained model is deployed.** The first Stage A evaluation ([ml/reports/evaluation-2026-09-17.md](../ml/reports/evaluation-2026-09-17.md)) is EXPERIMENTAL and NOT ADOPTED, because the available inventory mainly records where landslides get reported.
> Owner: AI/ML Engineer. Rules in [CLAUDE.md §10](../CLAUDE.md) apply.
> **Revision:** aligned with official SIH26001 requirements OR-02 (soil moisture sensors), OR-03 (satellite imagery), OR-06 (identify high-risk zones and predict possible events), OR-11 (severity levels) and OR-13 (weather-linked forecasts). Changed sections: §2.2–2.6, §3, §10, §11.

## 1. Framing

Landslide early warning combines two questions:

1. **Where** is the ground predisposed to fail? This is **susceptibility**, driven by mostly static factors such as slope, lithology, land cover and past landslides.
2. **When** is the trigger strong enough? This is **dynamic hazard**, driven mainly by rainfall intensity/duration and antecedent wetness in NER.

GeoRakshak models both and combines them into an explainable **risk level** per analysis grid cell. The output is a risk estimate for decision support. It is never a deterministic prediction.

> Terminology note: in hazard science, "risk" also includes exposure and vulnerability. In GeoRakshak, the **risk score** is the hazard likelihood estimate. **Exposure** (villages, roads) is added separately in the response-priority engine. The UI must use these terms consistently.

## 2. Prediction target

### 2.1 Stage A — Susceptibility (static)
- **Unit:** grid cell in the pilot area.
- **Target:** probability-like score that a cell contains or is near a mapped landslide, given static factors.
- **Output:** `susceptibility ∈ [0, 1]` and class (Low / Moderate / High / Very High).

### 2.2 Stage B — Dynamic hazard (rainfall-conditioned), "prediction of possible landslide events" (OR-06)
- **Unit:** grid cell × time window (daily, or shorter if the data allows).
- **Target:** probability-like likelihood that a landslide occurs in or near the cell within the next window (for example 24–72 h), given susceptibility, observed rainfall and soil-moisture signals.
- **Output:** `hazard_score ∈ [0, 1]` (exposed as `score` in the API and `risk_assessments`), `severity` (Low / Moderate / High / Very High, OR-11), confidence indicator, and top factors.
- **Wording rule:** the UI and pitch say "elevated likelihood of landslides in this area over the next 24–72 h," never "a landslide will occur."

### 2.3 MVP sequencing
1. **Rule-based baseline B0** (no training): transparent weighted scoring of slope, relief, land cover, vegetation index, past landslides and rainfall anomaly. Weights are documented with justification. It exists so the product works end-to-end early.
2. **Stage A ML model** trained on the real historical inventory with real terrain and satellite-derived features. **Required for the MVP**, because "AI/ML identification of high-risk zones" is an official requirement.
3. **Stage B for the MVP:** `hazard = f(Stage A susceptibility, rainfall trigger factor, soil-moisture modifier)`, with each part documented and explained. A **trained** Stage B model is used **only if** enough dated events exist for a temporal holdout (see §9). Otherwise the rule-based trigger stays and is stated as such.

### 2.4 Soil moisture sensor modifier (OR-02)
- Historical in-situ sensor data for training does **not** exist, and MVP sensors are virtual. Sensor readings therefore **do not enter the trained model**.
- They enter Stage B as a **bounded, documented rule-based modifier**. For example, if the nearest station within its influence radius reports volumetric water content above a configured level for a configured duration, the trigger factor is multiplied by a bounded factor. The levels are config values with rationale (literature-based, 🔶 reviewed by the team), and they are **not** calibrated site thresholds.
- The modifier appears as its own explanation factor (for example "Soil moisture sensor reading high"), carrying the reading's provenance (`SIMULATED_DEMO` for virtual stations).
- Cells with no station in range skip the modifier, and the explanation says "no sensor coverage."
- It is excluded from all reported metrics.

### 2.5 Weather-linked risk forecast (OR-13)
- **Same scorer, forecast inputs:** for lead times +24/+48/+72 h, Stage B runs with rainfall features built from **observed rainfall up to the issue time plus forecast rainfall up to the valid time**.
- Outputs are stored with `issue_time`, `valid_time`, `lead_time_h`, forecast source, and `provenance = MODEL_OUTPUT`.
- Confidence decreases with lead time (a documented rule for the MVP). The UI shows "forecast" styling and the forecast source.
- **Validation:** forecast-risk skill is not claimed in the MVP, because archived forecasts for a hindcast are not yet sourced. The model card states this. Post-MVP: hindcast with archived forecasts, if they can be sourced.

### 2.6 Road segment risk (supports OR-12, not ML)
- Road-segment `AT_RISK` status comes from the maximum severity of the cells a segment crosses (current or forecast). It is a deterministic rule, not a separate model. See [architecture.md §3.8](architecture.md).

## 3. Features

All features are computed per grid cell. Each has a unit, source, provenance and processing script.

| Group | Feature | Unit | Source | Stage |
|---|---|---|---|---|
| Terrain | `slope_deg` (mean, max) | degrees | DEM-derived | A |
| Terrain | `elevation_m` | m | DEM | A |
| Terrain | `relief_m` (local range) | m | DEM-derived | A |
| Terrain | `aspect_sin`, `aspect_cos` | — | DEM-derived | A |
| Terrain | `plan_curvature`, `profile_curvature` | 1/m | DEM-derived | A |
| Terrain | `twi` (topographic wetness index) | — | DEM-derived | A (optional) |
| Satellite (OR-03) | `landcover_class` (one-hot) | — | ESA WorldCover (satellite-derived) | A |
| Satellite (OR-03) | `ndvi_mean`, `ndvi_std` | — | Sentinel-2 composite, stated date range | A |
| Hydrology | `dist_to_drainage`, `flow_acc`, `twi_mean`, `elev_above_min` (hillslope position), `roughness` (TRI) | m, cells, —, m, m | **Built 2026-09-18** from Copernicus DEM GLO-90 (S33): priority-flood fill, vectorised D8, accumulation **window-truncated at ≤ 36 km²**, TWI with tan β floored at 0.5°, Zevenbergen–Thorne curvature. Candidate only, not in the handoff. | A (candidate) |
| Soil | `clay`, `sand`, `bdod` (bulk density), `cfvo` (coarse fragments), `bedrock_depth_cm` | g/kg, g/kg, cg/cm³, cm³/dm³, cm | **Built 2026-09-18** from ISRIC SoilGrids v2 and SoilGrids 2017 (S31, S32), 250 m. Zero means no data and is never imputed. Candidate only. | A (candidate) |
| Anthropogenic | `dist_to_road_m` | m | OSM | A (see bias note) |
| History | `past_landslide_density` | count/km² | Inventory (**excluding the validation fold**) | A |
| Geology | `lithology_class` | — | **Still unavailable (2026-09-18).** GLiM exists at 0.5° only (too coarse, and partly encodes the CV block); OneGeology unreachable; GSI's per-record geology is **label-only** and would leak. See S34. | A (optional, blocked) |
| Rainfall | `rain_1d_mm`, `rain_3d_mm`, `rain_7d_mm` | mm | IMD / IMERG | B |
| Rainfall | `rain_antecedent_15d_mm`, `rain_antecedent_30d_mm` | mm | IMD / IMERG | B |
| Rainfall | `rain_max_intensity_mm_h` (if sub-daily data exists) | mm/h | IMERG | B |
| Rainfall | `rain_anomaly` (vs. cell climatology for day-of-year) | ratio / z | IMD | B |
| Wetness | `soil_moisture_regional` (optional) | m³/m³ | SMAP / ERA5-Land (real) | B (optional, trained only if validated) |
| Wetness | `sensor_vwc` (nearest station) | m³/m³ | Sensor ingestion API (virtual in MVP) | B **rule modifier only** (§2.4) |
| Forecast (OR-13) | `fcst_rain_24h_mm`, `fcst_rain_48h_mm`, `fcst_rain_72h_mm` | mm | IMD API (if granted) / approved provider / replay | B forecast mode only (§2.5) |
| Seasonal | `is_monsoon`, `day_of_year_sin/cos` | — | derived | B |

Leakage guards:
- `past_landslide_density` must be computed without the events in the evaluation fold.
- Rainfall features for day *t* may use only data available **before** the prediction time.
- Forecast features are never used in training for reported metrics unless archived forecasts from the issue time are used.

## 4. Labels

| Stage | Positive | Negative | Source |
|---|---|---|---|
| A | Cells intersecting (or within a buffer of) mapped landslide points/polygons | Exposure-controlled background: comparable reporting opportunity, outside a buffer of `max(1 km, stated accuracy) + 0.5 km` around **any** record | **GSI surveyed inventory via the Bhusanket portal (primary, in use since 2026-09-18)** > NASA GLC via COOLR (secondary) > licensed research inventories |
| B | Cell-days with a dated landslide event in/near the cell | Cell-days without recorded events, sampled with care | NASA GLC (has dates), dated GSI/official records if available |

**Field and citizen reports are not training labels in the MVP.** Demo reports are `SIMULATED_DEMO`, and operational reports have no verified history yet. Verified reports may be added to the inventory post-MVP, with their own provenance and a review step.

Label caveats that must be documented:
- **Absence of a record ≠ absence of a landslide.** Inventories are incomplete, so negatives are "unlabelled" rather than truly negative.
- **Reporting bias:** events near roads and settlements are over-represented. This inflates the apparent importance of `dist_to_road_m`. Evaluate with and without this feature.
  - **Measured (2026-09-17, NASA GLC/COOLR, NER-India):** built-up share alone separates recorded events from random nearby points at ROC-AUC 0.895. The labels largely record *where landslides get reported*.
  - **Resolved (2026-09-18, GSI surveyed inventory):** with surveyed labels and the exposure-controlled design, the same diagnostic falls to **0.488 — chance**. Positives in the top built-up bin dropped from 37 % (GLC) to 2.6 % (GSI), and slope coefficients regained the physically expected sign. This is the accepted evidence that the design controls reporting bias, and it is why the surveyed inventory is the primary label source.
  - **Required negative design: exposure-controlled (target-group background).** Draw negatives from places with comparable reporting opportunity (matched on built-up share within ~1 km), not uniformly. The same diagnostic then falls to 0.640. Exposure proxies — built-up share, distance to road or settlement, population — must never be model features.
  - B0's apparent ranking skill on these labels **flips with the negative design** (0.438 naive → 0.711 exposure-controlled). Neither number is evidence about physical susceptibility, and neither may be quoted as accuracy.
- **Location and date uncertainty:** use record accuracy fields, and exclude or down-weight low-accuracy records.
- **Class imbalance:** positives are rare. Handle with class weights or sampling, never by oversampling the test data.

## 5. Candidate models

| Model | Why | Explainability | Stage |
|---|---|---|---|
| Rule-based weighted index | Transparent, needs no labels, a fast MVP | Native (weights × normalised factors) | Baseline |
| Logistic regression (with scaling, optional splines) | Interpretable, calibrated-ish, strong baseline | Coefficients, per-feature contribution | A, B |
| Random forest | Handles non-linearity, robust | SHAP (TreeExplainer), permutation importance | A |
| Gradient boosted trees (e.g. LightGBM / XGBoost) | Usually strongest on tabular geospatial data | SHAP (TreeExplainer) | A, B |
| Rainfall intensity–duration threshold | Established approach in landslide early warning literature | Native (threshold exceedance) | B |

Not in the MVP: CNNs on imagery, LSTMs/transformers on rainfall sequences, InSAR-based models. These are Phase 6 candidates, and only once labels and compute justify them.

🔶 **Requires human approval:** adding any library beyond the standard Python scientific / geospatial stack plus one gradient-boosting library and SHAP.

## 6. Baseline model

**B0 — Rule-based index (no training)**

```
raw = Σ w_i · normalise(factor_i)    over slope, relief, landcover_risk, past_landslide_density, rain_anomaly
risk_score = clip(raw, 0, 1)
```

- Weights and normalisation ranges are documented in a versioned config, with justification or references.
- It exists so the product works end-to-end before any trained model.

**As implemented in `b0-rules-0.1.0`** (full detail in the model card):
```
S = Σ w_i · n_i    susceptibility factors present (weights renormalised over available features)
T = Σ v_j · r_j    rainfall trigger factors present (T = 0 when there is no rainfall input)
M ∈ [1.00, 1.25]   bounded sensor multiplier (never lowers risk; CLAUDE.md §10 rule 11)
score = clip(0.5·S + 0.5·S·T·M, 0, 1)
```
- Terrain alone caps the score at 0.5 (at most HIGH). Severity cut-offs 0.25 / 0.45 / 0.65 are provisional heuristics pending H11.
- Confidence is never HIGH (uncalibrated): MEDIUM, lowered to LOW at lead ≥ 48 h or with no rainfall input.
- **Known result:** on the NER-wide spatial-CV sample, the untrained B0 terrain score ranked reported landslide locations below random points (ROC-AUC 0.458 ± 0.060, 1 km set). The labels are biased toward reporting, so this doesn't validate or refute B0 as a susceptibility index. It does mean **no accuracy or skill claim can be made for B0.**

**B1 — Logistic regression (trained)**
- Every "advanced" model must beat B1 under the same spatial validation to be adopted.

## 7. Training strategy

1. **Pilot area first** (selected in Phase 0 using the approved H4 criterion: inventory count + data coverage). Train and evaluate there, or on a wider state/NER training area if the pilot has too few records. Optionally test transfer to a second NER area.
2. Build a versioned feature table (cells × features) with a data-version hash.
3. Construct labels as in §4, and record the sampling ratio and random seed.
4. Train B1, then RF/GBM, with class weighting.
5. Tune hyperparameters with **nested spatial CV** or a separate spatial validation block. Never tune on the test blocks.
6. Calibrate probabilities (Platt or isotonic) on validation folds, if the scores are shown as probabilities.
7. Choose risk-class thresholds from validation curves (for example by target recall of historical events and the share of area flagged). Document them, then have the team review (🔶 H11).
8. Export a model artifact + model card + evaluation report, and register the `model_version` in the database.

## 8. Validation strategy

| Aspect | Method |
|---|---|
| Spatial generalisation | **Spatial block cross-validation**: partition the pilot area into blocks (block size larger than the spatial autocorrelation range, or at least several km). Train on k−1 blocks, test on the held-out block. |
| Temporal generalisation (Stage B) | **Time-based holdout**: train on earlier monsoon seasons, test on later seasons |
| Leakage checks | No shared cells across folds, history features recomputed per fold, and no future rainfall |
| Benchmark comparison | Compare Stage A against the GSI susceptibility map (if accessible) and the rule-based B0 |
| Sanity checks | Maps inspected visually. High scores must not simply trace roads or data-density artefacts. |
| Robustness | Performance by elevation band, land cover and distance to road |

Random k-fold results may be reported **only** alongside spatial CV results and labelled as optimistic.

### 7a. Adoption gate for a trained Stage A model (pre-register before results)

A trained Stage A model replaces the B0 baseline only if **all** of these hold on exposure-controlled, leakage-safe spatial CV (blocks ≥ 0.5°, a buffer between train and test folds, ≥ 2 block-grid offsets, fixed seeds):

| # | Criterion |
|---|---|
| a | mean ROC-AUC ≥ 0.65 and every fold > 0.5, for every block offset |
| b | beats B0 on the same folds, for every offset |
| c | a tree model is preferred over logistic regression only if it beats it by more than the LR fold std |
| d | no exposure-proxy features |
| e | share of **pilot area** flagged High/Very High at the operating threshold ≤ 30 %, always reported with recall |

The gate is written down before the run, and the result is recorded either way. Keeping B0 is an acceptable outcome and must be stated plainly rather than presented as a model.

**Result 2026-09-17, media-derived labels** ([evaluation-2026-09-17-v2.md](../ml/reports/evaluation-2026-09-17-v2.md)): logistic regression failed (a), (b) and (e); random forest passed (a) and (b) (ROC-AUC 0.747 ± 0.066 versus B0 0.711 ± 0.119) but failed (c) and (e).

**Result 2026-09-18, GSI surveyed labels** ([evaluation-2026-09-18-v3.md](../ml/reports/evaluation-2026-09-18-v3.md)), 1,000 deduped positives, gate restated unchanged: both models passed (a), (b) and (d); logistic regression beat B0 by only 0.002–0.004, far inside one fold standard deviation; random forest was the best ranker (0.709 ± 0.041 versus B0 0.692 ± 0.040) but failed (c), and **both failed (e)**, flagging 73–85 % of the pilot at the operating threshold. **Nothing is adopted; `b0-rules-0.1.0` stays served.**

**Result 2026-09-18 v4, adding hydrology and soil** ([evaluation-2026-09-18-v4.md](../ml/reports/evaluation-2026-09-18-v4.md)), same points and protocol as v3, gate restated unchanged: **ranking did not move** (LR 0.696 → 0.700, RF 0.709 → 0.712 pooled ROC-AUC, against fold standard deviations of 0.033–0.044, so roughly a tenth of one fold's noise), but the **area/recall trade-off improved materially**: the random forest needs 57 % of the pilot instead of 70 % for 70 % recall, and recall at a fixed 30 % of area rose 0.335 → 0.442. Hydrology alone changed nothing; the gain comes from soil. Criterion (e) still fails at 1.9× the 30 % budget, so **nothing was adopted and `b0-rules-0.1.0` stays served.** Candidate features are not in the pilot handoff.

**Where the ceiling actually is.** Ranking has sat at ROC-AUC ≈ 0.70 across three label sets and three feature families, which points at **label geometry rather than covariates**: GSI records one surveyed *point* per landslide, so a 500 m cell containing the scar, its crown or its toe all carry the same label. The gate-relevant asks, in order, are GSI's token-protected `Landslide_Polygon` service (polygon labels), a surveyed **extent** so that absence means absence, and only then lithology at ≤ 1 km.

What that means, stated plainly: with surveyed labels the reporting-bias problem is gone, and B0 ranks GSI-surveyed sites about as well as trained terrain-only models do. The binding constraint is now **area share, not ranking**: the Aizawl pilot is uniformly steep, so a 70 %-recall operating point covers roughly three quarters of it. Post-hoc at a fixed 30 % of area, recall was RF 0.335 ± 0.043, B0 0.315 ± 0.046, LR 0.193 ± 0.050 (recorded after the gate, changed no decision). The next gain must come from **better labels and features — mapped polygons with a surveyed extent (for true absences), lithology, soil depth and drainage — not another classifier.**

## 9. Evaluation metrics

| Metric | Why |
|---|---|
| ROC-AUC | Standard ranking metric in susceptibility literature, for comparability |
| **PR-AUC** | More informative under heavy class imbalance |
| **Recall at the alert threshold** | How many known events fall in High/Very High classes |
| **Share of area flagged High/Very High** | Guards against "flag everything" solutions. Always reported with recall. **Must be measured on a regular background** (the pilot grid census, or a uniform area sample), never on case-control samples, where an "area share" has no meaning. |
| Success-rate / prediction-rate curves | Standard landslide susceptibility evaluation (cumulative % events vs. % area ranked by score) |
| False alarm rate (Stage B, per cell-day) | Alert fatigue matters operationally |
| Brier score + reliability diagram | Calibration, if scores are presented as probabilities |

Report every metric with its validation scheme, number of positives, and variance across folds.

**Data sufficiency gate (Stage B):** if the pilot area has too few **dated** events to form a meaningful temporal test set, do not report a trained Stage B model as validated. Use the documented rule-based rainfall trigger and say so explicitly.

## 10. Explainability

| Layer | Method | User-facing form |
|---|---|---|
| Rule-based B0 | Weight × normalised factor contributions | "Slope contributes +0.21" |
| Logistic regression | Coefficient × standardised value | Same shape |
| Tree models | SHAP values (TreeExplainer) per prediction | Same shape |
| Global | Mean \|SHAP\| / permutation importance | Model card + admin page |
| Stage B trigger + sensor modifier | Rule contribution (trigger factor, modifier factor) as its own factor | "Rainfall trigger: 3-day rainfall far above normal," "Soil moisture sensor reading high (virtual sensor)" |
| Forecast mode | Same factors, computed on forecast inputs | Factor text prefixed "Forecast:", with source and lead time |

Precompute SHAP values in the batch/offline scoring step. The backend serves stored factors and doesn't need heavy explanation libraries at request time.

**Explanation contract** (returned with every score; canonical definition in [api.md §6.2](api.md)):

```json
{
  "factors": [
    {"feature": "rain_3d_mm", "label": "3-day rainfall", "value": 182.0, "unit": "mm",
     "contribution": 0.24, "direction": "increases_risk", "component": "TRIGGER",
     "text": "3-day rainfall is far above this area's usual level for this time of year",
     "provenance": "REAL_HISTORICAL"}
  ]
}
```
`component` is one of `SUSCEPTIBILITY`, `TRIGGER`, `SENSOR_ADJUSTMENT`. `provenance` is the provenance of the input value.

Rules:
- Show the top 3–5 factors, in plain language. The raw feature name is for advanced view only.
- Plain-language text comes from templates keyed by feature and value band. It is not free-form generated.
- Explanations describe the **model's reasoning**, not proven physical causation. The UI must say so in its help text.

## 11. Limitations (to publish in the model card)

1. **Incomplete, biased inventories:** labels undercount remote events and overcount road-side events.
2. **Resolution mismatch:** rainfall grids (~10–25 km) are much coarser than hillslopes (~30 m), so local convective bursts may be missed.
3. **Satellite rainfall bias** in complex terrain. Station validation is limited.
4. **Missing causal factors:** detailed geology, soil depth, groundwater, slope cuts and drainage failures may be unavailable.
5. **Few dated events** limit Stage B validation.
6. **Non-stationarity:** land-use change, construction and climate trends shift risk over time.
7. **Transferability:** a model trained on one pilot area may not generalise across NER without retraining and validation.
8. **Not a warning authority:** scores support human judgement. They do not replace official agencies or site inspection.
9. **Sensor modifier is uncalibrated:** MVP soil moisture stations are virtual, and modifier levels are not site-calibrated thresholds.
10. **Forecast risk skill is unvalidated** in the MVP. Forecast rainfall uncertainty passes directly into forecast risk.
11. **Satellite features are time-bound:** optical composites carry a date range and may not reflect recent land-cover change or slides.

## 12. Artifacts and versioning

| Artifact | Contents |
|---|---|
| `model_version` | Semantic version + git commit + data version hash |
| Model card | Purpose, data, features, metrics, validation scheme, limitations, intended/unintended use |
| Evaluation report | All metrics in §9, curves, and fold-wise results |
| Feature config | Feature list, units, normalisation, sources |
| Threshold config | Class boundaries with rationale |

Large binary artifacts are not committed to Git (see [CLAUDE.md §11](../CLAUDE.md)).
