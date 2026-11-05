from __future__ import annotations

from collections.abc import Callable


class DurableRoundWorker:
    def __init__(
        self,
        *,
        jobs: object,
        processor: object,
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
