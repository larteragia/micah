/**
 * Parse one Claude Code transcript line (JSONL) into trace pieces, ported
 * from mindwalk's claudecode adapter (MIT, Ricko Yu; see
 * LICENSES/mindwalk.txt). Handles the shapes real transcripts carry:
 * message.content as string or block array, tool_result.content as string or
 * block array, harness-injected user messages, compaction system records
 * and ai-title records.
 */

import { truncateRunes } from "./classify";

const USER_MESSAGE_NOTE_LIMIT = 2000;

export type ContentBlock = {
  type: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  content?: unknown;
  is_error?: boolean;
  text?: string;
};

/** Meta fields any transcript line may carry alongside its payload. */
export type LineMeta = {
  sessionId?: string;
  cwd?: string;
  timestamp?: string;
};

export type SessionLine =
  /** Line types the trace ignores: mode, permission-mode, attachments... */
  | ({ kind: "ignored"; reason: string } & LineMeta)
  | ({ kind: "ai-title"; title: string } & LineMeta)
  /** System record whose subtype mentions compact. */
  | ({ kind: "compaction" } & LineMeta)
  | ({
      kind: "message";
      role: "assistant" | "user";
      model?: string;
      blocks: ContentBlock[];
    } & LineMeta)
  /** A human user message that is not harness-injected. */
  | ({ kind: "user-text"; note: string } & LineMeta);

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

/** message.content unmarshal: a string becomes a single text block. */
function contentBlocks(content: unknown): ContentBlock[] | null {
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return null;
  const blocks: ContentBlock[] = [];
  for (const item of content) {
    const r = asRecord(item);
    if (!r) continue;
    const block: ContentBlock = {
      type: typeof r.type === "string" ? r.type : "",
    };
    if (typeof r.id === "string") block.id = r.id;
    if (typeof r.name === "string") block.name = r.name;
    if (r.input !== undefined && r.input !== null) block.input = r.input;
    if (typeof r.tool_use_id === "string") block.tool_use_id = r.tool_use_id;
    if (r.content !== undefined && r.content !== null)
      block.content = r.content;
    if (typeof r.is_error === "boolean") block.is_error = r.is_error;
    if (typeof r.text === "string") block.text = r.text;
    blocks.push(block);
  }
  return blocks;
}

/**
 * Recognize harness-injected text recorded as user messages: complete
 * markup envelopes (start tag, end tag) and Codex AGENTS.md instructions.
 * A bare "<" prefix would swallow real tasks pasting HTML or JSX.
 */
export function injectedUserMessage(text: string): boolean {
  const t = text.trim();
  if (t.startsWith("# AGENTS.md instructions")) return true;
  return t.startsWith("<") && t.endsWith(">");
}

export function userMessageText(blocks: ContentBlock[]): string {
  const parts: string[] = [];
  for (const b of blocks) {
    if (
      b.type === "text" &&
      typeof b.text === "string" &&
      b.text.trim() !== ""
    ) {
      parts.push(b.text.trim());
    }
  }
  return parts.join("\n");
}

/** True when the blocks carry a human message (text and no tool_result). */
export function hasUserMessage(blocks: ContentBlock[]): boolean {
  for (const b of blocks) {
    if (b.type === "tool_result") return false;
  }
  return true;
}

export function userMessageNote(text: string): string {
  return truncateRunes(text.trim(), USER_MESSAGE_NOTE_LIMIT, "…");
}

function metaOf(root: Record<string, unknown>): LineMeta {
  const meta: LineMeta = {};
  if (typeof root.sessionId === "string" && root.sessionId !== "") {
    meta.sessionId = root.sessionId;
  }
  if (typeof root.cwd === "string" && root.cwd !== "") meta.cwd = root.cwd;
  if (typeof root.timestamp === "string" && root.timestamp !== "") {
    meta.timestamp = root.timestamp;
  }
  return meta;
}

/**
 * Parse one transcript line into the union above. Everything the trace does
 * not consume (mode, permission-mode, file-history-snapshot,
 * file-history-delta, attachment, queue-operation, last-prompt, bare system
 * records, unknown types, unparseable JSON) returns kind "ignored" with the
 * reason, so callers can log coverage gaps instead of guessing.
 */
export function parseSessionLine(line: string): SessionLine {
  let rec: unknown;
  try {
    rec = JSON.parse(line);
  } catch {
    return { kind: "ignored", reason: "unparseable", ...emptyMeta() };
  }
  const root = asRecord(rec);
  if (!root) {
    return { kind: "ignored", reason: "not-an-object", ...emptyMeta() };
  }
  const meta = metaOf(root);
  const type = typeof root.type === "string" ? root.type : "";

  if (type === "ai-title") {
    if (typeof root.aiTitle === "string" && root.aiTitle !== "") {
      return { kind: "ai-title", title: root.aiTitle, ...meta };
    }
    return { kind: "ignored", reason: "ai-title-empty", ...meta };
  }
  if (type === "system") {
    const subtype = typeof root.subtype === "string" ? root.subtype : "";
    if (subtype.toLowerCase().includes("compact")) {
      return { kind: "compaction", ...meta };
    }
    return { kind: "ignored", reason: "system", ...meta };
  }
  if (type !== "user" && type !== "assistant") {
    return { kind: "ignored", reason: type === "" ? "no-type" : type, ...meta };
  }

  const msg = asRecord(root.message);
  if (!msg) return { kind: "ignored", reason: "no-message", ...meta };
  const blocks = contentBlocks(msg.content);
  if (!blocks) return { kind: "ignored", reason: "no-content", ...meta };
  const role =
    msg.role === "assistant"
      ? "assistant"
      : msg.role === "user"
        ? "user"
        : null;
  if (!role)
    return { kind: "ignored", reason: `role-${String(msg.role)}`, ...meta };

  if (role === "user" && hasUserMessage(blocks)) {
    const text = userMessageText(blocks);
    if (text !== "" && !injectedUserMessage(text)) {
      return { kind: "user-text", note: userMessageNote(text), ...meta };
    }
  }
  const parsed: SessionLine = { kind: "message", role, blocks, ...meta };
  if (typeof msg.model === "string" && msg.model !== "") {
    (parsed as { model?: string }).model = msg.model;
  }
  return parsed;
}

function emptyMeta(): LineMeta {
  return {};
}
