/*
 * Runs in the TASY page's own JS context (world: "MAIN"), so it has direct
 * access to the page's AngularJS app (window.angular) to read scope data.
 * It never touches chrome.* APIs directly - those only exist in the isolated
 * content script (content.js), so this file talks to it via window.postMessage.
 */
(() => {
  const MSG_MARK = "__tasyExt";

  function angularScope(el) {
    if (!el || !window.angular || typeof window.angular.element !== "function") {
      return null;
    }
    try {
      return window.angular.element(el).scope() || null;
    } catch (_error) {
      return null;
    }
  }

  function sendToBridge(type, payload) {
    window.postMessage({ [MSG_MARK]: true, type, ...payload }, "*");
  }

  // --- Process trace: records every real API call TASY makes ----------------
  // (method, endpoint, status, duration), so clearing the log before doing
  // something in TASY and copying it after shows the actual backend trace of
  // that process - not just a synthetic latency probe.
  function isTasyHost() {
    return window.location.hostname.toLowerCase().includes("tasy");
  }

  function relativeUrl(rawUrl) {
    try {
      const parsed = new URL(rawUrl, window.location.href);
      return parsed.pathname + parsed.search;
    } catch (_error) {
      return typeof rawUrl === "string" ? rawUrl : null;
    }
  }

  const API_CALL_BUFFER_MAX = 20;
  const RESPONSE_BODY_MAX = 3000;
  const apiCallBuffer = [];

  // Masks runs of 6+ digits (prontuário, CPF, phone, internal ids) while
  // leaving short numbers like ORA-00904 or a version string intact.
  function maskLongDigits(text) {
    return String(text == null ? "" : text).replace(/\d{6,}/g, (match) => "•".repeat(Math.min(match.length, 8)));
  }

  function pushApiCallBuffer(entry) {
    apiCallBuffer.push({ t: new Date().toISOString(), ...entry });
    if (apiCallBuffer.length > API_CALL_BUFFER_MAX) {
      apiCallBuffer.splice(0, apiCallBuffer.length - API_CALL_BUFFER_MAX);
    }
  }

  function reportApiCall(entry, responseBody) {
    if (!entry.url || entry.url.includes("__tasy_probe")) {
      return;
    }
    const failed = entry.ok === false || (typeof entry.httpStatus === "number" && entry.httpStatus >= 400);
    const buffered = { ...entry };
    // Response bodies are only kept for calls that actually failed, and only
    // in this in-memory buffer - they leave the page only if an error dialog
    // is captured while the user has "Capturar erros" turned on.
    if (failed && typeof responseBody === "string" && responseBody.trim()) {
      buffered.responseBody = maskLongDigits(responseBody).slice(0, RESPONSE_BODY_MAX);
    }
    pushApiCallBuffer(buffered);
    sendToBridge("API_CALL", { entry });
  }

  if (isTasyHost()) {
    const originalFetch = window.fetch;
    if (typeof originalFetch === "function") {
      window.fetch = function patchedFetch(input, init) {
        const startedAt = performance.now();
        const rawUrl = typeof input === "string" ? input : input?.url;
        const method = (init && init.method) || (typeof input === "object" && input?.method) || "GET";
        const url = relativeUrl(rawUrl);
        return originalFetch.apply(this, arguments).then(
          (response) => {
            const call = {
              method: String(method).toUpperCase(),
              url,
              httpStatus: response.status,
              ok: response.ok,
              durationMs: Math.round(performance.now() - startedAt)
            };
            if (!response.ok) {
              response
                .clone()
                .text()
                .then((body) => reportApiCall(call, body), () => reportApiCall(call));
            } else {
              reportApiCall(call);
            }
            return response;
          },
          (error) => {
            reportApiCall({
              method: String(method).toUpperCase(),
              url,
              httpStatus: null,
              ok: false,
              durationMs: Math.round(performance.now() - startedAt)
            });
            throw error;
          }
        );
      };
    }

    const XHRProto = window.XMLHttpRequest && window.XMLHttpRequest.prototype;
    if (XHRProto) {
      const originalOpen = XHRProto.open;
      const originalSend = XHRProto.send;
      XHRProto.open = function patchedOpen(method, url, ...rest) {
        this.__tasyExtMethod = method;
        this.__tasyExtUrl = url;
        return originalOpen.call(this, method, url, ...rest);
      };
      XHRProto.send = function patchedSend(...args) {
        const startedAt = performance.now();
        this.addEventListener("loadend", () => {
          const ok = this.status >= 200 && this.status < 400;
          const call = {
            method: String(this.__tasyExtMethod || "GET").toUpperCase(),
            url: relativeUrl(this.__tasyExtUrl),
            httpStatus: this.status || null,
            ok,
            durationMs: Math.round(performance.now() - startedAt)
          };
          let body;
          if (!ok) {
            try {
              body = typeof this.responseText === "string" ? this.responseText : undefined;
            } catch (_error) {
              body = undefined;
            }
          }
          reportApiCall(call, body);
        });
        return originalSend.apply(this, args);
      };
    }
  }

  // Runs on the leading edge (so badges show up immediately on the first
  // relevant mutation) and once more on the trailing edge if more mutations
  // arrived meanwhile (so the render catches up with the final DOM state).
  function debounce(fn, delayMs) {
    let timer = null;
    let calledDuringWindow = false;
    return (...args) => {
      if (timer === null) {
        fn(...args);
      } else {
        calledDuringWindow = true;
      }
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        if (calledDuringWindow) {
          calledDuringWindow = false;
          fn(...args);
        }
      }, delayMs);
    };
  }

  // Lets the user drag `target` around the viewport by pressing on `handle`.
  // A plain click (no movement) on the handle still reaches its own click
  // listeners normally; only an actual drag suppresses the following click.
  function makeDraggable(handle, target) {
    let drag = null;
    let moved = false;
    handle.addEventListener("mousedown", (event) => {
      if (event.button !== 0) {
        return;
      }
      const rect = target.getBoundingClientRect();
      drag = { offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
      moved = false;
      event.preventDefault();
    });
    window.addEventListener("mousemove", (event) => {
      if (!drag) {
        return;
      }
      moved = true;
      target.style.position = "fixed";
      target.style.transform = "none";
      target.style.right = "auto";
      target.style.bottom = "auto";
      target.style.left = `${event.clientX - drag.offsetX}px`;
      target.style.top = `${event.clientY - drag.offsetY}px`;
    });
    window.addEventListener("mouseup", () => {
      if (drag && moved) {
        const suppressClick = (event) => {
          event.stopPropagation();
          event.preventDefault();
          handle.removeEventListener("click", suppressClick, true);
        };
        handle.addEventListener("click", suppressClick, true);
      }
      drag = null;
    });
  }

  // --- clipboard for every tex-copy-me / [data-clipboard] element ---------
  document.addEventListener("click", (event) => {
    const target = event.target.closest(".tex-copy-me, [data-clipboard]");
    if (!target) {
      return;
    }
    const text = target.dataset.clipboard || target.innerText || "";
    if (!text) {
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      const original = target.dataset.copyFeedback === "1" ? null : target.innerText;
      if (original === null) {
        return;
      }
      target.dataset.copyFeedback = "1";
      const previousText = target.innerText;
      target.innerText = "Copiado!";
      window.setTimeout(() => {
        target.innerText = previousText;
        delete target.dataset.copyFeedback;
      }, 700);
    }).catch(() => {});
  });

  // --- render engine --------------------------------------------------------
  class Renderer {
    constructor() {
      this._debouncedRender = debounce(this.render.bind(this), 150);
    }
    debouncedRender(options) {
      this._debouncedRender(options);
    }
  }

  class RenderManager {
    constructor() {
      this._options = {};
      this._renderers = [];
      this._observer = new MutationObserver(this._onMutations.bind(this));
      this._observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true
      });
    }
    add(renderer) {
      this._renderers.push(renderer);
    }
    setOptions(options) {
      this._options = options || {};
      this._renderers.forEach((renderer) => renderer.debouncedRender(this._options));
    }
    _onMutations(mutations) {
      for (const mutation of mutations) {
        this._renderers.forEach((renderer) => {
          if (renderer.condition(mutation)) {
            renderer.debouncedRender(this._options);
          }
        });
      }
    }
  }

  const manager = new RenderManager();

  // --- Field details: shows the DB column name above each form field --------
  class FieldDetailsRenderer extends Renderer {
    condition({ type, target, addedNodes }) {
      if (type === "characterData" && target.parentElement) {
        return Boolean(target.parentElement.closest(".w-attr-container"));
      }
      if (type === "childList") {
        for (const node of addedNodes.values()) {
          if (!node.querySelectorAll) {
            continue;
          }
          if (node.classList && node.classList.contains("w-attr-container")) {
            return true;
          }
          if (node.querySelector(".w-attr-container")) {
            return true;
          }
        }
      }
      return false;
    }
    render({ showFieldDetails }) {
      document.querySelectorAll("form.w-mdetail__container").forEach((form) => {
        form.classList.toggle("tex-form-mdetail", Boolean(showFieldDetails));
      });
      document.querySelectorAll(".tex-field-attr-container").forEach((el) => el.remove());
      if (!showFieldDetails) {
        return;
      }
      document.querySelectorAll(".w-attr-container[w-attr-name]").forEach((container) => {
        const attrName = container.getAttribute("w-attr-name");
        const locatorValue = [...container.querySelectorAll(".textbox-locator-container, .w-listbox")].reduce(
          (_acc, el) => {
            const scope = angularScope(el);
            return scope ? scope.value : "";
          },
          ""
        );
        const wrapper = document.createElement("div");
        wrapper.classList.add("tex-field-attr-container");
        wrapper.appendChild(this._createLabel(attrName));
        if (locatorValue) {
          wrapper.appendChild(this._createLabel(locatorValue));
        }
        container.insertAdjacentElement("afterbegin", wrapper);

        const label = container.querySelector(".w-attr-container__label")?.innerText?.trim();
        sendToBridge("DICTIONARY_ENTRY", { entry: { kind: "field", name: attrName, label: label || null } });
      });
    }
    _createLabel(text) {
      const span = document.createElement("span");
      span.classList.add("tex-fellow-label", "tex-field-attr-label", "tex-copy-me");
      span.innerText = text;
      span.title = text;
      return span;
    }
  }

  // --- Grid details: shows the DB column name in every grid header ----------
  class GridDetailsRenderer extends Renderer {
    condition({ type, addedNodes }) {
      if (type !== "childList") {
        return false;
      }
      for (const node of addedNodes.values()) {
        if (!node.querySelectorAll) {
          continue;
        }
        if (node.classList && node.classList.contains("slick-header-column")) {
          return true;
        }
        if (node.querySelector(".slick-header-column")) {
          return true;
        }
      }
      return false;
    }
    render({ showGridDetails }) {
      document.querySelectorAll(".tex-grid-label").forEach((el) => el.remove());
      document.querySelectorAll(".slick-pane-top").forEach((el) => {
        el.classList.toggle("tex-slick-pane-top", Boolean(showGridDetails));
      });
      document.querySelectorAll(".slick-header-column").forEach((el) => {
        el.classList.toggle("tex-slick-header-column", Boolean(showGridDetails));
      });
      document.querySelectorAll(".slick-viewport-top[data-original-height]").forEach((el) => {
        el.style.height = `${el.dataset.originalHeight}px`;
        el.removeAttribute("data-original-height");
      });
      if (!showGridDetails) {
        return;
      }
      document.querySelectorAll(".slick-viewport-top").forEach((el) => {
        if (!el.dataset.originalHeight) {
          el.dataset.originalHeight = el.style.height.replace(/\D+/g, "");
          el.style.height = `${Number(el.dataset.originalHeight) - 20}px`;
        }
      });
      document.querySelectorAll(".slick-header-column").forEach((el) => {
        const columnName = el.id.replace(/^slickgrid_\d+_?/, "");
        const headerText = el.innerText?.trim();
        const label = document.createElement("span");
        label.classList.add("tex-fellow-label", "tex-grid-label", "tex-copy-me");
        label.innerText = columnName;
        label.title = columnName;
        el.appendChild(label);

        sendToBridge("DICTIONARY_ENTRY", {
          entry: { kind: "grid-column", name: columnName, label: headerText || null }
        });
      });
    }
  }

  // --- Panel details: shows code / view / table for the panel a screen sits in
  const PANEL_EXTRACTORS = [
    {
      containerClass: "wdbpanel-container",
      extractor: (scope) => ({
        code: scope.handler.getDto().code,
        type: scope.dto.componentType,
        view: scope.wActivator?.dataSourceRequest?.nrSeqVisao || scope.dto.viewCodeInter,
        table: scope.wActivator?.dataSourceRequest?.tableName || scope.dto.viewName
      })
    },
    {
      containerClass: "wcpanel-container",
      extractor: (scope) => ({
        code: scope.dtoCode,
        type: scope.wcPanelClass.toUpperCase(),
        view: scope.wModel.viewNumber
      })
    },
    {
      containerClass: "w-dlg-panel",
      targetClass: "dialog-box",
      extractor: (scope) => ({
        code: scope.wcode,
        type: scope.internalSchematics.getRootDto().componentType,
        view: scope.internalSchematics.getRootDto().viewCode
      })
    },
    {
      containerClass: "detail-container-dialog",
      targetClass: "dialog-box",
      extractor: (scope) => ({
        code: scope.dto.code,
        type: scope.dto.componentType,
        view: scope.dto.viewCodeInter
      })
    },
    {
      containerClass: "calendar-container",
      extractor: (scope) => ({
        code: scope.wModel.menuconfig.parentDtoCode,
        type: "WCALENDAR"
      })
    }
  ];

  class PanelDetailsRenderer extends Renderer {
    condition({ type, target, addedNodes }) {
      if (type !== "childList") {
        return false;
      }
      for (const { containerClass } of PANEL_EXTRACTORS) {
        if (target.classList && target.classList.contains(containerClass) && !target.querySelector(".tex-panel-info-container")) {
          return true;
        }
        for (const node of addedNodes.values()) {
          if (!node.querySelectorAll) {
            continue;
          }
          if (node.classList && node.classList.contains(containerClass)) {
            return true;
          }
          if (node.querySelector(`.${containerClass}`)) {
            return true;
          }
        }
      }
      return false;
    }
    render({ showPanelDetails }) {
      document.querySelectorAll(".tex-panel-info-container").forEach((el) => el.remove());
      if (!showPanelDetails) {
        return;
      }
      PANEL_EXTRACTORS.forEach(({ containerClass, targetClass, extractor }) => {
        [...document.getElementsByClassName(containerClass)].forEach((container) => {
          const target = targetClass ? container.querySelector(`.${targetClass}`) : container;
          if (!target) {
            return;
          }
          const scope = angularScope(container);
          if (!scope) {
            return;
          }
          let extracted;
          try {
            extracted = extractor(scope);
          } catch (_error) {
            return;
          }
          const { code, type, view, table } = extracted;
          if (code && table) {
            sendToBridge("DICTIONARY_ENTRY", {
              entry: { kind: "panel", name: String(code), label: table, table, view: view ?? null }
            });
          }
          const info = document.createElement("div");
          info.classList.add("tex-panel-info-container");
          info.appendChild(this._createItem(code, type || "CODE"));
          if (view) {
            info.appendChild(this._createItem(view, "VIEW"));
          }
          if (table) {
            info.appendChild(this._createItem(table));
          }
          target.style.position = "relative";
          target.classList.add("tex-panel-info-host");
          // Compact rows (e.g. CPOE's stacked category swimlanes, ~49px tall)
          // don't have room for the badge next to the native title without
          // covering it - reveal those only on hover instead of always-on.
          if (target.getBoundingClientRect().height < 60) {
            info.classList.add("tex-panel-info-compact");
          }
          target.appendChild(info);
        });
      });
    }
    _createItem(value, label) {
      const div = document.createElement("div");
      div.classList.add("tex-fellow-label", "tex-panel-item", "tex-copy-me");
      div.dataset.clipboard = value;
      div.innerText = label ? `${label} ${value}` : value;
      div.title = value;
      return div;
    }
  }

  // --- Recent features: quick-access sidebar on the TASY launcher home ------
  class RecentFeaturesRenderer extends Renderer {
    constructor() {
      super();
      document.body.addEventListener("click", this._onClickApp.bind(this));
    }
    condition({ type, target, addedNodes }) {
      if (type !== "childList") {
        return false;
      }
      // Case 1: something changed inside an already-mounted launcher.
      if (target.classList && target.classList.contains("w-launcher__apps")) {
        return !target.querySelector(".tex-recent-features-container");
      }
      // Case 2: the whole launcher (already containing its children) was
      // inserted as a single new node - e.g. on first mount of the home
      // screen, before any "inside" mutation ever happens.
      for (const node of addedNodes.values()) {
        if (!node.querySelectorAll) {
          continue;
        }
        if (node.classList && node.classList.contains("w-launcher__apps")) {
          return true;
        }
        if (node.querySelector(".w-launcher__apps")) {
          return true;
        }
      }
      return false;
    }
    render({ showRecentFeatures, recentFeatures = [] }) {
      document.querySelectorAll(".w-launcher__apps").forEach((launcher) => {
        let container = launcher.querySelector(".tex-recent-features-container");
        if (!container) {
          container = document.createElement("div");
          container.classList.add("tex-recent-features-container");
          launcher.appendChild(container);
        }
        container.style.display = showRecentFeatures ? "flex" : "none";
        if (!showRecentFeatures) {
          return;
        }

        const list = document.createElement("div");
        list.classList.add("tex-recent-features-list");
        recentFeatures.forEach((stored) => {
          const feature = this._getFreshFeature(stored);
          if (!feature) {
            return;
          }
          const item = document.createElement("button");
          item.classList.add("tex-recent-features-item");
          item.innerText = feature.caption;
          item.title = `${feature.code} - ${feature.name}`;
          if (feature.available) {
            item.addEventListener("click", () => this._onClickRecentFeature(feature));
          } else {
            item.classList.add("disabled");
          }
          const close = document.createElement("span");
          close.classList.add("close");
          close.title = "Remover item";
          close.innerText = "×";
          close.addEventListener("click", (event) => {
            event.stopPropagation();
            this._removeFeature(feature);
          });
          item.appendChild(close);
          list.appendChild(item);
        });

        container.innerHTML = '<div class="tex-recent-features-title">Recentes</div>';
        container.appendChild(list);
      });
    }
    _getFreshFeature(stored) {
      return [...document.querySelectorAll(".w-apps-grid")]
        .map((el) => angularScope(el))
        .filter(Boolean)
        .reduce((acc, scope) => [...acc, ...(scope.features || [])], [])
        .find((feature) => feature.code === stored.code);
    }
    _openFeature(feature) {
      const grid = document.querySelector(".w-apps-grid");
      const scope = angularScope(grid);
      if (scope && typeof scope.openFeature === "function") {
        scope.openFeature(feature);
      }
    }
    _closeSpotlight() {
      const scope = angularScope(document.querySelector(".w-spotlight"));
      if (scope && typeof scope.close === "function") {
        scope.close();
      }
    }
    _saveLastFeatureOpened(feature) {
      sendToBridge("FEATURE_OPENED", { feature: this._serializeFeature(feature) });
    }
    _removeFeature(feature) {
      sendToBridge("FEATURE_REMOVED", { feature: this._serializeFeature(feature) });
    }
    _serializeFeature(feature) {
      return { code: feature.code, name: feature.name, caption: feature.caption };
    }
    _onClickRecentFeature(feature) {
      this._openFeature(feature);
      this._saveLastFeatureOpened(feature);
      this._closeSpotlight();
    }
    _onClickApp(event) {
      const appEl = event.target.closest(".w-feature-app");
      if (!appEl) {
        return;
      }
      const scope = angularScope(appEl);
      if (scope && scope.feature) {
        this._saveLastFeatureOpened(scope.feature);
      }
    }
  }

  // --- User locale badge next to the footer date -----------------------------
  class UserLocaleRenderer extends Renderer {
    condition() {
      return !document.querySelector("#tex-user-locale");
    }
    render({ showUserLocale }) {
      const existing = document.querySelector("#tex-user-locale");
      if (existing) {
        existing.remove();
      }
      if (!showUserLocale) {
        return;
      }
      const headerScope = angularScope(document.querySelector(".w-header"));
      const footerDate = document.querySelector(".w-footer__date");
      if (!headerScope || !headerScope.user || !footerDate) {
        return;
      }
      const locale = headerScope.user.locale;
      let label = locale;
      try {
        const [lang] = String(locale).split("-");
        const displayNames = new Intl.DisplayNames(["pt-BR"], { type: "language" });
        label = displayNames.of(lang) || locale;
      } catch (_error) {
        // Intl.DisplayNames unsupported or invalid locale - fall back to the raw code.
      }
      footerDate.insertAdjacentHTML(
        "beforebegin",
        `<span id="tex-user-locale" class="tex-fellow-label" title="${locale}">${label}</span>`
      );
    }
  }

  // --- Inspect mode: click any element to see its AngularJS scope -----------
  class Inspector {
    constructor() {
      this.enabled = false;
      this.inspecting = false;
      this.button = document.createElement("button");
      this.button.type = "button";
      this.button.className = "tex-inspect-button";
      this.button.innerText = "Inspecionar";
      this.button.addEventListener("click", () => this.setInspecting(!this.inspecting));

      this.layer = document.createElement("div");
      this.layer.className = "tex-inspect-layer";

      document.addEventListener("keyup", (event) => {
        if (event.key === "Escape") {
          this.setInspecting(false);
        }
      });
      document.addEventListener("mousemove", (event) => {
        if (!this.inspecting) {
          return;
        }
        this._resetLayer();
        const target = document.elementFromPoint(event.clientX, event.clientY);
        if (target && target !== this.button) {
          this._highlight(target);
        }
      });
      document.addEventListener("click", (event) => {
        if (!this.inspecting) {
          return;
        }
        const target = document.elementFromPoint(event.clientX, event.clientY);
        if (target === this.button) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.setInspecting(false);
        this._showScope(target);
      }, true);
    }
    isEnabled() {
      return this.enabled;
    }
    setEnabled(enabled) {
      this.enabled = enabled;
      if (enabled) {
        document.body.append(this.button, this.layer);
      } else {
        this.setInspecting(false);
        this.button.remove();
        this.layer.remove();
      }
    }
    setInspecting(inspecting) {
      this.inspecting = inspecting;
      this.button.innerText = inspecting ? "Cancelar" : "Inspecionar";
      this.button.classList.toggle("tex-inspect-button-cancel", inspecting);
      if (!inspecting) {
        this._resetLayer();
      }
    }
    _resetLayer() {
      Object.assign(this.layer.style, { top: "0px", left: "0px", width: "0px", height: "0px" });
    }
    _highlight(el) {
      const rect = el.getBoundingClientRect();
      Object.assign(this.layer.style, {
        top: `${rect.top}px`,
        left: `${rect.left}px`,
        width: `${rect.width}px`,
        height: `${rect.height}px`
      });
    }
    _showScope(el) {
      document.querySelectorAll(".tex-scope-container").forEach((node) => node.remove());
      const scope = angularScope(el);
      const container = document.createElement("div");
      container.className = "tex-scope-container";

      const header = document.createElement("div");
      header.className = "tex-scope-header";
      header.innerHTML = `<div class="tex-scope-title">${el.tagName.toLowerCase()}${el.className ? "." + String(el.className).toString().trim().replace(/\s+/g, ".") : ""}</div>`;
      const close = document.createElement("button");
      close.className = "tex-scope-close";
      close.type = "button";
      close.innerText = "×";
      close.addEventListener("click", () => container.remove());
      header.appendChild(close);

      const content = document.createElement("div");
      content.className = "tex-scope-content";

      try {
        const contextPre = document.createElement("pre");
        contextPre.className = "tex-scope-context";
        contextPre.textContent = buildFunctionContext(el, this.recentFeatures);
        content.appendChild(contextPre);
        const divider = document.createElement("div");
        divider.className = "tex-scope-context-label";
        divider.textContent = "escopo AngularJS completo";
        content.appendChild(divider);
      } catch (_error) {
        // context block is best-effort - never block the scope view
      }

      const pre = document.createElement("pre");
      pre.innerHTML = scope ? renderScopeJson(scope) : "<em>Nenhum escopo AngularJS encontrado neste elemento.</em>";
      content.appendChild(pre);

      container.append(header, content);
      document.body.appendChild(container);
    }
  }

  function renderScopeJson(scope) {
    const seen = new WeakSet();
    try {
      const plain = JSON.parse(
        JSON.stringify(scope, (key, value) => {
          if (key.startsWith("$")) {
            return undefined;
          }
          if (typeof value === "function") {
            return undefined;
          }
          if (value instanceof Node || value instanceof Window) {
            return undefined;
          }
          if (typeof value === "object" && value !== null) {
            if (seen.has(value)) {
              return undefined;
            }
            seen.add(value);
          }
          return value;
        })
      );
      return syntaxHighlight(JSON.stringify(plain, null, 2));
    } catch (_error) {
      return "<em>Não foi possível serializar o escopo deste elemento.</em>";
    }
  }

  function syntaxHighlight(json) {
    const escaped = json.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    return escaped.replace(
      /("(\\u[a-zA-Z0-9]{4}|\\[^u]|[^\\"])*"(\s*:)?|\b(true|false)\b|null|-?\d+(?:\.\d*)?(?:[eE][+-]?\d+)?)/g,
      (match) => {
        let cls = "tex-json-number";
        if (/^"/.test(match)) {
          cls = /:$/.test(match) ? "tex-json-key" : "tex-json-string";
        } else if (/true|false/.test(match)) {
          cls = "tex-json-boolean";
        } else if (/null/.test(match)) {
          cls = "tex-json-null";
        }
        return `<span class="${cls}">${match}</span>`;
      }
    );
  }

  class InspectModeRenderer extends Renderer {
    constructor() {
      super();
      this.inspector = new Inspector();
    }
    condition() {
      return true;
    }
    render({ inspectMode, recentFeatures }) {
      this.inspector.recentFeatures = recentFeatures;
      if (Boolean(inspectMode) !== this.inspector.isEnabled()) {
        this.inspector.setEnabled(Boolean(inspectMode));
      }
    }
  }

  // --- "Contexto da função": função + parâmetros + regras detectadas -------
  // Reads from the AngularJS scope chain and the rendered DOM (the trace files
  // only carry the rule/param queries, not which rule hit which component).
  function texEscape(text) {
    return String(text ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function scopeChain(el, max = 14) {
    const chain = [];
    let scope = angularScope(el);
    let guard = 0;
    while (scope && guard++ < max) {
      chain.push(scope);
      scope = scope.$parent;
    }
    return chain;
  }

  function shortValue(value, limit = 160) {
    try {
      const seen = new WeakSet();
      const json = JSON.stringify(value, (key, val) => {
        if (key.startsWith("$") || typeof val === "function") return undefined;
        if (val instanceof Node || val instanceof Window) return undefined;
        if (val && typeof val === "object") {
          if (seen.has(val)) return undefined;
          seen.add(val);
        }
        return val;
      });
      if (!json) return String(value);
      return json.length > limit ? json.slice(0, limit) + "…" : json;
    } catch (_error) {
      return String(value);
    }
  }

  function collectFunctionParams(chain) {
    const out = [];
    const seenKeys = new Set();
    for (const scope of chain) {
      for (const key of Object.keys(scope)) {
        if (key.startsWith("$") || seenKeys.has(key)) continue;
        if (!/param/i.test(key)) continue;
        const value = scope[key];
        if (value && typeof value === "object") {
          seenKeys.add(key);
          out.push({ key, value });
        }
      }
    }
    return out;
  }

  function nearestPanelInfo(el) {
    for (const { containerClass, extractor } of PANEL_EXTRACTORS) {
      const container = el.closest("." + containerClass);
      if (!container) continue;
      const scope = angularScope(container);
      if (!scope) continue;
      try {
        return extractor(scope);
      } catch (_error) {
        // extractor shape mismatch on this version - try the next
      }
    }
    return null;
  }

  const RULE_KEY_RE = /legenda|regra|\brule\b|^cor$|colou?r|visib|ordenac|ordering|imagem|image|schematic|esquemat/i;

  function detectComponentRules(el, chain) {
    const notes = [];
    const colorHost = el.closest(".slick-cell, td, .w-attr-container, [style*='background']") || el;
    try {
      const bg = getComputedStyle(colorHost).backgroundColor;
      if (bg && bg !== "rgba(0, 0, 0, 0)" && bg !== "transparent") {
        notes.push("Cor de fundo aplicada: " + bg + " (pode vir de regra de legenda — TASY_PADRAO_COR)");
      }
    } catch (_error) {
      // getComputedStyle can throw on detached nodes
    }
    const hidden = el.closest(".ng-hide, [style*='display: none'], [style*='display:none']");
    if (hidden) {
      const expr =
        hidden.getAttribute("ng-show") || hidden.getAttribute("ng-if") || hidden.getAttribute("ng-hide") || "";
      notes.push("Elemento/ancestral oculto" + (expr ? " (condição: " + expr + ")" : "") + " — possível regra de visibilidade");
    }
    for (const scope of chain) {
      for (const key of Object.keys(scope)) {
        if (key.startsWith("$") || !RULE_KEY_RE.test(key)) continue;
        notes.push("escopo." + key + " = " + shortValue(scope[key]));
      }
    }
    return [...new Set(notes)];
  }

  function buildFunctionContext(el, recentFeatures) {
    const chain = scopeChain(el);
    const lines = [];

    const tabName =
      document.querySelector(".w-tab--selected, .w-tab.selected, .tab.active, li.active")?.innerText?.trim() || "";
    const feature = Array.isArray(recentFeatures) ? recentFeatures[0] : null;
    lines.push(
      "FUNÇÃO: " +
        (feature ? (feature.code ? "[" + feature.code + "] " : "") + (feature.caption || feature.name || "") : tabName || document.title || "?")
    );

    const panel = nearestPanelInfo(el);
    if (panel) {
      lines.push(
        "PAINEL: " +
          [panel.code ? "código " + panel.code : "", panel.view ? "view " + panel.view : "", panel.table ? "tabela " + panel.table : ""]
            .filter(Boolean)
            .join(" · ")
      );
    }

    const params = collectFunctionParams(chain);
    lines.push("");
    lines.push("PARÂMETROS (encontrados no escopo):");
    if (params.length) {
      params.forEach((p) => {
        lines.push("• " + p.key + ":");
        if (Array.isArray(p.value)) {
          p.value.slice(0, 60).forEach((item) => lines.push("    " + shortValue(item, 200)));
        } else {
          Object.keys(p.value)
            .filter((k) => !k.startsWith("$"))
            .slice(0, 80)
            .forEach((k) => lines.push("    " + k + " = " + shortValue(p.value[k], 200)));
        }
      });
    } else {
      lines.push("  (nenhum objeto com 'param' no nome foi encontrado neste escopo)");
    }

    const rules = detectComponentRules(el, chain);
    lines.push("");
    lines.push("REGRAS DETECTADAS:");
    if (rules.length) {
      rules.forEach((r) => lines.push("• " + r));
    } else {
      lines.push("  (nada evidente na cor/visibilidade/escopo deste elemento)");
    }

    lines.push("");
    lines.push("Dica: as consultas de regras e parâmetros aparecem no Explorador do app server");
    lines.push("(SQL_SQL_GET_COLOR_RULES, SQL_SQL_GET_VISIBILITY_RULE, SQL_SCRIPT_PARAMETERS, OBTER_PARAMETROS_USUARIO).");

    return lines.join("\n");
  }

  // --- Report layout preview: visual canvas for grids with Esquerda/Topo/
  // Tamanho/Altura columns (TASY's report band/field editor). Read-only: it
  // never writes back into the TASY grid, only reads the rendered cell text
  // and shows a draggable visual preview so the user can copy the computed
  // position/size instead of doing the math by hand.
  const LAYOUT_REQUIRED_COLUMNS = ["QT_ESQUERDA", "QT_TOPO", "QT_TAMANHO", "QT_ALTURA"];
  const LAYOUT_EXTRA_COLUMNS = ["DS_LABEL", "NM_ATRIBUTO"];
  const LAYOUT_SNAP = 5;
  const LAYOUT_GRID_ID_ATTR = "data-tex-layout-grid-id";

  function parseBrNumber(text) {
    const normalized = String(text || "").trim().replace(/\./g, "").replace(",", ".");
    const value = Number.parseFloat(normalized);
    return Number.isFinite(value) ? value : 0;
  }

  function formatBrNumber(value) {
    return value.toFixed(2).replace(".", ",");
  }

  function findLayoutHeaderRows() {
    const headerRows = new Set();
    document.querySelectorAll(".slick-header-column").forEach((headerCell) => {
      const colName = headerCell.id.replace(/^slickgrid_\d+_?/, "");
      if (LAYOUT_REQUIRED_COLUMNS.includes(colName)) {
        const headerRow = headerCell.parentElement;
        if (headerRow) {
          headerRows.add(headerRow);
        }
      }
    });
    return [...headerRows].filter((headerRow) => {
      const cols = [...headerRow.querySelectorAll(".slick-header-column")].map((el) =>
        el.id.replace(/^slickgrid_\d+_?/, "")
      );
      return LAYOUT_REQUIRED_COLUMNS.every((required) => cols.includes(required));
    });
  }

  function findGridContainer(headerRow) {
    let node = headerRow;
    for (let i = 0; i < 8 && node; i++) {
      node = node.parentElement;
      if (node && node.querySelector(".slick-row")) {
        return node;
      }
    }
    return null;
  }

  function readLayoutColumns(headerRow) {
    const headerCells = [...headerRow.querySelectorAll(".slick-header-column")];
    const columns = {};
    headerCells.forEach((cell, index) => {
      const colName = cell.id.replace(/^slickgrid_\d+_?/, "");
      if (LAYOUT_REQUIRED_COLUMNS.includes(colName) || LAYOUT_EXTRA_COLUMNS.includes(colName)) {
        columns[colName] = index;
      }
    });
    return columns;
  }

  function readLayoutFields(headerRow) {
    const container = findGridContainer(headerRow);
    if (!container) {
      return [];
    }
    const columns = readLayoutColumns(headerRow);
    const rows = [...container.querySelectorAll(".slick-row")];
    return rows
      .map((row) => {
        const cells = [...row.children];
        const get = (colName) => {
          const index = columns[colName];
          return index === undefined ? "" : (cells[index]?.innerText || "").trim();
        };
        return {
          left: parseBrNumber(get("QT_ESQUERDA")),
          top: parseBrNumber(get("QT_TOPO")),
          width: parseBrNumber(get("QT_TAMANHO")),
          height: parseBrNumber(get("QT_ALTURA")),
          label: get("DS_LABEL") || get("NM_ATRIBUTO") || "(campo)"
        };
      })
      .filter((field) => field.width > 0 && field.height > 0);
  }

  class LayoutCanvas {
    constructor() {
      this.container = null;
      this.scale = 1;
      this.newBoxes = [];
    }

    isOpen() {
      return Boolean(this.container);
    }

    toggle(headerRow) {
      if (this.isOpen()) {
        this.close();
      } else {
        this.open(headerRow);
      }
    }

    close() {
      if (this.container) {
        this.container.remove();
        this.container = null;
      }
      this.newBoxes = [];
    }

    open(headerRow) {
      this.close();
      const existingFields = readLayoutFields(headerRow);
      const maxRight = existingFields.reduce((acc, f) => Math.max(acc, f.left + f.width), 200);
      const maxBottom = existingFields.reduce((acc, f) => Math.max(acc, f.top + f.height), 100);
      const canvasWidthUnits = maxRight + 60;
      const canvasHeightUnits = maxBottom + 200;
      const maxDisplayWidth = Math.min(window.innerWidth * 0.7, 1000);
      this.scale = Math.min(1, maxDisplayWidth / canvasWidthUnits);

      const overlay = document.createElement("div");
      overlay.className = "tex-scope-container tex-layout-container";

      const header = document.createElement("div");
      header.className = "tex-scope-header tex-layout-header";
      header.innerHTML = `<div class="tex-scope-title">Layout visual (somente leitura das posições existentes)</div>`;
      makeDraggable(header, overlay);
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "tex-layout-add-button";
      addBtn.innerText = "+ Novo campo";
      addBtn.addEventListener("click", () => this._addBox(existingFields));
      const close = document.createElement("button");
      close.className = "tex-scope-close";
      close.type = "button";
      close.innerText = "×";
      close.addEventListener("click", () => this.close());
      header.append(addBtn, close);

      const content = document.createElement("div");
      content.className = "tex-scope-content tex-layout-content";

      const canvas = document.createElement("div");
      canvas.className = "tex-layout-canvas";
      canvas.style.width = `${canvasWidthUnits * this.scale}px`;
      canvas.style.height = `${canvasHeightUnits * this.scale}px`;
      this.canvas = canvas;

      existingFields.forEach((field) => {
        canvas.appendChild(this._createBox(field, { editable: false }));
      });

      content.appendChild(canvas);
      overlay.append(header, content);
      document.body.appendChild(overlay);
      this.container = overlay;
    }

    _addBox(existingFields) {
      const last = existingFields[existingFields.length - 1];
      const field = last
        ? { left: last.left + last.width + LAYOUT_SNAP, top: last.top, width: 70, height: 17, label: "Novo campo" }
        : { left: LAYOUT_SNAP, top: LAYOUT_SNAP, width: 70, height: 17, label: "Novo campo" };
      const box = this._createBox(field, { editable: true });
      this.canvas.appendChild(box);
    }

    _createBox(field, { editable }) {
      const box = document.createElement("div");
      box.className = "tex-layout-box";
      if (editable) {
        box.classList.add("tex-layout-box-new");
      }
      const label = document.createElement("div");
      label.className = "tex-layout-box-label";
      label.innerText = field.label;
      const info = document.createElement("div");
      info.className = "tex-layout-box-info";

      const state = { ...field };
      const applyGeometry = () => {
        box.style.left = `${state.left * this.scale}px`;
        box.style.top = `${state.top * this.scale}px`;
        box.style.width = `${Math.max(state.width * this.scale, 12)}px`;
        box.style.height = `${Math.max(state.height * this.scale, 10)}px`;
        info.innerText = `Esquerda ${formatBrNumber(state.left)} · Topo ${formatBrNumber(state.top)} · Tamanho ${formatBrNumber(state.width)} · Altura ${formatBrNumber(state.height)}`;
      };
      applyGeometry();

      box.append(label, info);

      if (editable) {
        const copyBtn = document.createElement("button");
        copyBtn.type = "button";
        copyBtn.className = "tex-layout-copy-button";
        copyBtn.innerText = "Copiar";
        copyBtn.addEventListener("click", (event) => {
          event.stopPropagation();
          const text = `Esquerda: ${formatBrNumber(state.left)}\nTopo: ${formatBrNumber(state.top)}\nTamanho: ${formatBrNumber(state.width)}\nAltura: ${formatBrNumber(state.height)}`;
          navigator.clipboard.writeText(text).catch(() => {});
          copyBtn.innerText = "Copiado!";
          window.setTimeout(() => {
            copyBtn.innerText = "Copiar";
          }, 700);
        });
        const resizeHandle = document.createElement("div");
        resizeHandle.className = "tex-layout-resize-handle";
        box.append(copyBtn, resizeHandle);

        let drag = null;
        box.addEventListener("mousedown", (event) => {
          if (event.target === resizeHandle || event.target === copyBtn) {
            return;
          }
          drag = { mode: "move", startX: event.clientX, startY: event.clientY, origLeft: state.left, origTop: state.top };
          event.preventDefault();
        });
        resizeHandle.addEventListener("mousedown", (event) => {
          drag = {
            mode: "resize",
            startX: event.clientX,
            startY: event.clientY,
            origWidth: state.width,
            origHeight: state.height
          };
          event.preventDefault();
          event.stopPropagation();
        });
        window.addEventListener("mousemove", (event) => {
          if (!drag) {
            return;
          }
          const dxUnits = (event.clientX - drag.startX) / this.scale;
          const dyUnits = (event.clientY - drag.startY) / this.scale;
          if (drag.mode === "move") {
            state.left = Math.max(0, Math.round((drag.origLeft + dxUnits) / LAYOUT_SNAP) * LAYOUT_SNAP);
            state.top = Math.max(0, Math.round((drag.origTop + dyUnits) / LAYOUT_SNAP) * LAYOUT_SNAP);
          } else {
            state.width = Math.max(LAYOUT_SNAP, Math.round((drag.origWidth + dxUnits) / LAYOUT_SNAP) * LAYOUT_SNAP);
            state.height = Math.max(LAYOUT_SNAP, Math.round((drag.origHeight + dyUnits) / LAYOUT_SNAP) * LAYOUT_SNAP);
          }
          applyGeometry();
        });
        window.addEventListener("mouseup", () => {
          drag = null;
        });
      }

      return box;
    }
  }

  class ReportLayoutRenderer extends Renderer {
    constructor() {
      super();
      this.canvas = new LayoutCanvas();
      this.buttons = new WeakMap();
    }
    condition({ type, addedNodes }) {
      if (type !== "childList") {
        return false;
      }
      for (const node of addedNodes.values()) {
        if (!node.querySelectorAll) {
          continue;
        }
        if (node.classList && node.classList.contains("slick-header-column")) {
          return true;
        }
        if (node.querySelector(".slick-header-column")) {
          return true;
        }
      }
      return false;
    }
    render({ showReportLayout }) {
      document.querySelectorAll(".tex-layout-button").forEach((btn) => btn.remove());
      if (!showReportLayout) {
        this.canvas.close();
        return;
      }
      const headerRows = findLayoutHeaderRows();
      headerRows.forEach((headerRow, index) => {
        headerRow.setAttribute(LAYOUT_GRID_ID_ATTR, String(index));
        const button = document.createElement("button");
        button.type = "button";
        button.className = "tex-layout-button";
        button.innerText = "📐 Layout visual";
        button.addEventListener("click", () => this.canvas.toggle(headerRow));
        makeDraggable(button, button);
        document.body.appendChild(button);
      });
    }
  }

  // --- Environment indicator: colored border + badge per configured rule ----
  function pickReadableTextColor(hexColor) {
    const hex = String(hexColor).replace("#", "");
    const r = parseInt(hex.substring(0, 2), 16);
    const g = parseInt(hex.substring(2, 4), 16);
    const b = parseInt(hex.substring(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.6 ? "#0F172A" : "#FFFFFF";
  }

  // The logged establishment (matriz / filial). Tasy shows it only in the
  // footer, which is easy to miss on a multi-establishment install.
  function readEstablishment() {
    // 1) Tasy HTML5 has a dedicated footer element for it.
    try {
      // Usually this is a CSS class, but some TASY builds render it as the
      // element name itself.  Prefer this dedicated field over the complete
      // footer, which also contains company, database and version details.
      const el = document.querySelector(".w-footer__establishment, w-footer__establishment");
      const value = el && (el.innerText || el.textContent);
      if (value && value.trim()) {
        return value.trim().slice(0, 40);
      }
    } catch (_error) {
      // fall through
    }
    // 2) AngularJS scope, when available.
    try {
      const scope = angularScope(document.querySelector(".w-header"));
      const user = scope && scope.user;
      const candidate =
        (user && (user.nmEstabelecimento || user.dsEstabelecimento || user.nomeEstabelecimento || user.estabelecimento)) ||
        (scope && (scope.nmEstabelecimento || scope.dsEstabelecimento));
      if (typeof candidate === "string" && candidate.trim()) {
        return candidate.trim().slice(0, 40);
      }
      if (candidate && typeof candidate === "object") {
        const name = candidate.nmEstabelecimento || candidate.dsEstabelecimento || candidate.ds || candidate.nome || candidate.descricao;
        if (name) return String(name).trim().slice(0, 40);
      }
    } catch (_error) {
      // fall through
    }
    // 3) Last resort: scrape the footer text (older layouts without the element).
    try {
      const footer = document.querySelector(".w-footer");
      if (footer) {
        let text = footer.innerText || "";
        footer.querySelectorAll(".w-footer__date, .w-footer__time, .w-footer__corp-name, .w-footer__database, .w-footer__privacy-policy").forEach((n) => {
          if (n.innerText) text = text.split(n.innerText).join(" ");
        });
        text = text
          .replace(/\bW?TASY\s+[\d.]+/i, " ")
          .replace(/UTC\s*\([^)]*\)/i, " ")
          .replace(/\s+/g, " ")
          .trim();
        const parts = text.split(/\s+[-–]\s+/).map((p) => p.trim()).filter(Boolean);
        const tail = parts.length > 1 ? parts[parts.length - 1] : text;
        return tail.slice(0, 40);
      }
    } catch (_error) {
      // no footer
    }
    return "";
  }

  class EnvironmentIndicatorRenderer extends Renderer {
    condition({ type, addedNodes }) {
      // Re-render once the footer mounts, so the establishment (read from it)
      // makes it into the badge on a fresh page load.
      if (type !== "childList") {
        return false;
      }
      for (const node of addedNodes) {
        if (node.nodeType === 1 && (node.matches?.(".w-footer") || node.querySelector?.(".w-footer"))) {
          return true;
        }
      }
      return false;
    }
    render({ environmentRules, serverNode, showEstablishment }) {
      const rules = Array.isArray(environmentRules) ? environmentRules : [];
      const hostname = window.location.hostname.toLowerCase();
      const match = rules.find((rule) => rule.match && hostname.includes(String(rule.match).toLowerCase()));
      const establishment = showEstablishment ? readEstablishment() : "";
      const nodeSuffix = serverNode && serverNode.node ? ` · nó ${serverNode.node}` : "";
      const estabSuffix = establishment ? ` · ${establishment}` : "";

      if (!match && !establishment) {
        document.documentElement.style.outline = "";
        document.querySelector(".tex-env-badge")?.remove();
        return;
      }

      let badge = document.querySelector(".tex-env-badge");
      if (!badge) {
        badge = document.createElement("div");
        badge.className = "tex-env-badge";
        document.body.appendChild(badge);
        makeDraggable(badge, badge);
      }

      if (match) {
        document.documentElement.style.outline = `4px solid ${match.color}`;
        document.documentElement.style.outlineOffset = "-4px";
        badge.style.backgroundColor = match.color;
        badge.style.color = pickReadableTextColor(match.color);
        badge.innerText = (match.label || match.match) + estabSuffix + nodeSuffix;
      } else {
        // No environment rule for this host, but the user wants the
        // establishment shown - neutral badge, no screen border.
        document.documentElement.style.outline = "";
        badge.style.backgroundColor = "#475569";
        badge.style.color = "#FFFFFF";
        badge.innerText = establishment + nodeSuffix;
      }
    }
  }

  // --- Tasy application error capture ------------------------------------
  // Watches for the "Houve um erro na execução da aplicação" dialog. When it
  // appears (and "Capturar erros" is on), it expands "Mais detalhes", reads
  // the whole message plus the logged user and any app-server link, and ships
  // it to content.js with the recent backend-call buffer. content.js then
  // fetches/parses the app-server ERRO file and stores an interpreted report.
  const ERROR_DIALOG_RE = /erro na execu[çc][aã]o da aplica[çc][aã]o|ocorreu um erro inesperado/i;

  function readLoggedUser() {
    try {
      const headerScope = angularScope(document.querySelector(".w-header"));
      const user = headerScope && headerScope.user;
      if (user) {
        return String(user.username || user.login || user.nmUsuario || user.dsUsuario || "").trim();
      }
    } catch (_error) {
      // header scope unavailable - content.js can still fall back to a manual value
    }
    return "";
  }

  class TasyErrorWatcher {
    constructor() {
      this.enabled = false;
      this.observer = new MutationObserver((mutations) => this._onMutations(mutations));
      this.lastSignature = "";
      this.lastAt = 0;
      this.suppressUntil = 0;
    }
    setEnabled(enabled) {
      if (enabled === this.enabled) {
        return;
      }
      this.enabled = enabled;
      if (enabled) {
        this.observer.observe(document.body, { childList: true, subtree: true });
        this._scan(document.body);
      } else {
        this.observer.disconnect();
      }
    }
    _onMutations(mutations) {
      if (Date.now() < this.suppressUntil) {
        return;
      }
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1) {
            this._scan(node);
          }
        }
      }
    }
    _scan(node) {
      if (!node || typeof node.querySelector !== "function") {
        return;
      }
      const probe = node.textContent || "";
      if (probe.length > 20000 || !ERROR_DIALOG_RE.test(probe)) {
        return;
      }
      let dialog = node;
      for (let i = 0; i < 6 && dialog; i++) {
        if (dialog.querySelector && dialog.querySelector("button")) {
          break;
        }
        dialog = dialog.parentElement;
      }
      if (dialog) {
        this._capture(dialog);
      }
    }
    _capture(dialog) {
      const now = Date.now();
      if (now < this.suppressUntil) {
        return;
      }
      let raw = "";
      try {
        raw = dialog.innerText || "";
      } catch (_error) {
        return;
      }
      const signature = raw.replace(/\s+/g, " ").trim().slice(0, 300);
      if (!signature || (signature === this.lastSignature && now - this.lastAt < 8000)) {
        return;
      }
      this.lastSignature = signature;
      this.lastAt = now;
      this.suppressUntil = now + 1500;

      let expanded = false;
      dialog.querySelectorAll("a, span, button, div").forEach((el) => {
        if (expanded) {
          return;
        }
        const label = (el.innerText || "").trim().toLowerCase();
        if (label === "mais detalhes" || label.startsWith("mais detalhes")) {
          try {
            el.click();
            expanded = true;
          } catch (_error) {
            // still ship whatever is visible
          }
        }
      });

      window.setTimeout(() => this._emit(dialog, raw), expanded ? 220 : 0);
    }
    _emit(dialog, fallbackText) {
      let clean = fallbackText;
      try {
        clean = dialog.innerText || fallbackText;
      } catch (_error) {
        clean = fallbackText;
      }
      clean = String(clean).replace(/\r/g, "").trim();

      const detalhes = (clean.match(/Detalhes:\s*([\s\S]*?)(?:\n\s*Mais informa[çc][õo]es:|\n\s*Vers[aã]o:|$)/i) || [])[1] || "";
      const moreInfo = (clean.match(/Mais informa[çc][õo]es:\s*(.+)/i) || [])[1] || "";
      const version = (clean.match(/Vers[aã]o:\s*([\d.]+)/i) || [])[1] || "";
      const detalheLines = detalhes.split("\n").map((s) => s.trim()).filter(Boolean);
      const summary = detalheLines[detalheLines.length - 1] || "";
      const titleLines = clean.split("\n").map((s) => s.trim()).filter(Boolean);

      let moreInfoHref = "";
      try {
        const link = [...dialog.querySelectorAll("a[href]")].find((a) => /arquivo\.jsp|appserver|wheb_arquivo/i.test(a.getAttribute("href") || ""));
        moreInfoHref = link ? link.href : "";
      } catch (_error) {
        moreInfoHref = "";
      }

      let footerVersion = "";
      try {
        const footerText = document.querySelector(".w-footer, .footer, footer")?.innerText || "";
        footerVersion = (footerText.match(/\b(\d+\.\d+\.\d+\.\d+)\b/) || [])[1] || "";
      } catch (_error) {
        // no footer
      }

      let screenHint = "";
      try {
        screenHint =
          document.querySelector(".w-tab--selected, .w-tab.selected, .tab.active, li.active")?.innerText?.trim() ||
          document.title ||
          "";
      } catch (_error) {
        screenHint = "";
      }

      sendToBridge("TASY_ERROR_CAPTURED", {
        payload: {
          capturedAt: new Date().toISOString(),
          title: titleLines[0] || "Houve um erro na execução da aplicação",
          summary: maskLongDigits(summary),
          detalhes: maskLongDigits(detalhes),
          moreInfo: moreInfo.trim(),
          moreInfoHref,
          version: (version || footerVersion).trim(),
          fullText: maskLongDigits(clean).slice(0, 4000),
          user: readLoggedUser(),
          establishment: readEstablishment(),
          origin: window.location.origin,
          screenHint: String(screenHint || "").slice(0, 200),
          apiCalls: apiCallBuffer.slice(-API_CALL_BUFFER_MAX)
        }
      });
    }
  }

  const tasyErrorWatcher = new TasyErrorWatcher();

  class ErrorCaptureRenderer extends Renderer {
    condition() {
      return false;
    }
    render({ captureErrors }) {
      tasyErrorWatcher.setEnabled(Boolean(captureErrors));
    }
  }

  // --- Waterfall de rede: mini timeline of the recent real requests --------
  function waterfallShortUrl(rawUrl) {
    try {
      const u = new URL(rawUrl, window.location.href);
      const segs = u.pathname.split("/").filter(Boolean).slice(-2).join("/");
      const firstParam = u.search ? u.search.replace(/^\?/, "").split("&")[0] : "";
      return "/" + segs + (firstParam ? "?" + firstParam : "");
    } catch (_error) {
      return String(rawUrl || "").slice(0, 80);
    }
  }

  class NetworkWaterfall {
    constructor() {
      this.panel = null;
      this.timer = null;
      this.calls = [];
    }
    setEnabled(enabled) {
      if (enabled && !this.panel) {
        this.panel = document.createElement("div");
        this.panel.className = "tex-waterfall";
        this.panel.innerHTML =
          '<div class="tex-waterfall-head">Rede — últimas chamadas <span class="tex-waterfall-close" title="Fechar">×</span></div>' +
          '<div class="tex-waterfall-body"></div>';
        this.panel.querySelector(".tex-waterfall-close").addEventListener("click", () => this.setEnabled(false));
        makeDraggable(this.panel.querySelector(".tex-waterfall-head"), this.panel);
        document.body.appendChild(this.panel);
        this.timer = window.setInterval(() => this.render(), 1000);
        this.render();
      } else if (!enabled && this.panel) {
        window.clearInterval(this.timer);
        this.timer = null;
        this.panel.remove();
        this.panel = null;
      }
    }
    render() {
      if (!this.panel) return;
      const body = this.panel.querySelector(".tex-waterfall-body");
      const calls = apiCallBuffer.slice(-15);
      this.calls = calls;
      if (!calls.length) {
        body.innerHTML = '<div class="tex-waterfall-empty">Sem chamadas registradas ainda.</div>';
        return;
      }
      const times = calls.map((c) => new Date(c.t).getTime());
      const t0 = Math.min(...times);
      const span = Math.max(1, ...calls.map((c, i) => times[i] - t0 + (c.durationMs || 0)));
      const maxDur = Math.max(1, ...calls.map((c) => c.durationMs || 0));
      body.innerHTML = calls
        .map((c, i) => {
          const start = times[i] - t0;
          const dur = c.durationMs || 0;
          const left = (start / span) * 100;
          const width = Math.max(1.5, (dur / span) * 100);
          const slow = dur >= 800 || (dur === maxDur && dur > 250);
          const bad = c.ok === false || (typeof c.httpStatus === "number" && c.httpStatus >= 400);
          const label = (c.method || "") + " " + waterfallShortUrl(c.url);
          return (
            '<div class="tex-waterfall-row' +
            (slow ? " slow" : "") +
            (bad ? " bad" : "") +
            '" data-i="' +
            i +
            '" title="' +
            texEscape(label + "  ·  HTTP " + (c.httpStatus || "?") + "  ·  " + dur + "ms") +
            '">' +
            '<span class="tex-waterfall-label">' +
            texEscape(label) +
            "</span>" +
            '<span class="tex-waterfall-track"><span class="tex-waterfall-bar" style="left:' +
            left.toFixed(1) +
            "%;width:" +
            width.toFixed(1) +
            '%"></span></span>' +
            '<span class="tex-waterfall-ms">' +
            dur +
            "ms</span></div>"
          );
        })
        .join("");
      body.querySelectorAll(".tex-waterfall-row").forEach((row) => {
        row.addEventListener("click", () => {
          const call = this.calls[Number(row.dataset.i)];
          if (call && call.url) {
            navigator.clipboard.writeText(call.url).catch(() => {});
            row.classList.add("copied");
            window.setTimeout(() => row.classList.remove("copied"), 500);
          }
        });
      });
    }
  }

  const networkWaterfall = new NetworkWaterfall();

  class WaterfallRenderer extends Renderer {
    condition() {
      return false;
    }
    render({ showWaterfall }) {
      networkWaterfall.setEnabled(Boolean(showWaterfall));
    }
  }

  manager.add(new FieldDetailsRenderer());
  manager.add(new GridDetailsRenderer());
  manager.add(new PanelDetailsRenderer());
  manager.add(new RecentFeaturesRenderer());
  manager.add(new UserLocaleRenderer());
  manager.add(new InspectModeRenderer());
  manager.add(new ReportLayoutRenderer());
  manager.add(new EnvironmentIndicatorRenderer());
  manager.add(new ErrorCaptureRenderer());
  manager.add(new WaterfallRenderer());

  window.addEventListener("message", (event) => {
    if (event.source !== window) {
      return;
    }
    const data = event.data;
    if (!data || data[MSG_MARK] !== true) {
      return;
    }
    if (data.type === "OPTIONS") {
      manager.setOptions(data.options);
    }
  });

  sendToBridge("REQUEST_OPTIONS", {});
})();
