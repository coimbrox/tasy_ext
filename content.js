const PERFORMANCE_SAMPLE_LIMIT = 8;
const PERFORMANCE_POLL_INTERVAL_MS = 8000;
const PERFORMANCE_TIMEOUT_MS = 4500;
const TRACE_ACTIVE_KEY = "traceActive";

let performanceSamples = [];
let performanceFailures = 0;
let performanceStatus = "normal";
let performanceMonitorId = null;
let lastTraceSignature = "";
let traceActive = false;

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
  if (!traceActive) {
    return;
  }

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
    kind: "probe",
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

async function syncTraceActiveState() {
  if (!isTasyHostname(window.location.hostname)) {
    return;
  }

  const data = await chrome.storage.local.get([TRACE_ACTIVE_KEY]);
  const active = Boolean(data[TRACE_ACTIVE_KEY]);
  if (active === traceActive) {
    return;
  }

  traceActive = active;
  if (traceActive) {
    startPerformanceMonitor();
  } else {
    stopPerformanceMonitor();
  }
}

void syncTraceActiveState();

// --- Interaction trace: clicks and field values, while a trace is active ---

// Always-on, in-memory only: the last few user actions (labels, never typed
// values), so an error capture can show "what you did right before it". Never
// persisted on its own - it is only copied into an error record, and only when
// "Capturar erros" is enabled.
const INTERACTION_BUFFER_MAX = 12;
const interactionBuffer = [];

function pushInteraction(action, label) {
  const clean = String(label || "").trim().slice(0, 120);
  if (!clean) {
    return;
  }
  interactionBuffer.push({ t: new Date().toISOString(), action, label: clean });
  if (interactionBuffer.length > INTERACTION_BUFFER_MAX) {
    interactionBuffer.splice(0, interactionBuffer.length - INTERACTION_BUFFER_MAX);
  }
}

function describeField(el) {
  const container = el.closest(".w-attr-container[w-attr-name]");
  if (container) {
    const label = container.querySelector(".w-attr-container__label, label")?.innerText?.trim();
    return label || container.getAttribute("w-attr-name");
  }

  const label = el.closest("label")?.innerText?.trim();
  if (label) {
    return label;
  }

  if (typeof el.className === "string" && el.className.toLowerCase().includes("search")) {
    return "Busca";
  }

  return el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.name || el.id || el.tagName.toLowerCase();
}

function describeClickTarget(el) {
  const clickable = el.closest("button, a, [role='button']");
  if (!clickable) {
    return null;
  }

  const text = clickable.innerText?.trim().split("\n")[0];
  return text || clickable.getAttribute("aria-label") || clickable.title || null;
}

document.addEventListener(
  "click",
  (event) => {
    if (!(event.target instanceof Element)) {
      return;
    }

    if (event.target.closest("input, select, textarea")) {
      return;
    }

    const label = describeClickTarget(event.target);
    if (!label) {
      return;
    }

    pushInteraction("click", label);

    if (!traceActive) {
      return;
    }

    void emitPerformanceTrace({
      kind: "interaction",
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      origin: window.location.origin,
      action: "click",
      label
    });
  },
  true
);

document.addEventListener(
  "change",
  (event) => {
    const target = event.target;
    const isFormField =
      target instanceof HTMLInputElement || target instanceof HTMLSelectElement || target instanceof HTMLTextAreaElement;
    if (!isFormField || target.type === "password") {
      return;
    }

    const label = describeField(target);

    pushInteraction("input", label);

    if (!traceActive) {
      return;
    }

    let value;
    if (target instanceof HTMLSelectElement) {
      value = target.options[target.selectedIndex]?.text || target.value;
    } else if (target.type === "checkbox" || target.type === "radio") {
      value = target.checked ? "marcado" : "desmarcado";
    } else {
      value = target.value;
    }

    void emitPerformanceTrace({
      kind: "interaction",
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      origin: window.location.origin,
      action: "input",
      label,
      value: String(value ?? "").slice(0, 200)
    });
  },
  true
);

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
  "inspectMode",
  "showReportLayout",
  "showWaterfall",
  "captureErrors"
];
const RECENT_FEATURES_KEY = "recentFeatures";
const RECENT_FEATURES_MAX = 20;
const DATA_DICTIONARY_KEY = "dataDictionary";
const DATA_DICTIONARY_MAX_ENTRIES = 3000;
const ENVIRONMENT_RULES_KEY = "environmentRules";
const SHOW_ESTABLISHMENT_KEY = "showEstablishment";

// Which app-server cluster node this session is pinned to (from the affinity
// cookie, read by the background via chrome.cookies). Loaded once; surfaced in
// the error report, the popup and the environment badge.
let serverNodeInfo = null;

async function loadServerNode() {
  if (!isTasyHostname(window.location.hostname)) {
    return;
  }
  try {
    const resp = await chrome.runtime.sendMessage({ type: "TASY_SERVER_NODE", url: window.location.href });
    serverNodeInfo = resp && resp.ok && resp.found ? resp : null;
  } catch (_error) {
    serverNodeInfo = null;
  }
  if (serverNodeInfo) {
    void sendMetadataOptions();
  }
}

