import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceLeftPanelMode,
  isLeftPanelMode,
  LEFT_PANEL_MODE_LABELS,
  LEFT_PANEL_MODES,
  readLeftPanelMode,
  readLeftPanelOpen,
  writeLeftPanelMode,
  writeLeftPanelOpen,
} from "./mode";

describe("LEFT_PANEL_MODES", () => {
  it("is exactly the three modes, in the product's order", () => {
    expect(LEFT_PANEL_MODES).toEqual(["browser", "editor", "ai-viewer"]);
  });

  it("labels every mode", () => {
    expect(Object.keys(LEFT_PANEL_MODE_LABELS).sort()).toEqual(
      [...LEFT_PANEL_MODES].sort(),
    );
    expect(LEFT_PANEL_MODE_LABELS["ai-viewer"]).toBe("Ai Viewer");
  });
});

describe("isLeftPanelMode", () => {
  it("accepts the three modes and nothing else", () => {
    for (const mode of LEFT_PANEL_MODES) expect(isLeftPanelMode(mode)).toBe(true);
    for (const junk of ["", "Browser", "ai viewer", null, undefined, 3, {}]) {
      expect(isLeftPanelMode(junk)).toBe(false);
    }
  });
});

describe("coerceLeftPanelMode", () => {
  it("keeps a valid mode", () => {
    expect(coerceLeftPanelMode("editor", true)).toBe("editor");
    expect(coerceLeftPanelMode("ai-viewer", false)).toBe("ai-viewer");
  });

  it("falls back for junk, empty and wrong-cased input", () => {
    for (const junk of ["", "  ", "Browser", "nope", null, undefined, 7, {}]) {
      expect(coerceLeftPanelMode(junk, true)).toBe("browser");
      expect(coerceLeftPanelMode(junk, false)).toBe("editor");
    }
  });

  it("refuses browser when the browser panel is unavailable", () => {
    expect(coerceLeftPanelMode("browser", false)).toBe("editor");
    expect(coerceLeftPanelMode("browser", true)).toBe("browser");
  });
});

// The suite runs on plain node: there is no DOM environment in this repo, on
// purpose. A map-backed stand-in is enough, since the only contract that matters
// here is "what goes in comes back out, and is coerced on the way back".
const cells = new Map<string, string>();
const storage = {
  getItem: (k: string) => cells.get(k) ?? null,
  setItem: (k: string, v: string) => void cells.set(k, v),
};

describe("persistence", () => {
  beforeEach(() => {
    cells.clear();
    vi.stubGlobal("window", { localStorage: storage });
  });

  afterAll(() => {
    vi.unstubAllGlobals();
  });

  it("round-trips the mode", () => {
    writeLeftPanelMode("ai-viewer");
    expect(readLeftPanelMode(true)).toBe("ai-viewer");
  });

  it("coerces what it reads back, not only what it is given", () => {
    cells.set("micah.leftPanel.mode", "browser");
    expect(readLeftPanelMode(false)).toBe("editor");
    cells.set("micah.leftPanel.mode", "garbage");
    expect(readLeftPanelMode(true)).toBe("browser");
  });

  it("survives storage that throws, as private mode does", () => {
    vi.stubGlobal("window", {
      localStorage: {
        getItem() {
          throw new Error("denied");
        },
        setItem() {
          throw new Error("denied");
        },
      },
    });
    expect(() => writeLeftPanelMode("editor")).not.toThrow();
    expect(readLeftPanelMode(true)).toBe("browser");
    expect(readLeftPanelOpen()).toBe(true);
  });

  it("defaults the panel to open and round-trips closed", () => {
    expect(readLeftPanelOpen()).toBe(true);
    writeLeftPanelOpen(false);
    expect(readLeftPanelOpen()).toBe(false);
    writeLeftPanelOpen(true);
    expect(readLeftPanelOpen()).toBe(true);
  });
});
