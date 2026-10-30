import type { Brand, CaseId, RoundId } from "./round.js";

export type EvidenceId = Brand<string, "EvidenceId">;
export type FindingId = Brand<string, "FindingId">;
export type HypothesisId = Brand<string, "HypothesisId">;

export type Evidence =
  | {
      readonly kind: "trace";
      readonly id: EvidenceId;
      readonly roundId: RoundId;
      readonly caseId: CaseId;
      readonly traceId: string;
      readonly observationId: string | null;
      readonly excerpt: string;
      readonly sourceUrl: string | null;
    }
  | {
      readonly kind: "execution";
      readonly id: EvidenceId;
      readonly roundId: RoundId;
      readonly caseId: CaseId;
      readonly executionId: string;
      readonly excerpt: string;
    }
  | {
      readonly kind: "missing_data";
      readonly id: EvidenceId;
      readonly roundId: RoundId;
      readonly caseId: CaseId;
      readonly field: string;
      readonly sourceReference: string;
    };

export type FindingSeverity = "low" | "medium" | "high" | "critical";

export interface Finding {
  readonly id: FindingId;
  readonly roundId: RoundId;
  readonly categoryCode: string;
  readonly observedFact: string;
  readonly frequency: number;
  readonly sampleSize: number;
  readonly severity: FindingSeverity;
  readonly impact: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly confidence: number;
  readonly limitations: readonly string[];
}

export interface Hypothesis {
  readonly id: HypothesisId;
  readonly findingId: FindingId;
  readonly explanation: string;
  readonly evidenceIds: readonly EvidenceId[];
  readonly expectedEffect: string;
}
