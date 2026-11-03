import type { CaseId, DomainId, AgentId } from "./round.js";
import type { PartitionCase } from "./partition.js";

export type CaseSource = "manual" | "json" | "csv" | "historical" | "synthetic";

export interface CaseRecord extends PartitionCase {
  readonly id: CaseId;
  readonly agentId: AgentId;
  readonly domainId: DomainId;
  readonly source: CaseSource;
  readonly sourceReference?: string;
  readonly syntheticLabel?: "SYNTHETIC";
  readonly createdAt: string;
}