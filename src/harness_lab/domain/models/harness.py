from __future__ import annotations

from typing import Any, Literal, Mapping, NewType, TypeAlias

from pydantic import Field, field_validator

from . import DomainModel
from .evidence import EvidenceId, HypothesisId
from .round import AgentId, CaseId, DomainId, RoundId

Brand: TypeAlias = str
HarnessSnapshotId = NewType("HarnessSnapshotId", Brand)
CandidateId = NewType("CandidateId", Brand)
ExecutionId = NewType("ExecutionId", Brand)


class HarnessSnapshot(DomainModel):
    id: HarnessSnapshotId
    agent_id: AgentId
    domain_id: DomainId
    version: str
    components: Mapping[str, str]
    immutable_constraints: tuple[str, ...]
    created_at: str
    source_version: str | None = Field(default=None, exclude_if=lambda value: value is None)
    artifact_hash: str | None = Field(default=None, exclude_if=lambda value: value is None)
    opaque_payload: Mapping[str, Any] | None = Field(
        default=None,
        exclude_if=lambda value: value is None,
    )

    @field_validator("source_version", "artifact_hash", "opaque_payload", mode="before")
    @classmethod
    def _reject_explicit_null_on_omissible_fields(cls, value: object) -> object:
        if value is None:
            raise ValueError("field must be omitted instead of null")
        return value


class CandidateChange(DomainModel):
    component: str
    before: str
    after: str
    rollback: str
    expected_effect: str


class Candidate(DomainModel):
    id: CandidateId
    round_id: RoundId
    baseline_id: HarnessSnapshotId
    snapshot: HarnessSnapshot
    changes: tuple[CandidateChange, ...]
    hypothesis_ids: tuple[HypothesisId, ...]
    evidence_ids: tuple[EvidenceId, ...]


ExecutionStatus = Literal[
    "succeeded",
    "agent_failed",
    "integration_failed",
    "trace_missing",
    "timed_out",
    "cancelled",
]


class ExecutionMetrics(DomainModel):
    input_tokens: int | None
    output_tokens: int | None
    cost: float | None
    latency_ms: int


class ExecutionResult(DomainModel):
    id: ExecutionId
    round_id: RoundId
    case_id: CaseId
    harness_snapshot_id: HarnessSnapshotId
    status: ExecutionStatus
    correlation_id: str
    trace_id: str | None
    output: str | None
    metrics: ExecutionMetrics
    limitations: tuple[str, ...]
