# Integrações

## Langfuse

O adapter usa HTTP(S), Basic Auth, timeout limitado e injeta `fetch` nos testes. A conexão API tenta `GET /api/public/v2/observations?limit=1`:

- `401/403`: credenciais inválidas;
- `429`: limite de taxa;
- resposta OK: escolhe observations v2;
- `404/405`: tenta uma leitura limitada (`page=1`, `limit=1`, janela de 60 segundos) em `/api/public/traces`; só seleciona fallback legado se a chamada for autenticada e tiver resposta válida;
- outros erros: falha de negociação.

A coleta v2 usa intervalo temporal e paginação por página, normaliza IDs/proveniência e converte observações em evidências. Campos ausentes continuam ausentes e viram limitações. A coleção de scores e a associação automatizada entre cases importados e traces não estão completas.

Se a rota legada responder `401/403`, as credenciais são rejeitadas. O fallback continua sendo legado/depreciado e sua limitação é registrada; confirme a versão da instância e planeje atualização.

## Agent Platform

O client implementa Bearer token, timeout, erros sanitizados e injeção de `fetch`. O adapter mapeia somente `dta-flow`, `tools`, `parameters`, `knowledge`, `memory` e `records`; campos desconhecidos são preservados em payload opaco e usados no hash do snapshot.

**Contrato de rede não confirmado:** caminhos como `/api/agents/:id/capabilities`, `/api/agents/:id/harness` e `/api/test/executions` estão fixos no adapter e cobertos somente por fixtures herméticas. Apenas URL base e token são configuráveis. Esses caminhos não foram validados com um serviço real; não assuma que são oficiais nem execute contra produção.

O cadastro no backend verifica formato de URL/token e armazena os dados cifrados. Ele não confirma autorização remota. Não existe smoke test real implementado. Antes de ativar o provider, obtenha OpenAPI/Swagger oficial do ambiente, valide caminhos, autenticação, payloads, versão/candidate semantics, ambiente de teste, polling e correlação de trace.

## Harness2

O adapter caracteriza o fluxo Propose-Probe-Compose e registra o upstream. O commit pinado é `1cfe254e8d25b15f37048c3730134686abe60335`, licença Apache-2.0. O código do produto não depende dos tipos do benchmark upstream; o adapter traduz entradas/saídas para os modelos internos.

## Providers do worker

O runtime não instancia integrações diretamente. Um módulo de deployment fornece `traces`, `harnesses`, `proposals`, `executor`, `evaluator` e `exportRound`. Isso evita embutir endpoints, janela de traces, política de mudanças ou localização de secrets sem contrato aprovado. Cases vêm do SQLite quando `cases` não é sobrescrito.

## Testes

Os testes padrão usam `fetch` fake e não enviam tráfego externo. Antes de usar um provider real, crie contrato sanitizado, habilite um ambiente não produtivo, limite a uma rodada/case e registre a limitação de observabilidade. Não há flag nem suite de smoke test real implementada neste momento.
