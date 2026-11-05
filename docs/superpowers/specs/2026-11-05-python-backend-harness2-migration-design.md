# Desenho: migração do backend para Python com Harness²

**Data:** 2026-11-05
**Estado:** desenho aprovado para revisão escrita; implementação ainda não autorizada.

## Objetivo

Migrar toda a aplicação do Harness Lab de TypeScript para Python, usando a implementação upstream do Harness² para o fluxo de refinamento reutilizável. Substituir React/TypeScript por interface server-rendered em Jinja2 com HTMX e preservar os contratos HTTP/SSE, os dados SQLite e o comportamento público existentes.

## Contexto verificado

- O repositório atual é um monólito modular TypeScript/Node.js com `apps/api`, `apps/worker`, `apps/web` e os pacotes `domain`, `application` e `adapters`.
- `packages/adapters/src/harness2/adapter.ts` é uma caracterização TypeScript; não invoca o Harness² Python. `packages/application/src/refinement/run-refinement.ts` contém refinamento próprio que se sobrepõe parcialmente ao Propose–Probe–Compose.
- O upstream disponibiliza o pacote Python `harness2` (Apache-2.0), compatível com Python `>=3.12,<3.14`. Os módulos reutilizáveis incluem recursão, scheduler, proposer, árvore de harness e biblioteca de experiências. O pacote não apresenta uma API consolidada no `harness2.__init__`; as APIs `harness2.core.*` devem ser tratadas como internas e protegidas por pin e testes de contrato.
- A integração de produção com Agent Platform ainda não está comprovada: endpoints, payloads, associação trace-case e semântica de execução dependem de contrato oficial.

## Escopo

### Incluído

- Backend Python para API REST/SSE e worker durável.
- Interface web renderizada no servidor com Jinja2, interações HTMX e CSS; migrar formulários, navegação, localização e atualizações de estado hoje implementados em React.
- Portabilidade das regras de domínio e aplicação que pertencem ao Harness Lab.
- Adapters Python para SQLite, criptografia, redaction, Langfuse, Agent Platform, Harness² e exportação.
- Integração fina com Harness², sem reimplementar sua recursão, composição, seleção ou biblioteca de experiências quando as APIs upstream forem compatíveis.
- Compatibilidade dos dados e contratos atuais, migração faseada, cutover e remoção do backend TypeScript após paridade.

### Fora de escopo

- Adicionar lógica de aplicação em JavaScript/TypeScript no navegador; usar HTMX para interações e manter CSS/HTML como recursos da apresentação.
- Inventar ou presumir o contrato de produção da Agent Platform; a ativação real depende da confirmação externa documentada.
- Alterar o produto para multi-tenant, introduzir autenticação de usuário ou trocar SQLite por outro banco.
- Manter duas implementações de refinamento ou um fork privado do Harness² como solução padrão.

## Arquitetura proposta

```text
Navegador
   │ HTML renderizado + HTMX
   ▼
FastAPI + Jinja2 ───────── SQLite existente
   │ REST / SSE (contrato atual) │
   │ jobs/checkpoints            │ stores Python
   ▼                             │
Worker Python ──────────────────┘
   ├── aplicação Harness Lab: isolamento, diagnóstico, avaliação, decisão e exportação
   ├── adapter Harness²: benchmark/substrate/proposer e conversão de harness
   └── adapters externos: Langfuse e Agent Platform
```

A organização Python deve espelhar as fronteiras de responsabilidade atuais, não os arquivos TypeScript: `domain`, `application`, `adapters`, `api`, `worker` e `web/templates`. FastAPI atende rotas HTML e REST; Jinja2 renderiza páginas e fragmentos; HTMX fornece submissões e atualizações parciais sem lógica de aplicação JavaScript/TypeScript própria. O CSS existente será reaproveitado e adaptado. O acesso ao SQLite pode usar `sqlite3` e as migrations SQL já existentes, evitando uma conversão de ORM que não agregue valor à migração. As rotas HTML chamarão serviços de aplicação compartilhados com a API, sem fazer chamadas HTTP para a própria aplicação.

A interface Python deve preservar navegação e funções atuais: cadastro de conexões, importação/revisão de cases, criação e acompanhamento de rodadas e consulta de resultados. Estados em andamento podem ser atualizados por fragmentos HTMX via polling; o endpoint SSE JSON existente permanece disponível e compatível. Não adicionar porcentagem artificial. Usar HTML semântico, labels, mensagens acessíveis e suporte de localização pt-BR/en/es. HTMX e extensões necessárias devem ser fixados por versão e carregados como dependências estáticas controladas pelo projeto.

