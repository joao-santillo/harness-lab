# Migração integral do Harness Lab para Python — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Substituir todo o código de aplicação TypeScript por uma aplicação Python com API REST/SSE, worker durável e interface Jinja2/HTMX, reutilizando o Harness² upstream e preservando comportamento, contratos, dados SQLite e segredos existentes.

**Architecture:** Implementar um pacote Python em `src/harness_lab` com as fronteiras de domínio, aplicação, adapters, API, worker e web. Harness² será encapsulado em um adapter que implementa os protocolos upstream e chama a API interna de scheduler/recursão aprovada pelo spike, sem reimplementar o motor. FastAPI/Jinja2 compartilharão serviços e stores; o worker será processo separado; o frontend será HTML/CSS com HTMX e sem lógica de aplicação JavaScript/TypeScript.

**Tech Stack:** Python 3.12, `uv`, FastAPI, Pydantic, Jinja2, HTMX, `sqlite3`, PyNaCl/libsodium compatível, pytest, HTTPX e Playwright Python. Harness² deve ser instalado a partir de uma revisão Git exata verificada, nunca de `main` móvel.

---

## Estrutura de arquivos e fronteiras

### Criar

- `pyproject.toml`, `.python-version`, `uv.lock`: dependências, Python 3.12, testes, lint e comandos Python.
- `src/harness_lab/domain/`: modelos, estados, transições e protocolos de portas.
- `src/harness_lab/application/`: partição, diagnóstico, avaliação, decisões e orquestração do produto.
- `src/harness_lab/adapters/sqlite/`: conexão, runner de migrations, repositories, stores de jobs/artefatos.
- `src/harness_lab/adapters/security/`: criptografia compatível e redaction.
- `src/harness_lab/adapters/langfuse/`, `agent_platform/`, `harness2/`, `export/`: integrações externas e mapeamentos.
- `src/harness_lab/api/`: FastAPI, schemas HTTP, rotas REST/SSE, configuração e erros estáveis.
- `src/harness_lab/worker/`: runtime, provider, lease, cancelamento e inicialização.
- `src/harness_lab/web/`: rotas HTML, `templates/`, `static/styles.css`, cópia versionada de HTMX, localização e fragmentos.
- `tests/contracts/`, `tests/unit/`, `tests/integration/`, `tests/web/`: contratos, testes de domínio/adapters, ciclo de rodada e Playwright Python.

### Migrar a partir destes arquivos

- Domínio: `packages/domain/src/model/{case,evaluation,evaluator,evidence,harness,partition,round}.ts` e `packages/domain/src/ports/index.ts`.
- Aplicação: `packages/application/src/cases/partition-cases.ts`; `diagnosis/{diagnose-executions,taxonomy}.ts`; `evaluation/{evaluate-candidate,recommendation-policy}.ts`; `rounds/{process-round,create-round-stages}.ts`; `connections/register-connection.ts`.
- SQLite: `packages/adapters/src/sqlite/{client,schema,case-repository,run-repository,connection-registration-store,round-artifact-store,round-job-store}.ts` e as oito migrations SQL existentes.
- Segurança/integradores: `packages/adapters/src/security/{encrypted-secret-store,redactor}.ts`; todos os módulos e testes em `packages/adapters/src/langfuse/` e `agent-platform/`; `packages/adapters/src/harness2/`; `packages/adapters/src/export/`.
- API: `apps/api/src/{server,main,config,connection-tester,i18n}.ts`, todas as rotas em `apps/api/src/routes/` e os respectivos testes.
- Worker: `apps/worker/src/{index,config,main,runtime,worker}.ts` e testes.
- Web: `apps/web/src/app.tsx`, `main.tsx`, `features/{cases,connections,rounds}/`, `i18n/messages.ts`, `styles.css`, `index.html`, testes e `e2e/app.spec.ts`.

### Remover somente após paridade e cutover

`apps/api/`, `apps/worker/`, `apps/web/`, `packages/`, configs TypeScript/Vite, configs/testes Vitest, `package.json`, `pnpm-lock.yaml`, `pnpm-workspace.yaml` e `tsconfig.base.json`. Preservar migrations SQL migrando-as sem alterar seu conteúdo nem checksums; preservar documentação de produto atualizando instruções Node/React para Python.

---

## Task 1: Congelar comportamento atual e preparar dados de teste

**Files:**
- Create: `tests/contracts/fixtures/api-v1/` e `tests/contracts/fixtures/sse/`
- Source of truth: `docs/api.md`, `docs/arquitetura.md`, `docs/seguranca.md`, testes TS atuais e migrations SQL.

- [ ] **Step 1: Catalogar o contrato público existente**

  Criar fixtures JSON para exemplos e erros documentados de agentes, conexões, importação JSON/CSV/Langfuse, preview/confirm, rodadas, resultados e cancelamento. Registrar status HTTP, chaves públicas, códigos estáveis e campos proibidos (credenciais, `opaquePayload`, trace input/output bruto).

