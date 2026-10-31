import type { SecretId, SecretStore, SecretValue } from "@harness-lab/domain";
import sodium from "libsodium-wrappers";
import { z } from "zod";
import type { SqliteDatabase } from "../sqlite/client.js";

const encryptedSecretSchema = z.object({
  key_version: z.literal(1),
  nonce: z.string(),
  ciphertext: z.string(),
});

export class EncryptedSqliteSecretStore implements SecretStore {
  private readonly masterKey: Uint8Array;

  public constructor(private readonly database: SqliteDatabase, encodedMasterKey: string) {
    const key = Buffer.from(encodedMasterKey, "base64");
    if (key.length !== 32 || key.toString("base64") !== encodedMasterKey) {
      throw new Error("INVALID_ENCRYPTION_KEY");
    }
    this.masterKey = new Uint8Array(key);
  }

  public save(id: SecretId, secret: SecretValue): Promise<void> {
    return this.encrypt(secret.value).then((encrypted) => {
      this.database.prepare(`INSERT INTO encrypted_secrets
        (id, key_version, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          key_version = excluded.key_version,
          nonce = excluded.nonce,
          ciphertext = excluded.ciphertext,
          updated_at = excluded.updated_at`)
        .run(id, encrypted.key_version, encrypted.nonce, encrypted.ciphertext, new Date().toISOString());
    });
  }

  public async get(id: SecretId): Promise<SecretValue | null> {
    const row = this.database.prepare(
      "SELECT key_version, nonce, ciphertext FROM encrypted_secrets WHERE id = ?",
    ).get(id);
    if (row === undefined) return null;
    let encrypted: z.infer<typeof encryptedSecretSchema>;
    try {
      encrypted = encryptedSecretSchema.parse(row);
    } catch (error) {
      throw new Error("SECRET_STORE_CORRUPT", { cause: error });
    }
    await sodium.ready;
    let ciphertext: Uint8Array;
    let nonce: Uint8Array;
    try {
      ciphertext = sodium.from_base64(encrypted.ciphertext);
      nonce = sodium.from_base64(encrypted.nonce);
      if (
        nonce.length !== sodium.crypto_secretbox_NONCEBYTES ||
        ciphertext.length < sodium.crypto_secretbox_MACBYTES
      ) {
        throw new Error("invalid encrypted secret dimensions");
      }
    } catch (error) {
      throw new Error("SECRET_STORE_CORRUPT", { cause: error });
    }
    try {
      const value = sodium.crypto_secretbox_open_easy(
        ciphertext,
        nonce,
        this.masterKey,
        "text",
      );
      if (value === null) throw new Error("authentication failed");
      return { value };
    } catch (error) {
      throw new Error("SECRET_DECRYPTION_FAILED", { cause: error });
    }
  }

  public rotate(id: SecretId, secret: SecretValue): Promise<void> {
    return this.save(id, secret);
  }

  public delete(id: SecretId): Promise<void> {
    this.database.prepare("DELETE FROM encrypted_secrets WHERE id = ?").run(id);
    return Promise.resolve();
  }

  private async encrypt(value: string): Promise<z.infer<typeof encryptedSecretSchema>> {
    await sodium.ready;
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    const ciphertext = sodium.crypto_secretbox_easy(value, nonce, this.masterKey);
    return {
      key_version: 1,
      nonce: sodium.to_base64(nonce),
      ciphertext: sodium.to_base64(ciphertext),
    };
  }
}