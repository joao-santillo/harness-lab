from __future__ import annotations

import asyncio
from typing import Any

import pytest

from harness_lab.application.rounds.create_round_stages import (
    InMemoryRoundArtifactStore,
    create_round_stages,
    terminal_event_for_decision,
)
from harness_lab.domain import (
    AgentCapabilities,
    ExecutionMetrics,
    ExecutionResult,
    HarnessSnapshot,
    Round,
)


def _run[T](coroutine: Any) -> T:
    return asyncio.run(coroutine)


ROUND = Round(
    id="round-1",
    agent_id="agent-1",
    domain_id="domain-1",
    state="setup",
    objective="Improve",
    created_at="2026-10-31T10:00:00.000Z",
    updated_at="2026-10-31T10:00:00.000Z",
)


def _baseline() -> HarnessSnapshot:
    return HarnessSnapshot(
        id="baseline-1",
        agent_id=ROUND.agent_id,
        domain_id=ROUND.domain_id,
        version="7",
        components={"parameters": "strict=false"},
        immutable_constraints=("Never disclose secrets",),
        created_at=ROUND.created_at,
    )


def _cases() -> tuple[dict[str, str], ...]:
    return (
        {"id": "case-1", "sessionId": "s1", "similarityGroup": "g1", "content": "question one"},
        {"id": "case-2", "sessionId": "s2", "similarityGroup": "g2", "content": "question two"},
        {"id": "case-3", "sessionId": "s3", "similarityGroup": "g3", "content": "question three"},
        {"id": "case-4", "sessionId": "s4", "similarityGroup": "g4", "content": "question four"},
    )


def _execution(request: dict[str, object]) -> ExecutionResult:
    kind = str(request["kind"])
    case_id = str(request["case_id"])
    return ExecutionResult(
        id=f"{kind}-{case_id}",
        round_id=str(request["round_id"]),
        case_id=case_id,
        harness_snapshot_id=str(request["harness_version_id"]),
        status="succeeded",
        correlation_id=str(request["idempotency_key"]),
        trace_id=f"trace-{case_id}",
        output="supported answer" if kind == "candidate" else "unsupported answer",
        metrics=ExecutionMetrics(input_tokens=5, output_tokens=5, cost=0.01, latency_ms=10),
        limitations=(),
    )


def test_terminal_event_mapping() -> None:
    assert terminal_event_for_decision("recommended") == "recommendation_completed"
    assert terminal_event_for_decision("rejected") == "rejection_completed"
    assert terminal_event_for_decision("inconclusive") == "evaluation_inconclusive"
    assert terminal_event_for_decision("pending_validation") == "validation_pending"
    assert terminal_event_for_decision("validation_insufficient") == "validation_insufficient"
    assert terminal_event_for_decision("stopped_by_limit") == "limit_reached"
    assert terminal_event_for_decision("cancelled") == "cancel_requested"
    assert terminal_event_for_decision("integration_failed") == "integration_failed"


