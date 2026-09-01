# Tasy DevTools (Chrome Extension)

Extensão Chrome (Manifest V3) para desenvolvedores e times de suporte do TASY: monitora oscilações de desempenho, exibe metadados técnicos das telas (nos moldes da Tasy Metadata Extension), monta um dicionário de dados pesquisável, grava processos passo a passo (com prints), captura e explica em português os erros do TASY (lendo o console do app server) e monta o texto de chamados de suporte.

Funciona em qualquer ambiente TASY cujo domínio contenha "tasy" no hostname (ex.: `tasy.suaempresa.com.br`, `tasyhml.suaempresa.com.br`, `dev.tasy.suaempresa.com.br`) — não é necessário configurar nada, ela ativa suas funcionalidades automaticamente nesses domínios.

## O que faz

Um link **📖 Manual** no topo do popup abre uma página explicando todas as funcionalidades abaixo em detalhe.

### Dicionário de dados

Enquanto você navega pelo TASY com os overlays de **Detalhes de campo**/**Detalhes de grid**/**Detalhes de painel** ativos, a extensão aprende sozinha os nomes técnicos de campos, colunas e painéis encontrados pelo caminho, junto com o rótulo visível na tela. No campo de busca no topo do popup, digite parte do nome técnico, do rótulo ou da tabela para encontrar; clique num resultado para copiar o nome técnico. Cresce naturalmente com o uso, guardado localmente.

### Registrar Processo

No popup, em **Registrar Processo**, um único botão liga e desliga a gravação:

- **Iniciar registro**: zera o log e começa a registrar, em ordem cronológica: cada tela aberta no TASY, cliques em botões/links e valores preenchidos em campos (exceto campos de senha). Internamente também mede cada requisição real (fetch/XHR) e a latência de rede, usados só para detectar oscilação/lentidão — essas linhas não entram no texto copiado, que fica focado no passo a passo.
- Execute normalmente o processo que quer documentar (ex.: criar um usuário).
- **Parar registro**: tira um **print final da tela como ela está no momento em que você para** (adicionado como passo "🏁 Fim do registro" — cobre o resultado do processo, que nenhum clique captura), copia para a área de transferência um resumo legível de tudo que aconteceu na aba ativa, e baixa um relatório `.html` com o mesmo passo a passo, incluindo um print da tela a cada passo — pronto para anexar num chamado de suporte (ex.: Philips). Exemplo do texto copiado:
  ```
  [14:32:10] 🖥️ Tela aberta: Cadastro de Usuários
  [14:32:12] ⌨️ Preencheu "Código": 12345
  [14:32:15] 🖱️ Clicou em: Salvar
  [14:32:16] ⚠️ oscillating — extreme_jitter (latência: 1850ms)
  ```
- **Atenção**: como o registro guarda os valores digitados nos campos e um print de cada passo, revise o texto/arquivo antes de compartilhar caso o processo documentado envolva dados sensíveis (ex.: dados de paciente, inclusive de terceiros que apareçam incidentalmente na tela).

### Capturar erros

Em **Capturar erros**, marque "Capturar e explicar erros do TASY" e deixe ligado. Quando o TASY exibe o diálogo *"Houve um erro na execução da aplicação"*, a extensão:

- lê o arquivo de erro correspondente no console do **app server** (`wheb_arquivo.jsp`, no mesmo domínio, com a sessão que o navegador já tem — a senha do app server nunca é manipulada);
- extrai a exceção, `Interface`/`Action`, parâmetros e o ponto do código que falhou;
- puxa as consultas SQL que rodaram no processo (valores reais + tabelas), já que o "Nome de coluna inválido" do Oracle não informa a coluna;
- monta uma explicação em português (o que aconteceu, em qual processo, causa provável, o que verificar) num painel na tela com botão **Copiar relatório**.

Se o mesmo erro (tipo + tela + processo + parâmetro-chave) já ocorreu hoje, o relatório e a lista avisam (`⚠ Este erro já aconteceu: 3× hoje` / `· ×3 hoje`), para separar recorrência de caso pontual.

