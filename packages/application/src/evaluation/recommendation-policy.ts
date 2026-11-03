import type { EvaluatorDefinition, TerminalDecision } from "@harness-lab/domain";

interface PolicyInput {
  readonly evaluator: EvaluatorDefinition;
  readonly sampleSize: number;
  readonly aggregateScore: number;
  readonly regressionRate: number;
  readonly criticalFailure: boolean;
  readonly deterministicFailure: boolean;
  readonly humanRejected: boolean;
  readonly highVariability: boolean;
  readonly lifecycle?: Extract<TerminalDecision, "cancelled" | "integration_failed" | "stopped_by_limit" | "pending_validation">;
}

export function decideRecommendation(input: PolicyInput): { decision: TerminalDecision; rationale: string } {
  if (input.lifecycle) return { decision: input.lifecycle, rationale: `Evaluation ended as ${input.lifecycle}.` };
  if (input.sampleSize < input.evaluator.minimumSampleSize) return { decision: "validation_insufficient", rationale: "Reserved validation sample is below the minimum." };
  if (input.criticalFailure) return { decision: "rejected", rationale: "At least one critical violation blocks recommendation." };
  if (input.deterministicFailure || input.humanRejected) {
    return { decision: "rejected", rationale: "Deterministic or human review policy failed." };
  }
  if (input.highVariability) return { decision: "inconclusive", rationale: "Run variability exceeds the confidence policy." };
  if (input.regressionRate > input.evaluator.maximumRegressionRate) {
    return { decision: "rejected", rationale: "Per-case regression policy failed." };
  }
  if (input.aggregateScore >= input.evaluator.recommendationThreshold) return { decision: "recommended", rationale: "Candidate cleared all gates and the recommendation threshold." };
  return { decision: "inconclusive", rationale: "Measured improvement did not clear the recommendation threshold." };
}