import type { FastifyInstance } from "fastify";

export async function registerRoundRoutes(server: FastifyInstance): Promise<void> {
  server.get("/api/v1/rounds", async () => ({ items: [] }));
}