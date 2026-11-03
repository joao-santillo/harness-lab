import type {
  AgentCapabilities, AgentHarnessRepository, CandidateExecutor, CandidateId, EvaluationId,
  EvaluatorDefinition, ExecutionResult, HarnessSnapshot, PartitionCase, PartitionManifest,
  Round, RoundEvent, RoundId, TerminalDecision, VersionedEvaluationResult,
} from "@harness-lab/domain";
import { partitionCases, sealPartitionManifest } from "../cases/partition-cases.js";
import { diagnoseExecutions, type DiagnosisResult, type DiagnosticTrace } from "../diagnosis/diagnose-executions.js";
import { evaluateCandidate, type CandidateCaseSignal } from "../evaluation/evaluate-candidate.js";
import { runRefinement, type RefinementProposal, type RefinementRunResult } from "../refinement/run-refinement.js";
import type { RoundStageRunners } from "./process-round.js";

export interface RoundArtifactSession {
  readonly cases: readonly PartitionCase[];
  readonly partition: PartitionManifest;
  readonly baseline: HarnessSnapshot;
  readonly capabilities: AgentCapabilities;
  readonly diagnosis: DiagnosisResult;
  readonly refinement: RefinementRunResult;
  readonly reservedExecutions: readonly { baseline: ExecutionResult; candidate: ExecutionResult }[];
  readonly evaluation: VersionedEvaluationResult | null;
}

export interface RoundArtifactStore {
  get(roundId: RoundId): Promise<RoundArtifactSession | null>;
  save(roundId: RoundId, session: RoundArtifactSession): Promise<void>;
}

const terminalEvents: Readonly<Record<TerminalDecision, RoundEvent>> = {
  recommended: "recommendation_completed",
  rejected: "rejection_completed",
  inconclusive: "evaluation_inconclusive",
  pending_validation: "validation_pending",
  validation_insufficient: "validation_insufficient",
  stopped_by_limit: "limit_reached",
  cancelled: "cancel_requested",
  integration_failed: "integration_failed",
};

export function terminalEventForDecision(decision: TerminalDecision): RoundEvent {
  return terminalEvents[decision];
}

export class InMemoryRoundArtifactStore implements RoundArtifactStore {
  readonly #sessions = new Map<RoundId, RoundArtifactSession>();

  async get(roundId: RoundId): Promise<RoundArtifactSession | null> {
    return this.#sessions.get(roundId) ?? null;
  }

  async save(roundId: RoundId, session: RoundArtifactSession): Promise<void> {
    this.#sessions.set(roundId, structuredClone(session));
  }
}

export interface HarnessSnapshotProvider extends AgentHarnessRepository {
  fetchSnapshot(agentId: Round["agentId"], domainId: Round["domainId"]): Promise<HarnessSnapshot>;
}

export interface RoundStageDependencies {
  readonly cases: { collect(round: Round): Promise<readonly PartitionCase[]> };
  readonly traces: { collect(round: Round, cases: readonly PartitionCase[]): Promise<readonly DiagnosticTrace[]> };
  readonly harnesses: HarnessSnapshotProvider;
  readonly proposals: { create(round: Round, diagnosis: DiagnosisResult, baseline: HarnessSnapshot): Promise<readonly RefinementProposal[]> };
  readonly executor: CandidateExecutor;
  readonly evaluator: EvaluatorDefinition;
  readonly exportRound: (round: Round, session: RoundArtifactSession) => Promise<void>;
}

export interface RoundStageOptions {
  readonly partitionSeed: string;
  readonly minimumReserved: number;
  readonly reservedRatio: number;
  readonly maxProposals: number;
}

interface CreateRoundStagesInput extends RoundStageDependencies {
  readonly artifacts: RoundArtifactStore;
  readonly options: RoundStageOptions;
}

function requireSession(session: RoundArtifactSession | null, stage: string): RoundArtifactSession {
  if (session === null) throw new Error(`ROUND_ARTIFACTS_MISSING:${stage}`);
  return session;
}

function emptySession(cases: readonly PartitionCase[], partition: PartitionManifest, baseline: HarnessSnapshot, capabilities: AgentCapabilities): RoundArtifactSession {
  return {
    cases,
    partition,
    baseline,
    capabilities,
    diagnosis: { evidence: [], findings: [], hypotheses: [], actionability: [] },
    refinement: { candidates: [], composed: null, rejected: [], lessons: [], stopReason: "completed" },
    reservedExecutions: [],
    evaluation: null,
  };
}

