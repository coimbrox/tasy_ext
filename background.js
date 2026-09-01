const TRACE_STORAGE_KEY = "performanceTraceLog";
const TRACE_SCREENSHOTS_KEY = "traceScreenshots";
const TRACE_MAX_ENTRIES = 500;
const SCREENSHOT_KINDS = new Set(["navigation", "interaction", "final"]);

// All trace writes touch the same storage keys with a read-modify-write, so they
// must run one at a time. Without this, two events that fire back-to-back (e.g.
// the last field change plus the click that closes the process) read the same
// array and the second set() clobbers the first, dropping an entry.
let traceWriteQueue = Promise.resolve();

function queueTraceWrite(task) {
  const result = traceWriteQueue.then(task);
  traceWriteQueue = result.catch(() => {});
  return result;
}

function normalizeTraceEvent(event, senderTab) {
  const safeEvent = typeof event === "object" && event ? event : {};
  const kind = ["request", "navigation", "interaction", "final"].includes(safeEvent.kind) ? safeEvent.kind : "probe";
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
    console.warn("captureStepScreenshot: no senderTab/windowId", senderTab);
    return;
  }

  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(senderTab.windowId, { format: "jpeg", quality: 50 });
    const data = await chrome.storage.local.get([TRACE_SCREENSHOTS_KEY]);
    const screenshots = data[TRACE_SCREENSHOTS_KEY] && typeof data[TRACE_SCREENSHOTS_KEY] === "object" ? data[TRACE_SCREENSHOTS_KEY] : {};
    screenshots[entryId] = dataUrl;
    await chrome.storage.local.set({ [TRACE_SCREENSHOTS_KEY]: screenshots });
  } catch (_error) {
    console.error("captureStepScreenshot failed:", _error);
    // Capture can fail (rate limit, tab not visible, etc) - the text entry is kept regardless.
  }
}

async function appendPerformanceTraceEvent(event, senderTab) {
  return queueTraceWrite(async () => {
    const entry = normalizeTraceEvent(event, senderTab);
    const data = await chrome.storage.local.get([TRACE_STORAGE_KEY]);
    const current = Array.isArray(data[TRACE_STORAGE_KEY]) ? data[TRACE_STORAGE_KEY] : [];
    const updated = [...current, entry].slice(-TRACE_MAX_ENTRIES);
    await chrome.storage.local.set({ [TRACE_STORAGE_KEY]: updated });

    if (SCREENSHOT_KINDS.has(entry.kind)) {
      await captureStepScreenshot(entry.id, senderTab);
    }

    return entry;
  });
}

async function getPerformanceTraceLog(limit = 120) {
  const data = await chrome.storage.local.get([TRACE_STORAGE_KEY, TRACE_SCREENSHOTS_KEY]);
  const current = Array.isArray(data[TRACE_STORAGE_KEY]) ? data[TRACE_STORAGE_KEY] : [];
  const screenshots = data[TRACE_SCREENSHOTS_KEY] && typeof data[TRACE_SCREENSHOTS_KEY] === "object" ? data[TRACE_SCREENSHOTS_KEY] : {};
  const normalizedLimit = Number.isFinite(Number(limit)) ? Math.max(1, Math.min(TRACE_MAX_ENTRIES, Number(limit))) : 120;
  return current.slice(-normalizedLimit).map((entry) => (screenshots[entry.id] ? { ...entry, screenshot: screenshots[entry.id] } : entry));
}

const APPSERVER_BODY_MAX = 200000;

// Fetches a TasyAppServer page (the wheb_arquivo.jsp file console) carrying the
// session cookie the user already has for that origin. Routed through the
// service worker so it works even when the app server is on a different host
// (host access comes from the "<all_urls>" permission). The extension never
// sees or handles the app-server password - it relies on the existing session.
async function fetchAppServerText(url) {
  if (typeof url !== "string" || !/^https?:\/\//i.test(url)) {
    return { ok: false, reason: "invalid_url" };
  }
  try {
    const response = await fetch(url, { credentials: "include", redirect: "follow" });
    const text = await response.text();
    const looksLikeLogin = /name=["']?(j_username|password|senha)["']?/i.test(text) || /login\.jsp/i.test(response.url);
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      looksLikeLogin,
      body: text.slice(0, APPSERVER_BODY_MAX)
    };
  } catch (error) {
    return { ok: false, reason: "network_error", message: String((error && error.message) || error) };
  }
}

