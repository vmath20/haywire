"use client";

/**
 * SVG isometric renderer: a city of buildings on a grid, streets between
 * them carrying payload flows, and buildings the user can drag to rearrange.
 */

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { MapFlow, MapModule } from "@/lib/systemMap";
import { MAP_GRID_W, MAP_GRID_H, nearestFree } from "@/lib/systemMap";

const HW = 36;
const HH = 18;
const LH = 10;
const SLAB_GAP = 2;

type Pt = { x: number; y: number };
type GPt = { gx: number; gy: number };

function iso(gx: number, gy: number): Pt {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}

function screenToGrid(x: number, y: number): GPt {
  return { gx: (x / HW + y / HH) / 2, gy: (y / HH - x / HW) / 2 };
}

function moduleHeight(m: MapModule): number {
  return m.stack * (LH + SLAB_GAP);
}

function centerOf(m: MapModule): Pt {
  return iso(m.x + m.size / 2, m.y + m.size / 2);
}

/** Front-center dock, half a cell into the street (toward the camera). */
function dockOf(m: MapModule): GPt {
  return { gx: m.x + m.size / 2, gy: m.y + m.size + 0.4 };
}

function occupiedSet(modules: MapModule[], exceptId?: string): Set<string> {
  const s = new Set<string>();
  for (const m of modules) {
    if (m.id === exceptId) continue;
    for (let dx = 0; dx < m.size; dx++) {
      for (let dy = 0; dy < m.size; dy++) {
        s.add(`${Math.round(m.x + dx)},${Math.round(m.y + dy)}`);
      }
    }
  }
  return s;
}

function samplesClear(a: GPt, b: GPt, occ: Set<string>): boolean {
  const steps = Math.max(2, Math.ceil(Math.abs(a.gx - b.gx) + Math.abs(a.gy - b.gy)) * 2);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const gx = a.gx + (b.gx - a.gx) * t;
    const gy = a.gy + (b.gy - a.gy) * t;
    if (occ.has(`${Math.floor(gx)},${Math.floor(gy)}`)) return false;
  }
  return true;
}

function polylineClear(pts: GPt[], occ: Set<string>): boolean {
  for (let i = 0; i < pts.length - 1; i++) {
    if (!samplesClear(pts[i]!, pts[i + 1]!, occ)) return false;
  }
  return true;
}

function toSvg(pts: GPt[]): string {
  return pts
    .map((p, i) => {
      const s = iso(p.gx, p.gy);
      return `${i === 0 ? "M" : "L"} ${s.x.toFixed(1)} ${s.y.toFixed(1)}`;
    })
    .join(" ");
}

function routeLength(pts: GPt[]): number {
  let n = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    n += Math.abs(pts[i]!.gx - pts[i + 1]!.gx) + Math.abs(pts[i]!.gy - pts[i + 1]!.gy);
  }
  return n;
}

/** Manhattan street route that prefers corridors around building footprints. */
function routeStreet(a: MapModule, b: MapModule, occ: Set<string>): GPt[] {
  const s = dockOf(a);
  const e = dockOf(b);
  const frontY = Math.max(s.gy, e.gy) + 0.7;
  const backY = Math.min(a.y, b.y) - 0.5;
  const leftX = Math.min(s.gx, e.gx) - 0.7;
  const rightX = Math.max(s.gx, e.gx) + 0.7;
  const candidates: GPt[][] = [
    [s, { gx: e.gx, gy: s.gy }, e],
    [s, { gx: s.gx, gy: e.gy }, e],
    [s, { gx: s.gx, gy: frontY }, { gx: e.gx, gy: frontY }, e],
    [s, { gx: s.gx, gy: backY }, { gx: e.gx, gy: backY }, e],
    [s, { gx: leftX, gy: s.gy }, { gx: leftX, gy: e.gy }, e],
    [s, { gx: rightX, gy: s.gy }, { gx: rightX, gy: e.gy }, e],
  ];
  for (const pts of candidates) {
    if (polylineClear(pts, occ)) return pts;
  }
  return [s, { gx: s.gx, gy: frontY }, { gx: e.gx, gy: frontY }, e];
}

