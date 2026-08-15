import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import type { LaneMap } from "./aiViewerLanes";
import {
  dropLeadingPartialLine,
  foldSessionEvents,
  parseSessionLine,
  splitSessionChunk,
} from "./claudeSessionOps";

type SessionTail = {
  found: boolean;
  data: string;
  next_offset: number;
  has_more: boolean;
  clipped: boolean;
};

const POLL_MS = 700;
/** Drain a backlog fast; the chunk cap means a long session needs a few trips. */
const CATCHUP_MS = 60;
/** The transcript file only exists once the agent answered something; keep
 * probing slowly so a fresh session upgrades from the buffer fallback. */
const ABSENT_POLL_MS = 3000;

export type ClaudeFeed = {
  status: "probing" | "feed" | "absent";
  lanes: LaneMap;
};

/**
 * Follow a pane's anchored Claude Code session transcript and expose it as
 * viewer lanes. Polling only runs while the consumer is mounted, and the
 * offset lives here so each poll ships only new bytes over IPC.
 */
export function useClaudeSessionFeed(sessionId: string | null): ClaudeFeed {
  const [lanes, setLanes] = useState<LaneMap>({});
  const [status, setStatus] = useState<ClaudeFeed["status"]>(
    sessionId ? "probing" : "absent",
  );
  const lanesRef = useRef<LaneMap>({});

  useEffect(() => {
    if (!sessionId) {
      setStatus("absent");
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let offset: number | undefined;
    let carry = "";
    let seq = 0;
    let synced = false;
    lanesRef.current = {};
    setLanes({});
    setStatus("probing");

    const tick = async () => {
      let delay = POLL_MS;
      try {
        const tail = await invoke<SessionTail>("claude_session_tail", {
          sessionId,
          offset,
        });
        if (!alive) return;
        if (!tail.found) {
          delay = ABSENT_POLL_MS;
          setStatus((s) => (s === "feed" ? s : "absent"));
        } else {
          offset = tail.next_offset;
          if (tail.has_more) delay = CATCHUP_MS;
          let chunk = tail.data;
          if (!synced) {
            synced = true;
            setStatus("feed");
            if (tail.clipped) chunk = dropLeadingPartialLine(chunk);
          }
          if (chunk.length > 0) {
            const split = splitSessionChunk(carry, chunk);
            carry = split.carry;
            const events = split.lines.flatMap(parseSessionLine);
            const folded = foldSessionEvents(lanesRef.current, events, seq);
            seq = folded.nextSeq;
            if (folded.lanes !== lanesRef.current) {
              lanesRef.current = folded.lanes;
              setLanes(folded.lanes);
            }
          }
        }
      } catch {
        // Command failure (bad id, IO): stay on the fallback quietly.
        if (!alive) return;
        delay = ABSENT_POLL_MS;
        setStatus((s) => (s === "feed" ? s : "absent"));
      }
      if (alive) timer = setTimeout(() => void tick(), delay);
    };
    void tick();

    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [sessionId]);

  return { status, lanes };
}
