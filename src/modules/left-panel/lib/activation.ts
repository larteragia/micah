/**
 * The Ai Viewer is opt-in per user: it only tails transcripts and polls
 * processes after an explicit "Ativar". The flag persists like the panel
 * mode does, so the choice survives restarts.
 */

const ACTIVE_KEY = "micah.aiViewer.active";

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
    // storage can fail in private mode; the toggle still works this session
  }
}

/** Anything but the exact stored "1" means off: the viewer must never
 * start watching because of garbage in storage. */
export function coerceAiViewerActive(raw: unknown): boolean {
  return raw === "1";
}

export function readAiViewerActive(): boolean {
  return coerceAiViewerActive(readStored(ACTIVE_KEY));
}

export function writeAiViewerActive(active: boolean): void {
  writeStored(ACTIVE_KEY, active ? "1" : "0");
}
