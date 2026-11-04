import type { SqliteDatabase, SqliteRoundArtifactStore, SqliteRoundJobStore, SqliteRunRepository } from "@harness-lab/adapters";
import type { AgentId, DomainId, Round, RoundId } from "@harness-lab/domain";
import type { FastifyInstance } from "fastify";
import { z } from "zod";

const roundInput = z.object({
  id: z.string().min(1),
  agentId: z.string().min(1),
  domainId: z.string().min(1),
  objective: z.string().min(1),
});

export async function registerRoundRoutes(
  server: FastifyInstance,
  database: SqliteDatabase,
  repository: SqliteRunRepository,
  jobs: SqliteRoundJobStore,
  artifacts: SqliteRoundArtifactStore,
): Promise<void> {
  server.get("/api/v1/rounds", async () => ({ items: await repository.listRounds() }));
  server.post("/api/v1/rounds", async (request, reply) => {
    const input = roundInput.safeParse(request.body);
    if (!input.success) return reply.code(400).send({ code: "ROUND_INVALID" });
    const agent = database.prepare("SELECT id FROM agents WHERE id = ? AND domain_id = ?")
      .get(input.data.agentId, input.data.domainId);
    if (agent === undefined) return reply.code(422).send({ code: "ROUND_SCOPE_INVALID" });
    const caseCount = Number(database.prepare("SELECT COUNT(*) AS count FROM cases WHERE agent_id = ? AND domain_id = ?")
      .get(input.data.agentId, input.data.domainId)?.count ?? 0);
    if (caseCount < 2) return reply.code(422).send({ code: "ROUND_CASES_INSUFFICIENT" });
    const now = new Date().toISOString();
    const round: Round = {
      id: input.data.id as RoundId,
      agentId: input.data.agentId as AgentId,
      domainId: input.data.domainId as DomainId,
      state: "setup",
      objective: input.data.objective,
      createdAt: now,
      updatedAt: now,
    };
    try {
      database.transaction(() => {
        database.prepare(`INSERT INTO rounds
          (id, agent_id, domain_id, state, objective, created_at, updated_at, payload_version, payload_json)
          VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)`)
          .run(round.id, round.agentId, round.domainId, round.state, round.objective, round.createdAt, round.updatedAt, JSON.stringify(round));
        jobs.enqueue(round.id, now);
      })();
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("UNIQUE constraint failed")) return reply.code(409).send({ code: "ROUND_ALREADY_EXISTS" });
      if (message.includes("FOREIGN KEY constraint failed") || message.includes("round scope must match agent scope")) {
        return reply.code(422).send({ code: "ROUND_SCOPE_INVALID" });
      }
      throw error;
    }
    return reply.code(201).send(round);
  });
  server.get<{ Params: { id: string } }>("/api/v1/rounds/:id", async (request, reply) => {
    const round = await repository.getRound(request.params.id as RoundId);
    return round ?? reply.code(404).send({ code: "ROUND_NOT_FOUND" });
  });
  server.get<{ Params: { id: string } }>("/api/v1/rounds/:id/results", async (request, reply) => {
    const roundId = request.params.id as RoundId;
    if (await repository.getRound(roundId) === null) return reply.code(404).send({ code: "ROUND_NOT_FOUND" });
    const session = await artifacts.get(roundId);
    if (session?.evaluation === null || session === null) return reply.code(409).send({ code: "ROUND_RESULT_NOT_READY" });
    const { evaluation } = session;
    // Não serialize a sessão inteira: ela inclui snapshot opaco e material de evidência que não pertence à resposta pública.
    return {
      roundId,
      decision: evaluation.decision,
      sampleSize: evaluation.sampleSize,
      confidence: evaluation.confidence,
      aggregateScoreChange: evaluation.aggregateScoreChange,
      costChange: evaluation.costChange,
      latencyChange: evaluation.latencyChange,
      cases: evaluation.cases,
      limitations: evaluation.limitations,
      rationale: evaluation.rationale,
    };
  });
  server.post<{ Params: { id: string } }>("/api/v1/rounds/:id/cancel", async (request, reply) => {
    const roundId = request.params.id as RoundId;
    if (await repository.getRound(roundId) === null) return reply.code(404).send({ code: "ROUND_NOT_FOUND" });
    if (!jobs.requestCancellation(roundId, new Date().toISOString())) return reply.code(409).send({ code: "ROUND_NOT_ACTIVE" });
    return reply.code(202).send({ id: roundId, cancellationRequested: true });
  });
}