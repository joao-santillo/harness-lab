# Desenvolvimento

## Estrutura

```text
src/harness_lab/domain/       modelos e portas
src/harness_lab/application/  casos de uso
src/harness_lab/adapters/     SQLite, Harness2, integracoes e seguranca
src/harness_lab/api/          REST e SSE FastAPI
src/harness_lab/web/          templates Jinja2 e CSS
src/harness_lab/worker/       execucao duravel
tests/                        unidade, contratos, integracao e E2E
```

## Ambiente e comandos

```bash
uv sync --frozen
uv run pytest -q
uv run ruff check .
uv run mypy src/harness_lab
uv run harness-lab api
uv run harness-lab worker
```

Use schemas Pydantic nas fronteiras, preserve codigos de erro estaveis e mantenha credenciais, payloads externos e URLs sensiveis fora de respostas e logs. Adicione migrations numeradas sem alterar migrations aplicadas. Testes usam bancos temporarios; nunca use `data/harness.sqlite`.

## E2E

`uv run pytest -q tests/e2e` inicia Uvicorn com SQLite temporario e bloqueia requests externos do navegador. Instale o Chromium com `uv run playwright install chromium` ou forneca `PLAYWRIGHT_CHROMIUM_EXECUTABLE`.