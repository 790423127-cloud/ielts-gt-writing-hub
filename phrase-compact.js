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

  function boot() {
    const root = document.getElementById("phraseGroups");
    if (!root || root.dataset.compactObserver === "on") return;
    root.dataset.compactObserver = "on";
    new MutationObserver(compactPhraseGroups).observe(root, { childList: true });
    compactPhraseGroups();
  }

  document.addEventListener("DOMContentLoaded", boot);
  window.addEventListener("hashchange", () => setTimeout(boot, 0));
  setTimeout(boot, 0);
})();
