import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type {
  AgentId,
  CheckpointId,
  DomainId,
  EventId,
  HarnessSnapshot,
  HarnessSnapshotId,
  Round,
  RoundId,
  RoundProgressEvent,
} from "@lynn-harness/domain";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteDatabase } from "./client.js";
import { SqliteRunRepository } from "./run-repository.js";

const agentId = "agent-1" as AgentId;
const domainId = "domain-1" as DomainId;
const roundId = "round-1" as RoundId;
const harnessId = "harness-1" as HarnessSnapshotId;

const round: Round = {
  id: roundId,
  agentId,
  domainId,
  state: "setup",
  objective: "Improve tool selection",
  createdAt: "2026-10-30T10:00:00.000Z",
  updatedAt: "2026-10-30T10:00:00.000Z",
};

const harness: HarnessSnapshot = {
  id: harnessId,
  agentId,
  domainId,
  version: "1.0.0",
  components: { systemPrompt: "Use evidence" },
  immutableConstraints: ["Do not expose credentials"],
  createdAt: "2026-10-30T09:00:00.000Z",
};

const collectingRound: Round = {
  ...round,
  state: "collecting",
  updatedAt: "2026-10-30T10:01:00.000Z",
};

const event = (sequence: number, id: string): RoundProgressEvent => ({
  id: id as EventId,
  roundId,
  sequence,
  event: "collection_started",
  state: "collecting",
  occurredAt: `2026-10-30T10:0${sequence}:00.000Z`,
  messageCode: `round.collection.${sequence}`,
});

