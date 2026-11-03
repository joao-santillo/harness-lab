import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";
import { openSqliteDatabase } from "@harness-lab/adapters";
import { resolveWorkerConfig } from "./config.js";
import { createRoundWorkerRuntime, type WorkerProviderModule } from "./runtime.js";

export async function startWorker(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = resolveWorkerConfig(env);
  await mkdir(dirname(config.databasePath), { recursive: true, mode: 0o700 });
  const database = await openSqliteDatabase(config.databasePath);
  let stopping = false;
  const stop = () => { stopping = true; };
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    // Providers pertencem ao deployment: não criamos endpoints, políticas de proposta ou exports por suposição.
    const providerUrl = pathToFileURL(config.providerModule).href;
    const providerModule = await import(providerUrl) as Partial<WorkerProviderModule>;
    if (typeof providerModule.createRoundStageDependencies !== "function") throw new Error("WORKER_PROVIDER_MODULE_INVALID");
    const stageDependencies = await providerModule.createRoundStageDependencies({
      database,
      encryptionKey: config.encryptionKey,
    });
    const runtime = createRoundWorkerRuntime({
      database,
      workerId: config.workerId,
      now: () => new Date().toISOString(),
      createId: () => crypto.randomUUID(),
      stageDependencies,
      stageOptions: {
        partitionSeed: config.partitionSeed,
        minimumReserved: config.minimumReserved,
        reservedRatio: config.reservedRatio,
        maxProposals: config.maxProposals,
      },
    });
    console.info("Harness Lab worker started");
    while (!stopping) {
      const processed = await runtime.tick();
      if (!processed && !stopping) await new Promise((resolve) => setTimeout(resolve, config.pollIntervalMs));
    }
  } finally {
    process.removeListener("SIGINT", stop);
    process.removeListener("SIGTERM", stop);
    await database.close();
  }
}

const isEntrypoint = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isEntrypoint) {
  try {
    await startWorker();
  } catch {
    console.error("WORKER_START_FAILED: check encryption, provider module, storage, and worker settings");
    process.exitCode = 1;
  }
}