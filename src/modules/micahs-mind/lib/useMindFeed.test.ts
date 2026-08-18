/**
 * Tests for the mind feed helpers. mapScanFiles pins the fs_list_files
 * contract: paths come RELATIVE to the scanned root (search.rs strips it),
 * so a full-root scan maps directly and a subdir scan re-prefixes the
 * subdir's path inside the root. Absolute or escaping junk is dropped.
 */

import { describe, expect, it } from "vitest";
import {
  absentStatus,
  composePick,
  mapScanFiles,
  touchedTopDirs,
  type MindSessionPick,
} from "./useMindFeed";

describe("absentStatus (critério 4: nunca branco)", () => {
  it("a synced session whose transcript vanished is missing, not absent", () => {
    expect(absentStatus(true)).toBe("missing");
  });
  it("a session never seen is just absent", () => {
    expect(absentStatus(false)).toBe("absent");
  });
});

describe("composePick (âncora > manual > auto)", () => {
  const anchored: MindSessionPick = { session: "aaa", why: "focused-leaf" };
  const none: MindSessionPick = { session: null, why: "none" };

  it("real anchor beats manual and auto", () => {
    expect(composePick(anchored, "bbb", { session: "ccc", forCwd: "x" }))
      .toEqual(anchored);
  });
  it("manual beats auto when nothing is anchored", () => {
    expect(composePick(none, "bbb", { session: "ccc", forCwd: "x" })).toEqual({
      session: "bbb",
      why: "manual",
    });
  });
  it("auto connects only when anchor and manual are absent", () => {
    expect(composePick(none, null, { session: "ccc", forCwd: "x" })).toEqual({
      session: "ccc",
      why: "auto-recent",
    });
  });
  it("auto without a found session keeps the honest empty verdict", () => {
    expect(composePick(none, null, { session: null, forCwd: "x" })).toEqual(
      none,
    );
    expect(composePick(none, null, null)).toEqual(none);
  });
  it("ambiguous stays ambiguous: auto never guesses over pane rules", () => {
    const amb: MindSessionPick = { session: null, why: "ambiguous" };
    expect(composePick(amb, null, { session: "z", forCwd: "x" })).toEqual(amb);
    // A manual choice still resolves the ambiguity: the user picked.
    expect(composePick(amb, "m", null)).toEqual({
      session: "m",
      why: "manual",
    });
  });
});

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
