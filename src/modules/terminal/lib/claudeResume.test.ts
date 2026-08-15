import { describe, expect, it } from "vitest";
import {
  claudeResumeCommand,
  clearClaudeResume,
  isClaudeSessionId,
  peekClaudeResume,
  queueClaudeResume,
} from "./claudeResume";

const UUID = "3f8a1c2e-9b4d-4f6a-8e2c-1a5d7b9c0e42";

describe("isClaudeSessionId", () => {
  it("accepts canonical and uppercase uuids", () => {
    expect(isClaudeSessionId(UUID)).toBe(true);
    expect(isClaudeSessionId(UUID.toUpperCase())).toBe(true);
  });

  it("rejects everything that is not a strict uuid", () => {
    for (const bad of [
      null,
      undefined,
      42,
      "",
      "not-a-uuid",
      `${UUID} `,
      ` ${UUID}`,
      UUID.slice(0, 35),
      `${UUID}0`,
      "claude --resume x; rm -rf ~",
      `$(reboot)${UUID.slice(10)}`,
    ]) {
      expect(isClaudeSessionId(bad)).toBe(false);
    }
  });
});

describe("claudeResumeCommand", () => {
  it("builds the resume command from a valid id, lowercased", () => {
    expect(claudeResumeCommand(UUID.toUpperCase())).toBe(
      `claude --resume ${UUID}`,
    );
  });

  it("returns null for anything invalid, never touching the shell", () => {
    expect(claudeResumeCommand("nope; whoami")).toBeNull();
    expect(claudeResumeCommand(undefined)).toBeNull();
  });
});

describe("resume queue", () => {
  it("queues only valid ids and is a single-shot per leaf", () => {
    queueClaudeResume(900, "garbage");
    expect(peekClaudeResume(900)).toBeNull();
    queueClaudeResume(900, UUID);
    expect(peekClaudeResume(900)).toBe(UUID);
    clearClaudeResume(900);
    expect(peekClaudeResume(900)).toBeNull();
  });
});
