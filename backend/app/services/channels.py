"""Notification channels (architecture.md §3.6). SMS is SANDBOX-only until H14 clearance."""
from app.services.sms_text import measure
from app.services.sources import mark_success


def _mask(phone: str | None) -> str | None:
    return None if not phone else phone[:3] + "*" * max(len(phone) - 7, 0) + phone[-4:]


def _message(alert: dict, lang: str) -> tuple[str, dict]:
    msgs = alert["messages"] or {}
    chosen = lang if lang in msgs else ("en" if "en" in msgs else next(iter(msgs), None))
    return chosen, msgs.get(chosen, {"title": "", "body": "", "sms_text": ""})


def dispatch(conn, alert: dict, recipients: list[dict], channels: list[str]) -> dict:
    summary: dict = {}
    for user in recipients:
        lang, msg = _message(alert, user["preferred_language"])
        if "APP_INBOX" in channels:
            conn.execute(
                """INSERT INTO notification_deliveries (alert_id, recipient_id, channel, language, rendered_text, status, channel_mode, sent_at)
                   VALUES (%s, %s, 'APP_INBOX', %s, %s, 'SENT', 'LIVE', now())""",
                (alert["id"], user["id"], lang, f"{msg['title']}\n{msg['body']}"),
            )
            summary.setdefault("APP_INBOX", {}).setdefault("SENT", 0)
            summary["APP_INBOX"]["SENT"] += 1
        if "APP_PUSH" in channels:
            # FCM isn't configured (no Firebase project). Nothing is sent and no delivery is claimed.
            summary.setdefault("APP_PUSH", {}).setdefault("NOT_CONNECTED", 0)
            summary["APP_PUSH"]["NOT_CONNECTED"] += 1
        if "SMS" in channels and user.get("sms_enabled") and user.get("phone"):
            text = msg.get("sms_text", "")
            encoding, segments = measure(text)  # what a real gateway would charge for (H14)
            conn.execute(
                """INSERT INTO notification_deliveries (alert_id, recipient_id, channel, language, destination_masked, rendered_text,
                       status, channel_mode, sms_encoding, sms_segments)
                   VALUES (%s, %s, 'SMS', %s, %s, %s, 'SANDBOXED', 'SANDBOX', %s, %s)""",
                (alert["id"], user["id"], lang, _mask(user["phone"]), text, encoding, segments),
            )
            summary.setdefault("SMS", {}).setdefault("SANDBOXED", 0)
            summary["SMS"]["SANDBOXED"] += 1
            summary.setdefault("SMS_COST", {}).setdefault("segments", 0)
            summary["SMS_COST"]["segments"] += segments
    if summary.get("APP_INBOX"):
        mark_success(conn, "app-inbox-channel", "CONNECTED_LIVE")
    return summary
