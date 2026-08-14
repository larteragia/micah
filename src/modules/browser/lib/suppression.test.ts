import { describe, expect, it } from "vitest";
import {
  CODE_DRIVEN_SOURCES,
  EMPTY_SUPPRESSION,
  isSuppressed,
  overlaps,
  OVERLAY_SELECTORS,
  OVERLAY_SOURCES,
  type OverlaySource,
  suppressionReducer,
  suppressionReason,
} from "./suppression";

describe("suppressionReducer", () => {
  // One case per overlay: the previous wording ("dialogs and menus") is exactly
  // what let the toaster, the tab switcher and the mini window slip through.
  it.each(OVERLAY_SOURCES)("hides the panel for %s", (source) => {
    const state = suppressionReducer(EMPTY_SUPPRESSION, {
      type: "suppress",
      source,
    });
    expect(isSuppressed(state)).toBe(true);
    expect(state.sources).toEqual([source]);
  });

  it.each(OVERLAY_SOURCES)("shows the panel again after %s closes", (source) => {
    const opened = suppressionReducer(EMPTY_SUPPRESSION, {
      type: "suppress",
      source,
    });
    const closed = suppressionReducer(opened, { type: "release", source });
    expect(isSuppressed(closed)).toBe(false);
  });

  it("counts sources: a dropdown closing must not reveal the panel under a dialog", () => {
    let state = suppressionReducer(EMPTY_SUPPRESSION, {
      type: "suppress",
      source: "dialog",
    });
    state = suppressionReducer(state, {
      type: "suppress",
      source: "dropdown-menu",
    });
    state = suppressionReducer(state, {
      type: "release",
      source: "dropdown-menu",
    });
    expect(isSuppressed(state)).toBe(true);
    expect(state.sources).toEqual(["dialog"]);
  });

  it("is idempotent on repeated suppress", () => {
    const first = suppressionReducer(EMPTY_SUPPRESSION, {
      type: "suppress",
      source: "toast",
    });
    const second = suppressionReducer(first, {
      type: "suppress",
      source: "toast",
    });
    // Same object: the caller skips an IPC round-trip on identity.
    expect(second).toBe(first);
  });

  it("ignores releasing something that was never suppressing", () => {
    const state = suppressionReducer(EMPTY_SUPPRESSION, {
      type: "release",
      source: "tooltip",
    });
    expect(state).toBe(EMPTY_SUPPRESSION);
  });

  it("reset clears everything at once, and is identity when already clear", () => {
    let state = suppressionReducer(EMPTY_SUPPRESSION, {
      type: "suppress",
      source: "dialog",
    });
    state = suppressionReducer(state, { type: "suppress", source: "select" });
    const cleared = suppressionReducer(state, { type: "reset" });
    expect(isSuppressed(cleared)).toBe(false);
    expect(suppressionReducer(cleared, { type: "reset" })).toBe(cleared);
  });

  it("drag suppression survives an unrelated overlay opening and closing", () => {
    let state = suppressionReducer(EMPTY_SUPPRESSION, {
      type: "suppress",
      source: "handle-drag",
    });
    state = suppressionReducer(state, { type: "suppress", source: "tooltip" });
    state = suppressionReducer(state, { type: "release", source: "tooltip" });
    expect(state.sources).toEqual(["handle-drag"]);
  });
});

describe("suppressionReason", () => {
  it("is null when the panel is free to paint", () => {
    expect(suppressionReason(EMPTY_SUPPRESSION)).toBeNull();
  });

  it("names every source so the agent knows why a screenshot would lie", () => {
    let state = suppressionReducer(EMPTY_SUPPRESSION, {
      type: "suppress",
      source: "select",
    });
    state = suppressionReducer(state, { type: "suppress", source: "dialog" });
    expect(suppressionReason(state)).toBe(
      "browser panel hidden by: dialog, select",
    );
  });
});

describe("OVERLAY_SELECTORS", () => {
  it("maps only to declared sources", () => {
    const declared = new Set<string>(OVERLAY_SOURCES);
    for (const source of Object.values(OVERLAY_SELECTORS)) {
      expect(declared.has(source)).toBe(true);
    }
  });

  it("covers the portal-rendered overlays the app does not own", () => {
    const covered = new Set<OverlaySource>(Object.values(OVERLAY_SELECTORS));
    for (const source of [
      "dialog",
      "alert-dialog",
      "dropdown-menu",
      "context-menu",
      "select",
      "popover",
      "tooltip",
      "toast",
    ] as const) {
      expect(covered.has(source)).toBe(true);
    }
  });

  // Enumerating a source proves nothing on its own: one that no selector matches
  // and no code dispatches never suppresses anything. This is the test that
  // would have caught TabSwitcherHud, AiMiniWindow and SelectionAskAi being
  // listed but unreachable.
  it("every declared source is either matched by a selector or driven by code", () => {
    const bySelector = new Set<OverlaySource>(Object.values(OVERLAY_SELECTORS));
    const byCode = new Set<OverlaySource>(CODE_DRIVEN_SOURCES);
    const orphans = OVERLAY_SOURCES.filter(
      (s) => !bySelector.has(s) && !byCode.has(s),
    );
    expect(orphans).toEqual([]);
  });
});

describe("overlaps", () => {
  const panel = { left: 0, top: 40, right: 560, bottom: 900 };

  it("ignores an overlay that never touches the panel", () => {
    // A toast in the far corner must not blank the browser.
    expect(overlaps({ left: 900, top: 800, right: 1200, bottom: 880 }, panel)).toBe(
      false,
    );
    // A tooltip over the right-hand sidebar.
    expect(overlaps({ left: 700, top: 100, right: 820, bottom: 130 }, panel)).toBe(
      false,
    );
  });

  it("catches an overlay that sits on the panel", () => {
    // A centred command palette.
    expect(overlaps({ left: 300, top: 200, right: 900, bottom: 600 }, panel)).toBe(
      true,
    );
    // A dropdown opening just inside the panel's left edge.
    expect(overlaps({ left: 10, top: 50, right: 200, bottom: 300 }, panel)).toBe(
      true,
    );
  });

  it("treats touching edges as not overlapping", () => {
    expect(overlaps({ left: 560, top: 40, right: 800, bottom: 900 }, panel)).toBe(
      false,
    );
    expect(overlaps({ left: 0, top: 0, right: 560, bottom: 40 }, panel)).toBe(false);
  });

  it("ignores a zero-area overlay", () => {
    expect(overlaps({ left: 100, top: 100, right: 100, bottom: 400 }, panel)).toBe(
      false,
    );
  });
});
