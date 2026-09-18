# Stage A evaluation v4: hydrology + soil features, same gate (2026-09-18)

> §1 (pre-registration) was written at **2026-09-17T21:11Z** (local 2026-09-18), after the new features were coded
> and their coverage measured, but **before any v4 model was trained or scored**. The gate in §1.5 is copied
> unchanged from v2/v3. Nothing was loosened. Deviations are in §6.
> Before/after baseline: `evaluation-2026-09-18-v3.md` (same points, same labels, terrain-only features).

## 1. Pre-registration

### 1.1 What changed from v3
Only the **feature set**. The label design (GSI surveyed positives, exposure-matched negatives), the points, the
NER background, the pilot grid, the seeds and the validation protocol are the v3 files and rules, unchanged.

### 1.2 New features
**Hydrology (H6), derived from the Copernicus DEM GLO-30 already in hand — no new source, so it inherits that
licence, attribution and `REAL_HISTORICAL` provenance.** Algorithms, window and edge handling are documented in
`ml/pipeline/hydro_features.py`: a 6 km × 6 km window centred on the point, reprojected bilinearly to 25 m in the
point's UTM zone (EPSG:326xx, 241 × 241 px), priority-flood depression filling, D8 flow accumulation in m²
(**truncated by the window, so at most ≈36 km²**, applied identically to every point), TWI with tan β floored at
tan 0.5°, Zevenbergen–Thorne plan and profile curvature on the unfilled surface, and the terrain ruggedness index.
Everything is averaged over the central 500 m cell (inner 20 × 20 px); the window's outer ring absorbs edge effects.

| Feature | Unit | Definition |
|---|---|---|
| `flow_acc_log10_m2_mean` | log10 m² | mean of log10(D8 contributing area) over the cell |
| `twi_mean` | — | mean ln(a / tan β), a = accumulation / 25 m |
| `elev_above_window_min_m` | m | centre elevation minus the 6 km window minimum (hillslope position) |
| `plan_curvature_mean` | 1/m | mean contour curvature (convergence) |
| `profile_curvature_mean` | 1/m | mean downslope curvature |
| `roughness_tri_m` | m | mean absolute elevation difference to the 8 neighbours |

`dist_to_drainage_m` (distance to the nearest cell with ≥ 0.25 km² accumulation) is **computed and reported but
excluded from the candidate set**: in a 40-point training sample its missingness was 20 % at the 0.25 km² threshold
and 45 % at 1 km² (2.5 % and 0 % on the pilot), because window truncation leaves ridge-top windows with no
qualifying channel. `elev_above_window_min_m` carries the same hillslope-position information and is always defined.

**Soil (S), ISRIC SoilGrids — real, retrieved, CC-BY 4.0** (`https://www.isric.org/about/data-policy`):
`clay_pct`, `sand_pct`, `bdod_kg_dm3`, `cfvo_pct_vol` from SoilGrids v2 (250 m) 5–15 cm means, fetched over the NER
training area through the ISRIC WCS 2.0.1 (`https://maps.isric.org/mapserv?map=/map/<layer>.map`, `GetCoverage`,
EPSG:4326 subsetting), plus `bedrock_depth_cm` from SoilGrids 2017 (v1) `BDTICM_M_250m_ll.tif` (v2 has no
depth-to-bedrock layer). Each point takes the mean of the valid pixels in a 3 × 3 (≈750 m) window. MapServer writes
0 outside the soil mask and 0 clay/sand/bulk-density/bedrock-depth is physically implausible, so **0 is treated as
missing**. Attribution: "Soil data: ISRIC — World Soil Information, SoilGrids".

**Lithology: not obtained.** Evidence, all logged in `ml/data/raw/inventory_hunt/attempts.tsv`:
- GLiM (Global Lithological Map) v1.0 is reachable on PANGAEA (doi:10.1594/PANGAEA.788537, **CC-BY-3.0**, 37.8 kB)
  but only **gridded to 0.5°** (≈55 km). At 500 m cells that is a regional constant — the whole pilot would fall in
  one or two grid cells — and under 0.5° spatial-block CV it would partly encode block identity. **Excluded on
  resolution grounds, not licence grounds.**
