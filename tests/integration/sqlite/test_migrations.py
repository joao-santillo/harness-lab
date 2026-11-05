from __future__ import annotations

from pathlib import Path

import pytest

from harness_lab.adapters.sqlite.client import open_sqlite_database


def test_applies_all_migrations_and_pragmas_for_file_database(tmp_path: Path) -> None:
    db_path = tmp_path / "harness.sqlite"
    database = open_sqlite_database(str(db_path))

    names = [
        row[0]
        for row in database.prepare("SELECT name FROM schema_migrations ORDER BY name").all()
    ]
    assert names == [
        "0001_foundation",
        "0002_immutable_harness",
        "0003_scope_integrity",
        "0004_encrypted_secrets",
        "0005_connection_registrations",
        "0006_round_jobs",
        "0007_round_artifacts",
        "0008_round_job_cancellation_leases",
    ]

    foreign_keys = database.prepare("PRAGMA foreign_keys").get()[0]
    busy_timeout = database.prepare("PRAGMA busy_timeout").get()[0]
    journal_mode = str(database.prepare("PRAGMA journal_mode").get()[0]).lower()
    synchronous = database.prepare("PRAGMA synchronous").get()[0]
    assert foreign_keys == 1
    assert busy_timeout == 5000
    assert journal_mode == "wal"
    assert synchronous == 2

    database.close()


def test_memory_database_does_not_force_wal(tmp_path: Path) -> None:
    _ = tmp_path
    database = open_sqlite_database(":memory:")
    journal_mode = str(database.prepare("PRAGMA journal_mode").get()[0]).lower()
    assert journal_mode != "wal"
    database.close()


def test_rejects_migration_checksum_mismatch(tmp_path: Path) -> None:
    db_path = tmp_path / "harness.sqlite"
    database = open_sqlite_database(str(db_path))
    database.prepare("UPDATE schema_migrations SET checksum = ? WHERE name = ?").run(
        "tampered",
        "0001_foundation",
    )
    database.close()

    with pytest.raises(ValueError, match="Migration checksum mismatch: 0001_foundation"):
        open_sqlite_database(str(db_path))


def test_rejects_legacy_checksum_backfill_when_schema_differs(tmp_path: Path) -> None:
    db_path = tmp_path / "harness.sqlite"
    database = open_sqlite_database(str(db_path))
    database.prepare("UPDATE schema_migrations SET checksum = NULL WHERE name = ?").run(
        "0001_foundation",
    )
    database.exec("DROP TABLE connections")
    database.close()

    with pytest.raises(ValueError, match="Legacy migration verification failed: 0001_foundation"):
        open_sqlite_database(str(db_path))


def test_rejects_scope_migration_when_legacy_rows_are_invalid(tmp_path: Path) -> None:
    db_path = tmp_path / "harness.sqlite"
    database = open_sqlite_database(str(db_path))

    triggers = database.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'trigger' AND name LIKE '%_validate_scope_insert'"
    ).all()
    for trigger in triggers:
        database.exec(f"DROP TRIGGER {trigger[0]}")

    database.prepare("DELETE FROM schema_migrations WHERE name = ?").run("0003_scope_integrity")
    database.prepare("INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)").run(
        "agent-1",
        "domain-1",
        "Agent",
        "2026-11-05T10:00:00.000Z",
    )
    database.prepare(
        """INSERT INTO rounds
           (id, agent_id, domain_id, state, objective, created_at, updated_at, payload_json)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)"""
    ).run(
        "round-1",
        "agent-1",
        "other-domain",
        "setup",
        "objective",
        "2026-11-05T10:00:00.000Z",
        "2026-11-05T10:00:00.000Z",
        "{}",
    )
    database.close()

    with pytest.raises(ValueError, match="Legacy scope integrity violation"):
        open_sqlite_database(str(db_path))