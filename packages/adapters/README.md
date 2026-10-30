# SQLite adapter

The adapter uses Node's native `node:sqlite` driver with WAL, full synchronous durability,
foreign keys, and transactional writer locking. Independent API and worker processes can
safely share the database file and observe committed writes without reopening it.

`harness_versions` is append-only. SQLite triggers reject direct `UPDATE` and `DELETE`
statements so persisted harness snapshots remain immutable outside the repository API.

Migrations are checksummed. Checksum-less legacy migrations are backfilled only after their
schema is verified, and scope-integrity upgrades reject incompatible existing records.