function pointAlong(pts: GPt[], t: number): GPt {
  if (pts.length === 0) return { gx: 0, gy: 0 };
  if (pts.length === 1) return pts[0]!;
  const lengths: number[] = [];
  let total = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const d =
      Math.abs(pts[i]!.gx - pts[i + 1]!.gx) + Math.abs(pts[i]!.gy - pts[i + 1]!.gy);
    lengths.push(d);
    total += d;
  }
  if (total <= 0) return pts[0]!;
  let dist = ((t % 1) + 1) % 1 * total;
  for (let i = 0; i < lengths.length; i++) {
    const d = lengths[i]!;
    if (dist <= d || i === lengths.length - 1) {
      const u = d === 0 ? 0 : dist / d;
      return {
        gx: pts[i]!.gx + (pts[i + 1]!.gx - pts[i]!.gx) * u,
        gy: pts[i]!.gy + (pts[i + 1]!.gy - pts[i]!.gy) * u,
      };
    }
    dist -= d;
  }
  return pts[pts.length - 1]!;
}

type Palette = {
  top: string;
  left: string;
  right: string;
  hatch: string;
  selectedTop: string;
  selectedLeft: string;
  selectedRight: string;
};

const PALETTES: Palette[] = [
  {
    top: "#f7ffe3",
    left: "#e7f3c2",
    right: "#d3e3a4",
    hatch: "#8fd414",
    selectedTop: "#f4ffd4",
    selectedLeft: "#dceea8",
    selectedRight: "#c6dd86",
  },
  {
    top: "#fbfcfd",
    left: "#eef1f5",
    right: "#e0e5eb",
    hatch: "#98a2af",
    selectedTop: "#f7ffe3",
    selectedLeft: "#ecf6cd",
    selectedRight: "#e2eec0",
  },
  {
    top: "#fff6ea",
    left: "#f3e6d4",
    right: "#e8d5bc",
    hatch: "#c4a06a",
    selectedTop: "#fff0d8",
    selectedLeft: "#ead7bc",
    selectedRight: "#dcc09a",
  },
  {
    top: "#eef3ff",
    left: "#dfe7f5",
    right: "#d0dbeb",
    hatch: "#7a8eaa",
    selectedTop: "#e4edff",
    selectedLeft: "#d0dcf0",
    selectedRight: "#becce0",
  },
  {
    top: "#f6f6f7",
    left: "#ececee",
    right: "#e2e2e5",
    hatch: "#a1a1aa",
    selectedTop: "#f0f0f2",
    selectedLeft: "#e4e4e7",
    selectedRight: "#d4d4d8",
  },
];

export function paletteForCategory(categoryId: string, categories: { id: string }[]): Palette {
  const i = Math.max(0, categories.findIndex((c) => c.id === categoryId));
  return PALETTES[i % PALETTES.length]!;
}

const KIND_STYLE: Record<string, { stroke: string; dash?: string; width: number }> = {
  flow: { stroke: "#5a9a0a", width: 1.7 },
  retry: { stroke: "#7b8794", dash: "6 5", width: 1.4 },
  feedback: { stroke: "#9aa4b1", dash: "2 5", width: 1.3 },
};

