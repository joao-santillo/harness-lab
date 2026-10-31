import { randomBytes } from "node:crypto";
import { ConnectionTestError } from "@lynn-harness/application";
import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

function serverOptions() {
  return {
    encryptionKey: randomBytes(32).toString("base64"),
    connectionTester: { test: async () => undefined },
  };
}

describe("connection routes", () => {
  it("creates, reads and deletes a connection without returning plaintext credentials", async () => {
    const server = await buildServer(serverOptions());
    const payload = {
      id: "langfuse-main",
      kind: "langfuse",
      name: "Langfuse principal",
      credentials: { publicKey: "pk-live", secretKey: "sk-live" },
    };

    const created = await server.inject({ method: "POST", url: "/api/v1/connections", payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toEqual({
      id: "langfuse-main",
      kind: "langfuse",
      name: "Langfuse principal",
      configured: true,
    });
    expect(created.body).not.toContain("pk-live");
    expect(created.body).not.toContain("sk-live");

    const found = await server.inject({ method: "GET", url: "/api/v1/connections/langfuse-main" });
    expect(found.json()).toEqual(created.json());

    const removed = await server.inject({ method: "DELETE", url: "/api/v1/connections/langfuse-main" });
    expect(removed.statusCode).toBe(204);
    expect((await server.inject({ method: "GET", url: "/api/v1/connections/langfuse-main" })).statusCode).toBe(404);
    await server.close();
  });

  it.each([
    ["pt-BR", "Dados da conexão inválidos."],
    ["en", "Invalid connection data."],
    ["es", "Datos de conexión no válidos."],
  ])("localizes validation errors for %s", async (locale, message) => {
    const server = await buildServer(serverOptions());
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/connections",
      headers: { "accept-language": locale },
      payload: { id: "invalid", credentials: {} },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json()).toEqual({ code: "CONNECTION_INVALID", message });
    await server.close();
  });

  it("replays only an identical idempotent create", async () => {
    const server = await buildServer(serverOptions());
    const request = {
      method: "POST" as const,
      url: "/api/v1/connections",
      headers: { "idempotency-key": "request-1" },
      payload: {
        id: "lynn-main",
        kind: "lynn",
        name: "LYNN principal",
        credentials: { token: "first-token" },
      },
    };
    const first = await server.inject(request);
    const replay = await server.inject(request);
    const conflict = await server.inject({
      ...request,
      payload: { ...request.payload, credentials: { token: "different-token" } },
    });

    expect(first.statusCode).toBe(201);
    expect(replay.statusCode).toBe(200);
    expect(replay.json()).toEqual(first.json());
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
    await server.close();
  });

  it("exposes credential status without exposing credential values", async () => {
    const server = await buildServer(serverOptions());
    await server.inject({
      method: "POST",
      url: "/api/v1/connections",
      payload: {
        id: "lynn-status",
        kind: "lynn",
        name: "LYNN status",
        credentials: { token: "hidden-token" },
      },
    });

    const response = await server.inject({ method: "GET", url: "/api/v1/connections/lynn-status/credentials" });
    expect(response.json()).toEqual({ connectionId: "lynn-status", configured: true });
    expect(response.body).not.toContain("hidden-token");
    await server.close();
  });

  it("exposes versioned empty agent and round collections", async () => {
    const server = await buildServer(serverOptions());

    expect((await server.inject({ method: "GET", url: "/api/v1/agents" })).json()).toEqual({ items: [] });
    expect((await server.inject({ method: "GET", url: "/api/v1/rounds" })).json()).toEqual({ items: [] });
    const missingEvents = await server.inject({ method: "GET", url: "/api/v1/rounds/round-1/events" });
    expect(missingEvents.statusCode).toBe(404);
    expect(missingEvents.json()).toEqual({ code: "ROUND_NOT_FOUND" });
    await server.close();
  });

  it("tests credentials before persistence and localizes failures without leaking details", async () => {
    const server = await buildServer({
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => { throw new ConnectionTestError("CONNECTION_UNAVAILABLE"); } },
    });
    const response = await server.inject({
      method: "POST",
      url: "/api/v1/connections",
      headers: { "accept-language": "en;q=0.4, es;q=0.9" },
      payload: { id: "rejected", kind: "lynn", name: "Rejected", credentials: { token: "hidden" } },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ code: "CONNECTION_UNAVAILABLE", message: "El servicio de conexión no está disponible." });
    expect((await server.inject({ method: "GET", url: "/api/v1/connections/rejected" })).statusCode).toBe(404);
    await server.close();
  });
});