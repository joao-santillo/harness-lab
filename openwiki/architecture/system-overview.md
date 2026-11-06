---
type: architecture
title: Visão Geral da Arquitetura Modular
description: Especificação técnica da arquitetura monolítica modular do Harness Lab, detalhando a separação clara em camadas (domain, application, adapters, api, worker, web) e as portas de desacoplamento Hexagonal.
tags: [architecture, modular-monolith, python, domain-driven-design, ports-and-adapters, hexagonal-architecture]
verified:
  - by: openwiki/0.7.2
    at: 2026-11-06T14:17:17.542Z
sources:
  - id: openwiki-source-a19510e275ac4fc1ed30d89f
    resource: repo://docs/arquitetura.md
  - id: openwiki-source-16bdf2179cb939c2aca7fd50
    resource: repo://src/harness_lab/api/app.py
  - id: openwiki-source-a68de475e68dfb8a6e833dd8
    resource: repo://src/harness_lab/api/services.py
  - id: openwiki-source-ceb4a06c2229966a04bd0165
    resource: repo://src/harness_lab/application/rounds/process_round.py
  - id: openwiki-source-0ad74f58d8cd78c36ab2ee4b
    resource: repo://src/harness_lab/cli.py
  - id: openwiki-source-2b3bd0873b40820c242431fe
    resource: repo://src/harness_lab/domain/ports.py
  - id: openwiki-source-56c639d3a6a476f226525a62
    resource: repo://src/harness_lab/main.py
  - id: openwiki-source-ebc59b83a88dc0584c705727
    resource: repo://src/harness_lab/web/app.py
  - id: openwiki-source-ef496fb4a7880942d73326a2
    resource: repo://src/harness_lab/worker/main.py
  - id: openwiki-source-85f705d56c1e6d5f830f5e4b
    resource: repo://src/harness_lab/worker/runtime.py
  - id: openwiki-source-308db7930b83e879ec45c48e
    resource: repo://src/harness_lab/worker/worker.py
generated: { by: "openwiki/0.7.2", at: "2026-11-06T14:17:17.542Z" }
---

# Visão Geral da Arquitetura Modular

O **Harness Lab** é projetado como um **monolito modular em Python**, unificando API REST/SSE, worker durável em segundo plano, interface gráfica server-rendered e adaptadores de infraestrutura dentro de um único pacote Python (`src/harness_lab`).

Apesar de compartilharem a mesma base de código e o mesmo espaço de empacotamento, os componentes do sistema mantêm um rigoroso isolamento arquitetural fundamentado nos princípios da **Arquitetura Hexagonal (Ports and Adapters)** e do **Domain-Driven Design (DDD)**. As regras de negócio e os modelos de domínio não dependem de nenhum framework web (como FastAPI), banco de dados relacional (como SQLite) ou SDK de terceiros.

---

## Diagrama da Arquitetura em Camadas

O diagrama abaixo ilustra o fluxo de dependências entre as camadas do sistema, destacando os pontos de entrada do usuário/processamento, o núcleo de domínio imutável e a ponte de infraestrutura mediada por portas.

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
flowchart TD
    subgraph Interfaces["Camada de Apresentação & Entrada"]
        WEB["harness_lab.web<br/>(Interface Jinja2 & CSS)"]
        API["harness_lab.api<br/>(Rotas FastAPI HTTP & SSE)"]
    end

    subgraph Background["Processamento em Segundo Plano"]
        WORKER["harness_lab.worker<br/>(DurableRoundWorker & Lease Loop)"]
    end

    subgraph AppLayer["Camada de Aplicação (Casos de Uso)"]
        PROCESS["harness_lab.application<br/>(ProcessRound & Pipeline Stages)"]
    end

    subgraph DomainLayer["Camada de Domínio (Núcleo)"]
        DOMAIN["harness_lab.domain<br/>(DomainModel, State Machines & Protocols)"]
    end

    subgraph AdaptersLayer["Camada de Adaptadores (Infraestrutura)"]
        SQLITE["Adapters SQLite<br/>(RunRepo, CaseRepo, JobStore, ArtifactStore)"]
        SECURITY["Adapters Security<br/>(EncryptedSecretStore, Redactor)"]
        EXTERNAL["Adapters Externos<br/>(Langfuse, Agent Platform, Harness2, Exporters)"]
    end

    WEB --> API
    API --> PROCESS
    WORKER --> PROCESS
    PROCESS --> DOMAIN
    PROCESS --> SQLITE
    API --> SQLITE
    SQLITE --> DOMAIN
    EXTERNAL -. "implementa porta" .-> DOMAIN
    SQLITE -. "implementa porta" .-> DOMAIN
    SECURITY -. "implementa porta" .-> DOMAIN
