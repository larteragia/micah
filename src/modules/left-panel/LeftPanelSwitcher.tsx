import { cn } from "@/lib/utils";
import {
  LEFT_PANEL_MODE_LABELS,
  LEFT_PANEL_MODES,
  type LeftPanelMode,
} from "./lib/mode";

type Props = {
  mode: LeftPanelMode;
  open: boolean;
  onSelect: (mode: LeftPanelMode) => void;
  browserAvailable: boolean;
};

/**
 * The three surfaces of the left panel, in a fixed order read straight from
 * `LEFT_PANEL_MODES`.
 */
export function LeftPanelSwitcher({
  mode,
  open,
  onSelect,
  browserAvailable,
}: Props) {
  return (
    <div
      data-left-panel-switcher
      className="flex h-7 shrink-0 items-center gap-0.5 rounded-md bg-foreground/[0.04] p-0.5 dark:bg-foreground/[0.06]"
    >
      {LEFT_PANEL_MODES.map((id) => {
        const isActive = open && id === mode;
        const unavailable = id === "browser" && !browserAvailable;
        return (
          <button
            key={id}
            type="button"
            data-left-panel-mode={id}
            aria-pressed={isActive}
            disabled={unavailable}
            title={
              unavailable
                ? "The browser panel is turned off"
                : LEFT_PANEL_MODE_LABELS[id]
            }
            onClick={() => onSelect(id)}
            className={cn(
              "h-6 cursor-pointer rounded-[5px] px-2 text-xs font-medium outline-none transition-colors duration-[var(--dur-base)]",
              "focus-visible:ring-2 focus-visible:ring-primary/40",
              unavailable && "cursor-not-allowed opacity-40",
              isActive
                ? "bg-card text-foreground shadow-[0_1px_2px_rgba(0,0,0,0.08)]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {LEFT_PANEL_MODE_LABELS[id]}
          </button>
        );
      })}
    </div>
  );
}
