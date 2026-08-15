import { native } from "@/modules/ai/lib/native";
import { usePreferencesStore } from "@/modules/settings/preferences";
import type { Tab } from "@/modules/tabs";
import { DEFAULT_SPACE_ID, tabPane } from "@/modules/tabs/lib/useTabs";
import { isLeaf, type PaneNode } from "@/modules/terminal/lib/panes";
import { parseWorkspaceScopeKey, type WorkspaceEnv } from "@/modules/workspace";
import { useEffect, useRef } from "react";
import { activeSpaceEnv, freshTabCwd } from "./activeSpace";
import { prepareClaudeResumes } from "./claudeResumeBoot";
import { freshTerminalTab, hydrateTabs } from "./serialize";
import { loadAll, type SpaceMeta, saveActiveId, saveSpacesList } from "./store";
import { useSpaces } from "./useSpaces";

type Params = {
  ready: boolean;
  launchCwd: string | null;
  home: string | null;
  allocId: () => number;
  replaceTabs: (
    tabs: Tab[],
    activeId: number,
    leftActiveId?: number | null,
  ) => void;
  markBooted: () => void;
  setActiveSpaceForNewTabs: (id: string) => void;
  adoptWorkspaceEnv: (env: WorkspaceEnv) => Promise<string | null>;
};

function uniqueCwds(tabs: Tab[]): string[] {
  const set = new Set<string>();
  const walk = (n: PaneNode) => {
    if (isLeaf(n)) {
      if (n.cwd) set.add(n.cwd);
      return;
    }
    for (const c of n.children) walk(c);
  };
  for (const t of tabs) if (t.kind === "terminal") walk(t.paneTree);
  return [...set];
}

export function useSpacesBoot({
  ready,
  launchCwd,
  home,
  allocId,
  replaceTabs,
  markBooted,
  setActiveSpaceForNewTabs,
  adoptWorkspaceEnv,
}: Params) {
  const done = useRef(false);

  useEffect(() => {
    if (!ready || done.current) return;
    done.current = true;

    void (async () => {
      try {
        const { spaces, activeId, states } = await loadAll();

        if (spaces.length === 0) {
          const root = launchCwd ?? home ?? null;
          // Hydrate prefs before reading the saved workspace env.
          await usePreferencesStore
            .getState()
            .init()
            .catch(() => {});
          const meta: SpaceMeta = {
            id: DEFAULT_SPACE_ID,
            name: "Default",
            root,
            env: parseWorkspaceScopeKey(
              usePreferencesStore.getState().defaultWorkspaceEnv,
            ),
            createdAt: Date.now(),
            updatedAt: Date.now(),
          };
          await saveSpacesList([meta]);
          await saveActiveId(DEFAULT_SPACE_ID);
          setActiveSpaceForNewTabs(DEFAULT_SPACE_ID);
          useSpaces.getState().hydrate([meta], DEFAULT_SPACE_ID);
          return;
        }

        const restored: Tab[] = [];
        for (const space of spaces) {
          const st = states.get(space.id);
          if (!st) continue;
          restored.push(...hydrateTabs(st.tabs, space.id, allocId));
        }

        const active =
          activeId && spaces.some((s) => s.id === activeId)
            ? activeId
            : spaces[0].id;
        setActiveSpaceForNewTabs(active);

        // Apply the space's env+home before the fresh-tab fallback and spawns
        // below; env is set synchronously so cwd resolution picks WSL vs local.
        const env = activeSpaceEnv(spaces, active);
        const restoredHome = await adoptWorkspaceEnv(env);

        // The active space's WORKSPACE strip must never be empty, else the
        // center shows nothing; left-panel tabs alone do not satisfy this.
        if (
          !restored.some(
            (t) => t.spaceId === active && tabPane(t) === "workspace",
          )
        ) {
          const cwd = freshTabCwd(env, restoredHome, launchCwd, home);
          restored.push(freshTerminalTab(active, cwd, allocId));
        }

        await Promise.allSettled(
          uniqueCwds(restored).map((cwd) => native.workspaceAuthorize(cwd)),
        );

        // Prune dead Claude anchors and queue live ones for injection on
        // first activation. Pref off degrades to today's shell-only restore.
        await usePreferencesStore
          .getState()
          .init()
          .catch(() => {});
        let tabsToMount = restored;
        if (usePreferencesStore.getState().resumeClaudeTabs) {
          try {
            tabsToMount = await prepareClaudeResumes(restored, home, (id) => {
              const env = spaces.find((s) => s.id === id)?.env;
              return !env || env.kind === "local";
            });
          } catch (e) {
            console.warn("[micah] claude resume prep failed:", e);
          }
        }

        const initialActiveIndex: Record<string, number> = {};
        const initialActiveByPane: Record<
          string,
          { workspace?: number; left?: number }
        > = {};
        for (const [id, st] of states) {
          initialActiveIndex[id] = st.activeTabIndex;
          if (st.activeTabIndexByPane)
            initialActiveByPane[id] = st.activeTabIndexByPane;
        }
        useSpaces
          .getState()
          .hydrate(spaces, active, initialActiveIndex, initialActiveByPane);

        const st = states.get(active);
        const inActive = tabsToMount.filter((t) => t.spaceId === active);
        const wsInActive = inActive.filter((t) => tabPane(t) === "workspace");
        const leftInActive = inActive.filter((t) => tabPane(t) === "left");
        // Pane-split index first; the legacy index (which counts both panes,
        // and in pre-pane files is the only one) as fallback. Whatever it
        // resolves to, the center's active tab must be a workspace tab.
        const wIdx = st?.activeTabIndexByPane?.workspace;
        const legacyPick = inActive[st?.activeTabIndex ?? 0];
        const activeTab =
          (wIdx !== undefined ? wsInActive[wIdx] : undefined) ??
          (legacyPick && tabPane(legacyPick) === "workspace"
            ? legacyPick
            : undefined) ??
          wsInActive[0] ??
          tabsToMount.find((t) => tabPane(t) === "workspace") ??
          tabsToMount[0];
        const lIdx = st?.activeTabIndexByPane?.left;
        const leftActive =
          (lIdx !== undefined ? leftInActive[lIdx] : undefined) ??
          leftInActive[leftInActive.length - 1] ??
          null;
        replaceTabs(tabsToMount, activeTab.id, leftActive?.id ?? null);
      } catch (e) {
        console.error("[micah] spaces boot failed:", e);
      } finally {
        markBooted();
      }
    })();
  }, [
    ready,
    launchCwd,
    home,
    allocId,
    replaceTabs,
    markBooted,
    setActiveSpaceForNewTabs,
    adoptWorkspaceEnv,
  ]);
}
