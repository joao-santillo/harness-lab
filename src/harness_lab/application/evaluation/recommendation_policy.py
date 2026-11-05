from __future__ import annotations

from typing import Literal

from harness_lab.domain import EvaluatorDefinition
from harness_lab.domain.models import DomainModel

LifecycleDecision = Literal[
    "cancelled",
    "integration_failed",
    "stopped_by_limit",
    "pending_validation",
]


class PolicyInput(DomainModel):
    evaluator: EvaluatorDefinition
    sample_size: int
    aggregate_score: float
    regression_rate: float
    critical_failure: bool
    deterministic_failure: bool
    human_rejected: bool
    high_variability: bool
    lifecycle: LifecycleDecision | None = None


def decide_recommendation(input_data: PolicyInput | dict[str, object]) -> dict[str, str]:
    input_value = (
        input_data
        if isinstance(input_data, PolicyInput)
        else PolicyInput.model_validate(input_data)
    )

    if input_value.lifecycle is not None:
        return {
            "decision": input_value.lifecycle,
            "rationale": f"Evaluation ended as {input_value.lifecycle}.",
        }
    if input_value.sample_size < input_value.evaluator.minimum_sample_size:
        return {
            "decision": "validation_insufficient",
            "rationale": "Reserved validation sample is below the minimum.",
        }
    if input_value.critical_failure:
        return {
            "decision": "rejected",
            "rationale": "At least one critical violation blocks recommendation.",
        }
    if input_value.deterministic_failure or input_value.human_rejected:
        return {
            "decision": "rejected",
            "rationale": "Deterministic or human review policy failed.",
        }
    if input_value.high_variability:
        return {
            "decision": "inconclusive",
            "rationale": "Run variability exceeds the confidence policy.",
        }
    if input_value.regression_rate > input_value.evaluator.maximum_regression_rate:
        return {
            "decision": "rejected",
            "rationale": "Per-case regression policy failed.",
        }
    if input_value.aggregate_score >= input_value.evaluator.recommendation_threshold:
        return {
            "decision": "recommended",
            "rationale": "Candidate cleared all gates and the recommendation threshold.",
        }
    return {
        "decision": "inconclusive",
        "rationale": "Measured improvement did not clear the recommendation threshold.",
    }
