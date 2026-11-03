import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveWorkerConfig } from "./config.js";

describe("resolveWorkerConfig", () => {
  it("requires a real encryption key and local provider module", () => {
    expect(() => resolveWorkerConfig({})).toThrow("APP_ENCRYPTION_KEY_INVALID");
    expect(() => resolveWorkerConfig({ APP_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64") }))
      .toThrow("WORKER_PROVIDER_MODULE_REQUIRED");
  });

  it("resolves the data store, provider module and bounded polling interval", () => {
    const config = resolveWorkerConfig({
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
      APP_DATA_DIR: "/tmp/harness-worker-data",
      WORKER_PROVIDER_MODULE: "./providers.js",
      WORKER_ID: "worker-test",
      WORKER_POLL_INTERVAL_MS: "250",
    }, "/workspace");
    expect(config).toEqual({
      encryptionKey: Buffer.alloc(32, 8).toString("base64"),
      databasePath: "/tmp/harness-worker-data/harness.sqlite",
      providerModule: resolve("/workspace", "./providers.js"),
      workerId: "worker-test",
      pollIntervalMs: 250,
      partitionSeed: "round-partition-v1",
      minimumReserved: 1,
      reservedRatio: 0.2,
      maxProposals: 3,
    });
  });

  it("resolves relative APP_DATA_DIR from the same repository root as the API", () => {
    const config = resolveWorkerConfig({
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 8).toString("base64"),
      APP_DATA_DIR: "./shared-data",
      WORKER_PROVIDER_MODULE: "./providers.js",
    });
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    expect(config.databasePath).toBe(resolve(projectRoot, "shared-data/harness.sqlite"));
  });
});