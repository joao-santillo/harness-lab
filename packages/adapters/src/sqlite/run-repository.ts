import type {
  AgentId,
  DomainId,
  HarnessSnapshot,
  HarnessSnapshotId,
  Round,
  RoundCheckpoint,
  RoundId,
  RoundProgressCommit,
  RoundProgressEvent,
  RunRepository,
} from "@lynn-harness/domain";
import { z } from "zod";
import type { SqliteDatabase } from "./client.js";

const isoDate = z.string().datetime({ offset: true });
const roundState = z.enum([
  "setup",
  "collecting",
  "diagnosing",
  "refining",
  "executing",
  "evaluating",
  "exporting",
  "recommended",
  "rejected",
  "inconclusive",
  "pending_validation",
  "validation_insufficient",
  "stopped_by_limit",
  "cancelled",
  "integration_failed",
]);
const roundEvent = z.enum([
  "collection_started",
  "diagnosis_started",
  "refinement_started",
  "execution_started",
  "evaluation_started",
  "export_started",
  "recommendation_completed",
  "rejection_completed",
  "evaluation_inconclusive",
  "validation_pending",
  "validation_insufficient",
  "limit_reached",
  "cancel_requested",
  "integration_failed",
]);
const roundSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  domainId: z.string().min(1),
  state: roundState,
  objective: z.string(),
  createdAt: isoDate,
  updatedAt: isoDate,
});
const checkpointSchema = z.object({
  id: z.string().min(1),
  roundId: z.string().min(1),
  state: roundState,
  sequence: z.number().int().nonnegative(),
  createdAt: isoDate,
});
const eventSchema = z.object({
  id: z.string().min(1),
  roundId: z.string().min(1),
  sequence: z.number().int().nonnegative(),
  event: roundEvent,
  state: roundState,
  occurredAt: isoDate,
  messageCode: z.string().min(1),
});
const harnessSchema = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  domainId: z.string().min(1),
  version: z.string().min(1),
  components: z.record(z.string(), z.string()),
  immutableConstraints: z.array(z.string()).readonly(),
  createdAt: isoDate,
});
const agentSchema = z.object({
  id: z.string().min(1),
  domainId: z.string().min(1),
  name: z.string().min(1),
  createdAt: isoDate,
});

function toRound(value: z.infer<typeof roundSchema>): Round {
  return {
    id: value.id as Round["id"],
    agentId: value.agentId as Round["agentId"],
    domainId: value.domainId as Round["domainId"],
    state: value.state,
    objective: value.objective,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
  };
}

function toCheckpoint(value: z.infer<typeof checkpointSchema>): RoundCheckpoint {
  return {
    id: value.id as RoundCheckpoint["id"],
    roundId: value.roundId as RoundCheckpoint["roundId"],
    state: value.state,
    sequence: value.sequence,
    createdAt: value.createdAt,
  };
}

function toEvent(value: z.infer<typeof eventSchema>): RoundProgressEvent {
  return {
    id: value.id as RoundProgressEvent["id"],
    roundId: value.roundId as RoundProgressEvent["roundId"],
    sequence: value.sequence,
    event: value.event,
    state: value.state,
    occurredAt: value.occurredAt,
    messageCode: value.messageCode,
  };
}

function toHarnessSnapshot(value: z.infer<typeof harnessSchema>): HarnessSnapshot {
  return {
    id: value.id as HarnessSnapshot["id"],
    agentId: value.agentId as HarnessSnapshot["agentId"],
    domainId: value.domainId as HarnessSnapshot["domainId"],
    version: value.version,
    components: value.components,
    immutableConstraints: value.immutableConstraints,
    createdAt: value.createdAt,
  };
}

interface PayloadRow {
  readonly payload_json: string;
}

export interface PersistedAgent {
  readonly id: AgentId;
  readonly domainId: DomainId;
  readonly name: string;
  readonly createdAt: string;
}

function parseJson(value: string): unknown {
  return JSON.parse(value) as unknown;
}

export class SqliteRunRepository implements RunRepository {
  public constructor(private readonly database: SqliteDatabase) {}

  public async saveAgent(agent: PersistedAgent): Promise<void> {
    this.database.assertOpen();
    const validAgent = agentSchema.parse(agent);
    this.database
      .prepare(
        "INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)",
      )
      .run(validAgent.id, validAgent.domainId, validAgent.name, validAgent.createdAt);
    await this.database.flush();
  }

