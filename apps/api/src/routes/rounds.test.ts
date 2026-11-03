import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteDatabase, SqliteRoundArtifactStore, SqliteRunRepository } from "@harness-lab/adapters";
import type { RoundArtifactSession } from "@harness-lab/application";
import type { AgentId, DomainId, RoundId } from "@harness-lab/domain";
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
    expect((await server.inject({ method: "GET", url: "/api/v1/rounds" })).json()).toMatchObject({
      items: [expect.objectContaining({ id: "round-1", agentId: "agent-1", state: "setup" })],
    });
    expect((await server.inject({ method: "GET", url: "/api/v1/rounds/round-1" })).json()).toMatchObject({ id: "round-1", state: "setup" });
    expect((await server.inject({ method: "GET", url: "/api/v1/rounds/round-1/results" })).statusCode).toBe(409);
    const artifactDatabase = await openSqliteDatabase(path);
    const session: RoundArtifactSession = {
      cases: [],
      partition: { version: 1, seed: "seed", diagnosisIds: [], reservedIds: [], createdAt: created.json().createdAt },
      baseline: {
        id: "snapshot-1" as never, agentId: "agent-1" as AgentId, domainId: "domain-1" as DomainId,
        version: "1", components: {}, immutableConstraints: [], createdAt: created.json().createdAt,
      },
      capabilities: { editableComponents: [], supportsSeed: false, supportsToolReplay: false },
      diagnosis: { evidence: [], findings: [], hypotheses: [], actionability: [] },
      refinement: { candidates: [], composed: null, rejected: [], lessons: [], stopReason: "completed" },
      reservedExecutions: [],
      evaluation: {
        id: "evaluation-1" as never, roundId: "round-1" as RoundId, candidateId: "candidate-1" as never,
        decision: "rejected", sampleSize: 1, confidence: 1, aggregateScoreChange: -0.5,
        costChange: 0.1, latencyChange: 5, cases: [], limitations: ["human review incomplete"],
        rationale: "Regression gate failed.", evaluatorVersion: "1",
      },
    };
    await new SqliteRoundArtifactStore(artifactDatabase).save("round-1" as RoundId, session);
    await artifactDatabase.close();
    const result = await server.inject({ method: "GET", url: "/api/v1/rounds/round-1/results" });
    expect(result.statusCode).toBe(200);
    expect(result.json()).toMatchObject({ decision: "rejected", sampleSize: 1, aggregateScoreChange: -0.5 });
    expect(result.body).not.toContain("opaquePayload");
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