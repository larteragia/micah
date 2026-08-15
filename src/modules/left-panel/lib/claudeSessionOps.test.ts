import { describe, expect, it } from "vitest";
import type { LaneMap } from "./aiViewerLanes";
import {
  dropLeadingPartialLine,
  foldSessionEvents,
  parseSessionLine,
  splitSessionChunk,
} from "./claudeSessionOps";

function assistantLine(blocks: unknown[]): string {
  return JSON.stringify({
    parentUuid: "p",
    message: { role: "assistant", content: blocks },
  });
}

function toolUse(id: string, name: string, input: Record<string, unknown>) {
  return { type: "tool_use", id, name, input };
}

describe("splitSessionChunk", () => {
  it("returns complete lines and carries the unterminated tail", () => {
    const a = splitSessionChunk("", '{"x":1}\n{"y"');
    expect(a.lines).toEqual(['{"x":1}']);
    expect(a.carry).toBe('{"y"');
    const b = splitSessionChunk(a.carry, ":2}\n");
    expect(b.lines).toEqual(['{"y":2}']);
    expect(b.carry).toBe("");
  });

  it("handles chunks with no newline by carrying everything", () => {
    const r = splitSessionChunk("", "partial");
    expect(r.lines).toEqual([]);
    expect(r.carry).toBe("partial");
  });
});

describe("dropLeadingPartialLine", () => {
  it("drops up to and including the first newline", () => {
    expect(dropLeadingPartialLine('tail"}\n{"a":1}\n')).toBe('{"a":1}\n');
  });

  it("drops everything when there is no newline", () => {
    expect(dropLeadingPartialLine("no-newline")).toBe("");
  });
});

describe("parseSessionLine", () => {
  it("extracts a Write as a write op with path and content", () => {
    const line = assistantLine([
      toolUse("t1", "Write", {
        file_path: "C:\\Users\\x\\a.ts",
        content: "hello",
      }),
    ]);
    expect(parseSessionLine(line)).toEqual([
      {
        kind: "op",
        toolUseId: "t1",
        path: "C:/Users/x/a.ts",
        op: "write",
        content: "hello",
      },
    ]);
  });

  it("extracts Edit and MultiEdit as edit ops with old/new pairs", () => {
    const edit = assistantLine([
      toolUse("t2", "Edit", {
        file_path: "/a.ts",
        old_string: "foo",
        new_string: "bar",
      }),
    ]);
    expect(parseSessionLine(edit)).toEqual([
      {
        kind: "op",
        toolUseId: "t2",
        path: "/a.ts",
        op: "edit",
        edits: [{ old_string: "foo", new_string: "bar" }],
      },
    ]);
    const multi = assistantLine([
      toolUse("t3", "MultiEdit", {
        file_path: "/b.ts",
        edits: [
          { old_string: "1", new_string: "2" },
          { old_string: "3", new_string: "4" },
        ],
      }),
    ]);
    const events = parseSessionLine(multi);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      op: "edit",
      edits: [
        { old_string: "1", new_string: "2" },
        { old_string: "3", new_string: "4" },
      ],
    });
  });

  it("extracts a Read as a read op and its result as readResult", () => {
    const read = assistantLine([
      toolUse("t4", "Read", { file_path: "/c.ts", offset: 10 }),
    ]);
    expect(parseSessionLine(read)).toEqual([
      { kind: "op", toolUseId: "t4", path: "/c.ts", op: "read" },
    ]);
    const result = JSON.stringify({
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t4" }],
      },
      toolUseResult: {
        type: "text",
        file: { filePath: "/c.ts", content: "line1\nline2" },
      },
    });
    expect(parseSessionLine(result)).toEqual([
      { kind: "readResult", toolUseId: "t4", content: "line1\nline2" },
    ]);
  });

  it("ignores unrelated records, other tools, and broken JSON", () => {
    expect(parseSessionLine("not json")).toEqual([]);
    expect(parseSessionLine('{"type":"last-prompt"}')).toEqual([]);
    expect(
      parseSessionLine(
        assistantLine([toolUse("t5", "Bash", { command: "ls" })]),
      ),
    ).toEqual([]);
    expect(
      parseSessionLine(assistantLine([{ type: "text", text: "hi" }])),
    ).toEqual([]);
  });

  it("ignores tool_use blocks missing a file path", () => {
    expect(
      parseSessionLine(assistantLine([toolUse("t6", "Write", {})])),
    ).toEqual([]);
  });
});

describe("foldSessionEvents", () => {
  it("creates one lane per op and keeps only the newest live", () => {
    let lanes: LaneMap = {};
    let seq = 0;
    ({ lanes, nextSeq: seq } = foldSessionEvents(
      lanes,
      [
        { kind: "op", toolUseId: "a", path: "/a", op: "write", content: "x" },
        {
          kind: "op",
          toolUseId: "b",
          path: "/b",
          op: "edit",
          edits: [{ old_string: "o", new_string: "n" }],
        },
      ],
      seq,
    ));
    expect(lanes.a.done).toBe(true);
    expect(lanes.b.done).toBe(false);
    expect(seq).toBe(2);
  });

  it("fills a read lane's content from its later result", () => {
    let lanes: LaneMap = {};
    ({ lanes } = foldSessionEvents(
      lanes,
      [{ kind: "op", toolUseId: "r", path: "/c", op: "read" }],
      0,
    ));
    expect(lanes.r.content).toBe("");
    ({ lanes } = foldSessionEvents(
      lanes,
      [{ kind: "readResult", toolUseId: "r", content: "file body" }],
      1,
    ));
    expect(lanes.r.content).toBe("file body");
    expect(lanes.r.kind).toBe("read");
  });

  it("drops a readResult whose read op was never seen", () => {
    const { lanes } = foldSessionEvents(
      {},
      [{ kind: "readResult", toolUseId: "ghost", content: "x" }],
      0,
    );
    expect(Object.keys(lanes)).toEqual([]);
  });

  it("returns the same map identity when no event applies", () => {
    const before = foldSessionEvents(
      {},
      [{ kind: "op", toolUseId: "a", path: "/a", op: "write", content: "x" }],
      0,
    ).lanes;
    const after = foldSessionEvents(before, [], 5);
    expect(after.lanes).toBe(before);
  });
});
