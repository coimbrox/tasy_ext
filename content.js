const BADGE_ID = "tasy-server-badge";
const BADGE_MARGIN = 8;
const PERFORMANCE_SAMPLE_LIMIT = 8;
const PERFORMANCE_POLL_INTERVAL_MS = 8000;
const PERFORMANCE_TIMEOUT_MS = 4500;

const BADGE_STATUS_COLORS = {
  normal: "#0b5cab",
  oscillating: "#d88700",
  slow: "#c73a3a"
};

let currentDrag = null;
let latestPayload = null;
let performanceSamples = [];
let performanceFailures = 0;
let performanceStatus = "normal";
let performanceMonitorId = null;
let lastTraceSignature = "";

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getViewportLimits(badge) {
  const rect = badge.getBoundingClientRect();
  const maxX = Math.max(BADGE_MARGIN, window.innerWidth - rect.width - BADGE_MARGIN);
  const maxY = Math.max(BADGE_MARGIN, window.innerHeight - rect.height - BADGE_MARGIN);
  return { maxX, maxY };
}

function applyBadgeCoordinates(badge, coordinates) {
  const xRaw = Number(coordinates?.x);
  const yRaw = Number(coordinates?.y);
  const xValid = Number.isFinite(xRaw);
  const yValid = Number.isFinite(yRaw);
  if (!xValid || !yValid) {
    return;
  }

  const { maxX, maxY } = getViewportLimits(badge);
  const x = clamp(Math.round(xRaw), BADGE_MARGIN, maxX);
  const y = clamp(Math.round(yRaw), BADGE_MARGIN, maxY);

  badge.style.top = `${y}px`;
  badge.style.left = `${x}px`;
  badge.style.right = "";
  badge.style.bottom = "";
}

async function persistBadgeCoordinates(x, y) {
  const payload = {
    badgeCoordinates: {
      x: Math.round(x),
      y: Math.round(y)
    }
  };

  await chrome.storage.local.set(payload);
}

function startDrag(event, badge) {
  if (event.button !== 0) {
    return;
  }

  const rect = badge.getBoundingClientRect();
  currentDrag = {
    pointerOffsetX: event.clientX - rect.left,
    pointerOffsetY: event.clientY - rect.top
  };

  badge.style.cursor = "grabbing";
  event.preventDefault();
}

async function updateDrag(event, badge) {
  if (!currentDrag) {
    return;
  }

  const { maxX, maxY } = getViewportLimits(badge);
  const x = clamp(event.clientX - currentDrag.pointerOffsetX, BADGE_MARGIN, maxX);
  const y = clamp(event.clientY - currentDrag.pointerOffsetY, BADGE_MARGIN, maxY);

  badge.style.top = `${Math.round(y)}px`;
  badge.style.left = `${Math.round(x)}px`;
  badge.style.right = "";
  badge.style.bottom = "";
}

async function finishDrag(badge) {
  if (!currentDrag) {
    return;
  }

  currentDrag = null;
  badge.style.cursor = "grab";

  const rect = badge.getBoundingClientRect();
  await persistBadgeCoordinates(rect.left, rect.top);
}

function setupBadgeDrag(badge) {
  if (badge.dataset.dragReady === "true") {
    return;
  }

  badge.dataset.dragReady = "true";
  badge.style.cursor = "grab";

  badge.addEventListener("mousedown", (event) => {
    startDrag(event, badge);
  });

  window.addEventListener("mousemove", (event) => {
    void updateDrag(event, badge);
  });

  window.addEventListener("mouseup", () => {
    void finishDrag(badge);
  });

  window.addEventListener("blur", () => {
    void finishDrag(badge);
  });
}

function pushPerformanceSample(latencyMs) {
  performanceSamples.push(latencyMs);
  if (performanceSamples.length > PERFORMANCE_SAMPLE_LIMIT) {
    performanceSamples = performanceSamples.slice(-PERFORMANCE_SAMPLE_LIMIT);
  }
}

