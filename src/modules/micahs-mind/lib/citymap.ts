/**
 * Deterministic city layout for Micah's Mind: a port of mindwalk's
 * squarified-treemap-v1 citymap builder (internal/citymap/builder.go, MIT,
 * Ricko Yu; see LICENSES/mindwalk.txt). Same tree in, same map out: children
 * sort by weight desc then name, weights are sqrt(max(lines, bytes/4096,
 * 16)) with a uniform floor when the scanner does not measure size, and
 * rects are inset and aspect-capped exactly like the original.
 *
 * Live-growth policy (auditor correction 7): the layout is built once per
 * session snapshot and frozen; files touched later that the snapshot never
 * saw become ghost points placed inside their parent directory's rect
 * without moving anything else, so the city never jumps under the camera.
 */

export type Rect = { x: number; z: number; w: number; d: number };

export type CityFile = {
  id: number;
  path: string;
  dir: string;
  lines: number;
  bytes: number;
  lang: string;
  rect: Rect;
  ghost: boolean;
};

export type CityDir = {
  path: string;
  depth: number;
  rect: Rect;
  fileCount: number;
  lines: number;
};

export type CityMap = {
  version: 1;
  root: string;
  truncated: boolean;
  files: CityFile[];
  dirs: CityDir[];
  layout: { algorithm: string; weight: string };
};

/** Commander's order (2026-08-18): the "mapa truncado" ceiling is gone.
 * This is now a runaway backstop, not a user-facing cap: a map that reaches
 * it was already impossible to read. HOME-rooted sessions never scan the
 * whole profile (they map touched dirs only), so nothing real gets close. */
export const MAX_MAP_FILES = 250_000;

export type CityEntry = {
  /** Repo-relative slash path. */
  rel: string;
  lines?: number;
  bytes?: number;
};

export type TouchedPath = {
  path: string;
  /** Strong targets ghost when missing; weak ones just disappear. */
  strong: boolean;
};

export function langForPath(path: string): string {
  const dot = path.lastIndexOf(".");
  const slash = path.lastIndexOf("/");
  const ext = (dot > slash ? path.slice(dot + 1) : "").toLowerCase();
  switch (ext) {
    case "ts":
    case "tsx":
      return "typescript";
    case "js":
    case "jsx":
      return "javascript";
    case "md":
    case "mdx":
      return "markdown";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    case "json":
      return "json";
    case "yaml":
    case "yml":
      return "yaml";
    case "css":
      return "css";
    case "html":
      return "html";
    case "":
      return "text";
    default:
      return ext;
  }
}

function fileWeight(file: Pick<CityFile, "lines" | "bytes">): number {
  const units = Math.max(file.lines, file.bytes / 4096, 16);
  return Math.sqrt(units);
}

type Node = {
  path: string;
  name: string;
  children: Map<string, Node>;
  files: number[];
  weight: number;
  fileCount: number;
  lines: number;
  rect?: Rect;
};

function splitPath(path: string): string[] {
  return path.split("/").filter((p) => p !== "" && p !== ".");
}

function buildTree(files: CityFile[], rootName = ""): Node {
  const root: Node = {
    path: "",
    name: rootName,
    children: new Map(),
    files: [],
    weight: 0,
    fileCount: 0,
    lines: 0,
  };
  for (let i = 0; i < files.length; i++) {
    const parts = splitPath(files[i].path);
    if (parts.length === 0) continue;
    let cur = root;
    for (let p = 0; p < parts.length - 1; p++) {
      const seg = parts[p];
      let next = cur.children.get(seg);
      if (!next) {
        next = {
          path: parts.slice(0, p + 1).join("/"),
          name: seg,
          children: new Map(),
          files: [],
          weight: 0,
          fileCount: 0,
          lines: 0,
        };
        cur.children.set(seg, next);
      }
      cur = next;
    }
    cur.files.push(i);
  }
  computeWeight(root, files);
  return root;
}

function computeWeight(n: Node, files: CityFile[]): number {
  n.weight = 0;
  for (const idx of n.files) {
    n.weight += fileWeight(files[idx]);
    n.fileCount++;
    n.lines += files[idx].lines;
  }
  for (const child of sortedChildren(n.children)) {
    n.weight += computeWeight(child, files);
    n.fileCount += child.fileCount;
    n.lines += child.lines;
  }
  if (n.weight <= 0) n.weight = 1;
  return n.weight;
}

function sortedChildren(children: Map<string, Node>): Node[] {
  return [...children.keys()].sort().map((name) => children.get(name) as Node);
}

type LayoutItem = {
  name: string;
  kind: "dir" | "file";
  idx: number;
  node?: Node;
  weight: number;
  area: number;
};

type PlacedItem = { item: LayoutItem; rect: Rect };

