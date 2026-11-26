// Resolve the exact rendered row and an editable parent on every click. Only
// controlled draft collections are updated; there is no server write or Save.
(() => {
  const { owners, editor } = window.__tulbeltEditorModel;
  let clip = null;
  const groupNames = { actions: "THEN", conditions: "IF" };
  function scope() {
    const route = editor();
    return route && JSON.stringify([location.origin, route.workspace, route.app, route.version]);
  }
  function rowData(row, kind) {
    const props = [...owners(row.querySelector("select,input,textarea") || row)];
    const singular = kind === "actions" ? "action" : "condition";
    for (const p of props) {
      const item = p[singular] || p.value;
      if (
        !item ||
        typeof item.id !== "string" ||
        typeof item.type !== "string" ||
        item.clauses ||
        item.actions ||
        item.conditions
      )
        continue;
      const lists = props.flatMap((owner) => [
        owner[kind],
        owner.value?.[kind],
        owner.clause?.[kind],
        Array.isArray(owner.value) ? owner.value : null,
      ]);
      if (
        p[singular] !== item &&
        !lists.some((list) => Array.isArray(list) && list.some((x) => x?.id === item.id))
      )
        continue;
      return { item, props };
    }
    return null;
  }
  function destination(data, kind) {
    const key = kind === "actions" ? "onChangeActions" : "onChangeConditions";
    // Only call onChange when its companion value is exactly the list or
    // clause that owns this row. Never guess a general update or save method.
    const owns = (list) =>
      Array.isArray(list) &&
      (data.item
        ? list.filter((item) => item?.id === data.item.id).length === 1
        : list.length === 0);
    for (const p of data.props) {
      if (owns(p[kind]) && typeof p[key] === "function")
        return { list: p[kind], change: (list) => p[key](list) };
      if (data.item && owns(p.value) && typeof p.onChange === "function")
        return { list: p.value, change: (list) => p.onChange(list) };
      for (const [clause, change] of [
        [p.value, p.onChange],
        [p.clause, p.onChangeClause],
      ]) {
        if (
          owns(clause?.[kind]) &&
          Array.isArray(clause.actions) &&
          Array.isArray(clause.conditions) &&
          typeof change === "function"
        )
          return { list: clause[kind], change: (list) => change({ ...clause, [kind]: list }) };
      }
    }
    return null;
  }
  function contextual(value) {
    if (!value || typeof value !== "object") return false;
    return Object.entries(value).some(
      ([key, v]) =>
        ["widgetId", "eventOutputId", "machineOutputId", "deviceOutputId"].includes(key) ||
        (key === "datasourceType" &&
          /event|this-widget|device.output|machine.output/i.test(String(v))) ||
        contextual(v),
    );
  }
  function act(btn) {
    const tools = btn.closest("[data-tulbelt-line-tools]");
    const empty = tools?.hasAttribute("data-empty-clause");
    const row = empty ? tools.previousElementSibling : tools?.parentElement;
    const kind = tools?.dataset.tulbeltLineTools;
    if (!editor() || !Object.hasOwn(groupNames, kind)) return;
    const status = tools.querySelector("[role=status]");
    const show = (msg) => {
      status.textContent = msg;
    };
    const data = row && (empty ? { item: null, props: [...owners(row)] } : rowData(row, kind));
    if (!data) return show("This Tulip build does not expose this row as editable logic.");
    if (btn.dataset.tulbeltLine === "copy") {
      if (data.item.isTransition) return show("Transitions need their native destination control.");
      if (contextual(data.item))
        return show("This line uses an event or widget-specific binding. Rebind it in Tulip.");
      clip = { scope: scope(), kind, item: structuredClone(data.item) };
      return show("Copied one " + groupNames[kind] + " line.");
    }
    if (!clip || clip.scope !== scope()) return show("Copy a line from this app version first.");
    if (clip.kind !== kind) return show("Choose another " + groupNames[clip.kind] + " line.");
    const target = destination(data, kind);
    if (!target) return show("No editable clause exposed here. The trigger has not been changed.");
    const offset = btn.dataset.tulbeltLine === "after" ? 1 : 0;
    const index = empty ? 0 : target.list.findIndex((item) => item.id === data.item.id) + offset;
    if (target.list.slice(0, index).some((item) => item.isTransition))
      return show("Choose a position before the transition.");
    const fresh = structuredClone(clip.item);
    fresh.id = crypto.randomUUID();
    const next = target.list.slice();
    next.splice(index, 0, fresh);
    target.change(next);
    // Some editors reject a change and some remount the controls. Verify the
    // actual new row ID before telling the builder that the paste succeeded.
    setTimeout(() => {
      const inserted = [...document.querySelectorAll("[data-tulbelt-line-tools]")].some(
        (t) =>
          !t.hasAttribute("data-empty-clause") &&
          t.dataset.tulbeltLineTools === kind &&
          rowData(t.parentElement, kind)?.item.id === fresh.id,
      );
      const message = inserted
        ? "Line inserted. Review the trigger and choose Save."
        : "Insertion could not be verified. Check the draft before saving or retrying.";
      document.dispatchEvent(new CustomEvent("tulbelt:line-result", { detail: message }));
    }, 300);
  }
  document.addEventListener(
    "click",
    (event) => {
      const btn = event.target.closest?.("button[data-tulbelt-line]");
      if (!btn || !event.isTrusted || !btn.closest("[data-tulbelt-line-tools]")) return;
      event.preventDefault();
      event.stopPropagation();
      try {
        act(btn);
      } catch {
        const status = btn.parentElement.querySelector("[role=status]");
        if (status) status.textContent = "This row could not be copied or pasted. Check the draft.";
      }
    },
    true,
  );
  document.addEventListener("tulbelt:clear-line", () => {
    clip = null;
  });
})();
