const METADATA_OPTION_KEYS = [
  "showFieldDetails",
  "showGridDetails",
  "showPanelDetails",
  "showRecentFeatures",
  "showUserLocale",
  "inspectMode",
  "showReportLayout"
];
const TRACE_ACTIVE_KEY = "traceActive";

const metadataCheckboxes = Object.fromEntries(
  METADATA_OPTION_KEYS.map((key) => [key, document.getElementById(key)])
);
const clearRecentFeaturesBtn = document.getElementById("clearRecentFeaturesBtn");
const reloadStylesheetsBtn = document.getElementById("reloadStylesheetsBtn");
const toggleTraceBtn = document.getElementById("toggleTraceBtn");
const statusEl = document.getElementById("status");

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

function formatTime(isoTimestamp) {
  try {
    return new Date(isoTimestamp).toLocaleTimeString("pt-BR");
  } catch (_error) {
    return "?";
  }
}

function formatTraceEntry(entry) {
  const time = formatTime(entry.timestamp);
  if (entry.kind === "navigation") {
    return entry.label ? `[${time}] 🖥️ Tela aberta: ${entry.label}` : null;
  }

  if (entry.kind === "request") {
    const status = entry.httpStatus ?? "erro";
    return `[${time}] → ${entry.method || "GET"} ${entry.url || ""} (${status}, ${entry.durationMs ?? "?"}ms)`;
  }

  if (entry.kind === "probe" && entry.status && entry.status !== "normal") {
    return `[${time}] ⚠️ ${entry.status} — ${entry.reason} (latência: ${entry.latencyMs ?? "?"}ms)`;
  }

  return null;
}

function buildReadableTrace(entries) {
  const lines = entries.map(formatTraceEntry).filter(Boolean);
  if (lines.length === 0) {
    return "";
  }
  return lines.join("\n");
}

function setTraceButtonState(active) {
  toggleTraceBtn.textContent = active ? "Desativar trace" : "Ativar trace";
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
    await chrome.storage.local.set({ [TRACE_ACTIVE_KEY]: true, performanceTraceLog: [] });
    setTraceButtonState(true);
    setStatus("Trace ativado. Execute o processo no TASY normalmente.", "ok");
    return;
  }

  await chrome.storage.local.set({ [TRACE_ACTIVE_KEY]: false });
  setTraceButtonState(false);
  setStatus("Coletando trace...");

  try {
    const activeTab = await getActiveTab();
    if (!activeTab || typeof activeTab.id !== "number") {
      setStatus("Não foi possível identificar a aba ativa para copiar o trace.", "warn");
      return;
    }

    const log = await getPerformanceTraceLog(500);
    const activeTabLog = log.filter((entry) => Number(entry?.tabId) === Number(activeTab.id));

    if (activeTabLog.length === 0) {
      setStatus("Trace desativado. Nenhum evento foi registrado.", "warn");
      return;
    }

    const readable = buildReadableTrace(activeTabLog);
    if (!readable) {
      setStatus("Trace desativado. Nenhum evento relevante foi registrado.", "warn");
      return;
    }

    await navigator.clipboard.writeText(readable);
    setStatus(`Trace copiado (${activeTabLog.length} evento(s)).`, "ok");
  } catch (error) {
    setStatus(`Falha ao copiar trace: ${error.message || String(error)}`, "error");
  }
});

(async () => {
  try {
    await loadMetadataOptions();
    await loadTraceState();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
})();
