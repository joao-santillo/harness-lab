import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Deve usar a mesma raiz da API; o worker compartilha fila, cases e checkpoints no mesmo SQLite.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");

export interface WorkerConfig {
  readonly encryptionKey: string;
  readonly databasePath: string;
  readonly providerModule: string;
  readonly workerId: string;
  readonly pollIntervalMs: number;
  readonly partitionSeed: string;
  readonly minimumReserved: number;
  readonly reservedRatio: number;
  readonly maxProposals: number;
}

function validKey(value: string | undefined): string {
  if (value === undefined) throw new Error("APP_ENCRYPTION_KEY_INVALID");
  const decoded = Buffer.from(value, "base64");
  if (decoded.length !== 32 || decoded.toString("base64") !== value) throw new Error("APP_ENCRYPTION_KEY_INVALID");
  return value;
}

function integer(value: string | undefined, fallback: number, min: number, max: number, code: string): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(code);
  return parsed;
}

export function resolveWorkerConfig(env: NodeJS.ProcessEnv, baseDir = process.cwd()): WorkerConfig {
  const encryptionKey = validKey(env.APP_ENCRYPTION_KEY);
  if (!env.WORKER_PROVIDER_MODULE) throw new Error("WORKER_PROVIDER_MODULE_REQUIRED");
  const providerModule = resolve(baseDir, env.WORKER_PROVIDER_MODULE);
  const dataDir = resolve(projectRoot, env.APP_DATA_DIR ?? "./data");
  const reservedRatio = env.ROUND_RESERVED_RATIO === undefined ? 0.2 : Number(env.ROUND_RESERVED_RATIO);
  if (!Number.isFinite(reservedRatio) || reservedRatio <= 0 || reservedRatio >= 1) throw new Error("ROUND_RESERVED_RATIO_INVALID");
  return {
    encryptionKey,
    databasePath: resolve(dataDir, "harness.sqlite"),
    providerModule,
    workerId: env.WORKER_ID ?? `worker-${process.pid}`,
    pollIntervalMs: integer(env.WORKER_POLL_INTERVAL_MS, 1000, 100, 60_000, "WORKER_POLL_INTERVAL_INVALID"),
    partitionSeed: env.ROUND_PARTITION_SEED ?? "round-partition-v1",
    minimumReserved: integer(env.ROUND_MINIMUM_RESERVED, 1, 1, 100, "ROUND_MINIMUM_RESERVED_INVALID"),
    reservedRatio,
    maxProposals: integer(env.ROUND_MAX_PROPOSALS, 3, 1, 20, "ROUND_MAX_PROPOSALS_INVALID"),
  };
}