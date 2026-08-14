/**
 * Drives the official `claude` CLI (Claude Code) as a Micah AI backend.
 *
 * Why a CLI and not the HTTP API: Micah's first law is that no LLM may be
 * billed per token. The Claude Code CLI authenticates with the user's own
 * subscription through Anthropic's own client — there is no API key, no
 * metered key to leak, and nothing to spoof. Everything below is plumbing
 * around that one decision.
 *
 * Transport: the CLI is spawned through Micah's normal background-shell
 * command with its NDJSON redirected to a file, and the file is tailed. The
 * background log pipe is deliberately NOT used for the JSON — it decodes each
 * 8 KiB pipe chunk with `from_utf8_lossy`, which mangles any multi-byte
 * character unlucky enough to straddle a chunk boundary. Reading the file
 * whole means every parsed line is complete and correctly decoded.
 */

import { invoke } from "@tauri-apps/api/core";
import { join, tempDir } from "@tauri-apps/api/path";
import { native } from "@/modules/ai/lib/native";
import { currentWorkspaceEnv } from "@/modules/workspace";
import { IS_WINDOWS } from "@/lib/platform";
import { parseNdjson, type ClaudeCliEvent } from "./protocol";

const POLL_MS = 40;
/** The CLI can sit silent while a tool runs; only a dead process ends a run. */
const IDLE_GRACE_MS = 800;

export type ClaudeCliRun = {
  prompt: string;
  /** Model id passed to `--model`; omit to use the CLI's configured default. */
  model?: string;
  /** Working directory for the CLI (its tools are rooted here). */
  cwd?: string | null;
  /** Resume an existing CLI session instead of starting a new one. */
  resumeSessionId?: string | null;
  /** Extra system prompt appended to Claude Code's own (first turn only). */
  appendSystemPrompt?: string | null;
  permissionMode?: "default" | "acceptEdits" | "plan" | "bypassPermissions";
  /** Maps to `--dangerously-skip-permissions`. Off unless the user opts in. */
  skipPermissions?: boolean;
  abortSignal?: AbortSignal;
};

let runCounter = 0;

/** True when the spawned shell speaks POSIX sh rather than PowerShell. */
function shellIsPosix(): boolean {
  if (!IS_WINDOWS) return true;
  return currentWorkspaceEnv().kind === "wsl";
}

async function scratchPaths(): Promise<{
  dir: string;
  inPath: string;
  outPath: string;
  errPath: string;
}> {
  const id = `micah-cc-${Date.now().toString(36)}-${(runCounter++).toString(36)}`;
  if (shellIsPosix()) {
    const dir = "/tmp";
    return {
      dir,
      inPath: `${dir}/${id}.in`,
      outPath: `${dir}/${id}.jsonl`,
      errPath: `${dir}/${id}.err`,
    };
  }
  const dir = await tempDir();
  return {
    dir,
    inPath: await join(dir, `${id}.in`),
    outPath: await join(dir, `${id}.jsonl`),
    errPath: await join(dir, `${id}.err`),
  };
}

