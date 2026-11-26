// Project a trigger definition into readable dependencies and clause logic.
// Keep configured arguments separate from values observed during a run.
(() => {
  const labels = {
    variable: ["variableId", "variableName", "appVariableId"],
    record: ["recordPlaceholderId", "placeholderId", "tableRecordId", "recordId"],
    aggregation: ["aggregationId", "tableAggregationId"],
    query: ["queryId", "tableQueryId"],
    connector: ["connectorFunctionId", "functionId"],
    automation: ["automationId"],
  };
  function project(trigger, catalog = {}) {
    if (!Array.isArray(trigger?.clauses)) return null;
    const refs = new Map();
    function operand(input) {
      if (input === null || typeof input !== "object") return { literal: input };
      if (Array.isArray(input)) return { children: input.map(operand) };
      const type = String(input.datasourceType || "");
      const params = input.params || input;
      if (type.toLowerCase() === "static") return { literal: params.value };
      for (const [kind, keys] of Object.entries(labels)) {
        const idKey = keys.find((k) => typeof params[k] === "string");
        const hinted = type.toLowerCase().includes(kind);
        const id = idKey ? params[idKey] : hinted ? params.id : null;
        if (typeof id !== "string" || !id) continue;
        const field = params.fieldId || params.columnId || params.field || "";
        const path = params.path || input.path || [];
        const bindingPath =
          Array.isArray(path) && path.every((x) => typeof x === "string")
            ? path
            : typeof path === "string" && path
              ? [path]
              : [];
        const key = JSON.stringify([kind, id, field, bindingPath]);
        const names =
          kind === "record"
            ? catalog.recordPlaceholders
            : catalog[kind === "query" ? "queries" : kind + "s"] || [];
        const name =
          (Array.isArray(names)
            ? names.find((item) => (item?.id ?? item?._id) === id)?.name
            : null) ||
          params.name ||
          params.variableName ||
          id;
        const ref = {
          key,
          kind,
          id,
          field,
          path: bindingPath,
          name: [name, field, ...bindingPath].filter(Boolean).join(" / "),
        };
        refs.set(key, ref);
        return { ref: key };
      }
      const children = Object.entries(input)
        .filter(
          ([k, v]) =>
            ![
              "id",
              "schema",
              "permissions",
              "name",
              "type",
              "datasourceType",
              "isTransition",
            ].includes(k) && v != null,
        )
        .map(([k, v]) => {
          if (
            ["params", "inputs", "outputs", "operands", "left", "right", "value"].includes(k) ||
            typeof v === "object"
          )
            return operand(v);
          return { literal: v };
        });
      return { name: type || input.type || "", children };
    }
    function line(item) {
      const args = [];
      for (const [key, value] of Object.entries(item || {})) {
        if (["id", "type", "name", "isTransition", "disabled", "operator"].includes(key)) continue;
        if (Array.isArray(value)) args.push(...value.map(operand));
        else if (value != null) args.push(operand({ [key]: value }));
      }
      return { type: item.operator || item.type || "Unspecified", args };
    }
    const clauses = trigger.clauses.map((c) => ({
      type: c.type,
      conditions: (c.conditions || []).map(line),
      actions: (c.actions || []).map(line),
    }));
    return {
      name: trigger.name || "Trigger",
      id: trigger.id,
      version: trigger.appVersionId,
      event: trigger.event?.type || "",
      disabled: !!trigger.disabled,
      clauses,
      refs: [...refs.values()],
    };
  }
  function evaluate(line, resolve) {
    const args = line.args.map((arg) =>
      Object.hasOwn(arg, "literal") ? { value: arg.literal } : arg.ref ? resolve(arg.ref) : null,
    );
    if (args.some((a) => !a || !Object.hasOwn(a, "value"))) return null;
    const [a, b] = args.map((x) => x.value);
    const op = String(line.type).toLowerCase().replace(/[_ ]/g, "-");
    if (args.length === 1) {
      if (op === "is-blank") return a === null || a === "";
      if (op === "is-not-blank") return a !== null && a !== "";
      return null;
    }
    if (args.length !== 2) return null;
    if ((a !== null && typeof a === "object") || (b !== null && typeof b === "object")) return null;
    if (["equals", "equal", "is-equal-to", "="].includes(op)) return a === b;
    if (["not-equals", "not-equal", "!="].includes(op)) return a !== b;
    if (typeof a !== "number" || typeof b !== "number") return null;
    return (
      {
        "greater-than": a > b,
        "less-than": a < b,
        "greater-than-or-equal": a >= b,
        "less-than-or-equal": a <= b,
      }[op] ?? null
    );
  }
  window.__tulbeltWatches = { project, evaluate };
})();
