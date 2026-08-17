/**
 * Tests for the Micah's Mind trace pipeline against the transcript shapes
 * observed in real ~/.claude/projects sessions (user content as string,
 * tool_result content as string or block array, injected envelopes,
 * system/compact records, attachment and mode records to ignore).
 */

import { describe, expect, it } from "vitest";
import {
  actionFor,
  commandReadPaths,
  contentToString,
  extractPaths,
  normalizePath,
  searchCommand,
  verifyCommand,
} from "./classify";
import { emptyMindFold, foldMindLines, type MindFold } from "./foldTrace";
import {
  injectedUserMessage,
  parseSessionLine,
  userMessageNote,
} from "./parseSession";

const CWD = "C:\\Users\\Zigfriad\\projetos\\micah";
const HOME = "C:/Users/Zigfriad";
const CTX = { cwd: CWD, home: HOME };

function line(patch: Record<string, unknown>): string {
  return JSON.stringify(patch);
}

describe("parseSessionLine", () => {
  it("reads user content as string into a user-text mark source", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        message: {
          role: "user",
          content: "mindhorse é o nome antigo, agora é Micah's Mind",
        },
        cwd: CWD,
        timestamp: "2026-08-17T12:00:00.000Z",
      }),
    );
    expect(parsed.kind).toBe("user-text");
    if (parsed.kind !== "user-text") return;
    expect(parsed.note).toContain("Micah's Mind");
    expect(parsed.cwd).toBe(CWD);
  });

  it("drops harness-injected markup envelopes from user marks", () => {
    const injected = line({
      type: "user",
      message: {
        role: "user",
        content:
          "<task-notification>\n<task-id>abc</task-id>\nAgent finished\n</task-notification>",
      },
    });
    const parsed = parseSessionLine(injected);
    // Injected text never becomes a user-text line, but blocks still flow
    // so tool_results inside are not lost.
    expect(parsed.kind).not.toBe("user-text");
    expect(injectedUserMessage("<a>\nxx\n</a>")).toBe(true);
    expect(injectedUserMessage("# AGENTS.md instructions\nfoo")).toBe(true);
    // A real task that starts with JSX-ish text but is a question must pass.
    expect(injectedUserMessage("<div>por que quebrou?</div> e agora?")).toBe(
      false,
    );
  });

  it("detects compaction by system subtype", () => {
    expect(
      parseSessionLine(line({ type: "system", subtype: "compact-boundary" }))
        .kind,
    ).toBe("compaction");
    expect(
      parseSessionLine(line({ type: "system", subtype: "turn-duration" })).kind,
    ).toBe("ignored");
  });

  it("captures ai-title and ignores bookkeeping records", () => {
    expect(
      parseSessionLine(line({ type: "ai-title", aiTitle: "Mindhorse port" }))
        .kind,
    ).toBe("ai-title");
    for (const type of [
      "mode",
      "permission-mode",
      "file-history-snapshot",
      "file-history-delta",
      "attachment",
      "queue-operation",
      "last-prompt",
    ]) {
      expect(parseSessionLine(line({ type })).kind).toBe("ignored");
    }
    expect(parseSessionLine("{broken json").kind).toBe("ignored");
  });

  it("keeps tool_result blocks from array content", () => {
    const parsed = parseSessionLine(
      line({
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
          ],
        },
      }),
    );
    expect(parsed.kind).toBe("message");
    if (parsed.kind !== "message") return;
    expect(parsed.blocks[0]?.tool_use_id).toBe("toolu_1");
  });

  it("truncates user notes to 2000 runes with marker", () => {
    const note = userMessageNote("a".repeat(3000));
    expect(Array.from(note).length).toBe(2000);
    expect(note.endsWith("…")).toBe(true);
  });
});

describe("contentToString", () => {
  it("handles string, block arrays with tool_reference and nested content", () => {
    expect(contentToString("plain")).toBe("plain");
    expect(
      contentToString([
        { type: "text", text: "alpha" },
        { type: "tool_reference", name: "thing" },
      ]),
    ).toBe("alpha");
    expect(contentToString([{ type: "tool_result", content: "beta" }])).toBe(
      "beta",
    );
    expect(contentToString(undefined)).toBe("");
  });
});

