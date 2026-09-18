# GSI data access and permission — technical checklist

> **For whoever contacts the Geological Survey of India.** This is a request checklist, not a claim of access.
> Current state (2026-09-18): we use the **public** GSI landslide point inventory from the Bhusanket portal.
> No permission has been granted, no token has been issued, and nothing here may be presented as GSI approval.

## 1. What we already use, and under what terms

| Item | Detail |
|---|---|
| Endpoint | `https://bhusanket.gsi.gov.in/gisserver/rest/services/Hosted/Public_Portal_Dashboard_Map/FeatureServer/0` (layer `Landslide_Public`, points, 134 fields) |
| Discovered via | `https://bhusanket.gsi.gov.in/json/config.json` (the portal's own configuration) |
| Volume retrieved | 31,545 records nationally · 8,691 in the 8 NER states · **132 inside the Aizawl pilot** |
| Used for | Map layer (OR-05) and the `past_landslide_density` model feature; Stage A experiments |
| Terms as published | [bhusanket.gsi.gov.in/terms.html](https://bhusanket.gsi.gov.in/terms.html): material "may be reproduced free of charge **after taking proper permission** by sending a mail to us", reproduced accurately, and "the source must be **prominently acknowledged**" |
| How we handle it today | Raw data is gitignored and never redistributed. The dashboard marks the source "permission required for publication". Derived maps are **not** published. |
| Unreachable | `bhukosh.gsi.gov.in` — DNS resolves (144.24.99.164) but every TCP connect to 443 and 80 timed out (19 logged attempts, 2026-09-17 and 2026-09-18; log: `ml/data/raw/inventory_hunt/attempts.tsv`) |

## 2. What to ask for, in priority order

1. **Written permission to reproduce and publish derived products.** Specifically: risk maps and dashboards derived from the GSI inventory, shown in (a) a Smart India Hackathon demonstration and public presentation, (b) screenshots in a report or slide deck, (c) a publicly reachable demo deployment. Ask what acknowledgement wording GSI requires and where it must appear.
2. **Access to the polygon services.** `GSI/Landslide_Polygon` and `GSI/GSI_Landslide_India` return `499 Token Required`. Ask for a token or an alternative export. **Why it matters technically:** point records give one coordinate per landslide, so a 500 m analysis cell containing the scar, its crown or its toe all receive the same label. Our evaluation has plateaued at ROC-AUC ≈ 0.70 across three label sets and three feature families, and polygon outlines are the single change most likely to move it.
3. **Event dates.** In the NER records we retrieved, `date`, `date_acc` and `geo_acc` are empty for every row (2,270 carry an initiation year only). Dated events are required for any time-based (rainfall-triggered) model, which we currently cannot validate at all.
4. **Surveyed extent.** Ask whether the mapped or surveyed *extent* is available — i.e. which areas were actually examined. Without it, "no record here" cannot be distinguished from "never surveyed", so our negatives are unlabelled rather than true absences. This is what currently forces an exposure-matched sampling design.
5. **Susceptibility mapping (NLSM) outputs**, if shareable, as an independent benchmark for our own model.
6. **Update cadence and a stable access route** for refreshes, plus any rate limits we should respect.

## 3. Questions worth asking explicitly

- Is the Bhusanket public point layer usable under the terms above for a non-commercial academic or hackathon demonstration, with acknowledgement, pending written permission?
- Does permission differ for (a) internal development, (b) a live public demo, (c) published screenshots?
- What citation text should accompany the inventory and any derived map?
- Is there a contact or process for a student team, and a realistic turnaround?

## 4. If permission or access does not arrive

Development continues on the currently permitted, clearly-labelled data — this is not a software blocker:

- The map layer and `past_landslide_density` keep using the public point inventory, marked "permission required for publication", and no derived map is published until permission exists.
- Fallbacks already verified and in use: NASA GLC/COOLR (permission-to-use text attached) and a CC-BY-4.0 research inventory for Aizawl.
- `b0-rules-0.1.0` remains the served model, so no model decision depends on this request.
- If publication permission is refused before the demo, present the risk layer and explanations without showing the GSI inventory layer, and say why.
