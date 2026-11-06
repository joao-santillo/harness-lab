---
type: operations
title: Configurações, Criptografia e Segurança
description: Guia operacional sobre variáveis de ambiente, armazenamento criptografado de segredos via PyNaCl SecretBox, redação recursiva de dados sensíveis e diretrizes de segurança da API.
tags: [configuration, security, encryption, secretbox, pynacl, redactor, environment-variables, credentials]
verified:
  - by: openwiki/0.7.2
    at: 2026-11-06T14:17:17.542Z
sources:
  - id: openwiki-source-6830e44109953100c1c0a6c8
    resource: repo://src/harness_lab/adapters/security/encrypted_secret_store.py
  - id: openwiki-source-25dce32e419f66ae74602912
    resource: repo://src/harness_lab/adapters/security/redactor.py
  - id: openwiki-source-d991184a24bd0752c5490268
    resource: repo://src/harness_lab/adapters/security/safe_logging.py
  - id: openwiki-source-bdd42bbf1c4f590438f31e14
    resource: repo://src/harness_lab/adapters/security/secretbox_codec.py
  - id: openwiki-source-667992a84a0046c49559767b
    resource: repo://src/harness_lab/api/routes/connections.py
  - id: openwiki-source-bdbac019d6249ecd214e831f
    resource: repo://src/harness_lab/worker/config.py
  - id: openwiki-source-0f57b59c79ed66069746e898
    resource: repo://tests/integration/security/test_secretbox_legacy_compatibility.py
generated: { by: "openwiki/0.7.2", at: "2026-11-06T14:17:17.542Z" }
---

# Configurações, Criptografia e Segurança

O **Harness Lab** opera como um monolito modular voltado para avaliação e benchmarking de agentes autônomos. Por lidar com integrações externas (como [Langfuse](../integrations/langfuse.md) e [Agent Platform](../integrations/agent-platform.md)), o sistema implementa mecanismos rigorosos para cifragem de credenciais em repouso, redação recursiva de dados sensíveis em logs e isolamento de rotas.

Esta página detalha a especificação das variáveis de ambiente, a arquitetura do cofre de segredos criptografado (`EncryptedSqliteSecretStore`), o funcionamento do higienizador de logs (`Redactor` e `SafeLogger`), a segurança da API HTTP e as diretrizes operacionais para mitigação de riscos em produção.

---

## Modelo de Segurança e Perímetro

O sistema foi desenhado sob as seguintes premissas de segurança:

1. **Serviço Local sem Autenticação Interna**: Por padrão, a API HTTP escuta exclusivamente na interface de loopback `127.0.0.1:8000`. Ela não possui autenticação ou autorização de usuários integrada no nível de aplicação.
2. **Exposição em Rede Compartilhada**: Qualquer deployment acessível por redes externas ou compartilhadas **deve** obrigatoriamente utilizar um proxy reverso autenticado (ex.: Nginx, Envoy ou API Gateway) para restringir o acesso.
3. **Isolamento de Domínio**: O isolamento lógico entre agentes, casos de teste e execuções (*rounds*) é aplicado diretamente nas rotas HTTP e nas consultas do SQLite, mas não substitui a camada de autenticação de rede.
4. **Proteção de Conteúdo Não Confiável**: Traces, prompts de LLM, respostas de candidatos, arquivos CSV/JSON e payloads opacos são classificados como dados não confiáveis (*untrusted data*). O sistema proíbe a execução de instruções contidas nesses campos como comandos ou políticas do sistema.

---

## Variáveis de Ambiente e Configuração Operacional

A configuração do [Worker Runtime](worker-runtime.md) e do servidor API é realizada através de variáveis de ambiente gerenciadas pela classe `WorkerConfig` em `src/harness_lab/worker/config.py` e pelos pontos de entrada do servidor.

### Tabela de Variáveis de Ambiente

