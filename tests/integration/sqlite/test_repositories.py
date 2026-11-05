from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

import pytest

from harness_lab.adapters.security.secretbox_codec import SecretBoxCodec
from harness_lab.adapters.sqlite.case_repository import SqliteCaseRepository
from harness_lab.adapters.sqlite.client import open_sqlite_database
from harness_lab.adapters.sqlite.connection_registration_store import (
    SqliteConnectionRegistrationStore,
    _canonical_request,
    _request_hash,
)
from harness_lab.adapters.sqlite.run_repository import SqliteRunRepository
from harness_lab.domain.models.case import CaseRecord
from harness_lab.domain.models.harness import HarnessSnapshot
from harness_lab.domain.models.round import Round, RoundCheckpoint, RoundProgressEvent


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def _agent(database: object) -> None:
    database.prepare("INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)").run(
        "agent-1",
        "domain-1",
        "Agent",
        "2026-11-05T10:00:00.000Z",
    )


def _round() -> Round:
    return Round(
        id="round-1",
        agent_id="agent-1",
        domain_id="domain-1",
        state="setup",
        objective="Improve",
        created_at="2026-11-05T10:00:00.000Z",
        updated_at="2026-11-05T10:00:00.000Z",
    )


def test_case_repository_save_and_list_and_batch_rollback(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    _agent(database)
    repository = SqliteCaseRepository(database)
    first = CaseRecord(
        id="case-a",
        agent_id="agent-1",
        domain_id="domain-1",
        session_id="session-a",
        similarity_group="group-a",
        content="Question A",
        source="manual",
        created_at="2026-11-05T10:00:00.000Z",
    )
    second = CaseRecord(
        id="case-b",
        agent_id="agent-1",
        domain_id="domain-1",
        session_id="session-b",
        similarity_group="group-b",
        content="Question B",
        source="json",
        created_at="2026-11-05T10:00:00.000Z",
    )

    assert _run(repository.save_many((first, second))) == 2
    assert _run(repository.list_by_scope("agent-1", "domain-1")) == (first, second)

    with pytest.raises(ValueError, match="CASE_ALREADY_EXISTS"):
        _run(repository.save_many((
            CaseRecord(
                id="case-c",
                agent_id="agent-1",
                domain_id="domain-1",
                session_id="session-c",
                similarity_group="group-c",
                content="Question C",
                source="manual",
                created_at="2026-11-05T10:00:00.000Z",
            ),
            first,
        )))

    assert _run(repository.list_by_scope("agent-1", "domain-1")) == (first, second)
    database.close()


def test_run_repository_round_commit_is_atomic_and_harness_is_immutable(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    _agent(database)
    repository = SqliteRunRepository(database)
    initial_round = _round()
    _run(repository.save_round(initial_round))
    snapshot = HarnessSnapshot(
        id="snapshot-1",
        agent_id="agent-1",
        domain_id="domain-1",
        version="1.0.0",
        components={"planner": "v1"},
        immutable_constraints=("no-secrets",),
        created_at="2026-11-05T10:00:00.000Z",
    )
    _run(repository.save_harness_snapshot(snapshot))

    event_1 = RoundProgressEvent(
        id="event-1",
        round_id="round-1",
        sequence=1,
        event="collection_started",
        state="collecting",
        occurred_at="2026-11-05T10:01:00.000Z",
        message_code="round.collection.1",
    )
    checkpoint_1 = RoundCheckpoint(
        id="checkpoint-1",
        round_id="round-1",
        state="collecting",
        sequence=1,
        created_at="2026-11-05T10:01:00.000Z",
    )
    collecting_round = initial_round.model_copy(
        update={"state": "collecting", "updated_at": "2026-11-05T10:01:00.000Z"}
    )
    _run(
        repository.commit_progress(
            round_obj=collecting_round,
            checkpoint=checkpoint_1,
            event=event_1,
        )
    )

    with pytest.raises(Exception):
        database.prepare("UPDATE harness_versions SET payload_json = ? WHERE id = ?").run(
            "{}",
            "snapshot-1",
        )

    diagnosing_round = collecting_round.model_copy(
        update={"state": "diagnosing", "updated_at": "2026-11-05T10:02:00.000Z"}
    )
    checkpoint_2 = RoundCheckpoint(
        id="checkpoint-2",
        round_id="round-1",
        state="diagnosing",
        sequence=2,
        created_at="2026-11-05T10:02:00.000Z",
    )
    duplicate_sequence_event = RoundProgressEvent(
        id="event-duplicate",
        round_id="round-1",
        sequence=1,
        event="diagnosis_started",
        state="diagnosing",
        occurred_at="2026-11-05T10:02:00.000Z",
        message_code="round.diagnosis.1",
    )
    with pytest.raises(Exception):
        _run(
            repository.commit_progress(
                round_obj=diagnosing_round,
                checkpoint=checkpoint_2,
                event=duplicate_sequence_event,
            )
        )

    assert _run(repository.get_round("round-1")) == collecting_round
    assert repository.get_checkpoint("round-1", 2) is None
    database.close()


def test_round_event_and_checkpoint_cascade_delete(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    _agent(database)
    repository = SqliteRunRepository(database)
    _run(repository.save_round(_round()))
    _run(
        repository.save_event(
            RoundProgressEvent(
                id="event-1",
                round_id="round-1",
                sequence=1,
                event="collection_started",
                state="collecting",
                occurred_at="2026-11-05T10:01:00.000Z",
                message_code="round.collection.1",
            )
        )
    )
    _run(repository.save_checkpoint(
        RoundCheckpoint(
            id="checkpoint-1",
            round_id="round-1",
            state="collecting",
            sequence=1,
            created_at="2026-11-05T10:01:00.000Z",
        )
    ))

    database.prepare("DELETE FROM rounds WHERE id = ?").run("round-1")
    assert database.prepare("SELECT COUNT(*) FROM round_events").get()[0] == 0
    assert database.prepare("SELECT COUNT(*) FROM checkpoints").get()[0] == 0
    database.close()


def test_connection_registration_idempotency_and_encrypted_secret(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    encoded_master_key = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
    codec = SecretBoxCodec(encoded_master_key)
    store = SqliteConnectionRegistrationStore(database, codec)
    request = {
        "id": "langfuse-main",
        "kind": "langfuse",
        "name": "Langfuse",
        "credentials": {"publicKey": "pk", "secretKey": "sk"},
        "idempotencyKey": "req-1",
    }

    created = _run(store.register(request))
    assert created["status"] == "created"
    replayed = _run(store.register(request))
    assert replayed["status"] == "replayed"

    with pytest.raises(ValueError, match="IDEMPOTENCY_CONFLICT"):
        _run(store.register({**request, "id": "another"}))

    ciphertext = database.prepare(
        "SELECT ciphertext FROM encrypted_secrets WHERE id = ?"
    ).get("langfuse-main")[0]
    assert isinstance(ciphertext, str)
    persisted = b"".join(path.read_bytes() for path in tmp_path.glob("harness.sqlite*"))
    assert b'"secretKey":"sk"' not in persisted
    assert b'"publicKey":"pk"' not in persisted
    database.close()


def test_connection_registration_unicode_canonicalization_matches_json_stringify(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    encoded_master_key = "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY="
    codec = SecretBoxCodec(encoded_master_key)
    store = SqliteConnectionRegistrationStore(database, codec)
    request = {
        "id": "langfuse-unicode",
        "kind": "langfuse",
        "name": "Conexão São Paulo",
        "credentials": {"publicKey": "pk", "secretKey": "ação-token"},
        "idempotencyKey": "req-unicode-1",
    }

    canonical = _canonical_request(request)
    assert "\\u" not in canonical

    ts_json_stringify_equivalent = json.dumps(
        {
            "id": request["id"],
            "kind": request["kind"],
            "name": request["name"],
            "credentials": dict(sorted(request["credentials"].items(), key=lambda item: item[0])),
        },
        separators=(",", ":"),
        ensure_ascii=False,
    )
    assert canonical == ts_json_stringify_equivalent

    expected_hash = hashlib.sha256(ts_json_stringify_equivalent.encode("utf-8")).hexdigest()
    assert _request_hash(request) == expected_hash

    created = _run(store.register(request))
    assert created["status"] == "created"
    replayed = _run(store.register(request))
    assert replayed["status"] == "replayed"

    stored_hash = database.prepare(
        "SELECT request_hash FROM connection_registrations WHERE idempotency_key = ?"
    ).get("req-unicode-1")[0]
    assert str(stored_hash) == expected_hash
    database.close()