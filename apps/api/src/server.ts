import Fastify, { type FastifyInstance } from "fastify";
import { ConnectionTestError, RegisterConnection, type ConnectionTester } from "@lynn-harness/application";
import {
  EncryptedSqliteSecretStore,
  openSqliteDatabase,
  SqliteConnectionRegistrationStore,
  type SqliteDatabase,
} from "@lynn-harness/adapters";
import { registerAgentRoutes } from "./routes/agents.js";
import { registerConnectionRoutes } from "./routes/connections.js";
import { registerEventRoutes } from "./routes/events.js";
import { registerRoundRoutes } from "./routes/rounds.js";
import { localize } from "./i18n.js";

export interface ServerOptions {
  readonly encryptionKey: string;
  readonly databasePath?: string;
  readonly connectionTester: ConnectionTester;
}

export async function buildServer(options: ServerOptions): Promise<FastifyInstance> {
  const server = Fastify({ logger: false });
  const database: SqliteDatabase = await openSqliteDatabase(options.databasePath ?? ":memory:");
  const secretStore = new EncryptedSqliteSecretStore(database, options.encryptionKey);
  const registrationStore = new SqliteConnectionRegistrationStore(database, options.encryptionKey);
  await registerConnectionRoutes(server, database, secretStore, new RegisterConnection(options.connectionTester, registrationStore));
  await registerAgentRoutes(server);
  await registerRoundRoutes(server);
  await registerEventRoutes(server);
  server.setNotFoundHandler((request, reply) => reply.code(404).send({
    code: "ROUTE_NOT_FOUND",
    message: localize("ROUTE_NOT_FOUND", request.headers["accept-language"]),
  }));
  server.setErrorHandler((error, request, reply) => {
    if (error.message === "IDEMPOTENCY_CONFLICT") {
      return reply.code(409).send({
        code: "IDEMPOTENCY_CONFLICT",
        message: localize("IDEMPOTENCY_CONFLICT", request.headers["accept-language"]),
      });
    }
    if (error instanceof ConnectionTestError) {
      return reply.code(error.code === "CONNECTION_AUTH_FAILED" ? 422 : 503).send({
        code: error.code,
        message: localize(error.code, request.headers["accept-language"]),
      });
    }
    return reply.code(500).send({
      code: "REQUEST_FAILED",
      message: localize("REQUEST_FAILED", request.headers["accept-language"]),
    });
  });
  server.addHook("onClose", async () => database.close());
  return server;
}