import type { RoundId } from "@harness-lab/domain";
import { describe, expect, it } from "vitest";
import { diagnoseExecutions } from "./diagnose-executions.js";

const roundId = "round-diagnosis" as RoundId;
const traces = [
  { id: "rule", output: "forbidden", ruleViolation: "PII disclosed" },
  { id: "missing-tool", output: "guessed", expectedTools: ["search"], toolCalls: [] },
  { id: "unnecessary-tool", output: "ok", expectedTools: [], toolCalls: [{ name: "search", validParameters: true, failed: false }] },
  { id: "invalid-params", output: "failed", expectedTools: ["search"], toolCalls: [{ name: "search", validParameters: false, failed: false }] },
  { id: "unsupported", output: "claim without source", unsupportedAnswer: true },
  { id: "context", output: "missed context", contextFailure: true },
  { id: "repeat", output: "again again", repetitionCount: 4 },
  { id: "cost", output: "expensive", cost: 9, costLimit: 2 },
  { id: "latency", output: "slow", latencyMs: 9000, latencyLimitMs: 1000 },
  { id: "infra", output: null, infrastructureFailure: "authentication failed" },
  { id: "tool-failure", output: null, expectedTools: ["search"], toolCalls: [{ name: "search", validParameters: true, failed: true }] },
];

describe("diagnoseExecutions", () => {
  it("emits deterministic evidence-backed findings for the required taxonomy", () => {
    const result = diagnoseExecutions(roundId, traces);

    expect(result.findings.map(({ categoryCode }) => categoryCode)).toEqual([
      "RULE_VIOLATION",
      "MISSING_TOOL",
      "UNNECESSARY_TOOL",
      "INVALID_TOOL_PARAMETERS",
      "UNSUPPORTED_ANSWER",
      "CONTEXT_FAILURE",
      "REPETITION",
      "COST_LIMIT_EXCEEDED",
      "LATENCY_LIMIT_EXCEEDED",
      "INFRASTRUCTURE_FAILURE",
      "TOOL_FAILURE",
    ]);
    for (const finding of result.findings) {
      expect(finding.observedFact).not.toBe("");
      expect(finding.frequency).toBeGreaterThan(0);
      expect(finding.sampleSize).toBe(traces.length);
      expect(finding.impact).not.toBe("");
      expect(finding.confidence).toBeGreaterThan(0);
      expect(finding.evidenceIds.length).toBeGreaterThan(0);
      expect(finding.limitations.length).toBeGreaterThan(0);
    }
    for (const evidence of result.evidence) {
      expect(evidence.sourceUrl).toContain(evidence.traceId);
      expect(evidence.excerpt).not.toContain("authentication failed");
    }
    expect(result.hypotheses.every(({ explanation }) => explanation.startsWith("Hypothesis:"))).toBe(true);
  });

  it("does not propose harness changes for infrastructure or tool outages", () => {
    const result = diagnoseExecutions(roundId, traces);
    const blocked = new Set(["INFRASTRUCTURE_FAILURE", "TOOL_FAILURE"]);
    const blockedFindingIds = result.findings.filter(({ categoryCode }) => blocked.has(categoryCode)).map(({ id }) => id);

    expect(result.hypotheses.filter(({ findingId }) => blockedFindingIds.includes(findingId))).toEqual([]);
    expect(result.actionability.filter(({ findingId }) => blockedFindingIds.includes(findingId))).toEqual([
      expect.objectContaining({ proposedChange: false }),
      expect.objectContaining({ proposedChange: false }),
    ]);
  });
});