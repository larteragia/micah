/**
 * Tests for the mind feed helpers. mapScanFiles pins the fs_list_files
 * contract: paths come RELATIVE to the scanned root (search.rs strips it),
 * so a full-root scan maps directly and a subdir scan re-prefixes the
 * subdir's path inside the root. Absolute or escaping junk is dropped.
 */

import { describe, expect, it } from "vitest";
import { mapScanFiles, touchedTopDirs } from "./useMindFeed";

describe("mapScanFiles", () => {
  const ROOT = "C:/Users/Zigfriad/projetos/micah";

  it("maps full-root scan files (REL to the root) directly", () => {
    const out = mapScanFiles(ROOT, ROOT, [
      "package.json",
      "src/main.tsx",
      "docs/card.md",
    ]);
    expect(out.map((e) => e.rel)).toEqual([
      "package.json",
      "src/main.tsx",
      "docs/card.md",
    ]);
  });

  it("re-prefixes subdir scans with the subdir path inside the root", () => {
    const out = mapScanFiles(ROOT, `${ROOT}/src`, ["main.tsx", "lib/util.ts"]);
    expect(out.map((e) => e.rel)).toEqual(["src/main.tsx", "src/lib/util.ts"]);
  });

  it("accepts windows-style scanned roots and files", () => {
    const out = mapScanFiles(
      "C:\\Users\\Zigfriad\\projetos\\micah",
      "C:\\Users\\Zigfriad\\projetos\\micah\\src",
      ["main.tsx"],
    );
    expect(out.map((e) => e.rel)).toEqual(["src/main.tsx"]);
  });

  it("drops absolute and escaping paths (cleanRel contract)", () => {
    const out = mapScanFiles(ROOT, ROOT, [
      "C:/elsewhere/x.ts",
      "../escape.ts",
      "./dot.ts",
      "",
      "ok.ts",
    ]);
    expect(out.map((e) => e.rel)).toEqual(["dot.ts", "ok.ts"]);
  });

  it("drops scan roots that are not inside the root (no empty prefix lie)", () => {
    const out = mapScanFiles(ROOT, "D:/other/repo", ["a.ts"]);
    // The scan root is outside the city root: mapping would need a prefix
    // outside the repo, so nothing is seated rather than seating a lie.
    expect(out).toEqual([]);
  });
});

describe("touchedTopDirs", () => {
  it("collects top-level dirs in first-seen order, ignoring root files", () => {
    expect(
      touchedTopDirs(["src/a.ts", "docs/b.md", "src/c.ts", "top.ts"]),
    ).toEqual(["src", "docs"]);
  });
});
