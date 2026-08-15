/**
 * Pure lane bookkeeping for the Ai Viewer. The AgentRunBridge (the single
 * useChat subscriber) publishes what the local agent is writing, keyed by
 * toolCallId; the viewer renders one read-only lane per live tool call.
 * Everything here is pure so the cap and eviction rules are testable.
 */

export type EditPair = { old_string: string; new_string: string };

export type LaneKind = "write" | "edit" | "read";

export type LaneInput = {
  toolCallId: string;
  path: string;
  kind: LaneKind;
  /** Cumulative partial content for writes (grows as the input streams). */
  content?: string;
  /** Old/new pairs for edit and multi_edit. */
  edits?: EditPair[];
};

export type ViewerLane = {
  toolCallId: string;
  path: string;
  kind: LaneKind;
  /** What the lane shows: the streamed content, or the rendered pairs. */
  content: string;
  done: boolean;
  seq: number;
};

export type LaneMap = Record<string, ViewerLane>;

/** Keep at most this many lanes; finished ones are evicted first. */
export const LANE_CAP = 8;
/** Per-lane content ceiling. The head is trimmed: while a file streams in,
 * the tail is where the action is. */
export const CONTENT_CAP = 100_000;

export function renderEdits(edits: EditPair[]): string {
  return edits
    .map((e) => `--- old\n${e.old_string}\n+++ new\n${e.new_string}`)
    .join("\n\n");
}

export function capContent(content: string): string {
  if (content.length <= CONTENT_CAP) return content;
  return content.slice(content.length - CONTENT_CAP);
}

/** Insert or update a lane. Returns the same map when nothing changed, so
 * subscribers can bail out on identity. */
export function upsertLane(
  lanes: LaneMap,
  input: LaneInput,
  seq: number,
): LaneMap {
  const content = capContent(
    input.kind === "edit"
      ? renderEdits(input.edits ?? [])
      : (input.content ?? ""),
  );
  const prev = lanes[input.toolCallId];
  if (
    prev &&
    prev.content === content &&
    prev.path === input.path &&
    !prev.done
  ) {
    return lanes;
  }
  const lane: ViewerLane = {
    toolCallId: input.toolCallId,
    path: input.path,
    kind: input.kind,
    content,
    done: false,
    seq: prev?.seq ?? seq,
  };
  return evict({ ...lanes, [input.toolCallId]: lane });
}

export function markLaneDone(lanes: LaneMap, toolCallId: string): LaneMap {
  const prev = lanes[toolCallId];
  if (!prev || prev.done) return lanes;
  return { ...lanes, [toolCallId]: { ...prev, done: true } };
}

/** Oldest finished lanes go first; live lanes are never evicted (a burst of
 * more than LANE_CAP simultaneous tool calls keeps them all - correctness
 * over the cap, and the burst is transient). */
function evict(lanes: LaneMap): LaneMap {
  const all = Object.values(lanes);
  if (all.length <= LANE_CAP) return lanes;
  const doneOldestFirst = all
    .filter((l) => l.done)
    .sort((a, b) => a.seq - b.seq);
  const excess = all.length - LANE_CAP;
  if (doneOldestFirst.length === 0) return lanes;
  const next = { ...lanes };
  for (const lane of doneOldestFirst.slice(0, excess)) {
    delete next[lane.toolCallId];
  }
  return next;
}

/** Lanes in stable creation order for rendering. */
export function orderedLanes(lanes: LaneMap): ViewerLane[] {
  return Object.values(lanes).sort((a, b) => a.seq - b.seq);
}