function Building({
  m,
  selected,
  dragging,
  palette,
  hatchId,
  isEntry,
  isExit,
  onPointerDown,
}: {
  m: MapModule;
  selected: boolean;
  dragging: boolean;
  palette: Palette;
  hatchId: string;
  isEntry: boolean;
  isExit: boolean;
  onPointerDown: (e: React.PointerEvent, id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const s = m.size;
  const stroke = selected || dragging ? "#0b0d10" : hover ? "#5c6775" : "#8b95a1";
  const slabs: React.ReactNode[] = [];

  for (let i = 0; i < m.stack; i++) {
    const zBot = i * (LH + SLAB_GAP);
    const zTop = zBot + LH;
    const N = iso(m.x, m.y);
    const E = iso(m.x + s, m.y);
    const S = iso(m.x + s, m.y + s);
    const W = iso(m.x, m.y + s);
    const top = `M ${N.x} ${N.y - zTop} L ${E.x} ${E.y - zTop} L ${S.x} ${S.y - zTop} L ${W.x} ${W.y - zTop} Z`;
    const left = `M ${W.x} ${W.y - zTop} L ${S.x} ${S.y - zTop} L ${S.x} ${S.y - zBot} L ${W.x} ${W.y - zBot} Z`;
    const right = `M ${S.x} ${S.y - zTop} L ${E.x} ${E.y - zTop} L ${E.x} ${E.y - zBot} L ${S.x} ${S.y - zBot} Z`;
    const isRoof = i === m.stack - 1;
    slabs.push(
      <g key={i}>
        <path d={left} fill={selected ? palette.selectedLeft : palette.left} stroke={stroke} strokeWidth={0.9} />
        <path d={right} fill={selected ? palette.selectedRight : palette.right} stroke={stroke} strokeWidth={0.9} />
        <path d={top} fill={selected ? palette.selectedTop : palette.top} stroke={stroke} strokeWidth={0.9} />
        {isRoof ? (
          <path d={top} fill={`url(#${hatchId})`} opacity={0.55} />
        ) : null}
      </g>,
    );
  }

  const h = moduleHeight(m);
  const c = centerOf(m);
  const roof = iso(m.x + s / 2, m.y + s / 2);

  // Ground plaza under the building, slightly larger than the footprint.
  const pad = 0.12;
  const pN = iso(m.x - pad, m.y - pad);
  const pE = iso(m.x + s + pad, m.y - pad);
  const pS = iso(m.x + s + pad, m.y + s + pad);
  const pW = iso(m.x - pad, m.y + s + pad);

  return (
    <g
      data-building={m.id}
      onPointerDown={(e) => onPointerDown(e, m.id)}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{ cursor: dragging ? "grabbing" : "grab" }}
      opacity={dragging ? 0.92 : 1}
    >
      <path
        d={`M ${pN.x} ${pN.y} L ${pE.x} ${pE.y} L ${pS.x} ${pS.y} L ${pW.x} ${pW.y} Z`}
        fill={selected ? "#eef6d4" : "#f1f3f6"}
        stroke="#d5dbe3"
        strokeWidth={0.6}
      />
      {slabs}
      {isEntry ? (
        <g>
          <line
            x1={roof.x}
            y1={roof.y - h - 2}
            x2={roof.x}
            y2={roof.y - h - 16}
            stroke="#0b0d10"
            strokeWidth={1.1}
          />
          <polygon
            points={`${roof.x},${roof.y - h - 16} ${roof.x + 9},${roof.y - h - 12} ${roof.x},${roof.y - h - 8}`}
            fill="#8fd414"
            stroke="#0b0d10"
            strokeWidth={0.7}
          />
        </g>
      ) : null}
      {isExit && !isEntry ? (
        <rect
          x={roof.x - 2.2}
          y={roof.y - h - 10}
          width={4.4}
          height={8}
          fill="#5c6775"
          stroke="#0b0d10"
          strokeWidth={0.6}
        />
      ) : null}
      <text
        x={c.x}
        y={c.y - h - 2 + HH * 0.42 * s}
        textAnchor="middle"
        fontSize={9.5}
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
        fontWeight={700}
        fill={selected || dragging ? "#0b0d10" : "#3d4654"}
        letterSpacing="0.08em"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {m.id}
      </text>
    </g>
  );
}

export function IsoScene({
  modules,
  flows,
  categories,
  activeFlow,
  paused,
  traceIndex,
  selectedId,
  onSelect,
  onMove,
  resetNonce,
}: {
  modules: MapModule[];
  flows: MapFlow[];
  categories: { id: string; label: string }[];
  activeFlow: MapFlow | null;
  paused: boolean;
  traceIndex: number | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onMove: (id: string, x: number, y: number) => void;
  resetNonce: number;
}) {
  const uid = useId().replace(/:/g, "");
  const byId = useMemo(() => {
    const map = new Map<string, MapModule>();
    for (const m of modules) map.set(m.id, m);
    return map;
  }, [modules]);

  const entries = useMemo(() => {
    const s = new Set<string>();
    for (const f of flows) {
      const first = f.steps[0]?.from;
      if (first) s.add(first);
    }
    return s;
  }, [flows]);

  const exits = useMemo(() => {
    const s = new Set<string>();
    for (const f of flows) {
      const last = f.steps[f.steps.length - 1]?.to;
      if (last) s.add(last);
    }
    return s;
  }, [flows]);

  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const panRef = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null);
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    origX: number;
    origY: number;
    moved: boolean;
  } | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [clock, setClock] = useState(0);
  const skipDeselectRef = useRef(false);

  useEffect(() => {
    setView({ k: 1, tx: 0, ty: 0 });
  }, [resetNonce]);

  const svgRef = useRef<SVGSVGElement>(null);
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setView((v) => ({
        ...v,
        k: Math.max(0.45, Math.min(2.6, v.k * Math.exp(-e.deltaY * 0.0012))),
      }));
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  const pad = 80;
  const corners = [iso(0, 0), iso(MAP_GRID_W, 0), iso(0, MAP_GRID_H), iso(MAP_GRID_W, MAP_GRID_H)];
  const minX = Math.min(...corners.map((c) => c.x)) - pad;
  const maxX = Math.max(...corners.map((c) => c.x)) + pad;
  const minY = Math.min(...corners.map((c) => c.y)) - pad - 7 * (LH + SLAB_GAP);
  const maxY = Math.max(...corners.map((c) => c.y)) + pad + 20;

  const gridLines = useMemo(() => {
    const lines: { x1: number; y1: number; x2: number; y2: number }[] = [];
    for (let gx = 0; gx <= MAP_GRID_W; gx++) {
      const a = iso(gx, 0);
      const b = iso(gx, MAP_GRID_H);
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    for (let gy = 0; gy <= MAP_GRID_H; gy++) {
      const a = iso(0, gy);
      const b = iso(MAP_GRID_W, gy);
      lines.push({ x1: a.x, y1: a.y, x2: b.x, y2: b.y });
    }
    return lines;
  }, []);

  const occ = useMemo(() => occupiedSet(modules), [modules]);

  const faintRoutes = useMemo(() => {
    const out: { d: string; depth: number }[] = [];
    for (const f of flows) {
      if (activeFlow && f.id === activeFlow.id) continue;
      for (const s of f.steps) {
        const a = byId.get(s.from);
        const b = byId.get(s.to);
        if (!a || !b) continue;
        const pts = routeStreet(a, b, occ);
        const mid = pts[Math.floor(pts.length / 2)]!;
        out.push({ d: toSvg(pts), depth: mid.gx + mid.gy });
      }
    }
    return out;
  }, [flows, activeFlow, byId, occ]);

  const activeRoutes = useMemo(() => {
    if (!activeFlow) return [];
    return activeFlow.steps
      .map((s, i) => {
        const a = byId.get(s.from);
        const b = byId.get(s.to);
        if (!a || !b) return null;
        const pts = routeStreet(a, b, occ);
        const mid = pts[Math.floor(pts.length / 2)]!;
        return {
          i,
          pts,
          d: toSvg(pts),
          kind: s.kind || "flow",
          to: b,
          depth: mid.gx + mid.gy,
          len: routeLength(pts),
        };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [activeFlow, byId, occ]);

  const motionPts = useMemo(() => {
    const pts: GPt[] = [];
    for (const r of activeRoutes) {
      if (pts.length > 0) pts.pop();
      pts.push(...r.pts);
    }
    const len = routeLength(pts);
    return pts.length >= 2 ? { pts, len, dur: Math.max(5, len * 0.85) } : null;
  }, [activeRoutes]);

  useEffect(() => {
    if (!motionPts || paused) return;
    let raf = 0;
    const t0 = performance.now();
    const loop = (t: number) => {
      setClock((t - t0) / 1000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [motionPts, paused, activeFlow?.id]);

  const payloads = useMemo(() => {
    if (!motionPts || paused) return [];
    return [0, 1, 2].map((i) => {
      const t = (clock / motionPts.dur + i / 3) % 1;
      const g = pointAlong(motionPts.pts, t);
      const s = iso(g.gx, g.gy);
      return { x: s.x, y: s.y, depth: g.gx + g.gy };
    });
  }, [motionPts, paused, clock]);

  const traced = traceIndex !== null && activeRoutes.length > 0
    ? activeRoutes[Math.min(traceIndex, activeRoutes.length - 1)]
    : null;

  function clientToWorld(e: { clientX: number; clientY: number }): Pt | null {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (!ctm) return null;
    const pt = svg.createSVGPoint();
    pt.x = e.clientX;
    pt.y = e.clientY;
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x / view.k - view.tx, y: p.y / view.k - view.ty };
  }

  function onBuildingPointerDown(e: React.PointerEvent, id: string) {
    e.stopPropagation();
    e.preventDefault();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const m = byId.get(id);
    if (!m) return;
    dragRef.current = {
      id,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      origX: m.x,
      origY: m.y,
      moved: false,
    };
    setDraggingId(id);
    onSelect(id);
  }

  type DrawItem =
    | { kind: "faint"; depth: number; d: string; key: string }
    | { kind: "active"; depth: number; d: string; style: (typeof KIND_STYLE)[string]; key: string }
    | { kind: "trace"; depth: number; d: string }
    | { kind: "building"; depth: number; m: MapModule }
    | { kind: "dot"; depth: number; x: number; y: number; key: string };

  const drawItems = useMemo(() => {
    const items: DrawItem[] = [];
    faintRoutes.forEach((r, i) => {
      items.push({ kind: "faint", depth: r.depth, d: r.d, key: `f-${i}` });
    });
    for (const r of activeRoutes) {
      const style = KIND_STYLE[r.kind] ?? KIND_STYLE.flow!;
      items.push({ kind: "active", depth: r.depth, d: r.d, style, key: `a-${r.i}` });
    }
    if (traced) {
      items.push({ kind: "trace", depth: traced.depth + 0.2, d: traced.d });
    }
    for (const m of modules) {
      items.push({ kind: "building", depth: m.x + m.y + m.size, m });
    }
    payloads.forEach((p, i) => {
      items.push({ kind: "dot", depth: p.depth + 0.15, x: p.x, y: p.y, key: `d-${i}` });
    });
    items.sort((a, b) => a.depth - b.depth);
    return items;
  }, [faintRoutes, activeRoutes, traced, modules, payloads]);

  return (
    <svg
      ref={svgRef}
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      className="h-full w-full touch-none select-none"
      onClick={(e) => {
        if (skipDeselectRef.current) {
          skipDeselectRef.current = false;
          return;
        }
        if ((e.target as Element).closest?.("[data-building]")) return;
        onSelect(null);
      }}
      onPointerDown={(e) => {
        if (dragRef.current) return;
        (e.target as Element).setPointerCapture?.(e.pointerId);
        panRef.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
      }}
      onPointerMove={(e) => {
        const drag = dragRef.current;
        if (drag) {
            if (Math.abs(e.clientX - drag.startX) + Math.abs(e.clientY - drag.startY) > 6) {
            drag.moved = true;
          }
          if (!drag.moved) return;
          const world = clientToWorld(e);
          const start = clientToWorld({ clientX: drag.startX, clientY: drag.startY });
          if (!world || !start) return;
          const dg = screenToGrid(world.x - start.x, world.y - start.y);
          const nx = Math.round(drag.origX + dg.gx);
          const ny = Math.round(drag.origY + dg.gy);
          const moving = byId.get(drag.id);
          if (!moving) return;
          const spot = nearestFree(modules, drag.id, nx, ny);
          if (spot.x !== moving.x || spot.y !== moving.y) {
            onMove(drag.id, spot.x, spot.y);
          }
          return;
        }
        const pan = panRef.current;
        if (!pan) return;
        setView((v) => ({
          ...v,
          tx: pan.tx + (e.clientX - pan.sx) / v.k,
          ty: pan.ty + (e.clientY - pan.sy) / v.k,
        }));
      }}
      onPointerUp={() => {
        if (dragRef.current) {
          if (dragRef.current.moved) skipDeselectRef.current = true;
          else onSelect(dragRef.current.id);
        }
        dragRef.current = null;
        panRef.current = null;
        setDraggingId(null);
      }}
      onPointerCancel={() => {
        dragRef.current = null;
        panRef.current = null;
        setDraggingId(null);
      }}
      style={{ cursor: draggingId ? "grabbing" : panRef.current ? "grabbing" : "grab" }}
    >
      <defs>
        {PALETTES.map((p, i) => (
          <pattern
            key={i}
            id={`${uid}-hatch-${i}`}
            width="5"
            height="5"
            patternUnits="userSpaceOnUse"
            patternTransform="rotate(45)"
          >
            <line x1="0" y1="0" x2="0" y2="5" stroke={p.hatch} strokeWidth="1.1" />
          </pattern>
        ))}
      </defs>

      <g transform={`scale(${view.k}) translate(${view.tx} ${view.ty})`}>
        <g>
          {gridLines.map((l, i) => (
            <line
              key={i}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="#e6eaef"
              strokeWidth={1}
            />
          ))}
        </g>

        {drawItems.map((item) => {
          if (item.kind === "faint") {
            return (
              <path
                key={item.key}
                d={item.d}
                fill="none"
                stroke="#d5dbe3"
                strokeWidth={1.1}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          }
          if (item.kind === "active") {
            return (
              <path
                key={item.key}
                d={item.d}
                fill="none"
                stroke={item.style.stroke}
                strokeWidth={item.style.width}
                strokeDasharray={item.style.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          }
          if (item.kind === "trace") {
            return (
              <path
                key="trace"
                d={item.d}
                fill="none"
                stroke="#0b0d10"
                strokeWidth={2.4}
                strokeLinecap="round"
                opacity={0.85}
              />
            );
          }
          if (item.kind === "dot") {
            return (
              <g key={item.key}>
                <circle cx={item.x} cy={item.y} r={4.4} fill="#8fd414" stroke="#ffffff" strokeWidth={1.5} />
              </g>
            );
          }
          const pal = paletteForCategory(item.m.category, categories);
          const palIndex = Math.max(0, categories.findIndex((c) => c.id === item.m.category));
          return (
            <Building
              key={item.m.id}
              m={item.m}
              selected={item.m.id === selectedId}
              dragging={item.m.id === draggingId}
              palette={pal}
              hatchId={`${uid}-hatch-${palIndex % PALETTES.length}`}
              isEntry={entries.has(item.m.id)}
              isExit={exits.has(item.m.id)}
              onPointerDown={onBuildingPointerDown}
            />
          );
        })}

        {/* name labels above geometry */}
        <g>
          {modules.map((m) => {
            const base = iso(m.x + m.size / 2, m.y + m.size / 2);
            const label = m.name.length > 22 ? `${m.name.slice(0, 21)}…` : m.name;
            return (
              <g key={m.id} style={{ pointerEvents: "none", userSelect: "none" }}>
                <text
                  x={base.x}
                  y={base.y + HH * m.size + 14}
                  textAnchor="middle"
                  fontSize={8.5}
                  fontFamily="var(--font-geist-mono), ui-monospace, monospace"
                  stroke="#fcfcfd"
                  strokeWidth={3.2}
                  strokeLinejoin="round"
                  letterSpacing="0.04em"
                >
                  {label}
                </text>
                <text
                  x={base.x}
                  y={base.y + HH * m.size + 14}
                  textAnchor="middle"
                  fontSize={8.5}
                  fontFamily="var(--font-geist-mono), ui-monospace, monospace"
                  fill={m.id === selectedId ? "#0b0d10" : "#5c6775"}
                  letterSpacing="0.04em"
                >
                  {label}
                </text>
              </g>
            );
          })}
        </g>

        {traced ? (
          <circle
            cx={centerOf(traced.to).x}
            cy={centerOf(traced.to).y - moduleHeight(traced.to) - 8}
            r={4}
            fill="none"
            stroke="#0b0d10"
            strokeWidth={1.4}
          >
            <animate attributeName="r" values="3;9;3" dur="1.1s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0;1" dur="1.1s" repeatCount="indefinite" />
          </circle>
        ) : null}
      </g>
    </svg>
  );
}
