import { join } from "node:path";
import { createRedactor } from "../security/redactor.js";
import { writeArtifact, type WrittenArtifact } from "./write-artifact.js";

interface CandidateExportInput {
  readonly dataDir: string;
  readonly agentId: string;
  readonly roundId: string;
  readonly sourceArtifact: Readonly<Record<string, unknown>>;
  readonly changes: readonly {
    component: string;
    before: string;
    after: string;
    expectedEffect: string;
  }[];
  readonly sourceVersions: Readonly<Record<string, string>>;
  readonly secrets: readonly string[];
}

export async function exportCandidate(input: CandidateExportInput): Promise<readonly WrittenArtifact[]> {
  const redact = createRedactor(input.secrets);
  const directory = join(input.dataDir, "exports", input.agentId, input.roundId);
  const candidate = redact({
    ...input.sourceArtifact,
    _harnessLab: { sourceVersions: input.sourceVersions, roundId: input.roundId },
  });
  const technicalDiff = redact({ changes: input.changes, sourceVersions: input.sourceVersions });
  const plainDiff = input.changes
    .map(({ component, expectedEffect }) => `${component}: ${expectedEffect}`)
    .join("\n");
  return Promise.all([
    writeArtifact(directory, "candidate.json", `${JSON.stringify(candidate, null, 2)}\n`, "application/json"),
    writeArtifact(directory, "diff.technical.json", `${JSON.stringify(technicalDiff, null, 2)}\n`, "application/json"),
    writeArtifact(directory, "diff.txt", `${String(redact(plainDiff))}\n`, "text/plain"),
  ]);
}