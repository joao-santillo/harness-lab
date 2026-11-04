import type { RoundId } from "@harness-lab/domain";
import type { SqliteDatabase } from "./client.js";

export interface RoundJob {
  readonly roundId: RoundId;
  readonly status: "claimed";
  readonly claimedBy: string;
}

export class SqliteRoundJobStore {
  public constructor(private readonly database: SqliteDatabase, private readonly leaseMs = 30_000) {}

  public enqueue(roundId: RoundId, now: string): void {
    this.database.prepare(`INSERT INTO round_jobs
      (round_id, status, claimed_by, claimed_at, created_at, updated_at)
      VALUES (?, 'queued', NULL, NULL, ?, ?)`)
      .run(roundId, now, now);
  }

  public claimNext(workerId: string, now: string): RoundJob | null {
    return this.database.transaction<RoundJob | null>(() => {
      const leaseCutoff = new Date(new Date(now).getTime() - this.leaseMs).toISOString();
      const candidate = this.database.prepare(
        `SELECT round_id FROM round_jobs
         WHERE status = 'queued'
           OR (status = 'cancel_requested' AND claimed_by IS NULL)
           OR (status IN ('claimed', 'cancel_requested') AND claimed_at < ?)
         ORDER BY created_at, round_id LIMIT 1`,
      ).get(leaseCutoff);
      if (candidate === undefined) return null;
      const claimed = this.database.prepare(`UPDATE round_jobs
        SET status = CASE WHEN status = 'cancel_requested' THEN status ELSE 'claimed' END,
            claimed_by = ?, claimed_at = ?, updated_at = ?
        WHERE round_id = ? AND (
          status = 'queued'
          OR (status = 'cancel_requested' AND claimed_by IS NULL)
          OR (status IN ('claimed', 'cancel_requested') AND claimed_at < ?)
        )
        RETURNING round_id`)
        .get(workerId, now, now, String(candidate.round_id), leaseCutoff);
      if (claimed === undefined) return null;
      return { roundId: String(claimed.round_id) as RoundId, status: "claimed", claimedBy: workerId };
    })();
  }

  public requestCancellation(roundId: RoundId, now: string): boolean {
    return this.database.prepare(`UPDATE round_jobs
      SET status = 'cancel_requested', updated_at = ?
      WHERE round_id = ? AND status IN ('queued', 'claimed')
      RETURNING round_id`)
      .get(now, roundId) !== undefined;
  }

  public async isCancellationRequested(roundId: RoundId): Promise<boolean> {
    return this.database.prepare("SELECT round_id FROM round_jobs WHERE round_id = ? AND status = 'cancel_requested'")
      .get(roundId) !== undefined;
  }

  public async isOwnedBy(roundId: RoundId, workerId: string): Promise<boolean> {
    return this.database.prepare("SELECT round_id FROM round_jobs WHERE round_id = ? AND status IN ('claimed', 'cancel_requested') AND claimed_by = ?")
      .get(roundId, workerId) !== undefined;
  }

  public async complete(roundId: RoundId, workerId: string): Promise<boolean> {
    return this.database.prepare("DELETE FROM round_jobs WHERE round_id = ? AND status IN ('claimed', 'cancel_requested') AND claimed_by = ? RETURNING round_id")
      .get(roundId, workerId) !== undefined;
  }

  public remove(roundId: RoundId): void {
    this.database.prepare("DELETE FROM round_jobs WHERE round_id = ?").run(roundId);
  }
}