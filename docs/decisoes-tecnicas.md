# Decisões técnicas

## Monólito modular

API, worker e interface são processos do mesmo workspace, com pacotes domain/application/adapters. A separação reduz acoplamento, mas não cria isolamento de rede/autorização automaticamente.

## SQLite para o MVP local

SQLite mantém estado, checkpoints, fila e artefatos em um arquivo compartilhado. WAL e transações dão persistência local; execução em múltiplos hosts ou alta disponibilidade exigem nova decisão de storage.

## Harness2 por adapter

Harness2 é usado como referência/compatibilidade para Propose-Probe-Compose, não como benchmark runtime inteiro. Versão upstream fica pinada e caracterizada.

## Avaliação separada

A avaliação não pertence ao engine de refinamento. O resultado pode rejeitar/inconcluir; recuperação após crash lê a decisão persistida e falha fechada quando ela não existe.

## Casos reservados

Cases correlacionados por sessão/grupo ficam juntos; a partição é determinística e selada. Refinamento e learning recebem apenas casos/evidências do grupo de diagnóstico.

## Compatibilidade externa conservadora

Langfuse negocia Observations v2 e registra fallback legado. Agent Platform conserva campos desconhecidos e não assume capabilities além do allowlist. Onde o contrato real não foi confirmado, o recurso é descrito como não verificado.

## Sem publicação automática

O produto exporta candidatos e relatórios, mas não promove/publica uma versão na produção. Uma futura ação de publicação requer requisito, autorização, confirmação humana e auditoria próprios.
