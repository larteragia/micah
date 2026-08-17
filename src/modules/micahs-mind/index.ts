export type {
  CityDir,
  CityEntry,
  CityFile,
  CityMap,
  Rect,
  TouchedPath,
} from "./lib/citymap";
export {
  buildCityMap,
  cleanRel,
  langForPath,
  MAX_MAP_FILES,
  placeGhost,
} from "./lib/citymap";
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
export { emptyMindFold, foldMindLines, resetMindFold } from "./lib/foldTrace";
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
export type { MindFeed, MindSessionPick } from "./lib/useMindFeed";
export {
  deriveHome,
  pickMindSession,
  touchedTopDirs,
  useMindFeed,
} from "./lib/useMindFeed";
export {
  type AnchoredLeaf,
  fileAtPoint,
  MicahsMindArea,
} from "./MicahsMindArea";
