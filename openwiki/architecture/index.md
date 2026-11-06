# Files

- [Modelo de Domínio e Contratos de Portas](domain-model.md) - Especificação técnica detalhada do modelo de domínio imutável do Harness Lab e dos contratos de portas (Protocols) que garantem o isolamento arquitetural das regras de negócio em relação à infraestrutura externa.
- [Persistência e Armazenamento em SQLite](storage-persistence.md) - Arquitetura da camada de persistência em SQLite do Harness Lab, detalhando o modo WAL, gerenciamento de transações com BEGIN IMMEDIATE, migrações versionadas com checksum e a estrutura das tabelas round_artifacts e round_jobs.
- [Visão Geral da Arquitetura Modular](system-overview.md) - Especificação técnica da arquitetura monolítica modular do Harness Lab, detalhando a separação clara em camadas (domain, application, adapters, api, worker, web) e as portas de desacoplamento Hexagonal.
