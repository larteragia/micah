import { describe, expect, it } from "vitest";
import {
  buildCityMap,
  type CityEntry,
  cleanRel,
  langForPath,
  placeGhost,
  RADIAL_CENTER,
  RADIAL_MAX_R,
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

describe("buildCityMap (radial sunburst)", () => {
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

  it("seats every file on a ring inside the world, with a positive AABB", () => {
    const city = buildCityMap({ root: "C:/repo", entries, touched: [] });
    for (const f of city.files) {
      expect(f.polar.r).toBeGreaterThan(0);
      expect(f.polar.r).toBeLessThanOrEqual(RADIAL_MAX_R + 0.001);
      expect(f.polar.size).toBeGreaterThan(0);
      // AABB is the dot square around the polar position
      const cx = RADIAL_CENTER + Math.cos(f.polar.a) * f.polar.r;
      const cz = RADIAL_CENTER + Math.sin(f.polar.a) * f.polar.r;
      expect(f.rect.x + f.rect.w / 2).toBeCloseTo(cx, 6);
      expect(f.rect.z + f.rect.d / 2).toBeCloseTo(cz, 6);
      expect(f.rect.x).toBeGreaterThanOrEqual(0);
      expect(f.rect.z).toBeGreaterThanOrEqual(0);
      expect(f.rect.x + f.rect.w).toBeLessThanOrEqual(120.0001);
      expect(f.rect.z + f.rect.d).toBeLessThanOrEqual(120.0001);
    }
  });

  it("deeper files sit on outer rings and dirs own contiguous wedges", () => {
    const city = buildCityMap({ root: "C:/repo", entries, touched: [] });
    const rootFile = city.files.find((f) => f.path === "package.json");
    const deep = city.files.find(
      (f) => f.path === "src/modules/left-panel/index.ts",
    );
    expect(deep?.polar.r).toBeGreaterThan(rootFile?.polar.r ?? 0);
    const src = city.dirs.find((d) => d.path === "src");
    expect(src).toBeTruthy();
    if (src) {
      expect(src.polar.a1).toBeGreaterThan(src.polar.a0);
      expect(src.polar.r1).toBeGreaterThan(src.polar.r0);
      // files of src sit inside src's ring band
      for (const f of city.files.filter((x) => x.dir === "src")) {
        expect(f.polar.r).toBeGreaterThan(src.polar.r0);
        expect(f.polar.r).toBeLessThanOrEqual(src.polar.r1);
        const a = ((f.polar.a - src.polar.a0) % (Math.PI * 2) + Math.PI * 2) %
          (Math.PI * 2);
        expect(a).toBeLessThanOrEqual(src.polar.a1 - src.polar.a0 + 1e-9);
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
    const tiny = buildCityMap({
      root: "C:/repo",
      entries: [],
      touched: [{ path: "src/App.tsx", strong: true }],
    });
    expect(tiny.files).toHaveLength(1);
    expect(tiny.files[0]?.ghost).toBe(true);
    const noscan = buildCityMap({
      root: "C:/repo",
      entries: null,
      touched: [{ path: "src/App.tsx", strong: true }],
    });
    expect(noscan.files[0]?.ghost).toBe(false);
    expect(noscan.truncated).toBe(true);
  });

  it("heavier files get bigger nodes", () => {
    const city = buildCityMap({ root: "C:/repo", entries, touched: [] });
    const app = city.files.find((f) => f.path === "src/App.tsx");
    const readme = city.files.find((f) => f.path === "README.md");
    expect(app?.polar.size).toBeGreaterThan(readme?.polar.size ?? 0);
  });
});

describe("placeGhost", () => {
  it("places late ghosts at the outer edge of the deepest dir wedge, deterministically", () => {
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
    const cx = a.x + a.w / 2;
    const cz = a.z + a.d / 2;
    const r = Math.hypot(cx - RADIAL_CENTER, cz - RADIAL_CENTER);
    expect(r).toBeGreaterThanOrEqual(libDir.polar.r1);
    expect(r).toBeLessThanOrEqual(RADIAL_MAX_R + 1.5);
    const ang = Math.atan2(cz - RADIAL_CENTER, cx - RADIAL_CENTER);
    const span = libDir.polar.a1 - libDir.polar.a0;
    const rel = ((ang - libDir.polar.a0) % (Math.PI * 2) + Math.PI * 2) %
      (Math.PI * 2);
    expect(rel).toBeLessThanOrEqual(Math.min(span + 1e-6, Math.PI * 2));
  });
});
