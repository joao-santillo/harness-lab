import type { AgentId, HarnessSnapshotId } from "@harness-lab/domain";
import { describe, expect, it, vi } from "vitest";
import { AgentPlatformClient } from "./client.js";
import { AgentPlatformHarnessRepository } from "./harness-repository.js";

describe("AgentPlatformHarnessRepository", () => {
  it("discovers proven capabilities and creates immutable snapshots with opaque fields", async () => {
    const fakeFetch: typeof fetch = vi.fn(async (input, init) => {
      const url = input as URL;
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer platform-token");
      if (url.pathname.endsWith("/capabilities")) return Response.json({
        editable: ["dta-flow", "tools", "parameters", "knowledge", "memory", "records", "unknown-component"],
        supportsSeed: true,
        supportsToolReplay: false,
        apiVersion: "2026-10",
      });
      return Response.json({
        id: "agent-1", version: "7", dtaFlow: { nodes: [] }, tools: [{ name: "search" }],
        parameters: { temperature: 0 }, knowledge: ["kb-1"], memory: { enabled: true }, records: [],
        futureField: { preserved: true }, immutableRules: ["No secret disclosure"],
      });
    });
    const repository = new AgentPlatformHarnessRepository(new AgentPlatformClient({
      baseUrl: "https://platform.example", token: "platform-token", fetch: fakeFetch,
    }), () => "2026-10-31T00:00:00.000Z");

    const capabilities = await repository.getCapabilities("agent-1" as AgentId);
    const snapshot = await repository.fetchSnapshot("agent-1" as AgentId, "domain-1" as never);

    expect(capabilities.editableComponents).toEqual(["dta-flow", "tools", "parameters", "knowledge", "memory", "records"]);
    expect(snapshot.components).toHaveProperty("dta-flow");
    expect(snapshot.immutableConstraints).toEqual(["No secret disclosure"]);
    expect(snapshot.sourceVersion).toBe("7");
    expect(snapshot.artifactHash).toMatch(/^[0-9a-f]{64}$/);
    expect(snapshot.opaquePayload).toHaveProperty("futureField", { preserved: true });
    expect(Object.isFrozen(snapshot.opaquePayload)).toBe(true);
  });

  it("stores and retrieves immutable snapshots locally", async () => {
    const client = new AgentPlatformClient({ baseUrl: "https://platform.example", token: "token", fetch: vi.fn() as never });
    const repository = new AgentPlatformHarnessRepository(client);
    const snapshot = {
      id: "snapshot-1" as HarnessSnapshotId, agentId: "agent-1" as AgentId, domainId: "domain-1" as never,
      version: "1", components: {}, immutableConstraints: [], createdAt: "now",
    };
    await repository.saveSnapshot(snapshot);
    expect(await repository.getSnapshot(snapshot.id)).toEqual(snapshot);
  });

  it("returns sanitized stable failures", async () => {
    const client = new AgentPlatformClient({
      baseUrl: "https://platform.example", token: "secret-token",
      fetch: vi.fn(async () => new Response(JSON.stringify({ message: "secret-token invalid" }), { status: 401 })) as never,
    });
    const repository = new AgentPlatformHarnessRepository(client);
    await expect(repository.getCapabilities("agent-1" as AgentId)).rejects.toThrow("AGENT_PLATFORM_INVALID_CREDENTIALS");
  });
});