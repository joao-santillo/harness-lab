# Task 3 Report — Portar domínio tipado (Python)

## Escopo executado
- Implementado pacote de domínio Python em `src/harness_lab/domain/` com modelos, transições e portas equivalentes aos contratos TypeScript de referência.
- Adicionados testes unitários de domínio e fixture de contrato sanitizada.
- Nenhum arquivo TypeScript foi modificado nesta task.

## Referências usadas
- `packages/domain/src/model/{case,evaluation,evaluator,evidence,harness,partition,round}.ts`
- `packages/domain/src/model/round.test.ts`
- `packages/domain/src/ports/index.ts`
- `packages/domain/src/ports/index.test.ts`
- `packages/domain/src/index.ts`

## TDD obrigatório (RED → GREEN)

### RED observado (antes da implementação)
Comando:
- `uv run pytest -q tests/unit/domain`

Resultado:
- Falha em coleta com `ModuleNotFoundError: No module named 'harness_lab.domain'` para:
  - `tests/unit/domain/test_round.py`
  - `tests/unit/domain/test_models.py`
  - `tests/unit/domain/test_ports.py`

Interpretação:
- Testes existentes para domínio foram criados primeiro e falharam corretamente pela ausência da implementação.

### GREEN após implementação
Comando:
- `uv run pytest -q tests/unit/domain`

Resultado:
- `................................................ [100%]`

## Implementação realizada

### Modelos de domínio
Criados em `src/harness_lab/domain/models/`:
- `round.py`
  - IDs tipados (NewType), estados/eventos e tabela `ROUND_TRANSITIONS`.
  - `transition_round` com erro explícito: `Invalid round transition: {state} -> {event}`.
  - `apply_round_event` imutável via `model_copy`.
  - `Round`, `RoundProgressEvent`, `RoundCheckpoint`.
- `case.py`: `CaseSource`, `CaseRecord`.
- `evaluation.py`: `EvaluationId`, `CaseEvaluation`, `EvaluationResult`, `VersionedEvaluationResult`.
- `evaluator.py`: `EvaluatorDefinition`.
- `evidence.py`: união de evidências (`trace`, `execution`, `missing_data`), `Finding`, `Hypothesis`.
- `harness.py`: `HarnessSnapshot`, `CandidateChange`, `Candidate`, `ExecutionMetrics`, `ExecutionResult`.
- `partition.py`: `PartitionCase`, `PartitionManifest`, `PartitionOptions`.
- `__init__.py`: base `DomainModel` (frozen, aliases camelCase, sem extras).

### Portas de domínio
Criado `src/harness_lab/domain/ports.py`:
- Contratos de repositórios/engines/publisher via `Protocol`.
- Tipos de request/response tipados para trace, execução de candidato, refinamento, avaliação, export e progresso.
- Unions discriminadas com parsing explícito:
  - `parse_candidate_execution_request`
  - `parse_artifact_export_request`
- `SecretValue` com `repr=False` para não expor valor sensível.

### Export público do pacote
Criado `src/harness_lab/domain/__init__.py`:
- `APP_NAME = "Harness Lab"`
- Re-export explícito de modelos e portas (sem wildcard import).

## Comparação TS ↔ Python (resumo de paridade)
- Estados/eventos/transições de rodada: portados 1:1.
- Tipos de decisão terminal e status de execução: portados 1:1.
- Estruturas de modelos (campos conhecidos): portadas 1:1.
- Casing de borda JSON/persistência: preservado em camelCase por alias generator.
- Objetos de domínio: imutáveis (`frozen=True`).
- Campo opaco (`opaquePayload`): preservado em round-trip sem normalização destrutiva.
- Domínio permanece desacoplado de FastAPI/SQLite/adapters.

## Fixtures e comparação normalizada
Criado:
- `tests/contracts/fixtures/domain/models-roundtrip.json`

Uso:
- `tests/unit/domain/test_models.py` valida round-trip dos modelos contra fixture.
- Comparação normalizada para diferenças estruturais irrelevantes (ex.: `tuple` vs `list`), preservando conteúdo/contrato.

## Testes adicionados
- `tests/unit/domain/test_round.py`
  - Cobre ciclo ativo, caminho de export, transições terminais, cancelamento/falha/limite e transições inválidas.
  - Porta o comportamento do `round.test.ts` com matriz completa de estados/eventos.
- `tests/unit/domain/test_models.py`
  - Valida serialização camelCase, imutabilidade, preservação de payload opaco.
