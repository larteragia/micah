import { cn } from "@/lib/utils";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  RefreshIcon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type RefObject, useEffect, useState } from "react";

type Props = {
  /** The native webview is parked over this element; it must stay empty. */
  hostRef: RefObject<HTMLDivElement | null>;
  url: string;
  error: string | null;
  cdpPort: number | null;
  suppressed: boolean;
  onNavigate: (url: string) => void;
  onGo: (delta: number) => void;
  onReload: () => void;
  onRetry: () => void;
};

export function BrowserPanel({
  hostRef,
  url,
  error,
  cdpPort,
  suppressed,
  onNavigate,
  onGo,
  onReload,
  onRetry,
}: Props) {
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);

  // Follow the page while the user is not mid-edit — the panel navigates on its
  // own (links, pushState) and a frozen address bar is a lie.
  useEffect(() => {
    if (!editing) setDraft(url);
  }, [url, editing]);

  return (
    <div className="flex h-full min-h-0 flex-col border-r border-border/60 bg-card">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-1.5 py-1.5">
        <button
          type="button"
          onClick={() => onGo(-1)}
          title="Back"
          aria-label="Back"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon icon={ArrowLeft01Icon} size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={() => onGo(1)}
          title="Forward"
          aria-label="Forward"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon icon={ArrowRight01Icon} size={16} strokeWidth={1.75} />
        </button>
        <button
          type="button"
          onClick={onReload}
          title="Reload"
          aria-label="Reload"
          className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon icon={RefreshIcon} size={15} strokeWidth={1.75} />
        </button>

        <form
          className="flex min-w-0 flex-1 items-center"
          onSubmit={(e) => {
            e.preventDefault();
            setEditing(false);
            onNavigate(draft);
          }}
        >
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onFocus={(e) => {
              setEditing(true);
              e.currentTarget.select();
            }}
            onBlur={() => setEditing(false)}
            onKeyDown={(e) => {
              e.stopPropagation();
              if (e.key === "Escape") {
                setDraft(url);
                setEditing(false);
                e.currentTarget.blur();
              }
            }}
            spellCheck={false}
            aria-label="Address"
            placeholder="Search or type a URL"
            className="h-7 w-full min-w-0 rounded-md bg-foreground/[0.04] px-2 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary/40"
          />
        </form>

        <span
          role="img"
          title={
            cdpPort
              ? `Playwright can attach on 127.0.0.1:${cdpPort} — anything running as you can too`
              : "Playwright bridge unavailable"
          }
          aria-label={
            cdpPort ? `debugging port ${cdpPort}` : "debugging unavailable"
          }
          className={cn(
            "flex size-7 shrink-0 items-center justify-center rounded-md",
            cdpPort ? "text-foreground/70" : "text-muted-foreground/40",
          )}
        >
          <HugeiconsIcon icon={ShieldKeyIcon} size={14} strokeWidth={1.75} />
        </span>
      </div>

      {/* Outside the host box on purpose: anything rendered inside it would be
          painted over by the native webview, so an error explaining why the
          panel is broken would itself be invisible. */}
      {error ? (
        <div className="flex shrink-0 items-start gap-2 border-b border-border/60 bg-foreground/[0.03] px-2 py-1.5">
          <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted-foreground">
            {error}
          </p>
          <button
            type="button"
            onClick={onRetry}
            className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[10px] font-medium text-foreground/80 outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            Retry
          </button>
        </div>
      ) : null}

      {/* The native webview is positioned over this box. Nothing may render
          inside it: on Windows it is a sibling HWND and paints above the DOM. */}
      <div ref={hostRef} className="relative min-h-0 flex-1">
        {suppressed ? (
          <div className="absolute inset-0 bg-card/95" aria-hidden />
        ) : null}
      </div>
    </div>
  );
}
