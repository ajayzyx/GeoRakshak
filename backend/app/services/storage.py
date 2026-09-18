"""Media storage. Local directory in development; an S3-compatible bucket replaces this for cloud (H7)."""
import hashlib
import uuid
from datetime import datetime, timezone
from pathlib import Path

from app.config import get_settings

CHUNK = 1024 * 1024


class TooLarge(Exception):
    pass


def save_stream(fileobj, ext: str, max_bytes: int) -> tuple[str, int, str]:
    root = Path(get_settings().media_dir)
    now = datetime.now(timezone.utc)
    key = f"{now:%Y/%m}/{uuid.uuid4().hex}{ext}"
    path = root / key
    path.parent.mkdir(parents=True, exist_ok=True)
    digest, size = hashlib.sha256(), 0
    try:
        with open(path, "wb") as out:
            while chunk := fileobj.read(CHUNK):
                size += len(chunk)
                if size > max_bytes:
                    raise TooLarge()
                digest.update(chunk)
                out.write(chunk)
    except TooLarge:
        path.unlink(missing_ok=True)
        raise
    return key, size, digest.hexdigest()


def path_for(key: str) -> Path:
    root = Path(get_settings().media_dir).resolve()
    p = (root / key).resolve()
    if root not in p.parents:
        raise ValueError("invalid storage key")
    return p
