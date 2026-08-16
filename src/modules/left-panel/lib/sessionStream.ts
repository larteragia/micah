/**
 * Chronological model of a Claude Code session transcript for the Ai Viewer
 * stream view: thinking blocks and every tool call, in order, with results
 * correlated by tool_use_id. Lives beside the lane model (aiViewerLanes),
 * which stays the source for the per-file view. Everything here is pure so
 * caps and eviction are testable.
 */

export type EditPair = { old_string: string; new_string: string };

export type StreamToolResult = { ok: boolean; preview: string };

export type StreamEvent =
  | { kind: "thinking"; id: string; text: string; seq: number }
  | {
      kind: "tool";
      id: string;
      name: string;
      input: Record<string, unknown>;
      path?: string;
      content?: string;
      edits?: EditPair[];
      result?: StreamToolResult;
      seq: number;
    };

export type StreamState = {
  events: StreamEvent[];
  nextSeq: number;
};

export type RawStreamItem =
  | { kind: "thinking"; text: string }
  | {
      kind: "toolUse";
      id: string;
      name: string;
      input: Record<string, unknown>;
    }
  | { kind: "toolResult"; toolUseId: string; ok: boolean; preview: string };

/** Keep at most this many events; the transcript is history, the stream is
 * "what is happening", so the head is what goes. */
export const STREAM_EVENT_CAP = 300;
export const THINKING_CHAR_CAP = 20_000;
export const RESULT_PREVIEW_CAP = 2_000;
/** Write bodies and edit pairs can be whole files; the tail is where the
 * action is, same rule as the lane content cap. */
export const STREAM_CONTENT_CAP = 50_000;

export function emptyStreamState(): StreamState {
  return { events: [], nextSeq: 0 };
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : null;
}

function capTail(text: string, cap: number): string {
  return text.length <= cap ? text : text.slice(text.length - cap);
}

function capHead(text: string, cap: number): string {
  return text.length <= cap ? text : text.slice(0, cap);
}

function resultPreview(content: unknown): string {
  if (typeof content === "string") return capHead(content, RESULT_PREVIEW_CAP);
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const block of content) {
      const b = asRecord(block);
      if (b?.type === "text" && typeof b.text === "string") texts.push(b.text);
    }
    return capHead(texts.join("\n"), RESULT_PREVIEW_CAP);
  }
  return "";
}

function editPairs(input: Record<string, unknown>): EditPair[] {
  if (
    typeof input.old_string === "string" &&
    typeof input.new_string === "string"
  ) {
    return [{ old_string: input.old_string, new_string: input.new_string }];
  }
  if (Array.isArray(input.edits)) {
    const pairs: EditPair[] = [];
    for (const e of input.edits) {
      const r = asRecord(e);
      if (
        r &&
        typeof r.old_string === "string" &&
        typeof r.new_string === "string"
      ) {
        pairs.push({ old_string: r.old_string, new_string: r.new_string });
      }
    }
    return pairs;
  }
  return [];
}

/**
 * Extract stream items from one transcript JSONL line. Unlike the lane
 * parser, every tool_use counts — Bash, Grep, Task, MCP tools — not only
 * the file mutations.
 */
export function parseStreamLine(line: string): RawStreamItem[] {
  let rec: unknown;
  try {
    rec = JSON.parse(line);
  } catch {
    return [];
  }
  const root = asRecord(rec);
  const msg = asRecord(root?.message);
  if (!root || !msg || !Array.isArray(msg.content)) return [];

  const out: RawStreamItem[] = [];
  if (msg.role === "assistant") {
    for (const block of msg.content) {
      const b = asRecord(block);
      if (!b) continue;
      if (b.type === "thinking" && typeof b.thinking === "string") {
        if (b.thinking.length > 0) {
          out.push({ kind: "thinking", text: b.thinking });
        }
      } else if (
        b.type === "tool_use" &&
        typeof b.id === "string" &&
        typeof b.name === "string"
      ) {
        out.push({
          kind: "toolUse",
          id: b.id,
          name: b.name,
          input: asRecord(b.input) ?? {},
        });
      }
    }
    return out;
  }
  if (msg.role === "user") {
    for (const block of msg.content) {
      const b = asRecord(block);
      if (b?.type !== "tool_result" || typeof b.tool_use_id !== "string") {
        continue;
      }
      out.push({
        kind: "toolResult",
        toolUseId: b.tool_use_id,
        ok: b.is_error !== true,
        preview: resultPreview(b.content),
      });
    }
  }
  return out;
}

function toToolEvent(
  item: Extract<RawStreamItem, { kind: "toolUse" }>,
  seq: number,
): StreamEvent {
  const input = item.input;
  const path =
    typeof input.file_path === "string"
      ? input.file_path.replace(/\\/g, "/")
      : undefined;
  const edits = editPairs(input);
  const content =
    typeof input.content === "string"
      ? capTail(input.content, STREAM_CONTENT_CAP)
      : undefined;
  return {
    kind: "tool",
    id: item.id,
    name: item.name,
    input,
    ...(path !== undefined ? { path } : {}),
    ...(content !== undefined ? { content } : {}),
    ...(edits.length > 0 ? { edits } : {}),
    seq,
  };
}

/**
 * Fold raw items into the stream. Returns the same state object when the
 * items change nothing, so subscribers can bail out on identity. A result
 * whose tool was never seen (or already evicted) is dropped.
 */
export function foldStreamItems(
  state: StreamState,
  items: RawStreamItem[],
): StreamState {
  if (items.length === 0) return state;
  let events = state.events;
  let seq = state.nextSeq;
  let changed = false;

  for (const item of items) {
    if (item.kind === "thinking") {
      events = [
        ...events,
        {
          kind: "thinking",
          id: `think-${seq}`,
          text: capTail(item.text, THINKING_CHAR_CAP),
          seq,
        },
      ];
      seq += 1;
      changed = true;
    } else if (item.kind === "toolUse") {
      const at = events.findIndex((e) => e.kind === "tool" && e.id === item.id);
      if (at === -1) {
        events = [...events, toToolEvent(item, seq)];
        seq += 1;
        changed = true;
      }
    } else {
      const at = events.findIndex(
        (e) => e.kind === "tool" && e.id === item.toolUseId,
      );
      if (at === -1) continue;
      const prev = events[at] as Extract<StreamEvent, { kind: "tool" }>;
      if (prev.result) continue;
      const next = [...events];
      next[at] = {
        ...prev,
        result: { ok: item.ok, preview: item.preview },
      };
      events = next;
      changed = true;
    }
  }

  if (!changed) return state;
  if (events.length > STREAM_EVENT_CAP) {
    events = events.slice(events.length - STREAM_EVENT_CAP);
  }
  return { events, nextSeq: seq };
}
