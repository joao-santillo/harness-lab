import type { Brand, CaseId, RoundId, TerminalDecision } from "./round.js";
import type { CandidateId, ExecutionId } from "./harness.js";

export type EvaluationId = Brand<string, "EvaluationId">;

export interface CaseEvaluation {
  readonly caseId: CaseId;
  readonly baselineExecutionId: ExecutionId;
  readonly candidateExecutionId: ExecutionId;
  readonly passed: boolean;
  readonly regression: boolean;
  readonly scoreChange: number | null;
  readonly criticalViolations: readonly string[];
}

export interface EvaluationResult {
  readonly id: EvaluationId;
  readonly roundId: RoundId;
  readonly candidateId: CandidateId;
  readonly decision: TerminalDecision;
  readonly sampleSize: number;
  readonly confidence: number;
  readonly aggregateScoreChange: number | null;
  readonly costChange: number | null;
  readonly latencyChange: number | null;
  readonly cases: readonly CaseEvaluation[];
  readonly limitations: readonly string[];
  readonly rationale: string;
}

export interface VersionedEvaluationResult extends EvaluationResult {
  readonly evaluatorVersion: string;
}