| Variável | Padrão | Faixa / Validação | Descrição |
| :--- | :--- | :--- | :--- |
| `APP_ENCRYPTION_KEY` | *(Obrigatório)* | Base64 canônico de 32 bytes | Chave mestre usada na cifragem/decifragem dos segredos no PyNaCl SecretBox. |
| `WORKER_PROVIDER_MODULE` | `None` | Caminho de arquivo `.py` relativo ou absoluto | Módulo customizado contendo provedores de execução do worker. |
| `APP_DATA_DIR` | `./data` | Diretório no sistema de arquivos | Diretório de armazenamento do banco de dados SQLite (`harness.sqlite`). |
| `WORKER_ID` | `worker-{pid}` | String não vazia | Identificador único da instância do worker no cluster de lease. |
| `WORKER_POLL_INTERVAL_MS` | `1000` | `100` a `60000` ms | Intervalo de sondagem da fila de trabalhos pelo worker. |
| `ROUND_PARTITION_SEED` | `round-partition-v1` | String de semente | Semente de particionamento determinístico de rodadas no worker. |
| `ROUND_MINIMUM_RESERVED` | `1` | `1` a `100` | Quantidade mínima reservada de partições no orçamento do worker. |
| `ROUND_RESERVED_RATIO` | `0.2` | `0.0 < ratio < 1.0` | Proporção reservada de partições no worker. |
| `ROUND_MAX_PROPOSALS` | `3` | `1` a `20` | Limite máximo de propostas avaliadas por rodada. |
| `APP_HOST` | `127.0.0.1` | Endereço IP / Hostname | Endereço IP de escuta do servidor HTTP FastAPI (`main.py`). |
| `APP_PORT` | `8000` | Número de porta TCP | Porta TCP de escuta do servidor HTTP FastAPI (`main.py`). |
| `DATABASE_PATH` | `data/harness.sqlite` | Caminho de arquivo | Caminho direto para o arquivo do banco de dados SQLite utilizado pela API. |

### Validação Estrita da Chave de Criptografia

A validação de `APP_ENCRYPTION_KEY` é feita pela função `_valid_key` em `src/harness_lab/worker/config.py`:

```python
def _valid_key(value: str | None) -> str:
    if value is None:
        raise ValueError("APP_ENCRYPTION_KEY_INVALID")
    try:
        decoded = base64.b64decode(value, validate=True)
    except Exception as error:
        raise ValueError("APP_ENCRYPTION_KEY_INVALID") from error
    if len(decoded) != 32 or base64.b64encode(decoded).decode("ascii") != value:
        raise ValueError("APP_ENCRYPTION_KEY_INVALID")
    return value
```

Para ser aceita, a chave deve ser a representação Base64 canônica de exatamente 32 bytes de entropia. Se a chave estiver ausente, tiver tamanho diferente de 32 bytes após decodificada, ou contiver um formato de padding não canônico (onde a recodificação não seja idêntica à string original), o sistema interrompe a inicialização lançando a exceção `ValueError("APP_ENCRYPTION_KEY_INVALID")`.

Se as demais variáveis numéricas estiverem fora dos limites definidos, as exceções correspondentes (`WORKER_POLL_INTERVAL_INVALID`, `ROUND_MINIMUM_RESERVED_INVALID`, `ROUND_RESERVED_RATIO_INVALID` ou `ROUND_MAX_PROPOSALS_INVALID`) são disparadas durante a resolução da configuração.

---

## Armazenamento Criptografado de Segredos (PyNaCl SecretBox)

O gerenciamento de credenciais de integração (chaves de API do Langfuse e tokens do Agent Platform) é feito pelo adaptador `EncryptedSqliteSecretStore`, implementado em `src/harness_lab/adapters/security/encrypted_secret_store.py`, utilizando a classe `SecretBoxCodec` em `src/harness_lab/adapters/security/secretbox_codec.py`.

### Arquitetura do SecretBoxCodec

O `SecretBoxCodec` empacota a funcionalidade da biblioteca `PyNaCl` (`nacl.secret.SecretBox`), fundamentada na primitiva criptográfica autenticada `crypto_secretbox_easy` do **libsodium** (cifragem XSalsa20 + autenticação de mensagem Poly1305 MAC).

```mermaid
flowchart TD
    A["SecretStore.save(id, secret)"] --> B["SecretBoxCodec.encrypt(value)"]
    B --> C["Gera Nonce Aleatório de 24 bytes (utils.random)"]
    C --> D["Executa PyNaCl SecretBox.encrypt(plaintext, nonce)"]
    D --> E["Concatena MAC Poly1305 (16B) + Ciphertext"]
    E --> F["Codifica Nonce e Ciphertext em Base64 (sem padding '=')"]
    F --> G["INSERT ON CONFLICT DO UPDATE na tabela encrypted_secrets"]

    H["SecretStore.get(id)"] --> I["SELECT key_version, nonce, ciphertext FROM encrypted_secrets WHERE id = ?"]
    I --> J["SecretBoxCodec.decrypt(encrypted_dict)"]
    J --> K["Valida key_version == 1, len(nonce) == 24, len(ciphertext) >= 16"]
    K --> L["Executa PyNaCl SecretBox.decrypt(ciphertext, nonce)"]
    L -- "Sucesso" --> M["Retorna SecretValue(value=decrypted)"]
    L -- "CryptoError / MAC Invalido" --> N["Lança ValueError('SECRET_DECRYPTION_FAILED')"]
```
Fluxo de cifragem autenticada e decifragem de segredos utilizando PyNaCl SecretBox e persistência relacional no SQLite.

