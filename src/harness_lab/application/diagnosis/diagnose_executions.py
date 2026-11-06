from __future__ import annotations

import re
from collections.abc import Callable

from harness_lab.domain import EvidenceTrace, Finding, Hypothesis
from harness_lab.domain.models import DomainModel
from harness_lab.domain.models.evidence import EvidenceId, FindingId, HypothesisId
from harness_lab.domain.models.round import CaseId, RoundId

from .taxonomy import DIAGNOSIS_CATEGORIES, NON_HARNESS_CATEGORIES, DiagnosisCategory


class DiagnosticToolCall(DomainModel):
    name: str
    valid_parameters: bool
    failed: bool


class DiagnosticTrace(DomainModel):
    id: str
    output: str | None
    rule_violation: str | None = None
    expected_tools: tuple[str, ...] | None = None
    tool_calls: tuple[DiagnosticToolCall, ...] | None = None
    unsupported_answer: bool | None = None
    context_failure: bool | None = None
    repetition_count: int | None = None
    cost: float | None = None
    cost_limit: float | None = None
    latency_ms: int | None = None
    latency_limit_ms: int | None = None
    infrastructure_failure: str | None = None


class DiagnosisActionability(DomainModel):
    finding_id: str
    proposed_change: bool
    reason: str


class DiagnosisResult(DomainModel):
    evidence: tuple[EvidenceTrace, ...]
    findings: tuple[Finding, ...]
    hypotheses: tuple[Hypothesis, ...]
    actionability: tuple[DiagnosisActionability, ...]


def _sanitize_excerpt(trace: DiagnosticTrace) -> str:
    excerpt = (trace.output or "No agent output was available.")[:240]
    return re.sub(
        r"(authorization|token|secret|password|api[_-]?key)\s*[:=]\s*\S+",
        r"\1=[REDACTED]",
        excerpt,
        flags=re.IGNORECASE,
    )


def _matches_rule_violation(trace: DiagnosticTrace) -> bool:
    return trace.rule_violation is not None and trace.rule_violation != ""


def _matches_missing_tool(trace: DiagnosticTrace) -> bool:
    if trace.expected_tools is None:
        return False
    present = {call.name for call in trace.tool_calls or ()}
    return any(expected not in present for expected in trace.expected_tools)


def _matches_unnecessary_tool(trace: DiagnosticTrace) -> bool:
    return (
        trace.expected_tools is not None
        and bool(trace.tool_calls)
        and len(trace.expected_tools) == 0
    )


def _matches_invalid_tool_parameters(trace: DiagnosticTrace) -> bool:
    return any(not call.valid_parameters for call in trace.tool_calls or ())


def _matches_unsupported_answer(trace: DiagnosticTrace) -> bool:
    return trace.unsupported_answer is True


def _matches_context_failure(trace: DiagnosticTrace) -> bool:
    return trace.context_failure is True


def _matches_repetition(trace: DiagnosticTrace) -> bool:
    return (trace.repetition_count or 0) > 2


def _matches_cost_limit_exceeded(trace: DiagnosticTrace) -> bool:
    return trace.cost is not None and trace.cost_limit is not None and trace.cost > trace.cost_limit


def _matches_latency_limit_exceeded(trace: DiagnosticTrace) -> bool:
    return (
        trace.latency_ms is not None
        and trace.latency_limit_ms is not None
        and trace.latency_ms > trace.latency_limit_ms
    )


def _matches_infrastructure_failure(trace: DiagnosticTrace) -> bool:
    return trace.infrastructure_failure is not None and trace.infrastructure_failure != ""


def _matches_tool_failure(trace: DiagnosticTrace) -> bool:
    return any(call.failed for call in trace.tool_calls or ())


_DETECTORS: dict[DiagnosisCategory, Callable[[DiagnosticTrace], bool]] = {
    "RULE_VIOLATION": _matches_rule_violation,
    "MISSING_TOOL": _matches_missing_tool,
    "UNNECESSARY_TOOL": _matches_unnecessary_tool,
    "INVALID_TOOL_PARAMETERS": _matches_invalid_tool_parameters,
    "UNSUPPORTED_ANSWER": _matches_unsupported_answer,
    "CONTEXT_FAILURE": _matches_context_failure,
    "REPETITION": _matches_repetition,
    "COST_LIMIT_EXCEEDED": _matches_cost_limit_exceeded,
    "LATENCY_LIMIT_EXCEEDED": _matches_latency_limit_exceeded,
    "INFRASTRUCTURE_FAILURE": _matches_infrastructure_failure,
    "TOOL_FAILURE": _matches_tool_failure,
}


def diagnose_executions(
    round_id: str,
    traces: tuple[DiagnosticTrace, ...] | list[DiagnosticTrace] | tuple[dict[str, object], ...] | list[dict[str, object]],
) -> DiagnosisResult:
    typed_round_id = RoundId(round_id)
    normalized_traces = tuple(
        item if isinstance(item, DiagnosticTrace) else DiagnosticTrace.model_validate(item)
        for item in traces
    )

    evidence: list[EvidenceTrace] = []
    findings: list[Finding] = []
    hypotheses: list[Hypothesis] = []
    actionability: list[DiagnosisActionability] = []

    for category in DIAGNOSIS_CATEGORIES:
        matched = tuple(trace for trace in normalized_traces if _DETECTORS[category](trace))
        if len(matched) == 0:
            continue

        category_evidence: list[EvidenceTrace] = []
        for index, trace in enumerate(matched, start=1):
            item = EvidenceTrace(
                kind="trace",
                id=EvidenceId(f"{category.lower()}-{index}"),
                round_id=typed_round_id,
                case_id=CaseId(trace.id),
                trace_id=trace.id,
                observation_id=None,
                excerpt=_sanitize_excerpt(trace),
                source_url=f"trace://{trace.id}",
            )
            evidence.append(item)
            category_evidence.append(item)

        finding_id = FindingId(f"finding-{category.lower()}")
        finding = Finding(
            id=finding_id,
            round_id=typed_round_id,
            category_code=category,
            observed_fact=f"{len(matched)} of {len(normalized_traces)} traces matched {category}.",
            frequency=len(matched),
            sample_size=len(normalized_traces),
            severity=(
                "critical"
                if category == "RULE_VIOLATION"
                else "high"
                if category in NON_HARNESS_CATEGORIES
                else "medium"
            ),
            impact=f"Observed {category.lower().replace('_', ' ')} in the analyzed cohort.",
            evidence_ids=tuple(item.id for item in category_evidence),
            confidence=1,
            limitations=("Deterministic detector; causal attribution requires a controlled probe.",),
        )
        findings.append(finding)

        proposed_change = category not in NON_HARNESS_CATEGORIES
        actionability.append(
            DiagnosisActionability(
                finding_id=finding_id,
                proposed_change=proposed_change,
                reason=(
                    "Eligible for a bounded harness hypothesis."
                    if proposed_change
                    else "Repair the integration before changing the harness."
                ),
            )
        )

        if proposed_change:
            hypotheses.append(
                Hypothesis(
                    id=HypothesisId(f"hypothesis-{category.lower()}"),
                    finding_id=finding_id,
                    explanation=f"Hypothesis: a bounded harness change may reduce {category.lower().replace('_', ' ')}.",
                    evidence_ids=tuple(item.id for item in category_evidence),
                    expected_effect=f"Reduce the frequency of {category}.",
                )
            )

    return DiagnosisResult(
        evidence=tuple(evidence),
        findings=tuple(findings),
        hypotheses=tuple(hypotheses),
        actionability=tuple(actionability),
    )
