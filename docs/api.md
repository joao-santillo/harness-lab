# Referência da API

## Convenções

- Base local: `http://127.0.0.1:3000/api/v1`.
- Corpo e resposta em JSON, salvo o stream SSE.
- IDs de agente/domínio aceitam letras minúsculas, números e hífens conforme a rota.
- O API não implementa autenticação de usuário. Mantenha-o em loopback ou atrás de proxy autenticado.
- Erros usam `code` estável; algumas mensagens incluem texto localizado via `Accept-Language`.

## Agentes

### `GET /agents`

Lista agentes cadastrados em ordem de criação e ID.

Resposta: `{ "items": [{ "id", "domainId", "name", "createdAt" }] }`.

### `POST /agents`

Cria o escopo de agente.

```json
{ "id": "agente-suporte", "domainId": "varejo", "name": "Suporte" }
```

- `201`: criado;
- `400 AGENT_INVALID`: formato ou campo inválido;
- `409 AGENT_ALREADY_EXISTS`: ID existente.

## Conexões

### `POST /connections`

Cabeçalho opcional: `Idempotency-Key`.

Langfuse:

```json
{
  "id": "langfuse-principal",
  "kind": "langfuse",
  "name": "Langfuse principal",
  "credentials": {
    "baseUrl": "https://langfuse.example",
    "publicKey": "...",
    "secretKey": "..."
  }
}
```

Agent Platform:

```json
{
  "id": "agent-platform-principal",
  "kind": "agent-platform",
  "name": "Agent Platform principal",
  "credentials": { "baseUrl": "https://plataforma.example", "token": "..." }
}
```

Resposta não contém credenciais: `{ "id", "kind", "name", "configured": true }`.

- `201`: conexão criada;
- `200`: repetição idempotente igual;
- `400 CONNECTION_INVALID`: corpo inválido;
- `409 IDEMPOTENCY_CONFLICT`: a mesma chave foi usada com outro payload;
- `422 CONNECTION_AUTH_FAILED`: credenciais recusadas pelo tester;
- `503 CONNECTION_UNAVAILABLE`: integração não acessível.

O tester Langfuse faz probe de capabilities. Para Agent Platform, o tester atual verifica apenas URL/token não vazios e a URL; não confirma a autenticação remota.

### `GET /connections`

Lista as conexões cadastradas em ordem alfabética pelo nome.

Resposta: `{ "items": [{ "id", "kind", "name", "configured": true }] }`.
As credenciais, URLs base e tokens nunca são retornados.

### `GET /connections/:id`

Retorna metadados públicos da conexão. `404 CONNECTION_NOT_FOUND` se não existir.

### `GET /connections/:id/credentials`

Retorna apenas `{ "connectionId", "configured": true }`; nunca devolve segredo.

### `DELETE /connections/:id`

Apaga o segredo e, pela chave estrangeira, o registro. Resposta `204`.

## Cases

### `POST /cases/import`

Importa de 1 a 40 cases JSON em lote atômico, usando agente/domínio existentes.

```json
{
  "agentId": "agente-suporte",
  "domainId": "varejo",
  "source": "json",
  "cases": [{
    "id": "caso-001",
    "sessionId": "sessao-001",
    "similarityGroup": "grupo-acesso",
    "content": "Como solicito acesso?"
  }]
}
```

Origens: `manual`, `json`, `historical` ou `synthetic`. `historical` exige `sourceReference`. `synthetic` exige `syntheticLabel: "SYNTHETIC"` em cada item. Resposta `201 { "imported": N }`.

### `POST /cases/import-csv`

O corpo contém `agentId`, `domainId` e string `csv` (máximo 250 KB). Cabeçalhos obrigatórios: `id,sessionId,similarityGroup,content`, em qualquer ordem e sem nomes duplicados. Máximo: 40 linhas de dados. A origem `csv` é atribuída pelo servidor.

O parser aceita LF e CRLF, ignora linhas vazias, aceita vírgulas/quebras de linha dentro de campos entre aspas e aspas duplas escapadas (`""`). Campo entre aspas deve começar no início do campo; depois da aspa final só pode haver separador, quebra de linha ou fim do arquivo. CR isolado, aspas não fechadas, número de colunas diferente ou campo obrigatório vazio geram `CASE_CSV_INVALID`. Espaço no começo/fim dos valores é removido.

### `GET /cases?agentId=<id>&domainId=<id>`

Lista apenas cases do escopo solicitado. Retorna `400 CASE_SCOPE_REQUIRED` se faltar algum parâmetro.

### `POST /cases/import-langfuse`

Importa traces históricos de uma conexão Langfuse salva e os converte em até 40 cases no escopo informado.

