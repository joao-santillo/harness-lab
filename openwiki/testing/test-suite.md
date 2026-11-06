---
type: quality-assurance
title: Suíte de Testes e Estratégia de Qualidade
description: Estrutura, divisão em camadas, comandos de execução e estratégias de isolamento da suíte de testes do Harness Lab para garantia de qualidade e regressão zero.
tags: [testing, quality-assurance, pytest, playwright, code-quality, integration-testing, contract-testing]
verified:
  - by: openwiki/0.7.2
    at: 2026-11-06T14:17:17.542Z
sources:
  - id: openwiki-source-13a21bc7a5de2b799de78fb9
    resource: repo://docs/desenvolvimento.md
  - id: openwiki-source-05ccef8d4cf1698187f20464
    resource: repo://pyproject.toml
  - id: openwiki-source-b75a0e585989254437edd654
    resource: repo://tests/contracts/test_api_v1_contract.py
  - id: openwiki-source-d2dbedc9276a5548dcdf4ccc
    resource: repo://tests/contracts/test_artifact_compatibility.py
  - id: openwiki-source-98542a969a2277ce83857ee0
    resource: repo://tests/contracts/test_sse_contract.py
  - id: openwiki-source-da1cc862f5a540f793502703
    resource: repo://tests/e2e/conftest.py
  - id: openwiki-source-68441ca05427bbbc581cd894
    resource: repo://tests/e2e/test_harness_lab_ui.py
  - id: openwiki-source-92d6c9e8b331c507b865da06
    resource: repo://tests/integration/test_complete_round.py
  - id: openwiki-source-d3373b0bc3eeb20de547de6a
    resource: repo://tests/integration/test_worker_recovery.py
generated: { by: "openwiki/0.7.2", at: "2026-11-06T14:17:17.542Z" }
---

# Suíte de Testes e Estratégia de Qualidade

A suíte de testes do **Harness Lab** é projetada para garantir regressão zero, alta confiabilidade e preservação rigorosa dos contratos de interface da arquitetura hexagonal. A estratégia de qualidade combina verificações estáticas automatizadas (linting e tipagem estática rigorosa) com quatro níveis progressivos de testes dinâmicos: **unidade**, **contratos**, **integração** e **end-to-end (E2E)**.

---

## Estrutura da Suíte e Fluxo de Validação

O sistema valida a qualidade do código desde a análise estática de sintaxe e tipos até a execução de interações reais em navegadores web.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    subgraph StaticCheck["Análise Estática"]
        RUFF["Ruff<br/>(Linting & Formatação)"]
        MYPY["Mypy<br/>(Tipagem Estática Strict)"]
    end

    subgraph TestSuite["Níveis de Teste (Pytest)"]
        UNIT["Testes de Unidade<br/>(tests/unit/)"]
        CONTRACT["Testes de Contrato<br/>(tests/contracts/)"]
        INTEG["Testes de Integração<br/>(tests/integration/)"]
        WEB["Testes Web UI<br/>(tests/web/)"]
        E2E["Testes E2E Browser<br/>(tests/e2e/)"]
    end

    subgraph Environment["Isolamento de Ambiente"]
        MEM_DB[("SQLite Em Memória / Temp")]
        ROUTE_BLOCK["Playwright Intercept<br/>(blockedbyclient)"]
        LIVE_SERVER["Uvicorn Server<br/>(Porta Dinâmica Loopback)"]
    end

    RUFF --> TestSuite
    MYPY --> TestSuite
    UNIT --> MEM_DB
    CONTRACT --> MEM_DB
    INTEG --> MEM_DB
    E2E --> LIVE_SERVER
    E2E --> ROUTE_BLOCK
