import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

/**
 * Open another app window in this same process. `cwd` seeds the new window's
 * workspace so it starts where the caller is, instead of at the launch dir.
 */
export async function openNewWindow(cwd?: string | null): Promise<void> {
  try {
    await invoke<string>("open_new_window", { cwd: cwd ?? null });
  } catch (error) {
    console.error("open_new_window failed:", error);
    toast.error("Could not open a new window");
  }
}
