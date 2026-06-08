(() => {
  const DATA = window.IELTS_GT_DATA || { prompts: [], meta: {}, phraseBanks: { task1: {}, task2: {} } };
  const prompts = Array.isArray(DATA.prompts) ? DATA.prompts : [];
  let selected = null;
  let timerId = null;
  let remaining = 0;
  let latestScoreResult = null;
  const GRADING_ENDPOINT_KEY = "ielts-gt-writing-hub:gradingEndpoint";

  const $ = (id) => document.getElementById(id);
  const els = {
    themeBtn: $("themeBtn"), bookFilter: $("bookFilter"), testFilter: $("testFilter"), taskFilter: $("taskFilter"), typeFilter: $("typeFilter"), searchInput: $("searchInput"),
    promptList: $("promptList"), countLabel: $("countLabel"), emptyState: $("emptyState"), practiceView: $("practiceView"), metaTags: $("metaTags"), sourceStatus: $("sourceStatus"), practiceTitle: $("practiceTitle"), practicePrompt: $("practicePrompt"), infoGrid: $("infoGrid"), timerDisplay: $("timerDisplay"), timerBtn: $("timerBtn"), resetTimerBtn: $("resetTimerBtn"), planArea: $("planArea"), essayInput: $("essayInput"), wordCount: $("wordCount"), wordTarget: $("wordTarget"), copyBtn: $("copyBtn"), clearBtn: $("clearBtn"), statusText: $("statusText"), favoriteInput: $("favoriteInput"), structureList: $("structureList"), bandTips: $("bandTips"), phraseKicker: $("phraseKicker"), phraseTitle: $("phraseTitle"), phraseGroups: $("phraseGroups"), backBtn: $("backBtn"), gradingEndpointInput: $("gradingEndpointInput"), gradingModeSelect: $("gradingModeSelect"), gradeBtn: $("gradeBtn"), gradingStatus: $("gradingStatus"), gradingResults: $("gradingResults"), restoreOriginalBtn: $("restoreOriginalBtn"), revisionCompareArea: $("revisionCompareArea"), compareOriginalText: $("compareOriginalText"), compareRevisedText: $("compareRevisedText")
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
    if (!els.gradingModeSelect) return;
    const current = localStorage.getItem("ielts-gt-writing-hub:gradingMode") || "score";
    els.gradingModeSelect.innerHTML = `
      <option value="score">只评分 / Score only</option>
      <option value="revision">评分 + 作文生成 / Score + model/revision</option>`;
    els.gradingModeSelect.value = current === "revision" ? "revision" : "score";
    els.gradingModeSelect.addEventListener("change", () => localStorage.setItem("ielts-gt-writing-hub:gradingMode", els.gradingModeSelect.value));
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
    const mode = els.gradingModeSelect?.value === "revision" ? "revision" : "score";
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
      mode,
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

  function renderCriteriaRows(result) {
    const criteria = result.finalCriteria || result.criteria || {};
    const rows = Object.entries(criteria).map(([criterion, band]) => `<div class="score-calculation-row"><span>${escapeHtml(criterion)}</span><strong>Band ${escapeHtml(formatBand(band))}</strong></div>`).join("");
    return rows ? `<div class="score-calculation-grid">${rows}</div>` : `<p class="muted">AI 没有返回完整四项分。</p>`;
  }

  function renderScoreCalibration(result = {}) {
    const cal = result.criterionCalibration || {};
    const entries = Object.entries(cal);
    if (!entries.length && !result.scoreProfile && !result.localSignals) return "";
    const criterionHtml = entries.map(([name, item]) => {
      const half = item?.halfBandDecision || {};
      return `<details class="score-collapse"><summary>${escapeHtml(name)} 半分判断</summary><div class="score-collapse-body">
        <p><strong>候选分：</strong>${escapeHtml((item?.candidateBandsConsidered || []).join(" / ") || "未返回")}</p>
        <p><strong>选择：</strong>Band ${escapeHtml(formatBand(item?.selectedBand))}</p>
        <p><strong>为什么高于低一档：</strong>${escapeHtml(half.whyAboveLowerBand || "未返回")}</p>
        <p><strong>为什么低于高一档：</strong>${escapeHtml(half.whyBelowUpperBand || "未返回")}</p>
        <p><strong>为什么刚好这个分：</strong>${escapeHtml(half.whyExactBand || "未返回")}</p>
        <div><strong>正面证据：</strong>${listHtml(item?.positiveEvidence || [])}</div>
        <div><strong>限制证据：</strong>${listHtml(item?.limitingEvidence || [])}</div>
      </div></details>`;
    }).join("");
    const signals = result.localSignals || {};
    return `<section class="grading-section">
      <h4>评分校准报告 / Clean Score Core</h4>
      <p><strong>版本：</strong>${escapeHtml(result.scoreSystemVersion || "clean-score-core-v1")}</p>
      <p><strong>可评分性：</strong>${escapeHtml(signals.rateabilityStatus || "未返回")} ｜ <strong>词数：</strong>${escapeHtml(signals.wordCount ?? "-")} ｜ <strong>段落：</strong>${escapeHtml(signals.paragraphCount ?? "-")} ｜ <strong>句子：</strong>${escapeHtml(signals.sentenceCount ?? "-")}</p>
      <p><strong>拼写密度：</strong>${escapeHtml(signals.spellingErrorDensity || "-")} ｜ <strong>语法密度：</strong>${escapeHtml(signals.grammarErrorDensity || "-")} ｜ <strong>句子控制：</strong>${escapeHtml(signals.sentenceControl || "-")} ｜ <strong>词汇控制：</strong>${escapeHtml(signals.lexicalControl || "-")}</p>
      ${result.examinerSummary ? `<p><strong>Examiner summary:</strong> ${escapeHtml(result.examinerSummary)}</p>` : ""}
      ${result.examinerSummaryZh ? `<p><strong>中文摘要：</strong>${escapeHtml(result.examinerSummaryZh)}</p>` : ""}
      ${result.stabilityWarnings?.length ? `<div class="ai-warning"><strong>稳定性提醒：</strong>${listHtml(result.stabilityWarnings)}</div>` : ""}
      ${criterionHtml}
    </section>`;
  }

  function renderScoreResult(result = {}) {
    latestScoreResult = result;
    const finalBand = Number(result.overallBand || result.scoreCalculation?.finalBand);
    const rawAverage = Number(result.rawAverage || result.scoreCalculation?.rawAverage);
    const disclaimer = result.disclaimer || "This is an AI-generated estimated score, not an official IELTS score.";
    const html = `
      <section class="overall-card"><h4>Overall estimated band</h4><div class="overall-score"><span>${escapeHtml(formatBand(finalBand))}</span><strong>Band ${escapeHtml(formatBand(finalBand))}</strong></div></section>
      <section class="grading-section score-calculation-card">
        <h4>评分计算说明</h4>
        <p><strong>评分系统：</strong>${escapeHtml(result.scoreCalculation?.mode || result.scoreSystemVersion || "clean_score_core")}</p>
        <p><strong>计算方式：</strong>${escapeHtml(result.scoreCalculation?.formula || "AI-returned four IELTS criterion bands averaged and rounded to nearest 0.5; no local cap, lift, or lowering is applied.")}</p>
        <p><strong>本地是否介入评分：</strong>否</p>
        <p><strong>本地是否 cap / 压分 / 提分：</strong>否</p>
        ${renderCriteriaRows(result)}
        ${Number.isFinite(rawAverage) ? `<p><strong>四项平均：</strong>${escapeHtml(rawAverage.toFixed(3).replace(/\.?0+$/, ""))}</p>` : ""}
        ${Number.isFinite(finalBand) ? `<p><strong>最终估算：</strong>Band ${escapeHtml(formatBand(finalBand))}</p>` : ""}
        <p class="muted">The server validates structure and averages the AI-returned criterion bands. It does not rewrite criterion bands locally.</p>
      </section>
      ${renderScoreCalibration(result)}
      <p class="ai-disclaimer">${escapeHtml(disclaimer)}</p>`;
    if (els.gradingResults) els.gradingResults.innerHTML = html;
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

  async function startGrading() {
    if (!selected) { setGradingStatus("请先选择一道题。", "error"); return; }
    const endpoint = String(els.gradingEndpointInput?.value || "").trim();
    if (!endpoint) { setGradingStatus("请先填写批改接口地址。不要把 API key 放在前端网页中。", "error"); return; }
    const originalText = els.gradeBtn?.textContent || "开始评分";
    if (els.gradeBtn) { els.gradeBtn.disabled = true; els.gradeBtn.textContent = "Scoring..."; els.gradeBtn.setAttribute("aria-busy", "true"); }
    if (els.gradingModeSelect) els.gradingModeSelect.disabled = true;
    if (els.gradingEndpointInput) els.gradingEndpointInput.disabled = true;
    try {
      setGradingStatus("第 1 步/1：AI 正在完成纯评分系统。", "loading");
      if (els.gradingResults) els.gradingResults.innerHTML = `<p class="ai-note">正在进行纯评分。旧的打分链路和反馈链路已经从前端流程移除。</p>`;
      const scoreResult = await postStage(endpoint, gradingPayload({ aiStage: "score-core" }));
      renderScoreResult(scoreResult);
      setGradingStatus("评分完成。四项分数已冻结。", "done");
      if (els.gradingModeSelect?.value === "revision") {
        setGradingStatus("评分完成，正在生成作文。", "loading");
        const revision = await postStage(endpoint, gradingPayload({ aiStage: "revision-generator", currentResult: scoreResult }));
        renderRevisionResult(revision);
        setGradingStatus("评分完成；作文生成完成。", "done");
      }
    } catch (error) {
      setGradingStatus(`评分失败：${error.message}`, "error");
      if (els.gradingResults) els.gradingResults.innerHTML = `<section class="grading-section error-details"><h4>错误</h4><pre>${escapeHtml(error.stack || error.message || error)}</pre></section>`;
    } finally {
      if (els.gradeBtn) { els.gradeBtn.disabled = false; els.gradeBtn.textContent = originalText; els.gradeBtn.removeAttribute("aria-busy"); }
      if (els.gradingModeSelect) els.gradingModeSelect.disabled = false;
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
