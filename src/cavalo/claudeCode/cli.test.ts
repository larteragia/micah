import { describe, expect, it } from "vitest";
import { buildCliArgs, buildShellCommand } from "./cli";

const paths = {
  inPath: "/tmp/micah-cc-1.in",
  outPath: "/tmp/micah-cc-1.jsonl",
  errPath: "/tmp/micah-cc-1.err",
};

describe("buildCliArgs", () => {
  it("always asks for streamed NDJSON", () => {
    const args = buildCliArgs({ prompt: "hi" });
    expect(args.slice(0, 6)).toEqual([
      "-p",
      "--output-format",
      "stream-json",
      "--include-partial-messages",
      "--verbose",
      "--permission-mode",
    ]);
  });

  it("resumes instead of re-sending the system prompt", () => {
    const args = buildCliArgs({
      prompt: "next question",
      resumeSessionId: "sess-1",
      appendSystemPrompt: "You are Micah.",
    });
    expect(args).toContain("--resume");
    expect(args).toContain("sess-1");
    expect(args).not.toContain("--append-system-prompt");
  });

  it("sends the system prompt only when opening a session", () => {
    const args = buildCliArgs({
      prompt: "first question",
      appendSystemPrompt: "You are Micah.",
    });
    expect(args).toContain("--append-system-prompt");
    expect(args).toContain("You are Micah.");
  });

  it("keeps permission skipping opt-in and exclusive", () => {
    const guarded = buildCliArgs({ prompt: "x", permissionMode: "plan" });
    expect(guarded).toContain("--permission-mode");
    expect(guarded).toContain("plan");
    expect(guarded).not.toContain("--dangerously-skip-permissions");

    const skipped = buildCliArgs({
      prompt: "x",
      permissionMode: "plan",
      skipPermissions: true,
    });
    expect(skipped).toContain("--dangerously-skip-permissions");
    expect(skipped).not.toContain("--permission-mode");
  });
});

describe("buildShellCommand", () => {
  it("pipes the prompt in and the NDJSON out on POSIX", () => {
    const cmd = buildShellCommand(["-p", "--model", "opus"], paths, true);
    expect(cmd).toBe(
      "cat '/tmp/micah-cc-1.in' | claude '-p' '--model' 'opus' > '/tmp/micah-cc-1.jsonl' 2> '/tmp/micah-cc-1.err'",
    );
  });

  it("keeps stderr out of the NDJSON on PowerShell", () => {
    const cmd = buildShellCommand(["-p"], paths, false);
    expect(cmd).toContain("Get-Content -Raw -Encoding UTF8");
    expect(cmd).toContain("2> '/tmp/micah-cc-1.err'");
    expect(cmd).toContain("Out-File -Encoding utf8 -FilePath");
  });

  it("neutralises quotes in arguments for both shells", () => {
    const nasty = `it's; rm -rf /`;
    expect(buildShellCommand([nasty], paths, true)).toContain(
      `'it'\\''s; rm -rf /'`,
    );
    expect(buildShellCommand([nasty], paths, false)).toContain(
      `'it''s; rm -rf /'`,
    );
  });
});
