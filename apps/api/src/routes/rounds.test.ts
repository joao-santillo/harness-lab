import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteDatabase, SqliteRunRepository } from "@harness-lab/adapters";
import type { AgentId, DomainId } from "@harness-lab/domain";
import { describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

describe("round routes", () => {
  it("creates, queues, reads and cooperatively cancels a round", async () => {
    const directory = await mkdtemp(join(tmpdir(), "round-api-"));
    const path = join(directory, "round.sqlite");
    const database = await openSqliteDatabase(path);
    await new SqliteRunRepository(database).saveAgent({
      id: "agent-1" as AgentId,
      domainId: "domain-1" as DomainId,
      name: "Agent",
      createdAt: "2026-10-30T12:00:00.000Z",
    });
    await database.close();
    const server = await buildServer({
      databasePath: path,
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => undefined },
    });
    const payload = { id: "round-1", agentId: "agent-1", domainId: "domain-1", objective: "Improve" };

    const created = await server.inject({ method: "POST", url: "/api/v1/rounds", payload });
    expect(created.statusCode).toBe(201);
    expect(created.json()).toMatchObject({ ...payload, state: "setup" });
    expect((await server.inject({ method: "GET", url: "/api/v1/rounds/round-1" })).json()).toMatchObject({ id: "round-1", state: "setup" });
    expect((await server.inject({ method: "POST", url: "/api/v1/rounds", payload })).statusCode).toBe(409);
    const invalidScope = await server.inject({
      method: "POST",
      url: "/api/v1/rounds",
      payload: { ...payload, id: "round-invalid", domainId: "other-domain" },
    });
    expect(invalidScope.statusCode).toBe(422);
    expect(invalidScope.json()).toEqual({ code: "ROUND_SCOPE_INVALID" });
    expect((await server.inject({ method: "POST", url: "/api/v1/rounds/round-1/cancel" })).statusCode).toBe(202);
    await server.close();
    await rm(directory, { recursive: true, force: true });
  });
});