async function sendMetadataOptions() {
  if (!isTasyHostname(window.location.hostname)) {
    return;
  }

  const data = await chrome.storage.local.get([
    ...METADATA_OPTION_KEYS,
    RECENT_FEATURES_KEY,
    ENVIRONMENT_RULES_KEY,
    SHOW_ESTABLISHMENT_KEY
  ]);
  const options = {};
  METADATA_OPTION_KEYS.forEach((key) => {
    options[key] = Boolean(data[key]);
  });
  options.recentFeatures = Array.isArray(data[RECENT_FEATURES_KEY]) ? data[RECENT_FEATURES_KEY] : [];
  options.environmentRules = Array.isArray(data[ENVIRONMENT_RULES_KEY]) ? data[ENVIRONMENT_RULES_KEY] : [];
  options.serverNode = serverNodeInfo ? { name: serverNodeInfo.name, node: serverNodeInfo.node } : null;
  options.showEstablishment = Boolean(data[SHOW_ESTABLISHMENT_KEY]);

  window.postMessage({ [METADATA_MSG_MARK]: true, type: "OPTIONS", options }, "*");
}

void loadServerNode();

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

async function upsertDictionaryEntry(entry) {
  if (!entry || !entry.kind || !entry.name) {
    return;
  }

  const key = `${entry.kind}:${entry.name}`;
  const data = await chrome.storage.local.get([DATA_DICTIONARY_KEY]);
  const dictionary = data[DATA_DICTIONARY_KEY] && typeof data[DATA_DICTIONARY_KEY] === "object" ? data[DATA_DICTIONARY_KEY] : {};

  const existing = dictionary[key];
  dictionary[key] = {
    kind: entry.kind,
    name: entry.name,
    label: entry.label || existing?.label || null,
    table: entry.table || existing?.table || null,
    view: entry.view ?? existing?.view ?? null,
    count: (existing?.count || 0) + 1,
    lastSeenAt: new Date().toISOString()
  };

  const keys = Object.keys(dictionary);
  if (keys.length > DATA_DICTIONARY_MAX_ENTRIES) {
    keys
      .sort((a, b) => new Date(dictionary[a].lastSeenAt) - new Date(dictionary[b].lastSeenAt))
      .slice(0, keys.length - DATA_DICTIONARY_MAX_ENTRIES)
      .forEach((staleKey) => delete dictionary[staleKey]);
  }

  await chrome.storage.local.set({ [DATA_DICTIONARY_KEY]: dictionary });
}

// --- Tasy error capture: read the app-server ERRO file, interpret, store ----

const ERROR_LOG_KEY = "errorCaptureLog";
const ERROR_LOG_MAX = 30;
const APP_SERVER_BASE_KEY = "appServerBaseUrl";
let errorWriteQueue = Promise.resolve();

function maskLongDigits(text) {
  return String(text == null ? "" : text).replace(/\d{6,}/g, (match) => "•".repeat(Math.min(match.length, 8)));
}

function firstQuotedIdentifier(text) {
  const match = String(text || "").match(/["'`“”]([A-Za-z_][A-Za-z0-9_$.#]{1,60})["'`“”]/);
  return match ? match[1] : "";
}

async function resolveAppServerBase(payloadOrigin) {
  const data = await chrome.storage.local.get([APP_SERVER_BASE_KEY]);
  let base = String(data[APP_SERVER_BASE_KEY] || "").trim();
  if (!base) {
    base = (payloadOrigin || window.location.origin) + "/TasyAppServer/";
  }
  if (!/\/$/.test(base)) {
    base += "/";
  }
  return base;
}

async function fetchAppServerText(url) {
  try {
    const response = await chrome.runtime.sendMessage({ type: "TASY_APPSERVER_FETCH", url });
    return response && typeof response === "object" ? response : { ok: false, reason: "no_response" };
  } catch (_error) {
    return { ok: false, reason: "sendmessage_failed" };
  }
}

function parseAppServerFolder(html) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(html, "text/html");
  } catch (_error) {
    return [];
  }
  return [...doc.querySelectorAll('a[href*="fileName="]')].map((link) => {
    const row = link.closest("tr");
    const cells = row ? [...row.querySelectorAll("td")].map((c) => c.textContent.trim()) : [];
    const name = link.textContent.trim();
    return {
      name,
      href: link.getAttribute("href") || "",
      tipo: cells[2] || name.split("_")[0] || "",
      dateText: cells[3] || ""
    };
  });
}

const APP_FRAME_RE = /^(com\.philips\.|br\.com\.wheb\.|com\.totvs\.|oracle\.jdbc\.)/;
const APP_FRAME_NOISE_RE = /^(sun\.reflect|java\.lang\.reflect|java\.lang\.Thread)/;

function pickAppFrames(stack) {
  return String(stack || "")
    .split("\n")
    .map((s) => s.trim())
    .filter((s) => s && APP_FRAME_RE.test(s) && !APP_FRAME_NOISE_RE.test(s))
    .slice(0, 14);
}

