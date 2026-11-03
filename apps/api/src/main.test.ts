import { createServer } from "node:net";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { startApi } from "./main.js";

describe("API entrypoint", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))));

  it("starts Fastify against persistent SQLite and serves the agent catalog", async () => {
    const directory = await mkdtemp(join(tmpdir(), "harness-api-main-"));
    directories.push(directory);
    const probe = createServer();
    await new Promise<void>((resolve, reject) => {
      probe.once("error", reject);
      probe.listen(0, "127.0.0.1", () => resolve());
    });
    const address = probe.address();
    if (address === null || typeof address === "string") throw new Error("TEST_PORT_UNAVAILABLE");
    const port = address.port;
    await new Promise<void>((resolve, reject) => probe.close((error) => error ? reject(error) : resolve()));

    const server = await startApi({
      APP_ENCRYPTION_KEY: Buffer.alloc(32, 4).toString("base64"),
      APP_DATA_DIR: directory,
      API_HOST: "127.0.0.1",
      API_PORT: String(port),
    });
    try {
      const response = await fetch(`http://127.0.0.1:${port}/api/v1/agents`);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ items: [] });
    } finally {
      await server.close();
    }
  });
});