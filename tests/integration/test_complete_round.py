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


def test_complete_round_uses_reserved_cases_for_evaluation_and_persists_decision() -> None:
    database = open_sqlite_database(":memory:")
    now = "2026-11-05T12:00:00.000Z"
    round_obj = Round(
        id="round-integration",
        agent_id="agent-1",
        domain_id="domain-1",
        state="setup",
        objective="Improve",
        created_at=now,
        updated_at=now,
    )
    repository = SqliteRunRepository(database)
    _run(repository.save_agent({"id": round_obj.agent_id, "domainId": round_obj.domain_id, "name": "Agent", "createdAt": now}))
    _run(repository.save_round(round_obj))

    evaluation_reserved_ids: list[tuple[str, ...]] = []

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
            "metrics": {"inputTokens": 1, "outputTokens": 1, "cost": 0.0, "latencyMs": 1},
            "limitations": [],
        }

    runtime = create_round_worker_runtime(
        {
            "database": database,
            "worker_id": "worker-a",
            "now": lambda: now,
            "create_id": lambda: str(uuid4()),
            "stage_dependencies": {
                "cases": {"collect": lambda _round: (
                    {"id": "case-1", "sessionId": "s1", "similarityGroup": "g1", "content": "question 1"},
                    {"id": "case-2", "sessionId": "s2", "similarityGroup": "g2", "content": "question 2"},
                    {"id": "case-3", "sessionId": "s3", "similarityGroup": "g3", "content": "question 3"},
                    {"id": "case-4", "sessionId": "s4", "similarityGroup": "g4", "content": "question 4"},
                )},
                "traces": {"collect": lambda _round, diagnosis_cases: tuple({"id": item["id"], "output": "unsupported", "unsupportedAnswer": True} for item in diagnosis_cases)},
                "harnesses": {
                    "get_capabilities": lambda _agent_id: {"editableComponents": ["parameters"], "supportsSeed": False, "supportsToolReplay": False},
                    "fetch_snapshot": lambda _agent_id, _domain_id: {
                        "id": "baseline-1",
                        "agentId": round_obj.agent_id,
                        "domainId": round_obj.domain_id,
                        "version": "1",
                        "components": {"parameters": "strict=false"},
                        "immutableConstraints": [],
                        "createdAt": now,
                    },
                },
                "refinement_engine": {
                    "refine": lambda _request: (
                        {
                            "id": "candidate-1",
                            "roundId": round_obj.id,
                            "baselineId": "baseline-1",
                            "snapshot": {
                                "id": "candidate-1-snapshot",
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
                },
                "executor": {"execute": execute},
                "evaluator": {
                    "id": "deterministic",
                    "version": "1",
                    "minimumSampleSize": 1,
                    "recommendationThreshold": 0.1,
                    "maximumRegressionRate": 0,
                },
                "on_evaluate_input": lambda payload: evaluation_reserved_ids.append(tuple(payload["reserved_case_ids"])),
                "export_round": lambda _round, _session: None,
            },
            "stage_options": {
                "partition_seed": "seed",
                "minimum_reserved": 1,
                "reserved_ratio": 0.25,
                "max_proposals": 3,
            },
        }
    )

    runtime.jobs.enqueue(round_obj.id, now)
    assert _run(runtime.tick()) is True
    final_round = _run(repository.get_round(round_obj.id))
    assert final_round is not None and final_round.state == "recommended"

    artifacts = _run(SqliteRoundArtifactStore(database).get(round_obj.id))
    assert artifacts is not None
    assert artifacts["evaluation"]["decision"] == "recommended"
    assert evaluation_reserved_ids == [tuple(artifacts["partition"]["reservedIds"])]
    database.close()