function classifyPerformanceStatus() {
  if (performanceFailures >= 2) {
    return "slow";
  }

  if (performanceSamples.length < 3) {
    return "normal";
  }

  const sum = performanceSamples.reduce((acc, value) => acc + value, 0);
  const average = sum / performanceSamples.length;
  const max = Math.max(...performanceSamples);
  const min = Math.min(...performanceSamples);
  const jitter = max - min;

  if (average >= 1200 || max >= 2000) {
    return "slow";
  }

  if ((jitter >= 650 && average >= 320) || jitter >= 900) {
    return "oscillating";
  }

  return "normal";
}

function summarizePerformanceMetrics() {
  if (performanceSamples.length === 0) {
    return {
      averageMs: null,
      maxMs: null,
      minMs: null,
      jitterMs: null,
      sampleCount: 0
    };
  }

  const sum = performanceSamples.reduce((acc, value) => acc + value, 0);
  const average = sum / performanceSamples.length;
  const max = Math.max(...performanceSamples);
  const min = Math.min(...performanceSamples);

  return {
    averageMs: Math.round(average),
    maxMs: Math.round(max),
    minMs: Math.round(min),
    jitterMs: Math.round(max - min),
    sampleCount: performanceSamples.length
  };
}

function inferPerformanceReason(status, latencyMs, metrics) {
  if (latencyMs === null) {
    return "probe_timeout_or_network_error";
  }

  if (status === "slow") {
    if (metrics.averageMs !== null && metrics.averageMs >= 1200) {
      return "high_average_latency";
    }

    if (metrics.maxMs !== null && metrics.maxMs >= 2000) {
      return "high_peak_latency";
    }

    if (performanceFailures >= 2) {
      return "consecutive_probe_failures";
    }

    return "slow_response_pattern";
  }

  if (status === "oscillating") {
    if (metrics.jitterMs !== null && metrics.jitterMs >= 900) {
      return "extreme_jitter";
    }

    if (metrics.jitterMs !== null && metrics.averageMs !== null && metrics.jitterMs >= 650 && metrics.averageMs >= 320) {
      return "high_jitter_with_medium_latency";
    }

    return "unstable_response_pattern";
  }

  return "stable_response_pattern";
}

async function emitPerformanceTrace(event) {
  try {
    await chrome.runtime.sendMessage({
      type: "TASY_PERF_TRACE_EVENT",
      event
    });
  } catch (_error) {
  }
}

async function tracePerformanceCycle(latencyMs, status) {
  const metrics = summarizePerformanceMetrics();
  const reason = inferPerformanceReason(status, latencyMs, metrics);
  const event = {
    timestamp: new Date().toISOString(),
    pageUrl: window.location.href,
    origin: window.location.origin,
    status,
    reason,
    latencyMs: latencyMs === null ? null : Math.round(latencyMs),
    failures: performanceFailures,
    ...metrics
  };

  const signature = `${event.status}|${event.reason}|${event.failures}|${event.latencyMs ?? "null"}|${event.jitterMs ?? "null"}`;
  const shouldTrace =
    status !== "normal" ||
    latencyMs === null ||
    signature !== lastTraceSignature;

  if (shouldTrace) {
    lastTraceSignature = signature;
    await emitPerformanceTrace(event);
  }
}

function applyPerformanceVisualState(badge) {
  const color = BADGE_STATUS_COLORS[performanceStatus] || BADGE_STATUS_COLORS.normal;
  badge.style.background = color;

  if (performanceStatus === "slow") {
    badge.style.boxShadow = "0 2px 10px rgba(199, 58, 58, 0.55)";
    badge.title = "Desempenho lento detectado";
    return;
  }

  if (performanceStatus === "oscillating") {
    badge.style.boxShadow = "0 2px 10px rgba(216, 135, 0, 0.55)";
    badge.title = "Oscilação de desempenho detectada";
    return;
  }

  badge.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.25)";
  badge.title = "Desempenho normal";
}

