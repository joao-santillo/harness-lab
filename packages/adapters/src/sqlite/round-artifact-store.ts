import type { RoundArtifactSession, RoundArtifactStore } from "@harness-lab/application";
import type { RoundId } from "@harness-lab/domain";
import { z } from "zod";
import type { SqliteDatabase } from "./client.js";

const sessionSchema = z.object({
  cases: z.array(z.object({ id: z.string(), sessionId: z.string(), similarityGroup: z.string(), content: z.string() })),
  partition: z.object({
    version: z.literal(1), seed: z.string(), diagnosisIds: z.array(z.string()),
    reservedIds: z.array(z.string()), createdAt: z.string(),
  }),
  baseline: z.object({
    id: z.string(), agentId: z.string(), domainId: z.string(), version: z.string(),
    components: z.record(z.string(), z.string()), immutableConstraints: z.array(z.string()), createdAt: z.string(),
    sourceVersion: z.string().optional(), artifactHash: z.string().optional(),
    opaquePayload: z.record(z.string(), z.unknown()).optional(),
  }),
  capabilities: z.object({ editableComponents: z.array(z.string()), supportsSeed: z.boolean(), supportsToolReplay: z.boolean() }),
  diagnosis: z.object({ evidence: z.array(z.unknown()), findings: z.array(z.unknown()), hypotheses: z.array(z.unknown()), actionability: z.array(z.unknown()) }),
  refinement: z.object({ candidates: z.array(z.unknown()), composed: z.unknown().nullable(), rejected: z.array(z.unknown()), lessons: z.array(z.unknown()), stopReason: z.enum(["completed", "proposal_limit_reached"]) }),
  reservedExecutions: z.array(z.object({ baseline: z.unknown(), candidate: z.unknown() })),
  evaluation: z.unknown().nullable(),
});

export class SqliteRoundArtifactStore implements RoundArtifactStore {
  constructor(private readonly database: SqliteDatabase) {}

  async get(roundId: RoundId): Promise<RoundArtifactSession | null> {
    const row = this.database.prepare("SELECT payload_version, payload_json FROM round_artifacts WHERE round_id = ?").get(roundId);
    if (row === undefined) return null;
    // Versão desconhecida interrompe a retomada; interpretar payload novo como antigo poderia mudar uma decisão auditável.
    if (row.payload_version !== 1) throw new Error("ROUND_ARTIFACT_VERSION_UNSUPPORTED");
    return sessionSchema.parse(JSON.parse(String(row.payload_json))) as unknown as RoundArtifactSession;
  }

  async save(roundId: RoundId, session: RoundArtifactSession): Promise<void> {
    const payload = JSON.stringify(sessionSchema.parse(session));
    this.database.transaction(() => {
      this.database.prepare(`
        INSERT INTO round_artifacts (round_id, payload_version, payload_json, updated_at)
        VALUES (?, 1, ?, ?)
        ON CONFLICT(round_id) DO UPDATE SET
          payload_version = excluded.payload_version,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `).run(roundId, payload, new Date().toISOString());
    })();
    await this.database.flush();
  }
}