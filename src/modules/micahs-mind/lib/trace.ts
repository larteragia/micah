/**
 * Trace model for Micah's Mind, ported from mindwalk's trace schema
 * (github.com/cosmtrek/mindwalk, MIT, Copyright (c) 2026 Ricko Yu; see
 * LICENSES/mindwalk.txt). The trace is the normalized, replayable record of
 * what the agent touched during one Claude Code session.
 */

export type Touch = "hit" | "read" | "edit";
export type TraceAction =
  | "search"
  | "read"
  | "edit"
  | "exec"
  | "verify"
  | "other";
export type MarkType = "compaction" | "user-message" | "subagent";
export type OutsideScope = "home" | "tmp" | "other";
export type Observability = "exact" | "estimated" | "unavailable";

export type TraceTarget = {
  /** Repo-relative, forward slashes. */
  path: string;
  touch: Touch;
  lines?: Array<[number, number]>;
  /** Target inferred from command or output text rather than tool input. */
  weak: boolean;
};

export type OutsideTouch = { scope: OutsideScope; path: string };

export type TraceEvent = {
  seq: number;
  ts?: string;
  tool: string;
  action: TraceAction;
  targets: TraceTarget[];
  outside?: OutsideTouch[];
  resultBytes: number;
  isError: boolean;
  outcomeKnown: boolean;
  summary: string;
};

export type TraceMark = {
  seq: number;
  type: MarkType;
  note?: string;
};

export type ActionCounts = {
  search: number;
  read: number;
  edit: number;
  exec: number;
  verify: number;
  other: number;
};

export type TraceStats = {
  filesInRepo: number;
  fovea: number;
  parafovea: number;
  edited: number;
  eventsBeforeFirstEdit: number;
  regressionRate: number;
  errorRate: number;
  actions: ActionCounts;
  errors: ActionCounts;
  maxEditsPerFile: number;
  churnFiles: number;
  userTurns: number;
  compactions: number;
  subagents: number;
  resultBytes: number;
  editsAfterLastVerify: number;
  observability: { reads: Observability; errors: Observability };
};

export type TraceSession = {
  id: string;
  harness: "claude-code";
  model?: string;
  title?: string;
  cwd?: string;
  startedAt?: string;
  endedAt?: string;
  eventCount: number;
};

export type MindTrace = {
  version: 1;
  session: TraceSession;
  events: TraceEvent[];
  marks: TraceMark[];
  stats: TraceStats;
};

export function emptyActionCounts(): ActionCounts {
  return {
    search: 0,
    read: 0,
    edit: 0,
    exec: 0,
    verify: 0,
    other: 0,
  };
}

export function emptyStats(): TraceStats {
  return {
    filesInRepo: 0,
    fovea: 0,
    parafovea: 0,
    edited: 0,
    eventsBeforeFirstEdit: 0,
    regressionRate: 0,
    errorRate: 0,
    actions: emptyActionCounts(),
    errors: emptyActionCounts(),
    maxEditsPerFile: 0,
    churnFiles: 0,
    userTurns: 0,
    compactions: 0,
    subagents: 0,
    resultBytes: 0,
    editsAfterLastVerify: 0,
    observability: { reads: "unavailable", errors: "estimated" },
  };
}

/** Higher touch wins when a path is seen twice in one event. */
export function rankTouch(touch: Touch | "" | undefined): number {
  switch (touch) {
    case "edit":
      return 3;
    case "read":
      return 2;
    case "hit":
      return 1;
    default:
      return 0;
  }
}

function countAction(counts: ActionCounts, action: TraceAction): void {
  switch (action) {
    case "search":
      counts.search++;
      break;
    case "read":
      counts.read++;
      break;
    case "edit":
      counts.edit++;
      break;
    case "exec":
      counts.exec++;
      break;
    case "verify":
      counts.verify++;
      break;
    default:
      counts.other++;
      break;
  }
}

/**
 * Derive session facts from events and marks, ported 1:1 from mindwalk's
 * model.ComputeStats. errorSignal grades the adapter's own error detection;
 * Claude Code flags failures structurally, so the fold passes "exact".
 */
export function computeStats(
  events: TraceEvent[],
  marks: TraceMark[],
  filesInRepo: number,
  errorSignal: Observability = "estimated",
): TraceStats {
  const state = new Map<string, Touch>();
  const lastReadVersion = new Map<string, number>();
  const editVersion = new Map<string, number>();
  let readEvents = 0;
  let weakReads = 0;
  let repeatedReads = 0;
  let errors = 0;
  let unknownOutcomes = false;
  let firstEdit = -1;

  const stats = emptyStats();
  stats.filesInRepo = filesInRepo;

  for (const event of events) {
    countAction(stats.actions, event.action);
    if (event.isError) {
      errors++;
      countAction(stats.errors, event.action);
    } else if (!event.outcomeKnown) {
      unknownOutcomes = true;
    }
    stats.resultBytes += event.resultBytes;
    if (event.action === "verify") stats.editsAfterLastVerify = 0;
    if (event.action === "edit") stats.editsAfterLastVerify++;
    for (const target of event.targets) {
      if (target.path === "") continue;
      const prev = state.get(target.path) ?? "";
      if (rankTouch(target.touch) > rankTouch(prev)) {
        state.set(target.path, target.touch);
      }
      if (target.touch === "edit") {
        editVersion.set(target.path, (editVersion.get(target.path) ?? 0) + 1);
        if (firstEdit === -1) firstEdit = event.seq;
      }
      if (target.touch === "read") {
        readEvents++;
        if (target.weak) weakReads++;
        const version = lastReadVersion.get(target.path);
        if (version !== undefined && version === editVersion.get(target.path)) {
          repeatedReads++;
        }
        lastReadVersion.set(target.path, editVersion.get(target.path) ?? 0);
      }
    }
  }

  stats.eventsBeforeFirstEdit = firstEdit >= 0 ? firstEdit : events.length;
  for (const touch of state.values()) {
    if (touch === "edit") {
      stats.edited++;
      stats.fovea++;
    } else if (touch === "read") {
      stats.fovea++;
    } else if (touch === "hit") {
      stats.parafovea++;
    }
  }
  for (const count of editVersion.values()) {
    if (count > stats.maxEditsPerFile) stats.maxEditsPerFile = count;
    if (count >= 3) stats.churnFiles++;
  }
  for (const mark of marks) {
    if (mark.type === "user-message") stats.userTurns++;
    if (mark.type === "compaction") stats.compactions++;
    if (mark.type === "subagent") stats.subagents++;
  }
  if (readEvents > 0) {
    stats.regressionRate = repeatedReads / readEvents;
  }
  if (events.length > 0) stats.errorRate = errors / events.length;
  if (readEvents === 0) {
    stats.observability.reads = "unavailable";
  } else if (weakReads === 0) {
    stats.observability.reads = "exact";
  } else {
    stats.observability.reads = "estimated";
  }
  let signal = errorSignal || "estimated";
  if (signal === "exact" && unknownOutcomes) signal = "estimated";
  stats.observability.errors = signal;
  return stats;
}