function quotePosix(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

function quotePowerShell(s: string): string {
  return `'${s.replace(/'/g, "''")}'`;
}

export function buildCliArgs(run: ClaudeCliRun): string[] {
  const args = [
    "-p",
    "--output-format",
    "stream-json",
    "--include-partial-messages",
    "--verbose",
  ];
  if (run.model?.trim()) args.push("--model", run.model.trim());
  if (run.resumeSessionId?.trim()) {
    args.push("--resume", run.resumeSessionId.trim());
  } else if (run.appendSystemPrompt?.trim()) {
    // Only meaningful on the turn that creates the session; a resumed session
    // already carries it, and repeating it would re-bill the prefix.
    args.push("--append-system-prompt", run.appendSystemPrompt.trim());
  }
  if (run.skipPermissions) {
    args.push("--dangerously-skip-permissions");
  } else {
    // A print-mode run has nobody to answer a prompt, so the mode is always
    // stated explicitly rather than left to whatever the CLI defaults to.
    args.push("--permission-mode", run.permissionMode ?? "acceptEdits");
  }
  return args;
}

/** Assembles the one shell line that feeds the prompt in and the NDJSON out. */
export function buildShellCommand(
  args: string[],
  paths: { inPath: string; outPath: string; errPath: string },
  posix: boolean,
): string {
  if (posix) {
    const argv = args.map(quotePosix).join(" ");
    return `cat ${quotePosix(paths.inPath)} | claude ${argv} > ${quotePosix(
      paths.outPath,
    )} 2> ${quotePosix(paths.errPath)}`;
  }
  const argv = args.map(quotePowerShell).join(" ");
  // `Out-File -Encoding utf8` keeps PowerShell 5.1 from writing UTF-16, and
  // stderr goes to its own file so ErrorRecord noise never lands in the NDJSON.
  return `Get-Content -Raw -Encoding UTF8 ${quotePowerShell(
    paths.inPath,
  )} | & claude ${argv} 2> ${quotePowerShell(
    paths.errPath,
  )} | Out-File -Encoding utf8 -FilePath ${quotePowerShell(paths.outPath)}`;
}

async function readTextOrEmpty(path: string): Promise<string> {
  try {
    const r = await native.readFile(path);
    return r.kind === "text" ? r.content : "";
  } catch {
    return "";
  }
}

function stripBom(s: string): string {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

export class ClaudeCliError extends Error {
  constructor(
    message: string,
    readonly stderr: string,
    readonly exitCode: number | null,
  ) {
    super(message);
    this.name = "ClaudeCliError";
  }
}

/**
 * Runs one CLI turn, yielding protocol events as they land on disk.
 * Cleans up its scratch files even when the caller stops iterating early.
 */
export async function* streamClaudeCli(
  run: ClaudeCliRun,
): AsyncGenerator<ClaudeCliEvent, void, void> {
  const paths = await scratchPaths();
  const posix = shellIsPosix();
  const command = buildShellCommand(buildCliArgs(run), paths, posix);

  await native.writeFile(paths.inPath, run.prompt);

  let handle: number | null = null;
  let consumed = 0;
  let pending = "";
  try {
    handle = await native.shellBgSpawn(command, run.cwd ?? null);
    let exited = false;
    let exitCode: number | null = null;
    let exitedAtMs: number | null = null;

    for (;;) {
      if (run.abortSignal?.aborted) return;

      if (!exited) {
        try {
          const logs = await native.shellBgLogs(handle, 0);
          exited = logs.exited;
          exitCode = logs.exit_code;
          if (exited && exitedAtMs === null) exitedAtMs = Date.now();
        } catch {
          exited = true;
          if (exitedAtMs === null) exitedAtMs = Date.now();
        }
      }

      const raw = stripBom(await readTextOrEmpty(paths.outPath));
      if (raw.length > consumed) {
        pending += raw.slice(consumed);
        consumed = raw.length;
        const { events, rest } = parseNdjson(pending);
        pending = rest;
        for (const ev of events) yield ev;
      }

      if (exited) {
        // The writer may still be flushing the last line after exit.
        const settled =
          exitedAtMs !== null && Date.now() - exitedAtMs > IDLE_GRACE_MS;
        if (settled) {
          if (consumed === 0) {
            const stderr = (await readTextOrEmpty(paths.errPath)).trim();
            throw new ClaudeCliError(
              stderr
                ? `Claude Code CLI failed: ${stderr.split("\n").slice(-6).join("\n")}`
                : "Claude Code CLI produced no output. Is `claude` on PATH and logged in (`claude /login`)?",
              stderr,
              exitCode,
            );
          }
          return;
        }
      }

      await sleep(POLL_MS);
    }
  } finally {
    if (handle !== null) {
      try {
        await native.shellBgKill(handle);
      } catch {
        // Already reaped.
      }
    }
    for (const p of [paths.inPath, paths.outPath, paths.errPath]) {
      void invoke("fs_delete", {
        path: p,
        workspace: currentWorkspaceEnv(),
      }).catch(() => {});
    }
  }
}
