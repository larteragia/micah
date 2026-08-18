/**
 * The Micah's Mind canvas: night-city renderer with pre-baked glow sprites,
 * viewport culling, dirty-frame rAF, pan/zoom/pinch navigation and a
 * scrubbable cool/warm timeline. Pure Canvas 2D.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { CityFile, CityMap, Rect } from "./lib/citymap";
import { cleanRel } from "./lib/citymap";
import type { MindFeed } from "./lib/useMindFeed";

const WORLD = 120;
const TIMELINE_H = 56;
const TOUCH_COLOR: Record<string, string> = {
  hit: "#34d399",
  read: "#60a5fa",
  edit: "#fbbf24",
};
const TOUCH_LABEL: Record<string, string> = {
  hit: "visto",
  read: "lido",
  edit: "editado",
};
const GHOST_COLOR = "#f87171";
const UNVISITED_FILL = "#141c2e";
const UNVISITED_EDGE = "rgba(51,65,85,0.35)";
const DIR_EDGE = "rgba(148,163,184,0.07)";
const BUCKETS = 96;

/** Honest badges: what the feed knows, in the user's language. */
const STATUS_LABEL: Record<string, { text: string; tone: "default" | "warn" }> =
  {
    off: { text: "desligado", tone: "default" },
    probing: { text: "conectando", tone: "default" },
    feed: { text: "ao vivo", tone: "default" },
    absent: { text: "sem transcript", tone: "default" },
    city: { text: "cidade sem sessão", tone: "default" },
    missing: { text: "transcript ausente", tone: "warn" },
  };

type Camera = { x: number; z: number; scale: number };

type Pointers = Map<number, { x: number; y: number }>;

function makeGlowSprite(color: string): HTMLCanvasElement {
  const size = 64;
  const c = document.createElement("canvas");
  c.width = size;
  c.height = size;
  const ctx = c.getContext("2d");
  if (!ctx) return c;
  const g = ctx.createRadialGradient(32, 32, 2, 32, 32, 32);
  g.addColorStop(0, color);
  g.addColorStop(0.25, `${color}bb`);
  g.addColorStop(1, "#00000000");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return c;
}

