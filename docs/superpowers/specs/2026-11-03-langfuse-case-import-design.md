# Especificação: importação automática de cases a partir de traces Langfuse

- **Data:** 2026-11-03
- **Status:** desenho aprovado em conversa; aguardando revisão desta especificação
- **Escopo:** Harness Lab — importação histórica para cases de avaliação

## Contexto

O Harness Lab já permite cadastrar conexões Langfuse, agentes e cases manuais em JSON/CSV. A conexão Langfuse é validada pela API, mas o usuário ainda precisa copiar traces manualmente para formar o corpus de avaliação.

A documentação atual do Langfuse recomenda a Observations API v2 para novas leituras, com intervalo de tempo limitado, campos seletivos e paginação por cursor. O endpoint legado de traces tem sunset previsto para 16/11/2026. A implementação deve preferir v2 e manter fallback explícito para deployments legados enquanto a compatibilidade for necessária.

## Objetivo

Permitir que o usuário selecione uma conexão Langfuse, um intervalo de tempo e um limite, busque traces automaticamente e importe até 40 cases históricos no agente/domínio selecionado.

O fluxo deve ser seguro, repetível, auditável e compatível com as conexões já criptografadas no SQLite.

## Fora do escopo

- Buscar traces na Agent Platform.
- Expor credenciais, outputs ou metadados sensíveis no navegador.
- Criar uma tela de revisão manual completa antes da importação.
- Alterar o contrato remoto da Agent Platform.
- Importar mais de 40 cases por operação da interface.
- Criar um job assíncrono separado para a busca.

## Fluxo do usuário

1. O usuário cadastra ou já possui uma conexão Langfuse.
2. Na preparação do corpus, seleciona a origem **Langfuse**.
3. Seleciona uma conexão Langfuse salva, informa `fromStartTime`, `toStartTime` e um limite de 1 a 40.
4. Aciona **Buscar e importar traces**.
5. A API lê as credenciais no servidor, consulta o Langfuse, transforma uma observação raiz por trace em case e grava o lote atomicamente.
6. A interface informa quantos cases foram importados e quantos já existiam.
7. O usuário pode listar o corpus e iniciar uma rodada normalmente.

As origens manual, JSON, CSV, histórico copiado e sintético permanecem disponíveis.

## Contrato da API

### `POST /api/v1/cases/import-langfuse`

Corpo:

```json
{
  "agentId": "agente-atendimento-winthor",
  "domainId": "winthor",
  "connectionId": "langfuse-principal",
  "fromStartTime": "2026-11-02T00:00:00.000Z",
  "toStartTime": "2026-11-03T00:00:00.000Z",
  "limit": 20
}
```

Regras:

- `connectionId` deve existir e ser do tipo `langfuse`;
- `agentId` e `domainId` devem formar um escopo de agente existente;
- o intervalo deve ser ISO 8601, com início anterior ao fim;
- `limit` aceita de 1 a 40;
- o backend lê o segredo criptografado e nunca recebe credenciais do browser;
- cada trace gera no máximo um case;
- cases sem `input` textual ou serializável são ignorados com contagem explícita;
- IDs já importados são ignorados, sem falhar o lote inteiro;
- novos cases são persistidos em uma única transação.

Resposta `201`:

```json
{
  "imported": 12,
  "skipped": 3,
  "source": {
    "connectionId": "langfuse-principal",
    "fromStartTime": "2026-11-02T00:00:00.000Z",
    "toStartTime": "2026-11-03T00:00:00.000Z"
  },
  "limitations": []
}
```

Códigos esperados:

- `400 CASE_LANGFUSE_INVALID`: corpo, intervalo ou limite inválido;
- `404 CONNECTION_NOT_FOUND`: conexão ausente;
- `422 CONNECTION_KIND_INVALID`: conexão não é Langfuse;
- `422 AGENT_SCOPE_INVALID`: agente/domínio inexistente ou incompatível;
- `422 CONNECTION_AUTH_FAILED`: credenciais recusadas;
- `503 CONNECTION_UNAVAILABLE`: serviço indisponível, timeout ou falha da consulta;
- `429` não é repassado diretamente: a integração faz uma nova tentativa limitada e retorna erro sanitizado se persistir.

Nenhuma resposta contém chave, token, output de modelo ou payload bruto do trace.

## Leitura no Langfuse

A integração deve reutilizar `LangfuseClient` e a negociação de capabilities existente.

