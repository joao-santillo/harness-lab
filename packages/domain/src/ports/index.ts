import type { EvaluationResult } from "../model/evaluation.js";
import type { Evidence, Finding, Hypothesis } from "../model/evidence.js";
import type {
  Candidate,
  ExecutionResult,
  HarnessSnapshot,
  HarnessSnapshotId,
} from "../model/harness.js";
import type {
  AgentId,
  CaseId,
  ExportId,
  Round,
  RoundCheckpoint,
  RoundId,
  RoundProgressEvent,
  SecretId,
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

export interface CandidateExecutionRequest {
  readonly roundId: RoundId;
  readonly caseId: CaseId;
  readonly snapshot: HarnessSnapshot;
  readonly idempotencyKey: string;
}

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

export interface RunRepository {
  getRound(id: RoundId): Promise<Round | null>;
  saveRound(round: Round): Promise<void>;
  saveCheckpoint(checkpoint: RoundCheckpoint): Promise<void>;
  appendEvent(event: RoundProgressEvent): Promise<void>;
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

export interface ArtifactExportRequest {
  readonly round: Round;
  readonly candidate: Candidate;
  readonly evaluation: EvaluationResult;
  readonly evidence: readonly Evidence[];
}

export interface ArtifactExporter {
  export(request: ArtifactExportRequest): Promise<readonly ExportedArtifact[]>;
}

export interface EventPublisher {
  publish(event: RoundProgressEvent): Promise<void>;
}
