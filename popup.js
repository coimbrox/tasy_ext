const COOKIE_NAME = "TASYAPPSERVER_TASY";
const PRESET_DOMAINS = [
  "tasy.circulosaude.com.br",
  "tasyhml.circulosaude.com.br"
];

const domainEl = document.getElementById("domain");
const domainPresetEl = document.getElementById("domainPreset");
const customDomainEl = document.getElementById("customDomain");
const saveDomainBtn = document.getElementById("saveDomainBtn");
const showServerFlagEl = document.getElementById("showServerFlag");
const badgePositionEl = document.getElementById("badgePosition");
const currentValueEl = document.getElementById("currentValue");
const newValueEl = document.getElementById("newValue");
const refreshBtn = document.getElementById("refreshBtn");
const saveBtn = document.getElementById("saveBtn");
const copyTraceBtn = document.getElementById("copyTraceBtn");
const clearTraceBtn = document.getElementById("clearTraceBtn");
const statusEl = document.getElementById("status");

let activeTab = null;
let targetCookieUrl = null;
let lastCookie = null;

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = `status ${type}`.trim();
}

function isHttpOrHttps(url) {
  return url && (url.startsWith("http://") || url.startsWith("https://"));
}

function isValidHostname(hostname) {
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(hostname);
}

function normalizeBadgePosition(position) {
  const validPositions = new Set(["top-right", "top-left", "bottom-right", "bottom-left"]);
  return validPositions.has(position) ? position : "bottom-right";
}

function normalizeCookieValue(value) {
  const text = String(value || "");
  try {
    return decodeURIComponent(text);
  } catch (_error) {
    return text;
  }
}

function cookieValueMatches(actualValue, expectedValue) {
  return normalizeCookieValue(actualValue) === normalizeCookieValue(expectedValue);
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripLeadingDot(hostname) {
  return String(hostname || "").replace(/^\./, "").toLowerCase();
}

function hostnameMatchesCookieDomain(hostname, cookieDomain) {
  const normalizedHost = stripLeadingDot(hostname);
  const normalizedCookieDomain = stripLeadingDot(cookieDomain);
  return (
    normalizedHost === normalizedCookieDomain ||
    normalizedHost.endsWith(`.${normalizedCookieDomain}`)
  );
}

function buildCookieUrlFromCookie(cookie, fallbackUrl) {
  const fallback = new URL(fallbackUrl);
  const hostname = stripLeadingDot(cookie.domain) || fallback.hostname;
  const protocol = cookie.secure ? "https:" : fallback.protocol;
  const path = cookie.path || "/";
  return `${protocol}//${hostname}${path}`;
}

async function getEditableCookies(baseCookie, fallbackUrl) {
  const parsed = new URL(fallbackUrl);
  const hostname = parsed.hostname.toLowerCase();

  const allSameName = await chrome.cookies.getAll({
    name: COOKIE_NAME,
    storeId: baseCookie.storeId
  });

  const scoped = allSameName.filter((cookie) => hostnameMatchesCookieDomain(hostname, cookie.domain));

  if (scoped.length > 0) {
    return scoped;
  }

  return [baseCookie];
}

async function getActiveTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

async function requestBadgeSync() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number") {
    return;
  }

  await chrome.runtime.sendMessage({
    type: "TASY_REQUEST_SERVER_BADGE_SYNC",
    tabId: tab.id
  });
}

