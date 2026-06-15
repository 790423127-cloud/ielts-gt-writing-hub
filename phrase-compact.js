(() => {
  let formatting = false;

  function compactPhraseGroups() {
    const root = document.getElementById("phraseGroups");
    if (!root || formatting) return;

    const groups = [...root.querySelectorAll(":scope > .phrase-group")]
      .filter((group) => group.tagName.toLowerCase() !== "details");
    if (!groups.length) return;

    formatting = true;
    groups.forEach((group, index) => {
      const title = group.querySelector("h4")?.textContent.trim() || "Phrases";
      const buttons = [...group.querySelectorAll(".phrase-btn")];
      const details = document.createElement("details");
      details.className = group.className;
      if (index === 0) details.open = true;

      const summary = document.createElement("summary");
      const label = document.createElement("span");
      label.textContent = title;
      const count = document.createElement("span");
      count.className = "phrase-count";
      count.textContent = `${buttons.length} 条`;
      summary.append(label, count);

      const body = document.createElement("div");
      body.className = "phrase-buttons";
      buttons.forEach((button) => body.appendChild(button));

      details.append(summary, body);
      group.replaceWith(details);
    });
    formatting = false;
  }

  function bootPhraseCompact() {
    const root = document.getElementById("phraseGroups");
    if (!root || root.dataset.compactObserver === "on") return;
    root.dataset.compactObserver = "on";
    new MutationObserver(compactPhraseGroups).observe(root, { childList: true });
    compactPhraseGroups();
  }

  document.addEventListener("DOMContentLoaded", bootPhraseCompact);
  window.addEventListener("hashchange", () => setTimeout(bootPhraseCompact, 0));
  setTimeout(bootPhraseCompact, 0);
})();

