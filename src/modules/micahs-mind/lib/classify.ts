/**
 * Tool classification ported from mindwalk's internal/adapter (MIT, Ricko
 * Yu; see LICENSES/mindwalk.txt): which action a tool call performed and
 * which repo paths it touched. Scope: the tools Claude Code emits
 * (Read/Write/Edit/MultiEdit/NotebookEdit/Grep/Glob/LS/Bash/Task and
 * aliases); mindwalk's codex-only "exec" heuristics are out of scope here.
 */

import {
  type OutsideScope,
  type OutsideTouch,
  rankTouch,
  type Touch,
  type TraceAction,
  type TraceTarget,
} from "./trace";

const TOOL_SUMMARY_VERB_LIMIT = 96;

export function truncateRunes(
  text: string,
  limit: number,
  marker: string,
): string {
  if (limit <= 0) return "";
  const runes = Array.from(text);
  if (runes.length <= limit) return text;
  let markerRunes = Array.from(marker);
  if (markerRunes.length > limit) markerRunes = markerRunes.slice(0, limit);
  return `${runes.slice(0, limit - markerRunes.length).join("")}${markerRunes.join("")}`;
}

// ---------------------------------------------------------------------------
// Path normalization (Go used filepath; here everything is forward slashes
// and Windows drives are compared case-insensitively, which is what the
// transcripts need on this machine).

export function normalizeSlashes(p: string): string {
  return p.replace(/\\/g, "/");
}

function isAbsPath(p: string): boolean {
  return p.startsWith("/") || p.startsWith("//") || /^[A-Za-z]:\//.test(p);
}

/** Resolve "." and ".." segments textually on a slashed path. */
function cleanSlashed(p: string): string {
  const absolute = isAbsPath(p);
  const out: string[] = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (out.length > 0 && out[out.length - 1] !== "..") out.pop();
      else if (!absolute) out.push("..");
      continue;
    }
    out.push(seg);
  }
  const joined = out.join("/");
  if (absolute) {
    if (/^[A-Za-z]:/.test(joined)) return joined;
    return `/${joined}`;
  }
  return joined;
}

function sameDrive(a: string, b: string): boolean {
  const da = a.slice(0, 2).toLowerCase();
  const db = b.slice(0, 2).toLowerCase();
  if (/^[a-z]:$/.test(da) && /^[a-z]:$/.test(db)) return da === db;
  return a.startsWith("/") && b.startsWith("/");
}

/** Go filepath.Rel on slashed paths: null when not under root. */
function relFrom(root: string, abs: string): string | null {
  if (!sameDrive(root, abs)) return null;
  const r = root.endsWith("/") ? root : `${root}/`;
  const base = r.toLowerCase();
  const target = abs.toLowerCase();
  if (target === root.toLowerCase() || target === base.slice(0, -1)) return ".";
  if (!target.startsWith(base)) return null;
  return abs.slice(r.length);
}

export type PathCtx = {
  /** Session cwd, slashed absolute. Empty disables repo-relative output. */
  cwd: string;
  /** Absolute base dir for this path (workdir); empty means cwd. */
  base?: string;
  home?: string;
  tmp?: string;
};

/**
 * Normalize one path against the session cwd. Returns the repo-relative
 * path, an outside touch, or null when the string is not a usable path.
 */
