import type { ProcessRound } from "@lynn-harness/application";
import type { RoundId } from "@lynn-harness/domain";

export interface ClaimedRoundJob {
  readonly roundId: RoundId;
  readonly claimedBy?: string;
}

export interface RoundJobClaimer {
  claimNext(workerId: string, now: string): ClaimedRoundJob | null;
}

export interface WorkerOptions {
  readonly workerId: string;
  readonly now: () => string;
}

export class DurableRoundWorker {
  public constructor(
    private readonly jobs: RoundJobClaimer,
    private readonly processor: Pick<ProcessRound, "execute">,
    private readonly options: WorkerOptions,
  ) {}

  public async tick(): Promise<boolean> {
    const job = this.jobs.claimNext(this.options.workerId, this.options.now());
    if (job === null) return false;
    await this.processor.execute(job.roundId, this.options.workerId);
    return true;
  }
}