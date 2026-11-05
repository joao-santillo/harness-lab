from __future__ import annotations

import asyncio
from collections import deque

from harness_lab.worker.worker import DurableRoundWorker


def _run[T](coroutine: object) -> T:
    return asyncio.run(coroutine)


def test_worker_processes_exactly_one_claim_per_tick() -> None:
    calls: list[tuple[str, str]] = []

    class _Jobs:
        def __init__(self) -> None:
            self.items = deque(({"roundId": "round-1"},))

        def claim_next(self, worker_id: str, now: str) -> dict[str, str] | None:
            del worker_id, now
            if not self.items:
                return None
            return self.items.popleft()

    class _Processor:
        async def execute(self, round_id: str, worker_id: str) -> object:
            calls.append((round_id, worker_id))
            return object()

    worker = DurableRoundWorker(
        jobs=_Jobs(),
        processor=_Processor(),
        worker_id="worker-a",
        now=lambda: "2026-11-01T10:00:00.000Z",
    )

    assert _run(worker.tick()) is True
    assert calls == [("round-1", "worker-a")]


def test_worker_does_not_process_when_queue_empty() -> None:
    class _Jobs:
        def claim_next(self, worker_id: str, now: str) -> None:
            del worker_id, now
            return None

    class _Processor:
        async def execute(self, round_id: str, worker_id: str) -> object:
            raise AssertionError(f"unexpected execution {round_id=} {worker_id=}")

    worker = DurableRoundWorker(
        jobs=_Jobs(),
        processor=_Processor(),
        worker_id="worker-a",
        now=lambda: "2026-11-01T10:00:00.000Z",
    )

    assert _run(worker.tick()) is False
