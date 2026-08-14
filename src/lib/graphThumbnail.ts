import type { AnalyzeResult, KnowledgeGraph } from "@/lib/types";
import { COMMUNITY_COLORS } from "@/lib/types";

/** Draw a lightweight graph preview to a JPEG data URL (no vis-network required). */
export function renderGraphThumbnail(
  graph: KnowledgeGraph,
  width = 640,
  height = 360,
): string | null {
  if (typeof document === "undefined") return null;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  ctx.fillStyle = "#f3f4f6";
  ctx.fillRect(0, 0, width, height);

  const nodes = graph.nodes.slice(0, 180);
  const nodeIds = new Set(nodes.map((n) => n.id));
  const links = graph.links
    .filter((e) => nodeIds.has(e.source) && nodeIds.has(e.target))
    .slice(0, 400);

  if (nodes.length === 0) {
    ctx.fillStyle = "#9ca3af";
    ctx.font = "16px Helvetica, Arial, sans-serif";
    ctx.fillText("Empty graph", 24, height / 2);
    return canvas.toDataURL("image/jpeg", 0.82);
  }

  const communities = new Map<number, typeof nodes>();
  for (const n of nodes) {
    const c = n.community ?? 0;
    const list = communities.get(c) ?? [];
    list.push(n);
    communities.set(c, list);
  }

  const cx = width / 2;
  const cy = height / 2;
  const positions = new Map<string, { x: number; y: number }>();
  const communityIds = [...communities.keys()];
  const ringR = Math.min(width, height) * 0.32;

  communityIds.forEach((cid, i) => {
    const members = communities.get(cid)!;
    const angle = (i / Math.max(communityIds.length, 1)) * Math.PI * 2;
    const groupX = cx + Math.cos(angle) * ringR * 0.55;
    const groupY = cy + Math.sin(angle) * ringR * 0.55;
    const localR = 18 + Math.min(56, members.length * 2.2);
    members.forEach((n, j) => {
      const a = (j / Math.max(members.length, 1)) * Math.PI * 2;
      positions.set(n.id, {
        x: groupX + Math.cos(a) * localR,
        y: groupY + Math.sin(a) * localR,
      });
    });
  });

  ctx.lineWidth = 1;
  for (const e of links) {
    const a = positions.get(e.source);
    const b = positions.get(e.target);
    if (!a || !b) continue;
    const conf = (e.confidence || "EXTRACTED").toUpperCase();
    ctx.strokeStyle =
      conf === "INFERRED" ? "rgba(13,148,136,0.35)" : "rgba(11,13,16,0.18)";
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  for (const n of nodes) {
    const p = positions.get(n.id);
    if (!p) continue;
    const c = n.community ?? 0;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 3.2, 0, Math.PI * 2);
    ctx.fillStyle = COMMUNITY_COLORS[c % COMMUNITY_COLORS.length];
    ctx.fill();
    ctx.strokeStyle = "rgba(11,13,16,0.35)";
    ctx.stroke();
  }

  return canvas.toDataURL("image/jpeg", 0.82);
}

export function dataUrlToBlob(dataUrl: string): Blob {
  const [header, data] = dataUrl.split(",");
  const mime = /data:(.*?);base64/.exec(header)?.[1] || "image/jpeg";
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function analyzeResultToBlob(result: AnalyzeResult): Blob {
  return new Blob([JSON.stringify(result)], { type: "application/json" });
}
