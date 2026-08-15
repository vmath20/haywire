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
  /** Bump when the automatic avenue layout changes so saved maps can be relaid. */
  layoutVersion?: number;
};

export const MAP_GRID_W = 16;
export const MAP_GRID_H = 12;
export const MAX_MODULES = 16;
export const LAYOUT_VERSION = 2;

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

export function cellKey(x: number, y: number): string {
  return `${x},${y}`;
}

/** True when `id` can sit at (x, y) without overlapping another footprint. */
export function moduleFits(
  modules: MapModule[],
  id: string,
  x: number,
  y: number,
): boolean {
  const moving = modules.find((m) => m.id === id);
  if (!moving) return false;
  if (x < 0 || y < 0 || x + moving.size > MAP_GRID_W || y + moving.size > MAP_GRID_H) {
    return false;
  }
  for (const m of modules) {
    if (m.id === id) continue;
    if (x < m.x + m.size && x + moving.size > m.x && y < m.y + m.size && y + moving.size > m.y) {
      return false;
    }
  }
  return true;
}

/** Spiral out from a desired cell until the module fits. */
export function nearestFree(
  modules: MapModule[],
  id: string,
  x: number,
  y: number,
): { x: number; y: number } {
  const moving = modules.find((m) => m.id === id);
  if (!moving) return { x: 0, y: 0 };
  const cx = clampInt(x, 0, MAP_GRID_W - moving.size, 0);
  const cy = clampInt(y, 0, MAP_GRID_H - moving.size, 0);
  if (moduleFits(modules, id, cx, cy)) return { x: cx, y: cy };
  for (let radius = 1; radius < Math.max(MAP_GRID_W, MAP_GRID_H); radius++) {
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
        const nx = clampInt(cx + dx, 0, MAP_GRID_W - moving.size, 0);
        const ny = clampInt(cy + dy, 0, MAP_GRID_H - moving.size, 0);
        if (moduleFits(modules, id, nx, ny)) return { x: nx, y: ny };
      }
    }
  }
  return { x: cx, y: cy };
}

export function moveModule(
  modules: MapModule[],
  id: string,
  x: number,
  y: number,
): MapModule[] {
  const spot = nearestFree(modules, id, x, y);
  return modules.map((m) => (m.id === id ? { ...m, x: spot.x, y: spot.y } : m));
}

/**
 * Place modules so the primary runtime flow is a readable avenue:
 * entry on the left, processing down the middle, outputs on the right.
 * Supporting modules sit on side streets next to the neighbor they talk to.
 */
