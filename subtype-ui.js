(() => {
  "use strict";

  const ALL = "all";
  let refreshQueued = false;

  const byId = (id) => document.getElementById(id);
  const promptData = () => Array.isArray(window.IELTS_GT_DATA?.prompts) ? window.IELTS_GT_DATA.prompts : [];
  const subtypeOf = (prompt) => String(prompt?.subtype || prompt?.purpose || "未分类 / Unclassified");

  function queueRefresh() {
    if (refreshQueued) return;
    refreshQueued = true;
    window.requestAnimationFrame(() => {
      refreshQueued = false;
      installAndRefresh();
    });
  }

  function addOption(select, value, label) {
    const option = document.createElement("option");
    option.value = value;
    option.textContent = label;
    select.appendChild(option);
  }

  function ensureSubtypeControl() {
    const existing = byId("subtypeFilter");
    if (existing) return existing;

    const typeFilter = byId("typeFilter");
    const filters = document.querySelector(".filters.command-bar");
    if (!typeFilter || !filters) return null;

    const label = document.createElement("label");
    label.id = "subtypeFilterLabel";
    label.innerHTML = "<span>小题型 / Subtype</span>";

    const select = document.createElement("select");
    select.id = "subtypeFilter";
    select.setAttribute("aria-label", "小题型筛选");
    label.appendChild(select);

    const typeLabel = typeFilter.closest("label");
    if (typeLabel) typeLabel.insertAdjacentElement("afterend", label);
    else filters.appendChild(label);

    select.addEventListener("change", applySubtypeFilter);
    return select;
  }

  function rebuildSubtypeOptions() {
    const select = ensureSubtypeControl();
    if (!select) return;

    const previous = select.value || ALL;
    const task = byId("taskFilter")?.value || ALL;
    const type = byId("typeFilter")?.value || ALL;

    const values = [...new Set(promptData()
      .filter((prompt) => (task === ALL || prompt.task === task) && (type === ALL || prompt.type === type))
      .map(subtypeOf))]
      .sort((a, b) => a.localeCompare(b, "zh-CN"));

    select.replaceChildren();
    addOption(select, ALL, "全部小题型");
    values.forEach((value) => addOption(select, value, value));
    select.value = values.includes(previous) ? previous : ALL;
  }

  function addSubtypeTag(container, prompt) {
    if (!container || !prompt) return;
    const value = subtypeOf(prompt);
    let tag = container.querySelector(".subtype-tag");
    if (!tag) {
      tag = document.createElement("span");
      tag.className = "tag type subtype-tag";
      container.appendChild(tag);
    }
    tag.textContent = `小题型：${value}`;
    tag.title = "小题型 / Subtype";
  }

  function decorateVisiblePromptCards() {
    const promptsById = new Map(promptData().map((prompt) => [prompt.id, prompt]));
    document.querySelectorAll("#promptList button[data-id]").forEach((button) => {
      addSubtypeTag(button.querySelector(".tags"), promptsById.get(button.dataset.id));
    });
  }

  function currentSelectedPrompt() {
    const activeButton = document.querySelector("#promptList button.active[data-id]");
    const activeId = activeButton?.dataset?.id;
    if (activeId) return promptData().find((prompt) => prompt.id === activeId) || null;

    const heading = byId("practiceTitle")?.textContent || "";
    return promptData().find((prompt) => heading.includes(prompt.title)) || null;
  }

  function decorateSelectedPrompt() {
    const prompt = currentSelectedPrompt();
    if (!prompt) return;

    addSubtypeTag(byId("metaTags"), prompt);

    const infoGrid = byId("infoGrid");
    if (!infoGrid) return;

    let info = infoGrid.querySelector("[data-subtype-info]");
    if (!info) {
      info = document.createElement("div");
      info.className = "info";
      info.dataset.subtypeInfo = "true";
      infoGrid.appendChild(info);
    }
    info.innerHTML = "";
    const label = document.createElement("span");
    label.textContent = "小题型 / Subtype";
    const value = document.createElement("strong");
    value.textContent = subtypeOf(prompt);
    info.append(label, value);

    // The previous data sync displayed this field as “目的”. Rename it in the UI
    // so the hierarchy is consistently: 大题型 → 小题型.
    infoGrid.querySelectorAll(".info").forEach((card) => {
      const name = card.querySelector("span");
      if (name && ["写信目的", "题目目的"].includes(name.textContent.trim())) {
        name.textContent = "小题型 / Subtype";
      }
    });
  }

  function applySubtypeFilter() {
    const select = byId("subtypeFilter");
    const wanted = select?.value || ALL;
    const promptsById = new Map(promptData().map((prompt) => [prompt.id, prompt]));
    const buttons = [...document.querySelectorAll("#promptList button[data-id]")];
    let shown = 0;

    buttons.forEach((button) => {
      const prompt = promptsById.get(button.dataset.id);
      const matched = wanted === ALL || subtypeOf(prompt) === wanted;
      button.hidden = !matched;
      if (matched) shown += 1;
    });

    const count = byId("countLabel");
    if (count && wanted !== ALL) count.textContent = `${shown} / ${buttons.length} · 小题型`;

    decorateVisiblePromptCards();
    decorateSelectedPrompt();
  }

  function bindCoreFilters() {
    [byId("taskFilter"), byId("typeFilter"), byId("searchInput"), byId("bookFilter"), byId("testFilter")]
      .filter(Boolean)
      .forEach((control) => {
        if (control.dataset.subtypeBound === "true") return;
        control.addEventListener("change", () => window.setTimeout(queueRefresh, 0));
        control.addEventListener("input", () => window.setTimeout(queueRefresh, 0));
        control.dataset.subtypeBound = "true";
      });
  }

  function installAndRefresh() {
    if (!promptData().length || !byId("promptList")) return;
    ensureSubtypeControl();
    bindCoreFilters();
    rebuildSubtypeOptions();
    applySubtypeFilter();
  }

  document.addEventListener("click", (event) => {
    if (event.target.closest?.("#promptList button[data-id]")) {
      window.setTimeout(queueRefresh, 0);
    }
  }, true);

  document.addEventListener("DOMContentLoaded", () => {
    const list = byId("promptList");
    if (list) new MutationObserver(queueRefresh).observe(list, { childList: true, subtree: true });
    const app = document.querySelector(".app-shell");
    if (app) new MutationObserver(queueRefresh).observe(app, { childList: true, subtree: true });
    queueRefresh();
  });
})();
