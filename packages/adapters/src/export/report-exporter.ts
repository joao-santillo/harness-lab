import { join } from "node:path";
import type { TerminalDecision } from "@harness-lab/domain";
import { createRedactor } from "../security/redactor.js";
import { writeArtifact, type WrittenArtifact } from "./write-artifact.js";

type ReportLocale = "pt-BR" | "en" | "es";

interface ReportExportInput {
  readonly dataDir: string;
  readonly agentId: string;
  readonly roundId: string;
  readonly locale: ReportLocale;
  readonly decision: TerminalDecision;
  readonly confidence: number;
  readonly sampleSize: number;
  readonly constraints: readonly string[];
  readonly regressions: readonly string[];
  readonly costs: Readonly<Record<string, number>>;
  readonly limitations: readonly string[];
  readonly evidenceChain: readonly Readonly<Record<string, string>>[];
  readonly sourceVersions: Readonly<Record<string, string>>;
  readonly secrets: readonly string[];
}

const summaries: Record<ReportLocale, string> = {
  "pt-BR": "Relatório de avaliação auditável",
  en: "Auditable evaluation report",
  es: "Informe de evaluación auditable",
};

export async function exportReport(input: ReportExportInput): Promise<WrittenArtifact> {
  const redact = createRedactor(input.secrets);
  const report = redact({
    locale: input.locale,
    summary: summaries[input.locale],
    decision: input.decision,
    confidence: input.confidence,
    sampleSize: input.sampleSize,
    constraints: input.constraints,
    regressions: input.regressions,
    costs: input.costs,
    limitations: input.limitations,
    evidenceChain: input.evidenceChain,
    sourceVersions: input.sourceVersions,
  });
  const directory = join(input.dataDir, "exports", input.agentId, input.roundId);
  return writeArtifact(directory, `report.${input.locale}.json`, `${JSON.stringify(report, null, 2)}\n`, "application/json");
}