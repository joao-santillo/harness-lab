import { access, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import initSqlJs, { type BindParams, type Database, type SqlJsStatic } from "sql.js/dist/sql-asm.js";

type BindValue = string | number | null | Uint8Array;

const migrations = [
  {
    name: "0001_foundation",
    path: fileURLToPath(new URL("./migrations/0001_foundation.sql", import.meta.url)),
  },
] as const;

export interface SqliteStatement {
  run(...parameters: BindValue[]): void;
  get(...parameters: BindValue[]): Record<string, unknown> | undefined;
  all(...parameters: BindValue[]): Record<string, unknown>[];
}

export interface SqliteDatabase {
  prepare(sql: string): SqliteStatement;
  exec(sql: string): void;
  transaction<T>(operation: () => T): () => T;
  flush(): Promise<void>;
  close(): Promise<void>;
}

class SqlJsDatabase implements SqliteDatabase {
  private transactionDepth = 0;
  private dirty = false;
  private closed = false;
  private persistenceSequence = 0;
  private persistence = Promise.resolve();

  public constructor(
    private readonly database: Database,
    private readonly path: string,
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
          this.database.run("ROLLBACK TO sqlite_database_write");
          this.database.run("RELEASE sqlite_database_write");
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

      this.transactionDepth += 1;
      this.database.run("BEGIN");
      try {
        const result = operation();
        this.assertForeignKeys();
        this.database.run("COMMIT");
        this.transactionDepth -= 1;
        this.queuePersistence();
        return result;
      } catch (error) {
        this.database.run("ROLLBACK");
        this.transactionDepth -= 1;
        throw error;
      }
    };
  }

  public async close(): Promise<void> {
    this.assertOpen();
    this.queuePersistence();
    await this.persistence;
    this.database.close();
    this.closed = true;
  }

  public async flush(): Promise<void> {
    this.queuePersistence();
    await this.persistence;
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.transactionDepth === 0) {
      this.queuePersistence();
    }
  }

  private queuePersistence(): void {
    if (!this.dirty || this.path === ":memory:") {
      return;
    }
    const bytes = this.database.export();
    this.dirty = false;
    this.persistence = this.persistence.then(async () => {
      const temporaryPath = join(
        dirname(this.path),
        `.${this.path.split("/").at(-1)}.${process.pid}.${this.persistenceSequence++}.tmp`,
      );
      await writeFile(temporaryPath, bytes);
      await rename(temporaryPath, this.path);
    });
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new Error("SQLite database is closed");
    }
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

export async function openSqliteDatabase(path: string): Promise<SqliteDatabase> {
  const SQL = await loadSqlJs();
  let bytes: Uint8Array | undefined;
  if (path !== ":memory:") {
    try {
      await access(path);
      bytes = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  const sqlJsDatabase = new SQL.Database(bytes);
  sqlJsDatabase.exec("PRAGMA foreign_keys = ON");
  const database = new SqlJsDatabase(sqlJsDatabase, path);
  await migrate(database);
  await database.flush();
  return database;
}
