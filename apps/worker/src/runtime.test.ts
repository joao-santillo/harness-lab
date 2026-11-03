import { randomUUID } from "node:crypto";
import {
  openSqliteDatabase,
  SqliteRoundArtifactStore,
  SqliteRunRepository,
} from "@harness-lab/adapters";
import type {
  AgentCapabilities,
  AgentHarnessRepository,
  AgentId,
  CandidateExecutor,
  DomainId,
  ExecutionId,
  ExecutionResult,
  HarnessSnapshot,
  HarnessSnapshotId,
  PartitionCase,
  Round,
  RoundId,
} from "@harness-lab/domain";
import type { RoundStageDependencies } from "@harness-lab/application";
import { describe, expect, it, vi } from "vitest";
import { createRoundWorkerRuntime } from "./runtime.js";

describe("createRoundWorkerRuntime", () => {
  it("processes an enqueued round through durable stages and persists its terminal artifacts", async () => {
    const database = await openSqliteDatabase(":memory:");
    const now = "2026-11-03T10:00:00.000Z";
    const round: Round = {
      id: "round-runtime" as RoundId,
      agentId: "agent-runtime" as AgentId,
      domainId: "domain-runtime" as DomainId,
      state: "setup",
      objective: "Reduce unsupported answers",
      createdAt: now,
      updatedAt: now,
    };
    const baseline: HarnessSnapshot = {
      id: "snapshot-runtime" as HarnessSnapshotId,
      agentId: round.agentId,
      domainId: round.domainId,
      version: "1",
      components: { parameters: "strict=false" },
      immutableConstraints: [],
      createdAt: now,
    };
    const cases: readonly PartitionCase[] = [1, 2, 3, 4].map((number) => ({
      id: `case-${number}`, sessionId: `session-${number}`, similarityGroup: `group-${number}`, content: `question ${number}`,
    }));
    const harnesses: RoundStageDependencies["harnesses"] = {
      getCapabilities: async (): Promise<AgentCapabilities> => ({ editableComponents: ["parameters"], supportsSeed: false, supportsToolReplay: false }),
      fetchSnapshot: async (): Promise<HarnessSnapshot> => baseline,
      getSnapshot: async () => baseline,
      saveSnapshot: async () => undefined,
    };
    const executor: CandidateExecutor = {
      execute: async (request): Promise<ExecutionResult> => ({
        id: randomUUID() as ExecutionId,
        roundId: request.roundId,
        caseId: request.caseId,
        harnessSnapshotId: request.harnessVersionId,
        status: "succeeded",
        correlationId: request.idempotencyKey,
        traceId: `trace-${request.caseId}`,
        output: "supported answer",
        metrics: { inputTokens: 2, outputTokens: 2, cost: 0.01, latencyMs: 15 },
        limitations: [],
      }),
    };
    const exported = vi.fn(async () => undefined);
    const stageDependencies: Omit<RoundStageDependencies, "cases"> = {
      traces: { collect: async (_round, diagnosisCases) => diagnosisCases.map(({ id }) => ({ id, output: "unsupported", unsupportedAnswer: true })) },
      harnesses,
      proposals: { create: async (_round, diagnosis) => [{
        id: "proposal-runtime",
        findingId: diagnosis.findings[0]!.id,
        hypothesisId: diagnosis.hypotheses[0]!.id,
        evidenceIds: diagnosis.evidence.map(({ id }) => id),
        component: "parameters",
        after: "strict=true",
        expectedEffect: "Reduce unsupported answers",
      }] },
      executor,
      evaluator: { id: "evaluator", version: "1", minimumSampleSize: 1, recommendationThreshold: 0.1, maximumRegressionRate: 0 },
      exportRound: exported,
    };
    const runtime = createRoundWorkerRuntime({
      database,
      workerId: "worker-runtime",
      now: () => now,
      createId: randomUUID,
      stageDependencies,
      stageOptions: { partitionSeed: "runtime-seed", minimumReserved: 1, reservedRatio: 0.25, maxProposals: 1 },
    });
    const repository = new SqliteRunRepository(database);
    await repository.saveAgent({ id: round.agentId, domainId: round.domainId, name: "Runtime agent", createdAt: now });
    await repository.saveRound(round);
    await runtime.cases.saveMany(cases.map((item) => ({
      ...item,
      id: item.id as never,
      agentId: round.agentId,
      domainId: round.domainId,
      source: "manual" as const,
      createdAt: now,
    })));
    runtime.jobs.enqueue(round.id, now);

    await expect(runtime.worker.tick()).resolves.toBe(true);
    await expect(repository.getRound(round.id)).resolves.toMatchObject({ state: "recommended" });
    const artifacts = await new SqliteRoundArtifactStore(database).get(round.id);
    expect(artifacts?.evaluation?.decision).toBe("recommended");
    expect(artifacts?.reservedExecutions).toHaveLength(1);
    expect(exported).toHaveBeenCalledOnce();
    await database.close();
  });
});