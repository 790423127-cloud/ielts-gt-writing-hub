(() => {
  const DATA = window.IELTS_GT_DATA || { prompts: [], meta: {}, phraseBanks: { task1: {}, task2: {} } };
  const prompts = Array.isArray(DATA.prompts) ? DATA.prompts : [];
  let selected = null;
  let timerId = null;
  let remaining = 0;
  let latestScoreResult = null;
  let latestScoringProgress = null;
  const SCORING_STEPS = [
    { stage: "score-precheck", title: "文本信号与任务类型检查", description: "检查词数、段落、句子、Task 1/Task 2 类型与可评分性。" },
    { stage: "score-criteria", title: "四项评分与半分判断", description: "AI 返回四项小项分数，并解释相邻半分边界。" },
    { stage: "score-gates", title: "低中高分与分数组合校准", description: "核查低分、中分、高分边界和分数组合是否合理。" },
    { stage: "score-finalize", title: "机械平均并冻结分数", description: "四项平均后生成最终 Band，并冻结分数。" }
  ];
  const GRADING_ENDPOINT_KEY = "ielts-gt-writing-hub:gradingEndpoint";

  const $ = (id) => document.getElementById(id);
  const els = {
    themeBtn: $("themeBtn"), bookFilter: $("bookFilter"), testFilter: $("testFilter"), taskFilter: $("taskFilter"), typeFilter: $("typeFilter"), searchInput: $("searchInput"),
    promptList: $("promptList"), countLabel: $("countLabel"), emptyState: $("emptyState"), practiceView: $("practiceView"), metaTags: $("metaTags"), sourceStatus: $("sourceStatus"), practiceTitle: $("practiceTitle"), practicePrompt: $("practicePrompt"), infoGrid: $("infoGrid"), timerDisplay: $("timerDisplay"), timerBtn: $("timerBtn"), resetTimerBtn: $("resetTimerBtn"), planArea: $("planArea"), essayInput: $("essayInput"), wordCount: $("wordCount"), wordTarget: $("wordTarget"), copyBtn: $("copyBtn"), clearBtn: $("clearBtn"), statusText: $("statusText"), favoriteInput: $("favoriteInput"), structureList: $("structureList"), bandTips: $("bandTips"), phraseKicker: $("phraseKicker"), phraseTitle: $("phraseTitle"), phraseGroups: $("phraseGroups"), backBtn: $("backBtn"), gradingEndpointInput: $("gradingEndpointInput"), gradingModeSelect: $("gradingModeSelect"), gradeBtn: $("gradeBtn"), generateRevisionBtn: $("generateRevisionBtn"), gradingStatus: $("gradingStatus"), gradingResults: $("gradingResults"), restoreOriginalBtn: $("restoreOriginalBtn"), revisionCompareArea: $("revisionCompareArea"), compareOriginalText: $("compareOriginalText"), compareRevisedText: $("compareRevisedText")
  };

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  }
  function unique(items) { return [...new Set(items.filter(Boolean))]; }
  function countWords(text) { return (String(text || "").trim().match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g) || []).length; }
  function fmt(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
  function storageKey(id, part) { return `ielts-gt-writing-hub:${id}:${part}`; }
  function save(id, part, value) { localStorage.setItem(storageKey(id, part), value); }
  function load(id, part) { return localStorage.getItem(storageKey(id, part)) || ""; }
  function tag(text, cls) { return `<span class="tag ${cls}">${escapeHtml(text)}</span>`; }
  function listHtml(items) {
    const arr = Array.isArray(items) ? items.filter(Boolean) : [];
    return arr.length ? `<ul>${arr.map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : `<p class="muted">暂无内容</p>`;
  }
  function formatBand(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(1).replace(/\.0$/, ".0") : "-";
  }
  function fillSelect(select, values, allText) {
    if (!select) return;
    select.innerHTML = `<option value="all">${escapeHtml(allText)}</option>` + values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  }

  function setupGradingModes() {
    // Scoring and essay generation are separated. The old combined grading-mode selector is removed from the UI.
    if (els.gradingModeSelect) {
      const wrapper = els.gradingModeSelect.closest("label") || els.gradingModeSelect.parentElement;
      if (wrapper) wrapper.remove();
      els.gradingModeSelect = null;
    }
    ensureGenerateRevisionButton();
  }

  function ensureGenerateRevisionButton() {
    if (els.generateRevisionBtn && document.body.contains(els.generateRevisionBtn)) return els.generateRevisionBtn;
    let btn = $("generateRevisionBtn");
    if (!btn) {
      btn = document.createElement("button");
      btn.id = "generateRevisionBtn";
      btn.type = "button";
      btn.className = "secondary";
      btn.textContent = "生成作文 / Generate essay";
      const anchor = els.gradeBtn;
      if (anchor && anchor.parentElement) anchor.insertAdjacentElement("afterend", btn);
    }
    btn.addEventListener("click", generateEssayOnly);
    els.generateRevisionBtn = btn;
    return btn;
  }

  function initFilters() {
    fillSelect(els.bookFilter, DATA.meta?.books || unique(prompts.map((p) => p.book)), "全部 Books");
    fillSelect(els.testFilter, ["Test 1", "Test 2", "Test 3", "Test 4"], "全部 Test");
    fillSelect(els.taskFilter, ["Task 1", "Task 2"], "Task 1 + Task 2");
    fillSelect(els.typeFilter, unique(prompts.map((p) => p.type)).sort(), "全部题型");
    if ($("booksStat")) $("booksStat").textContent = (DATA.meta?.books || unique(prompts.map((p) => p.book))).length;
    if ($("testsStat")) $("testsStat").textContent = ((DATA.meta?.books || unique(prompts.map((p) => p.book))).length || 0) * (DATA.meta?.testsPerBook || 4);
    if ($("task1Stat")) $("task1Stat").textContent = prompts.filter((p) => p.task === "Task 1").length;
    if ($("task2Stat")) $("task2Stat").textContent = prompts.filter((p) => p.task === "Task 2").length;
  }

  function filteredPrompts() {
    const q = String(els.searchInput?.value || "").trim().toLowerCase();
    return prompts.filter((p) => {
      const text = [p.book, p.test, p.module, p.task, p.type, p.letterStyle || "", p.title, p.prompt, p.difficulty].join(" ").toLowerCase();
      return text.includes(q)
        && (!els.bookFilter || els.bookFilter.value === "all" || p.book === els.bookFilter.value)
        && (!els.testFilter || els.testFilter.value === "all" || p.test === els.testFilter.value)
        && (!els.taskFilter || els.taskFilter.value === "all" || p.task === els.taskFilter.value)
        && (!els.typeFilter || els.typeFilter.value === "all" || p.type === els.typeFilter.value);
    });
  }

  function renderList() {
    if (!els.promptList) return;
    const list = filteredPrompts();
    if (els.countLabel) els.countLabel.textContent = `${list.length} / ${prompts.length}`;
    els.promptList.innerHTML = list.length ? list.map((p) => `
      <button class="prompt-btn ${selected && selected.id === p.id ? "active" : ""}" type="button" data-id="${escapeHtml(p.id)}">
        <div class="tags">${tag(String(p.book || "").replace("Cambridge IELTS ", "C"), "book")}${tag(p.test, "book")}${tag(p.task, p.task === "Task 1" ? "task1" : "task2")}${tag(p.type, "type")}</div>
        <h3>${escapeHtml(p.title)}</h3>
        <span class="muted">${escapeHtml(p.sourceStatus || "")}</span>
      </button>`).join("") : `<p class="muted">没有匹配的练习题，请调整筛选或搜索关键词。</p>`;
    els.promptList.querySelectorAll("button[data-id]").forEach((btn) => btn.addEventListener("click", () => selectPrompt(btn.dataset.id)));
  }

  function renderInfo(p) {
    if (!els.infoGrid) return;
    const info = [
      ["Module", p.module],
      [p.task === "Task 1" ? "书信类型" : "题型", p.task === "Task 1" ? p.letterStyle : p.type],
      ["建议字数", `至少 ${p.recommendedWords} words`],
      ["计时", `${p.timeLimit} 分钟`],
      ["难度", p.difficulty],
      ["来源状态", p.sourceStatus]
    ];
    els.infoGrid.innerHTML = info.map(([k, v]) => `<div class="info"><span>${escapeHtml(k)}</span><strong>${escapeHtml(v)}</strong></div>`).join("");
  }

  function renderPlan(p) {
    if (!els.planArea) return;
    const fields = p.task === "Task 1"
      ? [["purpose", "Task 1 letter purpose 分析", p.notes?.focus || ""], ["tone", "语气与读者关系", `Reader: ${p.letterStyle || ""}`], ["bullets", "三个 bullet points 覆盖计划", "Bullet 1:\nBullet 2:\nBullet 3:"], ["details", "可加入的细节", "time / place / reason / result / request"]]
      : [["position", "Task 2 position 分析", p.notes?.focus || ""], ["reasons", "Reasons", "Reason 1:\nReason 2:"], ["examples", "Examples", "Example 1:\nExample 2:"], ["balance", "让步或反方观点", "Although ..., I believe ..."]];
    els.planArea.innerHTML = fields.map(([key, label, placeholder]) => `<label><span class="muted">${escapeHtml(label)}</span><textarea data-plan="${escapeHtml(key)}" placeholder="${escapeHtml(placeholder)}">${escapeHtml(load(p.id, `plan:${key}`))}</textarea></label>`).join("");
    els.planArea.querySelectorAll("textarea").forEach((box) => box.addEventListener("input", () => save(p.id, `plan:${box.dataset.plan}`, box.value)));
  }

  function renderPhrases(p) {
    if (!els.phraseGroups) return;
    const bank = p.task === "Task 1" ? (DATA.phraseBanks?.task1 || {}) : (DATA.phraseBanks?.task2 || {});
    if (els.phraseKicker) els.phraseKicker.textContent = p.task === "Task 1" ? "Task 1 Letter Phrases" : "Task 2 Essay Phrases";
    if (els.phraseTitle) els.phraseTitle.textContent = p.task === "Task 1" ? "常用句型提示" : "常用连接词与模板";
    els.phraseGroups.innerHTML = Object.entries(bank).map(([name, phrases]) => `<div class="phrase-group"><h4>${escapeHtml(name)}</h4>${(phrases || []).map((phrase) => `<button class="phrase-btn" type="button" data-phrase="${escapeHtml(phrase)}">${escapeHtml(phrase)}</button>`).join("")}</div>`).join("");
    els.phraseGroups.querySelectorAll("button[data-phrase]").forEach((btn) => btn.addEventListener("click", () => {
      if (!els.favoriteInput) return;
      const current = els.favoriteInput.value.trim();
      els.favoriteInput.value = current ? `${current}\n${btn.dataset.phrase}` : btn.dataset.phrase;
      save(p.id, "favorites", els.favoriteInput.value);
      showStatus("已加入收藏区");
    }));
  }

  function updateWords() {
    if (!selected || !els.essayInput) return;
    const words = countWords(els.essayInput.value);
    if (els.wordCount) els.wordCount.textContent = words;
    if (els.wordTarget) els.wordTarget.textContent = `/ ${selected.recommendedWords} words`;
    if (els.wordCount) els.wordCount.style.color = words >= selected.recommendedWords ? "var(--teal)" : "var(--rose)";
  }

  function resetGradingPanel() {
    latestScoreResult = null;
    if (els.gradingResults) els.gradingResults.innerHTML = "";
    if (els.gradingStatus) { els.gradingStatus.textContent = ""; els.gradingStatus.dataset.state = ""; }
    if (els.revisionCompareArea) els.revisionCompareArea.classList.add("hidden");
  }

  function selectPrompt(id) {
    selected = prompts.find((p) => p.id === id);
    if (!selected) return;
    location.hash = id;
    els.emptyState?.classList.add("hidden");
    els.practiceView?.classList.remove("hidden");
    if (els.metaTags) els.metaTags.innerHTML = tag(selected.book, "book") + tag(selected.test, "book") + tag(selected.task, selected.task === "Task 1" ? "task1" : "task2") + tag(selected.type, "type");
    if (els.sourceStatus) els.sourceStatus.textContent = `Source status: ${selected.sourceStatus || ""}`;
    if (els.practiceTitle) els.practiceTitle.textContent = `${selected.book} · ${selected.test} · ${selected.task}: ${selected.title}`;
    if (els.practicePrompt) els.practicePrompt.textContent = selected.prompt || "";
    renderInfo(selected);
    renderPlan(selected);
    if (els.essayInput) els.essayInput.value = load(selected.id, "essay");
    if (els.favoriteInput) els.favoriteInput.value = load(selected.id, "favorites");
    if (els.structureList) els.structureList.innerHTML = (selected.sampleStructure || []).map((x) => `<li>${escapeHtml(x)}</li>`).join("");
    if (els.bandTips) els.bandTips.innerHTML = `<div class="band"><strong>Band 5 保底写法提示</strong>${escapeHtml(selected.notes?.band5 || "")}</div><div class="band"><strong>Band 6+ 提升提示</strong>${escapeHtml(selected.notes?.band6 || "")}</div>`;
    renderPhrases(selected);
    resetTimer(selected.timeLimit || 40);
    updateWords();
    resetGradingPanel();
    renderList();
    if (innerWidth < 1100) els.practiceView?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
    if (els.timerBtn) els.timerBtn.textContent = "开始";
  }
  function resetTimer(limit) {
    stopTimer();
    remaining = Number(limit || 40) * 60;
    if (els.timerDisplay) els.timerDisplay.textContent = fmt(remaining);
  }
  function toggleTimer() {
    if (!selected) return;
    if (timerId) { stopTimer(); return; }
    timerId = setInterval(() => {
      remaining = Math.max(0, remaining - 1);
      if (els.timerDisplay) els.timerDisplay.textContent = fmt(remaining);
      if (remaining === 0) stopTimer();
    }, 1000);
    if (els.timerBtn) els.timerBtn.textContent = "暂停";
  }
  function showStatus(text) {
    if (!els.statusText) return;
    els.statusText.textContent = text;
    setTimeout(() => { els.statusText.textContent = ""; }, 1400);
  }
  async function copyEssay() {
    const text = els.essayInput?.value || "";
    if (!text.trim()) { showStatus("作文区为空"); return; }
    try { await navigator.clipboard.writeText(text); } catch { els.essayInput?.select(); document.execCommand("copy"); }
    showStatus("已复制");
  }
  function setGradingStatus(text, state = "") {
    if (!els.gradingStatus) return;
    els.gradingStatus.textContent = text;
    els.gradingStatus.dataset.state = state;
  }

  function gradingPayload(extra = {}) {
    const essay = String(els.essayInput?.value || "").trim();
    return {
      task: selected?.task || "Task 2",
      promptId: selected?.id || "",
      title: selected?.title || "",
      taskType: selected?.task === "Task 1" ? "task1" : "task2",
      letterStyle: selected?.letterStyle || "",
      questionType: selected?.type || "",
      questionPrompt: selected?.prompt || "",
      essay,
      wordCount: countWords(essay),
      mode: "score",
      ...extra
    };
  }

  async function postStage(endpoint, payload) {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const text = await response.text();
    let data = {};
    try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
    if (!response.ok) throw new Error([`HTTP ${response.status}`, data.error, data.detail].filter(Boolean).join(" | "));
    return data;
  }

  function createScoringProgress() {
    return {
      status: "waiting",
      currentStep: 0,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      error: null,
      steps: SCORING_STEPS.map((step, index) => ({
        ...step,
        index: index + 1,
        status: "waiting",
        message: step.description,
        error: ""
      }))
    };
  }

  function ensureScoringProgress() {
    if (!latestScoringProgress) latestScoringProgress = createScoringProgress();
    return latestScoringProgress;
  }

  function updateScoringProgress(stepIndex, status, message = "", error = null) {
    const progress = ensureScoringProgress();
    progress.status = error ? "error" : (status === "running" ? "running" : progress.status);
    progress.currentStep = Math.max(1, stepIndex + 1);
    progress.updatedAt = new Date().toISOString();
    const step = progress.steps[stepIndex];
    if (step) {
      step.status = status;
      if (message) step.message = message;
      if (error) step.error = String(error.message || error);
    }
    if (error) {
      progress.status = "error";
      progress.error = {
        step: step ? step.index : stepIndex + 1,
        title: step ? step.title : "未知阶段",
        message: String(error.message || error),
        stack: String(error.stack || error.message || error)
      };
    }
    return progress;
  }

  function completeScoringProgress() {
    const progress = ensureScoringProgress();
    progress.status = "done";
    progress.currentStep = SCORING_STEPS.length;
    progress.updatedAt = new Date().toISOString();
    progress.steps.forEach((step) => {
      if (step.status !== "error") step.status = "done";
    });
    return progress;
  }

  function statusText(status) {
    return ({ waiting: "等待", running: "进行中", done: "完成", error: "失败" })[status] || "等待";
  }

  function renderScoringProgressPanel(progress = latestScoringProgress, open = false) {
    const p = progress || createScoringProgress();
    const hasError = p.status === "error" || !!p.error;
    const shouldOpen = open || hasError || p.status === "running";
    const statusClass = hasError ? "error" : (p.status === "done" ? "done" : (p.status === "running" ? "running" : "waiting"));
    const current = p.steps?.find((step) => step.status === "running") || p.steps?.find((step) => step.status === "error") || p.steps?.[Math.max(0, (p.currentStep || 1) - 1)];
    const errorHtml = hasError ? `<div class="ai-warning"><strong>失败步骤：</strong>第 ${escapeHtml(p.error?.step || current?.index || "-")} 步/4 ${escapeHtml(p.error?.title || current?.title || "未知阶段")}<br><strong>错误原因：</strong>${escapeHtml(p.error?.message || "未知错误")}<br><strong>建议操作：</strong>请先重试一次；如果连续失败，再检查接口、Vercel runtime logs 或 AI provider 超时情况。</div><details class="score-technical-details"><summary>技术错误详情 / Technical details</summary><pre>${escapeHtml(p.error?.stack || p.error?.message || "No technical details returned.")}</pre></details>` : "";
    return `<details class="score-accordion score-progress-accordion" ${shouldOpen ? "open" : ""}>
      <summary>评分流程与错误反馈 / Scoring Progress &amp; Error Log</summary>
      <div class="score-accordion-body">
        <div class="score-progress-overview">
          <span class="score-progress-chip ${escapeHtml(statusClass)}">当前状态：${escapeHtml(hasError ? "评分失败" : p.status === "done" ? "评分完成" : p.status === "running" ? "正在评分" : "等待评分")}</span>
          <span class="score-progress-chip">当前步骤：第 ${escapeHtml(current?.index || p.currentStep || 1)} 步/4</span>
          <span class="score-progress-chip">更新时间：${escapeHtml(p.updatedAt ? new Date(p.updatedAt).toLocaleString() : "-")}</span>
        </div>
        <ol class="score-step-list">
          ${(p.steps || []).map((step) => `<li class="score-step-item"><div class="score-step-head"><span>第 ${escapeHtml(step.index)} 步/4：${escapeHtml(step.title)}</span><span class="score-step-status ${escapeHtml(step.status)}">${escapeHtml(statusText(step.status))}</span></div><p>${escapeHtml(step.error || step.message || step.description || "")}</p></li>`).join("")}
        </ol>
        ${errorHtml}
      </div>
    </details>`;
  }

  function renderScoreAccordion(title, bodyHtml, open = false, className = "") {
    return `<details class="score-accordion ${escapeHtml(className)}" ${open ? "open" : ""}><summary>${escapeHtml(title)}</summary><div class="score-accordion-body">${bodyHtml}</div></details>`;
  }


  function injectScoreStyles() {
    if ($("scoreUiStyles")) return;
    const style = document.createElement("style");
    style.id = "scoreUiStyles";
    style.textContent = `
      .score-flow-note { border: 1px solid var(--border, #d7e2ea); border-radius: 14px; padding: 14px 16px; background: rgba(255,255,255,.65); margin: 12px 0; }
      .criterion-card-grid { display: grid; gap: 14px; margin: 14px 0; }
      .criterion-score-card { border: 1px solid var(--border, #d7e2ea); border-radius: 16px; background: var(--card, #fff); overflow: hidden; box-shadow: 0 1px 0 rgba(15,23,42,.03); transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease; }
      .criterion-score-card:hover { border-color: rgba(15,118,110,.35); box-shadow: 0 10px 24px rgba(15,23,42,.06); }
      .criterion-card-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--border, #d7e2ea); background: rgba(248,250,252,.7); }
      .criterion-title { font-weight: 800; font-size: 1.05rem; color: var(--text, #122033); }
      .criterion-band-pill { font-weight: 900; border-radius: 999px; padding: 8px 13px; background: rgba(15,118,110,.12); color: var(--teal, #0f766e); white-space: nowrap; }
      .criterion-toggle { width: 38px; height: 38px; border-radius: 999px; border: 1px solid var(--border, #bfd1de); background: transparent; font-weight: 900; font-size: 1.1rem; cursor: pointer; color: var(--teal, #0f766e); }
      .criterion-card-body { padding: 16px 18px 18px; }
      .criterion-card-body.hidden { display: none; }
      .criterion-quick-grid { display: grid; gap: 12px; }
      .criterion-quick-row { border-left: 4px solid rgba(15,118,110,.7); padding: 10px 12px; border-radius: 10px; background: rgba(15,118,110,.055); }
      .criterion-quick-row h5 { margin: 0 0 6px; font-size: .96rem; color: var(--text, #122033); }
      .criterion-quick-row p { margin: 0; line-height: 1.65; }
      .score-translate-btn { margin-left: 8px; border: 1px solid var(--border, #bfd1de); border-radius: 999px; padding: 5px 11px; background: transparent; cursor: pointer; font-size: .88rem; white-space: nowrap; }
      .score-translation { margin: 8px 0 0; padding: 10px 12px; border-radius: 10px; background: rgba(224,242,241,.7); color: var(--muted, #5b7082); line-height: 1.6; }
      .hidden-score-translation { display: none; }
      .score-detail-card { margin-top: 14px; border: 1px solid var(--border, #d7e2ea); border-radius: 14px; overflow: hidden; }
      .score-detail-toggle { width: 100%; display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 13px 15px; border: 0; background: rgba(248,250,252,.7); cursor: pointer; text-align: left; font-weight: 800; color: var(--text, #122033); }
      .score-detail-body { padding: 14px 16px; border-top: 1px solid var(--border, #d7e2ea); }
      .score-detail-body.hidden { display: none; }
      .evidence-grid { display: grid; gap: 12px; margin-top: 8px; }
      .evidence-box { border: 1px solid var(--border, #d7e2ea); border-radius: 12px; padding: 12px 14px; background: rgba(255,255,255,.6); }
      .evidence-box h5 { margin: 0 0 8px; }
      .quote-evidence { margin: 8px 0; padding: 9px 11px; border-left: 4px solid rgba(15,118,110,.55); background: rgba(15,118,110,.045); border-radius: 8px; }
      .score-gate-grid { display: grid; gap: 10px; margin-top: 10px; }
      .score-gate-item { border: 1px solid var(--border, #d7e2ea); border-radius: 12px; padding: 12px 14px; background: rgba(255,255,255,.62); }
      .overall-card { border: 1px solid var(--border, #d7e2ea); border-radius: 16px; background: var(--card, #fff); padding: 16px 18px; }
      .overall-card h4 { margin: 0 0 12px; }
      .overall-score { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .overall-score span { display: inline-grid; place-items: center; min-width: 76px; min-height: 58px; border-radius: 12px; background: var(--teal, #0f766e); color: #fff; font-weight: 900; font-size: 2rem; line-height: 1; }
      .overall-score strong { font-size: 1.15rem; }
      .score-accordion { border: 1px solid var(--border, #d7e2ea); border-radius: 16px; background: var(--card, #fff); overflow: hidden; }
      .score-accordion + .score-accordion { margin-top: 12px; }
      .score-accordion summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 58px; padding: 0 16px; cursor: pointer; list-style: none; font-weight: 900; color: var(--text, #122033); background: rgba(248,250,252,.72); }
      .score-accordion summary::-webkit-details-marker { display: none; }
      .score-accordion summary::after { content: "+"; display: grid; place-items: center; flex: 0 0 auto; width: 38px; height: 38px; border-radius: 999px; border: 1px solid var(--border, #bfd1de); color: var(--teal, #0f766e); font-weight: 900; }
      .score-accordion[open] summary::after { content: "-"; }
      .score-accordion-body { border-top: 1px solid var(--border, #d7e2ea); padding: 16px; line-height: 1.6; }
      .score-progress-overview { display: flex; flex-wrap: wrap; gap: 10px; align-items: center; margin-bottom: 12px; }
      .score-progress-chip { display: inline-flex; align-items: center; justify-content: center; border-radius: 999px; border: 1px solid var(--border, #bfd1de); padding: 5px 10px; font-weight: 850; font-size: .88rem; }
      .score-progress-chip.running { color: var(--amber, #a45d00); background: rgba(164,93,0,.1); }
      .score-progress-chip.done { color: var(--teal, #0f766e); background: rgba(15,118,110,.1); }
      .score-progress-chip.error { color: var(--rose, #b9433b); background: rgba(185,67,59,.1); }
      .score-step-list { display: grid; gap: 10px; margin: 0; padding: 0; list-style: none; }
      .score-step-item { border: 1px solid var(--border, #d7e2ea); border-radius: 12px; padding: 12px 14px; background: rgba(255,255,255,.62); }
      .score-step-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; font-weight: 850; }
      .score-step-status { border-radius: 999px; padding: 4px 9px; border: 1px solid var(--border, #bfd1de); font-size: .82rem; white-space: nowrap; }
      .score-step-status.waiting { color: var(--muted, #5b7082); }
      .score-step-status.running { color: var(--amber, #a45d00); background: rgba(164,93,0,.1); }
      .score-step-status.done { color: var(--teal, #0f766e); background: rgba(15,118,110,.1); }
      .score-step-status.error { color: var(--rose, #b9433b); background: rgba(185,67,59,.1); }
      .score-step-item p { margin: 7px 0 0; color: var(--muted, #5b7082); }
      .score-technical-details { margin-top: 12px; border: 1px solid var(--border, #d7e2ea); border-radius: 12px; overflow: hidden; }
      .score-technical-details summary { min-height: 42px; padding: 0 12px; background: rgba(248,250,252,.72); font-weight: 850; }
      .score-technical-details pre { max-height: 240px; overflow: auto; margin: 0; padding: 12px; background: var(--card, #fff); white-space: pre-wrap; word-break: break-word; }
      @media (min-width: 980px) { .criterion-card-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
      @media (max-width: 760px) { .criterion-card-header { align-items: flex-start; } .criterion-band-pill { margin-left: auto; } }
    `;
    document.head.appendChild(style);
  }

  function translationButton(zh, label = "中文解释") {
    const id = `scoreZh_${Math.random().toString(36).slice(2, 10)}`;
    return `<button class="score-translate-btn" type="button" data-score-translation-target="${id}">${escapeHtml(label)}</button><div id="${id}" class="score-translation hidden-score-translation">${escapeHtml(zh || "中文解释暂缺。")}</div>`;
  }

  function arr(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value === undefined || value === null || value === "") return [];
    return [String(value)];
  }

  function nearestHalfBand(value, direction) {
    const n = Number(value);
    if (!Number.isFinite(n)) return "-";
    const out = direction === "lower" ? Math.max(1, n - 0.5) : Math.min(9, n + 0.5);
    return formatBand(out);
  }

  function criterionItem(result, criterion) {
    const cal = result.criterionCalibration || result.criterionExplanations || {};
    const direct = cal[criterion] || {};
    const altName = criterion.replace("Task Response", "Task Achievement").replace("Task Achievement", "Task Response");
    return direct && Object.keys(direct).length ? direct : (cal[altName] || {});
  }

  function firstText(...items) {
    for (const item of items) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (Array.isArray(item) && item.filter(Boolean).length) return String(item.filter(Boolean)[0]).trim();
    }
    return "";
  }

  function fallbackImprove(criterion, band) {
    if (/Task Response|Task Achievement/i.test(criterion)) return "Develop each main point with a clearer reason and one specific example that directly answers the task.";
    if (/Coherence/i.test(criterion)) return "Make each paragraph develop one clear idea and improve sentence-to-sentence progression, not only basic linking words.";
    if (/Lexical/i.test(criterion)) return "Reduce spelling and word-form errors, use more accurate topic vocabulary, and avoid awkward collocations.";
    if (/Grammatical/i.test(criterion)) return "Control basic verb forms, articles, plurals, and sentence boundaries before adding more complex structures.";
    return `To move above Band ${formatBand(band)}, strengthen the limiting areas identified in this criterion.`;
  }

  function evidenceListHtml(items, zhItems = []) {
    const list = arr(items);
    if (!list.length) return `<p class="muted">未返回具体证据。</p>`;
    return `<ul>${list.map((x, i) => `<li>${escapeHtml(x)}${translationButton(zhItems?.[i] || "")}</li>`).join("")}</ul>`;
  }

  function essayEvidenceHtml(items) {
    const list = arr(items);
    if (!list.length) return `<p class="muted">暂未返回原文证据。</p>`;
    return list.map((item) => {
      if (typeof item === "string") return `<div class="quote-evidence">${escapeHtml(item)}</div>`;
      const quote = item.quote || item.text || item.original || "";
      const meaning = item.meaning || item.explanation || item.evidence || "";
      const zh = item.meaningZh || item.explanationZh || item.zh || "";
      return `<div class="quote-evidence"><strong>${escapeHtml(quote || "原文片段")}</strong>${meaning ? ` → ${escapeHtml(meaning)}${translationButton(zh)}` : ""}</div>`;
    }).join("");
  }

  function bindScoreUiInteractions() {
    if (!els.gradingResults || els.gradingResults.dataset.scoreUiBound === "true") return;
    els.gradingResults.dataset.scoreUiBound = "true";
    els.gradingResults.addEventListener("click", (event) => {
      const translateBtn = event.target.closest("[data-score-translation-target]");
      if (translateBtn) {
        const target = document.getElementById(translateBtn.dataset.scoreTranslationTarget);
        if (target) {
          const hidden = target.classList.toggle("hidden-score-translation");
          translateBtn.textContent = hidden ? "中文解释" : "收起中文";
        }
      }
      const cardToggle = event.target.closest("[data-criterion-toggle]");
      if (cardToggle) {
        const target = document.getElementById(cardToggle.dataset.criterionToggle);
        if (target) {
          const hidden = target.classList.toggle("hidden");
          cardToggle.textContent = hidden ? "+" : "-";
        }
      }
      const detailToggle = event.target.closest("[data-score-detail-toggle]");
      if (detailToggle) {
        const target = document.getElementById(detailToggle.dataset.scoreDetailToggle);
        if (target) {
          const hidden = target.classList.toggle("hidden");
          detailToggle.querySelector("span:last-child").textContent = hidden ? "+" : "-";
        }
      }
    });
  }

  function renderCriteriaRows(result) {
    const criteria = result.finalCriteria || result.criteria || {};
    const rows = Object.entries(criteria).map(([criterion, band]) => `<div class="score-calculation-row"><span>${escapeHtml(criterion)}</span><strong>Band ${escapeHtml(formatBand(band))}</strong></div>`).join("");
    return rows ? `<div class="score-calculation-grid">${rows}</div>` : `<p class="muted">AI 没有返回完整四项分。</p>`;
  }

  function renderScoreCalculationAccordion(result = {}, rawAverage, finalBand) {
    const body = `
      <p><strong>评分系统：</strong>${escapeHtml(result.scoreCalculation?.mode || result.scoreSystemVersion || "clean_score_core")}</p>
      <p><strong>计算方式：</strong>${escapeHtml(result.scoreCalculation?.formula || "AI-returned four IELTS criterion bands averaged and rounded to nearest 0.5; no local cap, lift, or lowering is applied.")}</p>
      <p><strong>本地是否介入评分：</strong>否</p>
      <p><strong>本地是否 cap / 压分 / 提分：</strong>否</p>
      ${renderCriteriaRows(result)}
      ${Number.isFinite(rawAverage) ? `<p><strong>四项平均：</strong>${escapeHtml(rawAverage.toFixed(3).replace(/\.?0+$/, ""))}</p>` : ""}
      ${Number.isFinite(finalBand) ? `<p><strong>最终估算：</strong>Band ${escapeHtml(formatBand(finalBand))}</p>` : ""}
      <p class="muted">The server validates structure and averages the AI-returned criterion bands. It does not rewrite criterion bands locally.</p>`;
    return renderScoreAccordion("评分计算说明 / Score Calculation Explanation", body, false, "score-calculation-card");
  }

  function renderScoreCalibration(result = {}) {
    const profile = result.scoreProfile || {};
    const signals = result.localSignals || {};
    const warnings = arr(result.stabilityWarnings);
    const gates = [
      ["Low-band check", profile.lowBandGate],
      ["Mid-band check", profile.midBandGate],
      ["High-band check", profile.highBandGate],
      ["Score-profile check", profile.scoreProfileGate]
    ];
    const body = `
      <div class="score-gate-grid">
        <div class="score-gate-item"><strong>版本：</strong>${escapeHtml(result.scoreSystemVersion || "clean-score-core-v2")}</div>
        <div class="score-gate-item"><strong>可评分性：</strong>${escapeHtml(signals.rateabilityStatus || "未返回")} ｜ <strong>词数：</strong>${escapeHtml(signals.wordCount ?? "-")} ｜ <strong>段落：</strong>${escapeHtml(signals.paragraphCount ?? "-")} ｜ <strong>句子：</strong>${escapeHtml(signals.sentenceCount ?? "-")}</div>
        <div class="score-gate-item"><strong>拼写密度：</strong>${escapeHtml(signals.spellingErrorDensity || "-")} ｜ <strong>语法密度：</strong>${escapeHtml(signals.grammarErrorDensity || "-")} ｜ <strong>句子控制：</strong>${escapeHtml(signals.sentenceControl || "-")} ｜ <strong>词汇控制：</strong>${escapeHtml(signals.lexicalControl || "-")}</div>
      </div>
      ${result.examinerSummary ? `<p><strong>Examiner summary:</strong> ${escapeHtml(result.examinerSummary)}${translationButton(result.examinerSummaryZh || "")}</p>` : ""}
      <div class="score-gate-grid">
        ${gates.map(([label, gate]) => `<div class="score-gate-item"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(gate?.status || gate?.result || gate?.triggered || "not_reported")}<br><span class="muted">${escapeHtml(gate?.reason || gate?.explanation || gate?.note || "No detailed gate explanation returned.")}</span></div>`).join("")}
      </div>
      ${warnings.length ? `<div class="ai-warning"><strong>稳定性提醒：</strong>${listHtml(warnings)}</div>` : ""}`;
    return renderScoreAccordion("评分校准报告 / Score Calibration Report", body, false, "score-calibration-report");
  }
  function renderCriterionCards(result = {}) {
    const criteria = result.finalCriteria || result.criteria || {};
    const entries = Object.entries(criteria);
    if (!entries.length) return `<section class="grading-section"><p class="muted">AI 没有返回完整四项分。</p></section>`;
    return `<section class="criterion-card-grid" aria-label="四项评分说明">
      ${entries.map(([criterion, band], index) => {
        const item = criterionItem(result, criterion);
        const half = item.halfBandDecision || {};
        const cardId = `criterionCard_${index}_${Math.random().toString(36).slice(2, 8)}`;
        const detailId = `criterionDetail_${index}_${Math.random().toString(36).slice(2, 8)}`;
        const whyThis = firstText(item.whyThisBand, item.summary, half.whyExactBand, item.positiveEvidence) || `This criterion was estimated at Band ${formatBand(band)} based on the examiner evidence.`;
        const whyThisZh = item.whyThisBandZh || item.summaryZh || half.whyExactBandZh || "";
        const whyLower = firstText(item.whyNotLower, half.whyAboveLowerBand) || `Not Band ${nearestHalfBand(band, "lower")} because the response shows enough relevant control for Band ${formatBand(band)}.`;
        const whyLowerZh = item.whyNotLowerZh || half.whyAboveLowerBandZh || "";
        const whyHigher = firstText(item.whyNotHigher, half.whyBelowUpperBand) || `Not Band ${nearestHalfBand(band, "higher")} because the limiting evidence prevents a stronger band.`;
        const whyHigherZh = item.whyNotHigherZh || half.whyBelowUpperBandZh || "";
        const improve = firstText(item.howToImprove, item.improvementFocus) || fallbackImprove(criterion, band);
        const improveZh = item.howToImproveZh || item.improvementFocusZh || "";
        return `<article class="criterion-score-card">
          <div class="criterion-card-header">
            <div class="criterion-title">${escapeHtml(criterion)}</div>
            <div class="criterion-band-pill">Band ${escapeHtml(formatBand(band))}</div>
            <button class="criterion-toggle" type="button" data-criterion-toggle="${cardId}" aria-label="展开或收起 ${escapeHtml(criterion)}">-</button>
          </div>
          <div class="criterion-card-body" id="${cardId}">
            <div class="criterion-quick-grid">
              <div class="criterion-quick-row"><h5>为什么是这个分</h5><p>${escapeHtml(whyThis)}${translationButton(whyThisZh)}</p></div>
              <div class="criterion-quick-row"><h5>为什么不是 Band ${escapeHtml(nearestHalfBand(band, "lower"))}</h5><p>${escapeHtml(whyLower)}${translationButton(whyLowerZh)}</p></div>
              <div class="criterion-quick-row"><h5>为什么不是 Band ${escapeHtml(nearestHalfBand(band, "higher"))}</h5><p>${escapeHtml(whyHigher)}${translationButton(whyHigherZh)}</p></div>
              <div class="criterion-quick-row"><h5>怎么提升</h5><p>${escapeHtml(improve)}${translationButton(improveZh)}</p></div>
            </div>
            <div class="score-detail-card">
              <button class="score-detail-toggle" type="button" data-score-detail-toggle="${detailId}"><span>详细证据 / Evidence details</span><span>+</span></button>
              <div id="${detailId}" class="score-detail-body hidden">
                <div class="evidence-grid">
                  <div class="evidence-box"><h5>支持这个分数的证据</h5>${evidenceListHtml(item.positiveEvidence || item.supportingEvidence, item.positiveEvidenceZh || item.supportingEvidenceZh)}</div>
                  <div class="evidence-box"><h5>限制更高分的证据</h5>${evidenceListHtml(item.limitingEvidence || item.limitsHigherBand, item.limitingEvidenceZh || item.limitsHigherBandZh)}</div>
                  <div class="evidence-box"><h5>原文证据 / Evidence from the essay</h5>${essayEvidenceHtml(item.essayEvidence || item.textEvidence || item.evidenceQuotes)}</div>
                  <div class="evidence-box"><h5>完整半分判断</h5>
                    <p><strong>Candidate bands:</strong> ${escapeHtml(arr(item.candidateBandsConsidered).join(" / ") || `${nearestHalfBand(band, "lower")} / ${formatBand(band)} / ${nearestHalfBand(band, "higher")}`)}</p>
                    <p><strong>Why above lower band:</strong> ${escapeHtml(half.whyAboveLowerBand || whyLower)}${translationButton(half.whyAboveLowerBandZh || whyLowerZh)}</p>
                    <p><strong>Why below higher band:</strong> ${escapeHtml(half.whyBelowUpperBand || whyHigher)}${translationButton(half.whyBelowUpperBandZh || whyHigherZh)}</p>
                    <p><strong>Why exact band:</strong> ${escapeHtml(half.whyExactBand || whyThis)}${translationButton(half.whyExactBandZh || whyThisZh)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </article>`;
      }).join("")}
    </section>`;
  }

  function renderScoreResult(result = {}) {
    latestScoreResult = result;
    if (!latestScoringProgress || latestScoringProgress.status === "running") completeScoringProgress();
    injectScoreStyles();
    bindScoreUiInteractions();
    const finalBand = Number(result.overallBand || result.scoreCalculation?.finalBand);
    const rawAverage = Number(result.rawAverage || result.scoreCalculation?.rawAverage);
    const disclaimer = result.disclaimer || "This is an AI-generated estimated score, not an official IELTS score.";
    const html = `
      ${renderScoringProgressPanel(latestScoringProgress, false)}
      <section class="overall-card"><h4>Overall estimated band</h4><div class="overall-score"><span>${escapeHtml(formatBand(finalBand))}</span><strong>Band ${escapeHtml(formatBand(finalBand))}</strong></div></section>
      ${renderCriterionCards(result)}
      ${renderScoreCalculationAccordion(result, rawAverage, finalBand)}
      ${renderScoreCalibration(result)}
      <p class="ai-disclaimer">${escapeHtml(disclaimer)}</p>`;
    if (els.gradingResults) els.gradingResults.innerHTML = html;
    bindScoreUiInteractions();
  }
  function renderRevisionResult(result = {}) {
    if (!els.gradingResults) return;
    const modelOutline = String(result.modelAnswerOutline || "").trim();
    const modelAnswer = String(result.modelAnswer || "").trim();
    const revisedEssay = String(result.revisedEssay || "").trim();
    const html = `<section class="grading-section revision-block">
      <h4>作文生成 / Model and Revision</h4>
      <p class="muted">这一部分只生成作文，不改变已经冻结的分数。</p>
      <details class="score-collapse" ${modelOutline ? "open" : ""}><summary>范文大纲</summary><div class="score-collapse-body"><pre>${escapeHtml(modelOutline || "暂未生成")}</pre></div></details>
      <details class="score-collapse" ${modelAnswer ? "open" : ""}><summary>同题范文</summary><div class="score-collapse-body"><pre>${escapeHtml(modelAnswer || "暂未生成")}</pre></div></details>
      <details class="score-collapse" ${revisedEssay ? "open" : ""}><summary>基于原文的修改版</summary><div class="score-collapse-body"><pre>${escapeHtml(revisedEssay || "暂未生成")}</pre>${revisedEssay ? `<button class="secondary" type="button" id="applyRevisedEssayBtn">应用到作文输入区</button>` : ""}</div></details>
    </section>`;
    els.gradingResults.insertAdjacentHTML("beforeend", html);
    $("applyRevisedEssayBtn")?.addEventListener("click", () => {
      if (!els.essayInput || !selected) return;
      els.essayInput.value = revisedEssay;
      save(selected.id, "essay", revisedEssay);
      updateWords();
      showStatus("已应用修改版");
    });
  }

  async function generateEssayOnly() {
    if (!selected) { setGradingStatus("请先选择一道题。", "error"); return; }
    const endpoint = String(els.gradingEndpointInput?.value || "").trim();
    if (!endpoint) { setGradingStatus("请先填写批改接口地址。不要把 API key 放在前端网页中。", "error"); return; }
    const originalText = els.generateRevisionBtn?.textContent || "生成作文 / Generate essay";
    if (els.generateRevisionBtn) { els.generateRevisionBtn.disabled = true; els.generateRevisionBtn.textContent = "Generating..."; els.generateRevisionBtn.setAttribute("aria-busy", "true"); }
    if (els.gradeBtn) els.gradeBtn.disabled = true;
    if (els.gradingEndpointInput) els.gradingEndpointInput.disabled = true;
    try {
      setGradingStatus("正在单独生成作文。评分流程不会被调用，分数不会被改变。", "loading");
      const revision = await postStage(endpoint, gradingPayload({ aiStage: "revision-generator", currentResult: latestScoreResult || null, mode: "revision_only" }));
      if (!latestScoreResult && els.gradingResults) els.gradingResults.innerHTML = "";
      renderRevisionResult(revision);
      setGradingStatus("作文生成完成。评分没有改变。", "done");
    } catch (error) {
      setGradingStatus(`作文生成失败：${error.message}`, "error");
      if (els.gradingResults) els.gradingResults.insertAdjacentHTML("beforeend", `<section class="grading-section error-details"><h4>作文生成错误</h4><pre>${escapeHtml(error.stack || error.message || error)}</pre></section>`);
    } finally {
      if (els.generateRevisionBtn) { els.generateRevisionBtn.disabled = false; els.generateRevisionBtn.textContent = originalText; els.generateRevisionBtn.removeAttribute("aria-busy"); }
      if (els.gradeBtn) els.gradeBtn.disabled = false;
      if (els.gradingEndpointInput) els.gradingEndpointInput.disabled = false;
    }
  }

  async function startGrading() {
    if (!selected) { setGradingStatus("请先选择一道题。", "error"); return; }
    const endpoint = String(els.gradingEndpointInput?.value || "").trim();
    if (!endpoint) { setGradingStatus("请先填写批改接口地址。不要把 API key 放在前端网页中。", "error"); return; }
    const originalText = els.gradeBtn?.textContent || "开始评分";
    if (els.gradeBtn) { els.gradeBtn.disabled = true; els.gradeBtn.textContent = "Scoring..."; els.gradeBtn.setAttribute("aria-busy", "true"); }
    if (els.generateRevisionBtn) els.generateRevisionBtn.disabled = true;
    if (els.gradingEndpointInput) els.gradingEndpointInput.disabled = true;
    let activeStageIndex = 0;
    try {
      latestScoringProgress = createScoringProgress();
      latestScoringProgress.status = "running";
      if (els.gradingResults) els.gradingResults.innerHTML = renderScoringProgressPanel(latestScoringProgress, true);
      let currentResult = null;
      for (let i = 0; i < SCORING_STEPS.length; i += 1) {
        activeStageIndex = i;
        const step = SCORING_STEPS[i];
        updateScoringProgress(i, "running", `AI 正在执行：${step.description}`);
        if (els.gradingResults) els.gradingResults.innerHTML = renderScoringProgressPanel(latestScoringProgress, true);
        setGradingStatus(`第 ${i + 1} 步/4：${step.title}。`, "loading");
        currentResult = await postStage(endpoint, gradingPayload({ aiStage: step.stage, currentResult }));
        updateScoringProgress(i, "done", `${step.title}已完成。`);
        if (els.gradingResults) els.gradingResults.innerHTML = renderScoringProgressPanel(latestScoringProgress, true);
      }
      completeScoringProgress();
      renderScoreResult(currentResult);
      setGradingStatus("评分完成。四项分数已冻结。作文生成请使用旁边的单独按钮。", "done");
    } catch (error) {
      updateScoringProgress(activeStageIndex, "error", "该阶段执行失败。", error);
      setGradingStatus(`评分失败：第 ${activeStageIndex + 1} 步/4 ${SCORING_STEPS[activeStageIndex]?.title || "未知阶段"}失败。`, "error");
      if (els.gradingResults) els.gradingResults.innerHTML = renderScoringProgressPanel(latestScoringProgress, true);
    } finally {
      if (els.gradeBtn) { els.gradeBtn.disabled = false; els.gradeBtn.textContent = originalText; els.gradeBtn.removeAttribute("aria-busy"); }
      if (els.generateRevisionBtn) els.generateRevisionBtn.disabled = false;
      if (els.gradingEndpointInput) els.gradingEndpointInput.disabled = false;
    }
  }

  function bind() {
    [els.bookFilter, els.testFilter, els.taskFilter, els.typeFilter].filter(Boolean).forEach((el) => el.addEventListener("change", renderList));
    els.searchInput?.addEventListener("input", renderList);
    els.timerBtn?.addEventListener("click", toggleTimer);
    els.resetTimerBtn?.addEventListener("click", () => selected && resetTimer(selected.timeLimit || 40));
    els.essayInput?.addEventListener("input", () => { if (selected) save(selected.id, "essay", els.essayInput.value); updateWords(); });
    els.favoriteInput?.addEventListener("input", () => selected && save(selected.id, "favorites", els.favoriteInput.value));
    els.copyBtn?.addEventListener("click", copyEssay);
    els.clearBtn?.addEventListener("click", () => { if (!selected || !els.essayInput) return; els.essayInput.value = ""; save(selected.id, "essay", ""); updateWords(); els.essayInput.focus(); });
    els.gradingEndpointInput?.addEventListener("input", () => localStorage.setItem(GRADING_ENDPOINT_KEY, els.gradingEndpointInput.value.trim()));
    els.gradeBtn?.addEventListener("click", startGrading);
    els.restoreOriginalBtn?.addEventListener("click", () => { if (!selected || !els.essayInput) return; els.essayInput.value = load(selected.id, "essay:original") || els.essayInput.value; updateWords(); });
    els.backBtn?.addEventListener("click", () => document.querySelector(".list-panel")?.scrollIntoView({ behavior: "smooth" }));
    els.themeBtn?.addEventListener("click", () => {
      const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
      document.documentElement.dataset.theme = next;
      localStorage.setItem("ielts-gt-writing-hub:theme", next);
      els.themeBtn.textContent = next === "dark" ? "浅色模式" : "深色模式";
    });
  }

  function init() {
    injectScoreStyles();
    initFilters();
    setupGradingModes();
    bind();
    if (els.gradingEndpointInput) els.gradingEndpointInput.value = localStorage.getItem(GRADING_ENDPOINT_KEY) || "";
    const theme = localStorage.getItem("ielts-gt-writing-hub:theme") || "light";
    document.documentElement.dataset.theme = theme;
    if (els.themeBtn) els.themeBtn.textContent = theme === "dark" ? "浅色模式" : "深色模式";
    renderList();
    const fromHash = location.hash.replace("#", "");
    if (fromHash && prompts.some((p) => p.id === fromHash)) selectPrompt(fromHash);
  }

  init();
})();