### Formato do Envelope e Esquema de Banco de Dados

Cada segredo é cifrado individualmente com um nonce aleatório único de 24 bytes (`SecretBox.NONCE_SIZE`) e armazenado na tabela `encrypted_secrets` do SQLite:

```sql
CREATE TABLE encrypted_secrets (
    id TEXT PRIMARY KEY,
    key_version INTEGER NOT NULL,
    nonce TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
```

As propriedades do envelope cifrado são:
- **`key_version`**: Inteiro indicando a versão da estrutura de chave (atualmente `1`).
- **`nonce`**: String Base64 (com os caracteres de preenchimento `=` removidos no final) representando o nonce aleatório de 24 bytes.
- **`ciphertext`**: String Base64 (sem preenchimento `=`) contendo o texto cifrado prefixado pelos 16 bytes do MAC de autenticação Poly1305 (`SecretBox.MACBYTES`).

### Erros Padronizados de Armazenamento

Para evitar vazamento de informações colaterais (side-channel attacks), o adaptador converte exceções criptográficas brutas em códigos de erro padronizados:

- **`INVALID_ENCRYPTION_KEY`**: Disparado no construtor de `SecretBoxCodec` se a chave mestre em Base64 for inválida ou não possuir 32 bytes.
- **`SECRET_STORE_CORRUPT`**: Disparado ao decodificar envelopes ausentes, com `key_version != 1`, núncios com tamanho diferente de 24 bytes, ciphertexts menores que 16 bytes ou codificação Base64 corrompida.
- **`SECRET_DECRYPTION_FAILED`**: Disparado quando o PyNaCl lança `nacl.exceptions.CryptoError`, indicando que o MAC Poly1305 falhou devido à adulteração dos dados ou ao uso de uma chave mestre incorreta.

### Compatibilidade Cross-Platform

A implementação do `SecretBoxCodec` garante compatibilidade direta com a biblioteca oficial `@slidev/libsodium` ou `libsodium-wrappers` em Node.js / TypeScript. A suíte de testes de integração em `tests/integration/security/test_secretbox_legacy_compatibility.py` valida contra a fixture sintética `tests/contracts/fixtures/security/secretbox-v1.json`, garantindo que payloads cifrados pelo TypeScript sejam decifrados com precisão pelo Python e vice-versa.

---

## Redação e Higienização de Dados Sensíveis (Redactor & SafeLogger)

O módulo de redação em `src/harness_lab/adapters/security/redactor.py` e o registrador seguro em `src/harness_lab/adapters/security/safe_logging.py` impedem o vazamento acidental de credenciais em logs, rastros de execução (*traces*) e mensagens de erro.

### Estrutura do Redactor

A função `create_redactor(secret_values)` constrói um higienizador recursivo imutável que substitui qualquer segredo detectado pela constante `"[REDACTED]"`.

```mermaid
flowchart TD
    A["create_redactor(secret_values)(input)"] --> B{"Tipo do Objeto?"}
    B -- "string" --> C["Aplica substituição de valores conhecidos + Sanitização de URLs"]
    B -- "list / tuple" --> D["Executa varredura recursiva nos itens"]
    B -- "Mapping / dict" --> E["Se a chave for sensível: força '[REDACTED]'. Caso contrário: varredura recursiva nos valores"]
    B -- "BaseException" --> F["Mascara name, message, stack, cause e atributos"]
    B -- "int / float / bool / None" --> G["Retorna valor sem alteração"]

    C --> H["Objeto Higienizado ([REDACTED])"]
    D --> H
    E --> H
    F --> H
    G --> H
```
Fluxo do algoritmo de redação recursiva de dados sensíveis com tratamento de URLs e exceções.

### 1. Detecção por Chaves Sensíveis (`_SENSITIVE_KEYS`)

