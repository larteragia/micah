/**
 * NDJSON protocol emitted by `claude --output-format stream-json --verbose`.
 *
 * Only the fields Micah actually consumes are typed; the CLI emits a lot more
 * and adds fields between releases, so every shape stays permissive.
 */

export type ClaudeContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking?: string }
  | { type: "tool_use"; id?: string; name?: string; input?: unknown }
  | { type: string; [k: string]: unknown };

export type ClaudeUsage = {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
};

export type ClaudeStreamEvent =
  | { type: "message_start"; message?: { id?: string; usage?: ClaudeUsage } }
  | {
      type: "content_block_start";
      index?: number;
      content_block?: ClaudeContentBlock;
    }
  | {
      type: "content_block_delta";
      index?: number;
      delta?:
        | { type: "text_delta"; text?: string }
        | { type: "thinking_delta"; thinking?: string }
        | { type: string; [k: string]: unknown };
    }
  | { type: "content_block_stop"; index?: number }
  | {
      type: "message_delta";
      delta?: { stop_reason?: string | null };
      usage?: ClaudeUsage;
    }
  | { type: "message_stop" }
  | { type: string; [k: string]: unknown };

export type ClaudeCliEvent =
  | {
      type: "system";
      subtype?: string;
      session_id?: string;
      model?: string;
      [k: string]: unknown;
    }
  | {
      type: "assistant";
      message?: {
        id?: string;
        model?: string;
        content?: ClaudeContentBlock[];
        usage?: ClaudeUsage;
      };
      session_id?: string;
    }
  | {
      type: "user";
      message?: { content?: ClaudeContentBlock[] };
      session_id?: string;
    }
  | { type: "stream_event"; event?: ClaudeStreamEvent; session_id?: string }
  | {
      type: "result";
      subtype?: string;
      is_error?: boolean;
      result?: string;
      stop_reason?: string | null;
      session_id?: string;
      usage?: ClaudeUsage;
      total_cost_usd?: number;
      permission_denials?: unknown[];
    }
  | { type: string; [k: string]: unknown };

/** Splits a growing NDJSON buffer into parsed events plus the unterminated tail. */
export function parseNdjson(buffer: string): {
  events: ClaudeCliEvent[];
  rest: string;
} {
  const events: ClaudeCliEvent[] = [];
  let start = 0;
  for (;;) {
    const nl = buffer.indexOf("\n", start);
    if (nl === -1) break;
    const line = buffer.slice(start, nl).trim();
    start = nl + 1;
    if (!line) continue;
    try {
      events.push(JSON.parse(line) as ClaudeCliEvent);
    } catch {
      // A truncated or non-JSON line (a CLI warning, say) is not fatal.
    }
  }
  return { events, rest: buffer.slice(start) };
}

export function blockText(block: ClaudeContentBlock): string {
  if (block.type === "text" && typeof block.text === "string")
    return block.text;
  return "";
}

export function blockThinking(block: ClaudeContentBlock): string {
  if (block.type === "thinking" && typeof block.thinking === "string") {
    return block.thinking;
  }
  return "";
}