- [ ] **Step 2: Registrar os casos de contrato para execução Python posterior**

  Preparar exemplos/request-response fixtures em `tests/contracts/fixtures/api-v1/`; os testes executáveis `tests/contracts/test_api_v1_contract.py` serão adicionados na Task 9, junto aos schemas Pydantic. Não alterar nem remover os testes TypeScript que ainda servem como referência.

- [ ] **Step 3: Caracterizar SSE e artefatos versionados**

  Registrar exemplos SSE com `id`, `event: round-progress`, JSON, cursor `Last-Event-ID`, heartbeat e encerramento terminal em `fixtures/sse/`. Os testes de stream e artefato executáveis serão adicionados nas Tasks 4 e 9, quando as implementações estiverem disponíveis.

- [ ] **Step 4: Rodar baseline TypeScript antes de removê-lo**

  Run separadamente: `pnpm -r test`; `pnpm -r typecheck`; `pnpm --filter @harness-lab/web test:e2e`.

  Expected: registrar quais comandos passam e falham no estado corrente; nenhuma falha preexistente será atribuída à migração Python.

- [ ] **Step 5: Commitar apenas os contratos iniciais**

  Commit: `test: characterize current Harness Lab contracts`.

## Task 2: Provar Harness² upstream antes de portar refinamento

**Files:**
- Create: `.python-version`, `pyproject.toml`, `src/harness_lab/__init__.py`, `tests/unit/adapters/harness2/test_upstream_contract.py`
- Create: `src/harness_lab/adapters/harness2/benchmark.py`
- Create: `src/harness_lab/adapters/harness2/substrate.py`
- Modify: `uv.lock`, `THIRD_PARTY_NOTICES.md`
- Reference: `packages/adapters/src/harness2/version.ts`, `tests/characterization/fixtures/harness2-corpus.json`, upstream `harness2/core/{schedule,recursion,spec,library,tree}.py`.

- [ ] **Step 1: Instalar Python 3.12 e validar revisão candidata**

  Criar `pyproject.toml` para o pacote `harness-lab`, requerendo `>=3.12,<3.14`, fixar `.python-version` em `3.12`, declarar dependências runtime (FastAPI, Pydantic, Jinja2, Uvicorn, HTTPX e PyNaCl) e dev (pytest, pytest-cov, ruff, mypy e Playwright Python). Fixar e registrar a versão/licença/hash do asset HTMX local em `THIRD_PARTY_NOTICES.md`. Fixar `harness2` a uma revisão Git exata e rodar `uv lock && uv sync --frozen`. Usar `1cfe254e8d25b15f37048c3730134686abe60335` como primeira candidata, pois é a revisão registrada no produto. Inspecionar nessa revisão se `harness2.core.schedule.run_task`, `BenchmarkAdapter`, `SubstrateLike`, `BenchSpec`, `BenchPrompts` e `RunView` existem e correspondem ao código/documentação upstream. Se não existir a superfície necessária, selecionar uma revisão upstream exata que exista e passe os testes; não seguir `main`.

- [ ] **Step 2: Escrever caracterização que falha sem integração upstream**

  Usar um proposer determinístico de teste, executor local determinístico e adapter de benchmark em memória. Chamar `run_task` com `k=1`, modo paralelo, um task id e uma pasta temporária; afirmar que o Harness² cria uma execução base, candidato/final selecionado e artefatos/library conforme seus próprios módulos. Não usar credenciais, modelos, redes ou benchmarks upstream.

- [ ] **Step 3: Verificar se `run_task` comporta o fluxo do produto**

  O spike deve receber apenas uma tarefa e os dados de diagnóstico; confirmar como são providos proposer, executor, seleção e experiência. Registrar limitações da API interna em `tests/unit/adapters/harness2/test_upstream_contract.py`. Se `run_task` exigir benchmarks/substrates fixos ou não permitir a execução Agent Platform sem copiar lógica upstream, parar e resolver a integração antes de qualquer migração de `run-refinement.ts`.

- [ ] **Step 4: Implementar só o adapter mínimo**

  `benchmark.py` adapta task/domain/prompt/files, execução e resultado aos protocolos upstream; `substrate.py` expõe somente a superfície Harness editável que o produto consegue mapear. Manter IDs e conteúdo de casos reservados inacessíveis a esses objetos. Não duplicar composição, recursão, seleção ou biblioteca de experiência.

- [ ] **Step 5: Fixar dependência e evidência de licença**

  Fixar o SHA validado no `pyproject.toml`/`uv.lock` e registrar o mesmo SHA, origem e Apache-2.0 em `THIRD_PARTY_NOTICES.md`. Não incluir código upstream copiado no repositório.

- [ ] **Step 6: Validar determinismo e isolamento**

  Run: `uv run pytest -q tests/unit/adapters/harness2/test_upstream_contract.py`

  Expected: testes passam sem acesso externo; repetir o comando gera os mesmos resultados normalizados; testes falham se case reservado, id reservado ou conteúdo reservado entrar no benchmark, proposer, logs ou library.