async function hardReloadActiveTab() {
  const tab = await getActiveTab();
  if (!tab || typeof tab.id !== "number" || !isHttpOrHttps(tab.url)) {
    return false;
  }

  await chrome.tabs.reload(tab.id, { bypassCache: true });
  return true;
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

function getConfiguredDomainFromUi() {
  const selected = domainPresetEl.value;

  if (selected === "auto") {
    return "";
  }

  if (selected === "custom") {
    return customDomainEl.value.trim().toLowerCase();
  }

  return selected;
}

function refreshCustomDomainState() {
  const isCustom = domainPresetEl.value === "custom";
  customDomainEl.disabled = !isCustom;
  if (isCustom) {
    customDomainEl.focus();
  }
}

async function loadDomainConfig() {
  const data = await chrome.storage.local.get(["configuredDomain", "showServerFlag", "badgePosition"]);
  const configuredDomain = (data.configuredDomain || "").toLowerCase();
  showServerFlagEl.checked = Boolean(data.showServerFlag);
  badgePositionEl.value = normalizeBadgePosition(data.badgePosition);

  if (!configuredDomain) {
    domainPresetEl.value = "auto";
    customDomainEl.value = "";
    refreshCustomDomainState();
    return;
  }

  if (PRESET_DOMAINS.includes(configuredDomain)) {
    domainPresetEl.value = configuredDomain;
    customDomainEl.value = "";
    refreshCustomDomainState();
    return;
  }

  domainPresetEl.value = "custom";
  customDomainEl.value = configuredDomain;
  refreshCustomDomainState();
}

async function saveDomainConfig() {
  const configuredDomain = getConfiguredDomainFromUi();

  if (domainPresetEl.value === "custom" && !configuredDomain) {
    throw new Error("Informe o domínio personalizado.");
  }

  if (configuredDomain && !isValidHostname(configuredDomain)) {
    throw new Error("Domínio inválido. Exemplo: tasy.circulosaude.com.br");
  }

  await chrome.storage.local.set({
    configuredDomain,
    showServerFlag: Boolean(showServerFlagEl.checked),
    badgePosition: normalizeBadgePosition(badgePositionEl.value)
  });
}

async function getConfiguredDomain() {
  const data = await chrome.storage.local.get(["configuredDomain"]);
  const configuredDomain = (data.configuredDomain || "").trim().toLowerCase();
  return configuredDomain;
}

async function resolveContext() {
  activeTab = await getActiveTab();
  const configuredDomain = await getConfiguredDomain();

  if (configuredDomain) {
    let preferredScheme = "https:";
    if (activeTab && isHttpOrHttps(activeTab.url)) {
      const activeUrl = new URL(activeTab.url);
      if (activeUrl.hostname.toLowerCase() === configuredDomain) {
        preferredScheme = activeUrl.protocol;
      }
    }

    targetCookieUrl = `${preferredScheme}//${configuredDomain}/`;
    domainEl.textContent = `${configuredDomain} (configurado)`;
    return;
  }

  const tab = activeTab;

  if (!tab || !tab.url) {
    throw new Error("Não foi possível identificar a aba ativa.");
  }

  if (!isHttpOrHttps(tab.url)) {
    throw new Error("Abra uma aba HTTP/HTTPS do TASY para usar a extensão.");
  }

  targetCookieUrl = tab.url;
  const parsed = new URL(targetCookieUrl);
  domainEl.textContent = parsed.hostname;
}

async function getCookieByUrlHints(url, name) {
  const found = await chrome.cookies.get({ url, name });
  if (found) {
    return found;
  }

  const parsed = new URL(url);
  const alternateProtocol = parsed.protocol === "https:" ? "http:" : "https:";
  const alternateUrl = `${alternateProtocol}//${parsed.host}/`;
  return chrome.cookies.get({ url: alternateUrl, name });
}

async function getCookieByIdentity(savedCookie, fallbackUrl) {
  if (!savedCookie) {
    return getCookieByUrlHints(fallbackUrl, COOKIE_NAME);
  }

  const filters = {
    name: COOKIE_NAME,
    domain: savedCookie.domain,
    path: savedCookie.path,
    storeId: savedCookie.storeId
  };

  const list = await chrome.cookies.getAll(filters);
  if (Array.isArray(list) && list.length > 0) {
    return list[0];
  }

  return getCookieByUrlHints(fallbackUrl, COOKIE_NAME);
}

async function waitForUpdatedCookie(expectedValue, savedCookieHint, maxAttempts = 5) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const candidate = await getCookieByIdentity(savedCookieHint, targetCookieUrl);
    if (candidate && cookieValueMatches(candidate.value, expectedValue)) {
      return candidate;
    }

    if (attempt < maxAttempts) {
      await delay(120);
    }
  }

  return null;
}

