// Return only names and stable IDs from explicitly app-wide collections. A
// missing collection is unknown. Never infer a deletion from a partial pane.
(() => {
  const { owners, editor } = window.__tulbeltEditorModel;
  const collections = {
    steps: ["steps", "stepNodes"],
    variables: ["variables"],
    placeholders: ["recordPlaceholders"],
    triggers: ["triggers"],
    queries: ["queries", "tableQueries"],
    aggregations: ["aggregations"],
    connectors: ["connectorFunctions"],
    automations: ["automations"],
  };

  function names(collection) {
    if (!Array.isArray(collection)) return null;
    const entries = [];
    const seen = new Set();
    for (const item of collection) {
      const id = item?.id ?? item?._id;
      if (typeof id !== "string" || !id || seen.has(id) || typeof item.name !== "string")
        return null;
      seen.add(id);
      entries.push([id, item.name]);
    }
    return entries;
  }

  function collect(model, into) {
    for (const [kind, keys] of Object.entries(collections)) {
      for (const key of keys) {
        const list = names(model[key]);
        if (list && !Object.hasOwn(into, kind)) into[kind] = list;
      }
    }
  }

  function inventory() {
    const route = editor();
    const current = {},
      previous = {};
    if (!route) return { current };
    const anchors = document.querySelectorAll(
      '[data-testid="app-editor-snapshot"], #cssCanvas, [data-testid="triggers section"]',
    );
    for (const anchor of anchors) {
      for (const p of owners(anchor)) {
        for (const model of [p.appVersion, p.processVersion, p.applicationVersion, p.app]) {
          if (!model || (model.appId ?? model.processId) !== route.app) continue;
          const version = model.appVersionId ?? model.id ?? model._id;
          if (
            route.version !== version &&
            !(
              ["dev", "development"].includes(route.version) &&
              (model.isDevelopmentVersion === true || ["dev", "development"].includes(model.type))
            )
          )
            continue;
          collect(model, current);
          const last = p.latestSnapshot ?? model.latestSnapshot;
          if (
            last &&
            (last.appId ?? last.processId) === route.app &&
            last.type === "snapshot" &&
            (last.id ?? last._id) &&
            (last.id ?? last._id) !== version
          )
            collect(last, previous);
        }
      }
    }
    return { current, previous: Object.keys(previous).length ? previous : null };
  }

  document.addEventListener("tulbelt:read-inventory", (event) => {
    if (!event.target.matches?.('[data-testid="app-editor-snapshot"]')) return;
    event.target.dispatchEvent(
      new CustomEvent("tulbelt:inventory", { detail: JSON.stringify(inventory()) }),
    );
  });
})();