- [ ] **Step 7: Commitar o gate**

  Commit: `feat: add pinned Harness2 Python adapter`.

## Task 3: Portar domínio tipado

**Files:**
- Create: `src/harness_lab/domain/` e `tests/unit/domain/`.
- Portar: models e ports identificados na seção de arquivos.

- [ ] **Step 1: Confirmar o ambiente Python do projeto**

  Run: `uv run python --version && uv lock --check`.

  Expected: Python `3.12.x` e lock sincronizado; as dependências e o pin HTMX foram definidos na Task 2. Não alterar dependências nesta tarefa de domínio.

- [ ] **Step 2: Portar primeiro as transições de rodada por testes**

  Em `tests/unit/domain/test_round.py`, testar todos os estados/eventos legais e ilegais que hoje estão em `packages/domain/src/model/round.test.ts`. Em seguida criar `domain/models/round.py` e `domain/transitions.py` com enums/dataclasses Pydantic ou dataclasses imutáveis, preservando estados e códigos.

- [ ] **Step 3: Portar models de cases, harness, evidência, partição e avaliação**

  Criar módulos separados `domain/models/{case,harness,evidence,partition,evaluation}.py`; portar `evaluator.py` e `ports.py`. Validar IDs, valores obrigatórios, cópias imutáveis e serialização compatível com payloads SQLite versionados.

- [ ] **Step 4: Comparar modelos Python com fixtures dos testes TypeScript**

  Adicionar fixtures sanitizadas sob `tests/contracts/fixtures/domain/` e comparar round-trip JSON normalizado. Não usar diferenças de estilo de JSON como mudança de contrato.

- [ ] **Step 5: Verificar domínio**

  Run: `uv run pytest -q tests/unit/domain`

  Expected: todos os estados válidos/inválidos e fixtures antigas passam; nenhuma camada importa FastAPI, SQLite ou cliente externo.

- [ ] **Step 6: Commitar domínio**

  Commit: `feat: add Python domain models and ports`.

## Task 4: Compatibilidade SQLite, migrations e repositories

**Files:**
- Create: `src/harness_lab/adapters/sqlite/{client,migrations,case_repository,run_repository,connection_registration_store,round_artifact_store,round_job_store}.py`
- Copy byte-for-byte, sem reescrever: `packages/adapters/src/sqlite/migrations/0001_foundation.sql` a `0008_round_job_cancellation_leases.sql` para `src/harness_lab/adapters/sqlite/migrations/`.
- Create: `tests/integration/sqlite/`.
- Create: `tests/contracts/test_artifact_compatibility.py`.
- Create: `tests/contracts/fixtures/sqlite/migration-checksums.json`.

- [ ] **Step 1: Criar testes de migração com banco temporário**

  Testar DB novo e DB interrompido em migration antiga; garantir execução ordenada, checksum, transação de migração, foreign keys, busy timeout, WAL e `synchronous=FULL`. Não apontar os testes ao arquivo real `data/harness.sqlite`.

- [ ] **Step 2: Implementar runner compatível**

  Em `client.py`, usar `sqlite3`, mesmas tabelas de migration/checksums e mesmas pragmas do backend TypeScript. Rejeitar checksum divergente em migration já aplicada. Nunca editar migration antiga; correções de schema usam arquivo novo numerado.

- [ ] **Step 3: Comparar checksum dos oito SQLs**

  Guardar os SHA-256 das oito migrations originais em `tests/contracts/fixtures/sqlite/migration-checksums.json` e comparar os SQLs copiados com esses valores. Assim a garantia sobre migrations aplicadas permanece depois da remoção de `packages/`.

- [ ] **Step 4: Portar stores por contrato**

  Portar case, run, conexão, job, checkpoint e artifact stores. Preservar atomicidade de criação de rodada + job, ownership/lease, cancelamento, idempotência, payload JSON e recuperação da decisão terminal a partir de artefato.

- [ ] **Step 5: Testar compatibilidade com cópia do banco legado**

  Criar uma cópia consistente com SQLite Backup API de um fixture sanitizado criado pelo schema TS; inicializar o runner Python sobre a cópia e verificar agentes, cases, conexões, rodadas, eventos, jobs, secrets e artifacts. Não copiar `-wal`/`-shm` isoladamente nem usar dados sensíveis do workspace em testes.

- [ ] **Step 6: Testar nova tabela apenas se houver requisito de persistência**

  Manter previews Langfuse em memória e API FastAPI com um processo inicialmente, para não persistir conteúdo bruto de trace e preservar o comportamento atual. Documentar `workers=1`; criar store compartilhado/migration adicional somente se requisito de multi-processo surgir.

- [ ] **Step 7: Verificar SQLite**

  Run: `uv run pytest -q tests/integration/sqlite`

  Expected: bancos novos e antigos abrem; migrations não aplicadas seguem a ordem; WAL/checkpoints/jobs/artifacts e constraints são preservados.

