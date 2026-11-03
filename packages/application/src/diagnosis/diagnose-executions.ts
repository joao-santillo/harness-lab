import type { Evidence, EvidenceId, Finding, FindingId, Hypothesis, HypothesisId, RoundId } from "@harness-lab/domain";
import { DIAGNOSIS_CATEGORIES, NON_HARNESS_CATEGORIES, type DiagnosisCategory } from "./taxonomy.js";

export interface DiagnosticToolCall {
  readonly name: string;
  readonly validParameters: boolean;
  readonly failed: boolean;
}

export interface DiagnosticTrace {
  readonly id: string;
  readonly output: string | null;
  readonly ruleViolation?: string;
  readonly expectedTools?: readonly string[];
  readonly toolCalls?: readonly DiagnosticToolCall[];
  readonly unsupportedAnswer?: boolean;
  readonly contextFailure?: boolean;
  readonly repetitionCount?: number;
  readonly cost?: number;
  readonly costLimit?: number;
  readonly latencyMs?: number;
  readonly latencyLimitMs?: number;
  readonly infrastructureFailure?: string;
}

export interface DiagnosisResult {
  readonly evidence: readonly Extract<Evidence, { kind: "trace" }>[];
  readonly findings: readonly Finding[];
  readonly hypotheses: readonly Hypothesis[];
  readonly actionability: readonly { findingId: FindingId; proposedChange: boolean; reason: string }[];
}

const detectors: Readonly<Record<DiagnosisCategory, (trace: DiagnosticTrace) => boolean>> = {
  RULE_VIOLATION: (trace) => Boolean(trace.ruleViolation),
  MISSING_TOOL: (trace) => Boolean(trace.expectedTools?.some((tool) => !trace.toolCalls?.some(({ name }) => name === tool))),
  UNNECESSARY_TOOL: (trace) => Boolean(trace.toolCalls?.length && trace.expectedTools?.length === 0),
  INVALID_TOOL_PARAMETERS: (trace) => Boolean(trace.toolCalls?.some(({ validParameters }) => !validParameters)),
  UNSUPPORTED_ANSWER: (trace) => trace.unsupportedAnswer === true,
  CONTEXT_FAILURE: (trace) => trace.contextFailure === true,
  REPETITION: (trace) => (trace.repetitionCount ?? 0) > 2,
  COST_LIMIT_EXCEEDED: (trace) => trace.cost !== undefined && trace.costLimit !== undefined && trace.cost > trace.costLimit,
  LATENCY_LIMIT_EXCEEDED: (trace) => trace.latencyMs !== undefined && trace.latencyLimitMs !== undefined && trace.latencyMs > trace.latencyLimitMs,
  INFRASTRUCTURE_FAILURE: (trace) => Boolean(trace.infrastructureFailure),
  TOOL_FAILURE: (trace) => Boolean(trace.toolCalls?.some(({ failed }) => failed)),
};

function sanitizeExcerpt(trace: DiagnosticTrace): string {
  const excerpt = trace.output?.slice(0, 240) || "No agent output was available.";
  return excerpt.replace(/(authorization|token|secret|password|api[_-]?key)\s*[:=]\s*\S+/gi, "$1=[REDACTED]");
}

export function diagnoseExecutions(roundId: RoundId, traces: readonly DiagnosticTrace[]): DiagnosisResult {
  const evidence: Extract<Evidence, { kind: "trace" }>[] = [];
  const findings: Finding[] = [];
  const hypotheses: Hypothesis[] = [];
  const actionability: DiagnosisResult["actionability"][number][] = [];

  for (const category of DIAGNOSIS_CATEGORIES) {
    const matched = traces.filter(detectors[category]);
    if (matched.length === 0) continue;
    const categoryEvidence = matched.map((trace, index) => {
      const item: Extract<Evidence, { kind: "trace" }> = {
        kind: "trace",
        id: `${category.toLowerCase()}-${index + 1}` as EvidenceId,
        roundId,
        caseId: trace.id as never,
        traceId: trace.id,
        observationId: null,
        excerpt: sanitizeExcerpt(trace),
        sourceUrl: `trace://${trace.id}`,
      };
      evidence.push(item);
      return item;
    });
    const findingId = `finding-${category.toLowerCase()}` as FindingId;
    findings.push({
      id: findingId,
      roundId,
      categoryCode: category,
      observedFact: `${matched.length} of ${traces.length} traces matched ${category}.`,
      frequency: matched.length,
      sampleSize: traces.length,
      severity: category === "RULE_VIOLATION" ? "critical" : NON_HARNESS_CATEGORIES.has(category) ? "high" : "medium",
      impact: `Observed ${category.toLowerCase().replaceAll("_", " ")} in the analyzed cohort.`,
      evidenceIds: categoryEvidence.map(({ id }) => id),
      confidence: 1,
      limitations: ["Deterministic detector; causal attribution requires a controlled probe."],
    });
    const proposedChange = !NON_HARNESS_CATEGORIES.has(category);
    actionability.push({
      findingId,
      proposedChange,
      reason: proposedChange ? "Eligible for a bounded harness hypothesis." : "Repair the integration before changing the harness.",
    });
    if (proposedChange) {
      hypotheses.push({
        id: `hypothesis-${category.toLowerCase()}` as HypothesisId,
        findingId,
        explanation: `Hypothesis: a bounded harness change may reduce ${category.toLowerCase().replaceAll("_", " ")}.`,
        evidenceIds: categoryEvidence.map(({ id }) => id),
        expectedEffect: `Reduce the frequency of ${category}.`,
      });
    }
  }
  return { evidence, findings, hypotheses, actionability };
}