### Adapter Harness²

1. Fixar uma revisão upstream exata; não depender de `main` nem de uma versão sem pin.
2. Criar uma implementação Python dos protocolos upstream `BenchmarkAdapter` e `SubstrateLike`, traduzindo cases, execução e harness da Agent Platform para os contratos requeridos pelo Harness².
3. Fazer um spike de compatibilidade com `harness2.core.schedule.run_task`, que é o ponto inicial recomendado por incluir recursão, seleção e persistência/reflexão de experiências. Não chamar apenas a recursão se isso obrigar o Harness Lab a reconstruir a seleção ou a biblioteca upstream.
4. Isolar imports `harness2.core.*` em um adapter próprio e cobri-los com testes de contrato contra a revisão pinada. Não copiar módulos upstream para o produto.
5. Se o scheduler upstream não puder representar o fluxo Agent Platform sem duplicação ou perda de semântica, interromper essa etapa e reavaliar o contrato/uma extensão upstream antes de portar `run-refinement.ts`. Não tratar a CLI de benchmarks upstream como interface genérica sem provar isso.

### Fronteira Harness Lab / Harness²

Harness² recebe somente tarefas e conteúdo da partição de diagnóstico. O manifesto de partição e a regra de não vazamento continuam sob controle do Harness Lab; casos reservados, IDs e conteúdo não podem entrar em propostas, probes, logs de refinamento ou biblioteca de experiências. A avaliação independente continua executando nos casos reservados e não deve importar módulos internos do Harness².

Particionamento determinístico, diagnóstico de traces, política de recomendação, estados/checkpoints/cancelamento, API, autenticação futura e stores são responsabilidades do produto e não devem ser reimplementados dentro do adapter Harness².

### Conversão e contratos externos

- Validar todo payload externo na fronteira e convertê-lo para modelos internos.
- Preservar campos desconhecidos da Agent Platform em `opaquePayload` para round-trip. A conversão para a árvore Harness² deve expor somente componentes explicitamente editáveis; ao reconstruir o snapshot, campos opacos são copiados intactos do snapshot de origem, nunca interpretados nem sobrescritos pelo refinador.
- Preservar códigos de erro estáveis e sanitizar mensagens/dados remotos.
- O resumo público de resultados deve continuar contendo somente decisão, amostra, confiança, métricas agregadas, regressões, limitações e justificativa — nunca snapshots completos, credenciais ou `opaquePayload`.
- Manter a paginação/retry e o preview/confirm de importação Langfuse, sem devolver conteúdo bruto de traces nas respostas públicas.

## Compatibilidade e segurança de dados

- Manter o SQLite existente como fonte de verdade; preservar nomes/tipos das tabelas, migrations, WAL, foreign keys, `synchronous=FULL`, leases, checkpoints, `payload_version` e formatos de artefatos na primeira migração.
- Preservar `/api/v1`, formatos JSON, códigos de erro e eventos SSE. SSE mantém `Last-Event-ID`, heartbeat e semântica terminal; não criar porcentagem artificial.
- Testar a interoperabilidade real dos segredos existentes. O backend TypeScript usa `libsodium crypto_secretbox_easy`; a implementação Python só poderá substituir a cifra após teste cruzado de descriptografia com fixtures não secretas/geradas em teste, incluindo chave, nonce, encoding e layout persistido. Credenciais nunca podem transitar em claro em respostas ou logs.
- Continuar redigindo segredos, restringindo permissões de exports e reconhecendo que dados operacionais do SQLite permanecem em claro conforme o modelo atual.
- Não executar API/worker antigos e novos simultaneamente como escritores do mesmo banco. O cutover deve ter backup verificado, parada dos processos antigos, inicialização dos processos Python e procedimento de rollback usando formatos compatíveis.

## Plano de migração (macroetapas)

