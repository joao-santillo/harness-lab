---
type: workflow
title: Particionamento de Casos e Diagnóstico de Falhas
description: Especificação técnica do algoritmo de partição determinística de casos de teste, isolamento estrito entre diagnóstico e validação reservada, e diagnose taxonômica de falhas de execução no Harness Lab.
tags: [case-partitioning, diagnosis-taxonomy, data-isolation, seed-deterministic, harness-refinement, evidence-tracing]
verified:
  - by: openwiki/0.7.2
    at: 2026-11-06T14:17:17.542Z
sources:
  - id: openwiki-source-6ca105ed2483beeaca168ea7
    resource: repo://src/harness_lab/application/cases/partition_cases.py
  - id: openwiki-source-2a9bc98995c24709a37e8f97
    resource: repo://src/harness_lab/application/diagnosis/diagnose_executions.py
  - id: openwiki-source-30783eca82772c3ef9e4e16e
    resource: repo://src/harness_lab/application/diagnosis/taxonomy.py
  - id: openwiki-source-2a24e797ae3203e0a70d4b38
    resource: repo://src/harness_lab/domain/models/partition.py
  - id: openwiki-source-2fc1287b7b26b2de80b5e9ca
    resource: repo://tests/unit/application/cases/test_partition.py
  - id: openwiki-source-a917f9f9c24b8b2549f2379b
    resource: repo://tests/unit/application/diagnosis/test_diagnosis.py
generated: { by: "openwiki/0.7.2", at: "2026-11-06T14:17:17.542Z" }
---

# Particionamento de Casos e Diagnóstico de Falhas

O **Particionamento de Casos e Diagnóstico de Falhas** constitui o mecanismo central de segurança metodológica e análise diagnóstica do Harness Lab. A sua finalidade primária é prevenir o vazamento de dados (*data leakage*) entre o corpus de casos utilizado para o aprendizado/refinamento de agentes de IA e o conjunto reservado (*held-out*) destinado à validação final, além de fornecer um motor determinístico para identificar e categorizar falhas de execução.

Esta arquitetura viabiliza o isolamento rigoroso exigido pelo [Framework Harness2 e Metodologia de Avaliação](../concepts/harness2-framework.md), assegurando que qualquer proposta de edição no agente seja elaborada apenas com evidências do conjunto de diagnóstico, mantendo a amostra de teste final estritamente inviolável.

---

## 1. Algoritmo de Particionamento Determinístico

O processo de particionamento de casos é orquestrado no módulo [`src/harness_lab/application/cases/partition_cases.py`](../../src/harness_lab/application/cases/partition_cases.py). O algoritmo converte um conjunto de casos de entrada em um manifesto imutável (`PartitionManifest`), dividindo os IDs de casos entre `diagnosis_ids` (disponíveis para inspeção e refinamento) e `reserved_ids` (reservados exclusivamente para validação).

### 1.1. Estruturas de Dados do Domínio

As entidades de particionamento são modeladas em [`src/harness_lab/domain/models/partition.py`](../../src/harness_lab/domain/models/partition.py):

