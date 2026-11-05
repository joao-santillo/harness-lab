from __future__ import annotations

import hashlib
import sqlite3
from collections.abc import Callable
from datetime import UTC, datetime
from pathlib import Path
from typing import TypeVar

BindValue = str | int | float | None | bytes
T = TypeVar("T")


MIGRATIONS: tuple[tuple[str, Path], ...] = (
    ("0001_foundation", Path(__file__).with_name("migrations") / "0001_foundation.sql"),
    (
        "0002_immutable_harness",
        Path(__file__).with_name("migrations") / "0002_immutable_harness.sql",
    ),
    (
        "0003_scope_integrity",
        Path(__file__).with_name("migrations") / "0003_scope_integrity.sql",
    ),
    (
        "0004_encrypted_secrets",
        Path(__file__).with_name("migrations") / "0004_encrypted_secrets.sql",
    ),
    (
        "0005_connection_registrations",
        Path(__file__).with_name("migrations") / "0005_connection_registrations.sql",
    ),
    ("0006_round_jobs", Path(__file__).with_name("migrations") / "0006_round_jobs.sql"),
    (
        "0007_round_artifacts",
        Path(__file__).with_name("migrations") / "0007_round_artifacts.sql",
    ),
    (
        "0008_round_job_cancellation_leases",
        Path(__file__).with_name("migrations") / "0008_round_job_cancellation_leases.sql",
    ),
)


class SqliteStatement:
    def __init__(self, connection: sqlite3.Connection, sql: str) -> None:
        self._connection = connection
        self._sql = sql

    def run(self, *parameters: BindValue) -> None:
        self._connection.execute(self._sql, parameters)

    def get(self, *parameters: BindValue) -> sqlite3.Row | None:
        return self._connection.execute(self._sql, parameters).fetchone()

    def all(self, *parameters: BindValue) -> list[sqlite3.Row]:
        return self._connection.execute(self._sql, parameters).fetchall()


class SqliteDatabase:
    def __init__(self, connection: sqlite3.Connection) -> None:
        self._connection = connection
        self._state: str = "open"
        self._transaction_depth = 0

    def assert_open(self) -> None:
        if self._state == "closed":
            raise ValueError("SQLite database is closed")

    def prepare(self, sql: str) -> SqliteStatement:
        self.assert_open()
        return SqliteStatement(self._connection, sql)

    def exec(self, sql: str) -> None:
        self.assert_open()
        self._exec_script(sql)

    def _exec_script(self, sql: str) -> None:
        buffer = ""
        for line in sql.splitlines(keepends=True):
            buffer += line
            if sqlite3.complete_statement(buffer):
                command = buffer.strip()
                if command:
                    self._connection.execute(command)
                buffer = ""
        trailing = buffer.strip()
        if trailing:
            self._connection.execute(trailing)

    def transaction(self, operation: Callable[[], T]) -> Callable[[], T]:
        def wrapped() -> T:
            self.assert_open()
            if self._transaction_depth > 0:
                return operation()

            self._connection.execute("BEGIN IMMEDIATE")
            self._transaction_depth += 1
            try:
                result = operation()
                self._connection.execute("COMMIT")
                return result
            except Exception as error:
                try:
                    self._connection.execute("ROLLBACK")
                except Exception as rollback_error:
                    raise RuntimeError("Transaction and rollback failed") from Exception(
                        f"{error!r}; {rollback_error!r}"
                    )
                raise
            finally:
                self._transaction_depth = 0

        return wrapped

    async def flush(self) -> None:
        self.assert_open()

    def close(self) -> None:
        if self._state == "closed":
            return
        self._connection.close()
        self._state = "closed"


def _migration_checksum(sql: str) -> str:
    return hashlib.sha256(sql.encode("utf-8")).hexdigest()


def _normalize_schema_sql(sql: object) -> str:
    text = str(sql)
    compact = " ".join(text.split())
    for token in ("(", ")", ","):
        compact = compact.replace(f" {token}", token).replace(f"{token} ", token)
    return compact.strip().lower()


def _schema_objects(database: SqliteDatabase, object_type: str) -> dict[str, str]:
    rows = database.prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'"
    ).all(object_type)
    return {str(row[0]): _normalize_schema_sql(row[1]) for row in rows}


