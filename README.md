# TASY Cookie Switcher (Chrome Extension)

Extensão Chrome (Manifest V3) para ler e alterar o cookie `TASYAPPSERVER_TASY`.

## O que faz

- Permite configurar domínio fixo (ou usar a aba ativa).
- Presets prontos: `tasy.circulosaude.com.br` e `tasyhml.circulosaude.com.br`.
- Flag opcional para mostrar, no canto da tela do TASY, um badge com o servidor detectado (ex.: `_512` => `512`).
- Permite escolher o canto do badge: superior direito/esquerdo ou inferior direito/esquerdo.
- Lê o valor atual de `TASYAPPSERVER_TASY`.
- Permite informar um novo valor e salvar no mesmo cookie.
- Após salvar o cookie, faz recarga forçada da aba ativa (equivalente ao `Ctrl+Shift+R`).

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
6. Clique em **Ler cookie** (ou aguarde leitura automática).
7. Edite o campo **Novo valor**.
8. Clique em **Salvar**.
9. A aba ativa é recarregada automaticamente sem cache.

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
- Após salvar, recarregue a página do TASY para aplicar o novo valor de sessão, se necessário.
