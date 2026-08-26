const TRACE_STORAGE_KEY = "performanceTraceLog";
const TRACE_SCREENSHOTS_KEY = "traceScreenshots";
const TRACE_MAX_ENTRIES = 500;
const SCREENSHOT_KINDS = new Set(["navigation", "interaction"]);

function normalizeTraceEvent(event, senderTab) {
  const safeEvent = typeof event === "object" && event ? event : {};
  const kind = ["request", "navigation", "interaction"].includes(safeEvent.kind) ? safeEvent.kind : "probe";
  return {
    id: crypto.randomUUID(),
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

async function captureStepScreenshot(entryId, senderTab) {
  if (!senderTab || typeof senderTab.windowId !== "number") {
    return;
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(senderTab.windowId, { format: "jpeg", quality: 50 });
    const data = await chrome.storage.local.get([TRACE_SCREENSHOTS_KEY]);
    const screenshots = data[TRACE_SCREENSHOTS_KEY] && typeof data[TRACE_SCREENSHOTS_KEY] === "object" ? data[TRACE_SCREENSHOTS_KEY] : {};
    screenshots[entryId] = dataUrl;
    await chrome.storage.local.set({ [TRACE_SCREENSHOTS_KEY]: screenshots });
  } catch (_error) {
    // Capture can fail (rate limit, tab not visible, etc) - the text entry is kept regardless.
  }
}

async function appendPerformanceTraceEvent(event, senderTab) {
  const entry = normalizeTraceEvent(event, senderTab);
  const data = await chrome.storage.local.get([TRACE_STORAGE_KEY]);
  const current = Array.isArray(data[TRACE_STORAGE_KEY]) ? data[TRACE_STORAGE_KEY] : [];
  const updated = [...current, entry].slice(-TRACE_MAX_ENTRIES);
  await chrome.storage.local.set({ [TRACE_STORAGE_KEY]: updated });

  if (SCREENSHOT_KINDS.has(entry.kind)) {
    await captureStepScreenshot(entry.id, senderTab);
  }

  return entry;
}

async function getPerformanceTraceLog(limit = 120) {
  const data = await chrome.storage.local.get([TRACE_STORAGE_KEY, TRACE_SCREENSHOTS_KEY]);
  const current = Array.isArray(data[TRACE_STORAGE_KEY]) ? data[TRACE_STORAGE_KEY] : [];
  const screenshots = data[TRACE_SCREENSHOTS_KEY] && typeof data[TRACE_SCREENSHOTS_KEY] === "object" ? data[TRACE_SCREENSHOTS_KEY] : {};
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(TRACE_MAX_ENTRIES, Number(limit))) : 120;
  return current.slice(-normalizedLimit).map((entry) => (screenshots[entry.id] ? { ...entry, screenshot: screenshots[entry.id] } : entry));
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
