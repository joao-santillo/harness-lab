# Suporte e interpretação de erros

## A API não inicia

- `APP_ENCRYPTION_KEY_INVALID`: `.env` ausente, placeholder ou valor que não seja Base64 canônico de 32 bytes.
- `API_PORT_INVALID`: porta fora do intervalo 1–65535.
- `API_START_FAILED`: mensagem geral do entrypoint; confira as variáveis sem copiar/expor segredos.

## O worker não inicia

- `WORKER_PROVIDER_MODULE_REQUIRED`: defina um caminho para o provider local.
- `WORKER_PROVIDER_MODULE_INVALID`: o módulo não exporta `createRoundStageDependencies`.
- `WORKER_START_FAILED`: confira configuração, caminho, banco e implementação do provider.

## Conexões

- `CONNECTION_AUTH_FAILED`: Langfuse recusou as credenciais; Agent Platform ainda não testa autenticação real.
- `CONNECTION_UNAVAILABLE`: endpoint sem resposta ou falha de capability probe.
- `IDEMPOTENCY_CONFLICT`: a chave de repetição foi reutilizada com outro payload.
- `CONNECTION_NOT_FOUND`: ID não cadastrado.

Não copie corpos de erro de serviços externos para tickets sem remover tokens, URL privada, trace e conteúdo de usuário.

## Cases

- `CASE_IMPORT_INVALID`: JSON/schema inválido ou mais de 40 cases.
- `CASE_CSV_INVALID`: cabeçalho/aspas/linha inválidos.
- `CASE_CSV_SIZE_INVALID`: CSV vazio ou acima de 40 linhas de dados.
- `CASE_ALREADY_EXISTS`: ID já importado; o lote inteiro é revertido.
- `CASE_SCOPE_INVALID`: agente não existe ou domínio não corresponde.
- `HISTORICAL_SOURCE_REFERENCE_REQUIRED`: faltou indicar a origem histórica.
- `SYNTHETIC_LABEL_REQUIRED`: falta o marcador `SYNTHETIC`.

## Rodadas

- `ROUND_SCOPE_INVALID`: agente/domínio não correspondem.
- `ROUND_ALREADY_EXISTS`: ID de rodada repetido.
- `ROUND_NOT_ACTIVE`: não há job ativo cancelável.
- `ROUND_RESULT_NOT_READY`: avaliação ainda não foi persistida.
- `ROUND_CLAIM_LOST`: outro worker assumiu o lease; a instância antiga deve parar.
- `ROUND_TERMINAL_DECISION_UNAVAILABLE`: recuperação em `exporting` não encontrou decisão persistida; o sistema falha fechado.

Uma rodada em `setup` sem progresso pode não ter sido reivindicada por worker. Confirme se existe worker saudável e provider válido. Não altere o banco manualmente para forçar um estado terminal.
