import type {
  AgentCapabilities, AgentHarnessRepository, AgentId, CandidateExecutor, CaseId, DomainId,
  EvaluatorDefinition, ExecutionId, ExecutionResult, HarnessSnapshot, HarnessSnapshotId,
  PartitionCase, Round, RoundId,
} from "@harness-lab/domain";
import { describe, expect, it, vi } from "vitest";
import { createRoundStages, InMemoryRoundArtifactStore, terminalEventForDecision } from "./create-round-stages.js";

describe("terminalEventForDecision", () => {
  it.each([
    ["recommended", "recommendation_completed"],
    ["rejected", "rejection_completed"],
    ["inconclusive", "evaluation_inconclusive"],
    ["pending_validation", "validation_pending"],
    ["validation_insufficient", "validation_insufficient"],
    ["stopped_by_limit", "limit_reached"],
    ["cancelled", "cancel_requested"],
    ["integration_failed", "integration_failed"],
  ] as const)("maps %s to %s", (decision, event) => {
    expect(terminalEventForDecision(decision)).toBe(event);
  });
});

const round: Round = {
  id: "round-1" as RoundId,
  agentId: "agent-1" as AgentId,
  domainId: "domain-1" as DomainId,
  state: "setup",
  objective: "Reduce unsupported answers",
  createdAt: "2026-10-31T10:00:00.000Z",
  updatedAt: "2026-10-31T10:00:00.000Z",
};
const baseline: HarnessSnapshot = {
  id: "baseline-1" as HarnessSnapshotId,
  agentId: round.agentId,
  domainId: round.domainId,
  version: "7",
  components: { parameters: "strict=false" },
  immutableConstraints: ["Never disclose secrets"],
  createdAt: round.createdAt,
};
const cases: PartitionCase[] = [
  { id: "case-1", sessionId: "s1", similarityGroup: "g1", content: "question one" },
  { id: "case-2", sessionId: "s2", similarityGroup: "g2", content: "question two" },
  { id: "case-3", sessionId: "s3", similarityGroup: "g3", content: "question three" },
  { id: "case-4", sessionId: "s4", similarityGroup: "g4", content: "question four" },
];

function execution(request: Parameters<CandidateExecutor["execute"]>[0]): ExecutionResult {
  return {
    id: `${request.kind}-${request.caseId}` as ExecutionId,
    roundId: request.roundId,
    caseId: request.caseId,
    harnessSnapshotId: request.harnessVersionId,
    status: "succeeded",
    correlationId: request.idempotencyKey,
    traceId: `trace-${request.caseId}`,
    output: request.kind === "candidate" ? "supported answer" : "unsupported answer",
    metrics: { inputTokens: 5, outputTokens: 5, cost: request.kind === "candidate" ? 0.01 : 0.02, latencyMs: 10 },
    limitations: [],
  };
}

describe("createRoundStages", () => {
  it("runs a complete isolated round and exports the reserved-case evaluation", async () => {
    const artifacts = new InMemoryRoundArtifactStore();
    const executor: CandidateExecutor = { execute: vi.fn(async (request) => execution(request)) };
    const harnesses: AgentHarnessRepository & { fetchSnapshot(agentId: AgentId, domainId: DomainId): Promise<HarnessSnapshot> } = {
      getCapabilities: async (): Promise<AgentCapabilities> => ({ editableComponents: ["parameters"], supportsSeed: true, supportsToolReplay: false }),
      fetchSnapshot: async () => baseline,
      getSnapshot: async () => baseline,
      saveSnapshot: async () => undefined,
    };
    const exportRound = vi.fn(async () => undefined);
    const evaluator: EvaluatorDefinition = {
      id: "deterministic-v1", version: "1", minimumSampleSize: 1,
      recommendationThreshold: 0.5, maximumRegressionRate: 0,
    };
    const stages = createRoundStages({
      artifacts,
      cases: { collect: async () => cases },
      traces: { collect: async (_round, diagnosisCases) => diagnosisCases.map(({ id }) => ({ id, output: "unsupported answer", unsupportedAnswer: true })) },
      harnesses,
      proposals: { create: async (_round, diagnosis, snapshot) => [{
        id: "proposal-1",
        findingId: diagnosis.findings[0]!.id,
        hypothesisId: diagnosis.hypotheses[0]!.id,
        evidenceIds: diagnosis.evidence.map(({ id }) => id),
        component: "parameters",
        after: "strict=true",
        expectedEffect: "Reduce unsupported answers",
      }] },
      executor,
      evaluator,
      exportRound,
      options: { partitionSeed: "seed-1", minimumReserved: 1, reservedRatio: 0.25, maxProposals: 1 },
    });

    await stages.collect.run(round);
    await stages.diagnose.run({ ...round, state: "collecting" });
    await stages.refine.run({ ...round, state: "diagnosing" });
    await stages.execute.run({ ...round, state: "refining" });
    await stages.evaluate.run({ ...round, state: "executing" });
    await stages.export.run({ ...round, state: "evaluating" });

    const session = await artifacts.get(round.id);
    expect(session).not.toBeNull();
    if (session === null) throw new Error("test session missing");
    expect(session.partition.reservedIds).toHaveLength(1);
    expect(session.diagnosis.evidence.every(({ caseId }) => session.partition.diagnosisIds.includes(caseId))).toBe(true);
    expect(session.evaluation?.sampleSize).toBe(1);
    expect(session.evaluation?.decision).toBe("recommended");
    expect(exportRound).toHaveBeenCalledWith(
      expect.objectContaining({ id: round.id, state: "evaluating" }),
      expect.objectContaining({ evaluation: expect.objectContaining({ decision: "recommended" }) }),
    );
    const reserved = new Set(session.partition.reservedIds);
    const refinementCalls = vi.mocked(executor.execute).mock.calls.slice(0, session.partition.diagnosisIds.length * 2);
    expect(refinementCalls.every(([request]) => !reserved.has(request.caseId))).toBe(true);
    const evaluationCalls = vi.mocked(executor.execute).mock.calls.slice(session.partition.diagnosisIds.length * 2);
    expect(evaluationCalls.every(([request]) => reserved.has(request.caseId))).toBe(true);
  });
});