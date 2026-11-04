import { createHash } from "node:crypto";
import type { CaseRecord, CaseSource, SecretId, SecretStore } from "@harness-lab/domain";
import {
  LangfuseCaseImportRepository,
  LangfuseClient,
  negotiateLangfuseCapabilities,
  type SqliteCaseRepository,
  type SqliteDatabase,
} from "@harness-lab/adapters";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { parseCaseCsv } from "./case-csv.js";

const importSchema = z.object({
  agentId: z.string().min(1).max(120),
  domainId: z.string().min(1).max(120),
  source: z.enum(["manual", "json", "historical", "synthetic"]),
  sourceReference: z.string().trim().min(1).max(500).optional(),
  cases: z.array(z.object({
    id: z.string().min(1).max(120),
    sessionId: z.string().min(1).max(200),
    similarityGroup: z.string().min(1).max(200),
    content: z.string().trim().min(1).max(20_000),
    syntheticLabel: z.literal("SYNTHETIC").optional(),
  })).min(1).max(40),
}).superRefine((input, context) => {
  // Proveniência histórica precisa apontar para uma origem; dados sintéticos nunca podem parecer observações reais.
  if (input.source === "historical" && input.sourceReference === undefined) {
    context.addIssue({ code: "custom", path: ["sourceReference"], message: "HISTORICAL_SOURCE_REFERENCE_REQUIRED" });
  }
  if (input.source === "synthetic") input.cases.forEach((item, index) => {
    if (item.syntheticLabel !== "SYNTHETIC") context.addIssue({ code: "custom", path: ["cases", index, "syntheticLabel"], message: "SYNTHETIC_LABEL_REQUIRED" });
  });
});
const listQuery = z.object({ agentId: z.string().min(1), domainId: z.string().min(1) });
const csvImportSchema = z.object({ agentId: z.string().min(1).max(120), domainId: z.string().min(1).max(120), csv: z.string().min(1).max(250_000) });
const langfuseImportSchema = z.object({
  agentId: z.string().min(1).max(120),
  domainId: z.string().min(1).max(120),
  connectionId: z.string().min(3).max(100),
  fromStartTime: z.string().datetime({ offset: true }),
  toStartTime: z.string().datetime({ offset: true }),
  limit: z.number().int().min(1).max(40),
  filter: z.object({
    field: z.enum(["traceName", "environment", "tags", "userId", "sessionId"]),
    value: z.string().trim().min(1).max(200),
  }).optional(),
}).superRefine((input, context) => {
  if (Date.parse(input.fromStartTime) >= Date.parse(input.toStartTime)) {
    context.addIssue({ code: "custom", path: ["toStartTime"], message: "CASE_LANGFUSE_INVALID" });
  }
});

interface CaseRouteDependencies {
  readonly database?: SqliteDatabase;
  readonly secretStore?: SecretStore;
  readonly fetch?: typeof fetch;
}

function langfuseCaseId(connectionId: string, traceId: string): CaseRecord["id"] {
  return `langfuse-${createHash("sha256").update(`${connectionId}:${traceId}`).digest("hex").slice(0, 64)}` as CaseRecord["id"];
}

function mapImportError(error: unknown): { status: number; code: string } | null {
  const code = error instanceof Error ? error.message : "";
  if (code === "LANGFUSE_INVALID_CREDENTIALS") return { status: 422, code: "CONNECTION_AUTH_FAILED" };
  if (code.startsWith("LANGFUSE_") || code === "LANGFUSE_CASE_IMPORT_LIMIT_EXCEEDED") {
    return { status: 503, code: "CONNECTION_UNAVAILABLE" };
  }
  return null;
}

