import { describe, expect, it } from "vitest";
import { nextActiveInSpace, type Tab } from "./useTabs";

function term(id: number, spaceId: string): Tab {
  return {
    id,
    kind: "terminal",
    spaceId,
    title: "shell",
    paneTree: { kind: "leaf", id: id * 10 },
    activeLeafId: id * 10,
  } as Tab;
}

describe("nextActiveInSpace", () => {
  it("picks the previous tab within the same space", () => {
    const tabs = [term(1, "a"), term(2, "a"), term(3, "a")];
    expect(nextActiveInSpace(tabs, 3)).toBe(2);
    expect(nextActiveInSpace(tabs, 2)).toBe(1);
  });

  it("falls forward when closing the first tab of a space", () => {
    const tabs = [term(1, "a"), term(2, "a")];
    expect(nextActiveInSpace(tabs, 1)).toBe(2);
  });

  it("never jumps into another space", () => {
    const tabs = [term(1, "a"), term(2, "b"), term(3, "b")];
    expect(nextActiveInSpace(tabs, 2)).toBe(3);
    expect(nextActiveInSpace(tabs, 3)).toBe(2);
  });

  it("returns null for the last tab of its space (refuse to close)", () => {
    const tabs = [term(1, "a"), term(2, "b")];
    expect(nextActiveInSpace(tabs, 1)).toBeNull();
    expect(nextActiveInSpace(tabs, 2)).toBeNull();
  });

  it("returns null for an unknown id", () => {
    expect(nextActiveInSpace([term(1, "a")], 99)).toBeNull();
  });
});

function leftEditor(id: number, spaceId: string): Tab {
  return {
    id,
    kind: "editor",
    spaceId,
    pane: "left",
    title: "x",
    path: `/x/${id}.ts`,
    dirty: false,
    preview: false,
  } as Tab;
}

describe("nextActiveInSpace per pane", () => {
  it("refuses to close the last workspace tab even with a left editor alive", () => {
    const tabs = [term(1, "a"), leftEditor(2, "a")];
    expect(nextActiveInSpace(tabs, 1)).toBeNull();
  });

  it("closing a left tab falls back to another left tab, never the workspace", () => {
    const tabs = [term(1, "a"), leftEditor(2, "a"), leftEditor(3, "a")];
    expect(nextActiveInSpace(tabs, 3)).toBe(2);
    expect(nextActiveInSpace(tabs, 2)).toBe(3);
  });

  it("reports no fallback for the last left tab (E2b callers decide to empty the panel)", () => {
    const tabs = [term(1, "a"), leftEditor(2, "a")];
    expect(nextActiveInSpace(tabs, 2)).toBeNull();
  });

  it("left pools are still scoped per space", () => {
    const tabs = [leftEditor(1, "a"), leftEditor(2, "b"), leftEditor(3, "b")];
    expect(nextActiveInSpace(tabs, 2)).toBe(3);
    expect(nextActiveInSpace(tabs, 1)).toBeNull();
  });
});
