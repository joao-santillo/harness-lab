from __future__ import annotations

import asyncio
from pathlib import Path

from harness_lab.adapters.sqlite.client import open_sqlite_database
from harness_lab.adapters.sqlite.round_job_store import SqliteRoundJobStore
from harness_lab.adapters.sqlite.run_repository import SqliteRunRepository
from harness_lab.domain.models.round import Round


def _run[T](coroutine: T) -> T:
    return asyncio.run(coroutine)


def _setup_round(database: object, round_id: str, created_at: str) -> None:
    database.prepare("INSERT OR IGNORE INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)").run(
        "agent-1",
        "domain-1",
        "Agent",
        created_at,
    )
    repository = SqliteRunRepository(database)
    _run(
        repository.save_round(
            Round(
                id=round_id,
                agent_id="agent-1",
                domain_id="domain-1",
                state="setup",
                objective="Improve",
                created_at=created_at,
                updated_at=created_at,
            )
        )
    )


def test_claim_order_and_lease_and_cancellation_flow(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    _setup_round(database, "round-a", "2026-11-05T10:00:00.000Z")
    _setup_round(database, "round-b", "2026-11-05T10:00:01.000Z")

    store = SqliteRoundJobStore(database)
    store.enqueue("round-b", "2026-11-05T10:00:01.000Z")
    store.enqueue("round-a", "2026-11-05T10:00:00.000Z")

    first = store.claim_next("worker-1", "2026-11-05T10:00:02.000Z")
    second = store.claim_next("worker-2", "2026-11-05T10:00:02.100Z")
    assert first == {"roundId": "round-a", "status": "claimed", "claimedBy": "worker-1"}
    assert second == {"roundId": "round-b", "status": "claimed", "claimedBy": "worker-2"}

    assert store.request_cancellation("round-a", "2026-11-05T10:00:03.000Z") is True
    assert _run(store.is_cancellation_requested("round-a")) is True
    assert _run(store.is_owned_by("round-a", "worker-1")) is True
    assert _run(store.complete("round-a", "worker-2")) is False
    assert _run(store.complete("round-a", "worker-1")) is True
    assert _run(store.is_cancellation_requested("round-a")) is False
    database.close()


def test_reclaims_expired_lease_and_keeps_cancel_requested_state(tmp_path: Path) -> None:
    database = open_sqlite_database(str(tmp_path / "harness.sqlite"))
    _setup_round(database, "round-lease", "2026-11-05T10:00:00.000Z")
    store = SqliteRoundJobStore(database, lease_ms=1_000)
    store.enqueue("round-lease", "2026-11-05T10:00:00.000Z")

    assert store.claim_next("worker-a", "2026-11-05T10:00:01.000Z") == {
        "roundId": "round-lease",
        "status": "claimed",
        "claimedBy": "worker-a",
    }
    assert store.request_cancellation("round-lease", "2026-11-05T10:00:01.500Z") is True
    assert store.claim_next("worker-b", "2026-11-05T10:00:03.000Z") == {
        "roundId": "round-lease",
        "status": "claimed",
        "claimedBy": "worker-b",
    }
    row = database.prepare(
        "SELECT status, claimed_by FROM round_jobs WHERE round_id = ?"
    ).get("round-lease")
    assert row[0] == "cancel_requested"
    assert row[1] == "worker-b"
    database.close()