Os erros ficam listados no popup — **Baixar relatório** gera um `.html` com todos; clicar num item copia só ele. O campo **URL do app server** fica em branco por padrão (usa `‹domínio atual›/TasyAppServer/`); preencha só se o app server estiver em outro host/porta. **Testar acesso** confirma se a extensão consegue ler o console.

### Explorador do app server

Em **Explorador do app server**, clique em **Atualizar lista** (com o TASY logado na aba ativa) para ver os arquivos de trace recentes do seu usuário (`SQL_*`, `PROCEDURE_*`, `ERRO_*`), com tempo de execução e hora. Filtre por nome, clique num item para ver o conteúdo (a consulta SQL já com os valores reais, ou o texto do erro) e use **Copiar conteúdo**. Reaproveita a leitura do console do app server da captura de erros — mesma sessão, mesma URL base.

### Servidor / nó do app server

Em ambientes com vários nós, a extensão lê o cookie `JSESSIONID` (cujo valor no Wheb é `tasy-tasyappserver-…_<nó>~…`) e mostra o **número do servidor** (ex.: `1114`) — no popup, no relatório de erro e, junto com a etiqueta de **Cores por ambiente**, na forma `HML · nó 1114`. Só o número do nó é lido; o restante da sessão, não.

### Gerar chamado

Em **Gerar chamado**, o botão **Gerar texto** monta o texto de um chamado com ambiente, nó do app server, versão do TASY, função/tela atual, os passos gravados no **Registrar Processo** e o último erro capturado. Preencha "esperado" e "obtido", ajuste na caixa e clique em **Copiar**.

### Cores por ambiente

Em **Cores por ambiente**, cadastre regras como "domínio contém `hml` → laranja, rótulo Homologação". Quando o hostname da aba bate com uma regra, a extensão mostra uma borda colorida ao redor da tela e uma etiqueta arrastável — assim fica visualmente óbvio se você está em produção, homologação, desenvolvimento etc.

A caixa **"Mostrar o estabelecimento logado na etiqueta"** acrescenta o estabelecimento (matriz/filial) à etiqueta — ex.: `Homologação · Filial 2 · nó 1114` —, lido do rodapé/sessão do próprio TASY. Útil em instalações multi-estabelecimento; sem regra de cor para o domínio, mostra uma etiqueta cinza só com o estabelecimento. O estabelecimento também entra no relatório de erro e no texto do chamado.

### Metadados TASY

Cada opção liga/desliga independentemente pelo popup, em **Metadados TASY** (a caixa **Ativar todos** liga/desliga as sete de uma vez):

- **Detalhes de campo**: mostra, acima de cada campo de formulário, o nome técnico da coluna (ex.: `CD_RELATORIO`, `DS_TITULO`).
- **Detalhes de grid**: mostra o nome técnico da coluna no cabeçalho de cada grid (SlickGrid).
- **Detalhes de painel**: mostra código/tipo, view e tabela do painel atual (ex.: `WDBPANEL 1038025`, `VIEW 96218`, `RELATORIO`).
- **Recentes (tela inicial)**: painel lateral na tela inicial do TASY com as últimas telas abertas, para acesso rápido (clique para abrir, "×" para remover).
- **Idioma do usuário no rodapé**: mostra o idioma da sessão atual ao lado da data no rodapé.
- **Modo inspeção**: exibe um botão "Inspecionar" fixo na tela; ao clicar em qualquer elemento, abre uma janela com **Contexto da função** (função aberta, painel/view/tabela, parâmetros encontrados no escopo e regras detectadas — cor/visibilidade) e, abaixo, o escopo AngularJS completo.
- **Waterfall de rede**: painel arrastável (canto inferior direito) com as últimas ~15 requisições reais da página numa linha do tempo (método + endereço, barra proporcional à duração, ms); lentas em laranja, com erro em vermelho; clique numa linha para copiar o endereço.
- **Layout visual (relatórios)** *(experimental)*: quando a grade atual tem as colunas Esquerda/Topo/Tamanho/Altura (editor de bandas/campos de relatório do TASY), mostra um botão "📐 Layout visual" que abre um canvas com os campos já cadastrados nas posições reais. Tanto o botão quanto o canvas podem ser arrastados para qualquer ponto da tela (segure pelo cabeçalho do canvas). Arraste um novo campo (`+ Novo campo`) até a posição desejada e clique em **Copiar** para levar Esquerda/Topo/Tamanho/Altura prontos para colar na grade. É somente leitura: a extensão nunca escreve na grade do TASY, e só lê as linhas atualmente renderizadas na tela (role a grade se o campo de referência não estiver visível).

