import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { resolveApiConfig } from "./config.js";

describe("resolveApiConfig", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  it("rejects missing and placeholder encryption keys", () => {
    expect(() => resolveApiConfig({})).toThrow("APP_ENCRYPTION_KEY_INVALID");
    expect(() => resolveApiConfig({ APP_ENCRYPTION_KEY: "INVALID_REPLACE_WITH_A_REAL_KEY" })).toThrow("APP_ENCRYPTION_KEY_INVALID");
  });

  it("resolves persistent database path and bounded listener settings", async () => {
    const dataDir = await mkdtemp(join(tmpdir(), "harness-api-config-"));
    directories.push(dataDir);
    const config = resolveApiConfig({
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      APP_DATA_DIR: dataDir,
      API_HOST: "127.0.0.1",
      API_PORT: "3400",
    });
    expect(config).toEqual({
      encryptionKey: Buffer.alloc(32, 7).toString("base64"),
      databasePath: join(dataDir, "harness.sqlite"),
      host: "127.0.0.1",
      port: 3400,
    });
  });

  it("rejects invalid ports without listening", () => {
    expect(() => resolveApiConfig({ APP_ENCRYPTION_KEY: Buffer.alloc(32).toString("base64"), API_PORT: "70000" }))
      .toThrow("API_PORT_INVALID");
  });

  it("resolves relative APP_DATA_DIR from the repository root, not the current working directory", () => {
    const config = resolveApiConfig({
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString("base64"),
      APP_DATA_DIR: "./shared-data",
    });
    const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
    expect(config.databasePath).toBe(resolve(projectRoot, "shared-data/harness.sqlite"));
  });
});