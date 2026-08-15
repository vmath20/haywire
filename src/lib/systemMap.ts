/**
 * System-map spec: an LLM-organized, isometric "city" view of a repository.
 * The spec is produced by /api/map from the code knowledge graph and rendered
 * by the IsoScene SVG renderer.
 */

export type MapModule = {
  /** Short 1–3 char code shown on the building, e.g. "CM". */
  id: string;
  name: string;
  /** Category id from SystemMapSpec.categories. */
  category: string;
  /** Plain-language description (WHAT IT DOES). */
  what: string;
  /** Implementation notes (HOW IT'S BUILT). */
  how: string;
  /** Cited source files, repo-relative. */
  files: string[];
  /** Building height in slabs, 1–6. */
  stack: number;
  /** Footprint in grid cells, 1–2. */
  size: number;
  x: number;
  y: number;
};

export type FlowStep = {
  from: string;
  to: string;
  kind?: "flow" | "retry" | "feedback";
};

export type MapFlow = {
  id: string;
  name: string;
  /** Arrow-style summary, e.g. "Candidate → evaluation → next generation". */
  tagline: string;
  what: string;
  /** Payload passed along the flow, e.g. "GenerationContext". */
  payload: string;
  sources: string[];
  steps: FlowStep[];
};

export type SystemMapSpec = {
  owner: string;
  repo: string;
  /** Editorial title, e.g. "The Evolution Harness". */
  title: string;
  tagline: string;
  what: string;
  how: string;
  categories: { id: string; label: string }[];
  modules: MapModule[];
  flows: MapFlow[];
  stats: { label: string; value: string }[];
  generatedAt: number;
  model?: string;
};

export const MAP_GRID_W = 13;
export const MAP_GRID_H = 11;

function clampInt(n: unknown, lo: number, hi: number, fallback: number): number {
  const v = typeof n === "number" && Number.isFinite(n) ? Math.round(n) : fallback;
  return Math.max(lo, Math.min(hi, v));
}

function asString(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v.trim() : fallback;
}

function asStringArray(v: unknown, max = 8): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
    .map((s) => s.trim())
    .slice(0, max);
}

/**
 * Validate and repair a raw LLM-produced spec: clamp coordinates, resolve
 * grid collisions, drop steps that reference unknown modules, and guarantee
 * every module has a valid category.
 */
