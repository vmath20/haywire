"use client";

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { ArrowUpRight, Github } from "lucide-react";

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
  { id: "inbox", label: "InboxPage", kind: "component", file: "src/app/inbox/page.tsx", x: 92, y: 78, community: 0 },
  { id: "list", label: "MessageList", kind: "component", file: "src/components/MessageList.tsx", x: 270, y: 58, community: 0 },
  { id: "auth", label: "AuthGate", kind: "function", file: "src/lib/auth.ts", x: 92, y: 198, community: 2 },
  { id: "fetch", label: "fetchInbox", kind: "function", file: "src/lib/inbox.ts", x: 270, y: 186, community: 1 },
  { id: "send", label: "sendMail", kind: "function", file: "src/lib/send.ts", x: 448, y: 128, community: 1 },
  { id: "store", label: "ThreadStore", kind: "module", file: "src/lib/store.ts", x: 270, y: 300, community: 1 },
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

const WHY = [
  {
    title: "Blast radius, not grep.",
    body: "A search finds a name. A graph finds every path that can reach it — including the callers named something else. Rename fetchInbox and see the three components that break before you touch a file.",
    visual: "blast" as const,
  },
  {
    title: "Architecture as it runs.",
    body: "Folder trees are where files live. Communities cluster by how code actually talks. Auth is whatever guards a request, not a directory called auth/.",
    visual: "community" as const,
  },
  {
    title: "The tour a README can't give.",
    body: "A map is how a new hire — or an agent — learns a repo in minutes: which modules own a flow, which buildings are load-bearing, which streets carry the real payload.",
    visual: "map" as const,
  },
  {
    title: "Proven edges vs guesses.",
    body: "Solid lines are EXTRACTED from the AST. Dashed lines are INFERRED. You always know what the compiler saw versus what Haywire filled in.",
    visual: "edges" as const,
  },
  {
    title: "God nodes, in plain sight.",
    body: "High-degree hubs light up. That's the file everyone is afraid to touch, visualized — the one change that ripples through the city.",
    visual: "hub" as const,
  },
  {
    title: "Agents that don't wander.",
    body: "Haywire's MCP lets coding agents query symbols, callers, and paths instead of stuffing the whole repository into context and hoping.",
    visual: "mcp" as const,
  },
];

const STEPS = [
  {
    n: "01",
    title: "Paste a repo",
    body: "A GitHub URL or owner/repo. Public source is enough — no IDE plugin, no local index to babysit.",
  },
  {
    n: "02",
    title: "Read the AST",
    body: "Tree-sitter walks the code. Functions, classes, modules, and calls become nodes and edges. No LLM inventing the graph.",
  },
  {
    n: "03",
    title: "Graph, then map",
    body: "Explore the knowledge graph, or step back to the isometric city — same truth, two distances. Query it from the app or over MCP.",
  },
];

