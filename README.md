# Harness Lab

Aplicacao Python para diagnostico, refinamento e avaliacao de agentes usando o Harness2 upstream fixado no lockfile.

## Requisitos

- Python 3.12 ou 3.13;
- `uv` 0.12 ou superior;
- Chromium para a suite E2E.

## Inicio rapido

```bash
uv sync --frozen
cp .env.example .env
uv run harness-lab api
```

A interface e a API ficam em `http://127.0.0.1:8000`. Em outro terminal, inicie o worker somente depois de configurar um provider:

```bash
uv run harness-lab worker
```

O banco padrao e `data/harness.sqlite`; altere `DATABASE_PATH` para usar outro arquivo. Testes e smokes nunca devem apontar para o banco ativo.

## Qualidade

```bash
uv run pytest -q
uv run ruff check .
uv run mypy src/harness_lab
```

Instale o Chromium gerenciado com `uv run playwright install chromium` ou defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.

## Backup

```bash
uv run python scripts/backup_sqlite.py data/harness.sqlite backups/harness-$(date +%Y%m%d-%H%M%S).sqlite
```

O comando usa a SQLite Backup API, valida integridade, grava atomicamente, aplica modo `0600` e imprime o SHA-256. Veja [operacao](docs/operacao.md) para cutover e rollback.