export function MindCanvas({ feed }: { feed: MindFeed }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>({ x: -4, z: -4, scale: 8 });
  const dirtyRef = useRef(true);
  const pulseUntilRef = useRef(0);
  const pointersRef = useRef<Pointers>(new Map());
  const dragRef = useRef<{ x: number; y: number; cam: Camera } | null>(null);
  const pinchRef = useRef<{ dist: number; scale: number } | null>(null);
  const hoverRef = useRef<string | null>(null);
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 });
  const [hover, setHover] = useState<{
    path: string;
    x: number;
    y: number;
  } | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [replaySeq, setReplaySeq] = useState<number | null>(null);

  const sprites = useMemo(() => {
    const mk = (color: string) =>
      typeof document === "undefined" ? null : makeGlowSprite(color);
    return {
      hit: mk(TOUCH_COLOR.hit),
      read: mk(TOUCH_COLOR.read),
      edit: mk(TOUCH_COLOR.edit),
      ghost: mk(GHOST_COLOR),
    };
  }, []);

  const fold = feed.fold;
  const city = feed.city;

  const touchedNow = useMemo(() => {
    const map = new Map<
      string,
      { touch: string; count: number; lastSeq: number }
    >();
    if (!fold) return map;
    for (const [path, info] of fold.touched) {
      map.set(cleanRel(path), {
        touch: info.touch,
        count: info.count,
        lastSeq: info.lastSeq,
      });
    }
    return map;
  }, [fold]);

  /** Per-file touch timeline for scrubbing: [seq, touchRank] upgrades. */
  const fileTimeline = useMemo(() => {
    const map = new Map<string, Array<[number, number]>>();
    if (!fold) return map;
    const rank = { hit: 1, read: 2, edit: 3 } as const;
    const state = new Map<string, number>();
    for (const event of fold.events) {
      for (const t of event.targets) {
        if (t.path === "") continue;
        const rel = cleanRel(t.path);
        const r = rank[t.touch];
        const prev = state.get(rel) ?? 0;
        if (r > prev) {
          state.set(rel, r);
          const list = map.get(rel) ?? [];
          list.push([event.seq, r]);
          map.set(rel, list);
        }
      }
    }
    return map;
  }, [fold]);

  const touchAt = useCallback(
    (path: string): string | null => {
      if (replaySeq === null) {
        const now = touchedNow.get(path);
        return now ? now.touch : null;
      }
      const list = fileTimeline.get(path);
      if (!list) return null;
      let touch: string | null = null;
      for (const [seq, r] of list) {
        if (seq > replaySeq) break;
        touch = r === 3 ? "edit" : r === 2 ? "read" : "hit";
      }
      return touch;
    },
    [replaySeq, touchedNow, fileTimeline],
  );

  // Recent activity drives a short glow pulse without a permanent rAF loop.
  useEffect(() => {
    if (feed.version === 0) return;
    dirtyRef.current = true;
    pulseUntilRef.current = Date.now() + 1400;
  }, [feed.version]);

  // Switching sessions clears the replay cursor and the pinned file.
  useEffect(() => {
    if (feed.pick.session === null) return;
    setSelected(null);
    setReplaySeq(null);
    dirtyRef.current = true;
  }, [feed.pick.session]);

  const fitCamera = useCallback((w: number, h: number): void => {
    const scale = Math.min(w, Math.max(h - TIMELINE_H, 1)) / (WORLD + 8);
    cameraRef.current = { x: -4, z: -4, scale };
  }, []);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ro = new ResizeObserver(() => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      canvas.width = Math.max(1, Math.round(rect.width * dpr));
      canvas.height = Math.max(1, Math.round(rect.height * dpr));
      canvas.style.width = `${rect.width}px`;
      canvas.style.height = `${rect.height}px`;
      if (cameraRef.current.scale <= 0.001) fitCamera(rect.width, rect.height);
      dirtyRef.current = true;
    });
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [fitCamera]);

  useEffect(() => {
    if (!city) return;
    if (cameraRef.current.scale <= 0.001 && sizeRef.current.w > 0) {
      fitCamera(sizeRef.current.w, sizeRef.current.h);
    }
    dirtyRef.current = true;
  }, [city, fitCamera]);

  // Main draw loop: renders while dirty or while a pulse is alive.
  useEffect(() => {
    let raf = 0;
    let running = true;
    const draw = (): void => {
      if (!running) return;
      const now = Date.now();
      const pulsing = now < pulseUntilRef.current;
      if (dirtyRef.current || pulsing) {
        dirtyRef.current = false;
        render(
          canvasRef.current,
          sizeRef.current,
          cameraRef.current,
          city,
          feed.lateGhosts,
          touchedNow,
          touchAt,
          sprites,
          fold,
          replaySeq,
          selected,
          hoverRef.current,
          pulsing ? 1 - (pulseUntilRef.current - now) / 1400 : 1,
        );
      }
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(raf);
    };
  }, [
    city,
    feed.lateGhosts,
    touchedNow,
    touchAt,
    sprites,
    fold,
    replaySeq,
    selected,
  ]);

  const toWorld = useCallback(
    (cx: number, cy: number): { wx: number; wz: number } => {
      const cam = cameraRef.current;
      const h = sizeRef.current.h - TIMELINE_H;
      return {
        wx: (cx - 0) / cam.scale + cam.x,
        wz: (cy - h) / cam.scale + cam.z,
      };
    },
    [],
  );

  const hitTest = useCallback(
    (cx: number, cy: number): string | null => {
      if (!city) return null;
      if (cy > sizeRef.current.h - TIMELINE_H) return null;
      const { wx, wz } = toWorld(cx, cy);
      let best: string | null = null;
      let bestArea = Number.POSITIVE_INFINITY;
      const consider = (path: string, rect: Rect): void => {
        if (wx < rect.x || wz < rect.z) return;
        if (wx > rect.x + rect.w || wz > rect.z + rect.d) return;
        const area = rect.w * rect.d;
        if (area < bestArea) {
          bestArea = area;
          best = path;
        }
      };
      for (const f of city.files) consider(f.path, f.rect);
      for (const [raw, rect] of feed.lateGhosts) consider(cleanRel(raw), rect);
      return best;
    },
    [city, feed.lateGhosts, toWorld],
  );

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    (e.target as HTMLCanvasElement).setPointerCapture(e.pointerId);
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointersRef.current.size === 1) {
      dragRef.current = {
        x: e.clientX,
        y: e.clientY,
        cam: { ...cameraRef.current },
      };
    } else if (pointersRef.current.size === 2) {
      const [a, b] = [...pointersRef.current.values()];
      pinchRef.current = {
        dist: Math.hypot(a.x - b.x, a.y - b.y),
        scale: cameraRef.current.scale,
      };
      dragRef.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (pointersRef.current.has(e.pointerId)) {
      pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }
    if (pinchRef.current && pointersRef.current.size >= 2) {
      const [a, b] = [...pointersRef.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const factor = dist / Math.max(pinchRef.current.dist, 1);
      cameraRef.current.scale = clampScale(pinchRef.current.scale * factor);
      dirtyRef.current = true;
      return;
    }
    if (dragRef.current && pointersRef.current.size === 1) {
      const cam = dragRef.current.cam;
      cameraRef.current = {
        ...cam,
        x: cam.x - (e.clientX - dragRef.current.x) / cam.scale,
        z: cam.z - (e.clientY - dragRef.current.y) / cam.scale,
      };
      dirtyRef.current = true;
      return;
    }
    const hit = hitTest(cx, cy);
    if (hit !== hoverRef.current) {
      hoverRef.current = hit;
      setHover(hit ? { path: hit, x: cx, y: cy } : null);
      dirtyRef.current = true;
    } else if (hit) {
      setHover({ path: hit, x: cx, y: cy });
    }
  };

  const endPointer = (e: React.PointerEvent<HTMLCanvasElement>): void => {
    pointersRef.current.delete(e.pointerId);
    if (pointersRef.current.size < 2) pinchRef.current = null;
    if (pointersRef.current.size === 0) dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLCanvasElement>): void => {
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    const h = sizeRef.current.h - TIMELINE_H;
    const cam = cameraRef.current;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const next = clampScale(cam.scale * factor);
    const wx = cx / cam.scale + cam.x;
    const wz = (cy - h) / cam.scale + cam.z;
    cameraRef.current = {
      scale: next,
      x: wx - cx / next,
      z: wz - (cy - h) / next,
    };
    dirtyRef.current = true;
  };

  const onClick = (e: React.MouseEvent<HTMLCanvasElement>): void => {
    const rect = e.currentTarget.getBoundingClientRect();
    const cx = e.clientX - rect.left;
    const cy = e.clientY - rect.top;
    if (cy > sizeRef.current.h - TIMELINE_H) {
      // Timeline scrub: click sets replay point; near-right edge re-follows.
      const ratio = cx / Math.max(rect.width, 1);
      if (ratio > 0.985) {
        setReplaySeq(null);
        return;
      }
      if (!fold || fold.events.length === 0) return;
      const seq = Math.max(
        0,
        Math.min(
          fold.events.length - 1,
          Math.round(ratio * fold.events.length),
        ),
      );
      setReplaySeq(seq);
      return;
    }
    const hit = hitTest(cx, cy);
    setSelected(hit && hit !== selected ? hit : null);
  };

  const selectedInfo = useMemo(() => {
    if (!selected || !fold) return null;
    const rel = cleanRel(selected);
    const file = city?.files.find((f) => f.path === rel);
    const events = fold.events
      .filter((ev) => ev.targets.some((t) => cleanRel(t.path) === rel))
      .slice(-3)
      .reverse();
    return { file, events, info: touchedNow.get(rel) ?? null };
  }, [selected, fold, city, touchedNow]);

  const stats = fold?.stats;
  const ghosts = feed.lateGhosts.size;

  return (
    <div
      ref={wrapRef}
      className="relative h-full min-h-0 w-full overflow-hidden"
    >
      <canvas
        ref={canvasRef}
        className="block h-full w-full touch-none select-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onWheel={onWheel}
        onClick={onClick}
      />
      {hover ? (
        <div
          className="pointer-events-none absolute z-10 max-w-[260px] truncate rounded border border-border bg-popover/95 px-2 py-1 text-[11px] text-popover-foreground shadow"
          style={{
            left: Math.min(hover.x + 12, (sizeRef.current.w || 300) - 200),
            top: hover.y + 12,
          }}
        >
          <span className="font-medium">{hover.path}</span>
          {touchedNow.get(hover.path) ? (
            <span className="ml-2 text-muted-foreground">
              {TOUCH_LABEL[touchedNow.get(hover.path)?.touch ?? ""] ?? ""} ·{" "}
              {touchedNow.get(hover.path)?.count}x
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="pointer-events-none absolute top-2 left-2 flex flex-wrap gap-1.5 text-[10px] text-slate-400">
        <Badge>Micah&apos;s Mind</Badge>
        <Badge tone={STATUS_LABEL[feed.status]?.tone ?? "default"}>
          {STATUS_LABEL[feed.status]?.text ?? feed.status}
        </Badge>
        {fold ? <Badge>{fold.session.id.slice(0, 8)}</Badge> : null}
        {stats ? <Badge>{fold?.events.length ?? 0} eventos</Badge> : null}
        {stats ? <Badge>{stats.edited} editados</Badge> : null}
        {stats ? <Badge>{stats.fovea} lidos</Badge> : null}
        {stats ? <Badge>{stats.parafovea} vistos</Badge> : null}
        {stats && stats.userTurns > 0 ? (
          <Badge>{stats.userTurns} turnos</Badge>
        ) : null}
        {ghosts > 0 ? <Badge>{ghosts} fantasmas</Badge> : null}
        {city?.truncated ? <Badge tone="warn">mapa truncado</Badge> : null}
      </div>
      {replaySeq !== null ? (
        <button
          type="button"
          onClick={() => setReplaySeq(null)}
          className="absolute top-2 right-2 z-10 rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[10px] text-amber-300"
        >
          replay até #{replaySeq} · seguir ao vivo
        </button>
      ) : null}
      {selectedInfo ? (
        <div className="absolute bottom-[64px] left-2 z-10 max-w-[280px] rounded border border-border bg-popover/95 p-2 text-[11px] text-popover-foreground shadow">
          <p className="truncate font-medium">{selected}</p>
          <p className="mt-0.5 text-muted-foreground">
            {selectedInfo.file ? selectedInfo.file.lang : "arquivo"}
            {selectedInfo.file?.ghost ? " · fantasma" : ""}
            {selectedInfo.info
              ? ` · ${TOUCH_LABEL[selectedInfo.info.touch] ?? ""} ${selectedInfo.info.count}x`
              : " · não tocado"}
          </p>
          {selectedInfo.events.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {selectedInfo.events.map((ev) => (
                <li key={ev.seq} className="truncate">
                  #{ev.seq} {ev.tool} · {ev.action}
                  {ev.isError ? " · erro" : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Badge({
  children,
  tone = "default",
}: {
  children: React.ReactNode;
  tone?: "default" | "warn";
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2 py-0.5",
        tone === "warn"
          ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
          : "border-slate-700/60 bg-slate-900/70 text-slate-300",
      )}
    >
      {children}
    </span>
  );
}

function cn(...parts: Array<string | false | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

function clampScale(scale: number): number {
  return Math.min(96, Math.max(0.8, scale));
}

type TouchAtFn = (path: string) => string | null;

function render(
  canvas: HTMLCanvasElement | null,
  size: { w: number; h: number; dpr: number },
  cam: Camera,
  city: CityMap | null,
  lateGhosts: Map<string, Rect>,
  touchedNow: Map<string, { touch: string; count: number; lastSeq: number }>,
  touchAt: TouchAtFn,
  sprites: {
    hit: HTMLCanvasElement | null;
    read: HTMLCanvasElement | null;
    edit: HTMLCanvasElement | null;
    ghost: HTMLCanvasElement | null;
  },
  fold: MindFeed["fold"],
  replaySeq: number | null,
  selected: string | null,
  hover: string | null,
  pulseT: number,
): void {
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const { w, h, dpr } = size;
  if (w <= 0 || h <= 0) return;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.fillStyle = "#07090f";
  ctx.fillRect(0, 0, w, h);
  const cityH = h - TIMELINE_H;
  const latestSeq =
    fold && fold.events.length > 0
      ? fold.events[fold.events.length - 1].seq
      : -1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, 0, w, cityH);
  ctx.clip();
  ctx.translate(0, cityH);
  ctx.scale(cam.scale, cam.scale);
  ctx.translate(-cam.x, -cam.z);

  if (city) {
    for (const dir of city.dirs) {
      const r = dir.rect;
      if (!visible(r, cam, w, cityH)) continue;
      ctx.strokeStyle = DIR_EDGE;
      ctx.lineWidth = 1 / cam.scale;
      ctx.strokeRect(r.x, r.z, r.w, r.d);
    }
    for (const f of city.files) {
      drawFile(
        ctx,
        cam,
        f,
        touchedNow,
        touchAt,
        sprites,
        replaySeq,
        selected,
        hover,
        pulseT,
        city.files.length,
        latestSeq,
      );
    }
    for (const [raw, rect] of lateGhosts) {
      const rel = cleanRel(raw);
      if (city.files.some((f) => f.path === rel)) continue;
      drawGhost(
        ctx,
        cam,
        rect,
        touchAt(rel) !== null,
        selected === rel,
        hover === rel,
      );
    }
  }
  ctx.restore();

  drawTimeline(ctx, w, h, fold, replaySeq);
}

function visible(r: Rect, cam: Camera, w: number, h: number): boolean {
  const sx = (r.x - cam.x) * cam.scale;
  const sy = (r.z - cam.z) * cam.scale;
  return (
    sx + r.w * cam.scale > -8 &&
    sy + r.d * cam.scale > -8 &&
    sx < w + 8 &&
    sy < h + 8
  );
}

function drawFile(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  f: CityFile,
  touchedNow: Map<string, { touch: string; count: number; lastSeq: number }>,
  touchAt: TouchAtFn,
  sprites: {
    hit: HTMLCanvasElement | null;
    read: HTMLCanvasElement | null;
    edit: HTMLCanvasElement | null;
    ghost: HTMLCanvasElement | null;
  },
  replaySeq: number | null,
  selected: string | null,
  hover: string | null,
  pulseT: number,
  fileCount: number,
  latestSeq: number,
): void {
  const touch = touchAt(f.path);
  const r = f.rect;
  const px = Math.max(r.w, r.d) * cam.scale;
  const minPx = Math.max(1.2, Math.min(4, 2000 / Math.max(fileCount, 1)));
  if (px < minPx && !touch && selected !== f.path && hover !== f.path) {
    // LOD: deep zoom-out, untouched specks collapse to a single pixel.
    ctx.fillStyle = UNVISITED_EDGE;
    ctx.fillRect(
      r.x,
      r.z,
      Math.max(r.w, 0.5 / cam.scale),
      Math.max(r.d, 0.5 / cam.scale),
    );
    return;
  }
  const cxw = r.x + r.w / 2;
  const czw = r.z + r.d / 2;
  if (!touch) {
    ctx.fillStyle = f.ghost ? "rgba(248,113,113,0.12)" : UNVISITED_FILL;
    ctx.fillRect(r.x, r.z, r.w, r.d);
    if (px > 3) {
      ctx.strokeStyle = UNVISITED_EDGE;
      ctx.lineWidth = 0.5 / cam.scale;
      ctx.strokeRect(r.x, r.z, r.w, r.d);
    }
  } else {
    const sprite =
      touch === "edit"
        ? sprites.edit
        : touch === "read"
          ? sprites.read
          : sprites.hit;
    const color = TOUCH_COLOR[touch];
    const radius = Math.max(Math.min(r.w, r.d) / 2, 0.5 / cam.scale);
    const glowR = Math.max(radius * 3, 2.2 / cam.scale);
    if (sprite) {
      ctx.globalAlpha = 0.85;
      ctx.drawImage(sprite, cxw - glowR, czw - glowR, glowR * 2, glowR * 2);
      ctx.globalAlpha = 1;
    }
    const info = touchedNow.get(f.path);
    const isLatest =
      replaySeq === null && info !== undefined && info.lastSeq >= latestSeq;
    if (isLatest && pulseT < 1) {
      const pulse = 1 + 0.6 * (1 - pulseT);
      ctx.globalAlpha = 0.5 * (1 - pulseT);
      if (sprite) {
        const g2 = glowR * pulse;
        ctx.drawImage(sprite, cxw - g2, czw - g2, g2 * 2, g2 * 2);
      }
      ctx.globalAlpha = 1;
    }
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cxw, czw, Math.max(radius, 0.7 / cam.scale), 0, Math.PI * 2);
    ctx.fill();
  }
  if (selected === f.path || hover === f.path) {
    ctx.strokeStyle = "#e2e8f0";
    ctx.lineWidth = 1.2 / cam.scale;
    ctx.strokeRect(
      r.x - 0.6 / cam.scale,
      r.z - 0.6 / cam.scale,
      r.w + 1.2 / cam.scale,
      r.d + 1.2 / cam.scale,
    );
  }
}

function drawGhost(
  ctx: CanvasRenderingContext2D,
  cam: Camera,
  rect: Rect,
  touched: boolean,
  selected: boolean,
  hover: boolean,
): void {
  const cxw = rect.x + rect.w / 2;
  const czw = rect.z + rect.d / 2;
  const r = Math.max(rect.w / 2, 0.8 / cam.scale);
  ctx.strokeStyle = touched ? GHOST_COLOR : "rgba(248,113,113,0.4)";
  ctx.lineWidth = (selected || hover ? 1.4 : 0.9) / cam.scale;
  ctx.beginPath();
  ctx.arc(cxw, czw, r, 0, Math.PI * 2);
  ctx.stroke();
}

function drawTimeline(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fold: MindFeed["fold"],
  replaySeq: number | null,
): void {
  const top = h - TIMELINE_H;
  ctx.fillStyle = "#0a0e18";
  ctx.fillRect(0, top, w, TIMELINE_H);
  ctx.strokeStyle = "rgba(148,163,184,0.15)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, top + 0.5);
  ctx.lineTo(w, top + 0.5);
  ctx.stroke();

  const cool = new Array<number>(BUCKETS).fill(0);
  const warm = new Array<number>(BUCKETS).fill(0);
  const marks: Array<{ bucket: number; type: string }> = [];
  if (fold && fold.events.length > 0) {
    const n = fold.events.length;
    for (const ev of fold.events) {
      const b = Math.min(BUCKETS - 1, Math.floor((ev.seq / n) * BUCKETS));
      if (ev.action === "edit" || ev.action === "exec") warm[b]++;
      else cool[b]++;
    }
    for (const m of fold.marks) {
      const b = Math.min(
        BUCKETS - 1,
        Math.floor((m.seq / Math.max(n, 1)) * BUCKETS),
      );
      marks.push({ bucket: b, type: m.type });
    }
  }
  const maxBar = Math.max(1, ...cool, ...warm);
  const pad = 8;
  const barW = (w - pad * 2) / BUCKETS;
  const base = h - 10;
  for (let i = 0; i < BUCKETS; i++) {
    const x = pad + i * barW;
    const coolH = (cool[i] / maxBar) * (TIMELINE_H - 26);
    const warmH = (warm[i] / maxBar) * (TIMELINE_H - 26);
    ctx.fillStyle = "rgba(96,165,250,0.55)";
    ctx.fillRect(x, base - coolH - warmH, Math.max(barW - 1, 1), coolH);
    ctx.fillStyle = "rgba(251,191,36,0.65)";
    ctx.fillRect(x, base - warmH, Math.max(barW - 1, 1), warmH);
  }
  for (const m of marks) {
    const x = pad + m.bucket * barW + barW / 2;
    ctx.fillStyle =
      m.type === "user-message"
        ? "#e2e8f0"
        : m.type === "compaction"
          ? "#f87171"
          : "#a78bfa";
    ctx.fillRect(x - 0.5, top + 4, 1.5, 6);
  }
  if (fold && fold.events.length > 0) {
    const ratio =
      replaySeq === null ? 1 : replaySeq / Math.max(fold.events.length - 1, 1);
    const x = pad + ratio * (w - pad * 2);
    ctx.fillStyle = replaySeq === null ? "#34d399" : "#fbbf24";
    ctx.fillRect(x - 1, top + 2, 2, TIMELINE_H - 14);
    ctx.beginPath();
    ctx.arc(x, h - 8, 3, 0, Math.PI * 2);
    ctx.fill();
  }
}
