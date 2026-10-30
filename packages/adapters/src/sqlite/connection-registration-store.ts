import { createHash } from "node:crypto";
import type {
  ConnectionRegistrationStore,
  ConnectionView,
  RegisterConnectionRequest,
  RegistrationResult,
} from "@lynn-harness/application";
import sodium from "libsodium-wrappers";
import type { SqliteDatabase } from "./client.js";

interface EncryptedValue {
  readonly keyVersion: 1;
  readonly nonce: string;
  readonly ciphertext: string;
}

function canonicalRequest(request: RegisterConnectionRequest): string {
  const credentials = Object.fromEntries(Object.entries(request.credentials).sort(([left], [right]) => left.localeCompare(right)));
  return JSON.stringify({ id: request.id, kind: request.kind, name: request.name, credentials });
}

function requestHash(request: RegisterConnectionRequest): string {
  return createHash("sha256").update(canonicalRequest(request)).digest("hex");
}

function toView(row: Record<string, unknown>): ConnectionView {
  return { id: String(row.id), kind: row.kind as ConnectionView["kind"], name: String(row.name), configured: true };
}

export class SqliteConnectionRegistrationStore implements ConnectionRegistrationStore {
  private readonly masterKey: Uint8Array;

  public constructor(private readonly database: SqliteDatabase, encodedMasterKey: string) {
    const key = Buffer.from(encodedMasterKey, "base64");
    if (key.length !== 32 || key.toString("base64") !== encodedMasterKey) throw new Error("INVALID_ENCRYPTION_KEY");
    this.masterKey = new Uint8Array(key);
  }

  public async findReplay(request: RegisterConnectionRequest): Promise<RegistrationResult | null> {
    if (request.idempotencyKey === null) return null;
    const replay = this.database.prepare(
      "SELECT id, kind, name, request_hash FROM connection_registrations WHERE idempotency_key = ?",
    ).get(request.idempotencyKey);
    if (replay === undefined) return null;
    if (replay.request_hash !== requestHash(request)) throw new Error("IDEMPOTENCY_CONFLICT");
    return { status: "replayed", connection: toView(replay) };
  }

  public async register(request: RegisterConnectionRequest): Promise<RegistrationResult> {
    const encrypted = await this.encrypt(JSON.stringify(request.credentials));
    const hash = requestHash(request);
    return this.database.transaction<RegistrationResult>(() => {
      if (request.idempotencyKey !== null) {
        const replay = this.database.prepare(
          "SELECT id, kind, name, request_hash FROM connection_registrations WHERE idempotency_key = ?",
        ).get(request.idempotencyKey);
        if (replay !== undefined) {
          if (replay.request_hash !== hash) throw new Error("IDEMPOTENCY_CONFLICT");
          return { status: "replayed", connection: toView(replay) };
        }
      }
      const now = new Date().toISOString();
      this.database.prepare(`INSERT INTO encrypted_secrets
        (id, key_version, nonce, ciphertext, updated_at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET key_version = excluded.key_version, nonce = excluded.nonce,
          ciphertext = excluded.ciphertext, updated_at = excluded.updated_at`)
        .run(request.id, encrypted.keyVersion, encrypted.nonce, encrypted.ciphertext, now);
      this.database.prepare(`INSERT INTO connection_registrations
        (id, kind, name, idempotency_key, request_hash, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET kind = excluded.kind, name = excluded.name,
          idempotency_key = excluded.idempotency_key, request_hash = excluded.request_hash,
          updated_at = excluded.updated_at`)
        .run(request.id, request.kind, request.name, request.idempotencyKey, hash, now, now);
      return {
        status: "created",
        connection: { id: request.id, kind: request.kind, name: request.name, configured: true },
      };
    })();
  }

  private async encrypt(value: string): Promise<EncryptedValue> {
    await sodium.ready;
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    return {
      keyVersion: 1,
      nonce: sodium.to_base64(nonce),
      ciphertext: sodium.to_base64(sodium.crypto_secretbox_easy(value, nonce, this.masterKey)),
    };
  }
}