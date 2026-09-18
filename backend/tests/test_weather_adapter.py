from datetime import date, datetime, timedelta, timezone

import psycopg
from psycopg.rows import dict_row

import pytest

from app.adapters import weather
from app.config import get_settings
from app.services import monitor, scoring, weather_ingest
from tests.conftest import DB


class StubProvider:
    """Stands in for a real provider. Tests never call a live API (CLAUDE.md §8 rule 6)."""

    slug = "open-meteo"
    label = "Stub provider (test)"
    is_imd = False

    def __init__(self, fail: bool = False):
        self.fail = fail
        self.calls: list[str] = []

    def observed_daily(self, points, days):
        self.calls.append("observed")
        if self.fail:
            raise weather.NotConnected("stub offline")
        today = datetime.now(timezone.utc).date()
        return [weather.DailyRainfall(point_index=i, day=today - timedelta(days=d), rainfall_mm=5.0 + d)
                for i in range(len(points)) for d in (1, 2)]

    def forecast_daily(self, points, days):
        self.calls.append("forecast")
        if self.fail:
            raise weather.NotConnected("stub offline")
        today = datetime.now(timezone.utc).date()
        return weather.ForecastBatch(issue_time=datetime.now(timezone.utc),
                                     days=[weather.DailyRainfall(point_index=i, day=today + timedelta(days=d), rainfall_mm=20.0)
                                           for i in range(len(points)) for d in (0, 1, 2)])


def _sources(conn, slugs):
    return {r["slug"]: r for r in conn.execute(
        "SELECT slug, connection_status::text AS connection_status, last_error, licence, status_note FROM data_sources WHERE slug = ANY(%s)",
        (slugs,)).fetchall()}


def test_provider_resolution_and_imd_stays_unconnected():
    assert weather.get_provider("none") is None and weather.get_provider(None) is None
    with pytest.raises(ValueError):
        weather.get_provider("made-up-provider")
    imd = weather.get_provider("imd-weather-api")
    with pytest.raises(weather.NotConnected):
        imd.observed_daily([(23.7, 92.7)], 3)
    with pytest.raises(weather.NotConnected):
        imd.forecast_daily([(23.7, 92.7)], 3)


def test_ingest_writes_labelled_rows_and_only_then_reports_connected(client):
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        result = weather_ingest.ingest(conn, StubProvider())
        assert result["observations"] > 0 and result["forecasts"] > 0 and result["is_imd"] is False
        rows = _sources(conn, [result["observed_source"], result["forecast_source"]])
        assert all(r["connection_status"] == "CONNECTED_LIVE" for r in rows.values()), "status follows a real successful call"
        assert "not gauge observations" in rows[result["observed_source"]]["status_note"]
        assert "Non-IMD" in rows[result["observed_source"]]["status_note"]
        obs = conn.execute(
            """SELECT count(*) AS n, count(DISTINCT risk_zone_id) AS zones, min(provenance::text) AS p
               FROM rainfall_observations ro JOIN data_sources ds ON ds.id = ro.source_id WHERE ds.slug = %s""",
            (result["observed_source"],)).fetchone()
        assert obs["n"] > 0 and obs["p"] == "REAL_LIVE"
        assert obs["zones"] == conn.execute("SELECT count(*) AS n FROM risk_zones").fetchone()["n"], "every cell takes its nearest point"
        leads = conn.execute(
            """SELECT DISTINCT lead_time_h FROM rainfall_forecasts rf JOIN data_sources ds ON ds.id = rf.source_id
               WHERE ds.slug = %s ORDER BY 1""", (result["forecast_source"],)).fetchall()
        assert [r["lead_time_h"] for r in leads] == [24, 48, 72]
        conn.execute("DELETE FROM rainfall_observations WHERE provenance = 'REAL_LIVE'")
        conn.execute("DELETE FROM rainfall_forecasts WHERE provenance = 'REAL_LIVE'")
        conn.execute("UPDATE data_sources SET connection_status = 'NOT_CONNECTED', last_success_at = NULL WHERE slug LIKE 'open-meteo%'")
        conn.commit()


def test_a_failing_provider_writes_nothing_and_records_the_error(client):
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        before = conn.execute("SELECT count(*) AS n FROM rainfall_observations").fetchone()["n"]
        with pytest.raises(weather.NotConnected):
            weather_ingest.ingest(conn, StubProvider(fail=True))
        conn.commit()
        assert conn.execute("SELECT count(*) AS n FROM rainfall_observations").fetchone()["n"] == before
        rows = _sources(conn, ["open-meteo-recent", "open-meteo-forecast"])
        assert rows and all(r["connection_status"] == "NOT_CONNECTED" for r in rows.values())
        assert all("stub offline" in (r["last_error"] or "") for r in rows.values())
        conn.execute("UPDATE data_sources SET last_error = NULL WHERE slug LIKE 'open-meteo%'")
        conn.commit()


def test_endpoint_requires_a_configured_provider_and_admin(client, admin, authority):
    assert client.post("/api/v1/system/weather/ingest", headers=authority).status_code == 403
    r = client.post("/api/v1/system/weather/ingest", headers=admin)
    assert r.status_code == 409 and "WEATHER_PROVIDER" in r.json()["error"]["message"]


