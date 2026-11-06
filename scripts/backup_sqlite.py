from __future__ import annotations

import argparse
import hashlib
import sqlite3
from pathlib import Path


def backup_database(source: Path, destination: Path) -> str:
    if not source.is_file():
        raise FileNotFoundError(source)
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".tmp")
    temporary.unlink(missing_ok=True)
    try:
        with sqlite3.connect(f"file:{source}?mode=ro", uri=True) as source_database:
            with sqlite3.connect(temporary) as destination_database:
                source_database.backup(destination_database)
                integrity = destination_database.execute("PRAGMA integrity_check").fetchone()
                if integrity is None or integrity[0] != "ok":
                    raise RuntimeError("SQLITE_BACKUP_INTEGRITY_FAILED")
        temporary.chmod(0o600)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return hashlib.sha256(destination.read_bytes()).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser(description="Create and verify a consistent SQLite backup.")
    parser.add_argument("source", type=Path)
    parser.add_argument("destination", type=Path)
    arguments = parser.parse_args()
    digest = backup_database(arguments.source, arguments.destination)
    print(f"sha256:{digest}  {arguments.destination}")


if __name__ == "__main__":
    main()