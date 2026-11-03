import { createHash } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { exportCandidate } from "./candidate-exporter.js";
import { exportReport } from "./report-exporter.js";

describe("audit exporters", () => {
  it("round-trips a redacted candidate while preserving unknown source fields", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "harness-export-"));
    const artifacts = await exportCandidate({
      dataDir,
      agentId: "agent-1",
      roundId: "round-1",
      sourceArtifact: { version: "1", components: { prompt: "Use top-secret" }, extensionField: { enabled: true }, apiKey: "top-secret" },
      changes: [{ component: "prompt", before: "Old", after: "Use top-secret", expectedEffect: "Improve grounding" }],
      sourceVersions: { agentPlatform: "42", harness2: "abc" },
      secrets: ["top-secret"],
    });

    expect(artifacts.map(({ mediaType }) => mediaType)).toEqual(["application/json", "application/json", "text/plain"]);
    for (const artifact of artifacts) {
      const content = await readFile(artifact.path);
      expect(createHash("sha256").update(content).digest("hex")).toBe(artifact.hash);
      expect(content.toString()).not.toContain("top-secret");
    }
    const candidate = JSON.parse(await readFile(artifacts[0]!.path, "utf8"));
    expect(candidate.extensionField).toEqual({ enabled: true });
    expect(candidate.apiKey).toBe("[REDACTED]");
    expect(candidate.components.prompt).toBe("Use [REDACTED]");
    expect(candidate._harnessLab.sourceVersions).toEqual({ agentPlatform: "42", harness2: "abc" });
  });

  it.each(["pt-BR", "en", "es"] as const)("exports a localized %s audit report without promotion capability", async (locale) => {
    const dataDir = await mkdtemp(join(tmpdir(), "harness-report-"));
    const artifact = await exportReport({
      dataDir,
      agentId: "agent-1",
      roundId: `round-${locale}`,
      locale,
      decision: "inconclusive",
      confidence: 0.55,
      sampleSize: 2,
      constraints: ["No production publication"],
      regressions: [],
      costs: { baseline: 1, candidate: 0.8 },
      limitations: ["Small sample"],
      evidenceChain: [{ findingId: "finding-1", hypothesisId: "hypothesis-1", proposalId: "proposal-1" }],
      sourceVersions: { evaluator: "1.0.0" },
      secrets: [],
    });
    const report = JSON.parse(await readFile(artifact.path, "utf8"));

    expect(report.locale).toBe(locale);
    expect(report.decision).toBe("inconclusive");
    expect(report).not.toHaveProperty("publish");
    expect(report).not.toHaveProperty("promote");
    expect(report.summary).not.toBe("");
  });
});