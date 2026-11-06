from __future__ import annotations

import sqlite3
import subprocess
from pathlib import Path


def test_backup_is_consistent_private_and_writable_copy(tmp_path: Path) -> None:
    source = tmp_path / "source.sqlite"
    destination = tmp_path / "backup.sqlite"
    with sqlite3.connect(source) as database:
        database.execute("PRAGMA journal_mode=WAL")
        database.execute("CREATE TABLE records (id INTEGER PRIMARY KEY, value TEXT NOT NULL)")
        database.execute("INSERT INTO records (value) VALUES ('before-backup')")

    result = subprocess.run(
        ["uv", "run", "python", "scripts/backup_sqlite.py", str(source), str(destination)],
        check=True,
        capture_output=True,
        text=True,
    )

    assert result.stdout.startswith("sha256:")
    assert len(result.stdout.split()[0].removeprefix("sha256:")) == 64
    assert destination.stat().st_mode & 0o777 == 0o600
    with sqlite3.connect(destination) as backup:
        assert backup.execute("PRAGMA integrity_check").fetchone() == ("ok",)
        assert backup.execute("SELECT value FROM records").fetchone() == ("before-backup",)
        backup.execute("INSERT INTO records (value) VALUES ('smoke-write')")
        assert backup.execute("SELECT COUNT(*) FROM records").fetchone() == (2,)