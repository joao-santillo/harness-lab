import type { ConnectionView, RegisterConnection } from "@lynn-harness/application";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { SecretId, SecretStore } from "@lynn-harness/domain";
import type { SqliteDatabase } from "@lynn-harness/adapters";
import { localize } from "../i18n.js";

const connectionSchema = z.object({
  id: z.string().min(3).max(100).regex(/^[a-z0-9][a-z0-9-]*$/),
  kind: z.enum(["langfuse", "lynn"]),
  name: z.string().min(1).max(120),
  credentials: z.record(z.string(), z.string().min(1)).refine((value) => Object.keys(value).length > 0),
});

function serialize(row: Record<string, unknown>): ConnectionView {
  return { id: String(row.id), kind: row.kind as ConnectionView["kind"], name: String(row.name), configured: true };
}

export async function registerConnectionRoutes(
  server: FastifyInstance,
  database: SqliteDatabase,
  secretStore: SecretStore,
  registerConnection: RegisterConnection,
): Promise<void> {
  server.post("/api/v1/connections", async (request, reply) => {
    const parsed = connectionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        code: "CONNECTION_INVALID",
        message: localize("CONNECTION_INVALID", request.headers["accept-language"]),
      });
    }
    const idempotencyKey = request.headers["idempotency-key"];
    const result = await registerConnection.execute({
      ...parsed.data,
      idempotencyKey: typeof idempotencyKey === "string" ? idempotencyKey : null,
    });
    return reply.code(result.status === "created" ? 201 : 200).send(result.connection);
  });

  server.get<{ Params: { id: string } }>("/api/v1/connections/:id", async (request, reply) => {
    const row = database.prepare("SELECT id, kind, name FROM connection_registrations WHERE id = ?").get(request.params.id);
    if (row === undefined) {
      return reply.code(404).send({
        code: "CONNECTION_NOT_FOUND",
        message: localize("CONNECTION_NOT_FOUND", request.headers["accept-language"]),
      });
    }
    return serialize(row);
  });

  server.get<{ Params: { id: string } }>("/api/v1/connections/:id/credentials", async (request, reply) => {
    const row = database.prepare("SELECT id FROM connection_registrations WHERE id = ?").get(request.params.id);
    const secret = row === undefined ? null : await secretStore.get(request.params.id as SecretId);
    if (secret === null) {
      return reply.code(404).send({
        code: "CONNECTION_NOT_FOUND",
        message: localize("CONNECTION_NOT_FOUND", request.headers["accept-language"]),
      });
    }
    return { connectionId: request.params.id, configured: true };
  });

  server.delete<{ Params: { id: string } }>("/api/v1/connections/:id", async (request, reply) => {
    database.transaction(() => {
      database.prepare("DELETE FROM encrypted_secrets WHERE id = ?").run(request.params.id);
    })();
    return reply.code(204).send();
  });
}