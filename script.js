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
    { stage: "score-kernel", title: "AI 核心评分", description: "AI 只返回 anchor、四项分和 reason codes；不生成详细反馈。" },
    { stage: "boundary-audit", title: "本地边界审计", description: "只做一致性检查：低分/高分边界、弱语言高分、四项同分和 anchor 冲突。" },
    { stage: "boundary-review", title: "AI 边界复核", description: "只有边界审计触发时才二次复核；否则跳过。" },
    { stage: "freeze-score", title: "冻结最终分数", description: "冻结 Overall 与四项分；从这里开始详细反馈不能改变分数。" },
    { stage: "criterion-feedback", title: "逐项详细反馈", description: "分数冻结后，独立生成四项详细反馈：证据、原因、差 0.5 的说明和提升建议。" }
  ];
  const GRADING_ENDPOINT_KEY = "ielts-gt-writing-hub:gradingEndpoint";
  const DEFAULT_GRADING_ENDPOINT = "/api/grade-ielts-production-router";

  const LEARNING_FEEDBACK_MODULES = [
    { key: "overview", label: "全文总览", en: "Overview" },
    { key: "sentenceUpgrade", label: "逐句修改", en: "Sentence Upgrade" },
    { key: "grammarWordFormSpelling", label: "语法词形拼写", en: "Grammar, Word Form & Spelling" },
    { key: "structureCohesionTask", label: "结构与任务回应", en: "Structure, Cohesion & Task" },
    { key: "expressionBank", label: "表达积累", en: "Expression Bank" }
  ];
  let latestLearningFeedback = {};
  let activeLearningFeedbackModule = "sentenceUpgrade";

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

  function lockedTaskForSelected() {
    return selected?.task === "Task 1" ? "Task 1" : "Task 2";
  }

  function taskTypeForLockedTask(task) {
    return task === "Task 1" ? "task1" : "task2";
  }

  function taskOfScoreResult(result) {
    if (!result || typeof result !== "object") return "";
    return result.task || result.localSignals?.task || result.requestedTask || result.scoringTask || result.selectedTask || "";
  }

  function safeCurrentResultForTask(task = lockedTaskForSelected()) {
    const resultTask = taskOfScoreResult(latestScoreResult);
    return resultTask === task ? latestScoreResult : null;
  }

  function lockedTaskFields(task = lockedTaskForSelected()) {
    const lockedTask = task === "Task 1" ? "Task 1" : "Task 2";
    return {
      task: lockedTask,
      taskType: taskTypeForLockedTask(lockedTask),
      scoringTask: lockedTask,
      feedbackTask: lockedTask,
      generationTask: lockedTask,
      requestedTask: lockedTask,
      selectedTask: lockedTask
    };
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
    latestLearningFeedback = {};
    activeLearningFeedbackModule = "sentenceUpgrade";
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
    const lockedTask = lockedTaskForSelected();
    return {
      ...lockedTaskFields(lockedTask),
      promptId: selected?.id || "",
      title: selected?.title || "",
      letterStyle: selected?.letterStyle || "",
      questionType: selected?.type || "",
      questionPrompt: selected?.prompt || "",
      promptText: selected?.prompt || "",
      prompt: selected?.prompt || "",
      task1BulletPoints: lockedTask === "Task 1" ? extractBulletPointsFromPrompt(selected?.prompt) : [],
      task2QuestionProfile: lockedTask === "Task 2" ? buildTask2QuestionProfile(selected?.prompt) : null,
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
    if (stepIndex >= 5 && status === "running") progress.phase = "feedback";
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

  function markScoreFrozenAndStartCriterionFeedback(message = "核心分数已冻结；正在逐项生成详细反馈。") {
    const progress = ensureScoringProgress();
    progress.status = "running";
    progress.phase = "feedback";
    progress.currentStep = 6;
    progress.updatedAt = new Date().toISOString();
    progress.error = null;
    progress.steps.forEach((step, index) => {
      if (index <= 4) {
        if (step.status !== "error") {
          step.status = step.stage === "boundary-review" && /跳过|skip/i.test(String(step.message || step.description || "")) ? "skipped" : "done";
        }
      }
    });
    const feedbackStep = progress.steps[5];
    if (feedbackStep) {
      feedbackStep.status = "running";
      feedbackStep.message = message;
      feedbackStep.error = "";
    }
    return progress;
  }

  function completeScoringProgress() {
    const progress = ensureScoringProgress();
    progress.status = "done";
    progress.phase = "done";
    progress.currentStep = SCORING_STEPS.length;
    progress.updatedAt = new Date().toISOString();
    progress.steps.forEach((step) => {
      if (step.status !== "error") step.status = "done";
    });
    return progress;
  }

  function refreshScoringSkeleton() {
    if (!els.gradingResults || !latestScoringProgress) return;
    els.gradingResults.innerHTML = renderScoreSkeleton(latestScoringProgress);
  }

  function progressStatusLabel(progress = latestScoringProgress) {
    const p = progress || {};
    const current = p.steps?.find((step) => step.status === "running") || p.steps?.find((step) => step.status === "error") || p.steps?.[Math.max(0, (p.currentStep || 1) - 1)];
    if (p.status === "error" || p.error) {
      return current?.stage === "criterion-feedback" ? "详细反馈失败" : "评分失败";
    }
    if (p.status === "done") return "批改完成";
    if (current?.stage === "criterion-feedback" || p.phase === "feedback") return "正在生成详细反馈";
    if (p.status === "running") return "正在评分";
    return "等待评分";
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
          <span class="score-progress-chip ${escapeHtml(statusClass)}">当前状态：${escapeHtml(progressStatusLabel(p))}</span>
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

      .criterion-diff-review-card { border: 1px solid rgba(15,118,110,.22); border-radius: 18px; background: linear-gradient(135deg, rgba(240,253,250,.86), rgba(255,255,255,.96)); padding: 16px 18px; margin: 14px 0; box-shadow: 0 10px 26px rgba(15,23,42,.05); }
      .criterion-diff-review-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 14px; flex-wrap: wrap; }
      .criterion-diff-review-title { margin: 0; font-size: 1rem; font-weight: 950; color: var(--text, #122033); }
      .criterion-diff-review-subtitle { margin: 5px 0 0; color: var(--muted, #5b7082); line-height: 1.55; }
      .criterion-diff-badge { display: inline-flex; align-items: center; gap: 6px; border-radius: 999px; padding: 7px 11px; font-weight: 900; font-size: .84rem; color: var(--teal, #0f766e); background: rgba(15,118,110,.12); border: 1px solid rgba(15,118,110,.18); white-space: nowrap; }
      .criterion-diff-badge.revised { color: var(--amber, #a45d00); background: rgba(164,93,0,.11); border-color: rgba(164,93,0,.2); }
      .criterion-diff-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; margin-top: 14px; }
      .criterion-diff-panel { border: 1px solid rgba(15,118,110,.16); border-radius: 14px; background: rgba(255,255,255,.72); padding: 12px 14px; }
      .criterion-diff-panel h5 { margin: 0 0 8px; font-size: .92rem; color: var(--teal, #0f766e); }
      .criterion-diff-row { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 7px 0; border-top: 1px solid rgba(15,118,110,.08); }
      .criterion-diff-row:first-of-type { border-top: 0; }
      .criterion-diff-row span { color: var(--text, #122033); font-weight: 800; }
      .criterion-diff-row strong { white-space: nowrap; color: var(--teal, #0f766e); }
      .criterion-diff-row.is-changed strong { color: var(--amber, #a45d00); }
      .criterion-diff-evidence { display: grid; gap: 8px; margin-top: 12px; }
      .criterion-diff-evidence-item { border-left: 4px solid rgba(15,118,110,.52); padding: 8px 10px; border-radius: 9px; background: rgba(255,255,255,.74); line-height: 1.55; }
      .criterion-diff-evidence-item strong { display: block; margin-bottom: 4px; color: var(--text, #122033); }
      .criterion-diff-note { margin-top: 12px; padding: 10px 12px; border-radius: 12px; background: rgba(15,118,110,.07); color: var(--muted, #5b7082); line-height: 1.6; }
      @media (max-width: 760px) { .criterion-diff-grid { grid-template-columns: 1fr; } }
      .criterion-card-grid { display: grid; gap: 14px; margin: 14px 0; }
      .criterion-score-card { border: 1px solid var(--border, #d7e2ea); border-radius: 16px; background: var(--card, #fff); overflow: hidden; box-shadow: 0 1px 0 rgba(15,23,42,.03); transition: border-color .16s ease, box-shadow .16s ease, transform .16s ease; }
      .criterion-score-card:hover { border-color: rgba(15,118,110,.35); box-shadow: 0 10px 24px rgba(15,23,42,.06); }
      .criterion-card-header { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 16px 18px; border-bottom: 1px solid var(--border, #d7e2ea); background: rgba(248,250,252,.7); }
      .criterion-score-card.is-collapsed .criterion-card-header { border-bottom: 0; }
      .criterion-title { font-weight: 800; font-size: 1.05rem; color: var(--text, #122033); }
      .criterion-band-pill { font-weight: 900; border-radius: 999px; padding: 8px 13px; background: rgba(15,118,110,.12); color: var(--teal, #0f766e); white-space: nowrap; }
      .criterion-toggle { width: 38px; height: 38px; border-radius: 999px; border: 1px solid var(--border, #bfd1de); background: transparent; font-weight: 900; font-size: 1.1rem; cursor: pointer; color: var(--teal, #0f766e); }
      .criterion-card-body { padding: 16px 18px 18px; }
      .criterion-card-body.hidden { display: none; }
      .criterion-compact-toolbar { grid-column: 1 / -1; display: flex; justify-content: flex-end; gap: 10px; margin: 0 0 2px; }
      .criterion-compact-toolbar button { border: 1px solid var(--border, #bfd1de); border-radius: 999px; background: rgba(255,255,255,.78); padding: 8px 13px; font-weight: 800; color: var(--teal, #0f766e); cursor: pointer; }
      .criterion-card-preview { padding: 0 18px 16px; display: grid; gap: 8px; color: var(--muted, #5b7082); }
      .criterion-card-preview strong { color: var(--text, #122033); font-weight: 900; }
      .criterion-preview-line { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.55; }
      .criterion-preview-zh { border-left: 4px solid rgba(15,118,110,.45); border-radius: 9px; background: rgba(224,242,241,.55); padding: 8px 10px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; line-height: 1.55; }
      .criterion-score-card.is-expanded .criterion-card-preview { display: none; }
      .criterion-score-card.is-expanded .criterion-quick-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
      .criterion-score-card.is-expanded .criterion-visible-evidence { margin-top: 16px; }
      .criterion-quick-grid { display: grid; gap: 12px; }
      .criterion-quick-row { border-left: 4px solid rgba(15,118,110,.7); padding: 10px 12px; border-radius: 10px; background: rgba(15,118,110,.055); }
      .criterion-quick-row h5 { margin: 0 0 6px; font-size: .96rem; color: var(--text, #122033); }
      .criterion-quick-row p { margin: 0; line-height: 1.65; }
      .criterion-visible-evidence { margin: 14px 0 4px; padding: 13px 14px; border: 1px solid rgba(15,118,110,.18); border-radius: 14px; background: linear-gradient(180deg, rgba(240,253,250,.72), rgba(255,255,255,.72)); }
      .criterion-visible-evidence h5 { margin: 0 0 10px; color: var(--teal, #0f766e); font-size: .95rem; }
      .criterion-evidence-quotes { display: grid; gap: 9px; margin-bottom: 10px; }
      .criterion-evidence-quote { border-left: 4px solid rgba(15,118,110,.55); padding: 9px 11px; border-radius: 9px; background: rgba(255,255,255,.72); }
      .criterion-evidence-quote strong { display: block; margin-bottom: 5px; color: var(--text, #122033); }
      .criterion-evidence-chips { display: grid; gap: 8px; }
      .criterion-evidence-chip { padding: 8px 10px; border-radius: 10px; background: rgba(255,255,255,.68); border: 1px solid rgba(15,118,110,.12); }
      .criterion-evidence-chip > span { display: inline-block; margin-bottom: 4px; font-size: .78rem; font-weight: 900; color: var(--teal, #0f766e); text-transform: uppercase; letter-spacing: .02em; }
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
      @media (max-width: 979px) { .criterion-score-card.is-expanded .criterion-quick-grid { grid-template-columns: 1fr; } }
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

.grading-results .criterion-score-card.is-expanded{
  grid-column:1 / -1 !important;
  transform:none !important;
}

.grading-results .criterion-score-card.is-expanded .criterion-card-preview{
  display:none !important;
}

.grading-results .criterion-score-card.is-expanded .criterion-card-body{
  display:block;
}

.grading-results .criterion-score-card.is-expanded .criterion-quick-grid{
  grid-template-columns:repeat(2,minmax(0,1fr)) !important;
  align-items:start;
}


.grading-results .criterion-card-grid.has-expanded-criterion{
  display:block !important;
}

.grading-results .criterion-card-grid.has-expanded-criterion .criterion-score-card{
  width:100% !important;
  max-width:none !important;
  margin:0 0 18px !important;
}

.grading-results .criterion-card-grid.has-expanded-criterion .criterion-score-card.is-expanded{
  grid-column:auto !important;
}

.grading-results .criterion-card-grid.has-expanded-criterion .criterion-compact-toolbar{
  display:flex !important;
}

.grading-results .criterion-score-card.is-expanded .criterion-quick-row{
  min-height:auto;
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

.grading-results .criterion-card-preview{
  padding:0 20px 16px !important;
}

.grading-results .criterion-compact-toolbar{
  margin:0 0 6px !important;
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
  .grading-results .criterion-score-card.is-expanded .criterion-quick-grid{
    grid-template-columns:1fr !important;
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


/* Score UI v7.8 display refinement: cleaner evidence cards and quieter calibration report */
.grading-results .refined-criterion-card .evidence-grid{
  grid-template-columns:1fr !important;
  gap:12px !important;
}
.grading-results .compact-evidence-details .score-detail-body{
  padding:14px 16px !important;
}
.grading-results .evidence-box{
  min-width:0;
  overflow-wrap:break-word;
}
.grading-results .evidence-box h5{
  font-size:.95rem;
  line-height:1.35;
}
.grading-results .compact-evidence-list{
  margin:0;
  padding-left:1.1rem;
  line-height:1.6;
}
.grading-results .compact-evidence-list li+li{
  margin-top:8px;
}
.grading-results .quote-evidence{
  line-height:1.55;
  word-break:normal;
  overflow-wrap:anywhere;
}
.grading-results .score-calibration-report .score-accordion-body{
  padding:16px 18px !important;
}
.grading-results .calibration-user-summary{
  display:grid;
  gap:12px;
}
.grading-results .calibration-summary-grid{
  display:grid;
  grid-template-columns:repeat(2,minmax(0,1fr));
  gap:12px;
}
.grading-results .calibration-summary-card{
  border:1px solid var(--border, #d7e2ea);
  border-radius:14px;
  padding:12px 14px;
  background:rgba(255,255,255,.70);
  line-height:1.55;
}
.grading-results .calibration-summary-card strong{
  display:block;
  margin-bottom:4px;
}
.grading-results .calibration-dev-details{
  margin-top:12px;
  border:1px dashed rgba(100,116,132,.35);
  border-radius:14px;
  overflow:hidden;
}
.grading-results .calibration-dev-details>summary{
  min-height:46px !important;
  padding:0 14px !important;
  background:rgba(248,250,252,.72) !important;
  font-size:.95rem !important;
}
.grading-results .calibration-dev-body{
  padding:14px;
  border-top:1px solid var(--border, #d7e2ea);
}
.grading-results .calibration-dev-body .score-gate-grid{
  grid-template-columns:1fr !important;
}
.grading-results .score-gate-item .muted{
  overflow-wrap:anywhere;
}
@media (max-width:760px){
  .grading-results .calibration-summary-grid{
    grid-template-columns:1fr;
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

  function autoZhText(en, context = {}) {
    const raw = String(en || "").trim();
    if (!raw) return "";
    const criterion = String(context.criterion || "");
    const heading = String(context.heading || "");
    const band = Number(context.band);
    const lowerHeading = heading.toLowerCase();
    const lowerText = raw.toLowerCase();
    const names = [];
    if (/task response|task achievement/i.test(criterion)) names.push("任务回应");
    if (/coherence/i.test(criterion)) names.push("连贯与衔接");
    if (/lexical/i.test(criterion)) names.push("词汇资源");
    if (/grammatical/i.test(criterion)) names.push("语法范围与准确性");
    const field = names[0] || "这一项";
    if (/why this|为什么是这个分/.test(lowerHeading)) {
      return `${field}得分依据：英文说明认为文章在该项表现达到 Band ${Number.isFinite(band) ? formatBand(band) : "当前"} 水平，主要证据是：${simpleZhGloss(raw)}`;
    }
    if (/above lower|高于/.test(lowerHeading)) {
      return `${field}高于低一档的原因：${simpleZhGloss(raw)}`;
    }
    if (/below higher|还不到|not yet/.test(lowerHeading)) {
      return `${field}还没有达到更高一档的原因：${simpleZhGloss(raw)}`;
    }
    if (/improve|提升/.test(lowerHeading)) {
      return `提升建议：${simpleZhGloss(raw)}`;
    }
    if (/evidence|证据/.test(lowerHeading)) {
      return `证据释义：${simpleZhGloss(raw)}`;
    }
    return `中文释义：${simpleZhGloss(raw)}`;
  }

  function simpleZhGloss(text) {
    let out = String(text || "").trim();
    const replacements = [
      [/presents? a clear position/ig, "提出清晰立场"],
      [/clear position/ig, "清晰立场"],
      [/develops? arguments?/ig, "展开论点"],
      [/developed reasoning/ig, "论证有展开"],
      [/specific examples?/ig, "具体例子"],
      [/balanced view/ig, "平衡观点"],
      [/logical progression/ig, "逻辑推进"],
      [/clear introduction/ig, "清楚的引言"],
      [/body paragraphs?/ig, "主体段"],
      [/conclusion/ig, "结论"],
      [/cohesive devices?/ig, "衔接手段"],
      [/paragraphing/ig, "分段"],
      [/formulaic/ig, "公式化"],
      [/transitions?/ig, "过渡表达"],
      [/seamless flow/ig, "自然流畅的衔接"],
      [/vocabulary range/ig, "词汇范围"],
      [/precise terms?/ig, "准确用词"],
      [/some repetition/ig, "有一些重复"],
      [/common collocations?/ig, "常见搭配"],
      [/complex structures?/ig, "复杂句式"],
      [/minor errors?/ig, "小错误"],
      [/rare and minor/ig, "少且轻微"],
      [/grammatical control/ig, "语法控制"],
      [/relative clauses?/ig, "定语从句"],
      [/conditionals?/ig, "条件句"],
      [/passive voice/ig, "被动语态"],
      [/counterarguments?/ig, "反方论点"],
      [/societal implications?/ig, "社会层面影响"],
      [/social pressure/ig, "社会压力"],
      [/personal freedom/ig, "个人自由"],
      [/healthy appearance/ig, "健康外貌"],
      [/regulation/ig, "监管"],
      [/supports? this score/ig, "支持这个分数"],
      [/limits? higher bands?/ig, "限制更高分"],
      [/candidate bands?/ig, "候选分数"],
      [/why above lower band/ig, "为什么高于低一档"],
      [/why below higher band/ig, "为什么低于高一档"],
      [/why exact band/ig, "为什么是这个准确分数"]
    ];
    replacements.forEach(([pattern, zh]) => { out = out.replace(pattern, zh); });
    return out;
  }


  function isTechnicalScoreText(value) {
    const text = String(value || "").trim();
    if (!text) return false;
    const lower = text.toLowerCase();
    if (/core score pass froze|detailed (lower|higher)-bound evidence|generated after freeze|reason codes|score kernel selected|anchor using task fit/i.test(text)) return true;
    if (/[a-z]+_[a-z]+/.test(lower)) return true;
    const tokens = lower.split(/[\s,;|]+/).filter(Boolean);
    if (tokens.length >= 2) {
      const codeLike = tokens.filter((t) => /^[a-z]+(?:_[a-z0-9]+)+$/.test(t)).length;
      if (codeLike / tokens.length >= 0.45) return true;
    }
    return false;
  }

  function cleanUserFeedbackText(value) {
    const text = String(value || "").trim();
    return isTechnicalScoreText(text) ? "" : text;
  }

  function criterionFieldZh(criterion) {
    if (/task response|task achievement/i.test(criterion)) return "任务回应";
    if (/coherence/i.test(criterion)) return "连贯与衔接";
    if (/lexical/i.test(criterion)) return "词汇资源";
    if (/grammatical/i.test(criterion)) return "语法范围与准确性";
    return "这一项";
  }

  function criterionFieldEn(criterion) {
    if (/task response|task achievement/i.test(criterion)) return "task response";
    if (/coherence/i.test(criterion)) return "coherence and cohesion";
    if (/lexical/i.test(criterion)) return "lexical resource";
    if (/grammatical/i.test(criterion)) return "grammar control";
    return "this criterion";
  }

  function defaultCriterionEnglish(criterion, band, kind, lowerBand, higherBand) {
    const field = criterionFieldEn(criterion);
    const current = formatBand(band);
    if (kind === "whyThis") {
      if (/task response|task achievement/i.test(criterion)) return `This band reflects the task evidence shown in the response. Use the evidence box below to check which claim was accepted and which missing explanation or example is limiting the score.`;
      if (/coherence/i.test(criterion)) return `This band reflects the organisation visible in this response. Check whether the ideas are actually developed from sentence to sentence, not only separated into paragraphs.`;
      if (/lexical/i.test(criterion)) return `This band reflects the vocabulary evidence in the response, including topic-word accuracy, repetition, word form, and collocation control.`;
      if (/grammatical/i.test(criterion)) return `This band reflects the sentence evidence in the response, including verb forms, sentence boundaries, clause control, and accuracy.`;
      return `This criterion is currently around Band ${current}.`;
    }
    if (kind === "whyLower") return `It is not lower because the writing still shows some assessable control in ${field}, rather than being absent or completely unclear.`;
    if (kind === "whyHigher") {
      if (/task response|task achievement/i.test(criterion)) return `It is not yet Band ${higherBand} because the answer needs more specific reasoning, clearer support, and fuller coverage of the task requirements.`;
      if (/coherence/i.test(criterion)) return `It is not yet Band ${higherBand} because paragraph progression and sentence links need to be clearer and less mechanical.`;
      if (/lexical/i.test(criterion)) return `It is not yet Band ${higherBand} because vocabulary needs more natural collocation, less repetition, and more precise topic words.`;
      if (/grammatical/i.test(criterion)) return `It is not yet Band ${higherBand} because grammar needs more accurate complex sentences and fewer basic errors.`;
      return `It is not yet Band ${higherBand} because stronger criterion-specific control is still needed.`;
    }
    if (kind === "improve") return fallbackImprove(criterion, band);
    return "";
  }

  function defaultCriterionChinese(criterion, band, kind, lowerBand, higherBand) {
    const field = criterionFieldZh(criterion);
    if (kind === "whyThis") {
      if (/task response|task achievement/i.test(criterion)) return `${field}目前这个分数说明：文章有回应任务的尝试，但主要观点或必答部分还需要更具体、更充分地展开。`;
      if (/coherence/i.test(criterion)) return `${field}目前这个分数说明：文章有基本结构，但段落内部推进和句子之间的连接还不够清楚。`;
      if (/lexical/i.test(criterion)) return `${field}目前这个分数说明：意思大体清楚，但用词仍偏简单、重复，搭配还不够自然。`;
      if (/grammatical/i.test(criterion)) return `${field}目前这个分数说明：句子基本能看懂，但复杂句准确度和语法控制还需要加强。`;
      return `${field}目前处在 Band ${formatBand(band)} 左右。`;
    }
    if (kind === "whyLower") return `没有更低，是因为${field}仍然有可评分的表现，并不是完全缺失或完全无法理解。`;
    if (kind === "whyHigher") {
      if (/task response|task achievement/i.test(criterion)) return `还不能到 Band ${higherBand}，因为任务回应还需要更具体的论证、更清楚的支撑和更完整的必答部分覆盖。`;
      if (/coherence/i.test(criterion)) return `还没到 Band ${higherBand}，因为段落推进和句子衔接还需要更自然、更清楚，不能只靠基础连接词。`;
      if (/lexical/i.test(criterion)) return `还没到 Band ${higherBand}，因为词汇需要更准确的搭配、更少重复，并加入更贴合话题的表达。`;
      if (/grammatical/i.test(criterion)) return `还没到 Band ${higherBand}，因为语法需要更准确的复杂句和更稳定的基础错误控制。`;
      return `还没到 Band ${higherBand}，因为这一项还需要更强的控制力。`;
    }
    if (kind === "improve") {
      if (/task response|task achievement/i.test(criterion)) return `提升建议：把每个主要观点或 bullet point 展开清楚，加入一个具体原因或例子。`;
      if (/coherence/i.test(criterion)) return `提升建议：让每段只负责一个中心意思，并用更清楚的指代和过渡句连接上下文。`;
      if (/lexical/i.test(criterion)) return `提升建议：减少重复词，优先学习和本题相关的自然搭配，而不是硬背高级词。`;
      if (/grammatical/i.test(criterion)) return `提升建议：先保证主谓一致、动词形式和从句结构准确，再逐步增加复杂句。`;
      return `提升建议：针对这一项做更具体、更稳定的表达训练。`;
    }
    return "";
  }

  function safeCriterionPair(item, rawEnCandidates, rawZhCandidates, context, fallbackKind) {
    const lowerBand = context.lowerBand || nearestHalfBand(context.band, "lower");
    const higherBand = context.higherBand || nearestHalfBand(context.band, "higher");
    const en = firstText(...rawEnCandidates.map(cleanUserFeedbackText)) || defaultCriterionEnglish(context.criterion, context.band, fallbackKind, lowerBand, higherBand);
    const zh = firstText(...rawZhCandidates.map(cleanUserFeedbackText)) || defaultCriterionChinese(context.criterion, context.band, fallbackKind, lowerBand, higherBand);
    return { en, zh };
  }

  function bilingualTextHtml(en, zh, context = {}) {
    const english = String(en || "").trim();
    if (!hasMeaningfulContent(english) && !hasMeaningfulContent(zh)) return "";
    const chinese = hasMeaningfulContent(zh) ? String(zh).trim() : autoZhText(english, context);
    return `<div class="bilingual-feedback-pair"><p class="bilingual-en">${escapeHtml(english)}</p><p class="bilingual-zh">${escapeHtml(chinese)}</p></div>`;
  }

  function zhAt(list, index) {
    return Array.isArray(list) && hasMeaningfulContent(list[index]) ? list[index] : "";
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
    const out = direction === "lower" ? Math.max(0, n - 0.5) : Math.min(9, n + 0.5);
    return formatBand(out);
  }

  function criterionItem(result, criterion) {
    const cal = result.criterionCalibration || result.criterionExplanations || {};
    const direct = cal[criterion] || {};
    // v8.4: do not cross-map Task Achievement and Task Response.
    // Task 1 and Task 2 first criteria must remain task-specific.
    return direct && Object.keys(direct).length ? direct : {};
  }

  function criterionHasRequiredEvidence(item = {}) {
    const evidence = arr(item.essayEvidence || item.textEvidence || item.evidenceQuotes);
    const hasQuote = evidence.some((entry) => typeof entry === "string" ? hasMeaningfulContent(entry) : hasMeaningfulContent(entry?.quote || entry?.text || entry?.original));
    return hasQuote && hasMeaningfulContent(item.whyThisBand || item.summary) && hasMeaningfulContent(item.whyNotHigher || item.halfBandDecision?.whyBelowUpperBand) && hasMeaningfulContent(item.howToImprove || item.improvementFocus);
  }

  function resultHasRequiredCriterionFeedback(result = {}) {
    const criteria = result.finalCriteria || result.criteria || {};
    const names = Object.keys(criteria);
    if (!names.length) return false;
    return names.every((criterion) => criterionHasRequiredEvidence(criterionItem(result, criterion)));
  }

  function firstText(...items) {
    for (const item of items) {
      if (typeof item === "string" && item.trim()) return item.trim();
      if (Array.isArray(item) && item.filter(Boolean).length) return String(item.filter(Boolean)[0]).trim();
    }
    return "";
  }

  function cleanCalibrationText(value, fallback = "系统已完成评分边界校准。") {
    const raw = String(value || "").trim();
    if (!raw) return fallback;
    if (/reason codes|reasonCodes|"Task Response"|"Task Achievement"|"Coherence and Cohesion"|"Lexical Resource"|"Grammatical Range/i.test(raw)) return fallback;
    return raw.length > 220 ? `${raw.slice(0, 217)}...` : raw;
  }

  function simpleBoundaryStatus(result = {}) {
    const audit = result.boundaryAudit || result.boundaryReview || {};
    const review = audit.boundaryReview || {};
    const reasons = meaningfulArr(audit.reviewReasons || audit.reviewedRemainingWarnings, 3);
    const unresolved = meaningfulArr(audit.unresolvedCriticalReasons, 3);
    const blocked = Boolean(audit.freezeBlocked || unresolved.length);
    if (blocked) return { status: "needs_attention", label: "需要注意", text: unresolved.join("；") || reasons.join("；") || "边界审计发现未解决冲突。" };
    if (audit.reviewRequired || review.triggered || reasons.length) return { status: "reviewed", label: "已复核", text: reasons.join("；") || review.decision || "边界审计触发后已完成复核。" };
    return { status: "passed", label: "通过", text: "未发现低分抬高、高分压制、四项同分异常或 anchor 冲突。" };
  }

  function fallbackCriterionZhSummary(labels = {}, texts = {}) {
    const rows = [
      [labels.whyThis || "为什么是这个分", texts.whyThis],
      [labels.whyLower || "为什么高于低一档", texts.whyLower],
      [labels.whyHigher || "为什么还不到高一档", texts.whyHigher],
      ["怎么提升", texts.improve]
    ].filter(([, text]) => hasMeaningfulContent(text));
    return rows.map(([title, text]) => `${title}：${text}`).join("\n\n");
  }

  function fallbackImprove(criterion, band) {
    if (/Task Response|Task Achievement/i.test(criterion)) return "Develop each main point with a clearer reason and one specific example that directly answers the task.";
    if (/Coherence/i.test(criterion)) return "Make each paragraph develop one clear idea and improve sentence-to-sentence progression, not only basic linking words.";
    if (/Lexical/i.test(criterion)) return "Reduce spelling and word-form errors, use more accurate topic vocabulary, and avoid awkward collocations.";
    if (/Grammatical/i.test(criterion)) return "Control basic verb forms, articles, plurals, and sentence boundaries before adding more complex structures.";
    return `To move above Band ${formatBand(band)}, strengthen the limiting areas identified in this criterion.`;
  }
  function evidenceListHtml(items, zhItems = [], context = {}) {
    const list = meaningfulArr(items, 3);
    if (!list.length) return "";
    return `<ul class="compact-evidence-list bilingual-evidence-list">${list.map((x, index) => `<li>${bilingualTextHtml(x, zhAt(zhItems, index), { ...context, heading: context.heading || "证据 / Evidence" })}</li>`).join("")}</ul>`;
  }
  function essayEvidenceHtml(items) {
    const list = arr(items).filter(hasMeaningfulContent).slice(0, 4);
    if (!list.length) return "";
    return list.map((item) => {
      if (typeof item === "string") return `<div class="quote-evidence bilingual-quote-evidence"><strong>${escapeHtml(item)}</strong>${bilingualTextHtml(item, "", { heading: "原文证据 / Evidence" })}</div>`;
      const quote = item.quote || item.text || item.original || "";
      const meaning = item.meaning || item.explanation || item.evidence || "";
      const zh = item.meaningZh || item.explanationZh || item.evidenceZh || item.translationZh || "";
      if (!hasMeaningfulContent(quote) && !hasMeaningfulContent(meaning) && !hasMeaningfulContent(zh)) return "";
      return `<div class="quote-evidence bilingual-quote-evidence"><strong>${escapeHtml(quote || "原文片段")}</strong>${bilingualTextHtml(meaning || quote, zh, { heading: "原文证据 / Evidence" })}</div>`;
    }).filter(Boolean).join("");
  }


  function criterionEvidencePreviewHtml(item = {}, context = {}) {
    const rawEssayEvidence = arr(item.essayEvidence || item.textEvidence || item.evidenceQuotes).filter(hasMeaningfulContent).slice(0, 2);
    const quoteRows = rawEssayEvidence.map((entry) => {
      if (typeof entry === "string") return { quote: entry, meaning: "This is direct text evidence used for the criterion judgement.", zh: "这是用于判断该项分数的原文证据。" };
      return {
        quote: entry.quote || entry.text || entry.original || "",
        meaning: entry.meaning || entry.explanation || entry.evidence || "",
        zh: entry.meaningZh || entry.explanationZh || entry.evidenceZh || entry.translationZh || ""
      };
    }).filter((entry) => hasMeaningfulContent(entry.quote) || hasMeaningfulContent(entry.meaning));

    const support = meaningfulArr(item.positiveEvidence || item.supportingEvidence, 2).map((text, index) => ({
      label: "supports",
      en: text,
      zh: zhAt(item.positiveEvidenceZh || item.supportingEvidenceZh, index)
    }));
    const limits = meaningfulArr(item.limitingEvidence || item.limitsHigherBand, 2).map((text, index) => ({
      label: "limits",
      en: text,
      zh: zhAt(item.limitingEvidenceZh || item.limitsHigherBandZh, index)
    }));

    const chips = [...support, ...limits].slice(0, 3).map((entry) => `<div class="criterion-evidence-chip ${escapeHtml(entry.label)}"><span>${entry.label === "supports" ? "支持" : "限制"}</span>${bilingualTextHtml(entry.en, entry.zh, { ...context, heading: "visible evidence" })}</div>`).join("");
    const quotes = quoteRows.slice(0, 2).map((entry) => `<div class="criterion-evidence-quote"><strong>“${escapeHtml(entry.quote || "原文片段")}”</strong>${bilingualTextHtml(entry.meaning || entry.quote, entry.zh, { ...context, heading: "essay quote evidence" })}</div>`).join("");

    if (!chips && !quotes) return "";
    return `<div class="criterion-visible-evidence"><h5>本项证据 / Evidence used</h5>${quotes ? `<div class="criterion-evidence-quotes">${quotes}</div>` : ""}${chips ? `<div class="criterion-evidence-chips">${chips}</div>` : ""}</div>`;
  }

  function syncCriterionGridLayout(scope = els.gradingResults) {
    const root = scope || els.gradingResults || document;
    root.querySelectorAll(".criterion-card-grid").forEach((grid) => {
      const hasExpanded = Boolean(grid.querySelector(".criterion-score-card.is-expanded"));
      grid.classList.toggle("has-expanded-criterion", hasExpanded);
    });
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
      const expandAllCriteria = event.target.closest("[data-criterion-expand-all]");
      if (expandAllCriteria) {
        els.gradingResults.querySelectorAll("[data-criterion-toggle]").forEach((btn) => {
          const target = document.getElementById(btn.dataset.criterionToggle);
          const card = btn.closest(".criterion-score-card");
          if (target) target.classList.remove("hidden");
          if (card) {
            card.classList.remove("is-collapsed");
            card.classList.add("is-expanded");
          }
          btn.textContent = "-";
        });
        syncCriterionGridLayout();
      }
      const collapseAllCriteria = event.target.closest("[data-criterion-collapse-all]");
      if (collapseAllCriteria) {
        els.gradingResults.querySelectorAll("[data-criterion-toggle]").forEach((btn) => {
          const target = document.getElementById(btn.dataset.criterionToggle);
          const card = btn.closest(".criterion-score-card");
          if (target) target.classList.add("hidden");
          if (card) {
            card.classList.add("is-collapsed");
            card.classList.remove("is-expanded");
          }
          btn.textContent = "+";
        });
        syncCriterionGridLayout();
      }
      const cardToggle = event.target.closest("[data-criterion-toggle]");
      if (cardToggle) {
        const target = document.getElementById(cardToggle.dataset.criterionToggle);
        if (target) {
          const hidden = target.classList.toggle("hidden");
          const card = cardToggle.closest(".criterion-score-card");
          if (card) {
            card.classList.toggle("is-collapsed", hidden);
            card.classList.toggle("is-expanded", !hidden);
          }
          cardToggle.textContent = hidden ? "+" : "-";
          syncCriterionGridLayout(card || els.gradingResults);
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
      const learningTab = event.target.closest("[data-learning-feedback-tab]");
      if (learningTab) {
        activeLearningFeedbackModule = learningTab.dataset.learningFeedbackTab;
        renderLearningFeedbackPanel();
      }
      const learningGenerate = event.target.closest("[data-learning-feedback-generate]");
      if (learningGenerate) {
        generateLearningFeedback(learningGenerate.dataset.learningFeedbackGenerate);
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
    const rawReason = firstText(anchor.whyCloserToThisBand, anchor.closestAnchorProfile, result.examinerSummary);
    const reason = cleanCalibrationText(rawReason, "系统根据任务回应、结构、词汇和语法控制完成分段锚点判断。");
    return `<div class="anchor-comparison-block compact-calibration-card">
      <div class="score-gate-item anchor-comparison-card">
        <strong>Anchor / 分段锚点：</strong>Band ${escapeHtml(band)}
        <span class="score-chip-inline">候选区间：${escapeHtml(range)}</span>
        <p class="muted">${escapeHtml(reason)}</p>
      </div>
    </div>`;
  }
  function renderBoundaryAudit(result = {}) {
    const summary = simpleBoundaryStatus(result);
    return `<div class="boundary-audit-block compact-calibration-card">
      <div class="score-gate-item boundary-audit-summary ${escapeHtml(summary.status)}">
        <strong>边界审计 / Boundary audit：</strong>${escapeHtml(summary.label)}
        <p class="muted">${escapeHtml(cleanCalibrationText(summary.text, "边界审计已完成。"))}</p>
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
    const anchor = result.anchorComparison || result.anchorCalibration || {};
    const anchorBand = anchor.closestAnchorBand ?? result.overallBand ?? result.scoreCalculation?.finalBand ?? "-";
    const anchorRange = anchor.candidateRange || (Number.isFinite(Number(anchorBand)) ? `${nearestHalfBand(anchorBand, "lower")}–${nearestHalfBand(anchorBand, "higher")}` : "-");
    const boundary = simpleBoundaryStatus(result);
    const gates = [
      ["Low-band check", profile.lowBandGate],
      ["Mid-band check", profile.midBandGate],
      ["High-band check", profile.highBandGate],
      ["Score-profile check", profile.scoreProfileGate]
    ].filter(([, gate]) => gate && !isPassedLikeStatus(gate.status || gate.result || gate.triggered));
    const userSummary = `<div class="calibration-user-summary">
      <div class="calibration-summary-grid">
        <div class="calibration-summary-card"><strong>评分版本</strong>${escapeHtml(result.scoreSystemVersion || "clean-score-core")}</div>
        <div class="calibration-summary-card"><strong>文本信号</strong>${escapeHtml(signals.wordCount ?? "-")} words ｜ ${escapeHtml(signals.paragraphCount ?? "-")} 段 ｜ ${escapeHtml(signals.sentenceCount ?? "-")} 句</div>
        <div class="calibration-summary-card"><strong>可评分性</strong>${escapeHtml(signals.rateabilityStatus || "未返回")}</div>
        <div class="calibration-summary-card"><strong>边界审计</strong>${escapeHtml(boundary.label)}：${escapeHtml(cleanCalibrationText(boundary.text, "边界审计已完成。"))}</div>
        <div class="calibration-summary-card"><strong>Anchor / 分段锚点</strong>Band ${escapeHtml(anchorBand)} ｜ 候选区间 ${escapeHtml(anchorRange)}</div>
        <div class="calibration-summary-card"><strong>语言信号</strong>拼写 ${escapeHtml(signals.spellingErrorDensity || "-")} ｜ 语法 ${escapeHtml(signals.grammarErrorDensity || "-")} ｜ 句子 ${escapeHtml(signals.sentenceControl || "-")}</div>
      </div>
      ${warnings.length ? `<div class="ai-warning"><strong>稳定性提醒：</strong>${listHtml(warnings)}</div>` : ""}
      <p class="muted">这里保留用户需要理解的校准摘要；开发调试信息已折叠，避免页面被技术细节占满。</p>
    </div>`;
    const devGateHtml = gates.length ? `<div class="score-gate-grid">${gates.map(([label, gate]) => {
      const reason = cleanCalibrationText(firstText(gate?.reason, gate?.explanation, gate?.note), "Gate requires attention.");
      const zh = firstText(gate?.reasonZh, gate?.explanationZh, gate?.noteZh) || gateChineseExplanation(label, gate);
      return `<div class="score-gate-item"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(gate?.status || gate?.result || gate?.triggered || "triggered")}<br><span class="muted">${escapeHtml(reason)}</span>${translationButton(zh)}</div>`;
    }).join("")}</div>` : `<div class="score-gate-item"><strong>Low / Mid / High / Score-profile checks:</strong> passed<br><span class="muted">所有核心分数边界检查均通过。</span></div>`;
    const devDetails = `<details class="calibration-dev-details"><summary>开发调试信息 / Developer diagnostics</summary><div class="calibration-dev-body">
      ${renderBoundaryAudit(result)}
      ${renderAnchorComparison(result)}
      ${renderTaskSpecificGateReport(result)}
      ${hasMeaningfulContent(result.examinerSummary) ? `<div class="score-gate-item"><strong>Examiner summary:</strong> ${escapeHtml(cleanCalibrationText(result.examinerSummary, "Core score kernel completed."))}${translationButton(result.examinerSummaryZh || "")}</div>` : ""}
      ${devGateHtml}
    </div></details>`;
    return renderScoreAccordion("评分校准摘要 / Score Calibration Summary", `${userSummary}${devDetails}`, false, "score-calibration-report compact-calibration-report");
  }
  function renderFeedbackStatusNotice(result = {}) {
    const status = result.feedbackStatus || result.scoreCoreMeta?.feedbackStatus;
    const statusValue = typeof status === "string" ? status : status?.status;
    if (!statusValue) return "";
    if (/generated_required_external|generated/i.test(statusValue)) {
      return `<div class="score-flow-note feedback-status-note"><strong>详细反馈：</strong>${escapeHtml(status?.note || "四项详细反馈已在分数冻结后逐项生成，不会改变分数。")}</div>`;
    }
    if (/required_external|generating_required/i.test(statusValue)) {
      return `<div class="score-flow-note feedback-status-note"><strong>详细反馈：</strong>核心分数已冻结；四项详细反馈将通过独立接口逐项生成，生成完成后才显示完整卡片。</div>`;
    }
    if (/failed/i.test(statusValue)) {
      return `<div class="ai-warning feedback-status-warning"><strong>详细反馈生成失败：</strong>核心评分已经冻结，分数不受影响；但本版本不会用模板内容冒充详细反馈。${escapeHtml(status?.note || status?.error || "请重新生成评分，或稍后再试。")}</div>`;
    }
    if (/quality/i.test(statusValue)) {
      return `<div class="ai-warning feedback-status-warning"><strong>反馈质量提醒：</strong>核心评分已经冻结；部分四项解释可能仍偏模板化。${escapeHtml(arr(status?.qualityIssues).join(" | "))}</div>`;
    }
    return `<div class="score-flow-note feedback-status-note"><strong>详细反馈：</strong>${escapeHtml(status?.note || "四项详细反馈已生成，不会改变分数。")}</div>`;
  }

  function compactCriterionPreviewText(text, max = 170) {
    const raw = cleanUserFeedbackText(text);
    if (!raw) return "";
    const normalized = raw.replace(/\s+/g, " ").trim();
    const firstSentence = normalized.match(/^.{35,}?[.!?。！？](\s|$)/);
    const candidate = firstSentence ? firstSentence[0].trim() : normalized;
    if (candidate.length <= max) return candidate;
    return `${candidate.slice(0, max).replace(/\s+\S*$/, "")}...`;
  }

  function criterionPreviewHtml(pair, fallbackPair, context = {}) {
    const en = compactCriterionPreviewText(pair?.en || fallbackPair?.en || "");
    const zh = compactCriterionPreviewText(pair?.zh || fallbackPair?.zh || "");
    if (!hasMeaningfulContent(en) && !hasMeaningfulContent(zh)) return "";
    return `<div class="criterion-card-preview" aria-label="该项简要说明">
      ${hasMeaningfulContent(en) ? `<div class="criterion-preview-line"><strong>简要：</strong>${escapeHtml(en)}</div>` : ""}
      ${hasMeaningfulContent(zh) ? `<div class="criterion-preview-zh">${escapeHtml(zh)}</div>` : ""}
    </div>`;
  }


  function renderCriterionDifferentiationReview(result = {}) {
    const review = result.criterionDifferentiationReview || result.boundaryAudit?.criterionDifferentiationReview || result.scoreCoreMeta?.criterionDifferentiationReview || null;
    if (!review || typeof review !== "object") return "";
    const triggered = review.triggered === true || /revised|kept_identical|error|failed/i.test(String(review.decision || ""));
    if (!triggered) return "";
    const firstCriteria = review.firstCriteria && typeof review.firstCriteria === "object" ? review.firstCriteria : {};
    const finalCriteria = review.finalCriteria && typeof review.finalCriteria === "object" ? review.finalCriteria : (result.finalCriteria || result.criteria || {});
    const names = Object.keys(finalCriteria || {}).length ? Object.keys(finalCriteria) : Object.keys(firstCriteria || {});
    const changed = new Set(Array.isArray(review.changedCriteria) ? review.changedCriteria.map(String) : []);
    names.forEach((name) => {
      if (Number(firstCriteria?.[name]) !== Number(finalCriteria?.[name]) && Number.isFinite(Number(firstCriteria?.[name])) && Number.isFinite(Number(finalCriteria?.[name]))) changed.add(name);
    });
    const decision = String(review.decision || (changed.size ? "revised" : "kept_identical_with_evidence"));
    const badgeClass = changed.size ? "revised" : "kept";
    const badgeText = changed.size ? `AI adjusted ${changed.size} criterion${changed.size > 1 ? "s" : ""}` : "AI kept same bands";
    const sameJustified = review.sameBandsJustified === true;
    const subtitle = changed.size
      ? "四项同分触发了 AI-only 复核；AI 重新按四项证据检查后调整了部分 criterion。"
      : "四项同分触发了 AI-only 复核；AI 重新检查后认为四项同分有证据支持。";
    const beforeRows = names.map((name) => `<div class="criterion-diff-row ${changed.has(name) ? "is-changed" : ""}"><span>${escapeHtml(name)}</span><strong>${Number.isFinite(Number(firstCriteria?.[name])) ? `Band ${escapeHtml(formatBand(firstCriteria[name]))}` : "-"}</strong></div>`).join("");
    const afterRows = names.map((name) => `<div class="criterion-diff-row ${changed.has(name) ? "is-changed" : ""}"><span>${escapeHtml(name)}</span><strong>${Number.isFinite(Number(finalCriteria?.[name])) ? `Band ${escapeHtml(formatBand(finalCriteria[name]))}` : "-"}</strong></div>`).join("");
    const evidenceObj = review.criterionEvidence && typeof review.criterionEvidence === "object" ? review.criterionEvidence : {};
    const evidenceRows = names.map((name) => {
      const evidence = evidenceObj[name] || evidenceObj[name.replace(/\s+/g, "_")] || evidenceObj[name.toLowerCase()] || "AI reviewed this criterion separately against the band matrix.";
      return `<div class="criterion-diff-evidence-item"><strong>${escapeHtml(name)}</strong>${escapeHtml(String(evidence))}</div>`;
    }).join("");
    const whyCopy = review.whyNotMechanicalCopy ? `<div class="criterion-diff-note"><strong>Why this is not mechanical copy / 为什么不是机械复制：</strong>${escapeHtml(review.whyNotMechanicalCopy)}</div>` : "";
    const whyBalanced = review.whyFinalProfileIsBalanced ? `<div class="criterion-diff-note"><strong>Final profile / 最终四项组合：</strong>${escapeHtml(review.whyFinalProfileIsBalanced)}</div>` : "";
    const error = review.error ? `<div class="ai-warning feedback-status-warning"><strong>四项复核失败：</strong>${escapeHtml(review.error)}。分数没有被本地改写，保留上一轮 AI 分数。</div>` : "";
    return `<section class="criterion-diff-review-card" aria-label="Criterion differentiation review">
      <div class="criterion-diff-review-head">
        <div>
          <h4 class="criterion-diff-review-title">四项分复核 / Criterion Differentiation Review</h4>
          <p class="criterion-diff-review-subtitle">${escapeHtml(subtitle)}</p>
        </div>
        <span class="criterion-diff-badge ${escapeHtml(badgeClass)}">${escapeHtml(badgeText)}</span>
      </div>
      <div class="criterion-diff-grid">
        <div class="criterion-diff-panel"><h5>复核前 / Before review</h5>${beforeRows || "<p class='muted'>No before-profile returned.</p>"}</div>
        <div class="criterion-diff-panel"><h5>复核后 / After review</h5>${afterRows || "<p class='muted'>No final-profile returned.</p>"}</div>
      </div>
      <div class="criterion-diff-panel" style="margin-top:12px"><h5>四项独立证据 / Criterion-specific evidence</h5><div class="criterion-diff-evidence">${evidenceRows}</div></div>
      ${whyCopy}
      ${whyBalanced}
      ${sameJustified && !changed.size ? `<div class="criterion-diff-note"><strong>结论：</strong>AI 认为四项同分是合理的，不是简单复制 Overall。</div>` : ""}
      ${error}
      <div class="criterion-diff-note"><strong>Decision:</strong> ${escapeHtml(decision)} ｜ <strong>本地是否改分：</strong>否。这里只显示 AI 复核结果。</div>
    </section>`;
  }

  function renderCriterionCards(result = {}) {
    const criteria = result.finalCriteria || result.criteria || {};
    const entries = Object.entries(criteria);
    if (!entries.length) return `<section class="grading-section"><p class="muted">AI 没有返回完整四项分。</p></section>`;
    const feedbackFailed = /failed/i.test(String(result.feedbackStatus?.status || result.scoreCoreMeta?.feedbackStatus?.status || ""));
    if (feedbackFailed && !resultHasRequiredCriterionFeedback(result)) {
      return `<section class="criterion-card-grid" aria-label="四项分数"><div class="ai-warning feedback-status-warning" style="grid-column:1/-1"><strong>详细反馈没有生成完成。</strong>核心分数已冻结，但系统不会显示模板化解释。请重新评分或稍后再试。</div>${entries.map(([criterion, band]) => `<article class="criterion-score-card refined-criterion-card"><div class="criterion-card-header"><div class="criterion-title">${escapeHtml(criterion)}</div><div class="criterion-band-pill">Band ${escapeHtml(formatBand(band))}</div></div></article>`).join("")}</section>`;
    }
    const impossibleZeroWarning = entries.some(([, band]) => Number(band) === 0) && !/hard-zero|skipped_hard_zero|not_rateable/i.test(JSON.stringify(result.scoreCoreMeta || {}) + JSON.stringify(result.feedbackStatus || {}) + JSON.stringify(result.localSignals?.hardZeroGate || {}))
      ? `<div class="ai-warning feedback-status-warning"><strong>评分异常：</strong>系统收到 Band 0，但该回答可能并非空白/非英文/明确放弃作答。请重新评分；新版后端会阻止这种假 0 分冻结。</div>`
      : "";
    return `${impossibleZeroWarning}<section class="criterion-card-grid" aria-label="四项评分说明">
      <div class="criterion-compact-toolbar">
        <button type="button" data-criterion-expand-all>全部展开</button>
        <button type="button" data-criterion-collapse-all>全部收起</button>
      </div>
      ${entries.map(([criterion, band], index) => {
        const item = criterionItem(result, criterion);
        const half = item.halfBandDecision || {};
        const cardId = `criterionCard_${index}_${Math.random().toString(36).slice(2, 8)}`;
        const detailId = `criterionDetail_${index}_${Math.random().toString(36).slice(2, 8)}`;
        const lowerBand = nearestHalfBand(band, "lower");
        const higherBand = nearestHalfBand(band, "higher");
        const whyThisPair = safeCriterionPair(item, [item.whyThisBand, item.summary, half.whyExactBand, item.positiveEvidence], [item.whyThisBandZh, item.summaryZh, half.whyExactBandZh, item.positiveEvidenceZh], { criterion, band, lowerBand, higherBand }, "whyThis");
        const whyLowerPair = safeCriterionPair(item, [item.whyNotLower, item.whyAboveLowerBand, half.whyAboveLowerBand], [item.whyNotLowerZh, item.whyAboveLowerBandZh, half.whyAboveLowerBandZh], { criterion, band, lowerBand, higherBand }, "whyLower");
        const whyHigherPair = safeCriterionPair(item, [item.whyNotHigher, item.whyNotYetHigherBand, half.whyBelowUpperBand], [item.whyNotHigherZh, item.whyNotYetHigherBandZh, half.whyBelowUpperBandZh], { criterion, band, lowerBand, higherBand }, "whyHigher");
        const improvePair = safeCriterionPair(item, [item.howToImprove, item.improvementFocus], [item.howToImproveZh, item.improvementFocusZh], { criterion, band, lowerBand, higherBand }, "improve");
        const whyThis = whyThisPair.en;
        const whyLower = whyLowerPair.en;
        const whyHigher = whyHigherPair.en;
        const improve = improvePair.en;
        const previewHtml = criterionPreviewHtml(whyThisPair, improvePair, { criterion, band });
        const lowerLabel = Number(band) <= 0 ? "为什么系统认为不是空白/完全跑题" : `为什么没有更低到 Band ${lowerBand}`;
        const higherLabel = Number(band) >= 9 ? "为什么已经接近满分" : (Number(band) <= 0 ? "为什么不能显示为 Band 0.5+" : `为什么还不能到 Band ${higherBand}`);
        const zh = criterionZhSummary(item, {
          whyThis: `为什么是 Band ${formatBand(band)}`,
          whyLower: lowerLabel,
          whyHigher: higherLabel
        });
        const supportHtml = evidenceListHtml(item.positiveEvidence || item.supportingEvidence, item.positiveEvidenceZh || item.supportingEvidenceZh, { criterion, band, heading: "支持这个分数的证据" });
        const limitHtml = evidenceListHtml(item.limitingEvidence || item.limitsHigherBand, item.limitingEvidenceZh || item.limitsHigherBandZh, { criterion, band, heading: "限制更高分的证据" });
        const essayHtml = essayEvidenceHtml(item.essayEvidence || item.textEvidence || item.evidenceQuotes);
        const evidencePreviewHtml = criterionEvidencePreviewHtml(item, { criterion, band });
        const halfHasContent = hasMeaningfulContent(half.whyAboveLowerBand || half.whyBelowUpperBand || half.whyExactBand || item.candidateBandsConsidered);
        const detailSections = [
          supportHtml ? `<div class="evidence-box"><h5>支持这个分数的证据</h5>${supportHtml}</div>` : "",
          limitHtml ? `<div class="evidence-box"><h5>限制更高分的证据</h5>${limitHtml}</div>` : "",
          essayHtml ? `<div class="evidence-box"><h5>原文证据 / Evidence from the essay</h5>${essayHtml}</div>` : "",
          halfHasContent ? `<div class="evidence-box"><h5>完整半分判断</h5>
            <p><strong>Candidate bands / 候选分数:</strong> ${escapeHtml(meaningfulArr(item.candidateBandsConsidered).join(" / ") || `${lowerBand} / ${formatBand(band)} / ${higherBand}`)}</p>
            ${hasMeaningfulContent(half.whyAboveLowerBand || whyLower) ? `<div class="halfband-bilingual"><strong>Why above lower band / 为什么高于低一档</strong>${bilingualTextHtml(cleanUserFeedbackText(half.whyAboveLowerBand) || whyLowerPair.en, cleanUserFeedbackText(half.whyAboveLowerBandZh) || whyLowerPair.zh, { criterion, band, heading: "why above lower band" })}</div>` : ""}
            ${hasMeaningfulContent(half.whyBelowUpperBand || whyHigher) ? `<div class="halfband-bilingual"><strong>Why below higher band / 为什么还不到高一档</strong>${bilingualTextHtml(cleanUserFeedbackText(half.whyBelowUpperBand) || whyHigherPair.en, cleanUserFeedbackText(half.whyBelowUpperBandZh) || whyHigherPair.zh, { criterion, band, heading: "why below higher band" })}</div>` : ""}
            ${hasMeaningfulContent(half.whyExactBand || whyThis) ? `<div class="halfband-bilingual"><strong>Why exact band / 为什么是这个准确分数</strong>${bilingualTextHtml(cleanUserFeedbackText(half.whyExactBand) || whyThisPair.en, cleanUserFeedbackText(half.whyExactBandZh) || whyThisPair.zh, { criterion, band, heading: "why exact band" })}</div>` : ""}
          </div>` : ""
        ].filter(Boolean);
        const detailCard = !feedbackFailed && detailSections.length ? `<div class="score-detail-card compact-evidence-details">
          <button class="score-detail-toggle" type="button" data-score-detail-toggle="${detailId}"><span>详细证据 / Evidence details</span><span>+</span></button>
          <div id="${detailId}" class="score-detail-body hidden"><div class="evidence-grid">${detailSections.join("")}</div></div>
        </div>` : "";
        return `<article class="criterion-score-card refined-criterion-card is-collapsed">
          <div class="criterion-card-header">
            <div class="criterion-title">${escapeHtml(criterion)}</div>
            <div class="criterion-band-pill">Band ${escapeHtml(formatBand(band))}</div>
            <button class="criterion-toggle" type="button" data-criterion-toggle="${cardId}" aria-label="展开或收起 ${escapeHtml(criterion)}">+</button>
          </div>
          ${previewHtml}
          <div class="criterion-card-body hidden" id="${cardId}">
            <div class="criterion-quick-grid bilingual-criterion-grid">
              <div class="criterion-quick-row"><h5>为什么是 Band ${escapeHtml(formatBand(band))}</h5>${bilingualTextHtml(whyThisPair.en, whyThisPair.zh, { criterion, band, heading: "为什么是这个分" })}</div>
              <div class="criterion-quick-row"><h5>${escapeHtml(lowerLabel)}</h5>${bilingualTextHtml(whyLowerPair.en, whyLowerPair.zh, { criterion, band, heading: "为什么没有更低" })}</div>
              <div class="criterion-quick-row"><h5>${escapeHtml(higherLabel)}</h5>${bilingualTextHtml(whyHigherPair.en, whyHigherPair.zh, { criterion, band, heading: "为什么还不能更高" })}</div>
              <div class="criterion-quick-row"><h5>下一步怎么提 0.5</h5>${bilingualTextHtml(improvePair.en, improvePair.zh, { criterion, band, heading: "怎么提升" })}</div>
            </div>
            ${evidencePreviewHtml}
            ${hasMeaningfulContent(zh) ? `<details class="criterion-zh-summary"><summary>整项中文总结</summary><div>${escapeHtml(zh)}</div></details>` : ""}
            ${feedbackFailed ? "" : ""}
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


  function feedbackEndpointFromGradingEndpoint() {
    const raw = String(els.gradingEndpointInput?.value || "").trim();
    if (!raw) return "/api/writing-feedback";
    try {
      const url = new URL(raw, window.location.origin);
      url.pathname = url.pathname.replace(/\/api\/grade-ielts\/?$/i, "/api/writing-feedback");
      if (!/\/api\/writing-feedback\/?$/i.test(url.pathname)) url.pathname = "/api/writing-feedback";
      return url.toString();
    } catch {
      return "/api/writing-feedback";
    }
  }

  function essayGeneratorEndpointFromGradingEndpoint() {
    const raw = String(els.gradingEndpointInput?.value || "").trim();
    if (!raw) return "/api/essay-generator";
    try {
      const url = new URL(raw, window.location.origin);
      url.pathname = url.pathname.replace(/\/api\/grade-ielts\/?$/i, "/api/essay-generator");
      url.pathname = url.pathname.replace(/\/api\/writing-feedback\/?$/i, "/api/essay-generator");
      if (!/\/api\/essay-generator\/?$/i.test(url.pathname)) url.pathname = "/api/essay-generator";
      return url.toString();
    } catch {
      return "/api/essay-generator";
    }
  }

  function criterionFeedbackEndpointFromGradingEndpoint() {
    const raw = String(els.gradingEndpointInput?.value || "").trim();
    if (!raw) return "/api/criterion-feedback";
    try {
      const url = new URL(raw, window.location.origin);
      url.pathname = url.pathname.replace(/\/api\/grade-ielts\/?$/i, "/api/criterion-feedback");
      url.pathname = url.pathname.replace(/\/api\/writing-feedback\/?$/i, "/api/criterion-feedback");
      url.pathname = url.pathname.replace(/\/api\/essay-generator\/?$/i, "/api/criterion-feedback");
      if (!/\/api\/criterion-feedback\/?$/i.test(url.pathname)) url.pathname = "/api/criterion-feedback";
      return url.toString();
    } catch {
      return "/api/criterion-feedback";
    }
  }

  function criteriaForScoreResult(result = {}) {
    const criteria = result.finalCriteria || result.criteria || {};
    const keys = Object.keys(criteria);
    if (keys.length) return keys;
    const task = taskOfScoreResult(result) || lockedTaskForSelected();
    return task === "Task 1"
      ? ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
      : ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  }

  function mergeCriterionFeedback(base = {}, feedback = {}) {
    const mergedCalibration = { ...(base.criterionCalibration || {}) };
    Object.assign(mergedCalibration, feedback.criterionCalibration || {});
    return {
      ...base,
      criterionCalibration: mergedCalibration,
      feedbackStatus: feedback.feedbackStatus || base.feedbackStatus,
      scoreCoreMeta: {
        ...(base.scoreCoreMeta || {}),
        feedbackRequiredExternal: true,
        feedbackGenerated: true,
        feedbackStatus: feedback.feedbackStatus?.status || "generated_required_external"
      }
    };
  }

  async function generateRequiredCriterionFeedback(coreResult = {}) {
    const endpoint = criterionFeedbackEndpointFromGradingEndpoint();
    const criteria = coreResult.finalCriteria || coreResult.criteria || {};
    const criterionNames = criteriaForScoreResult(coreResult);
    let merged = {
      ...coreResult,
      criterionCalibration: {},
      feedbackStatus: {
        status: "generating_required_external",
        scoreChanged: false,
        note: "Core score is frozen. Required detailed criterion feedback is being generated criterion by criterion."
      }
    };

    for (let i = 0; i < criterionNames.length; i += 1) {
      const criterion = criterionNames[i];
      const band = Number(criteria[criterion]);
      setGradingStatus(`详细反馈 ${i + 1}/${criterionNames.length}：正在生成 ${criterion}...`, "loading");
      if (els.gradeBtn) els.gradeBtn.textContent = `反馈 ${i + 1}/${criterionNames.length}...`;
      updateScoringProgress(5, "running", `详细反馈 ${i + 1}/${criterionNames.length}：正在生成 ${criterion}。`);
      refreshScoringSkeleton();
      let lastError = null;
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        try {
          const data = await postStage(endpoint, gradingPayload({
            mode: "criterion_feedback",
            aiStage: "required-criterion-feedback",
            criterion,
            criterionName: criterion,
            criterionBand: band,
            currentResult: coreResult,
            frozenScore: {
              ...coreResult,
              criteria: coreResult.finalCriteria || coreResult.criteria || {},
              finalCriteria: coreResult.finalCriteria || coreResult.criteria || {}
            }
          }));
          if (!data.ok || !data.criterionCalibration?.[criterion]) throw new Error(data.detail || data.error || `${criterion} detailed feedback missing.`);
          merged = mergeCriterionFeedback(merged, data);
          updateScoringProgress(5, "running", `详细反馈 ${i + 1}/${criterionNames.length}：${criterion} 已完成。`);
          refreshScoringSkeleton();
          lastError = null;
          break;
        } catch (error) {
          lastError = error;
          setGradingStatus(`${criterion} 详细反馈第 ${attempt} 次生成失败，正在重试...`, "loading");
          updateScoringProgress(5, "running", `${criterion} 详细反馈第 ${attempt} 次生成失败，正在重试。`);
          refreshScoringSkeleton();
        }
      }
      if (lastError) {
        throw new Error(`${criterion} 详细反馈生成失败：${lastError.message || lastError}`);
      }
    }

    updateScoringProgress(5, "done", "四项详细反馈已全部生成完成。");
    refreshScoringSkeleton();

    return {
      ...merged,
      feedbackStatus: {
        status: "generated_required_external",
        scoreChanged: false,
        note: "四项详细反馈已逐项生成。核心分数已经先冻结，详细反馈没有改变分数。"
      },
      scoreCoreMeta: {
        ...(merged.scoreCoreMeta || {}),
        feedbackRequiredExternal: true,
        feedbackGenerated: true,
        feedbackStatus: "generated_required_external"
      }
    };
  }

  function frozenScoreForFeedback() {
    if (!latestScoreResult) return null;
    return {
      overall: latestScoreResult.overallBand || latestScoreResult.overall || latestScoreResult.scoreCalculation?.finalBand || null,
      criteria: latestScoreResult.finalCriteria || latestScoreResult.criteria || latestScoreResult.criterionScores || null,
      scoreSystemVersion: latestScoreResult.scoreSystemVersion || latestScoreResult.rawVersion || ""
    };
  }

  function feedbackPayload(moduleName) {
    const essay = String(els.essayInput?.value || "").trim();
    const lockedTask = lockedTaskForSelected();
    return {
      module: moduleName,
      ...lockedTaskFields(lockedTask),
      promptId: selected?.id || "",
      title: selected?.title || "",
      letterStyle: selected?.letterStyle || "",
      questionType: selected?.type || "",
      prompt: selected?.prompt || "",
      questionPrompt: selected?.prompt || "",
      promptText: selected?.prompt || "",
      task1BulletPoints: lockedTask === "Task 1" ? extractBulletPointsFromPrompt(selected?.prompt) : [],
      task2QuestionProfile: lockedTask === "Task 2" ? buildTask2QuestionProfile(selected?.prompt) : null,
      essay,
      wordCount: countWords(essay),
      frozenScore: frozenScoreForFeedback(),
      currentResult: safeCurrentResultForTask(lockedTask)
    };
  }

  function missingChineseNoteHtml() {
    return `<p class="learning-value-note">AI 未返回中文解释，请重新生成该模块。</p>`;
  }

  function firstMeaningfulValue(...values) {
    for (const value of values) {
      if (hasMeaningfulContent(value)) return value;
    }
    return "";
  }

  function bilingualObject(en, zh = "") {
    return { en: en || "", zh: zh || "" };
  }

  function pairHtml(pair) {
    if (!hasMeaningfulContent(pair)) return "";
    if (typeof pair === "string") {
      return `<div class="learning-bilingual-block"><p class="learning-en">${escapeHtml(pair)}</p>${missingChineseNoteHtml()}</div>`;
    }
    const en = pair.en || pair.english || pair.text || pair.label || pair.value || "";
    const zh = pair.zh || pair.chinese || pair.meaningZh || pair.explanationZh || pair.reasonZh || pair.suggestionZh || pair.translationZh || "";
    if (!hasMeaningfulContent(en) && !hasMeaningfulContent(zh)) return "";
    return `<div class="learning-bilingual-block">${hasMeaningfulContent(zh) ? `<p class="learning-zh">${escapeHtml(zh)}</p>` : ""}${hasMeaningfulContent(en) ? `<p class="learning-en">${escapeHtml(en)}</p>` : ""}${!hasMeaningfulContent(zh) && hasMeaningfulContent(en) ? missingChineseNoteHtml() : ""}</div>`;
  }

  function learningText(value) {
    if (value == null) return "";
    if (typeof value === "string" || typeof value === "number") return String(value).trim();
    if (typeof value === "object") return String(value.zh || value.chinese || value.en || value.english || value.text || value.value || "").trim();
    return "";
  }

  function learningArray(value, limit = 12) {
    if (Array.isArray(value)) return value.filter(hasMeaningfulContent).slice(0, limit);
    if (hasMeaningfulContent(value)) return [value].slice(0, limit);
    return [];
  }

  function pickZhFromItem(item, keys = []) {
    if (!item || typeof item !== "object") return "";
    for (const key of keys) {
      const value = key.split(".").reduce((obj, part) => (obj && obj[part] != null ? obj[part] : undefined), item);
      if (hasMeaningfulContent(value)) return value;
    }
    return "";
  }

  function simpleValueHtml(label, value, cls = "", zhValue = "") {
    if (!hasMeaningfulContent(value) && !hasMeaningfulContent(zhValue)) return "";
    let en = value;
    let zh = zhValue;
    if (value && typeof value === "object") {
      en = value.en || value.english || value.text || value.value || "";
      zh = value.zh || value.chinese || value.meaningZh || value.translationZh || value.translation || value.chineseMeaning || zhValue || "";
    }
    const shouldShowZh = hasMeaningfulContent(en) || hasMeaningfulContent(zh);
    return `<div class="learning-value ${escapeHtml(cls)}"><strong>${escapeHtml(label)}</strong>${hasMeaningfulContent(zh) ? `<p class="learning-value-zh">${escapeHtml(zh)}</p>` : ""}${hasMeaningfulContent(en) ? `<p class="learning-value-en">${escapeHtml(en)}</p>` : ""}${shouldShowZh && !hasMeaningfulContent(zh) ? missingChineseNoteHtml() : ""}</div>`;
  }

  function tagListHtml(tags) {
    const list = learningArray(tags, 8);
    if (!list.length) return "";
    return `<div class="learning-tag-row">${list.map((tag) => {
      if (typeof tag === "string") return `<span class="learning-error-tag">${escapeHtml(tag)}</span>`;
      const en = tag.en || tag.english || tag.type || "";
      const zh = tag.zh || tag.chinese || tag.label || "";
      return `<span class="learning-error-tag">${escapeHtml(zh || en)}${en && zh ? ` / ${escapeHtml(en)}` : ""}</span>`;
    }).join("")}</div>`;
  }

  function learningListHtml(title, items, limit = 8) {
    const list = learningArray(items, limit);
    if (!list.length) return "";
    return `<div class="learning-card-list"><h4>${escapeHtml(title)}</h4>${list.map((item) => {
      if (typeof item === "string") return `<article class="learning-card">${escapeHtml(item)}</article>`;
      const titleText = item.title || item.problem || item.focus || item.point || item.type || item.label || "";
      const issueZh = firstMeaningfulValue(item.problemZh, item.issueZh, item.focusZh, item.pointZh, item.summaryZh, item.requirementZh, item.statusZh);
      const evidenceZh = firstMeaningfulValue(item.evidenceZh, item.originalZh, item.exampleZh, item.fromEssayZh, item.advice?.zh, item.explanationZh, item.reasonZh);
      const whyZh = firstMeaningfulValue(item.whyMattersZh, item.reasonZh, item.whyZh, item.explanationZh, item.advice?.zh);
      const nextZh = firstMeaningfulValue(item.nextActionZh, item.actionZh, item.checkMethodZh, item.suggestionZh, item.advice?.zh);
      const parts = [
        titleText ? `<div class="learning-card-title">${escapeHtml(learningText(titleText))}</div>` : "",
        pairHtml(bilingualObject(item.problem || item.issue || item.focus || item.point || item.summary || item.requirement || item.status, issueZh)),
        simpleValueHtml("原文证据 / Evidence", item.evidence || item.original || item.fromEssay || item.example, "", evidenceZh),
        pairHtml(bilingualObject(item.whyMatters || item.reason || item.why || item.explanation, whyZh)),
        pairHtml(bilingualObject(item.nextAction || item.action || item.checkMethod || item.suggestion || item.advice?.en, nextZh))
      ].filter(Boolean).join("");
      return `<article class="learning-card">${parts || `<pre>${escapeHtml(JSON.stringify(item, null, 2))}</pre>`}</article>`;
    }).join("")}</div>`;
  }

  function renderOverviewModule(result = {}) {
    return `${pairHtml(result.summary)}
      ${learningListHtml("最影响分数的 3-5 个问题 / Top score-limiting problems", result.topProblems, 5)}
      ${learningListHtml("错误类型总览 / Error summary", result.errorSummary, 8)}
      ${learningListHtml("下一篇优先练什么 / Next practice focus", result.nextPracticeFocus, 6)}
      ${pairHtml(result.priorityAdvice)}`;
  }

  function renderSentenceUpgradeModule(result = {}) {
    const cards = learningArray(result.sentenceCards || result.sentences, 40);
    return `${pairHtml(result.summary)}
      ${cards.length ? `<div class="learning-card-list sentence-correction-list">${cards.map((item, index) => {
        const noError = item.hasClearError === false || item.noClearError === true;
        const title = noError ? `Sentence ${escapeHtml(item.index || index + 1)} · 表达升级` : `Sentence ${escapeHtml(item.index || index + 1)} · 修改与升级`;
        return `<article class="learning-card">
          <div class="learning-card-title">${title}</div>
          ${tagListHtml(item.issueTags || item.errorTags || item.problemTags)}
          ${simpleValueHtml("原句 / Original", item.original, "", item.originalZh || item.originalTranslationZh)}
          ${simpleValueHtml("最小修正版 / Minimal correction", item.minimalCorrection || item.corrected, "is-corrected", item.minimalCorrectionZh || item.correctedZh)}
          ${simpleValueHtml("提高 0.5-1.0 分的升级版 / Next-step upgrade", item.upgradedVersion || item.improvedVersion, "is-upgraded", item.upgradedVersionZh || item.improvedVersionZh)}
          ${pairHtml(item.whyBetter || item.explanation || item.reason)}
          ${pairHtml(item.usefulPattern || item.pattern || item.learnThis)}
        </article>`;
      }).join("")}</div>` : `<p class="muted">没有可显示的逐句修改内容。请重新生成该模块。</p>`}
      ${pairHtml(result.priorityAdvice)}`;
  }

  function renderGrammarWordFormSpellingModule(result = {}) {
    const grammar = learningArray(result.grammarErrors, 100);
    const wordForm = learningArray(result.wordFormErrors || result.wordFormAndPartOfSpeechErrors, 80);
    const spelling = learningArray(result.spellingQuickFix || result.spellingErrors, 100);
    const focus = learningArray(result.learningFocus || result.grammarLearningFocus, 10);
    const grammarRows = grammar.length ? `<details class="score-accordion learning-subsection" open><summary>全部语法错误 / All grammar errors <span class="muted">${grammar.length} items</span></summary><div class="score-accordion-body learning-card-list">${grammar.map((item, index) => `<article class="learning-card"><div class="learning-card-title">${escapeHtml(item.errorType || item.type || `Grammar error ${index + 1}`)}</div>${simpleValueHtml("原文错误 / Original error", item.original || item.evidence, "", item.originalZh)}${simpleValueHtml("正确写法 / Corrected", item.corrected || item.correction, "is-corrected", item.correctedZh)}${pairHtml(item.explanation || item.reason)}${pairHtml(item.checkMethod || item.nextCheck)}</article>`).join("")}</div></details>` : `<p class="muted">没有发现明确语法错误，或该模块未返回语法错误。</p>`;
    const wordRows = wordForm.length ? `<details class="score-accordion learning-subsection"><summary>词形 / 词性错误 / Word form & part of speech <span class="muted">${wordForm.length} items</span></summary><div class="score-accordion-body learning-card-list">${wordForm.map((item, index) => `<article class="learning-card"><div class="learning-card-title">${escapeHtml(item.errorType || item.type || `Word-form issue ${index + 1}`)}</div>${simpleValueHtml("原文错误 / Original", item.original || item.wrong, "", item.originalZh)}${simpleValueHtml("正确写法 / Correct", item.corrected || item.correct, "is-corrected", item.correctedZh || item.correctZh)}${pairHtml(item.explanation || item.reason)}${pairHtml(item.checkMethod || item.nextCheck)}</article>`).join("")}</div></details>` : "";
    const spellingRows = spelling.length ? `<details class="score-accordion learning-subsection"><summary>拼写速查 / Spelling quick fix <span class="muted">${spelling.length} items</span></summary><div class="score-accordion-body"><div class="learning-spelling-grid">${spelling.map((item) => `<div class="learning-spelling-row"><strong>${escapeHtml(item.wrong || item.original || "")}</strong><span>→</span><strong class="is-corrected">${escapeHtml(item.correct || item.correction || "")}</strong><small>${escapeHtml(item.note || item.reason || "spelling")}</small></div>`).join("")}</div></div></details>` : "";
    const focusRows = focus.length ? `<details class="score-accordion learning-subsection" open><summary>本篇语法检查方法 / Grammar focus</summary><div class="score-accordion-body learning-card-list">${focus.map((item) => `<article class="learning-card"><div class="learning-card-title">${escapeHtml(item.point || item.focus || item.ruleName || "Grammar focus")}</div>${simpleValueHtml("本篇例子 / Example", item.example, "", item.exampleZh)}${pairHtml(item.rule || item.explanation)}${pairHtml(item.checkMethod || item.practiceTip)}</article>`).join("")}</div></details>` : "";
    return `${pairHtml(result.summary)}${grammarRows}${wordRows}${spellingRows}${focusRows}${pairHtml(result.priorityAdvice)}`;
  }

  function renderStructureCohesionTaskModule(result = {}) {
    const sectionCard = (title, obj) => {
      if (!hasMeaningfulContent(obj)) return "";
      return `<article class="learning-card"><div class="learning-card-title">${escapeHtml(title)}</div>${simpleValueHtml("当前问题 / Current issue", obj.currentIssue || obj.issue || obj.current, "", firstMeaningfulValue(obj.currentIssueZh, obj.issueZh, obj.currentZh, obj.explanationZh))}${simpleValueHtml("建议写法 / Suggested version", obj.suggestedVersion || obj.suggestion || obj.improved, "is-upgraded", firstMeaningfulValue(obj.suggestedVersionZh, obj.suggestionZh, obj.improvedZh))}${pairHtml(bilingualObject(obj.whyBetter?.en || obj.whyBetter || obj.why || obj.reason, firstMeaningfulValue(obj.whyBetter?.zh, obj.whyZh, obj.reasonZh, obj.explanationZh)))}${pairHtml(bilingualObject(obj.howToUse?.en || obj.howToUse || obj.nextStep || obj.advice?.en, firstMeaningfulValue(obj.howToUse?.zh, obj.nextStepZh, obj.advice?.zh, obj.suggestionZh)))}</article>`;
    };
    const checklist = learningArray(result.taskChecklist || result.taskResponse?.coverage || result.coverage, 10);
    const cohesionIssues = learningArray(result.cohesion?.issues || result.cohesionIssues, 8);
    const developmentIssues = learningArray(result.development?.issues || result.developmentIssues, 8);
    return `${pairHtml(result.summary)}
      ${checklist.length ? learningListHtml("任务要求覆盖 / Task requirement coverage", checklist, 10) : ""}
      <div class="learning-card-list">
        ${sectionCard("开头 / Opening", result.opening)}
        ${sectionCard("段落结构 / Paragraph organisation", result.paragraphOrganisation || result.paragraphOrganization)}
        ${cohesionIssues.map((item) => `<article class="learning-card"><div class="learning-card-title">衔接 / Cohesion</div>${simpleValueHtml("原来的连接 / Original link", item.original || item.current, "", firstMeaningfulValue(item.originalZh, item.currentZh, item.evidenceZh))}${simpleValueHtml("更好的连接 / Better link", item.improved || item.better, "is-upgraded", firstMeaningfulValue(item.improvedZh, item.betterZh, item.suggestionZh))}${pairHtml(bilingualObject(item.whyBetter?.en || item.whyBetter || item.reason, firstMeaningfulValue(item.whyBetter?.zh, item.reasonZh, item.explanationZh)))}</article>`).join("")}
        ${developmentIssues.map((item) => `<article class="learning-card"><div class="learning-card-title">内容展开 / Development</div>${simpleValueHtml("原内容 / Original content", item.original || item.current, "", firstMeaningfulValue(item.originalZh, item.currentZh, item.evidenceZh))}${simpleValueHtml("如何展开 / Better development", item.improved || item.better || item.suggestion, "is-upgraded", firstMeaningfulValue(item.improvedZh, item.betterZh, item.suggestionZh))}${pairHtml(bilingualObject(item.whyBetter?.en || item.whyBetter || item.reason, firstMeaningfulValue(item.whyBetter?.zh, item.reasonZh, item.explanationZh)))}</article>`).join("")}
        ${sectionCard("结尾 / Ending", result.ending)}
        ${sectionCard("任务回应 / Task response or achievement", result.taskResponse)}
      </div>
      ${pairHtml(result.priorityAdvice)}`;
  }

  function renderExpressionBankModule(result = {}) {
    const expressions = learningArray(result.usefulExpressions || result.expressions, 8);
    const avoid = learningArray(result.avoidForNow || result.avoid, 5);
    return `${pairHtml(result.summary)}
      ${expressions.length ? `<div class="learning-card-list">${expressions.map((item) => `<article class="learning-card">${simpleValueHtml("可积累表达 / Expression", item.expression || item.targetVersion || item.phrase, "is-upgraded", item.meaningZh || item.zh)}${simpleValueHtml("来自本文/题目 / From essay or prompt", item.fromEssayOrPrompt || item.source || item.original, "", item.sourceZh)}${pairHtml(item.situation || item.whenToUse)}${pairHtml(item.pattern || item.howToUse)}${pairHtml(item.whyUseful || item.reason)}</article>`).join("")}</div>` : `<p class="muted">没有可显示的表达积累。请重新生成该模块。</p>`}
      ${avoid.length ? learningListHtml("暂时不要优先模仿 / Avoid for now", avoid, 5) : ""}
      ${pairHtml(result.priorityAdvice)}`;
  }

  function renderLearningModuleBody(moduleName, data) {
    const result = data?.moduleResult || data?.result || {};
    if (!data) return `<div class="learning-empty-state"><p>点击“生成本模块反馈”开始。每个模块会单独请求 AI，反馈必须基于当前题目、你的原文和已经冻结的评分结果；不会重新打分，也不会用本地模板冒充真实反馈。</p></div>`;
    if (data.status === "loading") return `<div class="learning-loading"><p>正在生成 ${escapeHtml(moduleLabel(moduleName))}，请稍等...</p></div>`;
    if (data.status === "error") return `<div class="learning-error"><p>${escapeHtml(data.error || "反馈生成失败")}</p><button class="secondary" type="button" data-learning-feedback-generate="${escapeHtml(moduleName)}">重新生成</button></div>`;
    if (data.fallbackUsed) return `<div class="learning-error"><p>${escapeHtml(data.moduleResult?.summary?.zh || "该模块生成格式异常，请重新生成。")}</p><button class="secondary" type="button" data-learning-feedback-generate="${escapeHtml(moduleName)}">重新生成</button></div>`;
    if (moduleName === "overview") return renderOverviewModule(result);
    if (moduleName === "sentenceUpgrade") return renderSentenceUpgradeModule(result);
    if (moduleName === "grammarWordFormSpelling") return renderGrammarWordFormSpellingModule(result);
    if (moduleName === "structureCohesionTask") return renderStructureCohesionTaskModule(result);
    if (moduleName === "expressionBank") return renderExpressionBankModule(result);
    return `<pre>${escapeHtml(JSON.stringify(result, null, 2))}</pre>`;
  }

  function moduleLabel(moduleName) {
    const found = LEARNING_FEEDBACK_MODULES.find((item) => item.key === moduleName);
    return found ? `${found.label} / ${found.en}` : moduleName;
  }

  function renderLearningFeedbackHtml() {
    const active = LEARNING_FEEDBACK_MODULES.some((m) => m.key === activeLearningFeedbackModule) ? activeLearningFeedbackModule : "sentenceUpgrade";
    const activeModule = LEARNING_FEEDBACK_MODULES.find((m) => m.key === active) || LEARNING_FEEDBACK_MODULES[0];
    const body = renderLearningModuleBody(active, latestLearningFeedback[active]);
    return `<section class="learning-feedback-panel learning-feedback-v2-panel" id="learningFeedbackPanel">
      <div class="learning-feedback-head">
        <div>
          <h4>学习反馈 / Learning Feedback</h4>
          <p>每个模块单独请求 AI；反馈必须基于当前题目和你的原文，不重新打分，也不修改已经冻结的 Overall 或四项分。</p>
        </div>
        <button class="primary" type="button" data-learning-feedback-generate="${escapeHtml(active)}">生成本模块反馈</button>
      </div>
      <div class="learning-tabs" role="tablist">
        ${LEARNING_FEEDBACK_MODULES.map((item) => `<button class="learning-tab ${item.key === active ? "active" : ""}" type="button" data-learning-feedback-tab="${escapeHtml(item.key)}"><span>${escapeHtml(item.label)}</span><small>${escapeHtml(item.en)}</small></button>`).join("")}
      </div>
      <div class="learning-module-output" aria-live="polite">
        <h5>${escapeHtml(activeModule.label)} <span>/ ${escapeHtml(activeModule.en)}</span></h5>
        ${body}
      </div>
    </section>`;
  }

    function renderLearningFeedbackPanel() {
    const panel = document.getElementById("learningFeedbackPanel");
    if (panel) panel.outerHTML = renderLearningFeedbackHtml();
  }

  async function generateLearningFeedback(moduleName) {
    if (!selected) { setGradingStatus("请先选择一道题。", "error"); return; }
    const essay = String(els.essayInput?.value || "").trim();
    if (!essay) { setGradingStatus("请先输入作文，再生成学习反馈。", "error"); return; }
    activeLearningFeedbackModule = moduleName;
    latestLearningFeedback[moduleName] = { status: "loading" };
    renderLearningFeedbackPanel();
    try {
      const response = await fetch(feedbackEndpointFromGradingEndpoint(), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(feedbackPayload(moduleName))
      });
      const text = await response.text();
      let data = {};
      try { data = text ? JSON.parse(text) : {}; } catch { data = { raw: text }; }
      if (!response.ok || !data.ok) throw new Error([`HTTP ${response.status}`, data.error, data.detail].filter(Boolean).join(" | "));
      latestLearningFeedback[moduleName] = data;
      renderLearningFeedbackPanel();
      setGradingStatus(`${moduleLabel(moduleName)} 已生成。分数没有改变。`, "done");
    } catch (error) {
      latestLearningFeedback[moduleName] = { status: "error", error: String(error.message || error) };
      renderLearningFeedbackPanel();
      setGradingStatus(`学习反馈生成失败：${error.message || error}`, "error");
    }
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
      ${renderCriterionDifferentiationReview(result)}
      ${renderLearningFeedbackHtml()}
      ${renderScoreCalculationAccordion(result, rawAverage, finalBand)}
      ${renderScoreCalibration(result)}`;
    if (els.gradingResults) els.gradingResults.innerHTML = html;
    bindScoreUiInteractions();
  }
  function renderRevisionResult(result = {}) {
    if (!els.gradingResults) return;
    els.gradingResults.querySelectorAll(".generated-writing-learning-block").forEach((node) => node.remove());

    const taskLabel = result.task || lockedTaskForSelected();
    const toText = (value) => String(value || "").trim();
    const toArr = (value) => Array.isArray(value)
      ? value.map((item) => String(item || "").trim()).filter(Boolean)
      : (toText(value) ? [toText(value)] : []);

    const bandText = (value) => {
      const n = Number(value);
      return Number.isFinite(n) ? `Band ${formatBand(n)}` : "可学习提升";
    };

    const listBlock = (title, items) => {
      const arr = toArr(items);
      return arr.length ? `<div class="generated-study-list"><h5>${escapeHtml(title)}</h5>${listHtml(arr)}</div>` : "";
    };

    const valueBlock = (title, value) => {
      const text = toText(value);
      return text ? `<div class="score-flow-note"><strong>${escapeHtml(title)}</strong>${escapeHtml(text)}</div>` : "";
    };

    const fieldLine = (label, value) => {
      const text = toText(value);
      return text ? `<p><strong>${escapeHtml(label)}</strong>${escapeHtml(text)}</p>` : "";
    };

    const oldModelAnswer = typeof result.modelAnswer === "string" ? result.modelAnswer : "";
    const model = typeof result.modelAnswer === "object" && result.modelAnswer
      ? result.modelAnswer
      : { targetBand: result.targetBandModel, essay: oldModelAnswer, studyPoints: [], usefulSentences: [] };

    const plus05 = result.revisionPlus05 || {
      targetBand: result.targetBandPlus05,
      essay: result.revisedEssay || "",
      whyItIsPlus05: "",
      whatChanged: [],
      studyPoints: [],
      usefulSentences: []
    };

    const isBand5Rescue = Number.isFinite(Number(result.currentBand)) && Number(result.currentBand) < 5;
    const plus05Title = isBand5Rescue ? "② Band 5 保底修改版 / Band 5 rescue revision" : "② 基于原文修改版 / +0.5 band revision";
    const plus05WhyTitle = isBand5Rescue ? "为什么这是 Band 5 保底版" : "为什么大约高 0.5 分";
    const plus10Title = isBand5Rescue ? "③ Band 5.5 提升版 / Band 5.5 stronger revision" : "③ 基于原文修改版 / +1.0 band revision";

    const plus10 = result.revisionPlus10 || {
      targetBand: result.targetBandPlus10,
      essay: "",
      whyItIsPlus10: "",
      whatChangedFromPlus05: [],
      studyPoints: [],
      usefulSentences: []
    };

    const guide = result.learningGuide || {};
    const generatedTextMap = {
      model: toText(model.essay),
      plus05: toText(plus05.essay),
      plus10: toText(plus10.essay)
    };

    const systemNote = result.currentResultRejectedReason
      ? `旧评分结果未使用：${result.currentResultRejectedReason}`
      : result.currentResultUsed
        ? "已使用同一任务的冻结分数作为语言水平参考。"
        : "未使用旧评分结果；将按当前题目生成可学习作文。";

    const essayPre = (text, empty = "暂未生成") => `<pre class="generated-essay-text">${escapeHtml(toText(text) || empty)}</pre>`;
    const copyButton = (id, label) => `<button class="secondary" type="button" data-copy-generated="${escapeHtml(id)}">${escapeHtml(label)}</button>`;
    const applyButton = (id, label) => `<button class="secondary" type="button" data-apply-generated="${escapeHtml(id)}">${escapeHtml(label)}</button>`;

    const verificationStatusText = (status) => ({
      target_met: "精确达到目标",
      target_exceeded: "超过目标，不等于达标",
      closest_available: "使用最接近版本",
      not_exact_target: "未精确达到目标",
      below_target: "低于目标",
      verification_failed: "验证失败",
      verification_running: "正在验证",
      rewrite_running: "正在按目标重写",
      empty_essay: "无文本可验证",
      verification_unavailable: "验证不可用"
    })[status] || "验证结果未知";
    const verificationBandText = (obj, fallbackTarget) => {
      const target = obj?.targetBand || fallbackTarget;
      const verified = obj?.verification?.verifiedBand;
      const targetText = Number.isFinite(Number(target)) ? `目标：Band ${formatBand(target)}` : "目标：可学习提升";
      const verifiedText = Number.isFinite(Number(verified)) ? `生产验证：Band ${formatBand(verified)}` : "生产验证：暂无";
      const status = obj?.verification?.status ? `状态：${verificationStatusText(obj.verification.status)}` : "";
      return [targetText, verifiedText, status].filter(Boolean).join(" · ");
    };

    const verificationBlock = (obj) => {
      const v = obj?.verification || {};
      if (!v.enabled) return "";
      const target = Number.isFinite(Number(v.targetBand || obj?.targetBand)) ? `Band ${formatBand(v.targetBand || obj?.targetBand)}` : "目标未指定";
      const verified = Number.isFinite(Number(v.verifiedBand)) ? `Band ${formatBand(v.verifiedBand)}` : "暂无";
      const first = Number.isFinite(Number(v.firstVerifiedBand)) ? `；首次验证：Band ${formatBand(v.firstVerifiedBand)}` : "";
      const rewrite = v.rewriteAttempted ? "；已尝试自动重写" : "";
      const rewriteCount = Number.isFinite(Number(v.rewriteAttemptCount)) ? `；重写次数：${Number(v.rewriteAttemptCount)}` : "";
      const strategy = v.rewriteStrategy || obj?.rewriteStrategy ? `；策略：${v.rewriteStrategy || obj.rewriteStrategy}` : "";
      const exact = v.exactTargetMet === true ? "；精确达到目标：是" : (v.exactTargetMet === false ? "；精确达到目标：否" : "");
      const closest = v.closestVersionUsed || v.status === "closest_available"
        ? `；最终使用最接近版本${Number.isFinite(Number(v.closestVerifiedBand)) ? `（Band ${formatBand(v.closestVerifiedBand)}）` : ""}`
        : "";
      const distance = Number.isFinite(Number(v.distanceFromTarget)) ? `；距离目标：${formatBand(v.distanceFromTarget)}` : "";
      const err = v.error || v.rewriteError ? `<br><span class="muted">${escapeHtml(v.error || v.rewriteError)}</span>` : "";
      return `<div class="score-flow-note generated-verification-note"><strong>生产评分验证：</strong>目标 ${escapeHtml(target)}；验证 ${escapeHtml(verified)}；${escapeHtml(verificationStatusText(v.status))}${escapeHtml(first)}${escapeHtml(rewrite)}${escapeHtml(rewriteCount)}${escapeHtml(strategy)}${escapeHtml(exact)}${escapeHtml(closest)}${escapeHtml(distance)}${err}</div>`;
    };
    const card = (title, subtitle, essayText, explanationHtml, actionsHtml = "") => `
      <details class="score-accordion generated-essay-card">
        <summary>${escapeHtml(title)} <span class="muted">${escapeHtml(subtitle)}</span></summary>
        <div class="score-accordion-body">
          ${essayPre(essayText)}
          ${explanationHtml}
          <div class="actions generated-essay-actions">${actionsHtml}</div>
        </div>
      </details>`;

    const sourceBasedExplanation = (part, changeItems) => `
      ${listBlock("保留了原文哪些内容", part.preservedContent || part.sourceBasedChanges)}
      ${listBlock("改了哪些问题", part.changedProblems || changeItems)}
      ${valueBlock("为什么更接近目标分数：", part.whyCloserToTarget)}
      ${listBlock("可以模仿的句子", part.imitableSentences || part.usefulSentences)}
      ${valueBlock("为什么这不是新范文：", part.whySourceBasedRevision)}
    `;

    const renderTeacherGuide = (guideData = {}) => {
      const start = guideData.startHere || {};
      const differences = Array.isArray(guideData.keyDifferences) ? guideData.keyDifferences : [];
      const steps = Array.isArray(guideData.threeStepStudyPlan) ? guideData.threeStepStudyPlan : [];
      const patterns = Array.isArray(guideData.imitablePatterns) ? guideData.imitablePatterns : [];
      const oldWeaknesses = toArr(guideData.mainWeaknesses);
      const oldFocus = toArr(guideData.nextPracticeFocus);
      const oldDont = toArr(guideData.doNotCopyBlindly);
      const nextReminders = toArr(guideData.nextWritingReminders).length ? toArr(guideData.nextWritingReminders) : oldFocus;
      const doNotDo = toArr(guideData.doNotDo).length ? toArr(guideData.doNotDo) : oldDont;
      const startHtml = [
        fieldLine("先学哪一篇：", start.recommendedFirst),
        fieldLine("为什么先学它：", start.whyFirst),
        fieldLine("和你当前水平的关系：", start.relationToCurrentLevel),
        fieldLine("这篇适合学什么：", start.whatToStudy),
        fieldLine("暂时不要优先学哪篇：", start.notPriorityYet),
        fieldLine("目标分诚实说明：", start.targetAccuracyNote)
      ].filter(Boolean).join("") || `<p>先从最接近你当前水平的修改版开始，再看题目范文。不要直接背整篇 model answer。</p>`;
      const differencesHtml = differences.length
        ? differences.map((item, index) => `<div class="generated-teacher-item">
            <h5>差别 ${index + 1}：${escapeHtml(toText(item.title) || "原文到修改版的关键变化")}</h5>
            ${fieldLine("原文问题：", item.originalProblem)}
            ${fieldLine("原文证据：", item.originalEvidence)}
            ${fieldLine("修改版做法：", item.revisionEvidence)}
            ${fieldLine("为什么更像目标分：", item.whyCloserToTarget)}
            ${fieldLine("下次怎么模仿：", item.imitationAction)}
          </div>`).join("")
        : listHtml(oldWeaknesses.length ? oldWeaknesses : ["AI 暂未返回逐项差别。请先对比原文和 Band 5 修改版，看写信目的、任务要点和段落是否更清楚。"]);
      const stepsHtml = steps.length
        ? steps.map((item, index) => `<div class="generated-teacher-item">
            <h5>${escapeHtml(toText(item.step) || `Step ${index + 1}`)}</h5>
            ${fieldLine("具体任务：", item.task)}
            ${fieldLine("标记什么：", item.whatToMark)}
            ${fieldLine("学什么：", item.whatToLearn)}
            ${fieldLine("练习：", item.practice)}
          </div>`).join("")
        : `<ol><li>先对比原文和 Band 5 修改版，标出任务点如何补完整。</li><li>抄写并替换 2-3 个关键句型。</li><li>不看范文，用同一道题重新写一遍。</li></ol>`;
      const patternsHtml = patterns.length
        ? patterns.map((item) => `<div class="generated-teacher-item">
            ${fieldLine("句型：", item.pattern)}
            ${fieldLine("中文意思：", item.meaningZh)}
            ${fieldLine("来自：", item.source)}
            ${fieldLine("适用场景：", item.useCase)}
            ${fieldLine("替换练习：", item.substitutionPractice)}
            ${fieldLine("下次如何使用：", item.nextUse)}
          </div>`).join("")
        : listHtml(toArr(plus05.usefulSentences).concat(toArr(plus10.usefulSentences)).slice(0, 5));
      return `
        <details class="score-accordion generated-learning-guide">
          <summary>学习路线 / How to learn from these answers</summary>
          <div class="score-accordion-body generated-teacher-guide">
            <section><h4>1. 你应该先学哪一篇</h4>${startHtml}</section>
            <section><h4>2. 原文和修改版的关键差别</h4>${differencesHtml}</section>
            <section><h4>3. 三步学习路线</h4>${stepsHtml}</section>
            <section><h4>4. 可模仿句型</h4>${patternsHtml}</section>
            <section><h4>5. 下次写作提醒</h4>${listHtml(nextReminders.length ? nextReminders : ["每个任务点至少写 1-2 句。", "先写清楚目的和主要内容，再考虑更高级表达。"] )}</section>
            <section><h4>6. 不要做的事</h4>${listHtml(doNotDo.length ? doNotDo : ["不要直接背整篇 modelAnswer。", "不要只改单词，要先学任务回应和段落结构。", "不要把 modelAnswer 当成自己的修改版。"] )}</section>
          </div>
        </details>`;
    };

    const modelExplanation = `
      ${verificationBlock(model)}
      ${valueBlock("为什么这篇适合学：", model.whyThisIsLearnable)}
      ${valueBlock("为什么比你的原文更高：", model.whyHigherThanUserEssay)}
      ${listBlock("这篇范文里要学习什么", model.studyPoints)}
      ${listBlock("可模仿句子", model.usefulSentences)}
    `;

    const plus05Explanation = `
      ${verificationBlock(plus05)}
      ${valueBlock(`${plus05WhyTitle}：`, plus05.whyItIsPlus05)}
      ${sourceBasedExplanation(plus05, plus05.whatChanged)}
      ${listBlock("主要改了什么", plus05.whatChanged)}
      ${listBlock("下次优先学什么", plus05.studyPoints)}
      ${listBlock("可模仿句子", plus05.usefulSentences)}
    `;

    const plus10Explanation = `
      ${verificationBlock(plus10)}
      ${valueBlock("为什么大约高 1.0 分：", plus10.whyItIsPlus10)}
      ${sourceBasedExplanation(plus10, plus10.whatChangedFromPlus05 || plus10.whatChanged)}
      ${listBlock("比 +0.5 版本多提升在哪里", plus10.whatChangedFromPlus05 || plus10.whatChanged)}
      ${listBlock("下一阶段要学习什么", plus10.studyPoints)}
      ${listBlock("可模仿句子", plus10.usefulSentences)}
    `;

    const guideHtml = renderTeacherGuide(guide);
    const html = `<section class="grading-section revision-block generated-writing-learning-block">
      <details class="score-accordion generated-writing-panel">
        <summary>作文生成 / Model and Revision <span class="muted">已生成 3 篇可学习作文，点击展开。</span></summary>
        <div class="score-accordion-body">
          <p class="muted">独立作文生成系统：${escapeHtml(taskLabel)}；这一部分只生成作文，不改变已经冻结的分数。</p>
          <div class="ai-warning"><strong>生成系统状态：</strong>${escapeHtml(systemNote)}</div>
          ${result.verification?.summary ? `<div class="score-flow-note"><strong>生产模块验证：</strong>${escapeHtml(result.verification.summary)}</div>` : ""}
          ${Number.isFinite(Number(result.currentBand)) ? `<div class="score-flow-note"><strong>当前参考水平：</strong>Band ${escapeHtml(formatBand(result.currentBand))}。低于 Band 5.0 的作文，第一修改版必须基于你的原文按真实 Band 5 保底清单重写；如果多次仍卡在 4.5，会升级重构；如果多次被判 6.0，会进入 Band 5 降档锁定：保留内容但减少 polish、复杂句和额外展开；Band 5.0 及以上按 +0.5 / +1.0 严格生成。系统会用生产评分路由验证目标窗口：低于目标会重写，超过目标 0.5 以上会降档，因为太高也不适合作为当前阶段学习版。</div>` : ""}
          ${card("① 题目范文 / Question-based model answer", verificationBandText(model, result.targetBandModel), generatedTextMap.model, modelExplanation, copyButton("model", "复制范文"))}
          ${card(plus05Title, verificationBandText(plus05, result.targetBandPlus05), generatedTextMap.plus05, plus05Explanation, `${copyButton("plus05", isBand5Rescue ? "复制 Band 5 保底版" : "复制 +0.5 修改版")}${applyButton("plus05", isBand5Rescue ? "应用 Band 5 保底版到作文输入区" : "应用 +0.5 到作文输入区")}`)}
          ${card(plus10Title, verificationBandText(plus10, result.targetBandPlus10), generatedTextMap.plus10, plus10Explanation, `${copyButton("plus10", isBand5Rescue ? "复制 Band 5.5 提升版" : "复制 +1.0 修改版")}${applyButton("plus10", isBand5Rescue ? "应用 Band 5.5 提升版到作文输入区" : "应用 +1.0 到作文输入区")}`)}
          ${guideHtml}
        </div>
      </details>
    </section>`;

    els.gradingResults.insertAdjacentHTML("beforeend", html);
    const block = els.gradingResults.querySelector(".generated-writing-learning-block:last-child");
    if (!block) return;

    block.addEventListener("click", async (event) => {
      const copy = event.target.closest("[data-copy-generated]");
      if (copy) {
        const key = copy.dataset.copyGenerated;
        const text = generatedTextMap[key] || "";
        if (!text) { showStatus("暂无可复制内容"); return; }
        try { await navigator.clipboard.writeText(text); }
        catch {
          const tmp = document.createElement("textarea");
          tmp.value = text;
          document.body.appendChild(tmp);
          tmp.select();
          document.execCommand("copy");
          tmp.remove();
        }
        showStatus("已复制");
        return;
      }

      const apply = event.target.closest("[data-apply-generated]");
      if (apply) {
        const key = apply.dataset.applyGenerated;
        const text = generatedTextMap[key] || "";
        if (!text) { showStatus("暂无可应用内容"); return; }
        const ok = window.confirm("确认要用这个修改版替换当前作文输入区内容吗？建议先复制保存原文。");
        if (!ok) return;
        if (!els.essayInput || !selected) return;
        els.essayInput.value = text;
        save(selected.id, "essay", text);
        updateWords();
        showStatus("已应用到作文输入区");
      }
    });
  }


  function extractBandFromGeneratedVerificationResult(result = {}) {
    const candidates = [
      result.finalBand,
      result.overallBand,
      result.estimatedBand,
      result.score,
      result.band,
      result.scoreCalculation && result.scoreCalculation.finalBand,
      result.scoreCalculation && result.scoreCalculation.overallBand,
      result.visibleScore && result.visibleScore.finalBand,
      result.visibleScore && result.visibleScore.overallBand
    ];
    for (const value of candidates) {
      const n = Number(value);
      if (Number.isFinite(n) && n >= 0 && n <= 9) return Math.round(n * 2) / 2;
    }
    return null;
  }

  function generatedVerificationStatus(verifiedBand, targetBand) {
    const verified = Number(verifiedBand);
    const target = Number(targetBand);
    if (!Number.isFinite(verified) || !Number.isFinite(target)) return "verification_unavailable";
    if (verified < target) return "below_target";
    if (verified > target) return "target_exceeded";
    return "target_met";
  }

  function generatedVerificationSummary(result = {}) {
    const keys = ["modelAnswer", "revisionPlus05", "revisionPlus10"];
    const counts = keys.reduce((acc, key) => {
      const status = result[key]?.verification?.status || "unknown";
      acc[status] = (acc[status] || 0) + 1;
      return acc;
    }, {});
    const rewrites = keys.reduce((sum, key) => sum + (Number(result[key]?.rewriteAttemptCount) || 0), 0);
    return `严格生产评分验证完成：目标窗口内 ${counts.target_met || 0} 项，超过目标窗口 ${counts.target_exceeded || 0} 项，未达到目标 ${counts.below_target || 0} 项，验证失败 ${counts.verification_failed || 0} 项，自动重写/降档 ${rewrites} 次。`;
  }

  function generatedPartChineseName(key) {
    if (key === "modelAnswer") return "题目范文";
    if (key === "revisionPlus10") return "+1.0 修改版";
    return "+0.5 修改版";
  }

  async function scoreGeneratedEssayClientSide(result, key, label) {
    const part = result[key] || {};
    const essay = String(part.essay || "").trim();
    const targetBand = Number(part.targetBand || result.targetBandModel || result.targetBandPlus05 || result.targetBandPlus10);
    if (!essay) {
      return {
        enabled: true,
        ok: false,
        label,
        router: "grade-ielts-production-router",
        targetBand: Number.isFinite(targetBand) ? targetBand : null,
        verifiedBand: null,
        status: "empty_essay",
        message: "没有可验证的生成文本。"
      };
    }

    const scoreEndpoint = String(els.gradingEndpointInput?.value || DEFAULT_GRADING_ENDPOINT || "/api/grade-ielts-production-router").trim() || "/api/grade-ielts-production-router";
    const payload = gradingPayload({
      essay,
      wordCount: countWords(essay),
      mode: "score",
      generatedAnswerLabel: key,
      generatedTargetBand: Number.isFinite(targetBand) ? targetBand : null,
      currentResult: null,
      frozenScore: null
    });
    const score = await postStage(scoreEndpoint, payload);
    const verifiedBand = extractBandFromGeneratedVerificationResult(score);
    const status = generatedVerificationStatus(verifiedBand, targetBand);
    return {
      enabled: true,
      ok: true,
      label,
      router: "grade-ielts-production-router",
      targetBand: Number.isFinite(targetBand) ? targetBand : null,
      verifiedBand,
      status,
      message: status === "target_met"
        ? "生产评分验证已达到严格目标分。"
        : status === "target_exceeded"
          ? "生产评分验证超过目标窗口，说明这个版本偏难，需要降档重写。"
          : status === "below_target"
            ? `生产评分验证低于严格目标；${generatedPartChineseName(key)}将自动重写。`
            : "生产评分验证暂不可用。",
      criterionBands: score.finalCriteria || score.criteria || null,
      source: score.finalSource || score.scoreSource || score.system || "production-router"
    };
  }

  function mergeRewrittenGeneratedPart(result, key, rewriteResponse, attemptNumber) {
    const current = result[key] || {};
    const incoming = rewriteResponse?.[key] || rewriteResponse?.rewrittenPart || rewriteResponse?.generatedPart || {};
    const targetBand = current.targetBand;
    result[key] = {
      ...current,
      ...incoming,
      targetBand,
      essay: String(incoming.essay || current.essay || "").trim(),
      rewriteAttempted: true,
      rewriteAttemptCount: attemptNumber,
      rewriteStrategy: incoming.rewriteStrategy || current.rewriteStrategy || ""
    };
    return result[key];
  }

  async function rewriteGeneratedEssayPartClientSide(result, key, verification, attemptNumber) {
    const endpoint = essayGeneratorEndpointFromGradingEndpoint();
    if (!endpoint) throw new Error("作文生成接口地址不可用，无法自动重写。 ");
    const part = result[key] || {};
    const lockedTask = lockedTaskForSelected();
    const rewriteStrategy = verification?.status === "target_exceeded" ? "soft downshift" : "floor raise";
    const rewriteResponse = await postStage(endpoint, gradingPayload({
      mode: "rewrite_generated_part",
      generationMode: "rewrite_generated_part",
      rewriteGeneratedPart: key,
      failedGeneratedEssay: String(part.essay || ""),
      targetBand: part.targetBand,
      failedVerifiedBand: verification?.verifiedBand,
      rewriteStrategy,
      rewriteAttemptCount: attemptNumber,
      attemptNumber,
      verification,
      criterionBands: verification?.criterionBands || null,
      currentResult: safeCurrentResultForTask(lockedTask),
      frozenScore: frozenScoreForFeedback(),
      verifyGeneratedScores: false
    }));
    return mergeRewrittenGeneratedPart(result, key, rewriteResponse, attemptNumber);
  }

  function generatedBandDistance(verifiedBand, targetBand) {
    const verified = Number(verifiedBand);
    const target = Number(targetBand);
    if (!Number.isFinite(verified) || !Number.isFinite(target)) return Number.POSITIVE_INFINITY;
    return Math.abs(verified - target);
  }

  async function verifyOneGeneratedEssayClientSide(result, key, label) {
    const maxRewriteAttempts = 6;
    const part = result[key] || {};
    const targetBand = Number(part.targetBand || result.targetBandModel || result.targetBandPlus05 || result.targetBandPlus10);
    let closest = null;
    const rememberClosest = () => {
      const currentPart = result[key] || {};
      const verification = currentPart.verification || {};
      const distance = generatedBandDistance(verification.verifiedBand, targetBand);
      if (!Number.isFinite(distance)) return;
      if (!closest || distance < closest.distance) {
        closest = { essay: String(currentPart.essay || ""), part: { ...currentPart }, verification: { ...verification }, distance };
      }
    };

    part.verification = {
      enabled: true,
      ok: false,
      label,
      router: "grade-ielts-production-router",
      targetBand: Number.isFinite(targetBand) ? targetBand : null,
      verifiedBand: null,
      status: "verification_running",
      message: "正在使用生产评分路由验证生成作文。"
    };
    part.rewriteAttempted = Boolean(part.rewriteAttempted);
    part.rewriteAttemptCount = Number(part.rewriteAttemptCount) || 0;
    result[key] = part;
    result.verification = {
      ...(result.verification || {}),
      enabled: true,
      router: "grade-ielts-production-router",
      mode: "client-side-production-verification-with-strict-regeneration",
      summary: "正在使用生产评分路由验证生成作文。"
    };
    renderRevisionResult(result);

    let lastVerification = null;
    for (let attempt = 0; attempt <= maxRewriteAttempts; attempt += 1) {
      try {
        lastVerification = await scoreGeneratedEssayClientSide(result, key, label);
        result[key].verification = {
          ...lastVerification,
          rewriteAttempted: Boolean(result[key].rewriteAttempted),
          rewriteAttemptCount: Number(result[key].rewriteAttemptCount) || 0,
          rewriteStrategy: result[key].rewriteStrategy || (lastVerification.status === "target_exceeded" ? "soft downshift" : (lastVerification.status === "below_target" ? "floor raise" : "candidate selected")),
          exactTargetMet: lastVerification.status === "target_met",
          firstVerifiedBand: result[key].verification?.firstVerifiedBand ?? (attempt === 0 ? lastVerification.verifiedBand : result[key].verification?.firstVerifiedBand),
          firstStatus: result[key].verification?.firstStatus ?? (attempt === 0 ? lastVerification.status : result[key].verification?.firstStatus)
        };
        rememberClosest();
        renderRevisionResult(result);

        if (lastVerification.status === "target_met") return result[key].verification;
        if (!["below_target", "target_exceeded"].includes(lastVerification.status)) return result[key].verification;
        if (attempt >= maxRewriteAttempts) {
          const chosen = closest || { part: result[key], verification: result[key].verification, distance: generatedBandDistance(lastVerification.verifiedBand, targetBand) };
          result[key] = {
            ...(result[key] || {}),
            ...(chosen.part || {}),
            essay: chosen.essay || result[key]?.essay || "",
            rewriteAttempted: true,
            rewriteAttemptCount: Number(result[key]?.rewriteAttemptCount) || maxRewriteAttempts
          };
          result[key].verification = {
            ...(chosen.verification || result[key].verification || {}),
            status: "closest_available",
            secondaryStatus: "not_exact_target",
            message: "最终使用最接近版本，但未精确达到目标。",
            exactTargetMet: false,
            closestVersionUsed: true,
            closestVerifiedBand: chosen.verification?.verifiedBand ?? lastVerification.verifiedBand,
            targetBand: Number.isFinite(targetBand) ? targetBand : null,
            distanceFromTarget: Number.isFinite(chosen.distance) ? Math.round(chosen.distance * 2) / 2 : null,
            rewriteAttempted: true,
            rewriteAttemptCount: Number(result[key]?.rewriteAttemptCount) || maxRewriteAttempts,
            rewriteStrategy: "closest version used"
          };
          result[key].closestVersionUsed = true;
          result[key].exactTargetMet = false;
          result[key].rewriteStrategy = "closest version used";
          renderRevisionResult(result);
          return result[key].verification;
        }

        const rewriteStrategy = lastVerification.status === "target_exceeded" ? "soft downshift" : "floor raise";
        result[key].verification = {
          ...result[key].verification,
          status: "rewrite_running",
          message: lastVerification.status === "target_exceeded"
            ? `验证分高于精确目标，正在进行 soft downshift 第 ${attempt + 1} 次。`
            : `验证分低于精确目标，正在进行 floor raise 第 ${attempt + 1} 次。`,
          rewriteAttempted: true,
          rewriteAttemptCount: attempt + 1,
          rewriteStrategy
        };
        result[key].rewriteAttempted = true;
        result[key].rewriteAttemptCount = attempt + 1;
        result[key].rewriteStrategy = rewriteStrategy;
        renderRevisionResult(result);
        await rewriteGeneratedEssayPartClientSide(result, key, lastVerification, attempt + 1);
        renderRevisionResult(result);
      } catch (error) {
        result[key].verification = {
          enabled: true,
          ok: false,
          label,
          router: "grade-ielts-production-router",
          targetBand: Number.isFinite(targetBand) ? targetBand : null,
          verifiedBand: null,
          status: "verification_failed",
          message: "生产评分验证或自动重写失败；生成作文仍然可用，但目标分未验证。",
          rewriteAttempted: Boolean(result[key].rewriteAttempted),
          rewriteAttemptCount: Number(result[key].rewriteAttemptCount) || 0,
          error: String(error.message || error).slice(0, 500)
        };
        renderRevisionResult(result);
        return result[key].verification;
      }
    }
    return lastVerification;
  }
  async function verifyGeneratedEssaysClientSide(result = {}) {
    const keys = [
      ["modelAnswer", "question-based model answer"],
      ["revisionPlus05", "+0.5 revised version"],
      ["revisionPlus10", "+1.0 revised version"]
    ];
    for (const [key, label] of keys) {
      await verifyOneGeneratedEssayClientSide(result, key, label);
      result.verification = {
        ...(result.verification || {}),
        enabled: true,
        router: "grade-ielts-production-router",
        mode: "client-side-production-verification-with-strict-regeneration",
        summary: generatedVerificationSummary(result)
      };
      renderRevisionResult(result);
    }
    setGradingStatus("作文生成完成，严格生产评分验证和必要自动重写已完成。", "done");
    return result;
  }


  async function generateEssayOnly() {
    if (!selected) { setGradingStatus("请先选择一道题。", "error"); return; }
    const endpoint = essayGeneratorEndpointFromGradingEndpoint();
    if (!endpoint) { setGradingStatus("请先填写作文生成接口地址。不要把 API key 放在前端网页中。", "error"); return; }
    const originalText = els.generateRevisionBtn?.textContent || "生成作文 / Generate essay";
    if (els.generateRevisionBtn) { els.generateRevisionBtn.disabled = true; els.generateRevisionBtn.textContent = "Generating..."; els.generateRevisionBtn.setAttribute("aria-busy", "true"); }
    if (els.gradeBtn) els.gradeBtn.disabled = true;
    if (els.gradingEndpointInput) els.gradingEndpointInput.disabled = true;
    try {
      setGradingStatus("正在单独生成作文。评分流程不会被调用，分数不会被改变。", "loading");
      const lockedTask = lockedTaskForSelected();
      const revision = await postStage(endpoint, gradingPayload({
        aiStage: "essay-generator",
        mode: "generation_only",
        currentResult: safeCurrentResultForTask(lockedTask),
        frozenScore: frozenScoreForFeedback(),
        verifyGeneratedScores: false
      }));
      if (!latestScoreResult && els.gradingResults) els.gradingResults.innerHTML = "";
      renderRevisionResult(revision);
      setGradingStatus("作文生成完成，正在用生产评分路由验证生成版本。", "loading");
      verifyGeneratedEssaysClientSide(revision).catch((verifyError) => {
        setGradingStatus(`作文已生成，但生产验证失败：${verifyError.message}`, "error");
      });
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
      let failureStepIndex = 1;
      updateScoringProgress(0, "done", "文本已提交，后端将进行本地预检与任务分流。");
      updateScoringProgress(1, "running", "AI 正在生成短 JSON 核心评分：anchor、四项分和 reason codes。");
      if (els.gradingResults) els.gradingResults.innerHTML = renderScoreSkeleton(latestScoringProgress);
      setGradingStatus("第 2 步/6：AI 核心评分。", "loading");
      const result = await postStage(endpoint, gradingPayload({ mode: "score" }));
      latestScoreResult = result;
      syncScoringProgressFromResult(result);
      markScoreFrozenAndStartCriterionFeedback("核心分数已冻结；现在开始逐项生成四项详细反馈。");
      failureStepIndex = 5;
      if (els.gradeBtn) els.gradeBtn.textContent = "生成反馈中...";
      if (els.gradingResults) els.gradingResults.innerHTML = renderScoreSkeleton(latestScoringProgress);
      setGradingStatus("第 6 步/6：核心分数已冻结。正在通过独立接口逐项生成四项详细反馈...", "loading");
      const resultWithRequiredFeedback = await generateRequiredCriterionFeedback(result);
      latestScoreResult = resultWithRequiredFeedback;
      completeScoringProgress();
      renderScoreResult(resultWithRequiredFeedback);
      setGradingStatus("批改完成：核心分数已冻结，四项详细反馈已逐项生成；作文生成请使用旁边的单独按钮。", "done");
    } catch (error) {
      const failedStep = latestScoringProgress?.currentStep ? Math.max(0, latestScoringProgress.currentStep - 1) : 1;
      updateScoringProgress(failedStep, "error", failedStep >= 5 ? "详细反馈生成失败。" : "评分流程执行失败。", error);
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
      ...lockedTaskFields(prompt?.task === "Task 1" ? "Task 1" : "Task 2"),
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
    if (els.gradingEndpointInput) {
      const savedEndpoint = localStorage.getItem(GRADING_ENDPOINT_KEY) || "";
      const migratedEndpoint = /\/api\/grade-ielts\/?$/i.test(savedEndpoint)
        ? savedEndpoint.replace(/\/api\/grade-ielts\/?$/i, "/api/grade-ielts-production-router")
        : savedEndpoint;
      els.gradingEndpointInput.value = migratedEndpoint || DEFAULT_GRADING_ENDPOINT;
      if (migratedEndpoint !== savedEndpoint || !savedEndpoint) {
        localStorage.setItem(GRADING_ENDPOINT_KEY, els.gradingEndpointInput.value.trim());
      }
    }
    const theme = localStorage.getItem("ielts-gt-writing-hub:theme") || "light";
    document.documentElement.dataset.theme = theme;
    if (els.themeBtn) els.themeBtn.textContent = theme === "dark" ? "浅色模式" : "深色模式";
    renderList();
    const fromHash = location.hash.replace("#", "");
    if (fromHash && prompts.some((p) => p.id === fromHash)) selectPrompt(fromHash);
  }

  init();
})();
