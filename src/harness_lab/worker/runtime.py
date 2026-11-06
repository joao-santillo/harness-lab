from __future__ import annotations

from dataclasses import dataclass
from typing import Any, cast

from harness_lab.adapters.sqlite import (
    SqliteCaseRepository,
    SqliteRoundArtifactStore,
    SqliteRoundJobStore,
    SqliteRunRepository,
)
from harness_lab.application.rounds import ProcessRound, create_round_stages
from harness_lab.application.rounds.create_round_stages import CreateRoundStagesInput
from harness_lab.domain import Round

from .worker import DurableRoundWorker


@dataclass(frozen=True)
class RoundWorkerRuntime:
    worker: DurableRoundWorker
    repository: SqliteRunRepository
    jobs: SqliteRoundJobStore
    artifacts: SqliteRoundArtifactStore
    cases: SqliteCaseRepository

    async def tick(self) -> bool:
        return await self.worker.tick()


def create_round_worker_runtime(options: dict[str, Any]) -> RoundWorkerRuntime:
    database = options["database"]
    repository = SqliteRunRepository(database)
    jobs = SqliteRoundJobStore(database)
    artifacts = SqliteRoundArtifactStore(database)
    cases = SqliteCaseRepository(database)

    stage_dependencies: dict[str, Any] = dict(options["stage_dependencies"])
    if "cases" not in stage_dependencies:
        async def _collect_cases(round_obj: Round) -> tuple[dict[str, object], ...]:
            records = await cases.list_by_scope(round_obj.agent_id, round_obj.domain_id)
            return tuple(record.model_dump(by_alias=True) for record in records)

        stage_dependencies["cases"] = {
            "collect": _collect_cases
        }

    stage_input: CreateRoundStagesInput = cast(
        CreateRoundStagesInput,
        {
            **stage_dependencies,
            "artifacts": artifacts,
            "options": options["stage_options"],
        },
    )
    stages = create_round_stages(stage_input)
    processor = ProcessRound(
        repository=repository,
        jobs=jobs,
        stages=stages,
        now=options["now"],
        create_id=options["create_id"],
    )
    worker = DurableRoundWorker(
        jobs=jobs,
        processor=processor,
        worker_id=options["worker_id"],
        now=options["now"],
    )
    return RoundWorkerRuntime(
        worker=worker,
        repository=repository,
        jobs=jobs,
        artifacts=artifacts,
        cases=cases,
    )