export async function registerCaseRoutes(
  server: FastifyInstance,
  repository: SqliteCaseRepository,
  dependencies: CaseRouteDependencies = {},
): Promise<void> {
  server.post("/api/v1/cases/import-csv", async (request, reply) => {
    const parsed = csvImportSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "CASE_CSV_INVALID" });
    let rows: ReturnType<typeof parseCaseCsv>;
    try {
      rows = parseCaseCsv(parsed.data.csv);
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      return reply.code(400).send({ code: code === "CASE_CSV_SIZE_INVALID" ? code : "CASE_CSV_INVALID" });
    }
    const createdAt = new Date().toISOString();
    const cases: CaseRecord[] = rows.map((item) => ({
      ...item,
      id: item.id as CaseRecord["id"],
      agentId: parsed.data.agentId as CaseRecord["agentId"],
      domainId: parsed.data.domainId as CaseRecord["domainId"],
      source: "csv",
      createdAt,
    }));
    try {
      return reply.code(201).send({ imported: await repository.saveMany(cases) });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "CASE_ALREADY_EXISTS") return reply.code(409).send({ code });
      if (code === "CASE_SCOPE_INVALID") return reply.code(422).send({ code });
      if (code === "CASE_ID_DUPLICATE") return reply.code(400).send({ code });
      throw error;
    }
  });

  server.post("/api/v1/cases/import", async (request, reply) => {
    const parsed = importSchema.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "CASE_IMPORT_INVALID" });
    const createdAt = new Date().toISOString();
    const cases: CaseRecord[] = parsed.data.cases.map((item) => ({
      id: item.id as CaseRecord["id"],
      agentId: parsed.data.agentId as CaseRecord["agentId"],
      domainId: parsed.data.domainId as CaseRecord["domainId"],
      sessionId: item.sessionId,
      similarityGroup: item.similarityGroup,
      content: item.content,
      source: parsed.data.source as CaseSource,
      ...(parsed.data.sourceReference === undefined ? {} : { sourceReference: parsed.data.sourceReference }),
      ...(item.syntheticLabel === undefined ? {} : { syntheticLabel: item.syntheticLabel }),
      createdAt,
    }));
    try {
      const imported = await repository.saveMany(cases);
      return reply.code(201).send({ imported });
    } catch (error) {
      const code = error instanceof Error ? error.message : "";
      if (code === "CASE_ALREADY_EXISTS") return reply.code(409).send({ code });
      if (code === "CASE_SCOPE_INVALID") return reply.code(422).send({ code });
      if (code === "CASE_ID_DUPLICATE") return reply.code(400).send({ code });
      throw error;
    }
  });

  server.post("/api/v1/cases/import-langfuse", async (request, reply) => {
    const parsed = langfuseImportSchema.safeParse(request.body);
    if (!parsed.success || dependencies.database === undefined || dependencies.secretStore === undefined) {
      return reply.code(400).send({ code: "CASE_LANGFUSE_INVALID" });
    }
    const { database, secretStore } = dependencies;
    const agent = database.prepare("SELECT id FROM agents WHERE id = ? AND domain_id = ?")
      .get(parsed.data.agentId, parsed.data.domainId);
    if (agent === undefined) return reply.code(422).send({ code: "AGENT_SCOPE_INVALID" });
    const connection = database.prepare("SELECT id, kind FROM connection_registrations WHERE id = ?")
      .get(parsed.data.connectionId);
    if (connection === undefined) return reply.code(404).send({ code: "CONNECTION_NOT_FOUND" });
    if (connection.kind !== "langfuse") return reply.code(422).send({ code: "CONNECTION_KIND_INVALID" });

    let credentials: { baseUrl: string; publicKey: string; secretKey: string };
    try {
      const secret = await secretStore.get(parsed.data.connectionId as SecretId);
      if (secret === null) return reply.code(422).send({ code: "CONNECTION_AUTH_FAILED" });
      credentials = z.object({ baseUrl: z.string().url(), publicKey: z.string().min(1), secretKey: z.string().min(1) }).parse(JSON.parse(secret.value));
    } catch {
      return reply.code(422).send({ code: "CONNECTION_AUTH_FAILED" });
    }

    try {
      const client = new LangfuseClient({ ...credentials, ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }) });
      let capabilities;
      try {
        capabilities = await negotiateLangfuseCapabilities(client);
      } catch (error) {
        const code = error instanceof Error ? error.message : "";
        if (code === "LANGFUSE_INVALID_CREDENTIALS") return reply.code(422).send({ code: "CONNECTION_AUTH_FAILED" });
        return reply.code(503).send({ code: "CONNECTION_UNAVAILABLE" });
      }
      const importer = new LangfuseCaseImportRepository({
        client,
        observationsApi: capabilities.observationsApi,
        sourceReferencePrefix: `langfuse:${parsed.data.connectionId}:`,
      });
      const result = await importer.importCases({
        fromStartTime: parsed.data.fromStartTime,
        toStartTime: parsed.data.toStartTime,
        limit: parsed.data.limit,
        ...(parsed.data.filter === undefined ? {} : { filter: parsed.data.filter }),
      });
      const cases: CaseRecord[] = result.candidates.map((candidate) => ({
        id: langfuseCaseId(parsed.data.connectionId, candidate.traceId),
        agentId: parsed.data.agentId as CaseRecord["agentId"],
        domainId: parsed.data.domainId as CaseRecord["domainId"],
        sessionId: candidate.sessionId,
        similarityGroup: candidate.similarityGroup,
        content: candidate.content,
        source: "historical" as const,
        sourceReference: `langfuse:${parsed.data.connectionId}:${candidate.traceId}`,
        createdAt: new Date().toISOString(),
      }));
      const imported = cases.length === 0 ? 0 : await repository.saveManyIgnoringExisting(cases);
      const limitations = [...capabilities.limitations, ...result.limitations];
      return reply.code(201).send({
        imported,
        skipped: result.skipped + (cases.length - imported),
        source: { connectionId: parsed.data.connectionId, fromStartTime: parsed.data.fromStartTime, toStartTime: parsed.data.toStartTime },
        limitations,
      });
    } catch (error) {
      const mapped = mapImportError(error);
      if (mapped !== null) return reply.code(mapped.status).send({ code: mapped.code });
      throw error;
    }
  });

  server.get("/api/v1/cases", async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: "CASE_SCOPE_REQUIRED" });
    const items = await repository.listByScope(query.data.agentId as CaseRecord["agentId"], query.data.domainId as CaseRecord["domainId"]);
    return { items };
  });
}