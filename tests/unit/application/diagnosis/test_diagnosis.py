from __future__ import annotations

from harness_lab.application.diagnosis.diagnose_executions import diagnose_executions

ROUND_ID = "round-diagnosis"
TRACES = (
    {"id": "rule", "output": "forbidden", "rule_violation": "PII disclosed"},
    {"id": "missing-tool", "output": "guessed", "expected_tools": ("search",), "tool_calls": ()},
    {
        "id": "unnecessary-tool",
        "output": "ok",
        "expected_tools": (),
        "tool_calls": ({"name": "search", "valid_parameters": True, "failed": False},),
    },
    {
        "id": "invalid-params",
        "output": "failed",
        "expected_tools": ("search",),
        "tool_calls": ({"name": "search", "valid_parameters": False, "failed": False},),
    },
    {"id": "unsupported", "output": "claim without source", "unsupported_answer": True},
    {"id": "context", "output": "missed context", "context_failure": True},
    {"id": "repeat", "output": "again again", "repetition_count": 4},
    {"id": "cost", "output": "expensive", "cost": 9, "cost_limit": 2},
    {"id": "latency", "output": "slow", "latency_ms": 9000, "latency_limit_ms": 1000},
    {
        "id": "infra",
        "output": "authentication failed password=supersecret",
        "infrastructure_failure": "authentication failed",
    },
    {
        "id": "tool-failure",
        "output": "token=abc123",
        "expected_tools": ("search",),
        "tool_calls": ({"name": "search", "valid_parameters": True, "failed": True},),
    },
)


def test_diagnosis_emits_deterministic_evidence_backed_findings_in_taxonomy_order() -> None:
    result = diagnose_executions(ROUND_ID, TRACES)

    assert [item.category_code for item in result.findings] == [
        "RULE_VIOLATION",
        "MISSING_TOOL",
        "UNNECESSARY_TOOL",
        "INVALID_TOOL_PARAMETERS",
        "UNSUPPORTED_ANSWER",
        "CONTEXT_FAILURE",
        "REPETITION",
        "COST_LIMIT_EXCEEDED",
        "LATENCY_LIMIT_EXCEEDED",
        "INFRASTRUCTURE_FAILURE",
        "TOOL_FAILURE",
    ]
    for finding in result.findings:
        assert finding.observed_fact != ""
        assert finding.frequency > 0
        assert finding.sample_size == len(TRACES)
        assert finding.impact != ""
        assert finding.confidence > 0
        assert len(finding.evidence_ids) > 0
        assert len(finding.limitations) > 0

    for evidence in result.evidence:
        assert evidence.trace_id in (evidence.source_url or "")
        excerpt = evidence.excerpt.lower()
        assert "supersecret" not in excerpt
        assert "abc123" not in excerpt
        assert "[redacted]" in excerpt or "password=" not in excerpt

    assert all(item.explanation.startswith("Hypothesis:") for item in result.hypotheses)


def test_diagnosis_non_harness_failures_do_not_propose_changes_or_hypotheses() -> None:
    result = diagnose_executions(ROUND_ID, TRACES)
    blocked_categories = {"INFRASTRUCTURE_FAILURE", "TOOL_FAILURE"}
    blocked_finding_ids = {
        finding.id for finding in result.findings if finding.category_code in blocked_categories
    }

    assert [
        item for item in result.hypotheses if item.finding_id in blocked_finding_ids
    ] == []
    blocked_actionability = [
        item for item in result.actionability if item.finding_id in blocked_finding_ids
    ]
    assert len(blocked_actionability) == 2
    assert blocked_actionability[0].proposed_change is False
    assert blocked_actionability[1].proposed_change is False


def test_unnecessary_tool_requires_explicit_empty_expected_tools() -> None:
    base_trace = {
        "id": "trace-tool",
        "output": "ok",
        "tool_calls": ({"name": "search", "valid_parameters": True, "failed": False},),
    }

    without_expected = diagnose_executions(
        ROUND_ID,
        (
            {
                **base_trace,
                "expected_tools": None,
            },
        ),
    )
    assert [item.category_code for item in without_expected.findings] == []

    with_explicit_empty = diagnose_executions(
        ROUND_ID,
        (
            {
                **base_trace,
                "expected_tools": (),
            },
        ),
    )
    assert [item.category_code for item in with_explicit_empty.findings] == [
        "UNNECESSARY_TOOL"
    ]