import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { Harness2Adapter } from "./adapter.js";
import { HARNESS2_COMMIT, HARNESS2_LICENSE, HARNESS2_SOURCE } from "./version.js";

const fixtureUrl = new URL("../../../../tests/characterization/fixtures/harness2-corpus.json", import.meta.url);

describe("pinned Harness2 behavior", () => {
  it("records an exact Apache-2.0 upstream revision", () => {
    expect(HARNESS2_SOURCE).toBe("https://github.com/google-research/harness2");
    expect(HARNESS2_COMMIT).toMatch(/^[0-9a-f]{40}$/);
    expect(HARNESS2_LICENSE).toBe("Apache-2.0");
  });

  it("normalizes deterministic propose-probe-compose behavior", async () => {
    const corpus = JSON.parse(await readFile(fixtureUrl, "utf8"));
    const adapter = new Harness2Adapter();
    const first = adapter.characterize(corpus);
    const second = adapter.characterize(corpus);

    expect(second).toEqual(first);
    expect(first.proposalOrder).toEqual(["inv1", "dom1", "inv2", "dom2"]);
    expect(first.probes).toEqual([
      { proposalId: "inv1", sequence: 1 },
      { proposalId: "dom1", sequence: 2 },
      { proposalId: "inv2", sequence: 3 },
      { proposalId: "dom2", sequence: 4 },
    ]);
    expect(first.consumedEvidenceIds).toEqual(["ev-1", "ev-2"]);
    expect(first.compositions).toHaveLength(2);
    expect(first.stop).toEqual({ reason: "budget_exhausted", budget: 2 });
    expect(first.lessons.map((lesson) => lesson.scope)).toEqual([
      "trace-cohort-01:system-prompt",
      "trace-cohort-01:tool-guidance",
    ]);
  });
});