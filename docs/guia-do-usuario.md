# Guia do usuário

Este guia explica o fluxo disponível na interface. Os textos da aplicação podem ser alternados entre português do Brasil, inglês e espanhol.

## 1. Configure uma conexão

Na aba **Agentes**, escolha uma integração:

- **Langfuse:** informe nome, URL base, chave pública e chave secreta. A API testa o acesso pelo endpoint de capabilities antes de salvar.
- **Agent Platform:** informe nome, URL base e token. Neste estado do projeto, o backend valida o formato da URL e a presença do token, mas **não confirma autenticação nem acesso à plataforma**. O contrato real de verificação ainda precisa ser validado.

A interface envia a conexão ao backend e limpa os campos secretos depois da tentativa. A API retorna somente metadados; não retorna os valores das credenciais.

Depois do cadastro, o painel **Conexões salvas** mostra o nome, o tipo e o status de cada integração configurada. A lista é atualizada automaticamente após um novo cadastro ou manualmente pelo botão de atualização; credenciais e URLs não são exibidas.

## 2. Cadastre um agente

Na seção **Agentes e casos de avaliação**, informe:

- **ID do agente:** letras minúsculas, números e hífens; comece com letra ou número.
- **ID do domínio:** escopo lógico usado para separar dados e aprendizados.
- **Nome do agente:** nome legível para a equipe.

Se o agente já existir, a interface permite tentar importar casos para ele. O backend valida novamente o escopo.

## 3. Importe casos

Selecione o formato e informe de 1 a 40 casos por lote. Cada caso precisa de ID único, sessão, grupo de similaridade e conteúdo.

### JSON

```json
[
  {
    "id": "caso-001",
    "sessionId": "sessao-001",
    "similarityGroup": "grupo-perguntas-acesso",
    "content": "Como solicito acesso ao sistema?"
  }
]
```

As opções de origem são:

- **JSON** ou **Manual:** conteúdo fornecido pela equipe;
- **Histórico importado:** exige uma `sourceReference` que identifique o conjunto de origem;
- **Sintético:** exige o marcador literal `SYNTHETIC` em cada caso.

O rótulo não comprova qualidade nem validade do conteúdo; ele registra apenas a proveniência declarada.

### CSV

O arquivo deve conter as colunas `id,sessionId,similarityGroup,content`. O parser aceita campos entre aspas, vírgulas, quebras de linha e aspas escapadas conforme CSV RFC4180. A API atribui a origem `csv`; o cliente não pode escolher esse rótulo para outros formatos.

A importação é atômica: se houver ID duplicado ou escopo inválido, nenhum caso do lote é gravado.

### Importação automática do Langfuse

Para transformar traces históricos em cases, escolha **Importar do Langfuse** na origem. Selecione uma conexão Langfuse salva, informe a janela de início e fim e escolha um limite entre 1 e 40. Opcionalmente, selecione um campo do Langfuse (`traceName`, ambiente, tag, ID de usuário ou ID de sessão) e informe o valor. O filtro é aplicado na busca remota antes do limite, evitando que traces recentes de outros agentes ocupem as vagas. Sem filtro, todos os traces da janela podem ser considerados. O agente selecionado define o destino dos cases no Harness; não é automaticamente um filtro nos traces do Langfuse. As credenciais permanecem no backend.

Escolha **Buscar traces** para consultar e classificar os resultados sem gravar nada. A lista separa traces **Prontos**, **Já importados** e **Descartados**; cada descarte mostra seu motivo. Os traces prontos começam selecionados, então você pode confirmar rapidamente ou revisar a lista, usar a busca rápida e ajustar a seleção antes de importar. Somente os traces selecionados são gravados. O preview expira em cinco minutos; se isso acontecer, faça uma nova busca.

O sistema prefere o `input` da observação raiz de cada trace. Se a raiz não tiver um `input` utilizável, tenta o da observação filha elegível mais antiga; sem uma raiz dentro da janela, o trace é descartado. Traces sem entrada válida ou com data, sessão, referência ou conteúdo fora dos limites também são descartados com uma razão individual. Outputs nunca são copiados. A busca mostra contagens e quaisquer limitações da leitura, sem expor o conteúdo dos inputs no navegador antes da confirmação.

Repetir a mesma importação não cria duplicatas: cases já existentes são contados como ignorados. A leitura v2 é paginada por cursor, limitada e pode atrasar dados produzidos por SDKs ou OTEL mais antigos. Em instalações que só oferecem o endpoint legado, a interface informa a limitação de endpoint deprecated.

## 4. Inicie e acompanhe uma rodada

Na aba **Rodadas**:

1. selecione o agente;
2. descreva o objetivo;
3. selecione **Iniciar rodada**;
4. acompanhe o estado e o stream de eventos;
5. use **Cancelar rodada** para solicitar cancelamento cooperativo.

A solicitação de cancelamento não significa que a rodada já terminou: a chamada à integração em andamento não é interrompida à força. Quando a etapa atual retorna, o worker verifica o pedido antes de iniciar a próxima etapa, grava o estado terminal e libera o job. O tempo depende do timeout configurado no provider. Uma rodada recém-criada aparece como `setup` até um worker ativo reivindicar o job.

## 5. Consulte resultados

A aba **Resultados** mostra resumos das avaliações persistidas: decisão, quantidade de casos, confiança, justificativa e limitações. A lista não inclui o payload opaco do harness nem credenciais.

Rodadas sem avaliação disponível não aparecem como recomendadas. Se nenhuma avaliação foi persistida, a tela informa que ainda não há resultados.

## O que pode impedir uma rodada

A API e a interface podem criar e enfileirar uma rodada, mas o worker precisa de um `WORKER_PROVIDER_MODULE` válido. Esse módulo deve fornecer associação entre casos e traces, leitura do harness, propostas, execução, avaliação e exportação. O repositório não contém um provider real completo, porque o contrato da Agent Platform e as políticas de proposta/exportação ainda precisam de confirmação.
