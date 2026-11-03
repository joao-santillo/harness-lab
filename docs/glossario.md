# Glossário

- **Agente:** configuração executável selecionada no Agent Platform.
- **Harness:** instruções, fluxo, ferramentas e parâmetros que influenciam como o agente executa uma tarefa.
- **Rodada:** ciclo persistido de coleta, diagnóstico, refinamento, execução, avaliação e exportação.
- **Checkpoint:** estado/evento durável gravado após uma etapa; permite retomar a rodada e delimita onde o cancelamento cooperativo será observado.
- **Case/caso:** unidade de entrada usada para testar o agente; contém ID, sessão, grupo de similaridade e conteúdo.
- **Caso de diagnóstico:** case permitido ao diagnóstico/refinamento.
- **Caso reservado:** case separado antes do refinamento, usado apenas na avaliação independente.
- **Partição:** divisão determinística entre diagnóstico e validação reservada.
- **Trace:** execução observada no Langfuse, composta por observações/filhos.
- **Evidência:** referência a trace/execução com trecho sanitizado que sustenta um achado.
- **Achado:** fato observado e medido; não é, por si só, causa raiz.
- **Hipótese:** explicação causal a ser testada, sempre ligada a um achado/evidência.
- **Proposta:** alteração pequena e revisável no harness.
- **Candidate:** snapshot candidato, executado em ambiente de teste e nunca promovido automaticamente.
- **Avaliação:** julgamento independente com decisão terminal, amostra, confiança, regressões e limitações.
- **Proveniência:** registro de onde um case veio; não comprova sua qualidade.
- **Provider do worker:** módulo de deployment que conecta as portas de traces, harness, propostas, execução e export.
- **Fallback legado:** rota Langfuse usada quando a sonda Observations v2 retorna 404/405; essa condição é registrada como limitação.
