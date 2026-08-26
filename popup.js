const METADATA_OPTION_KEYS = [
  "showFieldDetails",
  "showGridDetails",
  "showPanelDetails",
  "showRecentFeatures",
  "showUserLocale",
  "inspectMode"
];
const metadataCheckboxes = Object.fromEntries(
  METADATA_OPTION_KEYS.map((key) => [key, document.getElementById(key)])
);
const clearRecentFeaturesBtn = document.getElementById("clearRecentFeaturesBtn");
const reloadStylesheetsBtn = document.getElementById("reloadStylesheetsBtn");
const copyTraceBtn = document.getElementById("copyTraceBtn");
const clearTraceBtn = document.getElementById("clearTraceBtn");
const statusEl = document.getElementById("status");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function getPerformanceTraceLog(limit = 120) {
  const response = await chrome.runtime.sendMessage({
    type: "TASY_PERF_TRACE_GET",
    limit
  });

  if (!response || response.ok !== true || !Array.isArray(response.log)) {
    return [];
  }

  return response.log;
}

async function clearPerformanceTraceLog() {
  await chrome.runtime.sendMessage({
    type: "TASY_PERF_TRACE_CLEAR"
  });
}

async function loadMetadataOptions() {
  const data = await chrome.storage.local.get(METADATA_OPTION_KEYS);
  METADATA_OPTION_KEYS.forEach((key) => {
    metadataCheckboxes[key].checked = Boolean(data[key]);
  });
}

METADATA_OPTION_KEYS.forEach((key) => {
  metadataCheckboxes[key].addEventListener("change", async () => {
    await chrome.storage.local.set({ [key]: metadataCheckboxes[key].checked });
  });
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

copyTraceBtn.addEventListener("click", async () => {
  setStatus("Coletando trace...");
  try {
    const activeTab = await getActiveTab();
    if (!activeTab || typeof activeTab.id !== "number") {
      setStatus("Não foi possível identificar a aba ativa para copiar o trace.", "warn");
      return;
    }

    const log = await getPerformanceTraceLog(300);
    const activeTabLog = log.filter((entry) => Number(entry?.tabId) === Number(activeTab.id));

    if (activeTabLog.length === 0) {
      setStatus("Ainda não há eventos de trace para a aba ativa.", "warn");
      return;
    }

    const content = JSON.stringify(activeTabLog, null, 2);
    await navigator.clipboard.writeText(content);
    setStatus(`Trace da aba ativa copiado (${activeTabLog.length} evento(s)).`, "ok");
  } catch (error) {
    setStatus(`Falha ao copiar trace: ${error.message || String(error)}`, "error");
  }
});

clearTraceBtn.addEventListener("click", async () => {
  setStatus("Limpando trace...");
  try {
    await clearPerformanceTraceLog();
    setStatus("Trace limpo com sucesso.", "ok");
  } catch (error) {
    setStatus(`Falha ao limpar trace: ${error.message || String(error)}`, "error");
  }
});

(async () => {
  try {
    await loadMetadataOptions();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
})();