describe("normalizePath", () => {
  it("makes windows absolute paths repo-relative", () => {
    const n = normalizePath(
      "C:\\Users\\Zigfriad\\projetos\\micah\\src\\App.tsx",
      CTX,
    );
    expect(n).toEqual({ rel: "src/App.tsx" });
  });

  it("keeps repo-relative paths and rejects escapes", () => {
    expect(normalizePath("src/lib/x.ts", CTX)).toEqual({ rel: "src/lib/x.ts" });
    expect(normalizePath("../outside.ts", CTX)).toBeNull();
    expect(normalizePath("http://example.com/a.ts", CTX)).toBeNull();
  });

  it("marks paths outside the repo as outside touches with scope", () => {
    const desk = normalizePath("C:\\Users\\Zigfriad\\Desktop\\06.jpg", CTX);
    expect(desk).toEqual({
      outside: { scope: "home", path: "C:/Users/Zigfriad/Desktop/06.jpg" },
    });
    const other = normalizePath("D:\\repo\\other.ts", CTX);
    expect(other).toEqual({
      outside: { scope: "other", path: "D:/repo/other.ts" },
    });
  });
});

describe("actionFor and command grading", () => {
  it("classifies the Claude Code tool set", () => {
    expect(actionFor("Read", { file_path: "a.ts" }, "")).toBe("read");
    expect(actionFor("Edit", { file_path: "a.ts" }, "")).toBe("edit");
    expect(actionFor("Glob", { pattern: "*" }, "")).toBe("search");
    expect(actionFor("TaskCreate", {}, "")).toBe("other");
  });

  it("grades shell commands: verify, search, read, exec", () => {
    expect(verifyCommand("pnpm -C . test")).toBe(true);
    expect(actionFor("Bash", { command: "pnpm -C . test" }, "")).toBe("verify");
    expect(actionFor("Bash", { command: "rg pattern src | head -5" }, "")).toBe(
      "search",
    );
    expect(actionFor("Bash", { command: "cat src/App.tsx" }, "")).toBe("read");
    expect(actionFor("Bash", { command: "npm install" }, "")).toBe("exec");
    // Lint runs that write files are edits, never verification.
    expect(
      actionFor("Bash", { command: "pnpm exec biome check --write src" }, ""),
    ).toBe("exec");
    expect(actionFor("Bash", { command: "cargo test --locked" }, "")).toBe(
      "verify",
    );
    // find with -exec mutates: stays out of search
    expect(searchCommand("find . -name x -exec rm {} ;")).toBe(false);
    expect(commandReadPaths("cat src/a.ts src/b.ts")).toEqual([
      "src/a.ts",
      "src/b.ts",
    ]);
  });
});

describe("extractPaths", () => {
  it("finds slash paths but not bare filenames, sorted like the port", () => {
    expect(extractPaths("see src/a.ts and docs/b.md here")).toEqual([
      "docs/b.md",
      "src/a.ts",
    ]);
    expect(extractPaths("file.txt at top level")).toEqual([]);
  });
});

