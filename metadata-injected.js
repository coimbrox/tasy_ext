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
          if (node.classList && node.classList.contains("w-attr-container")) {
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
        if (node.classList && node.classList.contains("slick-header-column")) {
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
        const label = document.createElement("span");
        label.classList.add("tex-fellow-label", "tex-grid-label", "tex-copy-me");
        label.innerText = columnName;
        label.title = columnName;
        el.appendChild(label);
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
          if (node.classList && node.classList.contains(containerClass)) {
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
    render({ inspectMode }) {
      if (Boolean(inspectMode) !== this.inspector.isEnabled()) {
        this.inspector.setEnabled(Boolean(inspectMode));
      }
    }
  }

  manager.add(new FieldDetailsRenderer());
  manager.add(new GridDetailsRenderer());
  manager.add(new PanelDetailsRenderer());
  manager.add(new RecentFeaturesRenderer());
  manager.add(new UserLocaleRenderer());
  manager.add(new InspectModeRenderer());

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
