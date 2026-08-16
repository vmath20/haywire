"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { ArrowUpRight, Github } from "lucide-react";
import clsx from "clsx";

type DemoNode = {
  id: string;
  label: string;
  kind: string;
  file: string;
  x: number;
  y: number;
};

type DemoEdge = {
  from: string;
  to: string;
  relation: string;
  confidence: "EXTRACTED" | "INFERRED";
};

const NODES: DemoNode[] = [
  { id: "inbox", label: "InboxPage", kind: "function", file: "inbox.ts:1", x: 90, y: 70 },
  { id: "auth", label: "AuthGate", kind: "function", file: "auth.ts:8", x: 90, y: 210 },
  { id: "list", label: "MessageList", kind: "function", file: "inbox.ts:6", x: 270, y: 70 },
  { id: "fetch", label: "fetchInbox", kind: "function", file: "inbox.ts:12", x: 270, y: 200 },
  { id: "send", label: "sendMail", kind: "function", file: "inbox.ts:16", x: 450, y: 130 },
  { id: "store", label: "ThreadStore", kind: "module", file: "store.ts", x: 270, y: 310 },
];

const EDGES: DemoEdge[] = [
  { from: "inbox", to: "list", relation: "renders", confidence: "EXTRACTED" },
  { from: "inbox", to: "auth", relation: "calls", confidence: "EXTRACTED" },
  { from: "list", to: "fetch", relation: "calls", confidence: "EXTRACTED" },
  { from: "list", to: "send", relation: "calls", confidence: "EXTRACTED" },
  { from: "fetch", to: "store", relation: "reads", confidence: "EXTRACTED" },
  { from: "send", to: "store", relation: "writes", confidence: "EXTRACTED" },
];

const SOURCE: Array<{
  n: number;
  text: string;
  nodes?: string[];
  edges?: string[];
}> = [
  { n: 1, text: "export function InboxPage() {", nodes: ["inbox"] },
  { n: 2, text: "  return AuthGate(<MessageList />);", nodes: ["inbox", "auth", "list"], edges: ["inbox"] },
  { n: 3, text: "}" },
  { n: 4, text: "" },
  { n: 5, text: "export function MessageList() {", nodes: ["list"] },
  { n: 6, text: "  const threads = fetchInbox();", nodes: ["list", "fetch"], edges: ["list-fetch"] },
  { n: 7, text: "  return threads.map(sendMail);", nodes: ["list", "send"], edges: ["list-send"] },
  { n: 8, text: "}" },
  { n: 9, text: "" },
  { n: 10, text: "export function fetchInbox() {", nodes: ["fetch"] },
  { n: 11, text: "  return ThreadStore.list();", nodes: ["fetch", "store"], edges: ["fetch"] },
  { n: 12, text: "}" },
  { n: 13, text: "" },
  { n: 14, text: "export function sendMail(thread) {", nodes: ["send"] },
  { n: 15, text: "  return ThreadStore.append(thread);", nodes: ["send", "store"], edges: ["send"] },
  { n: 16, text: "}" },
];

type StepId = "source" | "nodes" | "edges" | "query";

const STEPS: Array<{
  id: StepId;
  n: string;
  title: string;
  body: string;
}> = [
  {
    id: "source",
    n: "01",
    title: "Start from a code block",
    body: "Haywire doesn't read your README. It opens the file. This is a tiny inbox module — four functions and a store. Everything below is extracted from these sixteen lines.",
  },
  {
    id: "nodes",
    n: "02",
    title: "Functions become nodes",
    body: "Tree-sitter walks the AST and emits a node for every function, class, and module. Highlighted lines are declarations. InboxPage, MessageList, fetchInbox, sendMail, AuthGate, ThreadStore — six nodes, no guessing.",
  },
  {
    id: "edges",
    n: "03",
    title: "Calls become edges",
    body: "Each call site is an EXTRACTED edge: InboxPage renders MessageList, MessageList calls fetchInbox and sendMail, both read/write ThreadStore. The graph is the call structure, not a folder tree.",
  },
  {
    id: "query",
    n: "04",
    title: "Query the graph, not the files",
    body: "Now the code is an index. who_calls(fetchInbox) returns MessageList. trace_path(InboxPage → ThreadStore) walks the three extracted hops. An agent gets those answers without dumping the repo.",
  },
];

