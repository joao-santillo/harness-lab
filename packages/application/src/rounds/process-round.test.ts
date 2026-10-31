import type { AgentId, DomainId, Round, RoundId, RunRepository } from "@lynn-harness/domain";
import { describe, expect, it, vi } from "vitest";
import { ProcessRound, type RoundJobControl, type RoundStageRunners } from "./process-round.js";

function fixture() {
  let round: Round = {
    id: "round-1" as RoundId,
    agentId: "agent-1" as AgentId,
    domainId: "domain-1" as DomainId,
    state: "setup",
    objective: "Improve",
    createdAt: "2026-10-30T12:00:00.000Z",
    updatedAt: "2026-10-30T12:00:00.000Z",
  };
  const events: Array<{ sequence: number }> = [];
  const repository = {
    getRound: async () => round,
    saveRound: async (value: Round) => { round = value; },
    listEvents: async () => events as never,
    commitProgress: async (input: Parameters<RunRepository["commitProgress"]>[0]) => {
      round = input.round;
      events.push(input.event);
    },
  } as RunRepository;
  const run = vi.fn(async () => undefined);
  const stages: RoundStageRunners = {
    collect: { run }, diagnose: { run }, refine: { run }, execute: { run }, evaluate: { run }, export: { run },
  };
  return { repository, stages, events, getRound: () => round };
}

describe("ProcessRound", () => {
  it("persists every explicit stage in ordered checkpoints and resumes from current state", async () => {
    const state = fixture();
    const jobs: RoundJobControl = { isOwnedBy: async () => true, isCancellationRequested: async () => false, complete: vi.fn(async () => true) };
    let id = 0;
    const result = await new ProcessRound(state.repository, jobs, state.stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => `id-${++id}`,
    }).execute("round-1" as RoundId, "worker-a");

    expect(result.state).toBe("recommended");
    expect(state.events.map((event) => event.sequence)).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(state.stages.collect.run).toHaveBeenCalledTimes(6);
    expect(jobs.complete).toHaveBeenCalledWith("round-1", "worker-a");
  });

  it("cooperatively cancels before the next stage", async () => {
    const state = fixture();
    const jobs: RoundJobControl = { isOwnedBy: async () => true, isCancellationRequested: async () => true, complete: vi.fn(async () => true) };
    const result = await new ProcessRound(state.repository, jobs, state.stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => "id",
    }).execute("round-1" as RoundId, "worker-a");

    expect(result.state).toBe("cancelled");
    expect(state.events).toHaveLength(1);
    expect(state.stages.collect.run).not.toHaveBeenCalled();
  });

  it("commits a stable terminal failure when a stage rejects", async () => {
    const state = fixture();
    state.stages.collect.run = vi.fn(async () => { throw new Error("upstream detail"); });
    const jobs: RoundJobControl = { isOwnedBy: async () => true, isCancellationRequested: async () => false, complete: vi.fn(async () => true) };
    const result = await new ProcessRound(state.repository, jobs, state.stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => "id",
    }).execute("round-1" as RoundId, "worker-a");

    expect(result.state).toBe("integration_failed");
    expect(state.events).toHaveLength(1);
  });

  it("fences a stale worker before it runs another stage", async () => {
    const state = fixture();
    const jobs: RoundJobControl = { isOwnedBy: async () => false, isCancellationRequested: async () => false, complete: vi.fn(async () => true) };
    await expect(new ProcessRound(state.repository, jobs, state.stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => "id",
    }).execute("round-1" as RoundId, "stale-worker")).rejects.toThrow("ROUND_CLAIM_LOST");
    expect(state.stages.collect.run).not.toHaveBeenCalled();
  });

  it("fences a stale worker before the terminal decision commit", async () => {
    const state = fixture();
    let ownershipChecks = 0;
    const jobs: RoundJobControl = {
      isOwnedBy: async () => ++ownershipChecks < 13,
      isCancellationRequested: async () => false,
      complete: vi.fn(async () => true),
    };
    await expect(new ProcessRound(state.repository, jobs, state.stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => `id-${ownershipChecks}`,
    }).execute("round-1" as RoundId, "stale-worker")).rejects.toThrow("ROUND_CLAIM_LOST");
    expect(state.getRound().state).toBe("exporting");
    expect(state.events).toHaveLength(6);
  });
});