function worstAspect(row: LayoutItem[], side: number): number {
  if (row.length === 0 || side <= 0) return Number.POSITIVE_INFINITY;
  let sum = 0;
  let minArea = Number.POSITIVE_INFINITY;
  let maxArea = 0;
  for (const item of row) {
    sum += item.area;
    if (item.area < minArea) minArea = item.area;
    if (item.area > maxArea) maxArea = item.area;
  }
  if (sum <= 0 || minArea <= 0) return Number.POSITIVE_INFINITY;
  const side2 = side * side;
  const sum2 = sum * sum;
  return Math.max((side2 * maxArea) / sum2, sum2 / (side2 * minArea));
}

function layoutRow(
  rect: Rect,
  row: LayoutItem[],
): { placed: PlacedItem[]; rest: Rect } {
  let sum = 0;
  for (const item of row) sum += item.area;
  if (sum <= 0) return { placed: [], rest: rect };
  const placed: PlacedItem[] = [];
  const rest = { ...rect };
  if (rect.w >= rect.d) {
    const rowD = sum / rect.w;
    let x = rect.x;
    for (let i = 0; i < row.length; i++) {
      const item = row[i];
      let w = item.area / rowD;
      if (i === row.length - 1) w = rect.x + rect.w - x;
      placed.push({ item, rect: { x, z: rect.z, w, d: rowD } });
      x += w;
    }
    rest.z += rowD;
    rest.d -= rowD;
  } else {
    const rowW = sum / rect.d;
    let z = rect.z;
    for (let i = 0; i < row.length; i++) {
      const item = row[i];
      let d = item.area / rowW;
      if (i === row.length - 1) d = rect.z + rect.d - z;
      placed.push({ item, rect: { x: rect.x, z, w: rowW, d } });
      z += d;
    }
    rest.x += rowW;
    rest.w -= rowW;
  }
  if (rest.w < 0) rest.w = 0;
  if (rest.d < 0) rest.d = 0;
  return { placed, rest };
}

function squarify(rect: Rect, items: LayoutItem[]): PlacedItem[] {
  let remaining = { ...rect };
  const placed: PlacedItem[] = [];
  let row: LayoutItem[] = [];
  for (let idx = 0; idx < items.length; idx++) {
    const item = items[idx];
    if (item.area <= 0) continue;
    const side = Math.min(remaining.w, remaining.d);
    const candidate = [...row, item];
    if (
      row.length < 2 ||
      idx === items.length - 1 ||
      worstAspect(candidate, side) <= worstAspect(row, side)
    ) {
      row = candidate;
      continue;
    }
    const out = layoutRow(remaining, row);
    placed.push(...out.placed);
    remaining = out.rest;
    row = [item];
  }
  if (row.length > 0) {
    const out = layoutRow(remaining, row);
    placed.push(...out.placed);
  }
  return placed;
}

function inset(rect: Rect, pad: number): Rect {
  const r = { ...rect };
  if (r.w > pad * 2) {
    r.x += pad;
    r.w -= pad * 2;
  }
  if (r.d > pad * 2) {
    r.z += pad;
    r.d -= pad * 2;
  }
  return r;
}

function capAspect(rect: Rect, maxRatio: number): Rect {
  const r = { ...rect };
  if (r.w <= 0 || r.d <= 0 || maxRatio <= 1) return r;
  if (r.w / r.d > maxRatio) {
    const newW = r.d * maxRatio;
    r.x += (r.w - newW) / 2;
    r.w = newW;
  } else if (r.d / r.w > maxRatio) {
    const newD = r.w * maxRatio;
    r.z += (r.d - newD) / 2;
    r.d = newD;
  }
  return r;
}

function layoutNode(
  n: Node,
  rect: Rect,
  files: CityFile[],
  dirs: CityDir[],
): void {
  n.rect = rect;
  if (n.path !== "") {
    dirs.push({
      path: n.path,
      depth: n.path.split("/").length,
      rect,
      fileCount: n.fileCount,
      lines: n.lines,
    });
  }
  const items: LayoutItem[] = [];
  for (const child of sortedChildren(n.children)) {
    items.push({
      name: child.name,
      kind: "dir",
      idx: -1,
      node: child,
      weight: child.weight,
      area: 0,
    });
  }
  for (const idx of n.files) {
    items.push({
      name: files[idx].path,
      kind: "file",
      idx,
      weight: fileWeight(files[idx]),
      area: 0,
    });
  }
  items.sort((a, b) => {
    if (a.weight === b.weight) return a.name < b.name ? -1 : 1;
    return a.weight > b.weight ? -1 : 1;
  });
  let total = 0;
  for (const item of items) total += item.weight;
  if (total <= 0) return;
  const scale = (rect.w * rect.d) / total;
  for (const item of items) item.area = item.weight * scale;
  for (const placed of squarify(rect, items)) {
    const childRect = capAspect(inset(placed.rect, 0.08), 40);
    if (placed.item.kind === "dir" && placed.item.node) {
      layoutNode(placed.item.node, childRect, files, dirs);
    } else {
      files[placed.item.idx].rect = childRect;
    }
  }
}

