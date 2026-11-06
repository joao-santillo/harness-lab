# Arquitetura

## Visão geral

O Harness Lab e um monolito modular Python. API, worker, interface e adapters compartilham o pacote `harness_lab`. A aplicacao usa portas para manter regras de dominio separadas de FastAPI, Jinja2, SQLite, Harness2 e APIs externas.

```text
Navegador
   │ HTTP / SSE
   ▼
FastAPI/Jinja2 ── SQLite
   │                 ▲
   │ fila de rodadas │ checkpoints/artefatos
   ▼                 │
Worker durável ──────┘
   │ providers injetados
   ├── Langfuse
   └── Agent Platform (contrato real pendente)
```

## Pacotes e responsabilidades

- `src/harness_lab/domain`: modelos, estados e portas independentes de framework.
- `src/harness_lab/application`: particionamento, diagnostico, avaliacao e orquestracao.
- `src/harness_lab/adapters`: SQLite, criptografia, redaction, Langfuse, Agent Platform, Harness2 e exportadores.
- `src/harness_lab/api`: rotas HTTP/SSE, validacao e composicao.
- `src/harness_lab/worker`: lease de jobs, runtime de rodadas e provider de deployment.
- `src/harness_lab/web`: interface Jinja2 server-rendered e CSS.

## Fluxo de uma rodada

1. A API cria `Round` em `setup` e enfileira um job na mesma transação.
2. `DurableRoundWorker` reivindica o job com lease. `ProcessRound` verifica ownership antes/depois de cada etapa.
3. A coleta carrega cases do SQLite por agente/domínio, sela uma partição determinística e captura baseline/capabilities via provider.
4. Diagnóstico recebe apenas cases de diagnóstico; os reservados ficam fora do refinamento e dos aprendizados.
5. Refinamento cria candidatos e executa probes comparáveis via provider.
6. Execução reserva casos que não foram vistos pelo refinador.
7. Avaliação independente persiste decisão, amostra, regressões, confiança e limitações.
8. Exportação grava os artefatos configurados. O evento terminal deriva da decisão persistida.

Se o processo reiniciar após `exporting`, o controlador recupera a decisão do artefato persistido. Se não conseguir recuperá-la, encerra como `integration_failed`; nunca assume `recommended` por omissão.

## Isolamento entre diagnóstico e validação

`partition_cases` agrupa transitivamente cases que compartilham sessao ou grupo semantico e distribui grupos de forma deterministica usando a seed. O manifesto separa diagnostico e reserva e e selado antes do refinamento. `run_refinement_with_diagnosis_cases` projeta apenas o corpus de diagnostico, e `assert_learning_sources` bloqueia IDs reservados.

## Persistência

SQLite usa WAL, foreign keys, `synchronous=FULL`, timeout de lock e migrations versionadas. A tabela `round_artifacts` persiste o snapshot de execução por etapa. A tabela `cases` mantém o corpus. Segredos de conexão ficam criptografados em `encrypted_secrets`; os demais dados operacionais do banco não são criptografados pelo aplicativo.

## Worker e providers

O runtime do worker conecta os stores SQLite ao pipeline. `harness-lab worker` exige um modulo local em `WORKER_PROVIDER_MODULE`, que exporta `create_round_stage_dependencies(config)`. O provider precisa implementar traces, harness, propostas, execucao e exportacao.

Não há provider de produção no repositório. Essa separação é intencional: sem confirmar os endpoints/semântica da Agent Platform, associação trace-case e política de proposta, um provider embutido poderia atribuir resultados errados ou executar ações externas inesperadas.

## Fronteiras de integração

Cada adapter valida payload externo com schema, traduz erros para códigos estáveis e mantém os dados externos fora do domínio. O adapter da Agent Platform preserva campos desconhecidos em `opaquePayload` para round-trip. O resumo público de resultados expõe apenas campos avaliativos; não serializa o snapshot inteiro.

## Evolução

As portas permitem substituir SQLite, armazenamento local de exports e providers específicos por implementações de deployment. Isso não transforma a aplicação atual em serviço multi-tenant ou distribuído: esses cenários precisam de autenticação, autorização, storage e testes próprios.
