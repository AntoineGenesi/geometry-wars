/**
 * Utilities for preserving DOM panel visibility state across a full HTML re-render.
 *
 * Used by StartMenu (and PauseMenu) to prevent the language-change re-render
 * from resetting the user's current navigation state (e.g. Quick Game modal open).
 *
 * See: tasks/s44r3-01-language-selector-flag-exits-modal.md
 */

type QueryableRoot = {
  querySelector: (selector: string) => { classList: { contains: (cls: string) => boolean } } | null;
};

type MutableRoot = {
  querySelector: (selector: string) => { classList: { add: (cls: string) => void; remove: (cls: string) => void } } | null;
};

/**
 * Snapshot which element IDs currently have the 'hidden' CSS class.
 *
 * @param root    Any element with querySelector support (usually the menu container)
 * @param ids     List of element IDs to inspect (without the `#` prefix)
 * @returns       Map from id → wasHidden
 */
export function captureHiddenState(root: QueryableRoot, ids: string[]): Map<string, boolean> {
  const state = new Map<string, boolean>();
  for (const id of ids) {
    const el = root.querySelector(`#${id}`);
    // Default to true (hidden) when element not found — safe for newly-added panels
    state.set(id, el ? el.classList.contains('hidden') : true);
  }
  return state;
}

/**
 * Restore the 'hidden' class on elements from a previously captured snapshot.
 * Elements that no longer exist after a re-render are silently skipped.
 *
 * @param root    Re-rendered container element
 * @param state   Map from captureHiddenState()
 */
export function restoreHiddenState(root: MutableRoot, state: Map<string, boolean>): void {
  for (const [id, wasHidden] of state) {
    const el = root.querySelector(`#${id}`);
    if (!el) continue;
    if (wasHidden) {
      el.classList.add('hidden');
    } else {
      el.classList.remove('hidden');
    }
  }
}
