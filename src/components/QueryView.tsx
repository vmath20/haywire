"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import {
  ArrowUp,
  BookOpen,
  Check,
  ChevronDown,
  Code2,
  Copy,
  CornerDownRight,
  GitBranch,
  Layers,
  GitPullRequest,
  Loader2,
  Network,
  Plus,
  Search,
  Trash2,
} from "lucide-react";
import { useConvexAuth, useMutation, useQuery } from "convex/react";
import ReactMarkdown from "react-markdown";
import { api } from "@convex/_generated/api";
import type { Id } from "@convex/_generated/dataModel";
import { EXAMPLES } from "@/lib/types";
import type { AnalyzeResult } from "@/lib/types";
import { queryChatPath } from "@/lib/paths";
import {
  githubBlobUrl,
  lookupSymbol,
  parseGraphSymbolMap,
  sanitizeAnswerMarkdown,
} from "@/lib/githubLinks";
import { normalizeTraversal, type TraversalPath } from "@/lib/traversal";
import { AnswerGraph } from "@/components/AnswerGraph";
import { LoadingState } from "@/components/LoadingState";
import { RepoAvatar } from "@/components/RepoAvatar";
import { normalizeAnalyzePayload } from "@/lib/normalizeAnalyze";
import remarkGfm from "remark-gfm";

type RepoOption = {
  key: string;
  owner: string;
  repo: string;
  label: string;
  kind: "saved" | "example";
};

type StreamUsage = {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
  cost_usd: number;
  model: string | null;
  elapsed_ms: number;
  graph_context: string;
  answer: string;
  traversal: TraversalPath | null;
};

const SUGGESTIONS = [
  {
    text: "What are the main modules and how do they connect?",
    icon: Layers,
  },
  {
    text: "Where is authentication or authorization handled?",
    icon: Search,
  },
  {
    text: "Which files are the densest hubs in this codebase?",
    icon: Network,
  },
  {
    text: "Map the data flow from entrypoint to storage.",
    icon: BookOpen,
  },
  {
    text: "What depends on the core API or server package?",
    icon: GitBranch,
  },
] as const;

function titleFromQuestion(q: string): string {
  const cleaned = q.replace(/\s+/g, " ").trim();
  if (cleaned.length <= 56) return cleaned;
  return `${cleaned.slice(0, 53)}…`;
}

function firstName(name?: string | null, email?: string | null): string {
  const raw = (name || email || "there").trim();
  return raw.split(/\s+|@/)[0] || "there";
}

