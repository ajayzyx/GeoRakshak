from psycopg.types.json import Jsonb

from app.config import get_settings


def run_mode() -> str:
    return get_settings().run_mode


def get_state(conn, key: str):
    row = conn.execute("SELECT value FROM system_state WHERE key = %s", (key,)).fetchone()
    return row["value"] if row else None


def set_state(conn, key: str, value) -> None:
    conn.execute(
        "INSERT INTO system_state (key, value) VALUES (%s, %s) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value",
        (key, Jsonb(value)),
    )


def delete_state(conn, key: str) -> None:
    conn.execute("DELETE FROM system_state WHERE key = %s", (key,))