- OneGeology: `https://onegeology.org/wmsconnector/wms/one_geology?…GetCapabilities` → HTTP 404;
  `https://portal.onegeology.org/OnegeologyGlobal/` → TLS certificate verification failure.
- A full-resolution GLiM shapefile could not be located at any reachable URL (guessed Uni Hamburg path → 404).
- GSI's per-record `geology` attribute exists **only at positive locations**, so using it would leak the label. It
  is deliberately not a feature.

**NDVI: not attempted** in this block (time went to hydrology and soil). WorldCover tree-cover share already covers
some of that signal and is excluded anyway as an exposure proxy.

### 1.3 Candidate feature sets
| Name | Features | Role |
|---|---|---|
| T6 | v3 terrain six | before (re-run on the identical rows for comparability) |
| T6+H6 | + hydrology | ablation |
| **T6+H6+S** | + soil (the full obtainable set) | **primary candidate, the one the gate judges** |

Exposure proxies (built-up share, exposure X, land-cover class, tree share, distance to road/settlement,
population) and `past_landslide_density` remain excluded from every candidate.

### 1.4 Missing-value policy
No imputation anywhere. A feature whose overall missingness exceeds **5 %** across the training designs is excluded
from the candidate set and reported instead (this is what removes `dist_to_drainage_m`, and it is the rule that
decides whether `bedrock_depth_cm` is in). Rows still missing any candidate feature are **dropped** from training
and evaluation, with the count reported. `georakshak_ml` keeps raising `MissingFeaturesError`; nothing in the
runtime imputes.

### 1.5 Adoption gate (copied verbatim from v2 §1.5 / v3 §1.4)

| # | Criterion |
|---|---|
| a | For **each** offset: mean test ROC-AUC ≥ 0.65, **and** every fold ROC-AUC > 0.5 |
| b | For **each** offset: mean ROC-AUC > B0's mean ROC-AUC on the same folds |
| c | RF may be adopted only if its mean ROC-AUC, pooled over both offsets' 10 folds, exceeds LR's by more than LR's pooled fold std. Otherwise LR is the choice if LR passes. RF cannot be adopted when (c) fails, even if LR fails |
| d | No exposure-proxy feature |
| e | Mean pilot-area share at `t_op` across all 10 folds ≤ 0.30, **and** the final model's pilot share ≤ 0.30, reported together with recall |

Gate on **design E** with the primary candidate feature set. Metrics additionally reported per offset: PR-AUC,
recall at `t_op` with the pilot share, **recall at a fixed 30 % of pilot area**, **the pilot area needed for 70 %
recall**, the prediction-rate curve, and **permutation importance** on the test folds (offline only).

If nothing passes every criterion, `b0-rules-0.1.0` stays served — improved metrics alone are not adoption.

