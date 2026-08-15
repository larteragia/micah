import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { LazyStore } from "@tauri-apps/plugin-store";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  type Bookmark,
  type HistoryEntry,
  pushHistory,
  redactUrl,
  removeBookmark,
  sanitizeBookmarks,
  sanitizeHistory,
  titleHistory,
  upsertBookmark,
} from "./collections";

/**
 * Two files on purpose: history gets an append per navigation and the store
 * plugin rewrites the whole file per save, so it must not share a file with
 * bookmark icons. Writer rule: only the main window mutates these stores.
 */
const bookmarksStore = new LazyStore("micah-browser-bookmarks.json", {
  defaults: {},
  autoSave: 500,
});
const historyStore = new LazyStore("micah-browser-history.json", {
  defaults: {},
  // History is flushed by our own debounce; autoSave would double every write.
  autoSave: false,
});

const HISTORY_FLUSH_MS = 1500;

export type PageInfo = {
  url: string | null;
  title: string | null;
  favicon_png_base64: string | null;
};

export type ExtensionInfo = {
  id: string;
  name: string;
  enabled: boolean;
};

/**
 * Bookmarks and history state for the browser panel. Navigation flows in from
 * two sides — the COM events (Windows, push) and the caller via `record`
 * (the URL poll, cross-platform pull) — and both meet the same reducer, whose
 * coalescing makes the double feed harmless.
 */
export function useBrowserCollections(enabled: boolean) {
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const historyRef = useRef(history);
  historyRef.current = history;
  const flushTimer = useRef(0);
  const dirtyRef = useRef(false);

  // Hydrate once. Junk in either file is dropped by the sanitizers rather
  // than crashing the panel: a corrupted store must degrade to empty, loudly
  // in the log, never to a dead browser.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (async () => {
      try {
        const [rawBookmarks, rawHistory] = await Promise.all([
          bookmarksStore.get("bookmarks"),
          historyStore.get("entries"),
        ]);
        if (!alive) return;
        setBookmarks(sanitizeBookmarks(rawBookmarks));
        setHistory(sanitizeHistory(rawHistory));
      } catch (e) {
        console.warn("browser: could not load bookmark/history stores", e);
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled]);

  const scheduleFlush = useCallback(() => {
    dirtyRef.current = true;
    if (flushTimer.current) window.clearTimeout(flushTimer.current);
    flushTimer.current = window.setTimeout(() => {
      flushTimer.current = 0;
      dirtyRef.current = false;
      void historyStore
        .set("entries", historyRef.current)
        .then(() => historyStore.save())
        .catch(() => {});
    }, HISTORY_FLUSH_MS);
  }, []);

  // The debounce loses its tail if the app closes inside the window; flush on
  // teardown and on tab-hide, which covers detach, mode switch and app exit.
  useEffect(() => {
    if (!enabled) return;
    const flush = () => {
      if (!dirtyRef.current) return;
      dirtyRef.current = false;
      void historyStore
        .set("entries", historyRef.current)
        .then(() => historyStore.save())
        .catch(() => {});
    };
    document.addEventListener("visibilitychange", flush);
    return () => {
      document.removeEventListener("visibilitychange", flush);
      flush();
    };
  }, [enabled]);

  const record = useCallback(
    (url: string) => {
      setHistory((prev) => {
        const next = pushHistory(prev, url, Date.now());
        if (next.length !== prev.length || next !== prev) scheduleFlush();
        return next;
      });
    },
    [scheduleFlush],
  );

  // Push-based navigation and title backfill from the COM events (Windows).
  useEffect(() => {
    if (!enabled) return;
    const subs: Promise<UnlistenFn>[] = [
      listen<{ url: string }>("micah:browser-nav", (e) => {
        record(e.payload.url);
      }),
      listen<{ url: string; title: string }>("micah:browser-title", (e) => {
        setHistory((prev) => titleHistory(prev, e.payload.url, e.payload.title));
        scheduleFlush();
      }),
    ];
    return () => {
      for (const sub of subs) void sub.then((un) => un());
    };
  }, [enabled, record, scheduleFlush]);

  const persistBookmarks = useCallback((next: Bookmark[]) => {
    setBookmarks(next);
    void bookmarksStore.set("bookmarks", next).catch(() => {});
  }, []);

  /** Reads url+title+icon in ONE Rust round-trip (never the polled UI state,
   *  which can be a navigation behind), then upserts. */
  const addBookmarkFromCurrentPage = useCallback(async (): Promise<
    Bookmark | null
  > => {
    const info = await invoke<PageInfo>("browser_page_info");
    if (!info.url) return null;
    const next = upsertBookmark(bookmarks, {
      url: info.url,
      title: info.title,
      iconPng: info.favicon_png_base64,
    });
    persistBookmarks(next);
    const saved = redactUrl(info.url);
    return next.find((b) => b.url === saved) ?? null;
  }, [bookmarks, persistBookmarks]);

  const deleteBookmark = useCallback(
    (id: string) => {
      persistBookmarks(removeBookmark(bookmarks, id));
    },
    [bookmarks, persistBookmarks],
  );

  return {
    bookmarks,
    history,
    record,
    addBookmarkFromCurrentPage,
    deleteBookmark,
  };
}
