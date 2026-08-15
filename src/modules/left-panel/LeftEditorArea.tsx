import { cn } from "@/lib/utils";
import { EditorStack, type EditorPaneHandle } from "@/modules/editor";
import { MarkdownStack } from "@/modules/markdown";
import type { Tab } from "@/modules/tabs";
import { LeftPanelEmpty } from "./LeftPanelEmpty";

type Props = {
  /** Left-pane tabs of the active space, in strip order. */
  tabs: Tab[];
  /** Every left-pane tab across all spaces. The stacks mount these so a
   * space switch never unmounts an editor with an unsaved buffer; hidden
   * ones cost nothing beyond their kept state. */
  stackTabs: Tab[];
  /** Active left tab id, or null when the panel is empty. */
  activeId: number | null;
  onSelect: (id: number) => void;
  onClose: (id: number) => void;
  registerHandle: (id: number, handle: EditorPaneHandle | null) => void;
  onDirtyChange: (id: number, dirty: boolean) => void;
  onSetMarkdownView: (id: number, mode: "rendered" | "raw") => void;
};

/**
 * The Editor mode of the left panel: a compact tab strip over the same
 * EditorStack/MarkdownStack surfaces the workspace uses, fed only with
 * `pane === "left"` tabs. Keeping the stacks shared means handles, dirty
 * state and the markdown toggle behave identically in both panels. The
 * stacks never unmount while this component is mounted; the empty state
 * overlays them, it does not replace them.
 */
export function LeftEditorArea({
  tabs,
  stackTabs,
  activeId,
  onSelect,
  onClose,
  registerHandle,
  onDirtyChange,
  onSetMarkdownView,
}: Props) {
  const active = tabs.find((t) => t.id === activeId);
  const stackActiveId = active?.id ?? -1;
  const isMarkdown = active?.kind === "markdown";
  const empty = tabs.length === 0;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <div
        data-left-editor-strip
        className={cn(
          "flex h-8 shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border/60 px-1.5",
          empty && "hidden",
        )}
      >
        {tabs.map((t) => {
          const isActive = t.id === activeId;
          const dirty = t.kind === "editor" && t.dirty;
          return (
            <div
              key={t.id}
              className={cn(
                "group flex h-6 shrink-0 items-center gap-1 rounded-[5px] pr-0.5 pl-2 text-xs transition-colors duration-[var(--dur-base)]",
                isActive
                  ? "bg-foreground/[0.07] text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <button
                type="button"
                className="max-w-40 cursor-pointer truncate outline-none"
                title={t.title}
                onClick={() => onSelect(t.id)}
              >
                {t.title}
                {dirty ? <span className="ml-1 align-middle">•</span> : null}
              </button>
              <button
                type="button"
                aria-label={`Close ${t.title}`}
                className="flex h-4 w-4 cursor-pointer items-center justify-center rounded-sm text-muted-foreground/70 opacity-0 outline-none transition-opacity hover:bg-foreground/10 hover:text-foreground group-hover:opacity-100"
                onClick={() => onClose(t.id)}
              >
                ×
              </button>
            </div>
          );
        })}
      </div>
      <div
        className={cn("relative min-h-0 flex-1", empty && "invisible")}
        aria-hidden={empty}
      >
        <div
          className={cn(
            "absolute inset-0 p-2",
            isMarkdown && "invisible pointer-events-none",
          )}
          aria-hidden={isMarkdown}
        >
          <EditorStack
            tabs={stackTabs}
            activeId={stackActiveId}
            registerHandle={registerHandle}
            onDirtyChange={onDirtyChange}
            onCloseTab={onClose}
            onSetMarkdownView={onSetMarkdownView}
          />
        </div>
        <div
          className={cn(
            "absolute inset-0 p-2",
            !isMarkdown && "invisible pointer-events-none",
          )}
          aria-hidden={!isMarkdown}
        >
          <MarkdownStack
            tabs={stackTabs}
            activeId={stackActiveId}
            onSetMarkdownView={onSetMarkdownView}
          />
        </div>
      </div>
      {empty ? (
        <div className="absolute inset-0 bg-card">
          <LeftPanelEmpty
            title="No file open here"
            hint="Files opened from the sidebar land in this panel while Editor is selected."
          />
        </div>
      ) : null}
    </div>
  );
}
