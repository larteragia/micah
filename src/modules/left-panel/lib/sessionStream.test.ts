import { describe, expect, it } from "vitest";
import {
  emptyStreamState,
  foldStreamItems,
  parseStreamLine,
  RESULT_PREVIEW_CAP,
  STREAM_EVENT_CAP,
  THINKING_CHAR_CAP,
  type RawStreamItem,
  type StreamEvent,
} from "./sessionStream";

function assistantLine(blocks: unknown[]): string {
  return JSON.stringify({
    parentUuid: "p",
    message: { role: "assistant", content: blocks },
  });
}

function userLine(blocks: unknown[]): string {
  return JSON.stringify({
    parentUuid: "p",
    message: { role: "user", content: blocks },
  });
}

function tool(events: StreamEvent[], id: string) {
  const e = events.find((x) => x.kind === "tool" && x.id === id);
  if (e?.kind !== "tool") throw new Error(`no tool event ${id}`);
  return e;
}

describe("parseStreamLine", () => {
  it("extracts thinking blocks", () => {
    const items = parseStreamLine(
      assistantLine([{ type: "thinking", thinking: "hmm let me see" }]),
    );
    expect(items).toEqual([{ kind: "thinking", text: "hmm let me see" }]);
  });

  it("skips empty thinking blocks", () => {
    expect(
      parseStreamLine(assistantLine([{ type: "thinking", thinking: "" }])),
    ).toEqual([]);
  });

  it("extracts every tool_use, not only file mutations", () => {
    const items = parseStreamLine(
      assistantLine([
        { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
        { type: "tool_use", id: "t2", name: "Grep", input: { pattern: "x" } },
        { type: "tool_use", id: "t3", name: "mcp__oracle__add", input: {} },
      ]),
    );
    expect(items.map((i) => (i.kind === "toolUse" ? i.name : ""))).toEqual([
      "Bash",
      "Grep",
      "mcp__oracle__add",
    ]);
  });

  it("extracts tool results with error flag and string preview", () => {
    const items = parseStreamLine(
      userLine([
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "went fine",
        },
        {
          type: "tool_result",
          tool_use_id: "t2",
          is_error: true,
          content: [{ type: "text", text: "boom" }],
        },
      ]),
    );
    expect(items).toEqual([
      { kind: "toolResult", toolUseId: "t1", ok: true, preview: "went fine" },
      { kind: "toolResult", toolUseId: "t2", ok: false, preview: "boom" },
    ]);
  });

  it("caps result previews", () => {
    const items = parseStreamLine(
      userLine([
        {
          type: "tool_result",
          tool_use_id: "t1",
          content: "x".repeat(RESULT_PREVIEW_CAP + 10),
        },
      ]),
    );
    const item = items[0];
    if (item.kind !== "toolResult") throw new Error("expected result");
    expect(item.preview.length).toBe(RESULT_PREVIEW_CAP);
  });

  it("returns nothing for junk lines", () => {
    expect(parseStreamLine("not json")).toEqual([]);
    expect(parseStreamLine('{"message":{"role":"assistant"}}')).toEqual([]);
  });
});

describe("foldStreamItems", () => {
  it("keeps chronological order across thinking and tools", () => {
    const state = foldStreamItems(emptyStreamState(), [
      { kind: "thinking", text: "plan" },
      { kind: "toolUse", id: "t1", name: "Bash", input: { command: "ls" } },
      { kind: "thinking", text: "now edit" },
      {
        kind: "toolUse",
        id: "t2",
        name: "Edit",
        input: {
          file_path: "C:\\a.ts",
          old_string: "a",
          new_string: "b",
        },
      },
    ]);
    expect(state.events.map((e) => e.kind)).toEqual([
      "thinking",
      "tool",
      "thinking",
      "tool",
    ]);
    expect(tool(state.events, "t2").path).toBe("C:/a.ts");
    expect(tool(state.events, "t2").edits).toEqual([
      { old_string: "a", new_string: "b" },
    ]);
  });

  it("correlates results by tool_use_id and keeps ok/error", () => {
    let state = foldStreamItems(emptyStreamState(), [
      { kind: "toolUse", id: "t1", name: "Bash", input: {} },
    ]);
    state = foldStreamItems(state, [
      { kind: "toolResult", toolUseId: "t1", ok: false, preview: "boom" },
    ]);
    expect(tool(state.events, "t1").result).toEqual({
      ok: false,
      preview: "boom",
    });
  });

  it("drops results for unknown tools and bails out on identity", () => {
    const state = foldStreamItems(emptyStreamState(), [
      { kind: "toolUse", id: "t1", name: "Bash", input: {} },
    ]);
    const same = foldStreamItems(state, [
      { kind: "toolResult", toolUseId: "ghost", ok: true, preview: "" },
    ]);
    expect(same).toBe(state);
    expect(foldStreamItems(state, [])).toBe(state);
  });

  it("ignores a duplicate tool_use id from a re-read line", () => {
    let state = foldStreamItems(emptyStreamState(), [
      { kind: "toolUse", id: "t1", name: "Bash", input: {} },
    ]);
    state = foldStreamItems(state, [
      { kind: "toolUse", id: "t1", name: "Bash", input: {} },
    ]);
    expect(state.events.length).toBe(1);
  });

  it("caps thinking text keeping the tail", () => {
    const state = foldStreamItems(emptyStreamState(), [
      { kind: "thinking", text: `${"x".repeat(THINKING_CHAR_CAP)}END` },
    ]);
    const e = state.events[0];
    if (e.kind !== "thinking") throw new Error("expected thinking");
    expect(e.text.length).toBe(THINKING_CHAR_CAP);
    expect(e.text.endsWith("END")).toBe(true);
  });

  it("evicts oldest events beyond the cap", () => {
    const items: RawStreamItem[] = [];
    for (let i = 0; i < STREAM_EVENT_CAP + 5; i++) {
      items.push({ kind: "toolUse", id: `t${i}`, name: "Bash", input: {} });
    }
    const state = foldStreamItems(emptyStreamState(), items);
    expect(state.events.length).toBe(STREAM_EVENT_CAP);
    expect(tool(state.events, "t5").id).toBe("t5");
    expect(state.events.find((e) => e.kind === "tool" && e.id === "t0")).toBe(
      undefined,
    );
  });
});
