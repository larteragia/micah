/**
 * A LanguageModelV3 backed by the Claude Code CLI.
 *
 * The CLI is a full agent, not a completion endpoint: it owns its own tools,
 * its own permission prompts and its own transcript. So this adapter does not
 * try to drive it turn-by-turn like an API model. It hands over the user's
 * message, streams back the thinking and the text, and reports which tools the
 * CLI decided to run. Micah's own tool loop stays out of the way — running two
 * agent loops against one another would double the work and the cost.
 */

import type {
  LanguageModelV3,
  LanguageModelV3CallOptions,
  LanguageModelV3Content,
  LanguageModelV3FinishReason,
  LanguageModelV3StreamPart,
  LanguageModelV3Usage,
} from "@ai-sdk/provider";
import { streamClaudeCli, type ClaudeCliRun } from "./cli";
import type { ClaudeCliEvent, ClaudeUsage } from "./protocol";
import { conversationKey, getSessionId, setSessionId } from "./session";

export type ClaudeCodeModelOptions = {
  /** Directory the CLI runs in — its tools are rooted there. */
  getCwd?: () => string | null;
  /** `--permission-mode`; ignored when `getSkipPermissions()` is true. */
  getPermissionMode?: () => ClaudeCliRun["permissionMode"];
  /** Maps to `--dangerously-skip-permissions`. */
  getSkipPermissions?: () => boolean;
};

const EMPTY_USAGE: LanguageModelV3Usage = {
  inputTokens: {
    total: undefined,
    noCache: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
  },
  outputTokens: { total: undefined, text: undefined, reasoning: undefined },
};

function toUsage(u: ClaudeUsage | undefined): LanguageModelV3Usage {
  if (!u) return EMPTY_USAGE;
  const noCache = u.input_tokens ?? 0;
  const cacheRead = u.cache_read_input_tokens ?? 0;
  const cacheWrite = u.cache_creation_input_tokens ?? 0;
  return {
    inputTokens: {
      total: noCache + cacheRead + cacheWrite,
      noCache,
      cacheRead,
      cacheWrite,
    },
    outputTokens: {
      total: u.output_tokens ?? 0,
      text: undefined,
      reasoning: undefined,
    },
    raw: u as unknown as LanguageModelV3Usage["raw"],
  };
}

function toFinishReason(stopReason: unknown): LanguageModelV3FinishReason {
  const raw = typeof stopReason === "string" ? stopReason : undefined;
  switch (raw) {
    case "max_tokens":
      return { unified: "length", raw };
    case "refusal":
      return { unified: "content-filter", raw };
    case "end_turn":
    case "stop_sequence":
      return { unified: "stop", raw };
    default:
      return { unified: "stop", raw };
  }
}

function textOfParts(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((p) =>
      p && typeof p === "object" && (p as { type?: string }).type === "text"
        ? ((p as { text?: string }).text ?? "")
        : "",
    )
    .join("");
}

type PromptShape = {
  key: string;
  prompt: string;
  system: string | null;
};

/**
 * Turns the SDK prompt into what the CLI needs. With a known session the CLI
 * already holds the history, so only the newest user turn crosses the wire.
 */
export function shapePrompt(
  messages: LanguageModelV3CallOptions["prompt"],
  hasSession: boolean,
): PromptShape | null {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => (typeof m.content === "string" ? m.content : ""))
    .join("\n\n")
    .trim();

  const users = messages.filter((m) => m.role === "user");
  if (users.length === 0) return null;
  const firstUserText = textOfParts(users[0].content);
  const lastUserText = textOfParts(users[users.length - 1].content);
  const key = conversationKey(firstUserText);

  if (hasSession) {
    return { key, prompt: lastUserText, system: null };
  }

  // No session yet (new chat, or one whose id was lost): replay the visible
  // transcript once so the CLI starts with the same context the user sees.
  const lines: string[] = [];
  for (const m of messages) {
    if (m.role === "system") continue;
    const text = textOfParts(m.content).trim();
    if (!text) continue;
    lines.push(m.role === "user" ? text : `[assistant]\n${text}`);
  }
  return {
    key,
    prompt: lines.join("\n\n---\n\n") || lastUserText,
    system: system || null,
  };
}

function toolLabel(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  const arg =
    (typeof i.command === "string" && i.command) ||
    (typeof i.file_path === "string" && i.file_path) ||
    (typeof i.path === "string" && i.path) ||
    (typeof i.pattern === "string" && i.pattern) ||
    (typeof i.description === "string" && i.description) ||
    "";
  const short = arg.length > 70 ? `${arg.slice(0, 69)}…` : arg;
  return short ? `⏺ ${name}(${short})` : `⏺ ${name}`;
}