  public async saveHarnessSnapshot(snapshot: HarnessSnapshot): Promise<void> {
    this.database.assertOpen();
    const validSnapshot = harnessSchema.parse(snapshot);
    this.database
      .prepare(`
        INSERT INTO harness_versions
          (id, agent_id, domain_id, version, created_at, payload_version, payload_json)
        VALUES (?, ?, ?, ?, ?, 1, ?)
      `)
      .run(
        validSnapshot.id,
        validSnapshot.agentId,
        validSnapshot.domainId,
        validSnapshot.version,
        validSnapshot.createdAt,
        JSON.stringify(validSnapshot),
      );
    await this.database.flush();
  }

  public getHarnessSnapshot(id: HarnessSnapshotId): HarnessSnapshot | null {
    const row = this.database
      .prepare("SELECT payload_json FROM harness_versions WHERE id = ?")
      .get(id) as PayloadRow | undefined;
    return row === undefined
      ? null
      : toHarnessSnapshot(harnessSchema.parse(parseJson(row.payload_json)));
  }

  public async getRound(id: RoundId): Promise<Round | null> {
    const row = this.database
      .prepare("SELECT payload_json FROM rounds WHERE id = ?")
      .get(id) as PayloadRow | undefined;
    return row === undefined ? null : toRound(roundSchema.parse(parseJson(row.payload_json)));
  }

  public async saveRound(round: Round): Promise<void> {
    this.database.assertOpen();
    this.upsertRound(roundSchema.parse(round));
    await this.database.flush();
  }

  public async commitProgress(input: RoundProgressCommit): Promise<void> {
    this.database.assertOpen();
    const validRound = roundSchema.parse(input.round);
    const validCheckpoint = checkpointSchema.parse(input.checkpoint);
    const validEvent = eventSchema.parse(input.event);
    if (
      validCheckpoint.roundId !== validRound.id ||
      validEvent.roundId !== validRound.id
    ) {
      throw new Error("Round progress records must share the same round id");
    }

    const commit = this.database.transaction(() => {
      this.upsertRound(validRound);
      this.insertCheckpoint(validCheckpoint);
      this.insertEvent(validEvent);
    });
    commit();
    await this.database.flush();
  }

  public async listEvents(
    roundId: RoundId,
    afterSequence: number,
  ): Promise<readonly RoundProgressEvent[]> {
    const rows = this.database
      .prepare(`
        SELECT payload_json
        FROM round_events
        WHERE round_id = ? AND sequence > ?
        ORDER BY sequence ASC
      `)
      .all(roundId, afterSequence) as unknown as PayloadRow[];
    return rows.map((row) => toEvent(eventSchema.parse(parseJson(row.payload_json))));
  }

  public async saveEvent(event: RoundProgressEvent): Promise<void> {
    this.database.assertOpen();
    this.insertEvent(eventSchema.parse(event));
    await this.database.flush();
  }

  public getCheckpoint(roundId: RoundId, sequence: number): RoundCheckpoint | null {
    const row = this.database
      .prepare("SELECT payload_json FROM checkpoints WHERE round_id = ? AND sequence = ?")
      .get(roundId, sequence) as PayloadRow | undefined;
    return row === undefined
      ? null
      : toCheckpoint(checkpointSchema.parse(parseJson(row.payload_json)));
  }

  private upsertRound(round: z.infer<typeof roundSchema>): void {
    this.database
      .prepare(`
        INSERT INTO rounds
          (id, agent_id, domain_id, state, objective, created_at, updated_at, payload_version, payload_json)
        VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(id) DO UPDATE SET
          state = excluded.state,
          objective = excluded.objective,
          updated_at = excluded.updated_at,
          payload_version = excluded.payload_version,
          payload_json = excluded.payload_json
      `)
      .run(
        round.id,
        round.agentId,
        round.domainId,
        round.state,
        round.objective,
        round.createdAt,
        round.updatedAt,
        JSON.stringify(round),
      );
  }

  private insertCheckpoint(checkpoint: z.infer<typeof checkpointSchema>): void {
    this.database
      .prepare(`
        INSERT INTO checkpoints
          (id, round_id, sequence, created_at, payload_version, payload_json)
        VALUES (?, ?, ?, ?, 1, ?)
      `)
      .run(
        checkpoint.id,
        checkpoint.roundId,
        checkpoint.sequence,
        checkpoint.createdAt,
        JSON.stringify(checkpoint),
      );
  }

  private insertEvent(event: z.infer<typeof eventSchema>): void {
    this.database
      .prepare(`
        INSERT INTO round_events
          (id, round_id, sequence, occurred_at, payload_version, payload_json)
        VALUES (?, ?, ?, ?, 1, ?)
      `)
      .run(
        event.id,
        event.roundId,
        event.sequence,
        event.occurredAt,
        JSON.stringify(event),
      );
  }
}