export function normalizeSpec(
  raw: unknown,
  owner: string,
  repo: string,
  model?: string,
): SystemMapSpec {
  const r = (raw ?? {}) as Record<string, unknown>;

  const categoriesRaw = Array.isArray(r.categories) ? r.categories : [];
  const categories: { id: string; label: string }[] = [];
  const catIds = new Set<string>();
  for (const c of categoriesRaw) {
    const obj = (c ?? {}) as Record<string, unknown>;
    const id = asString(obj.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const label = asString(obj.label);
    if (!id || !label || catIds.has(id)) continue;
    catIds.add(id);
    categories.push({ id, label });
    if (categories.length >= 5) break;
  }
  if (categories.length === 0) {
    categories.push({ id: "system", label: "The system" });
    catIds.add("system");
  }

  const modulesRaw = Array.isArray(r.modules) ? r.modules : [];
  const modules: MapModule[] = [];
  const usedIds = new Set<string>();
  const usedCells = new Set<string>();

  const cellsFree = (x: number, y: number, size: number): boolean => {
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        if (usedCells.has(`${x + dx},${y + dy}`)) return false;
      }
    }
    return true;
  };
  // Claim the footprint plus a 1-cell halo so buildings never touch and
  // labels stay readable.
  const claimCells = (x: number, y: number, size: number) => {
    for (let dx = -1; dx <= size; dx++) {
      for (let dy = -1; dy <= size; dy++) {
        usedCells.add(`${x + dx},${y + dy}`);
      }
    }
  };
  /** Nudge to the nearest free spot (spiral search). */
  const placeNear = (x: number, y: number, size: number): { x: number; y: number } => {
    for (let radius = 0; radius < Math.max(MAP_GRID_W, MAP_GRID_H); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const nx = clampInt(x + dx, 0, MAP_GRID_W - size, 0);
          const ny = clampInt(y + dy, 0, MAP_GRID_H - size, 0);
          if (cellsFree(nx, ny, size)) return { x: nx, y: ny };
        }
      }
    }
    return { x: 0, y: 0 };
  };

  for (const m of modulesRaw) {
    const obj = (m ?? {}) as Record<string, unknown>;
    let id = asString(obj.id).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 3);
    const name = asString(obj.name);
    if (!name) continue;
    if (!id) id = name.slice(0, 2).toUpperCase();
    while (usedIds.has(id)) id = `${id.slice(0, 2)}${modules.length}`;
    usedIds.add(id);

    let category = asString(obj.category).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    if (!catIds.has(category)) category = categories[0]!.id;

    const size = clampInt(obj.size, 1, 2, 1);
    const wantX = clampInt(obj.x, 0, MAP_GRID_W - size, Math.floor(Math.random() * MAP_GRID_W));
    const wantY = clampInt(obj.y, 0, MAP_GRID_H - size, Math.floor(Math.random() * MAP_GRID_H));
    const spot = cellsFree(wantX, wantY, size) ? { x: wantX, y: wantY } : placeNear(wantX, wantY, size);
    claimCells(spot.x, spot.y, size);

    modules.push({
      id,
      name,
      category,
      what: asString(obj.what, "No description available."),
      how: asString(obj.how, ""),
      files: asStringArray(obj.files),
      stack: clampInt(obj.stack, 1, 6, 2),
      size,
      x: spot.x,
      y: spot.y,
    });
    if (modules.length >= 16) break;
  }

  const moduleIds = new Set(modules.map((m) => m.id));
  const flowsRaw = Array.isArray(r.flows) ? r.flows : [];
  const flows: MapFlow[] = [];
  const flowIds = new Set<string>();
  for (const f of flowsRaw) {
    const obj = (f ?? {}) as Record<string, unknown>;
    let id = asString(obj.id).toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    const name = asString(obj.name);
    if (!name) continue;
    if (!id) id = name.toLowerCase().replace(/[^a-z0-9-]+/g, "-");
    if (flowIds.has(id)) continue;

    const stepsRaw = Array.isArray(obj.steps) ? obj.steps : [];
    const steps: FlowStep[] = [];
    for (const s of stepsRaw) {
      const so = (s ?? {}) as Record<string, unknown>;
      const from = asString(so.from).toUpperCase().replace(/[^A-Z0-9]/g, "");
      const to = asString(so.to).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (!moduleIds.has(from) || !moduleIds.has(to) || from === to) continue;
      const kindRaw = asString(so.kind);
      const kind: FlowStep["kind"] =
        kindRaw === "retry" || kindRaw === "feedback" ? kindRaw : "flow";
      steps.push({ from, to, kind });
      if (steps.length >= 10) break;
    }
    if (steps.length === 0) continue;

    flowIds.add(id);
    flows.push({
      id,
      name,
      tagline: asString(obj.tagline),
      what: asString(obj.what),
      payload: asString(obj.payload, "payload"),
      sources: asStringArray(obj.sources, 4),
      steps,
    });
    if (flows.length >= 5) break;
  }

  const statsRaw = Array.isArray(r.stats) ? r.stats : [];
  const stats: { label: string; value: string }[] = [];
  for (const s of statsRaw) {
    const obj = (s ?? {}) as Record<string, unknown>;
    const label = asString(obj.label);
    const value = asString(obj.value);
    if (!label || !value) continue;
    stats.push({ label, value });
    if (stats.length >= 4) break;
  }

  return {
    owner,
    repo,
    title: asString(r.title, `${repo} system map`),
    tagline: asString(r.tagline),
    what: asString(r.what, "No overview generated."),
    how: asString(r.how, ""),
    categories,
    modules,
    flows,
    stats,
    generatedAt: Date.now(),
    model,
  };
}

/** Canonical in-app path for a repository system map. */
export function mapPath(owner: string, repo: string): string {
  return `/dashboard/map/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}
