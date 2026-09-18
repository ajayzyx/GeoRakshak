from app.services.sms_text import measure


def test_gsm7_and_ucs2_segment_counts():
    assert measure("Landslide risk High near your area.") == ("GSM7", 1)
    assert measure("a" * 160) == ("GSM7", 1)
    assert measure("a" * 161) == ("GSM7", 2)
    assert measure("a" * 306) == ("GSM7", 2)
    assert measure("a" * 307) == ("GSM7", 3)
    assert measure("") == ("GSM7", 1)
    # GSM-7 extension characters cost two septets each.
    assert measure("a" * 159 + "€") == ("GSM7", 2)
    # Any Devanagari character forces UCS-2 at 70 characters per single message.
    assert measure("भूस्खलन") == ("UCS2", 1)
    assert measure("अ" * 70) == ("UCS2", 1)
    assert measure("अ" * 71) == ("UCS2", 2)
    assert measure("अ" * 134) == ("UCS2", 2)
    assert measure("अ" * 135) == ("UCS2", 3)


def test_hindi_warning_costs_more_segments_than_english(client, admin, authority):
    from app.services import templates

    en = templates.render("WARNING", ["en"], severity="Very High", n=3, reason="", actions="Avoid the slope road.", lead=0)
    hi = templates.render("WARNING", ["hi"], severity="Very High", n=3, reason="", actions="Avoid the slope road.", lead=0)
    en_enc, en_seg = measure(en["en"]["sms_text"])
    hi_enc, hi_seg = measure(hi["hi"]["sms_text"])
    assert en_enc == "GSM7" and hi_enc == "UCS2"
    assert hi_seg >= en_seg, "the Hindi message must not be reported as cheaper than the English one"


def test_sandboxed_sms_records_encoding_and_segments(client, admin, authority):
    client.post("/api/v1/demo/reset", headers=admin)
    client.post("/api/v1/demo/replay/start", headers=admin)
    client.post("/api/v1/demo/replay/step", headers=admin, json={"to_step": 8})
    drafts = client.get("/api/v1/alerts?tier=WARNING&status=DRAFT", headers=authority).json()["items"]
    assert drafts, "replay produced no public WARNING draft"
    approved = client.post(f"/api/v1/alerts/{drafts[0]['id']}/approve", headers=authority,
                           json={"languages": ["en", "hi"], "channels": ["SMS"]}).json()
    assert approved["delivery_summary"]["SMS"]["SANDBOXED"] >= 1
    assert approved["delivery_summary"]["SMS_COST"]["segments"] >= 1

    sms = [d for d in client.get(f"/api/v1/alerts/{drafts[0]['id']}/deliveries", headers=authority).json()["items"] if d["channel"] == "SMS"]
    assert sms and all(d["status"] == "SANDBOXED" and d["channel_mode"] == "SANDBOX" for d in sms), "sandbox SMS is never sent"
    assert all(d["sms_encoding"] in ("GSM7", "UCS2") and d["sms_segments"] >= 1 for d in sms)


def test_only_sms_deliveries_carry_sms_fields(db):
    import psycopg
    import pytest

    row = db.execute("SELECT id FROM notification_deliveries WHERE channel = 'APP_INBOX' LIMIT 1").fetchone()
    if row:
        with pytest.raises(psycopg.errors.CheckViolation):
            db.execute("UPDATE notification_deliveries SET sms_segments = 2 WHERE id = %s", (row["id"],))
        db.rollback()


def test_severity_terms_are_translated_but_free_text_is_not():
    from app.services import templates

    msgs = templates.render("WARNING", ["en", "hi"], severity="Very High", n=2, reason="",
                            actions="Avoid the hill road.", lead=0)
    assert "Very High" in msgs["en"]["body"]
    assert "बहुत अधिक" in msgs["hi"]["body"] and "Very High" not in msgs["hi"]["body"], "severity must be translated"
    # The authority's own wording is inserted verbatim: it is never machine-translated (CLAUDE.md §10 rule 9).
    assert "Avoid the hill road." in msgs["hi"]["body"]
    assert msgs["hi"]["review_status"] == "DRAFT_UNREVIEWED"
    assert templates.severity_term("High", "hi") == "अधिक"
    assert templates.severity_term("High", "mizo-not-loaded") == "High", "unknown language falls back to English"
