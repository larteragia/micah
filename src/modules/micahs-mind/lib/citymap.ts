/**
 * Deterministic city layout for Micah's Mind: a radial sunburst tree (the
 * reference look the commander chose — branches out of a center, luminous
 * leaves, night depth), ported in spirit from mindwalk's citymap builder
 * (MIT, Ricko Yu; see LICENSES/mindwalk.txt): same tree in, same map out.
 * Children sort by weight desc then name, weights are sqrt(max(lines,
 * bytes/4096, 16)), and each child's wedge is proportional to its subtree
 * weight (auditor correction 2 of the p4p6 card: no hash-angles — hash
 * only jitters ghosts).
 *
 * Bridge for the renderer (auditor correction 1): nodes carry polar coords
 * {a, r, size} AND keep `rect` as the AABB around the node, so culling,
 * AABB-based ghosts and existing consumers survive untouched.
 *
 * Live-growth policy: the layout is built once per session snapshot and
 * frozen; files touched later that the snapshot never saw become ghost
 * points placed in the outer edge of their parent directory's wedge,
 * without moving anything else, so the city never jumps under the camera.
 */

export type Rect = { x: number; z: number; w: number; d: number };

/** Polar placement: angle in radians from the top, radius/size in world units. */
export type Polar = { a: number; r: number; size: number };

export type CityFile = {
  id: number;
  path: string;
  dir: string;
  lines: number;
  bytes: number;
  lang: string;
  rect: Rect;
  polar: Polar;
  ghost: boolean;
};

export type CityDir = {
  path: string;
  depth: number;
  rect: Rect;
  /** Wedge of the annular sector this directory owns. */
  polar: { a0: number; a1: number; r0: number; r1: number };
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
  depth?: number;
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

/** World geometry: the radial city lives in the same 120x120 world the
 * camera already fits, centered, outer ring inside the corners. */
export const RADIAL_CENTER = 60;
export const RADIAL_MAX_R = 56;
const START_ANGLE = -Math.PI / 2;

function treeDepth(n: Node): number {
  let max = 0;
  for (const child of n.children.values()) {
    max = Math.max(max, treeDepth(child) + 1);
  }
  return max;
}

function dotRadius(weight: number): number {
  return Math.min(3, Math.max(0.35, 0.35 + weight * 0.045));
}

function sectorAabb(a0: number, a1: number, r0: number, r1: number): Rect {
  let minX = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let minZ = Number.POSITIVE_INFINITY;
  let maxZ = Number.NEGATIVE_INFINITY;
  const steps = Math.max(2, Math.ceil(((a1 - a0) / Math.PI) * 8));
  for (let i = 0; i <= steps; i++) {
    const a = a0 + ((a1 - a0) * i) / steps;
    for (const r of [r0, r1]) {
      const x = RADIAL_CENTER + Math.cos(a) * r;
      const z = RADIAL_CENTER + Math.sin(a) * r;
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minZ = Math.min(minZ, z);
      maxZ = Math.max(maxZ, z);
    }
  }
  return { x: minX, z: minZ, w: maxX - minX, d: maxZ - minZ };
}

function polarToRect(a: number, r: number, size: number): Rect {
  const x = RADIAL_CENTER + Math.cos(a) * r;
  const z = RADIAL_CENTER + Math.sin(a) * r;
  return { x: x - size, z: z - size, w: size * 2, d: size * 2 };
}

/**
 * Radial sunburst layout: every node owns a wedge of its parent's annulus
 * proportional to subtree weight, children in the frozen sorted order
 * (weight desc then name — same tree always produces the same map). Files
 * sit at the middle of their own sub-wedge on the band of their depth.
 */
function layoutRadial(
  root: Node,
  files: CityFile[],
  dirs: CityDir[],
): void {
  const rings = treeDepth(root) + 1;
  const ringW = RADIAL_MAX_R / rings;

  const assign = (n: Node, a0: number, a1: number, depth: number): void => {
    const r0 = depth * ringW;
    const r1 = r0 + ringW;
    if (n.path !== "") {
      dirs.push({
        path: n.path,
        depth,
        rect: sectorAabb(a0, a1, r0, r1),
        polar: { a0, a1, r0, r1 },
        fileCount: n.fileCount,
        lines: n.lines,
      });
    }
    const items: Array<{
      name: string;
      kind: "dir" | "file";
      idx: number;
      node?: Node;
      weight: number;
    }> = [];
    for (const child of sortedChildren(n.children)) {
      items.push({
        name: child.name,
        kind: "dir",
        idx: -1,
        node: child,
        weight: child.weight,
      });
    }
    for (const idx of n.files) {
      items.push({
        name: files[idx].path,
        kind: "file",
        idx,
        weight: fileWeight(files[idx]),
      });
    }
    items.sort((a, b) => {
      if (a.weight === b.weight) return a.name < b.name ? -1 : 1;
      return a.weight > b.weight ? -1 : 1;
    });
    let total = 0;
    for (const item of items) total += item.weight;
    if (total <= 0) return;
    let a = a0;
    for (const item of items) {
      const wedge = ((a1 - a0) * item.weight) / total;
      if (item.kind === "dir" && item.node) {
        assign(item.node, a, a + wedge, depth + 1);
      } else {
        const mid = a + wedge / 2;
        const r = r0 + ringW * 0.5;
        const size = dotRadius(item.weight);
        files[item.idx].polar = { a: mid, r, size };
        files[item.idx].rect = polarToRect(mid, r, size);
      }
      a += wedge;
    }
  };

  assign(root, START_ANGLE, START_ANGLE + Math.PI * 2, 0);
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
      polar: { a: 0, r: 0, size: 0.6 },
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
  layoutRadial(rootNode, files, dirs);

  return {
    version: 1,
    root: input.root,
    truncated,
    files,
    dirs,
    layout: {
      algorithm: "radial-sunburst-v2",
      weight: "sqrt(max(lines, bytes/4096, 16))",
    },
  };
}

/**
 * Place a late ghost (touched after the snapshot froze) without relayout:
 * in the outer edge of the deepest known directory's wedge — the map edge
 * beyond the frozen rings — with a stable spiral jitter by hash so stacked
 * ghosts of the same dir do not overlap. Pure and deterministic.
 */
export function placeGhost(city: CityMap, rel: string): Rect {
  let best: CityDir | undefined;
  for (const dir of city.dirs) {
    if (rel === dir.path || rel.startsWith(`${dir.path}/`)) {
      if (!best || dir.depth > best.depth) best = dir;
    }
  }
  let h = 2166136261;
  for (let i = 0; i < rel.length; i++) {
    h ^= rel.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  const hh = h >>> 0;
  const wedge = best?.polar;
  const a0 = wedge ? wedge.a0 : START_ANGLE;
  const a1 = wedge ? wedge.a1 : START_ANGLE + Math.PI * 2;
  const a = a0 + ((hh % 1000) / 1000) * (a1 - a0);
  const inner = wedge ? wedge.r1 : 0;
  const r = Math.min(
    RADIAL_MAX_R,
    inner + 1 + ((Math.floor(hh / 1000) % 100) / 100) * 4,
  );
  const size = 0.6;
  return polarToRect(a, r, size);
}