export function layoutByFlow(modules: MapModule[], flows: MapFlow[]): MapModule[] {
  if (modules.length === 0) return modules;

  const byId = new Map(modules.map((m) => [m.id, m]));
  const pos = new Map<string, { x: number; y: number }>();
  const used = new Set<string>();

  const footprintFree = (x: number, y: number, size: number): boolean => {
    if (x < 0 || y < 0 || x + size > MAP_GRID_W || y + size > MAP_GRID_H) return false;
    for (let dx = -1; dx <= size; dx++) {
      for (let dy = -1; dy <= size; dy++) {
        const cx = x + dx;
        const cy = y + dy;
        if (cx < 0 || cy < 0 || cx >= MAP_GRID_W || cy >= MAP_GRID_H) continue;
        if (dx >= 0 && dx < size && dy >= 0 && dy < size) {
          if (used.has(cellKey(cx, cy))) return false;
        } else if (used.has(cellKey(cx, cy))) {
          // halo: allow touching the map edge, but not another building
          return false;
        }
      }
    }
    return true;
  };

  const claim = (x: number, y: number, size: number) => {
    for (let dx = 0; dx < size; dx++) {
      for (let dy = 0; dy < size; dy++) {
        used.add(cellKey(x + dx, y + dy));
      }
    }
  };

  const spiralFrom = (x: number, y: number, size: number): { x: number; y: number } | null => {
    const sx = clampInt(x, 0, MAP_GRID_W - size, 0);
    const sy = clampInt(y, 0, MAP_GRID_H - size, 0);
    if (footprintFree(sx, sy, size)) return { x: sx, y: sy };
    for (let radius = 1; radius < Math.max(MAP_GRID_W, MAP_GRID_H); radius++) {
      for (let dx = -radius; dx <= radius; dx++) {
        for (let dy = -radius; dy <= radius; dy++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue;
          const nx = clampInt(sx + dx, 0, MAP_GRID_W - size, 0);
          const ny = clampInt(sy + dy, 0, MAP_GRID_H - size, 0);
          if (footprintFree(nx, ny, size)) return { x: nx, y: ny };
        }
      }
    }
    return null;
  };

  const place = (id: string, x: number, y: number) => {
    const m = byId.get(id);
    if (!m || pos.has(id)) return;
    const spot = spiralFrom(x, y, m.size);
    if (!spot) return;
    pos.set(id, spot);
    claim(spot.x, spot.y, m.size);
  };

  const neighbors = new Map<string, Set<string>>();
  const addEdge = (a: string, b: string) => {
    if (!neighbors.has(a)) neighbors.set(a, new Set());
    if (!neighbors.has(b)) neighbors.set(b, new Set());
    neighbors.get(a)!.add(b);
    neighbors.get(b)!.add(a);
  };
  for (const f of flows) {
    for (const s of f.steps) addEdge(s.from, s.to);
  }

  const spineFlow = [...flows].sort((a, b) => b.steps.length - a.steps.length)[0];
  const spine: string[] = [];
  if (spineFlow) {
    for (const s of spineFlow.steps) {
      if (byId.has(s.from) && !spine.includes(s.from)) spine.push(s.from);
      if (byId.has(s.to) && !spine.includes(s.to)) spine.push(s.to);
    }
  }
  if (spine.length === 0) {
    for (const m of modules) spine.push(m.id);
  }

  let avenueY = Math.max(2, Math.floor(MAP_GRID_H / 2) - 1);
  const gap = 2;
  let cursorX = 1;
  for (let i = 0; i < spine.length; i++) {
    const m = byId.get(spine[i]!);
    if (!m || pos.has(m.id)) continue;
    const y = avenueY + (i % 2 === 0 ? 0 : 1);
    place(m.id, cursorX, y);
    cursorX += m.size + gap;
    if (cursorX > MAP_GRID_W - 3) {
      cursorX = 1;
      avenueY = Math.min(avenueY + 4, MAP_GRID_H - 3);
    }
  }

  const rest = modules
    .filter((m) => !pos.has(m.id))
    .sort((a, b) => {
      const an = [...(neighbors.get(a.id) ?? [])].filter((id) => pos.has(id)).length;
      const bn = [...(neighbors.get(b.id) ?? [])].filter((id) => pos.has(id)).length;
      return bn - an;
    });

  for (const m of rest) {
    const placedNeighbors = [...(neighbors.get(m.id) ?? [])]
      .map((id) => pos.get(id))
      .filter((p): p is { x: number; y: number } => !!p);
    const anchor = placedNeighbors[0] ?? { x: Math.floor(MAP_GRID_W / 2), y: avenueY };
    place(m.id, anchor.x, anchor.y - 3);
    if (!pos.has(m.id)) place(m.id, anchor.x, anchor.y + 3);
    if (!pos.has(m.id)) place(m.id, anchor.x + 3, anchor.y);
  }

  // Last pass: shrink leftovers to 1×1 and pack into remaining cells.
  // Anything that still does not fit is dropped so the city never overflows
  // the 16×12 grid.
  for (const m of modules) {
    if (pos.has(m.id)) continue;
    if (m.size > 1) {
      byId.set(m.id, { ...m, size: 1 });
      const spot = spiralFrom(1, 1, 1);
      if (spot) {
        pos.set(m.id, spot);
        claim(spot.x, spot.y, 1);
      }
    }
  }

  return modules
    .filter((m) => pos.has(m.id))
    .map((m) => {
      const p = pos.get(m.id)!;
      const sized = byId.get(m.id) ?? m;
      return { ...m, x: p.x, y: p.y, size: sized.size };
    });
}

export type NormalizeOptions = {
  /** Keep saved x/y; only unstick exact overlaps. Used when loading a map. */
  preserveLayout?: boolean;
  /** After validating, arrange modules along the primary flow avenue. */
  relayout?: boolean;
};

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
  options?: NormalizeOptions,
): SystemMapSpec {
  const preserveLayout = options?.preserveLayout === true;
  const relayout = options?.relayout === true;
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
        if (usedCells.has(cellKey(x + dx, y + dy))) return false;
      }
    }
    return true;
  };
  const claimCells = (x: number, y: number, size: number) => {
    const halo = preserveLayout ? 0 : 1;
    for (let dx = -halo; dx < size + halo; dx++) {
      for (let dy = -halo; dy < size + halo; dy++) {
        if (halo === 0 && (dx < 0 || dy < 0 || dx >= size || dy >= size)) continue;
        usedCells.add(cellKey(x + dx, y + dy));
      }
    }
  };
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
    const wantX = clampInt(obj.x, 0, MAP_GRID_W - size, 1);
    const wantY = clampInt(obj.y, 0, MAP_GRID_H - size, 1);
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
    if (modules.length >= MAX_MODULES) break;
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

  const laidOut = relayout ? layoutByFlow(modules, flows) : modules;
  const keptIds = new Set(laidOut.map((m) => m.id));
  const prunedFlows = flows
    .map((f) => ({
      ...f,
      steps: f.steps.filter((s) => keptIds.has(s.from) && keptIds.has(s.to)),
    }))
    .filter((f) => f.steps.length > 0);

  return {
    owner,
    repo,
    title: asString(r.title, `${repo} system map`),
    tagline: asString(r.tagline),
    what: asString(r.what, "No overview generated."),
    how: asString(r.how, ""),
    categories,
    modules: laidOut,
    flows: prunedFlows,
    stats,
    generatedAt: typeof r.generatedAt === "number" ? r.generatedAt : Date.now(),
    model,
    layoutVersion: relayout
      ? LAYOUT_VERSION
      : typeof r.layoutVersion === "number"
        ? r.layoutVersion
        : undefined,
  };
}

/** Canonical in-app path for a repository system map. */
export function mapPath(owner: string, repo: string): string {
  return `/dashboard/map/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
}
