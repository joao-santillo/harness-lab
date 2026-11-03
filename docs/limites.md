# Limitações e próximos passos

Este documento registra limites do código atual para que testes herméticos não sejam confundidos com validação de deployment.

## Bloqueios para produção ponta a ponta

- O worker exige `WORKER_PROVIDER_MODULE`; não há provider completo incluído.
- Não existe política implantada de associação cases ↔ traces Langfuse nem janela de coleta configurada por agente/rodada.
- A estratégia de geração de propostas, guardrails por negócio, executor real e destino/segredo dos exports dependem do provider.
- Os caminhos/payloads do adapter Agent Platform ainda não foram validados contra OpenAPI/Swagger oficial de um ambiente real.
- Cadastro Agent Platform não confirma login; `configured: true` indica apenas registro/cifragem.
- Não há smoke test real nem flag para executá-lo; compatibilidade externa continua não verificada.

## Segurança/deployment

- As rotas API não exigem identidade de usuário. O bind padrão é loopback; deployment em rede compartilhada exige proxy autenticado.
- Credenciais são cifradas; cases e artefatos no SQLite não são cifrados pelo aplicativo.
- `.env` deve receber chave real, ser mantido fora do Git e protegido. Rotação formal de master key ainda não está automatizada.
- Não há política de retenção/expurgo configurável pela interface.
- SQLite/local filesystem são adequados para o MVP local, não para múltiplos workers ou alta disponibilidade.

## Produto

- Importação disponível: JSON/manual, CSV e JSON com provenance histórica ou sintética devidamente marcada. Não há integração automática com um catálogo histórico nem gerador sintético embutido.
- Há criação/listagem de agentes/rodadas, cancelamento e resumo de resultados; critérios de sucesso configuráveis, revisão humana, juiz calibrado e comparação completa de diffs ainda não estão conectados a uma experiência completa.
- A origem histórica é uma referência declarada pelo operador; o sistema não valida seu conteúdo contra uma fonte externa.
- O conteúdo de avaliação é amostrado e limitado; não há edição visual de cases após importação.

## Qualidade ainda necessária antes de publicar

- Confirmar OpenAPI da Agent Platform e revisar cada endpoint/mapeamento executado.
- Criar provider de deployment e realizar smoke test não produtivo com uma única execução.
- Configurar autenticação de API, backup/restore testado e política de retenção.
- Revisar diffs e executar gates na branch que será submetida a PR.