/** Repo-relative slash path or "" when it escapes or is absolute. */
export function cleanRel(p: string): string {
  const slashed = p.replace(/\\/g, "/");
  if (slashed.startsWith("/") || /^[A-Za-z]:/.test(slashed)) return "";
  const parts: string[] = [];
  for (const seg of slashed.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") {
      if (parts.length > 0) parts.pop();
      else return "";
      continue;
    }
    parts.push(seg);
  }
  if (parts.length === 0) return "";
  return parts.join("/");
}

export type BuildCityInput = {
  root: string;
  /**
   * Scanned repo files (repo-relative, junk-pruned by the scanner), or null
   * when the scan itself failed (root not a dir, not authorized): then
   * touched files seat as real points (existence unknown is not "gone")
   * and the map reports truncated instead of lying with ghosts.
   */
  entries: CityEntry[] | null;
  /** Trace targets in first-appearance order, deduped by caller or here. */
  touched: TouchedPath[];
};

/**
 * Build the frozen city snapshot: touched files seat first (existing before
 * ghosts), then the scan fills the budget; layout is squarified treemap in
 * a 120x120 world like mindwalk's. Deterministic for the same inputs.
 */
export function buildCityMap(input: BuildCityInput): CityMap {
  const seen = new Set<string>();
  const files: CityFile[] = [];
  let truncated = input.entries === null;

  const seat = (rel: string, entry?: CityEntry, ghost = false): void => {
    files.push({
      id: 0,
      path: rel,
      dir: rel.includes("/") ? rel.slice(0, rel.lastIndexOf("/")) : "",
      lines: entry?.lines ?? 0,
      bytes: entry?.bytes ?? 0,
      lang: langForPath(rel),
      rect: { x: 0, z: 0, w: 0, d: 0 },
      ghost,
    });
  };

  // Tier 1 and 2: touched targets, existing files before ghosts. A ghost is
  // only honest when the scan ran and the path is absent from it.
  const entryByRel = new Map((input.entries ?? []).map((e) => [e.rel, e]));
  const ghosts: TouchedPath[] = [];
  for (const t of input.touched) {
    const rel = cleanRel(t.path);
    if (rel === "" || seen.has(rel)) continue;
    const entry = entryByRel.get(rel);
    if (entry) {
      seen.add(rel);
      if (files.length >= MAX_MAP_FILES) {
        truncated = true;
        continue;
      }
      seat(rel, entry);
      continue;
    }
    if (input.entries === null) {
      seen.add(rel);
      if (files.length < MAX_MAP_FILES) seat(rel, undefined, false);
      else truncated = true;
      continue;
    }
    if (t.strong) ghosts.push({ ...t, path: rel });
  }
  for (const g of ghosts) {
    if (files.length >= MAX_MAP_FILES) {
      truncated = true;
      break;
    }
    if (seen.has(g.path)) continue;
    seen.add(g.path);
    seat(g.path, undefined, true);
  }

  // Tier 3: the rest of the scan.
  for (const entry of input.entries ?? []) {
    if (seen.has(entry.rel)) continue;
    if (files.length >= MAX_MAP_FILES) {
      truncated = true;
      break;
    }
    seen.add(entry.rel);
    seat(entry.rel, entry);
  }

  files.sort((a, b) => (a.path < b.path ? -1 : 1));
  for (let i = 0; i < files.length; i++) files[i].id = i;

  const dirs: CityDir[] = [];
  const rootNode = buildTree(files);
  layoutNode(rootNode, { x: 0, z: 0, w: 120, d: 120 }, files, dirs);

  return {
    version: 1,
    root: input.root,
    truncated,
    files,
    dirs,
    layout: {
      algorithm: "squarified-treemap-v1",
      weight: "sqrt(max(lines, bytes/4096, 16))",
    },
  };
}

/**
 * Place a late ghost (touched after the snapshot froze) without relayout:
 * centered in the deepest known directory rect that is its ancestor, else
 * near the center of the map. Pure and deterministic.
 */
export function placeGhost(city: CityMap, rel: string): Rect {
  let best: CityDir | undefined;
  for (const dir of city.dirs) {
    if (rel === dir.path || rel.startsWith(`${dir.path}/`)) {
      if (!best || dir.depth > best.depth) best = dir;
    }
  }
  const base = best?.rect ?? { x: 0, z: 0, w: 120, d: 120 };
  // Hash the tail into a stable offset so stacked ghosts do not overlap
  // perfectly at the center.
  let h = 2166136261;
  for (let i = 0; i < rel.length; i++) {
    h ^= rel.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const angle = ((h >>> 0) % 628) / 100;
  const radius = Math.min(base.w, base.d) * 0.3;
  const cx = base.x + base.w / 2 + Math.cos(angle) * radius;
  const cz = base.z + base.d / 2 + Math.sin(angle) * radius;
  const size = 0.6;
  return { x: cx - size / 2, z: cz - size / 2, w: size, d: size };
}
