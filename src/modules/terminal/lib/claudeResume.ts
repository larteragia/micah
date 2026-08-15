// Claude Code session anchoring: validation, the resume command a restored
// pane replays, and the boot-time queue of pending injections. Session ids
// come from untrusted places (spaces.json on disk, PTY output), so nothing
// reaches a shell without passing isClaudeSessionId.

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UUID_LEN = 36;

export function isClaudeSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length === UUID_LEN &&
    UUID_RE.test(value)
  );
}

/** The exact command a restored pane replays, or null for anything that does
 * not survive validation (poisoned spaces.json must never touch the shell). */
export function claudeResumeCommand(sessionId: unknown): string | null {
  if (!isClaudeSessionId(sessionId)) return null;
  return `claude --resume ${sessionId.toLowerCase()}`;
}

const pending = new Map<number, string>();

export function queueClaudeResume(leafId: number, sessionId: unknown): void {
  if (isClaudeSessionId(sessionId)) pending.set(leafId, sessionId);
}

export function peekClaudeResume(leafId: number): string | null {
  return pending.get(leafId) ?? null;
}

export function clearClaudeResume(leafId: number): void {
  pending.delete(leafId);
}
