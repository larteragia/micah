import {
  clearClaudeResume,
  peekClaudeResume,
} from "@/modules/terminal/lib/claudeResume";
import { findLeafResume } from "@/modules/terminal/lib/panes";
import type { Tab } from "@/modules/tabs";
import { invoke } from "@tauri-apps/api/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  collectResumeLeaves,
  dropResumeLeaves,
  prepareClaudeResumes,
} from "./claudeResumeBoot";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn() }));
const invokeMock = vi.mocked(invoke);

const UUID_A = "3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42";
const UUID_B = "94144000-8101-401c-808b-f7c2291aa747";

function term(
  id: number,
  leafId: number,
  resume?: string,
  spaceId = "s1",
): Tab {
  return {
    id,
    kind: "terminal",
    spaceId,
    title: "shell",
    paneTree: { kind: "leaf", id: leafId, cwd: "/a", ...(resume && { resume }) },
    activeLeafId: leafId,
  } as Tab;
}

afterEach(() => {
  invokeMock.mockReset();
  for (const leafId of [11, 21, 31]) clearClaudeResume(leafId);
});

describe("collectResumeLeaves", () => {
  it("collects only leaves carrying a valid anchor", () => {
    const tabs = [
      term(1, 11, UUID_A),
      term(2, 21),
      term(3, 31, "not-a-uuid"),
    ];
    expect(collectResumeLeaves(tabs)).toEqual([
      { leafId: 11, spaceId: "s1", sessionId: UUID_A },
    ]);
  });
});

describe("dropResumeLeaves", () => {
  it("strips anchors for dead leaves and keeps identity otherwise", () => {
    const tabs = [term(1, 11, UUID_A), term(2, 21, UUID_B)];
    const out = dropResumeLeaves(tabs, new Set([11]));
    const t1 = out[0];
    const t2 = out[1];
    if (t1.kind !== "terminal" || t2.kind !== "terminal")
      throw new Error("bad shape");
    expect(findLeafResume(t1.paneTree, 11)).toBeUndefined();
    expect(findLeafResume(t2.paneTree, 21)).toBe(UUID_B);
    expect(t2).toBe(tabs[1]);
    expect(dropResumeLeaves(tabs, new Set())).toBe(tabs);
  });
});

describe("prepareClaudeResumes", () => {
  it("queues anchors whose transcript exists and prunes the dead", async () => {
    invokeMock.mockImplementation((_cmd, args) => {
      const { pattern } = args as { pattern: string };
      return Promise.resolve({
        hits: pattern.includes(UUID_A) ? [{ path: "x", rel: "y" }] : [],
      });
    });
    const tabs = [term(1, 11, UUID_A), term(2, 21, UUID_B)];
    const out = await prepareClaudeResumes(tabs, "C:/Users/x", () => true);
    expect(peekClaudeResume(11)).toBe(UUID_A);
    expect(peekClaudeResume(21)).toBeNull();
    const t2 = out[1];
    if (t2.kind !== "terminal") throw new Error("bad shape");
    expect(findLeafResume(t2.paneTree, 21)).toBeUndefined();
  });

  it("keeps anchors alive when the glob fails for unknown reasons", async () => {
    invokeMock.mockRejectedValue(new Error("walk exploded"));
    const tabs = [term(1, 11, UUID_A)];
    const out = await prepareClaudeResumes(tabs, "C:/Users/x", () => true);
    expect(peekClaudeResume(11)).toBe(UUID_A);
    expect(out).toBe(tabs);
  });

  it("prunes everything when the projects dir does not exist", async () => {
    invokeMock.mockRejectedValue("not a directory: C:/Users/x/.claude/projects");
    const tabs = [term(1, 11, UUID_A)];
    await prepareClaudeResumes(tabs, "C:/Users/x", () => true);
    expect(peekClaudeResume(11)).toBeNull();
  });

  it("skips the transcript check for non-local spaces but still queues", async () => {
    const tabs = [term(1, 11, UUID_A, "wsl-space")];
    const out = await prepareClaudeResumes(tabs, "C:/Users/x", () => false);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(peekClaudeResume(11)).toBe(UUID_A);
    expect(out).toBe(tabs);
  });

  it("queues without pruning when home is unknown", async () => {
    const tabs = [term(1, 11, UUID_A)];
    await prepareClaudeResumes(tabs, null, () => true);
    expect(invokeMock).not.toHaveBeenCalled();
    expect(peekClaudeResume(11)).toBe(UUID_A);
  });
});