```
*Legenda: Arquitetura em camadas do Harness Lab com direção de dependências apontando rigorosamente para a camada de Aplicação e Domínio.*

---

## Princípios do Monolito Modular

A escolha por uma arquitetura monolítica modular combina a simplicidade operacional e de deploy de um único pacote com a manutenibilidade de limites bem demarcados de software.

1. **Pacote Único com Limites Rígidos**: Todos os submódulos residem no pacote `harness_lab`. A comunicação entre módulos obedece estritamente a hierarquia de camadas: `web` / `api` / `worker` dependem de `application` e `domain`; `adapters` implementam as portas declaradas em `domain`.
2. **Ponto de Entrada Unificado por CLI**: A CLI centralizada em `src/harness_lab/cli.py` e os scripts de inicialização em `src/harness_lab/main.py` e `src/harness_lab/worker/main.py` permitem iniciar os serviços do sistema (`harness-lab api` ou `harness-lab worker`) a partir da mesma base instalada.
3. **Persistência Local Compartilhada no MVP**: Em ambiente local, a API e o Worker comunicam-se de forma assíncrona desacoplada utilizando uma instância compartilhada de banco SQLite operando em modo WAL (*Write-Ahead Logging*) para coordenação de filas e checkpoints.
4. **Substitutividade Sem Regressão**: Por utilizarem `typing.Protocol`, os componentes de infraestrutura (banco de dados, executores e refinadores) podem ser substituídos por implementações de produção sem necessidade de alterar as regras de orquestração do pipeline.

---

## Separação em Camadas

O pacote `harness_lab` divide-se em seis responsabilidades primárias:

### 1. Camada de Domínio (`src/harness_lab/domain`)
O coração do sistema. Contém a definição declarativa dos tipos imutáveis, das máquinas de estado e das portas abstratas:
- **Modelos Imutáveis (`DomainModel`)**: Construídos sobre `pydantic.BaseModel` com configuração de imutabilidade (`frozen=True`), conversão automática de chaves para `camelCase` e rejeição de campos não declarados (`extra="forbid"`).
- **Tipos Fortemente Tipados (Branded IDs)**: `RoundId`, `AgentId`, `DomainId`, `CaseId`, `SecretId`, entre outros, implementados com `typing.NewType` para prevenir acoplamentos errôneos.
- **Contratos de Portas (`src/harness_lab/domain/ports.py`)**: Interfaces Python abstratas baseadas em `typing.Protocol` que definem todas as interações do sistema com persistência, executores, refinadores, avaliadores e segurança.

### 2. Camada de Aplicação (`src/harness_lab/application`)
Contém a lógica dos casos de uso e a orquestração do ciclo de vida das rodadas de otimização:
- **Orquestração de Rodadas (`ProcessRound`)**: Implementado em `src/harness_lab/application/rounds/process_round.py`, controla as transições de estado de cada `Round`, assegurando posse do lease antes e depois de cada fase.
- **Construção de Estágios (`create_round_stages`)**: Cria a sequência determinística de estágios (`collect`, `diagnose`, `refine`, `execute`, `evaluate`, `export`) definidos em `create_round_stages.py`.
- **Regras de Isolamento e Diagnóstico**:
  - `partition_cases.py`: Agrupa casos por sessão ou chave semântica e divide o corpus de forma determinística em grupos de diagnóstico e reserva.
  - `diagnose_executions.py`: Projeta evidências de falha utilizando exclusivamente o subconjunto de diagnóstico.
  - `change_policy.py`: Governa quais componentes de harness podem ser alterados pelo refinador.
  - `evaluate_candidate.py` e `recommendation_policy.py`: Avaliam o desempenho de candidatos em relação ao baseline de maneira independente do motor de refinamento.

### 3. Camada de Adaptadores (`src/harness_lab/adapters`)
Realiza a ponte entre as interfaces de domínio e as ferramentas/tecnologias externas:
- **Adaptadores SQLite (`src/harness_lab/adapters/sqlite`)**: Implementações concretas de repositórios (`SqliteRunRepository`, `SqliteCaseRepository`, `SqliteRoundJobStore`, `SqliteRoundArtifactStore`) com gerenciamento rigoroso de transações `BEGIN IMMEDIATE` e migrações versionadas.
- **Criptografia e Segurança (`src/harness_lab/adapters/security`)**: Criptografia autenticada de segredos via `EncryptedSecretStore` (com codecs Fernet/AES-256) e sanitização de logs e payloads através de `Redactor`.
- **Integradores Externos**:
  - `src/harness_lab/adapters/langfuse`: Coleta de traços de observabilidade e importação de sessões.
  - `src/harness_lab/adapters/agent_platform`: Conexão com plataformas externas de execução de agentes com preservação de payload não reconhecido em `opaquePayload`.
  - `src/harness_lab/adapters/harness2`: Compatibilidade com a especificação Harness2 de Propose-Probe-Compose.
  - `src/harness_lab/adapters/export`: Exportação de relatórios finais e artefatos de candidatos (`CandidateExporter`, `ReportExporter`).

### 4. Camada de API REST e Eventos (`src/harness_lab/api`)
Interface de serviços baseada em **FastAPI** (`src/harness_lab/api/app.py`):
- **Gerenciador de Serviços (`ApiServices`)**: Container de injeção de dependências que expõe instâncias ativas dos repositórios e serviços para as rotas HTTP.
- **Roteamento Especializado**:
  - `/api/v1/agents`: Cadastro e listagem de agentes operacionais.
  - `/api/v1/cases`: Ingestão, visualização e importação de casos de teste.
  - `/api/v1/connections`: Registro e armazenamento criptografado de conexões e segredos.
  - `/api/v1/rounds`: Criação, consulta e enfileiramento de rodadas de otimização.
  - `/api/v1/rounds/{id}/events`: Stream Server-Sent Events (SSE) para acompanhamento do progresso de execuções em tempo real.
- **Tratamento de Exceções e i18n**: Interceptador global de `ApiError` e mecanismo de internacionalização (`i18n.py`) que formata mensagens de erro segundo o cabeçalho `Accept-Language`.

### 5. Camada do Worker Durável (`src/harness_lab/worker`)
Runtime assíncrono para execução segura e tolerante a falhas de rodadas em background:
- **Worker Principal (`DurableRoundWorker`)**: Loop de polling operando sobre a tabela `round_jobs` (`src/harness_lab/worker/worker.py`).
- **Invariante de Ownership (Lease)**: Garante a reivindicação exclusiva de um job por um `worker_id` específico e previne execuções simultâneas ou roubo de trabalhos.
- **Provedor Dinâmico de Deployment**: Carrega o módulo de dependências de execução especificado pela variável `WORKER_PROVIDER_MODULE` através da função `create_round_stage_dependencies`, permitindo plugar motores de execução reais sem alterar a base de código do núcleo.

### 6. Camada Web Server-Rendered (`src/harness_lab/web`)
Interface visual para usuários humanos construída com **Jinja2** e arquivos estáticos:
- **Rotas Web (`src/harness_lab/web/app.py`)**: Renderiza páginas HTML para visualização de agentes, gestão de casos de teste e monitoramento do histórico de rodadas.
- **Arquivos Estáticos (`src/harness_lab/web/static`)**: Folhas de estilo CSS e ativos visuais sem dependências de frameworks frontend pesados no client-side.

---

## Portas de Desacoplamento (Hexagonal Architecture)

As portas declaradas em `src/harness_lab/domain/ports.py` atuam como contratos formais entre o núcleo da aplicação e os recursos de infraestrutura. A tabela a seguir descreve as responsabilidades das principais portas do sistema:

| Porta (`Protocol`) | Responsabilidade no Sistema | Adaptador Concreto Principal |
| :--- | :--- | :--- |
| `RunRepository` | Persistência de instâncias de `Round`, checkpoints de fase e histórico de eventos. | `SqliteRunRepository` |
| `CaseRepository` | Armazenamento e listagem do corpus de casos de teste por agente e domínio. | `SqliteCaseRepository` |
| `AgentHarnessRepository` | Leitura de capacidades do agente (`AgentCapabilities`) e snapshots de versão do harness. | `AgentPlatformHarnessRepository` |
| `CandidateExecutor` | Execução de requisições de teste em modo baseline ou candidato contra o agente. | `AgentPlatformCandidateExecutor` |
| `RefinementEngine` | Geração de propostas de candidatos a harness a partir de achados e evidências. | Provedor customizado em `WORKER_PROVIDER_MODULE` |
| `EvaluationEngine` | Avaliação quantitativa/estatística de desempenho comparando candidato e baseline. | Módulo interno `evaluate_candidate` |
| `ArtifactExporter` | Exportação e persistência de relatórios finais e snapshots de candidatos. | `CandidateExporter` / `ReportExporter` |
| `SecretStore` | Armazenamento, rotação e leitura de credenciais e segredos criptografados. | `EncryptedSecretStore` |
| `TraceRepository` | Coleta paginada de traços de execução e observabilidade externa. | `LangfuseTraceRepository` |
| `EventPublisher` | Publicação de eventos de progresso de rodadas para clientes inscritos. | Emissor interno de eventos da API |

---

## Ciclo de Vida e Fluxo de Controle de uma Rodada

O processamento de uma rodada (`Round`) exemplifica como todas as camadas interagem de maneira coordenada:

<!-- openwiki: mermaid parse failed and this diagram was converted to a text fence so it does not break rendering. Fix the diagram source and restore the mermaid fence. Parser error: Heuristic: an unescaped angle bracket inside a label breaks rendering; rephrase the label. -->
```text
sequenceDiagram
    participant API as API FastAPI
    participant DB as SQLite WAL
    participant Worker as DurableRoundWorker
    participant Process as ProcessRound
    participant Stages as Estágios (Stages)
    participant Ext as Provider Externo

    API->>DB: 1. Cria Round (state: setup) e insere Job (transação atômica)
    Worker->>DB: 2. claim_next(worker_id) adquire lease do Job
    Worker->>Process: 3. execute(round_id, worker_id)
    loop Fases do Pipeline (collect -> export)
        Process->>DB: Verifica is_owned_by(round_id, worker_id)
        Process->>Stages: Executa fase correspondente
        Stages->>Ext: Chama CandidateExecutor / RefinementEngine via Porta
        Ext-->>Stages: Retorna resultados / candidatos
        Stages-->>Process: Retorna progresso da fase
        Process->>DB: commit_progress (atualiza Round, insere Checkpoint e Evento)
    end
    Process->>DB: 4. Transição para estado terminal (ex: recommendation_completed)
    Worker->>DB: 5. complete(round_id, worker_id) encerra o Job
