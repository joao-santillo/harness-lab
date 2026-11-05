from __future__ import annotations

import asyncio
from collections.abc import Awaitable, Callable

import pytest

from harness_lab.application.rounds.process_round import ProcessRound
from harness_lab.domain.models.round import Round


def _run[T](coroutine: Awaitable[T]) -> T:
    return asyncio.run(coroutine)


class _Repository:
    def __init__(self) -> None:
        self.round_obj = Round(
            id="round-1",
            agent_id="agent-1",
            domain_id="domain-1",
            state="setup",
            objective="Improve",
            created_at="2026-10-30T12:00:00.000Z",
            updated_at="2026-10-30T12:00:00.000Z",
        )
        self.events: list[dict[str, object]] = []

    async def get_round(self, round_id: str) -> Round | None:
        del round_id
        return self.round_obj

    async def save_round(self, round_obj: Round) -> None:
        self.round_obj = round_obj

    async def list_events(self, round_id: str, after_sequence: int) -> tuple[dict[str, object], ...]:
        del round_id, after_sequence
        return tuple(self.events)

    async def commit_progress(self, *, round_obj: Round, checkpoint: object, event: object) -> None:
        del checkpoint
        self.round_obj = round_obj
        self.events.append(event.model_dump(by_alias=True))


class _Jobs:
    def __init__(self, *, owned: Callable[[], bool], cancelled: Callable[[], bool]) -> None:
        self._owned = owned
        self._cancelled = cancelled
        self.completed: list[tuple[str, str]] = []

    async def is_owned_by(self, round_id: str, worker_id: str) -> bool:
        del round_id, worker_id
        return self._owned()

    async def is_cancellation_requested(self, round_id: str) -> bool:
        del round_id
        return self._cancelled()

    async def complete(self, round_id: str, worker_id: str) -> bool:
        self.completed.append((round_id, worker_id))
        return True


def _stages() -> dict[str, object]:
    async def no_op(round_obj: Round) -> None:
        del round_obj

    return {
        "collect": {"run": no_op},
        "diagnose": {"run": no_op},
        "refine": {"run": no_op},
        "execute": {"run": no_op},
        "evaluate": {"run": no_op},
        "export": {"run": no_op},
    }


def test_process_round_persists_all_stage_transitions_in_sequence() -> None:
    repository = _Repository()
    jobs = _Jobs(owned=lambda: True, cancelled=lambda: False)
    sequence_id = 0

    def create_id() -> str:
        nonlocal sequence_id
        sequence_id += 1
        return f"id-{sequence_id}"

    result = _run(
        ProcessRound(
            repository=repository,
            jobs=jobs,
            stages=_stages(),
            now=lambda: "2026-10-30T12:00:01.000Z",
            create_id=create_id,
        ).execute("round-1", "worker-a")
    )

    assert result.state == "recommended"
    assert [event["sequence"] for event in repository.events] == [0, 1, 2, 3, 4, 5, 6]
    assert jobs.completed == [("round-1", "worker-a")]


def test_process_round_fails_closed_on_export_recovery_without_decision() -> None:
    repository = _Repository()
    repository.round_obj = repository.round_obj.model_copy(update={"state": "exporting"})
    jobs = _Jobs(owned=lambda: True, cancelled=lambda: False)

    result = _run(
        ProcessRound(
            repository=repository,
            jobs=jobs,
            stages=_stages(),
            now=lambda: "2026-10-30T12:00:01.000Z",
            create_id=lambda: "id",
        ).execute("round-1", "worker-a")
    )

    assert result.state == "integration_failed"
    assert repository.events[-1]["event"] == "integration_failed"


def test_process_round_cancel_requested_before_stage() -> None:
    repository = _Repository()
    jobs = _Jobs(owned=lambda: True, cancelled=lambda: True)

    result = _run(
        ProcessRound(
            repository=repository,
            jobs=jobs,
            stages=_stages(),
            now=lambda: "2026-10-30T12:00:01.000Z",
            create_id=lambda: "id",
        ).execute("round-1", "worker-a")
    )

    assert result.state == "cancelled"
    assert repository.events == [
        {
            "id": "id",
            "roundId": "round-1",
            "sequence": 0,
            "event": "cancel_requested",
            "state": "cancelled",
            "occurredAt": "2026-10-30T12:00:01.000Z",
            "messageCode": "ROUND_CANCEL_REQUESTED",
        }
    ]


def test_process_round_raises_when_round_claim_is_lost() -> None:
    repository = _Repository()
    jobs = _Jobs(owned=lambda: False, cancelled=lambda: False)

    with pytest.raises(RuntimeError, match="ROUND_CLAIM_LOST"):
        _run(
            ProcessRound(
                repository=repository,
                jobs=jobs,
                stages=_stages(),
                now=lambda: "2026-10-30T12:00:01.000Z",
                create_id=lambda: "id",
            ).execute("round-1", "worker-a")
        )


def test_process_round_fails_closed_when_stage_runner_is_missing() -> None:
    repository = _Repository()
    jobs = _Jobs(owned=lambda: True, cancelled=lambda: False)
    stages = _stages()
    stages["collect"] = {}

    result = _run(
        ProcessRound(
            repository=repository,
            jobs=jobs,
            stages=stages,
            now=lambda: "2026-10-30T12:00:01.000Z",
            create_id=lambda: "id",
        ).execute("round-1", "worker-a")
    )

    assert result.state == "integration_failed"
    assert repository.events[-1]["event"] == "integration_failed"
    assert jobs.completed == [("round-1", "worker-a")]


def test_process_round_ownership_loss_after_stage_is_not_mapped_to_integration_failed() -> None:
    repository = _Repository()
    ownership_checks = iter((True, False))
    jobs = _Jobs(owned=lambda: next(ownership_checks), cancelled=lambda: False)

    with pytest.raises(RuntimeError, match="ROUND_CLAIM_LOST"):
        _run(
            ProcessRound(
                repository=repository,
                jobs=jobs,
                stages=_stages(),
                now=lambda: "2026-10-30T12:00:01.000Z",
                create_id=lambda: "id",
            ).execute("round-1", "worker-a")
        )

    assert repository.events == []
    assert jobs.completed == []


def test_process_round_cancel_requested_after_stage_commit() -> None:
    repository = _Repository()
    cancellation_checks = iter((False, True))
    jobs = _Jobs(owned=lambda: True, cancelled=lambda: next(cancellation_checks))

    result = _run(
        ProcessRound(
            repository=repository,
            jobs=jobs,
            stages=_stages(),
            now=lambda: "2026-10-30T12:00:01.000Z",
            create_id=lambda: "id",
        ).execute("round-1", "worker-a")
    )

    assert result.state == "cancelled"
    assert [event["event"] for event in repository.events] == [
        "collection_started",
        "cancel_requested",
    ]
    assert jobs.completed == [("round-1", "worker-a")]
