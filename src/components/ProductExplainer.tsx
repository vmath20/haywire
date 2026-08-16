"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { ArrowUpRight, Github } from "lucide-react";
import clsx from "clsx";

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
const NODE_IDS = GRAPH_NODES.map((n) => n.id);

const WHY = [
  {
    title: "Blast radius, not grep.",
    body: "A search finds a name. A graph finds every path that can reach it — including the callers named something else. Rename fetchInbox and see what actually breaks.",
    visual: "blast" as const,
  },
  {
    title: "Architecture as it runs.",
    body: "Folder trees are where files live. Communities cluster by how code actually talks. Auth is whatever guards a request, not a directory called auth/.",
    visual: "community" as const,
  },
  {
    title: "Follow the call path.",
    body: "Click from a screen to a store in one hop sequence. Haywire traces the shortest path through real EXTRACTED edges, so you read the flow instead of guessing it.",
    visual: "path" as const,
  },
  {
    title: "Proven edges vs guesses.",
    body: "Solid lines are EXTRACTED from the AST. Dashed lines are INFERRED. You always know what the compiler saw versus what Haywire filled in.",
    visual: "edges" as const,
  },
  {
    title: "God nodes, in plain sight.",
    body: "High-degree hubs light up. That's the file everyone is afraid to touch, visualized — the one change that ripples through the graph.",
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
    title: "Indexes your repo",
    body: "Paste a GitHub URL. Haywire clones the source and lists every function, class, and module as a node — no IDE plugin, no local index to babysit.",
  },
  {
    n: "02",
    title: "Extracts the call graph",
    body: "Tree-sitter walks the AST. Calls, imports, and writes become edges. Solid is proven. Dashed is inferred. No LLM inventing the wiring.",
  },
  {
    n: "03",
    title: "You (or an agent) query it",
    body: "Explore communities and hubs in the app, or ask find_symbol / who_calls / trace_path over MCP so agents navigate instead of dumping files.",
  },
];

const MCP_TOOLS = [
  {
    id: "find",
    label: "find_symbol",
    arg: '"fetchInbox"',
    lines: [
      { tone: "ok", text: "fetchInbox  ·  function  ·  src/lib/inbox.ts:42" },
      { tone: "dim", text: "community  Data  ·  degree  4" },
    ],
  },
  {
    id: "calls",
    label: "who_calls",
    arg: '"fetchInbox"',
    lines: [
      { tone: "ok", text: "MessageList  ·  calls  ·  src/components/MessageList.tsx:88" },
      { tone: "ok", text: "AuthGate  ·  scopes  ·  inferred" },
      { tone: "dim", text: "2 callers  ·  0 files dumped" },
    ],
  },
  {
    id: "path",
    label: "trace_path",
    arg: '"InboxPage" → "ThreadStore"',
    lines: [
      { tone: "ok", text: "InboxPage  →  MessageList  →  fetchInbox  →  ThreadStore" },
      { tone: "dim", text: "3 hops  ·  all EXTRACTED  ·  14ms" },
    ],
  },
] as const;

