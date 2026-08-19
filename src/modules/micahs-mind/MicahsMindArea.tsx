/**
 * Micah's Mind (modo ai-viewer): the REAL mindwalk UI — rail of sessions,
 * night map, timeline — served by the local sidecar and shown in a native
 * child webview positioned over this panel (card mindwalk-real, E4). The
 * homemade Canvas 2D renderer is gone from this path (files die in E5).
 *
 * What stays is the session plumbing, now the webview's remote control:
 * the Ativar gate, the auto-connect for anchorless panes, the manual
 * session selector and the provenance badges. Priority is unchanged: a
 * real anchor beats a manual choice, a manual choice beats auto-connect.
 *
 * Layout note: the native webview paints above ALL HTML and ignores
 * z-index, so the chrome (badges + selector) lives in a header strip
 * OUTSIDE the webview's rectangle, and the selector dropdown hides the
 * webview while open (suppression inside useMindView).
 */

import {
  readAiViewerActive,
  writeAiViewerActive,
} from "@/modules/left-panel/lib/activation";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  type MindSessionPick,
  composePick,
  pickMindSession,
} from "./lib/useMindFeed";
import { useMindView } from "./lib/useMindView";

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

/**
 * Elapsed seconds since `startedAt`, for the honest handshake spinner.
 * A 1s UI clock, not a data refresh: live-follow belongs to the fork's
 * own UI (?follow=1, plan decision 9).
 */
function useElapsedSeconds(startedAt: number | null): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (startedAt === null) return;
    setNow(Date.now());
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [startedAt]);
  return startedAt === null
    ? 0
    : Math.max(0, Math.floor((now - startedAt) / 1000));
}