- [ ] **Step 8: Commitar persistência**

  Commit: `feat: preserve SQLite data with Python stores`.

## Task 5: Criptografia, redaction, logging e exports

**Files:**
- Create: `src/harness_lab/adapters/security/{encrypted_secret_store,redactor,safe_logging}.py`
- Create: `src/harness_lab/adapters/export/{write_artifact,candidate_exporter,report_exporter}.py`
- Create: `tests/unit/adapters/security/`, `tests/integration/security/`, `tests/unit/adapters/export/`.

- [ ] **Step 1: Definir fixtures criptográficas só de teste**

  Gerar chave aleatória e mensagens sintéticas nos testes; fixtures guardam ciphertext/nonce/`key_version`, nunca segredo real. A forma legada é Base64 canônico, chave de 32 bytes, `crypto_secretbox_easy`, nonce e ciphertext no layout do store atual.

- [ ] **Step 2: Provar leitura cruzada antes de migrar o store**

  Criar um ciphertext pelo backend JS legado em fixture de teste e validar descriptografia em Python; criar ciphertext Python e validar em teste de compatibilidade legado enquanto o código TS existir. Confirmar ordem da MAC/ciphertext, nonce, Base64 e `key_version` contra `encrypted-secret-store.test.ts`.

- [ ] **Step 3: Implementar segredo e redactor**

  Implementar `EncryptedSecretStore` e teste para chave malformada, versão não suportada, ciphertext alterado, nonce inválido e segredo ausente. Portar regras de `redactor.ts` para chaves normalizadas, URLs, query parameters e valores conhecidos. Nunca devolver texto claro em APIs ou exceções.

- [ ] **Step 4: Introduzir logs sem payload sensível**

  `safe_logging.py` deve aceitar códigos/IDs de correlação e campos allowlist; não registrar credentials, URLs privadas, traces, conteúdo de cases, prompts ou `opaquePayload`. Testar logs de cada classe de erro e confirmar ausência dos valores sentinela.

- [ ] **Step 5: Portar escrita de artifacts e exports**

  Preservar caminho `APP_DATA_DIR/exports/<agentId>/<roundId>/`, `candidate.json`, `diff.technical.json`, `diff.txt`, escrita atômica, redaction, hash e permissão `0600`. O resultado público não serializa snapshot completo nem `opaquePayload`.

- [ ] **Step 6: Rodar testes de segurança/export**

  Run: `uv run pytest -q tests/unit/adapters/security tests/integration/security tests/unit/adapters/export`

  Expected: round-trip TS/Python, ciphertext adulterado rejeitado, nenhum segredo nas respostas/logs, exports com hash correto e mode `0600`.

- [ ] **Step 7: Commitar segurança**

  Commit: `feat: preserve secretbox compatibility and secure exports`.

## Task 6: Migrar adapters Langfuse e Agent Platform

**Files:**
- Create: `src/harness_lab/adapters/langfuse/{client,capabilities,normalize,trace_repository,case_import_repository}.py`
- Create: `src/harness_lab/adapters/agent_platform/{client,capabilities,harness_repository,candidate_executor}.py`
- Create: `tests/unit/adapters/langfuse/`, `tests/integration/adapters/langfuse/`, `tests/unit/adapters/agent_platform/`.
- Reference: todos os módulos e fixtures em `packages/adapters/src/langfuse/` e `agent-platform/`.

- [ ] **Step 1: Portar o transporte HTTP por testes fake**

  Usar HTTPX com cliente injetável/transport fake. Testar Basic Auth do Langfuse, Bearer da Agent Platform, timeout, retry, status sanitizado e ausência de tráfego em testes padrão.

- [ ] **Step 2: Portar negociação e normalização Langfuse**

  Preservar probe v2, fallback legado somente em 404/405 autenticado, paginação por cursor/página, retry único de 429 com teto de `Retry-After`, limites de resposta/páginas/observações, normalização de root e limitações declaradas.

- [ ] **Step 3: Portar importação direta e preview/confirm**

  Preservar parser e regras de `case-import-repository.ts`, ID determinístico, deduplicação, no máximo um case por trace, não devolver input/output bruto e não consultar novamente o Langfuse na confirmação. Preview: TTL cinco minutos, limite cem, seleção única/não vazia; seleção inválida não consome; preview ausente/expirado/consumido retorna o mesmo erro estável. Manter API com um processo para o store em memória.

- [ ] **Step 4: Portar o CSV como contrato separado**

  Implementar parser compatível com `case-csv.ts`: LF/CRLF, quoted commas/newlines, escaped quotes, CR isolado inválido, cabeçalho sem duplicatas, colunas exatas, trims e limites de bytes/linhas. Portar testes para delimiters malformados, aspas soltas e campos vazios.

- [ ] **Step 5: Portar os mappers Agent Platform por fixtures**

  Preservar capacidades suportadas, snapshot, `opaquePayload` de campos desconhecidos e hash do snapshot. O executor deve usar ambiente de teste, timeout, correlation/idempotency IDs e erros tipados. Não afirmar compatibilidade com endpoints remotos a partir de fixtures.

