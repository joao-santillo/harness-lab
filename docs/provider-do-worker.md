# Provider do worker

## Para que serve

`createRoundWorkerRuntime` conecta persistência e fluxo de estados, mas não escolhe endpoints externos nem políticas de negócio. Um provider de deployment fornece as dependências específicas do ambiente para que o worker execute coleta, harness, propostas, avaliações e exportação.

O repositório não contém um provider executável de Agent Platform. O contrato remoto de capabilities/execução ainda precisa ser confirmado com o OpenAPI/Swagger do ambiente. O caminho `./worker-providers.js` no `.env.example` é apenas um nome esperado, não um arquivo incluído.

## Contrato carregado pelo processo

O worker resolve `WORKER_PROVIDER_MODULE` em relação ao diretório do pacote `apps/worker` e importa o módulo. Ele deve expor uma função com esta forma:

```ts
interface WorkerProviderModule {
  createRoundStageDependencies(
    context: WorkerProviderFactoryContext,
  ): Promise<RoundStageDependencies> | RoundStageDependencies;
}
```

O contexto entregue pelo entrypoint é:

```ts
interface WorkerProviderFactoryContext {
  database: SqliteDatabase;
  encryptionKey: string;
}
```

O tipo de produto `RoundStageDependencies` vem de `@harness-lab/application` e requer:

- `traces.collect(round, diagnosisCases)`: retorna traces/evidências para os cases de diagnóstico;
- `harnesses`: repository de capabilities/snapshots, incluindo `fetchSnapshot(agentId, domainId)`;
- `proposals.create(round, diagnosis, baseline)`: estratégia explícita de propostas;
- `executor.execute(request)`: execução baseline/candidato, com ambiente e correlação seguros;
- `evaluator`: definição versionada e limites de recomendação;
- `exportRound(round, session)`: persistência segura do artefato e relatório.

`cases` é opcional. Se omitido, o runtime lê o corpus SQLite pelo agente e domínio da rodada.

## Requisitos para uma implementação

1. Leia credenciais com `EncryptedSqliteSecretStore`; nunca consulte nem devolva texto claro por rotas públicas.
2. Use o contrato oficial da plataforma alvo; não copie automaticamente os caminhos de fixture do adapter atual.
3. Restrinja execução a ambiente de teste e use idempotency/correlation IDs por rodada/case/tentativa.
4. Associe traces aos cases com regra verificável (por exemplo, trace ID explicitamente guardado ou correlation ID). Não use proximidade temporal como prova única.
5. Faça refinement somente com IDs/conteúdo de `diagnosisIds`; não inclua reservados em logs, prompts, propostas ou lessons.
6. Configure timeouts, cancelamento e limites de chamadas/custo; classifique timeout, falha de execução e trace ausente separadamente.
7. Exporte com redaction, hash e permissões `0600`; não publique/promova versões.
8. Inclua fixtures sanitizadas e testes de contrato. Rode smoke real só em ambiente não produtivo, com uma execução limitada.

## O que falta para um provider real

Antes da implementação, obtenha/defina: API oficial de leitura de harness/capabilities e execução versionada, campos de correlação retornados, projeto/ambiente Langfuse e regra de matching case-trace, política de proposals (componentes permitidos/imutáveis), evaluator e destino/segredos dos exports. Sem essas entradas, o worker deve permanecer sem provider e não reivindicar jobs.
