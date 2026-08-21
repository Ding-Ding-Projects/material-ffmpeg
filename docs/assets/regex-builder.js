(function materialFfmpegRegexBuilderBootstrap(global) {
  "use strict";

  const API_VERSION = "1.0.0";
  const DEFAULT_LIMITS = Object.freeze({
    queryLength: 512,
    patternLength: 512,
    sampleLength: 4096,
    candidateLength: 4096,
    maxMatches: 200,
    maxCaptureGroups: 32,
  });
  const MODE_PLAIN = "plain";
  const MODE_REGEX = "regex";
  const FIELD_SELECTOR = "[data-regex-builder]";
  const CONTROLLERS = new WeakMap();
  let controllerSequence = 0;
  let injectedStyles = false;

  const FLAG_DEFINITIONS = Object.freeze([
    { value: "g", label: "Global", detail: "Show every match" },
    { value: "i", label: "Ignore case", detail: "Match upper and lower case" },
    { value: "m", label: "Multiline", detail: "^ and $ work per line" },
    { value: "s", label: "Dot all", detail: ". also matches line breaks" },
    { value: "u", label: "Unicode", detail: "Use Unicode code points" },
  ]);

  const GUIDE_GROUPS = Object.freeze([
    {
      label: "Literals",
      items: [
        { label: "Literal text", insert: "text", select: [0, 4] },
        { label: "Escaped dot", insert: "\\." },
        { label: "Whitespace", insert: "\\s" },
        { label: "Digit", insert: "\\d" },
        { label: "Word character", insert: "\\w" },
      ],
    },
    {
      label: "Character classes",
      items: [
        { label: "Any listed", insert: "[abc]", select: [1, 4] },
        { label: "Not listed", insert: "[^abc]", select: [2, 5] },
        { label: "Range", insert: "[a-z]", select: [1, 4] },
        { label: "Any character", insert: "." },
      ],
    },
    {
      label: "Anchors",
      items: [
        { label: "Start", insert: "^" },
        { label: "End", insert: "$" },
        { label: "Word boundary", insert: "\\b" },
      ],
    },
    {
      label: "Groups and alternation",
      items: [
        { label: "Capture group", insert: "()", select: [1, 1] },
        { label: "Named capture", insert: "(?<name>)", select: [3, 7] },
        { label: "Non-capturing group", insert: "(?:)", select: [3, 3] },
        { label: "Either / or", insert: "|" },
      ],
    },
    {
      label: "Quantifiers",
      items: [
        { label: "Zero or more", insert: "*" },
        { label: "One or more", insert: "+" },
        { label: "Optional", insert: "?" },
        { label: "Exact count", insert: "{2}", select: [1, 2] },
        { label: "Count range", insert: "{2,5}", select: [1, 4] },
        { label: "Lazy", insert: "?" },
      ],
    },
  ]);

  function mergeLimits(limits) {
    const merged = { ...DEFAULT_LIMITS };
    if (!limits || typeof limits !== "object") return merged;
    for (const key of Object.keys(merged)) {
      const value = Number(limits[key]);
      if (Number.isSafeInteger(value) && value > 0) merged[key] = value;
    }
    return merged;
  }

  function clampText(value, maximum) {
    const text = String(value == null ? "" : value);
    return text.length > maximum ? text.slice(0, maximum) : text;
  }

  function escapeLiteral(value) {
    return String(value == null ? "" : value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function normalizeFlags(flags) {
    const requested = Array.isArray(flags) ? flags.join("") : String(flags || "");
    const supported = FLAG_DEFINITIONS.map((entry) => entry.value);
    return supported.filter((flag) => requested.includes(flag)).join("");
  }

  function supportsFlag(flag) {
    try {
      new RegExp("", flag);
      return true;
    } catch (_error) {
      return false;
    }
  }

  function findUnsafePatternReason(pattern) {
    if (!pattern) return "";

    // Nested repetitions such as (a+)+ are the most common source of runaway
    // backtracking. This conservative check can reject a few valid patterns,
    // but keeps synchronous browser filtering bounded and responsive.
    const nestedQuantifier = /\((?:\\.|\[(?:\\.|[^\]\\])*\]|[^()[\]\\])*[+*{](?:[^()[\]\\]|\\.)*\)[+*{]/;
    if (nestedQuantifier.test(pattern)) {
      return "Nested repeating groups are blocked because they can freeze the page.";
    }

    const quantifiedAlternation = /\((?:\\.|[^()\\])*\|(?:\\.|[^()\\])*\)[+*{]/;
    if (quantifiedAlternation.test(pattern)) {
      return "Repeated alternation groups are blocked because they can backtrack without a safe bound.";
    }

    if (/\\[1-9]/.test(pattern)) {
      return "Numeric backreferences are blocked in live filters because their running time is difficult to bound.";
    }

    return "";
  }

  function validateRegex(pattern, flags, limits) {
    const activeLimits = mergeLimits(limits);
    const text = String(pattern || "");
    const normalizedFlags = normalizeFlags(flags);

    if (text.length > activeLimits.patternLength) {
      return {
        ok: false,
        error: `Pattern is ${text.length} characters; the limit is ${activeLimits.patternLength}.`,
        flags: normalizedFlags,
      };
    }

    const unsafeReason = findUnsafePatternReason(text);
    if (unsafeReason) return { ok: false, error: unsafeReason, flags: normalizedFlags };

    try {
      const expression = new RegExp(text, normalizedFlags);
      return { ok: true, error: "", flags: normalizedFlags, expression };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : "The pattern is not valid.",
        flags: normalizedFlags,
      };
    }
  }

  function normalizeState(state, limits) {
    const input = state && typeof state === "object" ? state : {};
    const mode = input.mode === MODE_REGEX ? MODE_REGEX : MODE_PLAIN;
    const query = String(input.query == null ? "" : input.query);
    const pattern = String(
      input.pattern == null ? (mode === MODE_REGEX ? query : escapeLiteral(query)) : input.pattern,
    );
    return {
      mode,
      query,
      pattern,
      flags: normalizeFlags(input.flags),
      sample: String(input.sample == null ? "" : input.sample),
    };
  }

  function compileState(state, limits) {
    const activeLimits = mergeLimits(limits);
    const normalized = normalizeState(state, activeLimits);
    if (normalized.mode === MODE_PLAIN) {
      if (normalized.query.length > activeLimits.queryLength) {
        return {
          ok: false,
          error: `Plain-text query is ${normalized.query.length} characters; the limit is ${activeLimits.queryLength}.`,
          state: normalized,
        };
      }
      return { ok: true, error: "", state: normalized, expression: null };
    }
    const validation = validateRegex(normalized.pattern, normalized.flags, activeLimits);
    return { ...validation, state: normalized };
  }

  function createMatcher(state, options) {
    const settings = options || {};
    const limits = mergeLimits(settings.limits);
    const normalized = normalizeState(state, limits);

    if (normalized.mode === MODE_PLAIN) {
      if (normalized.query.length > limits.queryLength) {
        return {
          ok: false,
          error: `Plain-text query is ${normalized.query.length} characters; the limit is ${limits.queryLength}.`,
          test: () => false,
        };
      }
      const needle = settings.caseSensitive ? normalized.query : normalized.query.toLocaleLowerCase();
      return {
        ok: true,
        error: "",
        test(value) {
          const candidate = String(value == null ? "" : value);
          if (candidate.length > limits.candidateLength) return false;
          const haystack = settings.caseSensitive ? candidate : candidate.toLocaleLowerCase();
          return needle === "" || haystack.includes(needle);
        },
      };
    }

    const compiled = validateRegex(normalized.pattern, normalized.flags, limits);
    if (!compiled.ok) return { ok: false, error: compiled.error, test: () => false };
    return {
      ok: true,
      error: "",
      test(value) {
        const candidate = String(value == null ? "" : value);
        if (candidate.length > limits.candidateLength) return false;
        compiled.expression.lastIndex = 0;
        return compiled.expression.test(candidate);
      },
    };
  }

  function matchesText(value, state, options) {
    const settings = options || {};
    const limits = mergeLimits(settings.limits);
    const candidate = String(value == null ? "" : value);
    if (candidate.length > limits.candidateLength) {
      return {
        ok: false,
        matched: false,
        error: `Candidate text is ${candidate.length} characters; the limit is ${limits.candidateLength}.`,
      };
    }
    const matcher = createMatcher(state, { ...settings, limits });
    return { ok: matcher.ok, matched: matcher.ok && matcher.test(candidate), error: matcher.error };
  }

  function filterItems(items, state, getText, options) {
    const list = Array.from(items || []);
    const reader = typeof getText === "function" ? getText : (item) => item;
    const limits = mergeLimits(options && options.limits);
    const matches = [];
    const rejected = [];
    const matcher = createMatcher(state, options);
    if (!matcher.ok) {
      return { ok: false, error: matcher.error, matches, rejected: list, total: list.length };
    }
    const candidates = list.map((item, index) => {
      const value = reader(item, index);
      return String(value == null ? "" : value);
    });
    if (candidates.some((candidate) => candidate.length > limits.candidateLength)) {
      return {
        ok: false,
        error: `At least one candidate exceeds the ${limits.candidateLength}-character limit.`,
        matches,
        rejected: list,
        total: list.length,
      };
    }

    list.forEach((item, index) => {
      if (matcher.test(candidates[index])) matches.push(item);
      else rejected.push(item);
    });

    return { ok: true, error: "", matches, rejected, total: list.length };
  }

  function filterElements(elements, state, options) {
    const settings = options || {};
    const hiddenClass = settings.hiddenClass || "mff-regex-filtered-out";
    const attribute = settings.textAttribute || "data-search-text";
    const reader =
      typeof settings.getText === "function"
        ? settings.getText
        : (element) => element.getAttribute(attribute) || element.textContent || "";
    const result = filterItems(elements, state, reader, settings);

    if (!result.ok) {
      const liveRegion = settings.liveRegion;
      if (liveRegion && "textContent" in liveRegion) {
        liveRegion.textContent = `Filter was not applied: ${result.error}`;
      }
      return result;
    }

    result.matches.forEach((element) => {
      element.hidden = false;
      element.classList.remove(hiddenClass);
      element.removeAttribute("aria-hidden");
    });
    result.rejected.forEach((element) => {
      element.hidden = true;
      element.classList.add(hiddenClass);
      element.setAttribute("aria-hidden", "true");
    });

    const liveRegion = settings.liveRegion;
    if (liveRegion && "textContent" in liveRegion) {
      liveRegion.textContent = result.ok
        ? `${result.matches.length} of ${result.total} items shown.`
        : `Filter was not applied: ${result.error}`;
    }
    return result;
  }

  function collectMatches(pattern, flags, sample, limits) {
    const activeLimits = mergeLimits(limits);
    const text = String(sample == null ? "" : sample);
    if (text.length > activeLimits.sampleLength) {
      return {
        ok: false,
        error: `Sample is ${text.length} characters; the limit is ${activeLimits.sampleLength}.`,
        matches: [],
        truncated: false,
      };
    }
    const validation = validateRegex(pattern, flags, activeLimits);
    if (!validation.ok) return { ok: false, error: validation.error, matches: [], truncated: false };

    const previewFlags = validation.flags.includes("g") ? validation.flags : `${validation.flags}g`;
    let expression;
    try {
      expression = new RegExp(pattern, previewFlags);
    } catch (error) {
      return { ok: false, error: error.message, matches: [], truncated: false };
    }

    const matches = [];
    let match;
    while ((match = expression.exec(text)) !== null && matches.length < activeLimits.maxMatches) {
      const captures = match.slice(1, activeLimits.maxCaptureGroups + 1).map((value, index) => ({
        index: index + 1,
        value: value == null ? null : value,
      }));
      const namedCaptures = match.groups ? { ...match.groups } : {};
      matches.push({
        value: match[0],
        index: match.index,
        end: match.index + match[0].length,
        zeroWidth: match[0].length === 0,
        captures,
        groups: namedCaptures,
      });

      if (match[0].length === 0) {
        const codePoint = text.codePointAt(expression.lastIndex);
        expression.lastIndex += codePoint != null && codePoint > 0xffff ? 2 : 1;
      }
    }

    return {
      ok: true,
      error: "",
      matches,
      truncated: matches.length >= activeLimits.maxMatches && expression.lastIndex <= text.length,
    };
  }

  function createElement(tag, attributes, text) {
    const element = document.createElement(tag);
    Object.entries(attributes || {}).forEach(([name, value]) => {
      if (name === "className") element.className = value;
      else if (name === "type") element.type = value;
      else if (name.startsWith("aria-")) element.setAttribute(name, value);
      else if (name === "dataset") Object.assign(element.dataset, value);
      else if (name in element) element[name] = value;
      else element.setAttribute(name, value);
    });
    if (text != null) element.textContent = text;
    return element;
  }

  function append(parent, ...children) {
    children.forEach((child) => parent.appendChild(child));
    return parent;
  }

  function injectStyles() {
    if (injectedStyles || !document.head) return;
    injectedStyles = true;
    const style = createElement("style", { id: "mff-regex-builder-styles" });
    style.textContent = `
      .mff-regex-launcher { min-width: 44px; min-height: 44px; margin-inline-start: 6px; border: 1px solid currentColor; border-radius: 999px; background: Canvas; color: CanvasText; cursor: pointer; font: inherit; }
      .mff-regex-launcher[aria-expanded="true"] { outline: 2px solid Highlight; outline-offset: 2px; }
      .mff-regex-popover { position: fixed; z-index: 2147483000; box-sizing: border-box; width: min(720px, calc(100vw - 24px)); max-height: min(720px, calc(100vh - 24px)); overflow: auto; padding: 18px; border: 1px solid color-mix(in srgb, CanvasText 24%, Canvas); border-radius: 24px; background: Canvas; color: CanvasText; box-shadow: 0 12px 36px color-mix(in srgb, CanvasText 24%, transparent); font: 400 14px/1.45 system-ui, sans-serif; }
      .mff-regex-popover[hidden] { display: none; }
      .mff-regex-header, .mff-regex-actions, .mff-regex-mode, .mff-regex-flags, .mff-regex-guide-items { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; }
      .mff-regex-header { justify-content: space-between; margin-block-end: 12px; }
      .mff-regex-header h2 { margin: 0; font-size: 1.2rem; }
      .mff-regex-section { margin-block: 14px; }
      .mff-regex-section > label, .mff-regex-section > strong { display: block; margin-block-end: 6px; }
      .mff-regex-popover input[type="text"], .mff-regex-popover textarea { box-sizing: border-box; width: 100%; min-height: 44px; padding: 10px 12px; border: 1px solid color-mix(in srgb, CanvasText 35%, Canvas); border-radius: 12px; background: Canvas; color: CanvasText; font: inherit; }
      .mff-regex-popover textarea { min-height: 92px; resize: vertical; font-family: ui-monospace, monospace; }
      .mff-regex-popover button { min-height: 40px; padding: 7px 12px; border: 1px solid color-mix(in srgb, CanvasText 30%, Canvas); border-radius: 999px; background: color-mix(in srgb, Highlight 10%, Canvas); color: CanvasText; font: inherit; cursor: pointer; }
      .mff-regex-popover button:focus-visible, .mff-regex-popover input:focus-visible, .mff-regex-popover textarea:focus-visible { outline: 3px solid Highlight; outline-offset: 2px; }
      .mff-regex-mode label, .mff-regex-flags label { display: inline-flex; align-items: center; gap: 5px; min-height: 40px; }
      .mff-regex-guide { border: 0; padding: 0; margin: 12px 0; }
      .mff-regex-guide legend { font-weight: 700; padding: 0; }
      .mff-regex-feedback[data-state="error"] { color: #b3261e; }
      .mff-regex-feedback[data-state="valid"] { color: #146c2e; }
      .mff-regex-results { margin: 8px 0 0; padding-inline-start: 24px; }
      .mff-regex-results li { margin-block: 5px; overflow-wrap: anywhere; }
      .mff-regex-results code { font-family: ui-monospace, monospace; }
      .mff-regex-muted { opacity: .76; }
      @media (prefers-reduced-motion: no-preference) { .mff-regex-popover { transition: opacity 120ms ease, transform 120ms ease; } }
      @media (forced-colors: active) { .mff-regex-popover, .mff-regex-popover button, .mff-regex-launcher { border: 1px solid ButtonText; } }
    `;
    document.head.appendChild(style);
  }

  function copyText(text) {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      return navigator.clipboard.writeText(text);
    }
    return new Promise((resolve, reject) => {
      const textArea = createElement("textarea", { value: text, readOnly: true });
      textArea.style.position = "fixed";
      textArea.style.opacity = "0";
      document.body.appendChild(textArea);
      textArea.select();
      try {
        if (!document.execCommand("copy")) throw new Error("Copy command was refused.");
        resolve();
      } catch (error) {
        reject(error);
      } finally {
        textArea.remove();
      }
    });
  }

  function exportState(state, filename) {
    const payload = JSON.stringify({ schemaVersion: 1, ...state }, null, 2);
    const blob = new Blob([payload], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = createElement("a", {
      href: url,
      download: filename || "regex-filter.json",
    });
    anchor.hidden = true;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
    return payload;
  }

  class RegexBuilderController {
    constructor(field, options) {
      if (!(field instanceof HTMLElement)) throw new TypeError("A search field element is required.");
      if (!(field instanceof HTMLInputElement || field instanceof HTMLTextAreaElement)) {
        throw new TypeError("The search field must be an input or textarea.");
      }

      this.field = field;
      this.options = options && typeof options === "object" ? options : {};
      this.limits = mergeLimits(this.options.limits);
      this.id = `mff-regex-builder-${++controllerSequence}`;
      this.storageKey = this.options.storageKey || field.dataset.regexStorageKey || "";
      this.state = this.loadState();
      this.isOpen = false;
      this.destroyed = false;
      this.boundPosition = () => this.position();
      this.onFieldInput = () => this.handleFieldInput();
      this.onFieldKeydown = (event) => this.handleFieldKeydown(event);
      this.onRequestClose = () => this.close(false);
      this.onDocumentPointerDown = (event) => {
        if (!this.isOpen || this.popover.contains(event.target) || this.launcher.contains(event.target)) return;
        this.close(false);
      };
      this.build();
      this.bind();
      this.render();
    }

    loadState() {
      let stored = null;
      if (this.storageKey) {
        try {
          stored = JSON.parse(global.localStorage.getItem(this.storageKey) || "null");
        } catch (_error) {
          stored = null;
        }
      }
      return normalizeState(
        stored || {
          mode: MODE_PLAIN,
          query: this.field.value,
          pattern: escapeLiteral(this.field.value),
          flags: "",
          sample: "",
        },
        this.limits,
      );
    }

    persist() {
      if (!this.storageKey) return;
      try {
        global.localStorage.setItem(this.storageKey, JSON.stringify(this.state));
      } catch (_error) {
        // Storage can be unavailable in private contexts. The in-memory state
        // remains fully usable and no network fallback is attempted.
      }
    }

    build() {
      injectStyles();
      this.field.setAttribute("aria-haspopup", "dialog");
      this.field.dataset.regexMode = this.state.mode;

      this.launcher = createElement(
        "button",
        {
          type: "button",
          className: "mff-regex-launcher",
          "aria-label": this.options.launcherLabel || "Open regex builder for this search",
          "aria-expanded": "false",
          "aria-controls": this.id,
          title: "Regex builder",
        },
        ".*",
      );
      this.field.insertAdjacentElement("afterend", this.launcher);

      this.popover = createElement("section", {
        id: this.id,
        className: "mff-regex-popover",
        role: "dialog",
        "aria-modal": "false",
        "aria-labelledby": `${this.id}-title`,
        hidden: true,
      });

      const title = createElement("h2", { id: `${this.id}-title` }, "Regex builder");
      this.closeButton = createElement(
        "button",
        { type: "button", "aria-label": "Close regex builder" },
        "Close",
      );
      append(this.popover, append(createElement("header", { className: "mff-regex-header" }), title, this.closeButton));

      this.modePlain = createElement("input", {
        type: "radio",
        name: `${this.id}-mode`,
        value: MODE_PLAIN,
        checked: this.state.mode === MODE_PLAIN,
      });
      this.modeRegex = createElement("input", {
        type: "radio",
        name: `${this.id}-mode`,
        value: MODE_REGEX,
        checked: this.state.mode === MODE_REGEX,
      });
      const modeGroup = createElement("div", { className: "mff-regex-mode", role: "radiogroup", "aria-label": "Search mode" });
      append(
        modeGroup,
        append(createElement("label"), this.modePlain, document.createTextNode("Plain text")),
        append(createElement("label"), this.modeRegex, document.createTextNode("Regular expression")),
      );
      append(this.popover, append(createElement("div", { className: "mff-regex-section" }), modeGroup));

      this.patternInput = createElement("input", {
        type: "text",
        value: this.state.pattern,
        maxLength: this.limits.patternLength,
        spellcheck: false,
        autocomplete: "off",
        "aria-describedby": `${this.id}-feedback`,
      });
      const patternLabel = createElement("label", { htmlFor: `${this.id}-pattern` }, "Pattern");
      this.patternInput.id = `${this.id}-pattern`;
      this.patternSection = append(createElement("div", { className: "mff-regex-section" }), patternLabel, this.patternInput);
      append(this.popover, this.patternSection);

      this.flagsContainer = createElement("div", { className: "mff-regex-flags", role: "group", "aria-label": "Regex flags" });
      this.flagInputs = new Map();
      FLAG_DEFINITIONS.forEach((definition) => {
        if (!supportsFlag(definition.value)) return;
        const checkbox = createElement("input", {
          type: "checkbox",
          value: definition.value,
          checked: this.state.flags.includes(definition.value),
          title: definition.detail,
        });
        this.flagInputs.set(definition.value, checkbox);
        append(this.flagsContainer, append(createElement("label", { title: definition.detail }), checkbox, document.createTextNode(definition.label)));
      });
      this.flagsSection = append(
        createElement("div", { className: "mff-regex-section" }),
        createElement("strong", {}, "Flags"),
        this.flagsContainer,
      );
      append(this.popover, this.flagsSection);

      this.guideContainer = createElement("div");
      GUIDE_GROUPS.forEach((group) => {
        const fieldset = createElement("fieldset", { className: "mff-regex-guide" });
        append(fieldset, createElement("legend", {}, group.label));
        const items = createElement("div", { className: "mff-regex-guide-items" });
        group.items.forEach((item) => {
          const button = createElement("button", { type: "button", dataset: { insert: item.insert } }, item.label);
          if (item.select) button.dataset.select = item.select.join(":");
          items.appendChild(button);
        });
        append(fieldset, items);
        this.guideContainer.appendChild(fieldset);
      });
      this.guideSection = append(
        createElement("div", { className: "mff-regex-section" }),
        createElement("strong", {}, "Guided construction"),
        this.guideContainer,
      );
      append(this.popover, this.guideSection);

      this.sampleInput = createElement("textarea", {
        value: this.state.sample,
        maxLength: this.limits.sampleLength,
        spellcheck: false,
        "aria-describedby": `${this.id}-sample-help`,
      });
      this.sampleInput.id = `${this.id}-sample`;
      const sampleHelp = createElement(
        "div",
        { id: `${this.id}-sample-help`, className: "mff-regex-muted" },
        `Local preview only. Maximum ${this.limits.sampleLength} characters.`,
      );
      append(
        this.popover,
        append(
          createElement("div", { className: "mff-regex-section" }),
          createElement("label", { htmlFor: this.sampleInput.id }, "Sample text"),
          this.sampleInput,
          sampleHelp,
        ),
      );

      this.feedback = createElement("div", {
        id: `${this.id}-feedback`,
        className: "mff-regex-feedback",
        role: "status",
        "aria-live": "polite",
      });
      this.results = createElement("ol", { className: "mff-regex-results", "aria-label": "Live regex matches" });
      append(this.popover, append(createElement("div", { className: "mff-regex-section" }), this.feedback, this.results));

      this.copyButton = createElement("button", { type: "button" }, "Copy pattern");
      this.exportButton = createElement("button", { type: "button" }, "Export JSON");
      this.resetButton = createElement("button", { type: "button" }, "Reset to plain text");
      append(
        this.popover,
        append(createElement("div", { className: "mff-regex-actions" }), this.copyButton, this.exportButton, this.resetButton),
      );

      document.body.appendChild(this.popover);
    }

    bind() {
      this.launcher.addEventListener("click", () => this.toggle());
      this.closeButton.addEventListener("click", () => this.close());
      this.field.addEventListener("input", this.onFieldInput);
      this.field.addEventListener("keydown", this.onFieldKeydown);
      this.popover.addEventListener("keydown", (event) => this.handlePopoverKeydown(event));
      this.popover.addEventListener("mff-request-close", this.onRequestClose);
      this.modePlain.addEventListener("change", () => this.setMode(MODE_PLAIN));
      this.modeRegex.addEventListener("change", () => this.setMode(MODE_REGEX));
      this.patternInput.addEventListener("input", () => {
        this.state.pattern = clampText(this.patternInput.value, this.limits.patternLength);
        this.state.query = this.state.pattern;
        this.field.value = this.state.pattern;
        this.changed();
      });
      this.sampleInput.addEventListener("input", () => {
        this.state.sample = clampText(this.sampleInput.value, this.limits.sampleLength);
        this.changed(false);
      });
      this.flagInputs.forEach((checkbox) => checkbox.addEventListener("change", () => {
        this.state.flags = Array.from(this.flagInputs.entries())
          .filter(([, input]) => input.checked)
          .map(([flag]) => flag)
          .join("");
        this.changed();
      }));
      this.guideContainer.addEventListener("click", (event) => {
        const button = event.target.closest("button[data-insert]");
        if (!button) return;
        this.insertGuide(button.dataset.insert || "", button.dataset.select || "");
      });
      this.copyButton.addEventListener("click", () => {
        const text = this.state.mode === MODE_REGEX ? this.state.pattern : this.state.query;
        copyText(text)
          .then(() => this.setFeedback("Copied to the clipboard.", "valid"))
          .catch((error) => this.setFeedback(`Copy failed: ${error.message}`, "error"));
      });
      this.exportButton.addEventListener("click", () => {
        exportState(this.getState(), `${this.field.id || "search"}-regex-filter.json`);
        this.setFeedback("Exported the local filter settings.", "valid");
      });
      this.resetButton.addEventListener("click", () => this.reset());
      document.addEventListener("pointerdown", this.onDocumentPointerDown);
    }

    handleFieldInput() {
      const value = clampText(this.field.value, this.limits.queryLength);
      if (this.field.value !== value) this.field.value = value;
      this.state.query = value;
      if (this.state.mode === MODE_REGEX) {
        this.state.pattern = value;
        this.patternInput.value = value;
      } else {
        this.state.pattern = escapeLiteral(value);
      }
      this.changed();
    }

    handleFieldKeydown(event) {
      if (event.key === "ArrowDown" && event.altKey) {
        event.preventDefault();
        this.open();
      }
    }

    handlePopoverKeydown(event) {
      if (event.key === "Escape") {
        event.preventDefault();
        this.close(true);
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = Array.from(
        this.popover.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'),
      ).filter((element) => !element.hidden && element.offsetParent !== null);
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    insertGuide(text, selection) {
      this.setMode(MODE_REGEX, false);
      const input = this.patternInput;
      const start = input.selectionStart == null ? input.value.length : input.selectionStart;
      const end = input.selectionEnd == null ? start : input.selectionEnd;
      const next = `${input.value.slice(0, start)}${text}${input.value.slice(end)}`;
      if (next.length > this.limits.patternLength) {
        this.setFeedback(`Pattern limit is ${this.limits.patternLength} characters.`, "error");
        return;
      }
      input.value = next;
      this.state.pattern = next;
      this.state.query = next;
      this.field.value = next;
      const [relativeStart, relativeEnd] = selection
        ? selection.split(":").map((value) => Number(value))
        : [text.length, text.length];
      input.focus();
      input.setSelectionRange(start + relativeStart, start + relativeEnd);
      this.changed();
    }

    setMode(mode, emit = true) {
      const nextMode = mode === MODE_REGEX ? MODE_REGEX : MODE_PLAIN;
      if (nextMode === this.state.mode) return;
      if (nextMode === MODE_REGEX) {
        this.state.pattern = escapeLiteral(this.state.query);
        this.patternInput.value = this.state.pattern;
        this.field.value = this.state.pattern;
        this.state.query = this.state.pattern;
      } else {
        this.state.query = this.state.pattern;
        this.field.value = this.state.query;
      }
      this.state.mode = nextMode;
      this.modePlain.checked = nextMode === MODE_PLAIN;
      this.modeRegex.checked = nextMode === MODE_REGEX;
      if (emit) this.changed();
      else this.render();
    }

    changed(dispatch = true) {
      this.state = normalizeState(this.state, this.limits);
      this.persist();
      this.render();
      if (!dispatch) return;
      const detail = {
        controller: this,
        state: this.getState(),
        compiled: compileState(this.state, this.limits),
      };
      this.field.dispatchEvent(new CustomEvent("material-ffmpeg-regex-change", { bubbles: true, detail }));
      if (typeof this.options.onChange === "function") this.options.onChange(detail);
    }

    render() {
      const regexMode = this.state.mode === MODE_REGEX;
      this.field.dataset.regexMode = this.state.mode;
      this.modePlain.checked = !regexMode;
      this.modeRegex.checked = regexMode;
      this.patternSection.hidden = !regexMode;
      this.flagsSection.hidden = !regexMode;
      this.guideSection.hidden = !regexMode;
      this.patternInput.value = this.state.pattern;
      this.sampleInput.value = this.state.sample;
      this.flagInputs.forEach((checkbox, flag) => {
        checkbox.checked = this.state.flags.includes(flag);
      });

      if (!regexMode) {
        this.setFeedback(
          this.state.query
            ? `Plain-text filter ready. ${this.state.query.length} of ${this.limits.queryLength} characters used.`
            : "Plain-text filter is empty; every item matches.",
          "valid",
        );
        this.results.replaceChildren();
        return;
      }

      const preview = collectMatches(this.state.pattern, this.state.flags, this.state.sample, this.limits);
      if (!preview.ok) {
        this.setFeedback(preview.error, "error");
        this.results.replaceChildren();
        return;
      }

      this.setFeedback(
        preview.truncated
          ? `Pattern is valid. Showing the first ${preview.matches.length} matches.`
          : `Pattern is valid. ${preview.matches.length} ${preview.matches.length === 1 ? "match" : "matches"}.`,
        "valid",
      );
      const fragment = document.createDocumentFragment();
      preview.matches.forEach((match, index) => {
        const item = createElement("li");
        const value = match.zeroWidth ? "zero-width match" : JSON.stringify(match.value);
        append(item, createElement("code", {}, `#${index + 1} ${value} at ${match.index}–${match.end}`));
        if (match.captures.length) {
          const captures = match.captures
            .map((capture) => `$${capture.index}=${capture.value == null ? "unmatched" : JSON.stringify(capture.value)}`)
            .join(", ");
          append(item, document.createTextNode(`; captures: ${captures}`));
        }
        const named = Object.entries(match.groups);
        if (named.length) {
          append(
            item,
            document.createTextNode(
              `; named: ${named.map(([name, value]) => `${name}=${value == null ? "unmatched" : JSON.stringify(value)}`).join(", ")}`,
            ),
          );
        }
        fragment.appendChild(item);
      });
      this.results.replaceChildren(fragment);
    }

    setFeedback(message, state) {
      this.feedback.textContent = message;
      this.feedback.dataset.state = state;
    }

    position() {
      if (!this.isOpen) return;
      const anchor = this.field.getBoundingClientRect();
      const margin = 12;
      const viewportWidth = document.documentElement.clientWidth;
      const viewportHeight = document.documentElement.clientHeight;
      const width = Math.min(720, viewportWidth - margin * 2);
      this.popover.style.width = `${Math.max(280, width)}px`;
      this.popover.style.maxHeight = `${Math.max(240, viewportHeight - margin * 2)}px`;
      const measured = this.popover.getBoundingClientRect();
      let left = Math.min(anchor.left, viewportWidth - measured.width - margin);
      left = Math.max(margin, left);
      const roomBelow = viewportHeight - anchor.bottom - margin;
      const roomAbove = anchor.top - margin;
      let top;
      if (roomBelow >= Math.min(measured.height, 320) || roomBelow >= roomAbove) {
        top = Math.min(anchor.bottom + 8, viewportHeight - measured.height - margin);
      } else {
        top = Math.max(margin, anchor.top - measured.height - 8);
      }
      this.popover.style.left = `${Math.round(left)}px`;
      this.popover.style.top = `${Math.round(Math.max(margin, top))}px`;
    }

    open() {
      if (this.destroyed || this.isOpen) return;
      Array.from(document.querySelectorAll(".mff-regex-popover:not([hidden])")).forEach((popover) => {
        if (popover !== this.popover) popover.dispatchEvent(new CustomEvent("mff-request-close"));
      });
      this.isOpen = true;
      this.popover.hidden = false;
      this.launcher.setAttribute("aria-expanded", "true");
      global.addEventListener("resize", this.boundPosition);
      global.addEventListener("scroll", this.boundPosition, true);
      this.position();
      (this.state.mode === MODE_REGEX ? this.patternInput : this.modePlain).focus();
    }

    close(returnFocus = true) {
      if (!this.isOpen) return;
      this.isOpen = false;
      this.popover.hidden = true;
      this.launcher.setAttribute("aria-expanded", "false");
      global.removeEventListener("resize", this.boundPosition);
      global.removeEventListener("scroll", this.boundPosition, true);
      if (returnFocus) this.field.focus();
    }

    toggle() {
      if (this.isOpen) this.close();
      else this.open();
    }

    getState() {
      return { ...this.state };
    }

    setState(nextState, options) {
      const settings = options || {};
      this.state = normalizeState({ ...this.state, ...(nextState || {}) }, this.limits);
      this.field.value = this.state.mode === MODE_REGEX ? this.state.pattern : this.state.query;
      this.changed(settings.emit !== false);
      return this.getState();
    }

    reset() {
      this.state = normalizeState(
        { mode: MODE_PLAIN, query: "", pattern: "", flags: "", sample: "" },
        this.limits,
      );
      this.field.value = "";
      this.changed();
      this.modePlain.focus();
    }

    matches(value, options) {
      return matchesText(value, this.state, { ...options, limits: this.limits });
    }

    filter(items, getText, options) {
      return filterItems(items, this.state, getText, { ...options, limits: this.limits });
    }

    filterElements(elements, options) {
      return filterElements(elements, this.state, { ...options, limits: this.limits });
    }

    destroy() {
      if (this.destroyed) return;
      this.close(false);
      this.destroyed = true;
      this.field.removeEventListener("input", this.onFieldInput);
      this.field.removeEventListener("keydown", this.onFieldKeydown);
      this.popover.removeEventListener("mff-request-close", this.onRequestClose);
      document.removeEventListener("pointerdown", this.onDocumentPointerDown);
      this.field.removeAttribute("aria-haspopup");
      delete this.field.dataset.regexMode;
      this.launcher.remove();
      this.popover.remove();
      CONTROLLERS.delete(this.field);
    }
  }

  function attach(field, options) {
    if (CONTROLLERS.has(field)) return CONTROLLERS.get(field);
    const controller = new RegexBuilderController(field, options);
    CONTROLLERS.set(field, controller);
    return controller;
  }

  function detach(field) {
    const controller = CONTROLLERS.get(field);
    if (controller) controller.destroy();
  }

  function getController(field) {
    return CONTROLLERS.get(field) || null;
  }

  function autoMount(root, options) {
    const scope = root && typeof root.querySelectorAll === "function" ? root : document;
    const fields = [];
    if (scope.matches && scope.matches(FIELD_SELECTOR)) fields.push(scope);
    fields.push(...scope.querySelectorAll(FIELD_SELECTOR));
    return fields.map((field) => attach(field, options));
  }

  const api = Object.freeze({
    version: API_VERSION,
    modes: Object.freeze({ plain: MODE_PLAIN, regex: MODE_REGEX }),
    limits: DEFAULT_LIMITS,
    selector: FIELD_SELECTOR,
    RegexBuilderController,
    attach,
    detach,
    getController,
    autoMount,
    escapeLiteral,
    normalizeFlags,
    normalizeState,
    validateRegex,
    compileState,
    createMatcher,
    collectMatches,
    matchesText,
    filterItems,
    filterElements,
    adapters: Object.freeze({
      tabs: filterElements,
      dropdown: filterElements,
      contextMenu: filterElements,
      settings: filterElements,
      commandPalette: filterElements,
    }),
  });

  Object.defineProperty(global, "MaterialFfmpegRegexBuilder", {
    configurable: false,
    enumerable: true,
    writable: false,
    value: api,
  });

  function mountWhenReady() {
    autoMount(document);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", mountWhenReady, { once: true });
  } else {
    mountWhenReady();
  }
})(window);
