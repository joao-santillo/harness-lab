# Recuperação intuitiva de traces do Langfuse

## Objetivo

Substituir a importação direta e o contador agregado de itens ignorados por um fluxo curto de busca, revisão opcional e confirmação. O usuário deve saber, antes de gravar, quais traces serão importados e por que cada trace não aproveitável foi descartado.

## Experiência aprovada

O fluxo terá duas ações explícitas:

1. O usuário escolhe conexão, período, limite e filtro opcional e aciona **Buscar traces**.
2. O Harness apresenta um resumo e permite revisar o resultado antes da gravação.
3. Os traces aproveitáveis começam selecionados. O usuário pode marcar ou desmarcar itens individualmente ou usar **Selecionar todos**.
4. O usuário aciona **Importar N traces** para gravar apenas a seleção atual.

Alterar conexão, período, limite ou filtro invalida imediatamente a prévia anterior. Nenhum trace é gravado durante a busca.

## Resultado da busca

O resumo permanece visível durante a revisão e apresenta quatro números separados:

- **Encontrados**: traces distintos examinados na janela e no filtro solicitados;
- **Prontos**: traces que podem gerar um case;
- **Já importados**: traces cujo case determinístico já existe no escopo do agente;
- **Descartados**: traces que não podem gerar um case.

O resultado detalhado será organizado em abas:

### Prontos

- Aberta por padrão quando houver itens importáveis.
- Cada linha contém checkbox, nome ou grupo, data/hora, sessão e identificador abreviado do trace.
- Todos os itens começam marcados.
- O cabeçalho oferece **Selecionar todos** e **Limpar seleção**.
- A ação principal usa a contagem atual: **Importar N traces**.
- Com nenhum item marcado, a ação fica desabilitada e informa que é necessário selecionar ao menos um trace.

### Já importados

- Itens somente para consulta, sem checkbox.
- Cada linha identifica o trace e informa **Já importado**.
- Quando disponível, exibe o identificador do case existente.

### Descartados

- Itens somente para consulta, sem checkbox.
- Cada linha apresenta um motivo específico, calculado no servidor.
- Os motivos iniciais são:
  - `MISSING_ROOT`: não foi possível identificar a observação raiz;
  - `MISSING_USABLE_INPUT`: raiz e observações filhas não possuem entrada utilizável;
  - `INVALID_START_TIME`: a observação candidata não possui data válida;
  - `CONTENT_TOO_LARGE`: a entrada excede o limite aceito por um case;
  - `INVALID_SESSION_ID`: a sessão não pode ser normalizada dentro do limite;
  - `SOURCE_REFERENCE_TOO_LARGE`: a referência de origem excederia o limite persistido;
  - `INVALID_CONTENT`: a entrada existe, mas não pode ser serializada com segurança.

A interface traduz os códigos para frases curtas em português e inglês. Ela não deduz causas a partir de contadores.

## Contrato do adapter

O adapter deixa de retornar apenas `candidates` e `skipped`. Cada trace examinado gera exatamente um resultado discriminado:

```ts
type LangfuseTraceRecoveryItem =
  | { status: "ready"; traceId: string; candidate: LangfuseCaseImportCandidate }
  | { status: "discarded"; traceId: string; reason: LangfuseTraceDiscardReason };

interface LangfuseTraceRecoveryResult {
  readonly items: readonly LangfuseTraceRecoveryItem[];
  readonly limitations: readonly string[];
}
```

Traces sem raiz passam a ser resultados `discarded` com `MISSING_ROOT`; não desaparecem nem são agregados silenciosamente. A escolha de conteúdo continua preferindo a raiz e, depois, a observação filha válida mais antiga.

O limite solicitado representa a quantidade máxima de traces distintos devolvidos na prévia, e não apenas a quantidade de candidatos válidos. Assim, **Encontrados** corresponde ao conjunto efetivamente revisável e não cresce de modo imprevisível quando há descartes.

## API e armazenamento temporário

### Criar prévia

`POST /api/v1/cases/import-langfuse/preview`

Recebe os mesmos campos atuais: agente, domínio, conexão, intervalo, limite e filtro opcional. A rota valida o escopo, negocia capacidades, recupera os traces, classifica os resultados e consulta os cases existentes.

Resposta `200`:

```json
{
  "previewId": "opaque-id",
  "expiresAt": "2026-11-04T15:10:00.000Z",
  "summary": {
    "found": 18,
    "ready": 12,
    "alreadyImported": 3,
    "discarded": 3
  },
  "items": [
    {
      "traceId": "trace-123",
      "status": "ready",
      "traceName": "support-agent",
      "sessionId": "session-8",
      "startTime": "2026-11-04T14:00:00.000Z"
    },
    {
      "traceId": "trace-456",
      "status": "discarded",
      "reason": "MISSING_USABLE_INPUT",
      "startTime": "2026-11-04T14:02:00.000Z"
    }
  ],
  "limitations": []
}
```

