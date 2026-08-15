/**
 * Pure parsing of a Claude Code session transcript (JSONL) into Ai Viewer
 * lane events. The transcript is what the terminal's TUI does not show in
 * full: every Read/Edit/Write the agent performs, with paths and content.
 * The harness writes it regardless of which model answers, so this works
 * for any backend driven through Claude Code.
 */

import {
  type EditPair,
  type LaneMap,
  markLaneDone,
  orderedLanes,
  upsertLane,
} from "./aiViewerLanes";

export type SessionEvent =
  | {
      kind: "op";
      toolUseId: string;
      path: string;
      op: "read" | "edit" | "write";
      content?: string;
      edits?: EditPair[];
    }
  | { kind: "readResult"; toolUseId: string; content: string };

/** Split a tail chunk into complete JSONL lines, carrying the open tail. */
export function splitSessionChunk(
  carry: string,
  chunk: string,
): { lines: string[]; carry: string } {
  const text = carry + chunk;
  const parts = text.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.length > 0), carry: rest };
}

/** A tail that starts mid-file begins inside a line; drop that fragment. */
export function dropLeadingPartialLine(chunk: string): string {
  const nl = chunk.indexOf("\n");
  return nl === -1 ? "" : chunk.slice(nl + 1);
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null
    ? (v as Record<string, unknown>)
    : null;
}

function normPath(p: string): string {
  return p.replace(/\\/g, "/");
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

export function parseSessionLine(line: string): SessionEvent[] {
  let rec: unknown;
  try {
    rec = JSON.parse(line);
  } catch {
    return [];
  }
  const root = asRecord(rec);
  const msg = asRecord(root?.message);
  if (!root || !msg || !Array.isArray(msg.content)) return [];

  const out: SessionEvent[] = [];
  if (msg.role === "assistant") {
    for (const block of msg.content) {
      const b = asRecord(block);
      if (b?.type !== "tool_use" || typeof b.id !== "string") continue;
      const input = asRecord(b.input) ?? {};
      const path =
        typeof input.file_path === "string" ? normPath(input.file_path) : "";
      if (!path) continue;
      if (b.name === "Write") {
        out.push({
          kind: "op",
          toolUseId: b.id,
          path,
          op: "write",
          content: typeof input.content === "string" ? input.content : "",
        });
      } else if (b.name === "Edit" || b.name === "MultiEdit") {
        const edits = editPairs(input);
        if (edits.length > 0) {
          out.push({ kind: "op", toolUseId: b.id, path, op: "edit", edits });
        }
      } else if (b.name === "Read") {
        out.push({ kind: "op", toolUseId: b.id, path, op: "read" });
      }
    }
    return out;
  }
  if (msg.role === "user") {
    const file = asRecord(asRecord(root.toolUseResult)?.file);
    if (!file || typeof file.content !== "string") return out;
    for (const block of msg.content) {
      const b = asRecord(block);
      if (b?.type === "tool_result" && typeof b.tool_use_id === "string") {
        out.push({
          kind: "readResult",
          toolUseId: b.tool_use_id,
          content: file.content,
        });
        break;
      }
    }
  }
  return out;
}

/**
 * Fold parsed events into the shared lane map. Transcript ops arrive whole
 * (the harness writes a record per completed message), so every lane except
 * the newest is settled work and only the newest stays live.
 */
export function foldSessionEvents(
  lanes: LaneMap,
  events: SessionEvent[],
  nextSeq: number,
): { lanes: LaneMap; nextSeq: number } {
  if (events.length === 0) return { lanes, nextSeq };
  let next = lanes;
  let seq = nextSeq;
  for (const e of events) {
    if (e.kind === "op") {
      next = upsertLane(
        next,
        {
          toolCallId: e.toolUseId,
          path: e.path,
          kind: e.op,
          content: e.content,
          edits: e.edits,
        },
        seq++,
      );
    } else {
      const prev = next[e.toolUseId];
      if (prev?.kind !== "read") continue;
      next = upsertLane(
        next,
        {
          toolCallId: e.toolUseId,
          path: prev.path,
          kind: "read",
          content: e.content,
        },
        prev.seq,
      );
    }
  }
  const ordered = orderedLanes(next);
  if (ordered.length > 0) {
    const newest = ordered.reduce((m, l) => (l.seq > m.seq ? l : m));
    for (const l of ordered) {
      if (l.toolCallId !== newest.toolCallId) {
        next = markLaneDone(next, l.toolCallId);
      }
    }
  }
  return { lanes: next, nextSeq: seq };
}