describe("SqliteRunRepository", () => {
  const temporaryDirectories: string[] = [];

  afterEach(async () => {
    await Promise.all(
      temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  it("shares committed writes across independent handles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lynn-adapters-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "harness.sqlite");
    const first = await openSqliteDatabase(path);
    const second = await openSqliteDatabase(path);
    const firstRepository = new SqliteRunRepository(first);
    const secondRepository = new SqliteRunRepository(second);

    await firstRepository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await secondRepository.saveHarnessSnapshot(harness);
    await firstRepository.saveRound(round);

    expect(second.prepare("SELECT name FROM agents WHERE id = ?").get(agentId)).toEqual({ name: "Research agent" });
    expect(firstRepository.getHarnessSnapshot(harnessId)).toEqual(harness);
    expect(await secondRepository.getRound(roundId)).toEqual(round);
    await Promise.all([first.close(), second.close()]);
  });

  it("shares one close promise and rejects writes after close", async () => {
    const database = await openSqliteDatabase(":memory:");
    const repository = new SqliteRunRepository(database);
    const firstClose = database.close();
    expect(database.close()).toBe(firstClose);
    await firstClose;
    await expect(repository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt }))
      .rejects.toThrow("SQLite database is closed");
  });

  it("migrates, persists a round and returns events in sequence after reopen", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lynn-adapters-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "harness.sqlite");

    const first = await openSqliteDatabase(path);
    expect(() =>
      first
        .prepare("INSERT INTO rounds (id, agent_id, domain_id, state, objective, created_at, updated_at, payload_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
        .run("orphan", "missing-agent", domainId, "setup", "invalid", round.createdAt, round.updatedAt, "{}"),
    ).toThrow();
    expect(first.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({ count: 3 });
    const firstRepository = new SqliteRunRepository(first);
    await firstRepository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await firstRepository.saveHarnessSnapshot(harness);
    await firstRepository.saveRound(round);
    await firstRepository.commitProgress({
      round: collectingRound,
      checkpoint: {
        id: "checkpoint-1" as CheckpointId,
        roundId,
        state: "collecting",
        sequence: 1,
        createdAt: event(1, "event-1").occurredAt,
      },
      event: event(1, "event-1"),
    });
    await firstRepository.saveEvent(event(2, "event-2"));
    await first.close();

    const reopened = await openSqliteDatabase(path);
    expect(reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({
      count: 3,
    });
    const reopenedRepository = new SqliteRunRepository(reopened);
    expect(await reopenedRepository.getRound(roundId)).toEqual(collectingRound);
    expect(reopenedRepository.getHarnessSnapshot(harnessId)).toEqual(harness);
    expect(await reopenedRepository.listEvents(roundId, 0)).toEqual([
      event(1, "event-1"),
      event(2, "event-2"),
    ]);
    expect(await reopenedRepository.listEvents(roundId, 1)).toEqual([event(2, "event-2")]);
    await reopened.close();
  });

  it("persists a committed progress transaction before close", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lynn-adapters-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "harness.sqlite");
    const first = await openSqliteDatabase(path);
    const repository = new SqliteRunRepository(first);
    await repository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await repository.saveRound(round);
    await repository.commitProgress({
      round: collectingRound,
      checkpoint: {
        id: "checkpoint-1" as CheckpointId,
        roundId,
        state: "collecting",
        sequence: 1,
        createdAt: event(1, "event-1").occurredAt,
      },
      event: event(1, "event-1"),
    });

    const second = await openSqliteDatabase(path);
    expect(await new SqliteRunRepository(second).getRound(roundId)).toEqual(collectingRound);
    await second.close();
    await first.close();
  });

  it("applies the immutable harness migration to an existing foundation database once", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lynn-adapters-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "harness.sqlite");
    const legacy = await openSqliteDatabase(path);
    legacy.exec("DROP TRIGGER harness_versions_reject_update");
    legacy.exec("DROP TRIGGER harness_versions_reject_delete");
    legacy.prepare("DELETE FROM schema_migrations WHERE name = ?").run("0002_immutable_harness");
    await legacy.close();

    const upgraded = await openSqliteDatabase(path);
    expect(upgraded.prepare("SELECT name FROM schema_migrations ORDER BY name").all()).toEqual([
      { name: "0001_foundation" },
      { name: "0002_immutable_harness" },
      { name: "0003_scope_integrity" },
    ]);
    await upgraded.close();

    const reopened = await openSqliteDatabase(path);
    expect(reopened.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get()).toEqual({
      count: 3,
    });
    await reopened.close();
  });

  it("rejects direct SQL updates to harness snapshots and preserves the original", async () => {
    const database = await openSqliteDatabase(":memory:");
    const repository = new SqliteRunRepository(database);
    await repository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await repository.saveHarnessSnapshot(harness);

    expect(() =>
      database
        .prepare("UPDATE harness_versions SET payload_json = ? WHERE id = ?")
        .run('{"components":{"systemPrompt":"Mutated"}}', harnessId),
    ).toThrow("harness_versions rows are immutable: UPDATE is not allowed");
    expect(repository.getHarnessSnapshot(harnessId)).toEqual(harness);
    await database.close();
  });

  it("rejects direct SQL deletes of harness snapshots and preserves the original", async () => {
    const database = await openSqliteDatabase(":memory:");
    const repository = new SqliteRunRepository(database);
    await repository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await repository.saveHarnessSnapshot(harness);

    expect(() => database.prepare("DELETE FROM harness_versions WHERE id = ?").run(harnessId)).toThrow(
      "harness_versions rows are immutable: DELETE is not allowed",
    );
    expect(repository.getHarnessSnapshot(harnessId)).toEqual(harness);
    await database.close();
  });

  it("rolls back round and checkpoint when the event sequence collides", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lynn-adapters-"));
    temporaryDirectories.push(directory);
    const database = await openSqliteDatabase(join(directory, "harness.sqlite"));
    const repository = new SqliteRunRepository(database);
    await repository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await repository.saveHarnessSnapshot(harness);
    await repository.saveRound(round);
    await repository.commitProgress({
      round: collectingRound,
      checkpoint: {
        id: "checkpoint-1" as CheckpointId,
        roundId,
        state: "collecting",
        sequence: 1,
        createdAt: event(1, "event-1").occurredAt,
      },
      event: event(1, "event-1"),
    });

    const diagnosingRound: Round = {
      ...round,
      state: "diagnosing",
      updatedAt: "2026-10-30T10:02:00.000Z",
    };

    await expect(
      repository.commitProgress({
        round: diagnosingRound,
        checkpoint: {
          id: "checkpoint-2" as CheckpointId,
          roundId,
          state: "diagnosing",
          sequence: 2,
          createdAt: diagnosingRound.updatedAt,
        },
        event: { ...event(1, "event-duplicate"), state: "diagnosing", event: "diagnosis_started" },
      }),
    ).rejects.toThrow();

    expect(await repository.getRound(roundId)).toEqual(collectingRound);
    expect(repository.getCheckpoint(roundId, 2)).toBeNull();
    await database.close();
  });

  it.each([
    { field: "id", value: "" },
    { field: "domainId", value: "" },
    { field: "name", value: "" },
    { field: "createdAt", value: "not-an-iso-date" },
  ])("rejects an agent with invalid $field", async ({ field, value }) => {
    const database = await openSqliteDatabase(":memory:");
    const repository = new SqliteRunRepository(database);
    const agent = {
      id: agentId,
      domainId,
      name: "Research agent",
      createdAt: round.createdAt,
      [field]: value,
    };

    await expect(repository.saveAgent(agent)).rejects.toThrow();
    expect(database.prepare("SELECT COUNT(*) AS count FROM agents").get()).toEqual({ count: 0 });
    await database.close();
  });

  it("makes every public write durable before its promise resolves", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lynn-adapters-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "harness.sqlite");
    const writer = await openSqliteDatabase(path);
    const repository = new SqliteRunRepository(writer);

    await repository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await repository.saveHarnessSnapshot(harness);
    await repository.saveRound(round);
    await repository.saveEvent(event(1, "event-1"));

    const reader = await openSqliteDatabase(path);
    const readerRepository = new SqliteRunRepository(reader);
    expect(reader.prepare("SELECT name FROM agents WHERE id = ?").get(agentId)).toEqual({
      name: "Research agent",
    });
    expect(readerRepository.getHarnessSnapshot(harnessId)).toEqual(harness);
    expect(await readerRepository.listEvents(roundId, 0)).toEqual([event(1, "event-1")]);
    await reader.close();
    await writer.close();
  });

  it("enforces event sequence uniqueness across independent handles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lynn-adapters-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "harness.sqlite");
    const first = await openSqliteDatabase(path);
    const second = await openSqliteDatabase(path);
    const firstRepository = new SqliteRunRepository(first);
    const secondRepository = new SqliteRunRepository(second);
    await firstRepository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await firstRepository.saveRound(round);
    await firstRepository.saveEvent(event(1, "event-1"));

    await expect(secondRepository.saveEvent(event(1, "event-2"))).rejects.toThrow();
    expect(await secondRepository.listEvents(roundId, 0)).toEqual([event(1, "event-1")]);
    await Promise.all([first.close(), second.close()]);
  });

  it("rejects changing an existing round identity or scope", async () => {
    const database = await openSqliteDatabase(":memory:");
    const repository = new SqliteRunRepository(database);
    await repository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await repository.saveRound(round);

    await expect(repository.saveRound({ ...round, domainId: "other-domain" as DomainId }))
      .rejects.toThrow("Round identity and scope are immutable");
    expect(await repository.getRound(roundId)).toEqual(round);
    await database.close();
  });

  it("rejects a round whose domain differs from its agent", async () => {
    const database = await openSqliteDatabase(":memory:");
    const repository = new SqliteRunRepository(database);
    await repository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });

    await expect(repository.saveRound({ ...round, domainId: "other-domain" as DomainId }))
      .rejects.toThrow("round scope must match agent scope");
    await database.close();
  });

  it("detects an altered checksum for an applied migration", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lynn-adapters-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "harness.sqlite");
    const database = await openSqliteDatabase(path);
    database.prepare("UPDATE schema_migrations SET checksum = ? WHERE name = ?")
      .run("tampered", "0001_foundation");
    await database.close();

    await expect(openSqliteDatabase(path)).rejects.toThrow("Migration checksum mismatch: 0001_foundation");
  });

  it("enforces execution idempotency across independent handles", async () => {
    const directory = await mkdtemp(join(tmpdir(), "lynn-adapters-"));
    temporaryDirectories.push(directory);
    const path = join(directory, "harness.sqlite");
    const first = await openSqliteDatabase(path);
    const second = await openSqliteDatabase(path);
    const firstRepository = new SqliteRunRepository(first);
    await firstRepository.saveAgent({ id: agentId, domainId, name: "Research agent", createdAt: round.createdAt });
    await firstRepository.saveRound(round);
    first.prepare("INSERT INTO cases (id, agent_id, domain_id, created_at, payload_json) VALUES (?, ?, ?, ?, ?)")
      .run("case-1", agentId, domainId, round.createdAt, "{}");
    const insertExecution = (database: typeof first, id: string) => database.prepare(`
      INSERT INTO executions
        (id, round_id, case_id, agent_id, domain_id, idempotency_key, created_at, payload_json)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, roundId, "case-1", agentId, domainId, "same-key", round.createdAt, "{}");
    insertExecution(first, "execution-1");

    expect(() => insertExecution(second, "execution-2")).toThrow();
    expect(second.prepare("SELECT id FROM executions").all()).toEqual([{ id: "execution-1" }]);
    await Promise.all([first.close(), second.close()]);
  });
});
