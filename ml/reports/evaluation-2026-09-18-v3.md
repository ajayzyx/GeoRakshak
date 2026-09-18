# Stage A evaluation v3: GSI surveyed inventory, same gate (2026-09-18)

> §1 (pre-registration) was written at **2026-09-17T18:50Z**, after the v3 dataset was built but **before any v3 model
> was trained or scored**. The gate in §1.4 is copied unchanged from `evaluation-2026-09-17-v2.md` §1.5. Nothing in it
> was loosened. Deviations are listed in §4.
> Inventory hunt that produced these labels: `ml/reports/inventory-hunt-2026-09-18.md`.

## 1. Pre-registration

### 1.1 What changed from v2
Only the **label source**. v2 used the media-derived NASA GLC/COOLR catalogue, whose positives sit in settlements
(48 % of positive windows were built-up against ~1 % of background). v3 uses the **GSI (Geological Survey of India)
public landslide inventory** from the Bhusanket portal: systematic inventory and macro-scale (1:50,000) susceptibility
mapping records with surveyed coordinates, slide numbers, toposheet references, geology, dimensions and citations.

- Service (discovered from `https://bhusanket.gsi.gov.in/json/config.json`, no token needed):
  `https://bhusanket.gsi.gov.in/gisserver/rest/services/Hosted/Public_Portal_Dashboard_Map/FeatureServer/0`
- Retrieved 2026-09-18: **8,691 records in the 8 NER states** (Mizoram 2,046 · Nagaland 1,636 · Manipur 1,578 ·
  Arunachal Pradesh 1,059 · Meghalaya 902 · Sikkim 768 · Assam 635 · Tripura 67), 8,230 distinct coordinates,
  `slide_no` on 8,546, citations on 7,472, movement type on 8,527. **132 records fall inside the Aizawl pilot bbox**
  (against 19 from NASA GLC).
- Terms of use (`https://bhusanket.gsi.gov.in/terms.html`, quoted): "Material featured on this Portal may be
  reproduced free of charge after taking proper permission by sending a mail to us … the source must be prominently
  acknowledged." So the raw data stays gitignored and is **not redistributed**; the team must request permission
  before publishing anything derived from it. Same handling as the IMD rainfall grids.
- `date`, `date_acc` and `geo_acc` are empty for every NER record. 2,270 records carry an initiation year and 489 a
  reactivation year. So v3 supports **Stage A susceptibility only**, not dated Stage B.

### 1.2 Dataset (seed 42)
- **Positives:** GSI NER records, deduplicated to one per 500 m (the feature-window size) → 5,275 kept from 8,691.
  A random sample of **1,000** is used (compute budget: each point needs a remote DEM window read).
- **Negatives:** the v2 candidate generator unchanged (random point within 30 km of a positive, inside the
  approximate NER-India mask, WorldCover window valid and not majority water), with the exclusion rule extended:
  a candidate is rejected if it lies within **1 km of any of the 8,691 GSI records** (not just the sampled positives)
  or within `max(1 km, accuracy) + 0.5 km` of any NASA GLC/COOLR record with accuracy ≤ 5 km. Rationale: GSI
  coordinates are surveyed, so 1 km covers position error plus the 500 m window, while keeping media-known sites out
  of the negatives as well.
- **Ratio:** 3 negatives per positive (v2 used 5; lowered for the same compute budget at 10× the positives).
- **Design N (naive):** negatives straight from the generator.
- **Design E (exposure-controlled):** negatives frequency-matched to the positives' exposure bins, where exposure `X`
  is the built-up block density in an ≈1.1 km neighbourhood (bins `0`, `(0,0.1]`, `(0.1,0.3]`, `(0.3,0.6]`, `(0.6,1]`),
  exactly as in v2.
- **Features:** T6 terrain only — `slope_deg_mean`, `slope_deg_max`, `elevation_m_mean`, `relief_m`,
  `aspect_sin_mean`, `aspect_cos_mean` — from the same 500 m UTM window method as the pilot grid. Exposure proxies
  (built-up share, `X`, distance to road/settlement, population, `landcover_class`, `landcover_tree_share`) are
  excluded from every candidate, and `past_landslide_density` is never used.
