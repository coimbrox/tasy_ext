# Tasy DevTools (Chrome Extension)

Extensão Chrome (Manifest V3) para desenvolvedores e times de suporte do TASY: monitora oscilações de desempenho e exibe metadados técnicos das telas (nos moldes da Tasy Metadata Extension).

Funciona em qualquer ambiente TASY cujo domínio contenha "tasy" no hostname (ex.: `tasy.suaempresa.com.br`, `tasyhml.suaempresa.com.br`, `dev.tasy.suaempresa.com.br`) — não é necessário configurar nada, ela ativa suas funcionalidades automaticamente nesses domínios.

## O que faz

### Monitoramento de desempenho

- Faz uma sondagem de latência periódica (a cada ~8s) contra a própria origem da aba TASY.
- Classifica o estado como normal, oscilando ou lento, com base em média, pico e jitter das últimas amostras.
- Mantém um log local (`Tracer de performance`) com status, motivo (ex.: `high_average_latency`, `extreme_jitter`, `probe_timeout_or_network_error`) e métricas de cada evento relevante.
- No popup, use **Copiar log** para levar o histórico da aba ativa e **Limpar log** para zerar a coleta.

### Metadados TASY

Cada opção liga/desliga independentemente pelo popup, em **Metadados TASY**:

- **Detalhes de campo**: mostra, acima de cada campo de formulário, o nome técnico da coluna (ex.: `CD_RELATORIO`, `DS_TITULO`).
- **Detalhes de grid**: mostra o nome técnico da coluna no cabeçalho de cada grid (SlickGrid).
- **Detalhes de painel**: mostra código/tipo, view e tabela do painel atual (ex.: `WDBPANEL 1038025`, `VIEW 96218`, `RELATORIO`).
- **Recentes (tela inicial)**: painel lateral na tela inicial do TASY com as últimas telas abertas, para acesso rápido (clique para abrir, "×" para remover).
- **Idioma do usuário no rodapé**: mostra o idioma da sessão atual ao lado da data no rodapé.
- **Modo inspeção**: exibe um botão "Inspecionar" fixo na tela; ao clicar em qualquer elemento, abre uma janela com o escopo AngularJS daquele elemento (dados técnicos brutos).

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
