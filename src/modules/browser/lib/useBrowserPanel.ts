import { IS_WINDOWS } from "@/lib/platform";
import { invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useReducer, useRef, useState } from "react";
import type { PanelImperativeHandle } from "react-resizable-panels";
import {
  type Bounds,
  isRenderableRect,
  readAppZoom,
  rectToBounds,
  sameBounds,
  zoomScaleFor,
} from "./bounds";
import { redactUrl } from "./collections";
import {
  EMPTY_SUPPRESSION,
  isSuppressed,
  overlaps,
  OVERLAY_SELECTORS,
  type OverlaySource,
  suppressionReason,
  suppressionReducer,
} from "./suppression";

export const BROWSER_DEFAULT_WIDTH = 560;
export const BROWSER_MIN_WIDTH = 320;
export const BROWSER_MAX_WIDTH = 1600;
export const BROWSER_HOME = "https://search.brave.com";

/**
 * v9 discards every width written before the degenerate-group guard existed.
 * The poisonings all shared one shape: some code read or wrote the width while
 * the panel group was not laid out at a believable size — the 800x600 bootstrap
 * window, a minimized window (the group collapses to ~150px), or a drag ending
 * over a half-restored layout. A width sampled there is garbage, and garbage
 * persisted once comes back on every launch. The fix (refusing to enforce or
 * persist against a degenerate group) cannot heal a value already on disk, so
 * the key version is the migration.
 */
const WIDTH_KEY = "micah.browser.width.v9";
/**
 * Below this, the group is not a real layout: the window's own minimum is
 * 860px while the panel exists, so anything narrower is the bootstrap window,
 * a minimized window, or a mid-restore frame. Widths must be neither enforced
 * against it (resize() converts px to a percentage of the group, so a 560px ask
 * against a 157px group stores a garbage percentage) nor persisted from it.
 */
const GROUP_SANE_MIN_WIDTH = 860;
const ENABLED_KEY = "micah.browser.enabled";
const URL_KEY = "micah.browser.url";
/** Reading back the webview's own URL is the only thing that catches pushState. */
const URL_POLL_MS = 700;
/** Attach retries: the first paint can measure a rect the layout has not settled. */
const ATTACH_RETRY_MS = 400;
const ATTACH_MAX_ATTEMPTS = 8;

export type CdpInfo = {
  schema: number;
  port: number;
  ws_endpoint: string;
  pid: number;
  started_at: number;
  window_label: string;
};

export type BrowserInfo = {
  window_label: string;
  webview_label: string;
  cdp: CdpInfo | null;
  cdp_error: string | null;
};

function clampWidth(width: number): number {
  return Math.min(
    BROWSER_MAX_WIDTH,
    Math.max(BROWSER_MIN_WIDTH, Math.round(width)),
  );
}

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // storage can fail in private mode; the panel still works this session
  }
}

export function readBrowserWidth(): number {
  const parsed = Number.parseInt(readStored(WIDTH_KEY) ?? "", 10);
  return Number.isFinite(parsed) ? clampWidth(parsed) : BROWSER_DEFAULT_WIDTH;
}

/**
 * Feature flag. Defaults to on for Windows and off everywhere else — the panel
 * renders on all platforms, but only WebView2 exposes CDP, and a browser the
 * agent cannot drive is not what this feature is for.
 *
 * The author's stated workflow is "I always work with the browser open", so
 * defaulting to off on Windows would mean re-enabling it on every install. The
 * flag exists for the rollback it guarantees, not to make the default cautious.
 */
export function readBrowserEnabled(): boolean {
  const stored = readStored(ENABLED_KEY);
  if (stored === "1") return true;
  if (stored === "0") return false;
  return IS_WINDOWS;
}

export function readBrowserUrl(): string {
  const stored = readStored(URL_KEY);
  return stored?.trim() ? stored : BROWSER_HOME;
}

