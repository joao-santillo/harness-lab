from __future__ import annotations

from typing import Annotated, Literal, Protocol, TypeAlias

from pydantic import Field, TypeAdapter

from .models import DomainModel
from .models.case import CaseRecord
from .models.evaluation import EvaluationResult
from .models.evidence import Evidence, Finding, Hypothesis
from .models.harness import (
    Candidate,
    CandidateId,
    ExecutionResult,
    HarnessSnapshot,
    HarnessSnapshotId,
)
from .models.round import (
    AgentId,
    CaseId,
    DomainId,
    ExportId,
    Round,
    RoundCheckpoint,
    RoundId,
    RoundProgressEvent,
    SecretId,
    TerminalDecision,
)


class TraceQuery(DomainModel):
    round_id: RoundId
    agent_id: AgentId
    from_: str = Field(alias="from")
    to: str
    cursor: str | None
    limit: int


class TracePage(DomainModel):
    evidence: tuple[Evidence, ...]
    next_cursor: str | None


class TraceRepository(Protocol):
    async def collect(self, query: TraceQuery) -> TracePage: ...


class CaseRepository(Protocol):
    async def save_many(self, cases: tuple[CaseRecord, ...]) -> int: ...

    async def list_by_scope(self, agent_id: AgentId, domain_id: DomainId) -> tuple[CaseRecord, ...]: ...


class AgentCapabilities(DomainModel):
    editable_components: tuple[str, ...]
    supports_seed: bool
    supports_tool_replay: bool


class AgentHarnessRepository(Protocol):
    async def get_capabilities(self, agent_id: AgentId) -> AgentCapabilities: ...

    async def get_snapshot(self, id: HarnessSnapshotId) -> HarnessSnapshot | None: ...

    async def save_snapshot(self, snapshot: HarnessSnapshot) -> None: ...


class _ExecutionRequestContext(DomainModel):
    round_id: RoundId
    case_id: CaseId
    harness_version_id: HarnessSnapshotId
    attempt: int
    idempotency_key: str


class BaselineExecutionRequest(_ExecutionRequestContext):
    kind: Literal["baseline"]


class CandidateVersionExecutionRequest(_ExecutionRequestContext):
    kind: Literal["candidate"]
    candidate_id: CandidateId


CandidateExecutionRequest: TypeAlias = Annotated[
    BaselineExecutionRequest | CandidateVersionExecutionRequest,
    Field(discriminator="kind"),
]
_candidate_execution_adapter: TypeAdapter[BaselineExecutionRequest | CandidateVersionExecutionRequest] = (
    TypeAdapter(CandidateExecutionRequest)  # type: ignore[arg-type]
)


def parse_candidate_execution_request(payload: object) -> BaselineExecutionRequest | CandidateVersionExecutionRequest:
    return _candidate_execution_adapter.validate_python(payload)


class CandidateExecutor(Protocol):
    async def execute(
        self, request: BaselineExecutionRequest | CandidateVersionExecutionRequest
    ) -> ExecutionResult: ...


class RefinementRequest(DomainModel):
    round_id: RoundId
    baseline: HarnessSnapshot
    findings: tuple[Finding, ...]
    hypotheses: tuple[Hypothesis, ...]
    evidence: tuple[Evidence, ...]
    max_proposals: Annotated[int, Field(gt=0)]


class RefinementEngine(Protocol):
    async def refine(self, request: RefinementRequest) -> tuple[Candidate, ...]: ...


class EvaluationRequest(DomainModel):
    round_id: RoundId
    candidate: Candidate
    baseline_executions: tuple[ExecutionResult, ...]
    candidate_executions: tuple[ExecutionResult, ...]


class EvaluationEngine(Protocol):
    async def evaluate(self, request: EvaluationRequest) -> EvaluationResult: ...


class RoundProgressCommit(DomainModel):
    round: Round
    checkpoint: RoundCheckpoint
    event: RoundProgressEvent


class RunRepository(Protocol):
    async def get_round(self, id: RoundId) -> Round | None: ...

    async def save_round(self, round_obj: Round) -> None: ...

    async def commit_progress(
        self, *, round_obj: Round, checkpoint: RoundCheckpoint, event: RoundProgressEvent
    ) -> None: ...

    async def list_events(self, round_id: RoundId, after_sequence: int) -> tuple[RoundProgressEvent, ...]: ...


class SecretValue(DomainModel):
    value: str = Field(repr=False)


class SecretStore(Protocol):
    async def save(self, id: SecretId, secret: SecretValue) -> None: ...

    async def get(self, id: SecretId) -> SecretValue | None: ...

    async def rotate(self, id: SecretId, secret: SecretValue) -> None: ...

    async def delete(self, id: SecretId) -> None: ...


ArtifactKind = Literal["candidate", "diff", "report", "evidence"]


class ExportedArtifact(DomainModel):
    id: ExportId
    kind: ArtifactKind
    location: str
    hash: str


class _ArtifactExportContext(DomainModel):
    round: Round
    evidence: tuple[Evidence, ...]


class CandidateArtifactExportRequest(_ArtifactExportContext):
    kind: Literal["candidate"]
    candidate: Candidate
    evaluation: EvaluationResult


class ReportArtifactExportRequest(_ArtifactExportContext):
    kind: Literal["report"]
    decision: TerminalDecision


ArtifactExportRequest: TypeAlias = Annotated[
    CandidateArtifactExportRequest | ReportArtifactExportRequest,
    Field(discriminator="kind"),
]
_artifact_export_adapter: TypeAdapter[CandidateArtifactExportRequest | ReportArtifactExportRequest] = (
    TypeAdapter(ArtifactExportRequest)  # type: ignore[arg-type]
)


def parse_artifact_export_request(
    payload: object,
) -> CandidateArtifactExportRequest | ReportArtifactExportRequest:
    return _artifact_export_adapter.validate_python(payload)


class ArtifactExporter(Protocol):
    async def export(
        self, request: CandidateArtifactExportRequest | ReportArtifactExportRequest
    ) -> tuple[ExportedArtifact, ...]: ...


class EventPublisher(Protocol):
    async def publish(self, event: RoundProgressEvent) -> None: ...


__all__ = [
    "AgentCapabilities",
    "AgentHarnessRepository",
    "ArtifactExportRequest",
    "ArtifactExporter",
    "ArtifactKind",
    "BaselineExecutionRequest",
    "CandidateArtifactExportRequest",
    "CandidateExecutionRequest",
    "CandidateExecutor",
    "CandidateVersionExecutionRequest",
    "CaseRepository",
    "EvaluationEngine",
    "EvaluationRequest",
    "EventPublisher",
    "ExportedArtifact",
    "RefinementEngine",
    "RefinementRequest",
    "ReportArtifactExportRequest",
    "RoundProgressCommit",
    "RunRepository",
    "SecretStore",
    "SecretValue",
    "TracePage",
    "TraceQuery",
    "TraceRepository",
    "parse_artifact_export_request",
    "parse_candidate_execution_request",
]