def _verify_legacy_migration(database: SqliteDatabase, name: str, sql: str) -> None:
    if name == "0001_foundation":
        expected_connection = sqlite3.connect(":memory:")
        try:
            expected_connection.row_factory = sqlite3.Row
            expected_connection.executescript(sql)
            expected_database = SqliteDatabase(expected_connection)
            expected_tables = _schema_objects(expected_database, "table")
            actual_tables = _schema_objects(database, "table")
            for table_name, definition in expected_tables.items():
                if actual_tables.get(table_name) != definition:
                    raise ValueError("Legacy migration verification failed: 0001_foundation")
            return
        finally:
            expected_connection.close()

    if name == "0002_immutable_harness":
        trigger_rows = database.prepare(
            "SELECT name FROM sqlite_master WHERE type = 'trigger'"
        ).all()
        triggers = {str(row[0]) for row in trigger_rows}
        if (
            "harness_versions_reject_update" not in triggers
            or "harness_versions_reject_delete" not in triggers
        ):
            raise ValueError("Legacy migration verification failed: 0002_immutable_harness")
        return

    raise ValueError(f"Legacy migration has no verifier: {name}")


def _verify_existing_scope(database: SqliteDatabase) -> None:
    invalid = database.prepare(
        """SELECT 1 FROM (
        SELECT 1 FROM rounds r LEFT JOIN agents a ON a.id = r.agent_id AND a.domain_id = r.domain_id WHERE a.id IS NULL
        UNION ALL SELECT 1 FROM harness_versions h LEFT JOIN agents a ON a.id = h.agent_id AND a.domain_id = h.domain_id WHERE a.id IS NULL
        UNION ALL SELECT 1 FROM connections c LEFT JOIN agents a ON a.id = c.agent_id AND a.domain_id = c.domain_id WHERE a.id IS NULL
        UNION ALL SELECT 1 FROM capabilities c LEFT JOIN agents a ON a.id = c.agent_id AND a.domain_id = c.domain_id WHERE a.id IS NULL
        UNION ALL SELECT 1 FROM cases c LEFT JOIN agents a ON a.id = c.agent_id AND a.domain_id = c.domain_id WHERE a.id IS NULL
        UNION ALL SELECT 1 FROM case_partitions p LEFT JOIN cases c ON c.id = p.case_id AND c.domain_id = p.domain_id WHERE c.id IS NULL
        UNION ALL SELECT 1 FROM executions e LEFT JOIN rounds r ON r.id = e.round_id AND r.agent_id = e.agent_id AND r.domain_id = e.domain_id LEFT JOIN cases c ON c.id = e.case_id AND c.agent_id = e.agent_id AND c.domain_id = e.domain_id WHERE r.id IS NULL OR c.id IS NULL
        UNION ALL SELECT 1 FROM findings x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
        UNION ALL SELECT 1 FROM proposals x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
        UNION ALL SELECT 1 FROM evaluations x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
        UNION ALL SELECT 1 FROM learnings x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
        UNION ALL SELECT 1 FROM exports x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
        ) LIMIT 1"""
    ).get()
    if invalid is not None:
        raise ValueError("Legacy scope integrity violation")


def _migrate(database: SqliteDatabase) -> None:
    database.exec(
        """CREATE TABLE IF NOT EXISTS schema_migrations (
        name TEXT PRIMARY KEY,
        checksum TEXT,
        applied_at TEXT NOT NULL
      )"""
    )
    columns = database.prepare("PRAGMA table_info(schema_migrations)").all()
    if not any(str(column[1]) == "checksum" for column in columns):
        database.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT")

    migration_sql = {
        name: path.read_text(encoding="utf-8") for name, path in MIGRATIONS
    }

    def apply_all() -> None:
        for name, _path in MIGRATIONS:
            sql = migration_sql[name]
            checksum = _migration_checksum(sql)
            existing = database.prepare(
                "SELECT checksum FROM schema_migrations WHERE name = ?"
            ).get(name)
            if existing is None:
                if name == "0003_scope_integrity":
                    _verify_existing_scope(database)
                database.exec(sql)
                database.prepare(
                    "INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)"
                ).run(name, checksum, datetime.now(UTC).isoformat().replace("+00:00", "Z"))
            elif existing[0] is None:
                _verify_legacy_migration(database, name, sql)
                database.prepare("UPDATE schema_migrations SET checksum = ? WHERE name = ?").run(
                    checksum,
                    name,
                )
            elif str(existing[0]) != checksum:
                raise ValueError(f"Migration checksum mismatch: {name}")

    database.transaction(apply_all)()


def open_sqlite_database(path: str) -> SqliteDatabase:
    connection = sqlite3.connect(path, isolation_level=None)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    connection.execute("PRAGMA busy_timeout = 5000")
    if path != ":memory:":
        connection.execute("PRAGMA journal_mode = WAL")
        connection.execute("PRAGMA synchronous = FULL")

    database = SqliteDatabase(connection)
    try:
        _migrate(database)
        return database
    except Exception:
        database.close()
        raise
