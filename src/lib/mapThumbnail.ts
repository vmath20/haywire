/**
 * Isometric map preview: types + canvas JPEG for storage, SVG renderer for
 * recents cards and the sidebar (drawn from the saved layout, not a stub).
 */

import type { SystemMapSpec } from "@/lib/systemMap";

const HW = 22;
const HH = 11;
const LH = 6;
const SLAB_GAP = 1.4;

export type MapPreviewModule = {
  id: string;
  category: string;
  stack: number;
  size: number;
  x: number;
  y: number;
};

export type MapPreviewData = {
  categories: { id: string }[];
  modules: MapPreviewModule[];
  flows: { steps: { from: string; to: string }[] }[];
};

export const MAP_PREVIEW_PALETTES = [
  { top: "#f7ffe3", left: "#e7f3c2", right: "#d3e3a4" },
  { top: "#fbfcfd", left: "#eef1f5", right: "#e0e5eb" },
  { top: "#fff6ea", left: "#f3e6d4", right: "#e8d5bc" },
  { top: "#eef3ff", left: "#dfe7f5", right: "#d0dbeb" },
  { top: "#f6f6f7", left: "#ececee", right: "#e2e2e5" },
] as const;

export function previewPalette(category: string, categories: { id: string }[]) {
  const i = Math.max(0, categories.findIndex((c) => c.id === category));
  return MAP_PREVIEW_PALETTES[i % MAP_PREVIEW_PALETTES.length]!;
}

/** Compact layout from `maps.listMine` — never throws if fields are missing. */
export function previewFromListRow(row: {
  categoryIds?: string[] | null;
  buildings?: MapPreviewModule[] | null;
  flowSteps?: { from: string; to: string }[] | null;
}): MapPreviewData {
  return {
    categories: (row.categoryIds ?? []).map((id) => ({ id })),
    modules: row.buildings ?? [],
    flows: [{ steps: row.flowSteps ?? [] }],
  };
}

export function previewFromSpec(spec: SystemMapSpec): MapPreviewData {
  return {
    categories: spec.categories.map((c) => ({ id: c.id })),
    modules: spec.modules.map((m) => ({
      id: m.id,
      category: m.category,
      stack: m.stack,
      size: m.size,
      x: m.x,
      y: m.y,
    })),
    flows: spec.flows.map((f) => ({
      steps: f.steps.map((s) => ({ from: s.from, to: s.to })),
    })),
  };
}

/** Parse a saved SystemMapSpec JSON string into a compact preview. */
export function previewFromSpecJson(specJson: string): MapPreviewData | null {
  try {
    let raw: unknown = JSON.parse(specJson);
    if (typeof raw === "string") raw = JSON.parse(raw);
    const obj = (raw ?? {}) as {
      categories?: { id?: unknown }[];
      modules?: {
        id?: unknown;
        category?: unknown;
        stack?: unknown;
        size?: unknown;
        x?: unknown;
        y?: unknown;
      }[];
      flows?: { steps?: { from?: unknown; to?: unknown }[] }[];
    };
    const categories = (obj.categories ?? [])
      .map((c) => ({ id: String(c.id ?? "").trim() }))
      .filter((c) => c.id.length > 0);
    const modules = (obj.modules ?? [])
      .map((m) => ({
        id: String(m.id ?? "").trim(),
        category: String(m.category ?? "system").trim() || "system",
        stack: Math.max(1, Math.min(6, Math.round(Number(m.stack) || 2))),
        size: Math.max(1, Math.min(2, Math.round(Number(m.size) || 1))),
        x: Number(m.x) || 0,
        y: Number(m.y) || 0,
      }))
      .filter((m) => m.id.length > 0);
    if (modules.length === 0) return null;
    const flows = (obj.flows ?? [])
      .map((f) => ({
        steps: (f.steps ?? [])
          .map((s) => ({
            from: String(s.from ?? "").trim(),
            to: String(s.to ?? "").trim(),
          }))
          .filter((s) => s.from.length > 0 && s.to.length > 0),
      }))
      .filter((f) => f.steps.length > 0);
    return { categories, modules, flows };
  } catch {
    return null;
  }
}

