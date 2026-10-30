# SQLite adapter

The adapter uses `sql.js` to avoid native bindings. Each write is exported to a temporary
file and atomically renamed after the operation or transaction commits. A database opened
after that commit observes the persisted state without requiring the writer to close.

`harness_versions` is append-only. SQLite triggers reject direct `UPDATE` and `DELETE`
statements so persisted harness snapshots remain immutable outside the repository API.

`sql.js` keeps an independent in-memory image per database instance. Concurrent writers in
separate instances or processes are not safe because a later export can replace changes from
another writer. Until persistence moves to a locking SQLite driver or a single-writer service,
the API and worker must not write the same database from separate processes.