// Read only props belonging to the mounted editor control. Prefer the committed
// React tree when an element still points to the other side of a render.
(() => {
  function* owners(node) {
    for (let el = node; el; el = el.parentElement) {
      const key = Object.getOwnPropertyNames(el).find((k) =>
        /^__react(Fiber|InternalInstance)\$/.test(k),
      );
      let fiber = key && el[key];
      if (!fiber) continue;
      let root = fiber;
      while (root.return) root = root.return;
      if (root.stateNode?.current && root.stateNode.current !== root && fiber.alternate) {
        fiber = fiber.alternate;
      }
      for (let i = 0; fiber && i < 80; i++, fiber = fiber.return) {
        if (fiber.memoizedProps) yield fiber.memoizedProps;
      }
      return;
    }
  }

  function editor() {
    const match = /^(?:\/w\/([^/]+))?\/apps\/([^/]+)\/versions\/([^/]+)/.exec(location.pathname);
    return match && { workspace: match[1] || "", app: match[2], version: match[3] };
  }

  window.__tulbeltEditorModel = Object.freeze({ owners, editor });
})();
