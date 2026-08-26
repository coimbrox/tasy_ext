const TRACE_STORAGE_KEY = "performanceTraceLog";
const TRACE_MAX_ENTRIES = 500;

function normalizeTraceEvent(event, senderTab) {
  const safeEvent = typeof event === "object" && event ? event : {};
  const kind = ["request", "navigation", "interaction"].includes(safeEvent.kind) ? safeEvent.kind : "probe";
  return {
    kind,
    label: typeof safeEvent.label === "string" ? safeEvent.label : null,
    action: typeof safeEvent.action === "string" ? safeEvent.action : null,
    value: typeof safeEvent.value === "string" ? safeEvent.value : null,
    timestamp: typeof safeEvent.timestamp === "string" ? safeEvent.timestamp : new Date().toISOString(),
    status: typeof safeEvent.status === "string" ? safeEvent.status : "unknown",
    reason: typeof safeEvent.reason === "string" ? safeEvent.reason : "unspecified",
    latencyMs: Number.isFinite(Number(safeEvent.latencyMs)) ? Number(safeEvent.latencyMs) : null,
    averageMs: Number.isFinite(Number(safeEvent.averageMs)) ? Number(safeEvent.averageMs) : null,
    maxMs: Number.isFinite(Number(safeEvent.maxMs)) ? Number(safeEvent.maxMs) : null,
    minMs: Number.isFinite(Number(safeEvent.minMs)) ? Number(safeEvent.minMs) : null,
    jitterMs: Number.isFinite(Number(safeEvent.jitterMs)) ? Number(safeEvent.jitterMs) : null,
    sampleCount: Number.isFinite(Number(safeEvent.sampleCount)) ? Number(safeEvent.sampleCount) : 0,
    failures: Number.isFinite(Number(safeEvent.failures)) ? Number(safeEvent.failures) : 0,
    method: typeof safeEvent.method === "string" ? safeEvent.method : null,
    url: typeof safeEvent.url === "string" ? safeEvent.url : null,
    httpStatus: Number.isFinite(Number(safeEvent.httpStatus)) ? Number(safeEvent.httpStatus) : null,
    ok: typeof safeEvent.ok === "boolean" ? safeEvent.ok : null,
    durationMs: Number.isFinite(Number(safeEvent.durationMs)) ? Number(safeEvent.durationMs) : null,
    pageUrl: typeof safeEvent.pageUrl === "string" ? safeEvent.pageUrl : senderTab?.url || "",
    origin: typeof safeEvent.origin === "string" ? safeEvent.origin : "",
    tabId: typeof senderTab?.id === "number" ? senderTab.id : null
  };
}

async function appendPerformanceTraceEvent(event, senderTab) {
  const entry = normalizeTraceEvent(event, senderTab);
  const data = await chrome.storage.local.get([TRACE_STORAGE_KEY]);
  const current = Array.isArray(data[TRACE_STORAGE_KEY]) ? data[TRACE_STORAGE_KEY] : [];
  const updated = [...current, entry].slice(-TRACE_MAX_ENTRIES);
  await chrome.storage.local.set({ [TRACE_STORAGE_KEY]: updated });
  return entry;
}

async function getPerformanceTraceLog(limit = 120) {
  const data = await chrome.storage.local.get([TRACE_STORAGE_KEY]);
  const current = Array.isArray(data[TRACE_STORAGE_KEY]) ? data[TRACE_STORAGE_KEY] : [];
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(TRACE_MAX_ENTRIES, Number(limit))) : 120;
  return current.slice(-normalizedLimit);
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "TASY_PERF_TRACE_EVENT") {
    (async () => {
      await appendPerformanceTraceEvent(message.event, sender.tab);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "TASY_PERF_TRACE_GET") {
    (async () => {
      const log = await getPerformanceTraceLog(message.limit);
      sendResponse({ ok: true, log });
    })();
    return true;
  }

  if (message.type === "TASY_RELOAD_STYLESHEETS") {
    (async () => {
      const tabId = message.tabId;
      if (typeof tabId === "number") {
        await chrome.scripting.executeScript({
          target: { tabId },
          func: () => {
            document.querySelectorAll('link[rel="stylesheet"]').forEach((link) => {
              const separator = link.href.includes("?") ? "&" : "?";
              link.href += `${separator}tasyExtReload=${Date.now()}`;
            });
          }
        }).catch(() => {});
      }
      sendResponse({ ok: true });
    })();
    return true;
  }
});
