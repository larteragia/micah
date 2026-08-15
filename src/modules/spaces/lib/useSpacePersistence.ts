import { useCallback, useEffect, useRef } from "react";
import type { Tab } from "@/modules/tabs";
import { paneActiveIndexes, serializeTabs } from "./serialize";
import { saveState, type SpaceState } from "./store";
import { useSpaces } from "./useSpaces";

const DEBOUNCE_MS = 3000;

type Snapshot = {
  tabs: Tab[];
  activeId: number;
  activeLeftId: number | null;
  activeSpaceId: string;
};

type Params = Snapshot & {
  /** Gate writes until boot hydration finished, so restore never round-trips. */
  enabled: boolean;
};

type ByPane = NonNullable<SpaceState["activeTabIndexByPane"]>;

type LastWrite = {
  json: string;
  activeTabIndex: number;
  byPane: ByPane | undefined;
};

export function useSpacePersistence({
  tabs,
  activeId,
  activeLeftId,
  activeSpaceId,
  enabled,
}: Params) {
  const last = useRef<Map<string, LastWrite>>(new Map());
  const seeded = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latest = useRef<Snapshot>({ tabs, activeId, activeLeftId, activeSpaceId });
  latest.current = { tabs, activeId, activeLeftId, activeSpaceId };

  // Seed each space's last-known active index from disk so the first flush
  // preserves it for spaces the user never opens (empty json forces one write
  // with the correct index rather than clobbering it to 0).
  if (enabled && !seeded.current) {
    seeded.current = true;
    const { initialActiveIndex, initialActiveByPane } = useSpaces.getState();
    for (const [id, idx] of Object.entries(initialActiveIndex)) {
      last.current.set(id, {
        json: "",
        activeTabIndex: idx,
        byPane: initialActiveByPane[id],
      });
    }
  }

  const flush = useCallback((snap: Snapshot) => {
    const groups = new Map<string, Tab[]>();
    for (const t of snap.tabs) {
      const arr = groups.get(t.spaceId);
      if (arr) arr.push(t);
      else groups.set(t.spaceId, [t]);
    }

    for (const [spaceId, group] of groups) {
      const serialized = serializeTabs(group);
      const prev = last.current.get(spaceId);
      let activeTabIndex = prev?.activeTabIndex ?? 0;
      // Background spaces carry their last-known per-pane indexes forward
      // (seeded from disk): saveState replaces the whole key, so leaving the
      // field out of the literal would silently erase it.
      let byPane: ByPane | undefined = prev?.byPane;
      if (spaceId === snap.activeSpaceId) {
        const ix = paneActiveIndexes(group, snap.activeId, snap.activeLeftId);
        if (ix.legacy >= 0) activeTabIndex = ix.legacy;
        byPane = {
          ...(ix.workspace >= 0 && { workspace: ix.workspace }),
          ...(ix.left >= 0 && { left: ix.left }),
        };
      }
      const json = JSON.stringify(serialized);
      const byPaneJson = JSON.stringify(byPane ?? null);
      if (
        prev &&
        prev.json === json &&
        prev.activeTabIndex === activeTabIndex &&
        JSON.stringify(prev.byPane ?? null) === byPaneJson
      ) {
        continue;
      }
      last.current.set(spaceId, { json, activeTabIndex, byPane });
      void saveState(spaceId, {
        tabs: serialized,
        activeTabIndex,
        ...(byPane && { activeTabIndexByPane: byPane }),
      });
    }
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const snap: Snapshot = { tabs, activeId, activeLeftId, activeSpaceId };
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      flush(snap);
    }, DEBOUNCE_MS);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [tabs, activeId, activeLeftId, activeSpaceId, enabled, flush]);

  useEffect(() => {
    if (!enabled) return;
    const onHidden = () => {
      if (document.visibilityState === "hidden") flush(latest.current);
    };
    const onLeave = () => flush(latest.current);
    document.addEventListener("visibilitychange", onHidden);
    window.addEventListener("blur", onLeave);
    window.addEventListener("beforeunload", onLeave);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      window.removeEventListener("blur", onLeave);
      window.removeEventListener("beforeunload", onLeave);
      flush(latest.current);
    };
  }, [enabled, flush]);
}
