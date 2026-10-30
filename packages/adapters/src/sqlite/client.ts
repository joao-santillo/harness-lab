import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { DatabaseSync, type StatementSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

type BindValue = string | number | null | Uint8Array;

const migrations = [
  { name: "0001_foundation", path: fileURLToPath(new URL("./migrations/0001_foundation.sql", import.meta.url)) },
  { name: "0002_immutable_harness", path: fileURLToPath(new URL("./migrations/0002_immutable_harness.sql", import.meta.url)) },
  { name: "0003_scope_integrity", path: fileURLToPath(new URL("./migrations/0003_scope_integrity.sql", import.meta.url)) },
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

function verifyLegacyMigration(database: SqliteDatabase, name: string): void {
  if (name === "0001_foundation") {
    const requiredTables = [
      "agents", "connections", "capabilities", "harness_versions", "rounds",
      "round_events", "checkpoints", "cases", "case_partitions", "executions",
      "findings", "proposals", "evaluations", "learnings", "exports",
    ];
    const tables = new Set(
      database.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
        .map((row) => row.name),
    );
    if (requiredTables.some((table) => !tables.has(table))) {
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
        database.exec(sql);
        database.prepare("INSERT INTO schema_migrations (name, checksum, applied_at) VALUES (?, ?, ?)")
          .run(migration.name, checksum, new Date().toISOString());
      } else if (existing.checksum === null) {
        verifyLegacyMigration(database, migration.name);
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