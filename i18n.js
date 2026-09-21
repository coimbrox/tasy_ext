/*
 * Minimal, dependency-free i18n for the fixed UI chrome (popup + the badges/
 * panels/buttons the content scripts inject into the TASY page). This does
 * NOT translate generated diagnostic content (error causes/checks, function
 * context tips) or the manual - only buttons, labels, section titles, status
 * messages and similar interface text. Language choice lives in
 * chrome.storage.local under "language" ("pt" | "en", default "pt") and is
 * relayed to every context (popup, isolated content script, MAIN-world
 * script) the same way other options are.
 *
 * Loaded as a plain global (window.TasyI18n) in three separate script
 * realms (popup.html, content.js's isolated world, metadata-injected.js's
 * MAIN world) - each realm gets its own independent copy, which is fine
 * since they all read the same stored language value.
 */
(function (root) {
  const STRINGS = {
    // --- Popup: header / sections -------------------------------------------
    popup_manual_link: { pt: "📖 Manual", en: "📖 Manual" },
    popup_manual_title: { pt: "Ver manual da extensão", en: "View extension manual" },
    section_dictionary: { pt: "Dicionário de dados", en: "Data dictionary" },
    dictionary_search_placeholder: { pt: "Buscar campo, coluna ou tabela...", en: "Search field, column or table..." },
    section_metadata: { pt: "Metadados TASY", en: "TASY metadata" },
    toggle_all: { pt: "Ativar todos", en: "Enable all" },
    opt_field_details: { pt: "Detalhes de campo", en: "Field details" },
    opt_grid_details: { pt: "Detalhes de grid", en: "Grid details" },
    opt_panel_details: { pt: "Detalhes de painel", en: "Panel details" },
    opt_recent_features: { pt: "Recentes (tela inicial)", en: "Recent (home screen)" },
    opt_user_locale: { pt: "Idioma do usuário no rodapé", en: "User language in the footer" },
    opt_inspect_mode: { pt: "Modo inspeção", en: "Inspect mode" },
    opt_report_layout: { pt: "Layout visual (relatórios)", en: "Visual layout (reports)" },
    opt_waterfall: { pt: "Waterfall de rede", en: "Network waterfall" },
    opt_menu_filter: { pt: "Filtro nos menus (Perfil/Setor)", en: "Filter in menus (Profile/Sector)" },
    menu_filter_placeholder: { pt: "Filtrar...", en: "Filter..." },
    btn_clear_recent: { pt: "Limpar recentes", en: "Clear recent" },
    btn_reload_styles: { pt: "Recarregar estilos", en: "Reload styles" },

    section_env_colors: { pt: "Cores por ambiente", en: "Colors by environment" },
    env_hint: {
      pt: "Identifique visualmente em qual ambiente você está: quando o domínio da aba contém o texto abaixo, a extensão mostra uma borda e uma etiqueta na cor escolhida.",
      en: "Visually identify which environment you're in: when the tab's domain contains the text below, the extension shows a border and a label in the chosen color."
    },
    btn_add_env_rule: { pt: "+ Adicionar regra", en: "+ Add rule" },
    opt_show_establishment: {
      pt: "Mostrar o estabelecimento logado na etiqueta (matriz/filial)",
      en: "Show the logged-in establishment on the label (headquarters/branch)"
    },
    establishment_hint: {
      pt: "Útil em instalações multi-estabelecimento. Se não houver regra de cor para o domínio, mostra uma etiqueta cinza só com o estabelecimento.",
      en: "Useful for multi-establishment installs. If there's no color rule for the domain, shows a gray label with just the establishment."
    },

    section_register_process: { pt: "Registrar Processo", en: "Record Process" },
    register_hint: {
      pt: 'Inicie antes de executar o processo que quer documentar (ex.: criar um usuário). Ao parar, o passo a passo é copiado automaticamente e um relatório em HTML (com prints de cada passo) é baixado — pronto para anexar num chamado.',
      en: "Start it before running the process you want to document (e.g. creating a user). When you stop, the step-by-step is copied automatically and an HTML report (with a screenshot of each step) is downloaded — ready to attach to a ticket."
    },
    btn_start_recording: { pt: "Iniciar registro", en: "Start recording" },
    btn_stop_recording: { pt: "Parar registro", en: "Stop recording" },

    section_capture_errors: { pt: "Capturar erros", en: "Capture errors" },
    capture_errors_hint: {
      pt: 'Ligue e esqueça. Quando o TASY mostrar "Houve um erro na execução da aplicação", a extensão lê o detalhe no app server, explica em linguagem simples o que aconteceu e em qual processo, e mostra um botão "Copiar relatório" pronto pro chamado.',
      en: 'Turn it on and forget it. When TASY shows "Houve um erro na execução da aplicação", the extension reads the detail on the app server, explains in plain language what happened and in which process, and shows a "Copy report" button ready for the ticket.'
    },
    opt_capture_errors: { pt: "Capturar e explicar erros do TASY", en: "Capture and explain TASY errors" },
    appserver_url_placeholder: { pt: "URL do app server (vazio = automático)", en: "App server URL (empty = automatic)" },
    btn_test_access: { pt: "Testar acesso", en: "Test access" },
    btn_download_report: { pt: "Baixar relatório", en: "Download report" },
    btn_clear: { pt: "Limpar", en: "Clear" },

    section_generate_ticket: { pt: "Gerar chamado", en: "Generate ticket" },
    ticket_hint: {
      pt: "Monta o texto do chamado com ambiente, servidor, versão, função, passos (do Registrar Processo) e o último erro capturado. Edite e copie.",
      en: "Builds the ticket text with environment, server, version, function, steps (from Record Process) and the last captured error. Edit and copy."
    },
    ticket_expected_placeholder: { pt: "O que deveria acontecer (esperado)", en: "What should happen (expected)" },
    ticket_obtained_placeholder: { pt: "O que aconteceu (obtido)", en: "What happened (actual)" },
    btn_generate_text: { pt: "Gerar texto", en: "Generate text" },
    btn_copy: { pt: "Copiar", en: "Copy" },
    ticket_output_placeholder: { pt: "O texto do chamado aparece aqui.", en: "The ticket text appears here." },

    section_explorer: { pt: "Explorador do app server", en: "App server explorer" },
    explorer_hint: {
      pt: "Lista os arquivos de trace recentes do seu usuário no app server (consultas SQL, procedures e erros). Clique num item para ver o conteúdo e copiar.",
      en: "Lists your user's recent trace files on the app server (SQL queries, procedures and errors). Click an item to see the content and copy it."
    },
    btn_refresh_list: { pt: "Atualizar lista", en: "Refresh list" },
    explorer_filter_placeholder: { pt: "Filtrar por nome (ex.: PERFIL, GERAR, ERRO)", en: "Filter by name (e.g. PERFIL, GERAR, ERRO)" },
    explorer_detail_placeholder: { pt: "Conteúdo do arquivo selecionado.", en: "Content of the selected file." },
    btn_copy_content: { pt: "Copiar conteúdo", en: "Copy content" },

    footer_support: { pt: "☕ Apoie o projeto", en: "☕ Support the project" },
    footer_contact: { pt: "💬 Sugestões e contato", en: "💬 Suggestions and contact" },

    lang_toggle_title: { pt: "Idioma da extensão", en: "Extension language" },

    // --- Popup: dynamic ------------------------------------------------------
    env_rule_match_placeholder: { pt: "ex: hml", en: "e.g. hml" },
    env_rule_label_placeholder: { pt: "ex: Homologação", en: "e.g. Staging" },
    env_rule_remove_title: { pt: "Remover regra", en: "Remove rule" },
    dict_kind_field: { pt: "Campo", en: "Field" },
    dict_kind_grid_column: { pt: "Coluna de grid", en: "Grid column" },
    dict_kind_panel: { pt: "Painel", en: "Panel" },
    dict_view_prefix: { pt: "view {{name}}", en: "view {{name}}" },
    dict_copied: { pt: '"{{name}}" copiado.', en: '"{{name}}" copied.' },

    status_clearing_recent: { pt: "Limpando recentes...", en: "Clearing recent..." },
    status_recent_cleared: { pt: "Lista de recentes limpa.", en: "Recent list cleared." },
    status_recent_clear_failed: { pt: "Falha ao limpar recentes: {{msg}}", en: "Failed to clear recent: {{msg}}" },
    status_reloading_styles: { pt: "Recarregando estilos...", en: "Reloading styles..." },
    status_no_active_tab: { pt: "Não foi possível identificar a aba ativa.", en: "Couldn't identify the active tab." },
    status_styles_reloaded: { pt: "Estilos recarregados.", en: "Styles reloaded." },
    status_reload_failed: { pt: "Falha ao recarregar estilos: {{msg}}", en: "Failed to reload styles: {{msg}}" },

    status_recording_started: {
      pt: "Registro iniciado. Execute o processo no TASY normalmente.",
      en: "Recording started. Run the process in TASY normally."
    },
    status_finishing_recording: { pt: "Finalizando registro...", en: "Finishing recording..." },
    status_no_active_tab_copy: {
      pt: "Não foi possível identificar a aba ativa para copiar o registro.",
      en: "Couldn't identify the active tab to copy the recording."
    },
    status_recording_empty: { pt: "Registro finalizado. Nenhum evento foi registrado.", en: "Recording finished. No event was recorded." },
    status_recording_empty_relevant: {
      pt: "Registro finalizado. Nenhum evento relevante foi registrado.",
      en: "Recording finished. No relevant event was recorded."
    },
    status_recording_done: {
      pt: "Registro copiado e relatório baixado ({{count}} evento(s)).",
      en: "Recording copied and report downloaded ({{count}} event(s))."
    },
    status_recording_copy_failed: { pt: "Falha ao copiar registro: {{msg}}", en: "Failed to copy recording: {{msg}}" },

    status_testing_access: { pt: "Testando acesso ao app server...", en: "Testing app server access..." },
    status_open_tasy_or_url: {
      pt: "Abra o TASY na aba ativa ou preencha a URL do app server.",
      en: "Open TASY in the active tab or fill in the app server URL."
    },
    status_access_ok: { pt: "Acesso OK: {{base}}", en: "Access OK: {{base}}" },
    status_needs_login: {
      pt: "Precisa de login: abra o console do app server uma vez no navegador.",
      en: "Needs login: open the app server console once in the browser."
    },
    status_no_access: { pt: "Sem acesso a {{base}} — confira a URL.", en: "No access to {{base}} — check the URL." },
    status_test_failed: { pt: "Falha no teste: {{msg}}", en: "Test failed: {{msg}}" },

    error_report_copied: { pt: "Relatório do erro copiado.", en: "Error report copied." },
    status_no_errors_export: { pt: "Nenhum erro capturado para exportar.", en: "No error captured to export." },
    status_errors_downloaded: { pt: "Relatório de erros baixado ({{count}}).", en: "Error report downloaded ({{count}})." },
    status_errors_cleared: { pt: "Erros capturados apagados.", en: "Captured errors cleared." },
    no_errors_yet: { pt: "Nenhum erro capturado ainda.", en: "No error captured yet." },
    error_fallback_label: { pt: "Erro", en: "Error" },

    server_node_known: { pt: "Servidor atual: nó {{node}}  (cookie {{name}})", en: "Current server: node {{node}}  (cookie {{name}})" },
    server_node_unknown: { pt: "Servidor atual: nó não identificado nesta aba.", en: "Current server: node not identified on this tab." },

    status_building_ticket: { pt: "Montando texto do chamado...", en: "Building ticket text..." },
    status_ticket_generated: { pt: "Texto do chamado gerado. Revise e copie.", en: "Ticket text generated. Review and copy." },
    status_generate_first: { pt: "Gere o texto primeiro.", en: "Generate the text first." },
    status_ticket_copied: { pt: "Texto do chamado copiado.", en: "Ticket text copied." },
    status_copy_failed: { pt: "Falha ao copiar: {{msg}}", en: "Failed to copy: {{msg}}" },

    explorer_no_match_filter: { pt: "Nenhum arquivo bate com o filtro.", en: "No file matches the filter." },
    explorer_click_refresh: { pt: 'Clique em "Atualizar lista".', en: 'Click "Refresh list".' },
    explorer_loading: { pt: "Carregando...", en: "Loading..." },
    explorer_open_failed: { pt: "Não foi possível abrir o arquivo.", en: "Couldn't open the file." },
    explorer_error_prefix: { pt: "Erro: {{msg}}", en: "Error: {{msg}}" },
    status_reading_appserver: { pt: "Lendo o app server...", en: "Reading the app server..." },
    explorer_open_tasy_or_url: {
      pt: 'Abra o TASY na aba ativa (ou preencha a URL do app server em "Capturar erros").',
      en: 'Open TASY in the active tab (or fill in the app server URL in "Capture errors").'
    },
    explorer_no_user: {
      pt: "Não identifiquei seu usuário — verifique se está logado no TASY nesta aba.",
      en: "Couldn't identify your user — check that you're logged into TASY on this tab."
    },
    explorer_needs_login: { pt: "Precisa de login no console do app server.", en: "Needs login on the app server console." },
    explorer_no_access: { pt: "Sem acesso ao app server.", en: "No access to the app server." },
    status_explorer_files: { pt: "Explorador: {{count}} arquivo(s) de {{user}}.", en: "Explorer: {{count}} file(s) from {{user}}." },
    status_select_file_first: { pt: "Selecione um arquivo primeiro.", en: "Select a file first." },
    status_content_copied: { pt: "Conteúdo copiado.", en: "Content copied." },

    // --- Injected UI (content.js / metadata-injected.js) ---------------------
    err_captured_prefix: { pt: "Erro capturado", en: "Error captured" },
    err_repeat_suffix: { pt: "  (×{{count}} hoje)", en: "  (×{{count}} today)" },
    btn_copy_report: { pt: "Copiar relatório", en: "Copy report" },
    btn_copied: { pt: "Copiado!", en: "Copied!" },

    inspect_btn: { pt: "Inspecionar", en: "Inspect" },
    inspect_btn_cancel: { pt: "Cancelar", en: "Cancel" },
    scope_full_label: { pt: "escopo AngularJS completo", en: "full AngularJS scope" },
    scope_not_found: { pt: "Nenhum escopo AngularJS encontrado neste elemento.", en: "No AngularJS scope found on this element." },
    scope_serialize_failed: { pt: "Não foi possível serializar o escopo deste elemento.", en: "Couldn't serialize this element's scope." },

    layout_panel_title: { pt: "Layout visual (somente leitura das posições existentes)", en: "Visual layout (read-only, existing positions)" },
    layout_add_field: { pt: "+ Novo campo", en: "+ New field" },
    layout_new_field_label: { pt: "Novo campo", en: "New field" },
    layout_info_line: {
      pt: "Esquerda {{left}} · Topo {{top}} · Tamanho {{width}} · Altura {{height}}",
      en: "Left {{left}} · Top {{top}} · Width {{width}} · Height {{height}}"
    },
    layout_copy_text: {
      pt: "Esquerda: {{left}}\nTopo: {{top}}\nTamanho: {{width}}\nAltura: {{height}}",
      en: "Left: {{left}}\nTop: {{top}}\nWidth: {{width}}\nHeight: {{height}}"
    },
    layout_visual_btn: { pt: "📐 Layout visual", en: "📐 Visual layout" },

    waterfall_header: { pt: "Rede — últimas chamadas", en: "Network — recent calls" },
    waterfall_close_title: { pt: "Fechar", en: "Close" },
    waterfall_empty: { pt: "Sem chamadas registradas ainda.", en: "No calls recorded yet." },
    waterfall_summary: {
      pt: "{{total}} chamadas · {{errors}} com erro · {{services}} serviços · mais lenta: <b>{{slowName}}</b> ({{slowMs}}ms)",
      en: "{{total}} calls · {{errors}} failed · {{services}} services · slowest: <b>{{slowName}}</b> ({{slowMs}}ms)"
    },
    waterfall_tip_start: { pt: "início", en: "start" },
    waterfall_tip_group: { pt: "neste serviço", en: "for this service" },
    waterfall_tip_calls: { pt: "chamadas", en: "calls" },
    waterfall_tip_avg: { pt: "média", en: "avg" },
    waterfall_tip_max: { pt: "máx", en: "max" },

    env_node_word: { pt: "nó", en: "node" },
    recent_feature_remove_title: { pt: "Remover item", en: "Remove item" },
    view_badge_copy_hint: {
      pt: "Clique para copiar a consulta SQL (select * from dic_objeto where nr_sequencia = {{view}};) — cole no seu client de banco para investigar este objeto (confira o retorno: DIC_OBJETO cobre tabelas, views e também campos/componentes de tela).",
      en: "Click to copy the SQL query (select * from dic_objeto where nr_sequencia = {{view}};) — paste it in your DB client to look this object up (check the result: DIC_OBJETO covers tables, views, and also screen fields/components)."
    }
  };

  let currentLang = "pt";

  function normalizeLang(lang) {
    return lang === "en" ? "en" : "pt";
  }

  function setLang(lang) {
    currentLang = normalizeLang(lang);
  }

  function getLang() {
    return currentLang;
  }

  function t(key, vars) {
    const entry = STRINGS[key];
    let str = entry ? entry[currentLang] || entry.pt : key;
    if (vars) {
      Object.keys(vars).forEach((name) => {
        str = str.replace(new RegExp("\\{\\{" + name + "\\}\\}", "g"), String(vars[name]));
      });
    }
    return str;
  }

  root.TasyI18n = { t, setLang, getLang, STRINGS };
})(typeof window !== "undefined" ? window : globalThis);