- **Backgrounds:** reused unchanged from v2 — the 2,798-cell Aizawl pilot grid (full census) and the 1,500-point
  clustered NER background.

### 1.3 Validation (identical to v2)
0.5° spatial blocks, `GroupKFold(5)` without shuffle, at offsets (0, 0) and (0.25, 0.25); every training sample within
**5 km** of any test sample of that fold is dropped; `t_op` = the score at which 70 % of training-fold positives are
flagged, computed on inner `GroupKFold(3)` out-of-fold scores with the same buffer; B0 uses its raw training scores.
Models: B0 (untrained, slope + relief + majority land cover), LR (`StandardScaler` + `LogisticRegression(C=1,
class_weight="balanced")`), RF (`RandomForestClassifier(n_estimators=500, min_samples_leaf=5, max_features="sqrt",
class_weight="balanced_subsample", random_state=42)`). No tuning. Metrics: ROC-AUC, PR-AUC, recall at `t_op`, pilot
and NER area share at `t_op`, and the prediction-rate curve on background points inside the test-fold blocks.
A one-feature LR on the 500 m built-up share is reported as an exposure diagnostic and is never adoptable.

### 1.4 Adoption gate (copied verbatim from v2 §1.5)

| # | Criterion |
|---|---|
| a | For **each** offset: mean test ROC-AUC ≥ 0.65, **and** every fold ROC-AUC > 0.5 |
| b | For **each** offset: mean ROC-AUC > B0's mean ROC-AUC on the same folds |
| c | RF may be adopted only if its mean ROC-AUC, pooled over both offsets' 10 folds, exceeds LR's by more than LR's pooled fold std. Otherwise LR is the choice if LR passes. RF cannot be adopted when (c) fails, even if LR fails |
| d | No exposure-proxy feature |
| e | Mean pilot-area share at `t_op` across all 10 folds ≤ 0.30, **and** the final model's pilot share ≤ 0.30, reported together with recall |

Gate is evaluated on **design E** only. If nothing passes, `b0-rules-0.1.0` stays the served model.

**If adopted:** `S = min(1, 0.9 · raw / t_op)` (a cell at `t_op` is exactly HIGH without rainfall), severity cut-offs
unchanged, contributions precomputed offline (LR: coefficient × standardised value), runtime stays dependency-free,
model version `stage-a-<lr|rf>-0.1.0+trigger-rules-0.1.0`, `active_model()` reports the real metrics with
`forecast_skill_evaluated: False`, and the handoff carries `susceptibility_score` + contributions with
`feature_provenance = MODEL_OUTPUT`.

## 2. Results

All numbers from `ml/reports/evaluation-v3-results.json`; dataset counts from
`ml/data/processed/training/v3/build_meta.json`.

### 2.0 Dataset actually built
1,000 positives (from 5,275 deduplicated GSI records; 3,416 dropped as within 500 m of a kept record) and 2,999
negatives per design (one candidate lost to a DEM tile edge). Exposure bins of the positives:
`X=0` 390 · `(0,0.1]` 333 · `(0.1,0.3]` 216 · `(0.3,0.6]` 35 · `(0.6,1]` 26. **Compare v2's media-derived positives,
where 37 % sat in the top built-up bin against 2.6 % here** — the GSI inventory is not settlement-concentrated.
Design E filled every bin quota from 25,968 examined candidates. Minimum positive-to-negative distance: 1,003 m
(design N) and 1,036 m (design E), consistent with the 1 km GSI exclusion buffer.

### 2.1 Design E (exposure-controlled) — gated results, T6 terrain-only

| Model | Offset | ROC-AUC (mean ± std) | fold min–max | PR-AUC | Recall @ t_op | Pilot area @ t_op | NER area @ t_op |
|---|---|---|---|---|---|---|---|
| B0 (untrained) | (0, 0) | 0.693 ± 0.030 | 0.669 – 0.742 | 0.362 | 0.700 | 0.782 | 0.484 |
| B0 (untrained) | (0.25, 0.25) | 0.692 ± 0.052 | 0.616 – 0.762 | 0.362 | 0.705 | 0.784 | 0.485 |
| **LR-T6** | (0, 0) | 0.695 ± 0.024 | 0.666 – 0.725 | 0.367 | 0.698 | 0.850 | 0.374 |
| **LR-T6** | (0.25, 0.25) | 0.696 ± 0.055 | 0.620 – 0.776 | 0.370 | 0.711 | 0.848 | 0.372 |
| **RF-T6** | (0, 0) | 0.708 ± 0.037 | 0.647 – 0.746 | 0.397 | 0.713 | 0.733 | 0.303 |
| **RF-T6** | (0.25, 0.25) | 0.711 ± 0.050 | 0.656 – 0.789 | 0.400 | 0.723 | 0.723 | 0.302 |

