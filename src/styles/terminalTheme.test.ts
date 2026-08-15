import { describe, expect, it } from "vitest";
import { withAlpha } from "./terminalTheme";

describe("withAlpha", () => {
  it("adds an alpha channel to a computed rgb color", () => {
    expect(withAlpha("rgb(18, 52, 86)", 0.2)).toBe("rgba(18, 52, 86, 0.2)");
  });

  it("replaces the alpha of an rgba color", () => {
    expect(withAlpha("rgba(1, 2, 3, 0.9)", 0.5)).toBe("rgba(1, 2, 3, 0.5)");
  });

  it("passes through anything it does not recognize", () => {
    expect(withAlpha("#123456", 0.2)).toBe("#123456");
    expect(withAlpha("", 0.2)).toBe("");
  });
});