```json
{
  "agentId": "agente-suporte",
  "domainId": "varejo",
  "connectionId": "langfuse-principal",
  "fromStartTime": "2026-11-03T00:00:00.000Z",
  "toStartTime": "2026-11-04T00:00:00.000Z",
  "limit": 20,
  "filter": { "field": "traceName", "value": "support-flow" }
}
```

`fromStartTime` e `toStartTime` devem ser ISO 8601 com offset, e o início deve ser anterior ao fim. `limit` aceita de 1 a 40. `filter` é opcional; quando informado, contém um dos campos `traceName`, `environment`, `tags`, `userId` ou `sessionId` e um `value` não vazio, de até 200 caracteres. `traceName`, `environment`, `userId` e `sessionId` usam correspondência exata; `tags` seleciona traces que contenham a tag informada. O limite é aplicado aos traces que correspondem ao filtro. Sem filtro, a busca continua abrangendo todos os traces na janela. A API valida o agente e o domínio antes de qualquer acesso externo e descriptografa a conexão somente no backend.

Resposta `201`:

```json
{
  "imported": 2,
  "skipped": 1,
  "source": {
    "connectionId": "langfuse-principal",
    "fromStartTime": "2026-11-03T00:00:00.000Z",
    "toStartTime": "2026-11-04T00:00:00.000Z"
  },
  "limitations": []
}
```

No endpoint v2, a leitura usa `GET /api/public/v2/observations`, campos seletivos, janela temporal e paginação por cursor. As observações são agrupadas por trace; o importador prefere o `input` serializável da raiz e, se a raiz não tiver input utilizável, usa o da observação filha elegível mais antiga. Uma raiz precisa estar presente na janela para o trace ser considerado. Outputs e o payload bruto remoto não são retornados nem gravados no response. Cada trace gera no máximo um case, com ID determinístico derivado da conexão e do trace. Repetições são idempotentes e contam cases já existentes em `skipped`.

O adaptador tem retry único para `429`, respeitando `Retry-After` com teto de 30 segundos, limite de 100 páginas, 1.000 observações e 5 MB por resposta. Quando a capability negotiation indicar apenas `/api/public/traces`, o fallback legado é usado explicitamente e `limitations` informa que o endpoint é deprecated; os campos legados são normalizados para o mesmo contrato.

Erros: `400 CASE_LANGFUSE_INVALID`, `404 CONNECTION_NOT_FOUND`, `422 CONNECTION_KIND_INVALID`, `422 AGENT_SCOPE_INVALID`, `422 CONNECTION_AUTH_FAILED` e `503 CONNECTION_UNAVAILABLE`. Nenhuma dessas respostas contém credenciais, URL privada, input, output ou corpo remoto.

Erros de importação:

- `400 CASE_IMPORT_INVALID`, `CASE_CSV_INVALID`, `CASE_CSV_SIZE_INVALID` ou `CASE_ID_DUPLICATE`;
- `409 CASE_ALREADY_EXISTS`;
- `422 CASE_SCOPE_INVALID`.

## Rodadas

### `GET /rounds`

Lista até 100 rodadas, mais recentes primeiro.

### `POST /rounds`

```json
{ "id": "rodada-001", "agentId": "agente-suporte", "domainId": "varejo", "objective": "Melhorar respostas" }
```

A API cria estado `setup` e enfileira o job atomicamente. Respostas: `201`, `400 ROUND_INVALID`, `409 ROUND_ALREADY_EXISTS`, `422 ROUND_SCOPE_INVALID`.

### `GET /rounds/:id`

Retorna a rodada ou `404 ROUND_NOT_FOUND`.

### `POST /rounds/:id/cancel`

Solicita cancelamento cooperativo: `202 { "id", "cancellationRequested": true }`. Retorna `404` se ausente e `409 ROUND_NOT_ACTIVE` se o job não está ativo. A mudança para estado terminal ocorre no próximo checkpoint.

### `GET /rounds/:id/results`

Retorna apenas decisão, amostra, confiança, métricas agregadas, regressões, limitações e justificativa. Não expõe payload opaco do harness.

- `200`: avaliação persistida;
- `404 ROUND_NOT_FOUND`;
- `409 ROUND_RESULT_NOT_READY`: ainda não há avaliação persistida.

## Progresso SSE

### `GET /rounds/:roundId/events`

Stream `text/event-stream`. Envie `Last-Event-ID` para retomar depois do último número de sequência recebido. O servidor emite:

```text
id: 3
event: round-progress
data: {"id":"...","roundId":"...","sequence":3,"event":"execution_started","state":"executing","occurredAt":"...","messageCode":"ROUND_EXECUTION_STARTED"}
```

Comentários `: heartbeat` mantêm a conexão aberta. Estados terminais encerram o stream. Não há porcentagem artificial.
