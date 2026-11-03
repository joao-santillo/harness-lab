import { describe, expect, it, vi } from "vitest";
import { ExternalConnectionTester } from "./connection-tester.js";

describe("ExternalConnectionTester", () => {
  it("authenticates Langfuse through the observations capability probe", async () => {
    const fetcher: typeof fetch = vi.fn(async (_input, init) => {
      expect(new Headers(init?.headers).get("authorization")).toMatch(/^Basic /u);
      return Response.json({ data: [], meta: { page: 1, totalPages: 1 } });
    });
    await expect(new ExternalConnectionTester(fetcher).test({
      kind: "langfuse",
      credentials: { baseUrl: "https://langfuse.example", publicKey: "pk-test", secretKey: "sk-test" },
    })).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledOnce();
    expect(String(vi.mocked(fetcher).mock.calls[0]?.[0])).toContain("/api/public/v2/observations");
  });

  it("maps invalid Langfuse credentials to a stable sanitized error", async () => {
    const fetcher: typeof fetch = vi.fn(async () => new Response("secret backend detail", { status: 401 }));
    await expect(new ExternalConnectionTester(fetcher).test({
      kind: "langfuse",
      credentials: { baseUrl: "https://langfuse.example", publicKey: "pk-test", secretKey: "sk-test" },
    })).rejects.toMatchObject({ code: "CONNECTION_AUTH_FAILED" });
  });

  it("does not probe an unconfirmed Agent Platform endpoint", async () => {
    const fetcher: typeof fetch = vi.fn();
    await expect(new ExternalConnectionTester(fetcher).test({
      kind: "agent-platform",
      credentials: { baseUrl: "https://platform.example", token: "platform-token" },
    })).resolves.toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();
  });
});