- `tests/unit/domain/test_ports.py`
  - Valida formatos de commit de progresso, unions discriminadas de requests, segregação de request de artifact e não exposição de segredo em `repr`.
  - Inclui verificação de fronteira de import para ausência de tokens proibidos no pacote de domínio.

## Comandos executados e resultados
1. `uv run python --version && uv lock --check`
   - `Python 3.12.14`
   - lock check OK (`Resolved 40 packages in 2ms`)
2. `uv run pytest -q tests/unit/domain`
   - RED inicial observado (módulo inexistente)
3. Implementação
4. `uv run pytest -q tests/unit/domain`
   - GREEN (`48 passed`)
5. `uv run ruff check src/harness_lab/domain tests/unit/domain`
   - Ajustes aplicados (imports/estilo)
6. `uv run pytest -q tests/unit/domain && uv run ruff check src/harness_lab/domain tests/unit/domain`
   - GREEN final + lint OK (`All checks passed!`)

## Arquivos criados (Task 3)
- `src/harness_lab/domain/__init__.py`
- `src/harness_lab/domain/ports.py`
- `src/harness_lab/domain/models/__init__.py`
- `src/harness_lab/domain/models/case.py`
- `src/harness_lab/domain/models/evaluation.py`
- `src/harness_lab/domain/models/evaluator.py`
- `src/harness_lab/domain/models/evidence.py`
- `src/harness_lab/domain/models/harness.py`
- `src/harness_lab/domain/models/partition.py`
- `src/harness_lab/domain/models/round.py`
- `tests/unit/domain/test_round.py`
- `tests/unit/domain/test_models.py`
- `tests/unit/domain/test_ports.py`
- `tests/contracts/fixtures/domain/models-roundtrip.json`

## Observações
- Não foram incluídas alterações preexistentes fora do escopo da task.
- Nenhum artifact de `.venv` ou `src/harness_lab.egg-info/` foi preparado para stage/commit nesta task.

## Task 3 — Fix Round 1 (serialização de opcionais)

### Objetivo
Corrigir semântica de campos opcionais omitíveis para alinhar com os contratos TS, sem aplicar `exclude_none=True` global e preservando nullables obrigatórios.

### TDD (RED → GREEN)
- **RED** após adicionar asserts em `tests/unit/domain/test_models.py`:
  - Falhas esperadas para:
    - inclusão indevida de campos opcionais ausentes no dump;
    - aceitação indevida de `null` explícito em opcionais omitíveis;
    - `Hypothesis` aceitando omissão de `evidenceIds`.
- **GREEN** após ajustes por campo nos modelos.

### Implementação aplicada
- `src/harness_lab/domain/models/harness.py`
  - `source_version`, `artifact_hash`, `opaque_payload` com `Field(exclude_if=lambda value: value is None)`.
  - validator `mode="before"` para rejeitar `null` explícito nesses campos (permitindo omissão).
- `src/harness_lab/domain/models/case.py`
  - `source_reference`, `synthetic_label` com `exclude_if` por campo.
  - validator `mode="before"` para rejeitar `null` explícito e exigir omissão quando ausente.
- `src/harness_lab/domain/models/partition.py`
  - `created_at` com `exclude_if` por campo.
  - validator `mode="before"` para rejeitar `null` explícito.
- `src/harness_lab/domain/models/evidence.py`
  - `Hypothesis.evidence_ids` tornou-se obrigatório (remoção do `default_factory=tuple`).
- `tests/unit/domain/test_models.py`
  - Asserts para omissão de opcionais em `HarnessSnapshot`, `CaseRecord`, `PartitionOptions`.
  - Asserts para rejeição de `null` explícito em opcionais omitíveis.
  - Asserts de preservação de `null` em nullables obrigatórios (`ExecutionMetrics`, `ExecutionResult`, `EvidenceTrace`, `CaseEvaluation`, agregados de `EvaluationResult`).
  - Asserts para `Hypothesis` exigir `evidenceIds` e aceitar lista vazia explícita.
  - Ajuste de compatibilidade da fixture legada no teste de roundtrip (`candidate.snapshot.* = null` convertido para omissão no expected de teste).

### Comandos executados
- `uv run pytest -q tests/unit/domain`
  - RED observado após inclusão dos testes.
- `uv run pytest -q tests/unit/domain && uv run ruff check src/harness_lab/domain tests/unit/domain && uv lock --check`
  - GREEN final, lint OK e lock check OK.