**If adopted:** exactly as briefed before — `S = min(1, 0.9 · raw / t_op)`, severity cut-offs untouched (H11 is the
user's call), contributions precomputed offline, dependency-free runtime, model version
`stage-a-<lr|rf>-0.1.0+trigger-rules-0.1.0`, real metrics in `active_model()` with
`forecast_skill_evaluated: False`, handoff carries `susceptibility_score` + contributions as `MODEL_OUTPUT`, and
`feature_version` bumped.

## 2. Features actually obtained

| Group | Provider · endpoint | Licence / attribution | Native res. | Coverage | Retrieved | Missingness (training / pilot / NER background) |
|---|---|---|---|---|---|---|
| Hydrology (7) | Derived by us from **Copernicus DEM GLO-90**, `https://copernicus-dem-90m.s3.amazonaws.com/Copernicus_DSM_COG_30_N<lat>_00_E<lon>_00_DEM/…tif` (46 tiles, 250 MB) | Copernicus DEM licence; "produced using Copernicus WorldDEM-90 © DLR e.V. 2010-2014 and © Airbus Defence and Space GmbH 2014-2018 provided under COPERNICUS by the European Union and ESA; all rights reserved" | 3″ (~90 m), routed over a 6 km window | Whole NER training area + pilot | 2026-09-18 | **0.1 % / 0 % / 0–0.7 %** |
| Soil (4) | **ISRIC SoilGrids v2**, WCS 2.0.1 `https://maps.isric.org/mapserv?map=/map/{clay,sand,bdod,cfvo}.map` → `GetCoverage`, 5–15 cm means | **CC-BY 4.0** (ISRIC data policy); "Soil data: ISRIC — World Soil Information, SoilGrids" | 250 m | 88–97.5 E, 21.5–29.5 N (covers the pilot) | 2026-09-18 | **0.6 % / 0.3 % / 4.8 %** |
| Soil depth (1) | **SoilGrids 2017 (v1)** `https://files.isric.org/soilgrids/former/2017-03-10/data/BDTICM_M_250m_ll.tif` (v2 has no depth-to-bedrock layer) | CC-BY 4.0 (same ISRIC policy) | 250 m | same window | 2026-09-18 | **0.2 % / 0 % / 5.8 %** |
| Lithology | **not obtained** | — | — | — | — | — |
| NDVI | **not attempted** in this block | — | — | — | — | — |

Because `dist_to_drainage_m` came out at 0.1 % missing on the 90 m routing (it was ~20 % at 25 m), the
pre-registered 5 % rule **admits** it, so it is in the candidate set — see §6.1. No value was imputed anywhere;
rows still missing a candidate feature were dropped: 23 of 3,999 training rows, 9 of 2,798 pilot cells, and 103 of
1,500 NER background points for the full feature set.

## 3. Results (design E, exposure-controlled — the gated design)

All numbers from `ml/reports/evaluation-v4-results.json`. "Before" is the identical protocol and rows with the v3
terrain-only set, so it reproduces `evaluation-2026-09-18-v3.md` exactly.

### 3.1 Ranking, per offset

| Feature set | Model | Offset | ROC-AUC (mean ± std) | fold min–max | PR-AUC |
|---|---|---|---|---|---|
| **T6 (before)** | B0 | (0,0) / (0.25,0.25) | 0.693 ± 0.030 / 0.692 ± 0.052 | 0.616 – 0.762 | 0.362 |
| | LR | (0,0) / (0.25,0.25) | 0.695 ± 0.024 / 0.696 ± 0.055 | 0.620 – 0.776 | 0.369 |
| | RF | (0,0) / (0.25,0.25) | 0.708 ± 0.037 / 0.711 ± 0.050 | 0.647 – 0.789 | 0.398 |
| T6+H6 (hydrology) | LR | — | 0.695 ± 0.047 (pooled) | — | 0.373 |
| | RF | — | 0.709 ± 0.046 (pooled) | — | 0.403 |
| **T6+H6+S (after)** | B0 | (0,0) / (0.25,0.25) | 0.685 ± 0.021 / 0.691 ± 0.039 | 0.652 – 0.753 | 0.358 |
| | **LR** | (0,0) / (0.25,0.25) | **0.700 ± 0.018 / 0.700 ± 0.047** | 0.646 – 0.775 | 0.378 |
| | **RF** | (0,0) / (0.25,0.25) | **0.707 ± 0.042 / 0.718 ± 0.049** | 0.659 – 0.797 | 0.411 |

Pooled over the 10 folds: LR 0.696 → **0.700**, RF 0.709 → **0.712**, B0 0.692 → 0.688 (B0 is unchanged in
substance; it moves only because 23 rows were dropped). PR-AUC: LR 0.369 → 0.378, RF 0.398 → 0.411.

### 3.2 Operating point and area share — the criterion that blocked v3

| Feature set | Model | Recall @ `t_op` | **Pilot area @ `t_op`** | NER area @ `t_op` | **Recall @ 30 % pilot area** | **Pilot area for 70 % recall** |
|---|---|---|---|---|---|---|
| T6 (before) | B0 | 0.702 | 0.783 | 0.484 | 0.315 | 0.770 |
| | LR | 0.704 | 0.849 | 0.373 | 0.193 | 0.843 |
| | RF | 0.718 | 0.728 | 0.303 | 0.335 | 0.703 |
| T6+H6+S (after) | B0 | 0.691 | 0.780 | 0.470 | 0.309 | 0.770 |
| | **LR** | 0.720 | **0.737** (final model 0.723) | 0.342 | **0.348** | **0.718** |
| | **RF** | 0.701 | **0.560** (final model 0.512) | 0.331 | **0.442** | **0.567** |

Prediction-rate capture at 5/10/20/30/50 % of NER background area: RF before 0.16/0.28/0.49/0.68/0.91,
after 0.17/0.26/0.42/0.58/0.87 (curve area 0.767 → 0.734); LR before 0.08/0.18/0.38/0.56/0.85,
after 0.11/0.18/0.36/0.55/0.87 (0.711 → 0.712).

### 3.3 Per-feature contribution (permutation importance on the test folds, ROC-AUC drop)
- **LR:** `twi_mean` 0.203 ± 0.035 dominates, then `slope_deg_mean` 0.048, `slope_deg_max` 0.022,
  `elevation_m_mean` 0.016, `flow_acc_log10_m2_mean` 0.014, `roughness_tri_m` 0.012, `clay_pct` 0.007,
  `sand_pct` 0.006, `bdod_kg_dm3` 0.004, `cfvo_pct_vol` 0.003; `dist_to_drainage_m`, `plan_curvature_mean`,
  `bedrock_depth_cm` and `elev_above_window_min_m` ≈ 0 or slightly negative.
  Its standardised coefficients are `twi_mean` −1.44, `roughness_tri_m` −0.70, `slope_deg_mean` +0.45,
  `slope_deg_max` +0.34, `flow_acc_log10_m2_mean` +0.37, `elevation_m_mean` −0.28, soil terms |0.09|–|0.17|.
  Since TWI = ln(a / tan β) and slope is already in the model, a large negative TWI coefficient is mostly **another
  slope term**, not a wetness term — which is why the extra features barely move the ranking.
- **RF:** `slope_deg_mean` 0.022, `elevation_m_mean` 0.015, `roughness_tri_m` 0.010, `slope_deg_max` 0.007,
  `twi_mean` 0.007, `relief_m` 0.006, `cfvo_pct_vol` 0.006, `elev_above_window_min_m` 0.005, `sand_pct` 0.004;
  `bedrock_depth_cm`, `plan_curvature_mean` and `bdod_kg_dm3` ≈ 0. Terrain still carries the signal; soil and
  wetness are marginal individually.

### 3.4 Design N (naive) for contrast — not gated
Same features, random rather than exposure-matched negatives: LR 0.588 → 0.609, **RF 0.625 → 0.678** pooled
ROC-AUC, and RF's pilot area at `t_op` drops 0.633 → 0.408. So the new features do separate landslide terrain from
*random* terrain much better, but not from *exposure-matched* terrain — the same lesson as v2/v3, one level deeper.

## 4. The two questions, answered

**1. Does the expanded candidate materially improve ranking? No.**
Pooled ROC-AUC rises by +0.004 (LR: 0.696 → 0.700) and +0.003 (RF: 0.709 → 0.712) against fold standard
deviations of 0.033–0.044, so the change is roughly a tenth of one fold's noise. PR-AUC gains a little more
(+0.009 LR, +0.013 RF) and the hydrology-only step gains nothing at all (LR 0.695, RF 0.709). Permutation
importance explains why: the strongest new feature, TWI, is largely a slope re-expression, and every soil term is
worth ≤ 0.007 ROC-AUC.

**2. Does it reduce the area-share problem? Yes, materially — but not enough to pass.**
At the 70 %-recall operating point the RF candidate now flags **56 % of the pilot instead of 73 %** (final model
51 % vs 74 %), the area needed for 70 % recall falls from **70 % to 57 %**, and recall at a fixed 30 % of pilot area
rises from **0.335 to 0.442** (LR: 0.193 → 0.348). That is a real operational gain — about a quarter less area for
the same recall — and it comes mostly from soil: the pilot's soil profile differs from the NER-wide positive
profile, so fewer pilot cells clear the threshold. It is still **1.9× the 30 % budget** for RF and 2.5× for LR.

## 5. Pre-registered gate

| # | Criterion | LR (T6+H6+S) | RF (T6+H6+S) |
|---|---|---|---|
| a | mean ROC-AUC ≥ 0.65 and every fold > 0.5, per offset | **PASS** (0.700 / 0.700; worst fold 0.646) | **PASS** (0.707 / 0.718; worst fold 0.659) |
| b | mean ROC-AUC > B0 on the same folds, per offset | **PASS** (0.700 vs 0.685; 0.700 vs 0.691) | **PASS** (0.707 vs 0.685; 0.718 vs 0.691) |
| c | RF beats LR by more than LR's pooled fold std | n/a | **FAIL** (0.712 − 0.700 = 0.013 < 0.033) → LR is the selected candidate |
| d | no exposure-proxy features | PASS (asserted in the test suite) | PASS |
| e | pilot area flagged ≤ 30 % (fold mean **and** final model) | **FAIL** (0.737 / 0.723) | **FAIL** (0.560 / 0.512) |

**Outcome: no trained Stage A model is adopted. `b0-rules-0.1.0` stays the served model.** The selected candidate
under (c) is LR, and LR fails (e) by the widest margin of the two. `georakshak_ml` is unchanged: same interface,
same required features (`slope_deg_mean`, `relief_m`), `metrics: None`, and no imputation anywhere. H11 severity
thresholds are untouched.

**Remaining gap to a pass:** the selected model must flag ≤ 30 % of the pilot while keeping ~70 % recall. RF is at
56 % (needs a ~1.9× concentration improvement) and would additionally have to beat LR by more than LR's fold
spread. Ranking is stuck at ROC-AUC ≈ 0.70 across three label sets and three feature families, which points at the
label geometry rather than the covariates: GSI gives one surveyed **point** per landslide, so a 500 m cell that
contains a mapped scar is labelled the same as one that contains its crown or toe. The next real lever is
**polygon labels** (GSI's token-protected `Landslide_Polygon` service) or a **surveyed extent** so absence means
absence, followed by lithology at ≤ 1 km resolution. See `ml/reports/inventory-hunt-2026-09-18.md` §6.

## 6. Deviations from the pre-registration
1. **Hydrology routing resolution: 90 m, not 25 m.** Routing a 6 km window from the 30 m tiles needed thousands of
   remote range reads — measured at ~1 s and a few MB per point, which extrapolated to tens of GB for 11,300
   points. The 46 GLO-90 tiles the point set needs are 250 MB in total, so hydrology is computed from GLO-90 with
   everything read locally. The 500 m cell aggregation is therefore an inner 6 × 6 px block (540 m) instead of
   20 × 20 px, and the 25 m terrain features (T6) are unchanged. Consequence: `dist_to_drainage_m` missingness fell
   from ~20 % to 0.1 %, so the pre-registered 5 % rule admits it (§1.2 had excluded it on the 25 m measurement) —
   the **rule** was followed, its earlier conclusion changed with the measurement.
2. `hydro_features` D8 was vectorised for speed after the first run (identical semantics, covered by fixed-input
   tests); a transient remote-read retry and a resume path were added to the extraction script.
3. Everything else — labels, designs, blocks, offsets, 5 km buffer, seeds, models, hyperparameters, `t_op` rule,
   metrics and the gate thresholds — ran as written in §1.