(() => {
  const LIVE_PANEL_ID = "liveCheckSection";
  const LIVE_STATUS_ID = "liveCheckStatus";
  const LIVE_LIST_ID = "liveSuggestions";
  const LIVE_TOGGLE_ID = "liveCheckToggle";
  const LIVE_MODE_ID = "liveCheckMode";
  const LIVE_OVERLAY_ID = "liveCheckOverlay";
  const LIVE_UNDERLINE_TOGGLE_ID = "liveUnderlineToggle";
  const LIVE_DEBOUNCE_MS = 1200;
  const MIN_CHECK_CHARS = 12;
  const MAX_SENTENCE_CHARS = 650;
  const LIVE_MODE_KEY = "ielts-gt-writing-hub:liveCheckMode";
  const LIVE_ENABLED_KEY = "ielts-gt-writing-hub:liveCheckEnabled";
  const LIVE_UNDERLINE_KEY = "ielts-gt-writing-hub:liveUnderlineEnabled";

  let booted = false;
  let checkTimer = null;
  let activeRequest = null;
  let requestVersion = 0;
  let lastSuggestions = [];

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function injectLiveStyles() {
    if (document.getElementById("liveCheckStyles")) return;
    const style = document.createElement("style");
    style.id = "liveCheckStyles";
    style.textContent = `
      .live-check-card { border: 1px solid rgba(59, 130, 246, 0.22); background: linear-gradient(180deg, rgba(59,130,246,.08), rgba(255,255,255,.03)); }
      .live-check-topline { display: flex; justify-content: space-between; gap: 10px; align-items: center; margin-bottom: 10px; }
      .live-check-controls { display: grid; gap: 8px; margin: 10px 0 12px; }
      .live-check-toggle { display: flex; align-items: center; gap: 8px; font-size: 13px; color: inherit; }
      .live-check-toggle input { width: auto; }
      .live-check-select { width: 100%; border-radius: 12px; border: 1px solid rgba(148,163,184,.35); padding: 8px 10px; background: rgba(255,255,255,.86); color: #0f172a; }
      .live-check-status { min-height: 20px; }
      .live-suggestions { display: grid; gap: 10px; }
      .live-empty { border: 1px dashed rgba(148,163,184,.45); border-radius: 14px; padding: 12px; color: var(--muted, #64748b); font-size: 13px; line-height: 1.5; }
      .live-suggestion-card { border: 1px solid rgba(148,163,184,.28); border-radius: 14px; padding: 12px; background: rgba(255,255,255,.78); box-shadow: 0 8px 24px rgba(15,23,42,.05); }
      .live-suggestion-head { display: flex; justify-content: space-between; gap: 8px; align-items: center; margin-bottom: 8px; }
      .live-badge { font-size: 11px; letter-spacing: .08em; text-transform: uppercase; border-radius: 999px; padding: 4px 8px; background: rgba(59,130,246,.12); color: #1d4ed8; font-weight: 700; }
      .live-original, .live-replacement { font-size: 13px; line-height: 1.45; margin: 6px 0; }
      .live-original del { color: #b91c1c; text-decoration-thickness: 2px; }
      .live-replacement strong { color: #047857; }
      .live-message { font-size: 13px; line-height: 1.5; color: var(--muted, #475569); }
      .live-actions { display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; }
      .live-actions button { border: 1px solid rgba(148,163,184,.38); background: rgba(255,255,255,.84); border-radius: 999px; padding: 7px 10px; cursor: pointer; font-weight: 700; }
      .live-actions button[data-live-action="apply"] { background: #2563eb; color: #fff; border-color: #2563eb; }
      .live-hidden-answer .live-replacement, .live-hidden-answer .live-message-answer { display: none; }
      .live-error { color: #b91c1c; }
      .live-editor-wrap { position: relative; width: 100%; }
      .live-editor-wrap .essay { position: relative; z-index: 2; width: 100%; }
      .live-editor-wrap.live-underline-on .essay { background: transparent !important; color: transparent !important; caret-color: #0f172a; }
      .live-editor-wrap.live-underline-on .essay::selection { background: rgba(96,165,250,.35); color: transparent; }
      .live-check-overlay { position: absolute; inset: 0; z-index: 1; overflow: auto; pointer-events: none; box-sizing: border-box; white-space: pre-wrap; overflow-wrap: break-word; color: #0f172a; background: transparent; }
      .live-check-overlay::-webkit-scrollbar { width: 0; height: 0; }
      .live-underline-mark { background: transparent; color: inherit; text-decoration-line: underline; text-decoration-style: wavy; text-decoration-thickness: 1.5px; text-underline-offset: 3px; cursor: pointer; }
      .live-underline-mark[data-live-type="grammar"], .live-underline-mark[data-live-type="spelling"] { text-decoration-color: #dc2626; }
      .live-underline-mark[data-live-type="vocabulary"], .live-underline-mark[data-live-type="clarity"] { text-decoration-color: #d97706; }
      .live-underline-mark[data-live-type="coherence"], .live-underline-mark[data-live-type="task"] { text-decoration-color: #2563eb; }
      body.dark .live-check-select, body.dark .live-suggestion-card, body.dark .live-actions button { background: rgba(15,23,42,.85); color: #e5e7eb; }
      body.dark .live-editor-wrap.live-underline-on .essay { caret-color: #f8fafc; }
      body.dark .live-check-overlay { color: #e5e7eb; }
    `;
    document.head.appendChild(style);
  }

  function liveEndpoint() {
    const input = document.getElementById("gradingEndpointInput");
    const raw = String(input?.value || "").trim();
    if (raw) {
      try {
        const url = new URL(raw, window.location.origin);
        url.pathname = "/api/live-check";
        url.search = "";
        url.hash = "";
        return url.toString();
      } catch {}
    }
    if (/github\.io$/i.test(window.location.hostname)) {
      return "https://ielts-gt-writing-hub.vercel.app/api/live-check";
    }
    return "/api/live-check";
  }

  function getCurrentTask() {
    const meta = document.getElementById("metaTags")?.textContent || "";
    if (/Task\s*1/i.test(meta)) return "Task 1";
    if (/Task\s*2/i.test(meta)) return "Task 2";
    const target = document.getElementById("wordTarget")?.textContent || "";
    return /250/.test(target) ? "Task 2" : "Task 1";
  }

  function getPromptText() {
    return document.getElementById("practicePrompt")?.textContent || "";
  }

  function setStatus(message, className = "") {
    const status = document.getElementById(LIVE_STATUS_ID);
    if (!status) return;
    status.textContent = message || "";
    status.className = `muted live-check-status ${className}`.trim();
  }

  function getMode() {
    const select = document.getElementById(LIVE_MODE_ID);
    return String(select?.value || localStorage.getItem(LIVE_MODE_KEY) || "practice");
  }

  function underlineEnabled() {
    const toggle = document.getElementById(LIVE_UNDERLINE_TOGGLE_ID);
    return Boolean(toggle?.checked);
  }

  function isEnabled() {
    const toggle = document.getElementById(LIVE_TOGGLE_ID);
    return Boolean(toggle?.checked) && getMode() !== "exam";
  }

  function isSentenceBoundary(ch) {
    return /[.!?。！？\n]/.test(ch || "");
  }

  function currentSentence(text, cursor) {
    const source = String(text || "");
    const safeCursor = Math.max(0, Math.min(Number(cursor) || source.length, source.length));
    let start = 0;
    let end = source.length;

    for (let i = safeCursor - 1; i >= 0; i -= 1) {
      if (isSentenceBoundary(source[i])) {
        start = i + 1;
        break;
      }
    }
    for (let i = safeCursor; i < source.length; i += 1) {
      if (isSentenceBoundary(source[i])) {
        end = i + 1;
        break;
      }
    }

    while (start < end && /\s/.test(source[start])) start += 1;
    while (end > start && /\s/.test(source[end - 1])) end -= 1;

    if (end - start > MAX_SENTENCE_CHARS) {
      start = Math.max(0, safeCursor - Math.floor(MAX_SENTENCE_CHARS * 0.45));
      end = Math.min(source.length, start + MAX_SENTENCE_CHARS);
      while (start < end && /\s/.test(source[start])) start += 1;
      while (end > start && /\s/.test(source[end - 1])) end -= 1;
    }

    return { text: source.slice(start, end), offsetStart: start };
  }

  function uniqueOccurrencePosition(text, needle) {
    const source = String(text || "");
    const target = String(needle || "");
    if (!target) return -1;
    let count = 0;
    let only = -1;
    let from = 0;
    while (from <= source.length) {
      const found = source.indexOf(target, from);
      if (found < 0) break;
      count += 1;
      only = found;
      if (count > 1) return -1;
      from = found + Math.max(1, target.length);
    }
    return count === 1 ? only : -1;
  }

  function normalizeSuggestion(raw, index, fullText = "") {
    let start = Number(raw.globalStart ?? raw.start);
    let end = Number(raw.globalEnd ?? raw.end);
    const original = String(raw.original || "");
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || !original.trim()) return null;

    const source = String(fullText || "");
    if (source) {
      if (source.slice(start, end) !== original) {
        const unique = uniqueOccurrencePosition(source, original);
        if (unique < 0) return null;
        start = unique;
        end = unique + original.length;
      }
      if (source.slice(start, end) !== original) return null;
    }

    return {
      id: String(raw.id || `s-${index}`),
      start,
      end,
      original,
      replacement: String(raw.replacement || ""),
      type: String(raw.type || "grammar"),
      confidence: Number(raw.confidence || 0),
      message: String(raw.message || "This sentence has a clear language issue."),
      messageZh: String(raw.messageZh || "这个句子里有一个比较明确的语言问题。"),
      ieltsImpact: String(raw.ieltsImpact || "This may affect IELTS Writing accuracy and clarity.")
    };
  }

  function getEssayWrap() {
    return document.getElementById("essayInput")?.closest(".live-editor-wrap") || null;
  }

  function syncOverlayMetrics() {
    const essay = document.getElementById("essayInput");
    const overlay = document.getElementById(LIVE_OVERLAY_ID);
    if (!essay || !overlay) return;
    const style = window.getComputedStyle(essay);
    [
      "fontFamily", "fontSize", "fontWeight", "fontStyle", "lineHeight", "letterSpacing",
      "textTransform", "textAlign", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
      "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "borderRadius",
      "boxSizing", "tabSize"
    ].forEach((key) => { overlay.style[key] = style[key]; });
    overlay.style.borderStyle = "solid";
    overlay.style.borderColor = "transparent";
    overlay.style.minHeight = `${essay.offsetHeight}px`;
    overlay.scrollTop = essay.scrollTop;
    overlay.scrollLeft = essay.scrollLeft;
  }

  function setupEditorUnderlineLayer() {
    const essay = document.getElementById("essayInput");
    if (!essay) return null;
    let wrap = essay.closest(".live-editor-wrap");
    if (wrap) return wrap;

    wrap = document.createElement("div");
    wrap.className = "live-editor-wrap";
    const overlay = document.createElement("div");
    overlay.id = LIVE_OVERLAY_ID;
    overlay.className = "live-check-overlay";
    overlay.setAttribute("aria-hidden", "true");

    essay.parentElement.insertBefore(wrap, essay);
    wrap.appendChild(overlay);
    wrap.appendChild(essay);

    essay.addEventListener("scroll", () => {
      overlay.scrollTop = essay.scrollTop;
      overlay.scrollLeft = essay.scrollLeft;
    });
    essay.addEventListener("input", () => renderUnderlines());
    window.addEventListener("resize", syncOverlayMetrics);
    syncOverlayMetrics();
    return wrap;
  }

  function renderUnderlines() {
    const essay = document.getElementById("essayInput");
    const overlay = document.getElementById(LIVE_OVERLAY_ID);
    const wrap = getEssayWrap();
    if (!essay || !overlay || !wrap) return;
    syncOverlayMetrics();

    const text = essay.value || "";
    const activeItems = underlineEnabled() && getMode() !== "exam"
      ? lastSuggestions
          .map((item, index) => normalizeSuggestion(item, index, text))
          .filter(Boolean)
          .filter((item) => item.start >= 0 && item.end <= text.length && item.start < item.end)
          .filter((item) => text.slice(item.start, item.end) === item.original)
          .sort((a, b) => a.start - b.start || a.end - b.end)
      : [];

    if (!activeItems.length || !text) {
      overlay.textContent = "";
      wrap.classList.remove("live-underline-on");
      return;
    }

    let html = "";
    let cursor = 0;
    activeItems.forEach((item, index) => {
      if (item.start < cursor) return;
      html += escapeHtml(text.slice(cursor, item.start));
      const marked = text.slice(item.start, item.end);
      html += `<mark class="live-underline-mark" data-live-index="${index}" data-live-type="${escapeHtml(item.type)}" title="${escapeHtml(item.messageZh || item.message)}">${escapeHtml(marked)}</mark>`;
      cursor = item.end;
    });
    html += escapeHtml(text.slice(cursor));
    overlay.innerHTML = html || " ";
    wrap.classList.add("live-underline-on");
    overlay.scrollTop = essay.scrollTop;
    overlay.scrollLeft = essay.scrollLeft;
  }

  function renderSuggestions(items = []) {
    const list = document.getElementById(LIVE_LIST_ID);
    if (!list) return;
    const essayText = document.getElementById("essayInput")?.value || "";
    lastSuggestions = items.map((item, index) => normalizeSuggestion(item, index, essayText)).filter(Boolean);
    const mode = getMode();
    renderUnderlines();

    if (mode === "exam") {
      list.innerHTML = `<div class="live-empty">Exam Mode 已开启：实时提醒关闭。写完后再点“开始批改”，更接近考试训练。</div>`;
      return;
    }

    if (!lastSuggestions.length) {
      list.innerHTML = `<div class="live-empty">继续写。系统会在你停顿约 1 秒后只检查当前句子。现在只有精确匹配的明确错误才会画线。</div>`;
      return;
    }

    list.innerHTML = lastSuggestions.map((item, index) => {
      const hiddenClass = mode === "practice" ? " live-hidden-answer" : "";
      return `
        <article class="live-suggestion-card${hiddenClass}" data-live-index="${index}">
          <div class="live-suggestion-head">
            <span class="live-badge">${escapeHtml(item.type)}</span>
            <small>sentence-level</small>
          </div>
          <p class="live-original"><del>${escapeHtml(item.original)}</del></p>
          <p class="live-replacement"><strong>${escapeHtml(item.replacement)}</strong></p>
          <p class="live-message">${escapeHtml(item.messageZh || item.message)}</p>
          <p class="live-message live-message-answer">IELTS impact: ${escapeHtml(item.ieltsImpact)}</p>
          <div class="live-actions">
            ${mode === "practice" ? `<button type="button" data-live-action="show" data-live-index="${index}">Show answer</button>` : ""}
            <button type="button" data-live-action="apply" data-live-index="${index}">Apply</button>
          </div>
        </article>
      `;
    }).join("");
  }

  function applySuggestion(index) {
    const item = lastSuggestions[Number(index)];
    const essay = document.getElementById("essayInput");
    if (!item || !essay) return;
    const value = essay.value || "";
    let start = item.start;
    let end = item.end;

    if (value.slice(start, end) !== item.original) {
      const unique = uniqueOccurrencePosition(value, item.original);
      if (unique < 0) {
        setStatus("原文已经变化，未自动替换。请继续输入后让系统重新检查。", "live-error");
        return;
      }
      start = unique;
      end = unique + item.original.length;
    }

    essay.value = `${value.slice(0, start)}${item.replacement}${value.slice(end)}`;
    essay.focus();
    const cursor = start + item.replacement.length;
    essay.setSelectionRange(cursor, cursor);
    essay.dispatchEvent(new Event("input", { bubbles: true }));
    lastSuggestions.splice(Number(index), 1);
    renderSuggestions(lastSuggestions);
    scheduleLiveCheck();
  }

  async function runLiveCheck() {
    const essay = document.getElementById("essayInput");
    if (!essay || !isEnabled()) return;
    const fullText = essay.value || "";
    if (fullText.trim().length < MIN_CHECK_CHARS) {
      renderSuggestions([]);
      setStatus("输入更多内容后开始检查当前句子。");
      return;
    }

    const version = ++requestVersion;
    if (activeRequest) activeRequest.abort();
    activeRequest = new AbortController();
    const segment = currentSentence(fullText, essay.selectionStart ?? fullText.length);
    if (segment.text.trim().length < MIN_CHECK_CHARS) return;

    setStatus("正在检查当前句子……");
    try {
      const response = await fetch(liveEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: segment.text,
          offsetStart: segment.offsetStart,
          task: getCurrentTask(),
          prompt: getPromptText(),
          mode: getMode(),
          sentenceOnly: true
        }),
        signal: activeRequest.signal
      });
      const data = await response.json().catch(() => ({}));
      if (version !== requestVersion) return;
      if (!response.ok || data.ok === false) {
        renderSuggestions([]);
        setStatus(data.error || "实时检查暂时失败。", "live-error");
        return;
      }
      renderSuggestions(Array.isArray(data.suggestions) ? data.suggestions : []);
      setStatus(data.suggestions?.length ? `发现 ${data.suggestions.length} 条句子级建议，已精确标线。` : "当前句子没有明显问题。");
    } catch (error) {
      if (error?.name === "AbortError") return;
      if (version !== requestVersion) return;
      renderSuggestions([]);
      setStatus("实时检查连接失败，请确认 Vercel API 已部署。", "live-error");
    }
  }

  function scheduleLiveCheck() {
    clearTimeout(checkTimer);
    renderUnderlines();
    if (!isEnabled()) return;
    checkTimer = setTimeout(runLiveCheck, LIVE_DEBOUNCE_MS);
  }

  function createPanel() {
    const existing = document.getElementById(LIVE_PANEL_ID);
    if (existing) return existing;
    const anchor = document.getElementById("aiGradingSection") || document.getElementById("quickReference")?.parentElement;
    if (!anchor) return null;

    const section = document.createElement("section");
    section.id = LIVE_PANEL_ID;
    section.className = "assistant-card live-check-card";
    section.innerHTML = `
      <div class="live-check-topline">
        <div>
          <p class="eyebrow">LIVE CHECK</p>
          <h3>实时写作建议</h3>
        </div>
        <span class="live-badge">Sentence</span>
      </div>
      <p class="muted">停顿约 1 秒后，只检查光标所在的当前句子。现在不会按段落检查，误标会更少。</p>
      <div class="live-check-controls">
        <label class="live-check-toggle"><input id="${LIVE_TOGGLE_ID}" type="checkbox"> 开启实时检查</label>
        <label class="live-check-toggle"><input id="${LIVE_UNDERLINE_TOGGLE_ID}" type="checkbox"> 文内波浪线</label>
        <select id="${LIVE_MODE_ID}" class="live-check-select">
          <option value="practice">Practice：先提示，点开看答案</option>
          <option value="help">Help：直接显示修改建议</option>
          <option value="exam">Exam：关闭实时提醒</option>
        </select>
      </div>
      <p id="${LIVE_STATUS_ID}" class="muted live-check-status">输入后停顿一下开始检查当前句子。</p>
      <div id="${LIVE_LIST_ID}" class="live-suggestions"></div>
    `;
    anchor.parentElement?.insertBefore(section, anchor);
    return section;
  }

  function bootLiveCheck() {
    if (booted) return;
    const essay = document.getElementById("essayInput");
    if (!essay) return;
    injectLiveStyles();
    setupEditorUnderlineLayer();
    const panel = createPanel();
    if (!panel) return;

    const toggle = document.getElementById(LIVE_TOGGLE_ID);
    const underlineToggle = document.getElementById(LIVE_UNDERLINE_TOGGLE_ID);
    const mode = document.getElementById(LIVE_MODE_ID);
    if (toggle) toggle.checked = localStorage.getItem(LIVE_ENABLED_KEY) !== "off";
    if (underlineToggle) underlineToggle.checked = localStorage.getItem(LIVE_UNDERLINE_KEY) !== "off";
    if (mode) mode.value = localStorage.getItem(LIVE_MODE_KEY) || "practice";

    essay.addEventListener("input", scheduleLiveCheck);
    essay.addEventListener("keyup", scheduleLiveCheck);
    essay.addEventListener("click", scheduleLiveCheck);
    essay.addEventListener("scroll", renderUnderlines);

    toggle?.addEventListener("change", () => {
      localStorage.setItem(LIVE_ENABLED_KEY, toggle.checked ? "on" : "off");
      if (!toggle.checked) {
        clearTimeout(checkTimer);
        if (activeRequest) activeRequest.abort();
        renderSuggestions([]);
        setStatus("实时检查已关闭。");
      } else {
        scheduleLiveCheck();
      }
    });

    underlineToggle?.addEventListener("change", () => {
      localStorage.setItem(LIVE_UNDERLINE_KEY, underlineToggle.checked ? "on" : "off");
      renderUnderlines();
    });

    mode?.addEventListener("change", () => {
      localStorage.setItem(LIVE_MODE_KEY, mode.value);
      if (mode.value === "exam") {
        clearTimeout(checkTimer);
        if (activeRequest) activeRequest.abort();
      }
      renderSuggestions(lastSuggestions);
      scheduleLiveCheck();
    });

    panel.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-live-action]");
      if (!button) return;
      const action = button.dataset.liveAction;
      const index = button.dataset.liveIndex;
      if (action === "show") {
        button.closest(".live-suggestion-card")?.classList.remove("live-hidden-answer");
        button.remove();
      }
      if (action === "apply") applySuggestion(index);
    });

    renderSuggestions([]);
    booted = true;
  }

  document.addEventListener("DOMContentLoaded", bootLiveCheck);
  window.addEventListener("hashchange", () => setTimeout(bootLiveCheck, 0));
  setTimeout(bootLiveCheck, 0);
})();