- [ ] **Step 6: Implementar factory de provider desativada por padrão**

  Carregar dependências de execução por configuração Python, preservar o contrato de provider documentado em `docs/provider-do-worker.md` e recusar consumo de jobs quando provider não estiver configurado. Não inserir URLs Agent Platform não verificadas.

- [ ] **Step 7: Verificar adapters sem tráfego externo**

  Run: `uv run pytest -q tests/unit/adapters/langfuse tests/integration/adapters/langfuse tests/unit/adapters/agent_platform`

  Expected: todos os casos usam fixtures/fakes; preview e CSV equivalem aos contratos documentados; unknown fields fazem round-trip; provider ausente não reivindica jobs.

- [ ] **Step 8: Commitar integrations**

  Commit: `feat: port Langfuse and Agent Platform adapters to Python`.

## Task 7: Portar regras de produto e avaliação independente

**Files:**
- Create: `src/harness_lab/application/{cases,diagnosis,evaluation,connections}/`
- Create: `tests/unit/application/{cases,diagnosis,evaluation,connections}/`
- Source: módulos de `packages/application/src/` exceto refinamento genérico, que será delegado ao Harness².

- [ ] **Step 1: Portar particionamento com teste de isolamento**

  Copiar os vetores de teste atuais para `tests/unit/application/cases/test_partition.py`: seed estável, agrupamento transitivo por sessão/grupo semântico, minimum reserved, disjunção e manifestação selada. Spy no adapter Harness² verifica que recebe só diagnosis IDs/content.

- [ ] **Step 2: Portar diagnóstico e taxonomy**

  Portar detectores para violação de regra, ferramenta, parâmetro, resposta não suportada, contexto, repetição, custo, latência e falhas. Cada finding mantém observação distinta de hipótese, denominador, impacto, confiança, sources sanitizados e limitações. Falha de infraestrutura não vira automaticamente mudança de prompt.

- [ ] **Step 3: Portar política de mudança e registrar limites Harness²**

  Manter no domínio do produto apenas whitelist/imutabilidade dos componentes Agent Platform e validação de evidências/scope necessárias à conversão; remover a lógica de scheduler, recursão, composição e experiência própria depois que a Task 2 comprovar delegação upstream.

- [ ] **Step 4: Portar avaliação e recomendações**

  Preservar sinais determinísticos, custo/tokens/latência, regressões, tamanho mínimo de amostra, confiança, variabilidade, falha crítica, limitações e todas as decisões terminais. Avaliação usa exclusivamente reserved cases e não importa `harness2.core`.

- [ ] **Step 5: Portar registro de conexão**

  Preservar validação do tipo, teste de conexão, idempotência e erros estáveis; não fazer o tester da Agent Platform alegar autenticação que hoje não verifica.

- [ ] **Step 6: Comparar resultados com testes TypeScript**

  Para cada vector de `partition-cases.test.ts`, `diagnose-executions.test.ts`, `evaluate-candidate.test.ts`, `recommendation-policy.test.ts` e `register-connection.test.ts`, comparar JSON normalizado, estados e decisões.

- [ ] **Step 7: Validar domínio de produto**

  Run: `uv run pytest -q tests/unit/application`

  Expected: sem vazamento para refinamento, os casos reservados entram apenas em avaliação e todas as decisões/limites coincidem com os testes de referência.

- [ ] **Step 8: Commitar application**

  Commit: `feat: port Harness Lab domain policies to Python`.

## Task 8: Orquestração de rodada e worker durável

**Files:**
- Create: `src/harness_lab/application/rounds/{process_round,create_round_stages}.py`
- Create: `src/harness_lab/worker/{runtime,worker,config,main}.py`
- Create: `tests/unit/application/rounds/`, `tests/integration/test_complete_round.py`, `tests/integration/test_worker_recovery.py`.
- Reference: `apps/worker/src/`, `packages/application/src/rounds/` e stores SQLite da Task 4.

- [ ] **Step 1: Testar pipeline completo com providers fakes**

  Criar rodada fake com coleta, partição, diagnóstico, adapter Harness² fake do teste de contrato, execução reserved, avaliação e export. Assegurar ordem das etapas e verificação de ownership antes/depois de cada etapa.

- [ ] **Step 2: Portar stage artifacts/checkpoints**

  Cada etapa lê o artifact persistido anterior, grava o snapshot com `payload_version: 1` e não confirma estado terminal antes de persistência. Depois de reinício em `exporting`, recuperar decisão do artifact; se ausente/corrompido, terminar como integração falha.

- [ ] **Step 3: Portar fila, lease e cancelamento literalmente**

  Manter duração de lease 30 s e o comportamento atual (sem renovação durante estágio; ownership checado nas fronteiras), a menos que testes de estresse mostrem falha e um design separado aprove a mudança. Cancelamento cooperativo continua checado entre etapas, não promete interromper execução remota em andamento.

