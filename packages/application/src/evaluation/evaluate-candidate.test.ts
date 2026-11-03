import type { CandidateId, EvaluationId, RoundId } from "@harness-lab/domain";
import { describe, expect, it } from "vitest";
import { evaluateCandidate, type CandidateEvaluationInput } from "./evaluate-candidate.js";

const base: CandidateEvaluationInput = {
  evaluationId: "evaluation-1" as EvaluationId,
  roundId: "round-1" as RoundId,
  candidateId: "candidate-1" as CandidateId,
  evaluator: { id: "evaluator-default", version: "1.0.0", minimumSampleSize: 2, recommendationThreshold: 0.1, maximumRegressionRate: 0 },
  cases: [
    { caseId: "case-1" as never, baselineExecutionId: "base-1" as never, candidateExecutionId: "candidate-1" as never, deterministicPassed: true, completionChange: 0.2, costChange: -0.1, tokenChange: -0.1, latencyChange: -0.1, judgeScore: 0.8, humanApproved: true, criticalViolations: [] },
    { caseId: "case-2" as never, baselineExecutionId: "base-2" as never, candidateExecutionId: "candidate-2" as never, deterministicPassed: true, completionChange: 0.3, costChange: -0.2, tokenChange: -0.2, latencyChange: -0.2, judgeScore: 0.9, humanApproved: true, criticalViolations: [] },
  ],
};

describe("evaluateCandidate", () => {
  it("combines deterministic, measured, calibrated judge, and human signals", () => {
    const result = evaluateCandidate(base);

    expect(result.decision).toBe("recommended");
    expect(result.sampleSize).toBe(2);
    expect(result.aggregateScoreChange).toBeGreaterThan(0.1);
    expect(result.costChange).toBeLessThan(0);
    expect(result.latencyChange).toBeLessThan(0);
    expect(result.evaluatorVersion).toBe("1.0.0");
    expect(result.cases.every(({ passed, regression }) => passed && !regression)).toBe(true);
  });

  it("blocks recommendation on any critical failure despite a high aggregate", () => {
    const result = evaluateCandidate({
      ...base,
      cases: [base.cases[0]!, { ...base.cases[1]!, criticalViolations: ["SECRET_DISCLOSURE"] }],
    });
    expect(result.decision).toBe("rejected");
    expect(result.rationale).toContain("critical");
  });

  it.each([
    ["cancelled", { lifecycle: "cancelled" }],
    ["integration_failed", { lifecycle: "integration_failed" }],
    ["stopped_by_limit", { lifecycle: "stopped_by_limit" }],
    ["pending_validation", { lifecycle: "pending_validation" }],
    ["validation_insufficient", { cases: [base.cases[0]!] }],
    ["inconclusive", { cases: base.cases.map((item) => ({ ...item, completionChange: 0 })) }],
    ["rejected", { cases: base.cases.map((item) => ({ ...item, deterministicPassed: false })) }],
  ] as const)("returns %s for its terminal policy condition", (decision, override) => {
    expect(evaluateCandidate({ ...base, ...override } as CandidateEvaluationInput).decision).toBe(decision);
  });

  it("marks variable mixed outcomes inconclusive", () => {
    const result = evaluateCandidate({
      ...base,
      cases: [
        { ...base.cases[0]!, completionChange: 1 },
        { ...base.cases[1]!, completionChange: -1 },
      ],
    });
    expect(result.decision).toBe("inconclusive");
    expect(result.limitations).toContain("High run variability.");
  });
});