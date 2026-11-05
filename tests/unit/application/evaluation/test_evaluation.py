from __future__ import annotations

import copy

import pytest

from harness_lab.application.evaluation.evaluate_candidate import evaluate_candidate

BASE = {
    "evaluation_id": "evaluation-1",
    "round_id": "round-1",
    "candidate_id": "candidate-1",
    "evaluator": {
        "id": "evaluator-default",
        "version": "1.0.0",
        "minimum_sample_size": 2,
        "recommendation_threshold": 0.1,
        "maximum_regression_rate": 0.0,
    },
    "cases": (
        {
            "case_id": "case-1",
            "baseline_execution_id": "base-1",
            "candidate_execution_id": "candidate-1",
            "deterministic_passed": True,
            "completion_change": 0.2,
            "cost_change": -0.1,
            "token_change": -0.1,
            "latency_change": -0.1,
            "judge_score": 0.8,
            "human_approved": True,
            "critical_violations": (),
        },
        {
            "case_id": "case-2",
            "baseline_execution_id": "base-2",
            "candidate_execution_id": "candidate-2",
            "deterministic_passed": True,
            "completion_change": 0.3,
            "cost_change": -0.2,
            "token_change": -0.2,
            "latency_change": -0.2,
            "judge_score": 0.9,
            "human_approved": True,
            "critical_violations": (),
        },
    ),
}


def _merge(base: dict, update: dict) -> dict:
    merged = copy.deepcopy(base)
    merged.update(update)
    return merged


def test_evaluation_combines_deterministic_measured_judge_and_human_signals() -> None:
    result = evaluate_candidate(BASE)

    assert result.decision == "recommended"
    assert result.sample_size == 2
    assert result.aggregate_score_change is not None and result.aggregate_score_change > 0.1
    assert result.cost_change is not None and result.cost_change < 0
    assert result.latency_change is not None and result.latency_change < 0
    assert result.evaluator_version == "1.0.0"
    assert all(item.passed and not item.regression for item in result.cases)


def test_evaluation_blocks_recommendation_on_critical_failure() -> None:
    cases = list(BASE["cases"])
    cases[1] = {**cases[1], "critical_violations": ("SECRET_DISCLOSURE",)}
    result = evaluate_candidate(_merge(BASE, {"cases": tuple(cases)}))
    assert result.decision == "rejected"
    assert "critical" in result.rationale.lower()


@pytest.mark.parametrize(
    ("decision", "override"),
    [
        ("cancelled", {"lifecycle": "cancelled"}),
        ("integration_failed", {"lifecycle": "integration_failed"}),
        ("stopped_by_limit", {"lifecycle": "stopped_by_limit"}),
        ("pending_validation", {"lifecycle": "pending_validation"}),
        ("validation_insufficient", {"cases": (BASE["cases"][0],)}),
        (
            "inconclusive",
            {"cases": tuple({**item, "completion_change": 0.0} for item in BASE["cases"])},
        ),
        (
            "rejected",
            {
                "cases": tuple(
                    {**item, "deterministic_passed": False} for item in BASE["cases"]
                )
            },
        ),
    ],
)
def test_evaluation_returns_terminal_decision_for_policy_condition(
    decision: str,
    override: dict,
) -> None:
    result = evaluate_candidate(_merge(BASE, override))
    assert result.decision == decision


def test_evaluation_marks_variable_mixed_outcomes_inconclusive() -> None:
    result = evaluate_candidate(
        _merge(
            BASE,
            {
                "cases": (
                    {**BASE["cases"][0], "completion_change": 1.0},
                    {**BASE["cases"][1], "completion_change": -1.0},
                )
            },
        )
    )
    assert result.decision == "inconclusive"
    assert "High run variability." in result.limitations


def test_evaluation_computes_expected_aggregation_confidence_and_limitations() -> None:
    result = evaluate_candidate(
        _merge(
            BASE,
            {
                "cases": (
                    {
                        **BASE["cases"][0],
                        "completion_change": 0.2,
                        "judge_score": None,
                        "human_approved": None,
                    },
                    {
                        **BASE["cases"][1],
                        "completion_change": 0.3,
                        "judge_score": 0.9,
                        "human_approved": True,
                    },
                )
            },
        )
    )

    expected_aggregate = ((0.2 + 0.3) / 2) + (0.9 * 0.1)
    assert result.aggregate_score_change is not None
    assert result.aggregate_score_change == pytest.approx(expected_aggregate)
    assert result.confidence == pytest.approx(0.75)
    assert "Judge signal unavailable for one or more cases." in result.limitations
    assert "Human review is incomplete." in result.limitations


def test_evaluation_rejects_non_reserved_inputs() -> None:
    with pytest.raises(ValueError, match="EVALUATION_CASE_NOT_RESERVED"):
        evaluate_candidate(
            _merge(
                BASE,
                {
                    "reserved_case_ids": ("case-1",),
                },
            )
        )