async function updateExistingCookieValue(cookie, newValue, fallbackUrl) {
  const details = {
    url: buildCookieUrlFromCookie(cookie, fallbackUrl),
    name: COOKIE_NAME,
    value: newValue,
    path: cookie.path,
    secure: cookie.secure,
    httpOnly: cookie.httpOnly,
    sameSite: cookie.sameSite,
    expirationDate: cookie.expirationDate,
    storeId: cookie.storeId
  };

  if (!cookie.hostOnly && cookie.domain) {
    details.domain = cookie.domain;
  }

  return chrome.cookies.set(details);
}

async function readCookie() {
  await resolveContext();

  lastCookie = await getCookieByUrlHints(targetCookieUrl, COOKIE_NAME);

  if (!lastCookie) {
    currentValueEl.value = "";
    setStatus(`Cookie ${COOKIE_NAME} não encontrado para esta URL.`, "warn");
    await requestBadgeSync();
    return;
  }

  currentValueEl.value = lastCookie.value || "";
  newValueEl.value = lastCookie.value || "";
  setStatus("Cookie carregado com sucesso.", "ok");
  await requestBadgeSync();
}

async function saveCookie() {
  await resolveContext();

  const newValue = newValueEl.value;
  if (newValue === "") {
    throw new Error("Informe um valor para salvar.");
  }

  let baseCookie = lastCookie;
  if (!baseCookie) {
    baseCookie = await getCookieByUrlHints(targetCookieUrl, COOKIE_NAME);
  }

  if (!baseCookie) {
    throw new Error(`Cookie ${COOKIE_NAME} não foi encontrado para este domínio/path.`);
  }

  setStatus("Recarregando página (1/2)...", "ok");
  await hardReloadActiveTab();
  await delay(300);

  const editableCookies = await getEditableCookies(baseCookie, targetCookieUrl);
  const saveResults = [];
  for (const cookie of editableCookies) {
    const saved = await updateExistingCookieValue(cookie, newValue, targetCookieUrl);
    if (saved) {
      saveResults.push(saved);
    }
  }

  if (saveResults.length === 0) {
    throw new Error("Não foi possível atualizar nenhum cookie existente.");
  }

  currentValueEl.value = newValue;
  lastCookie = await waitForUpdatedCookie(newValue, saveResults[0]);
  if (!lastCookie) {
    throw new Error("O cookie não foi atualizado com o novo valor.");
  }

  setStatus(`Cookie atualizado em ${saveResults.length} registro(s). Recarregando (2/2)...`, "ok");
  await requestBadgeSync();
  const reloaded = await hardReloadActiveTab();
  if (!reloaded) {
    setStatus("Cookie salvo com sucesso. Recarregue a página manualmente.", "warn");
  }
}

domainPresetEl.addEventListener("change", () => {
  refreshCustomDomainState();
});

showServerFlagEl.addEventListener("change", async () => {
  await chrome.storage.local.set({ showServerFlag: Boolean(showServerFlagEl.checked) });
  await requestBadgeSync();
});

badgePositionEl.addEventListener("change", async () => {
  const normalized = normalizeBadgePosition(badgePositionEl.value);
  badgePositionEl.value = normalized;
  await chrome.storage.local.set({ badgePosition: normalized, badgeCoordinates: null });
  await requestBadgeSync();
});

saveDomainBtn.addEventListener("click", async () => {
  setStatus("Salvando domínio...");
  try {
    await saveDomainConfig();
    setStatus("Domínio salvo. Lendo cookie...", "ok");
    await readCookie();
    await requestBadgeSync();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

refreshBtn.addEventListener("click", async () => {
  setStatus("Lendo cookie...");
  try {
    await readCookie();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

saveBtn.addEventListener("click", async () => {
  setStatus("Salvando cookie...");
  try {
    await saveCookie();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
});

copyTraceBtn.addEventListener("click", async () => {
  setStatus("Coletando trace...");
  try {
    const log = await getPerformanceTraceLog(180);
    if (log.length === 0) {
      setStatus("Ainda não há eventos de trace para copiar.", "warn");
      return;
    }

    const content = JSON.stringify(log, null, 2);
    await navigator.clipboard.writeText(content);
    setStatus(`Trace copiado (${log.length} evento(s)).`, "ok");
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
  setStatus("Carregando contexto da aba...");
  try {
    await loadDomainConfig();
    await readCookie();
  } catch (error) {
    setStatus(error.message || String(error), "error");
  }
})();
