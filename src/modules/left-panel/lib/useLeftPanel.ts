import { useCallback, useEffect, useState } from "react";
import {
  coerceLeftPanelMode,
  type LeftPanelMode,
  readLeftPanelMode,
  readLeftPanelOpen,
  writeLeftPanelMode,
  writeLeftPanelOpen,
} from "./mode";

/**
 * Which surface the left panel shows, and whether the panel is on screen at all.
 *
 * `browserAvailable` is the browser panel's own feature flag. It gates the
 * `browser` *mode*, never the panel: the panel is where Editor and Ai Viewer
 * live too, and turning the browser off must not take them with it.
 */
export function useLeftPanel(browserAvailable: boolean) {
  const [mode, setModeState] = useState<LeftPanelMode>(() =>
    readLeftPanelMode(browserAvailable),
  );
  const [open, setOpenState] = useState(readLeftPanelOpen);

  const setMode = useCallback(
    (next: LeftPanelMode) => {
      const resolved = coerceLeftPanelMode(next, browserAvailable);
      writeLeftPanelMode(resolved);
      setModeState(resolved);
    },
    [browserAvailable],
  );

  const setOpen = useCallback((next: boolean) => {
    writeLeftPanelOpen(next);
    setOpenState(next);
  }, []);

  // Turning the browser panel off while it is the visible mode would leave an
  // empty panel with no way back, so the mode follows the flag down.
  useEffect(() => {
    setModeState((current) => {
      const resolved = coerceLeftPanelMode(current, browserAvailable);
      if (resolved !== current) writeLeftPanelMode(resolved);
      return resolved;
    });
  }, [browserAvailable]);

  return { mode, setMode, open, setOpen, browserAvailable };
}

export type LeftPanelState = ReturnType<typeof useLeftPanel>;