function parseAppServerParams(raw) {
  const inner = String(raw || "").replace(/^\{|\}$/g, "").trim();
  if (!inner) {
    return {};
  }
  const out = {};
  inner.split(/,\s*(?=[A-Za-z0-9_]+=)/).forEach((pair) => {
    const eq = pair.indexOf("=");
    if (eq > 0) {
      out[pair.slice(0, eq).trim()] = pair.slice(eq + 1).trim();
    }
  });
  return out;
}

function parseAppServerErrorFile(html) {
  let text = "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    text = (doc.body ? doc.body.innerText : "").replace(/\r/g, "");
  } catch (_error) {
    text = String(html || "").replace(/<[^>]+>/g, " ").replace(/\r/g, "");
  }

  const grab = (label) => {
    const re = new RegExp(label + "\\s*\\n([\\s\\S]*?)(?=\\n(?:Error thrown|Additional info|Stack trace)\\b|$)", "i");
    const m = text.match(re);
    return m ? m[1].trim() : "";
  };

  const errorThrown = grab("Error thrown");
  const additional = grab("Additional info");
  const stack = grab("Stack trace");
  const exc =
    errorThrown.match(/^([\w.$]+(?:Exception|Error)):\s*(.+)$/m) ||
    text.match(/^([\w.$]+(?:Exception|Error)):\s*(.+)$/m);
  const paramsRaw = (additional.match(/Parameters:\s*(\{[\s\S]*?\})/i) || [])[1] || "";

  return {
    exceptionClass: exc ? exc[1].trim() : "",
    message: exc ? exc[2].trim() : (errorThrown.split("\n")[0] || "").trim(),
    iface: ((additional.match(/Interface:\s*(.+)/i) || [])[1] || "").trim(),
    action: ((additional.match(/Action:\s*(.+)/i) || [])[1] || "").trim(),
    parametersRaw: maskLongDigits(paramsRaw).trim(),
    parameters: parseAppServerParams(maskLongDigits(paramsRaw)),
    appFrames: pickAppFrames(stack),
    rawText: maskLongDigits(text).slice(0, 6000)
  };
}

// Framework/plumbing trace files - never the "process" query the consultant wants.
const SQL_NOISE_NAME_RE = /^SQL_(W_CONSULTA_PADRAO|CONSULTA_PADRAO_OBTER_DIC_OBJETO|BUCKET|STORAGE_PATH|CONTA_REGISTROS|sql|GET_DATA|GET_MULTIPLE_TEXTS|SYSDATE|SQL_GET_DOMAINS|SQL_ROUTES|ARMAZENA_SQL|LOG_)/i;

function parseAppServerSqlFile(html) {
  let text = "";
  try {
    const doc = new DOMParser().parseFromString(html, "text/html");
    text = (doc.body ? doc.body.innerText : "").replace(/\r/g, "");
  } catch (_error) {
    text = String(html || "").replace(/<[^>]+>/g, " ").replace(/\r/g, "");
  }

  const withParams = (text.match(/SQL with its parameters\s*\n(?:Time\s*->[^\n]*\n)?\s*([\s\S]*?)(?=\n\s*Parameters\b|\n\s*SQL Stack trace\b|$)/i) || [])[1] || "";
  const firstSql = (text.match(/((?:SELECT|INSERT|UPDATE|DELETE|MERGE|BEGIN|CALL|WITH)\b[\s\S]*?)(?=\n\s*SQL with its parameters\b|\n\s*Parameters\b|\n\s*SQL Stack trace\b|$)/i) || [])[1] || "";
  const sql = (withParams || firstSql).trim();
  const tables = [...sql.matchAll(/\b(?:FROM|JOIN|UPDATE|INTO|MERGE\s+INTO)\s+([A-Za-z_][A-Za-z0-9_$]*)/gi)]
    .map((m) => m[1].toUpperCase())
    .filter((t) => !["DUAL"].includes(t));

  return { sql: maskLongDigits(sql).slice(0, 2200), tables: [...new Set(tables)] };
}

