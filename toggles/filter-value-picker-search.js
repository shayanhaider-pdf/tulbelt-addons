// Search the Variable and Table Record value pickers in a Tulip table-widget filter.
// This is an isolated-world DOM enhancement; it never writes Tulip data.
(() => {
  "use strict";
  const { registerToggle, ensureStyles, removeStyles } = window.__tulbeltLib;
  const FEATURE = "filter-value-picker-search";
  const STYLE = "tulbelt-filter-value-search-style";
  const POPPERS = '[x-attr-popper="popper"],[data-testid="popper"],[role="listbox"]';
  const OPTIONS = 'li button:not([disabled]),li [role="option"]:not([aria-disabled="true"]),[role="option"]:not([aria-disabled="true"])';
  const css = [
    '.tulbelt-fvs{position:absolute!important;z-index:2147483640!important;display:flex!important;flex-direction:column!important;box-sizing:border-box!important;min-width:230px;max-width:420px;min-height:205px;border:1px solid #c8d0db;border-radius:6px;background:#fff;color:#182536;box-shadow:0 8px 28px #0003;font:13px system-ui,sans-serif;}',
    '.tulbelt-fvs input{flex:none;box-sizing:border-box;width:calc(100% - 16px);margin:8px;padding:8px;border:1px solid #acb7c5;border-radius:4px;background:#fff;color:#182536;font:inherit;}',
    '.tulbelt-fvs-list{flex:1;min-height:0;overflow-y:auto;overscroll-behavior:contain;}',
    '.tulbelt-fvs-list button{display:block;width:100%;padding:9px 11px;border:0;border-bottom:1px solid #eef0f3;background:white;color:#182536;text-align:left;font:inherit;cursor:pointer;overflow-wrap:anywhere;}',
    '.tulbelt-fvs-list button:hover,.tulbelt-fvs-list button:focus-visible{background:#eaf3ff;}',
    '.tulbelt-fvs-status{flex:none;padding:6px 9px;border-top:1px solid #e7eaf0;color:#657080;font-size:11px;}'
  ].join("\n");
  let enabled = false, observer = null, state = null, pending = null, frameScheduled = false;

  const labelOf = (el) => (el.getAttribute("aria-label") || el.textContent || "").replace(/\s+/g, " ").trim();
  const visible = (el) => !!(el && el.isConnected && el.getClientRects().length &&
    getComputedStyle(el).display !== "none" && getComputedStyle(el).visibility !== "hidden");

  function filterDialogContains(button) {
    // Restrict to table-widget filter editor, not every variable chooser in Tulip.
    for (let el = button.parentElement, i = 0; el && i < 15; el = el.parentElement, i++) {
      const t = el.textContent || "";
      if (/\bFilters\b/i.test(t) && /include records matching/i.test(t)) return true;
      if (el.matches('[role="dialog"],[aria-modal="true"],.ReactModal__Content')) break;
    }
    return false;
  }
  function pickerButton(button) {
    const text = labelOf(button);
    return /^(variable|variables|table record|table record field|table records)$/i.test(text) ||
      /^select (a )?(variable|table record|table record field)/i.test(text);
  }
  function realOptions(root) {
    const found = new Set();
    return Array.from(root.querySelectorAll(OPTIONS)).filter((el) => {
      if (found.has(el) || !visible(el) || el.closest('li[disabled],li[aria-disabled="true"]')) return false;
      if (!labelOf(el)) return false;
      found.add(el);
      return true;
    });
  }
  function scrollerIn(popper) {
    const nodes = [popper, ...popper.querySelectorAll("*")];
    const virtual = nodes.find((el) => el.matches &&
      el.matches('[style*="overflow: auto"][style*="will-change: transform"]') &&
      el.querySelector("li"));
    if (virtual) return virtual;
    const scrolling = nodes.filter((el) => el.querySelector && el.querySelector("li") &&
      el.clientHeight > 25 && el.scrollHeight > el.clientHeight + 2);
    return scrolling[scrolling.length - 1] || nodes.find((el) => el.querySelector && el.querySelector("li")) || popper;
  }
  function findPopper(anchor) {
    const box = anchor.getBoundingClientRect();
    const choices = Array.from(document.querySelectorAll(POPPERS))
      .filter((el) => visible(el) && !el.closest(".tulbelt-fvs") && realOptions(el).length);
    const newChoices = choices.filter((el) => !pending.existing.has(el));
    const options = newChoices.length ? newChoices : choices;
    return options.map((el) => {
      const r = el.getBoundingClientRect();
      const dx = Math.max(0, r.left - box.right, box.left - r.right);
      const dy = Math.max(0, r.top - box.bottom, box.top - r.bottom);
      return { el, score: dx + dy };
    }).sort((a, b) => a.score - b.score)[0]?.el || null;
  }
  function topOf(option, scroller) {
    const row = option.closest('[style*="position: absolute"]');
    if (row) {
      const top = parseFloat(row.style.top);
      if (Number.isFinite(top)) return top;
    }
    return Math.max(0, scroller.scrollTop + option.getBoundingClientRect().top -
      scroller.getBoundingClientRect().top);
  }
  function redraw(s) {
    if (s !== state) return;
    const q = s.input.value.toLocaleLowerCase().trim();
    const matches = s.items.filter((item) => item.name.toLocaleLowerCase().includes(q));
    const frag = document.createDocumentFragment();
    for (const item of matches.slice(0, 100)) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = item.name;
      button.title = item.name;
      button.addEventListener("click", () => void select(s, item));
      frag.appendChild(button);
    }
    s.list.replaceChildren(frag);
    s.status.textContent = matches.length + " matching choice(s)" +
      (matches.length > 100 ? " (first 100 shown)" : "") +
      (s.indexing ? " · indexing more…" : "") +
      (s.partial ? " · some options may be missing" : "");
  }
  function collect(s) {
    if (state !== s) return;
    for (const option of realOptions(s.scroller)) {
      const name = labelOf(option);
      const top = topOf(option, s.scroller);
      const key = name + "\u0000" + Math.round(top / 2);
      if (!s.known.has(key)) {
        s.known.add(key);
        s.items.push({ name, top });
      }
    }
    s.items.sort((a, b) => a.top - b.top);
    redraw(s);
  }
  const nextFrame = () => new Promise((done) => requestAnimationFrame(done));
  async function scan(s) {
    s.indexing = true;
    const original = s.scroller.scrollTop;
    let finished = false;
    try {
      for (let i = 0; i < 140 && state === s && s.popper.isConnected && !s.selecting; i++) {
        collect(s);
        const max = Math.max(0, s.scroller.scrollHeight - s.scroller.clientHeight);
        if (max < 2 || s.scroller.scrollTop >= max - 2) { finished = true; break; }
        const next = Math.min(max, s.scroller.scrollTop + Math.max(30, s.scroller.clientHeight * .65));
        if (next <= s.scroller.scrollTop + 1) { s.partial = true; break; }
        s.scroller.scrollTop = next;
        s.scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
        await nextFrame();
        await nextFrame();
      }
      if (state === s && !s.selecting) collect(s);
    } catch (e) {
      s.partial = true;
      console.warn("[tulbelt filter-value-picker-search] Index incomplete", e);
    } finally {
      if (state === s && !s.selecting) {
        if (!finished) s.partial = true;
        s.scroller.scrollTop = original;
        s.scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
        s.indexing = false;
        redraw(s);
      }
    }
  }
  async function select(s, item) {
    if (state !== s || s.selecting) return;
    s.selecting = true;
    s.input.disabled = true;
    s.status.textContent = "Selecting original Tulip option…";
    const scroller = s.scroller;
    for (let i = 0; i < 8 && state === s; i++) {
      scroller.scrollTop = Math.max(0, item.top - scroller.clientHeight / 3);
      scroller.dispatchEvent(new Event("scroll", { bubbles: true }));
      await nextFrame();
      await nextFrame();
      const candidates = realOptions(scroller).filter((el) => labelOf(el) === item.name);
      const picked = candidates.sort((a, b) =>
        Math.abs(topOf(a, scroller) - item.top) - Math.abs(topOf(b, scroller) - item.top))[0];
      if (picked && Math.abs(topOf(picked, scroller) - item.top) < 110) {
        picked.click(); // Use Tulip's selection handler; never alter React state directly.
        close();
        return;
      }
    }
    if (state === s) {
      s.selecting = false;
      s.input.disabled = false;
      s.status.textContent = "Could not select that entry. Use the original list.";
    }
  }
  function close() {
    if (!state) return;
    const prev = state;
    state = null;
    prev.overlay.remove();
    if (prev.oldPosition !== null) prev.popper.style.position = prev.oldPosition;
  }
  function open(popper) {
    close();
    const overlay = document.createElement("div");
    overlay.className = "tulbelt-fvs";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Search filter values");
    const input = document.createElement("input");
    input.type = "search";
    input.placeholder = "Search variables and records…";
    input.setAttribute("aria-label", "Search variables and table record fields");
    const list = document.createElement("div");
    list.className = "tulbelt-fvs-list";
    const status = document.createElement("div");
    status.className = "tulbelt-fvs-status";
    status.setAttribute("role", "status");
    overlay.append(input, list, status);
    const s = { popper, overlay, input, list, status, scroller: scrollerIn(popper),
      items: [], known: new Set(), indexing: false, partial: false, selecting: false,
      oldPosition: null };
    for (const eventName of ["pointerdown", "mousedown", "touchstart", "click"]) {
      overlay.addEventListener(eventName, (e) => e.stopPropagation());
    }
    input.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") { e.preventDefault(); close(); }
    });
    input.addEventListener("input", () => redraw(s));
    if (getComputedStyle(popper).position === "static") {
      s.oldPosition = popper.style.position;
      popper.style.position = "relative";
    }
    popper.appendChild(overlay);
    state = s;
    const rect = popper.getBoundingClientRect();
    overlay.style.width = Math.max(230, rect.width) + "px";
    overlay.style.height = Math.min(Math.max(rect.height, 220), window.innerHeight - 12) + "px";
    overlay.style.left = "0px";
    overlay.style.top = "0px";
    collect(s);
    input.focus();
    void scan(s);
  }
  function check() {
    frameScheduled = false;
    if (!enabled) return;
    if (state && !state.popper.isConnected) close();
    if (!pending || Date.now() > pending.until) { pending = null; return; }
    const popper = findPopper(pending.button);
    if (!popper || (state && state.popper === popper)) return;
    pending = null;
    open(popper);
  }
  function schedule() {
    if (!enabled || frameScheduled) return;
    frameScheduled = true;
    requestAnimationFrame(check);
  }
  function pointer(event) {
    if (!enabled) return;
    if (state && state.overlay.contains(event.target)) return;
    if (state && !state.popper.contains(event.target)) close();
    const button = event.target.closest && event.target.closest("button");
    if (!button || !pickerButton(button) || !filterDialogContains(button)) return;
    pending = { button, until: Date.now() + 1500,
      existing: new Set(document.querySelectorAll(POPPERS)) };
    schedule();
  }
  function mutate() {
    if (state && !state.popper.isConnected) close();
    if (pending && Date.now() <= pending.until) schedule();
  }
  function enable() {
    if (enabled) return;
    enabled = true;
    ensureStyles(STYLE, css);
    document.addEventListener("pointerdown", pointer, true);
    observer = new MutationObserver(mutate);
    observer.observe(document.body, { childList: true, subtree: true });
  }
  function disable() {
    enabled = false;
    document.removeEventListener("pointerdown", pointer, true);
    observer?.disconnect();
    observer = null;
    pending = null;
    close();
    removeStyles(STYLE);
  }
  registerToggle(FEATURE, { onEnable: enable, onDisable: disable });
})();
