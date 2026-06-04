(() => {
const DATA = window.IELTS_GT_DATA;
const prompts = DATA.prompts;
let selected = null;
let timerId = null;
let remaining = 0;
let currentLimit = 0;

const $ = (id) => document.getElementById(id);
const els = {
  themeBtn: $("themeBtn"), bookFilter: $("bookFilter"), testFilter: $("testFilter"), taskFilter: $("taskFilter"), typeFilter: $("typeFilter"), searchInput: $("searchInput"),
  promptList: $("promptList"), countLabel: $("countLabel"), emptyState: $("emptyState"), practiceView: $("practiceView"), metaTags: $("metaTags"), sourceStatus: $("sourceStatus"), practiceTitle: $("practiceTitle"), practicePrompt: $("practicePrompt"), infoGrid: $("infoGrid"), timerDisplay: $("timerDisplay"), timerBtn: $("timerBtn"), resetTimerBtn: $("resetTimerBtn"), planArea: $("planArea"), essayInput: $("essayInput"), wordCount: $("wordCount"), wordTarget: $("wordTarget"), copyBtn: $("copyBtn"), clearBtn: $("clearBtn"), statusText: $("statusText"), favoriteInput: $("favoriteInput"), structureList: $("structureList"), bandTips: $("bandTips"), phraseKicker: $("phraseKicker"), phraseTitle: $("phraseTitle"), phraseGroups: $("phraseGroups"), backBtn: $("backBtn")
};

function unique(items) { return [...new Set(items)]; }
function storageKey(id, part) { return `ielts-gt-writing-hub:${id}:${part}`; }
function save(id, part, value) { localStorage.setItem(storageKey(id, part), value); }
function load(id, part) { return localStorage.getItem(storageKey(id, part)) || ""; }
function countWords(text) { return (text.trim().match(/[A-Za-z0-9]+(?:[-'][A-Za-z0-9]+)?/g) || []).length; }
function fmt(seconds) { return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`; }
function tag(text, cls) { return `<span class="tag ${cls}">${text}</span>`; }

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

function bind() {
  [els.bookFilter, els.testFilter, els.taskFilter, els.typeFilter].forEach((el) => el.addEventListener("change", renderList));
  els.searchInput.addEventListener("input", renderList);
  els.timerBtn.addEventListener("click", toggleTimer);
  els.resetTimerBtn.addEventListener("click", () => selected && resetTimer(selected.timeLimit));
  els.essayInput.addEventListener("input", () => { if (selected) save(selected.id, "essay", els.essayInput.value); updateWords(); });
  els.favoriteInput.addEventListener("input", () => selected && save(selected.id, "favorites", els.favoriteInput.value));
  els.copyBtn.addEventListener("click", copyEssay);
  els.clearBtn.addEventListener("click", () => { if (!selected) return; els.essayInput.value = ""; save(selected.id, "essay", ""); updateWords(); els.essayInput.focus(); });
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
  const theme = localStorage.getItem("ielts-gt-writing-hub:theme") || "light";
  document.documentElement.dataset.theme = theme;
  els.themeBtn.textContent = theme === "dark" ? "浅色模式" : "深色模式";
  renderList();
  const fromHash = location.hash.replace("#", "");
  if (fromHash && prompts.some((p) => p.id === fromHash)) selectPrompt(fromHash);
}

init();

})();
