import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Checkbox } from "@/components/ui/checkbox";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import {
  ArrowLeft01Icon,
  ArrowRight01Icon,
  Menu01Icon,
  PlusSignIcon,
  RefreshIcon,
  ShieldKeyIcon,
} from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { type RefObject, useCallback, useEffect, useState } from "react";
import { type Bookmark, tileFor } from "./lib/collections";
import type { OverlaySource } from "./lib/suppression";
import {
  type ExtensionInfo,
  useBrowserCollections,
} from "./lib/useCollections";

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
  /**
   * The panel's own menus suppress by code, not by the selector scan: Radix
   * sizes popper content via attribute mutations the overlay observer never
   * sees, so a menu without this opens behind the native webview.
   */
  onSuppress: (source: OverlaySource) => void;
  onRelease: (source: OverlaySource) => void;
};

const CLEAR_SCOPES: Array<{ id: string; label: string }> = [
  { id: "cookies", label: "Cookies e logins" },
  { id: "cache", label: "Cache de disco" },
  { id: "cache_storage", label: "Cache storage" },
  { id: "dom_storage", label: "Armazenamento de sites (localStorage, IndexedDB)" },
  { id: "history", label: "Historico interno do Chromium" },
  { id: "downloads", label: "Historico de downloads" },
  { id: "autofill", label: "Autopreenchimento" },
  { id: "passwords", label: "Senhas salvas" },
];

