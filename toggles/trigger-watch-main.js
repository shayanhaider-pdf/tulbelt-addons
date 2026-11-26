// Inspect the selected trigger and explicitly scoped Player values. Do not
// execute trigger handlers or store current values outside the open panel.
(() => {
  const { owners, editor } = window.__tulbeltEditorModel;
  const respond = (el, data) =>
    el.dispatchEvent(new CustomEvent("tulbelt:watch-response", { detail: JSON.stringify(data) }));
  document.addEventListener("tulbelt:watch-trigger", (event) => {
    const row = event.target;
    if (!editor() || !row.matches?.('[class*="triggerRow"],[data-testid="trigger-row"]')) return;
    for (const p of owners(row.querySelector("button:not([data-tulbelt-inspect])") || row)) {
      const trigger = p.trigger ?? p.value;
      if (Array.isArray(trigger?.clauses) && trigger.id) {
        respond(row, window.__tulbeltWatches.project(trigger, p.appVersion || p));
        return;
      }
    }
  });
  function playerContext() {
    if (!/(?:^|\/)player(?:\/|$)/i.test(location.pathname)) return null;
    for (const anchor of document.querySelectorAll(
      '[data-testid="widget"],[data-testid="player"],#cssCanvas,.widget',
    )) {
      for (const p of owners(anchor)) {
        const app = p.appId || p.appVersion?.appId;
        const version = p.appVersionId || p.appVersion?.id;
        if (typeof app === "string" && typeof version === "string") {
          const workspace = p.workspaceId || /\/w\/([^/]+)/.exec(location.pathname)?.[1] || "";
          return { app, version, workspace, anchor };
        }
      }
    }
    return null;
  }
  const maps = {
    variable: "variableValues",
    record: "recordPlaceholderValues",
    aggregation: "aggregationValues",
    query: "queryValues",
  };
  function lookup(map, key) {
    return map instanceof Map
      ? map.has(key)
        ? { value: map.get(key) }
        : null
      : map && Object.hasOwn(map, key)
        ? { value: map[key] }
        : null;
  }
  document.addEventListener("tulbelt:watch-live", (event) => {
    const ctx = playerContext();
    if (!ctx) return;
    const { app, workspace, version } = ctx;
    const request = JSON.parse(event.detail || "{}");
    const values = {};
    if (request.app === app && request.workspace === workspace && request.version === version) {
      for (const p of owners(ctx.anchor)) {
        // A provider carrying another version cannot supply this run's data.
        if ((p.appId && p.appId !== app) || (p.appVersionId && p.appVersionId !== version))
          continue;
        for (const ref of request.refs || []) {
          if (Object.hasOwn(values, ref.key)) continue;
          let slot = lookup(p[maps[ref.kind]], ref.id);
          if (!slot) continue;
          if (ref.kind === "record" && slot.value === null) {
            values[ref.key] = { status: "Record not loaded" };
            continue;
          }
          for (const field of [ref.field, ...(ref.path || [])].filter(Boolean))
            slot = lookup(slot?.value, field);
          if (slot && slot.value !== undefined) values[ref.key] = slot;
        }
      }
    }
    respond(event.target, { app, workspace, version, values });
  });
})();