describe("foldMindLines", () => {
  const base = {
    sessionId: "s1",
    cwd: CWD,
    timestamp: "2026-08-17T12:00:00.000Z",
  };

  function foldLines(
    lines: string[],
    fold: MindFold = emptyMindFold("s1"),
  ): MindFold {
    return foldMindLines(fold, lines, CTX);
  }

  it("produces marks and events from a realistic mini session", () => {
    const fold = foldLines([
      line({
        ...base,
        type: "user",
        message: { role: "user", content: "port the mind" },
      }),
      line({
        ...base,
        type: "assistant",
        message: {
          role: "assistant",
          model: "glm-5.3",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "Read",
              input: {
                file_path: "C:\\Users\\Zigfriad\\projetos\\micah\\package.json",
              },
            },
          ],
        },
      }),
      line({
        ...base,
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t1",
              content: [{ type: "text", text: '{ "name": "micah" }' }],
            },
          ],
        },
      }),
      line({
        ...base,
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t2",
              name: "Edit",
              input: {
                file_path: "C:\\Users\\Zigfriad\\projetos\\micah\\src\\App.tsx",
                old_string: "a",
                new_string: "b",
              },
            },
            {
              type: "tool_use",
              id: "t3",
              name: "Agent",
              input: { description: "audit the plan" },
            },
          ],
        },
      }),
      line({ ...base, type: "system", subtype: "compact-boundary" }),
      line({
        ...base,
        type: "user",
        message: {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "t2",
              content: "applied",
              is_error: false,
            },
            {
              type: "tool_result",
              tool_use_id: "t3",
              content: "agent done",
              is_error: true,
            },
          ],
        },
      }),
    ]);

    expect(fold.session.model).toBe("glm-5.3");
    expect(fold.session.cwd).toBe(CWD);
    expect(fold.events.map((e) => e.toolUseId)).toEqual(["t1", "t2", "t3"]);
    expect(fold.events[0]).toMatchObject({
      settled: true,
      action: "read",
      outcomeKnown: true,
    });
    expect(fold.events[0]?.targets[0]).toMatchObject({
      path: "package.json",
      touch: "read",
    });
    expect(fold.events[1]?.targets[0]).toMatchObject({
      path: "src/App.tsx",
      touch: "edit",
    });
    expect(fold.events[2]?.isError).toBe(true);
    const markTypes = fold.marks.map((m) => m.type);
    expect(markTypes).toContain("user-message");
    expect(markTypes).toContain("subagent");
    expect(markTypes).toContain("compaction");
    expect(fold.stats.userTurns).toBe(1);
    expect(fold.stats.subagents).toBe(1);
    expect(fold.stats.compactions).toBe(1);
    expect(fold.stats.edited).toBe(1);
    expect(fold.stats.fovea).toBe(2);
    expect(fold.stats.errorRate).toBeCloseTo(1 / 3);
    expect(fold.touched.get("src/App.tsx")).toMatchObject({
      touch: "edit",
      count: 1,
    });
  });

  it("creates provisional events and settles them across fold calls", () => {
    const fold = emptyMindFold("s2");
    foldMindLines(
      fold,
      [
        line({
          ...base,
          sessionId: "s2",
          type: "assistant",
          message: {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "t9",
                name: "Bash",
                input: { command: "pnpm -C . test" },
              },
            ],
          },
        }),
      ],
      CTX,
    );
    const provisional = fold.events[0];
    expect(provisional).toMatchObject({
      settled: false,
      outcomeKnown: false,
      action: "verify",
    });
    expect(fold.stats.actions.verify).toBe(1);

    foldMindLines(
      fold,
      [
        line({
          ...base,
          sessionId: "s2",
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "tool_result", tool_use_id: "t9", content: "all green" },
            ],
          },
        }),
      ],
      CTX,
    );
    expect(fold.events[0]).toMatchObject({
      settled: true,
      outcomeKnown: true,
      resultBytes: "all green".length,
      isError: false,
    });
    expect(fold.events.length).toBe(1);
  });

  it("is idempotent when lines are re-delivered (offset regression safety)", () => {
    const lines = [
      line({
        ...base,
        type: "user",
        message: { role: "user", content: "do the thing" },
      }),
      line({
        ...base,
        type: "system",
        subtype: "compact-boundary",
      }),
      line({
        ...base,
        type: "assistant",
        message: {
          role: "assistant",
          content: [
            {
              type: "tool_use",
              id: "t1",
              name: "Read",
              input: { file_path: "src/a.ts" },
            },
            { type: "tool_use", id: "t2", name: "Agent", input: {} },
          ],
        },
      }),
      line({
        ...base,
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "t1", content: "x" },
            { type: "tool_result", tool_use_id: "t2", content: "done" },
          ],
        },
      }),
    ];
    const fold = foldLines(lines);
    const before = {
      events: fold.events.length,
      userTurns: fold.stats.userTurns,
      compactions: fold.stats.compactions,
      subagents: fold.stats.subagents,
      actions: { ...fold.stats.actions },
    };
    foldLines(lines, fold);
    expect(fold.events.length).toBe(before.events);
    expect(fold.stats.userTurns).toBe(before.userTurns);
    expect(fold.stats.compactions).toBe(before.compactions);
    expect(fold.stats.subagents).toBe(before.subagents);
    expect(fold.stats.actions).toEqual(before.actions);
  });

  it("does not downgrade a settled event when its result is re-delivered alone", () => {
    const fold = emptyMindFold("s3");
    const use = line({
      ...base,
      sessionId: "s3",
      type: "assistant",
      message: {
        role: "assistant",
        content: [
          {
            type: "tool_use",
            id: "t1",
            name: "Bash",
            input: { command: "pnpm -C . test" },
          },
        ],
      },
    });
    const result = line({
      ...base,
      sessionId: "s3",
      type: "user",
      message: {
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }],
      },
    });
    foldMindLines(fold, [use, result], CTX);
    expect(fold.events[0]?.action).toBe("verify");
    // Result re-delivered after the pending call was consumed: the settled
    // classification (full input) must survive (auditor finding 2).
    foldMindLines(fold, [result], CTX);
    expect(fold.events[0]?.action).toBe("verify");
    expect(fold.events[0]?.summary).toContain("pnpm -C . test");
    expect(fold.events.length).toBe(1);
  });

  it("ignores tool_results without a known call", () => {
    const fold = foldLines([
      line({
        ...base,
        type: "user",
        message: {
          role: "user",
          content: [
            { type: "tool_result", tool_use_id: "ghost", content: "x" },
          ],
        },
      }),
    ]);
    expect(fold.events.length).toBe(0);
  });
});
