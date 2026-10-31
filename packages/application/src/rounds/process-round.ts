import {
  applyRoundEvent,
  type CheckpointId,
  type EventId,
  type Round,
  type RoundCheckpoint,
  type RoundEvent,
  type RoundId,
  type RoundProgressEvent,
  type RunRepository,
} from "@harness-lab/domain";

export interface RoundStageRunner {
  run(round: Round): Promise<void>;
}

export interface RoundJobControl {
  isOwnedBy(roundId: RoundId, workerId: string): Promise<boolean>;
  isCancellationRequested(roundId: RoundId): Promise<boolean>;
  complete(roundId: RoundId, workerId: string): Promise<boolean>;
}

export interface ProcessRoundOptions {
  readonly now: () => string;
  readonly createId: () => string;
}

const nextStage: Partial<Record<Round["state"], { event: RoundEvent; runner: keyof RoundStageRunners }>> = {
  setup: { event: "collection_started", runner: "collect" },
  collecting: { event: "diagnosis_started", runner: "diagnose" },
  diagnosing: { event: "refinement_started", runner: "refine" },
  refining: { event: "execution_started", runner: "execute" },
  executing: { event: "evaluation_started", runner: "evaluate" },
  evaluating: { event: "export_started", runner: "export" },
};

export interface RoundStageRunners {
  readonly collect: RoundStageRunner;
  readonly diagnose: RoundStageRunner;
  readonly refine: RoundStageRunner;
  readonly execute: RoundStageRunner;
  readonly evaluate: RoundStageRunner;
  readonly export: RoundStageRunner;
}

export class ProcessRound {
  public constructor(
    private readonly repository: RunRepository,
    private readonly jobs: RoundJobControl,
    private readonly stages: RoundStageRunners,
    private readonly options: ProcessRoundOptions,
  ) {}

  public async execute(roundId: RoundId, workerId: string): Promise<Round> {
    let round = await this.repository.getRound(roundId);
    if (round === null) throw new Error("ROUND_NOT_FOUND");
    let sequence = (await this.repository.listEvents(roundId, -1)).at(-1)?.sequence ?? -1;

    while (nextStage[round.state] !== undefined) {
      if (!await this.jobs.isOwnedBy(round.id, workerId)) throw new Error("ROUND_CLAIM_LOST");
      if (await this.jobs.isCancellationRequested(round.id)) {
        round = await this.commit(round, "cancel_requested", ++sequence);
        await this.jobs.complete(round.id, workerId);
        return round;
      }
      const stage = nextStage[round.state];
      if (stage === undefined) break;
      try {
        await this.stages[stage.runner].run(round);
      } catch {
        if (!await this.jobs.isOwnedBy(round.id, workerId)) throw new Error("ROUND_CLAIM_LOST");
        round = await this.commit(round, "integration_failed", ++sequence);
        await this.jobs.complete(round.id, workerId);
        return round;
      }
      if (!await this.jobs.isOwnedBy(round.id, workerId)) throw new Error("ROUND_CLAIM_LOST");
      round = await this.commit(round, stage.event, ++sequence);
    }
    if (round.state === "exporting") {
      if (!await this.jobs.isOwnedBy(round.id, workerId)) throw new Error("ROUND_CLAIM_LOST");
      round = await this.commit(round, "recommendation_completed", ++sequence);
    }
    await this.jobs.complete(round.id, workerId);
    return round;
  }

  private async commit(round: Round, eventName: RoundEvent, sequence: number): Promise<Round> {
    const occurredAt = this.options.now();
    const updated = applyRoundEvent(round, eventName, occurredAt);
    const checkpoint: RoundCheckpoint = {
      id: this.options.createId() as CheckpointId,
      roundId: round.id,
      state: updated.state,
      sequence,
      createdAt: occurredAt,
    };
    const event: RoundProgressEvent = {
      id: this.options.createId() as EventId,
      roundId: round.id,
      sequence,
      event: eventName,
      state: updated.state,
      occurredAt,
      messageCode: `ROUND_${eventName.toUpperCase()}`,
    };
    await this.repository.commitProgress({ round: updated, checkpoint, event });
    return updated;
  }
}