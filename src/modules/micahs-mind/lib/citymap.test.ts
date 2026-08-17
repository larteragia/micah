import { describe, expect, it } from "vitest";
import {
  buildCityMap,
  type CityEntry,
  cleanRel,
  langForPath,
  placeGhost,
} from "./citymap";

function entry(rel: string, lines = 100): CityEntry {
  return { rel, lines };
}

describe("cleanRel", () => {
  it("normalizes separators and rejects escapes", () => {
    expect(cleanRel("src\\lib\\a.ts")).toBe("src/lib/a.ts");
    expect(cleanRel("./a.ts")).toBe("a.ts");
    expect(cleanRel("../a.ts")).toBe("");
    expect(cleanRel("/abs/a.ts")).toBe("");
    expect(cleanRel("")).toBe("");
  });
});

describe("langForPath", () => {
  it("maps extensions", () => {
    expect(langForPath("a/b.tsx")).toBe("typescript");
    expect(langForPath("a/b.rs")).toBe("rust");
    expect(langForPath("Makefile")).toBe("text");
    expect(langForPath("a/b.xyz")).toBe("xyz");
  });
});

describe("buildCityMap", () => {
  const entries: CityEntry[] = [
    entry("src/App.tsx", 400),
    entry("src/main.tsx", 50),
    entry("src/modules/left-panel/index.ts", 120),
    entry("package.json", 60),
    entry("README.md", 30),
  ];

  it("is deterministic: same input, byte-identical layout", () => {
    const a = buildCityMap({ root: "C:/repo", entries, touched: [] });
    const b = buildCityMap({ root: "C:/repo", entries, touched: [] });
    expect(b.files).toEqual(a.files);
    expect(b.dirs).toEqual(a.dirs);
  });

  it("fills the 120x120 world with non-overlapping, positive rects", () => {
    const city = buildCityMap({ root: "C:/repo", entries, touched: [] });
    for (const f of city.files) {
      expect(f.rect.w).toBeGreaterThan(0);
      expect(f.rect.d).toBeGreaterThan(0);
      expect(f.rect.x).toBeGreaterThanOrEqual(0);
      expect(f.rect.z).toBeGreaterThanOrEqual(0);
      expect(f.rect.x + f.rect.w).toBeLessThanOrEqual(120.0001);
      expect(f.rect.z + f.rect.d).toBeLessThanOrEqual(120.0001);
    }
    // siblings within the same dir must not overlap each other
    const byDir = new Map<string, typeof city.files>();
    for (const f of city.files) {
      const list = byDir.get(f.dir) ?? [];
      list.push(f);
      byDir.set(f.dir, list);
    }
    for (const list of byDir.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i].rect;
          const b = list[j].rect;
          const overlaps =
            a.x < b.x + b.w &&
            b.x < a.x + a.w &&
            a.z < b.z + b.d &&
            b.z < a.z + a.d;
          expect(overlaps).toBe(false);
        }
      }
    }
  });

  it("seats strong touched files first and ghosts for missing ones", () => {
    const city = buildCityMap({
      root: "C:/repo",
      entries,
      touched: [
        { path: "src/App.tsx", strong: true },
        { path: "docs/gone-card.md", strong: true },
        { path: "docs/weak-miss.md", strong: false },
      ],
    });
    const app = city.files.find((f) => f.path === "src/App.tsx");
    expect(app?.ghost).toBe(false);
    const ghost = city.files.find((f) => f.path === "docs/gone-card.md");
    expect(ghost?.ghost).toBe(true);
    expect(
      city.files.find((f) => f.path === "docs/weak-miss.md"),
    ).toBeUndefined();
    // touched existing seats even when the scan list is empty
    const tiny = buildCityMap({
      root: "C:/repo",
      entries: [],
      touched: [{ path: "src/App.tsx", strong: true }],
    });
    expect(tiny.files).toHaveLength(1);
    expect(tiny.files[0]?.ghost).toBe(true);
    // a failed scan never lies with ghosts: existence unknown seats real
    const noscan = buildCityMap({
      root: "C:/repo",
      entries: null,
      touched: [{ path: "src/App.tsx", strong: true }],
    });
    expect(noscan.files[0]?.ghost).toBe(false);
    expect(noscan.truncated).toBe(true);
  });

  it("larger files get larger rects", () => {
    const city = buildCityMap({ root: "C:/repo", entries, touched: [] });
    const app = city.files.find((f) => f.path === "src/App.tsx");
    const readme = city.files.find((f) => f.path === "README.md");
    expect((app?.rect.w ?? 0) * (app?.rect.d ?? 0)).toBeGreaterThan(
      (readme?.rect.w ?? 0) * (readme?.rect.d ?? 0),
    );
  });
});

describe("placeGhost", () => {
  it("places late ghosts inside the deepest known dir, deterministically", () => {
    const city = buildCityMap({
      root: "C:/repo",
      entries: [entry("src/App.tsx"), entry("src/lib/b.ts")],
      touched: [],
    });
    const a = placeGhost(city, "src/lib/late-ghost.ts");
    const b = placeGhost(city, "src/lib/late-ghost.ts");
    expect(a).toEqual(b);
    const libDir = city.dirs.find((d) => d.path === "src/lib");
    expect(libDir).toBeTruthy();
    if (!libDir) return;
    expect(a.x).toBeGreaterThanOrEqual(libDir.rect.x - 1);
    expect(a.x + a.w).toBeLessThanOrEqual(libDir.rect.x + libDir.rect.w + 1);
    expect(a.z).toBeGreaterThanOrEqual(libDir.rect.z - 1);
    expect(a.z + a.d).toBeLessThanOrEqual(libDir.rect.z + libDir.rect.d + 1);
  });
});
