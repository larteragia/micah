/**
 * Micah's Mind view driver (card mindwalk-real, E4): the panel no longer
 * renders a homemade canvas — a native child webview (label "mind") shows
 * the REAL mindwalk UI served by the local sidecar. This hook owns the
 * state machine that takes the sidecar from off to ready, points the
 * webview at the session the plumbing picked, and keeps the native
 * rectangle glued to the host div.
 *
 * Machine: "off" → "sidecar-starting" → "session-waiting" → "ready", with
 * "dead" (sidecar down, manual relight) and "session-absent" (no valid
 * uuid to follow) as terminal-until-input states. Driven by: gate active +
 * pick.session. Transitions are pure (deriveMindPhase) and pinned by tests.
 *
 * A native child webview paints ABOVE the whole HTML layer and ignores
 * z-index, so visibility is explicit: shown only in "ready", hidden for
 * overlays (suppression pattern from the browser panel), for the panel's
 * own menu, and whenever the session is absent — the selector and the
 * state UI must stay clickable (plan decision 4).
 *
 * No refresh interval lives here on purpose (plan decision 9): live
 * follow belongs to the fork's own UI (`?follow=1`).
 */

import {
  type Bounds,
  isRenderableRect,
  readAppZoom,
  rectToBounds,
  sameBounds,
  zoomScaleFor,
} from "@/modules/browser/lib/bounds";
import {
  EMPTY_SUPPRESSION,
  isSuppressed,
  OVERLAY_SELECTORS,
  type OverlaySource,
  overlaps,
  suppressionReducer,
} from "@/modules/browser/lib/suppression";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  type RefObject,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";

/** Sidecar status as the Rust `mind_*` commands report it (camelCase). */
export type MindStatus = {
  state: "off" | "starting" | "ready" | "dead";
  port?: number;
  restarts: number;
  lastError?: string;
};

export type MindViewPhase =
  | "off"
  | "sidecar-starting"
  | "session-waiting"
  | "ready"
  | "dead"
  | "session-absent";

/** One handshake slice; the loop repeats until the trace answers 200. */
const WAIT_SLICE_MS = 5000;
/** The first paint can measure a rect the layout has not settled. */
const ATTACH_RETRY_MS = 250;
const ATTACH_MAX_ATTEMPTS = 12;
/** Boot poll while mind_ensure answered "starting"; ends at ready/dead. */
const BOOT_POLL_MS = 300;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The only session id the webview may be navigated to is a uuid (plan
 * decision 3): anything else — resume labels, paths, garbage — is treated
 * as "no session" instead of being embedded in a URL. Lowercased first so
 * the sidecar's Key/ID lookup and the deep-link stay canonical.
 */
export function normalizeMindSession(
  session: string | null | undefined,
): string | null {
  if (!session) return null;
  const lower = session.trim().toLowerCase();
  return UUID_RE.test(lower) ? lower : null;
}

/** Deep-link into the sidecar: follow mode is the fork's own (P3 patch). */
export function mindUrl(port: number, session: string): string {
  return `http://127.0.0.1:${port}/?session=${session}&follow=1`;
}

/**
 * Pure phase derivation — the machine's truth table. `sessionReady` means
 * the handshake (mind_wait_session → GET /trace 200) confirmed the session
 * exists in the sidecar's scan, the webview attached and navigation landed.
 */