export function normalizePath(
  path: string,
  ctx: PathCtx,
): { rel: string } | { outside: OutsideTouch } | null {
  let p = path.trim();
  p = p.replace(/^["']+|["']+$/g, "");
  if (p === "" || p.includes("\n")) return null;
  if (p.startsWith("http://") || p.startsWith("https://")) return null;
  p = normalizeSlashes(p);
  const cwd = ctx.cwd ? cleanSlashed(normalizeSlashes(ctx.cwd)) : "";
  const base =
    ctx.base && isAbsPath(normalizeSlashes(ctx.base))
      ? cleanSlashed(normalizeSlashes(ctx.base))
      : "";
  if (!isAbsPath(p)) {
    const clean = cleanSlashed(p);
    if (clean === "" || clean === "." || clean.startsWith("..")) return null;
    if (base !== "") {
      const abs = cleanSlashed(`${base}/${clean}`);
      if (cwd !== "") {
        const rel = relFrom(cwd, abs);
        if (rel !== null && rel !== ".") return { rel };
      }
      return { outside: { scope: outsideScope(abs, ctx), path: abs } };
    }
    return { rel: clean };
  }
  const abs = cleanSlashed(p);
  if (cwd !== "") {
    const rel = relFrom(cwd, abs);
    if (rel !== null && rel !== ".") return { rel };
  }
  return { outside: { scope: outsideScope(abs, ctx), path: abs } };
}

export function outsideScope(abs: string, ctx: PathCtx): OutsideScope {
  const home = ctx.home ? cleanSlashed(normalizeSlashes(ctx.home)) : "";
  if (home !== "") {
    const rel = relFrom(home, abs);
    if (rel !== null) return "home";
  }
  const tmp = ctx.tmp ? cleanSlashed(normalizeSlashes(ctx.tmp)) : "";
  if (tmp !== "" && relFrom(tmp, abs) !== null) return "tmp";
  if (abs.startsWith("/tmp") || abs.startsWith("/var/folders")) return "tmp";
  return "other";
}

// ---------------------------------------------------------------------------
// Extracted-path scrubbing (ported from mindwalk).

export function cleanExtractedPath(
  path: string,
  allowTopLevel: boolean,
): { path: string } | null {
  let p = path.trim();
  p = p.replace(/^["' ,;:()[\]{}]+|["' ,;:()[\]{}]+$/g, "");
  for (const prefix of ["a/", "b/", "./"]) {
    if (p.startsWith(prefix)) p = p.slice(prefix.length);
  }
  if (p === "" || p.includes("://") || /[\n\r\t]/.test(p)) return null;
  if (p.startsWith("--") || p.startsWith("++")) return null;
  if (!allowTopLevel && !p.includes("/")) return null;
  return { path: p };
}

const PATH_LINE_RE =
  /(?:^|[\s"'([])([A-Za-z0-9_./@+-]*[A-Za-z0-9_/@+-]\.[A-Za-z0-9][A-Za-z0-9._-]*):([0-9]+)/g;
const PATH_ONLY_RE =
  /(?:^|[\s"'([])([./~A-Za-z0-9_@+-]*[/][A-Za-z0-9_./~@+-]*\.[A-Za-z0-9][A-Za-z0-9._-]*)(?:$|[\s"',)\]:;])/g;
const COMMAND_PATH_RE =
  /(?:^|[\s"'=])([./~A-Za-z0-9_@+-]+\.[A-Za-z0-9][A-Za-z0-9._-]*)(?:$|[\s"',)\]:;])/g;
const PATCH_FILE_RE =
  /^\*\*\* (?:Add|Update|Delete) File: (.+)$|^\*\*\* Move to: (.+)$/gm;

export type PathHit = { path: string; lines: Array<[number, number]> };

export function parsePathHits(text: string): PathHit[] {
  const byPath = new Map<string, Array<[number, number]>>();
  for (const m of text.matchAll(PATH_LINE_RE)) {
    const line = Number(m[2]);
    if (line > 0) {
      const cleaned = cleanExtractedPath(m[1], true);
      if (cleaned) {
        const list = byPath.get(cleaned.path) ?? [];
        list.push([line, line]);
        byPath.set(cleaned.path, list);
      }
    }
  }
  for (const p of extractPaths(text)) {
    if (!byPath.has(p)) byPath.set(p, []);
  }
  return [...byPath.entries()]
    .map(([path, lines]) => ({ path, lines }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

export function extractPaths(text: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const m of text.matchAll(PATH_ONLY_RE)) {
    const cleaned = cleanExtractedPath(m[1], false);
    if (!cleaned) continue;
    if (cleaned.path === "" || seen.has(cleaned.path)) continue;
    if (cleaned.path.includes("://")) continue;
    seen.add(cleaned.path);
    paths.push(cleaned.path);
  }
  paths.sort();
  return paths;
}

export function extractCommandPaths(command: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const m of command.matchAll(COMMAND_PATH_RE)) {
    const cleaned = cleanExtractedPath(m[1], true);
    if (!cleaned || seen.has(cleaned.path)) continue;
    seen.add(cleaned.path);
    paths.push(cleaned.path);
  }
  paths.sort();
  return paths;
}

export function parsePatchPaths(patch: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const m of patch.matchAll(PATCH_FILE_RE)) {
    const raw = m[1] ?? m[2] ?? "";
    const cleaned = cleanExtractedPath(raw, true);
    if (!cleaned || seen.has(cleaned.path)) continue;
    seen.add(cleaned.path);
    paths.push(cleaned.path);
  }
  paths.sort();
  return paths;
}

// ---------------------------------------------------------------------------
// Shell command grading (ported from mindwalk: conservative by design,
// anything unrecognized stays "exec").

const SEARCH_PROGRAMS = new Set([
  "grep",
  "rg",
  "ag",
  "find",
  "fd",
  "ls",
  "tree",
]);

const READ_ONLY_PROGRAMS = new Set([
  "cd",
  "cat",
  "head",
  "tail",
  "wc",
  "sort",
  "uniq",
  "cut",
  "awk",
  "echo",
  "which",
  "file",
  "stat",
  "du",
  "pwd",
  "dirname",
  "basename",
  "true",
]);

const READ_PROGRAMS = new Set(["cat", "head", "tail", "nl", "sed"]);

const ENV_ASSIGN_RE = /^[A-Za-z_][A-Za-z0-9_]*=/;

const VERIFY_PATTERNS = [
  "go test",
  "go vet",
  "npm test",
  "npm run build",
  "pnpm test",
  "pnpm build",
  "pytest",
  "make test",
  "cargo test",
  "swift test",
];

export function verifyCommand(command: string): boolean {
  const c = command.toLowerCase();
  if (VERIFY_PATTERNS.some((p) => c.includes(p))) return true;
  // Package runners and toolchains with flags between runner and script
  // (pnpm -C . test) hide the literal patterns above; grade those by tokens.
  const VALUE_FLAGS = new Set(["-c", "--dir", "--prefix", "-w", "--workspace"]);
  for (const segment of segmentsOf(command)) {
    let fields = segment.split(/\s+/).filter(Boolean);
    fields = stripEnvAssigns(fields);
    if (fields.length === 0) continue;
    const program = programOf(fields[0]);
    const rest = fields.slice(1);
    if (
      program === "pnpm" ||
      program === "npm" ||
      program === "yarn" ||
      program === "bun"
    ) {
      const tokens: string[] = [];
      let skipValue = false;
      for (const arg of rest) {
        if (skipValue) {
          skipValue = false;
          continue;
        }
        if (arg === "run") continue;
        if (arg.startsWith("-")) {
          skipValue =
            VALUE_FLAGS.has(arg) ||
            arg.startsWith("--dir") ||
            arg.startsWith("--prefix");
          continue;
        }
        tokens.push(arg);
      }
      if (
        tokens.includes("test") ||
        tokens.includes("build") ||
        tokens.includes("check")
      ) {
        return true;
      }
    } else if (program === "cargo" || program === "go") {
      if (rest.includes("test") || rest.includes("vet")) return true;
    }
  }
  return false;
}

function programOf(field: string): string {
  const base = field.includes("/") ? (field.split("/").pop() ?? field) : field;
  return base.toLowerCase();
}

function segmentsOf(command: string): string[] {
  return command
    .replace(/2>&1|2>\/dev\/null|>\/dev\/null|> \/dev\/null/g, " ")
    .split(/[|;&\n]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function stripEnvAssigns(fields: string[]): string[] {
  let i = 0;
  while (i < fields.length && ENV_ASSIGN_RE.test(fields[i])) i++;
  return fields.slice(i);
}

export function searchCommand(command: string): boolean {
  let searched = false;
  for (const segment of segmentsOf(command)) {
    if (segment.includes(">")) return false;
    let fields = segment.split(/\s+/).filter(Boolean);
    fields = stripEnvAssigns(fields);
    if (fields.length === 0) continue;
    const program = programOf(fields[0]);
    if (
      program === "git" &&
      fields.length > 1 &&
      (fields[1] === "grep" || fields[1] === "ls-files")
    ) {
      searched = true;
      continue;
    }
    if (SEARCH_PROGRAMS.has(program)) {
      if (segment.includes("-exec") || segment.includes("-delete"))
        return false;
      searched = true;
      continue;
    }
    if (!READ_ONLY_PROGRAMS.has(program)) return false;
  }
  return searched;
}

function sedReadsOnly(args: string[]): boolean {
  let hasN = false;
  for (const arg of args) {
    if (arg === "-n") hasN = true;
    if (arg.startsWith("-i")) return false;
  }
  return hasN;
}

function flagTakesValue(program: string, flag: string): boolean {
  if (program === "head" || program === "tail") {
    return flag === "-n" || flag === "-c";
  }
  if (program === "sed") return flag === "-e" || flag === "-f";
  return false;
}

export function commandReadPaths(command: string): string[] {
  const seen = new Set<string>();
  const paths: string[] = [];
  for (const segment of segmentsOf(command)) {
    if (segment.includes(">")) continue;
    let fields = segment.split(/\s+/).filter(Boolean);
    fields = stripEnvAssigns(fields);
    if (fields.length === 0) continue;
    const program = programOf(fields[0]);
    if (!READ_PROGRAMS.has(program)) continue;
    const args = fields.slice(1);
    let scriptArgs = 0;
    if (program === "sed") {
      if (!sedReadsOnly(args)) continue;
      scriptArgs = 1;
    }
    let expectValue = false;
    for (const arg of args) {
      if (expectValue) {
        expectValue = false;
        continue;
      }
      if (arg.startsWith("-")) {
        expectValue = flagTakesValue(program, arg);
        continue;
      }
      if (scriptArgs > 0) {
        scriptArgs--;
        continue;
      }
      if (/[<>*?$`]/.test(arg)) continue;
      const cleaned = cleanExtractedPath(arg, true);
      if (!cleaned || seen.has(cleaned.path)) continue;
      seen.add(cleaned.path);
      paths.push(cleaned.path);
    }
  }
  paths.sort();
  return paths;
}

export function readCommand(command: string): boolean {
  if (commandReadPaths(command).length === 0) return false;
  for (const segment of segmentsOf(command)) {
    if (segment.includes(">")) return false;
    let fields = segment.split(/\s+/).filter(Boolean);
    fields = stripEnvAssigns(fields);
    if (fields.length === 0) continue;
    const program = programOf(fields[0]);
    if (program === "sed" && !sedReadsOnly(fields.slice(1))) return false;
    if (!READ_ONLY_PROGRAMS.has(program) && !READ_PROGRAMS.has(program)) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Action and target classification.

export type ToolInput = Record<string, unknown>;

function firstString(input: ToolInput, keys: string[]): string {
  for (const key of keys) {
    const v = input[key];
    if (typeof v === "string") return v;
  }
  return "";
}

function intFromAny(v: unknown): number {
  if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
  return 0;
}

function readLines(input: ToolInput): Array<[number, number]> | undefined {
  const offset = intFromAny(input.offset);
  const limit = intFromAny(input.limit);
  if (offset <= 0) return undefined;
  if (limit <= 0) return [[offset, offset]];
  return [[offset, offset + limit - 1]];
}

export function contentToString(v: unknown): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const parts: string[] = [];
    for (const item of v) {
      if (typeof item === "object" && item !== null) {
        const m = item as Record<string, unknown>;
        if (typeof m.text === "string") parts.push(m.text);
        if (typeof m.content === "string") parts.push(m.content);
      }
    }
    return parts.join("\n");
  }
  return JSON.stringify(v);
}

export function actionFor(
  tool: string,
  input: ToolInput,
  _result: string,
): TraceAction {
  switch (tool) {
    case "Read":
    case "read":
      return "read";
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "apply_patch":
    case "write":
    case "edit":
      return "edit";
    case "Grep":
    case "Glob":
    case "LS":
    case "view_image":
    case "grep":
    case "find":
    case "ls":
      return "search";
    case "Bash":
    case "bash":
    case "exec_command": {
      const command = firstString(input, ["command", "cmd"]);
      if (verifyCommand(command)) return "verify";
      if (searchCommand(command)) return "search";
      if (readCommand(command)) return "read";
      return "exec";
    }
    default:
      return "other";
  }
}

export type TargetsCtx = PathCtx & {
  /** Weak targets survive only when this says the repo file exists. */
  exists?: (rel: string) => boolean;
};

function weakExists(ctx: TargetsCtx, rel: string): boolean {
  if (!ctx.exists) return true;
  return ctx.exists(rel);
}

export function targetsFor(
  tool: string,
  input: ToolInput,
  result: string,
  ctx: TargetsCtx,
): { targets: TraceTarget[]; outside: OutsideTouch[] } {
  const targets: TraceTarget[] = [];
  const outside: OutsideTouch[] = [];

  const add = (
    rawPath: string,
    touch: Touch,
    weak: boolean,
    lines: Array<[number, number]> | undefined,
    base: string,
  ): void => {
    const norm = normalizePath(rawPath, { ...ctx, base });
    if (!norm) return;
    if ("outside" in norm) {
      outside.push(norm.outside);
      return;
    }
    const rel = norm.rel;
    if (weak && !weakExists(ctx, rel)) return;
    const existing = targets.find((t) => t.path === rel);
    if (existing) {
      if (rankTouch(touch) > rankTouch(existing.touch)) existing.touch = touch;
      if (lines && lines.length > 0) {
        existing.lines = [...(existing.lines ?? []), ...lines];
      }
      return;
    }
    targets.push({ path: rel, touch, lines, weak });
  };

  const addFromResultHits = (weak: boolean, base: string): void => {
    for (const hit of parsePathHits(result)) {
      add(hit.path, "hit", weak, hit.lines, base);
    }
  };

  switch (tool) {
    case "Read":
    case "read":
      add(
        firstString(input, ["file_path", "path"]),
        "read",
        false,
        readLines(input),
        "",
      );
      break;
    case "Write":
    case "Edit":
    case "MultiEdit":
    case "NotebookEdit":
    case "write":
    case "edit":
      add(
        firstString(input, ["file_path", "notebook_path", "path"]),
        "edit",
        false,
        undefined,
        "",
      );
      break;
    case "Grep":
    case "grep":
      addFromResultHits(false, "");
      if (targets.length === 0) {
        add(firstString(input, ["path"]), "hit", true, undefined, "");
      }
      break;
    case "Glob":
    case "LS":
    case "find":
    case "ls":
      addFromResultHits(false, "");
      if (targets.length === 0) {
        add(firstString(input, ["path"]), "hit", true, undefined, "");
      }
      break;
    case "Bash":
    case "bash":
    case "exec_command": {
      const command = firstString(input, ["command", "cmd"]);
      const base =
        tool === "exec_command" ? firstString(input, ["workdir"]) : "";
      for (const p of commandReadPaths(command))
        add(p, "read", true, undefined, base);
      for (const p of extractCommandPaths(command))
        add(p, "hit", true, undefined, base);
      for (const p of extractPaths(`${command}\n${result}`)) {
        add(p, "hit", true, undefined, base);
      }
      break;
    }
    case "apply_patch": {
      const patch = firstString(input, ["patch", "input", "_raw"]);
      for (const p of parsePatchPaths(patch))
        add(p, "edit", false, undefined, "");
      break;
    }
    case "view_image":
      add(firstString(input, ["path"]), "read", false, undefined, "");
      break;
    default:
      break;
  }
  return { targets, outside };
}

export function summarizeTool(
  tool: string,
  input: ToolInput,
  targets: TraceTarget[],
  outside: OutsideTouch[],
  isError: boolean,
): string {
  let verb = tool;
  const desc = input.description;
  if (typeof desc === "string" && desc !== "") verb = desc;
  const command = firstString(input, ["command", "cmd"]);
  if (command !== "") {
    verb = truncateRunes(command, TOOL_SUMMARY_VERB_LIMIT, "...");
  }
  const status = isError ? " error" : "";
  return `${verb} -> ${targets.length} targets, ${outside.length} outside${status}`;
}
