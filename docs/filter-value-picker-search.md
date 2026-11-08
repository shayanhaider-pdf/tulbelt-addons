# Search Filter Variables & Table Records

This fork adds an **optional** Tulbelt toggle: **Search Filter Variables & Table Records** (off by default).

## Intended behavior

In the Tulip App Editor, select an interactive table widget, open **Filters**, choose a value source such as **Variable** or **Table Record**, and open its value dropdown. Tulbelt overlays a search field on the choice list. Type any substring of an option name, case-insensitively, to narrow results. Selecting a search result activates the original Tulip option rather than modifying app data. Clear the input to see all indexed choices.

This is a search over **filter configuration choices**, not an app data search, a table record query, or a new backend filter condition.

## How it works

- One isolated-world content script, `toggles/filter-value-picker-search.js`, registered in `manifest.json`.
- The toggle is registered in `features.js` and can be disabled at any time.
- It only responds to Variable/Table Record buttons inside a dialog containing **Filters** and **Include records matching**.
- It locates the dropdown portal, scans the list by moving its internal scroll position (to index virtualized options), and restores scroll position afterward.
- It displays matches in an injected overlay. Clicking a result scrolls the original dropdown to its corresponding entry and invokes that original Tulip button's click handler.
- No new permissions, external APIs, network calls, or libraries.

## Manual test in desktop Chrome

1. Load the fork as an unpacked extension via `chrome://extensions` and turn on **Search Filter Variables & Table Records** in the popup.
2. Open the Tulip App Editor, select a table widget, and edit its **Filters**.
3. Choose **Variable**, open the value dropdown, and check that the search field appears.
4. Search for an application variable near the end of a long list, including options not initially rendered. Try uppercase/lowercase, partial matches, and no matches.
5. Select a result and confirm that the chosen variable appears correctly in Tulip's filter row and is retained after saving.
6. Repeat for **Table Record** and **Table Record Field** sources, including nested fields, same-named fields, and multiple filters.
7. Disable the toggle while the dropdown is open, reopen it, and confirm that the original interface returns without extra controls.
8. Verify other Tulbelt toggles, including collapsing record placeholders and searching saved queries.

## Known limitations

**This implementation has not yet been tested on the authenticated Tulip editor DOM.** The screenshots establish the requested interface but do not provide selectors or React virtualization behavior. The code is based on the selectors and list structure used by the upstream Tulbelt query picker and variable-picker features, so Tulip version differences may require selector adjustments. If no search appears or selecting a result fails, turn off the toggle and capture a DevTools Elements screenshot of the open dropdown for a targeted fix.

The maximum scanning passes and result count are bounded to reduce overhead on very large lists. If scanning reaches the limit the overlay indicates that its index may be incomplete.

The original project is [Tulbelt](https://github.com/dapomeranz/tulbelt) (MIT License, © 2026 Daniel Pomeranz). Keep the original `LICENSE` file.
