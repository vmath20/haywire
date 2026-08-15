"use client";

import type { ReactNode } from "react";
import { MAP_GRID_H, MAP_GRID_W } from "@/lib/systemMap";
import { previewPalette, type MapPreviewData } from "@/lib/mapThumbnail";

/** Same isometric metrics as IsoScene so thumbnails match the real map. */
const HW = 36;
const HH = 18;
const LH = 10;
const SLAB_GAP = 2;

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

  const pad = compact ? 36 : 72;
  const corners = [
    iso(0, 0),
    iso(MAP_GRID_W, 0),
    iso(0, MAP_GRID_H),
    iso(MAP_GRID_W, MAP_GRID_H),
  ];
  const minX = Math.min(...corners.map((c) => c.x)) - pad;
  const maxX = Math.max(...corners.map((c) => c.x)) + pad;
  const minY = Math.min(...corners.map((c) => c.y)) - pad - 6 * (LH + SLAB_GAP);
  const maxY = Math.max(...corners.map((c) => c.y)) + pad;

  const grid: ReactNode[] = [];
  for (let gx = 0; gx <= MAP_GRID_W; gx++) {
    const a = iso(gx, 0);
    const b = iso(gx, MAP_GRID_H);
    grid.push(
      <line
        key={`vx-${gx}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="#d5dbe3"
        strokeWidth={compact ? 0.8 : 1}
      />,
    );
  }
  for (let gy = 0; gy <= MAP_GRID_H; gy++) {
    const a = iso(0, gy);
    const b = iso(MAP_GRID_W, gy);
    grid.push(
      <line
        key={`hy-${gy}`}
        x1={a.x}
        y1={a.y}
        x2={b.x}
        y2={b.y}
        stroke="#d5dbe3"
        strokeWidth={compact ? 0.8 : 1}
      />,
    );
  }

  const byId = new Map(modules.map((m) => [m.id, m]));
  const sorted = [...modules].sort((a, b) => a.x + a.y - (b.x + b.y));

  return (
    <svg
      viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
      width="100%"
      height="100%"
      className={className}
      aria-hidden
      preserveAspectRatio="xMidYMid slice"
    >
      <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="#f3f4f6" />
      {grid}
      {flows.flatMap((flow, fi) =>
        (flow.steps ?? []).map((step, si) => {
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
              strokeWidth={compact ? 2 : 2.4}
              strokeOpacity={0.7}
            />
          );
        }),
      )}
      {sorted.map((m) => {
        const pal = previewPalette(m.category, categories);
        const s = Math.max(1, m.size);
        const stack = Math.max(1, m.stack);
        const slabs: ReactNode[] = [];
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
                stroke="#5c6775"
                strokeWidth={1}
              />
              <path
                d={pathOf([
                  { x: S.x, y: S.y - zTop },
                  { x: E.x, y: E.y - zTop },
                  { x: E.x, y: E.y - zBot },
                  { x: S.x, y: S.y - zBot },
                ])}
                fill={pal.right}
                stroke="#5c6775"
                strokeWidth={1}
              />
              <path
                d={pathOf([
                  { x: N.x, y: N.y - zTop },
                  { x: E.x, y: E.y - zTop },
                  { x: S.x, y: S.y - zTop },
                  { x: W.x, y: W.y - zTop },
                ])}
                fill={pal.top}
                stroke="#5c6775"
                strokeWidth={1}
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
                y={roof.y - h + HH * 0.4 * s}
                textAnchor="middle"
                fontSize={11}
                fontFamily="ui-monospace, monospace"
                fontWeight={700}
                fill="#0b0d10"
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
