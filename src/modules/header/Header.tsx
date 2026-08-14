import { Button } from "@/components/ui/button";
import { WindowControls } from "@/components/WindowControls";
import { IS_MAC, USE_CUSTOM_WINDOW_CONTROLS } from "@/lib/platform";
import { NotificationBell } from "@/modules/agents";
import {
  CommandIcon,
  Settings01Icon,
  SidebarLeftIcon,
  SidebarRightIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  type ReactNode,
  type RefObject,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  SearchInline,
  type SearchInlineHandle,
  type SearchTarget,
} from "./SearchInline";

type Props = {
  onToggleSidebar: () => void;
  onToggleLeftPanel: () => void;
  leftPanelOpen: boolean;
  onOpenCommandPalette: () => void;
  onActivateAgent: (tabId: number, leafId: number) => void;
  onActivateLocalAgent: () => void;
  onOpenSettings: () => void;
  leftPanelSwitcher: ReactNode;
  spaceSwitcher: ReactNode;
  searchTarget: SearchTarget;
  searchRef: RefObject<SearchInlineHandle | null>;
};

const COMPACT_WIDTH = 720;

export function Header({
  onToggleSidebar,
  onToggleLeftPanel,
  leftPanelOpen,
  onOpenCommandPalette,
  onActivateAgent,
  onActivateLocalAgent,
  onOpenSettings,
  leftPanelSwitcher,
  spaceSwitcher,
  searchTarget,
  searchRef,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setCompact(w < COMPACT_WIDTH);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const settingsButton = (
    <Button
      variant="ghost"
      size="icon"
      className="size-7 shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={onOpenSettings}
      title="Settings"
    >
      <HugeiconsIcon icon={Settings01Icon} size={15} strokeWidth={1.75} />
    </Button>
  );

  // Left-panel toggle, spaces, bell, command palette and sidebar toggle sit on
  // the right next to the settings gear, mirrored so the sidebar toggle lands
  // closest to it. The left panel docks opposite the sidebar, so its toggle
  // mirrors the sidebar one: same button, icon pointing the other way.
  const controlCluster = (
    <div className="flex shrink-0 items-center gap-0.5">
      <Button
        onClick={onToggleLeftPanel}
        title={leftPanelOpen ? "Hide left panel" : "Show left panel"}
        aria-pressed={leftPanelOpen}
        variant="ghost"
        size="icon-sm"
        className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={SidebarLeftIcon} size={18} strokeWidth={1.75} />
      </Button>

      {spaceSwitcher}

      <NotificationBell
        onActivate={onActivateAgent}
        onActivateLocal={onActivateLocalAgent}
      />

      <Button
        size="icon-sm"
        variant="ghost"
        onClick={onOpenCommandPalette}
        title="Command palette"
        className="shrink-0 gap-1.5 rounded-md px-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={CommandIcon} size={14} strokeWidth={1.75} />
      </Button>

      <Button
        onClick={onToggleSidebar}
        title="Toggle sidebar"
        variant="ghost"
        size="icon-sm"
        className="shrink-0 rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <HugeiconsIcon icon={SidebarRightIcon} size={18} strokeWidth={1.75} />
      </Button>
    </div>
  );

  return (
    <div
      ref={rootRef}
      data-tauri-drag-region
      className={`flex h-10 shrink-0 items-center gap-2 border-b border-border/60 bg-card select-none ${
        IS_MAC ? "pr-2 pl-20" : "pr-0 pl-2"
      }`}
    >
      {/* Tabs live in the sidebar's Tabs panel; the top-left corner belongs to
          the left panel's mode switcher and the rest stays window drag surface.
          Spaces moved into the control cluster on the right. */}
      <div
        className="flex min-w-0 flex-1 items-center gap-2"
        data-tauri-drag-region
      >
        {leftPanelSwitcher}
        <div data-tauri-drag-region className="h-full min-w-2 flex-1" />
      </div>

      <SearchInline ref={searchRef} target={searchTarget} compact={compact} />

      <span className="mx-1 h-full w-px shrink-0 bg-border/70" />

      {controlCluster}

      {settingsButton}

      {USE_CUSTOM_WINDOW_CONTROLS && (
        <>
          <span className="ml-1 h-5 w-px shrink-0 bg-border/60" />
          <WindowControls />
        </>
      )}
    </div>
  );
}
