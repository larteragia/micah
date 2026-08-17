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
import type { ContentBlock } from "./parseSession";
import {
  hasUserMessage,
  injectedUserMessage,
  userMessageText,
} from "./parseSession";

const SESSION = join(
  homedir(),
  ".claude-micah",
  "projects",
  "C--",
  "c05cf414-13ad-42cf-81a6-f471679a9e36.jsonl",
);

const skip = !existsSync(SESSION);
const d = describe.skipIf(skip);

function blocksOf(content: unknown): ContentBlock[] {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  return content as ContentBlock[];
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
    } else if (rec.type === "user" && hasUserMessage(blocks)) {
      const text = userMessageText(blocks);
      if (text !== "" && !injectedUserMessage(text)) userTurns++;
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
    foldMindLines(fold, lines, { cwd: "C:\\", home: "C:/Users/Zigfriad" });
    expect(fold.events.length).toBe(toolUses);
    expect(fold.stats.actions.read + fold.stats.actions.edit).toBeGreaterThan(
      0,
    );
  });
});
