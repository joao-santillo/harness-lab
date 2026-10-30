import type { FastifyInstance } from "fastify";

export async function registerEventRoutes(server: FastifyInstance): Promise<void> {
  server.get<{ Params: { roundId: string } }>("/api/v1/rounds/:roundId/events", async () => ({ items: [] }));
}