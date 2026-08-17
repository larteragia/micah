/**
 * Micah's Mind scene: the repository as a night city of luminous dots the
 * agent touched, navigable with mouse or touch, following the Claude
 * session of the focused pane in real time. Canvas 2D only: no new
 * dependency (LEI ZERO) and no WebGL context (renderer pool stays at 5).
 */

import { LeftPanelEmpty } from "@/modules/left-panel/LeftPanelEmpty";
import {
  readAiViewerActive,
  writeAiViewerActive,
} from "@/modules/left-panel/lib/activation";
import { lazy, Suspense, useMemo, useState } from "react";
import {
  type MindSessionPick,
  pickMindSession,
  useMindFeed,
} from "./lib/useMindFeed";

const MindCanvas = lazy(() =>
  import("./MindCanvas").then((m) => ({ default: m.MindCanvas })),
);

export type AnchoredLeaf = { leafId: number; resume: string };

const WHY_TEXT: Record<MindSessionPick["why"], string> = {
  "focused-leaf": "pane em foco",
  "single-anchored": "única pane ancorada",
  ambiguous: "mais de uma pane ancorada; clique numa delas",
  none: "nenhuma sessão ancorada nesta aba",
};

export function MicahsMindArea({
  resolveLeafResume,
  anchoredLeaves,
  visibleLeafIds,
  activeLeafId,
}: {
  resolveLeafResume?: (leafId: number) => string | null;
  anchoredLeaves?: AnchoredLeaf[];
  visibleLeafIds?: number[];
  activeLeafId?: number | null;
}) {
  const [active, setActive] = useState(readAiViewerActive);

  const pick = useMemo(
    () =>
      pickMindSession({
        activeLeafId,
        resolveLeafResume,
        anchoredLeaves,
        visibleLeafIds,
      }),
    [activeLeafId, resolveLeafResume, anchoredLeaves, visibleLeafIds],
  );

  const feed = useMindFeed(pick, active);

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

  if (!pick.session) {
    return (
      <LeftPanelEmpty
        title="Nenhuma sessão para seguir"
        hint={WHY_TEXT[pick.why]}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#07090f]">
      <Suspense fallback={<div className="flex-1" />}>
        <MindCanvas feed={feed} />
      </Suspense>
    </div>
  );
}
