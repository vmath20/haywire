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
  if (!data || data.modules.length === 0) {
    return (
      <div className={className} style={{ background: "#f3f4f6" }} aria-hidden />
    );
  }

  const modules = data.modules;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const m of modules) {
    const s = m.size;
    const h = m.stack * (LH + SLAB_GAP);
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

  const pad = compact ? 18 : 36;
  const vbX = minX - pad;
  const vbY = minY - pad;
  const vbW = Math.max(1, maxX - minX + pad * 2);
  const vbH = Math.max(1, maxY - minY + pad * 2);
  const byId = new Map(modules.map((m) => [m.id, m]));
  const sorted = [...modules].sort((a, b) => a.x + a.y - (b.x + b.y));
  const strokeW = compact ? 0.9 : 0.8;
  const fontSize = compact ? 7 : 9;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${vbW} ${vbH}`}
      className={className}
      style={{ display: "block", width: "100%", height: "100%" }}
      aria-hidden
      preserveAspectRatio="xMidYMid meet"
    >
      <rect x={vbX} y={vbY} width={vbW} height={vbH} fill="#f3f4f6" />
      {data.flows.slice(0, 4).flatMap((flow, fi) =>
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
              strokeWidth={compact ? 1.4 : 1.8}
              strokeOpacity={0.55}
            />
          );
        }),
      )}
      {sorted.map((m) => {
        const pal = previewPalette(m.category, data.categories);
        const s = m.size;
        const slabs: ReactNode[] = [];
        for (let i = 0; i < m.stack; i++) {
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
        const h = m.stack * (LH + SLAB_GAP);
        return (
          <g key={m.id}>
            {slabs}
            {!compact ? (
              <text
                x={roof.x}
                y={roof.y - h + HH * 0.35 * s}
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