def test_create_round_stages_runs_complete_lifecycle_and_evaluates_reserved_only() -> None:
    artifacts = InMemoryRoundArtifactStore()
    calls: list[dict[str, object]] = []
    exported: list[dict[str, object]] = []
    reserved_case_ids_seen: list[tuple[str, ...]] = []

    async def execute(request: dict[str, object]) -> ExecutionResult:
        calls.append(request)
        return _execution(request)

    async def export_round(round_obj: Round, session: dict[str, object]) -> None:
        del round_obj
        exported.append(session)

    async def refine(request: Any) -> tuple[dict[str, object], ...]:
        del request
        return (
            {
                "id": "candidate-1",
                "roundId": ROUND.id,
                "baselineId": "baseline-1",
                "snapshot": {
                    "id": "candidate-snapshot-1",
                    "agentId": ROUND.agent_id,
                    "domainId": ROUND.domain_id,
                    "version": "8",
                    "components": {"parameters": "strict=true"},
                    "immutableConstraints": ["Never disclose secrets"],
                    "createdAt": ROUND.updated_at,
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

    stages = create_round_stages(
        {
            "artifacts": artifacts,
            "cases": {"collect": lambda round_obj: _cases()},
            "traces": {
                "collect": lambda _round, diagnosis_cases: tuple(
                    {"id": item["id"], "output": "unsupported answer", "unsupportedAnswer": True}
                    for item in diagnosis_cases
                )
            },
            "harnesses": {
                "get_capabilities": lambda _agent_id: AgentCapabilities(
                    editable_components=("parameters",),
                    supports_seed=True,
                    supports_tool_replay=False,
                ),
                "fetch_snapshot": lambda _agent_id, _domain_id: _baseline(),
            },
            "refinement_engine": {"refine": refine},
            "executor": {"execute": execute},
            "evaluator": {
                "id": "deterministic-v1",
                "version": "1",
                "minimumSampleSize": 1,
                "recommendationThreshold": 0.5,
                "maximumRegressionRate": 0,
            },
            "export_round": export_round,
            "on_evaluate_input": lambda payload: reserved_case_ids_seen.append(
                tuple(payload["reserved_case_ids"])
            ),
            "options": {
                "partition_seed": "seed-1",
                "minimum_reserved": 1,
                "reserved_ratio": 0.25,
            },
        }
    )

    _run(stages["collect"].run(ROUND))
    _run(stages["diagnose"].run(ROUND.model_copy(update={"state": "collecting"})))
    _run(stages["refine"].run(ROUND.model_copy(update={"state": "diagnosing"})))
    _run(stages["execute"].run(ROUND.model_copy(update={"state": "refining"})))
    _run(stages["evaluate"].run(ROUND.model_copy(update={"state": "executing"})))
    terminal_event = _run(stages["export"].run(ROUND.model_copy(update={"state": "evaluating"})))

    session = _run(artifacts.get(ROUND.id))
    assert session is not None
    reserved = set(session["partition"]["reservedIds"])
    diagnosis = set(session["partition"]["diagnosisIds"])

    assert diagnosis.isdisjoint(reserved)
    assert all(item["caseId"] in diagnosis for item in session["diagnosis"]["evidence"])
    assert all(request["case_id"] in reserved for request in calls[-(2 * len(reserved)):])
    assert terminal_event == "recommendation_completed"
    assert exported
    assert reserved_case_ids_seen == [tuple(session["partition"]["reservedIds"])]


def test_export_stage_recovery_fails_closed_when_decision_missing() -> None:
    artifacts = InMemoryRoundArtifactStore()
    _run(
        artifacts.save(
            ROUND.id,
            {
                "cases": list(_cases()),
                "partition": {
                    "version": 1,
                    "seed": "seed",
                    "diagnosisIds": ["case-1", "case-2", "case-3"],
                    "reservedIds": ["case-4"],
                    "createdAt": ROUND.created_at,
                },
                "baseline": _baseline().model_dump(by_alias=True),
                "capabilities": {
                    "editableComponents": ["parameters"],
                    "supportsSeed": True,
                    "supportsToolReplay": False,
                },
                "diagnosis": {"evidence": [], "findings": [], "hypotheses": [], "actionability": []},
                "refinement": {
                    "candidates": [],
                    "composed": None,
                    "rejected": [],
                    "lessons": [],
                    "stopReason": "completed",
                },
                "reservedExecutions": [],
                "evaluation": None,
            },
        )
    )

    stages = create_round_stages(
        {
            "artifacts": artifacts,
            "cases": {"collect": lambda _round: _cases()},
            "traces": {"collect": lambda _round, _cases: ()},
            "harnesses": {
                "get_capabilities": lambda _agent_id: AgentCapabilities(
                    editable_components=("parameters",),
                    supports_seed=True,
                    supports_tool_replay=False,
                ),
                "fetch_snapshot": lambda _agent_id, _domain_id: _baseline(),
            },
            "refinement_engine": {"refine": lambda _request: ()},
            "executor": {"execute": lambda _request: pytest.fail("not used")},
            "evaluator": {
                "id": "deterministic-v1",
                "version": "1",
                "minimumSampleSize": 1,
                "recommendationThreshold": 0.5,
                "maximumRegressionRate": 0,
            },
            "export_round": lambda _round, _session: None,
            "options": {
                "partition_seed": "seed-1",
                "minimum_reserved": 1,
                "reserved_ratio": 0.25,
            },
        }
    )

    with pytest.raises(RuntimeError, match="ROUND_EVALUATION_MISSING"):
        _run(stages["export"].get_completion_event(ROUND))
