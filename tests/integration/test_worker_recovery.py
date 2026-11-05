from __future__ import annotations

import asyncio

from harness_lab.application.rounds.process_round import ProcessRound
from harness_lab.domain import Round


def _run[T](coroutine: object) -> T:
    return asyncio.run(coroutine)


def test_process_round_recovers_exporting_terminal_decision_from_persisted_artifact() -> None:
    round_obj = Round(
        id="round-recovery",
        agent_id="agent-1",
        domain_id="domain-1",
        state="exporting",
        objective="Improve",
        created_at="2026-11-05T13:00:00.000Z",
        updated_at="2026-11-05T13:00:00.000Z",
    )
    events: list[dict[str, object]] = []

    class _Repository:
        async def get_round(self, round_id: str) -> Round | None:
            del round_id
            return round_obj

        async def list_events(self, round_id: str, after_sequence: int) -> tuple[dict[str, object], ...]:
            del round_id, after_sequence
            return tuple(events)

        async def commit_progress(self, *, round_obj: Round, checkpoint: object, event: object) -> None:
            del checkpoint
            events.append(event.model_dump(by_alias=True))

    class _Jobs:
        async def is_owned_by(self, round_id: str, worker_id: str) -> bool:
            del round_id, worker_id
            return True

        async def is_cancellation_requested(self, round_id: str) -> bool:
            del round_id
            return False

        async def complete(self, round_id: str, worker_id: str) -> bool:
            del round_id, worker_id
            return True

    async def no_op(_round: Round) -> None:
        return None

    stages = {
        "collect": {"run": no_op},
        "diagnose": {"run": no_op},
        "refine": {"run": no_op},
        "execute": {"run": no_op},
        "evaluate": {"run": no_op},
        "export": {
            "run": no_op,
            "get_completion_event": lambda _round: "rejection_completed",
        },
    }

    result = _run(
        ProcessRound(
            repository=_Repository(),
            jobs=_Jobs(),
            stages=stages,
            now=lambda: "2026-11-05T13:00:01.000Z",
            create_id=lambda: "id",
        ).execute(round_obj.id, "worker-a")
    )

    assert result.state == "rejected"
    assert events[-1]["event"] == "rejection_completed"
