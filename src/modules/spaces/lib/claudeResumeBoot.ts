import {
  isClaudeSessionId,
  queueClaudeResume,
} from "@/modules/terminal/lib/claudeResume";
import {
  isLeaf,
  type PaneNode,
  setLeafResume,
} from "@/modules/terminal/lib/panes";
import type { Tab } from "@/modules/tabs";
import { invoke } from "@tauri-apps/api/core";

export type ResumeLeaf = {
  leafId: number;
  spaceId: string;
  sessionId: string;
};

export function collectResumeLeaves(tabs: Tab[]): ResumeLeaf[] {
  const out: ResumeLeaf[] = [];
  const walk = (n: PaneNode, spaceId: string) => {
    if (isLeaf(n)) {
      if (isClaudeSessionId(n.resume)) {
        out.push({ leafId: n.id, spaceId, sessionId: n.resume });
      }
      return;
    }
    for (const c of n.children) walk(c, spaceId);
  };
  for (const t of tabs) {
    if (t.kind === "terminal") walk(t.paneTree, t.spaceId);
  }
  return out;
}

export function dropResumeLeaves(
  tabs: Tab[],
  deadLeafIds: ReadonlySet<number>,
): Tab[] {
  if (deadLeafIds.size === 0) return tabs;
  return tabs.map((t) => {
    if (t.kind !== "terminal") return t;
    let paneTree = t.paneTree;
    for (const leafId of deadLeafIds) {
      paneTree = setLeafResume(paneTree, leafId, null);
    }
    return paneTree === t.paneTree ? t : { ...t, paneTree };
  });
}

/** Claude Code prunes old transcripts on its own schedule; an anchored id
 * whose `<uuid>.jsonl` vanished would replay a guaranteed error into the
 * shell. The check is a local glob, so a missing home directory or a glob
 * failure keeps the anchor (worst case is a harmless exit-1 resume). */
async function transcriptAlive(
  sessionId: string,
  home: string,
): Promise<boolean> {
  try {
    const res = await invoke<{ hits: unknown[] }>("fs_glob", {
      pattern: `**/${sessionId.toLowerCase()}.jsonl`,
      root: `${home}/.claude/projects`,
      maxResults: 1,
      workspace: null,
    });
    return res.hits.length > 0;
  } catch (e) {
    // No projects dir means no transcripts at all: everything is stale.
    return !String(e).includes("not a directory");
  }
}

/**
 * Boot step: prune anchors whose transcript is gone, queue the survivors for
 * injection on first tab activation, and return the (possibly pruned) tabs.
 * Panes in non-local (WSL) spaces skip the prune: their transcripts live in
 * the distro's filesystem, out of reach of a local glob.
 */
export async function prepareClaudeResumes(
  tabs: Tab[],
  home: string | null,
  isLocalSpace: (spaceId: string) => boolean,
): Promise<Tab[]> {
  const leaves = collectResumeLeaves(tabs);
  if (leaves.length === 0) return tabs;

  const dead = new Set<number>();
  if (home) {
    const localIds = [
      ...new Set(
        leaves.filter((l) => isLocalSpace(l.spaceId)).map((l) => l.sessionId),
      ),
    ];
    const alive = new Map<string, boolean>();
    await Promise.all(
      localIds.map(async (id) => {
        alive.set(id, await transcriptAlive(id, home));
      }),
    );
    for (const l of leaves) {
      if (alive.get(l.sessionId) === false) dead.add(l.leafId);
    }
  }

  for (const l of leaves) {
    if (!dead.has(l.leafId)) queueClaudeResume(l.leafId, l.sessionId);
  }
  return dropResumeLeaves(tabs, dead);
}
