import { describe, expect, it } from "vitest";
import { collectLeafResumes, type PaneNode } from "./panes";

describe("collectLeafResumes", () => {
  it("collects anchored leaves in tree order and skips bare ones", () => {
    const tree: PaneNode = {
      kind: "split",
      id: 100,
      dir: "row",
      children: [
        { kind: "leaf", id: 1, resume: "aaaa" },
        {
          kind: "split",
          id: 101,
          dir: "col",
          children: [
            { kind: "leaf", id: 2 },
            { kind: "leaf", id: 3, resume: "bbbb" },
          ],
        },
      ],
    };
    expect(collectLeafResumes(tree)).toEqual([
      { leafId: 1, resume: "aaaa" },
      { leafId: 3, resume: "bbbb" },
    ]);
  });

  it("returns empty for a tree with no anchors", () => {
    expect(collectLeafResumes({ kind: "leaf", id: 7 })).toEqual([]);
  });
});
