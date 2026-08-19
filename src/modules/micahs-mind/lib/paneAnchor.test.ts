import { describe, expect, it, beforeEach } from "vitest";
import {
  attachPaneSession,
  freezePaneCity,
  paneCurrentSession,
  paneFrozenSnapshot,
  paneSessionHistory,
  resetPaneAnchors,
} from "./paneAnchor";

describe("paneAnchor (P4: a identidade do mapa é a pane, não o arquivo)", () => {
  beforeEach(() => resetPaneAnchors());

  it("attaches sessions and dedupes history", () => {
    attachPaneSession(1, "aaa");
    attachPaneSession(1, "bbb");
    attachPaneSession(1, "aaa");
    expect(paneCurrentSession(1)).toBe("aaa");
    expect(paneSessionHistory(1)).toEqual(["aaa", "bbb"]);
  });

  it("panes are independent: the history of one never leaks to another", () => {
    attachPaneSession(1, "aaa");
    attachPaneSession(2, "zzz");
    expect(paneSessionHistory(2)).toEqual(["zzz"]);
    expect(paneCurrentSession(2)).toBe("zzz");
  });

  it("freezing keeps the last city on record when the transcript dies", () => {
    attachPaneSession(7, "sess-1");
    freezePaneCity(7, "sess-1", 321, 1584);
    expect(paneFrozenSnapshot(7)).toEqual({
      sessionId: "sess-1",
      files: 321,
      events: 1584,
    });
    // re-attaching the same session keeps the freeze until a NEW session
    attachPaneSession(7, "sess-1");
    expect(paneFrozenSnapshot(7)).not.toBeNull();
    attachPaneSession(7, "sess-2");
    expect(paneFrozenSnapshot(7)).toBeNull();
    expect(paneSessionHistory(7)).toEqual(["sess-1", "sess-2"]);
  });
});