1. **Caracterização e spike Harness²:** transformar testes TypeScript e fixtures em contratos/golden cases; provar `run_task`, protocolos, conversão Agent Platform e isolamento de casos contra a revisão upstream selecionada.
2. **Base Python e persistência:** configurar Python 3.12, dependências e testes; portar models/stores/migrations preservando SQLite, fila, artefatos e criptografia; testar contra cópia do banco atual.
3. **Adapters e regras de produto:** migrar redaction, Langfuse, mapeamento Agent Platform e exports; portar particionamento, diagnóstico, avaliação e políticas, mantendo a separação de Harness².
4. **Worker e orquestração:** migrar leases, cancelamento, checkpoints, retomada e fluxo de rodada; garantir que a decisão terminal sempre venha do artefato persistido e que falhas fechem como integração falha/inconclusiva, nunca como recomendação implícita.
5. **API Python compatível:** implementar REST/SSE e validar todos os contratos existentes, incluindo respostas de erro e sanitização.
6. **Interface Jinja2/HTMX:** migrar páginas, formulários, navegação, estados, localização e acessibilidade; manter os mesmos serviços de aplicação e contratos REST/SSE.
7. **Paridade, cutover e remoção:** rodar testes de unidade, integração e E2E; fazer backup/cutover único; verificar UI e retomada; então remover React, Vite, TypeScript, API/worker e pacotes TS, além da toolchain Node/pnpm se nenhum outro componente ainda depender dela.

## Estratégia de testes e critérios de aceite

- **Contrato HTTP/SSE:** mesmos endpoints, schemas, códigos de erro, ordenação/paginação e retomada SSE usados pelo frontend existente.
- **Persistência:** abrir cópia de banco criado pelo backend TypeScript; ler/escrever entidades e continuar rodadas/checkpoints; garantir migrations compatíveis e rollback documentado.
- **Criptografia:** segredo cifrado pela implementação antiga pode ser lido pela nova e vice-versa em teste; nenhuma resposta/log expõe segredo.
- **Harness²:** testes de contrato confirmam ordem/composição/seleção/reflexão conforme a revisão pinada; alterações upstream não entram silenciosamente; nenhuma lógica genérica equivalente permanece em TypeScript/Python no produto.
- **Isolamento:** testes comprovam que conteúdo e IDs reservados não chegam ao adapter/refinamento/biblioteca Harness² e que apenas a avaliação os consome.
- **Adapters:** schemas, erros estáveis, `opaquePayload` preservado em round-trip, redaction e exports sanitizados.
- **Round lifecycle:** testes herméticos para leases, idempotência, cancelamento, falha de integração, retomada em checkpoints e decisão recuperada após reinício.
- **Interface:** testes de rotas/templates e interações HTMX; E2E Playwright cobre os fluxos equivalentes à suíte atual, incluindo navegação por teclado, labels, feedback de erros, importação, acompanhamento e resultados. Preferir executar os testes E2E em Python para não manter TypeScript/Node como dependência apenas de testes.
- **Remoção de TypeScript:** após a paridade, nenhum código de aplicação frontend/backend em TypeScript/JavaScript, build Vite ou pacote pnpm permanece; dependências estáticas de terceiros usadas pelo HTMX são fixadas e não contêm lógica de negócio do produto.
- **Cutover:** backup legível, procedimento de rollback ensaiado e nenhum processo TypeScript de backend escrevendo simultaneamente com o Python.

## Riscos e gates

1. **APIs internas do Harness²:** pin exato, testes de contrato e revisão de mudanças upstream são obrigatórios. O spike é gate antes de portar o refinamento.
2. **Modelo Agent Platform versus árvore Harness²:** validar a conversão sem perder campos opacos e sem afirmar equivalência entre componentes que não correspondam.
3. **Proposer/substrate:** provar que a configuração de modelo e execução necessária pelo Harness² pode acionar a Agent Platform sem duplicar executor/proposer.
4. **Contrato externo incompleto:** manter provider real desabilitado até obter contrato oficial e ambiente de teste; fixtures não são prova de compatibilidade remota.
5. **SQLite/segredos:** paridade transacional e criptográfica precisa ser demonstrada contra dados existentes antes do cutover.
6. **Mudança comportamental:** testes atuais passam a ser caracterização do produto, mas não justificam portar bugs ou funcionalidades não implementadas como se fossem recursos existentes.

## Referências

- Harness Lab: `docs/arquitetura.md`, `docs/api.md`, `docs/seguranca.md`, `docs/integracoes.md` e `docs/provider-do-worker.md`.
- Harness² upstream: [repositório](https://github.com/google-research/harness2), [guia de setup](https://github.com/google-research/harness2/blob/main/docs/SETUP.md), [guia de experimentos](https://github.com/google-research/harness2/blob/main/docs/EXPERIMENTS.md), e módulos `harness2/core/recursion.py`, `schedule.py`, `spec.py`, `library.py` e `tree.py`.
