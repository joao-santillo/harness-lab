import { describe, expect, it } from "vitest";
import { LangfuseClient } from "./client.js";
import { negotiateLangfuseCapabilities } from "./capabilities.js";

function clientWithStatus(status: number, inspect?: (url: URL, init: RequestInit) => void) {
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = input as URL;
    inspect?.(url, init ?? {});
    const legacyProbe = url.pathname === "/api/public/traces";
    return new Response(JSON.stringify({ data: [], meta: { page: 1, totalPages: 1 } }), {
      status: legacyProbe && (status === 404 || status === 405) ? 200 : status,
      headers: { "content-type": "application/json", "retry-after": "3" },
    });
  };
  return new LangfuseClient({ baseUrl: "https://langfuse.example", publicKey: "pk", secretKey: "sk-secret", fetch: fakeFetch });
}

describe("negotiateLangfuseCapabilities", () => {
  it("selects observations v2 after a bounded authenticated read", async () => {
    const client = clientWithStatus(200, (url, init) => {
      expect(url.pathname).toBe("/api/public/v2/observations");
      expect(url.searchParams.get("limit")).toBe("1");
      expect(new Headers(init.headers).get("authorization")).toMatch(/^Basic /);
    });
    const result = await negotiateLangfuseCapabilities(client, () => "2026-10-31T00:00:00.000Z");
    expect(result).toEqual(expect.objectContaining({ observationsApi: "v2", scoresApi: "v3", probedAt: "2026-10-31T00:00:00.000Z", limitations: [] }));
  });

  it.each([
    ["advertised v2 returning 404", 404, "legacy", ["Observations v2 probe returned 404; using deprecated legacy trace reads."]],
    ["legacy-only deployment", 405, "legacy", ["Observations v2 is unavailable; using deprecated legacy trace reads."]],
  ] as const)("handles %s", async (_name, status, expectedApi, limitations) => {
    const result = await negotiateLangfuseCapabilities(clientWithStatus(status), () => "2026-10-31T00:00:00.000Z");
    expect(result.observationsApi).toBe(expectedApi);
    expect(result.limitations).toEqual(limitations);
  });

    it("confirms authentication against the legacy endpoint before accepting an observations v2 mismatch", async () => {
      const requests: string[] = [];
      const client = new LangfuseClient({
        baseUrl: "https://langfuse.example",
        publicKey: "pk",
        secretKey: "sk-secret",
        fetch: async (input) => {
          const url = input as URL;
          requests.push(url.pathname);
          return new Response(JSON.stringify({ data: [], meta: { page: 1, totalPages: 1 } }), {
            status: url.pathname.endsWith("/observations") ? 404 : 401,
            headers: { "content-type": "application/json" },
          });
        },
      });
      await expect(negotiateLangfuseCapabilities(client, () => "2026-11-03T12:00:00.000Z"))
        .rejects.toMatchObject({ message: "LANGFUSE_INVALID_CREDENTIALS" });
      expect(requests).toEqual(["/api/public/v2/observations", "/api/public/traces"]);
    });

  it.each([[401, "LANGFUSE_INVALID_CREDENTIALS"], [429, "LANGFUSE_RATE_LIMITED"]] as const)("returns a stable sanitized error for %s", async (status, code) => {
    await expect(negotiateLangfuseCapabilities(clientWithStatus(status), () => "2026-10-31T00:00:00.000Z"))
      .rejects.toMatchObject({ message: code });
  });
});