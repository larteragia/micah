import { useAgentStore } from "@/modules/agents/store/agentStore";
import { useChatStore } from "@/modules/ai";
import { leafHasForegroundProcess } from "@/modules/terminal";
import { cn } from "@/lib/utils";
import { lazy, Suspense, useEffect, useState, type ReactNode } from "react";
import { orderedLanes, type LaneKind } from "./lib/aiViewerLanes";
import {
  readAiViewerActive,
  writeAiViewerActive,
} from "./lib/activation";
import { useAiViewerStore } from "./lib/useAiViewerStore";
import { useClaudeSessionFeed } from "./lib/useClaudeSessionFeed";
import { LeftPanelEmpty } from "./LeftPanelEmpty";

// Lazy for the same reason the editor stacks are: CodeMirror must stay out
// of the eager startup bundle (locked by the eager-budget test).
const ReadOnlyStream = lazy(() =>
  import("./ReadOnlyStream").then((m) => ({ default: m.ReadOnlyStream })),
);
// The stream view pulls the chat's reasoning/tool rows (hugeicons, radix
// collapsible); same eager-budget rule.
const SessionStreamView = lazy(() =>
  import("./SessionStreamView").then((m) => ({ default: m.SessionStreamView })),
);

const TERMINAL_POLL_MS = 500;
const ALIVE_POLL_MS = 2000;

const LANE_VERB: Record<LaneKind, string> = {
  read: "reading",
  edit: "editing",
  write: "writing",
};

export type AnchoredLeaf = { leafId: number; resume: string };

type ViewerView = "stream" | "files";

/** What a terminal lane needs to label itself; agent-signal sessions and
 * anchored-but-signalless panes both reduce to this. */
type LaneMeta = {
  leafId: number;
  agent: string;
  status: string;
  resume: string | null;
};

/**
 * Read-only observation deck for the AI working in the pane you are looking
 * at. Off until the user hits Ativar — only then does it tail the Claude
 * Code session transcript anchored to the visible panes of the active tab
 * (thinking, every tool call, edits, chronologically), with the per-file
 * lanes one toggle away. The local Micah agent's lanes come from the viewer
 * store the AgentRunBridge feeds. The raw terminal buffer is only the
 * fallback when no transcript exists. Watching only; intervening is the
 * conversation's job.
 */
export function AiViewerArea({
  resolveLeafResume,
  anchoredLeaves,
  visibleLeafIds,
}: {
  resolveLeafResume?: (leafId: number) => string | null;
  anchoredLeaves?: AnchoredLeaf[];
  visibleLeafIds?: number[];
}) {
  const [active, setActive] = useState(readAiViewerActive);
  const [view, setView] = useState<ViewerView>("stream");
  const lanes = useAiViewerStore((s) => s.lanes);
  const sessions = useAgentStore((s) => s.sessions);

  const inScope = (leafId: number) =>
    visibleLeafIds === undefined || visibleLeafIds.includes(leafId);

  const localLanes = orderedLanes(lanes);
  const signalled: LaneMeta[] = Object.values(sessions)
    .filter((s) => inScope(s.leafId))
    .sort((a, b) => a.startedAt - b.startedAt)
    .map((s) => ({
      leafId: s.leafId,
      agent: s.agent,
      status: s.status,
      resume: resolveLeafResume?.(s.leafId) ?? null,
    }));

  const candidates = (anchoredLeaves ?? []).filter(
    (a) => !sessions[a.leafId] && inScope(a.leafId),
  );
  // Inactive viewer polls nothing: an empty id list short-circuits the hook.
  const aliveIds = useAliveLeaves(active ? candidates.map((a) => a.leafId) : []);
  const anchored: LaneMeta[] = candidates
    .filter((a) => aliveIds.includes(a.leafId))
    .map((a) => ({
      leafId: a.leafId,
      agent: "claude",
      status: "working",
      resume: a.resume,
    }));

  const setActivePersisted = (next: boolean) => {
    writeAiViewerActive(next);
    setActive(next);
  };

  if (!active) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
        <div>
          <p className="text-sm font-medium text-foreground/80">
            Ai Viewer desligado
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Ativar conecta ao transcript da sessão Claude Code da pane ao
            lado e mostra o que a TUI não mostra: pensamento, tools e edits,
            ao vivo. Somente leitura.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActivePersisted(true)}
          className={cn(
            "h-7 cursor-pointer rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground",
            "transition-colors hover:bg-primary/90",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
          )}
        >
          Ativar
        </button>
      </div>
    );
  }

  const terminals = [...signalled, ...anchored];
  const body =
    localLanes.length === 0 && terminals.length === 0 ? (
      <LeftPanelEmpty
        title="No AI in the current tab"
        hint="Open the tab whose terminal runs claude (via the shell wrapper) and its session shows up here."
      />
    ) : (
      <div className="flex min-h-0 flex-1 flex-col divide-y divide-border/60">
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
          <TerminalSession key={meta.leafId} meta={meta} view={view} />
        ))}
      </div>
    );

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-7 shrink-0 items-center gap-1 border-b border-border/40 px-2">
        <ViewButton
          label="Stream"
          active={view === "stream"}
          onClick={() => setView("stream")}
        />
        <ViewButton
          label="Files"
          active={view === "files"}
          onClick={() => setView("files")}
        />
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => setActivePersisted(false)}
          className="cursor-pointer text-[11px] text-muted-foreground transition-colors hover:text-foreground"
        >
          Desativar
        </button>
      </div>
      {body}
    </div>
  );
}

function ViewButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        "h-5 cursor-pointer rounded px-2 text-[11px] font-medium transition-colors",
        active
          ? "bg-foreground/10 text-foreground"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
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

/** One anchored pane: a single feed drives both views, so toggling does not
 * restart the tail. */
function TerminalSession({ meta, view }: { meta: LaneMeta; view: ViewerView }) {
  const feed = useClaudeSessionFeed(meta.resume);
  if (feed.status !== "feed") return <TerminalBufferLane meta={meta} />;

  if (view === "stream") {
    if (feed.stream.events.length === 0) {
      return <TerminalBufferLane meta={meta} />;
    }
    return (
      <div className="flex min-h-0 flex-1 basis-0 flex-col">
        <div
          className="flex h-6 shrink-0 items-center border-b border-border/40 px-2 text-[11px] text-muted-foreground"
          title={`${meta.agent} session`}
        >
          <span className="truncate">
            {meta.agent} · session ({meta.status})
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <Suspense fallback={null}>
            <SessionStreamView events={feed.stream.events} />
          </Suspense>
        </div>
      </div>
    );
  }

  const fileLanes = orderedLanes(feed.lanes);
  if (fileLanes.length === 0) return <TerminalBufferLane meta={meta} />;
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
