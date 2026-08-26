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
      return `<div class="step"><p class="step-text">${escapeHtml(text)}</p>${image}</div>`;
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
  .step { border: 1px solid #E2E8F0; border-radius: 8px; padding: 12px 16px; margin-bottom: 16px; background: #ffffff; }
  .step-text { margin: 0 0 8px; font-size: 14px; }
  .step-shot { max-width: 100%; border: 1px solid #E2E8F0; border-radius: 4px; display: block; }
</style>
</head>
<body>
<h1>Registro de processo TASY</h1>
<p class="generated-at">Gerado em ${escapeHtml(generatedAt)} — Tasy DevTools</p>
${steps}
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

  try {
    const activeTab = await getActiveTab();
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

(async () => {
  try {
    await loadMetadataOptions();
    await loadTraceState();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
})();
