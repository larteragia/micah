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

const WIDTH_KEY = "micah.browser.width.v3";
const ENABLED_KEY = "micah.browser.enabled";
const URL_KEY = "micah.browser.url";
/** Reading back the webview's own URL is the only thing that catches pushState. */
const URL_POLL_MS = 700;
/** Attach retries: the first paint can measure a rect the layout has not settled. */
const ATTACH_RETRY_MS = 400;
const ATTACH_MAX_ATTEMPTS = 8;
/** Frames to keep re-asserting the panel width before giving up. */
const WIDTH_APPLY_MAX_ATTEMPTS = 30;

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

/**
 * The initial size as a percentage of the window.
 *
 * A pixel `defaultSize` is not resolvable on the first commit — the group has
 * not measured itself yet — and a panel with no resolvable size becomes the
 * elastic one, swallowing everything the other panels' minimums leave behind.
 * A percentage needs no measurement, so it lands right on the first paint.
 */
export function initialBrowserPercent(
  widthPx: number,
  windowWidth: number,
): string {
  if (!Number.isFinite(windowWidth) || windowWidth <= 0) return "25%";
  const pct = (widthPx / windowWidth) * 100;
  return `${Math.min(80, Math.max(10, pct)).toFixed(2)}%`;
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

export function useBrowserPanel() {
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
  // Computed once: re-deriving it on every render would fight the user's drag.
  const [initialSize] = useState(() =>
    initialBrowserPercent(widthRef.current, window.innerWidth),
  );
  const widthTimerRef = useRef(0);
  const lastBoundsRef = useRef<Bounds | null>(null);
  const lastUrlRef = useRef(url);
  const rafRef = useRef(0);
  const attachedRef = useRef(false);
  const attachingRef = useRef(false);
  const suppressedRef = useRef(false);
  const draggingRef = useRef(false);

  const suppress = useCallback((source: OverlaySource) => {
    if (source === "handle-drag") draggingRef.current = true;
    dispatchSuppression({ type: "suppress", source });
  }, []);
  const release = useCallback((source: OverlaySource) => {
    dispatchSuppression({ type: "release", source });
  }, []);

  // Only a real drag may change the stored width. The panel group reports
  // `isUserInteraction` for layout passes that no user caused, and trusting it
  // created a feedback loop: a bad initial layout got persisted, then read back
  // as the next session's starting width, and the panel grew every launch.
  const persistWidth = useCallback(
    (next: number, isUserInteraction: boolean) => {
      if (!isUserInteraction || !draggingRef.current || next <= 0) return;
      widthRef.current = clampWidth(next);
      if (widthTimerRef.current) window.clearTimeout(widthTimerRef.current);
      widthTimerRef.current = window.setTimeout(() => {
        widthTimerRef.current = 0;
        writeStored(WIDTH_KEY, String(widthRef.current));
      }, 200);
    },
    [],
  );

  const setEnabled = useCallback((next: boolean) => {
    writeStored(ENABLED_KEY, next ? "1" : "0");
    setEnabledState(next);
  }, []);

  // Neither `defaultSize` nor a single `resize()` in pixels survives the first
  // commit: the group has not measured itself yet, so a pixel size resolves to
  // nothing and this panel silently becomes the elastic one — swallowing every
  // pixel the other panels' minimums leave behind. So the width is applied and
  // then *verified*, retrying until the group answers with the size we asked
  // for. Anything less is a panel that is usually, but not always, right.
  useEffect(() => {
    if (!enabled) return;
    let frame = 0;
    let attempts = 0;
    const apply = () => {
      const panel = panelRef.current;
      const target = widthRef.current;
      if (panel) {
        const current = panel.getSize().inPixels;
        if (Math.abs(current - target) <= 1) return;
        panel.resize(`${target}px`);
      }
      if (++attempts < WIDTH_APPLY_MAX_ATTEMPTS) {
        frame = requestAnimationFrame(apply);
      }
    };
    frame = requestAnimationFrame(apply);
    return () => cancelAnimationFrame(frame);
    // `attached` is here because the panel is re-created on remount, and a panel
    // that came back at the wrong width is the same bug as one that started at
    // the wrong width.
  }, [enabled, attached]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt(0);
  }, []);

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
    if (!enabled) return;
    const end = () => {
      release("handle-drag");
      // Cleared a beat later: the group's final layout event lands after the
      // pointer is already up, and that one is the size worth keeping.
      window.setTimeout(() => {
        draggingRef.current = false;
      }, 250);
    };
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, [enabled, release]);

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
        writeStored(URL_KEY, current);
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
      writeStored(URL_KEY, resolved);
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