function iso(gx: number, gy: number): { x: number; y: number } {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}

export function renderMapThumbnail(
  spec: SystemMapSpec,
  width = 480,
  height = 270,
): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, width, height);

  const modules = spec.modules;
  if (modules.length === 0) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "16px Helvetica, Arial, sans-serif";
    ctx.fillText("Empty map", 24, height / 2);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

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

  const pad = 28;
  const spanX = Math.max(1, maxX - minX);
  const spanY = Math.max(1, maxY - minY);
  const scale = Math.min((width - pad * 2) / spanX, (height - pad * 2) / spanY);
  const ox = (width - spanX * scale) / 2 - minX * scale;
  const oy = (height - spanY * scale) / 2 - minY * scale;

  const tx = (gx: number, gy: number, z = 0) => {
    const p = iso(gx, gy);
    return { x: p.x * scale + ox, y: (p.y - z) * scale + oy };
  };

  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  const byId = new Map(modules.map((m) => [m.id, m]));
  ctx.strokeStyle = "rgba(90, 154, 10, 0.55)";
  ctx.lineWidth = Math.max(1.2, 1.6 * scale);
  for (const flow of spec.flows.slice(0, 4)) {
    for (const step of flow.steps) {
      const a = byId.get(step.from);
      const b = byId.get(step.to);
      if (!a || !b) continue;
      const pa = tx(a.x + a.size / 2, a.y + a.size / 2);
      const pb = tx(b.x + b.size / 2, b.y + b.size / 2);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
  }

  const sorted = [...modules].sort((a, b) => a.x + a.y - (b.x + b.y));
  for (const m of sorted) {
    const pal = previewPalette(m.category, spec.categories);
    const s = m.size;
    const stroke = "#8b95a1";
    for (let i = 0; i < m.stack; i++) {
      const zBot = i * (LH + SLAB_GAP);
      const zTop = zBot + LH;
      const N = tx(m.x, m.y, zTop);
      const E = tx(m.x + s, m.y, zTop);
      const S = tx(m.x + s, m.y + s, zTop);
      const W = tx(m.x, m.y + s, zTop);
      const Eb = tx(m.x + s, m.y, zBot);
      const Sb = tx(m.x + s, m.y + s, zBot);
      const Wb = tx(m.x, m.y + s, zBot);

      ctx.beginPath();
      ctx.moveTo(W.x, W.y);
      ctx.lineTo(S.x, S.y);
      ctx.lineTo(Sb.x, Sb.y);
      ctx.lineTo(Wb.x, Wb.y);
      ctx.closePath();
      ctx.fillStyle = pal.left;
      ctx.fill();
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 0.7;
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(S.x, S.y);
      ctx.lineTo(E.x, E.y);
      ctx.lineTo(Eb.x, Eb.y);
      ctx.lineTo(Sb.x, Sb.y);
      ctx.closePath();
      ctx.fillStyle = pal.right;
      ctx.fill();
      ctx.stroke();

      ctx.beginPath();
      ctx.moveTo(N.x, N.y);
      ctx.lineTo(E.x, E.y);
      ctx.lineTo(S.x, S.y);
      ctx.lineTo(W.x, W.y);
      ctx.closePath();
      ctx.fillStyle = pal.top;
      ctx.fill();
      ctx.stroke();
    }

    const roof = tx(m.x + s / 2, m.y + s / 2, m.stack * (LH + SLAB_GAP));
    ctx.fillStyle = "#3d4654";
    ctx.font = `bold ${Math.max(8, 9.5 * scale)}px ui-monospace, monospace`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(m.id, roof.x, roof.y + 1);
  }

  return canvas.toDataURL("image/jpeg", 0.82);
}
