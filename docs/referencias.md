# Referências do projeto

## Código upstream

- Harness2: https://github.com/google-research/harness2
- Commit fixado: `1cfe254e8d25b15f37048c3730134686abe60335`
- Licença: Apache-2.0
- Atribuição: [`../THIRD_PARTY_NOTICES.md`](../THIRD_PARTY_NOTICES.md)

## Contratos de integração

O contrato Agent Platform deve vir do OpenAPI/Swagger oficial do ambiente de destino; nenhum URL privado é reproduzido aqui. A compatibilidade real ainda não foi verificada.

Para Langfuse, consulte a documentação oficial de Public API e o OpenAPI servido pela própria instância. A versão da API pode variar em ambientes self-hosted; o adapter negocia Observations v2 e mantém um fallback legado explícito.

## Documentos internos

- [Especificação original](./superpowers/specs/2026-10-30-agent-platform-harness-improvement-design.md)
- [Plano de wiring e entrada de cases](./superpowers/plans/2026-11-03-runtime-and-ui-wiring.md)
- [Visão da arquitetura](./arquitetura.md)
- [Limitações atuais](./limites.md)

A especificação original descreve o MVP desejado; para saber o comportamento efetivamente disponível, consulte também `limites.md` e os contratos API deste diretório.
