import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentId, DomainId, Round, RoundId } from "@harness-lab/domain";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteDatabase } from "./client.js";
import { SqliteRoundJobStore } from "./round-job-store.js";
import { SqliteRunRepository } from "./run-repository.js";

const cleanup: string[] = [];

afterEach(async () => Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

async function createRoundJobFixture(roundId: RoundId, leaseMs = 30_000) {
  const directory = await mkdtemp(join(tmpdir(), "round-cancellation-"));
  cleanup.push(directory);
  const database = await openSqliteDatabase(join(directory, "worker.sqlite"));
  const round: Round = {
    id: roundId,
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
  const store = new SqliteRoundJobStore(database, leaseMs);
  store.enqueue(round.id, round.createdAt);
  return { database, round, store };
}

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

  it("preserves a claimed worker's lease and ownership while cancellation is requested", async () => {
    const { database, round, store } = await createRoundJobFixture("round-cancel-claimed" as RoundId);
    expect(store.claimNext("worker-a", "2026-10-30T12:00:01.000Z")?.claimedBy).toBe("worker-a");

    expect(store.requestCancellation(round.id, "2026-10-30T12:00:02.000Z")).toBe(true);

    const job = database.prepare("SELECT status, claimed_by, claimed_at FROM round_jobs WHERE round_id = ?").get(round.id);
    expect(job).toEqual({
      status: "cancel_requested",
      claimed_by: "worker-a",
      claimed_at: "2026-10-30T12:00:01.000Z",
    });
    await expect(store.isOwnedBy(round.id, "worker-a")).resolves.toBe(true);
    await expect(store.isCancellationRequested(round.id)).resolves.toBe(true);
    expect(store.claimNext("worker-b", "2026-10-30T12:00:02.500Z")).toBeNull();
    await database.close();
  });

  it("claims a queued cancellation request without clearing its cancellation state", async () => {
    const { database, round, store } = await createRoundJobFixture("round-cancel-queued" as RoundId);
    expect(store.requestCancellation(round.id, "2026-10-30T12:00:01.000Z")).toBe(true);

    expect(store.claimNext("worker-a", "2026-10-30T12:00:02.000Z")?.claimedBy).toBe("worker-a");

    const job = database.prepare("SELECT status, claimed_by, claimed_at FROM round_jobs WHERE round_id = ?").get(round.id);
    expect(job).toEqual({
      status: "cancel_requested",
      claimed_by: "worker-a",
      claimed_at: "2026-10-30T12:00:02.000Z",
    });
    await expect(store.isOwnedBy(round.id, "worker-a")).resolves.toBe(true);
    await expect(store.isCancellationRequested(round.id)).resolves.toBe(true);
    await database.close();
  });

  it("recovers an expired cancellation-requested claim while retaining cancellation", async () => {
    const { database, round, store } = await createRoundJobFixture("round-cancel-expired" as RoundId, 1_000);
    expect(store.claimNext("crashed-worker", "2026-10-30T12:00:01.000Z")?.claimedBy).toBe("crashed-worker");
    expect(store.requestCancellation(round.id, "2026-10-30T12:00:01.500Z")).toBe(true);

    expect(store.claimNext("recovery-worker", "2026-10-30T12:00:03.000Z")?.claimedBy).toBe("recovery-worker");

    await expect(store.isOwnedBy(round.id, "crashed-worker")).resolves.toBe(false);
    await expect(store.isOwnedBy(round.id, "recovery-worker")).resolves.toBe(true);
    await expect(store.isCancellationRequested(round.id)).resolves.toBe(true);
    await database.close();
  });

  it("allows the owner to complete a cancellation-requested claimed job", async () => {
    const { database, round, store } = await createRoundJobFixture("round-cancel-complete" as RoundId);
    expect(store.claimNext("worker-a", "2026-10-30T12:00:01.000Z")?.claimedBy).toBe("worker-a");
    expect(store.requestCancellation(round.id, "2026-10-30T12:00:02.000Z")).toBe(true);

    await expect(store.complete(round.id, "worker-a")).resolves.toBe(true);

    await expect(store.isOwnedBy(round.id, "worker-a")).resolves.toBe(false);
    await expect(store.isCancellationRequested(round.id)).resolves.toBe(false);
    await database.close();
  });
});
