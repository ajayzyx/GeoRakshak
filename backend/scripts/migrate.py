"""Apply backend/migrations/*.sql in order. Usage: python -m scripts.migrate [--database-url URL]"""
import argparse
from pathlib import Path

import psycopg

from app.config import get_settings

MIGRATIONS = Path(__file__).resolve().parent.parent / "migrations"


def migrate(database_url: str) -> list[str]:
    applied = []
    with psycopg.connect(database_url, autocommit=False) as conn:
        conn.execute("CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz DEFAULT now())")
        done = {r[0] for r in conn.execute("SELECT name FROM schema_migrations")}
        for path in sorted(MIGRATIONS.glob("*.sql")):
            if path.name in done:
                continue
            conn.execute(path.read_text())
            conn.execute("INSERT INTO schema_migrations (name) VALUES (%s)", (path.name,))
            applied.append(path.name)
        conn.commit()
    return applied


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--database-url", default=get_settings().database_url)
    args = parser.parse_args()
    print("applied:", migrate(args.database_url) or "nothing new")
