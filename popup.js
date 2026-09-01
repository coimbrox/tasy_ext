const METADATA_OPTION_KEYS = [
  "showFieldDetails",
  "showGridDetails",
  "showPanelDetails",
  "showRecentFeatures",
  "showUserLocale",
  "inspectMode",
  "showReportLayout",
  "showWaterfall",
  "captureErrors"
];
const TRACE_ACTIVE_KEY = "traceActive";
const ERROR_LOG_KEY = "errorCaptureLog";
const APP_SERVER_BASE_KEY = "appServerBaseUrl";

const metadataCheckboxes = Object.fromEntries(
  METADATA_OPTION_KEYS.map((key) => [key, document.getElementById(key)])
);
const clearRecentFeaturesBtn = document.getElementById("clearRecentFeaturesBtn");
const reloadStylesheetsBtn = document.getElementById("reloadStylesheetsBtn");
const toggleTraceBtn = document.getElementById("toggleTraceBtn");
const dictionarySearchEl = document.getElementById("dictionarySearch");
const dictionaryResultsEl = document.getElementById("dictionaryResults");
const statusEl = document.getElementById("status");

const DICTIONARY_KIND_LABELS = {
  field: "Campo",
  "grid-column": "Coluna de grid",
  panel: "Painel"
};

function renderDictionaryResults(matches) {
  dictionaryResultsEl.innerHTML = "";
  if (matches.length === 0) {
    return;
  }

  matches.slice(0, 30).forEach((entry) => {
    const row = document.createElement("div");
    row.className = "dictionary-item";
    const kindLabel = DICTIONARY_KIND_LABELS[entry.kind] || entry.kind;
    const details = [entry.table, entry.view ? `view ${entry.view}` : null].filter(Boolean).join(" · ");
    row.innerHTML = `
      <div class="dictionary-item-main">
        <span class="dictionary-item-name">${escapeHtml(entry.name)}</span>
        ${entry.label ? `<span class="dictionary-item-label">${escapeHtml(entry.label)}</span>` : ""}
      </div>
      <div class="dictionary-item-meta">${escapeHtml(kindLabel)}${details ? ` · ${escapeHtml(details)}` : ""}</div>
    `;
    row.addEventListener("click", () => {
      navigator.clipboard.writeText(entry.name).catch(() => {});
      setStatus(`"${entry.name}" copiado.`, "ok");
    });
    dictionaryResultsEl.appendChild(row);
  });
}

dictionarySearchEl.addEventListener("input", async () => {
  const query = dictionarySearchEl.value.trim().toLowerCase();
  if (!query) {
    renderDictionaryResults([]);
    return;
  }

  const data = await chrome.storage.local.get(["dataDictionary"]);
  const dictionary = data.dataDictionary && typeof data.dataDictionary === "object" ? data.dataDictionary : {};
  const matches = Object.values(dictionary).filter((entry) => {
    return (
      (entry.name && entry.name.toLowerCase().includes(query)) ||
      (entry.label && entry.label.toLowerCase().includes(query)) ||
      (entry.table && entry.table.toLowerCase().includes(query))
    );
  });
  matches.sort((a, b) => b.count - a.count);
  renderDictionaryResults(matches);
});

// --- Environment color rules ------------------------------------------------

const ENVIRONMENT_RULES_KEY = "environmentRules";
const environmentRulesListEl = document.getElementById("environmentRulesList");
const addEnvironmentRuleBtn = document.getElementById("addEnvironmentRuleBtn");

