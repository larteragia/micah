import { readTerminalTokens } from "@/styles/tokens";
import type { ITheme } from "@xterm/xterm";

/** Tokens resolve to computed `rgb(...)`; give one an explicit alpha. */
export function withAlpha(color: string, alpha: number): string {
  const m = color.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!m) return color;
  return `rgba(${m[1]}, ${m[2]}, ${m[3]}, ${alpha})`;
}

export function buildTerminalTheme(): ITheme {
  const t = readTerminalTokens();
  return {
    background: t.background,
    foreground: t.foreground,
    cursor: t.cursor,
    cursorAccent: t.cursorAccent,
    selectionBackground: t.selection,
    scrollbarSliderBackground: withAlpha(t.foreground, 0.2),
    scrollbarSliderHoverBackground: withAlpha(t.foreground, 0.35),
    scrollbarSliderActiveBackground: withAlpha(t.foreground, 0.5),
    black: t.ansiBlack,
    red: t.ansiRed,
    green: t.ansiGreen,
    yellow: t.ansiYellow,
    blue: t.ansiBlue,
    magenta: t.ansiMagenta,
    cyan: t.ansiCyan,
    white: t.ansiWhite,
    brightBlack: t.ansiBrightBlack,
    brightRed: t.ansiBrightRed,
    brightGreen: t.ansiBrightGreen,
    brightYellow: t.ansiBrightYellow,
    brightBlue: t.ansiBrightBlue,
    brightMagenta: t.ansiBrightMagenta,
    brightCyan: t.ansiBrightCyan,
    brightWhite: t.ansiBrightWhite,
  };
}