- [ ] **Step 4: Implementar processos e encerramento**

  `worker/main.py` conecta configuração/provider/stores, não inicia job com provider ausente, trata SIGTERM/KeyboardInterrupt e fecha conexões sem perder lease/estado. API e worker usam a mesma localização SQLite mas são processos independentes; apenas um worker pode reivindicar um job por lease.

- [ ] **Step 5: Testar interrupções, retomada e corrida**

  Cobrir crash antes/depois de gravar artifacts, expiração de lease, worker concorrente, cancelamento, evento terminal, falha de export e retomada. Testar `data/harness.sqlite` somente via backup descartável e explicitamente escolhido pelo operador; nunca executar worker no banco do workspace durante testes.

- [ ] **Step 6: Rodar testes do ciclo**

  Run: `uv run pytest -q tests/unit/application/rounds tests/integration/test_complete_round.py tests/integration/test_worker_recovery.py`

  Expected: rodada hermética produz artifact/decisão/export; retomada não repete etapa concluída nem inventa decisão.

- [ ] **Step 7: Commitar worker**

  Commit: `feat: port durable round worker to Python`.

## Task 9: API FastAPI compatível e SSE

**Files:**
- Create: `src/harness_lab/api/{app,config,errors,i18n,schemas}.py`
- Create: `src/harness_lab/api/routes/{agents,connections,cases,rounds,events}.py`
- Create: `tests/contracts/test_api_v1_contract.py`, `tests/contracts/test_sse_contract.py`, `tests/integration/api/`.
- Implement: `tests/contracts/test_artifact_compatibility.py` created in Task 4.
- Source: `apps/api/src/` e `docs/api.md`.

- [ ] **Step 1: Implementar app factory e schemas**

  Criar `create_app(services, settings)` para permitir dependências fake nos testes. Pydantic schemas só aceitam campos de entrada documentados e limitam saídas públicas; payload de erro contém `code` estável e mensagem localizada quando aplicável.

- [ ] **Step 2: Portar rotas simples primeiro**

  Implementar agentes e conexões GET/POST/DELETE, idempotency, teste de conexão e credenciais públicas configuradas. Comparar status/JSON com fixtures da Task 1.

- [ ] **Step 3: Portar cases e limites de import**

  Implementar listagem por escopo obrigatório, JSON, CSV, Langfuse direto, preview e confirmação. Reusar os adapters e preview store da Task 6. Preservar atomicidade, limite de 40 cases e erros de scope/duplicate.

- [ ] **Step 4: Portar rodadas/resultados/cancelamento**

  Criação de rodada valida existência de agente, escopo e no mínimo dois cases e enfileira job atomicamente. `GET results` expõe somente decisão, amostra, confiança, agregado, regressões, limitações e justificativa.

- [ ] **Step 5: Implementar SSE reproduzível**

  Streaming `text/event-stream` com formato e cursor atual; replay a partir de `Last-Event-ID`, heartbeat de 15 segundos, consulta de eventos no intervalo atual de 250 ms e término ao estado terminal. Cursor inválido retoma do início. Não adicionar porcentagem.

- [ ] **Step 6: Portar `connection-tester`, config e i18n API**

  Preservar variáveis/config defaults, erro na inicialização quando chave de cifragem inválida, texto/localização API e sanitização. Não criar `.env` com secrets reais; manter `.env.example` com placeholders já existentes.

- [ ] **Step 7: Rodar contratos e API integration**

  Run: `uv run pytest -q tests/contracts tests/integration/api`

  Expected: fixtures REST/SSE passam; casos de erro confirmam códigos; streams retomam sem duplicação inesperada; nenhuma resposta vaza credenciais, opaque snapshots ou corpo remoto.

- [ ] **Step 8: Commitar API**

  Commit: `feat: add compatible Python REST and SSE API`.

## Task 10: Interface Jinja2/HTMX e localização

**Files:**
- Create: `src/harness_lab/web/{routes,context,i18n}.py`
- Create: `src/harness_lab/web/templates/{base,agents,cases,connections,rounds,results}.html` e `templates/partials/`.
- Create: `src/harness_lab/web/static/{styles.css,htmx.min.js}` e `tests/web/`.
- Source: telas/tests de `apps/web/src/`, `apps/web/e2e/app.spec.ts`, `apps/web/src/styles.css` e `apps/api/src/i18n.ts`.

- [ ] **Step 1: Migrar navegação, shell e tokens visuais**

  Criar template base com landmarks semânticos, navegação e rotas para cases/agentes, conexões, rodadas e resultados. Copiar/adaptar `styles.css`; manter layout responsivo em 680px, estilos de foco, reduced motion e estados disabled. Incluir versão HTMX fixada localmente e notice de licença.

- [ ] **Step 2: Migrar telas de conexões e segredos**

  Templates de cadastro/lista, validação de formulário, limpar campos de segredo após resposta, nunca repopular valores, manter mensagens configurado/não configurado e erros de conexão. Testar tab/teclado e leitores de tela.