function renderEnvironmentRules(rules) {
  environmentRulesListEl.innerHTML = "";
  rules.forEach((rule) => {
    const row = document.createElement("div");
    row.className = "environment-rule-row";

    const matchInput = document.createElement("input");
    matchInput.type = "text";
    matchInput.placeholder = "ex: hml";
    matchInput.value = rule.match || "";
    matchInput.className = "environment-rule-match";

    const colorInput = document.createElement("input");
    colorInput.type = "color";
    colorInput.value = rule.color || "#0284C7";
    colorInput.className = "environment-rule-color";

    const labelInput = document.createElement("input");
    labelInput.type = "text";
    labelInput.placeholder = "ex: Homologação";
    labelInput.value = rule.label || "";
    labelInput.className = "environment-rule-label";

    const removeBtn = document.createElement("button");
    removeBtn.type = "button";
    removeBtn.className = "environment-rule-remove";
    removeBtn.innerText = "×";
    removeBtn.title = "Remover regra";

    const persist = async () => {
      rule.match = matchInput.value.trim();
      rule.color = colorInput.value;
      rule.label = labelInput.value.trim();
      await saveEnvironmentRules();
    };

    matchInput.addEventListener("change", persist);
    matchInput.addEventListener("input", persist);
    colorInput.addEventListener("input", persist);
    labelInput.addEventListener("change", persist);
    labelInput.addEventListener("input", persist);
    removeBtn.addEventListener("click", async () => {
      currentEnvironmentRules = currentEnvironmentRules.filter((r) => r.id !== rule.id);
      renderEnvironmentRules(currentEnvironmentRules);
      await chrome.storage.local.set({ [ENVIRONMENT_RULES_KEY]: currentEnvironmentRules });
    });

    row.append(matchInput, colorInput, labelInput, removeBtn);
    environmentRulesListEl.appendChild(row);
  });
}

let currentEnvironmentRules = [];

async function saveEnvironmentRules() {
  await chrome.storage.local.set({ [ENVIRONMENT_RULES_KEY]: currentEnvironmentRules });
}

async function loadEnvironmentRules() {
  const data = await chrome.storage.local.get([ENVIRONMENT_RULES_KEY]);
  currentEnvironmentRules = Array.isArray(data[ENVIRONMENT_RULES_KEY]) ? data[ENVIRONMENT_RULES_KEY] : [];
  renderEnvironmentRules(currentEnvironmentRules);
}

addEnvironmentRuleBtn.addEventListener("click", async () => {
  currentEnvironmentRules.push({
    id: crypto.randomUUID(),
    match: "",
    color: "#0284C7",
    label: ""
  });
  renderEnvironmentRules(currentEnvironmentRules);
  await saveEnvironmentRules();
});

const showEstablishmentEl = document.getElementById("showEstablishment");

async function loadShowEstablishment() {
  const data = await chrome.storage.local.get(["showEstablishment"]);
  showEstablishmentEl.checked = Boolean(data.showEstablishment);
}

showEstablishmentEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ showEstablishment: showEstablishmentEl.checked });
});

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getPerformanceTraceLog(limit = 500) {
  const response = await chrome.runtime.sendMessage({
    type: "TASY_PERF_TRACE_GET",
    limit
  });

  if (!response || response.ok !== true || !Array.isArray(response.log)) {
    return [];
  }

  return response.log;
}

// The 7 overlay options shown in the "Metadados TASY" grid (captureErrors lives
// in its own section, so it is not part of "Ativar todos").
const METADATA_UI_KEYS = METADATA_OPTION_KEYS.filter((key) => key !== "captureErrors");
const metadataToggleAllEl = document.getElementById("metadataToggleAll");

function refreshMetadataToggleAll() {
  const states = METADATA_UI_KEYS.map((key) => metadataCheckboxes[key].checked);
  metadataToggleAllEl.checked = states.every(Boolean);
  metadataToggleAllEl.indeterminate = states.some(Boolean) && !states.every(Boolean);
}

async function loadMetadataOptions() {
  const data = await chrome.storage.local.get(METADATA_OPTION_KEYS);
  METADATA_OPTION_KEYS.forEach((key) => {
    metadataCheckboxes[key].checked = Boolean(data[key]);
  });
  refreshMetadataToggleAll();
}

METADATA_OPTION_KEYS.forEach((key) => {
  metadataCheckboxes[key].addEventListener("change", async () => {
    await chrome.storage.local.set({ [key]: metadataCheckboxes[key].checked });
    refreshMetadataToggleAll();
  });
});

metadataToggleAllEl.addEventListener("change", async () => {
  const on = metadataToggleAllEl.checked;
  metadataToggleAllEl.indeterminate = false;
  const patch = {};
  METADATA_UI_KEYS.forEach((key) => {
    metadataCheckboxes[key].checked = on;
    patch[key] = on;
  });
  await chrome.storage.local.set(patch);
});

