import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteDatabase, SqliteRunRepository } from "@harness-lab/adapters";
import type { AgentId, CheckpointId, DomainId, EventId, Round, RoundId } from "@harness-lab/domain";
import { afterEach, describe, expect, it } from "vitest";
import { buildServer } from "../server.js";

const cleanup: string[] = [];
afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("round event stream", () => {
  it("replays persisted events after Last-Event-ID in sequence", async () => {
    const directory = await mkdtemp(join(tmpdir(), "events-api-"));
    cleanup.push(directory);
    const path = join(directory, "events.sqlite");
    const database = await openSqliteDatabase(path);
    const repository = new SqliteRunRepository(database);
    const round: Round = {
      id: "round-1" as RoundId,
      agentId: "agent-1" as AgentId,
      domainId: "domain-1" as DomainId,
      state: "setup",
      objective: "Improve",
      createdAt: "2026-10-30T12:00:00.000Z",
      updatedAt: "2026-10-30T12:00:00.000Z",
    };
    await repository.saveAgent({ id: round.agentId, domainId: round.domainId, name: "Agent", createdAt: round.createdAt });
    await repository.saveRound(round);
    for (const sequence of [0, 1]) {
      const event = sequence === 0 ? "collection_started" : "diagnosis_started";
      const state = sequence === 0 ? "collecting" : "diagnosing";
      const occurredAt = `2026-10-30T12:00:0${sequence + 1}.000Z`;
      await repository.commitProgress({
        round: { ...round, state: sequence === 1 ? "cancelled" : state, updatedAt: occurredAt },
        checkpoint: { id: `checkpoint-${sequence}` as CheckpointId, roundId: round.id, state, sequence, createdAt: occurredAt },
        event: { id: `event-${sequence}` as EventId, roundId: round.id, sequence, event, state, occurredAt, messageCode: `ROUND_${event.toUpperCase()}` },
      });
    }
    await database.close();
    const server = await buildServer({
      databasePath: path,
      encryptionKey: randomBytes(32).toString("base64"),
      connectionTester: { test: async () => undefined },
      eventStreamOptions: { pollIntervalMs: 1, heartbeatIntervalMs: 100 },
    });

    const response = await server.inject({ method: "GET", url: "/api/v1/rounds/round-1/events", headers: { "last-event-id": "0" } });

    expect(response.statusCode).toBe(200);
    expect(response.headers["content-type"]).toContain("text/event-stream");
    expect(response.body).not.toContain("id: 0");
    expect(response.body).toContain("id: 1");
    expect(response.body).toContain("diagnosis_started");
    await server.close();
  });
});