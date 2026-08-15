import { useAgentStore } from "@/modules/agents/store/agentStore";
import { useChatStore } from "@/modules/ai";
import { leafHasForegroundProcess } from "@/modules/terminal";
import { cn } from "@/lib/utils";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { orderedLanes, type LaneKind } from "./lib/aiViewerLanes";
import { useAiViewerStore } from "./lib/useAiViewerStore";
import { useClaudeSessionFeed } from "./lib/useClaudeSessionFeed";
import { LeftPanelEmpty } from "./LeftPanelEmpty";

// Lazy for the same reason the editor stacks are: CodeMirror must stay out
// of the eager startup bundle (locked by the eager-budget test).
const ReadOnlyStream = lazy(() =>
  import("./ReadOnlyStream").then((m) => ({ default: m.ReadOnlyStream })),
);

const TERMINAL_POLL_MS = 500;
const ALIVE_POLL_MS = 2000;

const LANE_VERB: Record<LaneKind, string> = {
  read: "reading",
  edit: "editing",
  write: "writing",
};

export type AnchoredLeaf = { leafId: number; resume: string };

/** What a terminal lane needs to label itself; agent-signal sessions and
 * anchored-but-signalless panes both reduce to this. */
type LaneMeta = {
  leafId: number;
  agent: string;
  status: string;
  resume: string | null;
};

/**
 * Read-only observation deck: one horizontal lane per working AI instance.
 * The local Micah agent's lanes come from the viewer store the
 * AgentRunBridge feeds (streaming write_file content, edit old/new pairs).
 * A terminal agent's lane shows what its TUI does not: the files it is
 * reading, editing and writing, tailed from the Claude Code session
 * transcript anchored to the pane. The raw terminal buffer is only the
 * fallback when no transcript exists. A pane with an anchored session and a
 * live foreground process counts even when no OSC signal ever arrived
 * (claude launched outside the shell wrapper). Watching only; intervening
 * is the conversation's job.
 */
export function AiViewerArea({
  resolveLeafResume,
  anchoredLeaves,
}: {
  resolveLeafResume?: (leafId: number) => string | null;
  anchoredLeaves?: AnchoredLeaf[];
}) {
  const lanes = useAiViewerStore((s) => s.lanes);
  const sessions = useAgentStore((s) => s.sessions);

  const localLanes = orderedLanes(lanes);
  const signalled: LaneMeta[] = Object.values(sessions)
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({
      leafId: s.leafId,
      agent: s.agent,
      status: s.status,
      resume: resolveLeafResume?.(s.leafId) ?? null,
    }));

  const candidates = (anchoredLeaves ?? []).filter((a) => !sessions[a.leafId]);
  const aliveIds = useAliveLeaves(candidates.map((a) => a.leafId));
  const anchored: LaneMeta[] = candidates
    .filter((a) => aliveIds.includes(a.leafId))
    .map((a) => ({
      leafId: a.leafId,
      agent: "claude",
      status: "working",
      resume: a.resume,
    }));

  const terminals = [...signalled, ...anchored];
  if (localLanes.length === 0 && terminals.length === 0) {
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
      {terminals.map((meta) => (
        <TerminalSessionLanes key={meta.leafId} meta={meta} />
      ))}
    </div>
  );
}

/** Which of these leaves have a live foreground process, polled lightly
 * while the viewer is on screen. */
function useAliveLeaves(leafIds: number[]): number[] {
  const [alive, setAlive] = useState<number[]>([]);
  const key = leafIds.join(",");
  useEffect(() => {
    const ids = key.length > 0 ? key.split(",").map(Number) : [];
    if (ids.length === 0) {
      setAlive((prev) => (prev.length === 0 ? prev : []));
      return;
    }
    let on = true;
    const tick = async () => {
      const checks = await Promise.all(
        ids.map(async (id) => ((await leafHasForegroundProcess(id)) ? id : -1)),
      );
      if (!on) return;
      const next = checks.filter((id) => id !== -1);
      setAlive((prev) =>
        prev.length === next.length && prev.every((v, i) => v === next[i])
          ? prev
          : next,
      );
    };
    void tick();
    const timer = setInterval(() => void tick(), ALIVE_POLL_MS);
    return () => {
      on = false;
      clearInterval(timer);
    };
  }, [key]);
  return alive;
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

function TerminalSessionLanes({ meta }: { meta: LaneMeta }) {
  const feed = useClaudeSessionFeed(meta.resume);
  const fileLanes = orderedLanes(feed.lanes);
  if (feed.status === "feed" && fileLanes.length > 0) {
    return (
      <>
        {fileLanes.map((lane) => (
          <Lane
            key={lane.toolCallId}
            label={`${meta.agent} · ${LANE_VERB[lane.kind]} ${lane.path} (${meta.status})`}
            dimmed={lane.done}
          >
            <ReadOnlyStream content={lane.content} />
          </Lane>
        ))}
      </>
    );
  }
  return <TerminalBufferLane meta={meta} />;
}

function TerminalBufferLane({ meta }: { meta: LaneMeta }) {
  const [buffer, setBuffer] = useState("");

  // The terminal's buffer has no change events at this layer; a light poll
  // while the lane is on screen is the whole cost, and unmounting stops it.
  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (!alive) return;
      const text = useChatStore.getState().live.readLeafBuffer(meta.leafId);
      if (text !== null) setBuffer(text);
    };
    tick();
    const timer = setInterval(tick, TERMINAL_POLL_MS);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [meta.leafId]);

  return (
    <Lane
      label={`${meta.agent} · terminal output (${meta.status})`}
      dimmed={meta.status === "waiting"}
    >
      <ReadOnlyStream content={buffer} />
    </Lane>
  );
}
