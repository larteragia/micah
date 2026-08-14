import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type { AgentLaunchRequest } from "@/modules/agents/lib/launcher";
import {
  ALL_LANGUAGES,
  EXPOSED_LANGUAGES,
} from "@/modules/editor/lib/languageDefinitions";
import { resolveDisplayName } from "@/modules/editor/lib/languageResolver";
import { fileIconUrl } from "@/modules/explorer/lib/iconResolver";
import {
  NewTabMenu,
  TabIcon,
  labelFor,
  type EditorTab,
  type Tab,
} from "@/modules/tabs";
import {
  Cancel01Icon,
  PencilEdit02Icon,
  Search01Icon,
  Tick02Icon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useEffect, useRef, useState } from "react";

type Props = {
  tabs: Tab[];
  activeId: number;
  home: string | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  /** Promote a preview tab to persistent on double-click. */
  onPin: (id: number) => void;
  /** Move a dragged tab to a new position (insertion gap index 0..tabs.length). */
  onReorder: (fromId: number, toGapIndex: number) => void;
  /** Set a terminal tab's custom label; empty string resets to default. */
  onRename: (id: number, title: string) => void;
  onOverrideLanguage?: (id: number, lang: string | null) => void;
  onNew: () => void;
  /** Open another app window (same process, fresh workspace). */
  onNewWindow: () => void;
  onNewBlock: () => void;
  onNewPrivate: () => void;
  onNewPreview: () => void;
  onNewEditor: () => void;
  onNewGitGraph: () => void;
  onLaunchAgents: (request: AgentLaunchRequest) => void;
};

/** The second line of a row: cwd for terminals, path/url for everything else. */
export function tabSubtitle(tab: Tab, home: string | null): string {
  const raw =
    tab.kind === "terminal"
      ? tab.cwd
      : tab.kind === "preview"
        ? tab.url
        : "path" in tab
          ? tab.path
          : "";
  if (!raw) return "";
  if (tab.kind === "preview") return raw;
  return shortenPath(raw, home);
}

export function shortenPath(path: string, home: string | null): string {
  const norm = path.replace(/\\/g, "/");
  const normHome = home ? home.replace(/\\/g, "/").replace(/\/$/, "") : null;
  if (normHome && (norm === normHome || norm.startsWith(`${normHome}/`))) {
    const tail = norm.slice(normHome.length).replace(/^\//, "");
    return tail ? `~/${tail}` : "~";
  }
  return norm;
}

export function matchesTabQuery(
  tab: Tab,
  home: string | null,
  query: string,
): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return (
    labelFor(tab).toLowerCase().includes(q) ||
    tabSubtitle(tab, home).toLowerCase().includes(q)
  );
}

