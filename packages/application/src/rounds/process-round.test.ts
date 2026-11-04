import type { AgentId, DomainId, Round, RoundId, RunRepository } from "@harness-lab/domain";
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
  const stages: RoundStageRunners = {
    collect: { run: vi.fn(async () => undefined) },
    diagnose: { run: vi.fn(async () => undefined) },
    refine: { run: vi.fn(async () => undefined) },
    execute: { run: vi.fn(async () => undefined) },
    evaluate: { run: vi.fn(async () => undefined) },
    export: { run: vi.fn(async () => undefined) },
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
    expect(state.stages.collect.run).toHaveBeenCalledTimes(1);
    expect(state.stages.diagnose.run).toHaveBeenCalledTimes(1);
    expect(state.stages.refine.run).toHaveBeenCalledTimes(1);
    expect(state.stages.execute.run).toHaveBeenCalledTimes(1);
    expect(state.stages.evaluate.run).toHaveBeenCalledTimes(1);
    expect(state.stages.export.run).toHaveBeenCalledTimes(1);
    expect(jobs.complete).toHaveBeenCalledWith("round-1", "worker-a");
  });

  it("preserves a rejection decision returned after export instead of defaulting to recommended", async () => {
    const state = fixture();
    const stages = {
      ...state.stages,
      export: { run: async () => "rejection_completed" as never },
    };
    const jobs: RoundJobControl = { isOwnedBy: async () => true, isCancellationRequested: async () => false, complete: vi.fn(async () => true) };
    const result = await new ProcessRound(state.repository, jobs, stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => "id",
    }).execute("round-1" as RoundId, "worker-a");

    expect(result.state).toBe("rejected");
    expect(state.events.at(-1)).toMatchObject({ event: "rejection_completed", state: "rejected" });
  });

  it("recovers a terminal rejection from the persisted exporting checkpoint after restart", async () => {
    const state = fixture();
    await state.repository.saveRound({ ...state.getRound(), state: "exporting" });
    const stages = {
      ...state.stages,
      export: {
        ...state.stages.export,
        getCompletionEvent: async () => "rejection_completed" as const,
      },
    };
    const jobs: RoundJobControl = { isOwnedBy: async () => true, isCancellationRequested: async () => false, complete: vi.fn(async () => true) };
    const result = await new ProcessRound(state.repository, jobs, stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => "id",
    }).execute("round-1" as RoundId, "worker-a");

    expect(result.state).toBe("rejected");
    expect(state.stages.export.run).not.toHaveBeenCalled();
  });

  it("fails closed if an exporting round has no persisted terminal decision", async () => {
    const state = fixture();
    await state.repository.saveRound({ ...state.getRound(), state: "exporting" });
    const jobs: RoundJobControl = { isOwnedBy: async () => true, isCancellationRequested: async () => false, complete: vi.fn(async () => true) };
    const result = await new ProcessRound(state.repository, jobs, state.stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => "id",
    }).execute("round-1" as RoundId, "worker-a");

    expect(result.state).toBe("integration_failed");
    expect(state.events.at(-1)).toMatchObject({ event: "integration_failed", state: "integration_failed" });
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

  it("observes cancellation requested while a stage is running before starting the next stage", async () => {
    const state = fixture();
    let cancelled = false;
    state.stages.collect.run = vi.fn(async () => { cancelled = true; });
    const jobs: RoundJobControl = {
      isOwnedBy: async () => true,
      isCancellationRequested: async () => cancelled,
      complete: vi.fn(async () => true),
    };
    const result = await new ProcessRound(state.repository, jobs, state.stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => "id",
    }).execute("round-1" as RoundId, "worker-a");

    expect(result.state).toBe("cancelled");
    expect(state.stages.collect.run).toHaveBeenCalledTimes(1);
    expect(state.stages.diagnose.run).not.toHaveBeenCalled();
    expect(state.events).toHaveLength(2);
  });

  it("observes cancellation requested while the final export stage is running", async () => {
    const state = fixture();
    let cancelled = false;
    state.stages.export.run = vi.fn(async () => { cancelled = true; });
    const jobs: RoundJobControl = {
      isOwnedBy: async () => true,
      isCancellationRequested: async () => cancelled,
      complete: vi.fn(async () => true),
    };
    const result = await new ProcessRound(state.repository, jobs, state.stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => "id",
    }).execute("round-1" as RoundId, "worker-a");

    expect(result.state).toBe("cancelled");
    expect(state.events.at(-1)).toMatchObject({ event: "cancel_requested", state: "cancelled" });
    expect(state.stages.export.run).toHaveBeenCalledOnce();
    expect(jobs.complete).toHaveBeenCalledWith("round-1", "worker-a");
  });

  it("resumes from a persisted intermediate state without rerunning completed stages", async () => {
    const state = fixture();
    await state.repository.saveRound({ ...state.getRound(), state: "diagnosing" });
    const jobs: RoundJobControl = { isOwnedBy: async () => true, isCancellationRequested: async () => false, complete: vi.fn(async () => true) };
    const result = await new ProcessRound(state.repository, jobs, state.stages, {
      now: () => "2026-10-30T12:00:01.000Z",
      createId: () => "id",
    }).execute("round-1" as RoundId, "worker-b");

    expect(result.state).toBe("recommended");
    expect(state.stages.collect.run).not.toHaveBeenCalled();
    expect(state.stages.diagnose.run).not.toHaveBeenCalled();
    expect(state.stages.refine.run).toHaveBeenCalledTimes(1);
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