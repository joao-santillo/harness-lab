from __future__ import annotations

from typing import Literal

from harness_lab.domain import CaseEvaluation, EvaluatorDefinition, VersionedEvaluationResult
from harness_lab.domain.models import DomainModel

from .recommendation_policy import decide_recommendation

LifecycleDecision = Literal[
    "cancelled",
    "integration_failed",
    "stopped_by_limit",
    "pending_validation",
]


class CandidateCaseSignal(DomainModel):
    case_id: str
    baseline_execution_id: str
    candidate_execution_id: str
    deterministic_passed: bool
    completion_change: float
    cost_change: float
    token_change: float
    latency_change: float
    judge_score: float | None = None
    human_approved: bool | None = None
    critical_violations: tuple[str, ...]


class CandidateEvaluationInput(DomainModel):
    evaluation_id: str
    round_id: str
    candidate_id: str
    evaluator: EvaluatorDefinition
    cases: tuple[CandidateCaseSignal, ...]
    lifecycle: LifecycleDecision | None = None
    reserved_case_ids: tuple[str, ...] | None = None


def _average(values: tuple[float, ...]) -> float:
    return 0 if len(values) == 0 else sum(values) / len(values)


def evaluate_candidate(
    input_data: CandidateEvaluationInput | dict[str, object],
) -> VersionedEvaluationResult:
    input_value = (
        input_data
        if isinstance(input_data, CandidateEvaluationInput)
        else CandidateEvaluationInput.model_validate(input_data)
    )

    if input_value.reserved_case_ids is not None:
        reserved = set(input_value.reserved_case_ids)
        if any(signal.case_id not in reserved for signal in input_value.cases):
            raise ValueError("EVALUATION_CASE_NOT_RESERVED")

    completion_changes = tuple(signal.completion_change for signal in input_value.cases)
    mean_completion = _average(completion_changes)
    high_variability = (
        len(completion_changes) > 1
        and (max(completion_changes) - min(completion_changes)) > 1
    )

    case_results: list[CaseEvaluation] = []
    for signal in input_value.cases:
        regression = (
            signal.completion_change < 0
            or not signal.deterministic_passed
            or signal.human_approved is False
            or len(signal.critical_violations) > 0
        )
        case_results.append(
            CaseEvaluation(
                case_id=signal.case_id,
                baseline_execution_id=signal.baseline_execution_id,
                candidate_execution_id=signal.candidate_execution_id,
                passed=not regression,
                regression=regression,
                score_change=signal.completion_change,
                critical_violations=signal.critical_violations,
            )
        )

    judge_scores = tuple(
        signal.judge_score
        for signal in input_value.cases
        if signal.judge_score is not None
    )
    aggregate_score = mean_completion + (_average(judge_scores) * 0.1)
    regression_rate = len([item for item in case_results if item.regression]) / max(
        len(case_results), 1
    )
    policy = decide_recommendation(
        {
            "evaluator": input_value.evaluator,
            "sample_size": len(input_value.cases),
            "aggregate_score": aggregate_score,
            "regression_rate": regression_rate,
            "critical_failure": any(
                len(item.critical_violations) > 0 for item in case_results
            ),
            "deterministic_failure": any(
                not signal.deterministic_passed for signal in input_value.cases
            ),
            "human_rejected": any(
                signal.human_approved is False for signal in input_value.cases
            ),
            "high_variability": high_variability,
            **(
                {}
                if input_value.lifecycle is None
                else {"lifecycle": input_value.lifecycle}
            ),
        }
    )

    limitations = [
        *(
            ["Judge signal unavailable for one or more cases."]
            if len(judge_scores) < len(input_value.cases)
            else []
        ),
        *(
            ["Human review is incomplete."]
            if any(signal.human_approved is None for signal in input_value.cases)
            else []
        ),
        *(["High run variability."] if high_variability else []),
    ]

    confidence = max(
        0,
        min(1, len(input_value.cases) / input_value.evaluator.minimum_sample_size),
    ) * (1 if len(limitations) == 0 else 0.75)

    return VersionedEvaluationResult(
        id=input_value.evaluation_id,
        round_id=input_value.round_id,
        candidate_id=input_value.candidate_id,
        decision=policy["decision"],
        sample_size=len(input_value.cases),
        confidence=confidence,
        aggregate_score_change=aggregate_score,
        cost_change=_average(tuple(signal.cost_change for signal in input_value.cases)),
        latency_change=_average(tuple(signal.latency_change for signal in input_value.cases)),
        cases=tuple(case_results),
        limitations=tuple(limitations),
        rationale=policy["rationale"],
        evaluator_version=input_value.evaluator.version,
    )
