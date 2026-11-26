// Only one tab at a time may advance an app's clock or drive its native
// snapshot dialog. Each app has its own storage entry and confirmation state.
(() => {
  const local = chrome.storage.local;
  const buttonSelector = '[data-testid="app-editor-snapshot"]';
  const fieldSelector = '[data-testid="version-description-input"]';
  const modalSelector = '[data-testid="modal"], [role="dialog"]';
  const noticeSelector =
    '[role="alert"], [role="status"], [class*="toast" i], [data-testid*="toast" i]';
  const events = ["pointerdown", "pointermove", "keydown", "wheel", "touchstart"];
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let enabled = false,
    generation = 0,
    busy = false,
    timer,
    lastActivity = 0,
    lastTick = 0;
  let minutes = 15,
    note = "",
    retryAt = 0,
    overlay,
    overlayTimer;
  let pending = 0,
    lastScope = "",
    manual = null;

  function scope() {
    const path = /^(?:\/w\/([^/]+))?\/apps\/([^/]+)\/versions\/([^/]+)/.exec(location.pathname);
    return (
      path && "snapshot.v2:" + JSON.stringify([location.origin, path[1] || "", path[2], path[3]])
    );
  }
  function active() {
    lastActivity = Date.now();
  }
  function tell(message, sticky = false) {
    if (!enabled) return;
    clearTimeout(overlayTimer);
    if (!overlay) {
      overlay = document.createElement("div");
      overlay.dataset.tulbeltSnapshot = "";
      overlay.setAttribute("role", "status");
      overlay.style.cssText =
        "position:fixed;right:16px;top:16px;z-index:2147483647;max-width:340px;padding:10px 14px;border-radius:7px;background:#183d60;color:white;font:13px/1.45 system-ui";
      document.body.append(overlay);
    }
    overlay.textContent = message;
    if (!sticky)
      overlayTimer = setTimeout(() => {
        overlay?.remove();
        overlay = null;
      }, 5500);
  }
  function offerResume(key) {
    if (!enabled || key !== scope()) return;
    tell("Tulip has not confirmed the last snapshot. Check the Versions history.", true);
    const resume = document.createElement("button");
    resume.type = "button";
    resume.textContent = "Resume timer after checking history";
    resume.onclick = async () => {
      resume.disabled = true;
      await navigator.locks.request(key, async () => {
        const snapshot = await state(key);
        if (snapshot.uncertain) await local.set({ [key]: { elapsed: 0, baseline: null } });
      });
      if (enabled && key === scope())
        tell("Timer resumed. The next confirmed snapshot establishes a fresh baseline.");
    };
    overlay.append(document.createElement("br"), resume);
  }
  function inventory(btn) {
    let result = { current: {}, previous: null };
    const receive = (e) => {
      result = JSON.parse(e.detail);
    };
    btn.addEventListener("tulbelt:inventory", receive, { once: true });
    try {
      btn.dispatchEvent(new Event("tulbelt:read-inventory", { bubbles: true }));
    } finally {
      btn.removeEventListener("tulbelt:inventory", receive);
    }
    return result;
  }
  function describe(previous, current, nativePrevious) {
    if (!previous) return "First observed snapshot. No earlier baseline available.";
    const changes = [],
      coverage = [];
    for (const [kind, entries] of Object.entries(current)) {
      if (!Object.hasOwn(previous, kind)) continue;
      coverage.push(kind);
      const before = new Map(previous[kind]),
        after = new Map(entries);
      const added = [],
        removed = [],
        renamed = [];
      for (const [id, name] of after) {
        if (!before.has(id)) added.push(name);
        else if (before.get(id) !== name) renamed.push(before.get(id) + " → " + name);
      }
      for (const [id, name] of before) if (!after.has(id)) removed.push(name);
      for (const [verb, list] of [
        ["Added", added],
        ["Removed", removed],
        ["Renamed", renamed],
      ]) {
        if (list.length) changes.push(verb + " " + kind + ": " + list.sort().join(", "));
      }
    }
    if (!coverage.length) return "Structural comparison unavailable for this snapshot.";
    return (
      (nativePrevious
        ? "Since the previous snapshot ("
        : "Since the last snapshot observed by Tulbelt (") +
      coverage.join(", ") +
      "): " +
      (changes.length
        ? "\n• " + changes.join("\n• ")
        : "No additions, removals or renames in these assets.")
    );
  }
  // An old toast or a dismissed modal cannot establish successful creation.
  function watchResult() {
    let finish;
    const promise = new Promise((resolve) => {
      finish = resolve;
    });
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        const nodes = [...record.addedNodes, record.target];
        for (const node of nodes) {
          const el = node.nodeType === 1 ? node : node.parentElement;
          if (!el || el.closest("[data-tulbelt-snapshot]")) continue;
          const notices = [
            el.closest(noticeSelector),
            ...Array.from(
              node.nodeType === 1 && node !== record.target
                ? node.querySelectorAll(noticeSelector)
                : [],
            ),
          ];
          for (const notice of notices) {
            if (!notice || notice.closest("[data-tulbelt-snapshot]")) continue;
            const msg = notice.textContent.trim();
            if (!/\bsnapshot\b/i.test(msg)) continue;
            if (/\b(?:failed|unable|error|cannot|unsuccessful|not|never)\b/i.test(msg))
              finish(false);
            else if (
              /\bsnapshot\b.{0,45}\b(?:created|saved)\b|\b(?:created|saved)\b.{0,35}\bsnapshot\b/i.test(
                msg,
              )
            )
              finish(true);
          }
        }
      }
    });
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    const timeout = setTimeout(() => finish(null), 10000);
    return promise.finally(() => {
      clearTimeout(timeout);
      observer.disconnect();
    });
  }
  async function state(key) {
    const existing = (await local.get(key))[key];
    if (existing) return existing;
    // Adopt an old per-app counter once for this tenant, even if the user opens
    // another version later. New writes always use the fully scoped key.
    const [, , id] = JSON.parse(key.slice("snapshot.v2:".length));
    const claim = "snapshot.migrated:" + id;
    return navigator.locks.request(claim, async () => {
      const old = await local.get([key, claim, "autoSnapshotState"]);
      if (old[key]) return old[key];
      const value = old.autoSnapshotState?.[id];
      const elapsed = !old[claim] && Number.isFinite(value) && value > 0 ? value : 0;
      const initial = { elapsed, baseline: null };
      await local.set({ [key]: initial, [claim]: true });
      return initial;
    });
  }
  function usable(el) {
    return el && !el.disabled && el.getAttribute("aria-disabled") !== "true";
  }
  function finishSnapshot(result, snapshot, current) {
    if (result === true) return { elapsed: 0, baseline: current };
    return { ...snapshot, uncertain: result === null };
  }
  async function capture(key, snapshot, btn, run) {
    const valid = () => enabled && generation === run && key === scope();
    const { current, previous } = inventory(btn);
    const message = [
      note.trim(),
      "Tulbelt snapshot after " + minutes + " min of active editing.",
      describe(previous || snapshot.baseline, current, !!previous),
    ]
      .filter(Boolean)
      .join("\n");
    btn.click();
    let field;
    for (let i = 0; i < 50 && valid(); i++) {
      field = document.querySelector(fieldSelector);
      if (field) break;
      await sleep(100);
    }
    if (!field || !valid()) return;
    const dialog = field.closest(modalSelector);
    if (!dialog) return;
    const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
    if (!setter) return;
    const max = field.maxLength;
    const description = max > 0 && message.length > max ? message.slice(0, max - 1) + "…" : message;
    setter.call(field, description);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    await sleep(150);
    const confirm = dialog.querySelector('[data-testid="publish-confirm"]');
    if (!valid()) {
      if (key === scope() && field.isConnected && field.value === description)
        dialog.querySelector('[data-testid="close-modal-button"]')?.click();
      return;
    }
    if (
      !field.isConnected ||
      field.value !== description ||
      !usable(confirm) ||
      !dialog.contains(field)
    )
      return;
    await local.set({ [key]: { ...snapshot, uncertain: true } });
    if (!valid() || !confirm.isConnected || !usable(confirm)) {
      await local.set({ [key]: snapshot });
      return;
    }
    const resultPending = watchResult();
    confirm.click();
    const result = await resultPending;
    await local.set({ [key]: finishSnapshot(result, snapshot, current) });
    if (valid()) {
      if (result === null) offerResume(key);
      else tell(result ? "Snapshot created." : "Tulip reported a snapshot error.");
    }
  }
  // A manual snapshot observed in this tab also establishes a new baseline.
  function onClick(event) {
    if (!event.isTrusted || !enabled) return;
    const btn = event.target.closest?.(buttonSelector);
    if (btn && scope()) manual = { key: scope(), current: inventory(btn).current };
    if (!manual || !event.target.closest?.('[data-testid="publish-confirm"]')) return;
    if (
      !event.target.closest(modalSelector)?.querySelector(fieldSelector) ||
      manual.key !== scope()
    )
      return;
    const { key, current } = manual;
    manual = null;
    const result = watchResult();
    void navigator.locks.request(key, async () => {
      const snapshot = await state(key);
      const outcome = await result;
      if (outcome === true) await local.set({ [key]: { elapsed: 0, baseline: current } });
      else if (outcome === null) await local.set({ [key]: { ...snapshot, baseline: null } });
      if (outcome === true && enabled && key === scope() && overlay)
        tell("Snapshot confirmed. Timer resumed.");
    });
  }
  function storeTime(key, elapsed) {
    if (!key || !elapsed) return;
    void navigator.locks
      .request(key, async () => {
        const snapshot = await state(key);
        snapshot.elapsed += elapsed;
        await local.set({ [key]: snapshot });
      })
      .catch(() => {});
  }
  async function tick() {
    const key = scope(),
      now = Date.now(),
      run = generation;
    if (key !== lastScope) {
      storeTime(lastScope, pending);
      lastScope = key;
      pending = 0;
      manual = null;
      lastTick = now;
      retryAt = 0;
      overlay?.remove();
      overlay = null;
      if (key && (await state(key)).uncertain) offerResume(key);
    }
    const delta = Math.min(1000, Math.max(0, now - lastTick));
    lastTick = now;
    if (!key || busy || document.hidden || !document.hasFocus() || now - lastActivity >= 60000)
      return;
    pending += delta;
    if (pending < 5000) return;
    const elapsed = pending;
    pending = 0;
    busy = true;
    try {
      await navigator.locks.request(key, async () => {
        const snapshot = await state(key);
        snapshot.elapsed += elapsed;
        await local.set({ [key]: snapshot });
        const btn = document.querySelector(buttonSelector);
        if (
          run !== generation ||
          key !== scope() ||
          !enabled ||
          snapshot.uncertain ||
          snapshot.elapsed < minutes * 60000 ||
          now < retryAt ||
          !usable(btn) ||
          document.querySelector(modalSelector)
        )
          return;
        retryAt = now + 60000;
        await capture(key, snapshot, btn, run);
      });
    } finally {
      busy = false;
    }
  }
  function setEnabled(next) {
    if (enabled === next) return;
    enabled = next;
    generation++;
    if (next) {
      lastTick = Date.now();
      lastScope = scope();
      active();
      events.forEach((e) => window.addEventListener(e, active, { capture: true, passive: true }));
      document.addEventListener("click", onClick, true);
      timer = setInterval(() => tick().catch(() => {}), 1000);
      if (lastScope)
        void state(lastScope).then((s) => {
          if (s.uncertain) offerResume(lastScope);
        });
    } else {
      clearInterval(timer);
      clearTimeout(overlayTimer);
      overlay?.remove();
      overlay = null;
      storeTime(lastScope, pending);
      lastScope = "";
      pending = 0;
      manual = null;
      events.forEach((e) => window.removeEventListener(e, active, true));
      document.removeEventListener("click", onClick, true);
    }
  }
  function settings(values) {
    minutes = [15, 30, 60, 120].includes(values.snapshotMinutes) ? values.snapshotMinutes : 15;
    note = typeof values.snapshotNote === "string" ? values.snapshotNote : "";
    setEnabled(values.toggles?.["auto-snapshot"] === true);
  }
  const keys = ["toggles", "snapshotMinutes", "snapshotNote"];
  const sync = () => local.get(keys).then(settings);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && keys.some((k) => Object.hasOwn(changes, k))) void sync();
  });
  window.addEventListener("pagehide", () => {
    storeTime(lastScope, pending);
    pending = 0;
  });
  void sync();
})();
