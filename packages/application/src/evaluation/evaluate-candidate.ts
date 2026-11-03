import type {
  CandidateId, CaseId, EvaluationId, EvaluatorDefinition, ExecutionId, RoundId,
  TerminalDecision, VersionedEvaluationResult,
} from "@harness-lab/domain";
import { decideRecommendation } from "./recommendation-policy.js";

export interface CandidateCaseSignal {
  readonly caseId: CaseId;
  readonly baselineExecutionId: ExecutionId;
  readonly candidateExecutionId: ExecutionId;
  readonly deterministicPassed: boolean;
  readonly completionChange: number;
  readonly costChange: number;
  readonly tokenChange: number;
  readonly latencyChange: number;
  readonly judgeScore?: number;
  readonly humanApproved?: boolean;
  readonly criticalViolations: readonly string[];
}

export interface CandidateEvaluationInput {
  readonly evaluationId: EvaluationId;
  readonly roundId: RoundId;
  readonly candidateId: CandidateId;
  readonly evaluator: EvaluatorDefinition;
  readonly cases: readonly CandidateCaseSignal[];
  readonly lifecycle?: Extract<TerminalDecision, "cancelled" | "integration_failed" | "stopped_by_limit" | "pending_validation">;
}

function average(values: readonly number[]): number {
  return values.length === 0 ? 0 : values.reduce((total, value) => total + value, 0) / values.length;
}

export function evaluateCandidate(input: CandidateEvaluationInput): VersionedEvaluationResult {
  const completionChanges = input.cases.map(({ completionChange }) => completionChange);
  const meanCompletion = average(completionChanges);
  const highVariability = completionChanges.length > 1 && Math.max(...completionChanges) - Math.min(...completionChanges) > 1;
  const cases = input.cases.map((signal) => {
    const regression = signal.completionChange < 0 || !signal.deterministicPassed || signal.humanApproved === false || signal.criticalViolations.length > 0;
    return {
      caseId: signal.caseId,
      baselineExecutionId: signal.baselineExecutionId,
      candidateExecutionId: signal.candidateExecutionId,
      passed: !regression,
      regression,
      scoreChange: signal.completionChange,
      criticalViolations: signal.criticalViolations,
    };
  });
  const judgeScores = input.cases.flatMap(({ judgeScore }) => judgeScore === undefined ? [] : [judgeScore]);
  const aggregateScore = meanCompletion + average(judgeScores) * 0.1;
  const policy = decideRecommendation({
    evaluator: input.evaluator,
    sampleSize: input.cases.length,
    aggregateScore,
    regressionRate: cases.filter(({ regression }) => regression).length / Math.max(cases.length, 1),
    criticalFailure: cases.some(({ criticalViolations }) => criticalViolations.length > 0),
    deterministicFailure: input.cases.some(({ deterministicPassed }) => !deterministicPassed),
    humanRejected: input.cases.some(({ humanApproved }) => humanApproved === false),
    highVariability,
    ...(input.lifecycle === undefined ? {} : { lifecycle: input.lifecycle }),
  });
  const limitations = [
    ...(judgeScores.length < input.cases.length ? ["Judge signal unavailable for one or more cases."] : []),
    ...(input.cases.some(({ humanApproved }) => humanApproved === undefined) ? ["Human review is incomplete."] : []),
    ...(highVariability ? ["High run variability."] : []),
  ];
  return {
    id: input.evaluationId,
    roundId: input.roundId,
    candidateId: input.candidateId,
    decision: policy.decision,
    sampleSize: input.cases.length,
    confidence: Math.max(0, Math.min(1, input.cases.length / input.evaluator.minimumSampleSize)) * (limitations.length === 0 ? 1 : 0.75),
    aggregateScoreChange: aggregateScore,
    costChange: average(input.cases.map(({ costChange }) => costChange)),
    latencyChange: average(input.cases.map(({ latencyChange }) => latencyChange)),
    cases,
    limitations,
    rationale: policy.rationale,
    evaluatorVersion: input.evaluator.version,
  };
}