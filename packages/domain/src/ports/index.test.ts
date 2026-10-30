import { expectTypeOf, test } from "vitest";

import type { CandidateId, HarnessSnapshotId } from "../model/harness.js";
import type { CaseId, RoundId, RoundState, TerminalDecision } from "../model/round.js";
import type {
  ArtifactExportRequest,
  ArtifactExporter,
  CandidateExecutor,
  CandidateExecutionRequest,
  RunRepository,
  RoundProgressCommit,
} from "./index.js";

const roundId = "round-1" as RoundId;
const caseId = "case-1" as CaseId;
const harnessVersionId = "snapshot-1" as HarnessSnapshotId;
const candidateId = "candidate-1" as CandidateId;

test("run progress is committed atomically", () => {
  const repository: RunRepository = {
    async getRound() {
      return null;
    },
    async saveRound() {},
    async commitProgress(input: RoundProgressCommit) {
      expectTypeOf(input.round.state).toEqualTypeOf<RoundState>();
      expectTypeOf(input.checkpoint.roundId).toEqualTypeOf<RoundId>();
      expectTypeOf(input.event.roundId).toEqualTypeOf<RoundId>();
    },
    async listEvents() {
      return [];
    },
  };

  expectTypeOf(repository.commitProgress).parameter(0).toEqualTypeOf<RoundProgressCommit>();
});

test("candidate execution requests preserve explicit execution context", () => {
  const baseline: CandidateExecutionRequest = {
    kind: "baseline",
    roundId,
    caseId,
    harnessVersionId,
    attempt: 1,
    idempotencyKey: "round-1:case-1:baseline:1",
  };
  const candidate: CandidateExecutionRequest = {
    kind: "candidate",
    candidateId,
    roundId,
    caseId,
    harnessVersionId,
    attempt: 1,
    idempotencyKey: "round-1:case-1:candidate-1:1",
  };
  const executor: CandidateExecutor = {
    async execute(request) {
      expectTypeOf(request.attempt).toEqualTypeOf<number>();

      if (request.kind === "candidate") {
        expectTypeOf(request.candidateId).toEqualTypeOf<CandidateId>();
      }

      throw new Error("Contract-only fake");
    },
  };

  expectTypeOf(baseline).not.toHaveProperty("candidateId");
  expectTypeOf(candidate.candidateId).toEqualTypeOf<CandidateId>();
  expectTypeOf(executor.execute).parameter(0).toEqualTypeOf<CandidateExecutionRequest>();
});

test("artifact requests distinguish candidate exports from terminal reports", () => {
  const exporter: ArtifactExporter = {
    async export(request) {
      if (request.kind === "candidate") {
        expectTypeOf(request.candidate.id).toEqualTypeOf<CandidateId>();
        expectTypeOf(request.evaluation.decision).toEqualTypeOf<TerminalDecision>();
      } else {
        expectTypeOf(request.decision).toEqualTypeOf<TerminalDecision>();
        expectTypeOf(request).not.toHaveProperty("candidate");
        expectTypeOf(request).not.toHaveProperty("evaluation");
      }

      return [];
    },
  };

  expectTypeOf(exporter.export).parameter(0).toEqualTypeOf<ArtifactExportRequest>();
});
