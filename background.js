const COOKIE_NAME = "TASYAPPSERVER_TASY";

function isHttpOrHttps(url) {
  return Boolean(url) && (url.startsWith("http://") || url.startsWith("https://"));
}

function extractServerId(text) {
  const normalized = String(text || "").trim();
  if (!normalized) {
    return "-";
  }

  const underscoreMatch = normalized.match(/_(\d{3})(?!.*\d)/);
  if (underscoreMatch) {
    return underscoreMatch[1];
  }

  const fallbackMatch = normalized.match(/(\d{3})(?!.*\d)/);
  return fallbackMatch ? fallbackMatch[1] : "-";
}

async function getConfiguredDomain() {
  const data = await chrome.storage.local.get(["configuredDomain"]);
  return (data.configuredDomain || "").trim().toLowerCase();
}

async function isServerFlagEnabled() {
  const data = await chrome.storage.local.get(["showServerFlag"]);
  return Boolean(data.showServerFlag);
}

async function getBadgePosition() {
  const data = await chrome.storage.local.get(["badgePosition"]);
  const valid = new Set(["top-right", "top-left", "bottom-right", "bottom-left"]);
  return valid.has(data.badgePosition) ? data.badgePosition : "bottom-right";
}

async function getBadgeCoordinates() {
  const data = await chrome.storage.local.get(["badgeCoordinates"]);
  const x = Number(data.badgeCoordinates?.x);
  const y = Number(data.badgeCoordinates?.y);
  if (Number.isFinite(x) && Number.isFinite(y)) {
    return { x, y };
  }

  return null;
}

async function resolveCookieUrlForTab(tab) {
  const configuredDomain = await getConfiguredDomain();

  if (configuredDomain) {
    let preferredScheme = "https:";
    if (tab && isHttpOrHttps(tab.url)) {
      const parsed = new URL(tab.url);
      if (parsed.hostname.toLowerCase() === configuredDomain) {
        preferredScheme = parsed.protocol;
      }
    }

    return `${preferredScheme}//${configuredDomain}/`;
  }

  if (tab && isHttpOrHttps(tab.url)) {
    return tab.url;
  }

  return null;
}

async function getCookieByUrlHints(url, name) {
  if (!url) {
    return null;
  }

  const found = await chrome.cookies.get({ url, name });
  if (found) {
    return found;
  }

  const parsed = new URL(url);
  const alternateProtocol = parsed.protocol === "https:" ? "http:" : "https:";
  const alternateUrl = `${alternateProtocol}//${parsed.host}/`;
  return chrome.cookies.get({ url: alternateUrl, name });
}

async function getServerBadgePayloadForTab(tab) {
  const badgePosition = await getBadgePosition();
  const badgeCoordinates = await getBadgeCoordinates();
  const enabled = await isServerFlagEnabled();
  if (!enabled) {
    return { enabled: false, serverId: "-", badgePosition, badgeCoordinates };
  }

  const cookieUrl = await resolveCookieUrlForTab(tab);
  if (!cookieUrl) {
    return { enabled: false, serverId: "-", badgePosition, badgeCoordinates };
  }

  const cookie = await getCookieByUrlHints(cookieUrl, COOKIE_NAME);
  if (!cookie) {
    return { enabled: true, serverId: "-", badgePosition, badgeCoordinates };
  }

  return {
    enabled: true,
    serverId: extractServerId(cookie.value),
    badgePosition,
    badgeCoordinates,
    cookieValue: cookie.value || ""
  };
}

async function syncBadgeToTabId(tabId) {
  try {
    const tab = await chrome.tabs.get(tabId);
    if (!tab || !isHttpOrHttps(tab.url)) {
      return;
    }

    const payload = await getServerBadgePayloadForTab(tab);
    await chrome.tabs.sendMessage(tabId, {
      type: "TASY_SERVER_BADGE_UPDATE",
      payload
    });
  } catch (_error) {
  }
}

async function syncBadgeToAllHttpTabs() {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (typeof tab.id === "number" && isHttpOrHttps(tab.url)) {
      await syncBadgeToTabId(tab.id);
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || typeof message !== "object") {
    return;
  }

  if (message.type === "TASY_REQUEST_SERVER_BADGE_SYNC") {
    (async () => {
      const tabId = typeof message.tabId === "number" ? message.tabId : sender.tab?.id;
      if (typeof tabId === "number") {
        await syncBadgeToTabId(tabId);
      }
      sendResponse({ ok: true });
    })();
    return true;
  }

  if (message.type === "TASY_GET_SERVER_BADGE_STATE") {
    (async () => {
      const tab = sender.tab || null;
      const payload = await getServerBadgePayloadForTab(tab);
      sendResponse(payload);
    })();
    return true;
  }
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  await syncBadgeToTabId(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener(async (tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || typeof changeInfo.url === "string") {
    if (isHttpOrHttps(tab.url)) {
      await syncBadgeToTabId(tabId);
    }
  }
});

chrome.cookies.onChanged.addListener(async (changeInfo) => {
  if (changeInfo.cookie?.name === COOKIE_NAME) {
    await syncBadgeToAllHttpTabs();
  }
});

chrome.storage.onChanged.addListener(async (changes, areaName) => {
  if (areaName !== "local") {
    return;
  }

  if (changes.showServerFlag || changes.configuredDomain || changes.badgePosition || changes.badgeCoordinates) {
    await syncBadgeToAllHttpTabs();
  }
});