// Reads the app-server node from the session cookie. Wheb encodes it in the
// JSESSIONID value as `tasy-tasyappserver-<instance>_<NODE>~<sessionHash>` -
// e.g. ..._1114~3ADAA... means node 1114. The cookie is HttpOnly, so this
// needs the "cookies" permission + chrome.cookies API (document.cookie can't
// see it). Only the node number is surfaced, never the session hash.
async function getServerNode(url) {
  let host = "";
  try {
    host = new URL(url).hostname;
  } catch (_error) {
    return { ok: false, reason: "invalid_url" };
  }
  if (!/tasy/i.test(host)) {
    return { ok: true, found: false };
  }
  try {
    const cookies = await chrome.cookies.getAll({ url });
    for (const cookie of cookies) {
      const value = String(cookie.value || "");
      const match =
        value.match(/tasyappserver-\d+_(\d+)~/i) ||
        value.match(/_(\d+)~[0-9a-fA-F]{12,}/);
      if (match) {
        return { ok: true, found: true, name: cookie.name, node: match[1] };
      }
    }
    // Fallback: a classic affinity cookie (jvmRoute etc.) - use a short tail.
    const affinity = cookies.find((c) => /(jvmroute|route|sticky|affinity|srv|node)/i.test(c.name));
    if (affinity && affinity.value) {
      const tail = (affinity.value.match(/[A-Za-z0-9]{3,}$/) || [affinity.value])[0];
      return { ok: true, found: true, name: affinity.name, node: String(tail).slice(-8) };
    }
    return { ok: true, found: false };
  } catch (error) {
    return { ok: false, reason: String((error && error.message) || error) };
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "TASY_SERVER_NODE") {
    (async () => {
      sendResponse(await getServerNode(message.url));
    })();
    return true;
  }

  if (message.type === "TASY_PERF_TRACE_EVENT") {
    (async () => {
      await appendPerformanceTraceEvent(message.event, sender.tab);
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "TASY_PERF_TRACE_FINAL_SHOT") {
    (async () => {
      try {
        const tab = await chrome.tabs.get(message.tabId);
        let origin = "";
        try {
          origin = new URL(tab.url).origin;
        } catch (_error) {
          origin = "";
        }
        // Screenshot of the screen exactly as it is when the user stops the
        // capture - the "end state" that no click/navigation event covers.
        await appendPerformanceTraceEvent(
          {
            kind: "final",
            label: "Fim do registro — tela ao parar a captura",
            timestamp: new Date().toISOString(),
            pageUrl: tab.url || "",
            origin
          },
          tab
        );
        sendResponse({ ok: true });
      } catch (error) {
        sendResponse({ ok: false, reason: String((error && error.message) || error) });
      }
    })();
    return true;
  }

  if (message.type === "TASY_PERF_TRACE_FLUSH") {
    (async () => {
      await traceWriteQueue;
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

  if (message.type === "TASY_APPSERVER_FETCH") {
    (async () => {
      sendResponse(await fetchAppServerText(message.url));
    })();
    return true;
  }

  if (message.type === "TASY_GET_LOGGED_USER") {
    (async () => {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: message.tabId },
          world: "MAIN",
          func: () => {
            try {
              const scope =
                window.angular && window.angular.element(document.querySelector(".w-header")).scope();
              const user = scope && scope.user;
              return user ? String(user.username || user.login || user.nmUsuario || user.dsUsuario || "") : "";
            } catch (_error) {
              return "";
            }
          }
        });
        sendResponse({ ok: true, user: (result && result.result) || "" });
      } catch (error) {
        sendResponse({ ok: false, reason: String((error && error.message) || error) });
      }
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
