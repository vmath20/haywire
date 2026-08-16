"use client";

import { useMemo, useState, type ReactNode } from "react";
import clsx from "clsx";

type View = "graph" | "map";

type DemoNode = {
  id: string;
  label: string;
  kind: "function" | "component" | "module";
  file: string;
  x: number;
  y: number;
  community: 0 | 1 | 2;
};

type DemoEdge = {
  from: string;
  to: string;
  relation: string;
  confidence: "EXTRACTED" | "INFERRED";
};

const GRAPH_NODES: DemoNode[] = [
  { id: "inbox", label: "InboxPage", kind: "component", file: "src/app/inbox/page.tsx", x: 88, y: 72, community: 0 },
  { id: "list", label: "MessageList", kind: "component", file: "src/components/MessageList.tsx", x: 268, y: 56, community: 0 },
  { id: "auth", label: "AuthGate", kind: "function", file: "src/lib/auth.ts", x: 88, y: 188, community: 2 },
  { id: "fetch", label: "fetchInbox", kind: "function", file: "src/lib/inbox.ts", x: 268, y: 176, community: 1 },
  { id: "send", label: "sendMail", kind: "function", file: "src/lib/send.ts", x: 448, y: 120, community: 1 },
  { id: "store", label: "ThreadStore", kind: "module", file: "src/lib/store.ts", x: 268, y: 292, community: 1 },
];

const GRAPH_EDGES: DemoEdge[] = [
  { from: "inbox", to: "list", relation: "renders", confidence: "EXTRACTED" },
  { from: "inbox", to: "auth", relation: "guards", confidence: "EXTRACTED" },
  { from: "list", to: "fetch", relation: "calls", confidence: "EXTRACTED" },
  { from: "list", to: "send", relation: "calls", confidence: "EXTRACTED" },
  { from: "fetch", to: "store", relation: "reads", confidence: "EXTRACTED" },
  { from: "send", to: "store", relation: "writes", confidence: "EXTRACTED" },
  { from: "auth", to: "fetch", relation: "scopes", confidence: "INFERRED" },
];

const COMMUNITY = ["#4E79A7", "#F28E2B", "#59A14F"] as const;
const COMMUNITY_NAME = ["UI", "Data", "Auth"] as const;

type MapBuilding = {
  id: string;
  code: string;
  name: string;
  what: string;
  files: string[];
  category: string;
  x: number;
  y: number;
  size: number;
  stack: number;
};

type MapFlow = { from: string; to: string; payload: string };

const MAP_CATEGORIES = [
  { id: "ui", label: "Interface" },
  { id: "core", label: "Runtime" },
  { id: "data", label: "Storage" },
] as const;

const MAP_BUILDINGS: MapBuilding[] = [
  {
    id: "inbox",
    code: "IN",
    name: "Inbox UI",
    what: "Screens that list threads and compose mail.",
    files: ["src/app/inbox/", "src/components/"],
    category: "ui",
    x: 1,
    y: 2,
    size: 2,
    stack: 3,
  },
  {
    id: "agent",
    code: "AG",
    name: "Agent",
    what: "Turns a user request into tool calls and a reply.",
    files: ["src/lib/agent.ts"],
    category: "core",
    x: 5,
    y: 2,
    size: 2,
    stack: 5,
  },
  {
    id: "tools",
    code: "TL",
    name: "Tools",
    what: "Send, search, and label mail on behalf of the agent.",
    files: ["src/lib/send.ts", "src/lib/inbox.ts"],
    category: "core",
    x: 9,
    y: 2,
    size: 2,
    stack: 3,
  },
  {
    id: "auth",
    code: "AU",
    name: "Auth",
    what: "Gates every request to the signed-in user.",
    files: ["src/lib/auth.ts"],
    category: "ui",
    x: 1,
    y: 6,
    size: 2,
    stack: 2,
  },
  {
    id: "store",
    code: "DB",
    name: "Store",
    what: "Persists threads, messages, and agent traces.",
    files: ["src/lib/store.ts"],
    category: "data",
    x: 5,
    y: 6,
    size: 2,
    stack: 2,
  },
];

const MAP_FLOWS: MapFlow[] = [
  { from: "inbox", to: "agent", payload: "UserPrompt" },
  { from: "agent", to: "tools", payload: "ToolCall" },
  { from: "tools", to: "store", payload: "Message" },
  { from: "inbox", to: "auth", payload: "Session" },
  { from: "agent", to: "store", payload: "Trace" },
];

