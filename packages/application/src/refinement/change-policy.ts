import type { HarnessSnapshot } from "@harness-lab/domain";
import type { RefinementProposal } from "./run-refinement.js";

export type ProposalRejectionReason = "IMMUTABLE_CONSTRAINT" | "UNSUPPORTED_COMPONENT" | "COMPONENT_COLLISION";

export function validateProposal(
  baseline: HarnessSnapshot,
  proposal: RefinementProposal,
  supportedComponents: readonly string[],
): ProposalRejectionReason | null {
  if (!supportedComponents.includes(proposal.component) || baseline.components[proposal.component] === undefined) {
    return "UNSUPPORTED_COMPONENT";
  }
  if (baseline.immutableConstraints.some((constraint) => proposal.after.includes(constraint))) {
    return "IMMUTABLE_CONSTRAINT";
  }
  return null;
}