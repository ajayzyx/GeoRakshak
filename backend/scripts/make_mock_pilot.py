"""Write a small SIMULATED_DEMO pilot handoff for tests and offline UI work.

The area sits at 0°N 0°E (open ocean) on purpose so it can never be mistaken for a real
NER location. Every feature value is synthetic. Never use this for metrics or the jury demo.
"""
import csv
import json
import sys
from datetime import date, timedelta
from pathlib import Path

N = 6
STEP = 0.0045  # ~500 m
ORIGIN = (0.0, 0.0)


def build(out: Path) -> Path:
    out.mkdir(parents=True, exist_ok=True)
    cells = []
    for r in range(N):
        for c in range(N):
            x0, y0 = ORIGIN[0] + c * STEP, ORIGIN[1] + r * STEP
            ring = [[x0, y0], [x0 + STEP, y0], [x0 + STEP, y0 + STEP], [x0, y0 + STEP], [x0, y0]]
            slope = 8 + 6 * c + 2 * r
            cells.append({
                "type": "Feature",
                "geometry": {"type": "Polygon", "coordinates": [ring]},
                "properties": {
                    "grid_code": f"MOCK-{r:02d}-{c:02d}",
                    "static_features": {"slope_deg_mean": slope, "slope_deg_max": slope + 9, "elevation_m_mean": 400 + 60 * c, "relief_m": 40 + 25 * c},
                    "feature_provenance": {k: "SIMULATED_DEMO" for k in ("slope_deg_mean", "slope_deg_max", "elevation_m_mean", "relief_m")},
                },
            })
    fc = lambda feats: {"type": "FeatureCollection", "features": feats}
    (out / "grid_cells.geojson").write_text(json.dumps(fc(cells)))
    bbox = [ORIGIN[0], ORIGIN[1], ORIGIN[0] + N * STEP, ORIGIN[1] + N * STEP]
    ring = [[bbox[0], bbox[1]], [bbox[2], bbox[1]], [bbox[2], bbox[3]], [bbox[0], bbox[3]], [bbox[0], bbox[1]]]
    (out / "boundary.geojson").write_text(json.dumps(fc([{"type": "Feature", "geometry": {"type": "Polygon", "coordinates": [ring]}, "properties": {"name": "Mock Area — not a real location"}}])))
    mid = STEP * N / 2
    (out / "locations.geojson").write_text(json.dumps(fc([
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [mid + STEP, mid]}, "properties": {"type": "VILLAGE", "name": "Mock Village A", "osm_id": None, "attributes": {}, "source_slug": "mock-pilot"}},
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [mid + 2 * STEP, mid + STEP]}, "properties": {"type": "HEALTH_FACILITY", "name": "Mock Clinic", "osm_id": None, "attributes": {}, "source_slug": "mock-pilot"}},
    ])))
    (out / "road_segments.geojson").write_text(json.dumps(fc([
        {"type": "Feature", "geometry": {"type": "LineString", "coordinates": [[0.0005, mid], [N * STEP - 0.0005, mid]]}, "properties": {"osm_way_id": None, "name": "Mock Road", "road_class": "secondary", "source_slug": "mock-pilot"}},
    ])))
    (out / "historical_landslides.geojson").write_text(json.dumps(fc([
        {"type": "Feature", "geometry": {"type": "Point", "coordinates": [mid + 1.5 * STEP, mid + 0.5 * STEP]}, "properties": {"event_date": None, "event_date_precision": "UNKNOWN", "source_slug": "mock-pilot", "source_record_id": "MOCK-1"}},
    ])))
    with open(out / "rainfall_daily.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["grid_code", "date", "rainfall_mm", "source_slug", "provenance"])
        start = date(2000, 1, 1)
        for d in range(10):
            for cell in cells:
                w.writerow([cell["properties"]["grid_code"], (start + timedelta(days=d)).isoformat(), 5 + d * d * 2.5, "mock-rainfall", "SIMULATED_DEMO"])
    manifest = {
        "pilot_slug": "mock-area", "name": "Mock Area — not a real location", "status": "MOCK", "bbox": bbox,
        "cell_size_m": 500, "projected_crs": "EPSG:32631", "feature_version": "mock-0", "generated_at": "2000-01-01T00:00:00Z",
        "boundary_note": "Synthetic test area in open ocean. Not a real place.",
        "sources": [
            {"slug": "mock-pilot", "kind": "TERRAIN", "provider": "GeoRakshak test fixture", "dataset": "Synthetic mock pilot", "connection_status": "SIMULATED",
             "verification_status": "UNVERIFIED", "licence": "n/a", "attribution_text": "Synthetic test data", "provenance_default": "SIMULATED_DEMO", "status_note": "Test fixture only"},
            {"slug": "mock-rainfall", "kind": "WEATHER_HISTORICAL", "provider": "GeoRakshak test fixture", "dataset": "Synthetic rainfall series", "connection_status": "SIMULATED",
             "verification_status": "UNVERIFIED", "licence": "n/a", "attribution_text": "Synthetic test data", "provenance_default": "SIMULATED_DEMO", "status_note": "Test fixture only"},
        ],
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return out


if __name__ == "__main__":
    target = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).resolve().parent.parent / "tests" / "fixtures" / "mock-area"
    print("wrote", build(target))
