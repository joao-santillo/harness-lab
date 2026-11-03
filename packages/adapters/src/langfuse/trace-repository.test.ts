import type { AgentId, RoundId } from "@harness-lab/domain";
import { describe, expect, it, vi } from "vitest";
import { LangfuseClient } from "./client.js";
import { LangfuseTraceRepository } from "./trace-repository.js";

describe("LangfuseTraceRepository", () => {
  it("collects v2 pages with time bounds, resume cursor, deduplication, and retry-after", async () => {
    let attempts = 0;
    const delays: number[] = [];
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      const url = input as URL;
      attempts += 1;
      expect(url.searchParams.get("fromStartTime")).toBe("2026-10-01T00:00:00Z");
      expect(url.searchParams.get("toStartTime")).toBe("2026-10-31T00:00:00Z");
      if (attempts === 1) return new Response("{}", { status: 429, headers: { "retry-after": "1" } });
      const page = Number(url.searchParams.get("page") ?? "1");
      return Response.json({
        data: [{ id: `obs-${page}`, traceId: `trace-${page}`, parentObservationId: null, type: "SPAN", input: "in", output: "out", startTime: "2026-10-01T00:00:00Z", endTime: "2026-10-01T00:00:01Z" }],
        meta: { page, limit: 1, totalItems: 2, totalPages: 2 },
      });
    });
    const repository = new LangfuseTraceRepository({
      client: new LangfuseClient({ baseUrl: "https://langfuse.example", publicKey: "pk", secretKey: "sk", fetch: fakeFetch }),
      projectId: "project-1",
      observationsApi: "v2",
      delay: async (milliseconds) => { delays.push(milliseconds); },
    });
    const page = await repository.collect({
      roundId: "round-1" as RoundId,
      agentId: "agent-1" as AgentId,
      from: "2026-10-01T00:00:00Z",
      to: "2026-10-31T00:00:00Z",
      cursor: "1",
      limit: 2,
    });

    expect(delays).toEqual([1000]);
    expect(page.evidence).toHaveLength(2);
    expect(page.nextCursor).toBeNull();
  });

  it("uses the deprecated trace endpoint only for negotiated legacy capability", async () => {
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      expect((input as URL).pathname).toBe("/api/public/traces");
      return Response.json({ data: [{ id: "trace-1", input: "in", output: "out", timestamp: "2026-10-01T00:00:00Z" }], meta: { page: 1, totalPages: 1 } });
    });
    const repository = new LangfuseTraceRepository({
      client: new LangfuseClient({ baseUrl: "https://langfuse.example", publicKey: "pk", secretKey: "sk", fetch: fakeFetch }),
      projectId: "project-1",
      observationsApi: "legacy",
    });
    const page = await repository.collect({ roundId: "round-1" as RoundId, agentId: "agent-1" as AgentId, from: "from", to: "to", cursor: null, limit: 1 });
    expect(page.evidence).toHaveLength(1);
  });
});