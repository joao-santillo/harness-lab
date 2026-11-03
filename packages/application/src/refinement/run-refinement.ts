import type {
  Candidate, CandidateExecutor, CandidateId, CaseId, EvidenceId, FindingId, HarnessSnapshot,
  HarnessSnapshotId, HypothesisId, RoundId,
} from "@harness-lab/domain";
import { validateProposal, type ProposalRejectionReason } from "./change-policy.js";

export interface RefinementProposal {
  readonly id: string;
  readonly findingId: FindingId;
  readonly hypothesisId: HypothesisId;
  readonly evidenceIds: readonly EvidenceId[];
  readonly component: string;
  readonly after: string;
  readonly expectedEffect: string;
}

export interface RefinementLesson {
  readonly scope: string;
  readonly proposalId: string;
  readonly outcome: "adopted" | "rejected";
  readonly evidenceIds: readonly EvidenceId[];
  readonly reason: string;
}

interface RunRefinementInput {
  readonly roundId: RoundId;
  readonly baseline: HarnessSnapshot;
  readonly proposals: readonly RefinementProposal[];
  readonly diagnosisCaseIds: readonly CaseId[];
  readonly supportedComponents: readonly string[];
  readonly maxProposals: number;
  readonly executor: CandidateExecutor;
}

export interface RefinementRunResult {
  readonly candidates: readonly Candidate[];
  readonly composed: Candidate | null;
  readonly rejected: readonly { proposalId: string; reason: ProposalRejectionReason | "PROPOSAL_LIMIT_REACHED" }[];
  readonly lessons: readonly RefinementLesson[];
  readonly stopReason: "completed" | "proposal_limit_reached";
}

function buildCandidate(input: RunRefinementInput, proposal: RefinementProposal, sequence: number): Candidate {
  const snapshotId = `candidate-snapshot-${sequence}` as HarnessSnapshotId;
  return {
    id: `candidate-${sequence}` as CandidateId,
    roundId: input.roundId,
    baselineId: input.baseline.id,
    snapshot: {
      ...input.baseline,
      id: snapshotId,
      version: `${input.baseline.version}+candidate.${sequence}`,
      components: { ...input.baseline.components, [proposal.component]: proposal.after },
    },
    changes: [{
      component: proposal.component,
      before: input.baseline.components[proposal.component]!,
      after: proposal.after,
      rollback: input.baseline.components[proposal.component]!,
      expectedEffect: proposal.expectedEffect,
    }],
    hypothesisIds: [proposal.hypothesisId],
    evidenceIds: proposal.evidenceIds,
  };
}

export async function runRefinement(input: RunRefinementInput): Promise<RefinementRunResult> {
  const accepted: Array<{ proposal: RefinementProposal; candidate: Candidate }> = [];
  const rejected: RefinementRunResult["rejected"][number][] = [];
  let limitReached = false;

  for (const proposal of input.proposals) {
    const invalid = validateProposal(input.baseline, proposal, input.supportedComponents);
    if (invalid) {
      rejected.push({ proposalId: proposal.id, reason: invalid });
      continue;
    }
    if (accepted.length >= input.maxProposals) {
      rejected.push({ proposalId: proposal.id, reason: "PROPOSAL_LIMIT_REACHED" });
      limitReached = true;
      continue;
    }
    const candidate = buildCandidate(input, proposal, accepted.length + 1);
    accepted.push({ proposal, candidate });
    for (const caseId of input.diagnosisCaseIds) {
      await input.executor.execute({
        kind: "baseline", roundId: input.roundId, caseId, harnessVersionId: input.baseline.id,
        attempt: 1, idempotencyKey: `${input.roundId}:${proposal.id}:${caseId}:baseline`,
      });
      await input.executor.execute({
        kind: "candidate", roundId: input.roundId, caseId, harnessVersionId: candidate.snapshot.id,
        candidateId: candidate.id, attempt: 1, idempotencyKey: `${input.roundId}:${proposal.id}:${caseId}:candidate`,
      });
    }
  }

  const components = new Set<string>();
  const composable = accepted.filter(({ proposal }) => {
    if (components.has(proposal.component)) return false;
    components.add(proposal.component);
    return true;
  });
  const composed = composable.length < 2 ? null : {
    id: "candidate-composed" as CandidateId,
    roundId: input.roundId,
    baselineId: input.baseline.id,
    snapshot: {
      ...input.baseline,
      id: "candidate-snapshot-composed" as HarnessSnapshotId,
      version: `${input.baseline.version}+composed`,
      components: Object.fromEntries([
        ...Object.entries(input.baseline.components),
        ...composable.map(({ proposal }) => [proposal.component, proposal.after]),
      ]),
    },
    changes: composable.flatMap(({ candidate }) => candidate.changes),
    hypothesisIds: composable.map(({ proposal }) => proposal.hypothesisId),
    evidenceIds: Array.from(new Set(composable.flatMap(({ proposal }) => proposal.evidenceIds))),
  };
  const scope = `${input.baseline.agentId}:${input.baseline.domainId}`;
  const lessons: RefinementLesson[] = [
    ...accepted.map(({ proposal }) => ({
      scope, proposalId: proposal.id, outcome: "adopted" as const,
      evidenceIds: proposal.evidenceIds, reason: "Probe completed under equivalent conditions.",
    })),
    ...rejected.map(({ proposalId, reason }) => ({
      scope, proposalId, outcome: "rejected" as const, evidenceIds: [], reason,
    })),
  ];
  return {
    candidates: accepted.map(({ candidate }) => candidate),
    composed,
    rejected,
    lessons,
    stopReason: limitReached ? "proposal_limit_reached" : "completed",
  };
}