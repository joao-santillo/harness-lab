from __future__ import annotations

import json

from harness_lab.domain.models.harness import HarnessSnapshot
from harness_lab.domain.models.round import Round, RoundCheckpoint, RoundProgressEvent

from .client import SqliteDatabase


def _parse_payload(row: object) -> dict[str, object]:
    parsed: dict[str, object] = json.loads(str(row))
    return parsed


class SqliteRunRepository:
    def __init__(self, database: SqliteDatabase) -> None:
        self._database = database

    async def save_agent(self, agent: dict[str, str]) -> None:
        self._database.assert_open()
        self._database.prepare(
            "INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)"
        ).run(agent["id"], agent["domainId"], agent["name"], agent["createdAt"])
        await self._database.flush()

    async def save_harness_snapshot(self, snapshot: HarnessSnapshot) -> None:
        self._database.assert_open()
        valid_snapshot = HarnessSnapshot.model_validate(snapshot)
        self._database.prepare(
            """INSERT INTO harness_versions
            (id, agent_id, domain_id, version, created_at, payload_version, payload_json)
            VALUES (?, ?, ?, ?, ?, 1, ?)"""
        ).run(
            valid_snapshot.id,
            valid_snapshot.agent_id,
            valid_snapshot.domain_id,
            valid_snapshot.version,
            valid_snapshot.created_at,
            json.dumps(valid_snapshot.model_dump(by_alias=True), separators=(",", ":")),
        )
        await self._database.flush()

    def get_harness_snapshot(self, snapshot_id: str) -> HarnessSnapshot | None:
        row = self._database.prepare("SELECT payload_json FROM harness_versions WHERE id = ?").get(
            snapshot_id
        )
        if row is None:
            return None
        return HarnessSnapshot.model_validate(_parse_payload(row[0]))

    async def get_round(self, round_id: str) -> Round | None:
        row = self._database.prepare("SELECT payload_json FROM rounds WHERE id = ?").get(round_id)
        if row is None:
            return None
        return Round.model_validate(_parse_payload(row[0]))

    async def list_rounds(self, limit: int = 100) -> tuple[Round, ...]:
        if limit < 1 or limit > 500:
            raise ValueError("ROUND_LIST_LIMIT_INVALID")
        rows = self._database.prepare(
            "SELECT payload_json FROM rounds ORDER BY created_at DESC, id LIMIT ?"
        ).all(limit)
        return tuple(Round.model_validate(_parse_payload(row[0])) for row in rows)

    async def save_round(self, round_obj: Round) -> None:
        self._database.assert_open()
        self._upsert_round(Round.model_validate(round_obj))
        await self._database.flush()

    async def create_round_with_job(self, round_obj: Round, now: str) -> None:
        self._database.assert_open()
        valid_round = Round.model_validate(round_obj)

        def operation() -> None:
            if self._database.prepare("SELECT 1 FROM rounds WHERE id = ?").get(valid_round.id) is not None:
                raise ValueError("ROUND_ALREADY_EXISTS")
            self._upsert_round(valid_round)
            self._database.prepare(
                """INSERT INTO round_jobs
                (round_id, status, claimed_by, claimed_at, created_at, updated_at)
                VALUES (?, 'queued', NULL, NULL, ?, ?)"""
            ).run(valid_round.id, now, now)

        self._database.transaction(operation)()
        await self._database.flush()

    async def commit_progress(
        self, *, round_obj: Round, checkpoint: RoundCheckpoint, event: RoundProgressEvent
    ) -> None:
        self._database.assert_open()
        valid_round = Round.model_validate(round_obj)
        valid_checkpoint = RoundCheckpoint.model_validate(checkpoint)
        valid_event = RoundProgressEvent.model_validate(event)
        if valid_checkpoint.round_id != valid_round.id or valid_event.round_id != valid_round.id:
            raise ValueError("Round progress records must share the same round id")

        def operation() -> None:
            self._upsert_round(valid_round)
            self._insert_checkpoint(valid_checkpoint)
            self._insert_event(valid_event)

        self._database.transaction(operation)()
        await self._database.flush()

    async def list_events(self, round_id: str, after_sequence: int) -> tuple[RoundProgressEvent, ...]:
        rows = self._database.prepare(
            """SELECT payload_json FROM round_events
            WHERE round_id = ? AND sequence > ?
            ORDER BY sequence ASC"""
        ).all(round_id, after_sequence)
        return tuple(RoundProgressEvent.model_validate(_parse_payload(row[0])) for row in rows)

    async def save_event(self, event: RoundProgressEvent) -> None:
        self._database.assert_open()
        self._insert_event(RoundProgressEvent.model_validate(event))
        await self._database.flush()

    async def save_checkpoint(self, checkpoint: RoundCheckpoint) -> None:
        self._database.assert_open()
        self._insert_checkpoint(RoundCheckpoint.model_validate(checkpoint))
        await self._database.flush()

    def get_checkpoint(self, round_id: str, sequence: int) -> RoundCheckpoint | None:
        row = self._database.prepare(
            "SELECT payload_json FROM checkpoints WHERE round_id = ? AND sequence = ?"
        ).get(round_id, sequence)
        if row is None:
            return None
        return RoundCheckpoint.model_validate(_parse_payload(row[0]))

    def _upsert_round(self, round_obj: Round) -> None:
        existing = self._database.prepare(
            "SELECT agent_id, domain_id, created_at FROM rounds WHERE id = ?"
        ).get(round_obj.id)
        if existing is not None and (
            str(existing[0]) != str(round_obj.agent_id)
            or str(existing[1]) != str(round_obj.domain_id)
            or str(existing[2]) != str(round_obj.created_at)
        ):
            raise ValueError("Round identity and scope are immutable")

        self._database.prepare(
            """INSERT INTO rounds
            (id, agent_id, domain_id, state, objective, created_at, updated_at, payload_version, payload_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
            ON CONFLICT(id) DO UPDATE SET
              state = excluded.state,
              objective = excluded.objective,
              updated_at = excluded.updated_at,
              payload_version = excluded.payload_version,
              payload_json = excluded.payload_json"""
        ).run(
            round_obj.id,
            round_obj.agent_id,
            round_obj.domain_id,
            round_obj.state,
            round_obj.objective,
            round_obj.created_at,
            round_obj.updated_at,
            json.dumps(round_obj.model_dump(by_alias=True), separators=(",", ":")),
        )

    def _insert_checkpoint(self, checkpoint: RoundCheckpoint) -> None:
        self._database.prepare(
            """INSERT INTO checkpoints
            (id, round_id, sequence, created_at, payload_version, payload_json)
            VALUES (?, ?, ?, ?, 1, ?)"""
        ).run(
            checkpoint.id,
            checkpoint.round_id,
            checkpoint.sequence,
            checkpoint.created_at,
            json.dumps(checkpoint.model_dump(by_alias=True), separators=(",", ":")),
        )

    def _insert_event(self, event: RoundProgressEvent) -> None:
        self._database.prepare(
            """INSERT INTO round_events
            (id, round_id, sequence, occurred_at, payload_version, payload_json)
            VALUES (?, ?, ?, ?, 1, ?)"""
        ).run(
            event.id,
            event.round_id,
            event.sequence,
            event.occurred_at,
            json.dumps(event.model_dump(by_alias=True), separators=(",", ":")),
        )
