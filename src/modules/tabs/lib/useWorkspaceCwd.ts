import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Tab } from "./useTabs";

type Result = {
  explorerRoot: string | null;
  inheritedCwdForNewTab: () => string | undefined;
  setExplorerRootOverride: (path: string | null) => void;
};

export function useWorkspaceCwd(
  activeTab: Tab | undefined,
  tabs: Tab[],
  home: string | null,
): Result {
  const lastTerminalCwd = useRef<string | null>(null);
  // Manual root pin (breadcrumb root switcher while the shell is busy). A
  // fresh cwd from the active terminal supersedes it.
  const [rootOverride, setRootOverride] = useState<string | null>(null);

  const activeTerminalCwd =
    activeTab?.kind === "terminal" ? (activeTab.cwd ?? null) : null;
  const lastSeenCwd = useRef<string | null>(activeTerminalCwd);

  useEffect(() => {
    if (activeTab?.kind === "terminal" && activeTab.cwd) {
      lastTerminalCwd.current = activeTab.cwd;
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTerminalCwd && activeTerminalCwd !== lastSeenCwd.current) {
      setRootOverride(null);
    }
    lastSeenCwd.current = activeTerminalCwd;
  }, [activeTerminalCwd]);

  const explorerRoot = useMemo<string | null>(() => {
    if (rootOverride) return rootOverride;
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    if (lastTerminalCwd.current) return lastTerminalCwd.current;
    const anyTerm = tabs.find((t) => t.kind === "terminal" && t.cwd);
    if (anyTerm?.kind === "terminal" && anyTerm.cwd) return anyTerm.cwd;
    return home;
  }, [rootOverride, activeTab, tabs, home]);

  const inheritedCwdForNewTab = useCallback((): string | undefined => {
    // A pinned root is where the user is looking; new tabs should open there.
    if (rootOverride) return rootOverride;
    if (activeTab?.kind === "terminal" && activeTab.cwd) return activeTab.cwd;
    // Editor tabs inherit the last terminal's cwd (or workspace home), not
    // the file's folder — opening a new terminal from a file shouldn't
    // hijack the user's working directory context.
    return lastTerminalCwd.current ?? home ?? undefined;
  }, [rootOverride, activeTab, home]);

  return {
    explorerRoot,
    inheritedCwdForNewTab,
    setExplorerRootOverride: setRootOverride,
  };
}
