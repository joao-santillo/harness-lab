import { z } from "zod";
import { HARNESS2_COMMIT } from "./version.js";

const corpusSchema = z.object({
  taskId: z.string().min(1),
  budget: z.number().int().positive(),
  baseline: z.record(z.string(), z.string()),
  evidence: z.array(z.object({ id: z.string().min(1), summary: z.string() })),
  proposals: z.array(z.object({
    id: z.string().min(1),
    dimension: z.enum(["invariant", "domain"]),
    component: z.string().min(1),
    after: z.string(),
    evidenceIds: z.array(z.string().min(1)),
  })),
});

export interface Harness2Probe {
  readonly proposalId: string;
  readonly sequence: number;
}

export interface Harness2Composition {
  readonly id: string;
  readonly components: Readonly<Record<string, string>>;
  readonly proposalIds: readonly string[];
}

export interface Harness2Lesson {
  readonly scope: string;
  readonly proposalIds: readonly string[];
  readonly evidenceIds: readonly string[];
}

export interface Harness2Characterization {
  readonly upstreamCommit: string;
  readonly proposalOrder: readonly string[];
  readonly probes: readonly Harness2Probe[];
  readonly consumedEvidenceIds: readonly string[];
  readonly compositions: readonly Harness2Composition[];
  readonly stop: { readonly reason: "budget_exhausted"; readonly budget: number };
  readonly lessons: readonly Harness2Lesson[];
}

export class Harness2Adapter {
  characterize(input: unknown): Harness2Characterization {
    const corpus = corpusSchema.parse(input);
    const evidenceIds = new Set(corpus.evidence.map((item) => item.id));
    const proposals = corpus.proposals.slice(0, corpus.budget * 2);

    for (const proposal of proposals) {
      const missing = proposal.evidenceIds.filter((id) => !evidenceIds.has(id));
      if (missing.length > 0) throw new Error(`Unknown evidence: ${missing.join(", ")}`);
    }

    const compositions = Array.from({ length: corpus.budget }, (_, index) => {
      const selected = proposals.filter((proposal) =>
        proposal.dimension === "invariant" ? proposal.id === `inv${index + 1}` : proposal.id === `dom${index + 1}`,
      );
      const components = { ...corpus.baseline };
      for (const proposal of selected) components[proposal.component] = proposal.after;
      return {
        id: `agg${index + 1}`,
        components,
        proposalIds: selected.map((proposal) => proposal.id),
      };
    });

    const lessons = Array.from(new Set(proposals.map((proposal) => proposal.component)))
      .sort()
      .map((component) => {
        const relevant = proposals.filter((proposal) => proposal.component === component);
        return {
          scope: `${corpus.taskId}:${component}`,
          proposalIds: relevant.map((proposal) => proposal.id),
          evidenceIds: Array.from(new Set(relevant.flatMap((proposal) => proposal.evidenceIds))).sort(),
        };
      });

    return {
      upstreamCommit: HARNESS2_COMMIT,
      proposalOrder: proposals.map((proposal) => proposal.id),
      probes: proposals.map((proposal, index) => ({ proposalId: proposal.id, sequence: index + 1 })),
      consumedEvidenceIds: Array.from(new Set(proposals.flatMap((proposal) => proposal.evidenceIds))).sort(),
      compositions,
      stop: { reason: "budget_exhausted", budget: corpus.budget },
      lessons,
    };
  }
}