* **`PartitionCase`**: Representa um caso individual com os atributos `id`, `session_id`, `similarity_group` e `content` ([`src/harness_lab/domain/models/partition.py#L10-L14`](../../src/harness_lab/domain/models/partition.py#L10-L14)).
* **`PartitionOptions`**: Define os parâmetros de divisão, incluindo a semente determinística `seed`, a quantidade mínima reservada `minimum_reserved`, a proporção alvo `reserved_ratio` e o carimbo opcional `created_at` ([`src/harness_lab/domain/models/partition.py#L25-L36`](../../src/harness_lab/domain/models/partition.py#L25-L36)).
* **`PartitionManifest`**: O manifesto final contendo a versão (`1`), a semente utilizada, a tupla `diagnosis_ids`, a tupla `reserved_ids` e a data de criação (`created_at`) ([`src/harness_lab/domain/models/partition.py#L17-L22`](../../src/harness_lab/domain/models/partition.py#L17-L22)).

### 1.2. Agrupamento Transitivo Sintático e Semântico

Para evitar o vazamento indireto de dados — no qual casos altamente semelhantes ou pertencentes à mesma sessão interativa são divididos entre o grupo de diagnóstico e o reservado —, o algoritmo realiza um **agrupamento transitivo** ([`src/harness_lab/application/cases/partition_cases.py#L19-L42`](../../src/harness_lab/application/cases/partition_cases.py#L19-L42)).

Dois casos $A$ e $B$ pertencem à mesma partição atômica (grupo de equivalência) se compartilharem:
1. O mesmo `session_id` (agrupamento sintático/estrutural); OU
2. O mesmo `similarity_group` (agrupamento semântico de domínio).

Se o caso $A$ compartilha a mesma sessão com $B$, e $B$ compartilha o mesmo grupo de similaridade com $C$, os casos $A$, $B$ e $C$ são agrupados na mesma partição indivisível. O algoritmo expande essa relação de equivalência de forma transitiva até que todos os casos fiquem alocados em grupos disjuntos.

### 1.3. Ranqueamento Determinístico via SHA-256

Uma vez formados os grupos indivisíveis, eles precisam ser selecionados para o conjunto reservado sem introduzir viés nem dependência da ordem de entrada. A ordenação dos grupos é realizada pela função `_stable_rank` ([`src/harness_lab/application/cases/partition_cases.py#L14-L16`](../../src/harness_lab/application/cases/partition_cases.py#L14-L16)):

$$\text{hash} = \text{SHA256}(\text{seed} \parallel \text{NUL} \parallel \text{id}_1 \parallel \text{NUL} \parallel \dots \parallel \text{id}_k)$$

Onde $\text{id}_1, \dots, \text{id}_k$ são os identificadores ordenados dos casos dentro daquele grupo. Os grupos são então ordenados lexicalmente pelo hash SHA-256 gerado.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    subgraph Input["Casos de Entrada (PartitionCase)"]
        C1["Caso a1<br/>session-a / billing"]
        C2["Caso a2<br/>session-a / billing"]
        C3["Caso b1<br/>session-b / refund"]
        C4["Caso c1<br/>session-c / refund"]
        C5["Caso d1<br/>session-d / shipping"]
    end

    subgraph Grouping["Agrupamento Transitivo (_grouped_cases)"]
        G1["Grupo A: [a1, a2]<br/>(mesmo session_id)"]
        G2["Grupo B: [b1, c1]<br/>(mesmo similarity_group)"]
        G3["Grupo C: [d1]"]
    end

    subgraph Ranking["Ranqueamento por Hash SHA-256 (_stable_rank)"]
        R1["Hash(seed + Group A)"]
        R2["Hash(seed + Group B)"]
        R3["Hash(seed + Group C)"]
    end

    subgraph Allocation["Alocação de Alvo (target = max(min, ceil(total * ratio)))"]
        DIAG["diagnosis_ids<br/>(Conjunto Visível)"]
        RES["reserved_ids<br/>(Conjunto Reservado)"]
    end

    Input --> Grouping
    Grouping --> Ranking
    Ranking --> Allocation
    Allocation --> DIAG
    Allocation --> RES
```
*Fluxo de agrupamento transitivo, ordenação por hash SHA-256 e partição entre diagnóstico e reservado.*

### 1.4. Regras de Preenchimento e Validações de Fronteira

A função `partition_cases` ([`src/harness_lab/application/cases/partition_cases.py#L45-L83`](../../src/harness_lab/application/cases/partition_cases.py#L45-L83)) calcula o tamanho alvo do conjunto reservado:

$$\text{target} = \max(\text{options.minimum\_reserved}, \lceil \text{len(cases)} \times \text{options.reserved\_ratio} \rceil)$$

A iteração percorre os grupos ordenados e adiciona grupos inteiros a `reserved` desde que a inclusão não consuma a totalidade dos casos (`len(reserved) + len(group) < len(normalized_cases)`).

O algoritmo impõe validações rigorosas de pré e pós-condições:
* `PARTITION_REQUIRES_MULTIPLE_CASES`: Lançado se o número total de casos for menor que 2.
* `RESERVED_SIZE_INVALID`: Lançado se `minimum_reserved < 1` ou se `minimum_reserved >= len(cases)`.
* `RESERVED_RATIO_INVALID`: Lançado se `reserved_ratio <= 0` ou `>= 1`.
* `CASE_ID_DUPLICATE`: Lançado se houver IDs de caso duplicados no conjunto fornecido.
* `RESERVED_SIZE_UNSATISFIABLE`: Lançado se, após tentar adicionar os grupos respeitando o isolamento transitivo, o tamanho final retido for inferior a `options.minimum_reserved` (e.g., quando um único grupo indivisível engloba todos os casos ou impede a retenção do mínimo sem esgotar os casos de diagnóstico).

---

## 2. Barreira de Isolamento e Proteção Contra Vazamento de Dados

Para garantir que o agente ou o componente propositor de refinamento ([`evaluation-refinement.md`](evaluation-refinement.md)) nunca acesse casos do conjunto reservado, a aplicação implementa três camadas de proteção em código:

### 2.1. Selamento do Manifesto (`seal_partition_manifest`)

A função `seal_partition_manifest` ([`src/harness_lab/application/cases/partition_cases.py#L86-L93`](../../src/harness_lab/application/cases/partition_cases.py#L86-L93)) garante que o manifesto seja convertido em uma estrutura imutável composta exclusivamente por tuplas para `diagnosis_ids` e `reserved_ids`.

### 2.2. Execução de Refinamento com Projeção Imutável (`run_refinement_with_diagnosis_cases`)

A função assíncrona `run_refinement_with_diagnosis_cases` ([`src/harness_lab/application/cases/partition_cases.py#L96-L107`](../../src/harness_lab/application/cases/partition_cases.py#L96-L107)) atua como uma ponte segura para invocar callbacks de refinamento. Ela projeta **apenas** os casos contidos em `manifest.diagnosis_ids`.

Além de filtrar os casos por ID, ela mascara os registros utilizando `MappingProxyType` expondo apenas as chaves indispensáveis `{"id": ..., "content": ...}`. Os metadados de agrupamento (`session_id` e `similarity_group`) e os dados dos casos reservados permanecem inteiramente inacessíveis no contexto de execução do refinador.

### 2.3. Validação de Fontes de Aprendizado (`assert_learning_sources`)

A função `assert_learning_sources` ([`src/harness_lab/application/cases/partition_cases.py#L110-L116`](../../src/harness_lab/application/cases/partition_cases.py#L110-L116)) inspeciona uma lista de IDs de casos relatados como fonte de uma lição ou evidência no ciclo [Propose-Probe-Compose](../concepts/harness2-framework.md#2-o-ciclo-iterativo-propose-probe-compose).

Se qualquer ID listado pertencer a `reserved_ids` (ou seja, não estiver contido em `manifest.diagnosis_ids`), a função interrompe a execução imediatamente disparando um erro:

```python
ValueError("RESERVED_CASE_EVIDENCE_FORBIDDEN")
```

Isso impede que uma proposta de alteração no harness seja aceita se tiver sido gerada com base na observação direta ou indireta do conjunto reservado.

---

## 3. Diagnóstico de Execuções e Taxonomia de Falhas

Após a execução de uma rodada de testes sobre os casos visíveis ([`round-pipeline.md`](round-pipeline.md)), o módulo [`src/harness_lab/application/diagnosis/diagnose_executions.py`](../../src/harness_lab/application/diagnosis/diagnose_executions.py) analisa os traços de execução (`DiagnosticTrace`) e produz um relatório estruturado `DiagnosisResult`.

### 3.1. Taxonomia de Falhas (`DiagnosisCategory`)

A taxonomia oficial do sistema é definida em [`src/harness_lab/application/diagnosis/taxonomy.py`](../../src/harness_lab/application/diagnosis/taxonomy.py) e abrange 11 categorias fixas, avaliadas de forma determinística em uma ordem estrita ([`src/harness_lab/application/diagnosis/taxonomy.py#L19-L31`](../../src/harness_lab/application/diagnosis/taxonomy.py#L19-L31)):

| Categoria | Condição de Detecção (`_DETECTORS`) | Severidade | Acionável pelo Harness? |
| :--- | :--- | :--- | :--- |
| **`RULE_VIOLATION`** | `rule_violation` preenchido e não vazio | `critical` | Sim (`proposed_change=True`) |
| **`MISSING_TOOL`** | Ferramenta esperada em `expected_tools` ausente das chamadas (`tool_calls`) | `medium` | Sim (`proposed_change=True`) |
| **`UNNECESSARY_TOOL`** | `expected_tools` explicitamente vazio `()` e chamadas realizadas | `medium` | Sim (`proposed_change=True`) |
| **`INVALID_TOOL_PARAMETERS`** | Alguma chamada possui `valid_parameters=False` | `medium` | Sim (`proposed_change=True`) |
| **`UNSUPPORTED_ANSWER`** | `unsupported_answer` igual a `True` | `medium` | Sim (`proposed_change=True`) |
| **`CONTEXT_FAILURE`** | `context_failure` igual a `True` | `medium` | Sim (`proposed_change=True`) |
| **`REPETITION`** | `repetition_count > 2` | `medium` | Sim (`proposed_change=True`) |
| **`COST_LIMIT_EXCEEDED`** | `cost > cost_limit` | `medium` | Sim (`proposed_change=True`) |
| **`LATENCY_LIMIT_EXCEEDED`** | `latency_ms > latency_limit_ms` | `medium` | Sim (`proposed_change=True`) |
| **`INFRASTRUCTURE_FAILURE`** | `infrastructure_failure` preenchido e não vazio | `high` | **Não** (`proposed_change=False`) |
| **`TOOL_FAILURE`** | Alguma chamada de ferramenta possui `failed=True` | `high` | **Não** (`proposed_change=False`) |

### 3.2. Sanitização de Trechos e Segurança de Dados (`_sanitize_excerpt`)

Antes de anexar trechos da saída do agente a objetos `EvidenceTrace`, a função `_sanitize_excerpt` ([`src/harness_lab/application/diagnosis/diagnose_executions.py#L49-L56`](../../src/harness_lab/application/diagnosis/diagnose_executions.py#L49-L56)) sanitiza os dados via expressão regular, omitindo automaticamente credenciais como tokens, senhas, segredos e chaves de API:

```python
re.sub(
    r"(authorization|token|secret|password|api[_-]?key)\s*[:=]\s*\S+",
    r"\1=[REDACTED]",
    excerpt,
    flags=re.IGNORECASE,
)
```

Isso previne o vazamento acidental de segredos nos logs de evidências e resumos de rodada.

### 3.3. Categorias Não Pertencentes ao Harness (`NON_HARNESS_CATEGORIES`)

Nem todas as falhas observadas em uma rodada são passíveis de correção via ajuste do harness (instruções, diretrizes ou prompts do agente). As categorias `INFRASTRUCTURE_FAILURE` e `TOOL_FAILURE` pertencem a `NON_HARNESS_CATEGORIES` ([`src/harness_lab/application/diagnosis/taxonomy.py#L33-L36`](../../src/harness_lab/application/diagnosis/taxonomy.py#L33-L36)).

Quando o motor de diagnose encontra traços que correspondem a essas categorias:
1. Emite a evidência (`EvidenceTrace`) e o achado (`Finding`) normalmente.
2. Registra o objeto `DiagnosisActionability` com `proposed_change=False` e o motivo `"Repair the integration before changing the harness."` ([`src/harness_lab/application/diagnosis/diagnose_executions.py#L187-L197`](../../src/harness_lab/application/diagnosis/diagnose_executions.py#L187-L197)).
3. **Omite a geração de hipóteses** (`Hypothesis`), impedindo que o motor de refinamento proponha alterações inúteis ou errôneas no harness para tentar resolver falhas de rede, banco de dados ou indisponibilidade de APIs externas ([`src/harness_lab/application/diagnosis/diagnose_executions.py#L199-L208`](../../src/harness_lab/application/diagnosis/diagnose_executions.py#L199-L208)).

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    TR["Traços de Execução (DiagnosticTrace)"] --> LOOP["Iterar Categorias na Ordem Taxonômica"]
    LOOP --> DETECT{"Detector de Categoria Corresponde?"}
    DETECT -- Não --> LOOP
    DETECT -- Sim --> SANIT["Sanitizar Trechos (_sanitize_excerpt)"]
    SANIT --> EV["Criar EvidenceTrace e Finding"]
    EV --> CHK{"Categoria em NON_HARNESS_CATEGORIES?"}
    
    CHK -- Sim (INFRASTRUCTURE_FAILURE / TOOL_FAILURE) --> NH["actionability.proposed_change = False<br/>(Sem geração de Hypothesis)"]
    CHK -- Não (Harness Categories) --> H["actionability.proposed_change = True<br/>Criar Hypothesis para Refinamento"]

    NH --> RES["DiagnoseResult"]
    H --> RES
```
*Fluxo de diagnose de execuções, sanitização de logs e bifurcação de acionabilidade entre falhas de harness e de infraestrutura.*

---

## 4. Cobertura de Testes e Invariantes Verificados

A integridade do particionamento de casos e do motor de diagnóstico é garantida por uma suíte de testes unitários dedicada em `tests/unit/application/`:

1. **Determinismo e Isolamento Transitivo** ([`tests/unit/application/cases/test_partition.py#L25-L41`](../../tests/unit/application/cases/test_partition.py#L25-L41)):
   - `test_partition_keeps_transitive_groups_deterministic_and_disjoint`: Verifica se execuções repetidas com a mesma `seed` produzem exatamente os mesmos conjuntos `diagnosis_ids` e `reserved_ids`, e se nenhum ID de caso aparece simultaneamente em ambos os conjuntos.

2. **Ocultação de Dados no Refinamento** ([`tests/unit/application/cases/test_partition.py#L43-L69`](../../tests/unit/application/cases/test_partition.py#L43-L69)):
   - `test_partition_exposes_only_diagnosis_cases_to_refinement`: Valida que apenas os casos de diagnóstico são visíveis no callback de refinamento, confirmando que conteúdos, `session_id` e `similarity_group` dos casos reservados não vazam na memória de chamada.

3. **Bloqueio de Fontes Reservadas** ([`tests/unit/application/cases/test_partition.py#L71-L85`](../../tests/unit/application/cases/test_partition.py#L71-L85)):
   - `test_partition_seals_manifest_and_blocks_reserved_learning_sources`: Confirma a conversão para tuplas imutáveis e testa se `assert_learning_sources` dispara `RESERVED_CASE_EVIDENCE_FORBIDDEN` ao receber um ID reservado.

4. **Tratamento de Exceções de Fronteira** ([`tests/unit/application/cases/test_partition.py#L134-L144`](../../tests/unit/application/cases/test_partition.py#L134-L144)):
   - `test_partition_rejects_unsatisfiable_reserved_minimum`: Assegura que o sistema lança `RESERVED_SIZE_UNSATISFIABLE` quando agrupamentos transitivos impossibilitam satisfazer o mínimo reservado sem violar a partição.

5. **Diagnóstico e Redação de Segredos** ([`tests/unit/application/diagnosis/test_diagnosis.py#L40-L73`](../../tests/unit/application/diagnosis/test_diagnosis.py#L40-L73)):
   - `test_diagnosis_emits_deterministic_evidence_backed_findings_in_taxonomy_order`: Garante que os achados são emitidos na ordem exata de `DIAGNOSIS_CATEGORIES` e que segredos (`password`, `token`) nos traços são mascarados para `[REDACTED]`.

6. **Bloqueio de Propostas para Falhas de Infraestrutura** ([`tests/unit/application/diagnosis/test_diagnosis.py#L75-L90`](../../tests/unit/application/diagnosis/test_diagnosis.py#L75-L90)):
   - `test_diagnosis_non_harness_failures_do_not_propose_changes_or_hypotheses`: Confirma que falhas categorizadas como `INFRASTRUCTURE_FAILURE` e `TOOL_FAILURE` geram `proposed_change=False` e nenhuma hipótese de edição no harness.