O navegador recebe apenas metadados necessários para revisão. O conteúdo completo do `input`, as credenciais e o candidato persistível permanecem no servidor.

### Confirmar importação

`POST /api/v1/cases/import-langfuse/confirm`

```json
{
  "previewId": "opaque-id",
  "traceIds": ["trace-123", "trace-789"]
}
```

A confirmação aceita somente IDs classificados como `ready` naquela prévia. O servidor reconfirma o agente e o domínio associados, ignora com segurança um case que tenha sido criado depois da busca e devolve contagens separadas:

```json
{
  "requested": 2,
  "imported": 1,
  "alreadyImported": 1
}
```

A rota atual `POST /api/v1/cases/import-langfuse` permanece temporariamente como compatibilidade e mantém seu contrato durante a migração da interface. Ela poderá ser removida em mudança posterior explicitamente versionada.

### Ciclo de vida da prévia

- A prévia é associada a `previewId`, agente, domínio e conexão.
- Expira após cinco minutos.
- É consumida após uma confirmação bem-sucedida, impedindo reuso acidental.
- IDs são gerados com aleatoriedade criptográfica e não carregam dados do usuário.
- O armazenamento inicial é em memória, com limite global e remoção por expiração. Isso é adequado ao processo único atual, mas não garante confirmação em outra instância da API.
- Caso a API seja executada com múltiplas réplicas, o armazenamento deverá migrar para SQLite ou outro repositório compartilhado antes de habilitar o recurso nesse modo.

Prévia ausente, expirada ou consumida retorna `410 PREVIEW_EXPIRED`. Seleção vazia ou com trace não pertencente à prévia retorna `400 PREVIEW_SELECTION_INVALID`.

## Estados da interface

- **Inicial**: formulário e botão **Buscar traces**.
- **Buscando**: formulário bloqueado apenas durante a chamada e texto **Buscando traces...**.
- **Prévia pronta**: resumo, abas e botão de importação.
- **Sem resultados**: mensagem **Nenhum trace encontrado para este período e filtro**, mantendo os parâmetros editáveis.
- **Sem itens prontos**: abre a aba **Descartados** ou **Já importados**, conforme o conteúdo, e não mostra ação de importação ativa.
- **Importando**: preserva a seleção visível e impede envio duplicado.
- **Concluído**: informa separadamente importados e itens que passaram a existir após a busca; atualiza a lista de cases.
- **Prévia expirada**: explica que o resultado venceu e oferece **Buscar novamente**.
- **Falha de conexão ou autenticação**: mantém os filtros e usa as mensagens existentes, sem expor respostas do Langfuse.

## Segurança e privacidade

- A prévia não envia o conteúdo bruto do trace ao navegador.
- Credenciais continuam resolvidas exclusivamente no servidor.
- Erros do Langfuse permanecem sanitizados.
- O servidor valida que todos os `traceIds` confirmados pertencem à prévia e ao mesmo escopo.
- Os limites atuais de páginas, observações, tamanho de resposta e quantidade máxima permanecem ativos.
- Logs não devem registrar conteúdo, credenciais nem o candidato completo.

## Testes

### Adapter

- classifica um trace válido como `ready`;
- informa individualmente cada causa de descarte;
- classifica trace sem raiz como `MISSING_ROOT`;
- mantém a preferência raiz seguida do filho válido mais antigo;
- limita o número total de traces devolvidos;
- preserva paginação, filtros, limites e sanitização já cobertos.

### API

- a busca não persiste cases;
- separa prontos, existentes e descartados no resumo;
- armazena candidatos sem devolvê-los ao navegador;
- confirma apenas os traces selecionados;
- rejeita IDs que não pertencem à prévia;
- rejeita prévia expirada ou consumida;
- trata concorrência entre busca e confirmação como `alreadyImported`;
- mantém o endpoint legado durante a migração.

### Web

- altera o CTA de importar para buscar;
- mostra resumo e abas com contagens corretas;
- inicia os prontos selecionados;
- permite marcar, desmarcar, selecionar todos e limpar seleção;
- atualiza o texto **Importar N traces**;
- mostra o motivo individual de cada descarte;
- invalida a prévia ao alterar parâmetros;
- trata vazio, expiração, falhas e confirmação concorrente;
- mantém navegação por teclado, foco visível e associação entre checkbox e trace.

## Critérios de aceite

- Buscar traces nunca grava cases.
- Todo trace mostrado pertence a exatamente uma categoria: pronto, já importado ou descartado.
- Todo trace descartado apresenta um motivo individual vindo da API.
- O usuário controla quais traces prontos serão importados.
- A confirmação nunca aceita traces fora da prévia exibida.
- Alterar qualquer parâmetro da busca impede o uso da prévia anterior.
- O resultado final não usa o termo genérico **Ignorados**.