def test_live_cycle_reports_weather_outcome(client, admin, authority, monkeypatch):
    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")
    monkeypatch.setattr(get_settings(), "weather_provider", "open-meteo")
    stub = StubProvider()
    monkeypatch.setattr(weather, "get_provider", lambda name: stub)

    state = monitor.run_and_record("MANUAL")  # MANUAL always fetches; scheduled runs are throttled (see test_monitor)
    assert state["last_status"] == "OK" and state["weather"]["observations"] > 0 and state["weather_error"] is None
    assert stub.calls == ["observed", "forecast"]
    shown = client.get("/api/v1/system/mode", headers=authority).json()["monitor"]
    assert shown["weather_provider"] == "open-meteo" and shown["weather"]["forecasts"] > 0

    monkeypatch.setattr(weather, "get_provider", lambda name: StubProvider(fail=True))
    degraded = monitor.run_and_record("MANUAL")
    assert degraded["last_status"] == "OK", "a weather outage must not stop the risk cycle"
    assert "stub offline" in degraded["weather_error"] and degraded["result"]["scored"] > 0


def test_one_rainfall_value_per_cell_day_with_official_data_preferred(client, authority):
    """Two sources covering the same day must not be summed, and the winner must be deterministic."""
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        zone = conn.execute("SELECT id FROM risk_zones LIMIT 1").fetchone()["id"]
        day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=1)
        conn.execute("""INSERT INTO data_sources (slug, kind, provider, dataset, connection_status, verification_status, provenance_default)
                        VALUES ('imd-test-gridded', 'WEATHER_HISTORICAL', 'IMD test', 'official', 'CONNECTED_HISTORICAL', 'VERIFIED', 'REAL_HISTORICAL'),
                               ('other-test-model', 'WEATHER_HISTORICAL', 'Model test', 'non-IMD', 'CONNECTED_LIVE', 'UNVERIFIED', 'REAL_LIVE')
                        ON CONFLICT (slug) DO NOTHING""")
        for slug, mm, prov in (("imd-test-gridded", 11.0, "REAL_HISTORICAL"), ("other-test-model", 99.0, "REAL_LIVE")):
            conn.execute("""INSERT INTO rainfall_observations (risk_zone_id, period_start, period_end, rainfall_mm, source_id, provenance)
                            SELECT %s, %s, %s, %s, id, %s FROM data_sources WHERE slug = %s""",
                         (zone, day, day + timedelta(days=1), mm, prov, slug))
        conn.commit()
        try:
            series = scoring._daily_series(conn, day + timedelta(days=1), "LIVE")
            assert series[zone][1] == (11.0, "REAL_HISTORICAL"), "IMD data must win, and values must not be summed"
        finally:
            conn.execute("DELETE FROM rainfall_observations WHERE source_id IN (SELECT id FROM data_sources WHERE slug IN ('imd-test-gridded','other-test-model'))")
            conn.execute("DELETE FROM data_sources WHERE slug IN ('imd-test-gridded', 'other-test-model')")
            conn.commit()


def test_live_scoring_never_uses_simulated_rainfall(client, authority):
    """A LIVE risk view must be computed from real data only; replay and mock rainfall are SIMULATED_DEMO."""
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        zone = conn.execute("SELECT id FROM risk_zones LIMIT 1").fetchone()["id"]
        # A day no other test writes to, so the precedence rule is not what is under test here.
        day = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=5)
        as_of = day + timedelta(days=1)
        sim = conn.execute("SELECT id FROM data_sources WHERE provenance_default = 'SIMULATED_DEMO' LIMIT 1").fetchone()["id"]
        conn.execute("""INSERT INTO rainfall_observations (risk_zone_id, period_start, period_end, rainfall_mm, source_id, provenance)
                        VALUES (%s, %s, %s, 250.0, %s, 'SIMULATED_DEMO')""", (zone, day, as_of, sim))
        conn.execute("""INSERT INTO rainfall_forecasts (risk_zone_id, issue_time, valid_start, valid_end, lead_time_h, rainfall_mm, source_id, provenance)
                        VALUES (%s, %s, %s, %s, 24, 300.0, %s, 'SIMULATED_DEMO')""", (zone, as_of, as_of, as_of + timedelta(days=1), sim))
        conn.commit()
        try:
            live_series = scoring._daily_series(conn, as_of, "LIVE").get(zone, {})
            assert live_series.get(1, (None, None))[1] != "SIMULATED_DEMO", "simulated rainfall leaked into LIVE scoring"
            assert live_series.get(1, (0.0, None))[0] != 250.0
            live_forecast = scoring._forecasts(conn, as_of, "LIVE").get(zone, {})
            assert live_forecast.get(24, (0.0, None, None))[0] != 300.0, "simulated forecast leaked into LIVE scoring"
            # The replay is explicitly labelled, so DEMO_REPLAY may use it.
            assert scoring._daily_series(conn, as_of, "DEMO_REPLAY")[zone][1] == (250.0, "SIMULATED_DEMO")
            assert scoring._forecasts(conn, as_of, "DEMO_REPLAY")[zone][24][0] == 300.0
        finally:
            conn.execute("DELETE FROM rainfall_observations WHERE provenance = 'SIMULATED_DEMO' AND period_start = %s", (day,))
            conn.execute("DELETE FROM rainfall_forecasts WHERE provenance = 'SIMULATED_DEMO' AND issue_time = %s", (as_of,))
            conn.commit()
