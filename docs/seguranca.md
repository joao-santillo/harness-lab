# Segurança

## Modelo atual

A API e um servico local sem autenticacao/autorizacao de usuario. Ela escuta em `127.0.0.1` por padrao. O isolamento por agente/dominio e aplicado nas rotas e no SQLite, mas nao substitui autenticacao. Para qualquer rede compartilhada, use um proxy autenticado e restrinja acesso; nao exponha diretamente o FastAPI.

## Credenciais de integração

- Langfuse usa Basic Auth no adapter; a API testa as credenciais pelo probe de capabilities antes de persistir.
- Agent Platform armazena URL/token criptografados, mas o tester atual não autentica contra a plataforma.
- Respostas de criação e consulta nunca contêm valores de credenciais.
- A rota `/credentials` retorna apenas estado configurado.
- A interface limpa campos secretos depois da requisição; o retry usa a mesma identidade/idempotency key quando tipo, nome e URL permanecem iguais.

## Criptografia

`APP_ENCRYPTION_KEY` deve ser Base64 canônico de 32 bytes. O adapter usa libsodium `crypto_secretbox_easy`, nonce aleatório e ciphertext autenticado. Não versione `.env`, não registre a chave e não a envie em issue, screenshot ou log. Backups de `encrypted_secrets` exigem a mesma chave para recuperação.

A aplicação não cifra todo o SQLite. Cases, traces, snapshots opacos e artefatos de rodada podem conter conteúdo operacional em claro no arquivo de banco. Proteja permissões do diretório, volumes e backups; use dados minimizados e retenção apropriada.

## Redação e conteúdo não confiável

O redactor reconhece chaves normalizadas como `authorization`, `token`, `accessToken`, `refreshToken`, `secret`, `clientSecret`, `password`, `apiKey`, `signature` e `x-amz-signature`; também mascara usuário/senha em URLs, parâmetros de URL com esses nomes e valores secretos configurados. Isso é defesa adicional, não garantia de detecção de todo segredo nem substituto para evitar conteúdo sensível na entrada. Trace, prompt, output, CSV e JSON são dados não confiáveis: não execute instruções contidas nesses campos como comandos ou política do sistema.

Exports usam permissão `0600`. O endpoint de resultado devolve apenas resumo avaliativo; não devolve `opaquePayload`.

## Riscos e ações operacionais

1. **API sem autenticação:** manter loopback ou acrescentar proxy autenticado antes de deployment compartilhado.
2. **Chave perdida/alterada:** credenciais cifradas tornam-se irrecuperáveis; manter backup protegido da chave, separado do banco.
3. **Dados SQLite em claro:** limitar acesso ao volume e remover conteúdo fora da política de retenção.
4. **Provider externo:** revisar destinos, allowlists de ferramentas, limites e segredos antes de carregar `WORKER_PROVIDER_MODULE`.
5. **Agent Platform:** não confiar em `configured: true` como prova de login remoto; hoje significa que os dados foram salvos.
6. **Exports:** validar conteúdo e redaction antes de compartilhar externamente.