function Spinner() {
  return (
    <div
      aria-hidden
      className="size-4 animate-spin rounded-full border-2 border-slate-600 border-t-slate-200"
    />
  );
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
  const [auto, setAuto] = useState<{
    session: string | null;
    forCwd: string;
  } | null>(null);
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

  // Repo smell gate (auditor 2): the auto-connect only scopes to a cwd
  // that looks like a project root; an arbitrary folder (the user's home,
  // a drive) goes global instead of pretending to be a project.
  const [scannable, setScannable] = useState<boolean | null>(null);
  useEffect(() => {
    if (!focusedCwd) {
      setScannable(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        const entries = await invoke<{ name: string }[]>("fs_read_dir", {
          path: focusedCwd,
          showHidden: true,
        });
        if (!alive) return;
        const markers = [
          ".git",
          ".hg",
          ".svn",
          "package.json",
          "Cargo.toml",
          "go.mod",
          "pyproject.toml",
          "deno.json",
          "pnpm-workspace.yaml",
        ];
        setScannable(entries.some((e) => markers.includes(e.name)));
      } catch {
        if (!alive) return;
        setScannable(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [focusedCwd]);

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

  // Auto-connect, once per pane context: only when nothing is anchored and
  // nothing was manually chosen. A project-looking cwd scopes to its own
  // location tree; anything else — a non-project folder OR a pane with no
  // known cwd (no OSC 7 yet) — goes global: the freshest session anywhere
  // beats an empty panel, and the replay badge keeps the provenance honest.
  const autoKey = focusedCwd ?? "";
  useEffect(() => {
    if (manualSession || anchoredPick.session) return;
    if (auto?.forCwd === autoKey) return;
    if (focusedCwd !== null && scannable === null) return;
    let alive = true;
    void (async () => {
      try {
        const res = await invoke<RecentSession[]>("claude_sessions_recent", {
          cwd: scannable ? focusedCwd : null,
          limit: 5,
        });
        if (!alive) return;
        // A repo with no sessions of its own gets no auto-connect, but the
        // picker still offers the freshest sessions anywhere: one click
        // connects instead of an empty panel.
        if (res.length === 0 && scannable) {
          const globalRes = await invoke<RecentSession[]>(
            "claude_sessions_recent",
            { cwd: null, limit: 5 },
          );
          if (!alive) return;
          setRecent(globalRes);
        } else {
          setRecent(res);
        }
        setAuto({
          session: res[0]?.session_id ?? null,
          forCwd: autoKey,
        });
      } catch {
        if (!alive) return;
        setAuto({ session: null, forCwd: autoKey });
      }
    })();
    return () => {
      alive = false;
    };
  }, [
    autoKey,
    focusedCwd,
    scannable,
    manualSession,
    anchoredPick.session,
    auto?.forCwd,
  ]);

  const view = useMindView({
    enabled: active,
    session: pick.session,
    menuOpen: listOpen,
  });
  const waitedS = useElapsedSeconds(view.waitStartedAt);

  // Provenance badge: a replayed session must never read as "ao vivo"
  // (auditor 1, criterion 2).
  const sessionBadge = useMemo(() => {
    if (!pick.session) return null;
    if (pick.why === "focused-leaf" || pick.why === "single-anchored")
      return null;
    const mtime =
      recent.find((r) => r.session_id === pick.session)?.mtime_ms ?? null;
    const age = mtime != null ? ` · ${ageLabel(mtime)}` : "";
    if (pick.why === "manual") return { text: `escolhida${age}` };
    return { text: `replay${age}` };
  }, [pick, recent]);

  // Discreet sidecar badge whenever the webview is not the thing on screen.
  const sidecarBadge = useMemo(() => {
    const restarts = view.status?.restarts ?? 0;
    const suffix = restarts > 0 ? ` · religado ×${restarts}` : "";
    // A failed attach must not read as "varrendo…" forever: the center
    // screen explains, the badge agrees.
    if (view.attachError) return `webview falhou${suffix}`;
    switch (view.phase) {
      case "sidecar-starting":
        return `mindwalk subindo…${suffix}`;
      case "session-waiting":
        return `varrendo… ${waitedS}s${suffix}`;
      case "dead":
        return `mindwalk morto${suffix}`;
      case "session-absent":
        return "sem sessão";
      default:
        return null;
    }
  }, [view.phase, view.status, view.attachError, waitedS]);

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
            Ativar sobe o mindwalk local e conecta à sessão Claude Code da pane
            em foco: o mapa noturno do repositório, o rail de sessões e a
            timeline reais, seguindo a AI ao vivo. Somente leitura.
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

  // The session the plumbing picked exists but is not a uuid: the webview
  // must never be navigated to it (plan decision 3) — say so.
  const invalidPick = pick.session !== null && view.session === null;

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#07090f]">
      {/* Chrome strip OUTSIDE the webview rect: always visible, always
          clickable, whatever the native layer is doing below. */}
      <div className="relative z-10 flex h-8 shrink-0 items-center gap-2 border-b border-slate-800/60 px-2">
        {sessionBadge ? (
          <span className="rounded bg-slate-800/80 px-1.5 py-0.5 text-[10px] text-amber-300/90">
            {sessionBadge.text}
          </span>
        ) : null}
        {sidecarBadge ? (
          <span className="rounded bg-slate-800/60 px-1.5 py-0.5 text-[10px] text-slate-400">
            {sidecarBadge}
          </span>
        ) : null}
        <div className="relative ml-auto">
          <button
            type="button"
            onClick={() => setListOpen((v) => !v)}
            className="rounded border border-slate-700/60 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
          >
            sessões{recent.length > 0 ? ` (${recent.length})` : ""}
          </button>
          {listOpen ? (
            <div className="absolute top-full right-0 z-20 mt-1 max-h-[45vh] w-[240px] overflow-y-auto rounded border border-slate-700/60 bg-slate-950/95 p-1 text-[10px] text-slate-300 shadow">
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
      <div className="relative min-h-0 flex-1">
        {/* The native mindwalk webview covers exactly this div when the
            machine reaches "ready"; every other phase keeps it hidden so
            the state UI below is really what the user sees. */}
        <div ref={view.hostRef} className="absolute inset-0" />
        {view.phase !== "ready" ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-6 text-center">
            {view.phase === "sidecar-starting" ? (
              <>
                <Spinner />
                <p className="text-xs text-slate-400">subindo o mindwalk…</p>
              </>
            ) : null}
            {view.phase === "session-waiting" ? (
              view.attachError ? (
                <>
                  <p className="text-xs text-amber-300/90">
                    o mindwalk respondeu, mas o webview não abriu
                  </p>
                  <p className="max-w-[36ch] break-words text-[10px] text-slate-500">
                    {view.attachError}
                  </p>
                  <button
                    type="button"
                    onClick={view.relight}
                    className="rounded border border-slate-700/60 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
                  >
                    Tentar de novo
                  </button>
                </>
              ) : (
                <>
                  <Spinner />
                  <p className="text-xs text-slate-400">
                    varrendo a sessão… {waitedS}s
                  </p>
                  <p className="max-w-[40ch] text-[10px] leading-relaxed text-slate-500">
                    sem barra de progresso porque não existe uma honesta: a
                    primeira varredura de um diretório grande pode levar
                    minutos; as próximas são instantâneas
                  </p>
                </>
              )
            ) : null}
            {view.phase === "session-absent" ? (
              <>
                <p className="text-xs font-medium text-slate-300">
                  Nenhuma sessão para seguir
                </p>
                <p className="max-w-[40ch] text-[10px] leading-relaxed text-slate-500">
                  {invalidPick
                    ? "a sessão apontada não tem um id uuid válido"
                    : WHY_TEXT[pick.why]}
                </p>
              </>
            ) : null}
            {view.phase === "dead" ? (
              <>
                <p className="text-xs font-medium text-amber-300/90">
                  o mindwalk caiu
                </p>
                {view.status?.lastError ? (
                  <p className="max-w-[40ch] break-words text-[10px] leading-relaxed text-slate-500">
                    {view.status.lastError}
                  </p>
                ) : null}
                <button
                  type="button"
                  onClick={view.relight}
                  className="rounded border border-slate-700/60 bg-slate-900/80 px-2 py-1 text-[10px] text-slate-300 hover:bg-slate-800"
                >
                  Religar
                </button>
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
