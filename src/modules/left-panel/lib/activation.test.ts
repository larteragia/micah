import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  coerceAiViewerActive,
  readAiViewerActive,
  writeAiViewerActive,
} from "./activation";

describe("coerceAiViewerActive", () => {
  it("only the exact stored flag turns the viewer on", () => {
    expect(coerceAiViewerActive("1")).toBe(true);
    for (const junk of ["", "0", "true", "on", null, undefined, 1, {}]) {
      expect(coerceAiViewerActive(junk)).toBe(false);
    }
  });
});

// Same map-backed stand-in as mode.test.ts: the suite runs on plain node.
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

  it("defaults to off: watching is an explicit choice", () => {
    expect(readAiViewerActive()).toBe(false);
  });

  it("round-trips on and off", () => {
    writeAiViewerActive(true);
    expect(readAiViewerActive()).toBe(true);
    writeAiViewerActive(false);
    expect(readAiViewerActive()).toBe(false);
  });

  it("survives storage that throws, staying off", () => {
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
    expect(() => writeAiViewerActive(true)).not.toThrow();
    expect(readAiViewerActive()).toBe(false);
  });
});