// The SQL/procedure files listed right before the ERRO ran in the same
// operation. Grab the first few meaningful ones so the report can show the
// real queries + tables + bind values behind a vague error.
async function fetchInvolvedQueries(entries, erroIndex, base) {
  const candidates = entries
    .slice(erroIndex + 1)
    .filter((e) => /^(SQL_|PROCEDURE_|W_PROCEDURE_)/i.test(e.name) && !SQL_NOISE_NAME_RE.test(e.name))
    .slice(0, 3);

  const out = [];
  for (const entry of candidates) {
    let url;
    try {
      url = new URL(entry.href, base).href;
    } catch (_error) {
      url = base + entry.href.replace(/^\.?\//, "");
    }
    const resp = await fetchAppServerText(url + (url.includes("?") ? "&" : "?") + "_=" + Date.now());
    if (resp.ok && !resp.looksLikeLogin) {
      const parsed = parseAppServerSqlFile(resp.body);
      if (parsed.sql) {
        out.push({ name: entry.name.replace(/_\s*\d*ms\.html$/i, ""), sql: parsed.sql, tables: parsed.tables });
      }
    }
  }
  return out;
}

async function fetchAndParseAppServerError(payload) {
  const user = String(payload.user || "").trim().slice(0, 14);
  if (!user) {
    return { status: "no_user" };
  }
  const base = await resolveAppServerBase(payload.origin);

  const listUrl = base + "wheb_arquivo.jsp?user=" + encodeURIComponent(user) + "&t=1&_=" + Date.now();
  const list = await fetchAppServerText(listUrl);
  const entries = list.ok && !list.looksLikeLogin ? parseAppServerFolder(list.body) : [];
  const erroIndex = entries.findIndex((e) => /^ERRO_/i.test(e.name) || /^ERRO\b/i.test(e.tipo));
  const involvedQueries = erroIndex >= 0 ? await fetchInvolvedQueries(entries, erroIndex, base) : [];

  if (payload.moreInfoHref && /fileName=/i.test(payload.moreInfoHref)) {
    const direct = await fetchAppServerText(payload.moreInfoHref);
    if (direct.ok && !direct.looksLikeLogin) {
      return { status: "ok", base, fileName: "(link do diálogo)", fileDate: "", involvedQueries, ...parseAppServerErrorFile(direct.body) };
    }
  }

  if (!list.ok || list.looksLikeLogin) {
    return { status: list.looksLikeLogin ? "needs_login" : "unreachable", base, reason: list.reason || list.status };
  }
  if (erroIndex < 0) {
    return { status: "no_erro_file", base };
  }

  const erroEntry = entries[erroIndex];
  let fileUrl;
  try {
    fileUrl = new URL(erroEntry.href, base).href;
  } catch (_error) {
    fileUrl = base + erroEntry.href.replace(/^\.?\//, "");
  }
  const file = await fetchAppServerText(fileUrl + (fileUrl.includes("?") ? "&" : "?") + "_=" + Date.now());
  if (!file.ok || file.looksLikeLogin) {
    return { status: file.looksLikeLogin ? "needs_login" : "file_unreachable", base };
  }

  return {
    status: "ok",
    base,
    fileName: erroEntry.name,
    fileDate: erroEntry.dateText,
    involvedQueries,
    ...parseAppServerErrorFile(file.body)
  };
}

function interpretErrorClass({ text, version }) {
  const body = String(text || "");
  const name = firstQuotedIdentifier(body);
  const nameRef = name ? " (`" + name + "`)" : "";
  const vRef = version ? " (versão " + version + ")" : "";

  const rules = [
    {
      re: /nome de coluna inv[aá]lid|invalid column name|ORA-00904|getColumnIndex/i,
      signature: "Coluna inexistente no banco (SQL inválido)",
      what:
        "Uma consulta SQL tentou ler uma coluna que não existe no resultado/tabela" +
        nameRef +
        ". Obs.: esse erro do driver Oracle (`getColumnIndex`) NÃO informa o nome da coluna — nem o diálogo, nem o arquivo de erro trazem isso. As consultas do processo estão abaixo; a coluna inválida é uma que o código espera e que não aparece no SELECT (ou não existe na tabela).",
      causes: [
        "Banco de dados atrás da versão do app server (script de atualização/DDL pendente) — a tabela não tem a coluna nova que o código já usa.",
        "Objeto customizado (relatório, esquemático, regra, registro de prontuário, SQL dinâmico) apontando para uma coluna renomeada ou removida.",
        "View/consulta customizada que deixou de retornar uma coluna esperada."
      ],
      checks: [
        "Comparar o SELECT das consultas abaixo com as colunas reais das tabelas envolvidas — a que falta é a culpada.",
        "Confirmar se todos os scripts de atualização do banco foram aplicados" + vRef + ".",
        name
          ? "Procurar por `" + name + "` nos objetos customizados ligados ao processo (regra, esquemático, relatório, SQL)."
          : "Se for processo padrão sem customização, abrir chamado TOTVS com a versão, o Action e as consultas abaixo."
      ]
    },
    {
      re: /tabela ou view n[ãa]o existe|invalid object name|ORA-00942/i,
      signature: "Tabela ou view inexistente no banco",
      what: "Um SQL referencia uma tabela/view que não existe ou não está acessível neste banco" + nameRef + ".",
      causes: [
        "Objeto ainda não criado — script de criação/atualização não aplicado.",
        "Falta de sinônimo ou de permissão (GRANT).",
        "Objeto customizado apontando para tabela removida."
      ],
      checks: [
        name ? "Verificar no banco se `" + name + "` existe e está acessível ao usuário do Tasy." : "Verificar se o objeto existe e está acessível.",
        "Rodar a rotina de recriação de sinônimos/permissões, se aplicável.",
        "Conferir scripts de atualização pendentes" + vRef + "."
      ]
    },
    {
      re: /unique constraint|ORA-00001|duplicate key|chave duplicada|viola[çc][ãa]o.*(unique|exclusiv)/i,
      signature: "Registro duplicado (violação de unicidade)",
      what: "A gravação foi barrada porque já existe um registro com a mesma chave" + nameRef + ".",
      causes: ["Registro já cadastrado (mesmo código).", "Duplo clique em salvar.", "Integração reprocessando o mesmo dado."],
      checks: [
        "Verificar se o registro já não existe.",
        name ? "A constraint `" + name + "` aponta a tabela/campos em conflito." : "",
        "Se foi duplo clique, recarregar e gravar uma vez só."
      ]
    },
    {
      re: /ORA-02291|parent key not found|FOREIGN KEY constraint/i,
      signature: "Referência a registro inexistente (chave estrangeira)",
      what: "A gravação aponta para outro registro (FK) que não foi encontrado.",
      causes: ["Cadastro pai não existe ou foi excluído.", "Ordem de gravação/integração invertida."],
      checks: ["Conferir se o registro referenciado existe e está ativo.", name ? "A constraint `" + name + "` identifica o vínculo." : ""]
    },
    {
      re: /ORA-02292|child record found|REFERENCE constraint.*DELETE/i,
      signature: "Exclusão bloqueada por registros dependentes",
      what: "Não dá para excluir porque há registros vinculados a este.",
      causes: ["Existem movimentos/filhos usando este cadastro."],
      checks: ["Inativar em vez de excluir, ou remover antes os dependentes.", name ? "A constraint `" + name + "` indica a tabela dependente." : ""]
    },
    {
      re: /ORA-01400|cannot insert null|null into column|n[ãa]o pode ser (nul|vazi)/i,
      signature: "Campo obrigatório sem valor na gravação",
      what: "Um campo obrigatório ficou sem valor na hora de gravar" + nameRef + ".",
      causes: ["Campo obrigatório não preenchido.", "Uma regra limpou o valor antes de gravar.", "Rotina customizada não populou a coluna."],
      checks: [name ? "Preencher/verificar o campo correspondente a `" + name + "`." : "Revisar os campos obrigatórios da tela.", "Checar regras no evento de gravação."]
    },
    {
      re: /ORA-12899|value too large for column|string or binary data would be truncated/i,
      signature: "Valor maior que o tamanho da coluna",
      what: "O texto informado é maior do que o tamanho da coluna no banco" + nameRef + ".",
      causes: ["Digitou mais caracteres do que o campo suporta.", "Integração enviando valor longo."],
      checks: ["Reduzir o tamanho do valor.", name ? "Conferir o tamanho definido para `" + name + "`." : ""]
    },
    {
      re: /ORA-01722|invalid number|conversion failed.*to data type (int|numeric|bigint)/i,
      signature: "Texto usado onde se espera número",
      what: "Um valor de texto foi usado onde o sistema espera um número.",
      causes: ["Filtro/parâmetro digitado com letra ou símbolo.", "SQL customizado comparando texto com coluna numérica."],
      checks: ["Revisar os filtros/parâmetros informados.", "Em SQL customizado, conferir os tipos nas comparações."]
    },
    {
      re: /ORA-0(1858|1843)|not a valid month|invalid date|conversion failed.*to data type date/i,
      signature: "Data em formato inválido",
      what: "Uma data está em formato inválido ou fora do intervalo aceito.",
      causes: ["Parâmetro de data digitado errado.", "Máscara/idioma de data divergente do esperado."],
      checks: ["Conferir os campos de data do filtro.", "Verificar o formato de data do usuário."]
    },
    {
      re: /ORA-00054|resource busy|lock request time ?out|ORA-00060|deadlock/i,
      signature: "Registro bloqueado ou deadlock",
      what: "O registro está bloqueado por outra sessão/usuário, ou houve deadlock.",
      causes: ["Outro usuário editando o mesmo registro.", "Transação anterior travada.", "Job em execução na mesma tabela."],
      checks: ["Aguardar e repetir.", "Se persistir, checar sessões bloqueadas no banco (DBA)."]
    },
    {
      re: /ORA-06502|numeric or value error|PLS-\d+|ORA-06512/i,
      signature: "Erro dentro de bloco PL/SQL (function/procedure/trigger)",
      what: "Um objeto de programação do banco falhou (conversão de tipo, tamanho de variável, argumentos).",
      causes: ["Function/procedure/trigger customizada com problema.", "Dado fora do formato esperado pelo código."],
      checks: ["Identificar o objeto pelo stack do app server abaixo.", "Costuma exigir ajuste na customização ou chamado TOTVS."]
    },
    {
      re: /NullPointerException|java\.[\w.]+Exception(?!.*SQLException)|at com\.philips\.tasy/i,
      signature: "Falha na camada Java do servidor de aplicação",
      what: "O processo do lado servidor (Wheb) abortou por um erro no código Java — não é erro de banco.",
      causes: ["Falha em rotina server-side (relatório, esquemático, exportação, integração).", "Dado inesperado não tratado pelo código.", "Possível bug da versão."],
      checks: ["Reproduzir e anotar o passo exato.", "Usar Interface/Action/stack abaixo para achar o módulo.", "Geralmente é chamado TOTVS com o stack e a versão" + vRef + "."]
    }
  ];

  for (const rule of rules) {
    if (rule.re.test(body)) {
      return { signature: rule.signature, what: rule.what, causes: rule.causes.filter(Boolean), checks: rule.checks.filter(Boolean) };
    }
  }

  const ora = (body.match(/ORA-\d{5}/i) || [])[0];
  return {
    signature: ora ? "Erro do banco de dados Oracle (" + ora.toUpperCase() + ")" : "Erro não classificado automaticamente",
    what: ora
      ? "O banco retornou um erro Oracle. O texto completo está na seção do app server abaixo."
      : "Não foi possível classificar por um padrão conhecido. Use as seções abaixo (app server + diálogo) para a análise.",
    causes: ["Causa específica descrita na mensagem do servidor."],
    checks: [
      "Ler a mensagem completa do app server abaixo.",
      "Anexar este relatório" + vRef + " no chamado, com Interface/Action e o stack."
    ]
  };
}

function describeProcess(appServer) {
  if (!appServer || appServer.status !== "ok") {
    return "";
  }
  const parts = [];
  if (appServer.action) {
    parts.push("ação `" + appServer.action + "`" + (appServer.iface ? " (" + appServer.iface + ")" : ""));
  }
  const top = (appServer.appFrames || []).find((f) => /com\.philips\.tasy/.test(f)) || (appServer.appFrames || [])[0];
  if (top) {
    const m = top.match(/([\w$]+)\.([\w$]+)\(([\w$]+\.java:\d+)\)/);
    parts.push(m ? "falhou em `" + m[1] + "." + m[2] + "` (" + m[3] + ")" : top);
  }
  return parts.join(" — ");
}

function describeAbout(appServer) {
  if (!appServer || !appServer.parameters) {
    return "";
  }
  return Object.keys(appServer.parameters)
    .filter((k) => !/version|ds_base/i.test(k))
    .map((k) => k + "=" + appServer.parameters[k])
    .join(", ");
}

function errorClock(iso) {
  try {
    return new Date(iso).toLocaleTimeString("pt-BR");
  } catch (_error) {
    return "?";
  }
}

const APP_SERVER_STATUS_HINT = {
  no_user: "não identifiquei seu usuário no Tasy",
  needs_login: "sem sessão ativa no console do app server (abra-o uma vez e repita)",
  unreachable: "não consegui acessar a URL base do app server (confira no popup)",
  file_unreachable: "achei a pasta mas não abri o arquivo de erro",
  no_erro_file: "nenhum arquivo ERRO recente na sua pasta do app server",
  no_response: "o serviço da extensão não respondeu"
};

function buildErrorReportText(record) {
  const app = record.appServer || {};
  const L = [];
  L.push("RELATÓRIO DE ERRO — Tasy DevTools");
  L.push("Capturado em: " + (() => { try { return new Date(record.capturedAt).toLocaleString("pt-BR"); } catch (_e) { return record.capturedAt; } })());
  L.push("Ambiente: " + record.environment);
  if (record.establishment) L.push("Estabelecimento: " + record.establishment);
  if (record.serverNode) L.push("Servidor (nó): " + record.serverNode.node + "  [cookie " + record.serverNode.name + "]");
  if (record.version) L.push("Versão TASY: " + record.version);
  if (record.user) L.push("Usuário: " + record.user);
  if (record.screen) {
    const s = [record.screen.code ? "[" + record.screen.code + "]" : "", record.screen.caption || record.screen.name || ""].filter(Boolean).join(" ");
    if (s) L.push("Tela/processo: " + s);
  }
  if (record.repeat && record.repeat.countToday > 1) {
    L.push("");
    L.push(
      "⚠ ESTE ERRO JÁ ACONTECEU: " +
        record.repeat.countToday +
        "× hoje (1ª vez às " +
        (() => { try { return new Date(record.repeat.firstToday).toLocaleTimeString("pt-BR"); } catch (_e) { return "?"; } })() +
        ")."
    );
  }
  L.push("");
  L.push("== O QUE ACONTECEU ==");
  L.push(record.interpretation.what);
  L.push("");
  L.push("== EM QUAL PROCESSO ==");
  L.push(record.interpretation.where || "(sem detalhe do app server)");
  if (app.status === "ok" && app.fileName) {
    L.push("Arquivo do app server: " + app.fileName + (app.fileDate ? " (" + app.fileDate + ")" : ""));
  }
  if (record.interpretation.about) {
    L.push("");
    L.push("== SOBRE O QUÊ ==");
    L.push(record.interpretation.about);
  }
  L.push("");
  L.push("== CAUSA PROVÁVEL ==");
  record.interpretation.causes.forEach((c) => L.push("- " + c));
  L.push("");
  L.push("== O QUE VERIFICAR ==");
  record.interpretation.checks.forEach((c) => L.push("- " + c));
  L.push("");
  L.push("== ERRO DO APP SERVER ==");
  if (app.status === "ok") {
    if (app.exceptionClass || app.message) L.push("Exceção: " + [app.exceptionClass, app.message].filter(Boolean).join(": "));
    if (app.iface) L.push("Interface: " + app.iface);
    if (app.action) L.push("Action: " + app.action);
    if (app.parametersRaw) L.push("Parameters: " + app.parametersRaw);
    if (app.appFrames && app.appFrames.length) {
      L.push("Stack (frames relevantes):");
      app.appFrames.forEach((f) => L.push("  " + f));
    }
  } else {
    L.push("Não foi possível ler o app server: " + (APP_SERVER_STATUS_HINT[app.status] || app.status || "motivo desconhecido") + ".");
    L.push("Ajuste a URL base / a sessão do console em: popup da extensão → Capturar erros.");
  }
  if (app.involvedQueries && app.involvedQueries.length) {
    L.push("");
    L.push("== CONSULTAS DO PROCESSO (rodaram logo antes do erro) ==");
    app.involvedQueries.forEach((q) => {
      L.push("• " + q.name + (q.tables && q.tables.length ? "   [tabelas: " + q.tables.join(", ") + "]" : ""));
      q.sql.split("\n").forEach((line) => L.push("    " + line.trim()));
      L.push("");
    });
  }
  L.push("");
  L.push("== DIÁLOGO ORIGINAL DO TASY ==");
  L.push((record.fullText || record.summary || "").trim());
  if (record.interactions && record.interactions.length) {
    L.push("");
    L.push("== ÚLTIMAS AÇÕES ANTES DO ERRO ==");
    record.interactions.slice().reverse().forEach((i) => {
      L.push("[" + errorClock(i.t) + "] " + (i.action === "click" ? "clique: " : "campo: ") + i.label);
    });
  }
  if (record.requests && record.requests.length) {
    L.push("");
    L.push("== CHAMADAS DE BACKEND (cliente, mais recentes) ==");
    record.requests.slice().reverse().forEach((c) => {
      L.push(
        "[" + errorClock(c.t) + "] " + c.method + " " + c.url +
        " -> HTTP " + (c.httpStatus == null ? "?" : c.httpStatus) +
        " (" + (c.durationMs == null ? "?" : c.durationMs) + "ms)" +
        (c.suspect ? "   <== provável causadora" : "")
      );
      if (c.responseBody) {
        L.push("    resposta: " + c.responseBody.replace(/\s+/g, " ").trim().slice(0, 800));
      }
    });
  }
  L.push("");
  L.push("Obs.: revise este conteúdo antes de compartilhar — pode conter dados sensíveis.");
  return L.join("\n");
}

async function handleErrorCaptured(payload) {
  if (!payload || typeof payload !== "object") {
    return;
  }
  const store = await chrome.storage.local.get(["captureErrors", RECENT_FEATURES_KEY]);
  if (!store.captureErrors) {
    return;
  }

  let appServer = { status: "skipped" };
  try {
    appServer = await fetchAndParseAppServerError(payload);
  } catch (_error) {
    appServer = { status: "error" };
  }

  const recent = Array.isArray(store[RECENT_FEATURES_KEY]) ? store[RECENT_FEATURES_KEY] : [];
  const screen = recent[0]
    ? { code: recent[0].code, name: recent[0].name, caption: recent[0].caption }
    : (payload.screenHint ? { caption: payload.screenHint } : null);

  const apiCalls = Array.isArray(payload.apiCalls) ? payload.apiCalls : [];
  const interpretationText = [
    payload.summary,
    payload.detalhes,
    payload.fullText,
    appServer.status === "ok" ? [appServer.exceptionClass, appServer.message, appServer.rawText].filter(Boolean).join("\n") : "",
    ...apiCalls.map((c) => c.responseBody).filter(Boolean)
  ].filter(Boolean).join("\n");

  const version = payload.version || (appServer.parameters && appServer.parameters.CD_VERSION) || "";
  const base = interpretErrorClass({ text: interpretationText, version });

  const involvedTables = [
    ...new Set((appServer.involvedQueries || []).flatMap((q) => q.tables || []))
  ];
  if (involvedTables.length && /coluna inexistente|tabela ou view/i.test(base.signature)) {
    base.checks = [`Tabelas envolvidas no processo: ${involvedTables.join(", ")} — comparar as colunas reais delas com o SELECT das consultas abaixo.`, ...base.checks];
  }

  const record = {
    id: crypto.randomUUID(),
    capturedAt: payload.capturedAt || new Date().toISOString(),
    environment: window.location.hostname,
    version,
    user: payload.user || "",
    screen,
    title: payload.title || "",
    summary: payload.summary || "",
    moreInfo: payload.moreInfo || "",
    fullText: payload.fullText || "",
    establishment: payload.establishment || "",
    serverNode: serverNodeInfo ? { name: serverNodeInfo.name, node: serverNodeInfo.node } : null,
    appServer,
    interpretation: {
      signature: base.signature,
      what: base.what,
      where: describeProcess(appServer),
      about: describeAbout(appServer),
      causes: base.causes,
      checks: base.checks,
      origin: appServer.iface ? "Interface: " + appServer.iface : (payload.moreInfo || "")
    },
    interactions: interactionBuffer.slice(-INTERACTION_BUFFER_MAX),
    requests: apiCalls.map((c) => ({
      t: c.t,
      method: c.method,
      url: c.url,
      httpStatus: c.httpStatus,
      ok: c.ok,
      durationMs: c.durationMs,
      responseBody: c.responseBody || null,
      suspect: c.ok === false || (typeof c.httpStatus === "number" && c.httpStatus >= 400)
    }))
  };
  record.reportText = buildErrorReportText(record);

  errorWriteQueue = errorWriteQueue
    .then(async () => {
      const current = await chrome.storage.local.get([ERROR_LOG_KEY]);
      const list = Array.isArray(current[ERROR_LOG_KEY]) ? current[ERROR_LOG_KEY] : [];

      const key = errorDedupeKey(record);
      let today = "";
      try {
        today = new Date(record.capturedAt).toDateString();
      } catch (_error) {
        today = "";
      }
      const sameToday = list.filter((r) => {
        if (r.repeatKey !== key) {
          return false;
        }
        try {
          return new Date(r.capturedAt).toDateString() === today;
        } catch (_error) {
          return false;
        }
      });
      record.repeatKey = key;
      record.repeat = {
        countToday: sameToday.length + 1,
        firstToday: sameToday.length ? sameToday[0].capturedAt : record.capturedAt
      };
      record.reportText = buildErrorReportText(record);

      await chrome.storage.local.set({ [ERROR_LOG_KEY]: [...list, record].slice(-ERROR_LOG_MAX) });
    })
    .catch(() => {});
  await errorWriteQueue;

  showErrorPanel(record);
}

function errorDedupeKey(record) {
  const params = (record.appServer && record.appServer.parameters) || {};
  const idParam =
    params.CD_PERFIL || params.CD_RELATORIO || params.NR_SEQUENCIA || params.CD_ESTABELECIMENTO || params.NR_SEQ_REGISTRO || "";
  return [
    record.interpretation.signature,
    record.screen && record.screen.code ? record.screen.code : "",
    record.appServer && record.appServer.action ? record.appServer.action : "",
    idParam
  ]
    .join(" | ")
    .toLowerCase();
}

function showErrorPanel(record) {
  document.querySelectorAll(".tex-error-panel").forEach((el) => el.remove());

  const panel = document.createElement("div");
  panel.className = "tex-scope-container tex-error-panel";

  const header = document.createElement("div");
  header.className = "tex-scope-header tex-error-header";

  const title = document.createElement("div");
  title.className = "tex-scope-title";
  title.innerText =
    "Erro capturado — " +
    record.interpretation.signature +
    (record.repeat && record.repeat.countToday > 1 ? "  (×" + record.repeat.countToday + " hoje)" : "");

  const copyBtn = document.createElement("button");
  copyBtn.type = "button";
  copyBtn.className = "tex-error-copy";
  copyBtn.innerText = "Copiar relatório";
  copyBtn.addEventListener("click", () => {
    navigator.clipboard.writeText(record.reportText || buildErrorReportText(record)).then(
      () => {
        copyBtn.innerText = "Copiado!";
        window.setTimeout(() => { copyBtn.innerText = "Copiar relatório"; }, 900);
      },
      () => {}
    );
  });

  const close = document.createElement("button");
  close.type = "button";
  close.className = "tex-scope-close";
  close.innerText = "×";
  close.addEventListener("click", () => panel.remove());

  header.append(title, copyBtn, close);

  const content = document.createElement("div");
  content.className = "tex-scope-content";
  const pre = document.createElement("pre");
  pre.innerText = record.reportText || buildErrorReportText(record);
  content.appendChild(pre);

  panel.append(header, content);
  document.body.appendChild(panel);
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
    void emitPerformanceTrace({
      kind: "navigation",
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      origin: window.location.origin,
      label: data.feature?.caption || data.feature?.name || ""
    });
    return;
  }

  if (data.type === "FEATURE_REMOVED") {
    void removeRecentFeature(data.feature);
    return;
  }

  if (data.type === "API_CALL") {
    void emitPerformanceTrace({
      kind: "request",
      timestamp: new Date().toISOString(),
      pageUrl: window.location.href,
      origin: window.location.origin,
      ...data.entry
    });
    return;
  }

  if (data.type === "DICTIONARY_ENTRY") {
    void upsertDictionaryEntry(data.entry);
    return;
  }

  if (data.type === "TASY_ERROR_CAPTURED") {
    void handleErrorCaptured(data.payload);
  }
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  const relevantKeys = [...METADATA_OPTION_KEYS, RECENT_FEATURES_KEY, ENVIRONMENT_RULES_KEY, SHOW_ESTABLISHMENT_KEY];
  if (relevantKeys.some((key) => key in changes)) {
    void sendMetadataOptions();
  }

  if (TRACE_ACTIVE_KEY in changes) {
    void syncTraceActiveState();
  }
});

void sendMetadataOptions();