Pooled over 10 folds: B0 0.692 ± 0.040, LR 0.696 ± 0.040, RF 0.709 ± 0.041. Test positives per fold: 183–217.
Prediction-rate curve (capture at 5 / 10 / 20 / 30 / 50 % of NER background area, offset 0):
B0 0.10 / 0.24 / 0.40 / 0.55 / 0.78 · LR 0.09 / 0.18 / 0.41 / 0.56 / 0.81 · **RF 0.16 / 0.29 / 0.47 / 0.65 / 0.89**.
Curve area: B0 0.70 ± 0.16, LR 0.71 ± 0.11, RF **0.76 ± 0.06**.

### 2.2 Design N (naive) — side by side

| Model | Pooled ROC-AUC | PR-AUC | Recall @ t_op | Pilot area @ t_op |
|---|---|---|---|---|
| B0 | 0.575 ± 0.030 | 0.278 | 0.697 | 0.781 |
| LR-T6 | 0.588 ± 0.031 | 0.296 | 0.697 | 0.863 |
| RF-T6 | 0.625 ± 0.029 | 0.323 | 0.715 | 0.633 |

### 2.3 Exposure diagnostic (never a candidate)
One-feature LR on the 500 m built-up share, same folds:
- Design N: ROC-AUC 0.673 ± 0.040 (still some settlement signal, because GSI mapping follows roads and towns too).
- **Design E: ROC-AUC 0.488 ± 0.069 — chance.** With surveyed labels the matching removes the exposure signal
  completely, so the design-E numbers above are terrain signal, not reporting bias. In v2 the same diagnostic was
  0.640 under matching and 0.895 without it.

### 2.4 Pre-registered gate

| # | Criterion | LR-T6 | RF-T6 |
|---|---|---|---|
| a | mean ROC-AUC ≥ 0.65 and every fold > 0.5, per offset | **PASS** (0.695 / 0.696; worst fold 0.620) | **PASS** (0.708 / 0.711; worst fold 0.647) |
| b | mean ROC-AUC > B0 on the same folds, per offset | **PASS, but by 0.002 and 0.004** | **PASS** (0.708 vs 0.693; 0.711 vs 0.692) |
| c | RF beats LR by more than LR's pooled fold std | n/a | **FAIL** (0.709 − 0.696 = 0.013 < 0.040) → LR is the selected candidate |
| d | no exposure-proxy features | PASS | PASS |
| e | pilot area flagged ≤ 30 % (fold mean and final model) | **FAIL** (0.849 / 0.847) | **FAIL** (0.728 / 0.740) |

**Outcome: no trained Stage A model is adopted; `b0-rules-0.1.0` stays the served model.** `georakshak_ml` is
unchanged — same interface, same required features (`slope_deg_mean`, `relief_m`), `metrics: None`. The gate was not
loosened, and (e) is what stops adoption for both candidates.

### 2.5 What the numbers mean
1. **A surveyed inventory fixes the label problem.** Every model gains ~0.12 ROC-AUC over v2's media labels
   (LR 0.63 → 0.70 on design N-to-E terms; B0 0.44 → 0.69), the exposure proxy collapses to chance under matching,
   and PR-AUC roughly doubles. The v2 conclusion that "the labels encode where landslides get reported" is now
   confirmed from the other side.
2. **B0 is not beaten in any meaningful sense.** LR clears criterion (b) by 0.002–0.004 ROC-AUC, far inside one fold
   std (0.040). The hand-written index ranks GSI-surveyed landslide sites about as well as a trained terrain-only
   model. RF is the best ranker (0.709, best prediction-rate curve) but fails (c) by design: its edge, 0.013, is a
   third of LR's fold spread.
