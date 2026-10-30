import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

type BindValue = string | number | null | Uint8Array;

const migrations = [
  { name: "0001_foundation", path: fileURLToPath(new URL("./migrations/0001_foundation.sql", import.meta.url)) },
  { name: "0002_immutable_harness", path: fileURLToPath(new URL("./migrations/0002_immutable_harness.sql", import.meta.url)) },
  { name: "0003_scope_integrity", path: fileURLToPath(new URL("./migrations/0003_scope_integrity.sql", import.meta.url)) },
  { name: "0004_encrypted_secrets", path: fileURLToPath(new URL("./migrations/0004_encrypted_secrets.sql", import.meta.url)) },
] as const;

export interface SqliteStatement {
  run(...parameters: BindValue[]): void;
  get(...parameters: BindValue[]): Record<string, unknown> | undefined;
  all(...parameters: BindValue[]): Record<string, unknown>[];
}

export interface SqliteDatabase {
  assertOpen(): void;
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  transaction<T>(operation: () => T): () => T;
  flush(): Promise<void>;
  close(): Promise<void>;
}

class NodeSqliteStatement implements SqliteStatement {
  public constructor(private readonly statement: StatementSync) {}

  public run(...parameters: BindValue[]): void {
    this.statement.run(...parameters);
  }

  public get(...parameters: BindValue[]): Record<string, unknown> | undefined {
    return this.statement.get(...parameters) as Record<string, unknown> | undefined;
  }

  public all(...parameters: BindValue[]): Record<string, unknown>[] {
    return this.statement.all(...parameters) as Record<string, unknown>[];
  }
}

class NodeSqliteDatabase implements SqliteDatabase {
  private state: "open" | "closed" = "open";
  private transactionDepth = 0;
  private closePromise: Promise<void> | undefined;

  public constructor(private readonly database: DatabaseSync) {}

  public assertOpen(): void {
    if (this.state === "closed") {
      throw new Error("SQLite database is closed");
    }
  }

  public prepare(sql: string): SqliteStatement {
    this.assertOpen();
    return new NodeSqliteStatement(this.database.prepare(sql));
  }

  public exec(sql: string): void {
    this.assertOpen();
    this.database.exec(sql);
  }

  public transaction<T>(operation: () => T): () => T {
    return () => {
      this.assertOpen();
      if (this.transactionDepth > 0) return operation();
      this.database.exec("BEGIN IMMEDIATE");
      this.transactionDepth += 1;
      try {
        const result = operation();
        this.database.exec("COMMIT");
        return result;
      } catch (error) {
        try {
          this.database.exec("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Transaction and rollback failed", { cause: error });
        }
        throw error;
      } finally {
        this.transactionDepth = 0;
      }
    };
  }

  public async flush(): Promise<void> {
    this.assertOpen();
  }

  public close(): Promise<void> {
    if (this.closePromise !== undefined) return this.closePromise;
    this.assertOpen();
    this.database.close();
    this.state = "closed";
    this.closePromise = Promise.resolve();
    return this.closePromise;
  }
}

function migrationChecksum(sql: string): string {
  return createHash("sha256").update(sql).digest("hex");
}

function normalizeSchemaSql(sql: unknown): string {
  return String(sql).replace(/\s+/gu, " ").replace(/\s*([(),])\s*/gu, "$1").trim().toLowerCase();
}

function schemaObjects(database: SqliteDatabase, type: "table" | "trigger"): Map<string, string> {
  return new Map(
    database.prepare("SELECT name, sql FROM sqlite_master WHERE type = ? AND name NOT LIKE 'sqlite_%'").all(type)
      .map((row) => [String(row.name), normalizeSchemaSql(row.sql)]),
  );
}

function verifyLegacyMigration(database: SqliteDatabase, name: string, sql: string): void {
  if (name === "0001_foundation") {
    const expected = new NodeSqliteDatabase(new DatabaseSync(":memory:"));
    expected.exec(sql);
    const expectedTables = schemaObjects(expected, "table");
    const actualTables = schemaObjects(database, "table");
    void expected.close();
    if ([...expectedTables].some(([table, definition]) => actualTables.get(table) !== definition)) {
      throw new Error("Legacy migration verification failed: 0001_foundation");
    }
    return;
  }
  if (name === "0002_immutable_harness") {
    const triggers = new Set(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'trigger'").all()
        .map((row) => row.name),
    );
    if (
      !triggers.has("harness_versions_reject_update") ||
      !triggers.has("harness_versions_reject_delete")
    ) {
      throw new Error("Legacy migration verification failed: 0002_immutable_harness");
    }
    return;
  }
  throw new Error(`Legacy migration has no verifier: ${name}`);
}

