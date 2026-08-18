/**
 * Live feed for Micah's Mind: picks which Claude session the scene follows,
 * reads the WHOLE transcript from offset 0 (the city and the judge need the
 * full story, unlike the old viewer that only kept a tail), folds new lines
 * incrementally and freezes one citymap per session.
 */

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";
import {
  buildCityMap,
  type CityEntry,
  type CityMap,
  cleanRel,
  placeGhost,
  type Rect,
} from "./citymap";
import { normalizeSlashes } from "./classify";
import {
  emptyMindFold,
  foldMindLines,
  type MindFold,
  resetMindFold,
} from "./foldTrace";

type SessionTail = {
  found: boolean;
  data: string;
  next_offset: number;
  has_more: boolean;
  clipped: boolean;
};

const POLL_MS = 700;
const CATCHUP_MS = 60;
const ABSENT_POLL_MS = 3000;
/** Hard ceiling per fs_list_files call, matching the Rust hard limit. */
const SCAN_LIMIT = 10_000;
/** A workspace-looking root (many touched top dirs) maps only those dirs. */
const WORKSPACE_TOPDIR_THRESHOLD = 6;
const MAX_SCAN_ROOTS = 8;

export type MindSessionPick = {
  session: string | null;
  why:
    | "focused-leaf"
    | "single-anchored"
    | "ambiguous"
    | "none"
    | "manual"
    | "auto-recent";
};

/**
 * Auditor correction 10: the focused pane of the active tab decides; with no
 * resolvable focus, exactly one anchored visible pane still wins; two or
 * more is ambiguous and shows the empty state instead of guessing.
 */
export function pickMindSession(args: {
  activeLeafId?: number | null;
  resolveLeafResume?: (leafId: number) => string | null;
  anchoredLeaves?: { leafId: number; resume: string }[];
  visibleLeafIds?: number[];
}): MindSessionPick {
  const { activeLeafId, resolveLeafResume, anchoredLeaves, visibleLeafIds } =
    args;
  if (activeLeafId != null && resolveLeafResume) {
    const resume = resolveLeafResume(activeLeafId);
    if (resume) return { session: resume, why: "focused-leaf" };
  }
  const inScope = (leafId: number) =>
    visibleLeafIds === undefined || visibleLeafIds.includes(leafId);
  const anchored = (anchoredLeaves ?? [])
    .filter((a) => inScope(a.leafId) && a.resume)
    .sort((a, b) => a.leafId - b.leafId);
  if (anchored.length === 1)
    return { session: anchored[0].resume, why: "single-anchored" };
  if (anchored.length > 1) return { session: null, why: "ambiguous" };
  return { session: null, why: "none" };
}

/** Top-level dirs of touched paths, in first-seen order. */
export function touchedTopDirs(rels: string[]): string[] {
  const out: string[] = [];
  for (const rel of rels) {
    const slash = rel.indexOf("/");
    if (slash <= 0) continue;
    const top = rel.slice(0, slash);
    if (!out.includes(top)) out.push(top);
  }
  return out;
}

/**
 * Fixed priority for what the scene follows (card sempre-visivel): a real
 * anchor beats a manual picker choice, a manual choice beats the
 * auto-connect. An ambiguous verdict (two anchored panes, no focus) no
 * longer blocks the auto-connect: with the selector and the replay badge
 * on screen, following the freshest session of the location is labeled
 * provenance, not guessing — and the user can pick another in one click.
 */
export function composePick(
  anchored: MindSessionPick,
  manualSession: string | null,
  auto: { session: string | null; forCwd: string } | null,
): MindSessionPick {
  if (anchored.session) return anchored;
  if (manualSession) return { session: manualSession, why: "manual" };
  if (auto?.session) return { session: auto.session, why: "auto-recent" };
  return anchored;
}

/**
 * Transcript not found mid-feed: a session that ALREADY synced keeps its
 * city and fold on screen as "missing" (the transcript went away — badge
 * tells the truth, map stays); a session never seen is just "absent".
 */
export function absentStatus(synced: boolean): "missing" | "absent" {
  return synced ? "missing" : "absent";
}

function dropLeadingPartialLine(chunk: string): string {
  const nl = chunk.indexOf("\n");
  return nl === -1 ? "" : chunk.slice(nl + 1);
}

function splitChunk(
  carry: string,
  chunk: string,
): { lines: string[]; carry: string } {
  const text = carry + chunk;
  const parts = text.split("\n");
  const rest = parts.pop() ?? "";
  return { lines: parts.filter((l) => l.length > 0), carry: rest };
}

