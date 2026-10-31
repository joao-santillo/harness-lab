import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentId, DomainId, Round, RoundId } from "@lynn-harness/domain";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteDatabase } from "./client.js";
import { SqliteRoundJobStore } from "./round-job-store.js";
import { SqliteRunRepository } from "./run-repository.js";

const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe("SqliteRoundJobStore", () => {
  it("allows only one independent database handle to claim a queued round", async () => {
    const directory = await mkdtemp(join(tmpdir(), "round-job-"));
    cleanup.push(directory);
    const path = join(directory, "worker.sqlite");
    const firstDatabase = await openSqliteDatabase(path);
    const secondDatabase = await openSqliteDatabase(path);
    const round: Round = {
      id: "round-1" as RoundId,
      agentId: "agent-1" as AgentId,
      domainId: "domain-1" as DomainId,
      state: "setup",
      objective: "Improve answers",
      createdAt: "2026-10-30T12:00:00.000Z",
      updatedAt: "2026-10-30T12:00:00.000Z",
    };
    const repository = new SqliteRunRepository(firstDatabase);
    await repository.saveAgent({ id: round.agentId, domainId: round.domainId, name: "Agent", createdAt: round.createdAt });
    await repository.saveRound(round);
    new SqliteRoundJobStore(firstDatabase).enqueue(round.id, round.createdAt);

    const claims = [
      new SqliteRoundJobStore(firstDatabase).claimNext("worker-a", "2026-10-30T12:00:01.000Z"),
      new SqliteRoundJobStore(secondDatabase).claimNext("worker-b", "2026-10-30T12:00:01.000Z"),
    ];

    expect(claims.filter((claim) => claim !== null)).toHaveLength(1);
    expect(claims.filter((claim) => claim === null)).toHaveLength(1);
    await firstDatabase.close();
    await secondDatabase.close();
  });

  it("allows another worker to recover an expired claim", async () => {
    const directory = await mkdtemp(join(tmpdir(), "round-lease-"));
    cleanup.push(directory);
    const path = join(directory, "worker.sqlite");
    const database = await openSqliteDatabase(path);
    const round: Round = {
      id: "round-expired" as RoundId,
      agentId: "agent-1" as AgentId,
      domainId: "domain-1" as DomainId,
      state: "setup",
      objective: "Improve answers",
      createdAt: "2026-10-30T12:00:00.000Z",
      updatedAt: "2026-10-30T12:00:00.000Z",
    };
    const repository = new SqliteRunRepository(database);
    await repository.saveAgent({ id: round.agentId, domainId: round.domainId, name: "Agent", createdAt: round.createdAt });
    await repository.saveRound(round);
    const store = new SqliteRoundJobStore(database, 1_000);
    store.enqueue(round.id, round.createdAt);
    expect(store.claimNext("crashed-worker", "2026-10-30T12:00:01.000Z")?.claimedBy).toBe("crashed-worker");
    expect(store.claimNext("recovery-worker", "2026-10-30T12:00:03.000Z")?.claimedBy).toBe("recovery-worker");
    await database.close();
  });
});