from __future__ import annotations

import asyncio
from uuid import uuid4

from harness_lab.adapters.sqlite import (
    SqliteRoundArtifactStore,
    SqliteRunRepository,
    open_sqlite_database,
)
from harness_lab.domain import Round
from harness_lab.worker.runtime import create_round_worker_runtime


def _run[T](coroutine: object) -> T:
    return asyncio.run(coroutine)


def test_runtime_processes_round_and_persists_terminal_artifacts() -> None:
    database = open_sqlite_database(":memory:")
    now = "2026-11-03T10:00:00.000Z"
    round_obj = Round(
        id="round-runtime",
        agent_id="agent-runtime",
        domain_id="domain-runtime",
        state="setup",
        objective="Reduce unsupported answers",
        created_at=now,
        updated_at=now,
    )
    repository = SqliteRunRepository(database)
    _run(repository.save_agent({"id": round_obj.agent_id, "domainId": round_obj.domain_id, "name": "Agent", "createdAt": now}))
    _run(repository.save_round(round_obj))

    exported: list[dict[str, object]] = []

    async def refine(_request: object) -> tuple[dict[str, object], ...]:
        return (
            {
                "id": "candidate-runtime",
                "roundId": round_obj.id,
                "baselineId": "snapshot-runtime",
                "snapshot": {
                    "id": "candidate-runtime-snapshot",
                    "agentId": round_obj.agent_id,
                    "domainId": round_obj.domain_id,
                    "version": "2",
                    "components": {"parameters": "strict=true"},
                    "immutableConstraints": [],
                    "createdAt": now,
                },
                "changes": (
                    {
                        "component": "parameters",
                        "before": "strict=false",
                        "after": "strict=true",
                        "rollback": "strict=false",
                        "expectedEffect": "Reduce unsupported answers",
                    },
                ),
                "hypothesisIds": ("hypothesis-unsupported_answer",),
                "evidenceIds": ("unsupported_answer-1",),
            },
        )

    async def execute(request: dict[str, object]) -> dict[str, object]:
        return {
            "id": str(uuid4()),
            "roundId": request["round_id"],
            "caseId": request["case_id"],
            "harnessSnapshotId": request["harness_version_id"],
            "status": "succeeded",
            "correlationId": request["idempotency_key"],
            "traceId": f"trace-{request['case_id']}",
            "output": "supported",
            "metrics": {"inputTokens": 2, "outputTokens": 2, "cost": 0.01, "latencyMs": 10},
            "limitations": [],
        }

    runtime = create_round_worker_runtime(
        {
            "database": database,
            "worker_id": "worker-runtime",
            "now": lambda: now,
            "create_id": lambda: str(uuid4()),
            "stage_dependencies": {
                "cases": {"collect": lambda _round: (
                    {"id": "case-1", "sessionId": "s1", "similarityGroup": "g1", "content": "q1"},
                    {"id": "case-2", "sessionId": "s2", "similarityGroup": "g2", "content": "q2"},
                    {"id": "case-3", "sessionId": "s3", "similarityGroup": "g3", "content": "q3"},
                    {"id": "case-4", "sessionId": "s4", "similarityGroup": "g4", "content": "q4"},
                )},
                "traces": {"collect": lambda _round, diagnosis_cases: tuple({"id": item["id"], "output": "unsupported", "unsupportedAnswer": True} for item in diagnosis_cases)},
                "harnesses": {
                    "get_capabilities": lambda _agent_id: {
                        "editableComponents": ["parameters"],
                        "supportsSeed": False,
                        "supportsToolReplay": False,
                    },
                    "fetch_snapshot": lambda _agent_id, _domain_id: {
                        "id": "snapshot-runtime",
                        "agentId": round_obj.agent_id,
                        "domainId": round_obj.domain_id,
                        "version": "1",
                        "components": {"parameters": "strict=false"},
                        "immutableConstraints": [],
                        "createdAt": now,
                    },
                },
                "refinement_engine": {"refine": refine},
                "executor": {"execute": execute},
                "evaluator": {
                    "id": "evaluator",
                    "version": "1",
                    "minimumSampleSize": 1,
                    "recommendationThreshold": 0.1,
                    "maximumRegressionRate": 0,
                },
                "export_round": lambda _round, session: exported.append(session),
            },
            "stage_options": {
                "partition_seed": "seed",
                "minimum_reserved": 1,
                "reserved_ratio": 0.25,
            },
        }
    )

    runtime.jobs.enqueue(round_obj.id, now)
    assert _run(runtime.worker.tick()) is True
    assert _run(repository.get_round(round_obj.id)).state == "recommended"
    assert _run(SqliteRoundArtifactStore(database).get(round_obj.id))["evaluation"]["decision"] == "recommended"
    assert exported
    database.close()
