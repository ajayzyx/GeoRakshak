from app.config import get_settings
from app.services import monitor, scoring


def test_demo_replay_reports_the_scheduler_off_and_refuses_manual_cycles(client, admin, authority):
    mode = client.get("/api/v1/system/mode", headers=authority).json()
    assert mode["monitor"]["enabled"] is False and "replay steps" in mode["monitor"]["note"]
    r = client.post("/api/v1/system/monitor/run", headers=admin)
    assert r.status_code == 409 and "replay" in r.json()["error"]["message"]


def test_live_mode_cycle_runs_records_and_is_visible(client, admin, authority, monkeypatch):
    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")
    monkeypatch.setattr(get_settings(), "monitor_interval_s", 900)

    state = client.post("/api/v1/system/monitor/run", headers=admin).json()
    assert state["last_status"] == "OK" and state["trigger"] == "MANUAL" and state["run_mode"] == "LIVE"
    assert state["result"]["scored"] > 0 and state["result"]["model_version"]

    shown = client.get("/api/v1/system/mode", headers=authority).json()["monitor"]
    assert shown["enabled"] is True and shown["interval_s"] == 900
    assert shown["last_status"] == "OK" and shown["last_error"] is None
    assert shown["next_run_at"] > shown["last_run_at"], "next run must be scheduled after the last one"
    assert client.post("/api/v1/system/monitor/run", headers=authority).status_code == 403


def test_a_failing_cycle_is_recorded_and_shown_not_swallowed(client, admin, authority, monkeypatch):
    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")

    def boom(*a, **kw):
        raise RuntimeError("scoring unavailable")

    monkeypatch.setattr(scoring, "score_all", boom)
    assert client.post("/api/v1/system/monitor/run", headers=admin).status_code == 500
    shown = client.get("/api/v1/system/mode", headers=authority).json()["monitor"]
    assert shown["last_status"] == "FAILED" and "scoring unavailable" in shown["last_error"]

    monkeypatch.undo()
    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")
    assert monitor.run_and_record("TEST")["last_status"] == "OK", "the next cycle recovers"


def test_weather_is_not_refetched_on_every_cycle(client, admin, authority, monkeypatch):
    from app.adapters import weather
    from tests.test_weather_adapter import StubProvider

    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")
    monkeypatch.setattr(get_settings(), "weather_provider", "open-meteo")
    monkeypatch.setattr(get_settings(), "weather_min_interval_s", 3600)
    stub = StubProvider()
    monkeypatch.setattr(weather, "get_provider", lambda name: stub)

    first = monitor.run_and_record("SCHEDULER")
    assert first["weather"]["observations"] > 0 and stub.calls == ["observed", "forecast"]

    second = monitor.run_and_record("SCHEDULER")
    assert second["weather"]["skipped"] == "fetched recently", "a provider must not be polled every cycle"
    assert stub.calls == ["observed", "forecast"], "no second fetch"

    manual = monitor.run_and_record("MANUAL")
    assert manual["weather"]["observations"] > 0, "an explicit request still fetches"
    assert stub.calls == ["observed", "forecast", "observed", "forecast"]


def test_live_history_is_pruned_but_replay_history_is_kept(client, admin, monkeypatch):
    import psycopg
    from psycopg.rows import dict_row
    from tests.conftest import DB

    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")
    monkeypatch.setattr(get_settings(), "assessment_retention_days", 7)
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        zone = conn.execute("SELECT id FROM risk_zones LIMIT 1").fetchone()["id"]
        model = conn.execute("SELECT id FROM model_versions LIMIT 1").fetchone()["id"]
        old = "now() - interval '30 days'"
        for mode in ("LIVE", "DEMO_REPLAY"):
            conn.execute(f"""INSERT INTO risk_assessments (risk_zone_id, model_version_id, lead_time_h, issue_time, valid_from,
                                 valid_until, score, severity, confidence, factors, input_provenance, run_mode, is_latest)
                             VALUES (%s, %s, 0, {old}, {old}, now(), 0.1, 'LOW', 'LOW', '[]'::jsonb, '{{}}', %s, false)""",
                         (zone, model, mode))
        conn.commit()
        before_demo = conn.execute("SELECT count(*) AS n FROM risk_assessments WHERE run_mode = 'DEMO_REPLAY' AND NOT is_latest").fetchone()["n"]

        result = monitor.prune_history(conn, "LIVE")
        assert result["pruned"] and result["assessments_deleted"] >= 1
        assert conn.execute("SELECT count(*) AS n FROM risk_assessments WHERE run_mode = 'LIVE' AND NOT is_latest AND issue_time < now() - interval '7 days'").fetchone()["n"] == 0
        after_demo = conn.execute("SELECT count(*) AS n FROM risk_assessments WHERE run_mode = 'DEMO_REPLAY' AND NOT is_latest").fetchone()["n"]
        assert after_demo == before_demo, "replay history must survive pruning"
        assert monitor.prune_history(conn, "DEMO_REPLAY") == {"pruned": False}
        conn.rollback()


