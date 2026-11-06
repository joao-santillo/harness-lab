# Operacao

## Instalacao

Use Python 3.12 ou 3.13 e `uv`:

```bash
uv sync --frozen
cp .env.example .env
```

Configure `DATABASE_PATH`, uma `APP_ENCRYPTION_KEY` Base64 de 32 bytes e, para o worker, `WORKER_PROVIDER_MODULE`.

## Processos

```bash
uv run harness-lab api
uv run harness-lab worker
```

API e interface compartilham `APP_HOST`/`APP_PORT`, com padrao `127.0.0.1:8000`. API e worker devem usar o mesmo `DATABASE_PATH`. Execute um worker por dominio de lease do banco.

## Backup consistente

Pare escritores durante o cutover e execute:

```bash
uv run python scripts/backup_sqlite.py "$DATABASE_PATH" backups/harness-cutover.sqlite
```

Registre o SHA-256 exibido e proteja o backup e a chave de criptografia. Exports e SQLite podem conter dados de cases e resultados em claro; aplique controle de acesso ao volume inteiro.

## Ensaio de cutover

1. Pare API e worker que escrevem no banco.
2. Gere o backup consistente e confirme `PRAGMA integrity_check = ok`.
3. Copie o backup para um diretorio temporario e defina `DATABASE_PATH` para essa copia.
4. Inicie a API Python, consulte `/api/v1/health`, leia entidades e crie/remova um registro de smoke.
5. Inicie o worker apenas com provider homologado e valide retomada de uma rodada controlada.
6. No cutover real, garanta que nenhum processo anterior ou Python antigo continue escrevendo.

## Rollback objetivo

Acione rollback se a API nao iniciar, a integridade/checksum de migrations falhar, segredos nao puderem ser descriptografados, jobs/checkpoints nao forem retomados ou o smoke de leitura/escrita falhar. Pare imediatamente API e worker Python, preserve o banco falho para analise, restaure uma copia do backup ensaiado, restaure a mesma chave e reabra somente a versao anterior homologada. Nunca permita dois stacks escrevendo simultaneamente.

Rollback so e permitido se o Python ainda nao gravou um formato novo incompativel com o stack anterior; caso ja tenha gravado, mantenha o banco migrado e corrija em avanco. Com ambos os runtimes parados, execute:

```bash
# 1. Garanta que nenhum stack esteja escrevendo (API/worker Python e TS parados).
# 2. Preserve o banco falho para analise, sem sobrescrever.
mv "$DATABASE_PATH" "$DATABASE_PATH.failed-$(date +%Y%m%d%H%M%S)"
# 3. Restaure o backup ensaiado (ajuste o caminho do backup validado).
cp backups/harness-cutover.sqlite "$DATABASE_PATH"
# 4. Confirme integridade antes de reabrir.
uv run python -c "import sqlite3,sys; c=sqlite3.connect(sys.argv[1]); print(c.execute('PRAGMA integrity_check').fetchone()[0])" "$DATABASE_PATH"
```

Restaure a mesma chave de criptografia usada pelo backup e reinicie apenas o runtime homologado.

## Verificacao

```bash
uv run pytest -q
uv run ruff check .
uv run mypy src/harness_lab
```

Para E2E, instale o Chromium Playwright ou defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. A API nao possui autenticacao de usuario; mantenha bind em loopback ou use proxy autenticado.