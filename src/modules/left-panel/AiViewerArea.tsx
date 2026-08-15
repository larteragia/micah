import type { AgentSession } from "@/modules/agents/lib/types";
import { useAgentStore } from "@/modules/agents/store/agentStore";
import { useChatStore } from "@/modules/ai";
import { cn } from "@/lib/utils";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import {
  orderedLanes,
  type LaneKind,
  type ViewerLane,
} from "./lib/aiViewerLanes";
import { useAiViewerStore } from "./lib/useAiViewerStore";
import { useClaudeSessionFeed } from "./lib/useClaudeSessionFeed";
import { LeftPanelEmpty } from "./LeftPanelEmpty";

// Lazy for the same reason the editor stacks are: CodeMirror must stay out
// of the eager startup bundle (locked by the eager-budget test).
const ReadOnlyStream = lazy(() =>
  import("./ReadOnlyStream").then((m) => ({ default: m.ReadOnlyStream })),
);

const TERMINAL_POLL_MS = 500;

const LANE_VERB: Record<LaneKind, string> = {
  read: "reading",
  edit: "editing",
  write: "writing",
};

/**
 * Read-only observation deck: one horizontal lane per working AI instance.
 * The local Micah agent's lanes come from the viewer store the
 * AgentRunBridge feeds (streaming write_file content, edit old/new pairs).
 * A terminal agent's lane shows what its TUI does not: the files it is
 * reading, editing and writing, tailed from the Claude Code session
 * transcript anchored to the pane. The raw terminal buffer is only the
 * fallback when no transcript exists. Watching only; intervening is the
 * conversation's job.
 */
export function AiViewerArea({
  resolveLeafResume,
}: {
  resolveLeafResume?: (leafId: number) => string | null;
}) {
  const lanes = useAiViewerStore((s) => s.lanes);
  const sessions = useAgentStore((s) => s.sessions);

  const localLanes = orderedLanes(lanes);
  const terminalSessions = Object.values(sessions).sort(
    (a, b) => a.startedAt - b.startedAt,
  );

  if (localLanes.length === 0 && terminalSessions.length === 0) {
    return (
      <LeftPanelEmpty
        title="No AI is working right now"
        hint="Running agents show up here, one lane each, read only."
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col divide-y divide-border/60">
      {localLanes.map((lane) => (
        <Lane
          key={lane.toolCallId}
          label={`Micah agent · ${LANE_VERB[lane.kind]} ${lane.path}`}
          dimmed={lane.done}
        >
          <ReadOnlyStream content={lane.content} />
        </Lane>
      ))}
      {terminalSessions.map((session) => (
        <TerminalSessionLanes
          key={session.leafId}
          session={session}
          resume={resolveLeafResume?.(session.leafId) ?? null}
        />
      ))}
    </div>
  );
}

function Lane({
  label,
  dimmed,
  children,
}: {
  label: string;
  dimmed?: boolean;
  children: ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 basis-0 flex-col",
        dimmed && "opacity-60",
      )}
    >
      <div
        className="flex h-6 shrink-0 items-center border-b border-border/40 px-2 text-[11px] text-muted-foreground"
        title={label}
      >
        <span className="truncate">{label}</span>
      </div>
      <div className="min-h-0 flex-1 px-2">
        <Suspense fallback={null}>{children}</Suspense>
      </div>
    </div>
  );
}

function TerminalSessionLanes({
  session,
  resume,
}: {
  session: AgentSession;
  resume: string | null;
}) {
  const feed = useClaudeSessionFeed(resume);
  const fileLanes = orderedLanes(feed.lanes);
  if (feed.status === "feed" && fileLanes.length > 0) {
    return (
      <>
        {fileLanes.map((lane) => (
          <Lane
            key={lane.toolCallId}
            label={sessionLaneLabel(session, lane)}
            dimmed={lane.done}
          >
            <ReadOnlyStream content={lane.content} />
          </Lane>
        ))}
      </>
    );
  }
  return <TerminalBufferLane session={session} />;
}

function sessionLaneLabel(session: AgentSession, lane: ViewerLane): string {
  return `${session.agent} · ${LANE_VERB[lane.kind]} ${lane.path} (${session.status})`;
}

function TerminalBufferLane({ session }: { session: AgentSession }) {
  const [buffer, setBuffer] = useState("");

  // The terminal's buffer has no change events at this layer; a light poll
  // while the lane is on screen is the whole cost, and unmounting stops it.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const text = useChatStore.getState().live.readLeafBuffer(session.leafId);
      if (text !== null) setBuffer(text);
    };
    tick();
    const timer = setInterval(tick, TERMINAL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [session.leafId]);

  return (
    <Lane
      label={`${session.agent} · terminal output (${session.status})`}
      dimmed={session.status === "waiting"}
    >
      <ReadOnlyStream content={buffer} />
    </Lane>
  );
}
