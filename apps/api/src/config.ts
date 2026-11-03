import { dirname } from "node:path";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// API e worker resolvem APP_DATA_DIR pela mesma raiz para não abrir bancos diferentes conforme o CWD.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface ApiConfig {
  readonly encryptionKey: string;
  readonly databasePath: string;
  readonly host: string;
  readonly port: number;
}

function parseEncryptionKey(value: string | undefined): string {
  if (value === undefined) throw new Error("APP_ENCRYPTION_KEY_INVALID");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) throw new Error("APP_ENCRYPTION_KEY_INVALID");
  return value;
}

function parsePort(value: string | undefined, defaultValue: number): number {
  if (value === undefined) return defaultValue;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("API_PORT_INVALID");
  return port;
}

export function resolveApiConfig(env: NodeJS.ProcessEnv): ApiConfig {
  const dataDir = resolve(projectRoot, env.APP_DATA_DIR ?? "./data");
  const host = env.API_HOST ?? "127.0.0.1";
  if (host.trim().length === 0) throw new Error("API_HOST_INVALID");
  return {
    encryptionKey: parseEncryptionKey(env.APP_ENCRYPTION_KEY),
    databasePath: resolve(dataDir, "harness.sqlite"),
    host,
    port: parsePort(env.API_PORT, 3000),
  };
}