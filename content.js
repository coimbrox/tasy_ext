const PERFORMANCE_SAMPLE_LIMIT = 8;
const PERFORMANCE_POLL_INTERVAL_MS = 8000;
const PERFORMANCE_TIMEOUT_MS = 4500;

let performanceSamples = [];
let performanceFailures = 0;
let performanceStatus = "normal";
let performanceMonitorId = null;
let lastTraceSignature = "";

function isTasyHostname(hostname) {
  return typeof hostname === "string" && hostname.toLowerCase().includes("tasy");
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
  const latency = await measureLatencyProbe();
  if (typeof latency === "number" && Number.isFinite(latency)) {
    pushPerformanceSample(latency);
    performanceFailures = 0;
  } else {
    performanceFailures += 1;
  }

  performanceStatus = classifyPerformanceStatus();
  await tracePerformanceCycle(latency, performanceStatus);
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

if (isTasyHostname(window.location.hostname)) {
  startPerformanceMonitor();
}

// --- Tasy metadata bridge ---------------------------------------------------
// Relays chrome.storage options/recent-features to the page-context script
// (metadata-injected.js, world: "MAIN") since only this isolated script has
// access to chrome.storage/chrome.runtime.

const METADATA_MSG_MARK = "__tasyExt";
const METADATA_OPTION_KEYS = [
  "showFieldDetails",
  "showGridDetails",
  "showPanelDetails",
  "showRecentFeatures",
  "showUserLocale",
  "inspectMode"
];
const RECENT_FEATURES_KEY = "recentFeatures";
const RECENT_FEATURES_MAX = 20;

async function sendMetadataOptions() {
  if (!isTasyHostname(window.location.hostname)) {
    return;
  }

  const data = await chrome.storage.local.get([...METADATA_OPTION_KEYS, RECENT_FEATURES_KEY]);
  const options = {};
  METADATA_OPTION_KEYS.forEach((key) => {
    options[key] = Boolean(data[key]);
  });
  options.recentFeatures = Array.isArray(data[RECENT_FEATURES_KEY]) ? data[RECENT_FEATURES_KEY] : [];

  window.postMessage({ [METADATA_MSG_MARK]: true, type: "OPTIONS", options }, "*");
}

async function addRecentFeature(feature) {
  if (!feature || feature.code === undefined) {
    return;
  }

  const data = await chrome.storage.local.get([RECENT_FEATURES_KEY]);
  const current = Array.isArray(data[RECENT_FEATURES_KEY]) ? data[RECENT_FEATURES_KEY] : [];
  const withoutDuplicate = current.filter((item) => item.code !== feature.code);
  const updated = [feature, ...withoutDuplicate].slice(0, RECENT_FEATURES_MAX);
  await chrome.storage.local.set({ [RECENT_FEATURES_KEY]: updated });
}

async function removeRecentFeature(feature) {
  if (!feature || feature.code === undefined) {
    return;
  }

  const data = await chrome.storage.local.get([RECENT_FEATURES_KEY]);
  const current = Array.isArray(data[RECENT_FEATURES_KEY]) ? data[RECENT_FEATURES_KEY] : [];
  const updated = current.filter((item) => item.code !== feature.code);
  await chrome.storage.local.set({ [RECENT_FEATURES_KEY]: updated });
}

window.addEventListener("message", (event) => {
  if (event.source !== window) {
    return;
  }

  const data = event.data;
  if (!data || data[METADATA_MSG_MARK] !== true) {
    return;
  }

  if (data.type === "REQUEST_OPTIONS") {
    void sendMetadataOptions();
    return;
  }

  if (data.type === "FEATURE_OPENED") {
    void addRecentFeature(data.feature);
    return;
  }

  if (data.type === "FEATURE_REMOVED") {
    void removeRecentFeature(data.feature);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  const relevantKeys = [...METADATA_OPTION_KEYS, RECENT_FEATURES_KEY];
  if (relevantKeys.some((key) => key in changes)) {
    void sendMetadataOptions();
  }
});

void sendMetadataOptions();
