from __future__ import annotations

from typing import NewType, TypeAlias

from . import DomainModel
from .harness import CandidateId, ExecutionId
from .round import CaseId, RoundId, TerminalDecision

Brand: TypeAlias = str
EvaluationId = NewType("EvaluationId", Brand)


class CaseEvaluation(DomainModel):
    case_id: CaseId
    baseline_execution_id: ExecutionId
    candidate_execution_id: ExecutionId
    passed: bool
    regression: bool
    score_change: float | None
    critical_violations: tuple[str, ...]


class EvaluationResult(DomainModel):
    id: EvaluationId
    round_id: RoundId
    candidate_id: CandidateId
    decision: TerminalDecision
    sample_size: int
    confidence: float
    aggregate_score_change: float | None
    cost_change: float | None
    latency_change: float | None
    cases: tuple[CaseEvaluation, ...]
    limitations: tuple[str, ...]
    rationale: str


class VersionedEvaluationResult(EvaluationResult):
    evaluator_version: str
