import { create } from "zustand";
import {
  type LaneInput,
  type LaneMap,
  markLaneDone,
  upsertLane,
} from "./aiViewerLanes";

/**
 * The light store between the AgentRunBridge and the Ai Viewer. The bridge is
 * the chat's single subscriber and re-renders per token anyway; the viewer
 * must NOT subscribe to messages itself (a second subscriber re-renders on
 * every token), so it subscribes here instead and only wakes when a
 * file-mutation lane actually changes (upsertLane bails out on identity).
 */

type AiViewerState = {
  lanes: LaneMap;
  seq: number;
  publish: (input: LaneInput) => void;
  finish: (toolCallId: string) => void;
  clear: () => void;
};

export const useAiViewerStore = create<AiViewerState>((set) => ({
  lanes: {},
  seq: 0,

  publish: (input) =>
    set((s) => {
      const lanes = upsertLane(s.lanes, input, s.seq + 1);
      if (lanes === s.lanes) return s;
      return { lanes, seq: s.seq + 1 };
    }),

  finish: (toolCallId) =>
    set((s) => {
      const lanes = markLaneDone(s.lanes, toolCallId);
      return lanes === s.lanes ? s : { lanes };
    }),

  clear: () => set({ lanes: {}, seq: 0 }),
}));
