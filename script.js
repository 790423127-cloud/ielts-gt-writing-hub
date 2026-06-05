(() => {
const DATA = window.IELTS_GT_DATA;
const prompts = DATA.prompts;
let selected = null;
let timerId = null;
let remaining = 0;
let currentLimit = 0;
const GRADING_ENDPOINT_KEY = "ielts-gt-writing-hub:gradingEndpoint";

const $ = (id) => document.getElementById(id);
const els = {
  themeBtn: $("themeBtn"), bookFilter: $("bookFilter"), testFilter: $("testFilter"), taskFilter: $("taskFilter"), typeFilter: $("typeFilter"), searchInput: $("searchInput"),
  promptList: $("promptList"), countLabel: $("countLabel"), emptyState: $("emptyState"), practiceView: $("practiceView"), metaTags: $("metaTags"), sourceStatus: $("sourceStatus"), practiceTitle: $("practiceTitle"), practicePrompt: $("practicePrompt"), infoGrid: $("infoGrid"), timerDisplay: $("timerDisplay"), timerBtn: $("timerBtn"), resetTimerBtn: $("resetTimerBtn"), planArea: $("planArea"), essayInput: $("essayInput"), wordCount: $("wordCount"), wordTarget: $("wordTarget"), copyBtn: $("copyBtn"), clearBtn: $("clearBtn"), statusText: $("statusText"), favoriteInput: $("favoriteInput"), structureList: $("structureList"), bandTips: $("bandTips"), phraseKicker: $("phraseKicker"), phraseTitle: $("phraseTitle"), phraseGroups: $("phraseGroups"), backBtn: $("backBtn"), gradingEndpointInput: $("gradingEndpointInput"), gradingModeSelect: $("gradingModeSelect"), gradeBtn: $("gradeBtn"), gradingStatus: $("gradingStatus"), gradingResults: $("gradingResults"), restoreOriginalBtn: $("restoreOriginalBtn"), revisionCompareArea: $("revisionCompareArea"), compareOriginalText: $("compareOriginalText"), compareRevisedText: $("compareRevisedText")
};

function unique(items) { return [...new Set(items)]; }
function storageKey(id, part) { return `ielts-gt-writing-hub:${id}:${part}`; }
function save(id, part, value) { localStorage.setItem(storageKey(id, part), value); }
function load(id, part) { return localStorage.getItem(storageKey(id, part)) || ""; }
function countWords(text) { return (text.trim().match(/[A-Za-z0-9]+(?:[\'’-][A-Za-z0-9]+)*/g) || []).length; }
function fmt(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function tag(text, cls) { return `<span class="tag ${cls}">${text}</span>`; }
function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}
function listHtml(items) {
  return Array.isArray(items) && items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>` : `<p class="muted">暂无内容</p>`;
}

function proseHtml(text) {
  return text ? `<p>${escapeHtml(text)}</p>` : `<p class="muted">暂无内容</p>`;
}

function boolText(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["true", "yes", "y", "covered", "fully covered", "partly covered", "partially covered"].includes(normalized)) return "是";
    if (["false", "no", "n", "not covered", "missing", "uncovered", "否"].includes(normalized)) return "否";
  }
  return value ? "是" : "否";
}

function targetWordsForPrompt(prompt) {
  return prompt?.task === "Task 1" ? 150 : 250;
}

function taskTypeForPrompt(prompt) {
  return prompt?.task === "Task 1" ? "task1" : "task2";
}

function extractBulletPointsFromPrompt(text) {
  return String(text || "").split(/\n+/).map((line) => line.trim()).filter((line) => /^[-*•]\s+/.test(line)).map((line) => line.replace(/^[-*•]\s+/, ""));
}

function fillSelect(select, values, allText) {
  select.innerHTML = `<option value="all">${allText}</option>` + values.map((v) => `<option value="${v}">${v}</option>`).join("");
}

function initFilters() {
  fillSelect(els.bookFilter, DATA.meta.books, "全部 Books");
  fillSelect(els.testFilter, ["Test 1", "Test 2", "Test 3", "Test 4"], "全部 Test");
  fillSelect(els.taskFilter, ["Task 1", "Task 2"], "Task 1 + Task 2");
  fillSelect(els.typeFilter, unique(prompts.map((p) => p.type)).sort(), "全部题型");
  $("booksStat").textContent = DATA.meta.books.length;
  $("testsStat").textContent = DATA.meta.books.length * DATA.meta.testsPerBook;
  $("task1Stat").textContent = prompts.filter((p) => p.task === "Task 1").length;
  $("task2Stat").textContent = prompts.filter((p) => p.task === "Task 2").length;
}

function filteredPrompts() {
  const q = els.searchInput.value.trim().toLowerCase();
  return prompts.filter((p) => {
    const matches = [p.book, p.test, p.module, p.task, p.type, p.letterStyle || "", p.title, p.prompt, p.difficulty].join(" ").toLowerCase().includes(q);
    return matches &&
      (els.bookFilter.value === "all" || p.book === els.bookFilter.value) &&
      (els.testFilter.value === "all" || p.test === els.testFilter.value) &&
      (els.taskFilter.value === "all" || p.task === els.taskFilter.value) &&
      (els.typeFilter.value === "all" || p.type === els.typeFilter.value);
  });
}

function renderList() {
  const list = filteredPrompts();
  els.countLabel.textContent = `${list.length} / ${prompts.length}`;
  els.promptList.innerHTML = list.map((p) => `
    <button class="prompt-btn ${selected && selected.id === p.id ? "active" : ""}" type="button" data-id="${p.id}">
      <div class="tags">${tag(p.book.replace("Cambridge IELTS ", "C"), "book")}${tag(p.test, "book")}${tag(p.task, p.task === "Task 1" ? "task1" : "task2")}${tag(p.type, "type")}</div>
      <h3>${p.title}</h3>
      <span class="muted">${p.sourceStatus}</span>
    </button>`).join("");
  els.promptList.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => selectPrompt(btn.dataset.id)));
  if (!list.length) els.promptList.innerHTML = `<p class="muted">没有匹配的练习题，请调整筛选或搜索关键词。</p>`;
}

function stopTimer() {
  if (timerId) clearInterval(timerId);
  timerId = null;
  els.timerBtn.textContent = "开始";
}

function resetTimer(limit) {
  stopTimer();
  currentLimit = limit;
  remaining = limit * 60;
  els.timerDisplay.textContent = fmt(remaining);
}

function ensureEssayTimerDock() {
  if (!els.essayInput || !els.timerDisplay || !els.timerBtn || !els.resetTimerBtn) return;
  const essayCard = els.essayInput.closest(".card") || els.essayInput.parentElement;
  if (!essayCard) return;

  const oldTimerCard = els.timerDisplay.closest(".card");
  if (oldTimerCard && oldTimerCard !== essayCard) oldTimerCard.classList.add("timer-card-emptied");

  let dock = $("essayTimerDock");
  if (!dock) {
    dock = document.createElement("div");
    dock.id = "essayTimerDock";
    dock.className = "essay-timer-dock";
    dock.innerHTML = `<div class="essay-timer-title"><span>写作计时</span><small>Timer beside writing area</small></div><div class="essay-timer-controls"></div>`;
    const essayHeader = essayCard.querySelector(".card-head");
    if (essayHeader && essayHeader.parentNode) {
      essayHeader.parentNode.insertBefore(dock, essayHeader.nextSibling);
    } else {
      essayCard.insertBefore(dock, els.essayInput);
    }
  }

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
    els.timerDisplay.textContent = fmt(remaining);
    if (remaining === 0) stopTimer();
  }, 1000);
  els.timerBtn.textContent = "暂停";
}

function renderInfo(p) {
  const info = [
    ["Module", p.module],
    [p.task === "Task 1" ? "书信类型" : "题型", p.task === "Task 1" ? p.letterStyle : p.type],
    ["建议字数", `至少 ${p.recommendedWords} words`],
    ["计时", `${p.timeLimit} 分钟`],
    ["难度", p.difficulty],
    ["来源状态", p.sourceStatus]
  ];
  els.infoGrid.innerHTML = info.map(([k, v]) => `<div class="info"><span>${k}</span><strong>${v}</strong></div>`).join("");
}

function renderPlan(p) {
  const fields = p.task === "Task 1"
    ? [["purpose", "Task 1 letter purpose 分析", p.notes.focus], ["tone", "语气与读者关系", `Reader: ${p.letterStyle}`], ["bullets", "三个 bullet points 覆盖计划", "Bullet 1:\nBullet 2:\nBullet 3:"], ["details", "可加入的细节", "time / place / reason / result / request"]]
    : [["position", "Task 2 position 分析", p.notes.focus], ["reasons", "Reasons", "Reason 1:\nReason 2:"], ["examples", "Examples", "Example 1:\nExample 2:"], ["balance", "让步或反方观点", "Although ..., I believe ..."]];
  els.planArea.innerHTML = fields.map(([key, label, placeholder]) => `<label><span class="muted">${label}</span><textarea data-plan="${key}" placeholder="${placeholder}">${load(p.id, `plan:${key}`)}</textarea></label>`).join("");
  els.planArea.querySelectorAll("textarea").forEach((box) => box.addEventListener("input", () => save(p.id, `plan:${box.dataset.plan}`, box.value)));
}

function renderPhrases(p) {
  const bank = p.task === "Task 1" ? DATA.phraseBanks.task1 : DATA.phraseBanks.task2;
  els.phraseKicker.textContent = p.task === "Task 1" ? "Task 1 Letter Phrases" : "Task 2 Essay Phrases";
  els.phraseTitle.textContent = p.task === "Task 1" ? "常用句型提示" : "常用连接词与模板";
  els.phraseGroups.innerHTML = Object.entries(bank).map(([name, phrases]) => `<div class="phrase-group"><h4>${name}</h4>${phrases.map((phrase) => `<button class="phrase-btn" type="button" data-phrase="${phrase.replaceAll('"', '&quot;')}">${phrase}</button>`).join("")}</div>`).join("");
  els.phraseGroups.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", () => {
    const current = els.favoriteInput.value.trim();
    els.favoriteInput.value = current ? `${current}\n${btn.dataset.phrase}` : btn.dataset.phrase;
    save(p.id, "favorites", els.favoriteInput.value);
    showStatus("已加入收藏区");
  }));
}

function updateWords() {
  if (!selected) return;
  const words = countWords(els.essayInput.value);
  els.wordCount.textContent = words;
  els.wordTarget.textContent = `/ ${selected.recommendedWords} words`;
  els.wordCount.style.color = words >= selected.recommendedWords ? "var(--teal)" : "var(--rose)";
}

function selectPrompt(id) {
  selected = prompts.find((p) => p.id === id);
  if (!selected) return;
  location.hash = id;
  els.emptyState.classList.add("hidden");
  els.practiceView.classList.remove("hidden");
  els.metaTags.innerHTML = tag(selected.book, "book") + tag(selected.test, "book") + tag(selected.task, selected.task === "Task 1" ? "task1" : "task2") + tag(selected.type, "type");
  els.sourceStatus.textContent = `Source status: ${selected.sourceStatus}`;
  els.practiceTitle.textContent = `${selected.book} · ${selected.test} · ${selected.task}: ${selected.title}`;
  els.practicePrompt.textContent = selected.prompt;
  renderInfo(selected);
  renderPlan(selected);
  els.essayInput.value = load(selected.id, "essay");
  els.favoriteInput.value = load(selected.id, "favorites");
  els.structureList.innerHTML = selected.sampleStructure.map((x) => `<li>${x}</li>`).join("");
  els.bandTips.innerHTML = `<div class="band"><strong>Band 5 保底写法提示</strong>${selected.notes.band5}</div><div class="band"><strong>Band 6+ 提升提示</strong>${selected.notes.band6}</div>`;
  renderPhrases(selected);
  resetTimer(selected.timeLimit);
  ensureEssayTimerDock();
  updateWords();
  resetGradingPanel();
  renderList();
  if (innerWidth < 1100) els.practiceView.scrollIntoView({ behavior: "smooth", block: "start" });
}

function showStatus(text) {
  els.statusText.textContent = text;
  setTimeout(() => { els.statusText.textContent = ""; }, 1400);
}

async function copyEssay() {
  if (!els.essayInput.value.trim()) { showStatus("作文区为空"); return; }
  try { await navigator.clipboard.writeText(els.essayInput.value); }
  catch { els.essayInput.select(); document.execCommand("copy"); }
  showStatus("已复制");
}

function setGradingStatus(text, state = "") {
  els.gradingStatus.textContent = text;
  els.gradingStatus.dataset.state = state;
}

function truncateDetail(value, limit = 1500) {
  const text = String(value ?? "").trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

async function buildResponseError(response) {
  let payload = null;
  let fallbackText = "";

  try {
    payload = await response.clone().json();
  } catch {
    try {
      fallbackText = await response.text();
    } catch {
      fallbackText = "";
    }
  }

  const parts = [`HTTP ${response.status}`];
  if (payload?.error) parts.push(`error: ${payload.error}`);
  if (payload?.provider) parts.push(`provider: ${payload.provider}`);
  if (payload?.status) parts.push(`status: ${payload.status}`);
  if (payload?.suggestion) parts.push(`suggestion: ${payload.suggestion}`);
  const detail = payload?.detail ?? fallbackText;
  if (detail) parts.push(`detail: ${truncateDetail(detail, 320)}`);
  return {
    message: parts.join(" | "),
    detail: truncateDetail(detail),
    rawPreview: truncateDetail(payload?.rawPreview)
  };
}

function renderErrorDetails(errorInfo) {
  if (!errorInfo?.detail && !errorInfo?.rawPreview) return;
  const detailBlock = errorInfo.detail ? `<h4>Detail</h4><pre>${escapeHtml(errorInfo.detail)}</pre>` : "";
  const rawBlock = errorInfo.rawPreview ? `<h4>Raw Preview</h4><pre>${escapeHtml(errorInfo.rawPreview)}</pre>` : "";
  els.gradingResults.innerHTML = collapsibleSection("查看详细错误", `${detailBlock}${rawBlock}`, { className: "error-details" });
}

function renderZhToggle(text) {
  const value = String(text || "").trim();
  if (!value) return "";
  return `<button class="secondary translation-toggle zh-toggle" type="button" aria-expanded="false">中文解释</button><div class="translation-panel zh-note hidden">${escapeHtml(value)}</div>`;
}

function hasTranslationValue(value) {
  if (Array.isArray(value)) return value.some((item) => String(item || "").trim());
  return String(value || "").trim().length > 0;
}

function renderTextWithTranslation(englishText, chineseText, options = {}) {
  const text = String(englishText ?? "").trim();
  const fallback = options.fallback || "";
  const tagName = options.tag || "p";
  const className = options.className ? ` class="${options.className}"` : "";
  const englishHtml = text ? `<${tagName}${className}>${escapeHtml(text)}</${tagName}>` : (fallback ? `<${tagName} class="muted">${escapeHtml(fallback)}</${tagName}>` : "");
  if (options.noTranslate || !hasTranslationValue(chineseText)) return englishHtml;
  const zhText = Array.isArray(chineseText) ? chineseText.filter(Boolean).join("\n") : chineseText;
  return `<div class="translation-inline">${englishHtml}${renderZhToggle(zhText)}</div>`;
}

function collapsibleSection(title, contentHtml, options = {}) {
  const content = String(contentHtml || "").trim();
  if (!content && options.hideIfEmpty) return "";
  const open = options.defaultOpen ? " open" : "";
  const className = options.className ? ` ${options.className}` : "";
  const bodyClass = options.bodyClass ? ` ${options.bodyClass}` : "";
  return `<details class="feedback-collapse${className}"${open}>
    <summary>${escapeHtml(title)}</summary>
    <div class="feedback-collapse-body${bodyClass}">${content || `<p class="muted">${escapeHtml(options.emptyText || "No content is available.")}</p>`}</div>
  </details>`;
}

function isGenericChineseHelper(value, englishText = "") {
  const zh = String(value || "").trim();
  if (!zh) return false;
  const compact = zh.replace(/\s+/g, "");
  const genericNotes = new Set([
    "更完整地回应题目。", "这里说明开头是否合适。", "这里说明结尾是否合适。",
    "逐条覆盖题目要点。", "结构和衔接需要更清楚。", "分段并自然使用连接词。",
    "词汇需要更准确更多样。", "使用更准确的题目词汇。", "语法准确性和句子控制需提升。",
    "先写完整准确的句子。", "先保证句子语法准确。", "替换模糊词，使用题目相关词汇。",
    "更完整地回应题目。", "衔接更自然。", "内容和语言仍需加强。"
  ]);
  if (genericNotes.has(compact)) return true;
  const englishLength = String(englishText || "").trim().length;
  return englishLength > 90 && compact.length <= 8;
}

function safeChineseHelper(value, englishText = "") {
  if (Array.isArray(value)) {
    return value.map((item) => safeChineseHelper(item, englishText)).filter(Boolean);
  }
  return isGenericChineseHelper(value, englishText) ? "" : value;
}

function renderAdviceObject(item, zhFallback = "") {
  if (!item || typeof item !== "object") {
    return renderTextWithTranslation(item, zhFallback, { tag: "span" });
  }
  const title = firstNonEmpty(item.title, item.item, item.area, item.criterion, item.category, item.focus, item.point, item.issueType);
  const weakness = firstNonEmpty(item.currentWeakness, item.weakness, item.problem, item.issue, item.gap, item.currentProblem);
  const target = firstNonEmpty(item.target, item.targetBand, item.goal, item.objective, item.nextBand, item.targetLevel);
  const action = firstNonEmpty(item.action, item.advice, item.suggestion, item.howToImprove, item.howToFix, item.specificAction, item.recommendation, item.comment);
  const example = firstNonEmpty(item.example, item.exampleUpgrade, item.suggestedSentence, item.modelSentence, item.betterExpression, item.targetBandExpression);
  const impact = firstNonEmpty(item.bandImpact, item.impactOnBand, item.whyThisAffectsBand, item.scoreImpact, item.reason);
  const zh = safeChineseHelper(firstNonEmpty(item.actionZh, item.adviceZh, item.suggestionZh, item.howToImproveZh, item.howToFixZh, item.commentZh, item.problemZh, item.reasonZh, zhFallback), [title, weakness, target, action, example, impact].join(" "));
  const lines = [
    title ? `<p><strong>项目：</strong>${escapeHtml(title)}</p>` : "",
    weakness ? `<p><strong>当前问题：</strong>${escapeHtml(weakness)}</p>` : "",
    target ? `<p><strong>目标：</strong>${escapeHtml(target)}</p>` : "",
    action ? `<p><strong>具体动作：</strong>${escapeHtml(action)}</p>` : "",
    example ? `<p><strong>示例升级：</strong>${escapeHtml(example)} ${renderCopyButton(example)}</p>` : "",
    impact ? `<p><strong>对分数影响：</strong>${escapeHtml(impact)}</p>` : ""
  ].filter(Boolean).join("");
  return lines ? `<div class="advice-card-inline">${lines}${renderZhToggle(zh)}</div>` : renderTextWithTranslation(flattenObjectText(item), zh, { tag: "span" });
}

function renderListWithTranslations(items, translations, fallbackText) {
  const list = Array.isArray(items) ? items.filter((item) => hasAnyText(item)) : [];
  const zhList = Array.isArray(translations) ? translations : [];
  if (!list.length) return `<p class="muted">${escapeHtml(fallbackText || "No content is available.")}</p>`;
  return `<ul class="detailed-advice-list">${list.map((item, index) => `<li>${renderAdviceObject(item, zhList[index])}</li>`).join("")}</ul>`;
}

function bindZhToggles(scope) {
  scope.querySelectorAll(".zh-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      const note = button.nextElementSibling;
      if (!note) return;
      const isHidden = note.classList.toggle("hidden");
      button.setAttribute("aria-expanded", String(!isHidden));
      button.textContent = isHidden ? "中文解释" : "收起中文";
    });
  });
}


function renderFeedbackTools() {
  return `<div class="grading-tools" role="toolbar" aria-label="AI feedback tools">
    <button class="secondary" type="button" data-feedback-tool="expand-zh">展开全部中文</button>
    <button class="secondary" type="button" data-feedback-tool="collapse-zh">收起全部中文</button>
    <button class="secondary" type="button" data-feedback-tool="expand-details">展开全部折叠</button>
    <button class="secondary" type="button" data-feedback-tool="collapse-details">收起全部折叠</button>
  </div>`;
}

function setAllZhPanels(scope, expanded) {
  scope.querySelectorAll(".zh-toggle").forEach((button) => {
    const note = button.nextElementSibling;
    if (!note) return;
    note.classList.toggle("hidden", !expanded);
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "收起中文" : "中文解释";
  });
}

function setAllDetails(scope, expanded) {
  scope.querySelectorAll("details").forEach((detail) => {
    detail.open = expanded;
  });
}

function bindFeedbackTools(scope) {
  scope.querySelectorAll("[data-feedback-tool]").forEach((button) => {
    button.addEventListener("click", () => {
      const action = button.dataset.feedbackTool;
      if (action === "expand-zh") setAllZhPanels(scope, true);
      if (action === "collapse-zh") setAllZhPanels(scope, false);
      if (action === "expand-details") setAllDetails(scope, true);
      if (action === "collapse-details") setAllDetails(scope, false);
    });
  });
}

function resetGradingPanel() {
  setGradingStatus("等待批改");
  els.gradingResults.innerHTML = "";
  els.revisionCompareArea.classList.add("hidden");
  els.compareOriginalText.textContent = "";
  els.compareRevisedText.textContent = "";
}

function setupGradingModes() {
  if (!els.gradingModeSelect) return;
  const current = els.gradingModeSelect.value;
  els.gradingModeSelect.innerHTML = `
    <option value="full">详细批改（不带范文）</option>
    <option value="revision">详细批改 + 范文</option>`;
  els.gradingModeSelect.value = current === "revision" ? "revision" : "full";
}

function gradingPayload() {
  const essay = els.essayInput.value.trim();
  const wordCount = countWords(essay);
  const rawMode = els.gradingModeSelect.value || "full";
  const mode = rawMode === "revision" ? "revision" : "full";
  const targetWordCount = targetWordsForPrompt(selected);
  const includeRevision = mode === "revision";
  return {
    task: selected.task,
    taskType: taskTypeForPrompt(selected),
    book: selected.book,
    test: selected.test,
    questionTitle: selected.title,
    questionPrompt: selected.prompt,
    promptText: selected.prompt,
    task1BulletPoints: selected.task === "Task 1" ? extractBulletPointsFromPrompt(selected.prompt) : [],
    task2Instruction: selected.task === "Task 2" ? selected.prompt : "",
    essay,
    wordCount,
    actualWordCount: wordCount,
    targetWordCount,
    isUnderMinimum: wordCount < targetWordCount,
    mode,
    gradingMode: mode,
    outputLanguage: "en",
    locale: "en",
    includeRevision,
    revisionTargets: includeRevision ? ["band5", "band6", "band7"] : [],
    rubric: {
      task1: ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"],
      task2: ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
    }
  };
}


function mergeAiStageResult(base, incoming) {
  const output = base && typeof base === "object" ? { ...base } : {};
  const data = incoming && typeof incoming === "object" ? incoming : {};
  const arrayFields = [
    "spellingCorrections", "grammarErrors", "sentenceCorrections", "detailedSentenceCorrections",
    "taskAchievementAdvice", "taskAchievementAdviceZh", "coherenceAdvice", "coherenceAdviceZh",
    "lexicalAdvice", "lexicalAdviceZh", "grammarAdvice", "grammarAdviceZh",
    "band5FixPlan", "band5FixPlanZh", "band6UpgradePlan", "band6UpgradePlanZh",
    "band7UpgradePlan", "band7UpgradePlanZh", "revisionNotes", "revisionNotesZh",
    "strengths", "strengthsZh", "mainProblems", "mainProblemsZh", "stageWarnings", "stageProgress"
  ];
  const objectFields = [
    "errorAnalysis", "correctionPriority", "targetImprovementPlan", "task1LetterCorrections",
    "task2EssayCorrections", "revisedEssayMeta", "taskRequirementAnalysis", "taskRequirementAnalysisZh",
    "scoreCalibration", "scoreCalibrationZh", "lowBandDiagnostics", "lowBandDiagnosticsZh",
    "highBandDiagnostics", "highBandDiagnosticsZh", "taskMatchCheck"
  ];
  arrayFields.forEach((field) => {
    if (Array.isArray(data[field]) && data[field].length) output[field] = data[field];
  });
  objectFields.forEach((field) => {
    if (data[field] && typeof data[field] === "object") output[field] = { ...(output[field] || {}), ...data[field] };
  });
  [
    "revisedEssayBand5", "revisedEssayBand6", "revisedEssayBand7", "modelAnswerOutline",
    "correctionWarning", "correctionPassWarning", "revisionWarning", "gradingWarning", "sectionWarning", "disclaimer"
  ].forEach((field) => {
    if (typeof data[field] === "string" && data[field].trim()) output[field] = data[field];
  });
  if (data.criteria && typeof data.criteria === "object") output.criteria = data.criteria;
  const mayReplaceScore = !output.overallBand || data.aiStage === "score" || data.aiStage === "score-audit" || data.aiStage === "all" || !data.aiStage;
  if (mayReplaceScore && typeof data.overallBand !== "undefined") output.overallBand = data.overallBand;
  if (mayReplaceScore && typeof data.estimatedLevel !== "undefined") output.estimatedLevel = data.estimatedLevel;
  if (typeof data.actualWordCount !== "undefined") output.actualWordCount = data.actualWordCount;
  if (typeof data.wordCountThresholdUsed !== "undefined") output.wordCountThresholdUsed = data.wordCountThresholdUsed;
  if (typeof data.wordCountStatus !== "undefined") output.wordCountStatus = data.wordCountStatus;
  output.overallEstimatedBand = output.overallBand;
  output.revisedEssay = output.revisedEssayBand7 || output.revisedEssayBand6 || output.revisedEssayBand5 || output.revisedEssay || "";
  return output;
}

function hasUsefulItemArray(value) {
  return Array.isArray(value) && value.some((item) => hasAnyText(item));
}

function stageResultHasExpectedContent(aiStage, data = {}) {
  if (!data || typeof data !== "object") return false;
  if (aiStage === "score-audit") {
    return Boolean(data.criteria || data.scoreCalibration || hasUsefulItemArray(data.strengths) || hasUsefulItemArray(data.mainProblems));
  }
  if (aiStage === "correction-task") {
    return Boolean(
      hasUsefulItemArray(data.taskAchievementAdvice) ||
      hasUsefulItemArray(data.coherenceAdvice) ||
      hasAnyText(data.task1LetterCorrections) ||
      hasAnyText(data.task2EssayCorrections) ||
      hasAnyText(data.errorAnalysis?.summary)
    );
  }
  if (aiStage === "correction-language") {
    return hasUsefulItemArray(data.grammarErrors) || hasUsefulItemArray(data.sentenceCorrections) || hasUsefulItemArray(data.detailedSentenceCorrections) || hasAnyText(data.errorAnalysis?.summary);
  }
  if (aiStage === "correction-vocabulary") {
    return hasUsefulItemArray(data.spellingCorrections) || hasUsefulItemArray(data.lexicalAdvice) || hasUsefulItemArray(data.detailedSentenceCorrections) || hasAnyText(data.errorAnalysis?.summary);
  }
  if (aiStage === "improvement-plan" || aiStage === "correction-advice") {
    return Boolean(
      targetImprovementPlanHasUsefulContent(data.targetImprovementPlan) ||
      hasAnyText(data.correctionPriority) ||
      hasUsefulItemArray(data.taskAchievementAdvice) ||
      hasUsefulItemArray(data.coherenceAdvice) ||
      hasUsefulItemArray(data.lexicalAdvice) ||
      hasUsefulItemArray(data.grammarAdvice)
    );
  }
  if (aiStage === "correction-spelling") {
    return hasUsefulItemArray(data.spellingCorrections) || hasAnyText(data.errorAnalysis?.summary);
  }
  if (aiStage === "correction-grammar") {
    return hasUsefulItemArray(data.grammarErrors) || hasUsefulItemArray(data.detailedSentenceCorrections);
  }
  if (aiStage === "correction-sentence") {
    return hasUsefulItemArray(data.sentenceCorrections) || hasUsefulItemArray(data.detailedSentenceCorrections);
  }
  if (aiStage === "correction-advice") {
    return Boolean(
      hasUsefulItemArray(data.taskAchievementAdvice) ||
      hasUsefulItemArray(data.coherenceAdvice) ||
      hasUsefulItemArray(data.lexicalAdvice) ||
      hasUsefulItemArray(data.grammarAdvice) ||
      hasUsefulItemArray(data.band5FixPlan) ||
      hasUsefulItemArray(data.band6UpgradePlan) ||
      hasUsefulItemArray(data.band7UpgradePlan) ||
      targetImprovementPlanHasUsefulContent(data.targetImprovementPlan) ||
      hasAnyText(data.correctionPriority) ||
      hasAnyText(data.task1LetterCorrections) ||
      hasAnyText(data.task2EssayCorrections)
    );
  }
  if (aiStage === "correction") {
    return hasDetailedFeedbackContent(data) || hasDetailedAdviceContent(data);
  }
  if (aiStage === "revision") {
    return Boolean(data.revisedEssayBand5 || data.revisedEssayBand6 || data.revisedEssayBand7 || data.modelAnswerOutline);
  }
  return true;
}

function hasDetailedFeedbackContent(result = {}) {
  return Boolean(
    hasUsefulItemArray(result.spellingCorrections) ||
    hasUsefulItemArray(result.grammarErrors) ||
    hasUsefulItemArray(result.sentenceCorrections) ||
    hasUsefulItemArray(result.detailedSentenceCorrections)
  );
}

function hasDetailedAdviceContent(result = {}) {
  return Boolean(
    hasUsefulItemArray(result.taskAchievementAdvice) ||
    hasUsefulItemArray(result.coherenceAdvice) ||
    hasUsefulItemArray(result.lexicalAdvice) ||
    hasUsefulItemArray(result.grammarAdvice) ||
    hasUsefulItemArray(result.band5FixPlan) ||
    hasUsefulItemArray(result.band6UpgradePlan) ||
    hasUsefulItemArray(result.band7UpgradePlan) ||
    targetImprovementPlanHasUsefulContent(result.targetImprovementPlan) ||
    hasAnyText(result.correctionPriority) ||
    hasAnyText(result.task1LetterCorrections) ||
    hasAnyText(result.task2EssayCorrections)
  );
}


async function postAiStage(endpoint, payload, aiStage, statusText) {
  setGradingStatus(statusText, "loading");
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 285000) : null;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...payload, aiStage }),
      signal: controller ? controller.signal : undefined
    });
    if (!response.ok) {
      const errorInfo = await buildResponseError(response);
      throw new Error(errorInfo.message);
    }
    return await response.json();
  } catch (error) {
    if (error && error.name === "AbortError") {
      throw new Error(`${statusText} timed out after waiting. Please try again.`);
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function startGrading() {
  if (!selected) { setGradingStatus("请先选择一道题。", "error"); return; }
  if (els.gradeBtn.disabled) return;

  const endpoint = els.gradingEndpointInput.value.trim();
  if (!endpoint) {
    setGradingStatus("请先填写批改接口地址。不要把 API key 放在前端网页中。", "error");
    return;
  }
  const essay = els.essayInput.value.trim();
  const wordCount = countWords(essay);
  const targetWordCount = targetWordsForPrompt(selected);
  const isUnderMinimum = wordCount < targetWordCount;

  const originalButtonText = els.gradeBtn.textContent;
  els.gradeBtn.disabled = true;
  els.gradeBtn.textContent = "AI grading...";
  els.gradeBtn.setAttribute("aria-busy", "true");
  if (els.gradingModeSelect) els.gradingModeSelect.disabled = true;
  if (els.gradingEndpointInput) els.gradingEndpointInput.disabled = true;

  setGradingStatus("AI is scoring and analysing the task.", "loading");
  els.gradingResults.innerHTML = isUnderMinimum
    ? `<p class="ai-warning">当前字数低于 IELTS 建议字数，AI 仍会批改，但 Task Achievement / Task Response 可能会受到影响。</p>`
    : "";
  els.revisionCompareArea.classList.add("hidden");

  const payload = gradingPayload();
  const totalSteps = payload.mode === "revision" ? 8 : 7;
  let result = null;
  const stageWarnings = [];
  const stageProgress = [];

  function syncStageMeta() {
    if (!result) return;
    result.stageWarnings = stageWarnings.slice();
    result.stageProgress = stageProgress.slice();
  }

  function markStage(label, state, message) {
    stageProgress.push({ label, state, message });
    syncStageMeta();
  }

  async function runMergeStage(aiStage, statusText, warningPrefix) {
    markStage(warningPrefix, "running", statusText);
    try {
      const stageResult = await postAiStage(endpoint, { ...payload, currentOverallBand: result?.overallBand, currentResult: result || null }, aiStage, statusText);
      const hasExpectedContent = stageResultHasExpectedContent(aiStage, stageResult);
      result = mergeAiStageResult(result || {}, stageResult);

      if (!hasExpectedContent) {
        const warning = `${warningPrefix}：AI 已返回，但没有提供这一阶段的具体内容，系统会尝试补充完整详细反馈。`;
        stageWarnings.push(warning);
        if (aiStage.startsWith("correction")) result.correctionWarning = warning;
        if (aiStage === "revision") result.revisionWarning = warning;
        markStage(warningPrefix, "warning", warning);
      } else {
        markStage(warningPrefix, "done", `${warningPrefix}已完成。`);
      }

      syncStageMeta();
      renderGradingResult(result);
      return hasExpectedContent;
    } catch (stageError) {
      const warning = `${warningPrefix}：${stageError.message}`;
      stageWarnings.push(warning);
      if (result) {
        if (aiStage.startsWith("correction")) result.correctionWarning = warning;
        if (aiStage === "revision") result.revisionWarning = warning;
        markStage(warningPrefix, "error", warning);
        syncStageMeta();
        renderGradingResult(result);
      }
      return false;
    }
  }

  try {
    const scoreResult = await postAiStage(endpoint, payload, "score", `第 1 步/${totalSteps}：AI 正在评分与分析题目`);
    result = mergeAiStageResult({}, scoreResult);
    markStage("评分与题目分析", "done", `第 1 步/${totalSteps} 已完成：AI 已返回分数和题目分析。`);
    syncStageMeta();
    renderGradingResult(result);

    const correctionStages = [
      ["score-audit", `第 2 步/${totalSteps}：AI 正在审核评分一致性`, "评分一致性审核"],
      ["correction-task", `第 3 步/${totalSteps}：AI 正在检查任务回应、结构和题目覆盖`, "任务回应与结构检查"],
      ["correction-grammar", `第 4 步/${totalSteps}：AI 正在逐项检查语法、词形和句法错误`, "语法专项检查"],
      ["correction-sentence", `第 5 步/${totalSteps}：AI 正在生成逐句修改和更好表达`, "逐句批改检查"],
      ["correction-vocabulary", `第 6 步/${totalSteps}：AI 正在检查词汇、拼写、搭配和重复问题`, "词汇拼写和搭配检查"],
      ["correction-advice", `第 7 步/${totalSteps}：AI 正在生成下一阶段提分计划和练习任务`, "提分计划生成"]
    ];

    for (const [stage, statusText, warningPrefix] of correctionStages) {
      await runMergeStage(stage, statusText, warningPrefix);
    }

    if (!hasDetailedFeedbackContent(result) || !hasDetailedAdviceContent(result)) {
      await runMergeStage(
        "correction",
        `补充步骤：AI 正在补充完整详细反馈，包含错误订正和提分建议，请等待。`,
        "完整详细反馈补充"
      );
    }

    if (!hasDetailedFeedbackContent(result)) {
      const warning = "详细错误订正仍不完整：AI 没有返回足够的原句、修改句和错误原因。请再次点击开始批改重试详细订正阶段。";
      stageWarnings.push(warning);
      result.correctionWarning = warning;
      markStage("详细错误订正完整性检查", "warning", warning);
    }
    if (!hasDetailedAdviceContent(result)) {
      const warning = "提分建议仍不完整：AI 没有返回足够的下一阶段目标、四项提分动作或练习任务。请再次点击开始批改重试提分建议阶段。";
      stageWarnings.push(warning);
      result.correctionWarning = warning;
      markStage("提分建议完整性检查", "warning", warning);
    }
    syncStageMeta();
    renderGradingResult(result);

    if (payload.mode === "revision") {
      await runMergeStage("revision", `第 ${totalSteps} 步/${totalSteps}：AI 正在生成修改版/范文`, "范文/修改版生成");
    } else {
      setGradingStatus("AI 正在整理最终批改结果。", "loading");
      markStage("最终整理", "done", "结果已整理。");
      syncStageMeta();
      renderGradingResult(result);
    }

    if (stageWarnings.length) {
      setGradingStatus(`批改完成，但部分详细阶段需要重试：${stageWarnings.join("；")}`, "warning");
    } else {
      setGradingStatus("批改完成", "done");
    }
  } catch (error) {
    setGradingStatus(`批改失败：${error.message}`, "error");
    if (result) renderGradingResult(result);
  } finally {
    els.gradeBtn.disabled = false;
    els.gradeBtn.textContent = originalButtonText || "开始批改";
    els.gradeBtn.removeAttribute("aria-busy");
    if (els.gradingModeSelect) els.gradingModeSelect.disabled = false;
    if (els.gradingEndpointInput) els.gradingEndpointInput.disabled = false;
  }
}


function renderStageProgress(result = {}) {
  const progress = Array.isArray(result.stageProgress) ? result.stageProgress : [];
  const warnings = Array.isArray(result.stageWarnings) ? result.stageWarnings : [];
  const inlineWarnings = [result.gradingWarning, result.correctionWarning, result.correctionPassWarning, result.revisionWarning, result.sectionWarning]
    .filter((item) => String(item || "").trim());
  const allWarnings = [...warnings, ...inlineWarnings].filter((item, index, arr) => String(item || "").trim() && arr.indexOf(item) === index);
  if (!progress.length && !allWarnings.length) return "";
  return collapsibleSection("AI 批改进度与提示", `
    ${progress.length ? `<ul>${progress.map((item) => {
      const stateText = item.state === "done" ? "完成" : item.state === "running" ? "进行中" : item.state === "warning" ? "需注意" : "未完成";
      return `<li><strong>${escapeHtml(item.label || "阶段")}</strong>：${escapeHtml(stateText)} — ${escapeHtml(item.message || "")}</li>`;
    }).join("")}</ul>` : ""}
    ${allWarnings.length ? `<div class="ai-warning">${allWarnings.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
  `);
}

function renderCriteria(criteria = {}) {
  const rows = Object.entries(criteria);
  if (!rows.length) return `<p class="muted">暂无四项评分。</p>`;
  return `<div class="criteria-grid">${rows.map(([name, item]) => `
    <div class="criteria-item">
      <span>${escapeHtml(name)}</span>
      <strong>Band ${escapeHtml(item?.band ?? "-")}</strong>
      ${renderTextWithTranslation(item?.feedback || "", item?.feedbackZh, { fallback: "No feedback is available." })}
      ${item?.howToImprove ? renderTextWithTranslation(`How to improve: ${item.howToImprove}`, item?.howToImproveZh, { className: "improve" }) : ""}
    </div>`).join("")}</div>`;
}

function renderScoreCalibration(calibration, calibrationZh = {}) {
  if (!calibration || typeof calibration !== "object") return collapsibleSection("评分校准说明", `<p class="muted">No detailed score calibration is available.</p>`);
  return collapsibleSection("评分校准说明", `
      <p><strong>是否应用限分规则：</strong>${boolText(calibration.capApplied)}</p>
      <div><strong>限分原因：</strong>${renderTextWithTranslation(calibration.capReason || "No cap was applied.", calibrationZh.capReasonZh, { tag: "span" })}</div>
      <div><strong>为什么不能更高：</strong>${renderTextWithTranslation(calibration.whyNotHigher || "No detailed score calibration is available.", calibrationZh.whyNotHigherZh, { tag: "span" })}</div>
      <div><strong>为什么没有更低：</strong>${renderTextWithTranslation(calibration.whyNotLower || "No detailed score calibration is available.", calibrationZh.whyNotLowerZh, { tag: "span" })}</div>
      <div><strong>评分证据：</strong>${renderListWithTranslations(calibration.evidence, calibrationZh.evidenceZh, "No detailed score calibration is available.")}</div>
  `, { bodyClass: "compact-body" });
}

function renderLowBandDiagnostics(diagnostics, diagnosticsZh = {}) {
  if (!diagnostics || typeof diagnostics !== "object") return collapsibleSection("低分段判断依据", `<p class="muted">No low-band trigger was detected.</p>`);
  return collapsibleSection("低分段判断依据", `
      <p><strong>建议低分范围：</strong>${escapeHtml(diagnostics.recommendedLowBandRange || "无明显低分段限制")}</p>
      <div><strong>原因：</strong>${renderTextWithTranslation(diagnostics.reason || "No low-band trigger was detected.", diagnosticsZh.reasonZh, { tag: "span" })}</div>
      <p><strong>20词或更少：</strong>${boolText(diagnostics.wordCount20OrFewer)}</p>
      <p><strong>疑似大量复制题目：</strong>${boolText(diagnostics.mostlyCopiedFromPrompt)}</p>
      <p><strong>相关信息很少：</strong>${boolText(diagnostics.littleRelevantMessage)}</p>
      <p><strong>意思大多被错误阻断：</strong>${boolText(diagnostics.meaningMostlyBlocked)}</p>
  `, { bodyClass: "compact-facts" });
}


function renderTaskRequirementAnalysis(analysis = {}, match = {}, analysisZh = {}) {
  if (!analysis || typeof analysis !== "object") return collapsibleSection("题目要求分析", `<p class="muted">No detailed task analysis is available for this response.</p>`);
  const isTask1 = analysis.taskType === "task1" || selected?.task === "Task 1";
  const bullets = Array.isArray(analysis.bulletPoints) ? analysis.bulletPoints : [];
  const bulletsZh = Array.isArray(analysisZh.bulletPointsZh) ? analysisZh.bulletPointsZh : [];
  const parts = Array.isArray(analysis.requiredParts) ? analysis.requiredParts : [];
  const partsZh = Array.isArray(analysisZh.requiredPartsZh) ? analysisZh.requiredPartsZh : [];
  return collapsibleSection("题目要求分析", `
      <p><strong>题型：</strong>${isTask1 ? "Task 1 letter" : "Task 2 essay"}</p>
      ${isTask1 ? `
        <p><strong>收信人：</strong>${escapeHtml(analysis.recipient || "未返回")}</p>
        <p><strong>关系：</strong>${escapeHtml(analysis.relationship || "未返回")}</p>
        <div><strong>语气：</strong>${renderTextWithTranslation(analysis.requiredTone || "Not returned.", analysisZh.requiredToneZh, { tag: "span" })}</div>
        <div><strong>信件类型：</strong>${renderTextWithTranslation(analysis.letterType || "Not returned.", analysisZh.letterTypeZh, { tag: "span" })}</div>
        <div><strong>写作目的：</strong>${renderTextWithTranslation(analysis.taskPurpose || "No detailed task analysis is available for this response.", analysisZh.taskPurposeZh, { tag: "span" })}</div>
        <div><strong>Bullet points：</strong>${bullets.length ? `<div class="correction-list bullet-analysis-list">${bullets.map((item, index) => {
          const requirement = firstNonEmpty(item.requirement, item.bulletPoint, item.point, item.taskRequirement, item.text);
          const evidence = firstNonEmpty(item.evidence, item.evidenceFromEssay, item.originalEvidence, item.quote);
          const problem = firstNonEmpty(item.problem, item.issue, item.missingDetail, item.reason, item.comment);
          const suggestion = firstNonEmpty(item.suggestion, item.suggestedSentence, item.howToFix, item.advice, item.recommendation);
          const zh = safeChineseHelper(bulletsZh[index] || item.explanationZh || item.commentZh || item.reasonZh || item.suggestionZh, [requirement, evidence, problem, suggestion].join(" "));
          return `<div class="correction-item bullet-analysis-item">
            <p><strong>要点：</strong>${escapeHtml(requirement || `Bullet point ${index + 1}`)}</p>
            <p><strong>是否覆盖：</strong>${boolText(item.covered)}</p>
            ${evidence ? `<p><strong>原文证据：</strong>${escapeHtml(evidence)}</p>` : ""}
            ${problem ? `<p><strong>问题：</strong>${escapeHtml(problem)}</p>` : ""}
            ${suggestion ? `<p><strong>建议：</strong>${escapeHtml(suggestion)} ${renderCopyButton(suggestion)}</p>` : ""}
            ${renderZhToggle(zh)}
          </div>`;
        }).join("")}</div>` : `<p class="muted">No detailed task analysis is available for this response.</p>`}</div>
      ` : `
        <div><strong>题目类型：</strong>${renderTextWithTranslation(analysis.questionType || "Not returned.", analysisZh.questionTypeZh, { tag: "span" })}</div>
        <p><strong>话题：</strong>${escapeHtml(analysis.topic || "未返回")}</p>
        <div><strong>是否需要明确立场：</strong>${renderTextWithTranslation(analysis.requiredPosition || "Not returned.", analysisZh.requiredPositionZh, { tag: "span" })}</div>
        <p><strong>立场是否出现：</strong>${boolText(analysis.positionPresent)}</p>
        <div><strong>必须回答的部分：</strong>${parts.length ? renderListWithTranslations(parts, partsZh, "No detailed task analysis is available for this response.") : `<p class="muted">No detailed task analysis is available for this response.</p>`}</div>
      `}
      <div><strong>缺失要求：</strong>${listHtml(analysis.missingRequirements)}</div>
      <div><strong>匹配检查：</strong>${renderTextWithTranslation(match.reason || analysis.taskMatchSummary || "No detailed task analysis is available for this response.", analysisZh.taskMatchSummaryZh, { tag: "span" })}</div>
      ${match.warning ? `<p class="ai-warning">${escapeHtml(match.warning)}</p>` : ""}
  `);
}

function renderHighBandDiagnostics(diagnostics, diagnosticsZh = {}) {
  if (!diagnostics || typeof diagnostics !== "object") return collapsibleSection("高分判断依据", `<p class="muted">No high-band evidence was confirmed.</p>`);
  return collapsibleSection("高分判断依据", `
      <p><strong>建议高分范围：</strong>${escapeHtml(diagnostics.recommendedHighBandRange || "暂无")}</p>
      <div><strong>原因：</strong>${renderTextWithTranslation(diagnostics.reason || "No high-band evidence was confirmed.", diagnosticsZh.reasonZh, { tag: "span" })}</div>
      <p><strong>完整回应题目：</strong>${boolText(diagnostics.fullyAddressesTask)}</p>
      <p><strong>结构推进清楚：</strong>${boolText(diagnostics.clearProgression)}</p>
      <p><strong>观点/内容展开充分：</strong>${boolText(diagnostics.wellDevelopedIdeas)}</p>
      <p><strong>词汇准确灵活：</strong>${boolText(diagnostics.wideAccurateVocabulary)}</p>
      <p><strong>语法灵活：</strong>${boolText(diagnostics.flexibleGrammar)}</p>
      <p><strong>错误很少：</strong>${boolText(diagnostics.fewErrors)}</p>
      <p><strong>Task 1 语气合适：</strong>${diagnostics.appropriateToneTask1 === undefined ? "不适用" : boolText(diagnostics.appropriateToneTask1)}</p>
  `, { bodyClass: "compact-facts" });
}

function hasAnyText(value) {
  if (Array.isArray(value)) return value.some(hasAnyText);
  if (value && typeof value === "object") return Object.values(value).some(hasAnyText);
  return String(value ?? "").trim().length > 0;
}

function renderCopyButton(text, label = "复制") {
  const value = String(text || "").trim();
  if (!value) return "";
  return `<button class="secondary copy-mini" type="button" data-copy-text="${escapeHtml(value)}">${label}</button>`;
}

function renderErrorAnalysis(analysis) {
  if (!analysis || typeof analysis !== "object" || !hasAnyText(analysis)) {
    return collapsibleSection("主要错误总结", `<p class="muted">No detailed error analysis is available.</p>`);
  }
  const patterns = Array.isArray(analysis.errorPatterns)
    ? analysis.errorPatterns.filter((item) => item && (hasAnyText(item.type) || hasAnyText(item.impactOnBand) || hasAnyText(item.howToFix)))
    : [];
  return collapsibleSection("主要错误总结", `
    ${analysis.summary ? `<p>${escapeHtml(analysis.summary)}</p>` : ""}
    ${analysis.summaryZh ? renderZhToggle(analysis.summaryZh) : ""}
    ${patterns.length ? `<div class="correction-list">${patterns.map((item) => `
      <div class="correction-item">
        ${hasAnyText(item.type) || hasAnyText(item.typeZh) ? `<p><strong>错误类型：</strong>${escapeHtml(item.type || "")}${item.typeZh ? ` / ${escapeHtml(item.typeZh)}` : ""}</p>` : ""}
        ${hasAnyText(item.frequency) ? `<p><strong>出现频率：</strong>${escapeHtml(item.frequency)}</p>` : ""}
        ${hasAnyText(item.impactOnBand) ? `<p><strong>对分数影响：</strong>${escapeHtml(item.impactOnBand)}</p>` : ""}
        ${hasAnyText(item.howToFix) ? `<p><strong>怎么改：</strong>${escapeHtml(item.howToFix)}</p>` : ""}
        ${renderZhToggle([item.impactOnBandZh, item.howToFixZh].filter(Boolean).join("\n"))}
      </div>`).join("")}</div>` : ""}
    ${analysis.priorityFixes?.length ? `<h4>优先修改点</h4>${renderListWithTranslations(analysis.priorityFixes, analysis.priorityFixesZh, "No priority fixes are available.")}` : ""}
  `);
}

function compactFeedbackText(value) {
  return String(value ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

function isNoImpactFeedback(value) {
  const text = compactFeedbackText(value);
  return Boolean(text && (
    text === "none" ||
    text === "n/a" ||
    text.includes("none /") ||
    text.includes("no significant") ||
    text.includes("no impact") ||
    text.includes("no error") ||
    text.includes("no mistake") ||
    text.includes("does not affect the band") ||
    text.includes("not affect the band") ||
    text.includes("无")
  ));
}

function sameFeedbackText(a, b) {
  const left = compactFeedbackText(a).replace(/[.,!?;:'"()，。！？；：“”‘’]/g, "");
  const right = compactFeedbackText(b).replace(/[.,!?;:'"()，。！？；：“”‘’]/g, "");
  return Boolean(left && right && left === right);
}

function isScoreImpactingDetailedCorrection(item = {}) {
  const original = item.originalSentence || item.original || "";
  const corrected = item.correctedSentence || item.corrected || "";
  const better = item.betterExpression || "";
  if (item.scoreImpacting === false) return false;
  if (isNoImpactFeedback(item.errorType) || isNoImpactFeedback(item.problem) || isNoImpactFeedback(item.rule) || isNoImpactFeedback(item.bandImpact)) return false;
  if (sameFeedbackText(original, corrected) && (!better || sameFeedbackText(original, better))) return false;
  return hasAnyText(original) || hasAnyText(corrected) || hasAnyText(item.problem) || hasAnyText(item.rule) || hasAnyText(better) || hasAnyText(item.bandImpact);
}

function looksLikeStrengthInProblem(value) {
  const text = compactFeedbackText(value);
  return Boolean(text && (
    text.includes("fully addresses") ||
    text.includes("addresses all") ||
    text.includes("covers all") ||
    text.includes("clear purpose") ||
    text.includes("appropriate tone") ||
    text.includes("well-developed") ||
    text.includes("well developed") ||
    text.includes("clear progression") ||
    text.includes("accurate language") ||
    text.includes("few errors")
  ) && !(
    text.includes("but") ||
    text.includes("however") ||
    text.includes("although") ||
    text.includes("needs") ||
    text.includes("missing") ||
    text.includes("limited")
  ));
}

function filteredMainProblems(items = [], translations = []) {
  const list = Array.isArray(items) ? items : [];
  const zhList = Array.isArray(translations) ? translations : [];
  const kept = [];
  const keptZh = [];
  list.forEach((item, index) => {
    if (!String(item || "").trim() || looksLikeStrengthInProblem(item)) return;
    kept.push(item);
    if (zhList[index]) keptZh.push(zhList[index]);
  });
  if (!kept.length) {
    return {
      items: ["No major problems were identified at this band; focus on refinement."],
      translations: []
    };
  }
  return { items: kept, translations: keptZh };
}

function renderDetailedSentenceCorrections(items = []) {
  const filtered = Array.isArray(items) ? items.filter(isScoreImpactingDetailedCorrection) : [];
  if (!filtered.length && Array.isArray(items) && items.length) {
    return collapsibleSection("逐句批改 Sentence Corrections", `<p class="muted">No score-affecting sentence-level errors were found.</p>`);
  }
  if (!filtered.length) return collapsibleSection("逐句批改 Sentence Corrections", `<p class="muted">No sentence-level corrections are available.</p>`);
  return collapsibleSection("逐句批改 Sentence Corrections", `
    <div class="correction-list">${filtered.map((item, index) => {
      const original = item.originalSentence || item.original || "";
      const corrected = item.correctedSentence || item.corrected || "";
      const better = item.betterExpression || "";
      return `<div class="correction-item">
        <p><strong>句子 ${escapeHtml(item.sentenceNumber || index + 1)}</strong></p>
        <p><strong>原句：</strong>${escapeHtml(original)}</p>
        <p><strong>修改句：</strong>${escapeHtml(corrected)} ${renderCopyButton(corrected)}</p>
        ${better ? `<p><strong>更好表达：</strong>${escapeHtml(better)} ${renderCopyButton(better)}</p>` : ""}
        <p><strong>错误类型：</strong>${escapeHtml(item.errorType || "")}${item.errorTypeZh ? ` / ${escapeHtml(item.errorTypeZh)}` : ""}</p>
        ${item.problem ? `<p><strong>问题：</strong>${escapeHtml(item.problem)}</p>` : ""}
        ${item.rule ? `<p><strong>规则：</strong>${escapeHtml(item.rule)}</p>` : ""}
        ${item.bandImpact ? `<p><strong>对分数影响：</strong>${escapeHtml(item.bandImpact)}</p>` : ""}
        ${renderZhToggle([item.problemZh, item.ruleZh, item.betterExpressionZh, item.bandImpactZh].filter(Boolean).join("\n"))}
      </div>`;
    }).join("")}</div>
  `);
}

function renderCorrectionPriority(priority) {
  if (!priority || typeof priority !== "object" || !hasAnyText(priority)) {
    return collapsibleSection("错误优先级", `<p class="muted">No correction priority was returned by AI.</p>`);
  }
  return collapsibleSection("错误优先级", `
    <div class="advice-grid">
      <div><h4>先改 Fix First</h4>${listHtml(priority.fixFirst)}${priority.fixFirstZh?.length ? renderZhToggle(priority.fixFirstZh.join("\n")) : ""}</div>
      <div><h4>再改 Fix Next</h4>${listHtml(priority.fixNext)}${priority.fixNextZh?.length ? renderZhToggle(priority.fixNextZh.join("\n")) : ""}</div>
      <div><h4>最后优化 Polish Later</h4>${listHtml(priority.polishLater)}${priority.polishLaterZh?.length ? renderZhToggle(priority.polishLaterZh.join("\n")) : ""}</div>
    </div>
  `);
}

function firstNonEmpty(...values) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const text = value.map((item) => typeof item === "object" ? flattenObjectText(item) : String(item || "").trim()).filter(Boolean).join("; ");
      if (text) return text;
      continue;
    }
    if (value && typeof value === "object") {
      const text = flattenObjectText(value);
      if (text) return text;
      continue;
    }
    const text = String(value ?? "").trim();
    if (text) return text;
  }
  return "";
}

function flattenObjectText(value, limit = 6) {
  if (!value || typeof value !== "object") return String(value ?? "").trim();
  const parts = [];
  Object.values(value).forEach((item) => {
    if (parts.length >= limit) return;
    if (Array.isArray(item)) {
      const text = item.map((x) => typeof x === "object" ? flattenObjectText(x, 3) : String(x || "").trim()).filter(Boolean).join("; ");
      if (text) parts.push(text);
    } else if (item && typeof item === "object") {
      const text = flattenObjectText(item, 3);
      if (text) parts.push(text);
    } else {
      const text = String(item ?? "").trim();
      if (text) parts.push(text);
    }
  });
  return parts.join("; ");
}

function normalizeCriterionUpgradeItem(item) {
  if (typeof item === "string") return { criterion: "", target: "", action: item.trim(), actionZh: "" };
  if (Array.isArray(item)) return { criterion: "", target: "", action: item.map((x) => String(x || "").trim()).filter(Boolean).join("; "), actionZh: "" };
  if (!item || typeof item !== "object") return null;
  const criterion = firstNonEmpty(
    item.criterion, item.name, item.item, item.project, item.category, item.area,
    item.skill, item.criteria, item.criterionName, item.bandCriterion, item.focusArea, item.section
  );
  const target = firstNonEmpty(
    item.target, item.targetBand, item.targetRange, item.goal, item.objective,
    item.aim, item.nextBand, item.bandTarget, item.targetLevel
  );
  let action = firstNonEmpty(
    item.action, item.advice, item.specificAction, item.specificActions,
    item.actionStep, item.actionSteps, item.steps, item.howToImprove,
    item.whatToDo, item.recommendation, item.suggestion, item.plan, item.detail, item.details
  );
  const currentWeakness = firstNonEmpty(
    item.currentWeakness, item.weakness, item.currentProblem, item.currentIssue,
    item.problem, item.gap, item.whyThisMatters
  );
  const exampleUpgrade = firstNonEmpty(
    item.exampleUpgrade, item.example, item.exampleAction, item.modelUpgrade,
    item.betterExample, item.targetBandExpression, item.upgradedExample
  );
  if (!action && hasAnyText(item)) action = flattenObjectText(item);
  const actionZh = firstNonEmpty(item.actionZh, item.adviceZh, item.specificActionZh, item.suggestionZh, item.howToImproveZh);
  if (!criterion && !target && !action) return null;
  return { criterion, currentWeakness, target, action, exampleUpgrade, actionZh };
}

function getPlanUpgradeSource(plan) {
  if (!plan || typeof plan !== "object") return [];
  const candidates = [
    plan.criterionUpgrades,
    plan.criteriaUpgrades,
    plan.criterionActions,
    plan.criteriaActions,
    plan.fourCriteriaActions,
    plan.fourCriterionActions,
    plan.upgrades,
    plan.actions,
    plan.actionPlan,
    plan.nextSteps
  ];
  for (const candidate of candidates) {
    if (Array.isArray(candidate) && candidate.length) return candidate;
  }
  return [];
}

function fallbackCriterionUpgrades(plan, result = {}) {
  const target = plan?.targetBandRange || plan?.target || "Next realistic band range";
  const first = selected?.task === "Task 1" ? "Task Achievement" : "Task Response";
  const criteriaNames = [first, "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"];
  const adviceMap = {
    [first]: result.taskAchievementAdvice,
    "Coherence and Cohesion": result.coherenceAdvice,
    "Lexical Resource": result.lexicalAdvice,
    "Grammatical Range and Accuracy": result.grammarAdvice
  };
  return criteriaNames.map((criterion) => {
    const criterionFeedback = result.criteria?.[criterion]?.howToImprove || result.criteria?.[criterion]?.feedback || "";
    const advice = Array.isArray(adviceMap[criterion]) ? adviceMap[criterion].filter(Boolean).join("; ") : "";
    const action = advice || criterionFeedback || "Use the criterion feedback above to make one concrete improvement in this area.";
    return {
      criterion,
      currentWeakness: criterionFeedback || "Use the criterion feedback above to identify the most important current weakness.",
      target,
      action,
      exampleUpgrade: "Apply the action to one paragraph or sentence, then repeat the same check across the whole response.",
      actionZh: ""
    };
  });
}

function targetImprovementPlanHasUsefulContent(plan) {
  if (!plan || typeof plan !== "object") return false;
  const upgrades = getPlanUpgradeSource(plan).map(normalizeCriterionUpgradeItem).filter(Boolean).filter((item) => item.action || item.criterion || item.target);
  return Boolean(
    String(plan.currentBand || plan.targetBandRange || plan.targetReason || "").trim() ||
    hasUsefulItemArray(plan.focus) ||
    hasUsefulItemArray(plan.practiceTasks) ||
    upgrades.length
  );
}

function renderTargetImprovementPlan(plan, result = {}) {
  if (!plan || typeof plan !== "object" || !targetImprovementPlanHasUsefulContent(plan)) {
    return collapsibleSection("下一阶段提分计划 Target Improvement Plan", `<p class="muted">No detailed improvement plan is available.</p>`);
  }
  let criterionUpgrades = getPlanUpgradeSource(plan).map(normalizeCriterionUpgradeItem).filter(Boolean).filter((item) => item.action || item.criterion || item.target);
  if (!criterionUpgrades.length) criterionUpgrades = fallbackCriterionUpgrades(plan, result);
  return collapsibleSection("下一阶段提分计划 Target Improvement Plan", `
    <div class="compact-facts">
      <p><strong>当前分数：</strong>${escapeHtml(plan.currentBand || result.overallBand || "")}</p>
      <p><strong>目标范围：</strong>${escapeHtml(plan.targetBandRange || plan.targetRange || plan.target || "")}</p>
      ${plan.targetReason ? `<p><strong>为什么是这个目标：</strong>${escapeHtml(plan.targetReason)}</p>` : ""}
    </div>
    ${Array.isArray(plan.focus) && plan.focus.length ? `<h4>这次最应该提升的点</h4>${renderListWithTranslations(plan.focus, plan.focusZh, "No target focus was returned.")}` : ""}
    ${collapsibleSection("四项提分动作", criterionUpgrades.length ? `<div class="correction-list">${criterionUpgrades.map((item) => `
        <div class="correction-item">
          <p><strong>项目：</strong>${escapeHtml(item.criterion || "General improvement")}</p>
          ${item.currentWeakness ? `<p><strong>Current weakness:</strong> ${escapeHtml(item.currentWeakness)}</p>` : ""}
          <p><strong>目标：</strong>${escapeHtml(item.target || plan.targetBandRange || "Next realistic band range")}</p>
          <p><strong>具体动作：</strong>${escapeHtml(item.action || "Use the feedback above to make this criterion stronger.")}</p>
          ${item.exampleUpgrade ? `<p><strong>Example upgrade:</strong> ${escapeHtml(item.exampleUpgrade)}</p>` : ""}
          ${renderZhToggle(item.actionZh || item.adviceZh || "")}
        </div>`).join("")}</div>` : `<p class="muted">No criterion upgrades were returned.</p>`)}
    ${collapsibleSection("练习任务", Array.isArray(plan.practiceTasks) && plan.practiceTasks.length ? renderListWithTranslations(plan.practiceTasks, plan.practiceTasksZh, "No practice tasks were returned.") : `<p class="muted">No practice tasks were returned.</p>`)}
  `);
}

function renderTask1LetterCorrections(corrections) {
  if (!corrections || typeof corrections !== "object" || !hasAnyText(corrections)) {
    return collapsibleSection("Task 1 书信专项修改", `<p class="muted">No detailed Task 1 letter corrections are available.</p>`);
  }
  const bulletAdvice = Array.isArray(corrections.bulletPointAdvice) ? corrections.bulletPointAdvice : [];
  return collapsibleSection("Task 1 书信专项修改", `
    <div class="compact-facts">
      <div><strong>Opening：</strong>${renderTextWithTranslation(corrections.openingComment || "暂无", corrections.openingCommentZh, { tag: "span" })}</div>
      <div><strong>Closing：</strong>${renderTextWithTranslation(corrections.closingComment || "暂无", corrections.closingCommentZh, { tag: "span" })}</div>
      <div><strong>Tone：</strong>${renderTextWithTranslation(corrections.toneComment || "暂无", corrections.toneCommentZh, { tag: "span" })}</div>
      <div><strong>Purpose：</strong>${renderTextWithTranslation(corrections.purposeComment || "暂无", corrections.purposeCommentZh, { tag: "span" })}</div>
    </div>
    ${bulletAdvice.length ? `<h4>Bullet point 建议</h4><div class="correction-list bullet-analysis-list">${bulletAdvice.map((item, index) => {
      const bulletPoint = firstNonEmpty(item.bulletPoint, item.requirement, item.point, item.taskRequirement, item.text) || `Bullet point ${index + 1}`;
      const evidence = firstNonEmpty(item.evidenceFromEssay, item.evidence, item.originalEvidence, item.quote);
      const problem = firstNonEmpty(item.problem, item.issue, item.missingDetail, item.reason);
      const comment = firstNonEmpty(item.comment, item.advice, item.suggestion, item.howToFix, item.recommendation);
      const sentence = firstNonEmpty(item.suggestedSentence, item.modelSentence, item.exampleSentence, item.fixSentence);
      const zh = safeChineseHelper(firstNonEmpty(item.explanationZh, item.commentZh, item.suggestionZh, item.reasonZh, item.suggestedSentenceZh), [bulletPoint, evidence, problem, comment, sentence].join(" "));
      return `<div class="correction-item bullet-analysis-item">
        <p><strong>要点：</strong>${escapeHtml(bulletPoint)}</p>
        <p><strong>是否覆盖：</strong>${boolText(item.covered)}</p>
        ${evidence ? `<p><strong>原文证据：</strong>${escapeHtml(evidence)}</p>` : ""}
        ${problem ? `<p><strong>具体问题：</strong>${escapeHtml(problem)}</p>` : ""}
        ${comment ? `<p><strong>建议：</strong>${escapeHtml(comment)}</p>` : ""}
        ${sentence ? `<p><strong>可用句：</strong>${escapeHtml(sentence)} ${renderCopyButton(sentence)}</p>` : ""}
        ${renderZhToggle(zh)}
      </div>`;
    }).join("")}</div>` : ""}
  `);
}

function renderTask2EssayCorrections(corrections) {
  if (!corrections || typeof corrections !== "object" || !hasAnyText(corrections)) {
    return collapsibleSection("Task 2 议论文专项修改", `<p class="muted">No detailed Task 2 essay corrections are available.</p>`);
  }
  return collapsibleSection("Task 2 议论文专项修改", `
    <div class="compact-facts">
      <div><strong>立场：</strong>${renderTextWithTranslation(corrections.positionComment || "暂无", corrections.positionCommentZh, { tag: "span" })}</div>
      <div><strong>开头段：</strong>${renderTextWithTranslation(corrections.introductionComment || "暂无", corrections.introductionCommentZh, { tag: "span" })}</div>
      <div><strong>主体段：</strong>${renderTextWithTranslation(corrections.bodyParagraphComment || "暂无", corrections.bodyParagraphCommentZh, { tag: "span" })}</div>
      <div><strong>例子：</strong>${renderTextWithTranslation(corrections.exampleComment || "暂无", corrections.exampleCommentZh, { tag: "span" })}</div>
      <div><strong>结论：</strong>${renderTextWithTranslation(corrections.conclusionComment || "暂无", corrections.conclusionCommentZh, { tag: "span" })}</div>
    </div>
    ${corrections.developmentAdvice?.length ? `<h4>展开建议</h4>${renderListWithTranslations(corrections.developmentAdvice, corrections.developmentAdviceZh, "No detailed task analysis is available for this response.")}` : ""}
  `);
}

function renderRevisionLimitWarning(result = {}) {
  const meta = result.revisedEssayMeta || {};
  if (!meta.revisionLimited) return "";
  const words = Number(result.actualWordCount ?? countWords(els.essayInput.value));
  const threshold = Number(result.wordCountThresholdUsed ?? targetWordsForPrompt(selected));
  const low = result.lowBandDiagnostics || {};
  const mismatch = result.taskMatchCheck?.appearsToAnswerSelectedPrompt === false;
  if (mismatch) return `<p class="ai-warning">文章可能没有回答当前选中的题目，因此评分会被限制。</p>`;
  if (words < threshold) return `<p class="ai-warning">原文字数明显不足，系统只提供基础诊断或基础修改版。</p>`;
  if (low.recommendedLowBandRange || low.littleRelevantMessage || low.meaningMostlyBlocked) return `<p class="ai-warning">原文可评分内容较少或偏离题目，系统只提供基础修改建议。</p>`;
  return "";
}

function renderSpellingCorrections(items = []) {
  const list = Array.isArray(items)
    ? items.filter((item) => item && (String(item.originalWord || "").trim() || String(item.correctedWord || "").trim() || String(item.sentence || "").trim() || String(item.explanation || "").trim()))
    : [];
  if (!list.length) return `<p class="muted">暂无拼写错误列表。</p>`;
  return `<div class="correction-list">${list.map((item) => `
    <div class="correction-item">
      <p><strong>Original word:</strong> ${escapeHtml(item.originalWord || "")}</p>
      <p><strong>Correct spelling:</strong> ${escapeHtml(item.correctedWord || "")} ${renderCopyButton(item.correctedWord || "")}</p>
      ${item.sentence ? `<p><strong>Sentence:</strong> ${escapeHtml(item.sentence)}</p>` : ""}
      <p><strong>Explanation:</strong> ${escapeHtml(item.explanation || "")}</p>
      ${renderZhToggle(item.explanationZh)}
    </div>`).join("")}</div>`;
}

function renderGrammarErrors(items = []) {
  const list = Array.isArray(items)
    ? items.filter((item) => item && (String(item.original || "").trim() || String(item.corrected || "").trim() || String(item.explanation || "").trim()))
    : [];
  if (!list.length) return `<p class="muted">暂无语法错误列表。</p>`;
  return `<div class="correction-list">${list.map((item) => `
    <div class="correction-item">
      <p><strong>Type:</strong> ${escapeHtml(item.type || "other")}</p>
      <p><strong>Original:</strong> ${escapeHtml(item.original || "")}</p>
      <p><strong>Corrected:</strong> ${escapeHtml(item.corrected || "")}</p>
      <p><strong>Explanation:</strong> ${escapeHtml(item.explanation || "")}</p>
      ${renderZhToggle(item.explanationZh)}
    </div>`).join("")}</div>`;
}

function renderSentenceCorrections(items = []) {
  const list = Array.isArray(items)
    ? items.filter((item) => item && (String(item.original || "").trim() || String(item.corrected || "").trim() || String(item.reason || "").trim()))
    : [];
  if (!list.length) return `<p class="muted">暂无句子级修改。</p>`;
  return `<div class="correction-list">${list.map((item) => `
    <div class="correction-item">
      <p><strong>Original:</strong> ${escapeHtml(item.original || "")}</p>
      <p><strong>Corrected:</strong> ${escapeHtml(item.corrected || "")}</p>
      <p><strong>Reason:</strong> ${escapeHtml(item.reason || "")}</p>
      ${renderZhToggle(item.reasonZh)}
    </div>`).join("")}</div>`;
}

function renderRevisionBlock(label, target, text) {
  const content = text ? `<pre>${escapeHtml(text)}</pre>` : `<p class="muted">后端暂未返回修改版作文。</p>`;
  const disabled = text ? "" : "disabled";
  return `<details class="feedback-collapse revision-block">
    <summary>${escapeHtml(label)}</summary>
    <div class="feedback-collapse-body">
    ${content}
    <div class="actions">
      <button class="secondary" type="button" data-revision-action="copy" data-target="${target}" ${disabled}>复制修改版</button>
      <button class="primary" type="button" data-revision-action="apply" data-target="${target}" ${disabled}>应用到作文输入区</button>
      <button class="secondary" type="button" data-revision-action="compare" data-target="${target}" ${disabled}>和原文对比</button>
    </div>
    </div>
  </details>`;
}

function renderGradingResult(result = {}) {
  const band5 = result.revisedEssayBand5 || "";
  const band6 = result.revisedEssayBand6 || "";
  const band7 = result.revisedEssayBand7 || "";
  const revisionMeta = result.revisedEssayMeta || {};
  const revisionNotesZh = Array.isArray(result.revisionNotesZh) ? result.revisionNotesZh.join("\n") : result.revisionNotesZh;
  els.gradingResults.dataset.band5 = band5;
  els.gradingResults.dataset.band6 = band6;
  els.gradingResults.dataset.band7 = band7;
  const taskAdviceTitle = selected?.task === "Task 1" ? "Task Achievement Advice" : "Task Response Advice";
  const mainProblems = filteredMainProblems(result.mainProblems, result.mainProblemsZh);
  els.gradingResults.innerHTML = `
    ${result.fallback ? `<p class="ai-warning">AI 返回内容不完整，系统已提供基础诊断。请稍后可再次点击批改获取完整反馈。</p>` : ""}
    <p class="ai-disclaimer">${escapeHtml(result.disclaimer || "This is an AI-generated estimated score and revision, not an official IELTS score.")}</p>
    ${renderFeedbackTools()}
    ${renderStageProgress(result)}
    ${renderTaskRequirementAnalysis(result.taskRequirementAnalysis, result.taskMatchCheck, result.taskRequirementAnalysisZh)}
    ${renderScoreCalibration(result.scoreCalibration, result.scoreCalibrationZh)}
    ${renderLowBandDiagnostics(result.lowBandDiagnostics, result.lowBandDiagnosticsZh)}
    ${renderHighBandDiagnostics(result.highBandDiagnostics, result.highBandDiagnosticsZh)}
    <section class="grading-section">
      <h4>Overall estimated band</h4>
      <div class="overall-wrap"><div class="overall-band">${escapeHtml(result.overallBand ?? "-")}</div>${renderTextWithTranslation(result.estimatedLevel || "", result.estimatedLevelZh, { tag: "span" })}</div>
    </section>
    <section class="grading-section">
      <h4>四项评分表</h4>
      ${renderCriteria(result.criteria)}
    </section>
    ${collapsibleSection("Strengths", renderListWithTranslations(result.strengths, result.strengthsZh, "No strengths were returned for this response."))}
    ${collapsibleSection("Main Problems", renderListWithTranslations(mainProblems.items, mainProblems.translations, "No major problems were identified at this band; focus on refinement."))}
    ${renderErrorAnalysis(result.errorAnalysis)}
    ${renderDetailedSentenceCorrections(result.detailedSentenceCorrections)}
    ${renderCorrectionPriority(result.correctionPriority)}
    ${renderTargetImprovementPlan(result.targetImprovementPlan, result)}
    ${selected?.task === "Task 1" ? renderTask1LetterCorrections(result.task1LetterCorrections) : renderTask2EssayCorrections(result.task2EssayCorrections)}
    ${collapsibleSection("拼写错误 Spelling Corrections", renderSpellingCorrections(result.spellingCorrections))}
    ${collapsibleSection("语法错误 Grammar Errors", renderGrammarErrors(result.grammarErrors))}
    ${collapsibleSection("Sentence Corrections", renderSentenceCorrections(result.sentenceCorrections))}
    ${collapsibleSection("四项专项建议", `<div class="advice-grid">
      <div><h4>${taskAdviceTitle}</h4>${renderListWithTranslations(result.taskAchievementAdvice, result.taskAchievementAdviceZh, "No task advice is available.")}</div>
      <div><h4>Coherence Advice</h4>${renderListWithTranslations(result.coherenceAdvice, result.coherenceAdviceZh, "No coherence advice is available.")}</div>
      <div><h4>Lexical Advice</h4>${renderListWithTranslations(result.lexicalAdvice, result.lexicalAdviceZh, "No lexical advice is available.")}</div>
      <div><h4>Grammar Advice</h4>${renderListWithTranslations(result.grammarAdvice, result.grammarAdviceZh, "No grammar advice is available.")}</div>
    </div>`)}
    ${collapsibleSection("Band 5 / Band 6 / Band 7 提分建议", `<div class="advice-grid">
      <div><h4>Band 5 保底建议</h4>${renderListWithTranslations(result.band5FixPlan, result.band5FixPlanZh, "No Band 5 plan is available.")}</div>
      <div><h4>Band 6+ 提升建议</h4>${renderListWithTranslations(result.band6UpgradePlan, result.band6UpgradePlanZh, "No Band 6 plan is available.")}</div>
      <div><h4>Band 7+ 高分建议</h4>${renderListWithTranslations(result.band7UpgradePlan, result.band7UpgradePlanZh, "No Band 7 plan is available.")}</div>
    </div>`)}
    ${collapsibleSection("Model answer outline", proseHtml(result.modelAnswerOutline) || `<p class="muted">No model answer outline was returned.</p>`)}
    ${collapsibleSection("AI 修改版作文 / Revised Essays", `
      <p class="revision-meta-note">修改版按 Band 5 / Band 6 / Band 7 分层生成，不是默认 9 分范文。</p>
      ${renderRevisionLimitWarning(result)}
      ${renderRevisionBlock("Band 5 Safe Revision", "band5", band5)}
      ${renderRevisionBlock("Band 6+ Upgrade Revision", "band6", band6)}
      ${renderRevisionBlock("Band 7+ High-score Revision", "band7", band7)}
      ${collapsibleSection("Revision notes", `${listHtml(result.revisionNotes)}${revisionNotesZh ? `<h4>修改重点中文说明</h4>${renderZhToggle(revisionNotesZh)}` : ""}`)}
    `)}`;
  els.gradingResults.querySelectorAll("[data-revision-action]").forEach((button) => {
    button.addEventListener("click", () => handleRevisionAction(button.dataset.revisionAction, button.dataset.target));
  });
  els.gradingResults.querySelectorAll("[data-copy-text]").forEach((button) => {
    button.addEventListener("click", async () => {
      await copyText(button.dataset.copyText || "");
      setGradingStatus("已复制", "done");
    });
  });
  bindZhToggles(els.gradingResults);
  bindFeedbackTools(els.gradingResults);
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const box = document.createElement("textarea");
    box.value = text;
    document.body.appendChild(box);
    box.select();
    document.execCommand("copy");
    box.remove();
  }
}

async function handleRevisionAction(action, target) {
  const revised = els.gradingResults.dataset[target] || "";
  if (!revised) return;
  if (action === "copy") {
    await copyText(revised);
    setGradingStatus("已复制修改版", "done");
    return;
  }
  if (action === "apply") {
    localStorage.setItem(storageKey(selected.id, "essay:backup"), els.essayInput.value);
    els.essayInput.value = revised;
    save(selected.id, "essay", revised);
    updateWords();
    setGradingStatus("已应用修改版，可使用撤回按钮恢复原文。", "done");
    return;
  }
  if (action === "compare") {
    const backup = localStorage.getItem(storageKey(selected.id, "essay:backup"));
    els.compareOriginalText.textContent = backup || els.essayInput.value;
    els.compareRevisedText.textContent = revised;
    els.revisionCompareArea.classList.remove("hidden");
    els.revisionCompareArea.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function restoreOriginalEssay() {
  if (!selected) return;
  const backup = localStorage.getItem(storageKey(selected.id, "essay:backup"));
  if (!backup) {
    setGradingStatus("没有可撤回的原文备份。", "error");
    return;
  }
  els.essayInput.value = backup;
  save(selected.id, "essay", backup);
  updateWords();
  setGradingStatus("已恢复到修改前版本。", "done");
}

function bind() {
  [els.bookFilter, els.testFilter, els.taskFilter, els.typeFilter].forEach((el) => el.addEventListener("change", renderList));
  els.searchInput.addEventListener("input", renderList);
  els.timerBtn.addEventListener("click", toggleTimer);
  els.resetTimerBtn.addEventListener("click", () => selected && resetTimer(selected.timeLimit));
  els.essayInput.addEventListener("input", () => { if (selected) save(selected.id, "essay", els.essayInput.value); updateWords(); });
  els.favoriteInput.addEventListener("input", () => selected && save(selected.id, "favorites", els.favoriteInput.value));
  els.copyBtn.addEventListener("click", copyEssay);
  els.clearBtn.addEventListener("click", () => { if (!selected) return; els.essayInput.value = ""; save(selected.id, "essay", ""); updateWords(); els.essayInput.focus(); });
  els.gradingEndpointInput.addEventListener("input", () => localStorage.setItem(GRADING_ENDPOINT_KEY, els.gradingEndpointInput.value.trim()));
  els.gradeBtn.addEventListener("click", startGrading);
  els.restoreOriginalBtn.addEventListener("click", restoreOriginalEssay);
  els.backBtn.addEventListener("click", () => document.querySelector(".list-panel").scrollIntoView({ behavior: "smooth" }));
  els.themeBtn.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    localStorage.setItem("ielts-gt-writing-hub:theme", next);
    els.themeBtn.textContent = next === "dark" ? "浅色模式" : "深色模式";
  });
}

function init() {
  initFilters();
  setupGradingModes();
  bind();
  els.gradingEndpointInput.value = localStorage.getItem(GRADING_ENDPOINT_KEY) || "";
  const theme = localStorage.getItem("ielts-gt-writing-hub:theme") || "light";
  document.documentElement.dataset.theme = theme;
  els.themeBtn.textContent = theme === "dark" ? "浅色模式" : "深色模式";
  renderList();
  const fromHash = location.hash.replace("#", "");
  if (fromHash && prompts.some((p) => p.id === fromHash)) selectPrompt(fromHash);
}

init();

})();
