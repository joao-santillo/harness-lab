import {
  SqliteRoundArtifactStore,
  SqliteRoundJobStore,
  SqliteRunRepository,
  SqliteCaseRepository,
  type SqliteDatabase,
} from "@harness-lab/adapters";
import {
  createRoundStages,
  ProcessRound,
  type RoundStageDependencies,
  type RoundStageOptions,
} from "@harness-lab/application";
import { DurableRoundWorker } from "./worker.js";

export interface RoundWorkerRuntimeOptions {
  readonly database: SqliteDatabase;
  readonly workerId: string;
  readonly now: () => string;
  readonly createId: () => string;
  readonly stageDependencies: Omit<RoundStageDependencies, "cases"> & {
    readonly cases?: RoundStageDependencies["cases"];
  };
  readonly stageOptions: RoundStageOptions;
}

export interface WorkerProviderFactoryContext {
  readonly database: SqliteDatabase;
  readonly encryptionKey: string;
}

export interface WorkerProviderModule {
  createRoundStageDependencies(context: WorkerProviderFactoryContext): Promise<RoundWorkerRuntimeOptions["stageDependencies"]> | RoundWorkerRuntimeOptions["stageDependencies"];
}

export interface RoundWorkerRuntime {
  readonly worker: DurableRoundWorker;
  readonly repository: SqliteRunRepository;
  readonly jobs: SqliteRoundJobStore;
  readonly artifacts: SqliteRoundArtifactStore;
  readonly cases: SqliteCaseRepository;
  tick(): Promise<boolean>;
}

export function createRoundWorkerRuntime(options: RoundWorkerRuntimeOptions): RoundWorkerRuntime {
  const repository = new SqliteRunRepository(options.database);
  const jobs = new SqliteRoundJobStore(options.database);
  const artifacts = new SqliteRoundArtifactStore(options.database);
  const cases = new SqliteCaseRepository(options.database);
  const stages = createRoundStages({
    ...options.stageDependencies,
    cases: options.stageDependencies.cases ?? {
      collect: (round) => cases.listByScope(round.agentId, round.domainId),
    },
    artifacts,
    options: options.stageOptions,
  });
  const processor = new ProcessRound(repository, jobs, stages, {
    now: options.now,
    createId: options.createId,
  });
  const worker = new DurableRoundWorker(jobs, processor, {
    workerId: options.workerId,
    now: options.now,
  });

  return {
    worker,
    repository,
    jobs,
    artifacts,
    cases,
    tick: () => worker.tick(),
  };
}