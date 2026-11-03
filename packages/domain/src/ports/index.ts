import type { EvaluationResult } from "../model/evaluation.js";
import type { CaseRecord } from "../model/case.js";
import type { Evidence, Finding, Hypothesis } from "../model/evidence.js";
import type {
  Candidate,
  CandidateId,
  ExecutionResult,
  HarnessSnapshot,
  HarnessSnapshotId,
} from "../model/harness.js";
import type {
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
} from "../model/round.js";

export interface TraceQuery {
  readonly roundId: RoundId;
  readonly agentId: AgentId;
  readonly from: string;
  readonly to: string;
  readonly cursor: string | null;
  readonly limit: number;
}

export interface TracePage {
  readonly evidence: readonly Evidence[];
  readonly nextCursor: string | null;
}

export interface TraceRepository {
  collect(query: TraceQuery): Promise<TracePage>;
}

export interface CaseRepository {
  saveMany(cases: readonly CaseRecord[]): Promise<number>;
  listByScope(agentId: AgentId, domainId: DomainId): Promise<readonly CaseRecord[]>;
}

export interface AgentCapabilities {
  readonly editableComponents: readonly string[];
  readonly supportsSeed: boolean;
  readonly supportsToolReplay: boolean;
}

export interface AgentHarnessRepository {
  getCapabilities(agentId: AgentId): Promise<AgentCapabilities>;
  getSnapshot(id: HarnessSnapshotId): Promise<HarnessSnapshot | null>;
  saveSnapshot(snapshot: HarnessSnapshot): Promise<void>;
}

interface ExecutionRequestContext {
  readonly roundId: RoundId;
  readonly caseId: CaseId;
  readonly harnessVersionId: HarnessSnapshotId;
  /** Positive integer. */
  readonly attempt: number;
  readonly idempotencyKey: string;
}

export interface BaselineExecutionRequest extends ExecutionRequestContext {
  readonly kind: "baseline";
}

export interface CandidateVersionExecutionRequest extends ExecutionRequestContext {
  readonly kind: "candidate";
  readonly candidateId: CandidateId;
}

export type CandidateExecutionRequest =
  | BaselineExecutionRequest
  | CandidateVersionExecutionRequest;

export interface CandidateExecutor {
  execute(request: CandidateExecutionRequest): Promise<ExecutionResult>;
}

export interface RefinementRequest {
  readonly roundId: RoundId;
  readonly baseline: HarnessSnapshot;
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  readonly evidence: readonly Evidence[];
}

export interface RefinementEngine {
  refine(request: RefinementRequest): Promise<readonly Candidate[]>;
}

export interface EvaluationRequest {
  readonly roundId: RoundId;
  readonly candidate: Candidate;
  readonly baselineExecutions: readonly ExecutionResult[];
  readonly candidateExecutions: readonly ExecutionResult[];
}

export interface EvaluationEngine {
  evaluate(request: EvaluationRequest): Promise<EvaluationResult>;
}

export interface RoundProgressCommit {
  readonly round: Round;
  readonly checkpoint: RoundCheckpoint;
  readonly event: RoundProgressEvent;
}

export interface RunRepository {
  getRound(id: RoundId): Promise<Round | null>;
  saveRound(round: Round): Promise<void>;
  commitProgress(input: RoundProgressCommit): Promise<void>;
  listEvents(roundId: RoundId, afterSequence: number): Promise<readonly RoundProgressEvent[]>;
}

export interface SecretValue {
  readonly value: string;
}

export interface SecretStore {
  save(id: SecretId, secret: SecretValue): Promise<void>;
  get(id: SecretId): Promise<SecretValue | null>;
  rotate(id: SecretId, secret: SecretValue): Promise<void>;
  delete(id: SecretId): Promise<void>;
}

export type ArtifactKind = "candidate" | "diff" | "report" | "evidence";

export interface ExportedArtifact {
  readonly id: ExportId;
  readonly kind: ArtifactKind;
  readonly location: string;
  readonly hash: string;
}

interface ArtifactExportContext {
  readonly round: Round;
  readonly evidence: readonly Evidence[];
}

export interface CandidateArtifactExportRequest extends ArtifactExportContext {
  readonly kind: "candidate";
  readonly candidate: Candidate;
  readonly evaluation: EvaluationResult;
}

export interface ReportArtifactExportRequest extends ArtifactExportContext {
  readonly kind: "report";
  readonly decision: TerminalDecision;
}

export type ArtifactExportRequest =
  | CandidateArtifactExportRequest
  | ReportArtifactExportRequest;

export interface ArtifactExporter {
  export(request: ArtifactExportRequest): Promise<readonly ExportedArtifact[]>;
}

export interface EventPublisher {
  publish(event: RoundProgressEvent): Promise<void>;
}
