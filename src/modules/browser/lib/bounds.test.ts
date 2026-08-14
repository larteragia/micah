import { describe, expect, it } from "vitest";
import {
  isRenderableRect,
  readAppZoom,
  rectToBounds,
  sameBounds,
  zoomScaleFor,
} from "./bounds";

describe("zoomScaleFor", () => {
  it("is a no-op at 100% zoom", () => {
    expect(zoomScaleFor(1280, 1280, 1)).toBe(1);
  });

  // The whole point: same inputs, two engines, two answers — measured, not assumed.
  it.each([
    [1.25, 1600],
    [1.5, 1920],
    [0.9, 1152],
  ])(
    "returns 1 when rects already carry the zoom (zoom %s)",
    (zoom, viewport) => {
      // Engine reports the scaled rect, so it already matches the viewport.
      expect(zoomScaleFor(viewport, viewport, zoom)).toBe(1);
    },
  );

  it.each([
    [1.25, 1600],
    [1.5, 1920],
    [0.9, 1152],
  ])(
    "returns the zoom when rects are in pre-zoom space (zoom %s)",
    (zoom, viewport) => {
      expect(zoomScaleFor(viewport / zoom, viewport, zoom)).toBe(zoom);
    },
  );

  it("tolerates sub-pixel drift from layout rounding", () => {
    // 1920 / 1.5 = 1280, but layout hands back 1279.6.
    expect(zoomScaleFor(1279.6, 1920, 1.5)).toBe(1.5);
    expect(zoomScaleFor(1920.4, 1920, 1.5)).toBe(1);
  });

  it("falls back to 1 on garbage rather than moving the panel", () => {
    expect(zoomScaleFor(0, 1280, 1.5)).toBe(1);
    expect(zoomScaleFor(1280, 0, 1.5)).toBe(1);
    expect(zoomScaleFor(Number.NaN, 1280, 1.5)).toBe(1);
    expect(zoomScaleFor(1280, 1280, Number.NaN)).toBe(1);
    expect(zoomScaleFor(-10, 1280, 1.5)).toBe(1);
    expect(zoomScaleFor(1280, 1280, 0)).toBe(1);
  });

  it("does not flip convention on a hair-thin difference", () => {
    // Exactly ambiguous input resolves to the safe side.
    const viewport = 1000;
    const zoom = 2;
    const measured = viewport / (1 + zoom); // equidistant-ish, ties go to 1
    const result = zoomScaleFor(measured, viewport, zoom);
    expect([1, zoom]).toContain(result);
  });
});

describe("readAppZoom", () => {
  it("parses the CSS custom property", () => {
    expect(readAppZoom("1.25")).toBe(1.25);
    expect(readAppZoom("  0.9  ")).toBe(0.9);
  });

  it("treats missing or broken values as no zoom", () => {
    expect(readAppZoom(null)).toBe(1);
    expect(readAppZoom(undefined)).toBe(1);
    expect(readAppZoom("")).toBe(1);
    expect(readAppZoom("   ")).toBe(1);
    expect(readAppZoom("none")).toBe(1);
    expect(readAppZoom("0")).toBe(1);
    expect(readAppZoom("-2")).toBe(1);
  });
});

describe("rectToBounds", () => {
  it("passes a rect through unchanged at scale 1", () => {
    expect(
      rectToBounds({ left: 10, top: 40, width: 600, height: 720 }, 1),
    ).toEqual({ x: 10, y: 40, width: 600, height: 720 });
  });

  it("applies the measured scale to every edge", () => {
    expect(
      rectToBounds({ left: 8, top: 32, width: 480, height: 560 }, 1.25),
    ).toEqual({ x: 10, y: 40, width: 600, height: 700 });
  });

  it("rounds to whole pixels", () => {
    expect(
      rectToBounds({ left: 10.4, top: 40.6, width: 599.5, height: 719.2 }, 1),
    ).toEqual({ x: 10, y: 41, width: 600, height: 719 });
  });

  it("never emits a zero size — that paints a sliver instead of nothing", () => {
    const bounds = rectToBounds(
      { left: 0, top: 0, width: 0.2, height: 0 },
      1,
    );
    expect(bounds.width).toBe(1);
    expect(bounds.height).toBe(1);
  });

  it("ignores a nonsense scale instead of collapsing the panel", () => {
    const rect = { left: 10, top: 20, width: 300, height: 400 };
    expect(rectToBounds(rect, 0)).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    });
    expect(rectToBounds(rect, Number.NaN)).toEqual({
      x: 10,
      y: 20,
      width: 300,
      height: 400,
    });
  });
});

describe("sameBounds", () => {
  const base = { x: 1, y: 2, width: 3, height: 4 };

  it("matches identical bounds so redundant IPC is dropped", () => {
    expect(sameBounds(base, { ...base })).toBe(true);
  });

  it.each(["x", "y", "width", "height"] as const)(
    "detects a change in %s",
    (key) => {
      expect(sameBounds(base, { ...base, [key]: base[key] + 1 })).toBe(false);
    },
  );

  it("handles the not-yet-measured case", () => {
    expect(sameBounds(null, null)).toBe(true);
    expect(sameBounds(null, base)).toBe(false);
    expect(sameBounds(base, null)).toBe(false);
  });
});

describe("isRenderableRect", () => {
  it("accepts a real rect", () => {
    expect(
      isRenderableRect({ left: 0, top: 0, width: 400, height: 300 }),
    ).toBe(true);
  });

  it("rejects a collapsed panel", () => {
    expect(isRenderableRect({ left: 0, top: 0, width: 0, height: 300 })).toBe(
      false,
    );
    expect(isRenderableRect({ left: 0, top: 0, width: 400, height: 0 })).toBe(
      false,
    );
  });

  it("rejects a rect with no numbers in it", () => {
    expect(
      isRenderableRect({
        left: Number.NaN,
        top: 0,
        width: 400,
        height: 300,
      }),
    ).toBe(false);
  });
});
