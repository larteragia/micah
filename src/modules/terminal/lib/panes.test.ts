import { describe, expect, it } from "vitest";
import {
  findLeafResume,
  firstLeafSlotId,
  leafIds,
  setLeafResume,
  swapLeafInDirection,
  type PaneNode,
} from "@/modules/terminal/lib/panes";

function row(...ids: number[]): PaneNode {
  return {
    kind: "split",
    id: 100,
    dir: "row",
    children: ids.map((id) => ({ kind: "leaf", id })),
  };
}

function col(...ids: number[]): PaneNode {
  return {
    kind: "split",
    id: 200,
    dir: "col",
    children: ids.map((id) => ({ kind: "leaf", id })),
  };
}

describe("setLeafResume", () => {
  const UUID = "3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42";

  it("anchors, reads back and clears on a nested tree", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 100,
      dir: "row",
      children: [{ kind: "leaf", id: 1 }, col(2, 3)],
    };
    const anchored = setLeafResume(tree, 3, UUID);
    expect(findLeafResume(anchored, 3)).toBe(UUID);
    expect(findLeafResume(anchored, 1)).toBeUndefined();
    const cleared = setLeafResume(anchored, 3, null);
    expect(findLeafResume(cleared, 3)).toBeUndefined();
    const leaf3 = (cleared as Extract<PaneNode, { kind: "split" }>)
      .children[1] as Extract<PaneNode, { kind: "split" }>;
    expect(leaf3.children[1]).not.toHaveProperty("resume");
  });

  it("preserves identity on no-op updates", () => {
    const tree = row(1, 2);
    expect(setLeafResume(tree, 9, UUID)).toBe(tree);
    expect(setLeafResume(tree, 1, null)).toBe(tree);
    const anchored = setLeafResume(tree, 1, UUID);
    expect(setLeafResume(anchored, 1, UUID)).toBe(anchored);
  });
});

describe("swapLeafInDirection", () => {
  it("swaps the active pane with its neighbor to the left", () => {
    expect(leafIds(swapLeafInDirection(row(1, 2, 3), 2, "left"))).toEqual([
      2, 1, 3,
    ]);
  });

  it("wraps right from the rightmost pane to the leftmost pane", () => {
    expect(leafIds(swapLeafInDirection(row(1, 2, 3), 3, "right"))).toEqual([
      3, 2, 1,
    ]);
  });

  it("swaps vertically and wraps upward", () => {
    expect(leafIds(swapLeafInDirection(col(1, 2, 3), 2, "down"))).toEqual([
      1, 3, 2,
    ]);
    expect(leafIds(swapLeafInDirection(col(1, 2, 3), 1, "up"))).toEqual([
      3, 2, 1,
    ]);
  });

  it("chooses the overlapping directional neighbor in a nested layout", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 10,
      dir: "row",
      children: [
        { kind: "leaf", id: 1 },
        {
          kind: "split",
          id: 11,
          dir: "col",
          children: [
            { kind: "leaf", id: 2 },
            { kind: "leaf", id: 3 },
          ],
        },
      ],
    };

    expect(leafIds(swapLeafInDirection(tree, 2, "down"))).toEqual([1, 3, 2]);
    expect(leafIds(swapLeafInDirection(tree, 3, "left"))).toEqual([3, 2, 1]);
  });

  it("uses live pane bounds after splitters are resized", () => {
    const bounds = [
      { id: 1, left: 0, right: 100, top: 0, bottom: 100 },
      { id: 2, left: 200, right: 300, top: 100, bottom: 200 },
      { id: 3, left: 100, right: 200, top: 0, bottom: 100 },
    ];

    expect(
      leafIds(swapLeafInDirection(row(1, 2, 3), 1, "right", bounds)),
    ).toEqual([3, 2, 1]);
  });

  it("falls back to tree geometry when live bounds are incomplete", () => {
    const tree = row(1, 2, 3);
    const incompleteBounds = [
      { id: 1, left: 0, right: 100, top: 0, bottom: 100 },
    ];

    expect(
      leafIds(swapLeafInDirection(tree, 1, "right", incompleteBounds)),
    ).toEqual([2, 1, 3]);
  });

  it("moves pane metadata with the terminal session", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 100,
      dir: "row",
      children: [
        { kind: "leaf", id: 1, cwd: "/one" },
        { kind: "leaf", id: 2, cwd: "/two" },
      ],
    };
    const swapped = swapLeafInDirection(tree, 2, "left");
    expect(swapped.kind).toBe("split");
    if (swapped.kind === "split") {
      expect(swapped.children[0]).toEqual({
        kind: "leaf",
        id: 2,
        slotId: 1,
        cwd: "/two",
      });
      expect(swapped.children[1]).toEqual({
        kind: "leaf",
        id: 1,
        slotId: 2,
        cwd: "/one",
      });
    }
  });

  it("keeps resizable layout slots fixed while sessions move", () => {
    const tree = row(1, 2, 3);
    const swapped = swapLeafInDirection(tree, 2, "left");

    expect(swapped.kind).toBe("split");
    if (swapped.kind === "split") {
      expect(swapped.children.map(firstLeafSlotId)).toEqual([1, 2, 3]);
      expect(leafIds(swapped)).toEqual([2, 1, 3]);
    }

    const restored = swapLeafInDirection(swapped, 2, "right");
    expect(restored.kind).toBe("split");
    if (restored.kind === "split") {
      expect(restored.children.map(firstLeafSlotId)).toEqual([1, 2, 3]);
      expect(leafIds(restored)).toEqual([1, 2, 3]);
    }
  });

  it("does nothing when the tree contains only one pane", () => {
    const tree: PaneNode = { kind: "leaf", id: 1 };
    expect(swapLeafInDirection(tree, 1, "left")).toBe(tree);
  });
});