export function createClaudeCodeModel(
  modelId: string,
  options: ClaudeCodeModelOptions = {},
): LanguageModelV3 {
  const run = async function* (
    callOptions: LanguageModelV3CallOptions,
  ): AsyncGenerator<LanguageModelV3StreamPart, void, void> {
    const firstUsers = callOptions.prompt.filter((m) => m.role === "user");
    const probeKey =
      firstUsers.length > 0
        ? conversationKey(textOfParts(firstUsers[0].content))
        : "";
    const existing = probeKey ? getSessionId(probeKey) : null;
    const shaped = shapePrompt(callOptions.prompt, !!existing);
    if (!shaped?.prompt.trim()) {
      yield { type: "stream-start", warnings: [] };
      yield {
        type: "finish",
        usage: EMPTY_USAGE,
        finishReason: toFinishReason("end_turn"),
      };
      return;
    }

    yield { type: "stream-start", warnings: [] };

    const openBlocks = new Map<number, "text" | "reasoning">();
    let messageId = "m0";
    let usage: LanguageModelV3Usage = EMPTY_USAGE;
    let finishReason: LanguageModelV3FinishReason = toFinishReason("end_turn");
    let sessionId: string | null = existing;
    let sawAnyOutput = false;
    let syntheticBlock = 0;

    const blockId = (index: number) => `${messageId}:${index}`;

    const events = streamClaudeCli({
      prompt: shaped.prompt,
      model: modelId,
      cwd: options.getCwd?.() ?? null,
      resumeSessionId: existing,
      appendSystemPrompt: shaped.system,
      permissionMode: options.getPermissionMode?.() ?? "acceptEdits",
      skipPermissions: options.getSkipPermissions?.() ?? false,
      abortSignal: callOptions.abortSignal,
    });

    for await (const ev of events as AsyncGenerator<ClaudeCliEvent>) {
      const evSession = (ev as { session_id?: string }).session_id;
      if (typeof evSession === "string" && evSession) sessionId = evSession;

      if (ev.type === "stream_event") {
        const inner = (ev as { event?: Record<string, unknown> }).event;
        if (!inner || typeof inner.type !== "string") continue;
        const index = typeof inner.index === "number" ? inner.index : 0;

        if (inner.type === "message_start") {
          const id = (inner.message as { id?: string } | undefined)?.id;
          if (id) messageId = id;
          continue;
        }
        if (inner.type === "content_block_start") {
          const block = inner.content_block as
            | { type?: string; name?: string; input?: unknown }
            | undefined;
          if (block?.type === "text") {
            openBlocks.set(index, "text");
            yield { type: "text-start", id: blockId(index) };
          } else if (block?.type === "thinking") {
            openBlocks.set(index, "reasoning");
            yield { type: "reasoning-start", id: blockId(index) };
          } else if (block?.type === "tool_use") {
            // Surfaced as text: the CLI runs the tool itself, so there is no
            // call for Micah's tool loop to execute or approve.
            const id = `${blockId(index)}:tool`;
            yield { type: "text-start", id };
            yield {
              type: "text-delta",
              id,
              delta: `\n${toolLabel(block.name ?? "tool", block.input)}\n`,
            };
            yield { type: "text-end", id };
            sawAnyOutput = true;
          }
          continue;
        }
        if (inner.type === "content_block_delta") {
          const delta = inner.delta as
            | { type?: string; text?: string; thinking?: string }
            | undefined;
          const kind = openBlocks.get(index);
          if (delta?.type === "text_delta" && kind === "text" && delta.text) {
            sawAnyOutput = true;
            yield { type: "text-delta", id: blockId(index), delta: delta.text };
          } else if (
            delta?.type === "thinking_delta" &&
            kind === "reasoning" &&
            delta.thinking
          ) {
            sawAnyOutput = true;
            yield {
              type: "reasoning-delta",
              id: blockId(index),
              delta: delta.thinking,
            };
          }
          continue;
        }
        if (inner.type === "content_block_stop") {
          const kind = openBlocks.get(index);
          if (kind === "text") yield { type: "text-end", id: blockId(index) };
          if (kind === "reasoning") {
            yield { type: "reasoning-end", id: blockId(index) };
          }
          openBlocks.delete(index);
          continue;
        }
        continue;
      }

      if (ev.type === "result") {
        const r = ev as {
          usage?: ClaudeUsage;
          stop_reason?: string | null;
          is_error?: boolean;
          result?: string;
        };
        usage = toUsage(r.usage);
        finishReason = r.is_error
          ? { unified: "error", raw: "error" }
          : toFinishReason(r.stop_reason);
        // A run that errored before emitting content still owes the user the
        // reason; the CLI puts it in `result`.
        if (r.is_error && !sawAnyOutput && r.result) {
          const id = `${messageId}:err${syntheticBlock++}`;
          yield { type: "text-start", id };
          yield { type: "text-delta", id, delta: r.result };
          yield { type: "text-end", id };
        }
      }
    }

    for (const [index, kind] of openBlocks) {
      if (kind === "text") yield { type: "text-end", id: blockId(index) };
      else yield { type: "reasoning-end", id: blockId(index) };
    }

    if (sessionId && shaped.key) setSessionId(shaped.key, sessionId);

    yield { type: "finish", usage, finishReason };
  };

  return {
    specificationVersion: "v3",
    provider: "claude-code",
    modelId,
    supportedUrls: {},

    async doStream(callOptions) {
      const iterator = run(callOptions)[Symbol.asyncIterator]();
      const stream = new ReadableStream<LanguageModelV3StreamPart>({
        async pull(controller) {
          try {
            const next = await iterator.next();
            if (next.done) controller.close();
            else controller.enqueue(next.value);
          } catch (error) {
            controller.enqueue({ type: "error", error });
            controller.close();
          }
        },
        async cancel() {
          await iterator.return?.(undefined);
        },
      });
      return { stream };
    },

    async doGenerate(callOptions) {
      const content: LanguageModelV3Content[] = [];
      let text = "";
      let reasoning = "";
      let usage: LanguageModelV3Usage = EMPTY_USAGE;
      let finishReason: LanguageModelV3FinishReason =
        toFinishReason("end_turn");

      for await (const part of run(callOptions)) {
        if (part.type === "text-delta") text += part.delta;
        else if (part.type === "reasoning-delta") reasoning += part.delta;
        else if (part.type === "finish") {
          usage = part.usage;
          finishReason = part.finishReason;
        } else if (part.type === "error") {
          throw part.error;
        }
      }
      if (reasoning) content.push({ type: "reasoning", text: reasoning });
      if (text) content.push({ type: "text", text });
      return { content, finishReason, usage, warnings: [] };
    },
  };
}
