// Add row-level controls to the native trigger editor, including rows that
// mount after a clause is expanded. Removing the toggle removes its clipboard.
(() => {
  const { registerToggle, addedNodesObserver } = window.__tulbeltLib;
  const action = '.action-body, [data-testid="trigger-action-row"]';
  const condition =
    '.condition-body, [data-testid="trigger-condition-row"], [class*="conditionBodyStyles"]';
  const selector = action + ", " + condition;
  const addRow =
    'button[data-testid*="add-action"], button[data-testid*="add-condition"], button[aria-label="Add action" i], button[aria-label="Add condition" i]';
  let feedback;
  function scan() {
    if (!/\/apps\/[^/]+\/versions\//.test(location.pathname)) return;
    for (const add of document.querySelectorAll(addRow)) {
      if (
        add.disabled ||
        add.closest(".view-only,[aria-readonly=true]") ||
        add.nextElementSibling?.hasAttribute("data-empty-clause")
      )
        continue;
      const bar = document.createElement("span");
      const isCondition = /condition/i.test(add.dataset.testid || add.getAttribute("aria-label"));
      bar.dataset.tulbeltLineTools = isCondition ? "conditions" : "actions";
      bar.setAttribute("data-empty-clause", "");
      const b = document.createElement("button");
      b.type = "button";
      b.dataset.tulbeltLine = "first";
      b.textContent = isCondition ? "Paste first IF" : "Paste first THEN";
      const status = document.createElement("small");
      status.setAttribute("role", "status");
      bar.append(b, status);
      add.after(bar);
    }
    for (const row of document.querySelectorAll(selector)) {
      if (row.querySelector(selector) || row.querySelector(":scope > [data-tulbelt-line-tools]"))
        continue;
      const fields = row.querySelectorAll("input:not([type=hidden]), select, textarea");
      if (
        !fields.length ||
        [...fields].every((el) => el.disabled || el.readOnly) ||
        row.closest(".view-only,[aria-readonly=true]")
      )
        continue;
      const bar = document.createElement("span");
      bar.dataset.tulbeltLineTools = row.matches(action) ? "actions" : "conditions";
      bar.style.cssText =
        "display:flex;gap:4px;align-items:center;flex-wrap:wrap;font:12px system-ui";
      for (const [id, label] of [
        ["copy", "Copy line"],
        ["before", "Paste before"],
        ["after", "Paste after"],
      ]) {
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = label;
        button.dataset.tulbeltLine = id;
        bar.append(button);
      }
      const status = document.createElement("small");
      status.setAttribute("role", "status");
      bar.append(status);
      row.append(bar);
    }
  }
  function report(event) {
    feedback?.remove();
    feedback = document.createElement("div");
    feedback.setAttribute("role", "status");
    feedback.style.cssText =
      "position:fixed;bottom:16px;left:16px;z-index:2147483647;background:#193551;color:white;padding:8px 12px;border-radius:6px;font:13px system-ui";
    feedback.textContent = event.detail;
    document.body.append(feedback);
    const current = feedback;
    setTimeout(() => current.remove(), 5500);
  }
  const observer = addedNodesObserver(selector + ", " + addRow + ", select, textarea, input", scan);
  registerToggle("trigger-line-copy", {
    onEnable() {
      scan();
      observer.start();
      document.addEventListener("tulbelt:line-result", report);
    },
    onDisable() {
      observer.stop();
      document.removeEventListener("tulbelt:line-result", report);
      document.querySelectorAll("[data-tulbelt-line-tools]").forEach((el) => el.remove());
      document.dispatchEvent(new Event("tulbelt:clear-line"));
      feedback?.remove();
    },
  });
})();
