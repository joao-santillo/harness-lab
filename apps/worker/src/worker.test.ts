import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSqliteDatabase, SqliteRoundJobStore, SqliteRunRepository } from "@lynn-harness/adapters";
import { ProcessRound, type RoundStageRunners } from "@lynn-harness/application";
import type { AgentId, DomainId, Round, RoundId } from "@lynn-harness/domain";
import { describe, expect, it, vi } from "vitest";
import { DurableRoundWorker } from "./worker.js";

describe("DurableRoundWorker", () => {
  it("processes one claimed round per tick", async () => {
    const execute = vi.fn(async () => ({}) as never);
    const jobs = { claimNext: vi.fn(() => ({ roundId: "round-1" as RoundId })) };
    const worker = new DurableRoundWorker(jobs, { execute }, {
      workerId: "worker-a",
      now: () => "2026-10-30T12:00:00.000Z",
    });

    await expect(worker.tick()).resolves.toBe(true);
    expect(jobs.claimNext).toHaveBeenCalledWith("worker-a", "2026-10-30T12:00:00.000Z");
    expect(execute).toHaveBeenCalledWith("round-1", "worker-a");
  });

  it("does nothing when no queued round is available", async () => {
    const execute = vi.fn(async () => ({}) as never);
    const worker = new DurableRoundWorker({ claimNext: () => null }, { execute }, {
      workerId: "worker-a",
      now: () => "2026-10-30T12:00:00.000Z",
    });

    await expect(worker.tick()).resolves.toBe(false);
    expect(execute).not.toHaveBeenCalled();
  });

  it("persists ordered checkpoints and resumes from the last committed state after restart", async () => {
    const directory = await mkdtemp(join(tmpdir(), "durable-worker-"));
    const path = join(directory, "worker.sqlite");
    const firstDatabase = await openSqliteDatabase(path);
    const firstRepository = new SqliteRunRepository(firstDatabase);
    const jobs = new SqliteRoundJobStore(firstDatabase);
    const round: Round = {
      id: "round-restart" as RoundId,
      agentId: "agent-1" as AgentId,
      domainId: "domain-1" as DomainId,
      state: "setup",
      objective: "Improve",
      createdAt: "2026-10-30T12:00:00.000Z",
      updatedAt: "2026-10-30T12:00:00.000Z",
    };
    await firstRepository.saveAgent({ id: round.agentId, domainId: round.domainId, name: "Agent", createdAt: round.createdAt });
    await firstRepository.saveRound(round);
    jobs.enqueue(round.id, round.createdAt);
    const run = vi.fn(async () => undefined);
    const stages: RoundStageRunners = { collect: { run }, diagnose: { run }, refine: { run }, execute: { run }, evaluate: { run }, export: { run } };
    let id = 0;
    const processor = new ProcessRound(firstRepository, jobs, stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => `id-${++id}`,
    });
    await new DurableRoundWorker(jobs, processor, { workerId: "worker-a", now: () => "2026-10-30T12:00:00.500Z" }).tick();
    await firstDatabase.close();

    const reopened = await openSqliteDatabase(path);
    const reopenedRepository = new SqliteRunRepository(reopened);
    expect((await reopenedRepository.getRound(round.id))?.state).toBe("recommended");
    expect((await reopenedRepository.listEvents(round.id, -1)).map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(new SqliteRoundJobStore(reopened).claimNext("worker-b", "2026-10-30T12:00:02.000Z")).toBeNull();
    await reopened.close();
    await rm(directory, { recursive: true, force: true });
  });
});