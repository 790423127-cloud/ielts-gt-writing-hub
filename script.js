(() => {
  const DATA = window.IELTS_GT_DATA || { prompts: [], meta: {}, phraseBanks: { task1: {}, task2: {} } };
  const prompts = Array.isArray(DATA.prompts) ? DATA.prompts : [];
  let selected = null;
  let timerId = null;
  let remaining = 0;
  let latestScoreResult = null;
  let latestScoringProgress = null;
  let mockTask1Prompt = null;
  let mockTask2Prompt = null;
  let mockTimerId = null;
  let mockRemaining = 60 * 60;
  const SCORING_STEPS = [
    { stage: "local-precheck", title: "本地预检与任务分流", description: "检查词数、任务类型、可评分性、语言风险和 Task 1 / Task 2 评分边界。" },
    { stage: "score-kernel", title: "AI 核心评分", description: "AI 只返回 anchor、四项分和 reason codes，不生成中文、长解释、原文引用或详细反馈。" },
    { stage: "boundary-audit", title: "本地边界审计", description: "检查低分抬高、高分卡 7、弱语言高分、四项同分和 anchor 冲突。" },
    { stage: "boundary-review", title: "AI 边界复核", description: "只有审计触发时才二次复核；否则跳过。" },
    { stage: "final-freeze-feedback", title: "冻结分数与后置反馈", description: "先冻结最终分数，再生成详细反馈；反馈失败不影响分数。" }
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

  function targetWordsForPrompt(prompt) {
    return prompt?.task === "Task 1" ? 150 : 250;
  }

  function taskTypeForPrompt(prompt) {
    return prompt?.task === "Task 1" ? "task1" : "task2";
  }

  function extractBulletPointsFromPrompt(text) {
    const source = String(text || "");
    const clean = (value) => String(value || "")
      .replace(/^[-*•·]\s+/, "")
      .replace(/^(\d+)[.)]\s+/, "")
      .replace(/^and\s+/i, "")
      .replace(/[.;:,\s]+$/g, "")
      .trim();
    const lines = source.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
    const direct = lines
      .filter((line) => /^[-*•·]\s+/.test(line) || /^(\d+)[.)]\s+/.test(line))
      .map(clean)
      .filter(Boolean);
    if (direct.length) return direct.slice(0, 5);
    const afterInYourLetter = source.split(/In your letter[:,]?/i)[1] || source.split(/You should/i)[1] || "";
    const candidateSource = afterInYourLetter || source;
    const candidates = candidateSource
      .split(/\r?\n|;/)
      .map(clean)
      .filter((part) => /^(give|explain|describe|say|tell|ask|suggest|apologise|apologize|thank|invite|offer|request|remind|include|state|mention|why|what|how)/i.test(part));
    return candidates.filter(Boolean).slice(0, 5);
  }

  function buildTask2QuestionProfile(text) {
    const prompt = String(text || "");
    const requiredParts = [];
    const add = (label) => { if (!requiredParts.includes(label)) requiredParts.push(label); };
    const asksOpinion = /\b(your opinion|what is your opinion|give your opinion|to what extent do you agree|agree or disagree|do you agree|disagree)\b/i.test(prompt);
    const asksBothViews = /\b(discuss both views|both views)\b/i.test(prompt);
    const asksAdvantage = /\b(advantage|advantages|benefit|benefits)\b/i.test(prompt);
    const asksDisadvantage = /\b(disadvantage|disadvantages|drawback|drawbacks)\b/i.test(prompt);
    const asksOutweigh = /\boutweigh\b/i.test(prompt);
    const asksCause = /\b(cause|causes|reason|reasons|why)\b/i.test(prompt);
    const asksProblem = /\b(problem|problems|issue|issues)\b/i.test(prompt);
    const asksSolution = /\b(solution|solutions|solve|measures|what can be done|how can this be)\b/i.test(prompt);
    const asksPositiveNegative = /\b(positive or negative|positive development|negative development|good thing or bad thing|is this a positive|is this a negative)\b/i.test(prompt);
    let questionType = "general_essay";
    if (asksBothViews) { questionType = "discuss_both_views_with_opinion"; add("discuss view 1"); add("discuss view 2"); if (asksOpinion) add("give your own opinion"); }
    else if (asksOutweigh || (asksAdvantage && asksDisadvantage)) { questionType = asksOutweigh ? "advantages_disadvantages_outweigh" : "advantages_and_disadvantages"; if (asksAdvantage) add("advantages"); if (asksDisadvantage) add("disadvantages"); if (asksOutweigh) add("state whether advantages outweigh disadvantages"); }
    else if (asksCause && asksSolution) { questionType = "causes_and_solutions"; add("causes or reasons"); add("solutions or measures"); }
    else if (asksProblem && asksSolution) { questionType = "problems_and_solutions"; add("problems"); add("solutions"); }
    else if (asksPositiveNegative) { questionType = "positive_negative_development"; add("state whether it is mainly positive or negative"); add("support the judgement with reasons"); }
    else if (asksOpinion) { questionType = "opinion_agree_disagree"; add("clear position"); add("reasons supporting the position"); }
    const questions = (prompt.match(/[^?]+\?/g) || []).map((item) => item.trim()).filter(Boolean);
    if (questions.length >= 2) questions.forEach((q, index) => add(`answer question ${index + 1}: ${q}`));
    if (!requiredParts.length) add("answer all parts of the prompt");
    return { questionType, requiredParts, positionRequired: asksOpinion || asksOutweigh || asksPositiveNegative, questionCount: questions.length, inferredFromPrompt: true };
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

  function typeOptionsForSelectedTask() {
    const taskValue = els.taskFilter?.value || "all";
    const filtered = taskValue === "all" ? prompts : prompts.filter((p) => p.task === taskValue);
    return unique(filtered.map((p) => p.type)).sort();
  }

  function updateTypeFilterOptions() {
    if (!els.typeFilter) return;
    const previous = els.typeFilter.value || "all";
    const taskValue = els.taskFilter?.value || "all";
    const allText = taskValue === "Task 1" ? "全部书信类型" : taskValue === "Task 2" ? "全部作文题型" : "全部题型";
    const options = typeOptionsForSelectedTask();
    fillSelect(els.typeFilter, options, allText);
    els.typeFilter.value = previous === "all" || options.includes(previous) ? previous : "all";
  }

  function initFilters() {
    fillSelect(els.bookFilter, DATA.meta?.books || unique(prompts.map((p) => p.book)), "全部 Books");
    fillSelect(els.testFilter, ["Test 1", "Test 2", "Test 3", "Test 4"], "全部 Test");
    fillSelect(els.taskFilter, ["Task 1", "Task 2"], "Task 1 + Task 2");
    updateTypeFilterOptions();
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
    ensureEssayTimerDock();
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

  function ensureEssayTimerDock() {
    if (!els.essayInput || !els.timerDisplay || !els.timerBtn || !els.resetTimerBtn) return;
    const essayCard = els.essayInput.closest(".card") || els.essayInput.parentElement;
    if (!essayCard) return;

    const oldTimerCard = els.timerDisplay.closest(".card");
    if (oldTimerCard && oldTimerCard !== essayCard) oldTimerCard.classList.add("timer-card-emptied");

    let shell = $("essayWritingShell");
    if (!shell || !essayCard.contains(shell)) {
      shell = document.createElement("div");
      shell.id = "essayWritingShell";
      shell.className = "essay-writing-shell";
      els.essayInput.insertAdjacentElement("beforebegin", shell);
      shell.appendChild(els.essayInput);
    }

    let dock = $("essayTimerDock");
    if (!dock) {
      dock = document.createElement("aside");
      dock.id = "essayTimerDock";
      dock.className = "essay-timer-dock";
      dock.innerHTML = `<div class="essay-timer-title"><span>写作计时</span><small>Writing timer</small></div><div class="essay-timer-controls"></div>`;
    }
    if (dock.parentElement !== shell) shell.appendChild(dock);

    const controls = dock.querySelector(".essay-timer-controls");
    if (!controls) return;
    [els.timerDisplay, els.timerBtn, els.resetTimerBtn].forEach((node) => {
      if (node && node.parentElement !== controls) controls.appendChild(node);
    });
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

  function friendlyScoringError(error) {
    const msg = String(error?.message || error || "");
    if (/malformed JSON|valid JSON|JSON at position|repair failed/i.test(msg)) {
      return "AI 核心评分失败：短 JSON 评分内核损坏且自动重试未成功。系统没有展示不可信分数，请重试一次。";
    }
    if (/freeze blocked|boundary audit|boundary review|409/i.test(msg)) {
      return "评分冻结失败：边界校准冲突未解决，系统已阻止展示不可信分数。请重试一次；如果连续出现，请检查高分/低分边界复核返回。";
    }
    if (/timed out|timeout/i.test(msg)) {
      return "评分超时：AI provider 响应时间过长。请重试一次，或稍后再试。";
    }
    return `评分失败：${msg}`;
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

  function syncScoringProgressFromResult(result = {}) {
    const backendProgress = result.visibleProgress || result.scoringProgress || result.detailedScoringProgress;
    if (!backendProgress || !Array.isArray(backendProgress.steps)) return latestScoringProgress;
    const progress = ensureScoringProgress();
    progress.status = backendProgress.status || progress.status || "running";
    progress.currentStep = backendProgress.currentStep || progress.currentStep;
    progress.updatedAt = backendProgress.updatedAt || new Date().toISOString();
    if (backendProgress.totalSteps === SCORING_STEPS.length) {
      progress.steps = backendProgress.steps.map((step, index) => ({ ...SCORING_STEPS[index], ...step, index: index + 1 }));
      return progress;
    }
    const byStage = new Map(backendProgress.steps.map((step) => [step.stage, step]));
    progress.steps = progress.steps.map((step) => {
      const incoming = byStage.get(step.stage);
      return incoming ? { ...step, ...incoming, index: step.index || incoming.index } : step;
    });
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
    return ({ waiting: "等待", running: "进行中", done: "完成", skipped: "跳过", reviewed: "已复核", error: "失败" })[status] || "等待";
  }

  function renderScoringProgressPanel(progress = latestScoringProgress, open = false) {
    const p = progress || createScoringProgress();
    const hasError = p.status === "error" || !!p.error;
    const shouldOpen = open || hasError || p.status === "running";
    const statusClass = hasError ? "error" : (p.status === "done" ? "done" : (p.status === "running" ? "running" : "waiting"));
    const current = p.steps?.find((step) => step.status === "running") || p.steps?.find((step) => step.status === "error") || p.steps?.[Math.max(0, (p.currentStep || 1) - 1)];
    const errorHtml = hasError ? `<div class="ai-warning"><strong>失败步骤：</strong>第 ${escapeHtml(p.error?.step || current?.index || "-")} 步/${escapeHtml((p.steps || SCORING_STEPS).length)} ${escapeHtml(p.error?.title || current?.title || "未知阶段")}<br><strong>错误原因：</strong>${escapeHtml(p.error?.message || "未知错误")}<br><strong>建议操作：</strong>请先重试一次；如果连续失败，再检查接口、Vercel runtime logs 或 AI provider 超时情况。</div><details class="score-technical-details"><summary>技术错误详情 / Technical details</summary><pre>${escapeHtml(p.error?.stack || p.error?.message || "No technical details returned.")}</pre></details>` : "";
    return `<details class="score-accordion score-progress-accordion" ${shouldOpen ? "open" : ""}>
      <summary>评分流程与错误反馈 / Scoring Progress &amp; Error Log</summary>
      <div class="score-accordion-body">
        <div class="score-progress-overview">
          <span class="score-progress-chip ${escapeHtml(statusClass)}">当前状态：${escapeHtml(hasError ? "评分失败" : p.status === "done" ? "评分完成" : p.status === "running" ? "正在评分" : "等待评分")}</span>
          <span class="score-progress-chip">当前步骤：第 ${escapeHtml(current?.index || p.currentStep || 1)} 步/${escapeHtml((p.steps || SCORING_STEPS).length)}</span>
          <span class="score-progress-chip">更新时间：${escapeHtml(p.updatedAt ? new Date(p.updatedAt).toLocaleString() : "-")}</span>
        </div>
        <ol class="score-step-list score-step-list-rows">
          ${(p.steps || []).map((step) => `<li class="score-step-item score-step-row"><span class="score-step-label">第 ${escapeHtml(step.index)} 步/${escapeHtml((p.steps || SCORING_STEPS).length)}：${escapeHtml(step.title)}</span><span class="score-step-status ${escapeHtml(step.status)}">${escapeHtml(statusText(step.status))}</span><span class="score-step-message">${escapeHtml(step.error || step.message || step.description || "")}</span></li>`).join("")}
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
      .overall-card-main { display: grid; grid-template-columns: minmax(220px, 320px) minmax(0, 1fr); gap: 18px; align-items: stretch; }
      .overall-score-panel { display: flex; align-items: center; min-height: 100%; padding: 16px; border: 1px solid rgba(15,118,110,.16); border-radius: 16px; background: linear-gradient(135deg, rgba(15,118,110,.08), rgba(255,255,255,.96)); box-shadow: inset 0 1px 0 rgba(255,255,255,.55); }
      .overall-score { display: flex; align-items: center; gap: 14px; flex-wrap: wrap; }
      .overall-score span { display: inline-grid; place-items: center; min-width: 76px; min-height: 58px; border-radius: 12px; background: var(--teal, #0f766e); color: #fff; font-weight: 900; font-size: 2rem; line-height: 1; box-shadow: 0 12px 24px rgba(15,118,110,.18); }
      .overall-score strong { font-size: 1.15rem; }
      .overall-disclaimer-card { display: flex; gap: 14px; align-items: flex-start; min-height: 100%; padding: 16px; border: 1px solid rgba(164,93,0,.18); border-radius: 16px; background: linear-gradient(135deg, rgba(164,93,0,.10), rgba(255,255,255,.96)); box-shadow: inset 0 1px 0 rgba(255,255,255,.55); }
      .overall-disclaimer-badge { flex: 0 0 auto; display: inline-grid; place-items: center; width: 46px; height: 46px; border-radius: 14px; background: rgba(164,93,0,.14); color: var(--amber, #a45d00); font-weight: 900; letter-spacing: .03em; }
      .overall-disclaimer-copy { min-width: 0; }
      .overall-disclaimer-title { margin: 0 0 6px; font-size: .88rem; font-weight: 900; letter-spacing: .02em; color: var(--amber, #a45d00); text-transform: uppercase; }
      .overall-disclaimer-en, .overall-disclaimer-zh { margin: 0; line-height: 1.55; }
      .overall-disclaimer-en { color: var(--text, #122033); }
      .overall-disclaimer-zh { margin-top: 6px; color: var(--muted, #5b7082); font-size: .94rem; }
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
      @media (max-width: 760px) { .criterion-card-header { align-items: flex-start; } .criterion-band-pill { margin-left: auto; } .overall-card-main { grid-template-columns: 1fr; } .overall-disclaimer-card { padding: 14px; } }
    `;
    style.textContent += `\n
/* Score UI full visual polish: cleaner hierarchy, softer cards, better spacing */
.grading-results{
  gap:18px;
}

.grading-results .score-accordion,
.grading-results .overall-card,
.grading-results .criterion-score-card{
  border-color:rgba(15,118,110,.18) !important;
  border-radius:22px !important;
  box-shadow:0 14px 34px rgba(31,45,58,.075) !important;
}

.grading-results .score-progress-accordion{
  border-color:rgba(15,118,110,.38) !important;
  background:
    radial-gradient(circle at top right, rgba(15,118,110,.10), transparent 34%),
    var(--card) !important;
  overflow:hidden;
}

.grading-results .score-progress-accordion summary{
  min-height:68px !important;
  padding:0 22px !important;
  background:linear-gradient(135deg, rgba(15,118,110,.10), rgba(255,255,255,.74)) !important;
  font-size:1.03rem;
}

.grading-results .score-progress-accordion[open]{
  box-shadow:0 18px 42px rgba(15,118,110,.12) !important;
}

.grading-results .score-progress-overview{
  padding:8px 0 4px;
}

.grading-results .score-progress-chip{
  min-height:34px;
  padding:7px 12px !important;
  background:rgba(248,250,252,.86);
  box-shadow:inset 0 1px 0 rgba(255,255,255,.72);
}

.grading-results .score-step-list{
  grid-template-columns:repeat(4,minmax(0,1fr));
  gap:12px !important;
}

.grading-results .score-step-item{
  position:relative;
  padding:14px !important;
  border-radius:16px !important;
  background:linear-gradient(180deg, rgba(255,255,255,.86), rgba(248,250,252,.78)) !important;
  overflow:hidden;
}

.grading-results .score-step-item::before{
  content:"";
  position:absolute;
  inset:0 auto 0 0;
  width:4px;
  background:rgba(100,116,132,.28);
}

.grading-results .score-step-status.done{border-color:rgba(15,118,110,.28)!important}
.grading-results .score-step-status.running{border-color:rgba(164,93,0,.28)!important}
.grading-results .score-step-status.error{border-color:rgba(185,67,59,.28)!important}

.grading-results .overall-card{
  position:relative;
  overflow:hidden;
  padding:20px 22px !important;
  background:
    radial-gradient(circle at 18% 10%, rgba(15,118,110,.10), transparent 34%),
    linear-gradient(180deg, rgba(255,255,255,.96), rgba(248,250,252,.92)) !important;
}

.grading-results .overall-card::after{
  content:"";
  position:absolute;
  width:180px;
  height:180px;
  right:-70px;
  top:-80px;
  border-radius:50%;
  background:rgba(15,118,110,.08);
  pointer-events:none;
}

.grading-results .overall-card h4{
  font-size:1.02rem;
  letter-spacing:.01em;
}

.grading-results .overall-card-main{
  position:relative;
  z-index:1;
  grid-template-columns:minmax(230px,340px) minmax(0,1fr) !important;
  gap:20px !important;
}

.grading-results .overall-score-panel{
  min-height:132px;
  border-color:rgba(15,118,110,.22) !important;
  background:linear-gradient(135deg, rgba(15,118,110,.11), rgba(255,255,255,.92)) !important;
}

.grading-results .overall-score span{
  min-width:92px !important;
  min-height:76px !important;
  border-radius:18px !important;
  font-size:2.55rem !important;
}

.grading-results .overall-score strong{
  font-size:1.35rem !important;
}

.grading-results .overall-disclaimer-card{
  border-color:rgba(164,93,0,.24) !important;
  background:
    radial-gradient(circle at top right, rgba(164,93,0,.12), transparent 30%),
    linear-gradient(135deg, rgba(164,93,0,.095), rgba(255,255,255,.92)) !important;
}

.grading-results .overall-disclaimer-badge{
  box-shadow:0 10px 24px rgba(164,93,0,.10);
}

.grading-results .criterion-card-grid{
  gap:18px !important;
  margin:18px 0 !important;
}

.grading-results .criterion-score-card{
  background:
    linear-gradient(180deg, rgba(255,255,255,.96), rgba(248,250,252,.90)) !important;
}

.grading-results .criterion-score-card:hover{
  transform:translateY(-2px);
  box-shadow:0 20px 44px rgba(31,45,58,.10) !important;
}

.grading-results .criterion-card-header{
  min-height:88px;
  padding:18px 20px !important;
  background:
    linear-gradient(135deg, rgba(15,118,110,.075), rgba(255,255,255,.86)) !important;
}

.grading-results .criterion-title{
  font-size:1.13rem !important;
}

.grading-results .criterion-band-pill{
  padding:10px 16px !important;
  background:rgba(15,118,110,.13) !important;
  box-shadow:inset 0 1px 0 rgba(255,255,255,.60);
}

.grading-results .criterion-toggle,
.grading-results .score-accordion summary::after{
  width:42px !important;
  height:42px !important;
  background:rgba(255,255,255,.76) !important;
  transition:transform .16s ease, background .16s ease, border-color .16s ease;
}

.grading-results .criterion-toggle:hover,
.grading-results .score-accordion summary:hover::after{
  transform:scale(1.04);
  border-color:rgba(15,118,110,.42) !important;
}

.grading-results .criterion-card-body{
  padding:18px 20px 20px !important;
}

.grading-results .criterion-quick-grid{
  gap:14px !important;
}

.grading-results .criterion-quick-row{
  border-left-width:5px !important;
  padding:13px 15px !important;
  border-radius:14px !important;
  background:rgba(15,118,110,.060) !important;
}

.grading-results .criterion-quick-row h5{
  font-size:1rem !important;
}

.grading-results .score-detail-card{
  border-radius:16px !important;
}

.grading-results .score-detail-toggle{
  min-height:52px;
  padding:14px 16px !important;
  background:linear-gradient(135deg, rgba(49,95,167,.065), rgba(255,255,255,.72)) !important;
}

.grading-results .evidence-grid{
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:14px !important;
}

.grading-results .evidence-box,
.grading-results .score-gate-item{
  border-radius:16px !important;
  background:linear-gradient(180deg, rgba(255,255,255,.88), rgba(248,250,252,.80)) !important;
}

.grading-results .score-accordion{
  background:linear-gradient(180deg, rgba(255,255,255,.96), rgba(248,250,252,.90)) !important;
}

.grading-results .score-accordion summary{
  min-height:66px !important;
  padding:0 22px !important;
  background:linear-gradient(135deg, rgba(248,250,252,.94), rgba(255,255,255,.72)) !important;
  font-size:1.02rem;
}

.grading-results .score-accordion-body{
  padding:18px 22px !important;
}

.grading-results .score-calculation-row{
  padding:11px 0 !important;
}

.grading-results .score-gate-grid{
  gap:14px !important;
}

.grading-results .score-translate-btn{
  min-height:32px;
  padding:5px 12px !important;
  background:rgba(255,255,255,.72) !important;
  transition:background .16s ease, border-color .16s ease, transform .16s ease;
}

.grading-results .score-translate-btn:hover{
  transform:translateY(-1px);
  border-color:rgba(15,118,110,.42) !important;
  background:rgba(15,118,110,.08) !important;
}

.grading-results .score-translation{
  border:1px solid rgba(15,118,110,.14);
  background:rgba(15,118,110,.07) !important;
}

@media (max-width:1100px){
  .grading-results .score-step-list{
    grid-template-columns:repeat(2,minmax(0,1fr));
  }
}

@media (max-width:760px){
  .grading-results{
    gap:14px;
  }
  .grading-results .overall-card-main,
  .grading-results .evidence-grid,
  .grading-results .score-step-list{
    grid-template-columns:1fr !important;
  }
  .grading-results .overall-score-panel{
    min-height:auto;
  }
  .grading-results .overall-score span{
    min-width:82px !important;
    min-height:66px !important;
    font-size:2.15rem !important;
  }
  .grading-results .criterion-card-header{
    min-height:auto;
    align-items:center !important;
  }
  .grading-results .score-accordion summary,
  .grading-results .score-progress-accordion summary{
    padding:0 16px !important;
  }
}
\n`;
    document.head.appendChild(style);
  }
  function translationButton(zh, label = "中文解释") {
    if (!hasMeaningfulContent(zh)) return "";
    const id = `scoreZh_${Math.random().toString(36).slice(2, 10)}`;
    return `<button class="score-translate-btn" type="button" data-score-translation-target="${id}">${escapeHtml(label)}</button><div id="${id}" class="score-translation hidden-score-translation">${escapeHtml(zh)}</div>`;
  }

  function arr(value) {
    if (Array.isArray(value)) return value.filter(Boolean);
    if (value === undefined || value === null || value === "") return [];
    return [String(value)];
  }


  function hasMeaningfulContent(value) {
    if (value == null) return false;
    if (Array.isArray(value)) return value.some(hasMeaningfulContent);
    if (typeof value === "object") return Object.values(value).some(hasMeaningfulContent);
    const text = String(value).trim();
    if (!text || text === "-" || text === "—") return false;
    if (/^(no|not|none) .* returned\.?$/i.test(text)) return false;
    if (/^(暂无|暂未|没有返回|未返回|中文解释暂缺)/.test(text)) return false;
    return true;
  }

  function meaningfulArr(value, limit = Infinity) {
    return arr(value).map((x) => String(x).trim()).filter(hasMeaningfulContent).slice(0, limit);
  }

  function isPassedLikeStatus(status) {
    const s = String(status || "").toLowerCase().replace(/[\s_-]+/g, "_");
    return ["passed", "checked", "done", "not_required", "not_triggered", "false", "ok"].includes(s);
  }

  function criterionZhSummary(item = {}, labels = {}) {
    const direct = item.zhSummary || item.cardZh || item.overallZh || item.chineseSummary;
    if (hasMeaningfulContent(direct)) return direct;
    const parts = [
      [labels.whyThis || "为什么是这个分", item.whyThisBandZh || item.summaryZh || item.halfBandDecision?.whyExactBandZh],
      [labels.whyLower || "为什么高于低一档", item.whyNotLowerZh || item.halfBandDecision?.whyAboveLowerBandZh],
      [labels.whyHigher || "为什么还不到高一档", item.whyNotHigherZh || item.halfBandDecision?.whyBelowUpperBandZh],
      ["怎么提升", item.howToImproveZh || item.improvementFocusZh]
    ].filter(([, text]) => hasMeaningfulContent(text));
    return parts.map(([title, text]) => `${title}：${text}`).join("\n\n");
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
    const list = meaningfulArr(items, 3);
    if (!list.length) return "";
    return `<ul class="compact-evidence-list">${list.map((x, i) => `<li>${escapeHtml(x)}${translationButton(zhItems?.[i] || "")}</li>`).join("")}</ul>`;
  }
  function essayEvidenceHtml(items) {
    const list = arr(items).filter(hasMeaningfulContent).slice(0, 4);
    if (!list.length) return "";
    return list.map((item) => {
      if (typeof item === "string") return `<div class="quote-evidence">${escapeHtml(item)}</div>`;
      const quote = item.quote || item.text || item.original || "";
      const meaning = item.meaning || item.explanation || item.evidence || "";
      const zh = item.meaningZh || item.explanationZh || item.zh || "";
      if (!hasMeaningfulContent(quote) && !hasMeaningfulContent(meaning)) return "";
      return `<div class="quote-evidence"><strong>${escapeHtml(quote || "原文片段")}</strong>${meaning ? ` → ${escapeHtml(meaning)}${translationButton(zh)}` : ""}</div>`;
    }).filter(Boolean).join("");
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


  function gateChineseExplanation(label, gate = {}) {
    const raw = [gate?.status, gate?.result, gate?.triggered, gate?.reason, gate?.explanation, gate?.note].filter(Boolean).join(" ");
    const lower = String(label || "").toLowerCase();
    if (lower.includes("low")) return `低分核查：${raw || "检查文章是否过短、严重跑题或不可评分。"} 这一项用于防止可评分文章被误判为极低分，也防止不可评分文本被误给中高分。`;
    if (lower.includes("mid")) return `中分核查：${raw || "检查文章是否只具备基础结构和基础回应。"} 这一项用于防止文章因为有段落或连接词就被过度提高。`;
    if (lower.includes("high")) return `高分核查：${raw || "检查是否具备高分所需的任务完成度、逻辑推进、词汇灵活度和语法准确度。"} 如果没有 6.5 以上证据，高分门槛不适用。`;
    if (lower.includes("profile")) return `分数组合核查：${raw || "检查四项分数之间是否协调。"} 这一项用于判断 TR/CC/LR/GRA 的组合是否符合语言控制和任务完成情况。`;
    if (lower.includes("bullet")) return `要点覆盖核查：${raw || "检查 Task 1 三个 bullet points 是否覆盖并展开。"}`;
    if (lower.includes("purpose")) return `写信目的核查：${raw || "检查读者是否能清楚知道写信目的。"}`;
    if (lower.includes("tone") || lower.includes("register")) return `语气核查：${raw || "检查 formal / semi-formal / informal 是否符合收信人和任务。"}`;
    if (lower.includes("letter")) return `书信完整度核查：${raw || "检查开头、目的、主体信息、结尾和落款是否像完整信件。"}`;
    if (lower.includes("word")) return `字数核查：${raw || "检查字数是否导致任务回应和展开证据不足。"}`;
    if (lower.includes("band6")) return `6分准入核查：${raw || "检查是否有真实展开，而不只是有观点和段落。"}`;
    if (lower.includes("depth")) return `回应深度核查：${raw || "检查是否回答所有题目要求，并有原因、解释和例子。"}`;
    return `评分校准说明：${raw || "AI 已完成这一项核查。"} `;
  }


  function taskSpecificGateLabel(key) {
    const map = {
      bulletCoverageGate: "Bullet coverage check",
      purposeClarityGate: "Purpose clarity check",
      toneRegisterGate: "Tone/register check",
      letterCompletenessGate: "Letter completeness check",
      wordCountGuard: "Word count guard",
      highBandUnlockGate: "High-band unlock check",
      taskResponseDepthGate: "Task response depth check",
      band6AccessGate: "Band 6 access check",
      lowBandGuard: "Low-band guard",
      midBandCheck: "Mid-band check",
      scoreProfileCheck: "Score-profile check"
    };
    return map[key] || key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  }
  function renderAnchorComparison(result = {}) {
    const anchor = result.anchorComparison || result.anchorCalibration || {};
    if (!anchor || typeof anchor !== "object" || Object.keys(anchor).length === 0) return "";
    const band = anchor.closestAnchorBand ?? result.overallBand ?? result.scoreCalculation?.finalBand ?? "-";
    const range = anchor.candidateRange || (Number.isFinite(Number(band)) ? `${nearestHalfBand(band, "lower")}–${nearestHalfBand(band, "higher")}` : "-");
    const reason = firstText(anchor.whyCloserToThisBand, anchor.closestAnchorProfile, result.examinerSummary) || "系统根据任务类型、字数、可评分性和四项分数组合完成锚点校准。";
    const zh = firstText(anchor.whyCloserToThisBandZh, anchor.closestAnchorProfileZh, result.examinerSummaryZh) || "系统根据任务类型、字数、可评分性和四项分数组合完成锚点校准。";
    return `<div class="anchor-comparison-block compact-calibration-card">
      <div class="score-gate-item anchor-comparison-card">
        <strong>Anchor / 分段锚点：</strong>Band ${escapeHtml(band)}
        <span class="score-chip-inline">候选区间：${escapeHtml(range)}</span>
        <p class="muted">${escapeHtml(reason)}${translationButton(zh)}</p>
      </div>
    </div>`;
  }
  function renderBoundaryAudit(result = {}) {
    const audit = result.boundaryAudit || result.boundaryReview || {};
    if (!audit || typeof audit !== "object" || Object.keys(audit).length === 0) return "";
    const review = audit.boundaryReview || {};
    const reasons = meaningfulArr(audit.reviewReasons || audit.reviewedRemainingWarnings, 4);
    const unresolved = meaningfulArr(audit.unresolvedCriticalReasons, 4);
    const blocked = Boolean(audit.freezeBlocked || unresolved.length);
    const triggered = Boolean(blocked || audit.reviewRequired || review.triggered || reasons.length);
    const status = blocked ? "blocked" : triggered ? "reviewed" : "passed";
    const main = blocked
      ? `冻结被阻止：${unresolved.join("；") || reasons.join("；") || "二次复核后仍存在未解决边界冲突。"}`
      : triggered
        ? `已触发边界复核：${reasons.join("；") || review.decision || "AI 已完成二次边界检查。"}`
        : "边界审计通过：未发现低分抬高、高分压制、四项同分异常或 anchor 冲突。";
    const detail = triggered ? `<ul>${[...reasons, ...unresolved].map((x) => `<li>${escapeHtml(x)}</li>`).join("")}</ul>` : "";
    return `<div class="boundary-audit-block compact-calibration-card">
      <div class="score-gate-item boundary-audit-summary ${escapeHtml(status)}">
        <strong>边界审计 / Boundary audit：</strong>${escapeHtml(status)}
        <p class="muted">${escapeHtml(main)}${translationButton(main)}</p>
        ${detail ? `<div class="boundary-issue-list">${detail}</div>` : ""}
      </div>
    </div>`;
  }
  function renderTaskSpecificGateReport(result = {}) {
    const gates = result.taskSpecificGate || {};
    if (!gates || typeof gates !== "object" || Object.keys(gates).length === 0) return "";
    const visible = Object.entries(gates).filter(([key, gate]) => {
      const item = gate && typeof gate === "object" ? gate : { status: gate };
      const status = item.status || item.result || item.triggered || "";
      return !isPassedLikeStatus(status) || hasMeaningfulContent(item.warning) || hasMeaningfulContent(item.evidence);
    });
    const title = result.task === "Task 1" ? "Task 1 专项检查" : "Task 2 专项检查";
    if (!visible.length) {
      return `<div class="score-gate-item task-gate-summary"><strong>${escapeHtml(title)}：</strong>通过<br><span class="muted">任务专项检查通过；没有发现需要展开显示的异常 gate。</span></div>`;
    }
    const rows = visible.map(([key, gate]) => {
      const item = gate && typeof gate === "object" ? gate : { status: gate };
      const reason = firstText(item.reason, item.explanation, item.note, item.warning) || "Gate triggered and requires attention.";
      const zh = firstText(item.reasonZh, item.explanationZh, item.noteZh) || gateChineseExplanation(key, item);
      const evidence = meaningfulArr(item.evidence, 3).length ? `<div class="muted"><strong>Evidence:</strong> ${escapeHtml(meaningfulArr(item.evidence, 3).join("; "))}</div>` : "";
      return `<div class="score-gate-item"><strong>${escapeHtml(taskSpecificGateLabel(key))}:</strong> ${escapeHtml(item.status || item.result || item.triggered || "triggered")}<br><span class="muted">${escapeHtml(reason)}</span>${translationButton(zh)}${evidence}</div>`;
    }).join("");
    return `<div class="score-gate-item"><strong>${escapeHtml(title)}</strong><br><span class="muted">只显示触发、警告或失败的任务专项检查。</span></div><div class="score-gate-grid">${rows}</div>`;
  }
  function renderScoreCalibration(result = {}) {
    const profile = result.scoreProfile || {};
    const signals = result.localSignals || {};
    const warnings = meaningfulArr(result.stabilityWarnings, 5);
    const gates = [
      ["Low-band check", profile.lowBandGate],
      ["Mid-band check", profile.midBandGate],
      ["High-band check", profile.highBandGate],
      ["Score-profile check", profile.scoreProfileGate]
    ].filter(([, gate]) => gate && !isPassedLikeStatus(gate.status || gate.result || gate.triggered));
    const meta = `<div class="score-gate-grid compact-meta-grid">
        <div class="score-gate-item"><strong>版本：</strong>${escapeHtml(result.scoreSystemVersion || "clean-score-core")}</div>
        <div class="score-gate-item"><strong>可评分性：</strong>${escapeHtml(signals.rateabilityStatus || "未返回")} ｜ <strong>词数：</strong>${escapeHtml(signals.wordCount ?? "-")} ｜ <strong>段落：</strong>${escapeHtml(signals.paragraphCount ?? "-")} ｜ <strong>句子：</strong>${escapeHtml(signals.sentenceCount ?? "-")}</div>
        <div class="score-gate-item"><strong>语言信号：</strong>拼写 ${escapeHtml(signals.spellingErrorDensity || "-")} ｜ 语法 ${escapeHtml(signals.grammarErrorDensity || "-")} ｜ 句子控制 ${escapeHtml(signals.sentenceControl || "-")} ｜ 词汇控制 ${escapeHtml(signals.lexicalControl || "-")}</div>
      </div>`;
    const gateHtml = gates.length ? `<div class="score-gate-grid">${gates.map(([label, gate]) => {
      const reason = firstText(gate?.reason, gate?.explanation, gate?.note) || "Gate requires attention.";
      const zh = firstText(gate?.reasonZh, gate?.explanationZh, gate?.noteZh) || gateChineseExplanation(label, gate);
      return `<div class="score-gate-item"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(gate?.status || gate?.result || gate?.triggered || "triggered")}<br><span class="muted">${escapeHtml(reason)}</span>${translationButton(zh)}</div>`;
    }).join("")}</div>` : `<div class="score-gate-item"><strong>Low / Mid / High / Score-profile checks:</strong> passed<br><span class="muted">所有核心分数边界检查均通过。</span></div>`;
    const body = `
      ${meta}
      ${renderBoundaryAudit(result)}
      ${renderAnchorComparison(result)}
      ${renderTaskSpecificGateReport(result)}
      ${hasMeaningfulContent(result.examinerSummary) ? `<div class="score-gate-item"><strong>Examiner summary:</strong> ${escapeHtml(result.examinerSummary)}${translationButton(result.examinerSummaryZh || "")}</div>` : ""}
      ${gateHtml}
      ${warnings.length ? `<div class="ai-warning"><strong>稳定性提醒：</strong>${listHtml(warnings)}</div>` : ""}`;
    return renderScoreAccordion("评分校准报告 / Score Calibration Report", body, false, "score-calibration-report compact-calibration-report");
  }

  function renderFeedbackStatusNotice(result = {}) {
    const status = result.feedbackStatus || result.scoreCoreMeta?.feedbackStatus;
    const statusValue = typeof status === "string" ? status : status?.status;
    if (!statusValue) return "";
    if (/failed/i.test(statusValue)) {
      return `<div class="ai-warning feedback-status-warning"><strong>详细反馈暂时生成失败：</strong>核心评分已经冻结，分数不受影响。${escapeHtml(status?.note || status?.error || "可重新评分或后续重试生成反馈。")}</div>`;
    }
    if (/quality/i.test(statusValue)) {
      return `<div class="ai-warning feedback-status-warning"><strong>反馈质量提醒：</strong>核心评分已经冻结；部分四项解释可能仍偏模板化。${escapeHtml(arr(status?.qualityIssues).join(" | "))}</div>`;
    }
    return `<div class="score-flow-note feedback-status-note"><strong>详细反馈：</strong>${escapeHtml(status?.note || "四项详细反馈已在分数冻结后生成，不会改变分数。")}</div>`;
  }
  function renderCriterionCards(result = {}) {
    const criteria = result.finalCriteria || result.criteria || {};
    const entries = Object.entries(criteria);
    if (!entries.length) return `<section class="grading-section"><p class="muted">AI 没有返回完整四项分。</p></section>`;
    const feedbackFailed = /failed/i.test(String(result.feedbackStatus?.status || result.scoreCoreMeta?.feedbackStatus?.status || ""));
    return `<section class="criterion-card-grid" aria-label="四项评分说明">
      ${entries.map(([criterion, band], index) => {
        const item = criterionItem(result, criterion);
        const half = item.halfBandDecision || {};
        const cardId = `criterionCard_${index}_${Math.random().toString(36).slice(2, 8)}`;
        const detailId = `criterionDetail_${index}_${Math.random().toString(36).slice(2, 8)}`;
        const lowerBand = nearestHalfBand(band, "lower");
        const higherBand = nearestHalfBand(band, "higher");
        const whyThis = firstText(item.whyThisBand, item.summary, half.whyExactBand, item.positiveEvidence) || `Core score is frozen at Band ${formatBand(band)}. Detailed feedback was not available for this criterion.`;
        const whyLower = firstText(item.whyNotLower, item.whyAboveLowerBand, half.whyAboveLowerBand) || `This is above Band ${lowerBand} because the response shows enough criterion-specific control for Band ${formatBand(band)}.`;
        const whyHigher = firstText(item.whyNotHigher, item.whyNotYetHigherBand, half.whyBelowUpperBand) || `This is not yet Band ${higherBand} because the limiting features still prevent a stronger band.`;
        const improve = firstText(item.howToImprove, item.improvementFocus) || fallbackImprove(criterion, band);
        const zh = criterionZhSummary(item, {
          whyThis: "为什么是这个分",
          whyLower: `为什么高于 Band ${lowerBand}`,
          whyHigher: `为什么还不到 Band ${higherBand}`
        });
        const supportHtml = evidenceListHtml(item.positiveEvidence || item.supportingEvidence, item.positiveEvidenceZh || item.supportingEvidenceZh);
        const limitHtml = evidenceListHtml(item.limitingEvidence || item.limitsHigherBand, item.limitingEvidenceZh || item.limitsHigherBandZh);
        const essayHtml = essayEvidenceHtml(item.essayEvidence || item.textEvidence || item.evidenceQuotes);
        const halfHasContent = hasMeaningfulContent(half.whyAboveLowerBand || half.whyBelowUpperBand || half.whyExactBand || item.candidateBandsConsidered);
        const detailSections = [
          supportHtml ? `<div class="evidence-box"><h5>支持这个分数的证据</h5>${supportHtml}</div>` : "",
          limitHtml ? `<div class="evidence-box"><h5>限制更高分的证据</h5>${limitHtml}</div>` : "",
          essayHtml ? `<div class="evidence-box"><h5>原文证据 / Evidence from the essay</h5>${essayHtml}</div>` : "",
          halfHasContent ? `<div class="evidence-box"><h5>完整半分判断</h5>
            <p><strong>Candidate bands:</strong> ${escapeHtml(meaningfulArr(item.candidateBandsConsidered).join(" / ") || `${lowerBand} / ${formatBand(band)} / ${higherBand}`)}</p>
            ${hasMeaningfulContent(half.whyAboveLowerBand || whyLower) ? `<p><strong>Why above lower band:</strong> ${escapeHtml(half.whyAboveLowerBand || whyLower)}</p>` : ""}
            ${hasMeaningfulContent(half.whyBelowUpperBand || whyHigher) ? `<p><strong>Why below higher band:</strong> ${escapeHtml(half.whyBelowUpperBand || whyHigher)}</p>` : ""}
            ${hasMeaningfulContent(half.whyExactBand || whyThis) ? `<p><strong>Why exact band:</strong> ${escapeHtml(half.whyExactBand || whyThis)}</p>` : ""}
          </div>` : ""
        ].filter(Boolean);
        const detailCard = !feedbackFailed && detailSections.length ? `<div class="score-detail-card compact-evidence-details">
          <button class="score-detail-toggle" type="button" data-score-detail-toggle="${detailId}"><span>详细证据 / Evidence details</span><span>+</span></button>
          <div id="${detailId}" class="score-detail-body hidden"><div class="evidence-grid">${detailSections.join("")}</div></div>
        </div>` : "";
        return `<article class="criterion-score-card refined-criterion-card">
          <div class="criterion-card-header">
            <div class="criterion-title">${escapeHtml(criterion)}</div>
            <div class="criterion-band-pill">Band ${escapeHtml(formatBand(band))}</div>
            <button class="criterion-toggle" type="button" data-criterion-toggle="${cardId}" aria-label="展开或收起 ${escapeHtml(criterion)}">-</button>
          </div>
          <div class="criterion-card-body" id="${cardId}">
            <div class="criterion-quick-grid">
              <div class="criterion-quick-row"><h5>为什么是这个分</h5><p>${escapeHtml(whyThis)}</p></div>
              <div class="criterion-quick-row"><h5>为什么高于 Band ${escapeHtml(lowerBand)}</h5><p>${escapeHtml(whyLower)}</p></div>
              <div class="criterion-quick-row"><h5>为什么还不到 Band ${escapeHtml(higherBand)}</h5><p>${escapeHtml(whyHigher)}</p></div>
              <div class="criterion-quick-row"><h5>怎么提升</h5><p>${escapeHtml(improve)}</p></div>
            </div>
            ${translationButton(zh, "显示中文解释")}
            ${feedbackFailed ? `<div class="score-flow-note"><strong>详细反馈暂缺：</strong>核心评分已完成，详细证据反馈暂时未生成。</div>` : ""}
            ${detailCard}
          </div>
        </article>`;
      }).join("")}
    </section>`;
  }


  function renderOverallSkeleton() {
    const disclaimer = "This is an AI-generated estimated score, not an official IELTS score.";
    return `<section class="overall-card overall-card-hero score-skeleton-section">
      <h4>Overall estimated band</h4>
      <div class="overall-card-main">
        <div class="overall-score-panel">
          <div class="overall-score"><span>...</span><strong>AI 正在计算最终分数</strong></div>
        </div>
        <aside class="overall-disclaimer-card" role="note" aria-label="Score disclaimer">
          <div class="overall-disclaimer-badge">AI</div>
          <div class="overall-disclaimer-copy">
            <div class="overall-disclaimer-title">Estimated score / 估分说明</div>
            <p class="overall-disclaimer-en">${escapeHtml(disclaimer)}</p>
            <p class="overall-disclaimer-zh">AI 生成的估分，仅供参考，并非官方雅思成绩。</p>
          </div>
        </aside>
      </div>
    </section>`;
  }

  function renderCriterionSkeletonCards() {
    const names = selected?.task === "Task 1"
      ? ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
      : ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
    return `<section class="criterion-card-grid score-skeleton-section" aria-label="四项评分说明">
      ${names.map((criterion, index) => {
        const cardId = `criterionSkeleton_${index}`;
        return `<article class="criterion-score-card is-waiting">
          <div class="criterion-card-header">
            <div class="criterion-title">${escapeHtml(criterion)}</div>
            <div class="criterion-band-pill">等待评分</div>
            <button class="criterion-toggle" type="button" data-criterion-toggle="${cardId}" aria-label="展开或收起 ${escapeHtml(criterion)}">+</button>
          </div>
          <div class="criterion-card-body hidden" id="${cardId}">
            <div class="criterion-quick-row"><h5>AI 批改中</h5><p>AI 正在生成这一项的分数、半分判断、得分原因和提升建议。</p></div>
          </div>
        </article>`;
      }).join("")}
    </section>`;
  }

  function renderScoreCalculationPlaceholder() {
    const body = `<div class="score-placeholder">
      <p><strong>AI 批改中。</strong> 四项分数返回后，这里会显示评分系统、计算方式、四项平均和最终估算。</p>
      <p><strong>本地是否介入评分：</strong>否</p>
      <p><strong>本地是否 cap / 压分 / 提分：</strong>否</p>
    </div>`;
    return renderScoreAccordion("评分计算说明 / Score Calculation Explanation", body, true, "score-calculation-explanation score-skeleton-section");
  }

  function renderScoreCalibrationPlaceholder() {
    const body = `<div class="score-placeholder">
      <p>AI 正在进行 0-9 分锚点对比、Task 1/Task 2 专属核查、低分/中分/高分和分数组合核查。评分返回后，这里会显示 Anchor comparison、Task-specific gates、Low-band / Mid-band / High-band / Score-profile check。</p>
    </div>`;
    return renderScoreAccordion("评分校准报告 / Score Calibration Report", body, false, "score-calibration-report score-skeleton-section");
  }

  function renderScoreSkeleton(progress = latestScoringProgress) {
    injectScoreStyles();
    return `
      ${renderScoringProgressPanel(progress || createScoringProgress(), true)}
      ${renderOverallSkeleton()}
      ${renderCriterionSkeletonCards()}
      ${renderScoreCalculationPlaceholder()}
      ${renderScoreCalibrationPlaceholder()}`;
  }

  function renderScoreResult(result = {}) {
    latestScoreResult = result;
    if (!latestScoringProgress || latestScoringProgress.status === "running") completeScoringProgress();
    injectScoreStyles();
    bindScoreUiInteractions();
    const finalBand = Number(result.overallBand || result.scoreCalculation?.finalBand);
    const rawAverage = Number(result.rawAverage || result.scoreCalculation?.rawAverage);
    const disclaimer = result.disclaimer || "This is an AI-generated estimated score, not an official IELTS score.";
    const disclaimerZh = result.disclaimerZh || result.disclaimerChinese || "AI 生成的估分，仅供参考，并非官方雅思成绩。";
    const html = `
      ${renderScoringProgressPanel(latestScoringProgress, false)}
      <section class="overall-card overall-card-hero">
        <h4>Overall estimated band</h4>
        <div class="overall-card-main">
          <div class="overall-score-panel">
            <div class="overall-score"><span>${escapeHtml(formatBand(finalBand))}</span><strong>Band ${escapeHtml(formatBand(finalBand))}</strong></div>
          </div>
          <aside class="overall-disclaimer-card" role="note" aria-label="Score disclaimer">
            <div class="overall-disclaimer-badge">AI</div>
            <div class="overall-disclaimer-copy">
              <div class="overall-disclaimer-title">Estimated score / 估分说明</div>
              <p class="overall-disclaimer-en">${escapeHtml(disclaimer)}</p>
              <p class="overall-disclaimer-zh">${escapeHtml(disclaimerZh)}</p>
            </div>
          </aside>
        </div>
      </section>
      ${renderFeedbackStatusNotice(result)}
      ${renderCriterionCards(result)}
      ${renderScoreCalculationAccordion(result, rawAverage, finalBand)}
      ${renderScoreCalibration(result)}`;
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
    try {
      latestScoringProgress = createScoringProgress();
      latestScoringProgress.status = "running";
      updateScoringProgress(0, "done", "文本已提交，后端将进行本地预检与任务分流。");
      updateScoringProgress(1, "running", "AI 正在生成短 JSON 核心评分：anchor、四项分和 reason codes。");
      if (els.gradingResults) els.gradingResults.innerHTML = renderScoreSkeleton(latestScoringProgress);
      setGradingStatus("第 2 步/5：AI 核心评分。", "loading");
      const result = await postStage(endpoint, gradingPayload({ mode: "score" }));
      latestScoreResult = result;
      syncScoringProgressFromResult(result);
      completeScoringProgress();
      renderScoreResult(result);
      setGradingStatus("评分完成。五步流程已完成，四项分数已冻结；详细反馈若失败不会影响分数。作文生成请使用旁边的单独按钮。", "done");
    } catch (error) {
      updateScoringProgress(1, "error", "评分流程执行失败。", error);
      setGradingStatus(friendlyScoringError(error), "error");
      if (els.gradingResults) els.gradingResults.innerHTML = renderScoringProgressPanel(latestScoringProgress, true);
    } finally {
      if (els.gradeBtn) { els.gradeBtn.disabled = false; els.gradeBtn.textContent = originalText; els.gradeBtn.removeAttribute("aria-busy"); }
      if (els.generateRevisionBtn) els.generateRevisionBtn.disabled = false;
      if (els.gradingEndpointInput) els.gradingEndpointInput.disabled = false;
    }
  }


  function roundToHalfBand(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return 0;
    return Math.max(0, Math.min(9, Math.round(numeric * 2) / 2));
  }

  function formatMockBand(value) {
    const rounded = roundToHalfBand(value);
    return Number.isInteger(rounded) ? `${rounded}.0` : String(rounded);
  }

  function calculateMockWritingBand(task1Band, task2Band) {
    const raw = (Number(task1Band || 0) + Number(task2Band || 0) * 2) / 3;
    return roundToHalfBand(raw);
  }

  function chooseRandomPrompt(task) {
    const pool = prompts.filter((p) => p.task === task);
    return pool[Math.floor(Math.random() * pool.length)] || null;
  }

  function mockPayloadForPrompt(prompt, essay, extra = {}) {
    const wordCount = countWords(essay);
    const targetWordCount = targetWordsForPrompt(prompt);
    return {
      task: prompt?.task || "Task 2",
      taskType: taskTypeForPrompt(prompt),
      promptId: prompt?.id || "",
      book: prompt?.book || "",
      test: prompt?.test || "",
      title: prompt?.title || "",
      questionTitle: prompt?.title || "",
      questionType: prompt?.type || "",
      letterStyle: prompt?.letterStyle || "",
      questionPrompt: prompt?.prompt || "",
      promptText: prompt?.prompt || "",
      task1BulletPoints: prompt?.task === "Task 1" ? extractBulletPointsFromPrompt(prompt?.prompt) : [],
      task2QuestionProfile: prompt?.task === "Task 2" ? buildTask2QuestionProfile(prompt?.prompt) : null,
      task2Instruction: prompt?.task === "Task 2" ? prompt?.prompt || "" : "",
      essay,
      wordCount,
      actualWordCount: wordCount,
      targetWordCount,
      isUnderMinimum: wordCount < targetWordCount,
      mode: "score",
      gradingMode: "mock_exam",
      outputLanguage: "en",
      locale: "en",
      includeRevision: false,
      revisionTargets: [],
      mockExam: true,
      rubric: {
        task1: ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"],
        task2: ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
      },
      ...extra
    };
  }

  async function postMockScore(endpoint, prompt, essay, label) {
    setMockStatus(`${label}：AI 锚点评分与边界复核中...`, "loading");
    const currentResult = await postStage(endpoint, mockPayloadForPrompt(prompt, essay, { mode: "score" }));
    if (!Number.isFinite(Number(currentResult?.overallBand || currentResult?.scoreCalculation?.finalBand))) {
      throw new Error(`${label}: final score was not returned.`);
    }
    return currentResult;
  }

  function renderMockPrompt(targetId, prompt) {
    const node = $(targetId);
    if (!node || !prompt) return;
    node.innerHTML = `
      <div class="tags">${tag(prompt.book, "book")}${tag(prompt.test, "book")}${tag(prompt.task, prompt.task === "Task 1" ? "task1" : "task2")}${tag(prompt.type, "type")}</div>
      <h4>${escapeHtml(prompt.title)}</h4>
      <p class="prompt-text">${escapeHtml(prompt.prompt)}</p>`;
  }

  function setMockStatus(text, state = "") {
    const node = $("mockExamStatus");
    if (!node) return;
    node.textContent = text;
    node.dataset.state = state;
  }

  function updateMockWordCounts() {
    const t1 = $("mockTask1Essay");
    const t2 = $("mockTask2Essay");
    const w1 = $("mockTask1Words");
    const w2 = $("mockTask2Words");
    if (w1 && t1) w1.textContent = countWords(t1.value);
    if (w2 && t2) w2.textContent = countWords(t2.value);
  }

  function renderMockTimer() {
    const node = $("mockTimerDisplay");
    if (node) node.textContent = fmt(mockRemaining);
  }

  function startMockTimer() {
    if (mockTimerId) { clearInterval(mockTimerId); mockTimerId = null; const btn = $("mockStartTimerBtn"); if (btn) btn.textContent = "继续计时"; return; }
    const btn = $("mockStartTimerBtn");
    if (btn) btn.textContent = "暂停计时";
    mockTimerId = setInterval(() => {
      mockRemaining = Math.max(0, mockRemaining - 1);
      renderMockTimer();
      if (mockRemaining === 40 * 60) setMockStatus("建议开始 Task 2。", "loading");
      if (mockRemaining === 10 * 60) setMockStatus("剩余 10 分钟。", "loading");
      if (mockRemaining === 0) {
        clearInterval(mockTimerId);
        mockTimerId = null;
        if (btn) btn.textContent = "开始计时";
        setMockStatus("时间结束，可以提交两篇作文评分。", "warning");
      }
    }, 1000);
  }

  function resetMockExam(pickNew = true) {
    if (pickNew || !mockTask1Prompt) mockTask1Prompt = chooseRandomPrompt("Task 1");
    if (pickNew || !mockTask2Prompt) mockTask2Prompt = chooseRandomPrompt("Task 2");
    renderMockPrompt("mockTask1Prompt", mockTask1Prompt);
    renderMockPrompt("mockTask2Prompt", mockTask2Prompt);
    const t1 = $("mockTask1Essay");
    const t2 = $("mockTask2Essay");
    if (pickNew) {
      if (t1) t1.value = "";
      if (t2) t2.value = "";
      const results = $("mockExamResults");
      if (results) results.innerHTML = "";
    }
    mockRemaining = 60 * 60;
    if (mockTimerId) { clearInterval(mockTimerId); mockTimerId = null; }
    const btn = $("mockStartTimerBtn");
    if (btn) btn.textContent = "开始计时";
    renderMockTimer();
    updateMockWordCounts();
    setMockStatus("模拟考试准备就绪。", "");
  }

  function renderMockTaskScore(label, result = {}, band) {
    const rawAverage = Number(result.rawAverage || result.scoreCalculation?.rawAverage);
    const finalBand = Number(result.overallBand || result.scoreCalculation?.finalBand || band);
    return renderScoreAccordion(`${label} 模拟考试评分`, `
      <p><strong>Estimated band:</strong> Band ${escapeHtml(formatMockBand(finalBand))}</p>
      ${renderScoreCalculationAccordion(result, rawAverage, finalBand)}
      ${renderScoreCalibration(result)}
    `, false, "mock-task-result-accordion");
  }

  function renderMockResults(task1Result, task2Result) {
    const t1Band = roundToHalfBand(task1Result?.overallBand || task1Result?.scoreCalculation?.finalBand);
    const t2Band = roundToHalfBand(task2Result?.overallBand || task2Result?.scoreCalculation?.finalBand);
    const finalBand = calculateMockWritingBand(t1Band, t2Band);
    const rawWeightedAverage = (t1Band + t2Band * 2) / 3;
    const node = $("mockExamResults");
    if (!node) return;
    node.innerHTML = `
      <section class="mock-score-card mock-score-card-hero">
        <div>
          <p class="kicker">Mock Writing Result</p>
          <h3>Final Writing estimated band</h3>
          <p class="muted">Task 1 和 Task 2 分开评分；Task 2 权重更高。本结果为 AI 估算，不是官方 IELTS 成绩。</p>
        </div>
        <div class="mock-final-band">${escapeHtml(formatMockBand(finalBand))}</div>
        <div class="mock-score-formula">
          <p><strong>Task 1:</strong> Band ${escapeHtml(formatMockBand(t1Band))}</p>
          <p><strong>Task 2:</strong> Band ${escapeHtml(formatMockBand(t2Band))}</p>
          <p><strong>综合计算：</strong>(${escapeHtml(formatMockBand(t1Band))} + ${escapeHtml(formatMockBand(t2Band))} × 2) ÷ 3 = ${escapeHtml(rawWeightedAverage.toFixed(3).replace(/\.?0+$/, ""))} → Band ${escapeHtml(formatMockBand(finalBand))}</p>
        </div>
      </section>
      ${renderMockTaskScore("Task 1", task1Result, t1Band)}
      ${renderMockTaskScore("Task 2", task2Result, t2Band)}`;
  }

  async function submitMockExam() {
    const endpoint = String(els.gradingEndpointInput?.value || "").trim();
    if (!endpoint) { setMockStatus("请先填写批改接口地址。", "error"); return; }
    if (!mockTask1Prompt || !mockTask2Prompt) resetMockExam(true);
    const t1Essay = String($("mockTask1Essay")?.value || "").trim();
    const t2Essay = String($("mockTask2Essay")?.value || "").trim();
    if (!t1Essay && !t2Essay) setMockStatus("两篇都为空也可以提交，AI 会按无有效作答评分；建议至少保留真实考试中写下的内容。", "warning");
    const btn = $("mockSubmitBtn");
    const resetBtn = $("mockResetBtn");
    if (btn) { btn.disabled = true; btn.textContent = "评分中..."; }
    if (resetBtn) resetBtn.disabled = true;
    try {
      setMockStatus("正在评分 Task 1...", "loading");
      const task1Result = await postMockScore(endpoint, mockTask1Prompt, t1Essay, "Task 1");
      setMockStatus("正在评分 Task 2...", "loading");
      const task2Result = await postMockScore(endpoint, mockTask2Prompt, t2Essay, "Task 2");
      renderMockResults(task1Result, task2Result);
      setMockStatus("模拟考试最终评分完成。", "done");
    } catch (error) {
      setMockStatus(`模拟考试评分失败：${error.message}`, "error");
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "提交两篇作文并综合评分"; }
      if (resetBtn) resetBtn.disabled = false;
    }
  }

  function bindMockExamInteractions(card) {
    if (!card || card.dataset.mockBound === "true") return;
    card.dataset.mockBound = "true";
    card.addEventListener("click", (event) => {
      const translateBtn = event.target.closest("[data-score-translation-target]");
      if (translateBtn) {
        const target = document.getElementById(translateBtn.dataset.scoreTranslationTarget);
        if (target) {
          const hidden = target.classList.toggle("hidden-score-translation");
          translateBtn.textContent = hidden ? "中文解释" : "收起中文";
        }
      }
    });
  }

  function ensureMockExamPanel() {
    if ($("mockExamCard")) return;
    const filters = document.querySelector(".filters");
    if (!filters || !filters.parentNode) return;
    const card = document.createElement("section");
    card.id = "mockExamCard";
    card.className = "card mock-exam-card mock-exam-card-modern";
    card.innerHTML = `
      <div class="mock-exam-hero">
        <div>
          <p class="kicker">IELTS GT Writing Mock Test</p>
          <h3>考试模式：Task 1 + Task 2</h3>
          <p class="muted">60 分钟完成两篇作文。Task 1 建议 20 分钟，Task 2 建议 40 分钟；提交后按 Task 2 双倍权重计算模拟 Writing 总分。</p>
        </div>
        <div class="mock-exam-hero-actions">
          <strong id="mockTimerDisplay" class="mock-main-timer">60:00</strong>
          <button class="primary" type="button" id="mockToggleBtn">打开考试模式</button>
        </div>
      </div>
      <div id="mockExamBody" class="mock-exam-body hidden">
        <div class="mock-toolbar actions">
          <button class="secondary" type="button" id="mockStartTimerBtn">开始计时</button>
          <button class="secondary" type="button" id="mockResetBtn">换一套题 / 重置</button>
          <span id="mockExamStatus" class="muted"></span>
        </div>
        <div class="mock-exam-grid">
          <div class="mock-task-card">
            <div class="mock-task-card-head"><h4>Task 1 Letter</h4><span class="tag task1">20 min · 150+ words</span></div>
            <div id="mockTask1Prompt" class="question-card"></div>
            <textarea id="mockTask1Essay" class="essay" placeholder="Write your Task 1 letter here..."></textarea>
            <p class="wordbox"><strong id="mockTask1Words">0</strong><span>/ 150 words</span></p>
          </div>
          <div class="mock-task-card">
            <div class="mock-task-card-head"><h4>Task 2 Essay</h4><span class="tag task2">40 min · 250+ words</span></div>
            <div id="mockTask2Prompt" class="question-card"></div>
            <textarea id="mockTask2Essay" class="essay" placeholder="Write your Task 2 essay here..."></textarea>
            <p class="wordbox"><strong id="mockTask2Words">0</strong><span>/ 250 words</span></p>
          </div>
        </div>
        <div class="mock-submit-row"><button class="primary" type="button" id="mockSubmitBtn">提交两篇作文并综合评分</button></div>
        <div id="mockExamResults" class="grading-results"></div>
      </div>`;
    filters.parentNode.insertBefore(card, filters.nextSibling);
    bindMockExamInteractions(card);
    $("mockToggleBtn")?.addEventListener("click", () => {
      const body = $("mockExamBody");
      if (!body) return;
      const opening = body.classList.contains("hidden");
      body.classList.toggle("hidden", !opening);
      $("mockToggleBtn").textContent = opening ? "收起考试模式" : "打开考试模式";
      if (opening) resetMockExam(false);
    });
    $("mockStartTimerBtn")?.addEventListener("click", startMockTimer);
    $("mockResetBtn")?.addEventListener("click", () => resetMockExam(true));
    $("mockSubmitBtn")?.addEventListener("click", submitMockExam);
    $("mockTask1Essay")?.addEventListener("input", updateMockWordCounts);
    $("mockTask2Essay")?.addEventListener("input", updateMockWordCounts);
    resetMockExam(true);
  }

  function bind() {
    [els.bookFilter, els.testFilter, els.typeFilter].filter(Boolean).forEach((el) => el.addEventListener("change", renderList));
    els.taskFilter?.addEventListener("change", () => { updateTypeFilterOptions(); renderList(); });
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
    ensureMockExamPanel();
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