export function ProductExplainer() {
  return (
    <div className="relative z-10 bg-black text-white">
      <section id="graph" className="scroll-mt-20 px-4 pt-24 sm:px-6 sm:pt-32">
        <div className="mx-auto max-w-6xl">
          <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-wire-signal">
            Knowledge graph
          </p>
          <h2 className="mt-4 max-w-3xl font-display text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
            A graph of every
            <br />
            symbol, call, and hub.
          </h2>
          <p className="mt-6 max-w-xl text-[17px] leading-[1.6] text-[#999]">
            Haywire reads a GitHub repository with tree-sitter and builds a live
            knowledge graph: functions, classes, modules, and the edges that
            actually connect them. Click a node in the toy inbox below — a real
            repo works the same way.
          </p>
        </div>
      </section>

      <section className="px-4 pt-14 pb-4 sm:px-6 sm:pt-16">
        <div className="mx-auto max-w-6xl">
          <article className="overflow-hidden rounded-[28px] bg-wire-signal p-3 sm:p-4">
            <GraphDemo />
          </article>
          <p className="mt-6 max-w-2xl text-[17px] leading-[1.6] text-[#999]">
            Nodes are functions, classes, and modules. Solid edges are extracted
            from the AST; dashed edges are inferred. The graph auto-walks the
            toy inbox — click any node to take over.
          </p>
        </div>
      </section>

      <HowItWorks />

      <section id="why" className="scroll-mt-20 px-4 pt-8 pb-8 sm:px-6 sm:pt-16">
        <div className="mx-auto max-w-6xl">
          <h2 className="max-w-3xl font-display text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
            Why the graph
            <br />
            is the product
          </h2>
          <p className="mt-6 max-w-xl text-[17px] leading-[1.6] text-[#999]">
            Codebases hide structure in names, folders, and folklore. A graph
            makes the wiring inspectable — the questions grep never answers.
          </p>

          <div className="mt-14 grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
            {WHY.map((item) => (
              <SpotlightCard key={item.title}>
                <div className="relative aspect-[4/3] overflow-hidden rounded-[16px] bg-[#111113]">
                  <WhyVisual kind={item.visual} />
                </div>
                <p className="mt-6 text-[15px] leading-[1.65] text-[#a3a3a3]">
                  <span className="font-semibold text-white">{item.title} </span>
                  {item.body}
                </p>
              </SpotlightCard>
            ))}
          </div>
        </div>
      </section>

      <QueryPlayground />

      <section className="relative overflow-hidden px-4 pt-16 pb-28 text-center sm:px-6 sm:pb-36">
        <h2 className="font-display text-[clamp(2.75rem,7vw,5rem)] font-semibold leading-[1.02] tracking-[-0.04em]">
          See the wiring.
          <br />
          Then change it.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-[17px] leading-[1.6] text-[#999]">
          Paste a public GitHub repo and get a live knowledge graph — or star
          the project and run it yourself.
        </p>
        <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
          <Link
            href="/signin"
            className="inline-flex items-center gap-2 rounded-full bg-white px-6 py-3 text-sm font-semibold text-black transition hover:scale-[1.03] hover:bg-white/90"
          >
            Graph a repo
            <ArrowUpRight className="h-4 w-4" />
          </Link>
          <a
            href="https://github.com/vmath20/haywire"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/5 px-6 py-3 text-sm font-semibold text-white transition hover:scale-[1.03] hover:bg-white/10"
          >
            <Github className="h-4 w-4" />
            Star on GitHub
          </a>
        </div>
      </section>
    </div>
  );
}

function SpotlightCard({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLElement>(null);

  function onMove(e: MouseEvent<HTMLElement>) {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
    el.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
  }

  return (
    <article
      ref={ref}
      onMouseMove={onMove}
      className="group relative overflow-hidden rounded-[24px] border border-white/10 bg-[#0c0c0e] p-6 transition duration-300 hover:-translate-y-1 hover:border-wire-signal/40 sm:p-8"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{
          background:
            "radial-gradient(420px circle at var(--spot-x, 50%) var(--spot-y, 0%), rgba(184,255,60,0.14), transparent 42%)",
        }}
      />
      <div className="relative">{children}</div>
    </article>
  );
}

function GraphDemo() {
  const [selected, setSelected] = useState<string>("list");
  const [hovered, setHovered] = useState<string | null>(null);
  const [pinned, setPinned] = useState(false);
  const byId = useMemo(() => new Map(GRAPH_NODES.map((n) => [n.id, n])), []);
  const focusId = hovered ?? selected;
  const node = byId.get(focusId) ?? GRAPH_NODES[1]!;

  useEffect(() => {
    if (pinned) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = window.setInterval(() => {
      setSelected((cur) => NODE_IDS[(NODE_IDS.indexOf(cur) + 1) % NODE_IDS.length]!);
    }, 2400);
    return () => window.clearInterval(t);
  }, [pinned]);

  const related = GRAPH_EDGES.filter((e) => e.from === node.id || e.to === node.id);
  const lit = new Set<string>([node.id]);
  for (const e of related) {
    lit.add(e.from);
    lit.add(e.to);
  }

  function pick(id: string) {
    setPinned(true);
    setSelected(id);
  }

  return (
    <div className="flex min-h-[26rem] flex-col overflow-hidden rounded-[20px] bg-[#0b0d10]/[0.07]">
      <svg
        viewBox="0 0 540 360"
        className="h-[20rem] w-full flex-1 cursor-pointer sm:h-[26rem]"
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
              strokeOpacity={active ? 0.92 : 0.18}
              strokeWidth={active ? 2.4 : 1.2}
              strokeDasharray={e.confidence === "INFERRED" ? "5 4" : active ? "10 8" : undefined}
              className={clsx(
                "transition-[stroke-opacity,stroke-width] duration-500",
                active && e.confidence === "EXTRACTED" && "animate-dash-flow",
              )}
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
              onClick={() => pick(n.id)}
              onMouseEnter={() => setHovered(n.id)}
              onMouseLeave={() => setHovered(null)}
              className="cursor-pointer"
              role="button"
              tabIndex={0}
              onKeyDown={(ev) => {
                if (ev.key === "Enter" || ev.key === " ") {
                  ev.preventDefault();
                  pick(n.id);
                }
              }}
            >
              {isSel ? (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r="26"
                  fill="#0b0d10"
                  fillOpacity="0.12"
                  className="animate-node-pulse"
                />
              ) : null}
              <circle
                cx={n.x}
                cy={n.y}
                r={isSel ? 14 : 10}
                fill="#0b0d10"
                opacity={isLit ? 1 : 0.28}
                className="transition-all duration-300"
              />
              <text
                x={n.x}
                y={n.y + 30}
                textAnchor="middle"
                fontSize="12"
                fontWeight={isSel ? 700 : 500}
                fill="#0b0d10"
                opacity={isLit ? 1 : 0.38}
                className="transition-opacity duration-300"
              >
                {n.label}
              </text>
            </g>
          );
        })}
      </svg>

      <div className="m-2 mt-0 rounded-[16px] bg-black px-4 py-3 text-white sm:px-5">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <p className="font-display text-base font-semibold tracking-tight">{node.label}</p>
          <p className="text-[11px] font-medium uppercase tracking-[0.16em] text-white/45">
            {COMMUNITY_NAME[node.community]} · {node.kind}
            {pinned ? "" : " · auto"}
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
                  onClick={() => pick(otherId)}
                  className="underline decoration-wire-signal decoration-2 underline-offset-2 transition hover:decoration-white"
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

