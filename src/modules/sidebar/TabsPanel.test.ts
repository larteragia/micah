import type { Tab } from "@/modules/tabs";
import { describe, expect, it } from "vitest";
import { matchesTabQuery, shortenPath, tabSubtitle } from "./TabsPanel";

const HOME = "C:\\Users\\Zigfriad";

function terminal(id: number, cwd: string, customTitle?: string): Tab {
  return {
    id,
    kind: "terminal",
    spaceId: "default",
    title: "shell",
    cwd,
    customTitle,
    paneTree: { kind: "leaf", id },
    activeLeafId: id,
  } as unknown as Tab;
}

describe("shortenPath", () => {
  it("collapses the home prefix to ~", () => {
    expect(shortenPath("C:\\Users\\Zigfriad", HOME)).toBe("~");
    expect(shortenPath("C:\\Users\\Zigfriad\\projetos\\micah", HOME)).toBe(
      "~/projetos/micah",
    );
  });

  it("leaves paths outside home alone, normalized to forward slashes", () => {
    expect(shortenPath("D:\\work\\repo", HOME)).toBe("D:/work/repo");
    expect(shortenPath("/var/log", null)).toBe("/var/log");
  });

  it("does not treat a sibling directory as being inside home", () => {
    expect(shortenPath("C:\\Users\\ZigfriadOther", HOME)).toBe(
      "C:/Users/ZigfriadOther",
    );
  });
});

describe("tabSubtitle", () => {
  it("uses the cwd of a terminal tab", () => {
    expect(tabSubtitle(terminal(1, "C:\\Users\\Zigfriad\\projetos"), HOME)).toBe(
      "~/projetos",
    );
  });
});

describe("matchesTabQuery", () => {
  const tab = terminal(1, "C:\\Users\\Zigfriad\\projetos\\micah");

  it("matches everything on an empty query", () => {
    expect(matchesTabQuery(tab, HOME, "   ")).toBe(true);
  });

  it("matches the label", () => {
    expect(matchesTabQuery(tab, HOME, "MIC")).toBe(true);
  });

  it("matches the subtitle path", () => {
    expect(matchesTabQuery(tab, HOME, "projetos")).toBe(true);
  });

  it("rejects a miss", () => {
    expect(matchesTabQuery(tab, HOME, "nope")).toBe(false);
  });
});
