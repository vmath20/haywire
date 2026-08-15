"use client";

/**
 * SVG isometric renderer for system maps: varied 3D buildings on a grid,
 * flow paths tracing module-to-module edges, and animated payload dots.
 * Dark control-room aesthetic; pan with drag, zoom with wheel.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import type { MapFlow, MapModule } from "@/lib/systemMap";
import { MAP_GRID_W, MAP_GRID_H } from "@/lib/systemMap";

const HW = 34; // half tile width
const HH = 17; // half tile height
const LH = 9; // slab height
const SLAB_GAP = 2;

function iso(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}

function moduleHeight(m: MapModule): number {
  return m.stack * (LH + SLAB_GAP);
}

function centerOf(m: MapModule): { x: number; y: number } {
  return iso(m.x + m.size / 2, m.y + m.size / 2);
}

/** Ground-level L-shaped route between two module centers, as an SVG path. */
function routePath(a: MapModule, b: MapModule): string {
  const ax = a.x + a.size / 2;
  const ay = a.y + a.size / 2;
  const bx = b.x + b.size / 2;
  const by = b.y + b.size / 2;
  const p0 = iso(ax, ay);
  const p1 = iso(bx, ay);
  const p2 = iso(bx, by);
  if (Math.abs(ax - bx) < 0.01 || Math.abs(ay - by) < 0.01) {
    return `M ${p0.x} ${p0.y} L ${p2.x} ${p2.y}`;
  }
  return `M ${p0.x} ${p0.y} L ${p1.x} ${p1.y} L ${p2.x} ${p2.y}`;
}

function routeLength(a: MapModule, b: MapModule): number {
  const ax = a.x + a.size / 2;
  const ay = a.y + a.size / 2;
  const bx = b.x + b.size / 2;
  const by = b.y + b.size / 2;
  return Math.abs(ax - bx) + Math.abs(ay - by);
}

type StepStyle = { stroke: string; dash?: string };

const KIND_STYLE: Record<string, StepStyle> = {
  flow: { stroke: "#8fd414" },
  retry: { stroke: "#9aa4b1", dash: "6 5" },
  feedback: { stroke: "#b3bcc7", dash: "2 5" },
};

function Building({
  m,
  selected,
  onSelect,
}: {
  m: MapModule;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  const [hover, setHover] = useState(false);
  const s = m.size;
  const slabs: React.ReactNode[] = [];
  const stroke = selected ? "#0b0d10" : hover ? "#5c6775" : "#98a2af";

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
    slabs.push(
      <g key={i}>
        <path d={left} fill={selected ? "#ecf6cd" : "#edf0f4"} stroke={stroke} strokeWidth={0.8} />
        <path d={right} fill={selected ? "#e2eec0" : "#e0e5eb"} stroke={stroke} strokeWidth={0.8} />
        <path d={top} fill={selected ? "#f7ffe3" : "#fbfcfd"} stroke={stroke} strokeWidth={0.8} />
      </g>,
    );
  }

  const h = moduleHeight(m);
  const c = centerOf(m);

  return (
    <g
      onClick={(e) => {
        e.stopPropagation();
        onSelect(m.id);
      }}
      onPointerEnter={() => setHover(true)}
      onPointerLeave={() => setHover(false)}
      style={{ cursor: "pointer" }}
    >
      {slabs}
      {/* id chip on the top face */}
      <text
        x={c.x}
        y={c.y - h - 2 + HH * 0.45 * s}
        textAnchor="middle"
        fontSize={9.5}
        fontFamily="var(--font-geist-mono), ui-monospace, monospace"
        fontWeight={600}
        fill={selected ? "#0b0d10" : "#5c6775"}
        letterSpacing="0.08em"
        style={{ pointerEvents: "none", userSelect: "none" }}
      >
        {m.id}
      </text>
      {selected ? (
        <circle cx={c.x} cy={c.y - h - 14} r={3} fill="none" stroke="#8fd414" strokeWidth={1.4}>
          <animate attributeName="r" values="2;6;2" dur="2s" repeatCount="indefinite" />
          <animate attributeName="opacity" values="1;0.2;1" dur="2s" repeatCount="indefinite" />
        </circle>
      ) : null}
    </g>
  );
}