const MAP_PALETTES = [
  { top: "#f7ffe3", left: "#e7f3c2", right: "#d3e3a4" },
  { top: "#eef3ff", left: "#dfe7f5", right: "#d0dbeb" },
  { top: "#fff6ea", left: "#f3e6d4", right: "#e8d5bc" },
] as const;

export function ProductExplainer() {
  const [view, setView] = useState<View>("graph");

  return (
    <section className="relative z-10 bg-white">
      <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-24">
        <p className="font-mono text-[11px] uppercase tracking-[0.28em] text-wire-mute">
          What Haywire is for
        </p>
        <h2 className="mt-3 max-w-3xl font-display text-3xl font-extrabold leading-[1.08] tracking-tight text-wire-ink sm:text-5xl">
          Two views of the same repo.
          <br />
          A graph of the code. A map of the system.
        </h2>
        <p className="mt-5 max-w-2xl text-base leading-relaxed text-wire-mute sm:text-lg">
          Haywire reads a GitHub repository and builds a knowledge graph from the
          actual AST — functions, classes, modules, and the calls that connect
          them. From that graph it also lays out an isometric system map: buildings
          for subsystems, streets for the payloads that move between them. Click
          around the toy inbox app below; a real repo works the same way.
        </p>

        <div className="mt-10 flex flex-wrap gap-2">
          <ViewTab active={view === "graph"} onClick={() => setView("graph")}>
            Knowledge graph
          </ViewTab>
          <ViewTab active={view === "map"} onClick={() => setView("map")}>
            System map
          </ViewTab>
        </div>

        <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(16rem,0.8fr)]">
          <div className="overflow-hidden border-2 border-wire-ink/15 bg-[#f7f8fa]">
            {view === "graph" ? <GraphDemo /> : <MapDemo />}
          </div>
          <aside className="border-2 border-wire-ink/15 bg-white p-5 sm:p-6">
            {view === "graph" ? <GraphCopy /> : <MapCopy />}
          </aside>
        </div>
      </div>
    </section>
  );
}

function ViewTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        "px-4 py-2 text-sm font-semibold transition border-2",
        active
          ? "border-wire-ink bg-wire-ink text-white"
          : "border-wire-ink/15 text-wire-ink hover:border-wire-ink",
      )}
    >
      {children}
    </button>
  );
}

function GraphCopy() {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-wire-mute">Graph</p>
      <h3 className="mt-2 font-display text-xl font-bold tracking-tight text-wire-ink">
        Every symbol, wired to what it actually calls
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-wire-mute">
        Nodes are functions, classes, and modules. Solid edges are extracted from
        the AST. Dashed edges are inferred. Color is community — UI, data, auth —
        so you can see the architecture before you open a file.
      </p>
      <ul className="mt-5 space-y-2 text-sm text-wire-ink">
        <li className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-wire-ink" />
          Click a node to see callers and callees
        </li>
        <li className="flex items-center gap-2">
          <span className="h-px w-5 bg-wire-ink" />
          Solid = EXTRACTED from source
        </li>
        <li className="flex items-center gap-2">
          <span className="h-px w-5 border-t border-dashed border-wire-ink" />
          Dashed = INFERRED link
        </li>
      </ul>
    </div>
  );
}

