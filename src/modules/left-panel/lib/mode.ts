/**
 * The left panel hosts one of three surfaces at a time. The order is fixed by
 * the product and read from this one array everywhere, so no render site can
 * drift from it.
 */
export const LEFT_PANEL_MODES = ["browser", "editor", "ai-viewer"] as const;

export type LeftPanelMode = (typeof LEFT_PANEL_MODES)[number];

export const LEFT_PANEL_MODE_LABELS: Readonly<Record<LeftPanelMode, string>> = {
  browser: "Browser",
  editor: "Editor",
  "ai-viewer": "Ai Viewer",
};

const MODE_KEY = "micah.leftPanel.mode";
const OPEN_KEY = "micah.leftPanel.open";

export function isLeftPanelMode(value: unknown): value is LeftPanelMode {
  return (
    typeof value === "string" &&
    (LEFT_PANEL_MODES as readonly string[]).includes(value)
  );
}

/**
 * Anything that is not one of the three modes falls back, and so does `browser`
 * when the browser panel is turned off: a mode that renders nothing is
 * indistinguishable from a broken app.
 */
export function coerceLeftPanelMode(
  raw: unknown,
  browserAvailable: boolean,
): LeftPanelMode {
  if (isLeftPanelMode(raw)) {
    return raw === "browser" && !browserAvailable ? "editor" : raw;
  }
  return browserAvailable ? "browser" : "editor";
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

export function readLeftPanelMode(browserAvailable: boolean): LeftPanelMode {
  return coerceLeftPanelMode(readStored(MODE_KEY), browserAvailable);
}

export function writeLeftPanelMode(mode: LeftPanelMode): void {
  writeStored(MODE_KEY, mode);
}

export function readLeftPanelOpen(): boolean {
  const stored = readStored(OPEN_KEY);
  if (stored === "0") return false;
  return true;
}

export function writeLeftPanelOpen(open: boolean): void {
  writeStored(OPEN_KEY, open ? "1" : "0");
}
