import type {
  AgentId, CandidateExecutor, CaseId, DomainId, EvidenceId, FindingId, HarnessSnapshot,
  HarnessSnapshotId, HypothesisId, RoundId,
} from "@harness-lab/domain";
import { describe, expect, it, vi } from "vitest";
import { runRefinement, type RefinementProposal } from "./run-refinement.js";

const roundId = "round-refine" as RoundId;
const baseline: HarnessSnapshot = {
  id: "baseline-1" as HarnessSnapshotId,
  agentId: "agent-1" as AgentId,
  domainId: "domain-1" as DomainId,
  version: "1",
  components: { "system-prompt": "Be useful.", "tool-guidance": "Search when needed." },
  immutableConstraints: ["Never disclose secrets."],
  createdAt: "2026-10-31T00:00:00.000Z",
};
const proposals: RefinementProposal[] = [
  {
    id: "proposal-1",
    findingId: "finding-1" as FindingId,
    hypothesisId: "hypothesis-1" as HypothesisId,
    evidenceIds: ["evidence-1" as EvidenceId],
    component: "system-prompt",
    after: "Be useful. Cite evidence.",
    expectedEffect: "Reduce unsupported answers.",
  },
  {
    id: "proposal-2",
    findingId: "finding-2" as FindingId,
    hypothesisId: "hypothesis-2" as HypothesisId,
    evidenceIds: ["evidence-2" as EvidenceId],
    component: "tool-guidance",
    after: "Search when needed. Cite the retrieved source.",
    expectedEffect: "Reduce missing tool use.",
  },
];

function executor() {
  const execute = vi.fn<CandidateExecutor["execute"]>(async (request) => ({
    id: `${request.kind}-${request.caseId}` as never,
    roundId: request.roundId,
    caseId: request.caseId,
    harnessSnapshotId: request.harnessVersionId,
    status: "succeeded",
    correlationId: request.idempotencyKey,
    traceId: `trace-${request.caseId}`,
    output: "ok",
    metrics: { inputTokens: 1, outputTokens: 1, cost: 0.01, latencyMs: 10 },
    limitations: [],
  }));
  return { execute };
}

describe("runRefinement", () => {
  it("probes linked proposals under equivalent conditions and composes compatible changes", async () => {
    const candidateExecutor = executor();
    const result = await runRefinement({
      roundId,
      baseline,
      proposals,
      diagnosisCaseIds: ["case-1" as CaseId],
      supportedComponents: ["system-prompt", "tool-guidance"],
      maxProposals: 2,
      executor: candidateExecutor,
    });

    expect(candidateExecutor.execute).toHaveBeenCalledTimes(4);
    expect(candidateExecutor.execute.mock.calls.map(([request]) => [request.kind, request.caseId, request.attempt])).toEqual([
      ["baseline", "case-1", 1], ["candidate", "case-1", 1],
      ["baseline", "case-1", 1], ["candidate", "case-1", 1],
    ]);
    expect(result.candidates).toHaveLength(2);
    expect(result.composed?.changes.map(({ component }) => component)).toEqual(["system-prompt", "tool-guidance"]);
    expect(result.candidates[0]?.evidenceIds).toEqual(["evidence-1"]);
    expect(result.lessons.map(({ outcome }) => outcome)).toEqual(["adopted", "adopted"]);
    expect(result.lessons.every(({ scope }) => scope === "agent-1:domain-1")).toBe(true);
  });

  it("rejects unsupported, immutable, colliding, and over-budget changes", async () => {
    const candidateExecutor = executor();
    const invalid: RefinementProposal[] = [
      { ...proposals[0]!, id: "immutable", after: "Never disclose secrets." },
      { ...proposals[0]!, id: "unsupported", component: "unknown" },
      { ...proposals[0]!, id: "collision", after: "Different edit." },
    ];
    const result = await runRefinement({
      roundId,
      baseline,
      proposals: [...proposals, ...invalid],
      diagnosisCaseIds: ["case-1" as CaseId],
      supportedComponents: ["system-prompt", "tool-guidance"],
      maxProposals: 2,
      executor: candidateExecutor,
    });

    expect(candidateExecutor.execute).toHaveBeenCalledTimes(4);
    expect(result.rejected.map(({ reason }) => reason)).toEqual([
      "IMMUTABLE_CONSTRAINT", "UNSUPPORTED_COMPONENT", "PROPOSAL_LIMIT_REACHED",
    ]);
    expect(result.stopReason).toBe("proposal_limit_reached");
  });
});