- [ ] **Step 3: Migrar importação/revisão de cases**

  Formulários HTML para JSON, CSV e Langfuse; preview mostra metadados/status sem input de trace; seleção de itens e confirmação usam POST/HTMX. Erro de seleção inválida preserva o preview para correção; sucesso atualiza lista/import count.

- [ ] **Step 4: Migrar rodadas e resultados**

  Formulário de criação, cancelamento cooperativo, fragmentos de progresso e resultados com métricas/limitações. Atualização parcial via polling HTMX consulta rota HTML interna, não chama a própria API por HTTP. Manter `/api/v1` SSE para clientes externos e testes de contrato.

- [ ] **Step 5: Migrar pt-BR/en/es**

  Portar mensagens de `messages.ts` e `apps/api/src/i18n.ts` para catálogos Python tipados; testar que todas as chaves referenciadas em templates existem nos três idiomas e que `Accept-Language` respeita locale fallback atual.

- [ ] **Step 6: Testar templates, acessibilidade e comportamento sem JS de produto**

  Testar páginas completas e fragments com TestClient; garantir forms funcionam com POST e redirect/full page mesmo sem HTMX. Verificar `aria-*`, labels, mensagens `status/alert`, navegação por teclado, overflow/responsividade e reduced-motion.

- [ ] **Step 7: Commitar a UI Python**

  Commit: `feat: replace React screens with Jinja2 and HTMX`.

## Task 11: Migrar E2E para Playwright Python e verificar paridade

**Files:**
- Create: `tests/e2e/test_harness_lab_ui.py`, `tests/e2e/conftest.py`.
- Remove later: `apps/web/e2e/app.spec.ts`, `apps/web/playwright.config.ts`, Vitest/Testing Library configs.

- [ ] **Step 1: Subir API Python + worker fake + banco temporário**

  Fixture Playwright inicia FastAPI em porta local temporária, SQLite tmp e provider fake. Bloquear requests externas no browser e nos adapters. Instalar o browser de teste com `uv run playwright install chromium`; CI usa o cache/versionamento do Playwright resolvido pelo lock.

- [ ] **Step 2: Migrar fluxos visíveis atuais**

  Testar setup de conexão Langfuse/Agent Platform, criação de agente, import JSON/CSV, preview e seleção Langfuse, criação/cancelamento de rodada, resultado, navegação pt-BR/en, layout mobile e limpeza de segredos. Usar mocks HTTP isolados, sem declarar teste como prova de integração de produção.

- [ ] **Step 3: Cobrir SSE/API separadamente do UI**

  Manter `tests/contracts/test_sse_contract.py` e testar desconexão/reconexão, `Last-Event-ID`, cursor inválido, heartbeat e eventos terminais. E2E pode validar atualização de fragmentos HTML, não substituir contrato do stream.

- [ ] **Step 4: Rodar suíte completa Python**

  Run: `uv run pytest -q`

  Expected: unit, contract, integration e E2E passam; nenhum teste exige segredo real, banco do workspace ou rede externa.

- [ ] **Step 5: Commitar E2E**

  Commit: `test: cover Python UI and API end to end`.

## Task 12: Operação, documentação e execução local

**Files:**
- Modify: `README.md`, `docs/README.md`, `docs/api.md`, `docs/arquitetura.md`, `docs/desenvolvimento.md`, `docs/operacao.md`, `docs/seguranca.md`, `docs/provider-do-worker.md`, `docs/integracoes.md`, `docs/guia-do-usuario.md`, `docs/limites.md`, `docs/suporte-e-erros.md`, `docs/decisoes-tecnicas.md`, `docs/referencias.md`, `.env.example`, `.gitignore`.
- Create: `scripts/backup_sqlite.py`, `scripts/run_local.py` somente se os comandos existentes forem insuficientes.
- Create: `tests/integration/test_local_startup.py`.

- [ ] **Step 1: Documentar setup sem Node**

  README instala Python 3.12 e `uv sync --frozen`, configura `.env`, executa `uv run uvicorn harness_lab.api.app:app` e worker Python em processo/terminal separado. Documentar que API usa um processo enquanto preview store for in-memory e worker é desabilitado sem provider válido.

- [ ] **Step 2: Documentar backup/rollback**

  Script usa SQLite Backup API ou requer serviço parado; nunca copia WAL/SHM isolados. Instruções distinguem caminho do banco, exports, chave de cifragem e backup seguro da key.

- [ ] **Step 3: Atualizar segurança e integrações**

  Explicar compatibilidade secretbox, logs allowlisted, traces/cases não confiáveis, SQLite operacional em claro, Agent Platform não validada e restrição de provider. Não afirmar que credenciais Agent Platform estão autenticadas remotamente.

- [ ] **Step 4: Rodar verificação de referências antigas**

  Procurar comandos `pnpm`, `npm`, `vite`, React e Fastify na documentação operacional. Manter referências históricas só quando claramente identificadas como arquitetura anterior ou origem dos contratos.

