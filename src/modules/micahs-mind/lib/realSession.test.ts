/**
 * Real-transcript validation for the fold: runs against the live session
 * JSONL of this very machine when it exists, and skips anywhere else. Counts
 * are computed independently here (raw JSON scan) and must match the fold.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { emptyMindFold, foldMindLines } from "./foldTrace";

const SESSION = join(
  homedir(),
  ".claude-micah",
  "projects",
  "C--",
  "c05cf414-13ad-42cf-81a6-f471679a9e36.jsonl",
);

const skip = !existsSync(SESSION);
const d = describe.skipIf(skip);

/**
 * Raw block view for the hand count: deliberately NOT the module's own
 * helpers, so the count stays independent of the code under test (auditor
 * finding 11: a circular hand count cannot catch parser bugs).
 */
type RawBlock = {
  type?: unknown;
  id?: unknown;
  name?: unknown;
  text?: unknown;
};

function blocksOf(content: unknown): RawBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content as RawBlock[];
}

function rawUserText(blocks: RawBlock[]): string {
  return blocks
    .filter(
      (b) =>
        b.type === "text" && typeof b.text === "string" && b.text.trim() !== "",
    )
    .map((b) => (b.text as string).trim())
    .join("\n");
}

function rawIsInjected(text: string): boolean {
  const t = text.trim();
  if (t.startsWith("# AGENTS.md instructions")) return true;
  return t.startsWith("<") && t.endsWith(">");
}

function rawHasUserMessage(blocks: RawBlock[]): boolean {
  for (const b of blocks) {
    if (b.type === "tool_result") return false;
  }
  return true;
}

d("fold against the live transcript", () => {
  const lines = readFileSync(SESSION, "utf8")
    .split("\n")
    .filter((l) => l.trim() !== "");

  // Independent hand count from the raw records.
  let toolUses = 0;
  let userTurns = 0;
  let compactions = 0;
  let subagents = 0;
  for (const line of lines) {
    let rec: Record<string, unknown>;
    try {
      rec = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }
    const msg = rec.message as { role?: string; content?: unknown } | undefined;
    if (
      rec.type === "system" &&
      String(rec.subtype ?? "").includes("compact")
    ) {
      compactions++;
    }
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;
    const blocks = blocksOf(msg.content);
    if (msg.role === "assistant") {
      for (const b of blocks) {
        if (b.type === "tool_use" && typeof b.id === "string") {
          toolUses++;
          if (b.name === "Task" || b.name === "Agent") subagents++;
        }
      }
    } else if (rec.type === "user" && rawHasUserMessage(blocks)) {
      const text = rawUserText(blocks);
      if (text !== "" && !rawIsInjected(text)) userTurns++;
    }
  }

  const fold = foldMindLines(emptyMindFold(), lines, {
    cwd: "C:\\",
    home: "C:/Users/Zigfriad",
  });

  it("folds every tool_use exactly once", () => {
    expect(fold.events.length).toBe(toolUses);
  });

  it("counts user turns, compactions and subagents like the hand count", () => {
    expect(fold.stats.userTurns).toBe(userTurns);
    expect(fold.stats.compactions).toBe(compactions);
    expect(fold.stats.subagents).toBe(subagents);
  });

  it("settles events whose results already arrived", () => {
    const settled = fold.events.filter((e) => e.settled).length;
    expect(settled).toBeGreaterThan(fold.events.length - 10);
  });

  it("saw this session write the micahs-mind card", () => {
    // This session's cwd is C:\, so the Write lands under the long
    // repo-relative path; a short docs/... hit may also exist from greps.
    const card = [...fold.touched.entries()].filter(([p]) =>
      p.endsWith("docs/micahs-mind-2026-08-17.md"),
    );
    expect(card.length).toBeGreaterThan(0);
    expect(card.some(([, info]) => info.touch === "edit")).toBe(true);
  });

  it("captures session meta", () => {
    expect(fold.session.cwd).toBe("C:\\");
    expect(fold.session.startedAt).toBeTruthy();
    expect(fold.session.endedAt).toBeTruthy();
  });

  it("is idempotent when the whole file is folded again", () => {
    const before = {
      events: fold.events.length,
      marks: fold.marks.length,
      userTurns: fold.stats.userTurns,
      subagents: fold.stats.subagents,
      compactions: fold.stats.compactions,
    };
    foldMindLines(fold, lines, { cwd: "C:\\", home: "C:/Users/Zigfriad" });
    expect(fold.events.length).toBe(before.events);
    expect(fold.marks.length).toBe(before.marks);
    expect(fold.stats.userTurns).toBe(before.userTurns);
    expect(fold.stats.subagents).toBe(before.subagents);
    expect(fold.stats.compactions).toBe(before.compactions);
    expect(fold.stats.actions.read + fold.stats.actions.edit).toBeGreaterThan(
      0,
    );
  });
});
