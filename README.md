# Harness Lab

Aplicação para organizar rodadas auditáveis de avaliação e melhoria de agentes. A interface cadastra conexões, agentes e cases; a API persiste o trabalho; o worker executa as etapas fornecidas por um módulo local de integração.

> **Estado importante:** a integração real de execução com Agent Platform ainda depende de contrato e provider de deployment confirmados. O worker encerra sem processar jobs quando `WORKER_PROVIDER_MODULE` não está configurado/implementado. Conexões Agent Platform são armazenadas criptografadas, mas ainda não são verificadas remotamente.

## Documentação

- [Índice da documentação](docs/README.md)
- [Guia do usuário](docs/guia-do-usuario.md)
- [Arquitetura](docs/arquitetura.md)
- [API](docs/api.md)
- [Operação local](docs/operacao.md)
- [Contrato do provider do worker](docs/provider-do-worker.md)
- [Segurança](docs/seguranca.md)
- [Integrações e estado de compatibilidade](docs/integracoes.md)
- [Desenvolvimento](docs/desenvolvimento.md)
- [Limitações e próximos passos](docs/limites.md)
- [Glossário](docs/glossario.md)
- [Suporte e erros](docs/suporte-e-erros.md)
- [Decisões técnicas](docs/decisoes-tecnicas.md)
- [Referências e atribuições](docs/referencias.md)

## Início rápido

Requisitos: Node.js `>=24.12.0 <25` e pnpm `10.20.0`.

1. Execute `pnpm install --frozen-lockfile`.
2. Copie `.env.example` para `.env`.
3. Substitua `APP_ENCRYPTION_KEY` por uma chave aleatória Base64 de 32 bytes. O placeholder não é válido.
4. Inicie API, interface e, se houver provider configurado, worker em terminais separados:

   - `pnpm --filter @harness-lab/api start`
   - `pnpm --filter @harness-lab/web dev`
   - `pnpm --filter @harness-lab/worker start`

A API usa loopback por padrão e não implementa autenticação de usuário. Não a exponha em rede compartilhada sem um proxy autenticado. Detalhes de provider e dados estão em [Operação](docs/operacao.md).

## Verificação

- `pnpm -r typecheck`
- `pnpm -r test`
- `pnpm -r build`
- `pnpm --filter @harness-lab/web test:e2e`

## Licenças de terceiros

Consulte [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md).
