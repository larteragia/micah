/**
 * Incremental trace fold for Micah's Mind. Transcript chunks arrive out of
 * the claude_session_tail poll; this module turns lines into the live trace
 * without ever re-parsing the world: each fold call appends what is new.
 *
 * Idempotency contract (auditor correction 15): the tail offset can regress
 * when the transcript file is replaced, so a tool_use whose id was already
 * folded never duplicates; the caller resets the fold (emptyMindFold) when
 * the feed reports the file shrank.
 *
 * Event lifecycle: a tool_use creates a provisional event immediately
 * (outcomeKnown false, targets from input only) so the scene lights up while
 * the call runs; the matching tool_result settles it in place, same seq,
 * with error flag, result bytes and targets reclassified against the result
 * text, exactly like mindwalk's pending-map flush but streaming-friendly.
 */

import {
  actionFor,
  contentToString,
  normalizeSlashes,
  summarizeTool,
  type TargetsCtx,
  type ToolInput,
  targetsFor,
} from "./classify";
import { type ContentBlock, parseSessionLine } from "./parseSession";
import {
  computeStats,
  emptyStats,
  type MindTrace,
  type TraceEvent,
  type TraceMark,
  type TraceSession,
} from "./trace";

export type FoldedEvent = TraceEvent & {
  toolUseId: string;
  /** False while the tool call is still running (no result line yet). */
  settled: boolean;
  /** Tool input kept on the event so a late or post-copy result can
   * reclassify with full context even when the pending map lost the call. */
  input: ToolInput;
};

export type TouchedInfo = {
  touch: "hit" | "read" | "edit";
  firstSeq: number;
  lastSeq: number;
  count: number;
  /** True when every observation of this path was weak (inferred from
   * command/output text): the scene treats weak-only paths as unproven. */
  weak: boolean;
};

export type MindFold = Omit<MindTrace, "events"> & {
  events: FoldedEvent[];
  /** Live per-file view derived from events (what the city lights up). */
  touched: Map<string, TouchedInfo>;
};

type ToolUseCall = {
  id: string;
  name: string;
  input: ToolInput;
  ts?: string;
};

type FoldInternals = {
  byId: Map<string, FoldedEvent>;
  pending: Map<string, ToolUseCall>;
  /** Mark-bearing lines already folded; re-delivery must not double marks. */
  seenLines: Set<string>;
};

const internals = new WeakMap<MindFold, FoldInternals>();

export function emptyMindFold(sessionId = ""): MindFold {
  const session: TraceSession = {
    id: sessionId,
    harness: "claude-code",
    eventCount: 0,
  };
  const fold: MindFold = {
    version: 1,
    session,
    events: [],
    marks: [],
    stats: emptyStats(),
    touched: new Map(),
  };
  internals.set(fold, {
    byId: new Map(),
    pending: new Map(),
    seenLines: new Set(),
  });
  return fold;
}

/**
 * Internals for this fold object. Snapshots made the React way ({...fold},
 * structuredClone) do not carry the WeakMap: the index is re-seeded from
 * fold.events (every event knows its toolUseId), so a copy folding the same
 * line again dedupes instead of duplicating (auditor finding 3).
 */
function internsOf(fold: MindFold): FoldInternals {
  let i = internals.get(fold);
  if (!i) {
    i = {
      byId: new Map(fold.events.map((e) => [e.toolUseId, e])),
      pending: new Map(),
      seenLines: new Set(),
    };
    internals.set(fold, i);
  }
  return i;
}

/**
 * Reset a fold in place for a transcript file that shrank or was replaced:
 * events, marks, stats, session meta AND the id index/pending/line-dedupe
 * sets all go back to empty, or the refold would silence every re-delivered
 * tool_use as a duplicate (auditor correction 15).
 */
export function resetMindFold(
  fold: MindFold,
  sessionId = fold.session.id,
): void {
  fold.session = { id: sessionId, harness: "claude-code", eventCount: 0 };
  fold.events.length = 0;
  fold.marks.length = 0;
  fold.touched.clear();
  fold.stats = emptyStats();
  const i = internals.get(fold);
  if (i) {
    i.byId.clear();
    i.pending.clear();
    i.seenLines.clear();
  }
}

function toolInputOf(block: ContentBlock): ToolInput {
  const input = block.input;
  if (typeof input === "object" && input !== null && !Array.isArray(input)) {
    return input as ToolInput;
  }
  return {};
}

function buildEvent(
  seq: number,
  call: ToolUseCall,
  result: string,
  isError: boolean,
  outcomeKnown: boolean,
  ctx: TargetsCtx,
): TraceEvent {
  const action = actionFor(call.name, call.input, result);
  const { targets, outside } = targetsFor(call.name, call.input, result, ctx);
  return {
    seq,
    ts: call.ts,
    tool: call.name,
    action,
    targets,
    outside,
    resultBytes: result.length,
    isError,
    outcomeKnown,
    summary: summarizeTool(call.name, call.input, targets, outside, isError),
  };
}

const TOUCH_RANK = { hit: 1, read: 2, edit: 3 } as const;

function noteTouched(fold: MindFold, event: FoldedEvent): void {
  for (const t of event.targets) {
    const prev = fold.touched.get(t.path);
    if (!prev) {
      fold.touched.set(t.path, {
        touch: t.touch,
        firstSeq: event.seq,
        lastSeq: event.seq,
        count: 1,
        weak: t.weak,
      });
      continue;
    }
    if (TOUCH_RANK[t.touch] > TOUCH_RANK[prev.touch]) prev.touch = t.touch;
    if (!t.weak) prev.weak = false;
    prev.lastSeq = event.seq;
    prev.count++;
  }
}

