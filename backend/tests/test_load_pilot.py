import json
import shutil

import psycopg

from tests.conftest import DB, FIXTURE, reset_database
from scripts.load_pilot import load


def _slugs() -> set[str]:
    with psycopg.connect(DB) as conn:
        return {r[0] for r in conn.execute("SELECT slug FROM data_sources")}


def test_loading_another_pilot_removes_previous_pilot_sources_only(tmp_path):
    reset_database()
    before = _slugs()
    assert {"mock-pilot", "mock-rainfall", "imd-weather-api", "sms-channel"} <= before

    other = tmp_path / "other-area"
    shutil.copytree(FIXTURE, other)
    for f in other.iterdir():
        text = f.read_text().replace("mock-pilot", "other-pilot").replace("mock-rainfall", "other-rainfall")
        f.write_text(text)
    manifest = json.loads((other / "manifest.json").read_text())
    manifest["pilot_slug"] = "other-area"
    (other / "manifest.json").write_text(json.dumps(manifest))

    counts = load(other, DB)

    after = _slugs()
    assert counts["risk_zones"] > 0
    assert {"other-pilot", "other-rainfall"} <= after
    assert not {"mock-pilot", "mock-rainfall"} & after
    assert before - {"mock-pilot", "mock-rainfall"} <= after, "seeded integrations must survive a pilot reload"
    reset_database()
