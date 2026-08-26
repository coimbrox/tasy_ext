# Tasy DevTools (Chrome Extension)

Extensão Chrome (Manifest V3) para desenvolvedores e times de suporte do TASY: monitora oscilações de desempenho e exibe metadados técnicos das telas (nos moldes da Tasy Metadata Extension).

Funciona em qualquer ambiente TASY cujo domínio contenha "tasy" no hostname (ex.: `tasy.suaempresa.com.br`, `tasyhml.suaempresa.com.br`, `dev.tasy.suaempresa.com.br`) — não é necessário configurar nada, ela ativa suas funcionalidades automaticamente nesses domínios.

## O que faz

### Trace de processo

No popup, em **Trace de processo**, um único botão liga e desliga a gravação:

- **Ativar trace**: zera o log e começa a registrar, em ordem cronológica: cada tela aberta no TASY, cliques em botões/links e valores preenchidos em campos (exceto campos de senha). Internamente também mede cada requisição real (fetch/XHR) e a latência de rede, usados só para detectar oscilação/lentidão — essas linhas não entram no texto copiado, que fica focado no passo a passo.
- Execute normalmente o processo que quer documentar (ex.: criar um usuário).
- **Desativar trace**: para a gravação e copia automaticamente para a área de transferência um resumo legível de tudo que aconteceu na aba ativa, por exemplo:
  ```
  [14:32:10] 🖥️ Tela aberta: Cadastro de Usuários
  [14:32:12] ⌨️ Preencheu "Código (CD_USUARIO)": 12345
  [14:32:15] 🖱️ Clicou em: Salvar
  [14:32:16] ⚠️ oscillating — extreme_jitter (latência: 1850ms)
  ```
  Pronto para colar direto numa instrução de processo ou num chamado de suporte.
- **Atenção**: como o trace registra os valores digitados nos campos, revise o texto copiado antes de compartilhar caso o processo documentado envolva dados sensíveis (ex.: dados de paciente).

### Metadados TASY

Cada opção liga/desliga independentemente pelo popup, em **Metadados TASY**:

- **Detalhes de campo**: mostra, acima de cada campo de formulário, o nome técnico da coluna (ex.: `CD_RELATORIO`, `DS_TITULO`).
- **Detalhes de grid**: mostra o nome técnico da coluna no cabeçalho de cada grid (SlickGrid).
- **Detalhes de painel**: mostra código/tipo, view e tabela do painel atual (ex.: `WDBPANEL 1038025`, `VIEW 96218`, `RELATORIO`).
- **Recentes (tela inicial)**: painel lateral na tela inicial do TASY com as últimas telas abertas, para acesso rápido (clique para abrir, "×" para remover).
- **Idioma do usuário no rodapé**: mostra o idioma da sessão atual ao lado da data no rodapé.
- **Modo inspeção**: exibe um botão "Inspecionar" fixo na tela; ao clicar em qualquer elemento, abre uma janela com o escopo AngularJS daquele elemento (dados técnicos brutos).
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

- `manifest.json`: permissões (`tabs`, `storage`, `scripting`), ícone da extensão, `background` e `content_scripts`.
- `popup.html` / `popup.css` / `popup.js`: interface do popup (opções de metadados e tracer).
- `background.js`: tracer de performance e recarga de estilos.
- `content.js`: monitor de latência e ponte de `chrome.storage` com o script de metadados.
- `metadata-injected.js`: roda no contexto da própria página TASY (`world: "MAIN"`) para ler o AngularJS/DOM e renderizar os overlays de metadados.
- `metadata.css`: estilos dos overlays de metadados (campos, grid, painel, recentes, inspeção).

## Publicando na Chrome Web Store

Este repositório está pronto para ser carregado como extensão descompactada, mas publicá-lo na Chrome Web Store exige algumas etapas que só o dono da conta pode fazer:

1. Criar uma conta de desenvolvedor em https://chrome.google.com/webstore/devconsole (taxa única de US$5, caso ainda não tenha).
2. Gerar um pacote `.zip` da pasta do projeto (sem a pasta `.git`, sem `PRIVACY.md`/`README.md`).
3. Preencher a ficha da loja: nome, descrição curta/longa, categoria, e pelo menos uma screenshot (1280×800 ou 640×400).
4. Publicar/hospedar o arquivo `PRIVACY.md` deste repositório (ex.: GitHub Pages ou raw do GitHub) e informar a URL na ficha da loja — obrigatório porque a extensão pede acesso a todos os sites.
5. Justificar, no formulário de permissões da Web Store, por que cada permissão (`tabs`, `storage`, `scripting`, host permissions) é necessária (veja `PRIVACY.md` para o texto-base).
6. Submeter para revisão. Extensões com permissões amplas (`http://*/*`, `https://*/*`) costumam levar mais tempo na revisão do Google.

## Observações

- Se algum dos overlays de metadados não aparecer, confira se a opção correspondente está marcada no popup.
- Se o painel "Recentes" estiver vazio, abra pelo menos uma tela pela grade de ícones do TASY para começar a popular o histórico.
