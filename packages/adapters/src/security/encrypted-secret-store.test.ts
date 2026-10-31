import { randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { SecretId } from "@harness-lab/domain";
import { afterEach, describe, expect, it } from "vitest";
import { openSqliteDatabase } from "../sqlite/client.js";
import { EncryptedSqliteSecretStore } from "./encrypted-secret-store.js";

describe("EncryptedSqliteSecretStore", () => {
  const directories: string[] = [];
  const secretId = "langfuse-main" as SecretId;

  afterEach(async () => {
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  async function fixture() {
    const directory = await mkdtemp(join(tmpdir(), "agent-platform-secrets-"));
    directories.push(directory);
    const path = join(directory, "harness.sqlite");
    const key = randomBytes(32).toString("base64");
    const database = await openSqliteDatabase(path);
    return { path, key, database, store: new EncryptedSqliteSecretStore(database, key) };
  }

  it("persists ciphertext without plaintext credentials and decrypts with its master key", async () => {
    const { path, database, store } = await fixture();
    const value = JSON.stringify({ publicKey: "pk-live", secretKey: "sk-live" });
    await store.save(secretId, { value });

    const row = database.prepare(
      "SELECT key_version, nonce, ciphertext FROM encrypted_secrets WHERE id = ?",
    ).get(secretId);
    expect(row?.key_version).toBe(1);
    const persisted = await readFile(path);
    expect(persisted.includes(Buffer.from("pk-live"))).toBe(false);
    expect(persisted.includes(Buffer.from("sk-live"))).toBe(false);
    await expect(store.get(secretId)).resolves.toEqual({ value });
    await database.close();
  });

  it("rejects decryption with another master key", async () => {
    const { database, store } = await fixture();
    await store.save(secretId, { value: "secret-value" });
    const other = new EncryptedSqliteSecretStore(database, randomBytes(32).toString("base64"));
    await expect(other.get(secretId)).rejects.toThrow("SECRET_DECRYPTION_FAILED");
    await database.close();
  });

  it("replaces and deletes a secret", async () => {
    const { database, store } = await fixture();
    await store.save(secretId, { value: "first" });
    await store.rotate(secretId, { value: "second" });
    await expect(store.get(secretId)).resolves.toEqual({ value: "second" });
    await store.delete(secretId);
    await expect(store.get(secretId)).resolves.toBeNull();
    await database.close();
  });

  it("requires a base64 encoded 32-byte master key", async () => {
    const database = await openSqliteDatabase(":memory:");
    expect(() => new EncryptedSqliteSecretStore(database, "invalid")).toThrow("INVALID_ENCRYPTION_KEY");
    await database.close();
  });

  it("preserves concurrent writes from independent database handles", async () => {
    const { path, key, database, store } = await fixture();
    const secondDatabase = await openSqliteDatabase(path);
    const other = new EncryptedSqliteSecretStore(secondDatabase, key);
    await Promise.all([
      store.save("first" as SecretId, { value: "one" }),
      other.save("second" as SecretId, { value: "two" }),
    ]);
    await expect(store.get("first" as SecretId)).resolves.toEqual({ value: "one" });
    await expect(store.get("second" as SecretId)).resolves.toEqual({ value: "two" });
    await Promise.all([database.close(), secondDatabase.close()]);
  });

  it("maps malformed storage to a stable error code", async () => {
    const { database, store } = await fixture();
    await store.save(secretId, { value: "secret" });
    database.prepare("UPDATE encrypted_secrets SET key_version = ? WHERE id = ?").run(2, secretId);
    await expect(store.get(secretId)).rejects.toThrow("SECRET_STORE_CORRUPT");
    await database.close();
  });

  it("classifies malformed nonce and ciphertext as corrupt storage", async () => {
    const { database, store } = await fixture();
    await store.save(secretId, { value: "secret" });
    database.prepare("UPDATE encrypted_secrets SET nonce = ?, ciphertext = ? WHERE id = ?")
      .run("invalid", "AA==", secretId);
    await expect(store.get(secretId)).rejects.toThrow("SECRET_STORE_CORRUPT");
    await database.close();
  });
});