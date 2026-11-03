import type { CandidateExecutionRequest } from "@harness-lab/domain";
import { describe, expect, it, vi } from "vitest";
import { AgentPlatformClient } from "./client.js";
import { AgentPlatformCandidateExecutor } from "./candidate-executor.js";

const request: CandidateExecutionRequest = {
  kind: "candidate", roundId: "round-1" as never, caseId: "case-1" as never,
  harnessVersionId: "version-1" as never, candidateId: "candidate-1" as never,
  attempt: 1, idempotencyKey: "round-1:case-1:candidate-1",
};

describe("AgentPlatformCandidateExecutor", () => {
  it("returns a correlated synchronous execution without publishing", async () => {
    const fakeFetch: typeof fetch = vi.fn(async (_input, init) => {
      const body = JSON.parse(String(init?.body));
      expect(body.publish).toBeUndefined();
      expect(new Headers(init?.headers).get("idempotency-key")).toBe(request.idempotencyKey);
      return Response.json({ status: "completed", executionId: "exec-1", traceId: "trace-1", output: "ok", metrics: { latencyMs: 12, inputTokens: 2, outputTokens: 3, cost: 0.01 } });
    });
    const result = await new AgentPlatformCandidateExecutor(new AgentPlatformClient({ baseUrl: "https://platform.example", token: "token", fetch: fakeFetch })).execute(request);
    expect(result).toEqual(expect.objectContaining({ status: "succeeded", traceId: "trace-1", correlationId: request.idempotencyKey }));
  });

  it("polls asynchronous jobs and marks a missing trace explicitly", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      calls += 1;
      if ((input as URL).pathname.endsWith("/executions")) return Response.json({ status: "accepted", jobId: "job-1" }, { status: 202 });
      return Response.json({ status: "completed", executionId: "exec-1", traceId: null, output: "ok", metrics: { latencyMs: 5 } });
    });
    const result = await new AgentPlatformCandidateExecutor(
      new AgentPlatformClient({ baseUrl: "https://platform.example", token: "token", fetch: fakeFetch }),
      { delay: async () => undefined, maxPolls: 2 },
    ).execute(request);
    expect(calls).toBe(2);
    expect(result.status).toBe("trace_missing");
  });

  it.each([
    ["failed", "agent_failed"],
    ["cancelled", "cancelled"],
  ] as const)("maps %s jobs to %s", async (remoteStatus, expected) => {
    const fakeFetch: typeof fetch = vi.fn(async () => Response.json({ status: remoteStatus, executionId: "exec-1", traceId: null, output: null, metrics: { latencyMs: 1 } }));
    const result = await new AgentPlatformCandidateExecutor(new AgentPlatformClient({ baseUrl: "https://platform.example", token: "token", fetch: fakeFetch })).execute(request);
    expect(result.status).toBe(expected);
  });

  it("returns timeout after bounded job polling", async () => {
    const fakeFetch: typeof fetch = vi.fn(async (input) => (input as URL).pathname.endsWith("/executions")
      ? Response.json({ status: "accepted", jobId: "job-1" }, { status: 202 })
      : Response.json({ status: "running" }));
    const result = await new AgentPlatformCandidateExecutor(
      new AgentPlatformClient({ baseUrl: "https://platform.example", token: "token", fetch: fakeFetch }),
      { delay: async () => undefined, maxPolls: 2 },
    ).execute(request);
    expect(result.status).toBe("timed_out");
  });

  it("maps version creation or execution failures without leaking details", async () => {
    const fakeFetch: typeof fetch = vi.fn(async () => new Response(JSON.stringify({ message: "secret remote detail" }), { status: 500 }));
    const result = await new AgentPlatformCandidateExecutor(new AgentPlatformClient({ baseUrl: "https://platform.example", token: "token", fetch: fakeFetch })).execute(request);
    expect(result.status).toBe("integration_failed");
    expect(result.limitations.join(" ")).not.toContain("secret remote detail");
  });
});