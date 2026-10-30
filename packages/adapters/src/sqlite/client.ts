import { access, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs, { type BindParams, type Database, type SqlJsStatic } from "sql.js/dist/sql-asm.js";

type BindValue = string | number | null | Uint8Array;

export interface SqliteFileOperations {
  access(path: string): Promise<void>;
  readFile(path: string): Promise<Buffer>;
  writeFile(path: string, data: Uint8Array): Promise<void>;
  rename(oldPath: string, newPath: string): Promise<void>;
}

const defaultFileOperations: SqliteFileOperations = { access, readFile, rename, writeFile };

const migrations = [
  {
    name: "0001_foundation",
    path: fileURLToPath(new URL("./migrations/0001_foundation.sql", import.meta.url)),
  },
  {
    name: "0002_immutable_harness",
    path: fileURLToPath(new URL("./migrations/0002_immutable_harness.sql", import.meta.url)),
  },
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

class SqlJsDatabase implements SqliteDatabase {
  private transactionDepth = 0;
  private dirty = false;
  private state: "open" | "closing" | "closed" = "open";
  private persistenceSequence = 0;
  private mutationGeneration = 0;
  private persistedGeneration = 0;
  private persistence = Promise.resolve();
  private persistencePending = false;
  private closePromise: Promise<void> | undefined;

  public constructor(
    private readonly database: Database,
    private readonly path: string,
    private readonly fileOperations: SqliteFileOperations,
  ) {}

  public prepare(sql: string): SqliteStatement {
    const isWrite = !/^\s*(SELECT|PRAGMA\b(?!.*=))/i.test(sql);
    const execute = (parameters: BindValue[]): Record<string, unknown>[] => {
      this.assertOpen();
      if (isWrite && this.transactionDepth === 0) {
        this.database.run("SAVEPOINT sqlite_database_write");
      }
      const statement = this.database.prepare(sql);
      try {
        statement.bind(parameters as BindParams);
        const rows: Record<string, unknown>[] = [];
        while (statement.step()) {
          rows.push(statement.getAsObject());
        }
        if (isWrite) {
          this.assertForeignKeys();
          if (this.transactionDepth === 0) {
            this.database.run("RELEASE sqlite_database_write");
          }
          this.markDirty();
        }
        return rows;
      } catch (error) {
        if (isWrite && this.transactionDepth === 0) {
          this.cleanupSavepoint(error);
        }
        throw error;
      } finally {
        statement.free();
      }
    };

    return {
      run: (...parameters) => {
        execute(parameters);
      },
      get: (...parameters) => execute(parameters)[0],
      all: (...parameters) => execute(parameters),
    };
  }

  public exec(sql: string): void {
    this.assertOpen();
    this.database.exec(sql);
    if (!/^\s*(SELECT|PRAGMA\b(?!.*=))/i.test(sql)) {
      this.markDirty();
    }
  }

  public transaction<T>(operation: () => T): () => T {
    return () => {
      this.assertOpen();
      if (this.transactionDepth > 0) {
        return operation();
      }

      this.database.run("BEGIN");
      this.transactionDepth += 1;
      try {
        const result = operation();
        this.assertForeignKeys();
        this.database.run("COMMIT");
        this.transactionDepth = 0;
        this.markDirty();
        return result;
      } catch (error) {
        this.transactionDepth = 0;
        try {
          this.database.run("ROLLBACK");
        } catch (rollbackError) {
          throw new AggregateError([error, rollbackError], "Transaction and rollback failed", {
            cause: error,
          });
        }
        throw error;
      }
    };
  }

  public close(): Promise<void> {
    if (this.closePromise !== undefined) {
      return this.closePromise;
    }
    this.assertOpen();
    this.state = "closing";
    this.closePromise = this.drainPersistence().then(() => {
      this.database.close();
      this.state = "closed";
    });
    return this.closePromise;
  }

  public async flush(): Promise<void> {
    this.assertOpen();
    await this.drainPersistence();
  }

  private markDirty(): void {
    this.dirty = true;
    this.mutationGeneration += 1;
    if (this.transactionDepth === 0) {
      this.queuePersistence();
    }
  }

  private queuePersistence(): void {
    if (!this.dirty || this.persistencePending) {
      return;
    }
    if (this.path === ":memory:") {
      this.dirty = false;
      this.persistedGeneration = this.mutationGeneration;
      return;
    }
    const bytes = this.database.export();
    const snapshotGeneration = this.mutationGeneration;
    this.dirty = false;
    this.persistencePending = true;
    this.persistence = this.persistence.catch(() => undefined).then(async () => {
      const temporaryPath = join(
        dirname(this.path),
        `.${this.path.split("/").at(-1)}.${process.pid}.${this.persistenceSequence++}.tmp`,
      );
      try {
        await this.fileOperations.writeFile(temporaryPath, bytes);
        await this.fileOperations.rename(temporaryPath, this.path);
        this.persistedGeneration = snapshotGeneration;
      } catch (error) {
        this.dirty = true;
        throw error;
      } finally {
        this.persistencePending = false;
      }
    });
  }

  private async drainPersistence(): Promise<void> {
    const targetGeneration = this.mutationGeneration;
    while (this.persistedGeneration < targetGeneration) {
      if (this.dirty && !this.persistencePending) {
        this.queuePersistence();
      }
      await this.persistence;
    }
  }

  public assertOpen(): void {
    if (this.state === "closing") {
      throw new Error("SQLite database is closing");
    }
    if (this.state === "closed") {
      throw new Error("SQLite database is closed");
    }
  }

  private cleanupSavepoint(originalError: unknown): never {
    const cleanupErrors: unknown[] = [];
    for (const sql of ["ROLLBACK TO sqlite_database_write", "RELEASE sqlite_database_write"]) {
      try {
        this.database.run(sql);
      } catch (cleanupError) {
        cleanupErrors.push(cleanupError);
      }
    }
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [originalError, ...cleanupErrors],
        "Statement and savepoint cleanup failed",
        { cause: originalError },
      );
    }
    throw originalError;
  }

  private assertForeignKeys(): void {
    const violations = this.database.exec("PRAGMA foreign_key_check");
    if (violations.some((result) => result.values.length > 0)) {
      throw new Error("Foreign key constraint failed");
    }
  }
}

