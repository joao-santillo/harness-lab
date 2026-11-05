from __future__ import annotations

import json
from datetime import UTC, datetime

from harness_lab.domain.models.case import CaseRecord

from .client import SqliteDatabase

MAX_CASES_PER_IMPORT = 500


def _validate_semantics(record: CaseRecord) -> None:
    if record.source == "historical" and record.source_reference is None:
        raise ValueError("HISTORICAL_SOURCE_REFERENCE_REQUIRED")
    if record.source == "synthetic" and record.synthetic_label != "SYNTHETIC":
        raise ValueError("SYNTHETIC_LABEL_REQUIRED")


class SqliteCaseRepository:
    def __init__(self, database: SqliteDatabase) -> None:
        self._database = database

    async def save_many(self, cases: tuple[CaseRecord, ...]) -> int:
        if len(cases) == 0 or len(cases) > MAX_CASES_PER_IMPORT:
            raise ValueError("CASE_IMPORT_SIZE_INVALID")
        if len({case.id for case in cases}) != len(cases):
            raise ValueError("CASE_ID_DUPLICATE")
        for case in cases:
            _validate_semantics(case)

        created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")

        def op() -> None:
            statement = self._database.prepare(
                """INSERT INTO cases
                (id, agent_id, domain_id, created_at, payload_version, payload_json)
                VALUES (?, ?, ?, ?, 1, ?)"""
            )
            for item in cases:
                statement.run(
                    item.id,
                    item.agent_id,
                    item.domain_id,
                    created_at,
                    json.dumps(item.model_dump(by_alias=True), separators=(",", ":")),
                )

        try:
            self._database.transaction(op)()
        except Exception as error:
            message = str(error)
            if "UNIQUE constraint failed: cases.id" in message:
                raise ValueError("CASE_ALREADY_EXISTS") from error
            if (
                "FOREIGN KEY constraint failed" in message
                or "case scope must match agent scope" in message
            ):
                raise ValueError("CASE_SCOPE_INVALID") from error
            raise

        await self._database.flush()
        return len(cases)

    async def save_many_ignoring_existing(self, cases: tuple[CaseRecord, ...]) -> int:
        if len(cases) == 0 or len(cases) > MAX_CASES_PER_IMPORT:
            raise ValueError("CASE_IMPORT_SIZE_INVALID")
        if len({case.id for case in cases}) != len(cases):
            raise ValueError("CASE_ID_DUPLICATE")
        for case in cases:
            _validate_semantics(case)

        created_at = datetime.now(UTC).isoformat().replace("+00:00", "Z")
        inserted = 0

        def op() -> None:
            nonlocal inserted
            statement = self._database.prepare(
                """INSERT OR IGNORE INTO cases
                (id, agent_id, domain_id, created_at, payload_version, payload_json)
                VALUES (?, ?, ?, ?, 1, ?)"""
            )
            for item in cases:
                statement.run(
                    item.id,
                    item.agent_id,
                    item.domain_id,
                    created_at,
                    json.dumps(item.model_dump(by_alias=True), separators=(",", ":")),
                )
                changed = self._database.prepare("SELECT changes() AS count").get()
                inserted += int(changed[0] if changed is not None else 0)

        try:
            self._database.transaction(op)()
        except Exception as error:
            message = str(error)
            if (
                "FOREIGN KEY constraint failed" in message
                or "case scope must match agent scope" in message
            ):
                raise ValueError("CASE_SCOPE_INVALID") from error
            raise

        await self._database.flush()
        return inserted

    async def list_by_scope(self, agent_id: str, domain_id: str) -> tuple[CaseRecord, ...]:
        rows = self._database.prepare(
            """SELECT payload_version, payload_json FROM cases
            WHERE agent_id = ? AND domain_id = ? ORDER BY created_at, id"""
        ).all(agent_id, domain_id)

        result: list[CaseRecord] = []
        for row in rows:
            if int(row[0]) != 1:
                raise ValueError("CASE_PAYLOAD_VERSION_UNSUPPORTED")
            payload = json.loads(str(row[1]))
            item = CaseRecord.model_validate(payload)
            if item.agent_id != agent_id or item.domain_id != domain_id:
                raise ValueError("CASE_SCOPE_CORRUPT")
            result.append(item)

        return tuple(result)
