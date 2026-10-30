import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteDatabase } from "./client.js";
import { SqliteConnectionRegistrationStore } from "./connection-registration-store.js";

const request = {
  id: "langfuse-main",
  kind: "langfuse" as const,
  name: "Langfuse principal",
  credentials: { publicKey: "pk-live", secretKey: "sk-live" },
  idempotencyKey: "request-1",
};

describe("SqliteConnectionRegistrationStore", () => {
  const directories: string[] = [];
  afterEach(async () => Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "lynn-registration-"));
    directories.push(directory);
    const path = join(directory, "harness.sqlite");
    const key = randomBytes(32).toString("base64");
    const database = await openSqliteDatabase(path);
    return { path, key, database, store: new SqliteConnectionRegistrationStore(database, key) };
  }

  it("atomically stores metadata and encrypted credentials", async () => {
    const { database, store } = await fixture();
    await expect(store.register(request)).resolves.toMatchObject({ status: "created" });
    expect(database.prepare("SELECT id, kind, name FROM connection_registrations").all()).toEqual([{
      id: request.id,
      kind: request.kind,
      name: request.name,
    }]);
    expect(database.prepare("SELECT ciphertext FROM encrypted_secrets WHERE id = ?").get(request.id)?.ciphertext)
      .not.toContain("sk-live");
    await database.close();
  });

  it("replays only the identical request and rejects a conflicting idempotency key", async () => {
    const { database, store } = await fixture();
    await store.register(request);
    await expect(store.register(request)).resolves.toMatchObject({ status: "replayed" });
    await expect(store.register({ ...request, id: "other" })).rejects.toThrow("IDEMPOTENCY_CONFLICT");
    expect(database.prepare("SELECT COUNT(*) AS count FROM connection_registrations").get()).toEqual({ count: 1 });
    await database.close();
  });

  it("serializes concurrent registrations across independent handles", async () => {
    const { path, key, database, store } = await fixture();
    const otherDatabase = await openSqliteDatabase(path);
    const other = new SqliteConnectionRegistrationStore(otherDatabase, key);
    const results = await Promise.allSettled([
      store.register(request),
      other.register({ ...request, id: "other" }),
    ]);
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(database.prepare("SELECT COUNT(*) AS count FROM connection_registrations").get()).toEqual({ count: 1 });
    await Promise.all([database.close(), otherDatabase.close()]);
  });
});