```
*Fluxo de garantia de qualidade e isolamento de dependências nos testes do Harness Lab.*

---

## Divisão dos Níveis de Teste

A suíte em `tests/` é organizada de forma modular conforme a finalidade da verificação:

### 1. Testes de Unidade (`tests/unit/`)
* **Propósito**: Validar regras de negócio no modelo de domínio (`harness_lab.domain`), lógica de casos de uso (`harness_lab.application`) e funções de utilidade sem I/O persistente ou de rede.
* **Componentes Testados**:
  * Casos de uso de particionamento de cases (`tests/unit/application/cases/test_partition.py`), diagnóstico (`test_diagnosis.py`), avaliação (`test_evaluation.py`) e transições de estado do worker (`test_runtime.py`).
  * Adaptadores de segurança, incluindo mascaramento de dados sensíveis (`test_redactor.py`) e codificação `SecretBox` (`test_secretbox_codec.py`).
  * Clientes e adaptadores externos utilizando mocks/fakes baseados nos protocolos Python da arquitetura hexagonal (`test_client.py`, `test_upstream_contract.py`).

### 2. Testes de Contrato (`tests/contracts/`)
* **Propósito**: Garantir a estabilidade e a compatibilidade das interfaces públicas expostas pela API REST, rotas de streaming e estrutura de banco de dados.
* **Contratos Validados**:
  * **API REST v1 (`test_api_v1_contract.py`)**: Valida endpoints `/api/v1/agents`, `/api/v1/cases` e `/api/v1/rounds`, garantindo códigos HTTP estáveis (201, 200, 409 Conflict), sanitização de payloads e ausência de credenciais nas respostas.
  * **Streaming SSE (`test_sse_contract.py`)**: Confirma a emissão e formatação dos eventos em `/api/v1/rounds/{id}/events` (`id`, `event`, `data`), encerramento de conexões e retomada de stream a partir do cabeçalho `Last-Event-ID`.
  * **Migrações SQLite (`test_artifact_compatibility.py`)**: Compara os checksums SHA256 das migrations SQL em `src/harness_lab/adapters/sqlite/migrations/` (do script `0001_foundation.sql` ao `0008_round_job_cancellation_leases.sql`) com o arquivo de fixture `tests/contracts/fixtures/sqlite/migration-checksums.json`, prevenindo alterações acidentais em scripts já aplicados.

### 3. Testes de Integração (`tests/integration/`)
* **Propósito**: Validar o funcionamento coordenado entre múltiplos componentes da aplicação, persistência em SQLite e pipelines complexos.
* **Cenários Cobertos**:
  * **Pipeline Completo de Rodadas (`test_complete_round.py`)**: Executa todas as etapas do pipeline de otimização (coleta de cases, diagnóstico, refinamento, execução de candidatos, avaliação com cases reservados e exportação) usando banco SQLite em memória.
  * **Recuperação de Workers (`test_worker_recovery.py`)**: Simula falhas e confirma que o `ProcessRound` retoma a execução a partir de artefatos e checkpoints salvos (ex.: estado `exporting`).
  * **Persistência e Migrações SQLite (`tests/integration/sqlite/`)**: Valida o salvamento e consulta de repositórios (`test_repositories.py`), concorrência de jobs (`test_jobs.py`) e aplicação de migrações (`test_migrations.py`).
  * **Backup e Restauração (`test_sqlite_backup.py`)**: Garante a integridade de cópias de segurança da base SQLite.

### 4. Testes de Interface Web e E2E (`tests/web/` e `tests/e2e/`)
* **Testes de Renderização Web (`tests/web/test_pages.py`)**: Utilizam o `TestClient` do FastAPI para testar o HTML server-rendered via Jinja2, validando rotas da interface web (`/`, `/agents`, `/cases/csv`, `/rounds`), acessibilidade do DOM (`main-content`, atributos ARIA) e CSS estático.
* **Testes E2E em Navegador Real (`tests/e2e/test_harness_lab_ui.py`)**: Utilizam o Playwright (`sync_api`) para executar fluxos completos de operador em um navegador Chromium headless real (criação de agente, importação de cases CSV e disparo de rodadas).

---

## Estratégias de Isolamento de Testes

Para garantir testes reproduzíveis e previsíveis, o sistema adota isolamento rigoroso em múltiplos níveis:

1. **Isolamento de Banco de Dados**:
   * O banco de dados de desenvolvimento/produção (`data/harness.sqlite`) **nunca** é utilizado pela suíte de testes.
   * Testes de unidade e integração utilizam bancos SQLite em memória (`:memory:`).
   * Testes E2E utilizam instâncias temporárias criadas em diretórios isolados via fixture pytest (`tmp_path_factory.mktemp("e2e") / "harness.sqlite"`).

2. **Isolamento de Rede e Requisições Externas**:
   * Testes de unidade e integração usam fakes/stubs em memória para chamadas de APIs externas (como Langfuse e Agent Platform).
   * Testes E2E com Playwright implementam bloqueio estrito de tráfego externo via `page.route("**/*", ...)`: apenas requisições direcionadas à URL do servidor local (`live_server`) são permitidas; todas as demais são abortadas com o código `blockedbyclient`.

3. **Isolamento de Processo e Servidor Live**:
   * A fixture `live_server` em `tests/e2e/conftest.py` inicia um servidor Uvicorn dedicado em uma porta efêmera aleatória (`127.0.0.1:0`), aguarda a prontidão da rota de saúde `/api/v1/health` e encerra o processo de forma limpa ao final dos testes.

4. **Isolamento de Credenciais e Dados Sensíveis**:
   * O sistema utiliza chaves temporárias para criptografia com `SecretBox` (PyNaCl).
   * Testes verificam explicitamente que tokens de autorização e credenciais nunca vazam para payloads de resposta HTTP ou marcações HTML da interface.

---

## Comandos de Execução e Automação

O gerenciamento de dependências e a execução de comandos utilizam a ferramenta `uv`:

### Sincronização do Ambiente
```bash
uv sync --frozen
```

### Execução da Suíte de Testes com Pytest
```bash
# Executar toda a suíte de testes de forma silenciosa
uv run pytest -q

