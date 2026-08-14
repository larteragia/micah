import { describe, expect, it } from "vitest";
import { parseNdjson } from "./protocol";

describe("parseNdjson", () => {
  it("returns whole lines and keeps the unterminated tail", () => {
    const { events, rest } = parseNdjson(
      '{"type":"system"}\n{"type":"result","result":"ok"}\n{"type":"asси',
    );
    expect(events.map((e) => e.type)).toEqual(["system", "result"]);
    expect(rest).toBe('{"type":"asси');
  });

  it("survives a line that is not JSON at all", () => {
    const { events } = parseNdjson(
      'npm warn something\n{"type":"result","is_error":false}\n',
    );
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe("result");
  });

  it("resumes across chunk boundaries when the tail is fed back in", () => {
    const first = parseNdjson('{"type":"assis');
    expect(first.events).toHaveLength(0);
    const second = parseNdjson(`${first.rest}tant","session_id":"abc"}\n`);
    expect(second.events).toHaveLength(1);
    expect((second.events[0] as { session_id?: string }).session_id).toBe(
      "abc",
    );
    expect(second.rest).toBe("");
  });

  it("ignores blank lines", () => {
    const { events } = parseNdjson('\n\n{"type":"user"}\n\n');
    expect(events).toHaveLength(1);
  });
});
