from __future__ import annotations

import hashlib
import os
import tempfile
from pathlib import Path


def write_artifact(
    directory: str,
    filename: str,
    content: str,
    media_type: str,
) -> dict[str, str]:
    destination = Path(directory) / filename
    destination.parent.mkdir(parents=True, exist_ok=True)
    payload = content.encode("utf-8")

    descriptor, temporary_path = tempfile.mkstemp(prefix=f".{filename}.", suffix=".tmp", dir=directory)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(payload)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_path, destination)
    finally:
        if os.path.exists(temporary_path):
            os.unlink(temporary_path)

    return {
        "path": str(destination),
        "media_type": media_type,
        "hash": hashlib.sha256(payload).hexdigest(),
    }
