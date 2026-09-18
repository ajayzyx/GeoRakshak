# GeoRakshak — ML track (`ml/`)

| Path | What |
|---|---|
| `georakshak_ml/` | Scoring package used by the backend (docs/development.md §5). Active model: `b0-rules-0.1.0`, an uncalibrated rule-based index. Model card: `georakshak_ml/README.md` |
| `tests/` | Fixed-input pytest suite, no network |
| `pipeline/` | Offline data acquisition, pilot handoff build, and Stage A training (see `pipeline/README.md`) |
| `data/raw/` | Downloaded source data (gitignored) |
| `data/processed/<pilot_slug>/` | Backend handoff files (docs/development.md §6). Large files are gitignored, so rebuild with the pipeline |
| `reports/` | `data-spike.md`, `evaluation-2026-09-17.md`, and the raw JSON results behind them |
| `STATUS.md` | Short integration status for other tracks |

```bash
/opt/homebrew/bin/python3.11 -m venv ml/.venv
ml/.venv/bin/pip install -e 'ml[test]'            # add ,pipeline for the data pipeline
cd ml && .venv/bin/python -m pytest -q
```
