(() => {
const DATA = window.IELTS_GT_DATA;
const prompts = DATA.prompts;
let selected = null;
let timerId = null;
let remaining = 0;
let currentLimit = 0;
const GRADING_ENDPOINT_KEY = "ielts-gt-writing-hub:gradingEndpoint";

const feedbackUiState = {
  zhMode: "none", // "none" | "expanded" | "collapsed"
  detailsMode: "none", // "none" | "expanded" | "collapsed"
  toolsOpen: false
};

const $ = (id) => document.getElementById(id);
const els = {
  themeBtn: $("themeBtn"), bookFilter: $("bookFilter"), testFilter: $("testFilter"), taskFilter: $("taskFilter"), typeFilter: $("typeFilter"), searchInput: $("searchInput"),
  promptList: $("promptList"), countLabel: $("countLabel"), emptyState: $("emptyState"), practiceView: $("practiceView"), metaTags: $("metaTags"), sourceStatus: $("sourceStatus"), practiceTitle: $("practiceTitle"), practicePrompt: $("practicePrompt"), infoGrid: $("infoGrid"), timerDisplay: $("timerDisplay"), timerBtn: $("timerBtn"), resetTimerBtn: $("resetTimerBtn"), planArea: $("planArea"), essayInput: $("essayInput"), wordCount: $("wordCount"), wordTarget: $("wordTarget"), copyBtn: $("copyBtn"), clearBtn: $("clearBtn"), statusText: $("statusText"), favoriteInput: $("favoriteInput"), structureList: $("structureList"), bandTips: $("bandTips"), phraseKicker: $("phraseKicker"), phraseTitle: $("phraseTitle"), phraseGroups: $("phraseGroups"), backBtn: $("backBtn"), gradingEndpointInput: $("gradingEndpointInput"), gradingModeSelect: $("gradingModeSelect"), gradeBtn: $("gradeBtn"), gradingStatus: $("gradingStatus"), gradingResults: $("gradingResults"), restoreOriginalBtn: $("restoreOriginalBtn"), revisionCompareArea: $("revisionCompareArea"), compareOriginalText: $("compareOriginalText"), compareRevisedText: $("compareRevisedText")
};

function unique(items) { return [...new Set(items)]; }
function ensureArray(value) {
  if (Array.isArray(value)) {
    return value.filter((item) => item !== null && item !== undefined && item !== "");
  }
  if (value === null || value === undefined || value === "") return [];
  return [value];
}
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

function compactTranslationCompare(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[\s"'“”‘’`.,;:!?，。；：！？、()（）\[\]【】<>《》-]/g, "");
}

function translationRepeatsEnglish(chineseText, englishText) {
  const zh = String(chineseText || "").trim();
  const en = String(englishText || "").trim();
  if (!zh || !en) return false;
  const compactZh = compactTranslationCompare(zh);
  const compactEn = compactTranslationCompare(en);
  if (!compactZh || !compactEn) return false;
  if (compactZh === compactEn) return true;
  if (compactEn.length >= 18 && compactZh.includes(compactEn)) return true;
  if (/^[\u4e00-\u9fa5\s：:，,]*[A-Za-z]/.test(zh) && compactZh.length >= compactEn.length * 0.75) return true;
  return false;
}

function fallbackEvidenceZh(label, englishText) {
  const text = String(englishText || "").trim();
  if (!text) return "";
  const normalized = String(label || "").toLowerCase();
  if (normalized.includes("quote")) return "这是一处原文证据，用来支持当前评分判断；请结合英文原句查看它体现的内容、结构、词汇或语法问题。";
  if (normalized.includes("positive")) return "这是正面评分证据，说明这一项并非完全缺失，仍有可计分的表现。";
  if (normalized.includes("limiting")) return "这是限制分数的证据，说明这一项还没有稳定达到更高分档。";
  if (normalized.includes("why this")) return "这里解释当前分数为什么成立：系统根据正面表现和限制因素共同判断。";
  if (normalized.includes("why not higher")) return "这里解释为什么暂时不能给更高分：仍有影响该评分项的明显限制。";
  if (normalized.includes("why not lower")) return "这里解释为什么没有更低：原文仍有足够表现支撑当前分数。";
  return "这里是该项反馈的中文说明。";
}

function normalizeEvidenceZh(label, englishText, chineseText) {
  const zh = Array.isArray(chineseText) ? chineseText.filter(Boolean).join("\n") : String(chineseText || "").trim();
  if (!zh || translationRepeatsEnglish(zh, englishText)) return fallbackEvidenceZh(label, englishText);
  return zh;
}

function translatedListHtml(items, zhItems, label = "") {
  const english = Array.isArray(items) ? items.filter(Boolean) : [];
  const chinese = Array.isArray(zhItems) ? zhItems : [];
  if (!english.length) return `<p class="muted">暂无内容</p>`;
  return `<ul>${english.map((item, index) => {
    const zh = normalizeEvidenceZh(label, item, chinese[index]);
    return `<li><span class="evidence-item-text">${escapeHtml(item)}</span>${hasTranslationValue(zh) ? renderZhToggle(zh) : ""}</li>`;
  }).join("")}</ul>`;
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

function coverageText(value) {
  if (value === null || value === undefined || value === "") return "待 AI 核验";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (["unknown", "not returned", "uncertain", "needs check", "coverage unknown"].includes(normalized)) return "待 AI 核验";
  }
  return boolText(value);
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
  let candidates = candidateSource
    .split(/\r?\n|;/)
    .map(clean)
    .filter((part) => /^(give|explain|describe|say|tell|ask|suggest|apologise|apologize|thank|invite|offer|request|remind|include|state|mention|why|what|how)/i.test(part));
  if (!candidates.length) {
    const matches = [];
    const pattern = /(?:^|[.;:\n])\s*(say|tell|explain|describe|suggest|ask|give|thank|apologise|apologize|invite|offer|request|state|mention)\b[^.\n;]+/gi;
    let match;
    while ((match = pattern.exec(candidateSource)) && matches.length < 5) matches.push(clean(match[0]));
    candidates = matches;
  }
  return candidates.filter(Boolean).slice(0, 5);
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
  const simpleText = firstNonEmpty(item.text, item.english, item.en, item.content, item.statement);
  const simpleZh = firstNonEmpty(item.zh, item.chinese, item.cn, item.textZh, item.explanationZh, zhFallback);
  const objectKeys = Object.keys(item || {});
  const isSimplePairedItem = simpleText && objectKeys.every((key) => ["text", "english", "en", "content", "statement", "zh", "chinese", "cn", "textZh", "explanationZh"].includes(key));
  if (isSimplePairedItem) {
    return renderTextWithTranslation(simpleText, simpleZh || "AI 未返回这一项的中文解释；请重试对应阶段。", { tag: "span" });
  }
  const title = firstNonEmpty(item.title, item.item, item.area, item.criterion, item.category, item.focus, item.point, item.issueType);
  const weakness = firstNonEmpty(item.currentWeakness, item.weakness, item.problem, item.issue, item.gap, item.currentProblem);
  const target = firstNonEmpty(item.target, item.targetBand, item.goal, item.objective, item.nextBand, item.targetLevel);
  const action = firstNonEmpty(item.action, item.advice, item.suggestion, item.howToImprove, item.howToFix, item.specificAction, item.recommendation, item.comment);
  const example = firstNonEmpty(item.example, item.exampleUpgrade, item.suggestedSentence, item.modelSentence, item.betterExpression, item.targetBandExpression);
  const impact = firstNonEmpty(item.bandImpact, item.impactOnBand, item.whyThisAffectsBand, item.scoreImpact, item.reason);
  const zh = safeChineseHelper([
    item.currentWeaknessZh,
    item.weaknessZh,
    item.problemZh,
    item.targetZh,
    item.actionZh,
    item.adviceZh,
    item.suggestionZh,
    item.howToImproveZh,
    item.howToFixZh,
    item.commentZh,
    item.exampleUpgradeZh,
    item.exampleZh,
    item.impactOnBandZh,
    item.bandImpactZh,
    item.reasonZh,
    zhFallback
  ].filter(Boolean).join("\n"), [title, weakness, target, action, example, impact].join(" "));
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

function itemChineseFallback(item, zhList, index) {
  if (item && typeof item === "object") {
    return firstNonEmpty(
      item.zh,
      item.chinese,
      item.cn,
      item.textZh,
      item.explanationZh,
      item.commentZh,
      item.problemZh,
      item.reasonZh,
      item.adviceZh,
      item.actionZh,
      Array.isArray(zhList) ? zhList[index] : ""
    );
  }
  return Array.isArray(zhList) ? zhList[index] : "";
}

function renderListWithTranslations(items, translations, fallbackText) {
  const list = Array.isArray(items) ? items.filter((item) => hasAnyText(item)) : [];
  const zhList = Array.isArray(translations) ? translations : [];
  if (!list.length) return `<p class="muted">${escapeHtml(fallbackText || "No content is available.")}</p>`;
  return `<ul class="detailed-advice-list">${list.map((item, index) => {
    const zh = itemChineseFallback(item, zhList, index);
    const rendered = renderAdviceObject(item, zh);
    if (hasTranslationValue(zh) || (item && typeof item === "object" && hasTranslationValue(firstNonEmpty(item.zh, item.chinese, item.cn, item.textZh, item.explanationZh)))) {
      return `<li>${rendered}</li>`;
    }
    const plain = typeof item === "object" ? firstNonEmpty(item.text, item.english, item.en, item.content, item.statement, flattenObjectText(item)) : item;
    return `<li>${renderTextWithTranslation(plain, "AI 未返回这一项的中文解释；请重试对应阶段。", { tag: "span" })}</li>`;
  }).join("")}</ul>`;
}

function bindZhToggles(scope) {
  scope.querySelectorAll(".zh-toggle").forEach((button) => {
    button.addEventListener("click", () => {
      feedbackUiState.zhMode = "none";
      const note = button.nextElementSibling;
      if (!note) return;
      const isHidden = note.classList.toggle("hidden");
      button.setAttribute("aria-expanded", String(!isHidden));
      button.textContent = isHidden ? "中文解释" : "收起中文";
    });
  });
}


function renderFeedbackTools() {
  return `<details class="grading-tools grading-tools-menu"${feedbackUiState.toolsOpen ? " open" : ""}>
    <summary class="secondary grading-tools-summary">反馈工具</summary>
    <div class="grading-tools-panel" role="toolbar" aria-label="AI feedback tools">
      <button class="secondary" type="button" data-feedback-tool="expand-zh">展开全部中文</button>
      <button class="secondary" type="button" data-feedback-tool="collapse-zh">收起全部中文</button>
      <button class="secondary" type="button" data-feedback-tool="expand-details">展开全部折叠</button>
      <button class="secondary" type="button" data-feedback-tool="collapse-details">收起全部折叠</button>
    </div>
  </details>`;
}

function setAllZhPanels(scope, expanded) {
  feedbackUiState.zhMode = expanded ? "expanded" : "collapsed";
  scope.querySelectorAll(".zh-toggle").forEach((button) => {
    const note = button.nextElementSibling;
    if (!note) return;
    note.classList.toggle("hidden", !expanded);
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "收起中文" : "中文解释";
  });
}

function setAllDetails(scope, expanded) {
  feedbackUiState.detailsMode = expanded ? "expanded" : "collapsed";
  scope.querySelectorAll("details.feedback-collapse").forEach((detail) => {
    detail.open = expanded;
  });
}

function applyFeedbackUiState(scope) {
  const tools = scope.querySelector(".grading-tools-menu");
  if (tools) tools.open = Boolean(feedbackUiState.toolsOpen);
  if (feedbackUiState.zhMode === "expanded") applyAllZhPanels(scope, true);
  if (feedbackUiState.zhMode === "collapsed") applyAllZhPanels(scope, false);
  if (feedbackUiState.detailsMode === "expanded") applyAllDetails(scope, true);
  if (feedbackUiState.detailsMode === "collapsed") applyAllDetails(scope, false);
}

function applyAllZhPanels(scope, expanded) {
  scope.querySelectorAll(".zh-toggle").forEach((button) => {
    const note = button.nextElementSibling;
    if (!note) return;
    note.classList.toggle("hidden", !expanded);
    button.setAttribute("aria-expanded", String(expanded));
    button.textContent = expanded ? "收起中文" : "中文解释";
  });
}

function applyAllDetails(scope, expanded) {
  scope.querySelectorAll("details.feedback-collapse").forEach((detail) => {
    detail.open = expanded;
  });
}

function bindFeedbackTools(scope) {
  scope.querySelectorAll(".grading-tools-menu").forEach((menu) => {
    menu.addEventListener("toggle", () => {
      feedbackUiState.toolsOpen = menu.open;
    });
  });
  scope.querySelectorAll("details.feedback-collapse").forEach((detail) => {
    detail.addEventListener("toggle", () => {
      feedbackUiState.detailsMode = "none";
    });
  });
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



function richTextScore(value) {
  const text = String(value || "").trim();
  if (!text) return 0;
  const words = text.split(/\s+/).filter(Boolean).length;
  const specifics = /(because|however|for example|specific|evidence|band|task|grammar|vocabulary|paragraph|coherence|lexical|sentence|development|position|bullet|tone|reason|example)/i.test(text) ? 12 : 0;
  return text.length + words * 2 + specifics;
}

function preferRicherText(existing, incoming) {
  const oldText = String(existing || "").trim();
  const newText = String(incoming || "").trim();
  if (!oldText) return newText;
  if (!newText) return oldText;
  return richTextScore(newText) > richTextScore(oldText) * 1.12 ? newText : oldText;
}

function mergeUniqueArray(existing, incoming, limit = 12) {
  const toList = (value) => Array.isArray(value) ? value : (value === null || value === undefined || value === "" ? [] : [value]);
  const out = [];
  const seen = new Set();
  [...toList(existing), ...toList(incoming)].forEach((item) => {
    if (!hasAnyText(item)) return;
    const key = typeof item === "object" ? JSON.stringify(item) : String(item).trim();
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(item);
  });
  return out.slice(0, limit);
}

function mergeCriterionItem(existing = {}, incoming = {}, options = {}) {
  const keepBand = options.keepBand !== false;
  const merged = { ...(existing && typeof existing === "object" ? existing : {}) };
  const incomingObj = incoming && typeof incoming === "object" ? incoming : {};
  Object.entries(incomingObj).forEach(([key, value]) => {
    if (key === "band" && keepBand && typeof merged.band !== "undefined") return;
    if (Array.isArray(value)) {
      const limit = /evidenceQuotes/i.test(key) ? 3 : /Evidence/i.test(key) ? 6 : 12;
      merged[key] = mergeUniqueArray(merged[key], value, limit);
    } else if (value && typeof value === "object") {
      merged[key] = { ...(merged[key] && typeof merged[key] === "object" ? merged[key] : {}), ...value };
    } else if (typeof value === "string") {
      if (["feedback", "feedbackZh", "howToImprove", "howToImproveZh", "whyThisBand", "whyThisBandZh", "whyNotHigher", "whyNotHigherZh", "whyNotLower", "whyNotLowerZh"].includes(key)) {
        merged[key] = preferRicherText(merged[key], value);
      } else if (value.trim()) {
        merged[key] = value;
      }
    } else if (typeof value !== "undefined" && value !== null) {
      merged[key] = value;
    }
  });
  return merged;
}

function mergeCriteriaPreservingRichText(existingCriteria = {}, incomingCriteria = {}, options = {}) {
  const merged = { ...(existingCriteria && typeof existingCriteria === "object" ? existingCriteria : {}) };
  Object.entries(incomingCriteria && typeof incomingCriteria === "object" ? incomingCriteria : {}).forEach(([name, incoming]) => {
    merged[name] = mergeCriterionItem(merged[name], incoming, options);
  });
  return merged;
}

function mergeAiStageResult(base, incoming) {
  const output = base && typeof base === "object" ? { ...base } : {};
  const data = incoming && typeof incoming === "object" ? incoming : {};
  const incomingStage = data.aiStage || "";
  const isCoreScoreStage = incomingStage === "score" || incomingStage === "all" || (!incomingStage && !output.criteria);
  const isFinalScoreStage = incomingStage === "final-plan" || incomingStage === "final-score" || incomingStage === "final-reconciliation" || data.scoreFinalized === true;
  const canUpdateScores = isCoreScoreStage || isFinalScoreStage;
  const lockScores = !canUpdateScores && Boolean(output.criteria || output.overallBand);
  const scoreLockedObjectFields = new Set(["scoreCalculation", "scoringSystem", "mockWritingScore", "task1Result", "task2Result", "finalCriteria"]);
  const arrayFields = [
    "spellingCorrections", "grammarErrors", "sentenceCorrections", "detailedSentenceCorrections",
    "taskAchievementAdvice", "taskAchievementAdviceZh", "coherenceAdvice", "coherenceAdviceZh",
    "lexicalAdvice", "lexicalAdviceZh", "grammarAdvice", "grammarAdviceZh",
    "band5FixPlan", "band5FixPlanZh", "band6UpgradePlan", "band6UpgradePlanZh",
    "band7UpgradePlan", "band7UpgradePlanZh", "revisionNotes", "revisionNotesZh",
    "strengths", "strengthsZh", "mainProblems", "mainProblemsZh", "strengthItems", "mainProblemItems", "betterExpressionItems", "stageWarnings", "stageProgress"
  ];
  const objectFields = [
    "errorAnalysis", "correctionPriority", "targetImprovementPlan", "task1LetterCorrections",
    "task2EssayCorrections", "revisedEssayMeta", "taskRequirementAnalysis", "taskRequirementAnalysisZh",
    "scoreCalibration", "scoreCalibrationZh", "halfBandBoundary", "lowBandDiagnostics", "lowBandDiagnosticsZh",
    "highBandDiagnostics", "highBandDiagnosticsZh", "taskMatchCheck", "wordCountWarning",
    "scoreCalculation", "scoringSystem", "mockWritingScore", "task1Result", "task2Result", "finalCriteria"
  ];
  arrayFields.forEach((field) => {
    if (Array.isArray(data[field]) && data[field].length) {
      const limit = /detailedSentenceCorrections/i.test(field) ? 80
        : /betterExpressionItems/i.test(field) ? 80
        : /(sentenceCorrections|grammarErrors|spellingCorrections)/i.test(field) ? 80
        : /(Advice|Plan|Problems|strengths)/i.test(field) ? 18
        : 16;
      output[field] = mergeUniqueArray(output[field], data[field], limit);
    }
  });
  objectFields.forEach((field) => {
    if (lockScores && scoreLockedObjectFields.has(field)) return;
    if (data[field] && typeof data[field] === "object") output[field] = { ...(output[field] || {}), ...data[field] };
  });
  [
    "revisedEssayBand5", "revisedEssayBand6", "revisedEssayBand7", "modelAnswerOutline",
    "correctionWarning", "correctionPassWarning", "revisionWarning", "gradingWarning", "sectionWarning", "disclaimer"
  ].forEach((field) => {
    if (typeof data[field] === "string" && data[field].trim()) output[field] = preferRicherText(output[field], data[field]);
  });

  const canReplaceCriteria = data.criteria && typeof data.criteria === "object" && (
    canUpdateScores || !output.criteria
  );
  if (canReplaceCriteria) {
    output.criteria = output.criteria
      ? mergeCriteriaPreservingRichText(output.criteria, data.criteria, { keepBand: !canUpdateScores })
      : data.criteria;
  } else if (data.criteria && typeof data.criteria === "object") {
    // Later diagnostic stages may enrich feedback/evidence, but they must never change criterion bands.
    output.criteria = mergeCriteriaPreservingRichText(output.criteria || {}, data.criteria, { keepBand: true });
  }

  const mayReplaceScore = !output.overallBand || canUpdateScores;
  if (mayReplaceScore && typeof data.overallBand !== "undefined") output.overallBand = data.overallBand;
  if (mayReplaceScore && typeof data.estimatedLevel !== "undefined") output.estimatedLevel = data.estimatedLevel;
  const calculatedBand = Number(output.scoreCalculation?.finalBand ?? output.mockWritingScore?.mockWritingBand);
  if (mayReplaceScore && Number.isFinite(calculatedBand) && calculatedBand > 0) {
    output.overallBand = calculatedBand;
    output.estimatedLevel = `Band ${formatMockBand(calculatedBand)}`;
  }
  if (typeof data.scoreFinalized !== "undefined") output.scoreFinalized = Boolean(data.scoreFinalized);
  if (typeof data.scoreSource !== "undefined") output.scoreSource = data.scoreSource;
  if (typeof data.finalScoreSource !== "undefined") output.finalScoreSource = data.finalScoreSource;
  if (typeof data.finalOverallBand !== "undefined") output.finalOverallBand = data.finalOverallBand;
  if (typeof data.scoreChanged !== "undefined") output.scoreChanged = data.scoreChanged;
  if (typeof data.scoreChangeReason !== "undefined") output.scoreChangeReason = data.scoreChangeReason;
  if (typeof data.scoreChangeReasonZh !== "undefined") output.scoreChangeReasonZh = data.scoreChangeReasonZh;
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

function hasMatchingTranslationArray(items, translations) {
  const en = Array.isArray(items) ? items.filter((item) => hasAnyText(item)) : [];
  if (!en.length) return true;
  const zh = Array.isArray(translations) ? translations.filter((item) => hasAnyText(item)) : [];
  return zh.length >= en.length;
}

function adviceTranslationsComplete(data = {}) {
  return (
    hasMatchingTranslationArray(data.taskAchievementAdvice, data.taskAchievementAdviceZh) &&
    hasMatchingTranslationArray(data.coherenceAdvice, data.coherenceAdviceZh) &&
    hasMatchingTranslationArray(data.lexicalAdvice, data.lexicalAdviceZh) &&
    hasMatchingTranslationArray(data.grammarAdvice, data.grammarAdviceZh) &&
    hasMatchingTranslationArray(data.band5FixPlan, data.band5FixPlanZh) &&
    hasMatchingTranslationArray(data.band6UpgradePlan, data.band6UpgradePlanZh) &&
    hasMatchingTranslationArray(data.band7UpgradePlan, data.band7UpgradePlanZh)
  );
}

function stageResultHasExpectedContent(aiStage, data = {}) {
  if (!data || typeof data !== "object") return false;
  if (aiStage === "score") {
    return Boolean(data.criteria && typeof data.criteria === "object" && Number(data.overallBand) > 0);
  }
  if (aiStage === "prompt-analysis") {
    return Boolean(hasAnyText(data.taskRequirementAnalysis) || hasAnyText(data.taskMatchCheck));
  }
  if (aiStage === "half-band-summary") {
    return Boolean(hasAnyText(data.scoreCalibration) || hasAnyText(data.halfBandBoundary) || hasUsefulItemArray(data.strengthItems) || hasUsefulItemArray(data.mainProblemItems));
  }
  if (aiStage === "criterion-boundary" || aiStage === "score-boundary") {
    const criteria = data.criteria && typeof data.criteria === "object" ? data.criteria : {};
    return Boolean(hasAnyText(data.halfBandBoundary) || Object.values(criteria).some((item) => hasAnyText(item?.whyThisBand) || hasAnyText(item?.whyNotHigher) || hasAnyText(item?.whyNotLower)));
  }
  if (aiStage === "task-diagnosis") {
    return Boolean(hasUsefulItemArray(data.taskAchievementAdvice) || hasAnyText(data.task1LetterCorrections) || hasAnyText(data.task2EssayCorrections) || hasAnyText(data.errorAnalysis?.summary));
  }
  if (aiStage === "coherence-diagnosis") {
    return Boolean(hasUsefulItemArray(data.coherenceAdvice) || hasAnyText(data.criteria?.["Coherence and Cohesion"]) || hasAnyText(data.errorAnalysis?.summary));
  }
  if (aiStage === "spelling-wordform") {
    return Boolean(data.stageStatus === "no_issues" || hasUsefulItemArray(data.spellingCorrections) || hasUsefulItemArray(data.spellingWordformSentenceIssues) || hasUsefulItemArray(data.detailedSentenceCorrections) || hasAnyText(data.noIssueReason) || hasAnyText(data.errorAnalysis?.summary));
  }
  if (aiStage === "lexical-choice-collocation" || aiStage === "lexical-diagnosis") {
    return Boolean(hasUsefulItemArray(data.lexicalAdvice) || hasUsefulItemArray(data.spellingCorrections) || hasUsefulItemArray(data.detailedSentenceCorrections) || hasAnyText(data.criteria?.["Lexical Resource"]) || hasAnyText(data.errorAnalysis?.summary));
  }
  if (aiStage === "grammar-diagnosis") {
    return Boolean(hasUsefulItemArray(data.grammarErrors) || hasUsefulItemArray(data.grammarAdvice) || hasAnyText(data.criteria?.["Grammatical Range and Accuracy"]) || hasAnyText(data.errorAnalysis?.summary));
  }
  if (aiStage === "sentence-corrections") {
    return Boolean(hasUsefulItemArray(data.sentenceCorrections) || hasUsefulItemArray(data.detailedSentenceCorrections));
  }
  if (aiStage === "better-expressions") {
    const detailed = Array.isArray(data.detailedSentenceCorrections) ? data.detailedSentenceCorrections : [];
    return Boolean(detailed.some((item) => hasAnyText(item?.betterExpression)) || hasUsefulItemArray(data.betterExpressionItems));
  }
  if (aiStage === "better-expression-plan") {
    const detailed = Array.isArray(data.detailedSentenceCorrections) ? data.detailedSentenceCorrections : [];
    return Boolean(detailed.some((item) => hasAnyText(item?.betterExpression)) || targetImprovementPlanHasUsefulContent(data.targetImprovementPlan) || hasAnyText(data.correctionPriority));
  }
  if (aiStage === "final-plan") {
    return Boolean(data.scoreFinalized || (data.criteria && Object.values(data.criteria || {}).filter((item) => Number.isFinite(Number(item?.band))).length >= 4));
  }
  if (aiStage === "language-correction" || aiStage === "correction-language" || aiStage === "correction") {
    return hasDetailedFeedbackContent(data);
  }
  if (aiStage === "evidence-map" || aiStage === "evidence-plan") {
    const criteria = data.criteria && typeof data.criteria === "object" ? data.criteria : {};
    const hasCriterionEvidence = Object.values(criteria).some((item) => item && typeof item === "object" && (
      hasUsefulItemArray(item.evidenceQuotes) || hasUsefulItemArray(item.positiveEvidence) || hasUsefulItemArray(item.limitingEvidence) || hasAnyText(item.whyThisBand)
    ));
    return Boolean(
      hasCriterionEvidence ||
      hasAnyText(data.taskRequirementAnalysis) ||
      hasAnyText(data.taskMatchCheck) );
  }
  if (aiStage === "final-plan") {
    return Boolean(
      hasDetailedAdviceContent(data) ||
      targetImprovementPlanHasUsefulContent(data.targetImprovementPlan) ||
      hasAnyText(data.correctionPriority)
    );
  }
  if (aiStage === "revision") {
    return Boolean(data.revisedEssayBand5 || data.revisedEssayBand6 || data.revisedEssayBand7 || data.modelAnswerOutline);
  }
  // Backward-compatible checks for older endpoints/stages.
  if (aiStage === "correction-task") {
    const hasTaskContent = Boolean(
      hasUsefulItemArray(data.taskAchievementAdvice) ||
      hasUsefulItemArray(data.coherenceAdvice) ||
      hasAnyText(data.task1LetterCorrections) ||
      hasAnyText(data.task2EssayCorrections) ||
      hasAnyText(data.errorAnalysis?.summary)
    );
    return hasTaskContent &&
      hasMatchingTranslationArray(data.taskAchievementAdvice, data.taskAchievementAdviceZh) &&
      hasMatchingTranslationArray(data.coherenceAdvice, data.coherenceAdviceZh);
  }
  if (aiStage === "correction-vocabulary") {
    return hasUsefulItemArray(data.spellingCorrections) || hasUsefulItemArray(data.lexicalAdvice) || hasUsefulItemArray(data.detailedSentenceCorrections) || hasAnyText(data.errorAnalysis?.summary);
  }
  if (aiStage === "improvement-plan" || aiStage === "correction-advice") {
    return hasDetailedAdviceContent(data) && adviceTranslationsComplete(data);
  }
  if (aiStage === "correction-spelling") {
    return hasUsefulItemArray(data.spellingCorrections) || hasAnyText(data.errorAnalysis?.summary);
  }
  if (aiStage === "correction-grammar") {
    return hasUsefulItemArray(data.grammarErrors) ||
      hasUsefulItemArray(data.detailedSentenceCorrections) ||
      hasUsefulItemArray(data.grammarAdvice) ||
      hasAnyText(data.errorAnalysis?.summary);
  }
  if (aiStage === "correction-sentence") {
    return hasUsefulItemArray(data.sentenceCorrections) || hasUsefulItemArray(data.detailedSentenceCorrections);
  }
  return true;
}

function hasDetailedFeedbackContent(result = {}) {
  return Boolean(
    hasUsefulItemArray(result.spellingCorrections) ||
    hasUsefulItemArray(result.grammarErrors) ||
    hasUsefulItemArray(result.sentenceCorrections) ||
    hasUsefulItemArray(result.detailedSentenceCorrections) ||
    hasUsefulItemArray(result.corrections) ||
    hasUsefulItemArray(result.languageCorrections) ||
    hasUsefulItemArray(result.sentenceLevelCorrections) ||
    hasUsefulItemArray(result.sentenceFeedback)
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
  // Full grading now runs 13 smaller AI stages. Revision mode adds one optional AI stage for model/revised essays.
  const totalSteps = payload.mode === "revision" ? 14 : 13;
  let result = null;
  const stageWarnings = [];
  const stageProgress = [];

  function syncStageMeta() {
    if (!result) return;
    result.stageWarnings = stageWarnings.slice();
    result.stageProgress = stageProgress.slice();
  }

  function markStage(label, state, message, detail = "") {
    stageProgress.push({ label, state, message, detail, at: new Date().toISOString() });
    syncStageMeta();
  }

  async function runMergeStage(aiStage, statusText, warningPrefix, options = {}) {
    markStage(warningPrefix, "running", statusText);
    try {
      const stageResult = await postAiStage(endpoint, { ...payload, currentOverallBand: result?.overallBand, currentResult: result || null }, aiStage, statusText);
      const hasExpectedContent = stageResultHasExpectedContent(aiStage, stageResult);
      result = mergeAiStageResult(result || {}, stageResult);

      if (!hasExpectedContent) {
        const warning = `${warningPrefix}：AI 已返回，但没有提供这一阶段的完整结构化内容。`;
        stageWarnings.push(warning);
        markStage(warningPrefix, "warning", warning, JSON.stringify(stageResult || {}).slice(0, 1200));
      } else if (stageResult?.stageStatus === "no_issues") {
        markStage(warningPrefix, "done", `${warningPrefix}已完成：${stageResult.noIssueReasonZh || stageResult.noIssueReason || "未发现明显问题。"}`);
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
        markStage(warningPrefix, options.required ? "error" : "warning", warning, stageError.stack || stageError.message || "");
        syncStageMeta();
        renderGradingResult(result);
      }
      if (options.required) throw stageError;
      return false;
    }
  }

  try {
    await runMergeStage("prompt-analysis", `第 1 步/${totalSteps}：AI 正在分析题目要求`, "题目要求分析", { required: true });
    await runMergeStage("score", `第 2 步/${totalSteps}：AI 正在进行内部评分信号分析（暂不展示分数）`, "评分信号分析", { required: true });
    await runMergeStage("half-band-summary", `第 3 步/${totalSteps}：AI 正在整理半分边界信号`, "半分边界信号");
    await runMergeStage("criterion-boundary", `第 4 步/${totalSteps}：AI 正在逐项整理四项评分边界证据`, "四项边界证据");
    await runMergeStage("evidence-map", `第 5 步/${totalSteps}：AI 正在提取评分证据`, "评分证据");
    await runMergeStage("task-diagnosis", `第 6 步/${totalSteps}：AI 正在诊断任务回应/任务完成`, "任务回应诊断");
    await runMergeStage("coherence-diagnosis", `第 7 步/${totalSteps}：AI 正在诊断结构与衔接`, "结构与衔接诊断");
    await runMergeStage("spelling-wordform", `第 8 步/${totalSteps}：AI 正在检查拼写和词形`, "拼写和词形诊断");
    await runMergeStage("lexical-choice-collocation", `第 9 步/${totalSteps}：AI 正在检查用词、搭配和重复`, "词汇选择和搭配诊断");
    await runMergeStage("grammar-diagnosis", `第 10 步/${totalSteps}：AI 正在诊断语法范围和准确性`, "语法诊断");
    await runMergeStage("sentence-corrections", `第 11 步/${totalSteps}：AI 正在生成逐句批改`, "逐句批改");
    await runMergeStage("better-expressions", `第 12 步/${totalSteps}：AI 正在生成单句更好表达`, "更好表达");
    await runMergeStage("final-plan", `第 13 步/${totalSteps}：AI 正在进行最终评分复核并生成提分计划`, "最终评分复核与提分计划", { required: true });

    if (payload.mode === "revision") {
      await runMergeStage("revision", `第 14 步/${totalSteps}：AI 正在生成修改版/范文`, "范文/修改版生成");
    } else {
      markStage("最终整理", "done", "结果已整理。");
      syncStageMeta();
      renderGradingResult(result);
    }

    if (stageWarnings.length) {
      setGradingStatus("批改完成；部分阶段有记录，请查看下方“AI 批改进度与错误日志”。", "warning");
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



function isNonBlockingStageWarning(text) {
  const value = String(text || "");
  return /grammar stage returned no usable detailed content|grammar stage did not return enough usable detail|AI grammar stage returned no usable detailed content|AI JSON was repaired after|Unterminated string in JSON|malformed JSON|Failed to fetch|NetworkError|Load failed|AbortError|timed out after waiting|network request failed/i.test(value);
}

function isWordCountWarningText(text) {
  return /\bword count\b|\bunderlength\b|below the recommended|under the recommended|recommended minimum|\b150 words\b|\b250 words\b|significantly under|字数|低于.*建议/i.test(String(text || ""));
}

function isUserVisibleSystemWarning(text) {
  const value = String(text || "").trim();
  return value && !isNonBlockingStageWarning(value) && !isWordCountWarningText(value);
}

function renderStageProgress(result = {}) {
  const progress = Array.isArray(result.stageProgress) ? result.stageProgress : [];
  const warnings = Array.isArray(result.stageWarnings) ? result.stageWarnings : [];
  const inlineWarnings = [result.gradingWarning, result.correctionWarning, result.correctionPassWarning, result.revisionWarning, result.sectionWarning]
    .filter((item) => String(item || "").trim());
  const allWarnings = [...warnings, ...inlineWarnings].filter((item, index, arr) => String(item || "").trim() && arr.indexOf(item) === index);
  if (!progress.length && !allWarnings.length) return "";
  return collapsibleSection("AI 批改进度与错误日志", `
    ${progress.length ? `<ul class="stage-log-list">${progress.map((item) => {
      const recovered = isNonBlockingStageWarning(item.message);
      const stateText = item.state === "done" ? "完成" : item.state === "running" ? "进行中" : item.state === "warning" ? (recovered ? "已补全/有记录" : "需注意") : "失败";
      const detail = item.detail ? `<pre class="stage-log-detail">${escapeHtml(item.detail)}</pre>` : "";
      return `<li class="${recovered ? "stage-recovered" : item.state === "error" ? "stage-error" : ""}"><strong>${escapeHtml(item.label || "阶段")}</strong>：${escapeHtml(stateText)} — ${escapeHtml(item.message || "")}${detail}</li>`;
    }).join("")}</ul>` : ""}
    ${allWarnings.length ? `<div class="ai-warning stage-warning-log">${allWarnings.map((item) => `<p>${escapeHtml(item)}</p>`).join("")}</div>` : ""}
  `);
}

function renderEvidenceExplanationLine(label, englishText, chineseText) {
  const text = String(englishText || "").trim();
  if (!text) return "";
  const zh = normalizeEvidenceZh(label, text, chineseText);
  return `<div class="evidence-explain-line"><p><strong>${escapeHtml(label)}:</strong> ${escapeHtml(text)}</p>${hasTranslationValue(zh) ? renderZhToggle(zh) : ""}</div>`;
}

function renderCriterionEvidence(item = {}) {
  const positive = Array.isArray(item.positiveEvidence) ? item.positiveEvidence.filter(Boolean) : [];
  const positiveZh = Array.isArray(item.positiveEvidenceZh) ? item.positiveEvidenceZh : [];
  const limiting = Array.isArray(item.limitingEvidence) ? item.limitingEvidence.filter(Boolean) : [];
  const limitingZh = Array.isArray(item.limitingEvidenceZh) ? item.limitingEvidenceZh : [];
  const quotes = Array.isArray(item.evidenceQuotes) ? item.evidenceQuotes.filter(Boolean) : [];
  const quotesZh = Array.isArray(item.evidenceQuotesZh) ? item.evidenceQuotesZh : [];
  const whyThis = String(item.whyThisBand || "").trim();
  const whyThisZh = String(item.whyThisBandZh || "").trim();
  const whyHigher = String(item.whyNotHigher || "").trim();
  const whyHigherZh = String(item.whyNotHigherZh || "").trim();
  const whyLower = String(item.whyNotLower || "").trim();
  const whyLowerZh = String(item.whyNotLowerZh || "").trim();
  if (!positive.length && !limiting.length && !quotes.length && !whyThis && !whyHigher && !whyLower) return "";
  return `<details class="criterion-evidence-details">
    <summary>评分证据 / Band evidence</summary>
    <div class="criterion-evidence-body">
      ${quotes.length ? `<div class="evidence-block"><strong>Evidence quotes:</strong>${translatedListHtml(quotes, quotesZh, "Evidence quotes")}</div>` : ""}
      ${positive.length ? `<div class="evidence-block"><strong>Positive evidence:</strong>${translatedListHtml(positive, positiveZh, "Positive evidence")}</div>` : ""}
      ${limiting.length ? `<div class="evidence-block"><strong>Limiting evidence:</strong>${translatedListHtml(limiting, limitingZh, "Limiting evidence")}</div>` : ""}
      ${renderEvidenceExplanationLine("Why this band", whyThis, whyThisZh)}
      ${renderEvidenceExplanationLine("Why not higher", whyHigher, whyHigherZh)}
      ${renderEvidenceExplanationLine("Why not lower", whyLower, whyLowerZh)}
    </div>
  </details>`;
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
      ${item?.halfBandDecision ? renderTextWithTranslation(`Half-band decision: ${item.halfBandDecision}`, item?.halfBandDecisionZh, { className: "improve" }) : ""}
      ${renderCriterionEvidence(item || {})}
    </div>`).join("")}</div>`;
}

function criterionBandsFromResult(result = {}) {
  const calcBands = Array.isArray(result.scoreCalculation?.criteriaBands) ? result.scoreCalculation.criteriaBands : [];
  if (calcBands.length) return calcBands;
  const criteria = result.criteria && typeof result.criteria === "object" ? result.criteria : {};
  return Object.entries(criteria).map(([criterion, item]) => ({ criterion, band: item?.band }));
}

function averageCriterionBands(bands = []) {
  const numbers = bands.map((item) => Number(item?.band)).filter(Number.isFinite);
  if (!numbers.length) return null;
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function renderScoreCalculation(result = {}) {
  const calc = result.scoreCalculation && typeof result.scoreCalculation === "object" ? result.scoreCalculation : {};
  const scoringSystem = result.scoringSystem && typeof result.scoringSystem === "object" ? result.scoringSystem : {};
  const bands = criterionBandsFromResult(result).filter((item) => item && item.criterion && String(item.band ?? "").trim());
  const rawAverage = Number(calc.rawAverage ?? averageCriterionBands(bands));
  const finalBand = Number(calc.finalBand ?? result.overallBand);
  const hasCalculation = bands.length || Number.isFinite(rawAverage) || Number.isFinite(finalBand) || hasAnyText(scoringSystem);
  if (!hasCalculation) return "";

  const systemLabel = scoringSystem.type === "task1_practice_engine"
    ? "Task 1 GT Letter Scoring Engine"
    : scoringSystem.type === "task2_practice_engine"
      ? "Task 2 Essay Scoring Engine"
      : scoringSystem.type === "mock_writing_combined_system"
        ? "Mock Writing Combined Scoring System"
        : (calc.mode || scoringSystem.type || "Task-specific scoring engine");
  const formula = calc.formula || "four IELTS criteria average rounded to nearest 0.5";
  const rows = bands.length ? `<div class="score-calculation-grid">${bands.map((item) => `
    <div class="score-calculation-row"><span>${escapeHtml(item.criterion)}</span><strong>Band ${escapeHtml(formatMockBand(item.band))}</strong></div>
  `).join("")}</div>` : "";
  const sameBands = Boolean(result.scoreCalibration?.criteriaIdentical);
  const reviewNeeded = Boolean(result.scoreCalibration?.criteriaIdenticalReviewNeeded);

  return `<section class="grading-section score-calculation-card">
    <h4>评分计算说明</h4>
    <p><strong>评分系统：</strong>${escapeHtml(systemLabel)}</p>
    <p><strong>计算方式：</strong>${escapeHtml(formula)}</p>
    ${rows}
    ${Number.isFinite(rawAverage) ? `<p><strong>四项平均：</strong>${escapeHtml(rawAverage.toFixed(3).replace(/\.?0+$/, ""))}</p>` : ""}
    ${Number.isFinite(finalBand) ? `<p><strong>最终估算：</strong>Band ${escapeHtml(formatMockBand(finalBand))}</p>` : ""}
    ${sameBands ? `<p class="muted">四项分数相同：系统允许这种情况，但要求评分证据能支持四项确实处在同一水平。</p>` : ""}
    ${reviewNeeded ? `<p class="ai-warning">四项分数完全相同，但反馈证据显示不同弱点；后端已标记需要评分一致性复核。</p>` : ""}
    ${calc.explanation ? renderTextWithTranslation(calc.explanation, calc.explanationZh, { tag: "p" }) : ""}
  </section>`;
}




function renderWordCountWarningNote(result = {}) {
  const task = selected?.task === "Task 1" ? "Task 1" : "Task 2";
  const minWords = task === "Task 1" ? 150 : 250;
  const words = Number(result.actualWordCount || result.wordCount || countWords(els.essayInput?.value || "")) || 0;
  if (words >= minWords) return "";
  const note = result.wordCountWarning && typeof result.wordCountWarning === "object" ? result.wordCountWarning : {};
  const candidates = [note.message, note.warning, note.note, result.lowBandDiagnostics?.reason, result.scoreCalibration?.capReason, result.scoreCalibration?.whyNotHigher];
  const message = candidates.map((item) => String(item || "").trim()).find((item) => isWordCountWarningText(item)) || `${task} has ${words} words, below the recommended minimum of ${minWords} words.`;
  const zh = note.messageZh || note.warningZh || `${task} 当前约 ${words} 词，低于建议最低 ${minWords} 词，可能影响任务回应和内容展开。`;
  return `<section class="grading-section word-count-note"><h4>字数与限分说明</h4>${renderTextWithTranslation(message, zh)}</section>`;
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



function isPlaceholderBulletLabel(value) {
  const text = String(value || "").trim();
  return !text || /^bullet\s*point\s*\d+$/i.test(text) || /^point\s*\d+$/i.test(text) || /AI did not reliably return this prompt bullet point/i.test(text);
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
        <div><strong>Bullet points：</strong>${(() => {
          const reliableBullets = bullets.map((item, index) => {
            const rawRequirement = firstNonEmpty(item.requirement, item.bulletPoint, item.point, item.taskRequirement, item.text);
            const placeholder = isPlaceholderBulletLabel(rawRequirement) || item.coverageUnknown;
            const evidence = firstNonEmpty(item.evidence, item.evidenceFromEssay, item.originalEvidence, item.quote);
            const problem = firstNonEmpty(item.problem, item.issue, item.missingDetail, item.reason, item.comment);
            const suggestion = firstNonEmpty(item.suggestion, item.suggestedSentence, item.howToFix, item.advice, item.recommendation);
            return { item, index, requirement: rawRequirement, placeholder, evidence, problem, suggestion };
          }).filter((entry) => !entry.placeholder && entry.requirement && (entry.evidence || entry.problem || entry.suggestion || entry.item.covered !== null && entry.item.covered !== undefined));
          if (!reliableBullets.length) return `<p class="muted">题目要点覆盖分析暂未生成可靠结果。本次不显示 bullet-point 覆盖判断，以避免误判。</p>`;
          return `<div class="correction-list bullet-analysis-list">${reliableBullets.map(({ item, index, requirement, evidence, problem, suggestion }) => {
            const zh = safeChineseHelper(bulletsZh[index] || item.explanationZh || item.commentZh || item.reasonZh || item.suggestionZh || "", [requirement, evidence, problem, suggestion].join(" "));
            return `<div class="correction-item bullet-analysis-item">
              <p><strong>要点：</strong>${escapeHtml(requirement)}</p>
              <p><strong>是否覆盖：</strong>${coverageText(item.covered)}</p>
              ${evidence ? `<p><strong>原文证据：</strong>${escapeHtml(evidence)}</p>` : ""}
              ${problem ? `<p><strong>问题：</strong>${escapeHtml(problem)}</p>` : ""}
              ${suggestion ? `<p><strong>建议：</strong>${escapeHtml(suggestion)} ${renderCopyButton(suggestion)}</p>` : ""}
              ${renderZhToggle(zh)}
            </div>`;
          }).join("")}</div>`;
        })()}</div>
      ` : `
        <div><strong>题目类型：</strong>${renderTextWithTranslation(analysis.questionType || "Not returned.", analysisZh.questionTypeZh, { tag: "span" })}</div>
        <p><strong>话题：</strong>${escapeHtml(analysis.topic || "未返回")}</p>
        <div><strong>是否需要明确立场：</strong>${renderTextWithTranslation(analysis.requiredPosition || "Not returned.", analysisZh.requiredPositionZh, { tag: "span" })}</div>
        <p><strong>立场是否出现：</strong>${boolText(analysis.positionPresent)}</p>
        <div><strong>必须回答的部分：</strong>${parts.length ? renderListWithTranslations(parts, partsZh, "No detailed task analysis is available for this response.") : `<p class="muted">No detailed task analysis is available for this response.</p>`}</div>
      `}
      <div><strong>缺失要求：</strong>${listHtml(analysis.missingRequirements)}</div>
      <div><strong>匹配检查：</strong>${renderTextWithTranslation(match.reason || analysis.taskMatchSummary || "No detailed task analysis is available for this response.", analysisZh.taskMatchSummaryZh, { tag: "span" })}</div>
      ${match.warning && isUserVisibleSystemWarning(match.warning) ? `<p class="ai-warning">${escapeHtml(match.warning)}</p>` : ""}
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

function tokenizeExpressionForComparison(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/[^a-z0-9'\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter(Boolean);
}

function expressionSimilarity(a, b) {
  const aTokens = tokenizeExpressionForComparison(a);
  const bTokens = tokenizeExpressionForComparison(b);
  if (!aTokens.length || !bTokens.length) return 0;
  const aSet = new Set(aTokens);
  const bSet = new Set(bTokens);
  let overlap = 0;
  aSet.forEach((token) => { if (bSet.has(token)) overlap += 1; });
  return overlap / Math.max(aSet.size, bSet.size);
}

function expressionTokenEditDistance(a, b) {
  const left = tokenizeExpressionForComparison(a);
  const right = tokenizeExpressionForComparison(b);
  if (!left.length) return right.length;
  if (!right.length) return left.length;
  const dp = Array.from({ length: left.length + 1 }, () => Array(right.length + 1).fill(0));
  for (let i = 0; i <= left.length; i += 1) dp[i][0] = i;
  for (let j = 0; j <= right.length; j += 1) dp[0][j] = j;
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }
  return dp[left.length][right.length];
}

function importantMeaningSegments(text) {
  return String(text || "")
    .split(/\b(?:because|as|since|although|though|if|when|while|which|that|so that|in order to|therefore|as a result)\b/i)
    .map((segment) => segment.trim())
    .filter((segment) => tokenizeExpressionForComparison(segment).length >= 4);
}

function losesImportantMeaning(correctedSentence, betterExpression) {
  const correctedTokens = tokenizeExpressionForComparison(correctedSentence);
  const betterTokens = tokenizeExpressionForComparison(betterExpression);
  if (!correctedTokens.length || !betterTokens.length) return false;
  const correctedNorm = correctedTokens.join(" ");
  const betterNorm = betterTokens.join(" ");
  if (correctedNorm.startsWith(betterNorm) && betterTokens.length <= Math.ceil(correctedTokens.length * 0.78)) return true;
  if (betterTokens.length < Math.max(5, Math.floor(correctedTokens.length * 0.65))) return true;
  return importantMeaningSegments(correctedSentence).some((segment) => {
    const segTokens = tokenizeExpressionForComparison(segment);
    if (segTokens.length < 4) return false;
    const preserved = segTokens.filter((token) => betterTokens.includes(token)).length;
    return preserved / segTokens.length < 0.45;
  });
}

function hasBetterExpressionUpgradeSignal(correctedSentence, betterExpression) {
  const corrected = String(correctedSentence || "").toLowerCase();
  const better = String(betterExpression || "").toLowerCase();
  if (!better.trim()) return false;

  const correctedTokens = tokenizeExpressionForComparison(corrected);
  const betterTokens = tokenizeExpressionForComparison(better);
  if (!correctedTokens.length || !betterTokens.length) return false;

  const similarity = expressionSimilarity(corrected, better);
  const editDistance = expressionTokenEditDistance(corrected, better);
  const lengthGap = Math.abs(correctedTokens.length - betterTokens.length);

  // 只拦截假升级：完全重复、机械小替换、截断或丢信息。
  // 不再要求大幅重写；Band 0-5 的适度升级表达也应该显示。
  if (similarity >= 0.97) return false;
  if (editDistance <= 1 && lengthGap <= 1) return false;
  if (editDistance <= 2 && lengthGap === 0 && similarity >= 0.9) return false;
  if (losesImportantMeaning(correctedSentence, betterExpression)) return false;

  return true;
}

function shouldShowBetterExpression(correctedSentence, betterExpression) {
  const corrected = String(correctedSentence || "").trim();
  const better = String(betterExpression || "").trim();
  if (!better) return false;
  if (!corrected) return true;
  if (sameFeedbackText(corrected, better)) return false;
  return hasBetterExpressionUpgradeSignal(corrected, better);
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
    text.includes("fully satisfies") ||
    text.includes("satisfies all task requirements") ||
    text.includes("fully answers") ||
    text.includes("fully fulfils") ||
    text.includes("fully fulfills") ||
    text.includes("addresses all") ||
    text.includes("covers all") ||
    text.includes("all bullet points are covered") ||
    text.includes("all task requirements") ||
    text.includes("clear purpose") ||
    text.includes("purpose is clear") ||
    text.includes("appropriate tone") ||
    text.includes("appropriately formal") ||
    text.includes("appropriately polite") ||
    text.includes("formal and polite") ||
    text.includes("clear and polite") ||
    text.includes("well-developed") ||
    text.includes("well developed") ||
    text.includes("specific content") ||
    text.includes("clear progression") ||
    text.includes("logical progression") ||
    text.includes("logically ordered") ||
    text.includes("coherent") ||
    text.includes("accurate language") ||
    text.includes("high grammatical accuracy") ||
    text.includes("grammatical accuracy is high") ||
    text.includes("precise and natural") ||
    text.includes("vocabulary is precise") ||
    text.includes("natural vocabulary") ||
    text.includes("few errors") ||
    text.includes("strong control") ||
    text.includes("minor polishing") ||
    text.includes("minor refinement")
  ) && !(
    text.includes("but") ||
    text.includes("however") ||
    text.includes("although") ||
    text.includes("needs") ||
    text.includes("need improvement") ||
    text.includes("missing") ||
    text.includes("limited") ||
    text.includes("underdeveloped") ||
    text.includes("unclear") ||
    text.includes("inaccurate") ||
    text.includes("error") ||
    text.includes("weak") ||
    text.includes("lack")
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


function isInvalidBetterExpression(value) {
  const text = String(value || "").trim();
  if (!text) return true;
  const compact = compactFeedbackText(text);
  if (!compact) return true;
  const badPatterns = [
    /\b(which|this)\s+(makes|make|will\s+make)\s+the\s+(idea|point|sentence)\s+(clearer|more\s+specific|better)\b/i,
    /\bclearer\s+and\s+more\s+specific\b/i,
    /\bthis\s+improves\s+the\s+sentence\b/i,
    /\bdiscuss\s+about\b/i,
    /\bneed\s+to\s+facing\b/i,
    /\bit['’]?spossible\b/i,
    /\bshould\s+not\s+avoid\b/i,
    /\bcan\s+improve\b[^.?!]{0,80}\bcan\s+be\s+beneficial\b/i,
    /\bthat\s+means\b[^.?!]{0,80}\bcan\s+be\s+beneficial\b/i
  ];
  return badPatterns.some((pattern) => pattern.test(text));
}

function genericDisplayBetterExpression() {
  // AI-only display rule: the front end must not invent a better expression.
  // If AI does not return a safe betterExpression, the field stays hidden.
  return "";
}

function resolveBetterExpressionForDisplay(item = {}, corrected, original) {
  const base = corrected || original || "";
  const rawBetter = firstNonEmpty(
    item.betterExpression,
    item.upgradedExpression,
    item.highBandExpression,
    item.polishedSentence,
    item.modelExpression,
    item.betterSentence,
    item.exampleUpgrade
  );
  if (isInvalidBetterExpression(rawBetter)) return "";
  if (shouldShowBetterExpression(base, rawBetter)) return rawBetter;
  return "";
}

function normalizeSentenceCorrectionItem(item, index = 0) {
  if (typeof item === "string") {
    const text = item.trim();
    return text ? {
      sentenceNumber: index + 1,
      originalSentence: text,
      correctedSentence: text,
      problem: text,
      errorType: "Sentence-level issue"
    } : null;
  }
  if (!item || typeof item !== "object") return null;
  const original = firstNonEmpty(item.originalSentence, item.original, item.sourceSentence, item.sentence, item.inputSentence, item.before);
  const corrected = firstNonEmpty(item.correctedSentence, item.corrected, item.revisedSentence, item.fixedSentence, item.after, item.correction);
  const problem = firstNonEmpty(item.problem, item.issue, item.reason, item.explanation, item.comment);
  const rule = firstNonEmpty(item.rule, item.grammarRule, item.suggestionRule);
  const errorType = firstNonEmpty(item.errorType, item.type, item.category, item.issueType);
  const bandImpact = firstNonEmpty(item.bandImpact, item.impact, item.scoreImpact, item.impactOnBand);

  const normalized = {
    ...item,
    sentenceNumber: item.sentenceNumber || index + 1,
    originalSentence: original,
    correctedSentence: corrected,
    problem,
    rule,
    errorType,
    bandImpact
  };
  const better = resolveBetterExpressionForDisplay(normalized, corrected, original);
  if (better) normalized.betterExpression = better;
  else delete normalized.betterExpression;
  if (!hasAnyText(normalized.originalSentence) && !hasAnyText(normalized.correctedSentence) && !hasAnyText(normalized.problem) && !hasAnyText(normalized.rule) && !hasAnyText(normalized.betterExpression)) return null;
  return normalized;
}

function normalizeCorrectionIdentityText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/[’‘`]/g, "'")
    .replace(/\s+/g, " ")
    .replace(/\s*([,.!?;:])\s*/g, "$1")
    .replace(/["“”]/g, "")
    .trim();
}

function correctionIdentityKey(item = {}) {
  const number = String(item.sentenceNumber || "").trim();
  if (number && /^\d+$/.test(number)) return `num:${number}`;
  const original = firstNonEmpty(item.originalSentence, item.original, item.sourceSentence, item.sentence, item.inputSentence, item.before);
  const corrected = firstNonEmpty(item.correctedSentence, item.corrected, item.revisedSentence, item.fixedSentence, item.after, item.correction);
  const base = normalizeCorrectionIdentityText(original || corrected);
  return base ? `text:${base}` : "";
}

function sentenceIdentityTokens(value) {
  return normalizeCorrectionIdentityText(value)
    .replace(/[^a-z0-9'\s]/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function sentenceIdentitySimilarity(a, b) {
  const left = sentenceIdentityTokens(a);
  const right = sentenceIdentityTokens(b);
  if (!left.length || !right.length) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  let overlap = 0;
  leftSet.forEach((token) => { if (rightSet.has(token)) overlap += 1; });
  return overlap / Math.max(leftSet.size, rightSet.size);
}

function findMatchingCorrectionIndex(corrections = [], item = {}) {
  const key = correctionIdentityKey(item);
  if (key && key.startsWith("num:")) {
    const number = key.slice(4);
    const indexByNumber = corrections.findIndex((entry) => String(entry.sentenceNumber || "") === number);
    if (indexByNumber >= 0) return indexByNumber;
  }
  const original = firstNonEmpty(item.originalSentence, item.original, item.sourceSentence, item.sentence);
  const normalized = normalizeCorrectionIdentityText(original);
  if (!normalized) return -1;
  let bestIndex = -1;
  let bestScore = 0;
  corrections.forEach((entry, index) => {
    const entryOriginal = firstNonEmpty(entry.originalSentence, entry.original, entry.sourceSentence, entry.sentence);
    const entryNorm = normalizeCorrectionIdentityText(entryOriginal);
    if (!entryNorm) return;
    if (entryNorm === normalized || entryNorm.includes(normalized) || normalized.includes(entryNorm)) {
      const lengthRatio = Math.min(entryNorm.length, normalized.length) / Math.max(entryNorm.length, normalized.length);
      if (lengthRatio >= 0.45 && lengthRatio > bestScore) {
        bestScore = lengthRatio;
        bestIndex = index;
      }
      return;
    }
    const score = sentenceIdentitySimilarity(entryOriginal, original);
    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  });
  return bestScore >= 0.82 ? bestIndex : -1;
}

function mergeCorrectionText(existing, incoming) {
  const a = String(existing || "").trim();
  const b = String(incoming || "").trim();
  if (!a) return b;
  if (!b) return a;
  const compactA = compactFeedbackText(a);
  const compactB = compactFeedbackText(b);
  if (compactA === compactB || compactA.includes(compactB) || compactB.includes(compactA)) {
    return richTextScore(b) > richTextScore(a) ? b : a;
  }
  return `${a}; ${b}`;
}

function mergeCorrectionItem(existing = {}, incoming = {}) {
  const merged = { ...existing };
  const keepRicher = (key) => {
    merged[key] = preferRicherText(merged[key], incoming[key]);
  };
  if (!merged.sentenceNumber && incoming.sentenceNumber) merged.sentenceNumber = incoming.sentenceNumber;
  ["originalSentence", "correctedSentence"].forEach(keepRicher);
  ["problem", "problemZh", "rule", "ruleZh", "errorType", "errorTypeZh", "bandImpact", "bandImpactZh", "whyThisAffectsBand"].forEach((key) => {
    merged[key] = mergeCorrectionText(merged[key], incoming[key]);
  });
  const better = resolveBetterExpressionForDisplay(incoming, incoming.correctedSentence || merged.correctedSentence, incoming.originalSentence || merged.originalSentence);
  if (better) {
    const existingBetter = resolveBetterExpressionForDisplay(merged, merged.correctedSentence, merged.originalSentence);
    merged.betterExpression = preferRicherText(existingBetter, better);
    merged.betterExpressionZh = firstNonEmpty(incoming.betterExpressionZh, incoming.whyBetterZh, merged.betterExpressionZh);
    merged.betterExpressionTargetBand = firstNonEmpty(incoming.betterExpressionTargetBand, incoming.targetExpressionBand, incoming.targetBand, merged.betterExpressionTargetBand);
  }
  if (incoming.scoreImpacting === false && typeof merged.scoreImpacting === "undefined") merged.scoreImpacting = false;
  return merged;
}

function isHighBandPolishResult(result = {}) {
  return result?.betterExpressionMode === "high_band_polish" || result?.highBandPolish === true;
}

function attachBetterExpressionItems(corrections = [], betterItems = [], options = {}) {
  const allowStandalone = Boolean(options.allowStandalone);
  ensureArray(betterItems).forEach((raw, rawIndex) => {
    if (!raw || typeof raw !== "object") return;
    const item = normalizeSentenceCorrectionItem({
      sentenceNumber: raw.sentenceNumber,
      originalSentence: firstNonEmpty(raw.originalSentence, raw.original, raw.sourceSentence),
      correctedSentence: firstNonEmpty(raw.correctedSentence, raw.corrected, raw.revisedSentence, raw.originalSentence, raw.original, raw.sourceSentence),
      betterExpression: firstNonEmpty(raw.betterExpression, raw.upgradedExpression, raw.highBandExpression, raw.polishedSentence, raw.modelExpression, raw.betterSentence),
      betterExpressionZh: firstNonEmpty(raw.betterExpressionZh, raw.whyBetterZh),
      betterExpressionTargetBand: firstNonEmpty(raw.targetBand, raw.targetBandRange, raw.targetLevel),
      problem: firstNonEmpty(raw.problem, raw.whyBetter),
      problemZh: firstNonEmpty(raw.problemZh, raw.whyBetterZh),
      whyBetter: firstNonEmpty(raw.whyBetter),
      whyBetterZh: firstNonEmpty(raw.whyBetterZh),
      upgradeFocus: firstNonEmpty(raw.upgradeFocus, raw.focus, raw.polishFocus),
      errorType: raw.errorType || (allowStandalone ? "High-band polish" : "Better expression"),
      polishMode: allowStandalone ? "high_band_polish" : raw.polishMode
    }, rawIndex);
    if (!item || !hasAnyText(item.betterExpression)) return;
    const matchIndex = findMatchingCorrectionIndex(corrections, item);
    if (matchIndex >= 0) {
      corrections[matchIndex] = mergeCorrectionItem(corrections[matchIndex], item);
    }
    if (allowStandalone) {
      corrections.push(item);
    }
    // Low/mid-band AI-only display rule: betterExpressionItems must attach to an existing correction.
    // High-band polish mode is the only case where standalone polish cards are allowed.
  });
  return corrections;
}

function getSentenceCorrectionItems(result = {}) {
  const rawItems = [
    ...ensureArray(result.detailedSentenceCorrections),
    ...ensureArray(result.sentenceCorrections),
    ...ensureArray(result.corrections),
    ...ensureArray(result.languageCorrections),
    ...ensureArray(result.sentenceLevelCorrections),
    ...ensureArray(result.sentenceFeedback)
  ];
  const merged = [];
  rawItems
    .map((item, index) => normalizeSentenceCorrectionItem(item, index))
    .filter(Boolean)
    .forEach((item) => {
      const matchIndex = findMatchingCorrectionIndex(merged, item);
      if (matchIndex >= 0) {
        merged[matchIndex] = mergeCorrectionItem(merged[matchIndex], item);
      } else {
        merged.push(item);
      }
    });

  attachBetterExpressionItems(merged, result.betterExpressionItems, { allowStandalone: isHighBandPolishResult(result) || !merged.length });
  return merged
    .filter(isScoreImpactingDetailedCorrection)
    .sort((a, b) => (Number(a.sentenceNumber) || 9999) - (Number(b.sentenceNumber) || 9999));
}

function renderDetailedSentenceCorrections(items = [], result = {}) {
  const normalized = ensureArray(items)
    .map((item, index) => normalizeSentenceCorrectionItem(item, index))
    .filter(Boolean);
  const filtered = normalized.filter(isScoreImpactingDetailedCorrection);

  const highBandPolish = isHighBandPolishResult(result) || filtered.some((item) => item.polishMode === "high_band_polish" || item.errorType === "High-band polish");
  const title = highBandPolish ? "高分表达优化 High-band Polish" : "逐句批改 Sentence Corrections";
  if (!filtered.length && normalized.length) {
    return collapsibleSection(title, `<p class="muted">AI 返回了句子级内容，但没有检测到会明显影响分数的逐句错误。</p>`);
  }
  if (!filtered.length) return collapsibleSection(title, `<p class="muted">No sentence-level corrections are available. If this is a high-band essay, Stage 12 should return high-band polish suggestions; otherwise check the AI stage log.</p>`);

  return collapsibleSection(title, `
    ${highBandPolish ? `<p class="muted">这些不是错误修正，而是针对 Band 7+ 作文的可选高分润色，目标是提升约 0.5–1.0 分。</p>` : ""}
    <div class="correction-list">${filtered.map((item, index) => {
      const original = firstNonEmpty(item.originalSentence, item.original);
      const corrected = firstNonEmpty(item.correctedSentence, item.corrected, original);
      const better = resolveBetterExpressionForDisplay(item, corrected, original);
      const betterTarget = firstNonEmpty(item.betterExpressionTargetBand, item.targetExpressionBand, item.targetBand, item.targetLevel) || "下一档 +0.5–1.0";
      const betterZh = item.betterExpressionZh || "这个更好表达不是只修正错误，而是在保留原意的基础上，让句子更自然、更清楚，并提升约0.5到1分。";
      const errorType = firstNonEmpty(item.errorType, item.type, item.category, item.issueType);
      const errorTypeZh = firstNonEmpty(item.errorTypeZh, item.typeZh, item.categoryZh, item.issueTypeZh);
      const problem = firstNonEmpty(item.problem, item.issue, item.reason, item.explanation, item.comment, item.whyBetter);
      const rule = firstNonEmpty(item.rule, item.grammarRule, item.suggestionRule);
      const bandImpact = firstNonEmpty(item.bandImpact, item.impact, item.scoreImpact, item.impactOnBand);
      const polishItem = highBandPolish || item.polishMode === "high_band_polish" || errorType === "High-band polish";
      const upgradeFocus = firstNonEmpty(item.upgradeFocus, item.focus, item.polishFocus);
      if (polishItem) {
        return `<div class="correction-item high-band-polish-item">
          <p><strong>句子 ${escapeHtml(item.sentenceNumber || index + 1)}</strong></p>
          ${original ? `<p><strong>原句：</strong>${escapeHtml(original)}</p>` : ""}
          ${better ? `<p class="better-expression-line"><strong>优化句（目标 ${escapeHtml(betterTarget)}）：</strong>${escapeHtml(better)} ${renderCopyButton(better)}</p>` : ""}
          ${upgradeFocus ? `<p><strong>优化重点：</strong>${escapeHtml(upgradeFocus)}</p>` : ""}
          ${problem ? `<p><strong>为什么更好：</strong>${escapeHtml(problem)}</p>` : ""}
          ${renderZhToggle([item.problemZh, item.whyBetterZh, betterZh].filter(Boolean).join("\n"))}
        </div>`;
      }
      return `<div class="correction-item">
        <p><strong>句子 ${escapeHtml(item.sentenceNumber || index + 1)}</strong></p>
        ${original ? `<p><strong>原句：</strong>${escapeHtml(original)}</p>` : ""}
        ${corrected ? `<p><strong>修改句：</strong>${escapeHtml(corrected)} ${renderCopyButton(corrected)}</p>` : ""}
        ${better ? `<p class="better-expression-line"><strong>更好表达（目标 ${escapeHtml(betterTarget)}）：</strong>${escapeHtml(better)} ${renderCopyButton(better)}</p>` : ""}
        ${errorType || errorTypeZh ? `<p><strong>错误类型：</strong>${escapeHtml(errorType)}${errorTypeZh ? ` / ${escapeHtml(errorTypeZh)}` : ""}</p>` : ""}
        ${problem ? `<p><strong>问题：</strong>${escapeHtml(problem)}</p>` : ""}
        ${rule ? `<p><strong>规则：</strong>${escapeHtml(rule)}</p>` : ""}
        ${bandImpact ? `<p><strong>对分数影响：</strong>${escapeHtml(bandImpact)}</p>` : ""}
        ${renderZhToggle([item.problemZh, item.ruleZh, betterZh, item.bandImpactZh].filter(Boolean).join("\n"))}
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

function parseBandNumber(value) {
  const match = String(value ?? "").match(/\d+(?:\.\d+)?/);
  if (!match) return null;
  const numeric = Number(match[0]);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(9, Math.round(numeric * 2) / 2)) : null;
}

function formatBandNumber(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "";
  return Number.isInteger(numeric) ? `${numeric}.0` : String(numeric);
}

function nextBandTargetRangeForDisplay(plan = {}, result = {}) {
  const current = parseBandNumber(plan.currentBand || result.overallBand || result.scoreCalculation?.finalBand || result.estimatedLevel);
  if (!current) return "";
  const lower = Math.min(9, Math.round((current + 0.5) * 2) / 2);
  const upper = Math.min(9, Math.round((current + 1.0) * 2) / 2);
  return `${formatBandNumber(lower)}-${formatBandNumber(upper)}`;
}

function renderTargetImprovementPlan(plan, result = {}) {
  if (!plan || typeof plan !== "object" || !targetImprovementPlanHasUsefulContent(plan)) {
    return collapsibleSection("下一阶段提分计划 Target Improvement Plan", `<p class="muted">No detailed improvement plan is available.</p>`);
  }
  let criterionUpgrades = getPlanUpgradeSource(plan).map(normalizeCriterionUpgradeItem).filter(Boolean).filter((item) => item.action || item.criterion || item.target);
  if (!criterionUpgrades.length) criterionUpgrades = fallbackCriterionUpgrades(plan, result);
  const calibratedTargetRange = nextBandTargetRangeForDisplay(plan, result);
  const targetRangeText = calibratedTargetRange || plan.targetBandRange || plan.targetRange || plan.target || "";
  const targetRangeZh = plan.targetBandRangeZh || (targetRangeText ? "目标范围按当前分数上调0.5到1.0分设置，属于下一阶段可实现目标，不是长期最终目标。" : "");
  const targetReasonZh = plan.targetReasonZh || (plan.targetReason ? "这个目标按当前分数上调约0.5到1分，优先解决最影响分数的任务回应、结构、词汇或语法问题。" : "");
  return collapsibleSection("下一阶段提分计划 Target Improvement Plan", `
    <div class="compact-facts">
      <p><strong>当前分数：</strong>${escapeHtml(formatBandNumber(parseBandNumber(plan.currentBand || result.overallBand || result.estimatedLevel)) || plan.currentBand || result.overallBand || "")}</p>
      <div><strong>目标范围：</strong>${renderTextWithTranslation(targetRangeText, targetRangeZh, { tag: "span" })}</div>
      ${plan.targetReason ? `<div><strong>为什么是这个目标：</strong>${renderTextWithTranslation(plan.targetReason, targetReasonZh, { tag: "span" })}</div>` : ""}
    </div>
    ${Array.isArray(plan.focus) && plan.focus.length ? `<h4>这次最应该提升的点</h4>${renderListWithTranslations(plan.focus, plan.focusZh, "No target focus was returned.")}` : ""}
    ${collapsibleSection("四项提分动作", criterionUpgrades.length ? `<div class="correction-list">${criterionUpgrades.map((item) => `
        <div class="correction-item">
          <p><strong>项目：</strong>${escapeHtml(item.criterion || "General improvement")}</p>
          ${item.currentWeakness ? `<p><strong>Current weakness:</strong> ${escapeHtml(item.currentWeakness)}</p>` : ""}
          <p><strong>目标：</strong>${escapeHtml(item.target || targetRangeText || "Next realistic band range")}</p>
          <p><strong>具体动作：</strong>${escapeHtml(item.action || "Use the feedback above to make this criterion stronger.")}</p>
          ${item.exampleUpgrade ? `<p><strong>Example upgrade:</strong> ${escapeHtml(item.exampleUpgrade)}</p>` : ""}
          ${renderZhToggle([item.currentWeaknessZh, item.targetZh, item.actionZh, item.adviceZh, item.exampleUpgradeZh].filter(Boolean).join("\n"))}
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
    ${(() => {
      const reliableAdvice = bulletAdvice.map((item, index) => {
        const bulletPoint = firstNonEmpty(item.bulletPoint, item.requirement, item.point, item.taskRequirement, item.text) || `Bullet point ${index + 1}`;
        const placeholder = isPlaceholderBulletLabel(bulletPoint) || item.coverageUnknown;
        const evidence = firstNonEmpty(item.evidenceFromEssay, item.evidence, item.originalEvidence, item.quote);
        const problem = firstNonEmpty(item.problem, item.issue, item.missingDetail, item.reason);
        const comment = firstNonEmpty(item.comment, item.advice, item.suggestion, item.howToFix, item.recommendation);
        const sentence = firstNonEmpty(item.suggestedSentence, item.modelSentence, item.exampleSentence, item.fixSentence);
        return { item, bulletPoint, placeholder, evidence, problem, comment, sentence };
      }).filter((entry) => !entry.placeholder && (entry.evidence || entry.problem || entry.comment || entry.sentence));
      if (!reliableAdvice.length) {
        return `<h4>Bullet point 建议</h4><p class="muted">Task 1 bullet-point 专项建议暂未生成可靠结果。本次不显示覆盖判断，以避免误判。</p>`;
      }
      return `<h4>Bullet point 建议</h4><div class="correction-list bullet-analysis-list">${reliableAdvice.map(({ item, bulletPoint, evidence, problem, comment, sentence }) => {
        const zh = safeChineseHelper(firstNonEmpty(item.explanationZh, item.commentZh, item.suggestionZh, item.reasonZh, item.suggestedSentenceZh), [bulletPoint, evidence, problem, comment, sentence].join(" "));
        return `<div class="correction-item bullet-analysis-item">
          <p><strong>要点：</strong>${escapeHtml(bulletPoint)}</p>
          <p><strong>是否覆盖：</strong>${coverageText(item.covered)}</p>
          ${evidence ? `<p><strong>原文证据：</strong>${escapeHtml(evidence)}</p>` : ""}
          ${problem ? `<p><strong>具体问题：</strong>${escapeHtml(problem)}</p>` : ""}
          ${comment ? `<p><strong>建议：</strong>${escapeHtml(comment)}</p>` : ""}
          ${sentence ? `<p><strong>可用句：</strong>${escapeHtml(sentence)} ${renderCopyButton(sentence)}</p>` : ""}
          ${renderZhToggle(zh)}
        </div>`;
      }).join("")}</div>`;
    })()}
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

function renderSpellingWordformSection(result = {}) {
  if (result.stageStatus === "no_issues" || (result.spellingWordformBatchMeta && !hasUsefulItemArray(result.spellingCorrections) && !hasUsefulItemArray(result.spellingWordformSentenceIssues))) {
    const reason = result.noIssueReason || "No clear spelling or word-form errors were detected by AI in this essay.";
    const reasonZh = result.noIssueReasonZh || "AI未发现明显拼写或词形错误。";
    return collapsibleSection("拼写错误 Spelling Corrections", renderTextWithTranslation(reason, reasonZh, { fallback: "未发现明显拼写或词形错误。" }));
  }
  return collapsibleSection("拼写错误 Spelling Corrections", renderSpellingCorrections(result.spellingCorrections));
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


function numericBand(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function shouldShowBandLadderPlans(result = {}) {
  const band = numericBand(result.overallBand);
  if (band > 7) return false;
  return hasUsefulItemArray(result.band5FixPlan) || hasUsefulItemArray(result.band6UpgradePlan) || hasUsefulItemArray(result.band7UpgradePlan);
}

function bandPlanTranslationsComplete(result = {}) {
  return hasMatchingTranslationArray(result.band5FixPlan, result.band5FixPlanZh) &&
    hasMatchingTranslationArray(result.band6UpgradePlan, result.band6UpgradePlanZh) &&
    hasMatchingTranslationArray(result.band7UpgradePlan, result.band7UpgradePlanZh);
}

function renderBandLadderPlans(result = {}) {
  if (!shouldShowBandLadderPlans(result)) return "";
  if (!bandPlanTranslationsComplete(result)) {
    return collapsibleSection("Band 5 / Band 6 / Band 7 提分建议", `<p class="muted">AI 未返回完整提分计划中文解释；请重试专项建议生成。</p>`);
  }
  return collapsibleSection("Band 5 / Band 6 / Band 7 提分建议", `<div class="advice-grid">
    <div><h4>Band 5 保底建议</h4>${renderListWithTranslations(result.band5FixPlan, result.band5FixPlanZh, "No Band 5 plan is available.")}</div>
    <div><h4>Band 6+ 提升建议</h4>${renderListWithTranslations(result.band6UpgradePlan, result.band6UpgradePlanZh, "No Band 6 plan is available.")}</div>
    <div><h4>Band 7+ 高分建议</h4>${renderListWithTranslations(result.band7UpgradePlan, result.band7UpgradePlanZh, "No Band 7 plan is available.")}</div>
  </div>`);
}


function hasFinalDisplayedScore(result = {}) {
  return Boolean(result.scoreFinalized || result.aiStage === "mock-combine" || result.mockWritingScore);
}

function renderFinalScoreArea(result = {}) {
  if (!hasFinalDisplayedScore(result)) {
    return `<section class="grading-section score-pending-card">
      <h4>最终评分</h4>
      <p class="muted">最终分数会在第 13 步 AI 完成最终评分复核后显示。前面的步骤只收集评分证据、诊断问题和生成批改内容。</p>
    </section>`;
  }
  const changeNote = result.scoreChanged
    ? `<p class="ai-warning"><strong>评分复核已调整：</strong>${escapeHtml(result.scoreChangeReason || "Final AI reconciliation adjusted the criterion bands based on the detailed evidence.")}${renderZhToggle(result.scoreChangeReasonZh || "")}</p>`
    : "";
  const boundaryNote = (result.bandRange || result.boundaryPosition || result.boundaryReason)
    ? `<div class="boundary-note">
        ${result.bandRange ? `<p><strong>边界范围：</strong>${escapeHtml(result.bandRange)}</p>` : ""}
        ${result.boundaryPosition ? `<p><strong>边界位置：</strong>${escapeHtml(result.boundaryPosition)}</p>` : ""}
        ${result.strictExaminerBand || result.generousExaminerBand ? `<p><strong>严格/宽松考官：</strong>${escapeHtml(result.strictExaminerBand || "-")} / ${escapeHtml(result.generousExaminerBand || "-")}</p>` : ""}
        ${result.boundaryReason ? renderTextWithTranslation(result.boundaryReason, result.boundaryReasonZh, { tag: "p" }) : ""}
      </div>`
    : "";
  return `<section class="grading-section">
      <h4>Overall estimated band</h4>
      <div class="overall-wrap"><div class="overall-band">${escapeHtml(result.overallBand ?? "-")}</div>${renderTextWithTranslation(result.estimatedLevel || "", result.estimatedLevelZh, { tag: "span" })}</div>
      ${changeNote}
      ${boundaryNote}
    </section>
    ${renderScoreCalculation(result)}
    <section class="grading-section">
      <h4>四项评分表</h4>
      ${renderCriteria(result.criteria)}
    </section>`;
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
  const sentenceCorrectionItems = getSentenceCorrectionItems(result);
  const hasDetailedSentenceCorrections = hasUsefulItemArray(sentenceCorrectionItems);
  const feedbackContentHtml = `
    ${result.fallback ? `<p class="ai-warning">AI 返回内容不完整，系统已提供基础诊断。请稍后可再次点击批改获取完整反馈。</p>` : ""}
    <p class="ai-disclaimer">${escapeHtml(result.disclaimer || "This is an AI-generated estimated score and revision, not an official IELTS score.")}</p>
    ${renderStageProgress(result)}
    ${renderTaskRequirementAnalysis(result.taskRequirementAnalysis, result.taskMatchCheck, result.taskRequirementAnalysisZh)}
    ${renderWordCountWarningNote(result)}
    ${result.scoreFinalized ? renderScoreCalibration(result.scoreCalibration, result.scoreCalibrationZh) : ""}
    ${renderLowBandDiagnostics(result.lowBandDiagnostics, result.lowBandDiagnosticsZh)}
    ${renderHighBandDiagnostics(result.highBandDiagnostics, result.highBandDiagnosticsZh)}
    ${renderFinalScoreArea(result)}
    ${collapsibleSection("Strengths", renderListWithTranslations(result.strengthItems && result.strengthItems.length ? result.strengthItems : result.strengths, result.strengthItems && result.strengthItems.length ? [] : result.strengthsZh, "No strengths were returned for this response."))}
    ${collapsibleSection("Main Problems", renderListWithTranslations(result.mainProblemItems && result.mainProblemItems.length ? result.mainProblemItems : mainProblems.items, result.mainProblemItems && result.mainProblemItems.length ? [] : mainProblems.translations, "No major problems were identified at this band; focus on refinement."))}
    ${renderErrorAnalysis(result.errorAnalysis)}
    ${renderDetailedSentenceCorrections(sentenceCorrectionItems, result)}
    ${renderCorrectionPriority(result.correctionPriority)}
    ${renderTargetImprovementPlan(result.targetImprovementPlan, result)}
    ${selected?.task === "Task 1" ? renderTask1LetterCorrections(result.task1LetterCorrections) : renderTask2EssayCorrections(result.task2EssayCorrections)}
    ${renderSpellingWordformSection(result)}
    ${collapsibleSection("语法错误 Grammar Errors", renderGrammarErrors(result.grammarErrors))}
    
    ${collapsibleSection("四项专项建议", `<div class="advice-grid">
      <div><h4>${taskAdviceTitle}</h4>${renderListWithTranslations(result.taskAchievementAdvice, result.taskAchievementAdviceZh, "No task advice is available.")}</div>
      <div><h4>Coherence Advice</h4>${renderListWithTranslations(result.coherenceAdvice, result.coherenceAdviceZh, "No coherence advice is available.")}</div>
      <div><h4>Lexical Advice</h4>${renderListWithTranslations(result.lexicalAdvice, result.lexicalAdviceZh, "No lexical advice is available.")}</div>
      <div><h4>Grammar Advice</h4>${renderListWithTranslations(result.grammarAdvice, result.grammarAdviceZh, "No grammar advice is available.")}</div>
    </div>`)}
    ${renderBandLadderPlans(result)}
    ${collapsibleSection("Model answer outline", renderTextWithTranslation(result.modelAnswerOutline || "", result.modelAnswerOutlineZh, { fallback: "No model answer outline was returned." }))}
    ${collapsibleSection("AI 修改版作文 / Revised Essays", `
      <p class="revision-meta-note">修改版按 Band 5 / Band 6 / Band 7 分层生成，不是默认 9 分范文。</p>
      ${renderRevisionLimitWarning(result)}
      ${renderRevisionBlock("Band 5 Safe Revision", "band5", band5)}
      ${renderRevisionBlock("Band 6+ Upgrade Revision", "band6", band6)}
      ${renderRevisionBlock("Band 7+ High-score Revision", "band7", band7)}
      ${collapsibleSection("Revision notes", `${listHtml(result.revisionNotes)}${revisionNotesZh ? `<h4>修改重点中文说明</h4>${renderZhToggle(revisionNotesZh)}` : ""}`)}
    `)}`;

  els.gradingResults.innerHTML = `
    <div class="grading-result-layout">
      <div class="grading-result-main">
        <div class="grading-floating-tools">${renderFeedbackTools()}</div>
        ${feedbackContentHtml}
      </div>
    </div>`;

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
  applyFeedbackUiState(els.gradingResults);
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


let mockTask1Prompt = null;
let mockTask2Prompt = null;
let mockTimerId = null;
let mockRemaining = 60 * 60;

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

function mockPayloadForPrompt(prompt, essay) {
  const wordCount = countWords(essay);
  const targetWordCount = targetWordsForPrompt(prompt);
  return {
    task: prompt.task,
    taskType: taskTypeForPrompt(prompt),
    book: prompt.book,
    test: prompt.test,
    questionTitle: prompt.title,
    questionPrompt: prompt.prompt,
    promptText: prompt.prompt,
    task1BulletPoints: prompt.task === "Task 1" ? extractBulletPointsFromPrompt(prompt.prompt) : [],
    task2Instruction: prompt.task === "Task 2" ? prompt.prompt : "",
    essay,
    wordCount,
    actualWordCount: wordCount,
    targetWordCount,
    isUnderMinimum: wordCount < targetWordCount,
    mode: "full",
    gradingMode: "full",
    outputLanguage: "en",
    locale: "en",
    includeRevision: false,
    revisionTargets: [],
    mockExam: true,
    rubric: {
      task1: ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"],
      task2: ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
    }
  };
}

const MOCK_FINAL_SCORING_STAGES = [
  ["prompt-analysis", "题目要求分析"],
  ["score", "内部评分信号分析"],
  ["evidence-map", "评分证据提取"],
  ["task-diagnosis", "任务完成/回应诊断"],
  ["coherence-diagnosis", "结构与衔接诊断"],
  ["spelling-wordform", "拼写和词形诊断"],
  ["lexical-choice-collocation", "词汇选择和搭配诊断"],
  ["grammar-diagnosis", "语法诊断"],
  ["final-plan", "最终评分复核"]
];

async function postMockStage(endpoint, payload, aiStage, label, stageLabel) {
  const controller = typeof AbortController !== "undefined" ? new AbortController() : null;
  const timeout = controller ? setTimeout(() => controller.abort(), 285000) : null;
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller ? controller.signal : undefined
    });
    if (!response.ok) {
      const errorInfo = await buildResponseError(response);
      throw new Error(`${label} ${stageLabel}: ${errorInfo.message}`);
    }
    return await response.json();
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

async function postMockScore(endpoint, prompt, essay, label) {
  const basePayload = mockPayloadForPrompt(prompt, essay);
  let result = null;
  for (let i = 0; i < MOCK_FINAL_SCORING_STAGES.length; i += 1) {
    const [aiStage, stageLabel] = MOCK_FINAL_SCORING_STAGES[i];
    setMockStatus(`${label}：第 ${i + 1}/${MOCK_FINAL_SCORING_STAGES.length} 步，${stageLabel}...`, "loading");
    const stageResult = await postMockStage(endpoint, {
      ...basePayload,
      aiStage,
      currentOverallBand: result?.overallBand,
      currentResult: result || null
    }, aiStage, label, stageLabel);
    result = mergeAiStageResult(result || {}, stageResult);
  }
  if (!result?.scoreFinalized || !Number.isFinite(Number(result?.overallBand))) {
    throw new Error(`${label}: final AI score reconciliation did not return a final score.`);
  }
  return result;
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
  if (mockTimerId) clearInterval(mockTimerId);
  mockTimerId = setInterval(() => {
    mockRemaining = Math.max(0, mockRemaining - 1);
    renderMockTimer();
    if (mockRemaining === 40 * 60) setMockStatus("建议开始 Task 2。", "loading");
    if (mockRemaining === 10 * 60) setMockStatus("剩余 10 分钟。", "loading");
    if (mockRemaining === 0) {
      clearInterval(mockTimerId);
      mockTimerId = null;
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
  renderMockTimer();
  updateMockWordCounts();
  setMockStatus("模拟考试准备就绪。", "");
}

function renderMockResults(task1Result, task2Result) {
  if (!task1Result?.scoreFinalized || !task2Result?.scoreFinalized) {
    const node = $("mockExamResults");
    if (node) node.innerHTML = `<p class="ai-warning">模拟考试最终评分复核未完成，不能生成综合分数。请重试。</p>`;
    return;
  }
  const t1Band = roundToHalfBand(task1Result?.overallBand);
  const t2Band = roundToHalfBand(task2Result?.overallBand);
  const finalBand = calculateMockWritingBand(t1Band, t2Band);
  const node = $("mockExamResults");
  if (!node) return;
  const combinedProblems = [
    ...((Array.isArray(task1Result?.mainProblems) ? task1Result.mainProblems : []).slice(0, 3).map((x) => `Task 1: ${x}`)),
    ...((Array.isArray(task2Result?.mainProblems) ? task2Result.mainProblems : []).slice(0, 3).map((x) => `Task 2: ${x}`))
  ];
  const rawWeightedAverage = (t1Band + t2Band * 2) / 3;
  node.innerHTML = `
    <div class="mock-score-card">
      <p class="kicker">Mock Writing Result</p>
      <h3>Final Writing estimated band: Band ${formatMockBand(finalBand)}</h3>
      <p><strong>Task 1:</strong> Band ${formatMockBand(t1Band)} &nbsp; <strong>Task 2:</strong> Band ${formatMockBand(t2Band)}</p>
      <p><strong>综合计算：</strong>(${formatMockBand(t1Band)} + ${formatMockBand(t2Band)} × 2) ÷ 3 = ${rawWeightedAverage.toFixed(3).replace(/\.?0+$/, "")} → Band ${formatMockBand(finalBand)}</p>
      <p class="muted">Task 1 和 Task 2 分开评分；Task 2 权重更高。本结果为 AI 估算，不是官方 IELTS 成绩。</p>
    </div>
    ${collapsibleSection("Task 1 模拟考试评分", `
      <p><strong>Estimated band:</strong> Band ${formatMockBand(t1Band)}</p>
      ${renderScoreCalculation(task1Result || {})}
      ${renderCriteria(task1Result?.criteria || {})}
      ${renderListWithTranslations(task1Result?.mainProblems || [], task1Result?.mainProblemsZh || [], "No main problems returned.")}
    `, { defaultOpen: true })}
    ${collapsibleSection("Task 2 模拟考试评分", `
      <p><strong>Estimated band:</strong> Band ${formatMockBand(t2Band)}</p>
      ${renderScoreCalculation(task2Result || {})}
      ${renderCriteria(task2Result?.criteria || {})}
      ${renderListWithTranslations(task2Result?.mainProblems || [], task2Result?.mainProblemsZh || [], "No main problems returned.")}
    `, { defaultOpen: true })}
    ${collapsibleSection("综合弱点与下一步", combinedProblems.length ? listHtml(combinedProblems) : `<p class="muted">No combined weakness summary is available.</p>`)}
  `;
  bindZhToggles(node);
}

async function submitMockExam() {
  const endpoint = els.gradingEndpointInput.value.trim();
  if (!endpoint) { setMockStatus("请先填写批改接口地址。", "error"); return; }
  const t1Essay = String($("mockTask1Essay")?.value || "").trim();
  const t2Essay = String($("mockTask2Essay")?.value || "").trim();
  if (!t1Essay || !t2Essay) { setMockStatus("请先完成 Task 1 和 Task 2 两篇作文。", "error"); return; }
  const btn = $("mockSubmitBtn");
  if (btn) { btn.disabled = true; btn.textContent = "评分中..."; }
  try {
    setMockStatus("正在评分 Task 1...", "loading");
    const task1Result = await postMockScore(endpoint, mockTask1Prompt, t1Essay, "Task 1");
    setMockStatus("正在评分 Task 2...", "loading");
    const task2Result = await postMockScore(endpoint, mockTask2Prompt, t2Essay, "Task 2");
    renderMockResults(task1Result, task2Result);
    setMockStatus("模拟考试最终评分复核完成。", "done");
  } catch (error) {
    setMockStatus(`模拟考试评分失败：${error.message}`, "error");
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "提交两篇作文并综合评分"; }
  }
}

function ensureMockExamPanel() {
  if ($("mockExamCard")) return;
  const filters = document.querySelector(".filters");
  if (!filters || !filters.parentNode) return;
  const card = document.createElement("section");
  card.id = "mockExamCard";
  card.className = "card mock-exam-card";
  card.innerHTML = `
    <div class="card-head">
      <div><p class="kicker">IELTS GT Writing Mock Test</p><h3>模拟考试：Task 1 + Task 2</h3></div>
      <button class="secondary" type="button" id="mockToggleBtn">打开模拟考试</button>
    </div>
    <div id="mockExamBody" class="mock-exam-body hidden">
      <p class="ai-note">60 分钟完成两篇作文。Task 1 建议 20 分钟，Task 2 建议 40 分钟。提交后两篇分别评分，并按 Task 2 更高权重计算综合 Writing Band。</p>
      <div class="mock-toolbar actions">
        <strong id="mockTimerDisplay" class="timer">60:00</strong>
        <button class="secondary" type="button" id="mockStartTimerBtn">开始计时</button>
        <button class="secondary" type="button" id="mockResetBtn">换一套题 / 重置</button>
        <span id="mockExamStatus" class="muted"></span>
      </div>
      <div class="mock-exam-grid">
        <div class="mock-task-card">
          <h4>Task 1 Letter</h4>
          <div id="mockTask1Prompt" class="question-card"></div>
          <textarea id="mockTask1Essay" class="essay" placeholder="Write your Task 1 letter here..."></textarea>
          <p class="wordbox"><strong id="mockTask1Words">0</strong><span>/ 150 words</span></p>
        </div>
        <div class="mock-task-card">
          <h4>Task 2 Essay</h4>
          <div id="mockTask2Prompt" class="question-card"></div>
          <textarea id="mockTask2Essay" class="essay" placeholder="Write your Task 2 essay here..."></textarea>
          <p class="wordbox"><strong id="mockTask2Words">0</strong><span>/ 250 words</span></p>
        </div>
      </div>
      <div class="actions"><button class="primary" type="button" id="mockSubmitBtn">提交两篇作文并综合评分</button></div>
      <div id="mockExamResults" class="grading-results"></div>
    </div>`;
  filters.parentNode.insertBefore(card, filters.nextSibling);
  $("mockToggleBtn")?.addEventListener("click", () => {
    const body = $("mockExamBody");
    if (!body) return;
    const opening = body.classList.contains("hidden");
    body.classList.toggle("hidden", !opening);
    $("mockToggleBtn").textContent = opening ? "收起模拟考试" : "打开模拟考试";
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
  ensureMockExamPanel();
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