function MapCopy() {
  return (
    <div>
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-wire-mute">Map</p>
      <h3 className="mt-2 font-display text-xl font-bold tracking-tight text-wire-ink">
        The same repo as a city of subsystems
      </h3>
      <p className="mt-3 text-sm leading-relaxed text-wire-mute">
        Buildings are modules. Height is how much they do. Streets are real
        control and data paths — the payload that actually moves, not a guessed
        architecture diagram.
      </p>
      <ul className="mt-5 space-y-2 text-sm text-wire-ink">
        <li className="flex items-center gap-2">
          <span className="grid h-3 w-4 place-items-center text-[9px] font-bold leading-none">
            ▣
          </span>
          Click a building to read what it does
        </li>
        <li className="flex items-center gap-2">
          <span className="h-px w-5 bg-[#5a9a0a]" />
          Green streets = payload flow
        </li>
        <li className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 bg-[#f7ffe3] ring-1 ring-wire-mute" />
          Color = category (UI, runtime, storage)
        </li>
      </ul>
    </div>
  );
}

function GraphDemo() {
  const [selected, setSelected] = useState<string>("list");
  const byId = useMemo(() => new Map(GRAPH_NODES.map((n) => [n.id, n])), []);
  const node = byId.get(selected) ?? GRAPH_NODES[1]!;

  const related = GRAPH_EDGES.filter((e) => e.from === node.id || e.to === node.id);
  const lit = new Set<string>([node.id]);
  for (const e of related) {
    lit.add(e.from);
    lit.add(e.to);
  }

  return (
    <div className="flex h-full min-h-[22rem] flex-col">
      <svg
        viewBox="0 0 540 360"
        className="h-[22rem] w-full cursor-pointer sm:h-[26rem]"
        role="img"
        aria-label="Interactive knowledge graph of a toy inbox app. Click a node to inspect it."
      >
        {GRAPH_EDGES.map((e) => {
          const a = byId.get(e.from);
          const b = byId.get(e.to);
          if (!a || !b) return null;
          const active = e.from === node.id || e.to === node.id;
          return (
            <line
              key={`${e.from}-${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={active ? "#0b0d10" : "#c5ced8"}
              strokeWidth={active ? 2.2 : 1.2}
              strokeDasharray={e.confidence === "INFERRED" ? "5 4" : undefined}
              markerEnd={active ? "url(#hw-arrow-lit)" : "url(#hw-arrow)"}
            />
          );
        })}
        <defs>
          <marker id="hw-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#c5ced8" />
          </marker>
          <marker id="hw-arrow-lit" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#0b0d10" />
          </marker>
        </defs>
        {GRAPH_NODES.map((n) => {
          const color = COMMUNITY[n.community];
          const isSel = n.id === node.id;
          const isLit = lit.has(n.id);
          return (
            <g
              key={n.id}
              onClick={() => setSelected(n.id)}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  setSelected(n.id);
                }
              }}
            >
              {isSel ? (
                <circle cx={n.x} cy={n.y} r="22" fill="#b8ff3c" fillOpacity="0.45" />
              ) : null}
              <circle
                cx={n.x}
                cy={n.y}
                r={isSel ? 14 : 11}
                fill={color}
                stroke="#0b0d10"
                strokeWidth={isSel ? 2.4 : 1.4}
                opacity={isLit ? 1 : 0.38}
              />
              <text
                x={n.x}
                y={n.y + 28}
                textAnchor="middle"
                fontSize="12"
                fontWeight={isSel ? 700 : 500}
                fill={isLit ? "#0b0d10" : "#8a93a0"}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="border-t border-wire-ink/10 bg-white px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-base font-bold text-wire-ink">{node.label}</p>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-wire-mute">
            {COMMUNITY_NAME[node.community]} · {node.kind}
          </p>
        </div>
        <p className="mt-1 font-mono text-xs text-wire-mute">{node.file}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-wire-ink">
          {related.map((e) => {
            const otherId = e.from === node.id ? e.to : e.from;
            const other = byId.get(otherId);
            const dir = e.from === node.id ? "calls" : "called by";
            return (
              <li key={`${e.from}-${e.to}`}>
                <button
                  type="button"
                  onClick={() => setSelected(otherId)}
                  className="underline decoration-wire-signal decoration-2 underline-offset-2 hover:decoration-wire-ember"
                >
                  {dir} {other?.label}
                </button>
                <span className="text-wire-mute"> · {e.relation}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

const HW = 28;
const HH = 14;
const LH = 8;
const SLAB_GAP = 2;

function iso(gx: number, gy: number) {
  return { x: (gx - gy) * HW, y: (gx + gy) * HH };
}

function pathOf(pts: { x: number; y: number }[]) {
  return pts.map((p, i) => `${i === 0 ? "M" : "L"} ${p.x} ${p.y}`).join(" ") + " Z";
}

function MapDemo() {
  const [selected, setSelected] = useState<string>("agent");
  const byId = useMemo(() => new Map(MAP_BUILDINGS.map((b) => [b.id, b])), []);
  const building = byId.get(selected) ?? MAP_BUILDINGS[1]!;
  const relatedFlows = MAP_FLOWS.filter((f) => f.from === building.id || f.to === building.id);
  const lit = new Set<string>([building.id]);
  for (const f of relatedFlows) {
    lit.add(f.from);
    lit.add(f.to);
  }

  const pad = 48;
  const GRID_W = 12;
  const GRID_H = 9;
  const corners = [iso(0, 0), iso(GRID_W, 0), iso(0, GRID_H), iso(GRID_W, GRID_H)];
  const minX = Math.min(...corners.map((c) => c.x)) - pad;
  const maxX = Math.max(...corners.map((c) => c.x)) + pad;
  const minY = Math.min(...corners.map((c) => c.y)) - pad - 6 * (LH + SLAB_GAP);
  const maxY = Math.max(...corners.map((c) => c.y)) + pad;

  const grid: ReactNode[] = [];
  for (let gx = 0; gx <= GRID_W; gx++) {
    const a = iso(gx, 0);
    const b = iso(gx, GRID_H);
    grid.push(
      <line key={`vx-${gx}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d5dbe3" strokeWidth={1} />,
    );
  }
  for (let gy = 0; gy <= GRID_H; gy++) {
    const a = iso(0, gy);
    const b = iso(GRID_W, gy);
    grid.push(
      <line key={`hy-${gy}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d5dbe3" strokeWidth={1} />,
    );
  }

  const sorted = [...MAP_BUILDINGS].sort((a, b) => a.x + a.y - (b.x + b.y));

  return (
    <div className="flex h-full min-h-[22rem] flex-col">
      <svg
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        className="h-[22rem] w-full sm:h-[26rem]"
        role="img"
        aria-label="Interactive isometric system map of a toy inbox app. Click a building to inspect it."
      >
        <rect x={minX} y={minY} width={maxX - minX} height={maxY - minY} fill="#f3f4f6" />
        {grid}
        {MAP_FLOWS.map((flow) => {
          const a = byId.get(flow.from);
          const b = byId.get(flow.to);
          if (!a || !b) return null;
          const pa = iso(a.x + a.size / 2, a.y + a.size / 2);
          const pb = iso(b.x + b.size / 2, b.y + b.size / 2);
          const active = flow.from === building.id || flow.to === building.id;
          return (
            <line
              key={`${flow.from}-${flow.to}`}
              x1={pa.x}
              y1={pa.y}
              x2={pb.x}
              y2={pb.y}
              stroke="#5a9a0a"
              strokeWidth={active ? 3 : 2}
              strokeOpacity={active ? 0.95 : 0.28}
            />
          );
        })}
        {sorted.map((m) => {
          const palIndex = Math.max(
            0,
            MAP_CATEGORIES.findIndex((c) => c.id === m.category),
          );
          const pal = MAP_PALETTES[palIndex % MAP_PALETTES.length]!;
          const isSel = m.id === building.id;
          const isLit = lit.has(m.id);
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
                  stroke="#5c6775"
                  strokeWidth={isSel ? 1.6 : 1}
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
                  strokeWidth={isSel ? 1.6 : 1}
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
                  strokeWidth={isSel ? 1.6 : 1}
                />
              </g>,
            );
          }
          const roof = iso(m.x + s / 2, m.y + s / 2);
          const h = m.stack * (LH + SLAB_GAP);
          return (
            <g
              key={m.id}
              onClick={() => setSelected(m.id)}
              className="cursor-pointer"
              opacity={isLit ? 1 : 0.4}
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  setSelected(m.id);
                }
              }}
            >
              {isSel ? (
                <ellipse
                  cx={roof.x}
                  cy={roof.y + 8}
                  rx={HW * s * 0.85}
                  ry={HH * s * 0.7}
                  fill="#b8ff3c"
                  fillOpacity="0.35"
                />
              ) : null}
              {slabs}
              <text
                x={roof.x}
                y={roof.y - h + HH * 0.35 * s}
                textAnchor="middle"
                fontSize={12}
                fontWeight={700}
                fill="#0b0d10"
              >
                {m.code}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="border-t border-wire-ink/10 bg-white px-4 py-3 sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-base font-bold text-wire-ink">{building.name}</p>
          <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-wire-mute">
            {MAP_CATEGORIES.find((c) => c.id === building.category)?.label}
          </p>
        </div>
        <p className="mt-1 text-sm text-wire-mute">{building.what}</p>
        <p className="mt-1 font-mono text-xs text-wire-mute">{building.files.join(" · ")}</p>
        {relatedFlows.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-wire-ink">
            {relatedFlows.map((f) => {
              const otherId = f.from === building.id ? f.to : f.from;
              const other = byId.get(otherId);
              const dir = f.from === building.id ? "sends" : "receives";
              return (
                <li key={`${f.from}-${f.to}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(otherId)}
                    className="underline decoration-wire-signal decoration-2 underline-offset-2 hover:decoration-wire-ember"
                  >
                    {dir} {f.payload} {dir === "sends" ? "to" : "from"} {other?.name}
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
    </div>
  );
}
