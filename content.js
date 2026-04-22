const BADGE_ID = "tasy-server-badge";
const BADGE_MARGIN = 8;

let currentDrag = null;

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
  if (payload?.badgeCoordinates && Number.isFinite(Number(payload.badgeCoordinates.x)) && Number.isFinite(Number(payload.badgeCoordinates.y))) {
    applyBadgeCoordinates(badge, payload.badgeCoordinates);
  } else {
    applyBadgePosition(badge, payload?.badgePosition || "bottom-right");
  }
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