### Observations API v2

Usar `GET /api/public/v2/observations` com:

- `fromStartTime` e `toStartTime` sempre presentes;
- `isRootObservation=true` quando suportado;
- `fields=core,basic,io,trace_context`;
- `limit` limitado pelo lote solicitado e pelo máximo remoto;
- `cursor` retornado em `meta.cursor` para as páginas seguintes.

Os campos esperados são `id`, `traceId`, `startTime`, `parentObservationId`, `type`, `sessionId`, `isRootObservation`, `name`, `input`, `traceName` e `environment`, conforme os grupos solicitados. O parser deve aceitar I/O como string, objeto ou array e não deve exigir que o Langfuse faça parsing JSON.

A paginação v2 é por cursor; a implementação atual do repositório de traces que assume `meta.page/totalPages` deve ser ajustada ou isolada para não aplicar paginação de página à nova importação.

### Fallback legado

Se a negociação detectar deployment legado, usar somente o endpoint legado já negociado, carregar o limite de tempo e registrar em `limitations` que a origem é deprecated. A resposta legada deve ser normalizada para o mesmo candidato, usando `trace.id`, `trace.input`, `trace.timestamp` e os campos opcionais disponíveis.

O fallback não deve mascarar `401`, `403`, timeout ou erro de schema.

## Mapeamento trace → case

- `id`: `langfuse-` + prefixo determinístico de SHA-256 de `connectionId:traceId`, mantendo o limite de 120 caracteres;
- `sessionId`: `sessionId` do Langfuse quando preenchido; caso contrário, `traceId`;
- `similarityGroup`: `traceName`, depois `name`, depois `langfuse`;
- `content`: `input` da observação, convertido para texto; strings são preservadas e objetos/arrays usam JSON compacto;
- `source`: `historical`;
- `sourceReference`: `langfuse:<connectionId>:<traceId>`;
- `createdAt`: timestamp da importação local.

O output não é copiado para `content`; ele continua disponível apenas no trace remoto e não é necessário para formar o corpus de entrada.

Para escolher a observação de um trace, preferir uma observação marcada como raiz e com input serializável. Se houver mais de uma candidata, usar a mais antiga pelo `startTime`, deduplicando por `traceId`.

## Camadas e responsabilidades

- **Adapter Langfuse:** pagina observações, valida o schema, aplica retry limitado e devolve candidatos normalizados; não conhece agente/domínio nem persiste SQLite.
- **API:** valida escopo, recupera o segredo, seleciona a conexão, chama o adapter, deduplica contra o corpus do escopo e persiste o lote.
- **Frontend:** seleciona somente conexões Langfuse, valida datas/limite, dispara a operação e exibe contagens/limitações; nunca manipula credenciais.
- **Documentação:** explica janela de dados, fallback legado, deduplicação e limitações da API v2.

## Segurança e operação

- A descriptografia ocorre somente na API.
- Logs não podem conter `publicKey`, `secretKey`, tokens, input completo ou output completo.
- A API continua vinculada a loopback por padrão e deve permanecer atrás de proxy autenticado quando exposta.
- TLS continua verificando certificados; o processo deve usar `--use-system-ca`/`NODE_USE_SYSTEM_CA=1` quando a CA corporativa for necessária.
- A janela de tempo e o limite obrigatório evitam exportações ilimitadas.
- A API v2 pode atrasar dados antigos de SDK/OTEL; a interface deve apresentar essa limitação quando conhecida.

## Testes e critérios de aceite

1. Adapter: paginação v2 por cursor, limite, intervalo, seleção de raiz, I/O string/objeto, deduplicação, retry `429` e fallback legado.
2. API: validação, conexão inexistente/tipo inválido, escopo, deduplicação de cases, persistência atômica e ausência de segredos nas respostas.
3. Frontend: seleção de conexão Langfuse, validação de datas/limite, estados de sucesso/erro/vazio e preservação dos fluxos JSON/CSV.
4. E2E: importar traces mockados e confirmar que os cases aparecem no escopo correto sem overflow mobile.
5. Verificação final: typecheck, testes, build, `git diff --check` e smoke opt-in contra a conexão real sem registrar credenciais.

A feature será considerada pronta quando uma busca real bounded importar pelo menos um trace com input no agente/domínio correto, repetir a mesma busca sem criar duplicatas e não expor credenciais ou outputs em nenhuma resposta.
