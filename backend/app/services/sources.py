from datetime import datetime, timezone


def mark_success(conn, slug: str, status: str | None = None) -> None:
    """Record a real successful call. Only code paths that actually succeeded may call this."""
    conn.execute(
        "UPDATE data_sources SET last_success_at = %s, last_error = NULL, connection_status = COALESCE(%s::connection_status, connection_status) WHERE slug = %s",
        (datetime.now(timezone.utc), status, slug),
    )


def source_id(conn, slug: str):
    row = conn.execute("SELECT id FROM data_sources WHERE slug = %s", (slug,)).fetchone()
    return row["id"] if row else None
