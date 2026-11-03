import { describe, expect, it, vi } from "vitest";
import {
  assertLearningSources,
  partitionCases,
  runRefinementWithDiagnosisCases,
  sealPartitionManifest,
} from "./partition-cases.js";

const cases = [
  { id: "a1", sessionId: "session-a", similarityGroup: "billing", content: "invoice one" },
  { id: "a2", sessionId: "session-a", similarityGroup: "billing", content: "invoice two" },
  { id: "b1", sessionId: "session-b", similarityGroup: "refund", content: "refund one" },
  { id: "c1", sessionId: "session-c", similarityGroup: "refund", content: "refund two" },
  { id: "d1", sessionId: "session-d", similarityGroup: "shipping", content: "shipping one" },
  { id: "e1", sessionId: "session-e", similarityGroup: "account", content: "account one" },
];

describe("partitionCases", () => {
  it("keeps session and semantic groups together in a deterministic disjoint split", () => {
    const first = partitionCases(cases, { seed: "round-17", minimumReserved: 2, reservedRatio: 0.34 });
    const second = partitionCases(cases, { seed: "round-17", minimumReserved: 2, reservedRatio: 0.34 });

    expect(second).toEqual(first);
    expect(first.reservedIds.length).toBeGreaterThanOrEqual(2);
    expect(first.diagnosisIds.filter((id) => first.reservedIds.includes(id))).toEqual([]);
    expect(new Set([...first.diagnosisIds, ...first.reservedIds])).toEqual(new Set(cases.map(({ id }) => id)));
    expect(first.reservedIds.includes("a1")).toBe(first.reservedIds.includes("a2"));
    expect(first.reservedIds.includes("b1")).toBe(first.reservedIds.includes("c1"));
  });

  it("exposes only diagnosis cases to the refinement engine", async () => {
    const manifest = partitionCases(cases, { seed: "round-17", minimumReserved: 2, reservedRatio: 0.34 });
    const refinement = vi.fn(async (visibleCases: readonly { id: string; content: string }[]) => visibleCases.map(({ id }) => id));

    const visibleIds = await runRefinementWithDiagnosisCases(cases, manifest, refinement);

    expect(refinement).toHaveBeenCalledOnce();
    expect(visibleIds).toEqual(manifest.diagnosisIds);
    expect(JSON.stringify(refinement.mock.calls)).not.toContain("refund one");
    for (const reservedId of manifest.reservedIds) {
      expect(JSON.stringify(refinement.mock.calls)).not.toContain(reservedId);
      expect(JSON.stringify(refinement.mock.calls)).not.toContain(cases.find(({ id }) => id === reservedId)?.content);
    }
  });

  it("seals manifests before execution and rejects reserved learning sources", () => {
    const manifest = sealPartitionManifest(partitionCases(cases, {
      seed: "round-17",
      minimumReserved: 2,
      reservedRatio: 0.34,
    }));

    expect(Object.isFrozen(manifest)).toBe(true);
    expect(Object.isFrozen(manifest.diagnosisIds)).toBe(true);
    expect(() => assertLearningSources(manifest, [manifest.diagnosisIds[0]!])).not.toThrow();
    expect(() => assertLearningSources(manifest, [manifest.reservedIds[0]!])).toThrow("RESERVED_CASE_EVIDENCE_FORBIDDEN");
  });
});