# Python deployment

The Python application is split into an HTTP process and a durable worker:

```text
uv run harness-lab api
uv run harness-lab worker
```

Both processes use the same `APP_DATA_DIR` and therefore the same SQLite file.
Run one worker process per database lease domain. The worker refuses to claim
jobs when `WORKER_PROVIDER_MODULE` is absent. Provider modules are deployment
owned and must expose `create_round_stage_dependencies(config)`.

Required environment:

- `APP_ENCRYPTION_KEY`: canonical base64 encoding of 32 bytes.
- `DATABASE_PATH`: SQLite path; defaults to `./data/harness.sqlite`.
- `APP_HOST` and `APP_PORT`: HTTP bind settings.
- `WORKER_PROVIDER_MODULE`: optional provider module path.

Do not point tests or local smoke checks at a live `data/harness.sqlite`. Use a
temporary directory or a sanitized SQLite backup. During cutover, allow exactly
one writer stack. Use `scripts/backup_sqlite.py` and the rollback criteria in
`docs/operacao.md` before switching production traffic.