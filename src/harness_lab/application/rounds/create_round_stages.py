from __future__ import annotations

import copy
import inspect
from collections.abc import Mapping

from harness_lab.application import (
    assert_learning_sources,
    diagnose_executions,
    evaluate_candidate,
    partition_cases,
    run_refinement_with_diagnosis_cases,
    seal_partition_manifest,
)
from harness_lab.domain import (
    AgentCapabilities,
    Candidate,
    ExecutionResult,
    HarnessSnapshot,
    PartitionCase,
    PartitionManifest,
    PartitionOptions,
    RefinementRequest,
    Round,
    RoundEvent,
    TerminalDecision,
)
from harness_lab.domain.models.evaluation import VersionedEvaluationResult


async def _await_maybe(value: object) -> object:
    if inspect.isawaitable(value):
        return await value
    return value


class InMemoryRoundArtifactStore:
    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, object]] = {}

    async def get(self, round_id: str) -> dict[str, object] | None:
        session = self._sessions.get(round_id)
        return None if session is None else copy.deepcopy(session)

    async def save(self, round_id: str, session: dict[str, object]) -> None:
        self._sessions[round_id] = copy.deepcopy(session)


_TERMINAL_EVENTS: dict[TerminalDecision, RoundEvent] = {
    "recommended": "recommendation_completed",
    "rejected": "rejection_completed",
    "inconclusive": "evaluation_inconclusive",
    "pending_validation": "validation_pending",
    "validation_insufficient": "validation_insufficient",
    "stopped_by_limit": "limit_reached",
    "cancelled": "cancel_requested",
    "integration_failed": "integration_failed",
}


def terminal_event_for_decision(decision: TerminalDecision) -> RoundEvent:
    return _TERMINAL_EVENTS[decision]


def _require_session(session: dict[str, object] | None, stage: str) -> dict[str, object]:
    if session is None:
        raise RuntimeError(f"ROUND_ARTIFACTS_MISSING:{stage}")
    return session


def _empty_session(
    *,
    cases: tuple[PartitionCase, ...],
    partition: PartitionManifest,
    baseline: HarnessSnapshot,
    capabilities: AgentCapabilities,
) -> dict[str, object]:
    return {
        "cases": [item.model_dump(by_alias=True) for item in cases],
        "partition": partition.model_dump(by_alias=True),
        "baseline": baseline.model_dump(by_alias=True),
        "capabilities": capabilities.model_dump(by_alias=True),
        "diagnosis": {
            "evidence": [],
            "findings": [],
            "hypotheses": [],
            "actionability": [],
        },
        "refinement": {
            "candidates": [],
            "composed": None,
            "rejected": [],
            "lessons": [],
            "stopReason": "completed",
        },
        "reservedExecutions": [],
        "evaluation": None,
    }


def _session_cases(session: Mapping[str, object]) -> tuple[PartitionCase, ...]:
    return tuple(PartitionCase.model_validate(item) for item in session["cases"])


def _session_partition(session: Mapping[str, object]) -> PartitionManifest:
    return PartitionManifest.model_validate(session["partition"])


def _session_baseline(session: Mapping[str, object]) -> HarnessSnapshot:
    return HarnessSnapshot.model_validate(session["baseline"])


def _candidate_from_session(session: Mapping[str, object]) -> Candidate:
    refinement = session["refinement"]
    if not isinstance(refinement, Mapping):
        raise RuntimeError("ROUND_CANDIDATE_MISSING")
    composed = refinement.get("composed")
    candidates = refinement.get("candidates")
    candidate_payload = composed
    if candidate_payload is None and isinstance(candidates, list) and candidates:
        candidate_payload = candidates[0]
    if candidate_payload is None:
        raise RuntimeError("ROUND_CANDIDATE_MISSING")
    return Candidate.model_validate(candidate_payload)


