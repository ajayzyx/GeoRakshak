from collections.abc import Iterator

import psycopg
from psycopg.rows import dict_row
from psycopg_pool import ConnectionPool

from app.config import get_settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            get_settings().database_url,
            min_size=1,
            max_size=10,
            # api.md §1: timestamps are returned in UTC, whatever the server's local timezone is.
            kwargs={"row_factory": dict_row, "options": "-c timezone=UTC"},
            open=True,
        )
    return _pool


def close_pool() -> None:
    global _pool
    if _pool is not None:
        _pool.close()
        _pool = None


def get_db() -> Iterator[psycopg.Connection]:
    """One transaction per request: committed on success, rolled back on error."""
    with get_pool().connection() as conn:
        yield conn
