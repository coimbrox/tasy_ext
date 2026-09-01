# Política de Privacidade — Tasy DevTools

Última atualização: 2026-08-26

Tasy DevTools é uma extensão para Google Chrome voltada a desenvolvedores e times de suporte que trabalham com o sistema TASY. Esta página explica quais dados a extensão acessa, como são usados e armazenados.

## Resumo

- A extensão **não envia nenhum dado para servidores externos**. Nenhuma informação coletada é transmitida para o desenvolvedor da extensão ou para terceiros.
- Todo o processamento acontece localmente, no navegador do usuário.
- Todos os dados que a extensão armazena ficam em `chrome.storage.local`, isolados no seu próprio perfil do Chrome, e podem ser apagados a qualquer momento removendo a extensão, usando o botão "Limpar recentes" ou iniciando/parando o registro de processo no popup.

## Dados acessados e por quê

| Dado | Por quê | Onde fica |
|---|---|---|
| Nome da tela/funcionalidade aberta, texto de botões/links clicados, valor digitado em campos de formulário (exceto campos de senha), e método/caminho/status/duração de cada requisição real (fetch/XHR) feita pela página TASY | Só enquanto o usuário ativa manualmente o "Registrar Processo" no popup: monta um resumo cronológico do que foi feito (telas abertas, cliques, campos preenchidos, chamadas de backend, oscilações de rede) para diagnóstico ou documentação de um processo | `chrome.storage.local` (campo `performanceTraceLog`) enquanto o registro está ativo; ao parar, o resumo é copiado para a área de transferência e o log é zerado na próxima ativação. Não inclui corpo da requisição/resposta de rede |
| **Screenshot da aba visível** a cada tela aberta ou clique/preenchimento, capturado via `chrome.tabs.captureVisibleTab` | Só enquanto "Registrar Processo" está ativo: gerar o relatório `.html` com um print de cada passo, baixado automaticamente ao parar o registro | `chrome.storage.local` (campo `traceScreenshots`), só enquanto o registro está ativo; embutido no arquivo `.html` baixado ao parar. Apagado ao iniciar um novo registro |
| URL e tempo de resposta de uma sondagem HTTP (`/favicon.ico?__tasy_probe=...`) | Detectar oscilação/lentidão de rede enquanto o registro está ativo | `chrome.storage.local` (campo `performanceTraceLog`), só enquanto o registro está ativo |
| **Captura de erros** — só com a opção "Capturar e explicar erros do TASY" ativada: (1) o texto do diálogo "Houve um erro na execução da aplicação", incluindo o bloco "Mais detalhes"; (2) o rótulo das últimas ações do usuário (cliques e nomes de campos — **sem os valores digitados**), mantido só em memória; (3) método/caminho/status das últimas requisições e, **apenas das que retornaram erro (HTTP ≥ 400)**, o corpo da resposta truncado (~3 KB); (4) o conteúdo do arquivo de erro do próprio usuário no console do TasyAppServer (`wheb_arquivo.jsp`), buscado no mesmo domínio com a sessão que o navegador já tem — exceção, `Interface`/`Action`/`Parameters` e stack trace, truncados. Sequências de 6+ dígitos são mascaradas em todo esse material. | Montar um relatório do erro com contexto (o que aconteceu, em qual processo, causa provável e o que verificar) para diagnóstico ou anexo em chamado | `chrome.storage.local` (campo `errorCaptureLog`, últimos 30 erros); mostrado num painel na tela e no popup; embutido no `.html` de "Baixar relatório". A extensão **nunca lê nem manipula a senha do TasyAppServer** — ela depende da sessão que o usuário já abriu no navegador. A URL base do app server pode ser configurada no popup |
| Nomes técnicos de campos, colunas de grid, código/tabela de painéis e itens de menu recentes, lidos do DOM/AngularJS da página TASY | Exibir os overlays de metadados, a lista de "Recentes" e alimentar o "Dicionário de dados" pesquisável no popup | `chrome.storage.local` (`recentFeatures`, `dataDictionary`) e repassados via mensagens internas da extensão; nunca saem do navegador |
| Configurações da extensão (quais overlays estão ativos, se o registro de processo está ligado, regras de cor por ambiente cadastradas pelo usuário) | Lembrar as preferências do usuário entre sessões | `chrome.storage.local` |

A extensão não lê o conteúdo clínico das telas do TASY por conta própria. **Enquanto o Registrar Processo está ativo**, porém, ela: (1) registra o valor que o próprio usuário digita em campos de formulário, e (2) tira um screenshot da tela visível a cada passo. Ambos existem só para montar a documentação do processo que o próprio usuário pediu para gravar. Se o processo documentado envolver dados de paciente ou outra informação sensível — inclusive dados de **outras pessoas que apareçam incidentalmente na tela** (ex.: uma lista com vários pacientes ao fundo) —, esse conteúdo fica no texto copiado e no arquivo `.html` baixado; **cabe ao usuário revisar esse material antes de compartilhá-lo** (por exemplo, antes de anexar num chamado de suporte). Campos do tipo senha (`type="password"`) nunca são capturados.

De forma parecida, **com a "Captura de erros" ativada**, o corpo de respostas de erro e o `Parameters` do arquivo de erro do app server podem conter identificadores de registros ou de pacientes ligados à operação que falhou. Esse conteúdo é truncado e tem dígitos longos mascarados, mas ainda assim **cabe ao usuário revisar o relatório do erro antes de anexá-lo num chamado**.

## Permissões solicitadas

- **tabs**: necessária para identificar a aba ativa (usada para filtrar o registro de processo copiado e para a função "Recarregar estilos") e para capturar o screenshot de cada passo (`chrome.tabs.captureVisibleTab`) enquanto o Registrar Processo está ativo.
- **storage**: necessária para guardar as preferências do usuário e o log de performance localmente.
- **cookies**: usada só em domínios cujo hostname contém "tasy", para ler o **cookie de afinidade do app server** (que fixa a sessão a um nó do cluster, ex.: `tasy-tasyappserver-...`). A extensão extrai apenas um identificador curto do nó (para mostrar "em qual servidor você está" no rodapé, no relatório de erro e no texto do chamado). O valor da sessão em si não é exibido nem armazenado, e nenhum cookie é enviado para fora do navegador.
- **scripting**: necessária para a função "Recarregar estilos" (força o navegador a buscar novamente os arquivos CSS da página sem recarregá-la por completo).
- **Acesso a todos os sites (`<all_urls>`)**: a extensão precisa rodar em qualquer domínio que o usuário configure como seu ambiente TASY, que varia de empresa para empresa. Na prática, a extensão só ativa suas funcionalidades em páginas cujo hostname contenha "tasy"; em qualquer outro site ela permanece inativa. O padrão `<all_urls>` (em vez de `http://*/*` + `https://*/*` separados) é exigido especificamente pela API `chrome.tabs.captureVisibleTab`, usada para o print de cada passo do Registrar Processo. Esse mesmo acesso permite que a "Captura de erros" busque o arquivo de erro no console do TasyAppServer (por padrão no mesmo domínio do TASY, ou na URL configurada no popup), reaproveitando a sessão já existente do usuário.

## Contato

Dúvidas sobre esta política podem ser abertas como issue no repositório do projeto.