export function createRoundStages(input: CreateRoundStagesInput): RoundStageRunners {
  return {
    collect: { run: async (round) => {
      const cases = await input.cases.collect(round);
      const partition = sealPartitionManifest(partitionCases(cases, {
        seed: input.options.partitionSeed,
        minimumReserved: input.options.minimumReserved,
        reservedRatio: input.options.reservedRatio,
        createdAt: round.updatedAt,
      }));
      const [baseline, capabilities] = await Promise.all([
        input.harnesses.fetchSnapshot(round.agentId, round.domainId),
        input.harnesses.getCapabilities(round.agentId),
      ]);
      await input.artifacts.save(round.id, emptySession(cases, partition, baseline, capabilities));
    } },
    diagnose: { run: async (round) => {
      const session = requireSession(await input.artifacts.get(round.id), "diagnose");
      const diagnosisIds = new Set(session.partition.diagnosisIds);
      const diagnosisCases = session.cases.filter(({ id }) => diagnosisIds.has(id));
      const traces = await input.traces.collect(round, diagnosisCases);
      await input.artifacts.save(round.id, { ...session, diagnosis: diagnoseExecutions(round.id, traces) });
    } },
    refine: { run: async (round) => {
      const session = requireSession(await input.artifacts.get(round.id), "refine");
      const proposals = await input.proposals.create(round, session.diagnosis, session.baseline);
      const refinement = await runRefinement({
        roundId: round.id,
        baseline: session.baseline,
        proposals,
        diagnosisCaseIds: session.partition.diagnosisIds as readonly never[],
        supportedComponents: session.capabilities.editableComponents,
        maxProposals: input.options.maxProposals,
        executor: input.executor,
      });
      await input.artifacts.save(round.id, { ...session, refinement });
    } },
    execute: { run: async (round) => {
      const session = requireSession(await input.artifacts.get(round.id), "execute");
      const candidate = session.refinement.composed ?? session.refinement.candidates[0];
      if (candidate === undefined) throw new Error("ROUND_CANDIDATE_MISSING");
      const reservedExecutions = await Promise.all(session.partition.reservedIds.map(async (caseId) => ({
        baseline: await input.executor.execute({
          kind: "baseline", roundId: round.id, caseId: caseId as never, harnessVersionId: session.baseline.id,
          attempt: 1, idempotencyKey: `${round.id}:${caseId}:reserved:baseline`,
        }),
        candidate: await input.executor.execute({
          kind: "candidate", roundId: round.id, caseId: caseId as never, harnessVersionId: candidate.snapshot.id,
          candidateId: candidate.id, attempt: 1, idempotencyKey: `${round.id}:${caseId}:reserved:candidate`,
        }),
      })));
      await input.artifacts.save(round.id, { ...session, reservedExecutions });
    } },
    evaluate: { run: async (round) => {
      const session = requireSession(await input.artifacts.get(round.id), "evaluate");
      const candidate = session.refinement.composed ?? session.refinement.candidates[0];
      if (candidate === undefined) throw new Error("ROUND_CANDIDATE_MISSING");
      const signals: CandidateCaseSignal[] = session.reservedExecutions.map(({ baseline, candidate: execution }) => ({
        caseId: baseline.caseId,
        baselineExecutionId: baseline.id,
        candidateExecutionId: execution.id,
        deterministicPassed: execution.status === "succeeded",
        completionChange: execution.status === "succeeded" && baseline.status === "succeeded" ? 1 : 0,
        costChange: (execution.metrics.cost ?? 0) - (baseline.metrics.cost ?? 0),
        tokenChange: (execution.metrics.inputTokens ?? 0) + (execution.metrics.outputTokens ?? 0) - (baseline.metrics.inputTokens ?? 0) - (baseline.metrics.outputTokens ?? 0),
        latencyChange: execution.metrics.latencyMs - baseline.metrics.latencyMs,
        criticalViolations: [],
      }));
      const evaluation = evaluateCandidate({
        evaluationId: `${round.id}:${candidate.id}` as EvaluationId,
        roundId: round.id,
        candidateId: candidate.id as CandidateId,
        evaluator: input.evaluator,
        cases: signals,
      });
      await input.artifacts.save(round.id, { ...session, evaluation });
    } },
    export: {
      getCompletionEvent: async (round) => {
        const session = requireSession(await input.artifacts.get(round.id), "export-recovery");
        if (session.evaluation === null) throw new Error("ROUND_EVALUATION_MISSING");
        return terminalEventForDecision(session.evaluation.decision);
      },
      run: async (round) => {
        const session = requireSession(await input.artifacts.get(round.id), "export");
        if (session.evaluation === null) throw new Error("ROUND_EVALUATION_MISSING");
        await input.exportRound(round, session);
        return terminalEventForDecision(session.evaluation.decision);
      },
    },
  };
}