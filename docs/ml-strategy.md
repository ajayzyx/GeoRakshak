# ML Strategy — GeoRakshak

> **Status:** PROPOSED. No model has been trained. No metrics exist yet.
> Owner: AI/ML Engineer. Rules in [CLAUDE.md §10](../CLAUDE.md) apply.

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

### 2.2 Stage B — Dynamic hazard (rainfall-conditioned)
- **Unit:** grid cell × day (or a shorter window if the data allows).
- **Target:** probability-like score that a landslide occurs in or near the cell within the next window (for example 24–72 h), given susceptibility and recent/forecast rainfall.
- **Output:** `hazard_score ∈ [0, 1]`, `risk_class`, confidence indicator, and top factors.

### 2.3 MVP sequencing
1. **Rule-based baseline** (no training): transparent weighted scoring of slope, relief, land cover, distance to past landslides and rainfall anomaly. Weights come from the literature and are documented.
2. **Stage A ML model** trained on the historical inventory.
3. **Stage B:** combine Stage A with rainfall thresholds or a trained model, **only if** dated events are sufficient (see §9). Otherwise use `susceptibility × rainfall-trigger factor`, with the rule clearly documented.

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
| Land cover | `landcover_class` (one-hot), `ndvi_mean` | — | WorldCover / Sentinel-2 | A |
| Hydrology | `dist_to_stream_m` | m | DEM-derived drainage or OSM waterways | A |
| Anthropogenic | `dist_to_road_m` | m | OSM | A (see bias note) |
| History | `past_landslide_density` | count/km² | Inventory (**excluding the validation fold**) | A |
| Geology | `lithology_class` | — | GSI geology maps (if accessible) | A (optional) |
| Rainfall | `rain_1d_mm`, `rain_3d_mm`, `rain_7d_mm` | mm | IMD / IMERG | B |
| Rainfall | `rain_antecedent_15d_mm`, `rain_antecedent_30d_mm` | mm | IMD / IMERG | B |
| Rainfall | `rain_max_intensity_mm_h` (if sub-daily data exists) | mm/h | IMERG | B |
| Rainfall | `rain_anomaly` (vs. cell climatology for day-of-year) | ratio / z | IMD | B |
| Wetness | `soil_moisture` (optional) | m³/m³ | SMAP / ERA5-Land | B (optional) |
| Seasonal | `is_monsoon`, `day_of_year_sin/cos` | — | derived | B |

Leakage guards:
- `past_landslide_density` must be computed without the events in the evaluation fold.
- Rainfall features for day *t* may use only data available **before** the prediction time.

## 4. Labels

| Stage | Positive | Negative | Source |
|---|---|---|---|
| A | Cells intersecting (or within a buffer of) mapped landslide points/polygons | Cells sampled from areas with no mapped landslide, outside a buffer around positives, stratified by terrain to avoid trivially flat negatives | GSI inventory (primary), NASA GLC (secondary) |
| B | Cell-days with a dated landslide event in/near the cell | Cell-days without recorded events, sampled with care | NASA GLC (has dates), dated GSI/official records if available |

Label caveats that must be documented:
- **Absence of a record ≠ absence of a landslide.** Inventories are incomplete, so negatives are "unlabelled" rather than truly negative.
- **Reporting bias:** events near roads and settlements are over-represented. This inflates the apparent importance of `dist_to_road_m`. Evaluate with and without this feature.
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

**B1 — Logistic regression (trained)**
- Every "advanced" model must beat B1 under the same spatial validation to be adopted.

## 7. Training strategy

1. **Pilot area first** (🔶 pilot geography needs approval). Train and evaluate there, and optionally test transfer to a second NER area.
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

## 9. Evaluation metrics

| Metric | Why |
|---|---|
| ROC-AUC | Standard ranking metric in susceptibility literature, for comparability |
| **PR-AUC** | More informative under heavy class imbalance |
| **Recall at the alert threshold** | How many known events fall in High/Very High classes |
| **Share of area flagged High/Very High** | Guards against "flag everything" solutions. Always reported with recall. |
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

**Explanation contract** (returned with every score; see [api.md](api.md)):

```json
{
  "factors": [
    {"feature": "rain_3d_mm", "label": "3-day rainfall", "value": 182.0, "unit": "mm",
     "contribution": 0.24, "direction": "increases_risk",
     "text": "3-day rainfall is far above this area's usual level for this time of year"}
  ]
}
```

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

## 12. Artifacts and versioning

| Artifact | Contents |
|---|---|
| `model_version` | Semantic version + git commit + data version hash |
| Model card | Purpose, data, features, metrics, validation scheme, limitations, intended/unintended use |
| Evaluation report | All metrics in §9, curves, and fold-wise results |
| Feature config | Feature list, units, normalisation, sources |
| Threshold config | Class boundaries with rationale |

Large binary artifacts are not committed to Git (see [CLAUDE.md §11](../CLAUDE.md)).
