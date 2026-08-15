import {
  claudeResumeCommand,
  clearClaudeResume,
  peekClaudeResume,
} from "@/modules/terminal/lib/claudeResume";
import { leafIds } from "@/modules/terminal/lib/panes";
import {
  submitToLeaf,
  whenSessionReady,
  writeToSession,
} from "@/modules/terminal/lib/useTerminalSession";
import { useEffect } from "react";
import type { Tab } from "./useTabs";

const inFlight = new Set<number>();

async function inject(leafId: number, blocks: boolean): Promise<void> {
  await whenSessionReady(leafId, 8000);
  const sessionId = peekClaudeResume(leafId);
  if (sessionId === null) return;
  clearClaudeResume(leafId);
  const cmd = claudeResumeCommand(sessionId);
  if (cmd === null) return;
  // Block tabs go through the block machine; the grid types straight in.
  if (blocks) submitToLeaf(leafId, cmd);
  else writeToSession(leafId, `${cmd}\r`);
}

/** Replays `claude --resume <id>` into a restored pane the first time its tab
 * warms (cold -> active): the pane is visible, its session-ready gate is real,
 * and nothing is warmed eagerly at boot. The queue is filled once by the
 * spaces boot; the inFlight guard makes each leaf a single shot. */
export function useClaudeResumeInjection(tabs: Tab[]): void {
  useEffect(() => {
    for (const t of tabs) {
      if (t.kind !== "terminal" || t.cold) continue;
      for (const leafId of leafIds(t.paneTree)) {
        if (peekClaudeResume(leafId) === null || inFlight.has(leafId)) continue;
        inFlight.add(leafId);
        void inject(leafId, Boolean(t.blocks));
      }
    }
  }, [tabs]);
}
