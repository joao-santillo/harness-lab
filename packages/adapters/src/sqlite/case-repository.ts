import type { CaseRecord, CaseRepository } from "@harness-lab/domain";
import { z } from "zod";
import type { SqliteDatabase } from "./client.js";

const caseSchema = z.object({
  id: z.string().min(1).max(120),
  agentId: z.string().min(1).max(120),
  domainId: z.string().min(1).max(120),
  sessionId: z.string().min(1).max(200),
  similarityGroup: z.string().min(1).max(200),
  content: z.string().min(1).max(20_000),
  source: z.enum(["manual", "json", "csv", "historical", "synthetic"]),
  sourceReference: z.string().min(1).max(500).optional(),
  syntheticLabel: z.literal("SYNTHETIC").optional(),
  createdAt: z.string().datetime({ offset: true }),
}).superRefine((record, context) => {
  if (record.source === "historical" && record.sourceReference === undefined) {
    context.addIssue({ code: "custom", path: ["sourceReference"], message: "HISTORICAL_SOURCE_REFERENCE_REQUIRED" });
  }
  if (record.source === "synthetic" && record.syntheticLabel !== "SYNTHETIC") {
    context.addIssue({ code: "custom", path: ["syntheticLabel"], message: "SYNTHETIC_LABEL_REQUIRED" });
  }
});

const MAX_CASES_PER_IMPORT = 500;

export class SqliteCaseRepository implements CaseRepository {
  constructor(private readonly database: SqliteDatabase) {}

  async saveMany(cases: readonly CaseRecord[]): Promise<number> {
    if (cases.length === 0 || cases.length > MAX_CASES_PER_IMPORT) throw new Error("CASE_IMPORT_SIZE_INVALID");
    const parsed = cases.map((item) => caseSchema.parse(item));
    if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) throw new Error("CASE_ID_DUPLICATE");
    const createdAt = new Date().toISOString();
    try {
      // O lote é uma única transação: ID duplicado ou violação de escopo não pode deixar importação parcial.
      this.database.transaction(() => {
        const insert = this.database.prepare(`INSERT INTO cases
          (id, agent_id, domain_id, created_at, payload_version, payload_json)
          VALUES (?, ?, ?, ?, 1, ?)`);
        for (const item of parsed) insert.run(item.id, item.agentId, item.domainId, createdAt, JSON.stringify(item));
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE constraint failed: cases.id")) throw new Error("CASE_ALREADY_EXISTS");
      if (message.includes("FOREIGN KEY constraint failed") || message.includes("case scope must match agent scope")) {
        throw new Error("CASE_SCOPE_INVALID");
      }
      throw error;
    }
    await this.database.flush();
    return parsed.length;
  }

  async saveManyIgnoringExisting(cases: readonly CaseRecord[]): Promise<number> {
    if (cases.length === 0 || cases.length > MAX_CASES_PER_IMPORT) throw new Error("CASE_IMPORT_SIZE_INVALID");
    const parsed = cases.map((item) => caseSchema.parse(item));
    if (new Set(parsed.map(({ id }) => id)).size !== parsed.length) throw new Error("CASE_ID_DUPLICATE");
    const createdAt = new Date().toISOString();
    let inserted = 0;
    try {
      this.database.transaction(() => {
        const insert = this.database.prepare(`INSERT OR IGNORE INTO cases
          (id, agent_id, domain_id, created_at, payload_version, payload_json)
          VALUES (?, ?, ?, ?, 1, ?)`);
        for (const item of parsed) {
          insert.run(item.id, item.agentId, item.domainId, createdAt, JSON.stringify(item));
          const row = this.database.prepare("SELECT changes() AS count").get();
          inserted += Number(row?.count ?? 0);
        }
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("FOREIGN KEY constraint failed") || message.includes("case scope must match agent scope")) {
        throw new Error("CASE_SCOPE_INVALID");
      }
      throw error;
    }
    await this.database.flush();
    return inserted;
  }

  async listByScope(agentId: CaseRecord["agentId"], domainId: CaseRecord["domainId"]): Promise<readonly CaseRecord[]> {
    const rows = this.database.prepare(`SELECT payload_version, payload_json FROM cases
      WHERE agent_id = ? AND domain_id = ? ORDER BY created_at, id`).all(agentId, domainId);
    return rows.map((row) => {
      if (row.payload_version !== 1) throw new Error("CASE_PAYLOAD_VERSION_UNSUPPORTED");
      const value = caseSchema.parse(JSON.parse(String(row.payload_json)));
      if (value.agentId !== agentId || value.domainId !== domainId) throw new Error("CASE_SCOPE_CORRUPT");
      return value as unknown as CaseRecord;
    });
  }
}