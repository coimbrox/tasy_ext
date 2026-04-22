# TASY Cookie Switcher (Chrome Extension)

Extensão Chrome (Manifest V3) para ler e alterar o cookie `TASYAPPSERVER_TASY`.

## O que faz

- Permite configurar domínio fixo (ou usar a aba ativa).
- Presets prontos: `tasy.circulosaude.com.br` e `tasyhml.circulosaude.com.br`.
- Flag opcional para mostrar, no canto da tela do TASY, um badge com o servidor detectado (ex.: `_512` => `512`).
- A badge só aparece em abas TASY (hostname contendo `tasy`).
- Permite escolher o canto do badge: superior direito/esquerdo ou inferior direito/esquerdo.
- Permite arrastar o badge com o mouse para qualquer ponto da tela (posição persistida).
- Badge muda de cor automaticamente quando detecta oscilação/lentidão de resposta.
- Tracer de performance com log de latência, jitter, status e motivo da lentidão/oscilação.
- Lê o valor atual de `TASYAPPSERVER_TASY`.
- Permite informar um novo valor e salvar no mesmo cookie.
- Ao salvar o cookie, executa recarga forçada antes e depois da troca (equivalente a `Ctrl+Shift+R` duas vezes).

## Pré-requisitos

- Google Chrome (ou Chromium compatível com MV3).
- O site TASY deve permitir acesso ao cookie pela API `chrome.cookies`.
- O cookie não pode estar protegido por políticas que bloqueiem sobrescrita.

## Instalação (modo desenvolvedor)

1. Abra `chrome://extensions`.
2. Ative **Developer mode**.
3. Clique em **Load unpacked**.
4. Selecione a pasta deste projeto: `tasy_ext`.

## Como usar

1. Clique no ícone da extensão.
2. Em **Domínio configurado**, escolha:
	- **Usar aba ativa**, ou
	- `tasy.circulosaude.com.br`, ou
	- `tasyhml.circulosaude.com.br`, ou
	- **Outro domínio...** para digitar manualmente.
3. Clique em **Salvar domínio**.
4. (Opcional) Marque **Mostrar servidor no canto da tela**.
5. Em **Posição do badge**, escolha o canto desejado.
6. Se preferir, arraste o badge na página para posição livre.
7. Clique em **Ler cookie** (ou aguarde leitura automática).
8. Edite o campo **Novo valor**.
9. Clique em **Salvar**.
10. A extensão faz recarga forçada, atualiza o cookie existente e faz nova recarga forçada.
11. Em **Tracer de performance**, use **Copiar log** para levar o histórico de diagnóstico e **Limpar log** para zerar a coleta.

## Arquivos

- `manifest.json`: permissões (`cookies`, `tabs`, `storage`), ícone da extensão, `background` e `content_scripts`.
- `popup.html`: interface do popup.
- `popup.css`: estilos do popup.
- `popup.js`: lógica de leitura/gravação do cookie.
- `background.js`: leitura do cookie e sincronização do badge com as abas.
- `content.js`: renderização do badge fixo na página.

## Observações

- Se usar **Usar aba ativa** fora de uma aba HTTP/HTTPS, a extensão mostra erro de contexto.
- Se o cookie não existir para a URL/path atual, a extensão informa no status.
- Com a flag ativa, o badge aparece no canto inferior direito da tela da página.
- A posição do badge segue a opção selecionada no popup.
- Ao arrastar o badge, a posição livre passa a valer; ao trocar o canto no popup, volta ao modo por canto.
- Cores da badge: azul (normal), laranja (oscilação), vermelho (lento).
- O tracer registra `status` e `reason` (ex.: `high_average_latency`, `extreme_jitter`, `probe_timeout_or_network_error`).
- Após salvar, recarregue a página do TASY para aplicar o novo valor de sessão, se necessário.
