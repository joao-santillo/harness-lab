from __future__ import annotations

from typing import Literal, NewType, TypeAlias

from . import DomainModel
from .round import CaseId, RoundId

Brand: TypeAlias = str
EvidenceId = NewType("EvidenceId", Brand)
FindingId = NewType("FindingId", Brand)
HypothesisId = NewType("HypothesisId", Brand)


class EvidenceTrace(DomainModel):
    kind: Literal["trace"]
    id: EvidenceId
    round_id: RoundId
    case_id: CaseId
    trace_id: str
    observation_id: str | None
    excerpt: str
    source_url: str | None


class EvidenceExecution(DomainModel):
    kind: Literal["execution"]
    id: EvidenceId
    round_id: RoundId
    case_id: CaseId
    execution_id: str
    excerpt: str


class EvidenceMissingData(DomainModel):
    kind: Literal["missing_data"]
    id: EvidenceId
    round_id: RoundId
    case_id: CaseId
    field: str
    source_reference: str


Evidence = AnnotatedEvidence = (
    EvidenceTrace | EvidenceExecution | EvidenceMissingData
)

FindingSeverity = Literal["low", "medium", "high", "critical"]


class Finding(DomainModel):
    id: FindingId
    round_id: RoundId
    category_code: str
    observed_fact: str
    frequency: int
    sample_size: int
    severity: FindingSeverity
    impact: str
    evidence_ids: tuple[EvidenceId, ...]
    confidence: float
    limitations: tuple[str, ...]


class Hypothesis(DomainModel):
    id: HypothesisId
    finding_id: FindingId
    explanation: str
    evidence_ids: tuple[EvidenceId, ...]
    expected_effect: str