export function IsoScene({
  modules,
  flows,
  activeFlow,
  paused,
  traceIndex,
  selectedId,
  onSelect,
  resetNonce,
}: {
  modules: MapModule[];
  flows: MapFlow[];
  activeFlow: MapFlow | null;
  paused: boolean;
  traceIndex: number | null;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  resetNonce: number;
}) {
  const byId = useMemo(() => {
    const map = new Map<string, MapModule>();
    for (const m of modules) map.set(m.id, m);
    return map;
  }, [modules]);

  // Painter's order: back to front.
  const ordered = useMemo(
    () => [...modules].sort((a, b) => a.x + a.y + a.size - (b.x + b.y + b.size)),
    [modules],
  );

  // Pan / zoom
  const [view, setView] = useState({ k: 1, tx: 0, ty: 0 });
  const dragRef = useRef<{ sx: number; sy: number; tx: number; ty: number } | null>(null);

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

  // Scene bounds
  const pad = 70;
  const corners = [iso(0, 0), iso(MAP_GRID_W, 0), iso(0, MAP_GRID_H), iso(MAP_GRID_W, MAP_GRID_H)];
  const minX = Math.min(...corners.map((c) => c.x)) - pad;
  const maxX = Math.max(...corners.map((c) => c.x)) + pad;
  const minY = Math.min(...corners.map((c) => c.y)) - pad - 6 * (LH + SLAB_GAP);
  const maxY = Math.max(...corners.map((c) => c.y)) + pad;

  // Grid lines
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

  // Faint paths for every flow; bright styled paths for the active one.
  const faintPaths = useMemo(() => {
    const out: string[] = [];
    for (const f of flows) {
      if (activeFlow && f.id === activeFlow.id) continue;
      for (const s of f.steps) {
        const a = byId.get(s.from);
        const b = byId.get(s.to);
        if (a && b) out.push(routePath(a, b));
      }
    }
    return out;
  }, [flows, activeFlow, byId]);

  const activeSteps = useMemo(() => {
    if (!activeFlow) return [];
    return activeFlow.steps
      .map((s, i) => {
        const a = byId.get(s.from);
        const b = byId.get(s.to);
        if (!a || !b) return null;
        return { d: routePath(a, b), kind: s.kind || "flow", i, to: b, len: routeLength(a, b) };
      })
      .filter((s): s is NonNullable<typeof s> => s !== null);
  }, [activeFlow, byId]);

  // One concatenated motion path for payload dots.
  const motion = useMemo(() => {
    if (activeSteps.length === 0) return null;
    let d = "";
    let len = 0;
    for (const s of activeSteps) {
      d += (d ? " " : "") + s.d;
      len += s.len;
    }
    const dur = Math.max(4, len * 0.9);
    return { d, dur };
  }, [activeSteps]);

  const traced = traceIndex !== null && activeSteps.length > 0
    ? activeSteps[Math.min(traceIndex, activeSteps.length - 1)]
    : null;

  return (
    <svg
      ref={svgRef}
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      className="h-full w-full touch-none select-none"
      onClick={() => onSelect(null)}
      onPointerDown={(e) => {
        (e.target as Element).setPointerCapture?.(e.pointerId);
        dragRef.current = { sx: e.clientX, sy: e.clientY, tx: view.tx, ty: view.ty };
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d) return;
        setView((v) => ({ ...v, tx: d.tx + (e.clientX - d.sx) / v.k, ty: d.ty + (e.clientY - d.sy) / v.k }));
      }}
      onPointerUp={() => {
        dragRef.current = null;
      }}
      style={{ cursor: dragRef.current ? "grabbing" : "grab" }}
    >
      <g transform={`scale(${view.k}) translate(${view.tx} ${view.ty})`}>
        {/* floor grid */}
        <g>
          {gridLines.map((l, i) => (
            <line
              key={i}
              x1={l.x1}
              y1={l.y1}
              x2={l.x2}
              y2={l.y2}
              stroke="#e8ecf1"
              strokeWidth={1}
            />
          ))}
        </g>

        {/* faint inactive flow paths */}
        <g>
          {faintPaths.map((d, i) => (
            <path key={i} d={d} fill="none" stroke="#dfe4ea" strokeWidth={1} />
          ))}
        </g>

        {/* buildings */}
        <g>
          {ordered.map((m) => (
            <Building
              key={m.id}
              m={m}
              selected={m.id === selectedId}
              onSelect={(id) => onSelect(id)}
            />
          ))}
        </g>

        {/* name labels above everything so buildings never occlude them */}
        <g>
          {ordered.map((m) => {
            const base = iso(m.x + m.size / 2, m.y + m.size / 2);
            const label = m.name.length > 22 ? `${m.name.slice(0, 21)}…` : m.name;
            return (
              <g key={m.id} style={{ pointerEvents: "none", userSelect: "none" }}>
                <text
                  x={base.x}
                  y={base.y + HH * m.size + 12}
                  textAnchor="middle"
                  fontSize={8.5}
                  fontFamily="var(--font-geist-mono), ui-monospace, monospace"
                  stroke="#fcfcfd"
                  strokeWidth={3}
                  strokeLinejoin="round"
                  letterSpacing="0.04em"
                >
                  {label}
                </text>
                <text
                  x={base.x}
                  y={base.y + HH * m.size + 12}
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

        {/* active flow paths — rendered above buildings with a white casing
            so payload lanes are never blocked by tall buildings */}
        <g style={{ pointerEvents: "none" }}>
          {activeSteps.map((s) => (
            <path
              key={`case-${s.i}`}
              d={s.d}
              fill="none"
              stroke="#ffffff"
              strokeWidth={4.5}
              strokeLinecap="round"
              strokeLinejoin="round"
              opacity={0.85}
            />
          ))}
          {activeSteps.map((s) => {
            const style = KIND_STYLE[s.kind] ?? KIND_STYLE.flow!;
            return (
              <path
                key={s.i}
                d={s.d}
                fill="none"
                stroke={style.stroke}
                strokeWidth={1.8}
                strokeDasharray={style.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            );
          })}
        </g>

        {/* traced step highlight */}
        {traced ? (
          <path
            d={traced.d}
            fill="none"
            stroke="#0b0d10"
            strokeWidth={2.6}
            strokeLinecap="round"
            style={{ pointerEvents: "none" }}
          >
            <animate attributeName="opacity" values="1;0.45;1" dur="1.1s" repeatCount="indefinite" />
          </path>
        ) : null}

        {/* payload dots in motion — topmost so they are always visible */}
        {motion && !paused ? (
          <g style={{ pointerEvents: "none" }}>
            {[0, 1, 2].map((i) => (
              <circle key={i} r={4.2} fill="#8fd414" stroke="#ffffff" strokeWidth={1.6}>
                <animateMotion
                  path={motion.d}
                  dur={`${motion.dur}s`}
                  begin={`${(-i * motion.dur) / 3}s`}
                  repeatCount="indefinite"
                />
              </circle>
            ))}
          </g>
        ) : null}

        {/* pulse at traced step target */}
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