function verifyExistingScope(database: SqliteDatabase): void {
  const invalid = database.prepare(`SELECT 1 FROM (
    SELECT 1 FROM rounds r LEFT JOIN agents a ON a.id = r.agent_id AND a.domain_id = r.domain_id WHERE a.id IS NULL
    UNION ALL SELECT 1 FROM harness_versions h LEFT JOIN agents a ON a.id = h.agent_id AND a.domain_id = h.domain_id WHERE a.id IS NULL
    UNION ALL SELECT 1 FROM connections c LEFT JOIN agents a ON a.id = c.agent_id AND a.domain_id = c.domain_id WHERE a.id IS NULL
    UNION ALL SELECT 1 FROM capabilities c LEFT JOIN agents a ON a.id = c.agent_id AND a.domain_id = c.domain_id WHERE a.id IS NULL
    UNION ALL SELECT 1 FROM cases c LEFT JOIN agents a ON a.id = c.agent_id AND a.domain_id = c.domain_id WHERE a.id IS NULL
    UNION ALL SELECT 1 FROM case_partitions p LEFT JOIN cases c ON c.id = p.case_id AND c.domain_id = p.domain_id WHERE c.id IS NULL
    UNION ALL SELECT 1 FROM executions e LEFT JOIN rounds r ON r.id = e.round_id AND r.agent_id = e.agent_id AND r.domain_id = e.domain_id LEFT JOIN cases c ON c.id = e.case_id AND c.agent_id = e.agent_id AND c.domain_id = e.domain_id WHERE r.id IS NULL OR c.id IS NULL
    UNION ALL SELECT 1 FROM findings x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
    UNION ALL SELECT 1 FROM proposals x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
    UNION ALL SELECT 1 FROM evaluations x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
    UNION ALL SELECT 1 FROM learnings x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
    UNION ALL SELECT 1 FROM exports x LEFT JOIN rounds r ON r.id = x.round_id AND r.agent_id = x.agent_id AND r.domain_id = x.domain_id WHERE r.id IS NULL
  ) LIMIT 1`).get();
  if (invalid !== undefined) throw new Error("Legacy scope integrity violation");
}

async function migrate(database: SqliteDatabase): Promise<void> {
  database.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    name TEXT PRIMARY KEY,
    checksum TEXT,
    applied_at TEXT NOT NULL
  )`);
  const columns = database.prepare("PRAGMA table_info(schema_migrations)").all();
  if (!columns.some((column) => column.name === "checksum")) {
    database.exec("ALTER TABLE schema_migrations ADD COLUMN checksum TEXT");
  }

  const migrationSql = new Map(await Promise.all(migrations.map(async (migration) => [
    migration.name,
    await readFile(migration.path, "utf8"),
  ] as const)));
  database.transaction(() => {
    for (const migration of migrations) {
      const sql = migrationSql.get(migration.name)!;
      const checksum = migrationChecksum(sql);
      const existing = database.prepare("SELECT checksum FROM schema_migrations WHERE name = ?").get(migration.name);
      if (existing === undefined) {
        if (migration.name === "0003_scope_integrity") verifyExistingScope(database);
        database.exec(sql);
        database.prepare("INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)")
          .run(migration.name, checksum, new Date().toISOString());
      } else if (existing.checksum === null) {
        verifyLegacyMigration(database, migration.name, sql);
        database.prepare("UPDATE schema_migrations SET checksum = ? WHERE name = ?").run(checksum, migration.name);
      } else if (existing.checksum !== checksum) {
        throw new Error(`Migration checksum mismatch: ${migration.name}`);
      }
    }
  })();
}

export async function openSqliteDatabase(path: string): Promise<SqliteDatabase> {
  const nativeDatabase = new DatabaseSync(path);
  nativeDatabase.exec("PRAGMA foreign_keys = ON");
  nativeDatabase.exec("PRAGMA busy_timeout = 5000");
  if (path !== ":memory:") {
    nativeDatabase.exec("PRAGMA journal_mode = WAL");
    nativeDatabase.exec("PRAGMA synchronous = FULL");
  }
  const database = new NodeSqliteDatabase(nativeDatabase);
  try {
    await migrate(database);
    return database;
  } catch (error) {
    await database.close();
    throw error;
  }
}