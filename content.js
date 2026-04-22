const BADGE_ID = "tasy-server-badge";

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
  badge.style.pointerEvents = "none";
  badge.style.userSelect = "none";
  document.documentElement.appendChild(badge);
  return badge;
}

function removeBadgeElement() {
  const badge = document.getElementById(BADGE_ID);
  if (badge) {
    badge.remove();
  }
}

function renderBadge(payload) {
  const enabled = Boolean(payload?.enabled);
  if (!enabled) {
    removeBadgeElement();
    return;
  }

  const serverId = payload?.serverId && payload.serverId !== "-" ? payload.serverId : "N/D";
  const badge = ensureBadgeElement();
  applyBadgePosition(badge, payload?.badgePosition || "bottom-right");
  badge.textContent = `SRV ${serverId}`;
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
