import { describe, expect, it } from "vitest";
import { normalizeObservations } from "./normalize.js";

describe("normalizeObservations", () => {
  it("deduplicates observations and marks missing parents, roots, and metrics", () => {
    const result = normalizeObservations("project-1", [
      { id: "root-1", traceId: "trace-1", parentObservationId: null, type: "SPAN", input: { prompt: "hello" }, output: "ok", startTime: "2026-10-31T00:00:00Z", endTime: "2026-10-31T00:00:01Z" },
      { id: "child-1", traceId: "trace-1", parentObservationId: "missing", type: "GENERATION", input: null, output: null, startTime: "2026-10-31T00:00:02Z", endTime: null },
      { id: "child-1", traceId: "trace-1", parentObservationId: "missing", type: "GENERATION", input: null, output: null, startTime: "2026-10-31T00:00:02Z", endTime: null },
      { id: "root-2", traceId: "trace-1", parentObservationId: null, type: "EVENT", input: null, output: null, startTime: "2026-10-31T00:00:03Z", endTime: "2026-10-31T00:00:03Z" },
    ]);

    expect(result.observations).toHaveLength(3);
    expect(result.logicalRootIds).toEqual(["root-1", "child-1", "root-2"]);
    expect(result.limitations).toEqual(expect.arrayContaining([
      "Observation child-1 references missing parent missing.",
      "Trace trace-1 has multiple logical roots.",
      "Observation root-1 has missing usage or cost metrics.",
    ]));
    expect(result.observations[0]).toEqual(expect.objectContaining({ projectId: "project-1", sourceApi: "observations-v2", latencyMs: 1000 }));
  });
});