O redactor normaliza todas as chaves de dicionários e atributos de objetos removendo caracteres não alfabéticos e convertendo para minúsculo. Qualquer chave coincidente com o conjunto reservado tem seu valor substituído imediatamente por `"[REDACTED]"`:

```python
_SENSITIVE_KEYS = {
    "authorization",
    "token",
    "accesstoken",
    "refreshtoken",
    "secret",
    "clientsecret",
    "password",
    "apikey",
    "signature",
    "xamzsignature",
}
```

### 2. Higienização de URLs (`_redact_url`)

A função `_redact_url` intercepta URLs com esquema `http` ou `https` em qualquer bloco de texto:
- **UserInfo (Usuário e Senha)**: URLs contendo credenciais de autoridade no formato `https://user:password@host/` são alteradas para `https://%5BREDACTED%5D@host/`.
- **Query Parameters**: Parâmetros de consulta cujos nomes correspondam a `_SENSITIVE_KEYS` têm seus valores mascarados, ex.: `?token=xyz` torna-se `?token=%5BREDACTED%5D`.

### 3. Redação por Valores Conhecidos (`secret_values`)

Quando instanciado com uma lista de segredos conhecidos (ex.: tokens configurados), o `Redactor` constrói variações codificadas por URL (crua, percent-encoded e minúscula) e varre recursivamente todas as strings substituindo as ocorrências.

### 4. Proteção contra Ciclos e Tratamento de Exceções

- **Prevenção de Recursão Infinita**: O redactor mantém um dicionário de ponteiros de memória visitados (`seen: dict[int, Any]`) para evitar travamentos por referências circulares em dicionários e listas aninhadas.
- **Tratamento de Exceções (`BaseException`)**: Ao encontrar uma exceção, o redactor mascara recursivamente a mensagem, o rastreamento da pilha (*stack trace*), a causa subjacente (`__cause__`) e quaisquer atributos adicionais acoplados ao objeto de erro.

### Logger Seguro (`SafeLogger`)

O `SafeLogger` (`src/harness_lab/adapters/security/safe_logging.py`) atua como um wrapper sobre a emissão de eventos estruturados:

1. **Campos Permitidos (`allowlist_fields`)**: Somente os campos declarados na lista de permissões são repassados ao sink de eventos.
2. **Denylist de Chaves Reservadas (`_RESERVED_DENY_KEYS`)**: Chaves reservadas de dados sensíveis nunca são emitidas nos logs, mesmo se forem incluídas em `allowlist_fields`:
   ```python
   _RESERVED_DENY_KEYS = {
       "credential",
       "credentials",
       "trace",
       "input",
       "prompt",
       "opaquepayload",
       "opaque_payload",
   }
   ```
3. **Higienização Automática**: Todos os campos permitidos passam obrigatoriamente pelo `Redactor` antes do envio.

---

## Gerenciamento de Credenciais na API HTTP

As rotas de conexão em `src/harness_lab/api/routes/connections.py` gerenciam o ciclo de vida das credenciais de integração de forma segura.

```mermaid
sequenceDiagram
    autonumber
    actor Client as Cliente HTTP / Web UI
    participant API as FastAPI Router (/api/v1/connections)
    participant Probe as Integration Probe / Capabilities
    participant Store as EncryptedSqliteSecretStore
    participant DB as Tabela connection_registrations

    Client->>API: POST /api/v1/connections (Idempotency-Key)
    API->>Probe: Executa Capability Probe com as credenciais recebidas
    alt Credenciais Inválidas ou Serviço Indisponível
        Probe-->>API: Retorna erro de autenticação ou conexão
        API-->>Client: Responde HTTP 422 (CONNECTION_AUTH_FAILED) ou 503 (CONNECTION_UNAVAILABLE)
    else Credenciais Válidas
        Probe-->>API: Autenticação confirmada
        API->>Store: save(connection_id, secret_payload)
        Store->>Store: Cifra o segredo com PyNaCl SecretBox
        Store-->>API: Persiste em encrypted_secrets
        API->>DB: Registra id, kind, name na tabela connection_registrations
        API-->>Client: Responde HTTP 201 (id, kind, name, configured=true)
    end
```
Sequência de validação proativa de credenciais por probe e persistência cifrada ao registrar conexões externas.

### Princípios de Segurança das Rotas de Conexão