/**
 * fs_list_files returns paths RELATIVE to the scanned root (search.rs strips
 * the root before returning); a full-root scan maps them straight in, a
 * subdir scan must re-prefix the subdir's own path inside the root. Absolute
 * junk is dropped by cleanRel. Pure so the contract stays pinned by tests.
 */
export function mapScanFiles(
  root: string,
  scanRoot: string,
  files: string[],
): CityEntry[] {
  const rootNorm = normalizeSlashes(root).replace(/\/+$/, "");
  const scanNorm = normalizeSlashes(scanRoot).replace(/\/+$/, "");
  // A scan root outside the city root would seat foreign paths as repo
  // files: drop the whole scan instead of mapping it to a lie.
  if (scanNorm !== rootNorm && !scanNorm.startsWith(`${rootNorm}/`)) return [];
  const subPrefix =
    scanNorm === rootNorm ? "" : scanNorm.slice(rootNorm.length + 1);
  const out: CityEntry[] = [];
  for (const file of files) {
    const cleaned = cleanRel(file);
    if (cleaned === "") continue;
    out.push(subPrefix === "" ? { rel: cleaned } : { rel: `${subPrefix}/${cleaned}` });
  }
  return out;
}

async function scanEntries(
  root: string,
  subDirs: string[] | null,
): Promise<CityEntry[] | null> {
  const roots = subDirs ? subDirs.slice(0, MAX_SCAN_ROOTS) : [root];
  const perRoot = Math.max(200, Math.floor(SCAN_LIMIT / roots.length));
  const out: CityEntry[] = [];
  for (const r of roots) {
    try {
      const res = await invoke<{ files: string[]; truncated: boolean }>(
        "fs_list_files",
        {
          root: r,
          limit: perRoot,
          showHidden: false,
        },
      );
      out.push(...mapScanFiles(root, r, res.files));
    } catch {
      // one dead root does not kill the map; every root dead falls through
      // to null below and tier-1 seats the touched paths without ghosts
    }
  }
  return out.length > 0 ? out : null;
}

export type MindFeed = {
  /** city = city-only mode: repo city without any transcript. */
  status: "off" | "probing" | "feed" | "absent" | "city" | "missing";
  pick: MindSessionPick;
  fold: MindFold | null;
  city: CityMap | null;
  /** Ghost points for paths touched after the city froze. */
  lateGhosts: Map<string, Rect>;
  version: number;
};

/**
 * Follow the picked session transcript from byte zero and keep the fold and
 * the frozen city up to date. Only one feed runs at a time (one scene), and
 * polling stops the moment the consumer unmounts or the pick goes null.
 * With no session but a cityRoot, the scene still draws: the repository
 * city from a plain scan, dark and untouched.
 */