def test_last_success_at_survives_a_failure(client, admin, authority, monkeypatch):
    from app.services import scoring

    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")
    monkeypatch.setattr(get_settings(), "weather_provider", "none")
    ok = monitor.run_and_record("MANUAL")
    assert ok["last_success_at"] == ok["last_run_at"]

    monkeypatch.setattr(scoring, "score_all", lambda *a, **kw: (_ for _ in ()).throw(RuntimeError("db gone")))
    failed = monitor.run_and_record("MANUAL")
    assert failed["last_status"] == "FAILED"
    assert failed["last_success_at"] == ok["last_run_at"], "a client must still be able to say how stale the data is"
    shown = client.get("/api/v1/system/mode", headers=authority).json()["monitor"]
    assert shown["last_success_at"] == ok["last_run_at"] and shown["last_status"] == "FAILED"


def test_skipped_weather_fetch_reports_zero_not_unknown(client, admin, monkeypatch):
    from app.adapters import weather
    from tests.test_weather_adapter import StubProvider

    monkeypatch.setattr(get_settings(), "run_mode", "LIVE")
    monkeypatch.setattr(get_settings(), "weather_provider", "open-meteo")
    monkeypatch.setattr(get_settings(), "weather_min_interval_s", 3600)
    monkeypatch.setattr(weather, "get_provider", lambda name: StubProvider())
    monitor.run_and_record("MANUAL")
    skipped = monitor.run_and_record("SCHEDULER")["weather"]
    assert skipped["observations"] == 0 and skipped["forecasts"] == 0
    assert skipped["observed_source"] and skipped["forecast_source"] and skipped["last_fetch_at"]


def test_replay_keeps_only_the_latest_assessments_but_never_drops_an_alert_trigger(client, admin, authority):
    import psycopg
    from psycopg.rows import dict_row
    from tests.conftest import DB

    client.post("/api/v1/demo/reset", headers=admin)
    client.post("/api/v1/demo/replay/start", headers=admin)
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        after_start = conn.execute("SELECT count(*) AS n FROM risk_assessments WHERE run_mode = 'DEMO_REPLAY'").fetchone()["n"]
    client.post("/api/v1/demo/replay/step", headers=admin, json={"to_step": 8})
    with psycopg.connect(DB, row_factory=dict_row) as conn:
        rows = conn.execute("SELECT count(*) AS n FROM risk_assessments WHERE run_mode = 'DEMO_REPLAY'").fetchone()["n"]
        superseded = conn.execute("SELECT count(*) AS n FROM risk_assessments WHERE run_mode = 'DEMO_REPLAY' AND NOT is_latest").fetchone()["n"]
        triggers = conn.execute(
            """SELECT count(*) AS n FROM alerts a JOIN risk_assessments ra ON ra.id = a.triggering_assessment_id
               WHERE a.run_mode = 'DEMO_REPLAY'""").fetchone()["n"]
        alerts_with_trigger = conn.execute(
            "SELECT count(*) AS n FROM alerts WHERE run_mode = 'DEMO_REPLAY' AND triggering_assessment_id IS NOT NULL").fetchone()["n"]
    assert rows <= after_start + superseded + 8, f"replay history is not accumulating ({rows} rows after 8 steps)"
    assert superseded == triggers, "the only superseded rows kept are the ones alerts point at"
    assert triggers == alerts_with_trigger, "every alert still resolves its triggering assessment"