def create_round_stages(input_data: Mapping[str, object]) -> dict[str, object]:
    artifacts = input_data["artifacts"]
    cases = input_data["cases"]
    traces = input_data["traces"]
    harnesses = input_data["harnesses"]
    refinement_engine = input_data["refinement_engine"]
    executor = input_data["executor"]
    evaluator = input_data["evaluator"]
    export_round = input_data["export_round"]
    options = input_data["options"]
    on_evaluate_input = input_data.get("on_evaluate_input")

    class _CollectStage:
        async def run(self, round_obj: Round) -> None:
            collected = await _await_maybe(cases["collect"](round_obj))
            partition_cases_input = tuple(
                item if isinstance(item, PartitionCase) else PartitionCase.model_validate(item)
                for item in collected
            )
            partition = seal_partition_manifest(
                partition_cases(
                    partition_cases_input,
                    PartitionOptions(
                        seed=options["partition_seed"],
                        minimum_reserved=options["minimum_reserved"],
                        reserved_ratio=options["reserved_ratio"],
                        created_at=round_obj.updated_at,
                    ),
                )
            )
            baseline = HarnessSnapshot.model_validate(
                await _await_maybe(harnesses["fetch_snapshot"](round_obj.agent_id, round_obj.domain_id))
            )
            capabilities = AgentCapabilities.model_validate(
                await _await_maybe(harnesses["get_capabilities"](round_obj.agent_id))
            )
            await _await_maybe(
                artifacts.save(
                    round_obj.id,
                    _empty_session(
                        cases=partition_cases_input,
                        partition=partition,
                        baseline=baseline,
                        capabilities=capabilities,
                    ),
                )
            )

    class _DiagnoseStage:
        async def run(self, round_obj: Round) -> None:
            session = _require_session(await _await_maybe(artifacts.get(round_obj.id)), "diagnose")
            partition = _session_partition(session)
            diagnosis_ids = set(partition.diagnosis_ids)
            diagnosis_cases = tuple(
                item for item in _session_cases(session) if item.id in diagnosis_ids
            )
            trace_input = tuple(item.model_dump(by_alias=True) for item in diagnosis_cases)
            collected_traces = await _await_maybe(traces["collect"](round_obj, trace_input))
            diagnosis = diagnose_executions(round_obj.id, collected_traces)
            saved = dict(session)
            saved["diagnosis"] = diagnosis.model_dump(by_alias=True)
            await _await_maybe(artifacts.save(round_obj.id, saved))

    class _RefineStage:
        async def run(self, round_obj: Round) -> None:
            session = _require_session(await _await_maybe(artifacts.get(round_obj.id)), "refine")
            partition = _session_partition(session)
            diagnosis = session["diagnosis"]
            if not isinstance(diagnosis, Mapping):
                raise RuntimeError("ROUND_DIAGNOSIS_MISSING")
            cases_input = _session_cases(session)

            async def _run_refine_with_projection(_visible_cases: tuple[dict[str, str], ...]) -> tuple[Candidate, ...]:
                evidence_case_ids = tuple(
                    str(item["caseId"])
                    for item in diagnosis.get("evidence", [])
                )
                assert_learning_sources(partition, evidence_case_ids)

                request = RefinementRequest.model_validate(
                    {
                        "roundId": round_obj.id,
                        "baseline": session["baseline"],
                        "findings": diagnosis.get("findings", []),
                        "hypotheses": diagnosis.get("hypotheses", []),
                        "evidence": diagnosis.get("evidence", []),
                        "maxProposals": options.get("max_proposals", 3),
                    }
                )
                refined = await _await_maybe(refinement_engine["refine"](request))
                return tuple(
                    item if isinstance(item, Candidate) else Candidate.model_validate(item)
                    for item in refined
                )

            candidates = await run_refinement_with_diagnosis_cases(
                cases_input,
                partition,
                _run_refine_with_projection,
            )
            saved = dict(session)
            saved["refinement"] = {
                "candidates": [item.model_dump(by_alias=True) for item in candidates],
                "composed": candidates[0].model_dump(by_alias=True) if candidates else None,
                "rejected": [],
                "lessons": [],
                "stopReason": "completed",
            }
            await _await_maybe(artifacts.save(round_obj.id, saved))

    class _ExecuteStage:
        async def run(self, round_obj: Round) -> None:
            session = _require_session(await _await_maybe(artifacts.get(round_obj.id)), "execute")
            partition = _session_partition(session)
            baseline = _session_baseline(session)
            candidate = _candidate_from_session(session)

            reserved_executions: list[dict[str, object]] = []
            for case_id in partition.reserved_ids:
                baseline_request = {
                    "kind": "baseline",
                    "round_id": round_obj.id,
                    "case_id": case_id,
                    "harness_version_id": baseline.id,
                    "attempt": 1,
                    "idempotency_key": f"{round_obj.id}:{case_id}:reserved:baseline",
                }
                candidate_request = {
                    "kind": "candidate",
                    "round_id": round_obj.id,
                    "case_id": case_id,
                    "harness_version_id": candidate.snapshot.id,
                    "candidate_id": candidate.id,
                    "attempt": 1,
                    "idempotency_key": f"{round_obj.id}:{case_id}:reserved:candidate",
                }
                baseline_execution = ExecutionResult.model_validate(
                    await _await_maybe(executor["execute"](baseline_request))
                )
                candidate_execution = ExecutionResult.model_validate(
                    await _await_maybe(executor["execute"](candidate_request))
                )
                reserved_executions.append(
                    {
                        "baseline": baseline_execution.model_dump(by_alias=True),
                        "candidate": candidate_execution.model_dump(by_alias=True),
                    }
                )

            saved = dict(session)
            saved["reservedExecutions"] = reserved_executions
            await _await_maybe(artifacts.save(round_obj.id, saved))

    class _EvaluateStage:
        async def run(self, round_obj: Round) -> None:
            session = _require_session(await _await_maybe(artifacts.get(round_obj.id)), "evaluate")
            partition = _session_partition(session)
            candidate = _candidate_from_session(session)
            reserved_executions = session["reservedExecutions"]
            signals = []
            for item in reserved_executions:
                baseline_execution = item["baseline"]
                candidate_execution = item["candidate"]
                baseline_status = baseline_execution["status"]
                candidate_status = candidate_execution["status"]
                signals.append(
                    {
                        "case_id": baseline_execution["caseId"],
                        "baseline_execution_id": baseline_execution["id"],
                        "candidate_execution_id": candidate_execution["id"],
                        "deterministic_passed": candidate_status == "succeeded",
                        "completion_change": 1
                        if candidate_status == "succeeded" and baseline_status == "succeeded"
                        else 0,
                        "cost_change": float(candidate_execution["metrics"].get("cost") or 0)
                        - float(baseline_execution["metrics"].get("cost") or 0),
                        "token_change": (
                            int(candidate_execution["metrics"].get("inputTokens") or 0)
                            + int(candidate_execution["metrics"].get("outputTokens") or 0)
                            - int(baseline_execution["metrics"].get("inputTokens") or 0)
                            - int(baseline_execution["metrics"].get("outputTokens") or 0)
                        ),
                        "latency_change": int(candidate_execution["metrics"].get("latencyMs") or 0)
                        - int(baseline_execution["metrics"].get("latencyMs") or 0),
                        "critical_violations": (),
                    }
                )

            evaluate_input = {
                "evaluation_id": f"{round_obj.id}:{candidate.id}",
                "round_id": round_obj.id,
                "candidate_id": candidate.id,
                "evaluator": evaluator,
                "cases": tuple(signals),
                "reserved_case_ids": tuple(partition.reserved_ids),
            }
            if callable(on_evaluate_input):
                on_evaluate_input(evaluate_input)
            evaluation = VersionedEvaluationResult.model_validate(evaluate_candidate(evaluate_input))

            saved = dict(session)
            saved["evaluation"] = evaluation.model_dump(by_alias=True)
            await _await_maybe(artifacts.save(round_obj.id, saved))

    class _ExportStage:
        async def get_completion_event(self, round_obj: Round) -> RoundEvent:
            session = _require_session(await _await_maybe(artifacts.get(round_obj.id)), "export-recovery")
            evaluation = session.get("evaluation")
            if evaluation is None:
                raise RuntimeError("ROUND_EVALUATION_MISSING")
            return terminal_event_for_decision(str(evaluation["decision"]))

        async def run(self, round_obj: Round) -> RoundEvent:
            session = _require_session(await _await_maybe(artifacts.get(round_obj.id)), "export")
            evaluation = session.get("evaluation")
            if evaluation is None:
                raise RuntimeError("ROUND_EVALUATION_MISSING")
            await _await_maybe(export_round(round_obj, session))
            return terminal_event_for_decision(str(evaluation["decision"]))

    return {
        "collect": _CollectStage(),
        "diagnose": _DiagnoseStage(),
        "refine": _RefineStage(),
        "execute": _ExecuteStage(),
        "evaluate": _EvaluateStage(),
        "export": _ExportStage(),
    }
