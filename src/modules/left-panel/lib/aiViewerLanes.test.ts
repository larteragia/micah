import { describe, expect, it } from "vitest";
import {
  capContent,
  CONTENT_CAP,
  LANE_CAP,
  type LaneMap,
  markLaneDone,
  orderedLanes,
  renderEdits,
  upsertLane,
} from "./aiViewerLanes";

describe("upsertLane", () => {
  it("fuses cumulative chunks of the same tool call into one lane", () => {
    let lanes: LaneMap = {};
    lanes = upsertLane(
      lanes,
      { toolCallId: "t1", path: "/a.ts", kind: "write", content: "hel" },
      1,
    );
    lanes = upsertLane(
      lanes,
      { toolCallId: "t1", path: "/a.ts", kind: "write", content: "hello" },
      2,
    );
    expect(Object.keys(lanes)).toEqual(["t1"]);
    expect(lanes.t1.content).toBe("hello");
    expect(lanes.t1.seq).toBe(1);
  });

  it("returns the same map identity when nothing changed", () => {
    const a = upsertLane(
      {},
      { toolCallId: "t1", path: "/a.ts", kind: "write", content: "x" },
      1,
    );
    const b = upsertLane(
      a,
      { toolCallId: "t1", path: "/a.ts", kind: "write", content: "x" },
      2,
    );
    expect(b).toBe(a);
  });

  it("keeps lanes in creation order across updates", () => {
    let lanes: LaneMap = {};
    lanes = upsertLane(
      lanes,
      { toolCallId: "a", path: "/a", kind: "write", content: "1" },
      1,
    );
    lanes = upsertLane(
      lanes,
      { toolCallId: "b", path: "/b", kind: "write", content: "1" },
      2,
    );
    lanes = upsertLane(
      lanes,
      { toolCallId: "a", path: "/a", kind: "write", content: "12" },
      3,
    );
    expect(orderedLanes(lanes).map((l) => l.toolCallId)).toEqual(["a", "b"]);
  });

  it("trims the head once content passes the ceiling", () => {
    const big = `${"x".repeat(CONTENT_CAP + 10)}TAIL`;
    expect(capContent(big).length).toBe(CONTENT_CAP);
    expect(capContent(big).endsWith("TAIL")).toBe(true);
  });

  it("renders edit pairs as old/new, never a reconstructed file", () => {
    const lanes = upsertLane(
      {},
      {
        toolCallId: "e1",
        path: "/a.ts",
        kind: "edit",
        edits: [{ old_string: "foo", new_string: "bar" }],
      },
      1,
    );
    expect(lanes.e1.content).toBe(renderEdits([{ old_string: "foo", new_string: "bar" }]));
    expect(lanes.e1.content).toContain("--- old\nfoo");
    expect(lanes.e1.content).toContain("+++ new\nbar");
  });

  it("evicts the oldest FINISHED lanes past the cap, never live ones", () => {
    let lanes: LaneMap = {};
    for (let i = 0; i < LANE_CAP; i++) {
      lanes = upsertLane(
        lanes,
        { toolCallId: `t${i}`, path: `/f${i}`, kind: "write", content: "x" },
        i,
      );
    }
    lanes = markLaneDone(lanes, "t0");
    lanes = markLaneDone(lanes, "t1");
    lanes = upsertLane(
      lanes,
      { toolCallId: "new", path: "/new", kind: "write", content: "x" },
      99,
    );
    expect(lanes.t0).toBeUndefined();
    expect(lanes.t1).toBeDefined();
    expect(lanes.new).toBeDefined();
    expect(Object.keys(lanes)).toHaveLength(LANE_CAP);
  });

  it("keeps every lane when all are live, even past the cap", () => {
    let lanes: LaneMap = {};
    for (let i = 0; i <= LANE_CAP; i++) {
      lanes = upsertLane(
        lanes,
        { toolCallId: `t${i}`, path: `/f${i}`, kind: "write", content: "x" },
        i,
      );
    }
    expect(Object.keys(lanes)).toHaveLength(LANE_CAP + 1);
  });
});

describe("markLaneDone", () => {
  it("is idempotent and ignores unknown ids", () => {
    const a = upsertLane(
      {},
      { toolCallId: "t1", path: "/a", kind: "write", content: "x" },
      1,
    );
    const b = markLaneDone(a, "t1");
    expect(markLaneDone(b, "t1")).toBe(b);
    expect(markLaneDone(b, "nope")).toBe(b);
  });
});