- [ ] **Step 5: Validar docs e scripts**

  Run: `uv run pytest -q tests/integration/test_local_startup.py`

  Expected: comandos documentados iniciam API em SQLite temporário, páginas HTML respondem e worker não reivindica jobs sem provider.

- [ ] **Step 6: Commitar docs operacionais**

  Commit: `docs: document Python deployment and data safety`.

## Task 13: Cutover único e remoção TypeScript

**Files:**
- Remove: diretórios e manifests listados em “Remover somente após paridade e cutover”.
- Modify: `.gitignore`, `THIRD_PARTY_NOTICES.md`, docs e workflows CI.
- Preserve: `tests/characterization/fixtures/harness2-corpus.json`, `data/harness.sqlite` e diretório de exports; não adicionar DB/banco real ao commit.

- [x] **Step 1: Gate pré-cutover**

  Exigir: todas as Tasks 1–12 aceitas; testes Python completos; banco de teste derivado do schema TS; teste cruzado de cifra; backup ensaiado e hash/legibilidade verificados; usuário/operador escolheu explicitamente o caminho do banco real; provider externo permanece desabilitado se contrato oficial não foi entregue.

- [x] **Step 2: Criar backup consistente sem tocar nos dados originais**

  Parar API/worker TS, usar SQLite Backup API para novo arquivo com timestamp em diretório protegido, validar migrations/checksums e abrir cópia read-only. Não remover arquivos do workspace de usuário. Feito via `scripts/backup_sqlite.py` (SHA `7625621f…`, integrity_check OK, chmod 0600).

- [x] **Step 3: Executar migração de leitura/escrita na cópia**

  Apontar backend Python ao backup de validação, iniciar API/worker, executar smoke local de CRUD e rodadas com provider fake, validar dados antigos, segredo cifrado, artifacts, export redacted e retomada; parar processos e comparar invariantes.

- [x] **Step 4: Definir rollback objetivo**

  Antes de aceitar escrita nova no banco real, registrar comando para restaurar o backup com ambos runtimes parados. Se Python tiver escrito em banco migrado, rollback só é permitido se nenhum formato novo incompatível tiver sido gravado; não rodar dois escritores simultaneamente. Procedimento documentado em `docs/operacao.md`.

- [x] **Step 5: Remover o backend e frontend TS**

  Após cutover aceito, excluir `apps/`, `packages/`, manifests pnpm/TS, código e testes Vitest, React/Vite e Playwright TS. Manter CSS migrado, fixtures de caracterização necessárias e avisos de licença; atualizar CI para `uv sync --frozen`, `uv run pytest`, lint e type-check Python. Commit `ef0eb96` removeu 143 arquivos; CI Python adicionado em `f79a5bb`.

- [x] **Step 6: Verificar repositório sem dependência de Node**

  Run: `uv run pytest -q && uv run ruff check . && uv run mypy src/harness_lab`

  Expected: suite toda passa e não há runtime/build de aplicação Node. Em seguida rodar busca rastreada de `typescript`, `tsx`, `pnpm`, `vite`, `react` e conferir que só permanecem referências históricas, locks/cópias de assets de terceiros autorizados ou documentos de migração. Verificado: ruff pass, mypy 78 arquivos limpo, 193 testes passam; refs restantes apenas em planos/specs históricos.

- [x] **Step 7: Commitar remoção só após validação**

  Commits: `ef0eb96 chore: remove legacy TypeScript stack after Python cutover` e `f79a5bb ci: add Python quality gate workflow`.

## Gate final de aceite

- [ ] API REST/SSE preserva contratos públicos, códigos de erro e retomada por `Last-Event-ID`.
- [ ] Banco legado abre sem reescrever migrations aplicadas; dados, checksums, jobs, checkpoints e artifacts permanecem legíveis.
- [ ] Segredos cifrados pelo formato antigo são descriptografados pelo Python; segredos nunca aparecem em resposta/log.
- [ ] Harness² pinado executa refinamento pelo adapter com teste de contrato e sem duplicar recursão/composição/seleção/reflection.
- [ ] Casos reservados são excluídos de Harness², proposer, probes, logs e library; avaliação usa-os independentemente.
- [ ] Fluxos Langfuse, incluindo fallback e preview/confirm, mantêm as garantias atuais; API single-process está documentada enquanto preview for in-memory.
- [ ] Worker mantém lease, cancelamento, checkpoints, retomada e falha fechada.
- [ ] UI Jinja2/HTMX cobre conexões, cases, importações, rodadas e resultados, responsividade, localização e acessibilidade; Playwright Python cobre caminhos críticos.
- [ ] Cutover e rollback foram ensaiados em cópia e nenhuma API/worker TypeScript escreve simultaneamente com Python.
- [ ] Após cutover, aplicação e testes não dependem de TypeScript, React, Vite, pnpm ou Node.
- [ ] Integração real Agent Platform permanece explicitamente bloqueada até receber contrato oficial/ambiente de teste; a migração não reivindica essa validação.
