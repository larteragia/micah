/**
 * When the native browser panel has to get out of the way.
 *
 * The panel is a native child webview — a sibling HWND on Windows — so it paints
 * *above* the whole HTML layer and ignores `overflow: hidden` and `border-radius`
 * on `#root`. Anything the app draws over that region (a dialog, a dropdown, a
 * toast, the tab switcher) would render behind it. The fix is to hide the webview
 * while such an overlay is up.
 *
 * Suppression is reference-counted by source, not a boolean: a dropdown closing
 * must not un-hide the panel while a modal dialog is still open. Every overlay in
 * the app is enumerated here on purpose — "dialogs and menus" was the wording
 * that let `Toaster`, `TabSwitcherHud`, `SelectionAskAi`, `AiMiniWindow` and the
 * updater slip through.
 */

/** Every overlay that can cover the panel's region. Exhaustive by design. */
export const OVERLAY_SOURCES = [
  /** Covers the command palette, the new-editor dialog and the updater — they
   *  all render through the same `DialogContent`. */
  "dialog",
  /** The close guards, which use `AlertDialogContent`. */
  "alert-dialog",
  "dropdown-menu",
  "context-menu",
  "select",
  "popover",
  "tooltip",
  "toast",
  "tab-switcher",
  "selection-ask-ai",
  "ai-mini-window",
  /** The divider is being dragged: see `handle-drag` in the module docs. */
  "handle-drag",
  /** The panel is collapsed or the window is not visible. */
  "layout",
  /** The user turned the feature off. */
  "disabled",
  /**
   * The left panel is showing Editor or Ai Viewer instead of the browser.
   * Hiding beats detaching: `browser_detach` closes the webview and clears the
   * CDP discovery file, which would drop every attached Playwright client and
   * lose the page's session on every click of the mode switcher.
   */
  "mode",
  /**
   * The panel's own menus (hamburger dropdown, bookmark context menu). These
   * cannot rely on the selector scan: Radix mounts popper content at zero size
   * and then sizes it through ATTRIBUTE mutations, which the childList-only
   * MutationObserver never sees — the menu would open behind the webview.
   * Dispatched from onOpenChange instead, which is exact and race-free.
   */
  "browser-menu",
] as const;

export type OverlaySource = (typeof OVERLAY_SOURCES)[number];

export type SuppressionState = {
  readonly sources: readonly OverlaySource[];
};

export const EMPTY_SUPPRESSION: SuppressionState = { sources: [] };

export type SuppressionAction =
  | { type: "suppress"; source: OverlaySource }
  | { type: "release"; source: OverlaySource }
  | { type: "reset" };

/**
 * Pure transition. Returns the *same* object when nothing changed so callers can
 * skip an IPC round-trip on identity.
 */
export function suppressionReducer(
  state: SuppressionState,
  action: SuppressionAction,
): SuppressionState {
  switch (action.type) {
    case "suppress": {
      if (state.sources.includes(action.source)) return state;
      return { sources: [...state.sources, action.source] };
    }
    case "release": {
      if (!state.sources.includes(action.source)) return state;
      return { sources: state.sources.filter((s) => s !== action.source) };
    }
    case "reset":
      return state.sources.length === 0 ? state : EMPTY_SUPPRESSION;
  }
}

/** The panel may only paint when nothing at all is suppressing it. */
export function isSuppressed(state: SuppressionState): boolean {
  return state.sources.length > 0;
}

/**
 * What the Playwright bridge is told. A screenshot taken while the panel is
 * suppressed returns a stale or blank frame — CDP happily serves it, which is
 * exactly how a broken panel passes a naive test — so the reason travels with
 * the state instead of being inferred.
 */
export function suppressionReason(state: SuppressionState): string | null {
  if (state.sources.length === 0) return null;
  return `browser panel hidden by: ${[...state.sources].sort().join(", ")}`;
}

/**
 * CSS selectors for every overlay that can end up over the panel — Radix
 * portals, sonner toasts, and the app's own floating surfaces.
 *
 * The app's surfaces are here because enumerating enum members proves nothing:
 * a source that no code ever dispatches is a source that never suppresses. The
 * test at the bottom of `suppression.test.ts` holds this to it.
 */
export const OVERLAY_SELECTORS: Readonly<Record<string, OverlaySource>> = {
  "[data-slot='dialog-content']": "dialog",
  "[data-slot='alert-dialog-content']": "alert-dialog",
  "[data-radix-popper-content-wrapper]": "popover",
  "[data-slot='dropdown-menu-content']": "dropdown-menu",
  "[data-slot='context-menu-content']": "context-menu",
  "[data-slot='select-content']": "select",
  "[data-sonner-toaster]": "toast",
  "[role='tooltip']": "tooltip",
  "[data-tab-switcher-hud]": "tab-switcher",
  "[data-selection-ask-ai]": "selection-ask-ai",
  "[data-ai-mini-window]": "ai-mini-window",
};

/**
 * Sources that are driven by app code rather than by a DOM selector, and so are
 * exempt from the coverage test.
 */
export const CODE_DRIVEN_SOURCES: readonly OverlaySource[] = [
  "handle-drag",
  "layout",
  "disabled",
  "mode",
  "browser-menu",
];

export type OverlayRect = {
  left: number;
  top: number;
  right: number;
  bottom: number;
};

/**
 * Does this overlay actually cover the panel?
 *
 * Without this check the panel blanks whenever *anything* opens anywhere — and
 * since the app is wall-to-wall tooltips, hovering any icon in the header would
 * flash the whole browser away. Only overlap justifies hiding.
 */
export function overlaps(a: OverlayRect, b: OverlayRect): boolean {
  // A rectangle with no area covers nothing, however placed. Radix mounts
  // content at zero size for a frame before it animates in.
  if (a.right <= a.left || a.bottom <= a.top) return false;
  return a.right > b.left && a.left < b.right && a.bottom > b.top && a.top < b.bottom;
}