/** Rail width, kept out of the host so the native HWND never covers it. */
const RAIL_WIDTH = 40;

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
  onSuppress,
  onRelease,
}: Props) {
  const [draft, setDraft] = useState(url);
  const [editing, setEditing] = useState(false);
  const collections = useBrowserCollections(true);
  const { record } = collections;
  const [extensionsOpen, setExtensionsOpen] = useState(false);
  const [clearOpen, setClearOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const menuGate = useCallback(
    (open: boolean) => {
      if (open) {
        onSuppress("browser-menu");
      } else {
        onRelease("browser-menu");
      }
    },
    [onSuppress, onRelease],
  );

  const setExtensionsOpenGated = useCallback(
    (open: boolean) => {
      setExtensionsOpen(open);
      menuGate(open);
    },
    [menuGate],
  );
  const setClearOpenGated = useCallback(
    (open: boolean) => {
      setClearOpen(open);
      menuGate(open);
    },
    [menuGate],
  );

  // Follow the page while the user is not mid-edit — the panel navigates on its
  // own (links, pushState) and a frozen address bar is a lie.
  useEffect(() => {
    if (!editing) setDraft(url);
  }, [url, editing]);

  // The URL poll is the cross-platform navigation feed; the COM events on
  // Windows land in the same reducer, whose coalescing absorbs the overlap.
  useEffect(() => {
    if (url) record(url);
  }, [url, record]);

  // Errors from menu actions surface in the same strip as attach errors —
  // anything drawn inside the host would be painted over by the webview.
  const act = useCallback(async (label: string, task: () => Promise<unknown>) => {
    try {
      await task();
      setNotice(null);
    } catch (e) {
      setNotice(`${label}: ${String(e)}`);
    }
  }, []);

  return (
    <div className="flex h-full min-h-0 border-r border-border/60 bg-card">
      {/* Bookmark rail. A plain flex sibling of the content column, never a
          panel of the resizable group (the group remembers layouts per id set)
          and never inside the host (the HWND paints over everything there).
          Native `title` tooltips only: a Radix tooltip over the rail would
          cross the webview and suppression would blank the whole browser on
          every hover. */}
      <div
        style={{ width: RAIL_WIDTH }}
        className="flex shrink-0 flex-col items-center gap-1 overflow-y-auto border-r border-border/60 bg-card/80 py-1.5"
      >
        <button
          type="button"
          onClick={() =>
            void act("adicionar favorito", collections.addBookmarkFromCurrentPage)
          }
          title="Salvar a pagina atual como favorito"
          aria-label="Salvar favorito"
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          <HugeiconsIcon icon={PlusSignIcon} size={16} strokeWidth={1.75} />
        </button>

        <div className="h-px w-6 shrink-0 bg-border/60" />

        {collections.bookmarks.map((bookmark) => (
          <BookmarkButton
            key={bookmark.id}
            bookmark={bookmark}
            onOpen={() => onNavigate(bookmark.url)}
            onDelete={() => collections.deleteBookmark(bookmark.id)}
            onMenuOpenChange={menuGate}
          />
        ))}

        <div className="min-h-2 flex-1" />

        <DropdownMenu onOpenChange={menuGate}>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              title="Menu do browser"
              aria-label="Menu do browser"
              className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <HugeiconsIcon icon={Menu01Icon} size={16} strokeWidth={1.75} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side="right" align="end" className="w-72">
            <DropdownMenuLabel>Historico</DropdownMenuLabel>
            {collections.history.length === 0 ? (
              <DropdownMenuItem disabled>Nenhuma pagina visitada</DropdownMenuItem>
            ) : (
              [...collections.history]
                .slice(-12)
                .reverse()
                .map((entry) => (
                  <DropdownMenuItem
                    key={entry.seq}
                    onSelect={() => onNavigate(entry.url)}
                    className="flex-col items-start gap-0"
                  >
                    <span className="w-full truncate text-xs">
                      {entry.title || entry.url}
                    </span>
                    <span className="w-full truncate text-[10px] text-muted-foreground">
                      {entry.url}
                    </span>
                  </DropdownMenuItem>
                ))
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => setExtensionsOpenGated(true)}>
              Extensoes
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setClearOpenGated(true)}>
              Limpar dados
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
        {error || notice ? (
          <div className="flex shrink-0 items-start gap-2 border-b border-border/60 bg-foreground/[0.03] px-2 py-1.5">
            <p className="min-w-0 flex-1 text-[10px] leading-relaxed text-muted-foreground">
              {error ?? notice}
            </p>
            {error ? (
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[10px] font-medium text-foreground/80 outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Retry
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[10px] font-medium text-foreground/80 outline-none transition-colors hover:bg-foreground/[0.06] hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/40"
              >
                Fechar
              </button>
            )}
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

      <ExtensionsDialog
        open={extensionsOpen}
        onOpenChange={setExtensionsOpenGated}
        onNotice={setNotice}
      />
      <ClearDataDialog
        open={clearOpen}
        onOpenChange={setClearOpenGated}
        onNotice={setNotice}
      />
    </div>
  );
}

function BookmarkButton({
  bookmark,
  onOpen,
  onDelete,
  onMenuOpenChange,
}: {
  bookmark: Bookmark;
  onOpen: () => void;
  onDelete: () => void;
  onMenuOpenChange: (open: boolean) => void;
}) {
  const tile = tileFor(bookmark.url);
  return (
    <ContextMenu onOpenChange={onMenuOpenChange}>
      <ContextMenuTrigger asChild>
        <button
          type="button"
          onClick={onOpen}
          title={`${bookmark.title}\n${bookmark.url}`}
          aria-label={bookmark.title}
          className="flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-md outline-none transition-colors hover:bg-foreground/[0.08] focus-visible:ring-2 focus-visible:ring-primary/40"
        >
          {bookmark.iconPng ? (
            <img
              src={`data:image/png;base64,${bookmark.iconPng}`}
              alt=""
              className="size-5 rounded-sm"
            />
          ) : (
            <span
              aria-hidden
              className="flex size-5 items-center justify-center rounded-sm text-[10px] font-semibold text-white"
              style={{ backgroundColor: `oklch(0.55 0.12 ${tile.hue})` }}
            >
              {tile.letter}
            </span>
          )}
        </button>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onSelect={onOpen}>Abrir</ContextMenuItem>
        <ContextMenuItem variant="destructive" onSelect={onDelete}>
          Remover favorito
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function ExtensionsDialog({
  open,
  onOpenChange,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNotice: (notice: string | null) => void;
}) {
  const [extensions, setExtensions] = useState<ExtensionInfo[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [folder, setFolder] = useState("");
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setExtensions(await invoke<ExtensionInfo[]>("browser_extensions_list"));
      setFailure(null);
    } catch (e) {
      setExtensions(null);
      setFailure(String(e));
    }
  }, []);

  useEffect(() => {
    if (open) void refresh();
  }, [open, refresh]);

  const add = useCallback(async () => {
    const path = folder.trim();
    if (!path || busy) return;
    setBusy(true);
    try {
      await invoke("browser_extension_add", { path });
      setFolder("");
      await refresh();
      onNotice(null);
    } catch (e) {
      setFailure(String(e));
    } finally {
      setBusy(false);
    }
  }, [folder, busy, refresh, onNotice]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Extensoes</DialogTitle>
          <DialogDescription>
            Extensoes descompactadas (pasta com manifest.json) carregadas no
            perfil do painel. Elas rodam com acesso a tudo que o painel navega.
          </DialogDescription>
        </DialogHeader>

        {failure ? (
          <p className="text-xs leading-relaxed text-destructive">{failure}</p>
        ) : null}

        <div className="flex max-h-52 flex-col gap-1 overflow-y-auto">
          {extensions?.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma extensao carregada.</p>
          ) : null}
          {extensions?.map((ext) => (
            <div
              key={ext.id}
              className="flex items-center gap-2 rounded-md bg-foreground/[0.03] px-2 py-1.5"
            >
              <span className="min-w-0 flex-1 truncate text-xs">
                {ext.name}
                {ext.enabled ? "" : " (desativada)"}
              </span>
              <button
                type="button"
                onClick={() =>
                  void invoke("browser_extension_remove", { id: ext.id })
                    .then(refresh)
                    .catch((e) => setFailure(String(e)))
                }
                className="shrink-0 cursor-pointer rounded-md px-1.5 py-0.5 text-[10px] font-medium text-destructive outline-none transition-colors hover:bg-destructive/10"
              >
                Remover
              </button>
            </div>
          ))}
        </div>

        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            value={folder}
            onChange={(e) => setFolder(e.target.value)}
            placeholder="C:\caminho\da\extensao-descompactada"
            spellCheck={false}
            className="h-8 text-xs"
          />
          <button
            type="submit"
            disabled={busy || !folder.trim()}
            className="shrink-0 cursor-pointer rounded-md bg-foreground/[0.06] px-2.5 py-1.5 text-xs font-medium text-foreground outline-none transition-colors hover:bg-foreground/[0.1] disabled:cursor-default disabled:opacity-50"
          >
            Carregar
          </button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClearDataDialog({
  open,
  onOpenChange,
  onNotice,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onNotice: (notice: string | null) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(
    () => new Set(["cache", "cache_storage"]),
  );

  const toggle = (id: string, on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) {
        next.add(id);
      } else {
        next.delete(id);
      }
      return next;
    });
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Limpar dados do browser</AlertDialogTitle>
          <AlertDialogDescription>
            Apaga somente o que estiver marcado, somente do perfil do painel de
            browser. Cookies e logins marcados = sessoes deslogadas. Os
            favoritos e o historico do Micah nao sao tocados por esta acao.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          {CLEAR_SCOPES.map((scope) => (
            <label key={scope.id} className="flex items-center gap-2 text-xs">
              <Checkbox
                checked={selected.has(scope.id)}
                onCheckedChange={(v) => toggle(scope.id, v === true)}
              />
              {scope.label}
            </label>
          ))}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancelar</AlertDialogCancel>
          <AlertDialogAction
            disabled={selected.size === 0}
            onClick={() =>
              void invoke("browser_clear_data", { kinds: [...selected] })
                .then(() => onNotice(null))
                .catch((e) => onNotice(`limpar dados: ${String(e)}`))
            }
          >
            Limpar
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