const QUERIES = [
  {
    id: "who",
    label: "who_calls",
    arg: '"fetchInbox"',
    focus: "fetch",
    lit: ["list", "fetch"],
    edgeKeys: ["list-fetch"],
    lines: [5, 6, 10],
    result: [
      { tone: "ok" as const, text: "MessageList  ·  calls  ·  inbox.ts:6" },
      { tone: "dim" as const, text: "1 caller  ·  EXTRACTED  ·  0 files dumped" },
    ],
  },
  {
    id: "path",
    label: "trace_path",
    arg: '"InboxPage" → "ThreadStore"',
    focus: "store",
    lit: ["inbox", "list", "fetch", "store"],
    edgeKeys: ["inbox", "list-fetch", "fetch"],
    lines: [1, 2, 6, 11],
    result: [
      { tone: "ok" as const, text: "InboxPage → MessageList → fetchInbox → ThreadStore" },
      { tone: "dim" as const, text: "3 hops  ·  all EXTRACTED  ·  11ms" },
    ],
  },
  {
    id: "find",
    label: "find_symbol",
    arg: '"sendMail"',
    focus: "send",
    lit: ["send", "list", "store"],
    edgeKeys: ["list-send", "send"],
    lines: [7, 14, 15],
    result: [
      { tone: "ok" as const, text: "sendMail  ·  function  ·  inbox.ts:14" },
      { tone: "dim" as const, text: "called by MessageList  ·  writes ThreadStore" },
    ],
  },
] as const;

function edgeKey(e: DemoEdge): string {
  if (e.from === "list" && e.to === "fetch") return "list-fetch";
  if (e.from === "list" && e.to === "send") return "list-send";
  return e.from;
}