async function migrate(database: SqliteDatabase): Promise<void> {
  database.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    )
  `);

  const hasMigration = database.prepare("SELECT 1 FROM schema_migrations WHERE name = ?");
  const recordMigration = database.prepare(
    "INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)",
  );

  const applyMigrations = database.transaction(() => {
    for (const migration of migrations) {
      if (hasMigration.get(migration.name) === undefined) {
        database.exec(awaitMigrationSql.get(migration.name)!);
        recordMigration.run(migration.name, new Date().toISOString());
      }
    }
  });

  const awaitMigrationSql = new Map(
    await Promise.all(
      migrations.map(async (migration) => [migration.name, await readFile(migration.path, "utf8")] as const),
    ),
  );
  applyMigrations();
}

let sqlJsPromise: Promise<SqlJsStatic> | undefined;

function loadSqlJs(): Promise<SqlJsStatic> {
  sqlJsPromise ??= initSqlJs();
  return sqlJsPromise;
}

export async function openSqliteDatabase(
  path: string,
  fileOperations: SqliteFileOperations = defaultFileOperations,
): Promise<SqliteDatabase> {
  const SQL = await loadSqlJs();
  let bytes: Uint8Array | undefined;
  if (path !== ":memory:") {
    try {
      await fileOperations.access(path);
      bytes = await fileOperations.readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  const sqlJsDatabase = new SQL.Database(bytes);
  sqlJsDatabase.exec("PRAGMA foreign_keys = ON");
  const database = new SqlJsDatabase(sqlJsDatabase, path, fileOperations);
  await migrate(database);
  await database.flush();
  return database;
}