function HowItWorks() {
  const [step, setStep] = useState(0);
  const [pinned, setPinned] = useState(false);

  useEffect(() => {
    if (pinned) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), 3800);
    return () => window.clearInterval(t);
  }, [pinned]);

  const visibleNodes =
    step === 0 ? GRAPH_NODES.slice(0, 4) : GRAPH_NODES;
  const visibleEdges =
    step === 0 ? [] : step === 1 ? GRAPH_EDGES.filter((e) => e.confidence === "EXTRACTED") : GRAPH_EDGES;
  const byId = useMemo(() => new Map(GRAPH_NODES.map((n) => [n.id, n])), []);
  const colorize = step === 2;

  return (
    <section id="how" className="scroll-mt-20 px-4 py-24 sm:px-6 sm:py-32">
      <div className="mx-auto max-w-6xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/40">
          How it works
        </p>
        <h2 className="mt-4 max-w-3xl font-display text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
          How Haywire
          <br />
          graphs a repo
        </h2>
        <p className="mt-6 max-w-xl text-[17px] leading-[1.6] text-[#999]">
          Haywire constructs a graph index of your codebase, then lets you — or
          an agent — query symbols, callers, and paths instead of grepping in
          the dark.
        </p>

        <div className="mt-14 grid items-stretch gap-6 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <ol className="flex flex-col gap-2">
            {STEPS.map((item, i) => {
              const active = i === step;
              return (
                <li key={item.n}>
                  <button
                    type="button"
                    onClick={() => {
                      setPinned(true);
                      setStep(i);
                    }}
                    onMouseEnter={() => {
                      setPinned(true);
                      setStep(i);
                    }}
                    className={clsx(
                      "w-full rounded-[20px] border px-5 py-5 text-left transition duration-300",
                      active
                        ? "border-wire-signal/50 bg-white/[0.06]"
                        : "border-white/10 bg-transparent hover:border-white/20 hover:bg-white/[0.03]",
                    )}
                  >
                    <p
                      className={clsx(
                        "text-[11px] font-semibold tracking-[0.18em]",
                        active ? "text-wire-signal" : "text-white/35",
                      )}
                    >
                      STEP {item.n}
                    </p>
                    <h3 className="mt-2 font-display text-xl font-semibold tracking-[-0.03em]">
                      {item.title}
                    </h3>
                    <p
                      className={clsx(
                        "mt-2 text-[15px] leading-[1.6] transition-opacity duration-300",
                        active ? "text-[#bbb]" : "text-[#777]",
                      )}
                    >
                      {item.body}
                    </p>
                  </button>
                </li>
              );
            })}
          </ol>

          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#0c0c0e] p-4 sm:p-6">
            <svg viewBox="0 0 540 360" className="h-full min-h-[18rem] w-full" aria-hidden>
              {visibleEdges.map((e) => {
                const a = byId.get(e.from);
                const b = byId.get(e.to);
                if (!a || !b) return null;
                return (
                  <line
                    key={`${e.from}-${e.to}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke={e.confidence === "INFERRED" ? "#666" : "#b8ff3c"}
                    strokeOpacity={0.85}
                    strokeWidth={1.6}
                    strokeDasharray={e.confidence === "INFERRED" ? "5 4" : "10 8"}
                    className="animate-dash-flow"
                  />
                );
              })}
              {visibleNodes.map((n) => {
                const fill = colorize
                  ? ["#4E79A7", "#F28E2B", "#59A14F"][n.community]
                  : "#b8ff3c";
                return (
                  <g key={n.id} className="animate-fade-in">
                    <circle cx={n.x} cy={n.y} r="11" fill={fill} className="animate-node-pulse" />
                    <text
                      x={n.x}
                      y={n.y + 26}
                      textAnchor="middle"
                      fontSize="12"
                      fill="#e8e8e8"
                    >
                      {n.label}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      </div>
    </section>
  );
}

function QueryPlayground() {
  const [active, setActive] = useState<(typeof MCP_TOOLS)[number]["id"]>("calls");
  const tool = MCP_TOOLS.find((t) => t.id === active) ?? MCP_TOOLS[1]!;

  return (
    <section className="px-4 py-16 sm:px-6 sm:py-24">
      <div className="mx-auto max-w-6xl">
        <h2 className="max-w-3xl font-display text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
          Query it like
          <br />
          an agent would
        </h2>
        <p className="mt-6 max-w-xl text-[17px] leading-[1.6] text-[#999]">
          The same graph powers Haywire MCP. Click a tool — this is what a
          coding agent gets back instead of a pile of files.
        </p>

        <SpotlightCard>
          <div className="flex flex-wrap gap-2">
            {MCP_TOOLS.map((t) => (
              <button
                type="button"
                key={t.id}
                onClick={() => setActive(t.id)}
                className={clsx(
                  "rounded-full px-4 py-2 font-mono text-xs font-semibold transition duration-200",
                  t.id === active
                    ? "bg-wire-signal text-black"
                    : "bg-white/5 text-white/70 hover:bg-white/10 hover:text-white",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="mt-6 overflow-hidden rounded-[16px] border border-white/10 bg-black font-mono text-[13px] leading-relaxed">
            <div className="border-b border-white/10 px-4 py-2.5 text-white/40">
              mcp · haywire
            </div>
            <div className="px-4 py-4">
              <p className="text-wire-signal">
                {tool.label}({tool.arg})
              </p>
              <div className="mt-3 space-y-1.5">
                {tool.lines.map((line) => (
                  <p
                    key={line.text}
                    className={clsx(
                      "animate-fade-up",
                      line.tone === "ok" ? "text-white" : "text-white/40",
                    )}
                  >
                    {line.text}
                  </p>
                ))}
              </div>
            </div>
          </div>
        </SpotlightCard>
      </div>
    </section>
  );
}

function WhyVisual({ kind }: { kind: (typeof WHY)[number]["visual"] }) {
  if (kind === "blast") {
    return (
      <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
        <line x1="70" y1="120" x2="160" y2="120" stroke="#b8ff3c" strokeWidth="2" className="group-hover:animate-dash-flow" />
        <line x1="160" y1="120" x2="250" y2="58" stroke="#b8ff3c" strokeWidth="2" className="group-hover:animate-dash-flow" />
        <line x1="160" y1="120" x2="250" y2="120" stroke="#b8ff3c" strokeWidth="2" className="group-hover:animate-dash-flow" />
        <line x1="160" y1="120" x2="250" y2="182" stroke="#b8ff3c" strokeWidth="2" className="group-hover:animate-dash-flow" />
        <circle cx="70" cy="120" r="8" fill="#333" />
        <circle cx="160" cy="120" r="16" fill="#b8ff3c" className="group-hover:animate-node-pulse" />
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
          <circle
            key={i}
            cx={x}
            cy={y}
            r="11"
            fill={String(fill)}
            className="origin-center transition duration-500 group-hover:scale-110"
          />
        ))}
      </svg>
    );
  }
  if (kind === "path") {
    return (
      <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
        <line x1="50" y1="180" x2="120" y2="110" stroke="#333" strokeWidth="2" />
        <line
          x1="120"
          y1="110"
          x2="200"
          y2="110"
          stroke="#b8ff3c"
          strokeWidth="2.4"
          strokeDasharray="8 6"
          className="group-hover:animate-dash-flow"
        />
        <line
          x1="200"
          y1="110"
          x2="270"
          y2="50"
          stroke="#b8ff3c"
          strokeWidth="2.4"
          strokeDasharray="8 6"
          className="group-hover:animate-dash-flow"
        />
        <circle cx="50" cy="180" r="8" fill="#444" />
        <circle cx="120" cy="110" r="10" fill="#b8ff3c" />
        <circle cx="200" cy="110" r="10" fill="#b8ff3c" />
        <circle cx="270" cy="50" r="10" fill="#fff" />
      </svg>
    );
  }
  if (kind === "edges") {
    return (
      <svg viewBox="0 0 320 240" className="h-full w-full" aria-hidden>
        <line
          x1="60"
          y1="80"
          x2="260"
          y2="80"
          stroke="#fff"
          strokeWidth="2.2"
          strokeDasharray="10 8"
          className="group-hover:animate-dash-flow"
        />
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
        <circle cx="160" cy="120" r="22" fill="#ff5a36" className="group-hover:animate-node-pulse" />
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
