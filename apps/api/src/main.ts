import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { buildServer } from "./server.js";
import { resolveApiConfig } from "./config.js";

export async function startApi(env: NodeJS.ProcessEnv = process.env) {
  const config = resolveApiConfig(env);
  await mkdir(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const server = await buildServer({
    encryptionKey: config.encryptionKey,
    databasePath: config.databasePath,
  });
  await server.listen({ host: config.host, port: config.port });
  return server;
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  try {
    const server = await startApi();
    console.info("Harness Lab API listening");
    const close = async () => { await server.close(); };
    process.once("SIGINT", () => { void close(); });
    process.once("SIGTERM", () => { void close(); });
  } catch {
    console.error("API_START_FAILED: check APP_ENCRYPTION_KEY, APP_DATA_DIR, API_HOST, and API_PORT");
    process.exitCode = 1;
  }
}