export function deriveMindPhase(args: {
  enabled: boolean;
  status: MindStatus | null;
  session: string | null;
  sessionReady: boolean;
}): MindViewPhase {
  if (!args.enabled) return "off";
  const st = args.status;
  if (st === null || st.state === "off" || st.state === "starting")
    return "sidecar-starting";
  if (st.state === "dead") return "dead";
  // "ready" without a port is not usable yet: treat it as still starting
  // rather than building a URL against undefined.
  if (typeof st.port !== "number") return "sidecar-starting";
  if (args.session === null) return "session-absent";
  return args.sessionReady ? "ready" : "session-waiting";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Clone of the browser panel's private `measure` (useBrowserPanel.ts) —
 * it is not exported and is coupled to that panel's docs, so the minimum
 * is duplicated on purpose; the zoom-calibration story and every helper
 * live in browser/lib/bounds.ts and are imported, not copied.
 */
function measureHost(host: HTMLElement): Bounds | null {
  const rect = host.getBoundingClientRect();
  if (!isRenderableRect(rect)) return null;
  const zoom = readAppZoom(
    getComputedStyle(document.documentElement).getPropertyValue("--app-zoom"),
  );
  const zoomHost = host.closest<HTMLElement>(".zoom-content");
  const scale = zoomScaleFor(
    zoomHost?.getBoundingClientRect().width ?? window.innerWidth,
    window.innerWidth,
    zoom,
  );
  return rectToBounds(rect, scale);
}

export type MindView = {
  hostRef: RefObject<HTMLDivElement | null>;
  phase: MindViewPhase;
  /** Raw sidecar status, for the discreet badge and the dead screen. */
  status: MindStatus | null;
  /** Normalized uuid actually driving the webview, or null. */
  session: string | null;
  /** Wall-clock start of the current handshake wait (honest spinner). */
  waitStartedAt: number | null;
  /** Attach/navigate failure with the sidecar itself alive. */
  attachError: string | null;
  /** From "dead" (or a stuck attach): run mind_ensure and the flow again. */
  relight: () => void;
};

export function useMindView({
  enabled,
  session: rawSession,
  menuOpen = false,
}: {
  enabled: boolean;
  session: string | null;
  /**
   * The panel's own menu (the sessions dropdown) is plain HTML: it can
   * never paint over the native webview, so the webview hides while the
   * menu is open — same reasoning as the browser panel's "browser-menu".
   */
  menuOpen?: boolean;
}): MindView {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [status, setStatus] = useState<MindStatus | null>(null);
  const [attached, setAttached] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [waitStartedAt, setWaitStartedAt] = useState<number | null>(null);
  const [attachError, setAttachError] = useState<string | null>(null);
  const [ensureNonce, setEnsureNonce] = useState(0);
  const [suppression, dispatchSuppression] = useReducer(
    suppressionReducer,
    EMPTY_SUPPRESSION,
  );

  const attachedRef = useRef(false);
  const lastBoundsRef = useRef<Bounds | null>(null);
  const rafRef = useRef(0);
  const visibleRef = useRef(false);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const session = normalizeMindSession(rawSession);
  const port =
    status?.state === "ready" && typeof status.port === "number"
      ? status.port
      : null;

  /** Move the native webview onto the host div (browser panel pattern). */
  const syncBounds = useCallback(async (force = false) => {
    const host = hostRef.current;
    if (!host || !attachedRef.current) return;
    const bounds = measureHost(host);
    if (!bounds) return;
    if (!force && sameBounds(bounds, lastBoundsRef.current)) return;
    lastBoundsRef.current = bounds;
    try {
      await invoke("mind_set_bounds", { ...bounds });
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

  // Sidecar lifecycle. Gate ON: mind_ensure, then follow a "starting"
  // answer with mind_status until it settles (the Rust side owns restarts
  // and backoff; it always ends at ready or dead). Gate OFF while mounted:
  // detach for real (plan decision 6) — a plain unmount only hides, see
  // the unmount effect below.
  // biome-ignore lint/correctness/useExhaustiveDependencies(ensureNonce): manual relight trigger (Religar)
  useEffect(() => {
    if (!enabled) {
      if (attachedRef.current) {
        attachedRef.current = false;
        lastBoundsRef.current = null;
        visibleRef.current = false;
        setAttached(false);
        void invoke("mind_detach").catch(() => {});
      }
      setStatus(null);
      setSessionReady(false);
      setWaitStartedAt(null);
      setAttachError(null);
      return;
    }
    let alive = true;
    setStatus(null);
    void (async () => {
      try {
        let st = await invoke<MindStatus>("mind_ensure");
        if (!alive) return;
        setStatus(st);
        while (alive && st.state === "starting") {
          await sleep(BOOT_POLL_MS);
          if (!alive) return;
          st = await invoke<MindStatus>("mind_status");
          if (!alive) return;
          setStatus(st);
        }
      } catch (e) {
        if (alive)
          setStatus({ state: "dead", restarts: 0, lastError: String(e) });
      }
    })();
    return () => {
      alive = false;
    };
  }, [enabled, ensureNonce]);

  // Supervisor-driven transitions (death, restart on a new port, budget
  // spent → dead) are pushed by the Rust side; without this the panel
  // would never re-read mind_status after boot and a dead sidecar would
  // leave a frozen page with no Religar screen. A restart lands here as a
  // ready status with a new port, which re-runs the session flow below.
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    let unlisten: (() => void) | undefined;
    void listen<MindStatus>("micah:mind-status", (event) => {
      setStatus(event.payload);
    }).then((stop) => {
      if (!alive) {
        stop();
        return;
      }
      unlisten = stop;
    });
    return () => {
      alive = false;
      unlisten?.();
    };
  }, [enabled]);

  // Session flow: prewarm → handshake loop → attach → navigate → ready.
  // A pick.session change re-runs the whole flow WITHOUT detaching (plan
  // decision 4); sessionReady dropping to false hides the webview through
  // the visibility effect, so the state UI underneath is never covered.
  // A sidecar restart changes `port`, which also re-runs the flow.
  // biome-ignore lint/correctness/useExhaustiveDependencies(ensureNonce): relight must re-run the flow even when port and session are unchanged
  useEffect(() => {
    if (!enabled || port === null) return;
    setSessionReady(false);
    setAttachError(null);
    if (session === null) {
      setWaitStartedAt(null);
      return;
    }
    let alive = true;
    void (async () => {
      try {
        await invoke("mind_prewarm", { sessionId: session });
      } catch {
        // best-effort background warmup; the wait loop is the actual gate
      }
      if (!alive) return;
      setWaitStartedAt(Date.now());
      // Handshake (plan correction 7): a newborn session may not be in the
      // sidecar's scan yet and the fork's client would silently fall back
      // to "latest". Only navigate once GET /trace answers 200. The first
      // scan of a big root (HOME) can take minutes — the caller shows an
      // honest elapsed-time spinner off waitStartedAt, no fake progress.
      let ok = false;
      while (alive && !ok) {
        try {
          ok = await invoke<boolean>("mind_wait_session", {
            sessionId: session,
            timeoutMs: WAIT_SLICE_MS,
          });
        } catch {
          // The sidecar may have died mid-wait: re-read status. "dead"
          // surfaces the Religar screen; a restart re-runs this effect
          // with the new port.
          try {
            const st = await invoke<MindStatus>("mind_status");
            if (!alive) return;
            setStatus(st);
            if (st.state !== "ready" || st.port !== port) return;
          } catch {
            return;
          }
        }
      }
      if (!alive) return;
      setWaitStartedAt(null);

      // Attach at the host's measured rect. add_child is a singleton on
      // the Rust side, so re-attach after a re-mount is idempotent (plan
      // decision 6). The first paint can measure before layout settles.
      let bounds: Bounds | null = null;
      for (let i = 0; i < ATTACH_MAX_ATTEMPTS && alive; i++) {
        const host = hostRef.current;
        bounds = host ? measureHost(host) : null;
        if (bounds) break;
        await sleep(ATTACH_RETRY_MS);
      }
      if (!alive) return;
      if (!bounds) {
        setAttachError("painel sem área mensurável para posicionar o webview");
        return;
      }
      try {
        await invoke("mind_attach", { ...bounds });
      } catch (e) {
        if (alive) setAttachError(String(e));
        return;
      }
      // Reflect reality even if this run went stale mid-attach: the
      // webview exists now and — native default — is VISIBLE. Recording
      // that here is what makes the visibility effect push the first hide
      // instead of assuming the webview started hidden.
      attachedRef.current = true;
      visibleRef.current = true;
      setAttached(true);
      if (!alive) {
        // Stale mid-attach (unmount or gate-off): nobody else knows the
        // webview just appeared, so it would sit visible over whatever
        // replaced this panel. Hide it; a gate turned off wants the real
        // detach (plan decision 6).
        void invoke("mind_set_visible", { visible: false })
          .then(() => {
            visibleRef.current = false;
          })
          .catch(() => {});
        if (!enabledRef.current) {
          attachedRef.current = false;
          lastBoundsRef.current = null;
          setAttached(false);
          void invoke("mind_detach").catch(() => {});
        }
        return;
      }
      try {
        await invoke("mind_navigate", { url: mindUrl(port, session) });
      } catch (e) {
        if (alive) setAttachError(String(e));
        return;
      }
      if (!alive) return;
      // Invalidate the visibility bookkeeping before declaring ready: a
      // stale run's late fire-and-forget hide can land AFTER this run's
      // attach, leaving the native state hidden while the ref says visible.
      // With the ref forced stale, the visibility effect re-asserts
      // whatever is currently true instead of skipping the push.
      visibleRef.current = false;
      setSessionReady(true);
      // The wait + attach can straddle relayouts; drop the cache and
      // re-measure (browser panel's post-attach pattern).
      lastBoundsRef.current = null;
      void syncBounds(true);
    })();
    return () => {
      alive = false;
    };
  }, [enabled, port, session, ensureNonce, syncBounds]);

  // Visibility is the AND of every reason to show: handshake done, no
  // overlay over the panel, menu closed. Pushed only on change; coming
  // back visible re-measures (the webview can land at stale bounds).
  useEffect(() => {
    if (!attached) return;
    const visible = sessionReady && !isSuppressed(suppression);
    if (visible === visibleRef.current) return;
    visibleRef.current = visible;
    void invoke("mind_set_visible", { visible })
      .then(() => {
        if (visible) void syncBounds(true);
      })
      .catch(() => {});
  }, [attached, sessionReady, suppression, syncBounds]);

  // The panel's own menu suppresses through the same reducer.
  useEffect(() => {
    dispatchSuppression({
      type: menuOpen ? "suppress" : "release",
      source: "browser-menu",
    });
  }, [menuOpen]);

  // Follow the host div: panel resize, window resize, zoom change —
  // coalesced by rAF (plan decision 5).
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

  // Overlays that would otherwise render behind the native webview
  // (dialogs, dropdowns, toasts…). Only ones that actually cross the
  // panel count — clone of the browser panel's MutationObserver scan.
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
        if (!previous.has(source))
          dispatchSuppression({ type: "suppress", source });
      }
      for (const source of previous) {
        if (!now.has(source)) dispatchSuppression({ type: "release", source });
      }
      previous = now;
    };

    const observer = new MutationObserver(apply);
    observer.observe(document.body, { childList: true, subtree: true });
    apply();
    return () => {
      observer.disconnect();
      // Release what this pass held, or a re-enable would inherit stale
      // sources no scan would ever release again.
      for (const source of previous)
        dispatchSuppression({ type: "release", source });
    };
  }, [enabled]);

  // Dragging the panel divider over a native child webview loses pointer
  // capture, so the webview hides for the gesture — same window-level hit
  // test the browser panel uses (its React handlers never see pointers a
  // few pixels off the 1px separator). No width bookkeeping here: the
  // browser panel owns the left panel's width.
  useEffect(() => {
    if (!enabled) return;
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
        dispatchSuppression({ type: "suppress", source: "handle-drag" });
      }
    };
    const end = () =>
      dispatchSuppression({ type: "release", source: "handle-drag" });
    window.addEventListener("pointerdown", down, true);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    window.addEventListener("blur", end);
    return () => {
      window.removeEventListener("pointerdown", down, true);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      window.removeEventListener("blur", end);
    };
  }, [enabled]);

  // Unmount (mode switch away from ai-viewer) hides the webview but keeps
  // it and the sidecar alive: re-mount re-attaches the singleton and the
  // session comes back without paying the boot again (plan decision 6).
  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (attachedRef.current)
        void invoke("mind_set_visible", { visible: false }).catch(() => {});
    };
  }, []);

  const relight = useCallback(() => {
    setStatus(null);
    setAttachError(null);
    setEnsureNonce((n) => n + 1);
  }, []);

  return {
    hostRef,
    phase: deriveMindPhase({ enabled, status, session, sessionReady }),
    status,
    session,
    waitStartedAt,
    attachError,
    relight,
  };
}
