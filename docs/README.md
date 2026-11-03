# Documentação do Harness Lab

Use esta página para encontrar a orientação adequada ao seu trabalho.

## Para quem usa a aplicação

- [Guia do usuário](./guia-do-usuario.md): cadastrar agente e conexão, importar casos, iniciar e acompanhar rodadas.
- [Referência da API](./api.md): rotas, formatos de requisição, respostas e erros.

## Para quem desenvolve ou opera

- [Arquitetura](./arquitetura.md): módulos, fluxo da rodada, persistência e fronteiras entre camadas.
- [Operação](./operacao.md): configuração local, processos, dados, testes e recuperação.
- [Contrato do provider do worker](./provider-do-worker.md): assinatura, portas obrigatórias e critérios para uma integração real.
- [Segurança](./seguranca.md): chave de criptografia, credenciais, dados armazenados e exposição da API.
- [Integrações](./integracoes.md): o que está implementado para Langfuse, Agent Platform e Harness2.
- [Desenvolvimento](./desenvolvimento.md): estrutura do repositório, comandos e regras de manutenção.
- [Limitações e próximos passos](./limites.md): o que ainda exige contrato, provider ou decisão de produto.

## Estado documentado

A documentação distingue capacidades comprovadas por testes herméticos de integrações verificadas em ambientes reais. A integração de leitura Langfuse tem endpoint confirmado para negociação; o contrato de execução/validação da Agent Platform ainda não foi confirmado. O worker aceita providers por módulo local e não inicia rodadas se esse módulo estiver ausente ou inválido.

Os arquivos em `docs/superpowers/` são especificações e planos de implementação históricos, preservados no idioma em que foram produzidos. Esta documentação em PT-BR é a referência de uso e operação do estado atual.