```
*Legenda: Sequência de interações assíncronas entre a API HTTP, o banco de dados de coordenação, o worker durável e os adaptadores externos durante o processamento de uma rodada.*

### Garantias de Integridade e Tolerância a Falhas
- **Checagem Contínua de Ownership**: Antes e depois de cada transição de fase, o `ProcessRound` invoca `is_owned_by` no `SqliteRoundJobStore`. Se o lease expirar ou for tomado por outro worker, lança a exceção `ROUND_CLAIM_LOST`, interrompendo o processamento imediatamente para impedir inconsistências de estado.
- **Recuperação Graciosa de Crashes em Exportação**: Se o processo do worker falhar ou for interrompido durante o estado `exporting`, na reinicialização o controlador tenta recuperar a decisão terminal a partir do artefato gravado no `SqliteRoundArtifactStore`. Caso a decisão não possa ser recuperada, o sistema encerra a rodada como `integration_failed` (falhando de forma segura sem jamais assumir uma recomendação não confirmada).

---

## Mapeamento de Arquivos e Componentes

Para fins de navegação no código fonte, os principais arquivos que compõem a arquitetura modular estão organizados da seguinte forma:

- **Infraestrutura e Entrada**:
  - `src/harness_lab/main.py`: Ponto de entrada para o servidor de API FastAPI.
  - `src/harness_lab/cli.py`: Interface de linha de comando para despacho dos comandos `api` e `worker`.
- **Domínio**:
  - `src/harness_lab/domain/ports.py`: Contratos de interfaces e protocolos.
  - `src/harness_lab/domain/models/round.py`: Modelos de entidade e estados da rodada.
- **Aplicação**:
  - `src/harness_lab/application/rounds/process_round.py`: Motor de transição e execução do pipeline.
  - `src/harness_lab/application/rounds/create_round_stages.py`: Composição dos estágios do pipeline.
- **Worker**:
  - `src/harness_lab/worker/main.py`: Inicialização do runtime do worker e carregamento do provider.
  - `src/harness_lab/worker/worker.py`: Implementação do `DurableRoundWorker`.
  - `src/harness_lab/worker/config.py`: Resolução de configurações de ambiente para o worker.

---

## Páginas Relacionadas

- [Modelo de Domínio](domain-model.md) — Detalhamento técnico dos modelos imutáveis e especificações completas das portas de domínio.
- [Persistência e Armazenamento em SQLite](storage-persistence.md) — Arquitetura de persistência, modelo de concorrencia WAL e estrutura das tabelas de banco de dados.
- [Runtime do Worker](../operations/worker-runtime.md) — Operação em segundo plano, lease de trabalhos e injeção dinâmica de provedores de execução.
