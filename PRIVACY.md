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
| Nomes técnicos de campos, colunas de grid, código/tabela de painéis e itens de menu recentes, lidos do DOM/AngularJS da página TASY | Exibir os overlays de metadados, a lista de "Recentes" e alimentar o "Dicionário de dados" pesquisável no popup | `chrome.storage.local` (`recentFeatures`, `dataDictionary`) e repassados via mensagens internas da extensão; nunca saem do navegador |
| Configurações da extensão (quais overlays estão ativos, se o registro de processo está ligado, regras de cor por ambiente cadastradas pelo usuário) | Lembrar as preferências do usuário entre sessões | `chrome.storage.local` |

A extensão não lê o conteúdo clínico das telas do TASY por conta própria. **Enquanto o Registrar Processo está ativo**, porém, ela: (1) registra o valor que o próprio usuário digita em campos de formulário, e (2) tira um screenshot da tela visível a cada passo. Ambos existem só para montar a documentação do processo que o próprio usuário pediu para gravar. Se o processo documentado envolver dados de paciente ou outra informação sensível — inclusive dados de **outras pessoas que apareçam incidentalmente na tela** (ex.: uma lista com vários pacientes ao fundo) —, esse conteúdo fica no texto copiado e no arquivo `.html` baixado; **cabe ao usuário revisar esse material antes de compartilhá-lo** (por exemplo, antes de anexar num chamado de suporte). Campos do tipo senha (`type="password"`) nunca são capturados.

## Permissões solicitadas

- **tabs**: necessária para identificar a aba ativa (usada para filtrar o registro de processo copiado e para a função "Recarregar estilos") e para capturar o screenshot de cada passo (`chrome.tabs.captureVisibleTab`) enquanto o Registrar Processo está ativo.
- **storage**: necessária para guardar as preferências do usuário e o log de performance localmente.
- **scripting**: necessária para a função "Recarregar estilos" (força o navegador a buscar novamente os arquivos CSS da página sem recarregá-la por completo).
- **Acesso a todos os sites (`<all_urls>`)**: a extensão precisa rodar em qualquer domínio que o usuário configure como seu ambiente TASY, que varia de empresa para empresa. Na prática, a extensão só ativa suas funcionalidades em páginas cujo hostname contenha "tasy"; em qualquer outro site ela permanece inativa. O padrão `<all_urls>` (em vez de `http://*/*` + `https://*/*` separados) é exigido especificamente pela API `chrome.tabs.captureVisibleTab`, usada para o print de cada passo do Registrar Processo.

## Contato

Dúvidas sobre esta política podem ser abertas como issue no repositório do projeto.
