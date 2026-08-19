/**
 * Tests for the surviving session-selection helpers (the live feed and its
 * scan mapping died with the card mindwalk-real-no-micahs-mind-2026-08-19;
 * the mindwalk sidecar owns parsing and rendering now).
 */

import { describe, expect, it } from "vitest";
import {
  absentStatus,
  composePick,
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
  it("ambiguous no longer blocks the auto-connect: replay badge labels it", () => {
    const amb: MindSessionPick = { session: null, why: "ambiguous" };
    // Two anchored panes with no focus: the freshest labeled session beats
    // an empty panel (user reported exactly this as "não aparece nada").
    expect(composePick(amb, null, { session: "z", forCwd: "x" })).toEqual({
      session: "z",
      why: "auto-recent",
    });
    // A manual choice still wins over auto.
    expect(composePick(amb, "m", { session: "z", forCwd: "x" })).toEqual({
      session: "m",
      why: "manual",
    });
    // A real anchor still wins over everything.
    const anchored: MindSessionPick = { session: "live", why: "focused-leaf" };
    expect(
      composePick(anchored, "m", { session: "z", forCwd: "x" }),
    ).toEqual(anchored);
  });
});
