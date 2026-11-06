from __future__ import annotations

from collections.abc import Callable
from typing import Any, Protocol


class _JobClaimer(Protocol):
    def claim_next(self, worker_id: str, now: str) -> dict[str, str] | None: ...


class _RoundProcessor(Protocol):
    async def execute(self, round_id: str, worker_id: str) -> Any: ...


class DurableRoundWorker:
    def __init__(
        self,
        *,
        jobs: _JobClaimer,
        processor: _RoundProcessor,
        worker_id: str,
        now: Callable[[], str],
    ) -> None:
        self._jobs = jobs
        self._processor = processor
        self._worker_id = worker_id
        self._now = now

    async def tick(self) -> bool:
        job = self._jobs.claim_next(self._worker_id, self._now())
        if job is None:
            return False
        await self._processor.execute(job["roundId"], self._worker_id)
        return True
