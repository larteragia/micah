import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Tool, type ToolPart } from "@/components/ai-elements/tool";
import { cn } from "@/lib/utils";
import { useEffect, useRef, useState } from "react";
import type { EditPair, StreamEvent } from "./lib/sessionStream";

/** Keep the inline body of a Write light; the full content lives in the
 * files view's CodeMirror lane. */
const INLINE_BODY_CAP = 4_000;

/**
 * Chronological, read-only render of a Claude Code session: thinking blocks
 * collapse like the chat's reasoning, every tool call is one row, edits and
 * writes show their diff/content inline. Follows the tail unless the user
 * scrolls away.
 */
export function SessionStreamView({ events }: { events: StreamEvent[] }) {
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const stickRef = useRef(true);
  const lastId = events.length > 0 ? events[events.length - 1].id : "";
  const lastEvent = events[events.length - 1];
  const growth =
    events.length +
    (lastEvent?.kind === "tool" && lastEvent.result !== undefined ? 1 : 0);

  useEffect(() => {
    const el = scrollRef.current;
    if (el && stickRef.current) el.scrollTop = el.scrollHeight;
  }, [growth]);

  return (
    <div
      ref={scrollRef}
      onScroll={() => {
        const el = scrollRef.current;
        if (!el) return;
        stickRef.current =
          el.scrollTop + el.clientHeight >= el.scrollHeight - 40;
      }}
      className="h-full min-h-0 overflow-y-auto px-2 py-1.5"
    >
      <div className="flex flex-col gap-1">
        {events.map((e) =>
          e.kind === "thinking" ? (
            <ThinkingEvent key={e.id} text={e.text} live={e.id === lastId} />
          ) : (
            <ToolEvent key={e.id} event={e} />
          ),
        )}
      </div>
    </div>
  );
}

function ThinkingEvent({ text, live }: { text: string; live: boolean }) {
  return (
    <div className="px-2 py-0.5">
      <Reasoning isStreaming={live} defaultOpen={live}>
        <ReasoningTrigger />
        <ReasoningContent>{text}</ReasoningContent>
      </Reasoning>
    </div>
  );
}

/** Claude Code tool names mapped onto the chat's tool rows, so the viewer
 * reuses their icons and summaries instead of inventing a second visual
 * language. Unknown names (MCP tools included) fall through as-is. */
function displayTool(e: Extract<StreamEvent, { kind: "tool" }>): {
  toolName: string;
  input: unknown;
} {
  const i = e.input;
  switch (e.name) {
    case "Bash":
      return { toolName: "bash_run", input: { command: i.command } };
    case "Read":
      return { toolName: "read_file", input: { path: e.path } };
    case "Write":
      return { toolName: "write_file", input: { path: e.path } };
    case "Edit":
      return { toolName: "edit", input: { path: e.path } };
    case "MultiEdit":
      return { toolName: "multi_edit", input: { path: e.path } };
    case "Grep":
      return {
        toolName: "grep",
        input: { pattern: i.pattern, path: i.path },
      };
    case "Glob":
      return { toolName: "glob", input: { pattern: i.pattern } };
    case "Task":
      return {
        toolName: "run_subagent",
        input: { agent: i.subagent_type, task: i.description },
      };
    case "TodoWrite":
      return { toolName: "todo_write", input: { todos: i.todos } };
    default:
      return { toolName: e.name, input: i };
  }
}

function ToolEvent({
  event,
}: {
  event: Extract<StreamEvent, { kind: "tool" }>;
}) {
  const { toolName, input } = displayTool(event);
  const state: ToolPart["state"] = event.result
    ? event.result.ok
      ? "output-available"
      : "output-error"
    : "input-available";
  const output =
    event.result?.ok && event.result.preview.length > 0
      ? event.result.preview
      : undefined;
  const errorText =
    event.result && !event.result.ok
      ? event.result.preview || "failed"
      : undefined;
  return (
    <div>
      <Tool
        toolName={toolName}
        state={state}
        input={input}
        output={output}
        errorText={errorText}
      />
      {event.edits ? <EditDiff edits={event.edits} /> : null}
      {event.content !== undefined && event.name === "Write" ? (
        <InlineBody text={event.content} />
      ) : null}
    </div>
  );
}

function EditDiff({ edits }: { edits: EditPair[] }) {
  return (
    <div className="mt-0.5 ml-6 max-h-60 overflow-auto rounded bg-muted/30 p-2 font-mono text-[11px] leading-relaxed">
      {edits.map((pair, idx) => (
        <div key={idx} className={cn(idx > 0 && "mt-2")}>
          {diffLines(pair.old_string, "-").map((l, n) => (
            <div key={`o${n}`} className="text-destructive whitespace-pre-wrap">
              {l}
            </div>
          ))}
          {diffLines(pair.new_string, "+").map((l, n) => (
            <div
              key={`n${n}`}
              className="text-emerald-600 dark:text-emerald-400 whitespace-pre-wrap"
            >
              {l}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function diffLines(text: string, sign: "-" | "+"): string[] {
  return text.split("\n").map((l) => `${sign} ${l}`);
}

function InlineBody({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const clipped = text.length > INLINE_BODY_CAP;
  const shown = expanded || !clipped ? text : text.slice(0, INLINE_BODY_CAP);
  return (
    <div className="mt-0.5 ml-6">
      <pre className="max-h-60 overflow-auto rounded bg-muted/30 p-2 font-mono text-[11px] leading-relaxed whitespace-pre-wrap">
        {shown}
      </pre>
      {clipped && !expanded ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="mt-0.5 text-[10px] text-muted-foreground hover:text-foreground"
        >
          show all ({text.length} chars)
        </button>
      ) : null}
    </div>
  );
}
