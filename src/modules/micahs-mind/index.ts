export type { PathCtx, TargetsCtx, ToolInput } from "./lib/classify";
export {
  actionFor,
  contentToString,
  extractCommandPaths,
  extractPaths,
  normalizePath,
  normalizeSlashes,
  parsePathHits,
  summarizeTool,
  targetsFor,
} from "./lib/classify";
export type { FoldedEvent, MindFold, TouchedInfo } from "./lib/foldTrace";
export { emptyMindFold, foldMindLines } from "./lib/foldTrace";
export type { ContentBlock, LineMeta, SessionLine } from "./lib/parseSession";
export {
  hasUserMessage,
  injectedUserMessage,
  parseSessionLine,
  userMessageNote,
  userMessageText,
} from "./lib/parseSession";
export type {
  ActionCounts,
  MarkType,
  MindTrace,
  Observability,
  OutsideScope,
  OutsideTouch,
  Touch,
  TraceAction,
  TraceEvent,
  TraceMark,
  TraceSession,
  TraceStats,
  TraceTarget,
} from "./lib/trace";
export {
  computeStats,
  emptyActionCounts,
  emptyStats,
  rankTouch,
} from "./lib/trace";
