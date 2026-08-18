/**
 * Micah's Mind scene: the repository as a night city of luminous dots the
 * agent touched, navigable with mouse or touch, following the Claude
 * session of the focused pane in real time. Canvas 2D only: no new
 * dependency (LEI ZERO) and no WebGL context (renderer pool stays at 5).
 *
 * The map is always visible (card sempre-visivel): a pane with no anchored
 * session still draws its repository city (dark, untouched), and an
 * auto-connect picks the freshest session whose transcript cwd sits inside
 * the pane's location. Priority is fixed: a real anchor beats a manual
 * choice, a manual choice beats the auto-connect.
 */

import { LeftPanelEmpty } from "@/modules/left-panel/LeftPanelEmpty";
import {
  readAiViewerActive,
  writeAiViewerActive,
} from "@/modules/left-panel/lib/activation";
import { invoke } from "@tauri-apps/api/core";
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import {
  type MindSessionPick,
  composePick,
  pickMindSession,
  useMindFeed,
} from "./lib/useMindFeed";

const MindCanvas = lazy(() =>
  import("./MindCanvas").then((m) => ({ default: m.MindCanvas })),
);

export type AnchoredLeaf = { leafId: number; resume: string };

type RecentSession = {
  session_id: string;
  mtime_ms: number;
  size_bytes: number;
};

const WHY_TEXT: Record<MindSessionPick["why"], string> = {
  "focused-leaf": "pane em foco",
  "single-anchored": "única pane ancorada",
  ambiguous: "mais de uma pane ancorada; clique numa delas",
  none: "nenhuma sessão ancorada nesta aba",
  manual: "sessão escolhida manualmente",
  "auto-recent": "replay: sessão mais recente deste local",
};

function ageLabel(mtimeMs: number): string {
  const s = Math.max(0, Date.now() - mtimeMs) / 1000;
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}

export function MicahsMindArea({
  resolveLeafResume,
  resolveLeafCwd,
  anchoredLeaves,
  visibleLeafIds,
  activeLeafId,
}: {
  resolveLeafResume?: (leafId: number) => string | null;
  resolveLeafCwd?: (leafId: number) => string | null;
  anchoredLeaves?: AnchoredLeaf[];
  visibleLeafIds?: number[];
  activeLeafId?: number | null;
}) {
  const [active, setActive] = useState(readAiViewerActive);
  /** Manual picker choice; lives in memory, dies with the pane focus. */
  const [manualSession, setManualSession] = useState<string | null>(null);
  /** Auto-connect result, once per focused cwd (never over a choice). */
  const [auto, setAuto] = useState<{ session: string | null; forCwd: string } | null>(
    null,
  );
  const [recent, setRecent] = useState<RecentSession[]>([]);
  const [listOpen, setListOpen] = useState(false);

  const anchoredPick = useMemo(
    () =>
      pickMindSession({
        activeLeafId,
        resolveLeafResume,
        anchoredLeaves,
        visibleLeafIds,
      }),
    [activeLeafId, resolveLeafResume, anchoredLeaves, visibleLeafIds],
  );

  const focusedCwd =
    activeLeafId != null && resolveLeafCwd
      ? resolveLeafCwd(activeLeafId)
      : null;

  // The focused pane rules: switching pane/tab drops both the manual choice
  // and the auto-connect so the next pane starts its own resolution.
  useEffect(() => {
    setManualSession(null);
    setAuto(null);
    setListOpen(false);
  }, [activeLeafId]);

  const pick = useMemo(
    () => composePick(anchoredPick, manualSession, auto),
    [anchoredPick, manualSession, auto],
  );

  // Auto-connect, once per cwd: only when nothing is anchored and nothing
  // was manually chosen. The command scopes by the transcript's own cwd
  // (deepest ancestor with sessions), so a pane inside a repo finds that
  // repo and a pane at home finds home sessions.
  useEffect(() => {
    if (!focusedCwd || manualSession || anchoredPick.session) return;
    if (auto?.forCwd === focusedCwd) return;
    let alive = true;
    void (async () => {
      try {
        const res = await invoke<RecentSession[]>("claude_sessions_recent", {
          cwd: focusedCwd,
          limit: 5,
        });
        if (!alive) return;
        setRecent(res);
        setAuto({
          session: res[0]?.session_id ?? null,
          forCwd: focusedCwd,
        });
      } catch {
        if (!alive) return;
        setAuto({ session: null, forCwd: focusedCwd });
      }
    })();
    return () => {
      alive = false;
    };
  }, [focusedCwd, manualSession, anchoredPick.session, auto?.forCwd]);

  const feed = useMindFeed(pick, active, focusedCwd);

  const setActivePersisted = (next: boolean) => {
    writeAiViewerActive(next);
    setActive(next);
  };

  if (!active) {
    return (
      <div className="flex h-full min-h-0 flex-col items-center justify-center gap-3 px-6 text-center">
        <div>
          <p className="text-sm font-medium text-foreground/80">
            Micah&apos;s Mind desligado
          </p>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            Ativar conecta ao transcript da sessão Claude Code da pane em foco e
            desenha o rastro da AI no repositório: onde passou, o que leu, o que
            editou. Somente leitura.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setActivePersisted(true)}
          className="rounded-md border border-border bg-background px-3 py-1.5 text-xs font-medium text-foreground hover:bg-accent"
        >
          Ativar
        </button>
      </div>
    );
  }

  // No session AND no resolvable pane cwd: nothing honest to draw yet.
  if (!pick.session && !focusedCwd) {
    return (
      <LeftPanelEmpty
        title="Nenhuma sessão para seguir"
        hint={WHY_TEXT[pick.why]}
      />
    );
  }

  return (
    <div className="relative flex h-full min-h-0 flex-col bg-[#07090f]">
      <Suspense fallback={<div className="flex-1" />}>
        <MindCanvas feed={feed} />
      </Suspense>
      <div className="absolute top-2 right-2 z-20 flex flex-col items-end gap-1">
        <button
          type="button"
          onClick={() => setListOpen((v) => !v)}
          className="rounded border border-slate-700/60 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
        >
          sessões{recent.length > 0 ? ` (${recent.length})` : ""}
        </button>
        {listOpen ? (
          <div className="max-h-[45%] w-[240px] overflow-y-auto rounded border border-slate-700/60 bg-slate-950/95 p-1 text-[10px] text-slate-300 shadow">
            {recent.length === 0 ? (
              <p className="px-2 py-1 text-slate-500">
                nenhuma sessão recente neste local
              </p>
            ) : (
              recent.map((r) => (
                <button
                  key={r.session_id}
                  type="button"
                  onClick={() => {
                    setManualSession(r.session_id);
                    setListOpen(false);
                  }}
                  className={`block w-full truncate rounded px-2 py-1 text-left hover:bg-slate-800 ${
                    r.session_id === pick.session ? "text-emerald-400" : ""
                  }`}
                >
                  {r.session_id.slice(0, 8)} · {ageLabel(r.mtime_ms)}
                </button>
              ))
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