3. **(e) fails because the pilot is uniformly steep, not because the models are broken.** At the 70 %-recall
   operating point the threshold is low, so 73–85 % of Aizawl's 2,798 cells clear it. Post-hoc (not part of the
   gate): if the threshold is instead set to flag exactly **30 % of the pilot**, test recall is
   **RF 0.335 ± 0.043, B0 0.315 ± 0.046, LR 0.193 ± 0.050**. That same threshold flags only 11.7 % (RF), 30.6 % (B0)
   and 13.3 % (LR) of the NER background, i.e. it is a strict threshold in NER terms that the steep pilot mostly
   fails to clear. Read together: a pilot-area budget of 30 % buys about a third of the NER-wide events, and RF
   reaches that with a quarter of B0's flagged NER area — real but not enough to justify replacing a transparent
   rule, and it still fails the pre-registered (e).
4. **Terrain-only is close to its ceiling with these features.** Both designs, both offsets and all three models sit
   in a narrow 0.69–0.71 band on design E. The next gain has to come from features the inventory can reward
   (lithology, soil depth, drainage, cut-slope geometry) or from polygon labels, not from a different classifier.
5. RF feature importances are flat (slope mean 0.21, slope max 0.19, relief 0.19, elevation 0.17, aspect 0.13/0.11),
   and LR's standardised coefficients are slope mean +0.90, slope max +0.67, relief −0.48, elevation −0.21 — with
   surveyed labels the slope terms finally carry the expected positive sign (in v2 `slope_deg_mean` was −1.89).

## 3. Decision
- **Served model: unchanged `b0-rules-0.1.0`.** No package change, no new required features, `active_model()` still
  reports `metrics: None` and `forecast_skill_evaluated: False`.
- **What did change is the data**: the pilot handoff now carries 169 inventory records from three real sources
  (`gsi-bhusanket` 132, `nasa-glc` 19, `zenodo-aizawl-rsf-2026` 18), and `past_landslide_density` is computed from
  the GSI surveyed inventory instead of 17 media points, so `feature_version` is `pilot-features-0.2.0` and the
  backend should reload the pilot.
- **Next lever, in order:** GSI polygon services (token-protected), dates for the GSI NER records, a surveyed-area
  extent for one Mizoram district, then lithology. See `ml/reports/inventory-hunt-2026-09-18.md` §6.

### 3.1 Replay refresh after the density change (diagnostic, no claim)
`replay_sanity.py` re-run on the rebuilt handoff (B0 served; rain features derived as the backend does; the candidate
column is the **non-adopted** v3 RF):

| Day | Max 1-day rain | B0 (2,798 cells) | Candidate (not served) |
|---|---|---|---|
| 2017-05-15 (first day, partial windows) | 18 mm | LOW 1,002 · MODERATE 1,796 | LOW 78 · MODERATE 648 · HIGH 2,072 |
| 2017-06-13 (peak) | 191.5 mm | LOW 200 · MODERATE 911 · HIGH 1,650 · VERY_HIGH 37 | LOW 18 · MODERATE 70 · HIGH 243 · VERY_HIGH 2,467 |

With `past_landslide_density` now coming from the GSI surveyed inventory, B0 ranks the two dated pilot events higher
than before: the 2017-06-01 event cell moved from the 96.5th to the **99.2nd** percentile of pilot cells, and the
2017-06-10 cell from the 71.4th to the **78.7th**. Both still read MODERATE. Two events cannot validate event
prediction, and no event-prediction claim is made. Full output: `ml/reports/replay-sanity-2026-09-17.json`.

## 4. Deviations from the pre-registration
1. Positives are a **random 1,000-record sample** of the 5,275 deduplicated GSI records, and the negative ratio is
   **3** instead of v2's 5 — both stated in §1.2 before results, both for the DEM-read compute budget.
2. The NER background and pilot-grid features are **reused from v2** (identical method and files).
3. The post-hoc "recall at 30 % pilot area" figures in §2.5 were computed after the gate was evaluated. They are
   labelled post-hoc and did not change any gate decision.
4. Nothing else deviates: label rules, buffers, masks, block sizes, offsets, models, hyperparameters, `t_op` rule,
   metrics and the gate thresholds all ran as written in §1.
