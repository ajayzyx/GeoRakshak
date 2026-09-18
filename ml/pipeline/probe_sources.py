"""Logged HTTP probes for the mapped-inventory hunt (ml/reports/inventory-hunt-2026-09-18.md).

Every attempt is appended to ml/data/raw/inventory_hunt/attempts.tsv with a UTC timestamp, the exact URL,
the HTTP status (or the error), the byte count and the content type. Nothing is recorded as a source unless
a real retrieval succeeded.

Usage: ml/.venv/bin/python ml/pipeline/probe_sources.py <group> <url> [<url> ...]
"""

from __future__ import annotations

import sys
from datetime import datetime, timezone
from pathlib import Path

import requests

from common import RAW, USER_AGENT

LOG_DIR = RAW / "inventory_hunt"
LOG = LOG_DIR / "attempts.tsv"
TIMEOUT = (6, 25)  # connect, read


def probe(group: str, url: str, save: Path | None = None, method: str = "GET") -> dict:
    LOG_DIR.mkdir(parents=True, exist_ok=True)
    if not LOG.exists():
        LOG.write_text("utc_time\tgroup\tmethod\turl\tresult\tbytes\tcontent_type\tnote\n")
    row = {"utc_time": datetime.now(timezone.utc).isoformat(timespec="seconds"), "group": group, "method": method,
           "url": url, "result": "", "bytes": "", "content_type": "", "note": ""}
    out = {"status": None, "text": "", "content": b""}
    try:
        r = requests.request(method, url, headers={"User-Agent": USER_AGENT}, timeout=TIMEOUT, allow_redirects=True)
        row["result"] = f"HTTP {r.status_code}"
        row["bytes"] = len(r.content)
        row["content_type"] = r.headers.get("Content-Type", "")
        if r.url != url:
            row["note"] = f"redirected to {r.url}"
        if save is not None and r.status_code == 200:
            save.parent.mkdir(parents=True, exist_ok=True)
            save.write_bytes(r.content)
            row["note"] = (row["note"] + f" saved {save.name}").strip()
        ct = row["content_type"]
        out = {"status": r.status_code,
               "text": r.text if any(k in ct for k in ("text", "json", "xml")) else "",
               "content": r.content, "url": r.url}
    except Exception as e:  # timeouts, TLS, DNS
        row["result"] = type(e).__name__
        row["note"] = str(e)[:200]
    with open(LOG, "a") as fh:
        fh.write("\t".join(str(row[k]) for k in ("utc_time", "group", "method", "url", "result", "bytes", "content_type", "note")) + "\n")
    print(f"{row['result']:>14} {str(row['bytes']):>9}  {url}\n                          {row['note'][:140]}", flush=True)
    return {**row, **out}


def main():
    group, urls = sys.argv[1], sys.argv[2:]
    for u in urls:
        probe(group, u)


if __name__ == "__main__":
    main()
