import type { FastifyInstance } from "fastify";

export async function registerAgentRoutes(server: FastifyInstance): Promise<void> {
  server.get("/api/v1/agents", async () => ({ items: [] }));
}