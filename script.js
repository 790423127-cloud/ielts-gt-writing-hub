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
function countWords(text) { return (text.trim().match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) || []).length; }
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
  if (payload?.status) parts.push(`status: ${payload.status}`);
  const detail = payload?.detail ?? fallbackText;
  if (detail) parts.push(`detail: ${truncateDetail(detail)}`);
  return parts.join(" | ");
}

function resetGradingPanel() {
  setGradingStatus("等待批改");
  els.gradingResults.innerHTML = "";
  els.revisionCompareArea.classList.add("hidden");
  els.compareOriginalText.textContent = "";
  els.compareRevisedText.textContent = "";
}

function gradingPayload() {
  const essay = els.essayInput.value.trim();
  const wordCount = countWords(essay);
  const mode = els.gradingModeSelect.value || "quick";
  return {
    task: selected.task,
    book: selected.book,
    test: selected.test,
    questionTitle: selected.title,
    questionPrompt: selected.prompt,
    essay,
    wordCount,
    mode,
    includeRevision: mode === "revision",
    revisionTargets: ["band5", "band6", "band7"],
    rubric: {
      task1: ["Task Achievement", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"],
      task2: ["Task Response", "Coherence and Cohesion", "Lexical Resource", "Grammatical Range and Accuracy"]
    }
  };
}

async function startGrading() {
  if (!selected) { setGradingStatus("请先选择一道题。", "error"); return; }
  const endpoint = els.gradingEndpointInput.value.trim();
  if (!endpoint) {
    setGradingStatus("请先填写批改接口地址。不要把 API key 放在前端网页中。", "error");
    return;
  }
  const essay = els.essayInput.value.trim();
  if (!essay) { setGradingStatus("请先输入作文。", "error"); return; }
  const wordCount = countWords(essay);
  if (wordCount < selected.recommendedWords) {
    setGradingStatus(`当前 ${wordCount} words，未达到最低 ${selected.recommendedWords} words，暂不提交批改。`, "error");
    return;
  }

  setGradingStatus("批改中", "loading");
  els.gradeBtn.disabled = true;
  els.gradingResults.innerHTML = "";
  els.revisionCompareArea.classList.add("hidden");

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(gradingPayload())
    });
    if (!response.ok) throw new Error(await buildResponseError(response));
    const result = await response.json();
    renderGradingResult(result);
    setGradingStatus("批改完成", "done");
  } catch (error) {
    setGradingStatus(`批改失败：${error.message}`, "error");
  } finally {
    els.gradeBtn.disabled = false;
  }
}

function renderCriteria(criteria = {}) {
  const rows = Object.entries(criteria);
  if (!rows.length) return `<p class="muted">暂无四项评分。</p>`;
  return `<div class="criteria-grid">${rows.map(([name, item]) => `
    <div class="criteria-item">
      <span>${escapeHtml(name)}</span>
      <strong>Band ${escapeHtml(item?.band ?? "-")}</strong>
      <p>${escapeHtml(item?.feedback || "")}</p>
      ${item?.howToImprove ? `<p class="improve"><strong>How to improve:</strong> ${escapeHtml(item.howToImprove)}</p>` : ""}
    </div>`).join("")}</div>`;
}

function renderGrammarErrors(items = []) {
  if (!Array.isArray(items) || !items.length) return `<p class="muted">暂无语法错误列表。</p>`;
  return `<div class="correction-list">${items.map((item) => `
    <div class="correction-item">
      <p><strong>Type:</strong> ${escapeHtml(item.type || "other")}</p>
      <p><strong>Original:</strong> ${escapeHtml(item.original || "")}</p>
      <p><strong>Corrected:</strong> ${escapeHtml(item.corrected || "")}</p>
      <p><strong>Explanation:</strong> ${escapeHtml(item.explanation || "")}</p>
    </div>`).join("")}</div>`;
}

function renderSentenceCorrections(items = []) {
  if (!Array.isArray(items) || !items.length) return `<p class="muted">暂无句子级修改。</p>`;
  return `<div class="correction-list">${items.map((item) => `
    <div class="correction-item">
      <p><strong>Original:</strong> ${escapeHtml(item.original || "")}</p>
      <p><strong>Corrected:</strong> ${escapeHtml(item.corrected || "")}</p>
      <p><strong>Reason:</strong> ${escapeHtml(item.reason || "")}</p>
    </div>`).join("")}</div>`;
}

