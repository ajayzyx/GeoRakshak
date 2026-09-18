"""Seed demo users and the honest initial integration registry. Idempotent.

Demo users are SIMULATED_DEMO accounts with fictional names. Their password comes from
DEMO_USER_PASSWORD and is for local development only.
"""
import argparse

import psycopg
from psycopg.types.json import Jsonb

from app.config import get_settings
from app.security import hash_secret
from scripts.load_pilot import upsert_source

INTEGRATIONS = [
    {"slug": "imd-weather-api", "kind": "WEATHER_LIVE", "provider": "India Meteorological Department", "dataset": "IMD weather API",
     "connection_status": "AWAITING_ACCESS", "status_note": "Access request pending. No live IMD data in use.", "provenance_default": "REAL_LIVE"},
    {"slug": "imerg-feed", "kind": "SATELLITE_FEED", "provider": "NASA GES DISC", "dataset": "GPM IMERG (Early/Late)",
     "connection_status": "NOT_CONNECTED", "status_note": "Adapter slot only. Not connected.", "provenance_default": "REAL_LIVE"},
    {"slug": "virtual-soil-moisture", "kind": "SENSOR", "provider": "GeoRakshak virtual sensor emulator", "dataset": "Virtual soil moisture stations",
     "connection_status": "SIMULATED", "status_note": "Virtual stations posting through the real sensor ingestion API.", "provenance_default": "SIMULATED_DEMO"},
    {"slug": "sensor-gateway", "kind": "SENSOR", "provider": "—", "dataset": "Physical sensor gateway / partner network",
     "connection_status": "NOT_CONNECTED", "status_note": "Ingestion contract ready. No physical devices connected."},
    {"slug": "replay-forecast", "kind": "WEATHER_FORECAST", "provider": "GeoRakshak replay", "dataset": "Replay scenario forecast",
     "connection_status": "SIMULATED", "status_note": "Uses later days of the replay period as a stand-in forecast. Not a real forecast.", "provenance_default": "SIMULATED_DEMO"},
    {"slug": "app-inbox-channel", "kind": "NOTIFICATION_CHANNEL", "provider": "GeoRakshak", "dataset": "In-app inbox",
     "connection_status": "NOT_CONNECTED", "status_note": "Becomes CONNECTED_LIVE after the first successful in-app delivery."},
    {"slug": "app-push-channel", "kind": "NOTIFICATION_CHANNEL", "provider": "Firebase Cloud Messaging", "dataset": "FCM push",
     "connection_status": "NOT_CONNECTED", "status_note": "No FCM project configured. Inbox polling is used instead."},
    {"slug": "open-meteo-forecast", "kind": "WEATHER_FORECAST", "provider": "Open-Meteo (non-IMD model forecast)", "dataset": "Daily precipitation forecast",
     "connection_status": "NOT_CONNECTED", "provenance_default": "REAL_LIVE",
     "licence": "CC-BY 4.0 (Open-Meteo free API, non-commercial use). Attribution to Open-Meteo and the underlying national weather services.",
     "attribution_text": "Open-Meteo (non-IMD model forecast)",
     "status_note": "Approved non-IMD fallback for forecast rainfall (H16). Adapter implemented; not enabled (WEATHER_PROVIDER=none). Forecast skill not evaluated."},
    {"slug": "open-meteo-recent", "kind": "WEATHER_HISTORICAL", "provider": "Open-Meteo (non-IMD model forecast)", "dataset": "Recent daily precipitation",
     "connection_status": "NOT_CONNECTED", "provenance_default": "REAL_LIVE",
     "licence": "CC-BY 4.0 (Open-Meteo free API, non-commercial use). Attribution to Open-Meteo and the underlying national weather services.",
     "attribution_text": "Open-Meteo (non-IMD model forecast)",
     "status_note": "Model-derived recent precipitation, NOT gauge observations and NOT IMD. Adapter implemented; not enabled (WEATHER_PROVIDER=none)."},
    {"slug": "sms-channel", "kind": "NOTIFICATION_CHANNEL", "provider": "—", "dataset": "SMS",
     "connection_status": "SANDBOX", "status_note": "Messages rendered and logged, not sent (H14: gateway only after DLT compliance and cost clearance)."},
]

# (name, email, role, is_citizen, preferred_language). Two citizens with different languages, so an approved
# public warning actually renders per recipient language instead of English only. Phone numbers are fictional.
USERS = [
    ("Demo Administrator", "admin.demo@example.org", "ADMIN", False, "en"),
    ("Demo District Authority", "authority.demo@example.org", "DISTRICT_AUTHORITY", False, "en"),
    ("Demo Field Officer", "officer.demo@example.org", "FIELD_OFFICER", False, "en"),
    ("Demo Citizen (English)", "citizen.demo@example.org", "CITIZEN", True, "en"),
    ("Demo Citizen (Hindi)", "citizen.hi.demo@example.org", "CITIZEN", True, "hi"),
]


def seed(database_url: str) -> None:
    settings = get_settings()
    with psycopg.connect(database_url) as conn:
        for s in INTEGRATIONS:
            existing = conn.execute("SELECT connection_status FROM data_sources WHERE slug = %s", (s["slug"],)).fetchone()
            if existing is None:
                upsert_source(conn, {**s, "verification_status": "UNVERIFIED", "metadata": {}})
        boundary = conn.execute("SELECT boundary_id, bbox FROM pilot_area WHERE is_active LIMIT 1").fetchone()
        pw = hash_secret(settings.demo_user_password)
        for i, (name, email, role, is_citizen, language) in enumerate(USERS):
            conn.execute(
                """INSERT INTO users (full_name, email, password_hash, role, is_demo_account, sms_enabled, phone, phone_consent_at, preferred_language)
                   VALUES (%s, %s, %s, %s, true, %s, %s, CASE WHEN %s THEN now() END, %s)
                   ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash,
                       preferred_language = EXCLUDED.preferred_language, full_name = EXCLUDED.full_name""",
                (name, email, pw, role, is_citizen, f"+91000000000{i}" if is_citizen else None, is_citizen, language),
            )
        if boundary:
            b = boundary[1]
            conn.execute("UPDATE users SET admin_boundary_id = %s", (boundary[0],))
            conn.execute(
                "UPDATE users SET registered_location = ST_SetSRID(ST_MakePoint(%s, %s), 4326) WHERE role = 'CITIZEN'",
                ((b[0] + b[2]) / 2, (b[1] + b[3]) / 2),
            )
        conn.commit()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=get_settings().database_url)
    args = parser.parse_args()
    seed(args.database_url)
    print("seeded")