1. **Probe de Capacidade Antes da Persistência**: Ao enviar um `POST /api/v1/connections`, a API chama o serviço de registro de conexão (`services.register_connection.execute`), que efetua um teste de conectividade (probe) contra a API externa (ex.: Langfuse) antes de cifrar e gravar a credencial no banco. Se a validação falhar, a requisição é rejeitada com HTTP 422 (`CONNECTION_AUTH_FAILED`).
2. **Ocultação Absoluta de Segredos**: Nenhuma rota de consulta (`GET /api/v1/connections` ou `GET /api/v1/connections/{id}`) retorna chaves ou tokens. A rota `/api/v1/connections/{id}/credentials` retorna apenas um estado booleano indicando a presença da credencial cifrada:
   ```json
   {
     "connectionId": "langfuse-main",
     "configured": true
   }
   ```
3. **Idempotência de Requisições**: A API aceita o cabeçalho `Idempotency-Key` no registro de conexões. Se uma requisição for repetida com as mesmas credenciais, tipo, nome e URL, o sistema reusa a mesma identidade sem gerar registros duplicados ou chamadas redundantes de cifragem.

---

## Riscos Operacionais e Diretrizes de Mitigação

Em consonância com as diretrizes de segurança operacionais descritas em `docs/seguranca.md`, as seguintes ações devem ser observadas no gerenciamento da infraestrutura:

1. **API sem Autenticação Integrada**: Manter o binding em loopback (`127.0.0.1`) ou posicionar obrigatoriamente um proxy reverso com suporte a TLS e autenticação (OAuth2, mTLS ou Basic Auth) antes de qualquer exposição pública ou em rede local.
2. **Gestão de Chave Perdida ou Alterada**: Como os dados da tabela `encrypted_secrets` dependem exclusivamente da chave `APP_ENCRYPTION_KEY`, se a chave for perdida ou alterada, todas as credenciais gravadas tornam-se **permanentemente irrecuperáveis** (`SECRET_DECRYPTION_FAILED`). A chave mestre deve ser mantida em backup seguro, fisicamente separado do banco de dados SQLite.
3. **Dados SQLite em Texto Simples**: O sistema não criptografa o banco SQLite por inteiro. Casos de teste, traces de execução, snapshots de prompts e artefatos de rodadas são mantidos em texto claro no arquivo `harness.sqlite`. É indispensável restringir as permissões do diretório e do arquivo de banco no sistema operacional (`chmod 0600`) e aplicar políticas de retenção adequadas.
4. **Módulos de Provedores Externos (`WORKER_PROVIDER_MODULE`)**: Antes de carregar módulos Python customizados no worker, revise os arquivos de destino, permissões de chamadas de rede, allowlists de ferramentas e gestão de variáveis de ambiente.
5. **Interpretação da Flag `configured: true`**: No adaptador do Agent Platform, a resposta `"configured": true` indica apenas que os parâmetros e o token foram salvos com sucesso na tabela de conexões. Não serve como garantia de que o login no serviço remoto esteja ativo ou autenticado no momento.
6. **Segurança no Export de Artefatos**: Os utilitários de exportação de dados aplicam permissão estrita `0600` nos arquivos gerados. Certifique-se de validar o processo de redação de dados antes de compartilhar relatórios ou exportações com terceiros.

---

## Testes e Verificação

A integridade do subsistema de segurança é mantida por testes unitários e de integração automatizados:

- **`tests/unit/adapters/security/test_secretbox_codec.py`**: Valida a cifragem e decifragem idênticas (roundtrip), rejeição de chaves inválidas ou não canônicas e tratamento de ciphertexts corrompidos.
- **`tests/unit/adapters/security/test_encrypted_secret_store.py`**: Garante a persistência cifrada no SQLite, a ausência de texto simples na gravação em disco, a rotação de segredos, a remoção e o disparo de exceções padronizadas (`SECRET_STORE_CORRUPT`, `SECRET_DECRYPTION_FAILED`).
- **`tests/unit/adapters/security/test_redactor.py`**: Testa o mascaramento recursivo de chaves sensíveis, tratamento de URLs com credenciais, substituição de segredos conhecidos, prevenção de ciclos de referência e sanitização de exceções.
- **`tests/unit/adapters/security/test_safe_logging.py`**: Verifica a filtragem por campos permitidos, o bloqueio inegociável de chaves denylisted (`credentials`, `trace`, `prompt`, `opaquePayload`) e a redação prévia do payload antes da emissão ao sink.
- **`tests/integration/security/test_secretbox_legacy_compatibility.py`**: Garante interoperabilidade exata entre o `SecretBoxCodec` Python e as fixturas libsodium geradas em TypeScript.