export function TabsPanel({
  tabs,
  activeId,
  home,
  onSelect,
  onClose,
  onPin,
  onReorder,
  onRename,
  onOverrideLanguage,
  onNew,
  onNewWindow,
  onNewBlock,
  onNewPrivate,
  onNewPreview,
  onNewEditor,
  onNewGitGraph,
  onLaunchAgents,
}: Props) {
  const [query, setQuery] = useState("");
  const listRef = useRef<HTMLDivElement>(null);
  const [draggingId, setDraggingId] = useState<number | null>(null);
  const [dropGap, setDropGap] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [showAllLanguages, setShowAllLanguages] = useState(false);
  const drag = useRef<{
    pointerId: number;
    startY: number;
    fromId: number;
    active: boolean;
  } | null>(null);

  const visible = tabs.filter((t) => matchesTabQuery(t, home, query));
  const filtering = query.trim().length > 0;

  /** Insertion gap (0..tabs.length) for a pointer at clientY. */
  const gapAtY = (clientY: number): number => {
    const rows = Array.from(
      listRef.current?.querySelectorAll<HTMLElement>("[data-tab-row]") ?? [],
    );
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (clientY < r.top + r.height / 2) return i;
    }
    return rows.length;
  };

  const endDrag = (el: HTMLElement) => {
    const st = drag.current;
    if (st) {
      try {
        el.releasePointerCapture(st.pointerId);
      } catch {
        // pointer may already be released
      }
    }
    drag.current = null;
    setDraggingId(null);
    setDropGap(null);
    document.body.style.userSelect = "";
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 items-center gap-1 border-b border-border/60 px-2 py-1.5">
        <div className="relative flex min-w-0 flex-1 items-center">
          <HugeiconsIcon
            icon={Search01Icon}
            size={13}
            strokeWidth={1.75}
            className="pointer-events-none absolute left-2 shrink-0 text-muted-foreground"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tabs..."
            spellCheck={false}
            className="h-7 w-full min-w-0 rounded-md bg-foreground/[0.04] py-1 pr-2 pl-7 text-[11px] text-foreground outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-primary/40"
          />
        </div>
        <NewTabMenu
          onNew={onNew}
          onNewWindow={onNewWindow}
          onNewBlock={onNewBlock}
          onNewPrivate={onNewPrivate}
          onNewPreview={onNewPreview}
          onNewEditor={onNewEditor}
          onNewGitGraph={onNewGitGraph}
          onLaunchAgents={onLaunchAgents}
        />
      </div>

      <div
        ref={listRef}
        className="relative min-h-0 flex-1 overflow-y-auto px-1.5 py-1.5"
      >
        {visible.length === 0 ? (
          <p className="px-2 py-6 text-center text-[11px] text-muted-foreground">
            {filtering ? "No tabs match." : "No tabs."}
          </p>
        ) : null}

        {visible.map((t, index) => {
          const isActive = t.id === activeId;
          const isPreview = "preview" in t && t.preview === true;
          const subtitle = tabSubtitle(t, home);
          const row = (
            <div
              role="button"
              tabIndex={0}
              aria-current={isActive}
              onPointerDown={(e) => {
                if (e.button === 1) {
                  e.preventDefault();
                  return;
                }
                if (e.button !== 0) return;
                if ((e.target as HTMLElement).closest("[data-no-drag]")) return;
                e.preventDefault();
                drag.current = {
                  pointerId: e.pointerId,
                  startY: e.clientY,
                  fromId: t.id,
                  active: false,
                };
                e.currentTarget.setPointerCapture(e.pointerId);
              }}
              onPointerMove={(e) => {
                const st = drag.current;
                if (!st || st.pointerId !== e.pointerId) return;
                // Reordering is disabled while filtering: visible indices
                // would not map to real tab positions.
                if (filtering) return;
                if (!st.active) {
                  if (Math.abs(e.clientY - st.startY) < 4) return;
                  st.active = true;
                  setDraggingId(st.fromId);
                  document.body.style.userSelect = "none";
                }
                e.preventDefault();
                setDropGap(gapAtY(e.clientY));
              }}
              onPointerUp={(e) => {
                const st = drag.current;
                if (st?.active && dropGap !== null) {
                  onReorder(st.fromId, dropGap);
                } else if (st && !st.active) {
                  onSelect(t.id);
                }
                endDrag(e.currentTarget);
              }}
              onPointerCancel={(e) => endDrag(e.currentTarget)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(t.id);
                }
              }}
              onDoubleClick={() => isPreview && onPin(t.id)}
              onAuxClick={(e) => {
                if (e.button === 1 && tabs.length > 1) {
                  e.preventDefault();
                  e.stopPropagation();
                  onClose(t.id);
                }
              }}
              className={cn(
                "group relative mb-1 flex cursor-pointer items-center gap-2 rounded-lg border px-2 py-2 text-left outline-none transition-colors duration-[var(--dur-base)]",
                "focus-visible:ring-2 focus-visible:ring-primary/40",
                isActive
                  ? "border-primary/40 bg-foreground/[0.07] text-foreground dark:bg-foreground/[0.09]"
                  : "border-transparent text-muted-foreground hover:bg-foreground/[0.045] hover:text-foreground",
                draggingId === t.id && "opacity-50",
              )}
            >
              {t.kind === "editor" ? (
                <DropdownMenu
                  onOpenChange={(open) => {
                    if (!open) setShowAllLanguages(false);
                  }}
                >
                  <DropdownMenuTrigger asChild>
                    <span
                      role="button"
                      tabIndex={-1}
                      data-no-drag
                      title="Change language mode"
                      onPointerDown={(e) => e.stopPropagation()}
                      onMouseDown={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                      }}
                      className="flex size-7 shrink-0 cursor-pointer items-center justify-center rounded-md border border-border/50 bg-card/70 transition-all hover:ring-1 hover:ring-primary/30"
                    >
                      <TabIcon tab={t} />
                    </span>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    align="start"
                    side="bottom"
                    sideOffset={6}
                    alignOffset={-4}
                    className="max-h-75 w-48 overflow-y-auto rounded-xl border border-border/40 bg-popover/90 p-1 backdrop-blur-md shadow-lg"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    onPointerUp={(e) => e.stopPropagation()}
                  >
                    <DropdownMenuItem
                      onSelect={() => onOverrideLanguage?.(t.id, null)}
                      className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg cursor-default focus:bg-accent focus:text-accent-foreground"
                    >
                      <img
                        src={fileIconUrl(t.title)}
                        className="size-3.5 shrink-0 object-contain"
                        alt=""
                      />
                      <div className="flex flex-1 flex-col">
                        <span>Auto Detect</span>
                        <span className="text-[10px] text-muted-foreground italic">
                          Mode: {resolveDisplayName(t.title)}
                        </span>
                      </div>
                      {!(t as EditorTab).overrideLanguage && (
                        <HugeiconsIcon
                          icon={Tick02Icon}
                          className="size-3.5 text-primary"
                        />
                      )}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onSelect={(e) => {
                        e.preventDefault();
                        setShowAllLanguages((v) => !v);
                      }}
                      className="w-full px-2.5 py-1.5 text-left text-xs text-primary/60 hover:text-primary rounded-lg transition-colors hover:bg-accent"
                    >
                      {showAllLanguages
                        ? "↑ Fewer languages"
                        : "↓ All languages"}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator className="my-1 border-t border-border/30" />
                    {(showAllLanguages ? ALL_LANGUAGES : EXPOSED_LANGUAGES).map(
                      (lang) => {
                        const isSelected =
                          (t as EditorTab).overrideLanguage === lang.ext;
                        return (
                          <DropdownMenuItem
                            key={lang.ext}
                            onSelect={() => onOverrideLanguage?.(t.id, lang.ext)}
                            className="flex items-center gap-2 px-2.5 py-1.5 text-xs rounded-lg cursor-default focus:bg-accent focus:text-accent-foreground"
                          >
                            <img
                              src={fileIconUrl(`dummy.${lang.ext}`)}
                              className="size-3.5 shrink-0 object-contain"
                              alt=""
                            />
                            <span className="flex-1">{lang.name}</span>
                            {isSelected && (
                              <HugeiconsIcon
                                icon={Tick02Icon}
                                className="size-3.5 text-primary"
                              />
                            )}
                          </DropdownMenuItem>
                        );
                      },
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border/50 bg-card/70">
                  <TabIcon tab={t} />
                </span>
              )}

              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                {editingId === t.id && t.kind === "terminal" ? (
                  <TabRenameInput
                    initial={labelFor(t)}
                    onCommit={(value) => {
                      onRename(t.id, value);
                      setEditingId(null);
                    }}
                    onCancel={() => setEditingId(null)}
                  />
                ) : (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-[12px] font-medium",
                        isPreview && "italic",
                      )}
                    >
                      {labelFor(t)}
                    </span>
                    {t.kind === "editor" && t.dirty ? (
                      <span
                        aria-label="Unsaved changes"
                        className="size-1.5 shrink-0 rounded-full bg-foreground/70"
                      />
                    ) : null}
                  </span>
                )}
                {subtitle ? (
                  <span className="truncate text-[10px] text-muted-foreground/90">
                    {subtitle}
                  </span>
                ) : null}
              </span>

              {tabs.length > 1 ? (
                <span
                  role="button"
                  tabIndex={-1}
                  data-no-drag
                  aria-label="Close tab"
                  title="Close tab"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={(e) => {
                    e.stopPropagation();
                    onClose(t.id);
                  }}
                  className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100"
                >
                  <HugeiconsIcon icon={Cancel01Icon} size={12} strokeWidth={2} />
                </span>
              ) : null}
            </div>
          );

          return (
            <div key={t.id} data-tab-row className="relative">
              {dropGap === index && draggingId !== null ? (
                <span className="pointer-events-none absolute inset-x-1 -top-px z-[2] h-0.5 rounded-full bg-primary/70" />
              ) : null}
              {t.kind === "terminal" ? (
                <ContextMenu>
                  <ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
                  <ContextMenuContent
                    className="min-w-32 p-1"
                    onCloseAutoFocus={(e) => e.preventDefault()}
                  >
                    <ContextMenuItem
                      className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                      onSelect={() => setEditingId(t.id)}
                    >
                      <HugeiconsIcon
                        icon={PencilEdit02Icon}
                        size={13}
                        strokeWidth={1.75}
                      />
                      <span className="flex-1">Rename</span>
                    </ContextMenuItem>
                    {tabs.length > 1 && (
                      <>
                        <ContextMenuSeparator />
                        <ContextMenuItem
                          className="gap-2 rounded-xl px-2.5 py-1.5 text-[13px]"
                          onSelect={() => onClose(t.id)}
                        >
                          <HugeiconsIcon
                            icon={Cancel01Icon}
                            size={13}
                            strokeWidth={1.75}
                          />
                          <span className="flex-1">Close</span>
                        </ContextMenuItem>
                      </>
                    )}
                  </ContextMenuContent>
                </ContextMenu>
              ) : (
                row
              )}
              {dropGap === index + 1 && draggingId !== null ? (
                <span className="pointer-events-none absolute inset-x-1 -bottom-px z-[2] h-0.5 rounded-full bg-primary/70" />
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function TabRenameInput({
  initial,
  onCommit,
  onCancel,
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  // Guards against a trailing blur re-resolving an edit that Enter/Escape
  // already finished (Escape must never commit).
  const done = useRef(false);

  useEffect(() => {
    // Focus on the next frame so it runs after the context menu restores focus
    // to its trigger when closing; a synchronous focus would be stolen.
    const raf = requestAnimationFrame(() => {
      ref.current?.focus();
      ref.current?.select();
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const finish = (fn: () => void) => {
    if (done.current) return;
    done.current = true;
    fn();
  };

  // explicit = the user pressed Enter, which pins even the unchanged label. A
  // plain blur with no change must not freeze the cwd-derived default into a
  // custom title.
  const commit = (value: string, explicit: boolean) => {
    if (!explicit && value.trim() === initial.trim()) finish(onCancel);
    else finish(() => onCommit(value));
  };

  return (
    <input
      ref={ref}
      defaultValue={initial}
      aria-label="Rename tab"
      data-no-drag
      onPointerDown={(e) => e.stopPropagation()}
      className={cn(
        "w-full min-w-0 rounded-sm bg-background px-1 text-[12px] text-foreground",
        "outline-none ring-1 ring-border focus:ring-ring",
      )}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") commit(e.currentTarget.value, true);
        else if (e.key === "Escape") finish(onCancel);
      }}
      onBlur={(e) => {
        // Switching windows/apps blurs the input; keep the edit open instead
        // of resolving it on the way out.
        if (!document.hasFocus()) return;
        commit(e.currentTarget.value, false);
      }}
    />
  );
}