function stripFollowUpText(raw: string): string {
  return raw
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Pull ## Follow-ups out of the answer so they can be rendered as clickable chips. */
function splitFollowUps(content: string): { body: string; followUps: string[] } {
  const lines = content.split(/\r?\n/);
  const headingRe = /^#{1,3}\s*follow-?ups?\s*$/i;
  const idx = lines.findIndex((line) => headingRe.test(line.trim()));
  if (idx === -1) return { body: content, followUps: [] };

  const body = lines.slice(0, idx).join("\n").trimEnd();
  const followUps: string[] = [];
  for (const line of lines.slice(idx + 1)) {
    const t = line.trim();
    if (!t) continue;
    if (/^#{1,3}\s+\S/.test(t)) break;
    const item = t.match(/^(?:[-*]|\d+[.)])\s+(.+)$/);
    const text = stripFollowUpText(item ? item[1]! : t);
    if (text.length >= 8) followUps.push(text);
    if (!item && followUps.length) break;
  }
  return { body, followUps: followUps.slice(0, 6) };
}

function FollowUpList({
  questions,
  disabled,
  onPick,
}: {
  questions: string[];
  disabled?: boolean;
  onPick: (q: string) => void;
}) {
  if (!questions.length) return null;
  return (
    <div className="mt-10">
      <p className="text-[1.05rem] font-medium tracking-[-0.02em] text-[#0b0d10]">
        Follow-ups
      </p>
      <ul className="mt-2 border-t border-black/[0.06]">
        {questions.map((q) => (
          <li key={q} className="border-b border-black/[0.06]">
            <button
              type="button"
              disabled={disabled}
              onClick={() => onPick(q)}
              className="group flex w-full items-start gap-2.5 py-3 text-left text-[14.5px] font-light text-[#0b0d10] transition hover:text-[#65a30d] active:text-[#84cc16] disabled:cursor-not-allowed disabled:opacity-40"
            >
              <CornerDownRight
                className="mt-0.5 h-4 w-4 shrink-0 text-[#0b0d10]/45 transition group-hover:text-[#65a30d]"
                strokeWidth={1.75}
              />
              <span>{q}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MarkdownBody({
  content,
  owner,
  repo,
  graphContext,
  panelId,
}: {
  content: string;
  owner?: string;
  repo?: string;
  graphContext?: string | null;
  panelId?: string;
}) {
  const cleaned = useMemo(() => sanitizeAnswerMarkdown(content), [content]);
  const symbolMap = useMemo(
    () => parseGraphSymbolMap(graphContext || ""),
    [graphContext],
  );

  const codeClass =
    "rounded-md bg-black/[0.05] px-1.5 py-0.5 font-mono text-[12.5px] font-normal text-[#111827]";

  return (
    <div className="prose-chat max-w-none text-[15px] font-light leading-[1.75] tracking-[-0.01em] text-[#3a4149]">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => (
            <h2 className="mt-7 border-b border-black/[0.06] pb-2 text-[1.45rem] font-medium tracking-[-0.03em] text-[#0b0d10] first:mt-0">
              {children}
            </h2>
          ),
          h2: ({ children }) => (
            <h2 className="mt-7 text-[1.25rem] font-medium tracking-[-0.025em] text-[#0b0d10] first:mt-0">
              {children}
            </h2>
          ),
          h3: ({ children }) => (
            <h3 className="mt-5 text-[1.05rem] font-medium tracking-[-0.02em] text-[#0b0d10] first:mt-0">
              {children}
            </h3>
          ),
          h4: ({ children }) => (
            <h4 className="mt-4 text-[15px] font-medium text-[#0b0d10] first:mt-0">
              {children}
            </h4>
          ),
          p: ({ children }) => <p className="mt-3 first:mt-0">{children}</p>,
          ul: ({ children }) => (
            <ul className="mt-3 list-disc space-y-1.5 pl-5 first:mt-0">{children}</ul>
          ),
          ol: ({ children }) => (
            <ol className="mt-3 list-decimal space-y-1.5 pl-5 first:mt-0">{children}</ol>
          ),
          li: ({ children }) => <li className="pl-0.5">{children}</li>,
          strong: ({ children }) => (
            <strong className="font-semibold text-[#0b0d10]">{children}</strong>
          ),
          em: ({ children }) => <em className="italic text-[#1f2937]">{children}</em>,
          a: ({ href, children }) => {
            // Prefer turning path-only github links into code pills when possible
            const label = extractText(children);
            const ref =
              owner && repo ? lookupSymbol(symbolMap, label) : undefined;
            if (ref && owner && repo) {
              const url = githubBlobUrl(owner, repo, ref.path, ref.line);
              return (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${ref.path}${ref.line ? `:${ref.line}` : ""}`}
                  className="inline no-underline"
                  onClick={(e) => {
                    // Prefer scrolling to the snippet in the code column.
                    const target = ref.label || label;
                    if (panelId && jumpToSymbol(panelId, target)) {
                      e.preventDefault();
                    }
                  }}
                >
                  <code className={`${codeClass} transition hover:bg-wire-signal/35`}>
                    {label || children}
                  </code>
                </a>
              );
            }
            const external = Boolean(href && /^https?:\/\//i.test(href));
            return (
              <a
                href={href}
                target={external ? "_blank" : undefined}
                rel={external ? "noreferrer" : undefined}
                className="font-medium text-[#0b0d10] underline decoration-[#b8ff3c] decoration-2 underline-offset-[3px] transition hover:decoration-wire-signalDeep"
              >
                {children}
              </a>
            );
          },
          blockquote: ({ children }) => (
            <blockquote className="mt-3 border-l-2 border-wire-signal pl-4 text-[#4b5563] first:mt-0">
              {children}
            </blockquote>
          ),
          hr: () => <hr className="my-6 border-black/[0.08]" />,
          code: ({ children, className }) => {
            const block = Boolean(className);
            const text = extractText(children).replace(/\n$/, "");
            if (block) {
              return (
                <code className="mt-3 block overflow-x-auto rounded-2xl bg-[#f3f4f6] p-3.5 font-mono text-[12px] font-normal leading-relaxed text-[#1f2937]">
                  {children}
                </code>
              );
            }
            const ref =
              owner && repo ? lookupSymbol(symbolMap, text) : undefined;
            if (ref && owner && repo) {
              const url = githubBlobUrl(owner, repo, ref.path, ref.line);
              return (
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  title={`${ref.path}${ref.line ? `:${ref.line}` : ""}`}
                  className="inline no-underline"
                  onClick={(e) => {
                    // Prefer scrolling to the snippet in the code column.
                    const target = ref.label || text;
                    if (panelId && jumpToSymbol(panelId, target)) {
                      e.preventDefault();
                    }
                  }}
                >
                  <code className={`${codeClass} transition hover:bg-wire-signal/35`}>
                    {children}
                  </code>
                </a>
              );
            }
            return <code className={codeClass}>{children}</code>;
          },
          pre: ({ children }) => <div className="mt-3">{children}</div>,
          table: ({ children }) => (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full border-collapse text-left text-[13px]">{children}</table>
            </div>
          ),
          th: ({ children }) => (
            <th className="border-b border-black/10 px-3 py-2 font-medium text-[#0b0d10]">
              {children}
            </th>
          ),
          td: ({ children }) => (
            <td className="border-b border-black/[0.06] px-3 py-2">{children}</td>
          ),
        }}
      >
        {cleaned}
      </ReactMarkdown>
    </div>
  );
}

function extractText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (typeof node === "object" && node !== null && "props" in node) {
    const props = (node as { props?: { children?: ReactNode } }).props;
    return extractText(props?.children);
  }
  return "";
}

async function streamQuery(
  args: {
    owner: string;
    repo: string;
    question: string;
    graphUrl?: string | null;
    history?: { role: "user" | "assistant"; content: string }[];
  },
  handlers: {
    onStatus?: (message: string) => void;
    onMeta?: (meta: {
      graph_context: string;
      traversal: TraversalPath | null;
    }) => void;
    onToken?: (text: string) => void;
  },
): Promise<StreamUsage> {
  const res = await fetch("/api/query", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "text/event-stream" },
    body: JSON.stringify({
      owner: args.owner,
      repo: args.repo,
      question: args.question,
      budget: 3000,
      graph_url: args.graphUrl || undefined,
      history: args.history,
    }),
  });

  if (!res.ok || !res.body) {
    const err = await res.json().catch(() => ({}));
    const detail =
      typeof err.detail === "string" ? err.detail : `Query failed (${res.status})`;
    throw new Error(detail);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let graphContext = "";
  let traversal: TraversalPath | null = null;
  let answer = "";
  let sawDone = false;
  let usage: StreamUsage = {
    prompt_tokens: 0,
    completion_tokens: 0,
    total_tokens: 0,
    cost_usd: 0,
    model: null,
    elapsed_ms: 0,
    graph_context: "",
    answer: "",
    traversal: null,
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n\n");
    buffer = parts.pop() || "";
    for (const part of parts) {
      const line = part.split("\n").find((l) => l.startsWith("data:"));
      if (!line) continue;
      const raw = line.slice(5).trim();
      if (!raw) continue;
      let evt: Record<string, unknown>;
      try {
        evt = JSON.parse(raw) as Record<string, unknown>;
      } catch {
        continue;
      }
      if (evt.type === "status" && typeof evt.message === "string") {
        handlers.onStatus?.(evt.message);
      } else if (evt.type === "meta" && typeof evt.graph_context === "string") {
        graphContext = evt.graph_context;
        traversal = normalizeTraversal(evt.traversal);
        handlers.onMeta?.({ graph_context: graphContext, traversal });
      } else if (evt.type === "token" && typeof evt.text === "string") {
        answer += evt.text;
        handlers.onToken?.(evt.text);
      } else if (evt.type === "error") {
        throw new Error(typeof evt.detail === "string" ? evt.detail : "Query failed");
      } else if (evt.type === "done") {
        sawDone = true;
        usage = {
          prompt_tokens: Number(evt.prompt_tokens) || 0,
          completion_tokens: Number(evt.completion_tokens) || 0,
          total_tokens: Number(evt.total_tokens) || 0,
          cost_usd: Number(evt.cost_usd) || 0,
          model: typeof evt.model === "string" ? evt.model : null,
          elapsed_ms: Number(evt.elapsed_ms) || 0,
          graph_context: graphContext,
          answer: typeof evt.answer === "string" ? evt.answer : answer,
          traversal,
        };
      }
    }
  }

  // Never accept a stream that ended without the server's final event —
  // whatever accumulated is a truncated answer and must not be saved.
  if (!sawDone) {
    throw new Error("STREAM_DROPPED");
  }

  if (!usage.answer) usage.answer = answer;
  usage.graph_context = graphContext;
  usage.traversal = traversal;
  return usage;
}

function useRepoOptions() {
  const { isAuthenticated } = useConvexAuth();
  const saved = useQuery(api.graphs.listMine, isAuthenticated ? {} : "skip") ?? [];
  const examples = useQuery(api.examples.list) ?? [];

  return useMemo(() => {
    const map = new Map<string, RepoOption>();
    const exampleRows =
      examples.length > 0
        ? examples
        : EXAMPLES.map((e) => ({
            owner: e.owner,
            repo: e.repo,
            label: e.label,
          }));
    for (const ex of exampleRows) {
      const key = `${ex.owner}/${ex.repo}`;
      map.set(key, {
        key,
        owner: ex.owner,
        repo: ex.repo,
        label: ex.label,
        kind: "example",
      });
    }
    for (const g of saved) {
      const key = `${g.owner}/${g.repo}`;
      map.set(key, {
        key,
        owner: g.owner,
        repo: g.repo,
        label: g.label || g.repo,
        kind: "saved",
      });
    }
    return [...map.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [examples, saved]);
}

type ComposerMode = "graph" | "query" | "pr";

const MODE_OPTIONS: { id: ComposerMode; label: string; icon: typeof Network }[] = [
  { id: "graph", label: "Graph", icon: Network },
  { id: "query", label: "Query", icon: Search },
  { id: "pr", label: "PR", icon: GitPullRequest },
];

function ModeMenu({
  mode,
  onSelect,
}: {
  mode: ComposerMode;
  onSelect: (mode: ComposerMode) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = MODE_OPTIONS.find((o) => o.id === mode) ?? MODE_OPTIONS[1]!;
  const CurrentIcon = current.icon;

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[13px] font-light text-[#6b7280] transition hover:bg-black/[0.04] hover:text-[#0b0d10]"
      >
        <CurrentIcon className="h-3.5 w-3.5" strokeWidth={1.5} />
        {current.label}
        <ChevronDown
          className={clsx("h-3 w-3 opacity-50 transition-transform", open && "rotate-180")}
          strokeWidth={1.75}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute bottom-full right-0 z-30 mb-1.5 w-40 overflow-hidden rounded-xl border border-black/10 bg-white py-1 shadow-[0_12px_40px_rgba(0,0,0,0.12)]"
        >
          {MODE_OPTIONS.map((o) => {
            const Icon = o.icon;
            const active = o.id === mode;
            return (
              <button
                key={o.id}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onSelect(o.id);
                  setOpen(false);
                }}
                className={clsx(
                  "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] transition",
                  active
                    ? "bg-[#f4f4f5] font-medium text-[#0b0d10]"
                    : "font-light text-[#6b7280] hover:bg-black/[0.03] hover:text-[#0b0d10]",
                )}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
                <span className="flex-1">{o.label}</span>
                {active ? <Check className="h-3.5 w-3.5" strokeWidth={2} /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function RepoMenu({
  options,
  selected,
  onSelect,
}: {
  options: RepoOption[];
  selected: RepoOption | null;
  onSelect: (opt: RepoOption) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("");
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(
    null,
  );
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const updatePosition = useCallback(() => {
    const el = btnRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    const width = Math.max(r.width, 320);
    let left = r.left;
    if (left + width > window.innerWidth - 12) {
      left = Math.max(12, window.innerWidth - width - 12);
    }
    // Prefer opening downward; flip up only if not enough room below.
    const spaceBelow = window.innerHeight - r.bottom;
    const menuHeight = 320;
    const top =
      spaceBelow < Math.min(menuHeight, 220) && r.top > spaceBelow
        ? Math.max(12, r.top - menuHeight - 8)
        : r.bottom + 8;
    setCoords({ top, left, width });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    updatePosition();
    filterRef.current?.focus();
    function onScroll() {
      updatePosition();
    }
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [open, updatePosition]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
      setFilter("");
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        setFilter("");
      }
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.owner.toLowerCase().includes(q) ||
        o.repo.toLowerCase().includes(q) ||
        `${o.owner}/${o.repo}`.toLowerCase().includes(q),
    );
  }, [filter, options]);

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[13px] font-normal transition",
          open
            ? "bg-[#ececf1] text-[#0b0d10]"
            : "bg-[#f3f4f6] text-[#4b5563] hover:bg-[#e8e8ed] hover:text-[#0b0d10]",
        )}
      >
        {selected ? (
          <RepoAvatar
            owner={selected.owner}
            repo={selected.repo}
            label={selected.label}
            size={18}
            className="rounded-[5px]"
          />
        ) : (
          <GitBranch className="h-3.5 w-3.5 opacity-70" strokeWidth={1.5} />
        )}
        <span className="max-w-[11rem] truncate">
          {selected ? selected.label : "Repository"}
        </span>
        <ChevronDown
          className={clsx("h-3.5 w-3.5 opacity-50 transition", open && "rotate-180")}
          strokeWidth={1.5}
        />
      </button>
      {open && coords && typeof document !== "undefined"
        ? createPortal(
            <div
              ref={menuRef}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                width: coords.width,
                zIndex: 80,
              }}
              className="overflow-hidden rounded-2xl border border-black/[0.08] bg-white shadow-[0_16px_48px_rgba(0,0,0,0.14)]"
            >
              <div className="border-b border-black/[0.06] px-3 py-2.5">
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#9ca3af]" />
                  <input
                    ref={filterRef}
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                    placeholder="Search repositories…"
                    className="w-full rounded-xl bg-[#f7f7f8] py-2 pl-8 pr-3 text-[13px] font-light outline-none placeholder:text-[#9ca3af] focus:ring-1 focus:ring-black/10"
                  />
                </div>
              </div>
              <ul className="max-h-64 overflow-y-auto py-1.5">
                {filtered.length === 0 ? (
                  <li className="px-3.5 py-4 text-[13px] font-light text-[#9ca3af]">
                    No matching graphs
                  </li>
                ) : (
                  filtered.map((o) => {
                    const active = selected?.key === o.key;
                    return (
                      <li key={o.key}>
                        <button
                          type="button"
                          onClick={() => {
                            onSelect(o);
                            setOpen(false);
                            setFilter("");
                          }}
                          className={clsx(
                            "flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left transition",
                            active ? "bg-[#f3f4f6]" : "hover:bg-[#f7f7f8]",
                          )}
                        >
                          <RepoAvatar
                            owner={o.owner}
                            repo={o.repo}
                            label={o.label}
                            size={28}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[13px] font-medium text-[#0b0d10]">
                              {o.label}
                            </span>
                            <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] font-light text-[#9ca3af]">
                              <span className="truncate">
                                {o.owner}/{o.repo}
                              </span>
                              <span className="inline-flex shrink-0 items-center gap-1 rounded-full border border-black/[0.07] bg-white px-1.5 py-[1px] text-[10px] font-medium text-[#6b7280]">
                                <span
                                  className={clsx(
                                    "h-1.5 w-1.5 rounded-full",
                                    o.kind === "saved"
                                      ? "bg-[#84cc16]"
                                      : "bg-[#60a5fa]",
                                  )}
                                />
                                {o.kind}
                              </span>
                            </span>
                          </span>
                          {active ? (
                            <Check className="h-3.5 w-3.5 shrink-0 text-[#0b0d10]" strokeWidth={1.75} />
                          ) : null}
                        </button>
                      </li>
                    );
                  })
                )}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}

/** Landing: Ranger-style composer. */
export function QueryView() {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const viewer = useQuery(api.users.viewer, isAuthenticated ? {} : "skip");
  const options = useRepoOptions();
  const createChat = useMutation(api.chats.create);
  const appendMessage = useMutation(api.chats.appendMessage);

  const [question, setQuestion] = useState("");
  const [repoKey, setRepoKey] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Composer mode — Graph / Query / PR. Only Query is wired up today;
  // the other modes are placeholders for upcoming functionality.
  const [mode, setMode] = useState<ComposerMode>("query");

  const selected = useMemo(() => {
    if (repoKey && options.some((o) => o.key === repoKey)) {
      return options.find((o) => o.key === repoKey)!;
    }
    return options[0] ?? null;
  }, [options, repoKey]);

  async function startChat(qRaw: string) {
    const q = qRaw.trim();
    if (!selected) {
      setError("Pick a repository first");
      return;
    }
    if (q.length < 2) {
      setError("Enter a question");
      return;
    }
    if (!isAuthenticated) {
      setError("Sign in to chat");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const chatId = await createChat({
        owner: selected.owner,
        repo: selected.repo,
        label: selected.label,
        title: titleFromQuestion(q),
      });
      await appendMessage({
        chatId,
        role: "user",
        content: q,
        title: titleFromQuestion(q),
      });
      router.push(queryChatPath(chatId));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not start chat");
      setLoading(false);
    }
  }

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    void startChat(question);
  }

  const name = firstName(viewer?.name, viewer?.email);

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col overflow-y-auto bg-white">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          backgroundImage:
            "radial-gradient(circle at 1px 1px, rgba(15,23,42,0.09) 1px, transparent 0)",
          backgroundSize: "20px 20px",
        }}
      />

      <div className="relative flex w-full flex-1 flex-col items-center justify-center px-6 py-12 sm:px-10 lg:px-16">
        <div className="w-full max-w-4xl">
          <h1 className="text-center text-[1.85rem] font-medium tracking-[-0.03em] text-[#0b0d10] sm:text-[2.15rem]">
            Ready when you are, {name}.
          </h1>

          <form
            onSubmit={onSubmit}
            className="mt-9 w-full rounded-[1.6rem] border border-black/[0.07] bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03),0_18px_40px_rgba(0,0,0,0.05)]"
          >
            <textarea
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void startChat(question);
                }
              }}
              placeholder="Ask about structure, dependencies, hubs, or how modules connect…"
              rows={3}
              disabled={loading}
              className="w-full resize-none bg-transparent px-6 pt-5 text-[15px] font-light leading-relaxed text-[#0b0d10] outline-none placeholder:text-[#9ca3af]"
            />
            <div className="flex items-center justify-between gap-3 px-4 pb-3.5 pt-1">
              <RepoMenu
                options={options}
                selected={selected}
                onSelect={(o) => setRepoKey(o.key)}
              />
              <button
                type="submit"
                disabled={loading || !selected}
                className={clsx(
                  "grid h-10 w-10 place-items-center rounded-full bg-[#0b0d10] text-white transition hover:bg-black",
                  (loading || !selected) && "opacity-40",
                )}
                aria-label="Send"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" strokeWidth={1.75} />
                ) : (
                  <ArrowUp className="h-4 w-4" strokeWidth={2} />
                )}
              </button>
            </div>

            <div className="flex items-center justify-end gap-3 rounded-b-[1.6rem] border-t border-black/[0.05] bg-[#f7f7f5] px-4 py-2.5">
              <ModeMenu mode={mode} onSelect={setMode} />
            </div>
          </form>

          {error ? (
            <p className="mt-3 text-center text-sm font-light text-wire-ember">{error}</p>
          ) : null}

          <div className="mt-12 w-full">
            <p className="text-[13px] font-medium tracking-[-0.01em] text-[#0b0d10]">
              Users also ask
            </p>
            <ul className="mt-2">
              {SUGGESTIONS.map((s) => {
                const Icon = s.icon;
                return (
                  <li key={s.text} className="border-b border-black/[0.05] last:border-b-0">
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void startChat(s.text)}
                      className="flex w-full items-center justify-between gap-4 py-3.5 text-left text-[14.5px] font-light text-[#6b7280] transition hover:text-[#0b0d10]"
                    >
                      <span>{s.text}</span>
                      <Icon
                        className="h-4 w-4 shrink-0 text-[#c0c5cc]"
                        strokeWidth={1.4}
                      />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Thinking indicator: pixel loader + rotating phrases ─────── */

const GRAPH_PHRASES = [
  "Traversing the graph",
  "Following call paths",
  "Gathering evidence",
  "Ranking symbols",
];
const LLM_PHRASES = [
  "Thinking",
  "Reading the code",
  "Connecting the dots",
  "Weighing the evidence",
  "Drafting the answer",
];

function ThinkingIndicator({ phase }: { phase: "graph" | "llm" }) {
  const phrases = phase === "graph" ? GRAPH_PHRASES : LLM_PHRASES;
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    setIdx(0);
  }, [phase]);

  useEffect(() => {
    const t = window.setInterval(
      () => setIdx((v) => (v + 1) % phrases.length),
      2400,
    );
    return () => window.clearInterval(t);
  }, [phrases]);

  return <LoadingState size="sm" label={`${phrases[idx % phrases.length]}…`} />;
}

/* ─── DeepWiki-style evidence code panels ─────────────────────── */

type EvidenceRef = { label: string; path: string; line: number };

/** Parse `NODE label [src=path loc=Lnn]` entries from the graph context. */
function parseEvidenceRefs(graphContext: string): EvidenceRef[] {
  const out: EvidenceRef[] = [];
  const re = /^NODE\s+(.+?)\s+\[src=([^\s\]]+)\s+loc=L(\d+)/gim;
  let m: RegExpExecArray | null;
  while ((m = re.exec(graphContext)) !== null) {
    const line = Number(m[3]);
    if (!Number.isFinite(line)) continue;
    out.push({ label: m[1]!.trim(), path: m[2]!.trim(), line });
  }
  return out;
}

function slugifySymbol(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function symbolAnchorId(panelId: string, label: string): string {
  return `sym-${panelId}-${slugifySymbol(label)}`;
}

/**
 * Scroll the answer's citation to its snippet in the code column.
 * Returns false when the snippet isn't rendered (caller falls back to GitHub).
 */
function jumpToSymbol(panelId: string, label: string): boolean {
  const el = document.getElementById(symbolAnchorId(panelId, label));
  if (!el) return false;
  window.dispatchEvent(
    new CustomEvent("haywire-show-code", { detail: { panelId } }),
  );
  window.setTimeout(() => {
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    const row = el.closest("[data-snippet-row]") as HTMLElement | null;
    if (row) {
      row.style.transition = "background-color 400ms ease";
      const prev = row.style.backgroundColor;
      row.style.backgroundColor = "#ffe3d6";
      window.setTimeout(() => {
        row.style.backgroundColor = prev;
      }, 1100);
    }
  }, 90);
  return true;
}

// One fetch per file across all panels in the session.
const fileTextCache = new Map<string, Promise<string>>();
function fetchFileText(owner: string, repo: string, path: string): Promise<string> {
  const url = `https://raw.githubusercontent.com/${owner}/${repo}/HEAD/${path}`;
  let p = fileTextCache.get(url);
  if (!p) {
    p = fetch(url).then((r) =>
      r.ok ? r.text() : Promise.reject(new Error(String(r.status))),
    );
    p.catch(() => fileTextCache.delete(url));
    fileTextCache.set(url, p);
  }
  return p;
}

type Snippet = {
  key: string;
  path: string;
  symbols: { label: string; line: number }[];
};

function CodePanel({
  owner,
  repo,
  panelId,
  snippetDef,
}: {
  owner: string;
  repo: string;
  panelId: string;
  snippetDef: Snippet;
}) {
  const { path, symbols } = snippetDef;
  const [text, setText] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setText(null);
    setFailed(false);
    fetchFileText(owner, repo, path)
      .then((t) => {
        if (!cancelled) setText(t);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [owner, repo, path]);

  const lines = useMemo(
    () => [...new Set(symbols.map((s) => s.line))].sort((a, b) => a - b),
    [symbols],
  );

  const snippet = useMemo(() => {
    if (!text) return null;
    const all = text.split("\n");
    const first = lines[0] ?? 1;
    const last = lines[lines.length - 1] ?? first;
    const start = Math.max(1, first - 3);
    const end = Math.min(all.length, Math.min(start + 89, Math.max(last + 12, start + 27)));
    return { start, rows: all.slice(start - 1, end) };
  }, [text, lines]);

  const highlight = useMemo(() => new Set(lines), [lines]);
  const labelsByLine = useMemo(() => {
    const map = new Map<number, string[]>();
    for (const s of symbols) {
      const arr = map.get(s.line) ?? [];
      arr.push(s.label);
      map.set(s.line, arr);
    }
    return map;
  }, [symbols]);

  async function copySnippet() {
    if (!snippet) return;
    try {
      await navigator.clipboard.writeText(snippet.rows.join("\n"));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1200);
    } catch {
      // ignore
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border border-black/[0.07] bg-[#f6f7f8]">
      <div className="flex items-center gap-2 border-b border-black/[0.05] px-3.5 py-2">
        <span className="shrink-0 text-[11px] font-light text-[#9ca3af]">
          {owner}/{repo}
        </span>
        <a
          href={githubBlobUrl(owner, repo, path, lines[0])}
          target="_blank"
          rel="noreferrer"
          className="min-w-0 truncate font-mono text-[11.5px] font-medium text-[#374151] hover:text-[#0b0d10]"
          title={path}
        >
          {path}
        </a>
        <button
          type="button"
          onClick={() => void copySnippet()}
          aria-label="Copy snippet"
          className="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded-md text-[#9ca3af] transition hover:bg-black/[0.05] hover:text-[#0b0d10]"
        >
          {copied ? (
            <Check className="h-3 w-3" strokeWidth={2} />
          ) : (
            <Copy className="h-3 w-3" strokeWidth={1.75} />
          )}
        </button>
      </div>

      {snippet ? (
        <div className="max-h-80 overflow-auto py-1.5">
          <pre className="min-w-max font-mono text-[11.5px] leading-[1.65] text-[#374151]">
            {snippet.rows.map((row, i) => {
              const no = snippet.start + i;
              const hit = highlight.has(no);
              const anchors = labelsByLine.get(no);
              return (
                <div
                  key={no}
                  data-snippet-row
                  className={clsx("flex px-3.5", hit && "bg-[#eef7cf]")}
                >
                  {anchors?.map((label) => (
                    <span key={label} id={symbolAnchorId(panelId, label)} />
                  ))}
                  <span
                    className={clsx(
                      "w-10 shrink-0 select-none pr-3 text-right",
                      hit ? "font-semibold text-[#4d7c0f]" : "text-[#b6bcc4]",
                    )}
                  >
                    {no}
                  </span>
                  <span className="whitespace-pre">{row || " "}</span>
                </div>
              );
            })}
          </pre>
        </div>
      ) : failed ? (
        <p className="px-3.5 py-4 text-[12px] font-light text-[#9ca3af]">
          Couldn&rsquo;t load this file from GitHub (it may be private or moved).
        </p>
      ) : (
        <div className="animate-pulse space-y-2.5 px-3.5 py-4">
          {[..."aaaaaaa"].map((_, i) => (
            <div
              key={i}
              className={clsx(
                "h-2.5 rounded bg-black/[0.06]",
                ["w-11/12", "w-3/5", "w-4/5", "w-2/3", "w-5/6", "w-1/2", "w-3/4"][i % 7],
              )}
            />
          ))}
        </div>
      )}
    </div>
  );
}

/** Loose word-boundary check so `get_chat_model` matches `get_chat_model()`. */
function normalizeForMatch(s: string): string {
  return ` ${s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

function EvidencePanels({
  owner,
  repo,
  panelId,
  graphContext,
  answerBody,
}: {
  owner: string;
  repo: string;
  panelId: string;
  graphContext: string;
  answerBody: string;
}) {
  const snippets = useMemo(() => {
    const refs = parseEvidenceRefs(graphContext);
    if (!refs.length) return [];

    // Prefer the symbols the answer actually cites, in citation order.
    const normAnswer = normalizeForMatch(answerBody);
    const cited = refs
      .map((r) => {
        const norm = normalizeForMatch(r.label).slice(1, -1);
        if (norm.length < 3) return null;
        const at = normAnswer.indexOf(` ${norm} `);
        return at === -1 ? null : { ...r, at };
      })
      .filter(Boolean) as (EvidenceRef & { at: number })[];
    cited.sort((a, b) => a.at - b.at);

    const chosen: (EvidenceRef & { at: number })[] = cited.length
      ? cited
      : refs.slice(0, 6).map((r, i) => ({ ...r, at: i }));

    // Group by file, then cluster nearby lines into one snippet each.
    const byPath = new Map<string, (EvidenceRef & { at: number })[]>();
    for (const r of chosen) {
      const arr = byPath.get(r.path) ?? [];
      if (!arr.some((x) => x.label === r.label && x.line === r.line)) arr.push(r);
      byPath.set(r.path, arr);
    }

    const out: (Snippet & { at: number })[] = [];
    for (const [path, refsInFile] of byPath) {
      const sorted = [...refsInFile].sort((a, b) => a.line - b.line);
      let cluster: (EvidenceRef & { at: number })[] = [];
      const flush = () => {
        if (!cluster.length) return;
        out.push({
          key: `${path}:${cluster[0]!.line}`,
          path,
          symbols: cluster.map((c) => ({ label: c.label, line: c.line })),
          at: Math.min(...cluster.map((c) => c.at)),
        });
        cluster = [];
      };
      for (const r of sorted) {
        if (cluster.length && r.line - cluster[cluster.length - 1]!.line > 50) {
          flush();
        }
        cluster.push(r);
      }
      flush();
    }

    return out.sort((a, b) => a.at - b.at).slice(0, 6);
  }, [graphContext, answerBody]);

  if (!snippets.length) return null;
  return (
    <div className="space-y-4">
      {snippets.map((s) => (
        <CodePanel
          key={s.key}
          owner={owner}
          repo={repo}
          panelId={panelId}
          snippetDef={s}
        />
      ))}
    </div>
  );
}

/** Pulsing placeholder bars, DeepWiki-style, shown while an answer builds. */
function SkeletonBlock({ rows, className }: { rows: number; className?: string }) {
  const widths = ["w-11/12", "w-4/5", "w-3/5", "w-2/3", "w-5/6", "w-1/2", "w-3/4", "w-2/5"];
  return (
    <div className={clsx("animate-pulse rounded-2xl bg-[#f3f4f6] p-5", className)}>
      <div className="space-y-3.5">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className={clsx("h-3 rounded bg-black/[0.07]", widths[i % widths.length])} />
        ))}
      </div>
    </div>
  );
}

/** Right-hand evidence panel with Code / Graph tabs, DeepWiki-style. */
function RightPanelTabs({
  owner,
  repo,
  panelId,
  graphContext,
  traversal,
  graphResult,
  graphLoadError,
  loading,
  answerBody,
}: {
  owner: string;
  repo: string;
  panelId: string;
  graphContext: string;
  traversal: TraversalPath | null;
  graphResult: AnalyzeResult | null;
  graphLoadError?: string | null;
  loading: boolean;
  answerBody: string;
}) {
  const [tab, setTab] = useState<"code" | "graph">("code");

  // Citation clicks in the answer switch this pair back to the Code tab.
  useEffect(() => {
    const onShow = (e: Event) => {
      const detail = (e as CustomEvent).detail as { panelId?: string } | null;
      if (detail?.panelId === panelId) setTab("code");
    };
    window.addEventListener("haywire-show-code", onShow);
    return () => window.removeEventListener("haywire-show-code", onShow);
  }, [panelId]);

  const hasEvidence = Boolean(graphContext.trim());
  const hasGraph = Boolean(traversal);

  if (!hasEvidence && !hasGraph) {
    return loading ? <SkeletonBlock rows={16} /> : null;
  }

  // Fall back to whichever tab has content.
  const active =
    tab === "code" ? (hasEvidence ? "code" : "graph") : hasGraph ? "graph" : "code";

  const tabButton = (value: "code" | "graph", label: string, enabled: boolean, icon: ReactNode) => (
    <button
      type="button"
      disabled={!enabled}
      onClick={() => setTab(value)}
      className={clsx(
        "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[12px] font-medium transition",
        active === value
          ? "bg-white text-[#0b0d10] shadow-sm"
          : "text-[#6b7280] hover:text-[#0b0d10]",
        !enabled && "cursor-not-allowed opacity-40",
      )}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div className="min-w-0">
      <div className="mb-3 inline-flex rounded-lg border border-black/[0.07] bg-[#f3f4f6] p-0.5">
        {tabButton(
          "code",
          "Code",
          hasEvidence,
          <Code2 className="h-3.5 w-3.5" strokeWidth={1.75} />,
        )}
        {tabButton(
          "graph",
          "Graph",
          hasGraph,
          <Network className="h-3.5 w-3.5" strokeWidth={1.75} />,
        )}
      </div>

      {/* Code panels stay mounted (just hidden) so citation anchors resolve. */}
      <div className={active === "code" ? "" : "hidden"}>
        {hasEvidence ? (
          <EvidencePanels
            owner={owner}
            repo={repo}
            panelId={panelId}
            graphContext={graphContext}
            answerBody={answerBody}
          />
        ) : (
          <SkeletonBlock rows={12} />
        )}
      </div>

      {active === "graph" && traversal ? (
        graphResult ? (
          <AnswerGraph
            key={`${traversal.seeds.join(",")}-${traversal.visitOrder.length}-${answerBody.length}`}
            owner={owner}
            repo={repo}
            result={graphResult}
            traversal={traversal}
            graphContext={graphContext}
            answerBody={answerBody}
            heightClass="h-[26rem]"
          />
        ) : (
          <div className="flex h-[26rem] items-center justify-center rounded-xl border border-black/[0.08] bg-white">
            <p className="flex items-center gap-2 text-[12px] font-light text-[#9ca3af]">
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.5} />
              {graphLoadError || "Loading graph for replay…"}
            </p>
          </div>
        )
      ) : null}
    </div>
  );
}

/** Persisted chat thread. */
export function QueryChatView({ chatId }: { chatId: Id<"queryChats"> }) {
  const router = useRouter();
  const { isAuthenticated } = useConvexAuth();
  const data = useQuery(api.chats.get, isAuthenticated ? { chatId } : "skip");
  const appendMessage = useMutation(api.chats.appendMessage);
  const removeChat = useMutation(api.chats.remove);
  const recordChat = useMutation(api.usage.recordChat);

  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [streaming, setStreaming] = useState("");
  const [liveContext, setLiveContext] = useState<string | null>(null);
  const [liveTraversal, setLiveTraversal] = useState<TraversalPath | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [graphResult, setGraphResult] = useState<AnalyzeResult | null>(null);
  const [graphLoadError, setGraphLoadError] = useState<string | null>(null);
  const startedFor = useRef<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const chat = data?.chat ?? null;
  const messages = useMemo(() => data?.messages ?? [], [data]);

  // Pair turns chronologically. Memoized (with pre-normalized traversals) so
  // typing in the composer doesn't recreate objects and rebuild the graph.
  const pairs = useMemo(() => {
    const out: {
      user?: (typeof messages)[number];
      assistant?: (typeof messages)[number];
      storedTraversal: TraversalPath | null;
    }[] = [];
    for (const m of messages) {
      if (m.role === "user") out.push({ user: m, storedTraversal: null });
      else if (out.length === 0) out.push({ assistant: m, storedTraversal: null });
      else out[out.length - 1]!.assistant = m;
    }
    for (const p of out) {
      p.storedTraversal = normalizeTraversal(
        (p.assistant as { traversal?: unknown } | undefined)?.traversal,
      );
    }
    return out;
  }, [messages]);

  const exampleDetail = useQuery(
    api.examples.getByRepo,
    chat ? { owner: chat.owner, repo: chat.repo } : "skip",
  );
  const savedDetail = useQuery(
    api.graphs.getByRepo,
    chat && isAuthenticated ? { owner: chat.owner, repo: chat.repo } : "skip",
  );

  const graphDetailsReady =
    Boolean(chat) &&
    exampleDetail !== undefined &&
    (!isAuthenticated || savedDetail !== undefined);

  const graphUrl =
    exampleDetail?.displayGraphUrl ||
    exampleDetail?.graphUrl ||
    savedDetail?.graphUrl ||
    null;

  // Load graph JSON for traversal replay
  useEffect(() => {
    if (!chat || !graphUrl) {
      setGraphResult(null);
      return;
    }
    let cancelled = false;
    setGraphLoadError(null);
    (async () => {
      try {
        const res = await fetch(graphUrl);
        if (!res.ok) throw new Error(`Failed to load graph (${res.status})`);
        const raw = await res.json();
        const normalized = normalizeAnalyzePayload(raw, {
          owner: chat.owner,
          repo: chat.repo,
          nodeCount: exampleDetail?.nodeCount ?? savedDetail?.nodeCount,
          edgeCount: exampleDetail?.edgeCount ?? savedDetail?.edgeCount,
          communityCount:
            exampleDetail?.communityCount ?? savedDetail?.communityCount,
        });
        if (!cancelled) setGraphResult(normalized);
      } catch (err) {
        if (!cancelled) {
          setGraphResult(null);
          setGraphLoadError(
            err instanceof Error ? err.message : "Failed to load graph",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [chat, graphUrl, exampleDetail, savedDetail]);

  const runAssistant = useCallback(
    async (
      userQuestion: string,
      history: { role: "user" | "assistant"; content: string }[],
      resolvedGraphUrl: string | null,
    ) => {
      if (!chat) return;
      if (!resolvedGraphUrl) {
        setError(
          "No graph available for this repository. Open it from Graphs first, or pick an example.",
        );
        return;
      }
      setLoading(true);
      setError(null);
      setStatus("Traversing knowledge graph…");
      setStreaming("");
      setLiveContext(null);
      setLiveTraversal(null);
      try {
        const runStream = () =>
          streamQuery(
            {
              owner: chat.owner,
              repo: chat.repo,
              question: userQuestion,
              graphUrl: resolvedGraphUrl,
              history,
            },
            {
              onStatus: (m) => setStatus(m),
              onMeta: (meta) => {
                setLiveContext(meta.graph_context);
                setLiveTraversal(meta.traversal);
              },
              onToken: (t) => {
                setStatus(null);
                setStreaming((prev) => prev + t);
              },
            },
          );

        let usage: Awaited<ReturnType<typeof runStream>>;
        try {
          usage = await runStream();
        } catch (err) {
          // Dropped connections get one silent retry from scratch — a partial
          // answer is never shown or saved.
          const dropped =
            err instanceof Error &&
            (err.message === "STREAM_DROPPED" || /network|fetch|load failed/i.test(err.message));
          if (!dropped) throw err;
          setStreaming("");
          setStatus("Connection dropped — retrying…");
          usage = await runStream();
        }

        if (!usage.answer.trim()) {
          throw new Error(
            "The model didn't return an answer — the connection may have dropped. Please ask again.",
          );
        }

        const trav = usage.traversal;
        await appendMessage({
          chatId,
          role: "assistant",
          content: usage.answer,
          graphContext: usage.graph_context,
          traversal: trav
            ? {
                mode: trav.mode,
                depth: trav.depth,
                seeds: trav.seeds,
                visitOrder: trav.visitOrder.map((s) => ({
                  id: s.id,
                  label: s.label,
                  depth: s.depth,
                  seed: s.seed,
                  sourceFile: s.sourceFile || undefined,
                })),
                edges: trav.edges,
                nodeCount: trav.nodeCount,
              }
            : undefined,
          model: usage.model || undefined,
          elapsedMs: usage.elapsed_ms,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          costUsd: usage.cost_usd,
        });
        await recordChat({
          chatId,
          owner: chat.owner,
          repo: chat.repo,
          model: usage.model || undefined,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          costUsd: usage.cost_usd,
          elapsedMs: usage.elapsed_ms,
        });
        setStreaming("");
        setLiveContext(null);
        setLiveTraversal(null);
      } catch (err) {
        const message = err instanceof Error ? err.message : "Query failed";
        setError(
          message === "STREAM_DROPPED"
            ? "The connection dropped mid-answer. Please ask again."
            : message,
        );
        setStreaming("");
      } finally {
        setLoading(false);
        setStatus(null);
      }
    },
    [appendMessage, chat, chatId, recordChat],
  );

  // Auto-answer when the latest message is an unanswered user turn.
  useEffect(() => {
    if (!chat || !graphDetailsReady || loading || streaming) return;
    if (messages.length === 0) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== "user") return;
    if (startedFor.current === last._id) return;
    startedFor.current = last._id;
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role,
      content: m.content,
    }));
    void runAssistant(last.content, history, graphUrl);
  }, [
    chat,
    graphDetailsReady,
    graphUrl,
    loading,
    messages,
    runAssistant,
    streaming,
  ]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages.length, streaming, loading]);

  async function sendQuestion(raw: string) {
    if (!chat || loading) return;
    const q = raw.trim();
    if (q.length < 2) return;
    setQuestion("");
    const id = await appendMessage({ chatId, role: "user", content: q });
    startedFor.current = id;
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    await runAssistant(q, history, graphUrl);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await sendQuestion(question);
  }

  async function onDelete() {
    if (!confirm("Delete this chat?")) return;
    await removeChat({ chatId });
    router.push("/dashboard/query");
  }

  if (data === undefined) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <LoadingState />
      </div>
    );
  }

  if (data === null || !chat) {
    return (
      <div className="mx-auto flex max-w-lg flex-1 flex-col items-center justify-center px-6 text-center">
        <p className="font-display text-2xl font-bold">Chat not found</p>
        <Link href="/dashboard/query" className="mt-4 text-sm font-semibold underline">
          Back to Query
        </Link>
      </div>
    );
  }

  const latestIndex = pairs.length - 1;

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col bg-white">
      <header className="flex w-full shrink-0 items-center justify-end gap-1 border-b border-black/[0.05] px-6 py-2.5 sm:px-10 lg:px-14">
        <div className="flex shrink-0 items-center gap-1">
          <button
            type="button"
            onClick={onDelete}
            className="grid h-8 w-8 place-items-center rounded-full text-[#9ca3af] transition hover:bg-black/[0.04] hover:text-wire-ember"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.5} />
          </button>
          <Link
            href="/dashboard/query"
            className="inline-flex items-center gap-1.5 rounded-full bg-[#0b0d10] px-3.5 py-1.5 text-[12px] font-medium text-white"
          >
            <Plus className="h-3 w-3" strokeWidth={2} />
            New
          </Link>
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-6xl flex-col px-6 py-8 sm:px-10 lg:px-14 lg:py-10">
          {pairs.length === 0 ? (
            <p className="text-[14px] font-light text-[#9ca3af]">
              Ask a question to get started.
            </p>
          ) : (
            <div className="space-y-14">
              {pairs.map((p, i) => {
                const isLatest = i === latestIndex;
                const rawAnswer =
                  isLatest && streaming
                    ? streaming
                    : p.assistant?.content || "";
                const { body, followUps } = splitFollowUps(rawAnswer);
                const pairTraversal = isLatest
                  ? liveTraversal || p.storedTraversal
                  : p.storedTraversal;
                const graphContext =
                  (isLatest ? liveContext : null) ||
                  p.assistant?.graphContext ||
                  "";

                const hasEvidence = Boolean(graphContext.trim());
                const showRightColumn =
                  hasEvidence || Boolean(pairTraversal) || (isLatest && loading);
                const pairKey = p.user?._id || p.assistant?._id || String(i);

                return (
                  <section key={pairKey} className="min-w-0">
                    {i === 0 ? (
                      <p className="mb-2 flex items-center gap-1.5 text-[12px] font-light text-[#9ca3af]">
                        <GitBranch className="h-3 w-3" strokeWidth={1.5} />
                        {chat.owner}/{chat.repo}
                      </p>
                    ) : null}

                    {p.user ? (
                      <h2 className="mb-6 max-w-3xl font-display text-[22px] font-medium leading-snug tracking-[-0.02em] text-[#0b0d10]">
                        {p.user.content}
                      </h2>
                    ) : null}

                    {isLatest && status ? (
                      <div className="mb-5">
                        <ThinkingIndicator
                          phase={
                            status.toLowerCase().includes("graph")
                              ? "graph"
                              : "llm"
                          }
                        />
                      </div>
                    ) : null}

                    <div
                      className={clsx(
                        showRightColumn &&
                          "lg:grid lg:grid-cols-[minmax(0,10fr)_minmax(0,9fr)] lg:items-stretch lg:gap-7",
                      )}
                    >
                      <div className="min-w-0">
                        {body ? (
                          <div className="rounded-2xl border border-black/[0.07] bg-white p-5 sm:p-6">
                            <MarkdownBody
                              content={body}
                              owner={chat.owner}
                              repo={chat.repo}
                              graphContext={graphContext}
                              panelId={pairKey}
                            />
                          </div>
                        ) : isLatest && loading ? (
                          <SkeletonBlock rows={6} />
                        ) : p.assistant ? (
                          <div className="rounded-2xl border border-black/[0.07] bg-[#fafafa] p-5">
                            <p className="text-[13px] font-light text-[#9ca3af]">
                              No answer was captured for this turn — the
                              connection likely dropped mid-response. Ask the
                              question again.
                            </p>
                          </div>
                        ) : null}
                      </div>

                      {showRightColumn ? (
                        // The answer column sets the row height; the code column
                        // ends where the answer ends and scrolls internally.
                        <div className="relative mt-6 min-w-0 lg:mt-0">
                          <div className="lg:absolute lg:inset-0 lg:overflow-y-auto lg:pr-0.5">
                            <RightPanelTabs
                              owner={chat.owner}
                              repo={chat.repo}
                              panelId={pairKey}
                              graphContext={graphContext}
                              traversal={pairTraversal}
                              graphResult={graphResult}
                              graphLoadError={graphLoadError}
                              loading={isLatest && loading}
                              answerBody={isLatest && loading ? "" : body}
                            />
                          </div>
                        </div>
                      ) : null}
                    </div>

                    {isLatest && !loading && !streaming ? (
                      <FollowUpList
                        questions={followUps}
                        disabled={loading}
                        onPick={(q) => void sendQuestion(q)}
                      />
                    ) : null}
                  </section>
                );
              })}
            </div>
          )}

          {error ? <p className="mt-4 text-sm font-light text-wire-ember">{error}</p> : null}
          <div ref={bottomRef} className="h-28" />
        </div>
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center px-6 pb-6 sm:px-10">
        <form
          onSubmit={onSubmit}
          className="pointer-events-auto flex w-full max-w-5xl items-center gap-2 rounded-full border border-black/[0.08] bg-white/95 px-2.5 py-2 shadow-[0_10px_40px_rgba(0,0,0,0.08)] backdrop-blur"
        >
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask a follow-up"
            disabled={loading}
            className="min-w-0 flex-1 bg-transparent px-3 py-2 text-[14px] font-light outline-none placeholder:text-[#9ca3af]"
          />
          <button
            type="submit"
            disabled={loading}
            className={clsx(
              "grid h-9 w-9 place-items-center rounded-full bg-[#0b0d10] text-white transition",
              loading && "opacity-40",
            )}
            aria-label="Send"
          >
            {loading ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.75} />
            ) : (
              <ArrowUp className="h-3.5 w-3.5" strokeWidth={2} />
            )}
          </button>
        </form>
      </div>
    </div>
  );
}
