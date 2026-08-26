# Política de Privacidade — Tasy DevTools

Última atualização: 2026-08-26

Tasy DevTools é uma extensão para Google Chrome voltada a desenvolvedores e times de suporte que trabalham com o sistema TASY. Esta página explica quais dados a extensão acessa, como são usados e armazenados.

## Resumo

- A extensão **não envia nenhum dado para servidores externos**. Nenhuma informação coletada é transmitida para o desenvolvedor da extensão ou para terceiros.
- Todo o processamento acontece localmente, no navegador do usuário.
- Todos os dados que a extensão armazena ficam em `chrome.storage.local`, isolados no seu próprio perfil do Chrome, e podem ser apagados a qualquer momento removendo a extensão ou usando os botões "Limpar recentes" / "Limpar log" no popup.

## Dados acessados e por quê

| Dado | Por quê | Onde fica |
|---|---|---|
| URL e tempo de resposta de uma sondagem HTTP (`/favicon.ico?__tasy_probe=...`) contra a própria aba TASY | Medir latência/oscilação de rede para o log de performance | `chrome.storage.local` (campo `performanceTraceLog`), local ao navegador |
| Nomes técnicos de campos, colunas de grid, código/tabela de painéis e itens de menu recentes, lidos do DOM/AngularJS da página TASY | Exibir os overlays de metadados e a lista de "Recentes" | `chrome.storage.local` (`recentFeatures`) e repassados via mensagens internas da extensão; nunca saem do navegador |
| Configurações da extensão (quais overlays estão ativos) | Lembrar as preferências do usuário entre sessões | `chrome.storage.local` |

Nenhum desses dados inclui, por si só, informações de pacientes ou dados de saúde — a extensão não lê o conteúdo clínico das telas do TASY, apenas nomes técnicos de campos/colunas e metadados estruturais das telas, além de métricas de latência de rede.

## Permissões solicitadas

- **tabs**: necessária para identificar a aba ativa (usada para filtrar o log de performance copiado e para a função "Recarregar estilos").
- **storage**: necessária para guardar as preferências do usuário e o log de performance localmente.
- **scripting**: necessária para a função "Recarregar estilos" (força o navegador a buscar novamente os arquivos CSS da página sem recarregá-la por completo).
- **Acesso a todos os sites (`http://*/*`, `https://*/*`)**: a extensão precisa rodar em qualquer domínio que o usuário configure como seu ambiente TASY, que varia de empresa para empresa. Na prática, a extensão só ativa suas funcionalidades em páginas cujo hostname contenha "tasy"; em qualquer outro site ela permanece inativa.

## Contato

Dúvidas sobre esta política podem ser abertas como issue no repositório do projeto.
