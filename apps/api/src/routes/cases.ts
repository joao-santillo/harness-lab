import type { CaseRecord, CaseSource } from "@harness-lab/domain";
import type { SqliteCaseRepository } from "@harness-lab/adapters";
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

export async function registerCaseRoutes(server: FastifyInstance, repository: SqliteCaseRepository): Promise<void> {
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

  server.get("/api/v1/cases", async (request, reply) => {
    const query = listQuery.safeParse(request.query);
    if (!query.success) return reply.code(400).send({ code: "CASE_SCOPE_REQUIRED" });
    const items = await repository.listByScope(query.data.agentId as CaseRecord["agentId"], query.data.domainId as CaseRecord["domainId"]);
    return { items };
  });
}