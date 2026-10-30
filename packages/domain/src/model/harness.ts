import type { EvidenceId, HypothesisId } from "./evidence.js";
import type { AgentId, Brand, CaseId, DomainId, RoundId } from "./round.js";

export type HarnessSnapshotId = Brand<string, "HarnessSnapshotId">;
export type CandidateId = Brand<string, "CandidateId">;
export type ExecutionId = Brand<string, "ExecutionId">;

export interface HarnessSnapshot {
  readonly id: HarnessSnapshotId;
  readonly agentId: AgentId;
  readonly domainId: DomainId;
  readonly version: string;
  readonly components: Readonly<Record<string, string>>;
  readonly immutableConstraints: readonly string[];
  readonly createdAt: string;
}

export interface CandidateChange {
  readonly component: string;
  readonly before: string;
  readonly after: string;
  readonly rollback: string;
  readonly expectedEffect: string;
}

export interface Candidate {
  readonly id: CandidateId;
  readonly roundId: RoundId;
  readonly baselineId: HarnessSnapshotId;
  readonly snapshot: HarnessSnapshot;
  readonly changes: readonly CandidateChange[];
  readonly hypothesisIds: readonly HypothesisId[];
  readonly evidenceIds: readonly EvidenceId[];
}

export type ExecutionStatus =
  | "succeeded"
  | "agent_failed"
  | "integration_failed"
  | "trace_missing"
  | "timed_out"
  | "cancelled";

export interface ExecutionMetrics {
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cost: number | null;
  readonly latencyMs: number;
}

export interface ExecutionResult {
  readonly id: ExecutionId;
  readonly roundId: RoundId;
  readonly caseId: CaseId;
  readonly harnessSnapshotId: HarnessSnapshotId;
  readonly status: ExecutionStatus;
  readonly correlationId: string;
  readonly traceId: string | null;
  readonly output: string | null;
  readonly metrics: ExecutionMetrics;
  readonly limitations: readonly string[];
}
