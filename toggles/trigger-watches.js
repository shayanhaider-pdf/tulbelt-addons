// An editor inspection is read-only. Pinning shares the configuration with an
// exact matching web Player for this browser session. Test values stay local.
(() => {
  const { registerToggle, addedNodesObserver } = window.__tulbeltLib;
  const { project, evaluate } = window.__tulbeltWatches;
  const rowSelector = '[class*="triggerRowStyles"],[data-testid="trigger-row"]';
  let enabled = false,
    panel,
    profile,
    ctx,
    refresh,
    feedback,
    content,
    pin;
  let values = {},
    trials = new Map(),
    identity = "",
    scopeAtOpen,
    pollBusy = false,
    epoch = 0,
    dismissed = "";
  const editorRoute = () =>
    /^(?:\/w\/([^/]+))?\/apps\/([^/]+)\/versions\/([^/]+)/.exec(location.pathname);
  const playerRoute = () => /(?:^|\/)player(?:\/|$)/i.test(location.pathname);
  function viewKey() {
    return (
      location.pathname +
      (editorRoute() ? "@" + (new URL(location.href).searchParams.get("step") || "") : "")
    );
  }
  function request(target, event, data = {}) {
    let result = null;
    const reply = (e) => {
      result = JSON.parse(e.detail);
    };
    target.addEventListener("tulbelt:watch-response", reply, { once: true });
    try {
      target.dispatchEvent(new CustomEvent(event, { bubbles: true, detail: JSON.stringify(data) }));
    } finally {
      target.removeEventListener("tulbelt:watch-response", reply);
    }
    return result;
  }
  function add(parent, tag, text) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    parent.append(el);
    return el;
  }
  function button(parent, label, fn) {
    const b = add(parent, "button", label);
    b.type = "button";
    b.onclick = fn;
    return b;
  }
  function close() {
    epoch++;
    panel?.remove();
    panel = null;
    profile = null;
    pin = null;
    scopeAtOpen = "";
    trials.clear();
    values = {};
  }
  function frame(name) {
    panel = document.createElement("aside");
    panel.dataset.tulbeltWatch = "";
    panel.setAttribute("aria-label", "Trigger dependencies");
    panel.style.cssText =
      "position:fixed;right:14px;bottom:14px;width:min(395px,93vw);max-height:72vh;overflow:auto;z-index:2147483647;background:#fff;color:#172b40;box-shadow:0 6px 32px #20334c44;border:1px solid #b7c6d1;border-radius:10px;padding:12px;font:13px/1.45 system-ui;text-align:left";
    const header = add(panel, "header");
    header.style.cssText = "display:flex;align-items:center;justify-content:space-between;gap:8px";
    add(header, "strong", name);
    button(header, "Close", () => {
      dismissed = identity;
      close();
    });
    feedback = add(panel, "p");
    feedback.setAttribute("role", "status");
    content = add(panel, "div");
    document.body.append(panel);
  }
  function display(value) {
    if (value === null || value === "") return "Blank";
    if (typeof value === "string") return value;
    return JSON.stringify(value);
  }
  function operandText(a) {
    if (Object.hasOwn(a, "literal")) return JSON.stringify(a.literal) ?? "Unspecified";
    if (a.ref) return profile.refs.find((r) => r.key === a.ref)?.name || "Unresolved reference";
    return [a.name, ...(a.children || []).map(operandText)].filter(Boolean).join(" ");
  }
  function lineText(line) {
    return [line.type, ...line.args.map(operandText)].join(" · ");
  }
  function render() {
    content.replaceChildren();
    const refFields = [],
      results = [];
    if (profile.disabled) add(content, "p", "This trigger is disabled.");
    if (!profile.refs.length)
      add(content, "p", "No recognized variable, record or integration bindings.");
    for (const ref of profile.refs) {
      const box = add(content, "div");
      box.style.cssText = "margin:6px 0;padding:6px 8px;border-left:2px solid #91adc2";
      add(box, "strong", ref.name);
      add(box, "small", " (" + ref.kind + ")");
      const current = add(box, "div");
      const label = add(box, "label", "Try a value ");
      const input = add(label, "input");
      input.placeholder = 'e.g. 0, false, "Ready", null';
      input.setAttribute("aria-label", "Test value for " + ref.name);
      input.style.maxWidth = "100%";
      input.addEventListener("input", () => {
        if (!input.value) trials.delete(ref.key);
        else {
          let value;
          try {
            value = JSON.parse(input.value);
          } catch {
            value = input.value;
          }
          trials.set(ref.key, { value });
        }
        update();
      });
      refFields.push({ ref, current });
    }
    profile.clauses.forEach((clause, i) => {
      const section = add(content, "section");
      section.style.marginTop = "10px";
      const name = i === 0 ? "IF" : clause.conditions.length ? "ELSE IF" : "ELSE";
      add(
        section,
        "strong",
        name +
          (clause.conditions.length
            ? clause.type === "or"
              ? " · any condition"
              : " · " + clause.type
            : ""),
      );
      clause.conditions.forEach((line) => add(section, "div", lineText(line)));
      const result = add(section, "em");
      results.push({ clause, result });
      const list = add(section, "ol");
      list.style.paddingLeft = "22px";
      clause.actions.forEach((line) => add(list, "li", lineText(line)));
    });
    function update() {
      for (const { ref, current } of refFields) {
        const observed = values[ref.key];
        current.textContent =
          "Current: " +
          (observed && Object.hasOwn(observed, "value")
            ? display(observed.value)
            : observed?.status || "Unavailable");
      }
      let prior = false;
      for (const { clause, result } of results) {
        const outcomes = clause.conditions.map((line) =>
          evaluate(line, (key) => trials.get(key) || values[key]),
        );
        let match = null;
        if (!outcomes.length) match = true;
        else if (["and", "all"].includes(clause.type))
          match = outcomes.includes(false) ? false : outcomes.includes(null) ? null : true;
        else if (["or", "any"].includes(clause.type))
          match = outcomes.includes(true) ? true : outcomes.includes(null) ? null : false;
        result.textContent =
          "Preview: " +
          (profile.disabled || prior === true || match === false
            ? "would skip"
            : match === true && prior === false
              ? "would select these actions"
              : "undetermined");
        prior =
          prior === true || match === true ? true : prior === null || match === null ? null : false;
      }
    }
    update();
    return update;
  }
  let updateValues = () => {};
  function show(model, context, player = false) {
    close();
    profile = model;
    ctx = context;
    scopeAtOpen = viewKey();
    frame(model.name);
    feedback.textContent = player
      ? "Web Player watches · configured actions are previews."
      : "Editor configuration · use test values to preview conditions.";
    updateValues = render();
    if (!player)
      pin = button(panel, "Pin watches for Web Player", async () => {
        const current = panel;
        try {
          const ok = await chrome.runtime.sendMessage({ type: "tulbelt-watch-pin", ctx, profile });
          if (current === panel)
            feedback.textContent = ok
              ? "Pinned for this app version in Web Player."
              : "Could not match this app version.";
        } catch {
          if (current === panel) feedback.textContent = "Pinning was unavailable.";
        }
      });
    if (player)
      button(panel, "Unpin watches", async () => {
        await chrome.runtime.sendMessage({ type: "tulbelt-watch-clear", ctx });
        close();
      });
  }
  function inspect(row) {
    const route = editorRoute();
    if (!route) return;
    const context = { app: route[2], workspace: route[1] || "", version: route[3] };
    const model = request(row, "tulbelt:watch-trigger");
    if (model) {
      context.version = model.version || context.version;
      show(model, context);
      return;
    }
    close();
    scopeAtOpen = viewKey();
    frame("Inspect a copied trigger");
    feedback.textContent =
      "Use the native Copy icon on the trigger, then paste into the field below.";
    const field = add(content, "textarea");
    field.placeholder = "Paste Tulip trigger here";
    field.setAttribute("aria-label", field.placeholder);
    field.addEventListener("paste", (event) => {
      event.preventDefault();
      try {
        const html = new DOMParser().parseFromString(
          event.clipboardData.getData("text/html"),
          "text/html",
        );
        const bytes = atob(
          html.querySelector("[data-tulip-clipboard]").getAttribute("data-tulip-clipboard"),
        );
        const data = JSON.parse(
          new TextDecoder().decode(Uint8Array.from(bytes, (c) => c.charCodeAt(0))),
        );
        if (
          !editorRoute() ||
          scopeAtOpen !== viewKey() ||
          data.clipboardType !== "Trigger" ||
          data.sourceAppId !== context.app ||
          (data.sourceWorkspaceId &&
            context.workspace &&
            data.sourceWorkspaceId !== context.workspace) ||
          !data.sourceAppVersionId ||
          (!["dev", "development"].includes(context.version) &&
            data.sourceAppVersionId !== context.version)
        )
          throw Error();
        const projected = project(data.trigger, data);
        if (!projected) throw Error();
        context.version = data.sourceAppVersionId;
        show(projected, context);
      } catch {
        feedback.textContent = "A native trigger copy from this app version is required.";
      }
    });
    field.focus();
  }
  function scan() {
    if (!editorRoute()) return;
    for (const row of document.querySelectorAll(rowSelector)) {
      if (row.querySelector("[data-tulbelt-inspect]")) continue;
      const b = button(row, "⌕", (e) => {
        e.stopPropagation();
        inspect(row);
      });
      b.dataset.tulbeltInspect = "";
      b.title = "Inspect trigger dependencies";
      b.setAttribute("aria-label", b.title);
    }
  }
  async function tick() {
    if (scopeAtOpen && viewKey() !== scopeAtOpen) close();
    if (!playerRoute()) {
      identity = "";
      dismissed = "";
      return;
    }
    if (pollBusy) return;
    const current = request(
      document.body,
      "tulbelt:watch-live",
      profile ? { ...ctx, refs: profile.refs } : {},
    );
    const key = current && JSON.stringify([current.workspace, current.app, current.version]);
    if (identity !== key) {
      close();
      dismissed = "";
      identity = key;
    }
    if (!current || dismissed === key) return;
    if (!profile) {
      const token = epoch;
      pollBusy = true;
      try {
        const found = await chrome.runtime.sendMessage({ type: "tulbelt-watch-get", ctx: current });
        if (found && enabled && token === epoch && playerRoute())
          show(
            found,
            { app: current.app, workspace: current.workspace, version: current.version },
            true,
          );
      } finally {
        pollBusy = false;
      }
    }
    if (profile) {
      values = current.values || {};
      updateValues();
    }
  }
  const observer = addedNodesObserver(rowSelector, scan);
  registerToggle("trigger-dependency-watches", {
    onEnable() {
      enabled = true;
      scan();
      observer.start();
      refresh = setInterval(() => tick().catch(() => {}), 1000);
    },
    onDisable() {
      enabled = false;
      close();
      identity = "";
      dismissed = "";
      observer.stop();
      clearInterval(refresh);
      document.querySelectorAll("[data-tulbelt-inspect]").forEach((el) => el.remove());
    },
  });
})();