clearRecentFeaturesBtn.addEventListener("click", async () => {
  setStatus("Limpando recentes...");
  try {
    await chrome.storage.local.set({ recentFeatures: [] });
    setStatus("Lista de recentes limpa.", "ok");
  } catch (error) {
    setStatus(`Falha ao limpar recentes: ${error.message || String(error)}`, "error");
  }
});

reloadStylesheetsBtn.addEventListener("click", async () => {
  setStatus("Recarregando estilos...");
  try {
    const tab = await getActiveTab();
    if (!tab || typeof tab.id !== "number") {
      setStatus("Não foi possível identificar a aba ativa.", "warn");
      return;
    }
    await chrome.runtime.sendMessage({ type: "TASY_RELOAD_STYLESHEETS", tabId: tab.id });
    setStatus("Estilos recarregados.", "ok");
  } catch (error) {
    setStatus(`Falha ao recarregar estilos: ${error.message || String(error)}`, "error");
  }
});

function formatTime(isoTimestamp) {
  try {
    return new Date(isoTimestamp).toLocaleTimeString("pt-BR");
  } catch (_error) {
    return "?";
  }
}

function formatTraceEntry(entry) {
  const time = formatTime(entry.timestamp);
  if (entry.kind === "final") {
    return `[${time}] 🏁 ${entry.label || "Fim do registro"}`;
  }
  if (entry.kind === "navigation") {
    return entry.label ? `[${time}] 🖥️ Tela aberta: ${entry.label}` : null;
  }

  if (entry.kind === "interaction") {
    if (entry.action === "click") {
      return `[${time}] 🖱️ Clicou em: ${entry.label}`;
    }
    if (entry.action === "input") {
      return `[${time}] ⌨️ Preencheu "${entry.label}": ${entry.value}`;
    }
    return null;
  }

  if (entry.kind === "probe" && entry.status && entry.status !== "normal") {
    return `[${time}] ⚠️ ${entry.status} — ${entry.reason} (latência: ${entry.latencyMs ?? "?"}ms)`;
  }

  return null;
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildHtmlReport(entries) {
  const generatedAt = new Date().toLocaleString("pt-BR");
  const steps = entries
    .map((entry) => {
      const text = formatTraceEntry(entry);
      if (!text) {
        return "";
      }
      const image = entry.screenshot
        ? `<img src="${entry.screenshot}" alt="Print do passo" class="step-shot" />`
        : "";
      return `<div class="step"><button type="button" class="step-remove js-remove-step" title="Remover este passo do relatório">Remover</button><p class="step-text">${escapeHtml(text)}</p>${image}</div>`;
    })
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Registro de processo TASY</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; background: #F8FAFC; color: #0F172A; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .generated-at { font-size: 12px; color: #64748B; margin: 0 0 24px; }
  .report-toolbar { position: sticky; top: 0; background: #F8FAFC; padding: 12px 0 16px; margin-bottom: 8px; z-index: 1; }
  .report-toolbar button { font: inherit; padding: 8px 14px; border: 1px solid #CBD5E1; border-radius: 6px; background: #ffffff; cursor: pointer; }
  .report-toolbar .hint { font-size: 12px; color: #64748B; margin: 6px 0 0; }
  .step { position: relative; border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; background: #ffffff; }
  .step-text { margin: 0 0 8px; font-size: 14px; padding-right: 80px; }
  .step-shot { max-width: 100%; border: 1px solid #E2E8F0; border-radius: 4px; display: block; }
  .step-remove { position: absolute; top: 8px; right: 8px; font: inherit; font-size: 12px; padding: 4px 8px; border: 1px solid #FCA5A5; color: #B91C1C; background: #FEF2F2; border-radius: 6px; cursor: pointer; }
  @media print { .report-toolbar, .step-remove { display: none !important; } }
</style>
</head>
<body>
<h1>Registro de processo TASY</h1>
<p class="generated-at">Gerado em ${escapeHtml(generatedAt)} — Tasy DevTools</p>
<div class="report-toolbar">
  <button type="button" class="js-download-clean">Baixar versão limpa</button>
  <p class="hint">Use "Remover" em qualquer passo para tirá-lo do relatório e depois baixe a versão limpa (os botões não aparecem na impressão nem no arquivo salvo).</p>
</div>
${steps}
<script>
(function () {
  document.addEventListener("click", function (event) {
    var remove = event.target.closest(".js-remove-step");
    if (remove) {
      var step = remove.closest(".step");
      if (step) { step.remove(); }
      return;
    }
    if (event.target.closest(".js-download-clean")) {
      var clone = document.documentElement.cloneNode(true);
      clone.querySelectorAll(".report-toolbar, .js-remove-step, script").forEach(function (node) {
        node.remove();
      });
      var html = "<!doctype html>\\n" + clone.outerHTML;
      var blob = new Blob([html], { type: "text/html" });
      var url = URL.createObjectURL(blob);
      var link = document.createElement("a");
      link.href = url;
      link.download = "tasy-processo-limpo.html";
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    }
  });
})();
</script>
</body>
</html>`;
}

function downloadHtmlReport(html, filenameSuffix) {
  const blob = new Blob([html], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tasy-processo-${filenameSuffix}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function setTraceButtonState(active) {
  toggleTraceBtn.textContent = active ? "Parar registro" : "Iniciar registro";
  toggleTraceBtn.classList.toggle("recording", active);
}

async function loadTraceState() {
  const data = await chrome.storage.local.get([TRACE_ACTIVE_KEY]);
  setTraceButtonState(Boolean(data[TRACE_ACTIVE_KEY]));
}

toggleTraceBtn.addEventListener("click", async () => {
  const data = await chrome.storage.local.get([TRACE_ACTIVE_KEY]);
  const isActive = Boolean(data[TRACE_ACTIVE_KEY]);

  if (!isActive) {
    await chrome.storage.local.set({ [TRACE_ACTIVE_KEY]: true, performanceTraceLog: [], traceScreenshots: {} });
    setTraceButtonState(true);
    setStatus("Registro iniciado. Execute o processo no TASY normalmente.", "ok");
    return;
  }

  await chrome.storage.local.set({ [TRACE_ACTIVE_KEY]: false });
  setTraceButtonState(false);
  setStatus("Finalizando registro...");

  const activeTab = await getActiveTab();

  // The last action (the click that closes the process) may still be travelling
  // to the service worker. Give it a moment to arrive; then take a final
  // screenshot of the screen exactly as it is now (the "end" state that no
  // click event covers); then wait for every queued write to finish.
  await new Promise((resolve) => setTimeout(resolve, 300));
  if (activeTab && typeof activeTab.id === "number") {
    try {
      await chrome.runtime.sendMessage({ type: "TASY_PERF_TRACE_FINAL_SHOT", tabId: activeTab.id });
    } catch (_error) {
      // capture is best-effort
    }
  }
  try {
    await chrome.runtime.sendMessage({ type: "TASY_PERF_TRACE_FLUSH" });
  } catch (_error) {
    // Worker unavailable - fall through and read whatever is stored.
  }

  try {
    if (!activeTab || typeof activeTab.id !== "number") {
      setStatus("Não foi possível identificar a aba ativa para copiar o registro.", "warn");
      return;
    }

    const log = await getPerformanceTraceLog(500);
    const activeTabLog = log.filter((entry) => Number(entry?.tabId) === Number(activeTab.id));

    if (activeTabLog.length === 0) {
      setStatus("Registro finalizado. Nenhum evento foi registrado.", "warn");
      return;
    }

    const lines = activeTabLog.map(formatTraceEntry).filter(Boolean);
    if (lines.length === 0) {
      setStatus("Registro finalizado. Nenhum evento relevante foi registrado.", "warn");
      return;
    }

    await navigator.clipboard.writeText(lines.join("\n"));

    const filenameSuffix = new Date().toISOString().replace(/[:.]/g, "-");
    downloadHtmlReport(buildHtmlReport(activeTabLog), filenameSuffix);

    setStatus(`Registro copiado e relatório baixado (${lines.length} evento(s)).`, "ok");
  } catch (error) {
    setStatus(`Falha ao copiar registro: ${error.message || String(error)}`, "error");
  }
});

// --- Error capture --------------------------------------------------------

const errorCaptureListEl = document.getElementById("errorCaptureList");
const appServerBaseInput = document.getElementById("appServerBaseUrl");
const testAppServerBtn = document.getElementById("testAppServerBtn");
const downloadErrorsBtn = document.getElementById("downloadErrorsBtn");
const clearErrorsBtn = document.getElementById("clearErrorsBtn");

async function loadAppServerBase() {
  const data = await chrome.storage.local.get([APP_SERVER_BASE_KEY]);
  appServerBaseInput.value = data[APP_SERVER_BASE_KEY] || "";
}

appServerBaseInput.addEventListener("change", async () => {
  await chrome.storage.local.set({ [APP_SERVER_BASE_KEY]: appServerBaseInput.value.trim() });
});

async function resolveAppServerBaseForTest() {
  let base = appServerBaseInput.value.trim();
  if (!base) {
    const tab = await getActiveTab();
    try {
      base = new URL(tab.url).origin + "/TasyAppServer/";
    } catch (_error) {
      base = "";
    }
  }
  if (base && !/\/$/.test(base)) {
    base += "/";
  }
  return base;
}

testAppServerBtn.addEventListener("click", async () => {
  setStatus("Testando acesso ao app server...");
  const base = await resolveAppServerBaseForTest();
  if (!base) {
    setStatus("Abra o TASY na aba ativa ou preencha a URL do app server.", "warn");
    return;
  }
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "TASY_APPSERVER_FETCH",
      url: `${base}wheb_arquivo.jsp?t=1&_=${Date.now()}`
    });
    if (resp && resp.ok && !resp.looksLikeLogin) {
      setStatus(`Acesso OK: ${base}`, "ok");
    } else if (resp && resp.looksLikeLogin) {
      setStatus("Precisa de login: abra o console do app server uma vez no navegador.", "warn");
    } else {
      setStatus(`Sem acesso a ${base} — confira a URL.`, "error");
    }
  } catch (error) {
    setStatus(`Falha no teste: ${error.message || String(error)}`, "error");
  }
});

async function getErrorCaptureLog() {
  const data = await chrome.storage.local.get([ERROR_LOG_KEY]);
  return Array.isArray(data[ERROR_LOG_KEY]) ? data[ERROR_LOG_KEY] : [];
}

async function renderErrorCaptureList() {
  const list = await getErrorCaptureLog();
  errorCaptureListEl.innerHTML = "";
  if (list.length === 0) {
    errorCaptureListEl.innerHTML =
      '<div class="dictionary-item"><div class="dictionary-item-meta">Nenhum erro capturado ainda.</div></div>';
    return;
  }
  list
    .slice()
    .reverse()
    .forEach((record) => {
      const row = document.createElement("div");
      row.className = "dictionary-item";
      let when = record.capturedAt;
      try {
        when = new Date(record.capturedAt).toLocaleString("pt-BR");
      } catch (_error) {
        // keep raw
      }
      const screen = record.screen
        ? record.screen.caption || record.screen.name || (record.screen.code ? `[${record.screen.code}]` : "")
        : "";
      const signature = record.interpretation ? record.interpretation.signature : "Erro";
      const repeat = record.repeat && record.repeat.countToday > 1 ? ` · ×${record.repeat.countToday} hoje` : "";
      row.innerHTML = `
        <div class="dictionary-item-main">
          <span class="dictionary-item-name">${escapeHtml(signature)}</span>
          ${screen ? `<span class="dictionary-item-label">${escapeHtml(screen)}</span>` : ""}
        </div>
        <div class="dictionary-item-meta">${escapeHtml(when)}${record.version ? ` · ${escapeHtml(record.version)}` : ""}${repeat}</div>
      `;
      row.addEventListener("click", () => {
        navigator.clipboard.writeText(record.reportText || "").catch(() => {});
        setStatus("Relatório do erro copiado.", "ok");
      });
      errorCaptureListEl.appendChild(row);
    });
}

function buildErrorHtmlReport(entries) {
  const generatedAt = new Date().toLocaleString("pt-BR");
  const blocks = entries
    .slice()
    .reverse()
    .map((record) => {
      const signature = record.interpretation ? record.interpretation.signature : "Erro";
      return `<section class="err"><h2>${escapeHtml(signature)}</h2><pre>${escapeHtml(record.reportText || "")}</pre></section>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8" />
<title>Erros capturados — Tasy DevTools</title>
<style>
  body { font-family: "Segoe UI", Arial, sans-serif; background: #F8FAFC; color: #0F172A; margin: 0; padding: 24px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  .generated-at { font-size: 12px; color: #64748B; margin: 0 0 24px; }
  .err { border: 1px solid #E2E8F0; border-left: 4px solid #DC2626; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; background: #ffffff; }
  .err h2 { font-size: 14px; margin: 0 0 8px; }
  .err pre { margin: 0; white-space: pre-wrap; word-break: break-word; font-family: "Consolas", "Courier New", monospace; font-size: 12px; line-height: 1.45; }
</style>
</head>
<body>
<h1>Erros capturados — Tasy DevTools</h1>
<p class="generated-at">Gerado em ${escapeHtml(generatedAt)} — revise o conteúdo antes de compartilhar.</p>
${blocks}
</body>
</html>`;
}

downloadErrorsBtn.addEventListener("click", async () => {
  const list = await getErrorCaptureLog();
  if (list.length === 0) {
    setStatus("Nenhum erro capturado para exportar.", "warn");
    return;
  }
  const blob = new Blob([buildErrorHtmlReport(list)], { type: "text/html" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `tasy-erros-${new Date().toISOString().replace(/[:.]/g, "-")}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  setStatus(`Relatório de erros baixado (${list.length}).`, "ok");
});

clearErrorsBtn.addEventListener("click", async () => {
  await chrome.storage.local.set({ [ERROR_LOG_KEY]: [] });
  await renderErrorCaptureList();
  setStatus("Erros capturados apagados.", "ok");
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local" && ERROR_LOG_KEY in changes) {
    void renderErrorCaptureList();
  }
});

// --- Server node + ticket generator ------------------------------------------

const serverNodeInfoEl = document.getElementById("serverNodeInfo");
const ticketEsperadoInput = document.getElementById("ticketEsperado");
const ticketObtidoInput = document.getElementById("ticketObtido");
const ticketOutputEl = document.getElementById("ticketOutput");
const genTicketBtn = document.getElementById("genTicketBtn");
const copyTicketBtn = document.getElementById("copyTicketBtn");

async function getServerNode() {
  const tab = await getActiveTab();
  if (!tab || !tab.url) {
    return null;
  }
  try {
    const resp = await chrome.runtime.sendMessage({ type: "TASY_SERVER_NODE", url: tab.url });
    return resp && resp.ok && resp.found ? resp : null;
  } catch (_error) {
    return null;
  }
}

async function loadServerNodeInfo() {
  const node = await getServerNode();
  serverNodeInfoEl.textContent = node
    ? `Servidor atual: nó ${node.node}  (cookie ${node.name})`
    : "Servidor atual: nó não identificado nesta aba.";
}

async function generateTicket() {
  setStatus("Montando texto do chamado...");
  const tab = await getActiveTab();
  let host = "?";
  try {
    host = new URL(tab.url).hostname;
  } catch (_error) {
    // leave as ?
  }
  const node = await getServerNode();
  const data = await chrome.storage.local.get(["recentFeatures", "performanceTraceLog", ERROR_LOG_KEY]);
  const feature = (Array.isArray(data.recentFeatures) ? data.recentFeatures : [])[0];
  const lastError = (Array.isArray(data[ERROR_LOG_KEY]) ? data[ERROR_LOG_KEY] : []).slice(-1)[0];
  const steps = (Array.isArray(data.performanceTraceLog) ? data.performanceTraceLog : [])
    .map(formatTraceEntry)
    .filter(Boolean)
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, ""));

  const L = [];
  L.push("AMBIENTE: " + host + (node ? "   |   nó do app server: " + node.node : ""));
  if (lastError && lastError.establishment) L.push("ESTABELECIMENTO: " + lastError.establishment);
  L.push("VERSÃO TASY: " + (lastError && lastError.version ? lastError.version : "[preencher]"));
  L.push(
    "FUNÇÃO/TELA: " +
      (feature ? (feature.code ? "[" + feature.code + "] " : "") + (feature.caption || feature.name || "") : "[preencher]")
  );
  L.push("USUÁRIO: " + (lastError && lastError.user ? lastError.user : "[preencher]"));
  L.push("DATA/HORA: " + new Date().toLocaleString("pt-BR"));
  L.push("");
  L.push("PASSOS PARA REPRODUZIR:");
  if (steps.length) {
    steps.forEach((s, i) => L.push(i + 1 + ". " + s));
  } else {
    L.push("[use o \"Registrar Processo\" para gravar os passos e gere novamente]");
  }
  L.push("");
  L.push("ESPERADO: " + (ticketEsperadoInput.value.trim() || "[preencher]"));
  L.push("OBTIDO: " + (ticketObtidoInput.value.trim() || "[preencher]"));
  if (lastError && lastError.reportText) {
    L.push("");
    L.push("--- ERRO CAPTURADO ---");
    L.push(lastError.reportText);
  }
  L.push("");
  L.push("(Revise este texto antes de enviar — pode conter dados sensíveis.)");

  ticketOutputEl.value = L.join("\n");
  setStatus("Texto do chamado gerado. Revise e copie.", "ok");
}

genTicketBtn.addEventListener("click", () => {
  void generateTicket();
});

copyTicketBtn.addEventListener("click", async () => {
  if (!ticketOutputEl.value.trim()) {
    setStatus("Gere o texto primeiro.", "warn");
    return;
  }
  try {
    await navigator.clipboard.writeText(ticketOutputEl.value);
    setStatus("Texto do chamado copiado.", "ok");
  } catch (error) {
    setStatus("Falha ao copiar: " + (error.message || String(error)), "error");
  }
});

// --- App server explorer ---------------------------------------------------

const explorerRefreshBtn = document.getElementById("explorerRefreshBtn");
const explorerFilterEl = document.getElementById("explorerFilter");
const explorerListEl = document.getElementById("explorerList");
const explorerDetailEl = document.getElementById("explorerDetail");
const explorerCopyBtn = document.getElementById("explorerCopyBtn");

let explorerEntries = [];
let explorerBase = "";

function explorerHint(text) {
  explorerListEl.innerHTML = `<div class="dictionary-item"><div class="dictionary-item-meta">${escapeHtml(text)}</div></div>`;
}

function parseAppServerFolderHtml(html) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch (_error) {
    return [];
  }
  return [...doc.querySelectorAll('a[href*="fileName="]')].map((link) => {
    const cells = link.closest("tr") ? [...link.closest("tr").querySelectorAll("td")].map((c) => c.textContent.trim()) : [];
    const name = link.textContent.trim();
    return {
      name,
      href: link.getAttribute("href") || "",
      tempo: cells[1] || "",
      tipo: cells[2] || name.split("_")[0] || "",
      dateText: cells[3] || ""
    };
  });
}

function extractSqlText(rawHtml) {
  let text = "";
  try {
    const doc = new DOMParser().parseFromString(rawHtml, "text/html");
    text = (doc.body ? doc.body.innerText : "").replace(/\r/g, "");
  } catch (_error) {
    text = String(rawHtml || "").replace(/<[^>]+>/g, " ");
  }
  return text.trim();
}

function renderExplorerRows() {
  const filter = explorerFilterEl.value.trim().toLowerCase();
  const rows = explorerEntries.filter((e) => !filter || e.name.toLowerCase().includes(filter));
  explorerListEl.innerHTML = "";
  if (rows.length === 0) {
    explorerHint(explorerEntries.length ? "Nenhum arquivo bate com o filtro." : "Clique em \"Atualizar lista\".");
    return;
  }
  rows.slice(0, 60).forEach((entry) => {
    const row = document.createElement("div");
    row.className = "dictionary-item";
    const cleanName = entry.name.replace(/_\s*\d*ms\.html$/i, "").replace(/\.html$/i, "");
    row.innerHTML = `
      <div class="dictionary-item-main">
        <span class="dictionary-item-name">${escapeHtml(cleanName)}</span>
        <span class="dictionary-item-label">${escapeHtml(entry.tipo)}</span>
      </div>
      <div class="dictionary-item-meta">${escapeHtml(entry.tempo)}${entry.dateText ? ` · ${escapeHtml(entry.dateText)}` : ""}</div>
    `;
    row.addEventListener("click", () => {
      void openExplorerFile(entry);
    });
    explorerListEl.appendChild(row);
  });
}

async function openExplorerFile(entry) {
  explorerDetailEl.value = "Carregando...";
  let url;
  try {
    url = new URL(entry.href, explorerBase).href;
  } catch (_error) {
    url = explorerBase + entry.href.replace(/^\.?\//, "");
  }
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "TASY_APPSERVER_FETCH",
      url: url + (url.includes("?") ? "&" : "?") + "_=" + Date.now()
    });
    explorerDetailEl.value = resp && resp.ok ? extractSqlText(resp.body) : "Não foi possível abrir o arquivo.";
  } catch (error) {
    explorerDetailEl.value = "Erro: " + (error.message || String(error));
  }
}

async function loadAppServerExplorer() {
  setStatus("Lendo o app server...");
  explorerHint("Carregando...");
  const tab = await getActiveTab();
  explorerBase = await resolveAppServerBaseForTest();
  if (!tab || !tab.id || !explorerBase) {
    explorerHint("Abra o TASY na aba ativa (ou preencha a URL do app server em \"Capturar erros\").");
    setStatus("");
    return;
  }
  let user = "";
  try {
    const resp = await chrome.runtime.sendMessage({ type: "TASY_GET_LOGGED_USER", tabId: tab.id });
    user = ((resp && resp.user) || "").trim().slice(0, 14);
  } catch (_error) {
    user = "";
  }
  if (!user) {
    explorerHint("Não identifiquei seu usuário — verifique se está logado no TASY nesta aba.");
    setStatus("");
    return;
  }
  try {
    const resp = await chrome.runtime.sendMessage({
      type: "TASY_APPSERVER_FETCH",
      url: explorerBase + "wheb_arquivo.jsp?user=" + encodeURIComponent(user) + "&t=1&_=" + Date.now()
    });
    if (!resp || !resp.ok || resp.looksLikeLogin) {
      explorerHint(resp && resp.looksLikeLogin ? "Precisa de login no console do app server." : "Sem acesso ao app server.");
      setStatus("");
      return;
    }
    explorerEntries = parseAppServerFolderHtml(resp.body).filter((e) => /^(SQL_|PROCEDURE_|W_PROCEDURE_|ERRO_)/i.test(e.name));
    renderExplorerRows();
    setStatus(`Explorador: ${explorerEntries.length} arquivo(s) de ${user}.`, "ok");
  } catch (error) {
    explorerHint("Erro: " + (error.message || String(error)));
    setStatus("");
  }
}

explorerRefreshBtn.addEventListener("click", () => {
  void loadAppServerExplorer();
});
explorerFilterEl.addEventListener("input", renderExplorerRows);
explorerCopyBtn.addEventListener("click", async () => {
  if (!explorerDetailEl.value.trim()) {
    setStatus("Selecione um arquivo primeiro.", "warn");
    return;
  }
  try {
    await navigator.clipboard.writeText(explorerDetailEl.value);
    setStatus("Conteúdo copiado.", "ok");
  } catch (error) {
    setStatus("Falha ao copiar: " + (error.message || String(error)), "error");
  }
});

(async () => {
  try {
    await loadMetadataOptions();
    await loadTraceState();
    await loadEnvironmentRules();
    await loadShowEstablishment();
    await loadAppServerBase();
    await renderErrorCaptureList();
    await loadServerNodeInfo();
    explorerHint("Clique em \"Atualizar lista\".");
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
})();