export function ProductExplainer() {
  return (
    <div className="relative z-10 bg-black text-white">
      <section id="graph-and-map" className="scroll-mt-20 px-4 pt-24 sm:px-6 sm:pt-32">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-3xl font-display text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
            Graph the code.
            <br />
            Map the system.
          </h2>
          <p className="mt-6 max-w-xl text-[17px] leading-[1.6] text-[#999]">
            Haywire reads a GitHub repository and builds two views of the same
            truth: a knowledge graph of every symbol and call, and an isometric
            map of the subsystems those calls travel through. Click the toy
            inbox below — a real repo works the same way.
          </p>
        </div>
      </section>

      <section className="px-4 pt-14 pb-8 sm:px-6 sm:pt-16">
        <div className="mx-auto grid max-w-6xl gap-3 lg:grid-cols-2">
          <article className="flex min-h-[28rem] flex-col overflow-hidden rounded-[28px] bg-wire-signal p-3 sm:p-4">
            <GraphDemo />
          </article>
          <article className="flex min-h-[28rem] flex-col overflow-hidden rounded-[28px] bg-[#f3efe6] p-3 sm:p-4">
            <MapDemo />
          </article>
        </div>
        <div className="mx-auto mt-10 grid max-w-6xl gap-10 px-1 lg:grid-cols-2 lg:gap-16">
          <div>
            <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] sm:text-[28px]">
              Graph
            </h3>
            <p className="mt-3 text-[17px] leading-[1.6] text-[#999]">
              Nodes are functions, classes, and modules. Solid edges are extracted
              from the AST; dashed edges are inferred. Color is community — UI,
              data, auth — so you see the architecture before you open a file.
              Click a node to follow callers and callees.
            </p>
          </div>
          <div>
            <h3 className="font-display text-2xl font-semibold tracking-[-0.03em] sm:text-[28px]">
              Map
            </h3>
            <p className="mt-3 text-[17px] leading-[1.6] text-[#999]">
              Buildings are modules. Height is how much they do. Streets are real
              control and data paths — the payload that actually moves, not a
              guessed architecture diagram. Click a building to see what it owns
              and what it sends.
            </p>
          </div>
        </div>
      </section>

      <section id="why" className="scroll-mt-20 px-4 pt-24 pb-8 sm:px-6 sm:pt-36">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-3xl font-display text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
            Why graphs
            <br />
            and maps matter
          </h2>
          <p className="mt-6 max-w-xl text-[17px] leading-[1.6] text-[#999]">
            Codebases hide structure in names, folders, and folklore. Graphs make
            the wiring inspectable. Maps make the system legible. Together they
            answer the questions grep never will.
          </p>

          <div className="mt-14 grid grid-cols-1 gap-px overflow-hidden rounded-[24px] border border-white/10 bg-white/10 md:grid-cols-2 lg:grid-cols-3">
            {WHY.map((item) => (
              <article key={item.title} className="flex flex-col bg-black p-6 sm:p-8">
                <div className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-[#111113]">
                  <WhyVisual kind={item.visual} />
                </div>
                <p className="mt-6 text-[15px] leading-[1.65] text-[#a3a3a3]">
                  <span className="font-semibold text-white">{item.title} </span>
                  {item.body}
                </p>
              </article>
            ))}
          </div>
        </div>
      </section>

      <section id="how" className="scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-3xl font-display text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
            How it
            <br />
            actually works
          </h2>
          <div className="mt-16 grid gap-12 md:grid-cols-3 md:gap-8">
            {STEPS.map((step) => (
              <div key={step.n}>
                <p className="font-display text-sm font-semibold tracking-[0.18em] text-wire-signal">
                  {step.n}
                </p>
                <h3 className="mt-4 font-display text-2xl font-semibold tracking-[-0.03em]">
                  {step.title}
                </h3>
                <p className="mt-3 text-[17px] leading-[1.6] text-[#999]">{step.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden px-4 pt-10 pb-28 text-center sm:px-6 sm:pb-36">
        <h2 className="font-display text-[clamp(2.75rem,7vw,5rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
          See the wiring.
          <br />
          Then change it.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-[17px] leading-[1.6] text-[#999]">
          Paste a public GitHub repo and get a live graph and map — or star the
          project and run it yourself.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signin"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            Graph a repo
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <a
            href="https://github.com/vmath20/haywire"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:bg-white/10"
          >
            <Github className="h-4 w-4" />
            Star on GitHub
          </a>
        </div>
      </section>
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
    <div className="flex h-full min-h-[24rem] flex-1 flex-col overflow-hidden rounded-[20px] bg-[#0b0d10]/[0.06]">
      <svg
        viewBox="0 0 540 360"
        className="h-[18rem] w-full flex-1 cursor-pointer sm:h-[22rem]"
        role="img"
        aria-label="Interactive knowledge graph of a toy inbox app. Click a node to inspect it."
      >
        <defs>
          <marker id="hw-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#0b0d10" fillOpacity="0.28" />
          </marker>
          <marker id="hw-arrow-lit" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto">
            <polygon points="0 0, 7 3.5, 0 7" fill="#0b0d10" />
          </marker>
        </defs>
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
              stroke="#0b0d10"
              strokeOpacity={active ? 0.9 : 0.22}
              strokeWidth={active ? 2.2 : 1.2}
              strokeDasharray={e.confidence === "INFERRED" ? "5 4" : undefined}
              markerEnd={active ? "url(#hw-arrow-lit)" : "url(#hw-arrow)"}
            />
          );
        })}
        {GRAPH_NODES.map((n) => {
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
                <circle cx={n.x} cy={n.y} r="22" fill="#0b0d10" fillOpacity="0.12" />
              ) : null}
              <circle
                cx={n.x}
                cy={n.y}
                r={isSel ? 13 : 10}
                fill="#0b0d10"
                opacity={isLit ? 1 : 0.32}
              />
              <text
                x={n.x}
                y={n.y + 28}
                textAnchor="middle"
                fontSize="12"
                fontWeight={isSel ? 700 : 500}
                fill="#0b0d10"
                opacity={isLit ? 1 : 0.4}
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="m-2 mt-0 rounded-[16px] bg-black/90 px-4 py-3 text-white sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-base font-semibold tracking-tight">{node.label}</p>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
            {COMMUNITY_NAME[node.community]} · {node.kind}
          </p>
        </div>
        <p className="mt-1 font-mono text-xs text-white/45">{node.file}</p>
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
          {related.map((e) => {
            const otherId = e.from === node.id ? e.to : e.from;
            const other = byId.get(otherId);
            const dir = e.from === node.id ? "calls" : "called by";
            return (
              <li key={`${e.from}-${e.to}`}>
                <button
                  type="button"
                  onClick={() => setSelected(otherId)}
                  className="underline decoration-wire-signal decoration-2 underline-offset-2 hover:decoration-white"
                >
                  {dir} {other?.label}
                </button>
                <span className="text-white/40"> · {e.relation}</span>
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
    <div className="flex h-full min-h-[24rem] flex-1 flex-col overflow-hidden rounded-[20px] bg-[#ece8df]">
      <svg
        viewBox={`${minX} ${minY} ${maxX - minX} ${maxY - minY}`}
        className="h-[18rem] w-full flex-1 sm:h-[22rem]"
        role="img"
        aria-label="Interactive isometric system map of a toy inbox app. Click a building to inspect it."
      >
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
                  fillOpacity="0.45"
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

      <div className="m-2 mt-0 rounded-[16px] bg-black px-4 py-3 text-white sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-base font-semibold tracking-tight">{building.name}</p>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
            {MAP_CATEGORIES.find((c) => c.id === building.category)?.label}
          </p>
        </div>
        <p className="mt-1 text-sm text-white/65">{building.what}</p>
        <p className="mt-1 font-mono text-xs text-white/40">{building.files.join(" · ")}</p>
        {relatedFlows.length > 0 ? (
          <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {relatedFlows.map((f) => {
              const otherId = f.from === building.id ? f.to : f.from;
              const other = byId.get(otherId);
              const dir = f.from === building.id ? "sends" : "receives";
              return (
                <li key={`${f.from}-${f.to}`}>
                  <button
                    type="button"
                    onClick={() => setSelected(otherId)}
                    className="underline decoration-wire-signal decoration-2 underline-offset-2 hover:decoration-white"
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

function WhyVisual({ kind }: { kind: (typeof WHY)[number]["visual"] }) {
  if (kind === "blast") {
    return (
      <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
        <line x1="70" y1="120" x2="160" y2="120" stroke="#b8ff3c" strokeWidth="2" />
        <line x1="160" y1="120" x2="250" y2="58" stroke="#b8ff3c" strokeWidth="2" />
        <line x1="160" y1="120" x2="250" y2="120" stroke="#b8ff3c" strokeWidth="2" />
        <line x1="160" y1="120" x2="250" y2="182" stroke="#b8ff3c" strokeWidth="2" />
        <circle cx="70" cy="120" r="8" fill="#333" />
        <circle cx="160" cy="120" r="16" fill="#b8ff3c" />
        <circle cx="250" cy="58" r="9" fill="#fff" />
        <circle cx="250" cy="120" r="9" fill="#fff" />
        <circle cx="250" cy="182" r="9" fill="#fff" />
      </svg>
    );
  }
  if (kind === "community") {
    return (
      <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
        {[
          [70, 70, "#4E79A7"],
          [110, 95, "#4E79A7"],
          [80, 130, "#4E79A7"],
          [210, 80, "#F28E2B"],
          [250, 110, "#F28E2B"],
          [200, 140, "#F28E2B"],
          [140, 190, "#59A14F"],
          [180, 175, "#59A14F"],
        ].map(([x, y, fill], i) => (
          <circle key={i} cx={x} cy={y} r="11" fill={String(fill)} />
        ))}
      </svg>
    );
  }
  if (kind === "map") {
    return (
      <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
        <MiniBuilding x={70} y={140} h={50} fill="#e7f3c2" />
        <MiniBuilding x={140} y={150} h={90} fill="#dfe7f5" />
        <MiniBuilding x={210} y={145} h={40} fill="#f3e6d4" />
        <line x1="95" y1="150" x2="165" y2="120" stroke="#b8ff3c" strokeWidth="2" />
        <line x1="185" y1="120" x2="235" y2="155" stroke="#b8ff3c" strokeWidth="2" />
      </svg>
    );
  }
  if (kind === "edges") {
    return (
      <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
        <line x1="60" y1="80" x2="260" y2="80" stroke="#fff" strokeWidth="2.2" />
        <line
          x1="60"
          y1="150"
          x2="260"
          y2="150"
          stroke="#fff"
          strokeWidth="2.2"
          strokeDasharray="7 6"
          opacity="0.55"
        />
        <text x="60" y="64" fill="#b8ff3c" fontSize="11" fontWeight="700">
          EXTRACTED
        </text>
        <text x="60" y="134" fill="#999" fontSize="11" fontWeight="700">
          INFERRED
        </text>
      </svg>
    );
  }
  if (kind === "hub") {
    return (
      <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
        {Array.from({ length: 8 }, (_, i) => {
          const a = (i / 8) * Math.PI * 2;
          return (
            <g key={i}>
              <line
                x1="160"
                y1="120"
                x2={160 + Math.cos(a) * 88}
                y2={120 + Math.sin(a) * 70}
                stroke="#333"
                strokeWidth="1.4"
              />
              <circle cx={160 + Math.cos(a) * 88} cy={120 + Math.sin(a) * 70} r="7" fill="#555" />
            </g>
          );
        })}
        <circle cx="160" cy="120" r="22" fill="#ff5a36" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
      <rect x="48" y="48" width="224" height="144" rx="12" fill="#0b0d10" stroke="#2a2a2e" />
      <text x="64" y="82" fill="#b8ff3c" fontSize="12" fontFamily="ui-monospace, monospace">
        find_symbol("fetchInbox")
      </text>
      <text x="64" y="108" fill="#888" fontSize="12" fontFamily="ui-monospace, monospace">
        who_calls → 3 results
      </text>
      <text x="64" y="134" fill="#888" fontSize="12" fontFamily="ui-monospace, monospace">
        trace_path → InboxPage
      </text>
      <text x="64" y="160" fill="#555" fontSize="12" fontFamily="ui-monospace, monospace">
        12ms · 0 files dumped
      </text>
    </svg>
  );
}

function MiniBuilding({
  x,
  y,
  h,
  fill,
}: {
  x: number;
  y: number;
  h: number;
  fill: string;
}) {
  const w = 42;
  return (
    <g>
      <path d={`M ${x} ${y} L ${x + w / 2} ${y - 12} L ${x + w / 2} ${y - 12 - h} L ${x} ${y - h} Z`} fill={fill} />
      <path
        d={`M ${x + w / 2} ${y - 12} L ${x + w} ${y} L ${x + w} ${y - h} L ${x + w / 2} ${y - 12 - h} Z`}
        fill="#c8c8c4"
      />
      <path
        d={`M ${x} ${y - h} L ${x + w / 2} ${y - 12 - h} L ${x + w} ${y - h} L ${x + w / 2} ${y - h - 12} Z`}
        fill="#f7ffe3"
      />
    </g>
  );
}
