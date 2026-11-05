from __future__ import annotations

import inspect
from collections.abc import Awaitable, Callable, Mapping

from harness_lab.domain import (
    Round,
    RoundCheckpoint,
    RoundProgressCommit,
    RoundProgressEvent,
    apply_round_event,
)


def _get_stage_callable(stage: object, method: str) -> Callable[[Round], Awaitable[object]] | None:
    if isinstance(stage, Mapping):
        value = stage.get(method)
        if callable(value):
            return value
        return None
    value = getattr(stage, method, None)
    if callable(value):
        return value
    return None


class ProcessRound:
    def __init__(
        self,
        *,
        repository: object,
        jobs: object,
        stages: Mapping[str, object],
        now: Callable[[], str],
        create_id: Callable[[], str],
    ) -> None:
        self._repository = repository
        self._jobs = jobs
        self._stages = stages
        self._now = now
        self._create_id = create_id

    async def execute(self, round_id: str, worker_id: str) -> Round:
        round_obj = await self._repository.get_round(round_id)
        if round_obj is None:
            raise RuntimeError("ROUND_NOT_FOUND")

        recovering_export = round_obj.state == "exporting"
        events = await self._repository.list_events(round_id, -1)
        sequence = max((-1, *(self._event_sequence(item) for item in events)))
        terminal_event = "recommendation_completed"

        transitions: dict[str, tuple[str, str]] = {
            "setup": ("collection_started", "collect"),
            "collecting": ("diagnosis_started", "diagnose"),
            "diagnosing": ("refinement_started", "refine"),
            "refining": ("execution_started", "execute"),
            "executing": ("evaluation_started", "evaluate"),
            "evaluating": ("export_started", "export"),
        }

        while round_obj.state in transitions:
            await self._ensure_owned(round_obj.id, worker_id)
            if await self._jobs.is_cancellation_requested(round_obj.id):
                round_obj = await self._commit(round_obj, "cancel_requested", sequence + 1)
                await self._jobs.complete(round_obj.id, worker_id)
                return round_obj

            event_name, stage_name = transitions[round_obj.state]
            stage = self._stages[stage_name]
            run = _get_stage_callable(stage, "run")
            if run is None:
                raise RuntimeError(f"ROUND_STAGE_INVALID:{stage_name}")

            try:
                stage_result = await self._await_maybe(run(round_obj))
                if stage_name == "export" and stage_result is not None:
                    terminal_event = str(stage_result)
            except Exception:
                await self._ensure_owned(round_obj.id, worker_id)
                round_obj = await self._commit(round_obj, "integration_failed", sequence + 1)
                await self._jobs.complete(round_obj.id, worker_id)
                return round_obj

            await self._ensure_owned(round_obj.id, worker_id)
            sequence += 1
            round_obj = await self._commit(round_obj, event_name, sequence)

            if await self._jobs.is_cancellation_requested(round_obj.id):
                sequence += 1
                round_obj = await self._commit(round_obj, "cancel_requested", sequence)
                await self._jobs.complete(round_obj.id, worker_id)
                return round_obj

        if round_obj.state == "exporting":
            await self._ensure_owned(round_obj.id, worker_id)
            if await self._jobs.is_cancellation_requested(round_obj.id):
                sequence += 1
                round_obj = await self._commit(round_obj, "cancel_requested", sequence)
                await self._jobs.complete(round_obj.id, worker_id)
                return round_obj

            if recovering_export:
                try:
                    get_completion_event = _get_stage_callable(self._stages["export"], "get_completion_event")
                    if get_completion_event is None:
                        raise RuntimeError("ROUND_TERMINAL_DECISION_UNAVAILABLE")
                    terminal_event = str(await self._await_maybe(get_completion_event(round_obj)))
                except Exception:
                    await self._ensure_owned(round_obj.id, worker_id)
                    sequence += 1
                    round_obj = await self._commit(round_obj, "integration_failed", sequence)
                    await self._jobs.complete(round_obj.id, worker_id)
                    return round_obj

            await self._ensure_owned(round_obj.id, worker_id)
            if await self._jobs.is_cancellation_requested(round_obj.id):
                sequence += 1
                round_obj = await self._commit(round_obj, "cancel_requested", sequence)
                await self._jobs.complete(round_obj.id, worker_id)
                return round_obj

            sequence += 1
            round_obj = await self._commit(round_obj, terminal_event, sequence)

        await self._jobs.complete(round_obj.id, worker_id)
        return round_obj

    async def _ensure_owned(self, round_id: str, worker_id: str) -> None:
        if not await self._jobs.is_owned_by(round_id, worker_id):
            raise RuntimeError("ROUND_CLAIM_LOST")

    async def _commit(self, round_obj: Round, event_name: str, sequence: int) -> Round:
        occurred_at = self._now()
        updated = apply_round_event(round_obj, event_name, occurred_at)
        checkpoint = RoundCheckpoint(
            id=self._create_id(),
            round_id=round_obj.id,
            state=updated.state,
            sequence=sequence,
            created_at=occurred_at,
        )
        event = RoundProgressEvent(
            id=self._create_id(),
            round_id=round_obj.id,
            sequence=sequence,
            event=event_name,
            state=updated.state,
            occurred_at=occurred_at,
            message_code=f"ROUND_{event_name.upper()}",
        )
        commit = RoundProgressCommit(round=updated, checkpoint=checkpoint, event=event)
        try:
            await self._repository.commit_progress(
                round_obj=commit.round,
                checkpoint=commit.checkpoint,
                event=commit.event,
            )
        except TypeError:
            await self._repository.commit_progress(commit)
        return updated

    def _event_sequence(self, event: object) -> int:
        if isinstance(event, Mapping):
            return int(event["sequence"])
        return int(getattr(event, "sequence"))

    async def _await_maybe(self, value: object) -> object:
        if inspect.isawaitable(value):
            return await value
        return value
