import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SqliteDatabase } from "@harness-lab/adapters";

const agentInput = z.object({
  id: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/),
  domainId: z.string().min(1).max(120).regex(/^[a-z0-9][a-z0-9-]*$/),
  name: z.string().trim().min(1).max(120),
});

export async function registerAgentRoutes(server: FastifyInstance, database: SqliteDatabase): Promise<void> {
  server.get("/api/v1/agents", async () => ({
    items: database.prepare("SELECT id, domain_id AS domainId, name, created_at AS createdAt FROM agents ORDER BY created_at, id").all(),
  }));
  server.post("/api/v1/agents", async (request, reply) => {
    const parsed = agentInput.safeParse(request.body);
    if (!parsed.success) return reply.code(400).send({ code: "AGENT_INVALID" });
    const createdAt = new Date().toISOString();
    try {
      database.prepare("INSERT INTO agents (id, domain_id, name, created_at) VALUES (?, ?, ?, ?)")
        .run(parsed.data.id, parsed.data.domainId, parsed.data.name, createdAt);
    } catch (error) {
      if (error instanceof Error && error.message.includes("UNIQUE constraint failed")) {
        return reply.code(409).send({ code: "AGENT_ALREADY_EXISTS" });
      }
      throw error;
    }
    return reply.code(201).send({ ...parsed.data, createdAt });
  });
}