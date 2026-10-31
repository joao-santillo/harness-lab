import type { RoundId, RoundProgressEvent, RunRepository } from "@harness-lab/domain";
import type { FastifyInstance } from "fastify";

export interface EventStreamOptions {
  readonly pollIntervalMs: number;
  readonly heartbeatIntervalMs: number;
}

const terminalStates = new Set([
  "recommended", "rejected", "inconclusive", "pending_validation", "validation_insufficient",
  "stopped_by_limit", "cancelled", "integration_failed",
]);

function serializeEvent(event: RoundProgressEvent): string {
  return `id: ${event.sequence}\nevent: round-progress\ndata: ${JSON.stringify(event)}\n\n`;
}

function requestedSequence(header: string | string[] | undefined): number {
  const value = Array.isArray(header) ? header[0] : header;
  if (value === undefined) return -1;
  const sequence = Number.parseInt(value, 10);
  return Number.isSafeInteger(sequence) && sequence >= -1 ? sequence : -1;
}

export async function registerEventRoutes(
  server: FastifyInstance,
  repository: RunRepository,
  options: EventStreamOptions = { pollIntervalMs: 250, heartbeatIntervalMs: 15_000 },
): Promise<void> {
  server.get<{ Params: { roundId: string } }>("/api/v1/rounds/:roundId/events", async (request, reply) => {
    const roundId = request.params.roundId as RoundId;
    if (await repository.getRound(roundId) === null) return reply.code(404).send({ code: "ROUND_NOT_FOUND" });
    let sequence = requestedSequence(request.headers["last-event-id"]);
    reply.raw.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    });
    let lastWrite = Date.now();
    while (!reply.raw.destroyed) {
      const events = await repository.listEvents(roundId, sequence);
      for (const event of events) {
        reply.raw.write(serializeEvent(event));
        sequence = event.sequence;
        lastWrite = Date.now();
      }
      const round = await repository.getRound(roundId);
      if (round === null || terminalStates.has(round.state)) break;
      if (Date.now() - lastWrite >= options.heartbeatIntervalMs) {
        reply.raw.write(": heartbeat\n\n");
        lastWrite = Date.now();
      }
      await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs));
    }
    if (!reply.raw.destroyed) reply.raw.end();
  });
}