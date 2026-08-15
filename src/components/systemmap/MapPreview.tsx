"use client";

import type { ReactNode } from "react";
import { previewPalette, type MapPreviewData } from "@/lib/mapThumbnail";

const HW = 28;
const HH = 14;
const LH = 8;
const SLAB_GAP = 1.8;

function iso(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}

function pathOf(pts: { x: number; y: number }[]): string {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
}

export function MapPreview({
  data,
  compact = false,
  className,
}: {
  data: MapPreviewData | null;
  compact?: boolean;
  className?: string;
}) {
  const modules = data?.modules ?? [];
  const categories = data?.categories ?? [];
  const flows = data?.flows ?? [];

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of modules) {
    const s = Math.max(1, m.size);
    const h = Math.max(1, m.stack) * (LH + SLAB_GAP);
    const corners = [
      iso(m.x, m.y),
      iso(m.x + s, m.y),
      iso(m.x + s, m.y + s),
      iso(m.x, m.y + s),
    ];
    for (const c of corners) {
      minX = Math.min(minX, c.x);
      maxX = Math.max(maxX, c.x);
      minY = Math.min(minY, c.y - h);
      maxY = Math.max(maxY, c.y);
    }
  }

  if (!Number.isFinite(minX)) {
    minX = iso(0, 4).x;
    maxX = iso(6, 0).x;
    minY = iso(0, 0).y - 20;
    maxY = iso(6, 4).y;
  }

  const pad = compact ? 14 : 40;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = Math.max(40, maxX - minX + pad * 2);
  const vbH = Math.max(30, maxY - minY + pad * 2);
  const byId = new Map(modules.map((m) => [m.id, m]));
  const sorted = [...modules].sort((a, b) => a.x + a.y - (b.x + b.y));
  const strokeW = compact ? 0.9 : 0.85;
  const fontSize = compact ? 6 : 9;

  const grid: ReactNode[] = [];
  if (!compact) {
    const x0 = Math.floor(Math.min(...modules.map((m) => m.x), 0)) - 1;
    const y0 = Math.floor(Math.min(...modules.map((m) => m.y), 0)) - 1;
    const x1 = Math.ceil(Math.max(...modules.map((m) => m.x + m.size), 8)) + 1;
    const y1 = Math.ceil(Math.max(...modules.map((m) => m.y + m.size), 6)) + 1;
    for (let x = x0; x < x1; x++) {
      for (let y = y0; y < y1; y++) {
        const N = iso(x, y);
        const E = iso(x + 1, y);
        const S = iso(x + 1, y + 1);
        const W = iso(x, y + 1);
        grid.push(
          <path
            key={`g-${x}-${y}`}
            d={pathOf([N, E, S, W])}
            fill="none"
            stroke="#d5dbe3"
            strokeWidth={0.6}
          />,
        );
      }
    }
  }

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      width="100%"
      height="100%"
      className={className}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="#f3f4f6" />
      {grid}
      {flows.slice(0, 4).flatMap((flow, fi) =>
        flow.steps.map((step, si) => {
          const a = byId.get(step.from);
          const b = byId.get(step.to);
          if (!a || !b) return null;
          const pa = iso(a.x + a.size / 2, a.y + a.size / 2);
          const pb = iso(b.x + b.size / 2, b.y + b.size / 2);
          return (
            <line
              key={`${fi}-${si}`}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke="#5a9a0a"
              strokeWidth={compact ? 1.4 : 2}
              strokeOpacity={0.6}
            />
          );
        }),
      )}
      {sorted.map((m) => {
        const pal = previewPalette(m.category, categories);
        const s = Math.max(1, m.size);
        const slabs: ReactNode[] = [];
        const stack = Math.max(1, m.stack);
        for (let i = 0; i < stack; i++) {
          const zBot = i * (LH + SLAB_GAP);
          const zTop = zBot + LH;
          const N = iso(m.x, m.y);
          const E = iso(m.x + s, m.y);
          const S = iso(m.x + s, m.y + s);
          const W = iso(m.x, m.y + s);
          slabs.push(
            <g key={i}>
              <path
                d={pathOf([
                  { x: W.x, y: W.y - zTop },
                  { x: S.x, y: S.y - zTop },
                  { x: S.x, y: S.y - zBot },
                  { x: W.x, y: W.y - zBot },
                ])}
                fill={pal.left}
                stroke="#8b95a1"
                strokeWidth={strokeW}
              />
              <path
                d={pathOf([
                  { x: S.x, y: S.y - zTop },
                  { x: E.x, y: E.y - zTop },
                  { x: E.x, y: E.y - zBot },
                  { x: S.x, y: S.y - zBot },
                ])}
                fill={pal.right}
                stroke="#8b95a1"
                strokeWidth={strokeW}
              />
              <path
                d={pathOf([
                  { x: N.x, y: N.y - zTop },
                  { x: E.x, y: E.y - zTop },
                  { x: S.x, y: S.y - zTop },
                  { x: W.x, y: W.y - zTop },
                ])}
                fill={pal.top}
                stroke="#8b95a1"
                strokeWidth={strokeW}
              />
            </g>,
          );
        }
        const roof = iso(m.x + s / 2, m.y + s / 2);
        const h = stack * (LH + SLAB_GAP);
        return (
          <g key={m.id}>
            {slabs}
            {!compact ? (
              <text
                x={roof.x}
                y={roof.y - h + HH * 0.38 * s}
                textAnchor="middle"
                fontSize={fontSize}
                fontFamily="ui-monospace, monospace"
                fontWeight={700}
                fill="#3d4654"
                letterSpacing="0.06em"
              >
                {m.id}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}
