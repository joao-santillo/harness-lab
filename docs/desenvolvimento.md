# Desenvolvimento

## Estrutura

```text
apps/api/       Fastify, rotas e entrypoint
apps/worker/    fila durável, runtime e entrypoint
apps/web/       React, Vite, telas e E2E
packages/domain/ modelos, eventos e portas
packages/application/ regras e casos de uso
packages/adapters/ SQLite, Langfuse, Agent Platform, segurança e exports
docs/           documentação de uso, arquitetura e operação
tests/          fixtures e caracterização
```

## Ambiente

Use Node `>=24.12.0 <25` e pnpm `10.20.0`. Instale com `pnpm install --frozen-lockfile`; copie `.env.example` para `.env` e substitua o placeholder da chave antes de iniciar API.

## Comandos

- `pnpm -r typecheck`: verifica tipos de todos os pacotes;
- `pnpm -r test`: executa testes unitários/contratuais definidos nos pacotes;
- `pnpm -r build`: compila a interface;
- `pnpm --filter @harness-lab/api start`: inicia API;
- `pnpm --filter @harness-lab/worker start`: inicia worker, requer provider local;
- `pnpm --filter @harness-lab/web dev`: inicia Vite;
- `pnpm --filter @harness-lab/web test:e2e`: roda Playwright.

O script raiz `pnpm dev` percorre somente pacotes com script `dev`; API e worker devem ser iniciados separadamente. `pnpm lint` não está configurado nos pacotes neste momento.

## Regras de contribuição

1. Escreva um teste que falha antes de implementar mudança comportamental.
2. Rode o teste focado; depois typecheck e suíte do pacote.
3. Use schemas Zod nas fronteiras HTTP/SQLite/externas.
4. Preserve códigos de erro estáveis e não propague corpo externo, token ou URL secreta em mensagens.
5. Mantenha a camada de domínio livre de Fastify, React, SQLite e clientes externos.
6. Adicione comentários PT-BR para invariantes, algoritmos de estado e decisões de compatibilidade; evite comentar linhas autoexplicativas.
7. Adicione migration nova; não reescreva migration aplicada.
8. Atualize API/README/guia quando contrato público mudar.

## Comentários de manutenção

Comentários devem explicar por que a implementação existe (por exemplo, por que reserva não pode entrar em memória ou por que recuperação de `exporting` falha fechado), e não repetir o que o código já diz. Tipos e nomes devem continuar sendo a primeira fonte de entendimento.

## E2E Chromium

Playwright 1.56 pode exigir um Chromium compatível. Se o binário gerenciado não estiver disponível, defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE` para caminho absoluto. A suíte cobre desktop e mobile e salva screenshots em `apps/web/test-results/` (diretório ignorado pelo Git).

## Provider module

Implemente a interface `WorkerProviderModule` apenas após revisar os contratos externos. Mantenha providers e credenciais fora dos fixtures e do Git. O teste de runtime pode usar adapters fakes; isso não prova compatibilidade de um deployment real.