# Executar apenas uma camada específica
uv run pytest -q tests/unit
uv run pytest -q tests/contracts
uv run pytest -q tests/integration
uv run pytest -q tests/web
uv run pytest -q tests/e2e
```

### Análise Estática e Qualidade de Código
```bash
# Checagem de estilo e conformidade de sintaxe com Ruff
uv run ruff check .

# Validação rigorosa de tipos com Mypy
uv run mypy src/harness_lab
```

### Preparação do Ambiente E2E (Playwright)
```bash
# Instalar os navegadores do Playwright (Chromium)
uv run playwright install chromium
```
*Nota*: Opcionalmente, pode-se especificar o executável através da variável de ambiente `PLAYWRIGHT_CHROMIUM_EXECUTABLE` ou diretório de cache `PLAYWRIGHT_BROWSERS_PATH`.

---

## Configuração do Projeto (`pyproject.toml`)

A suíte e as ferramentas de qualidade são configuradas no `pyproject.toml`:

```toml
[dependency-groups]
dev = [
  "pytest>=8.3.0,<9.0.0",
  "pytest-cov>=6.0.0,<7.0.0",
  "ruff>=0.8.0,<1.0.0",
  "mypy>=1.13.0,<2.0.0",
  "playwright>=1.50.0,<2.0.0",
]

[tool.pytest.ini_options]
pythonpath = ["src"]
testpaths = ["tests"]
addopts = "-q"

[tool.ruff]
target-version = "py312"
line-length = 100

[tool.ruff.lint]
select = ["E4", "E7", "E9", "F", "I"]

[tool.mypy]
python_version = "3.12"
strict = true
warn_unused_configs = true
pretty = true
mypy_path = ["src"]
```

---

## Páginas Relacionadas

* [Visão Geral da Arquitetura](../architecture/system-overview.md) — Camadas e desmembramento do monolito modular.
* [Início Rápido](../quickstart.md) — Configuração do ambiente e execução inicial.
* [Pipeline de Rodadas](../workflows/round-pipeline.md) — Etapas de otimização de agentes e execução durável.
