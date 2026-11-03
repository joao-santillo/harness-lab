# Operação

## Pré-requisitos

- Node.js `>=24.12.0 <25`;
- pnpm `10.20.0`;
- Chromium compatível para E2E visual;
- chave `APP_ENCRYPTION_KEY` em Base64, decodificando exatamente 32 bytes;
- módulo de providers local para processar rodadas no worker.

## Instalação

Na raiz do worktree:

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

Gere uma chave localmente e copie a saída para `.env` sem compartilhá-la:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

A chave placeholder do `.env.example` é intencionalmente inválida; a API e o worker recusam iniciar com ela.

## Processos

Abra terminais separados a partir da raiz:

```bash
pnpm --filter @harness-lab/api start
pnpm --filter @harness-lab/worker start
pnpm --filter @harness-lab/web dev
```

A API usa `API_HOST`/`API_PORT` (padrão `127.0.0.1:3000`). A interface Vite usa `WEB_PORT` (padrão 5173) e encaminha `/api` para `API_PROXY_TARGET`. A raiz do repositório carrega o `.env`; a configuração Vite resolve esse arquivo explicitamente.

`pnpm dev` inicia os scripts `dev` existentes no workspace; no estado atual, somente a interface possui script `dev`. Inicie API e worker explicitamente.

## Dados

`APP_DATA_DIR` deve apontar para uma pasta persistente. Caminhos relativos são resolvidos a partir da raiz do repositório, independentemente do diretório de onde o processo foi iniciado. Com `./data`, API e worker compartilham `<raiz-do-repositório>/data/harness.sqlite`; em deployment, prefira caminho absoluto.

O banco é SQLite em `harness.sqlite`, com WAL, foreign keys e `synchronous=FULL`. Exports ficam em `APP_DATA_DIR/exports/<agente>/<rodada>/`. Exports são criados com permissão `0600`; proteja também o diretório e os backups.

Faça backup coordenado do banco, exports e chave de criptografia. Sem a mesma chave não é possível recuperar as credenciais criptografadas. O SQLite contém também cases e artefatos de rodada não criptografados pelo aplicativo; controle acesso ao volume/backup.

## Configuração do provider do worker

O worker exige `WORKER_PROVIDER_MODULE`, caminho local para um módulo exportando `createRoundStageDependencies(context)`. A assinatura exata, as portas obrigatórias, os requisitos de segurança e as pendências estão em [Contrato do provider](./provider-do-worker.md). `cases` é opcional: se omitido, o runtime lê o corpus SQLite pelo agente/domínio da rodada.

Sem provider válido, o processo encerra antes de reivindicar jobs. Não use fixtures de teste como provider de produção.

## Testes e build

```bash
pnpm -r typecheck
pnpm -r test
pnpm -r build
pnpm --filter @harness-lab/web test:e2e
```

O Playwright pode usar Chromium gerenciado. Em ambientes Linux incompatíveis, defina `PLAYWRIGHT_CHROMIUM_EXECUTABLE` com o caminho absoluto para um Chromium disponível.

## Inicialização segura

- A API não tem autenticação de usuário e faz bind em loopback por padrão. Não a exponha diretamente na internet.
- Se usar proxy/reverse proxy, configure autenticação e limite acesso às rotas de conexão/cases/rodadas.
- Não existe flag nem smoke test real implementado neste repositório; os testes padrão são herméticos e nenhum teste externo foi executado.
- A Agent Platform não é verificada pela rota de conexão enquanto o contrato de health-check não for confirmado.