function renderRevisionBlock(label, target, text) {
  const content = text ? `<pre>${escapeHtml(text)}</pre>` : `<p class="muted">后端暂未返回修改版作文。</p>`;
  const disabled = text ? "" : "disabled";
  return `<details class="revision-block" open>
    <summary>${label}</summary>
    ${content}
    <div class="actions">
      <button class="secondary" type="button" data-revision-action="copy" data-target="${target}" ${disabled}>复制修改版</button>
      <button class="primary" type="button" data-revision-action="apply" data-target="${target}" ${disabled}>应用到作文输入区</button>
      <button class="secondary" type="button" data-revision-action="compare" data-target="${target}" ${disabled}>和原文对比</button>
    </div>
  </details>`;
}

function renderGradingResult(result = {}) {
  const band5 = result.revisedEssayBand5 || "";
  const band6 = result.revisedEssayBand6 || "";
  const band7 = result.revisedEssayBand7 || "";
  els.gradingResults.dataset.band5 = band5;
  els.gradingResults.dataset.band6 = band6;
  els.gradingResults.dataset.band7 = band7;
  const taskAdviceTitle = selected?.task === "Task 1" ? "Task Achievement Advice" : "Task Response Advice";
  els.gradingResults.innerHTML = `
    <p class="ai-disclaimer">${escapeHtml(result.disclaimer || "This is an AI-generated estimated score and revision, not an official IELTS score.")}</p>
    <section class="grading-section">
      <h4>Overall estimated band</h4>
      <div class="overall-wrap"><div class="overall-band">${escapeHtml(result.overallBand ?? "-")}</div><span>${escapeHtml(result.estimatedLevel || "")}</span></div>
    </section>
    <section class="grading-section">
      <h4>四项评分表</h4>
      ${renderCriteria(result.criteria)}
    </section>
    <section class="grading-section two-mini">
      <div><h4>Strengths</h4>${listHtml(result.strengths)}</div>
      <div><h4>Main Problems</h4>${listHtml(result.mainProblems)}</div>
    </section>
    <section class="grading-section">
      <h4>语法错误</h4>
      ${renderGrammarErrors(result.grammarErrors)}
    </section>
    <section class="grading-section">
      <h4>Sentence Corrections</h4>
      ${renderSentenceCorrections(result.sentenceCorrections)}
    </section>
    <section class="grading-section advice-grid">
      <div><h4>${taskAdviceTitle}</h4>${listHtml(result.taskAchievementAdvice)}</div>
      <div><h4>Coherence Advice</h4>${listHtml(result.coherenceAdvice)}</div>
      <div><h4>Lexical Advice</h4>${listHtml(result.lexicalAdvice)}</div>
      <div><h4>Grammar Advice</h4>${listHtml(result.grammarAdvice)}</div>
    </section>
    <section class="grading-section advice-grid">
      <div><h4>Band 5 保底建议</h4>${listHtml(result.band5FixPlan)}</div>
      <div><h4>Band 6+ 提升建议</h4>${listHtml(result.band6UpgradePlan)}</div>
      <div><h4>Band 7+ 高分建议</h4>${listHtml(result.band7UpgradePlan)}</div>
    </section>
    <section class="grading-section">
      <h4>Model answer outline</h4>
      ${proseHtml(result.modelAnswerOutline)}
    </section>
    <section class="grading-section">
      <h4>AI 修改版作文</h4>
      ${renderRevisionBlock("Band 5 Safe Revision", "band5", band5)}
      ${renderRevisionBlock("Band 6+ Upgrade Revision", "band6", band6)}
      ${renderRevisionBlock("Band 7+ High-score Revision", "band7", band7)}
      <h4>Revision Notes</h4>
      ${listHtml(result.revisionNotes)}
    </section>`;
  els.gradingResults.querySelectorAll("[data-revision-action]").forEach((button) => {
    button.addEventListener("click", () => handleRevisionAction(button.dataset.revisionAction, button.dataset.target));
  });
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