Clicar em qualquer badge/label copia o valor para a área de transferência. Os botões **Limpar recentes** e **Recarregar estilos** ficam junto das opções de metadados.

## Pré-requisitos

- Google Chrome (ou Chromium compatível com MV3).
- Um ambiente TASY acessível pelo navegador.

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions`.
2. Ative **Developer mode**.
3. Clique em **Load unpacked**.
4. Selecione a pasta deste projeto: `tasy_ext`.

## Como usar

1. Abra a tela do TASY que quer inspecionar.
2. Clique no ícone da extensão.
3. Marque as opções desejadas em **Metadados TASY**.
4. Acompanhe o log de performance em **Monitoramento de desempenho**.

## Arquivos

- `manifest.json`: permissões (`tabs`, `storage`, `scripting`, `cookies`), ícone da extensão, `background` e `content_scripts`.
- `popup.html` / `popup.css` / `popup.js`: interface do popup (dicionário de dados, opções de metadados com "ativar todos", registro de processo, captura de erros, servidor/nó, gerador de chamado e explorador do app server).
- `manual.html`: página de ajuda com a explicação de todas as funcionalidades, aberta pelo link "📖 Manual" no popup.
- `background.js`: log de performance/trace (incluindo captura de screenshots), recarga de estilos, leitura do console do app server (`wheb_arquivo.jsp`) e do nó do app server (cookie de afinidade).
- `content.js`: monitor de latência, ponte de `chrome.storage` com o script de metadados, e a captura/interpretação de erros do TASY.
- `metadata-injected.js`: roda no contexto da própria página TASY (`world: "MAIN"`) para ler o AngularJS/DOM e renderizar os overlays de metadados.
- `metadata.css`: estilos dos overlays de metadados (campos, grid, painel, recentes, inspeção).

## Publicando na Chrome Web Store

Este repositório está pronto para ser carregado como extensão descompactada, mas publicá-lo na Chrome Web Store exige algumas etapas que só o dono da conta pode fazer:

1. Criar uma conta de desenvolvedor em https://chrome.google.com/webstore/devconsole (taxa única de US$5, caso ainda não tenha).
2. Gerar um pacote `.zip` da pasta do projeto (sem a pasta `.git`, sem `PRIVACY.md`/`README.md`).
3. Preencher a ficha da loja: nome, descrição curta/longa, categoria, e pelo menos uma screenshot (1280×800 ou 640×400).
4. Publicar/hospedar o arquivo `PRIVACY.md` deste repositório (ex.: GitHub Pages ou raw do GitHub) e informar a URL na ficha da loja — obrigatório porque a extensão pede acesso a todos os sites.
5. Justificar, no formulário de permissões da Web Store, por que cada permissão (`tabs`, `storage`, `scripting`, `cookies`, host permissions) é necessária (veja `PRIVACY.md` para o texto-base). A permissão `cookies` é usada só para ler o identificador do nó do app server a partir do cookie de afinidade, em domínios com "tasy" no hostname.
6. Submeter para revisão. Extensões com permissões amplas (`http://*/*`, `https://*/*`) costumam levar mais tempo na revisão do Google.

## Observações

- Se algum dos overlays de metadados não aparecer, confira se a opção correspondente está marcada no popup.
- Se o painel "Recentes" estiver vazio, abra pelo menos uma tela pela grade de ícones do TASY para começar a popular o histórico.
