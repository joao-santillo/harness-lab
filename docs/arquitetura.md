# Arquitetura

## Visão geral

O Harness Lab é um monólito modular TypeScript. API, worker, interface e adapters compartilham o mesmo workspace. A aplicação usa portas para manter regras de domínio separadas de Fastify, React, SQLite e APIs externas.

```text
Navegador
   │ HTTP / SSE
   ▼
API Fastify ───── SQLite
   │                 ▲
   │ fila de rodadas │ checkpoints/artefatos
   ▼                 │
Worker durável ──────┘
   │ providers injetados
   ├── Langfuse
   └── Agent Platform (contrato real pendente)
```

## Pacotes e responsabilidades

- `packages/domain`: modelos, estados e portas independentes de framework.
- `packages/application`: particionamento, diagnóstico, refinamento, avaliação e orquestração.
- `packages/adapters`: SQLite, criptografia, redaction, Langfuse, Agent Platform, Harness2 e exportadores.
- `apps/api`: rotas HTTP, validação, configuração, conexão e processos de inicialização.
- `apps/worker`: lease de jobs, runtime de rodadas e carregamento do provider de deployment.
- `apps/web`: interface React, localização e clientes HTTP/SSE.

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

`partitionCases` agrupa transitivamente cases que compartilham sessão ou grupo semântico e distribui grupos de forma determinística usando a seed. O manifesto separa `diagnosisIds` e `reservedIds`; é selado antes do refinamento. `runRefinementWithDiagnosisCases` projeta apenas IDs/conteúdo de diagnóstico, e `assertLearningSources` bloqueia IDs reservados.

## Persistência

SQLite usa WAL, foreign keys, `synchronous=FULL`, timeout de lock e migrations versionadas. A tabela `round_artifacts` persiste o snapshot de execução por etapa. A tabela `cases` mantém o corpus. Segredos de conexão ficam criptografados em `encrypted_secrets`; os demais dados operacionais do banco não são criptografados pelo aplicativo.

## Worker e providers

`createRoundWorkerRuntime` conecta os stores SQLite ao pipeline. `apps/worker/src/main.ts` exige um módulo local em `WORKER_PROVIDER_MODULE`, que exporta `createRoundStageDependencies({ database, encryptionKey })`. O provider precisa implementar traces, harness, propostas, execução e exportação.

Não há provider de produção no repositório. Essa separação é intencional: sem confirmar os endpoints/semântica da Agent Platform, associação trace-case e política de proposta, um provider embutido poderia atribuir resultados errados ou executar ações externas inesperadas.

## Fronteiras de integração

Cada adapter valida payload externo com schema, traduz erros para códigos estáveis e mantém os dados externos fora do domínio. O adapter da Agent Platform preserva campos desconhecidos em `opaquePayload` para round-trip. O resumo público de resultados expõe apenas campos avaliativos; não serializa o snapshot inteiro.

## Evolução

As portas permitem substituir SQLite, armazenamento local de exports e providers específicos por implementações de deployment. Isso não transforma a aplicação atual em serviço multi-tenant ou distribuído: esses cenários precisam de autenticação, autorização, storage e testes próprios.