/** Measure the placeholder in the coordinate space the native webview expects. */
function measure(host: HTMLElement): Bounds | null {
  const rect = host.getBoundingClientRect();
  if (!isRenderableRect(rect)) return null;
  const zoom = readAppZoom(
    getComputedStyle(document.documentElement).getPropertyValue("--app-zoom"),
  );
  // Calibrate against a full-width element *inside* the zoomed subtree.
  // `document.documentElement` is an ancestor of the zoom, so measuring it would
  // compare the viewport against itself and always answer "no scaling".
  const zoomHost = host.closest<HTMLElement>(".zoom-content");
  const scale = zoomScaleFor(
    zoomHost?.getBoundingClientRect().width ?? window.innerWidth,
    window.innerWidth,
    zoom,
  );
  return rectToBounds(rect, scale);
}

type Options = {
  /**
   * Whether the left panel that hosts this surface is on screen at all. The
   * width has to be asserted whenever the panel exists, including in the modes
   * that do not show the browser, or the panel resolves to no size and becomes
   * the elastic one.
   */
  mounted?: boolean;
  /**
   * Whether the panel's surface is the one currently on screen. False while the
   * left panel shows another mode, or while it is closed.
   *
   * This hides the webview, it does not detach it: detaching closes the child
   * webview and clears the CDP discovery file, so a Playwright client attached
   * to the panel would be dropped and the page's session lost every time the
   * user clicks another mode.
   */
  visible?: boolean;
};