export function ProductExplainer() {
  return (
    <div className="relative z-10 bg-black text-white">
      <HowItWorks />

      <section className="relative overflow-hidden px-4 pt-8 pb-28 text-center sm:px-6 sm:pb-36">
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

function HowItWorks() {
  const [step, setStep] = useState(0);
  const [pinned, setPinned] = useState(false);
  const [queryId, setQueryId] = useState<(typeof QUERIES)[number]["id"]>("who");
  const current = STEPS[step]!;
  const query = QUERIES.find((q) => q.id === queryId) ?? QUERIES[0]!;

  useEffect(() => {
    if (pinned) return;
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    const t = window.setInterval(() => setStep((s) => (s + 1) % STEPS.length), 5200);
    return () => window.clearInterval(t);
  }, [pinned]);

  const byId = useMemo(() => new Map(NODES.map((n) => [n.id, n])), []);

  const visibleNodes =
    current.id === "source" ? [] : NODES;
  const visibleEdges =
    current.id === "source" || current.id === "nodes"
      ? []
      : EDGES;

  let lit = new Set<string>(NODES.map((n) => n.id));
  let litEdges = new Set<string>(EDGES.map(edgeKey));
  let highlightLines = new Set<number>();
  let focusId: string | null = null;

  if (current.id === "source") {
    highlightLines = new Set(SOURCE.map((l) => l.n));
  } else if (current.id === "nodes") {
    highlightLines = new Set(SOURCE.filter((l) => l.nodes && !l.edges).map((l) => l.n));
  } else if (current.id === "edges") {
    highlightLines = new Set(SOURCE.filter((l) => l.edges).map((l) => l.n));
  } else {
    lit = new Set(query.lit);
    litEdges = new Set(query.edgeKeys);
    highlightLines = new Set(query.lines);
    focusId = query.focus;
  }

  function go(i: number) {
    setPinned(true);
    setStep(i);
  }

  return (
    <section id="how" className="scroll-mt-20 px-4 pt-24 pb-8 sm:px-6 sm:pt-32 sm:pb-12">
      <div className="mx-auto max-w-6xl">
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-wire-signal">
          How it works
        </p>
        <h2 className="mt-4 max-w-3xl font-display text-[clamp(2.5rem,6vw,4.25rem)] font-semibold leading-[1.04] tracking-[-0.035em]">
          How Haywire
          <br />
          graphs a repo
        </h2>
        <p className="mt-6 max-w-2xl text-[17px] leading-[1.6] text-[#999]">
          One file in, a queryable graph out. Walk the same inbox module Haywire
          would parse: declarations become nodes, call sites become edges, then
          you ask the graph who calls what.
        </p>

        <ol className="mt-12 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((item, i) => {
            const active = i === step;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => go(i)}
                  onMouseEnter={() => go(i)}
                  className={clsx(
                    "h-full w-full rounded-[20px] border px-4 py-4 text-left transition duration-300",
                    active
                      ? "border-wire-signal/50 bg-white/[0.06]"
                      : "border-white/10 hover:border-white/20 hover:bg-white/[0.03]",
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
                  <h3 className="mt-2 font-display text-[17px] font-semibold tracking-[-0.02em]">
                    {item.title}
                  </h3>
                </button>
              </li>
            );
          })}
        </ol>

        <p className="mt-6 max-w-3xl text-[16px] leading-[1.65] text-[#bbb]">{current.body}</p>

        <div className="mt-8 grid items-stretch gap-3 lg:grid-cols-2">
          <div className="overflow-hidden rounded-[24px] border border-white/10 bg-[#0c0c0e]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="font-mono text-xs text-white/45">inbox.ts</p>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/30">
                {current.id === "source"
                  ? "source"
                  : current.id === "nodes"
                    ? "declarations"
                    : current.id === "edges"
                      ? "call sites"
                      : "query hits"}
              </p>
            </div>
            <pre className="overflow-x-auto px-2 py-4 font-mono text-[12.5px] leading-[1.7] sm:text-[13px]">
              {SOURCE.map((line) => {
                const on = highlightLines.has(line.n);
                const empty = line.text.length === 0;
                return (
                  <div
                    key={line.n}
                    className={clsx(
                      "flex gap-4 rounded-md px-3 transition-colors duration-300",
                      on && !empty && "bg-wire-signal/15",
                    )}
                  >
                    <span className="w-5 shrink-0 select-none text-right text-white/25">
                      {line.n}
                    </span>
                    <span className={on && !empty ? "text-white" : "text-white/35"}>
                      {empty ? " " : line.text}
                    </span>
                  </div>
                );
              })}
            </pre>
          </div>

          <div className="flex min-h-[22rem] flex-col overflow-hidden rounded-[24px] border border-white/10 bg-[#0c0c0e]">
            <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
              <p className="font-mono text-xs text-white/45">
                {current.id === "query" ? "graph · query" : "graph"}
              </p>
              <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/30">
                {visibleNodes.length} nodes · {visibleEdges.length} edges
              </p>
            </div>
            <svg
              viewBox="0 0 540 360"
              className="h-[16rem] w-full flex-1 sm:h-[18rem]"
              aria-hidden
            >
              {visibleEdges.map((e) => {
                const a = byId.get(e.from);
                const b = byId.get(e.to);
                if (!a || !b) return null;
                const on = litEdges.has(edgeKey(e));
                return (
                  <line
                    key={`${e.from}-${e.to}`}
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    stroke="#b8ff3c"
                    strokeOpacity={on ? 0.95 : 0.18}
                    strokeWidth={on ? 2.2 : 1.2}
                    strokeDasharray="10 8"
                    className={clsx(on && "animate-dash-flow")}
                  />
                );
              })}
              {visibleNodes.map((n) => {
                const on = lit.has(n.id);
                const focus = n.id === focusId;
                return (
                  <g key={n.id} className="animate-fade-in">
                    {focus ? (
                      <circle
                        cx={n.x}
                        cy={n.y}
                        r="22"
                        fill="#b8ff3c"
                        fillOpacity="0.18"
                        className="animate-node-pulse"
                      />
                    ) : null}
                    <circle
                      cx={n.x}
                      cy={n.y}
                      r={focus ? 13 : 10}
                      fill={on ? "#b8ff3c" : "#333"}
                      className="transition-all duration-300"
                    />
                    <text
                      x={n.x}
                      y={n.y + 28}
                      textAnchor="middle"
                      fontSize="12"
                      fill={on ? "#e8e8e8" : "#555"}
                    >
                      {n.label}
                    </text>
                  </g>
                );
              })}
              {current.id === "source" ? (
                <text
                  x="270"
                  y="180"
                  textAnchor="middle"
                  fill="#666"
                  fontSize="14"
                >
                  No graph yet — only source.
                </text>
              ) : null}
            </svg>

            {current.id === "query" ? (
              <div className="border-t border-white/10 px-4 py-4">
                <div className="flex flex-wrap gap-2">
                  {QUERIES.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => {
                        setPinned(true);
                        setQueryId(q.id);
                      }}
                      className={clsx(
                        "rounded-full px-3 py-1.5 font-mono text-[11px] font-semibold transition",
                        q.id === query.id
                          ? "bg-wire-signal text-black"
                          : "bg-white/5 text-white/65 hover:bg-white/10 hover:text-white",
                      )}
                    >
                      {q.label}
                    </button>
                  ))}
                </div>
                <p className="mt-3 font-mono text-[13px] text-wire-signal">
                  {query.label}({query.arg})
                </p>
                <div className="mt-2 space-y-1 font-mono text-[12.5px]">
                  {query.result.map((line) => (
                    <p
                      key={line.text}
                      className={line.tone === "ok" ? "text-white" : "text-white/40"}
                    >
                      {line.text}
                    </p>
                  ))}
                </div>
              </div>
            ) : current.id === "nodes" ? (
              <p className="border-t border-white/10 px-4 py-3 text-sm text-white/50">
                Six symbols. Each declaration in the file on the left is a node
                on the right.
              </p>
            ) : current.id === "edges" ? (
              <p className="border-t border-white/10 px-4 py-3 text-sm text-white/50">
                Highlighted lines are call sites. Each one is a solid EXTRACTED
                edge — proven by the AST, not inferred by a model.
              </p>
            ) : (
              <p className="border-t border-white/10 px-4 py-3 text-sm text-white/50">
                Haywire clones the repo and opens files like this. Nothing is
                graphed until the AST is walked.
              </p>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