function recomputeDerived(fold: MindFold): void {
  fold.touched.clear();
  for (const event of fold.events) noteTouched(fold, event);
  fold.stats = computeStats(
    fold.events,
    fold.marks,
    fold.stats.filesInRepo,
    "exact",
  );
  fold.session.eventCount = fold.events.length;
}

function applyMeta(
  fold: MindFold,
  meta: { sessionId?: string; cwd?: string; timestamp?: string },
): void {
  if (meta.sessionId) fold.session.id = meta.sessionId;
  if (meta.cwd && !fold.session.cwd) fold.session.cwd = meta.cwd;
  if (meta.timestamp) {
    if (!fold.session.startedAt) fold.session.startedAt = meta.timestamp;
    fold.session.endedAt = meta.timestamp;
  }
}

/**
 * Fold transcript lines into the live trace. Mutates and returns the same
 * fold object; callers that need React reactivity wrap it with a version
 * counter. Re-delivered lines are no-ops on BOTH sides: events dedupe by
 * tool_use id and mark-producing lines dedupe by line hash (auditor finding
 * 1: userTurns/compactions/subagents are stats, doubling them on a refold
 * poisons the metrics the judge reads). resetMindFold clears the hashes so a
 * genuine refold after file replacement re-marks everything.
 *
 * Divergence from mindwalk (registered in the card): seq is assigned at
 * tool_use time so the scene lights up while the call runs (criterion 3);
 * mindwalk appends at settle time and reindexes. eventsBeforeFirstEdit can
 * differ by the unsettled prefix.
 */
export function foldMindLines(
  fold: MindFold,
  lines: string[],
  ctxIn: TargetsCtx,
): MindFold {
  const ctx: TargetsCtx = {
    ...ctxIn,
    cwd: normalizeSlashes(ctxIn.cwd ?? ""),
    base: ctxIn.base ? normalizeSlashes(ctxIn.base) : undefined,
    home: ctxIn.home ? normalizeSlashes(ctxIn.home) : undefined,
    tmp: ctxIn.tmp ? normalizeSlashes(ctxIn.tmp) : undefined,
  };
  const i = internsOf(fold);
  let changed = false;

  const lineHash = (line: string): string => {
    let h = 5381;
    for (let k = 0; k < line.length; k++) h = (h * 33) ^ line.charCodeAt(k);
    return String(h);
  };
  const markOnce = (
    line: string,
    mark: { seq: number; type: TraceMark["type"]; note?: string },
  ): boolean => {
    const key = lineHash(line);
    if (i.seenLines.has(key)) return false;
    i.seenLines.add(key);
    fold.marks.push(mark);
    return true;
  };

  for (const line of lines) {
    if (line.trim() === "") continue;
    const parsed = parseSessionLine(line);
    applyMeta(fold, parsed);
    switch (parsed.kind) {
      case "ai-title":
        fold.session.title = parsed.title;
        changed = true;
        break;
      case "compaction":
        if (markOnce(line, { seq: fold.events.length, type: "compaction" })) {
          changed = true;
        }
        break;
      case "user-text":
        if (
          markOnce(line, {
            seq: fold.events.length,
            type: "user-message",
            note: parsed.note,
          })
        ) {
          changed = true;
        }
        break;
      case "message": {
        if (parsed.model && !fold.session.model)
          fold.session.model = parsed.model;
        for (const block of parsed.blocks) {
          if (block.type === "tool_use" && typeof block.id === "string") {
            const call: ToolUseCall = {
              id: block.id,
              name: typeof block.name === "string" ? block.name : "",
              input: toolInputOf(block),
              ts: parsed.timestamp,
            };
            let event = i.byId.get(call.id);
            if (!event) {
              if (call.name === "Task" || call.name === "Agent") {
                markOnce(line, {
                  seq: fold.events.length,
                  type: "subagent",
                  note: call.name,
                });
              }
              event = {
                ...buildEvent(fold.events.length, call, "", false, false, ctx),
                toolUseId: call.id,
                settled: false,
                input: call.input,
              };
              fold.events.push(event);
              i.byId.set(call.id, event);
              changed = true;
            }
            // Always refresh the pending call so a result arriving in a
            // later fold call reclassifies with the full input.
            i.pending.set(call.id, call);
          } else if (
            block.type === "tool_result" &&
            typeof block.tool_use_id === "string"
          ) {
            const id = block.tool_use_id;
            const existing = i.byId.get(id);
            const call = i.pending.get(id);
            if (!existing && !call) continue;
            // Re-delivered result whose call we no longer hold: the event is
            // already settled with its full input; reclassifying against an
            // empty input would downgrade it (auditor finding 2).
            if (existing?.settled && !call) continue;
            const result = contentToString(block.content);
            const isError = block.is_error === true;
            const final = buildEvent(
              existing ? existing.seq : fold.events.length,
              call ?? {
                id,
                name: existing?.tool ?? "",
                input: existing?.input ?? {},
                ts: existing?.ts,
              },
              result,
              isError,
              true,
              ctx,
            );
            if (existing) {
              Object.assign(existing, final);
              existing.settled = true;
            } else {
              const event: FoldedEvent = {
                ...final,
                toolUseId: id,
                settled: true,
                input: call?.input ?? {},
              };
              fold.events.push(event);
              i.byId.set(id, event);
            }
            i.pending.delete(id);
            changed = true;
          }
        }
        break;
      }
      default:
        break;
    }
  }

  if (changed) recomputeDerived(fold);
  return fold;
}