export function useBrowserPanel({
  mounted = true,
  visible = true,
}: Options = {}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<PanelImperativeHandle | null>(null);
  const [enabled, setEnabledState] = useState(readBrowserEnabled);
  const [attached, setAttached] = useState(false);
  const [info, setInfo] = useState<BrowserInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState(readBrowserUrl);
  const [attempt, setAttempt] = useState(0);
  const [suppression, dispatchSuppression] = useReducer(
    suppressionReducer,
    EMPTY_SUPPRESSION,
  );

  const widthRef = useRef(readBrowserWidth());
  // A pixel size, not a percentage of the window. The window is created at
  // 800x600 and only restored to its real geometry after the first paint, so a
  // percentage sampled at mount is a percentage of the bootstrap window: 560 of
  // 800 is 70%, and the group keeps the percentage when it later widens, which
  // is how the panel ended up at its maximum width on every launch.
  const initialSize = `${widthRef.current}px`;
  const widthTimerRef = useRef(0);
  const lastBoundsRef = useRef<Bounds | null>(null);
  const lastUrlRef = useRef(url);
  const rafRef = useRef(0);
  const attachedRef = useRef(false);
  const attachingRef = useRef(false);
  const suppressedRef = useRef(false);
  const draggingRef = useRef(false);
  const pointerDownRef = useRef(false);

  const suppress = useCallback((source: OverlaySource) => {
    // Pressing the handle is not yet a drag. Persisting on pointerdown alone
    // means a plain click on the divider commits whatever width the panel
    // happens to have, which is how a bad layout used to become the stored one
    // and come back wider on every launch.
    if (source === "handle-drag") pointerDownRef.current = true;
    dispatchSuppression({ type: "suppress", source });
  }, []);
  const release = useCallback((source: OverlaySource) => {
    dispatchSuppression({ type: "release", source });
  }, []);

  /** The group's laid-out width, or 0 while the panel is not in the DOM. */
  const groupWidth = useCallback(
    () =>
      hostRef.current?.closest<HTMLElement>("[data-group]")?.offsetWidth ?? 0,
    [],
  );

  /**
   * Commit a width the user actually dragged to.
   *
   * This is deliberately not wired to the group's layout event. That event
   * reports `isUserInteraction` for passes no user caused, and every guard bolted
   * onto it leaked: a bad layout got stored, read back as the next session's
   * starting width, and the panel came back wrong on every launch. The end of the
   * gesture is the only moment that is unambiguously the user's.
   */
  const persistWidth = useCallback(
    (next: number) => {
      // A width read while the group is degenerate (minimized window,
      // mid-restore frame) is garbage, and persisted garbage comes back on
      // every launch. Refusing it here is what keeps the stored value clean.
      if (next <= 0 || groupWidth() < GROUP_SANE_MIN_WIDTH) return;
      widthRef.current = clampWidth(next);
      if (widthTimerRef.current) window.clearTimeout(widthTimerRef.current);
      widthTimerRef.current = window.setTimeout(() => {
        widthTimerRef.current = 0;
        writeStored(WIDTH_KEY, String(widthRef.current));
      }, 200);
    },
    [groupWidth],
  );

  const setEnabled = useCallback((next: boolean) => {
    writeStored(ENABLED_KEY, next ? "1" : "0");
    setEnabledState(next);
  }, []);

  /**
   * Drive the panel to the stored width and verify it got there.
   *
   * `resize("560px")` is open-loop: it converts pixels to a percentage against
   * panel measurements that can be one layout behind, so a single call can land
   * near the target instead of on it — that is where every 437/716/1313 in the
   * telemetry came from. Each kick therefore acts, re-reads on the next frame,
   * and acts again, up to a small bound. It stands down during a drag so it can
   * never fight the user, and it refuses to act against a degenerate group
   * (minimized window, bootstrap window), where the conversion is garbage.
   */
  const enforceFrameRef = useRef(0);
  const enforceWidth = useCallback(() => {
    let tries = 0;
    const tick = () => {
      const panel = panelRef.current;
      if (!panel || draggingRef.current) return;
      if (groupWidth() < GROUP_SANE_MIN_WIDTH) return;
      const target = widthRef.current;
      const size = panel.getSize().inPixels;
      if (Math.abs(size - target) <= 1) return;
      panel.resize(`${target}px`);
      if (++tries <= 8) {
        enforceFrameRef.current = requestAnimationFrame(tick);
      }
    };
    cancelAnimationFrame(enforceFrameRef.current);
    enforceFrameRef.current = requestAnimationFrame(tick);
  }, [groupWidth]);

  // `defaultSize` covers the first mount. It does not cover reopening the panel:
  // the group remembers the last layout for a given set of panel ids and prefers
  // it over `defaultSize`. Nor does it cover a group that was too narrow to
  // honour the width when the panel mounted. Both of those are "the group
  // changed size", so that is what this listens to, rather than racing a fixed
  // number of frames.
  useEffect(() => {
    if (!mounted) return;
    enforceWidth();
    // The group, not the window: the app can start minimized or restored to a
    // size the window manager only settles on later, and the first layout is
    // then computed against a group too narrow to hold the width, which clamps
    // the panel to its minimum. Watching the group catches every one of those,
    // including a zoom change, which resizes the group without resizing the
    // window. Each event kicks a fresh act-and-verify loop.
    const group = hostRef.current?.closest<HTMLElement>(
      '[data-slot="resizable-panel-group"]',
    );
    const observer = group ? new ResizeObserver(enforceWidth) : null;
    if (group && observer) observer.observe(group);
    window.addEventListener("resize", enforceWidth);
    return () => {
      cancelAnimationFrame(enforceFrameRef.current);
      observer?.disconnect();
      window.removeEventListener("resize", enforceWidth);
    };
    // `attached` is here because the panel is re-created on remount, and a panel
    // that came back at the wrong width is the same bug as one that started at
    // the wrong width.
  }, [mounted, attached, enforceWidth]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt(0);
  }, []);

  useEffect(() => {
    dispatchSuppression({
      type: visible ? "release" : "suppress",
      source: "mode",
    });
    // Coming back into view is a fresh chance to attach. Without this an attach
    // that exhausted its retries while the panel was showing another mode would
    // never be tried again, and the browser would stay blank until the app is
    // restarted into browser mode.
    if (visible) setAttempt(0);
  }, [visible]);

  /** Move the native webview onto the placeholder. */
  const syncBounds = useCallback(async (force = false) => {
    const host = hostRef.current;
    if (!host || !attachedRef.current) return;
    const bounds = measure(host);
    if (!bounds) return;
    if (!force && sameBounds(bounds, lastBoundsRef.current)) return;
    lastBoundsRef.current = bounds;
    try {
      await invoke("browser_set_bounds", bounds);
    } catch {
      // the webview may be mid-teardown; the next sync corrects it
    }
  }, []);

  const scheduleSync = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      void syncBounds();
    });
  }, [syncBounds]);

  // Attach / detach in step with the flag.
  useEffect(() => {
    let cancelled = false;
    if (!enabled) {
      if (attachedRef.current) {
        attachedRef.current = false;
        lastBoundsRef.current = null;
        setAttached(false);
        setInfo(null);
        void invoke("browser_detach").catch(() => {});
      }
      return;
    }
    if (attachedRef.current || attachingRef.current) return;
    if (attempt >= ATTACH_MAX_ATTEMPTS) return;

    const host = hostRef.current;
    // The first commit can land before the panel group has applied its layout,
    // so a degenerate rect is a "not yet", not a "never". Without the retry the
    // panel would stay dead until the app restarts.
    const bounds = host ? measure(host) : null;
    if (!bounds) {
      const timer = window.setTimeout(
        () => setAttempt((n) => n + 1),
        ATTACH_RETRY_MS,
      );
      return () => window.clearTimeout(timer);
    }

    attachingRef.current = true;
    void (async () => {
      try {
        const next = await invoke<BrowserInfo>("browser_attach", {
          url: readBrowserUrl(),
          ...bounds,
        });
        if (cancelled) return;
        attachedRef.current = true;
        setAttached(true);
        setInfo(next);
        setError(next.cdp_error);
        // Attaching can take seconds (the CDP probe). Every resize during that
        // window was dropped, and `bounds` above is from before the wait — so
        // re-measure now instead of leaving the webview at a stale rectangle.
        lastBoundsRef.current = null;
        void syncBounds(true);
      } catch (e) {
        if (cancelled) return;
        setError(String(e));
        window.setTimeout(() => setAttempt((n) => n + 1), ATTACH_RETRY_MS);
      } finally {
        attachingRef.current = false;
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, attempt, syncBounds]);

  // Detach on unmount so a closed window does not leave a live webview or a
  // stale discovery file behind.
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (widthTimerRef.current) window.clearTimeout(widthTimerRef.current);
      if (attachedRef.current) void invoke("browser_detach").catch(() => {});
    };
  }, []);

  // Follow the placeholder: panel resize, window resize, zoom change.
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !enabled) return;
    const observer = new ResizeObserver(scheduleSync);
    observer.observe(host);
    window.addEventListener("resize", scheduleSync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleSync);
    };
  }, [enabled, scheduleSync]);

  // Overlays that would otherwise render behind the native webview. Only ones
  // that actually cross the panel count: the app is wall-to-wall tooltips, and
  // blanking the browser because a toast appeared in the far corner makes it
  // unusable.
  useEffect(() => {
    if (!enabled) return;
    const selectors = Object.entries(OVERLAY_SELECTORS);
    let previous = new Set<OverlaySource>();

    const apply = () => {
      const host = hostRef.current;
      const panel = host?.getBoundingClientRect();
      const now = new Set<OverlaySource>();
      if (panel) {
        for (const [selector, source] of selectors) {
          if (now.has(source)) continue;
          for (const el of document.querySelectorAll(selector)) {
            const r = el.getBoundingClientRect();
            if (r.width > 0 && r.height > 0 && overlaps(r, panel)) {
              now.add(source);
              break;
            }
          }
        }
      }
      for (const source of now) {
        if (!previous.has(source)) suppress(source);
      }
      for (const source of previous) {
        if (!now.has(source)) release(source);
      }
      previous = now;
    };

    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    apply();
    return () => observer.disconnect();
  }, [enabled, release, suppress]);

  // Push visibility whenever suppression flips. Depends on `attached` (state,
  // not a ref) so a suppression that arrives while the attach is still in
  // flight is applied the moment the panel exists — otherwise the webview would
  // be born visible on top of an open dialog.
  useEffect(() => {
    if (!attached) return;
    const hidden = isSuppressed(suppression);
    if (hidden === suppressedRef.current) return;
    suppressedRef.current = hidden;
    void invoke("browser_set_visible", { visible: !hidden })
      .then(() => {
        // Coming back from hidden, the webview can land at stale bounds.
        if (!hidden) void syncBounds(true);
      })
      .catch(() => {});
  }, [attached, suppression, syncBounds]);

  // The divider suppresses on pointerdown; releasing has to be global because
  // the gesture routinely ends outside the handle (and outside the window).
  useEffect(() => {
    if (!mounted) return;
    // Only movement while the handle is held counts as a drag, so a stray click
    // on the divider cannot commit a width.
    // The library starts a divider drag from its own window-level hit test,
    // which accepts pointers a few pixels to either side of the 1px separator
    // element. A React handler on the separator never fires for those, so the
    // gesture has to be detected the same way the library detects it: by
    // proximity to the panel's right edge, on window capture.
    const down = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const panel = hostRef.current?.closest<HTMLElement>("[data-panel]");
      if (!panel) return;
      const r = panel.getBoundingClientRect();
      if (
        Math.abs(e.clientX - r.right) <= 8 &&
        e.clientY >= r.top &&
        e.clientY <= r.bottom
      ) {
        suppress("handle-drag");
      }
    };
    const move = () => {
      if (pointerDownRef.current) draggingRef.current = true;
    };
    const end = () => {
      const dragged = draggingRef.current;
      pointerDownRef.current = false;
      // Commit before releasing the stand-down. The library has already
      // applied the gesture's final layout by pointerup, and enforcement
      // starts pulling the panel back to the stored target the moment
      // `draggingRef` clears — persisting first is what makes the dragged
      // width the new target instead of the thing enforcement undoes.
      if (dragged) {
        const panel = panelRef.current;
        if (panel) persistWidth(panel.getSize().inPixels);
      }
      draggingRef.current = false;
      release("handle-drag");
    };
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, [mounted, release, persistWidth, suppress]);

  // The address bar reads the webview, because `pushState` fires no navigation
  // event and every SPA the panel is meant for navigates that way.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const tick = async () => {
      try {
        const current = await invoke<string | null>("browser_url");
        if (!alive || !current || current === lastUrlRef.current) return;
        lastUrlRef.current = current;
        setUrl(current);
        // Redacted on the way to disk: the restore key can otherwise hold an
        // OAuth callback with a live code in the query. The page itself keeps
        // the real URL; only what survives the session is stripped.
        writeStored(URL_KEY, redactUrl(current));
      } catch {
        // panel not attached yet
      }
    };
    const id = window.setInterval(tick, URL_POLL_MS);
    void tick();
    return () => {
      alive = false;
      window.clearInterval(id);
    };
  }, [enabled]);

  const navigate = useCallback(async (next: string) => {
    try {
      const resolved = await invoke<string | null>("browser_navigate", {
        url: next,
      });
      if (!resolved) return; // empty input is a no-op, not a failure
      lastUrlRef.current = resolved;
      setUrl(resolved);
      writeStored(URL_KEY, redactUrl(resolved));
      setError(null);
    } catch (e) {
      setError(String(e));
    }
  }, []);

  const go = useCallback((delta: number) => {
    void invoke("browser_go", { delta }).catch(() => {});
  }, []);

  const reload = useCallback(() => {
    void invoke("browser_reload").catch(() => {});
  }, []);

  return {
    hostRef,
    panelRef,
    enforceWidth,
    initialSize,
    enabled,
    setEnabled,
    attached,
    info,
    error,
    retry,
    url,
    setUrl,
    navigate,
    go,
    reload,
    widthRef,
    persistWidth,
    suppress,
    release,
    suppressed: isSuppressed(suppression),
    suppressionReason: suppressionReason(suppression),
    syncBounds,
  };
}
