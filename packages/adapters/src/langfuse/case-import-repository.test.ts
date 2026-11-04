import { describe, expect, it, vi } from "vitest";
import { LangfuseClient } from "./client.js";
import { LangfuseCaseImportRepository } from "./case-import-repository.js";

const fromStartTime = "2026-10-01T00:00:00.000Z";
const toStartTime = "2026-10-02T00:00:00.000Z";

function makeRepository(fetch: typeof globalThis.fetch, options: { observationsApi?: "v2" | "legacy"; delay?: (milliseconds: number) => Promise<void> } = {}) {
  return new LangfuseCaseImportRepository({
    client: new LangfuseClient({ baseUrl: "https://langfuse.example", publicKey: "pk", secretKey: "sk-secret", fetch }),
    observationsApi: options.observationsApi ?? "v2",
    sourceReferencePrefix: "langfuse:connection-1:",
    ...(options.delay ? { delay: options.delay } : {}),
  });
}

describe("LangfuseCaseImportRepository", () => {
  it("reads bounded v2 observations by cursor, prefers root input, and selects one candidate per trace", async () => {
    const requests: URL[] = [];
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      const url = input as URL;
      requests.push(url);
      expect(url.pathname).toBe("/api/public/v2/observations");
      expect(url.searchParams.get("fromStartTime")).toBe(fromStartTime);
      expect(url.searchParams.get("toStartTime")).toBe(toStartTime);
      expect(url.searchParams.has("isRootObservation")).toBe(false);
      expect(url.searchParams.get("fields")).toBe("core,basic,io,trace_context");
      expect(url.searchParams.get("limit")).toBe("2");
      expect(url.searchParams.has("filter")).toBe(false);

      if (requests.length === 1) {
        expect(url.searchParams.has("cursor")).toBe(false);
        return Response.json({
          data: [
            { id: "obs-child", traceId: "trace-a", isRootObservation: false, parentObservationId: "parent", startTime: "2026-10-01T08:00:00.000Z", input: "not the root" },
            { id: "obs-later", traceId: "trace-a", isRootObservation: true, startTime: "2026-10-01T10:00:00.000Z", input: "later", sessionId: "session-a", traceName: "flow-a" },
            { id: "obs-earlier", traceId: "trace-a", isRootObservation: true, startTime: "2026-10-01T09:00:00.000Z", input: { prompt: "earlier" }, sessionId: "session-a", traceName: "flow-a", output: "must not escape" },
            { id: "obs-invalid", traceId: "trace-invalid", isRootObservation: true, startTime: "2026-10-01T08:00:00.000Z", input: "   " },
          ],
          meta: { cursor: "cursor-2" },
        });
      }

      expect(url.searchParams.get("cursor")).toBe("cursor-2");
      return Response.json({
        data: [{ id: "obs-b", traceId: "trace-b", isRootObservation: true, startTime: "2026-10-01T11:00:00.000Z", input: ["question", 2], name: "root-b" }],
        meta: { cursor: "cursor-3" },
      });
    });
    const repository = makeRepository(fakeFetch);

    const result = await repository.importCases({ fromStartTime, toStartTime, limit: 2 });

    expect(requests).toHaveLength(2);
    expect(result).toEqual({
      candidates: [
        { traceId: "trace-a", sessionId: "session-a", similarityGroup: "flow-a", content: '{"prompt":"earlier"}', startTime: "2026-10-01T09:00:00.000Z" },
        { traceId: "trace-b", sessionId: "trace-b", similarityGroup: "root-b", content: '["question",2]', startTime: "2026-10-01T11:00:00.000Z" },
      ],
      skipped: 1,
      limitations: [],
    });
    expect(Object.keys(result.candidates[0] ?? {}).sort()).toEqual(["content", "sessionId", "similarityGroup", "startTime", "traceId"]);
  });

  it("uses the earliest child input when a trace root has no usable input", async () => {
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      const url = input as URL;
      expect(url.searchParams.has("isRootObservation")).toBe(false);
      return Response.json({
        data: [
          { id: "root", traceId: "trace-child-input", isRootObservation: true, startTime: "2026-10-01T10:00:00.000Z", input: null, sessionId: "session-1", traceName: "flow-1" },
          { id: "child-later", traceId: "trace-child-input", isRootObservation: false, parentObservationId: "root", startTime: "2026-10-01T09:00:00.000Z", input: "first child input", sessionId: "session-1", traceName: "flow-1" },
          { id: "child-earlier", traceId: "trace-child-input", isRootObservation: false, parentObservationId: "root", startTime: "2026-10-01T08:00:00.000Z", input: "earliest child input", sessionId: "session-1", traceName: "flow-1" },
        ],
        meta: {},
      });
    });

    const result = await makeRepository(fakeFetch).importCases({ fromStartTime, toStartTime, limit: 1 });

    expect(result.candidates).toEqual([
      { traceId: "trace-child-input", sessionId: "session-1", similarityGroup: "flow-1", content: "earliest child input", startTime: "2026-10-01T08:00:00.000Z" },
    ]);
    expect(result.skipped).toBe(0);
  });

  it.each([
    ["traceName", "support-flow", "filter", JSON.stringify([
      { type: "datetime", column: "startTime", operator: ">=", value: fromStartTime },
      { type: "datetime", column: "startTime", operator: "<", value: toStartTime },
      { type: "string", column: "traceName", operator: "=", value: "support-flow" },
    ])],
    ["tags", "agent-support", "filter", JSON.stringify([
      { type: "datetime", column: "startTime", operator: ">=", value: fromStartTime },
      { type: "datetime", column: "startTime", operator: "<", value: toStartTime },
      { type: "arrayOptions", column: "tags", operator: "any of", value: ["agent-support"] },
    ])],
    ["environment", "production", "environment", "production"],
    ["userId", "user-42", "userId", "user-42"],
    ["sessionId", "session-42", "sessionId", "session-42"],
  ] as const)("filters v2 observations by %s", async (field, value, parameter, expected) => {
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      const url = input as URL;
      expect(url.searchParams.get(parameter)).toBe(expected);
      return Response.json({ data: [], meta: {} });
    });

    await makeRepository(fakeFetch).importCases({
      fromStartTime,
      toStartTime,
      limit: 3,
      filter: { field, value },
    });

    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["traceName", "support-flow", "name"],
    ["tags", "agent-support", "tags"],
    ["environment", "production", "environment"],
    ["userId", "user-42", "userId"],
    ["sessionId", "session-42", "sessionId"],
  ] as const)("filters legacy traces by %s", async (field, value, parameter) => {
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      const url = input as URL;
      expect(url.searchParams.get(parameter)).toBe(value);
      return Response.json({ data: [], meta: { page: 1, totalPages: 1 } });
    });

    await makeRepository(fakeFetch, { observationsApi: "legacy" }).importCases({
      fromStartTime,
      toStartTime,
      limit: 3,
      filter: { field, value },
    });

    expect(fakeFetch).toHaveBeenCalledTimes(1);
  });

  it("retries a 429 exactly once, respects Retry-After up to the configured cap, and sanitizes exhaustion", async () => {
    const delays: number[] = [];
    let attempts = 0;
    const fakeFetch: typeof fetch = vi.fn(async () => {
      attempts += 1;
      return attempts === 1
        ? new Response("sensitive response body", { status: 429, headers: { "retry-after": "45" } })
        : Response.json({ data: [], meta: {} });
    });
    const repository = makeRepository(fakeFetch, { delay: async (milliseconds) => { delays.push(milliseconds); } });

    await repository.importCases({ fromStartTime, toStartTime, limit: 1 });
    expect(attempts).toBe(2);
    expect(delays).toEqual([30_000]);

    attempts = 0;
    const persistentRateLimit = makeRepository(vi.fn(async () => {
      attempts += 1;
      return new Response("secret payload", { status: 429, headers: { "retry-after": "0" } });
    }), { delay: async () => undefined });
    await expect(persistentRateLimit.importCases({ fromStartTime, toStartTime, limit: 1 }))
      .rejects.toMatchObject({ message: "LANGFUSE_RATE_LIMITED" });
    expect(attempts).toBe(2);
  });

  it("waits for Retry-After by default", async () => {
    vi.useFakeTimers();
    try {
      let attempts = 0;
      const fakeFetch: typeof fetch = vi.fn(async () => {
        attempts += 1;
        return attempts === 1
          ? new Response("", { status: 429, headers: { "retry-after": "2" } })
          : Response.json({ data: [], meta: {} });
      });
      const importing = makeRepository(fakeFetch).importCases({ fromStartTime, toStartTime, limit: 1 });

      await vi.advanceTimersByTimeAsync(0);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(attempts).toBe(1);
      await vi.advanceTimersByTimeAsync(1);
      await importing;

      expect(attempts).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("requires an explicit root marker or null parent and counts empty input as skipped", async () => {
    const fakeResponse = Response.json({
      data: [
        { id: "missing-root-marker", traceId: "not-a-root", startTime: fromStartTime, input: "must not import" },
        { id: "null-parent-root", traceId: "explicit-null-parent", parentObservationId: null, startTime: fromStartTime, input: "plain string input" },
        { id: "empty-input", traceId: "empty-input", isRootObservation: true, startTime: fromStartTime, input: null },
      ],
      meta: {},
    });
    const fakeFetch: typeof fetch = vi.fn(async () => fakeResponse);

    const result = await makeRepository(fakeFetch).importCases({ fromStartTime, toStartTime, limit: 3 });

    expect(result.candidates).toEqual([
      { traceId: "explicit-null-parent", sessionId: "explicit-null-parent", similarityGroup: "langfuse", content: "plain string input", startTime: fromStartTime },
    ]);
    expect(result.candidates[0]?.content).toBe("plain string input");
    expect(result.skipped).toBe(1);
  });

  it("stops when the cursor is absent or repeats and counts unrepresentable roots without truncating", async () => {
    const calls: string[] = [];
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      const url = input as URL;
      const cursor = url.searchParams.get("cursor") ?? "first";
      calls.push(cursor);
      if (calls.length === 1) {
        return Response.json({
          data: [
            { id: "bad-input", traceId: "bad-input", isRootObservation: true, startTime: fromStartTime },
            { id: "too-long", traceId: "too-long", isRootObservation: true, startTime: fromStartTime, input: "x".repeat(20_001) },
            { id: "too-long-session", traceId: "ok-session", isRootObservation: true, startTime: fromStartTime, sessionId: "s".repeat(201), traceName: "g".repeat(201), name: "fallback-name", input: "usable" },
            { id: "too-long-source", traceId: "t".repeat(490), isRootObservation: true, startTime: fromStartTime, input: "usable" },
          ],
          meta: { cursor: "same-cursor" },
        });
      }
      return Response.json({ data: [], meta: { cursor: "same-cursor" } });
    });
    const repository = makeRepository(fakeFetch);

    const result = await repository.importCases({ fromStartTime, toStartTime, limit: 10 });

    expect(calls).toEqual(["first", "same-cursor"]);
    expect(result.candidates).toEqual([
      { traceId: "ok-session", sessionId: "ok-session", similarityGroup: "fallback-name", content: "usable", startTime: fromStartTime },
    ]);
    expect(result.skipped).toBe(3);
    expect(result.limitations).toContain("Langfuse returned a repeated cursor; pagination stopped.");
  });

  it("stops after a v2 page when the response has no next cursor", async () => {
    const fakeFetch: typeof fetch = vi.fn(async () => Response.json({
      data: [{ id: "root", traceId: "trace-root", isRootObservation: true, startTime: fromStartTime, input: "question" }],
      meta: {},
    }));

    const result = await makeRepository(fakeFetch).importCases({ fromStartTime, toStartTime, limit: 3 });

    expect(fakeFetch).toHaveBeenCalledTimes(1);
    expect(result.candidates).toHaveLength(1);
    expect(result.limitations).toEqual([]);
  });

  it("uses legacy traces only when explicitly selected and reports deprecation", async () => {
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      const url = input as URL;
      expect(url.pathname).toBe("/api/public/traces");
      expect(url.searchParams.get("fromTimestamp")).toBe(fromStartTime);
      expect(url.searchParams.get("toTimestamp")).toBe(toStartTime);
      expect(url.searchParams.get("fromStartTime")).toBeNull();
      return Response.json({
        data: [{ id: "legacy-trace", input: { prompt: "hello" }, timestamp: fromStartTime, sessionId: "legacy-session", name: "legacy-name", output: "private" }],
        meta: { page: 1, totalPages: 1 },
      });
    });

    const result = await makeRepository(fakeFetch, { observationsApi: "legacy" })
      .importCases({ fromStartTime, toStartTime, limit: 4 });

    expect(result.candidates).toEqual([
      { traceId: "legacy-trace", sessionId: "legacy-session", similarityGroup: "legacy-name", content: '{"prompt":"hello"}', startTime: fromStartTime },
    ]);
    expect(result.limitations).toContain("Langfuse legacy trace endpoint is deprecated.");
  });

  it("paginates legacy traces within the requested bounds and does not probe v2", async () => {
    const requests: URL[] = [];
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      const url = input as URL;
      requests.push(url);
      expect(url.pathname).toBe("/api/public/traces");
      expect(url.searchParams.get("fromTimestamp")).toBe(fromStartTime);
      expect(url.searchParams.get("toTimestamp")).toBe(toStartTime);
      return Response.json({
        data: [{ id: `legacy-${url.searchParams.get("page")}`, input: "question", timestamp: fromStartTime }],
        meta: { page: Number(url.searchParams.get("page")), totalPages: 2 },
      });
    });

    const result = await makeRepository(fakeFetch, { observationsApi: "legacy" })
      .importCases({ fromStartTime, toStartTime, limit: 2 });

    expect(requests.map((url) => url.searchParams.get("page"))).toEqual(["1", "2"]);
    expect(result.candidates.map(({ traceId }) => traceId)).toEqual(["legacy-1", "legacy-2"]);
    expect(result.limitations).toEqual(["Langfuse legacy trace endpoint is deprecated."]);
  });

  it("fails with a sanitized error when v2 cursors continue past the global page limit", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = vi.fn(async () => {
      calls += 1;
      return Response.json({
        data: [{ id: `obs-${calls}`, traceId: `trace-${calls}`, isRootObservation: true, startTime: fromStartTime }],
        meta: calls < 120 ? { cursor: `cursor-${calls}` } : {},
      });
    });

    await expect(makeRepository(fakeFetch).importCases({ fromStartTime, toStartTime, limit: 40 }))
      .rejects.toMatchObject({ message: "LANGFUSE_CASE_IMPORT_LIMIT_EXCEEDED" });

    expect(calls).toBe(100);
  });

  it("fails with a sanitized error when legacy reports more pages than the global page limit", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      calls += 1;
      const page = Number((input as URL).searchParams.get("page"));
      return Response.json({
        data: [{ id: `trace-${page}`, timestamp: fromStartTime }],
        meta: { page, totalPages: 500 },
      });
    });

    await expect(makeRepository(fakeFetch, { observationsApi: "legacy" })
      .importCases({ fromStartTime, toStartTime, limit: 40 }))
      .rejects.toMatchObject({ message: "LANGFUSE_CASE_IMPORT_LIMIT_EXCEEDED" });

    expect(calls).toBe(100);
  });

  it("fails when v2 observations reach the global observation limit before candidates are complete", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = vi.fn(async () => {
      calls += 1;
      return Response.json({
        data: Array.from({ length: 40 }, (_, index) => ({
          id: `obs-${calls}-${index}`,
          traceId: `trace-${calls}-${index}`,
          isRootObservation: true,
          startTime: fromStartTime,
        })),
        meta: calls < 30 ? { cursor: `cursor-${calls}` } : {},
      });
    });

    await expect(makeRepository(fakeFetch).importCases({ fromStartTime, toStartTime, limit: 40 }))
      .rejects.toMatchObject({ message: "LANGFUSE_CASE_IMPORT_LIMIT_EXCEEDED" });

    expect(calls).toBe(25);
  });

  it.each(["v2", "legacy"] as const)("rejects a truncated %s page even when its retained prefix fills the requested limit", async (observationsApi) => {
    const data = Array.from({ length: 1_001 }, (_, index) => observationsApi === "v2"
      ? { id: `obs-${index}`, traceId: `trace-${index}`, isRootObservation: true, startTime: fromStartTime, input: "question" }
      : { id: `trace-${index}`, timestamp: fromStartTime, input: "question" });
    const fakeFetch: typeof fetch = vi.fn(async () => Response.json(observationsApi === "v2"
      ? { data, meta: {} }
      : { data, meta: { page: 1, totalPages: 1 } }));

    await expect(makeRepository(fakeFetch, { observationsApi })
      .importCases({ fromStartTime, toStartTime, limit: 1 }))
      .rejects.toMatchObject({ message: "LANGFUSE_CASE_IMPORT_LIMIT_EXCEEDED" });
  });

  it("fails when legacy observations reach the global observation limit before candidates are complete", async () => {
    let calls = 0;
    const fakeFetch: typeof fetch = vi.fn(async (input) => {
      calls += 1;
      const page = Number((input as URL).searchParams.get("page"));
      return Response.json({
        data: Array.from({ length: 40 }, (_, index) => ({ id: `trace-${page}-${index}`, timestamp: fromStartTime })),
        meta: { page, totalPages: 500 },
      });
    });

    await expect(makeRepository(fakeFetch, { observationsApi: "legacy" })
      .importCases({ fromStartTime, toStartTime, limit: 40 }))
      .rejects.toMatchObject({ message: "LANGFUSE_CASE_IMPORT_LIMIT_EXCEEDED" });

    expect(calls).toBe(25);
  });

  it("fails malformed pages and non-retried authorization failures with sanitized errors", async () => {
    const malformed = makeRepository(vi.fn(async () => Response.json({ data: "not-an-array", message: "secret" })));
    await expect(malformed.importCases({ fromStartTime, toStartTime, limit: 1 }))
      .rejects.toMatchObject({ message: "LANGFUSE_CASE_IMPORT_FAILED" });

    let calls = 0;
    const unauthorized = makeRepository(vi.fn(async () => {
      calls += 1;
      return new Response("secret body", { status: 401 });
    }));
    await expect(unauthorized.importCases({ fromStartTime, toStartTime, limit: 1 }))
      .rejects.toMatchObject({ message: "LANGFUSE_INVALID_CREDENTIALS" });
    expect(calls).toBe(1);

    const legacyRequests: string[] = [];
    const legacyUnauthorized = makeRepository(vi.fn(async (input) => {
      legacyRequests.push((input as URL).pathname);
      return new Response("secret body", { status: 403 });
    }), { observationsApi: "legacy" });
    await expect(legacyUnauthorized.importCases({ fromStartTime, toStartTime, limit: 1 }))
      .rejects.toMatchObject({ message: "LANGFUSE_INVALID_CREDENTIALS" });
    expect(legacyRequests).toEqual(["/api/public/traces"]);
  });

  it("rejects an oversized streamed response with a sanitized error and cancels its body", async () => {
    const secret = "REMOTE_SECRET_CONTENT";
    let chunkIndex = 0;
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        const content = chunkIndex === 0 ? secret : "x".repeat(1_048_576);
        controller.enqueue(new TextEncoder().encode(content));
        chunkIndex += 1;
      },
      cancel() {
        cancelled = true;
      },
    });
    const fakeFetch: typeof fetch = vi.fn(async () => new Response(stream));

    const error = await makeRepository(fakeFetch)
      .importCases({ fromStartTime, toStartTime, limit: 1 })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(Error);
    expect(error).toMatchObject({ message: "LANGFUSE_CASE_IMPORT_RESPONSE_TOO_LARGE" });
    expect((error as Error).message).not.toContain(secret);
    expect(cancelled).toBe(true);
  });

  it("rejects an oversized Content-Length before parsing and cancels its body", async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode("REMOTE_SECRET_CONTENT"));
      },
      cancel() {
        cancelled = true;
      },
    });
    const response = new Response(stream, {
      headers: { "content-length": String(5 * 1024 * 1024 + 1) },
    });
    const fakeFetch: typeof fetch = vi.fn(async () => response);

    const error = await makeRepository(fakeFetch)
      .importCases({ fromStartTime, toStartTime, limit: 1 })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: "LANGFUSE_CASE_IMPORT_RESPONSE_TOO_LARGE" });
    expect((error as Error).message).not.toContain("REMOTE_SECRET_CONTENT");
    expect(cancelled).toBe(true);
  });

  it.each([
    ["missing", new Response(null)],
    ["malformed", new Response("REMOTE_SECRET_CONTENT is not JSON")],
  ])("rejects a %s response body with a sanitized error", async (_kind, response) => {
    const fakeFetch: typeof fetch = vi.fn(async () => response);

    const error = await makeRepository(fakeFetch)
      .importCases({ fromStartTime, toStartTime, limit: 1 })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({ message: "LANGFUSE_CASE_IMPORT_FAILED" });
    expect((error as Error).message).not.toContain("REMOTE_SECRET_CONTENT");
  });
});