export function useMindFeed(
  pick: MindSessionPick,
  enabled: boolean,
  cityRoot?: string | null,
): MindFeed {
  const [state, setState] = useState<MindFeed>({
    status:
      pick.session && enabled
        ? "probing"
        : pick.session
          ? "off"
          : cityRoot
            ? "city"
            : "absent",
    pick,
    fold: null,
    city: null,
    lateGhosts: new Map(),
    version: 0,
  });

  const pickRef = useRef(pick);
  pickRef.current = pick;
  const cityRootRef = useRef(cityRoot);
  cityRootRef.current = cityRoot;

  // City-only: no transcript to follow, the pane cwd is the map. Pure scan,
  // zero touched files, no polling — the dark city that is always there.
  useEffect(() => {
    if (!enabled || pick.session || !cityRoot) return;
    let alive = true;
    setState((s) => ({
      ...s,
      status: "city",
      pick: pickRef.current,
      fold: null,
      // Drop the previous session's colored city immediately: a stale lit
      // map under a "cidade sem sessão" badge would be a lie (auditor 4).
      city: null,
      lateGhosts: new Map(),
      version: s.version + 1,
    }));
    void (async () => {
      const entries = await scanEntries(cityRoot, null);
      if (!alive) return;
      const city = buildCityMap({ root: cityRoot, entries, touched: [] });
      if (!alive) return;
      setState((s) => ({ ...s, city, version: s.version + 1 }));
    })();
    return () => {
      alive = false;
    };
  }, [enabled, pick.session, cityRoot]);

  useEffect(() => {
    const sessionId = pick.session;
    if (!enabled || !sessionId) {
      setState((s) => ({
        ...s,
        status: sessionId
          ? "off"
          : cityRootRef.current
            ? "city"
            : "absent",
        pick: pickRef.current,
      }));
      return;
    }
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let offset = 0;
    let carry = "";
    let synced = false;
    const fold = emptyMindFold(sessionId);
    let city: CityMap | null = null;
    /** Rel paths a FULL scan saw; weak targets outside it are garbage. */
    let scannedRel: Set<string> | null = null;
    const lateGhosts = new Map<string, Rect>();
    let bump = 0;

    const publish = (status: MindFeed["status"]) => {
      if (!alive) return;
      bump++;
      setState({
        status,
        pick: pickRef.current,
        fold,
        city,
        lateGhosts: new Map(lateGhosts),
        version: bump,
      });
    };

    const ensureCity = async (): Promise<void> => {
      if (city || !fold.session.cwd) return;
      const root = fold.session.cwd;
      const touchedRels = [...fold.touched.keys()]
        .map((p) => cleanRel(p))
        .filter(Boolean);
      const tops = touchedTopDirs(touchedRels);
      const subDirs =
        tops.length > WORKSPACE_TOPDIR_THRESHOLD
          ? tops.map(
              (t) => `${normalizeSlashes(root).replace(/\/+$/, "")}/${t}`,
            )
          : null;
      const entries = await scanEntries(root, subDirs);
      if (subDirs === null && entries && entries.length > 0) {
        scannedRel = new Set(entries.map((e) => e.rel));
      }
      const touched = collectTouched(fold);
      city = buildCityMap({ root, entries, touched });
    };

    const syncGhosts = (): void => {
      if (!city) return;
      for (const [path] of fold.touched) {
        const rel = cleanRel(path);
        if (rel === "") continue;
        if (city.files.some((f) => f.path === rel)) continue;
        if (lateGhosts.has(rel)) continue;
        lateGhosts.set(rel, placeGhost(city, rel));
      }
    };

    const tick = async () => {
      let delay = POLL_MS;
      try {
        const tail = await invoke<SessionTail>("claude_session_tail", {
          sessionId,
          offset,
        });
        if (!alive) return;
        if (!tail.found) {
          delay = ABSENT_POLL_MS;
          // Transcript vanished mid-flight: the synced city and fold stay on
          // screen, only the badge tells the truth (auditor correction 8).
          publish(absentStatus(synced));
        } else {
          if (tail.next_offset < offset) {
            // File shrank or was replaced: refold from zero or the trace
            // doubles (auditor correction 15).
            offset = 0;
            carry = "";
            synced = false;
            resetMindFold(fold, sessionId);
            lateGhosts.clear();
            city = null;
          }
          offset = tail.next_offset;
          if (tail.has_more) delay = CATCHUP_MS;
          let chunk = tail.data;
          if (!synced) {
            synced = true;
            if (tail.clipped && offset > chunk.length)
              chunk = dropLeadingPartialLine(chunk);
          }
          if (chunk.length > 0) {
            const split = splitChunk(carry, chunk);
            carry = split.carry;
            if (split.lines.length > 0) {
              foldMindLines(fold, split.lines, {
                cwd: fold.session.cwd ?? "",
                home: deriveHome(fold.session.cwd ?? ""),
                exists: scannedRel
                  ? (rel: string) => scannedRel?.has(rel) ?? true
                  : undefined,
              });
              if (!city)
                void ensureCity().then(() => {
                  syncGhosts();
                  publish("feed");
                });
              syncGhosts();
            }
          }
          publish("feed");
        }
      } catch {
        if (!alive) return;
        delay = ABSENT_POLL_MS;
        publish(absentStatus(synced));
      }
      if (alive) timer = setTimeout(() => void tick(), delay);
    };

    publish("probing");
    void tick();

    return () => {
      alive = false;
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [pick.session, enabled]);

  return state;
}

function collectTouched(fold: MindFold): { path: string; strong: boolean }[] {
  const out: { path: string; strong: boolean }[] = [];
  const seen = new Set<string>();
  for (const event of fold.events) {
    for (const target of event.targets) {
      if (target.path === "" || seen.has(target.path)) continue;
      seen.add(target.path);
      out.push({ path: target.path, strong: !target.weak });
    }
  }
  return out;
}

/**
 * Best-effort home for outside-scope grading: when the session runs under a
 * user profile (C:/Users/<name>/...), that profile is the home; otherwise an
 * empty string disables home scoping and everything outside lands in
 * "other".
 */
export function deriveHome(cwd: string): string {
  const slashed = normalizeSlashes(cwd);
  const m = /^([A-Za-z]:\/Users\/[^/]+)/.exec(slashed);
  return m ? m[1] : "";
}
