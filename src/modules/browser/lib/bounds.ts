/**
 * Turning a DOM rectangle into the native webview's position is the one place
 * this feature can silently be wrong on every machine but the author's.
 *
 * The panel's placeholder lives inside `<main class="zoom-content">`, whose
 * `zoom: var(--app-zoom)` (src/styles/globals.css) rescales the whole subtree.
 * Chromium changed how `zoom` interacts with `getBoundingClientRect()` — newer
 * engines report rects already multiplied by the accumulated zoom, older ones
 * report them in the pre-zoom coordinate space. Guessing which one is running
 * puts the browser panel in the wrong place at any zoom other than 100%.
 *
 * So nothing here guesses: `zoomScaleFor` *measures* which convention is live by
 * comparing a full-width element against the viewport, and the caller applies
 * the factor it returns.
 */

export type Rect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type Bounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Which multiplier turns a measured rect into window-logical pixels.
 *
 * `measuredWidth` must come from an element known to span the full viewport
 * width *inside* the zoomed subtree; `viewportWidth` from `window.innerWidth`,
 * which is never zoom-scaled.
 *
 * - Rects already scaled → `measuredWidth ≈ viewportWidth` → factor 1.
 * - Rects in pre-zoom space → `measuredWidth × zoom ≈ viewportWidth` → factor `zoom`.
 *
 * Ties and nonsense inputs resolve to 1: being wrong by the zoom factor is a
 * visible bug, being wrong by nothing is merely the status quo.
 */
export function zoomScaleFor(
  measuredWidth: number,
  viewportWidth: number,
  zoom: number,
): number {
  if (
    !Number.isFinite(measuredWidth) ||
    !Number.isFinite(viewportWidth) ||
    !Number.isFinite(zoom) ||
    measuredWidth <= 0 ||
    viewportWidth <= 0 ||
    zoom <= 0
  ) {
    return 1;
  }
  if (zoom === 1) return 1;
  const errorIfScaled = Math.abs(measuredWidth - viewportWidth);
  const errorIfUnscaled = Math.abs(measuredWidth * zoom - viewportWidth);
  return errorIfUnscaled < errorIfScaled ? zoom : 1;
}

/**
 * Read `--app-zoom` off the document. Returns 1 for anything unparseable, which
 * is the same as "no zoom applied".
 */
export function readAppZoom(styleValue: string | null | undefined): number {
  const parsed = Number.parseFloat((styleValue ?? "").trim());
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 1;
}

/**
 * Window-logical bounds for the native child webview.
 *
 * The rect is viewport-relative and the main webview fills the window, so no
 * chrome offset is added — the 1px border of `#root` is already inside the rect.
 * Sizes are floored to whole pixels and clamped to at least 1: a zero-size
 * webview keeps painting a sliver on Windows instead of disappearing.
 */
export function rectToBounds(rect: Rect, scale: number): Bounds {
  const factor = Number.isFinite(scale) && scale > 0 ? scale : 1;
  return {
    x: Math.round(rect.left * factor),
    y: Math.round(rect.top * factor),
    width: Math.max(1, Math.round(rect.width * factor)),
    height: Math.max(1, Math.round(rect.height * factor)),
  };
}

/** Two bounds are the same when every edge matches, so redundant IPC is dropped. */
export function sameBounds(a: Bounds | null, b: Bounds | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height
  );
}

/**
 * A rect that is off-screen, collapsed or degenerate means "there is nothing to
 * show" — the panel is hidden rather than parked somewhere odd.
 */
export function isRenderableRect(rect: Rect): boolean {
  return (
    Number.isFinite(rect.left) &&
    Number.isFinite(rect.top) &&
    rect.width >= 1 &&
    rect.height >= 1
  );
}