async function measureLatencyProbe() {
  const controller = new AbortController();
  const timeoutId = window.setTimeout(() => controller.abort(), PERFORMANCE_TIMEOUT_MS);
  const startedAt = performance.now();

  try {
    const probeUrl = `${window.location.origin}/favicon.ico?__tasy_probe=${Date.now()}`;
    await fetch(probeUrl, {
      method: "GET",
      cache: "no-store",
      credentials: "include",
      signal: controller.signal
    });

    return performance.now() - startedAt;
  } catch (_error) {
    return null;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function runPerformanceCycle() {
  if (!latestPayload?.enabled) {
    return;
  }

  const latency = await measureLatencyProbe();
  if (typeof latency === "number" && Number.isFinite(latency)) {
    pushPerformanceSample(latency);
    performanceFailures = 0;
  } else {
    performanceFailures += 1;
  }

  performanceStatus = classifyPerformanceStatus();
  await tracePerformanceCycle(latency, performanceStatus);
  const badge = document.getElementById(BADGE_ID);
  if (badge) {
    applyPerformanceVisualState(badge);
  }
}

function stopPerformanceMonitor() {
  if (performanceMonitorId !== null) {
    window.clearInterval(performanceMonitorId);
    performanceMonitorId = null;
  }

  performanceSamples = [];
  performanceFailures = 0;
  performanceStatus = "normal";
  lastTraceSignature = "";
}

function startPerformanceMonitor() {
  if (performanceMonitorId !== null) {
    return;
  }

  void runPerformanceCycle();
  performanceMonitorId = window.setInterval(() => {
    void runPerformanceCycle();
  }, PERFORMANCE_POLL_INTERVAL_MS);
}

function applyBadgePosition(badge, position) {
  badge.style.top = "";
  badge.style.right = "";
  badge.style.bottom = "";
  badge.style.left = "";

  switch (position) {
    case "top-left":
      badge.style.top = "14px";
      badge.style.left = "14px";
      break;
    case "bottom-left":
      badge.style.bottom = "14px";
      badge.style.left = "14px";
      break;
    case "bottom-right":
      badge.style.bottom = "14px";
      badge.style.right = "14px";
      break;
    case "top-right":
    default:
      badge.style.top = "14px";
      badge.style.right = "14px";
      break;
  }
}

function ensureBadgeElement() {
  let badge = document.getElementById(BADGE_ID);
  if (badge) {
    return badge;
  }

  badge = document.createElement("div");
  badge.id = BADGE_ID;
  badge.style.position = "fixed";
  badge.style.zIndex = "2147483647";
  badge.style.background = "#0b5cab";
  badge.style.color = "#ffffff";
  badge.style.fontFamily = "Segoe UI, Arial, sans-serif";
  badge.style.fontSize = "12px";
  badge.style.fontWeight = "700";
  badge.style.padding = "6px 10px";
  badge.style.borderRadius = "8px";
  badge.style.boxShadow = "0 2px 8px rgba(0, 0, 0, 0.25)";
  badge.style.pointerEvents = "auto";
  badge.style.userSelect = "none";
  document.documentElement.appendChild(badge);
  setupBadgeDrag(badge);
  return badge;
}

function removeBadgeElement() {
  stopPerformanceMonitor();
  const badge = document.getElementById(BADGE_ID);
  if (badge) {
    badge.remove();
  }
}

function renderBadge(payload) {
  const enabled = Boolean(payload?.enabled);
  latestPayload = payload || {};

  if (!enabled) {
    removeBadgeElement();
    return;
  }

  const serverId = payload?.serverId && payload.serverId !== "-" ? payload.serverId : "N/D";
  const badge = ensureBadgeElement();
  if (payload?.badgeCoordinates && Number.isFinite(Number(payload.badgeCoordinates.x)) && Number.isFinite(Number(payload.badgeCoordinates.y))) {
    applyBadgeCoordinates(badge, payload.badgeCoordinates);
  } else {
    applyBadgePosition(badge, payload?.badgePosition || "bottom-right");
  }
  badge.textContent = `SRV ${serverId}`;
  applyPerformanceVisualState(badge);
  startPerformanceMonitor();
}

async function requestInitialState() {
  try {
    const payload = await chrome.runtime.sendMessage({
      type: "TASY_GET_SERVER_BADGE_STATE"
    });
    renderBadge(payload);
  } catch (_error) {
  }
}

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "TASY_SERVER_BADGE_UPDATE") {
    renderBadge(message.payload || {});
  }
});

void requestInitialState();

document.addEventListener("visibilitychange", () => {
  if (!document.hidden) {
    void requestInitialState();
  }
});
